import mongoose, {
  Schema,
  model,
  type InferSchemaType,
  type Model,
} from "mongoose";

export const MediaJobType = {
  CLASSIFY_IMAGE: "CLASSIFY_IMAGE",
  OPTIMIZE_IMAGE: "OPTIMIZE_IMAGE",
  GENERATE_VIDEO_RENDITIONS: "GENERATE_VIDEO_RENDITIONS",
} as const;

export const MediaJobStatus = {
  PENDING: "PENDING",
  PROCESSING: "PROCESSING",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
} as const;

const MediaJobSchema = new Schema(
  {
    mediaId: {
      type: Schema.Types.ObjectId,
      ref: "Media",
      required: true,
      index: true,
    },

    postId: {
      type: Schema.Types.ObjectId,
      ref: "Post",
      default: null,
    },

    jobType: {
      type: String,
      enum: Object.values(MediaJobType),
      required: true,
    },

    status: {
      type: String,
      enum: Object.values(MediaJobStatus),
      required: true,
      default: MediaJobStatus.PENDING,
    },

    // Makes repeated job creation idempotent.
    idempotencyKey: {
      type: String,
      required: true,
      unique: true,
    },

    // Increment when the processing pipeline changes.
    pipelineVersion: {
      type: String,
      required: true,
    },

    priority: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },

    attempts: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },

    maxAttempts: {
      type: Number,
      required: true,
      default: 5,
      min: 1,
    },

    // Earliest time the job may run or retry.
    availableAt: {
      type: Date,
      required: true,
      default: Date.now,
      index: true,
    },

    startedAt: {
      type: Date,
      default: null,
    },

    completedAt: {
      type: Date,
      default: null,
    },

    // Lease fields for recovering jobs after worker crashes.
    lockedBy: {
      type: String,
      default: null,
    },

    lockToken: {
      type: String,
      default: null,
    },

    leaseExpiresAt: {
      type: Date,
      default: null,
    },

    lastError: {
      code: {
        type: String,
        default: null,
      },
      message: {
        type: String,
        default: null,
      },
      retryable: {
        type: Boolean,
        default: null,
      },
      occurredAt: {
        type: Date,
        default: null,
      },
    },
  },
  {
    timestamps: true,
    versionKey: false,
    strict: "throw",
  },
);

// Efficiently find jobs that are ready to execute.
MediaJobSchema.index({
  status: 1,
  availableAt: 1,
  priority: -1,
});

// Efficiently find expired worker leases.
MediaJobSchema.index({
  status: 1,
  leaseExpiresAt: 1,
});

export type MediaJobDocument = InferSchemaType<typeof MediaJobSchema>;

export const MediaJob =
  (mongoose.models["MediaJob"] as Model<MediaJobDocument> | undefined) ??
  model<MediaJobDocument>("MediaJob", MediaJobSchema);
