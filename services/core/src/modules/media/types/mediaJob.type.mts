import type { MediaJobStatus, MediaJobType } from "@shared/types";
import type mongoose from "mongoose";

export interface IMediaJobLastError {
  code?: string | null;
  message?: string | null;
  retryable?: boolean | null;
  occurredAt?: Date | null;
}

export interface IMediaJob {
  createdAt?: Date;
  updatedAt?: Date;

  mediaId: mongoose.Types.ObjectId;
  postId?: mongoose.Types.ObjectId | null;

  jobType: MediaJobType;
  status: MediaJobStatus;

  // Makes repeated job creation idempotent.
  idempotencyKey: string;

  // Increment when the processing pipeline changes.
  pipelineVersion: string;

  priority?: number;

  attempts: number;
  maxAttempts: number;

  // Earliest time the job may run or retry.
  availableAt: Date;

  startedAt?: Date | null;
  completedAt?: Date | null;

  // Lease fields for recovering jobs after worker crashes.
  lockedBy?: string | null;
  lockToken?: string | null;
  leaseExpiresAt?: Date | null;

  lastError?: IMediaJobLastError;
}
