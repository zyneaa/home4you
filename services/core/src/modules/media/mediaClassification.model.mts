import mongoose, {
  Schema,
  model,
  type InferSchemaType,
  type Model,
} from "mongoose";

export const ClassificationProvider = {
  GOOGLE_CLOUD_VISION: "google-cloud-vision",
} as const;

const ClassificationLabelSchema = new Schema(
  {
    // Your normalized, application-owned label.
    name: {
      type: String,
      required: true,
      trim: true,
    },

    // Confidence supplied by the provider, when available.
    score: {
      type: Number,
      required: true,
      min: 0,
      max: 1,
    },

    // Original provider label, useful for auditing normalization.
    providerLabel: {
      type: String,
      required: true,
      trim: true,
    },
  },
  {
    _id: false,
    strict: "throw",
  },
);

const MediaClassificationSchema = new Schema(
  {
    mediaId: {
      type: Schema.Types.ObjectId,
      ref: "Media",
      required: true,
      unique: true,
    },

    provider: {
      type: String,
      enum: Object.values(ClassificationProvider),
      required: true,
    },

    // Your adapter's version of the classification pipeline.
    pipelineVersion: {
      type: String,
      required: true,
    },

    // Provider/model version if available.
    modelVersion: {
      type: String,
      default: null,
    },

    // Identifies the exact source image that was analyzed.
    sourceFingerprint: {
      type: String,
      required: true,
    },

    labels: {
      type: [ClassificationLabelSchema],
      default: [],
    },

    // Optional categories mapped to your own taxonomy.
    categories: {
      type: [String],
      default: [],
    },

    classifiedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    versionKey: false,
    strict: "throw",
  },
);

MediaClassificationSchema.index({
  categories: 1,
});

export type MediaClassificationDocument = InferSchemaType<
  typeof MediaClassificationSchema
>;

export const MediaClassification =
  (mongoose.models["MediaClassification"] as
    | Model<MediaClassificationDocument>
    | undefined) ??
  model<MediaClassificationDocument>(
    "MediaClassification",
    MediaClassificationSchema,
  );
