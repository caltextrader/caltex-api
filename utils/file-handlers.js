import nodemailer from "nodemailer";
import {
  MAIL_USER,
  FIREBASE_BUCKET_NAME,
  HTTP_MULTER_NAME_ERROR
} from "../config/constants";
import multer from "multer";
import { v4 as uniq } from "uuid";
import { storage } from "../config/firebase";
import { createError, console500MSG } from "./error";
import path from "path";
import { isObject } from "./validators";

export const deleteFirebaseFile = async filePath => {
  try {
    if (!filePath) return;
    filePath = decodeURIComponent(path.basename(filePath));
    storage
      .bucket(FIREBASE_BUCKET_NAME)
      .file(filePath)
      .delete();
  } catch (err) {
    console500MSG(err);
  }
};

export const sendMail = (
  mailOptions = {},
  cb,
  service = "Gmail",
  user = MAIL_USER,
  pass = process.env.MAIL_PWD
) => {
  const transporter = nodemailer.createTransport({
    service,
    auth: {
      user,
      pass
    }
  });

  mailOptions.from = mailOptions.from || user;

  transporter.sendMail(mailOptions, (err, info) => {
    if (err)
      console.warn(
        `[SERVER_WARN: ${mailOptions.subject ||
          "MAIL"}] Encountered an error sending mail to ${
          mailOptions.to
        } at ${new Date()}`
      );
    cb(err, info);
  });
};

export const uploadFile = (config = {}) => {
  config = {
    dirPath: "avatars",
    type: "image",
    single: true,
    defaultFieldName: "avatar",
    bodySet: "",
    required: true,
    ...config
  };

  return [
    (req, res, next) => {
      req.skipMulterUpload = false;

      const _multer = multer({
        storage: new multer.memoryStorage()
      });

      const f = config.fields || req.query.fields;

      const maxUpload = Number(req.query.maxUpload) || 1;

      const cb = f
        ? _multer.fields(
            (() => {
              const arr = [];

              if (typeof f === "string") {
                for (const name of f.split(" ")) {
                  arr.push({ name, maxCount: maxUpload });
                }
              }

              return arr;
            })()
          )
        : _multer[config.single ? "single" : "array"](
            req.query.fieldName || config.defaultFieldName,
            maxUpload
          );

      return cb(req, res, function(err) {
        if (err) {
          if (!config.required && err.code === HTTP_MULTER_NAME_ERROR) {
            req.skipMulterUpload = true;
            next();
          } else next(err);
          return;
        }

        (async () => {
          try {
            const appendBodySet = ({ fieldname, publicUrl }) => {
              if (!req.body[config.bodySet]) req.body[config.bodySet] = {};
              req.body[config.bodySet][fieldname] = publicUrl;
            };

            if (req.skipMulterUpload) return next();

            if (req.file) {
              req.file = await uploadToFirebase(req.file, config);

              if (config.bodySet) appendBodySet(req.file);
            } else if (req.files) {
              const uploadFiles = async (files = req.files) => {
                const errs = [];
                for (let i = 0; i < files.length; i++) {
                  let file;
                  try {
                    file = files[i];
                    files[i] = await uploadToFirebase(file, config);

                    if (config.bodySet) appendBodySet(file);
                  } catch (err) {
                    if (req.query.withBatchFailure === "true")
                      errs.push(createError(err));
                    else throw err;
                  }
                }

                if (errs.length) {
                  const err = {
                    name: "FILE_UPLOAD_ERROR",
                    message: `${
                      errs.length > 1 ? "Batch" : "File"
                    } upload failed`,
                    details: errs,
                    status: 409
                  };
                  console500MSG(err);
                  throw err;
                }
              };

              if (isObject(req.files)) {
                for (const key in req.files) {
                  await uploadFiles(req.files[key]);
                }
              } else uploadFiles();
            }
            next();
          } catch (err) {
            next(err);
          }
        })();
      });
    }
  ];
};

export const uploadToFirebase = (file, config) =>
  new Promise((resolve, reject) => {
    if (file.mimetype.indexOf(config.type) === -1)
      return reject(`File mimetype ${file.mimetype} not supported`);

    if (!file.buffer)
      return reject(
        createError(`File content is either damaged or corrupt`, 409)
      );

    const filename =
      `${config.dirPath ? config.dirPath + "/" : ""}caltex-${(file.fieldname ||
        config.defaultFieldName ||
        config.dirPath ||
        config.type) + "-"}` +
      uniq() +
      path.extname(file.originalname);

    const bucket = storage.bucket(FIREBASE_BUCKET_NAME);
    const fileRef = bucket.file(filename);

    const streamConfig = {
      metadata: {
        contentType: file.mimetype
      }
    };

    const outstream = fileRef.createWriteStream(streamConfig);

    const handleError = err => reject(err);

    const handleSuccess = () => {
      file.filename = filename;
      fileRef
        .makePublic()
        .then(() => {
          file.publicUrl = fileRef.publicUrl();
          resolve(file);
        })
        .catch(handleError);
    };

    outstream.on("error", handleError);
    outstream.on("finish", handleSuccess);

    outstream.write(file.buffer);
    outstream.end();
  });
