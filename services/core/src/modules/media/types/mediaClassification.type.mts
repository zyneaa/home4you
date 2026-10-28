import type { ClassificationProvider } from "@shared/types";
import type mongoose from "mongoose";

export interface IMediaClassificationLabel {
  // Your normalized, application-owned label.
  name: string;

  // Confidence supplied by the provider, when available.
  score: number;

  // Original provider label, useful for auditing normalization.
  providerLabel: string;
}

export interface IMediaClassification {
  mediaId: mongoose.Types.ObjectId;

  provider: ClassificationProvider;

  // Your adapter's version of the classification pipeline.
  pipelineVersion: string;

  // Provider/model version if available.
  modelVersion?: string | null;

  // Identifies the exact source image that was analyzed.
  sourceFingerprint: string;

  labels: IMediaClassificationLabel[];

  // Optional categories mapped to your own taxonomy.
  categories?: string[];

  classifiedAt: Date;
}
