import User from "../models/User";
import { createError } from "../utils/error";
import bcrypt from "bcrypt";
import {
  generateBcryptHash,
  deleteCookie,
  setJWTCookie,
  authUser
} from "../utils/auth";
import {
  CLIENT_ORIGIN,
  HTTP_403_MSG,
  COOKIE_ACC_VERIFIC,
  COOKIE_PWD_RESET,
  COOKIE_ACCESS_TOKEN,
  COOKIE_REFRESH_TOKEN,
  SESSION_COOKIE_DURATION,
  HTTP_401_MSG,
  HTTP_CODE_ACCOUNT_VERIFICATION_ERROR,
  HTTP_CODE_MAIL_ERROR
} from "../config/constants";
import { sendMail } from "../utils/file-handlers";
import { verifyToken } from "../middlewares";
import { serializeUserToken } from "../utils/serializers";
import { createSuccessBody } from "../utils/normalizers";
import { validateUserToken } from "../utils/validators";
import { userExist } from "../middlewares";

const mailAccVerificationToken = (email, token, reject, resolve) => {
  sendMail(
    {
      to: email,
      from: "noreply@gmail.com",
      subject: "Caltex account verification",
      text: `
        Welcome to caltex! 🌱 To get started on your financial
        journey, kindly click the link below for OTP verification.
        Your account's security and growth are our top priorities.
        Let's build a prosperous future together! [Verification Link]
        OTP = ${token}
        ${CLIENT_ORIGIN}/auth/token-verification/account
        `
    },
    err => {
      if (err) reject(err);
      else resolve("Verification token as been sent to your mail");
    }
  );
};

const mailAndSerializePwdResetToken = async (user, next, res) => {
  if (user.accountExpires) throw createError(HTTP_403_MSG, 403);

  const token = await serializeUserToken(user);

  await user.save();

  sendMail(
    {
      to: user.email,
      from: "noreply@gmail.com",
      subject: "Caltex account password Reset",
      text: `Your reset code is: ${token}`
    },
    err => {
      if (err) {
        return next(err);
      } else {
        return res.json(
          createSuccessBody({ message: "An email has been sent to you" })
        );
      }
    }
  );
};

export const signup = async (req, res, next) => {
  try {
    let user = await User.findOne({
      email: req.body.email
    });

    if (!user)
      user = await User.findOne({
        username: req.body.username
      });

    if (user) {
      const emailExist = user.email === req.body.email;

      const nameExist = user.username === req.body.username;

      throw createError(
        `A user with the specified${emailExist ? " email" : ""}${
          nameExist ? ` ${emailExist ? "and username" : "username"}` : ""
        } exist!`
      );
    }

    req.body.photoUrl = req.file?.publicUrl;

    const token = await serializeUserToken(req.body);

    user = await new User(req.body).save();

    const io = req.app.get("socketIo");
    io && io.emit("user", user);

    const sendBody = () =>
      res.json(
        createSuccessBody({
          message: `Thank you for signing up${
            req.body.provider
              ? ""
              : ". Please check your email and verify your account"
          }!`
        })
      );

    if (user.provider) return sendBody();

    const handleErr = () => {
      next(
        createError(
          "Account has been created successfully! Encountered an error sending verification code to your mail.",
          400,
          HTTP_CODE_MAIL_ERROR
        )
      );
    };

    // setJWTCookie(COOKIE_ACC_VERIFIC, user.id, res);

    mailAccVerificationToken(user.email, token, handleErr, sendBody);
  } catch (err) {
    next(err);
  }
};

export const signin = async (req, res, next) => {
  try {
    console.log("signing..", req.body);
    if (
      !(
        !(req.body.placeholder || req.body.email || req.body.username) ||
        req.body.password
      )
    )
      throw "Invalid body request. Expect (placeholder or email or username) and password included";

    const query = {
      $or: [
        { email: req.body.placeholder || req.body.email },
        {
          username: req.body.placeholder || req.body.username
        }
      ]
    };
    let user = await User.findOne(query);

    switch (req.body.provider) {
      case "google":
        if (!user) user = await new User(req.body).save();
        break;
      default:
        if (!user) throw createError("Account is not registered");

        if (user.accountExpires)
          throw createError(
            "Login access denied. Account is not verified.",
            400,
            HTTP_CODE_ACCOUNT_VERIFICATION_ERROR
          );

        if (!(await bcrypt.compare(req.body.password, user.password || "")))
          throw createError("Email or password is incorrect");
        break;
    }

    user = await User.findByIdAndUpdate(
      { _id: user.id },
      {
        isLogin: true
      },
      { new: true }
    );

    setJWTCookie(
      COOKIE_ACCESS_TOKEN,
      user.id,
      res,
      SESSION_COOKIE_DURATION.accessToken
    );

    setJWTCookie(
      COOKIE_REFRESH_TOKEN,
      user.id,
      res,
      SESSION_COOKIE_DURATION.refreshToken,
      req.body.rememberMe
    );

    res.json(
      createSuccessBody({
        data: user,
        message: "Signed in successfully"
      })
    );
  } catch (err) {
    next(err);
  }
};

export const signout = async (req, res, next) => {
  try {
    deleteCookie(COOKIE_ACCESS_TOKEN, res);
    deleteCookie(COOKIE_REFRESH_TOKEN, res);

    res.json(createSuccessBody({ message: "You just got signed out!" }));

    const user = await User.findById(req.user.id);

    await user.updateOne({
      isLogin: false,
      settings: {
        ...user.settings,
        ...req.body.settings
      }
    });
  } catch (err) {
    next(err);
  }
};

export const recoverPwd = async (req, res, next) => {
  try {
    const user = await User.findOne({
      email: req.body.email,
      accountExpires: null
    });

    if (!user) throw createError("Account isn't registered or verified", 400);

    if (req.cookies[COOKIE_PWD_RESET])
      verifyToken(req, {
        cookieKey: COOKIE_PWD_RESET,
        hasForbidden: true
      });
    else setJWTCookie(COOKIE_PWD_RESET, user.id, res);

    await mailAndSerializePwdResetToken(user, next, res);
  } catch (err) {
    if (req.cookies[COOKIE_PWD_RESET]) deleteCookie(COOKIE_PWD_RESET, res);

    next(err);
  }
};

export const verifyUserToken = async (req, res, next) => {
  try {
    console.log(req.body, "toen ver");
    const reason = req.params.reason;

    if (!{ account: true }[reason])
      throw "Invalid reason to verify account. Expect /verify-token/<account>";

    if (!(req.body.token && req.body.email))
      throw "Invalid request body. Expect an email and a token";

    const user = await User.findOne({
      accountExpires: { $ne: null },
      email: req.body.email
    });

    if (!user) throw createError(HTTP_401_MSG, 403);

    if (!(await bcrypt.compare(req.body.password, user.password)))
      throw "Invalid credentials. Expect email, password and token to be valid";

    await validateUserToken(user, req.body.token);

    await user.updateOne({
      accountExpires: null,
      resetToken: "",
      resetDate: null
    });

    deleteCookie(COOKIE_ACC_VERIFIC, res);

    res.json(
      createSuccessBody({
        message: "Verification code has been verified"
      })
    );
  } catch (err) {
    next(err);
  }
};

export const resetPwd = async (req, res, next) => {
  try {
    if (!(req.body.email && req.body.token && req.body.password))
      throw "Invalid body. Expect both user email, password and token";

    const user = await User.findOne({
      accountExpires: null,
      email: req.body.email
    });

    await validateUserToken(user, req.body.token);

    if (user.provider)
      throw createError(
        `Failed to reset password. Account is registered under a third party provider`
      );

    await user.updateOne({
      password: await generateBcryptHash(req.body.password),
      resetDate: null,
      resetToken: ""
    });

    deleteCookie(COOKIE_PWD_RESET, res);

    res.json(
      createSuccessBody({
        message: "Password reset successful"
      })
    );
  } catch (err) {
    next(err);
  }
};

export const refreshToken = async (req, res, next) => {
  try {
    verifyToken(req, {
      cookieKey: COOKIE_REFRESH_TOKEN
    });

    if (req.user) {
      const user = await User.findById(req.user.id);

      if (!user || user.accountExpires) throw createError(HTTP_403_MSG, 403);

      setJWTCookie(
        COOKIE_ACCESS_TOKEN,
        req.user.id,
        res,
        SESSION_COOKIE_DURATION.accessToken
      );
    } else throw createError(HTTP_403_MSG, 403);

    res.json(createSuccessBody({ message: "Token refreshed" }));
  } catch (err) {
    next(err);
  }
};

export const generateUserToken = async (req, res, next) => {
  try {
    console.log("gen new toke...", req.params.reason, req.body);

    const withCookies = !!Object.keys(req.cookies).length;

    console.log(withCookies);

    if (withCookies) {
      const cookieKey = {
        // "account-verification": COOKIE_ACC_VERIFIC,
        "password-reset": COOKIE_PWD_RESET
      }[req.query.reason];

      verifyToken(req, {
        cookieKey,
        hasForbidden: true
      });

      await userExist(req, res);
    } else req.user = await authUser(req.body);

    const saveAndSerialize = async user => {
      const token = await serializeUserToken(user);

      await user.save();

      return token;
    };

    const resolver = message => {
      console.log(message, "...message");
      res.json(createSuccessBody({ message }));
    };

    switch (req.params.reason) {
      case "account-verification":
        if (!req.user.accountExpires)
          throw createError("Account has been verified!", 403);

        mailAccVerificationToken(
          req.user.email,
          await saveAndSerialize(req.user),
          next,
          resolver
        );
        break;
      case "password-reset":
        await mailAndSerializePwdResetToken(req.user, next, res);
      default:
        break;
    }
  } catch (err) {
    next(err);
  }
};
