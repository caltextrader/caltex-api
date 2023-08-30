import mongoose from "mongoose";
import { isEmail } from "../utils/validators";
import { generateBcryptHash } from "../utils/auth";

const schema = new mongoose.Schema(
  {
    lastname: {
      type: String,
      required: "Your lastname is required"
    },
    firstname: {
      type: String,
      required: "Your firstname is required"
    },
    username: {
      type: String,
      unique: true,
      message: "Username isn't available"
    },
    email: {
      type: String,
      required: "Your email is required",
      unique: true,
      validate: {
        validator: function(v) {
          return isEmail(v);
        },
        message: "Your email address is invalid"
      }
    },
    password: {
      type: String,
      required: "Your password is required",
      validate: {
        validator: function(v) {
          return v.length >= 8;
        },
        message: "Password is shorter than minimum allowed length (8)"
      }
    },
    photoUrl: String,
    lastLogin: Date,
    isLogin: {
      type: Boolean,
      default: false
    },
    provider: String,
    resetToken: String,
    resetDate: Date,
    settings: {
      type: Object
    },
    emailVerified: {
      type: Boolean,
      default: function() {
        return !!this.provider;
      }
    }
  },
  {
    collection: "user",
    timestamps: true,
    versionKey: false,
    toJSON: {
      transform(doc, ret) {
        ret.id = ret._id;

        delete ret._id;
        delete ret.password;
        delete ret.resetToken;
        delete ret.resetDate;

        if (ret.settings) delete ret.settings._id;
      }
    }
  }
);

schema.pre("save", async function(next) {
  try {
    if (this.isModified("password") || this.isNew) {
      if (this.password)
        this.password = await generateBcryptHash(this.password);
    }
    next();
  } catch (error) {
    return next(error);
  }
  next();
});

export default mongoose.model("user", schema);
