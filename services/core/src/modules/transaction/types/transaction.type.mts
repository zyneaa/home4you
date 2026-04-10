import type mongoose from "mongoose";

import type { CurrencyType, TransactionStatus, TransactionType } from "@shared/types"

export interface IProperty {
  user: mongoose.Types.ObjectId;

  amount: number;
  currency?: CurrencyType;

  transactionType: TransactionType;
  status: TransactionStatus;

  referenceId: string;
}
