import {
  CurrencyType,
  TransactionStatus,
  TransactionType,
} from "@shared/types";
import { model, Schema } from "mongoose";

import type { ITransaction } from "./types/transaction.type.mjs";

const TransactionSchema = new Schema<ITransaction>({
  user: {
    type: Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true,
  },

  amount: {
    type: Number,
    required: true,
    default: 0,
  },
  currency: {
    type: String,
    enum: Object.values(CurrencyType),
    default: CurrencyType.KYAT,
    required: true,
  },
  transactionType: {
    type: String,
    enum: Object.values(TransactionType),
    required: true,
  },
  status: {
    type: String,
    enum: Object.values(TransactionStatus),
    required: true,
    default: TransactionStatus.PENDING,
  },

  referenceId: {
    type: String,
    required: true,
  },
});

export const Transaction = model<ITransaction>(
  "Transaction",
  TransactionSchema,
);
