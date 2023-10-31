import mongoose from "mongoose";
import { createError } from "../utils/error";

const allowedStatus = ["awaiting", "confirmed", "rejected"];

const schema = new mongoose.Schema(
  {
    rewarded: {
      type: Boolean,
      default: false
    },
    autoGenerated: {
      type: Boolean,
      default: function() {
        return !!this.rewarded;
      }
    },
    user: {
      type: mongoose.Types.ObjectId,
      ref: "user",
      required: "Transaction user id is required"
    },
    currency: {
      type: String,
      required: "Transaction currency is required."
    },

    paymentType: {
      type: String,
      enum: ["fiat", "crypto"],
      required:
        "Transaction payment type is required. Expect one of <fiat|crypto>"
    },

    transactionType: {
      type: String,
      enum: ["deposit", "withdrawal"],
      default: "deposit"
    },
    walletAddress: {
      type: String,
      required: [
        function() {
          return this.autoGenerated ? false : !this.isDeposit;
        },
        "Transaction wallet address is required"
      ]
    },
    paymentProofUrl: {
      type: String,
      required: [
        function() {
          return this.autoGenerated ? false : this.isDeposit;
        },
        "Payment proof is required. Upload a copy of your transaction for confirmation"
      ]
    },
    amount: {
      type: Number,
      required: "Transaction amount is required"
    },
    description: {
      type: "String",
      default: function() {
        return this.rewarded ? "Referral commission" : "";
      }
    },
    investment: {
      type: mongoose.Types.ObjectId,
      ref: "investment"
    },
    status: {
      type: String,
      default: function() {
        return this.autoGenerated ? "confirmed" : "awaiting";
      },
      set(v) {
        if (!allowedStatus.includes(v)) {
          const err =
            "Invalid transaction status. Expect one of <awaiting|confirmed|rejected>";
          throw this.invalidate
            ? this.invalidate("status", err)
            : createError(err, 400, "ValidationError");
        }

        return v;
      }
    },
    localPayment: {
      type: new mongoose.Schema(
        {
          currency: {
            type: String,
            enum: ["USD", "EUR"],
            required: "Local payment currency is required"
          }
        },
        {
          toJSON: {
            transform(doc, ret) {
              delete ret._id;
            }
          }
        }
      ),
      default: {
        currency: "USD"
      }
    },
    availableAmount: {
      type: Number,
      default: function() {
        return this.isDeposit ? this.amount : undefined;
      }
    },
    markedAt: Date,
    markedBy: {
      type: mongoose.Types.ObjectId,
      ref: "user"
    },
    retrievalReference: [
      {
        type: mongoose.Types.ObjectId,
        ref: "transaction"
      }
    ],
    metadata: {
      type: Object,
      default: {
        _id: new mongoose.Types.ObjectId()
      }
    }
  },
  {
    collection: "transaction",
    timestamps: true,
    versionKey: false,
    toJSON: {
      transform(doc, ret) {
        ret.id = ret._id;
        delete ret._id;
        delete ret.metadata._id;
      }
    }
  }
);

schema.virtual("isDeposit").get(function() {
  return this.transactionType === "deposit";
});

export default mongoose.model("transaction", schema);