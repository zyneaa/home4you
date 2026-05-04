import type {
  CurrencyType,
  TransactionStatus,
  TransactionType,
} from "@shared/types";
import type mongoose from "mongoose";

export interface ITransaction {
  user: mongoose.Types.ObjectId;

  amount: number;
  currency?: CurrencyType;

  transactionType: TransactionType;
  status: TransactionStatus;

  referenceId: string;
}
