# Media Pipeline for Home4You

### Example pipeline for processing images
- User uploads photos and videos(max 100)
- User hits /api/v1/media/sign
- Core service checks the metadata uploaded from user(optional magic byte and checksum check)
- Core creates mongo doc for each media objs
- Core returns signed URLs to user
- User press "Post" button
- User post to /api/v1/post/new with mediaId(s) and necessary post info
- Core checks the mediaId(s) and create the post
- User uploads media objs to AWS with signed URLs


---

# Media Pipeline — Home4You

This document describes the end-to-end media upload and processing pipeline for Home4You, covering image/video uploads, validation, storage, and post creation.

---

## Overview

The system uses **pre-signed URLs** to allow clients to upload media directly to object storage (AWS S3), reducing backend load and improving scalability.

The pipeline ensures:

* Secure uploads (user-bound paths)
* Data integrity (optional checksum validation)
* Consistency (media must be uploaded before post creation)
* Scalability (async processing + cleanup jobs)

---

## Pipeline Flow

### 1. Client Preparation

The client generates:

* `postId` (UUID v7 recommended)
* `media[]` metadata:

```json
{
  "mediaId": "uuid",
  "type": "image | video",
  "mimeType": "image/jpeg",
  "size": 123456,
  "checksum": "optional",
  "width": 1920,
  "height": 1080
}
```

---

### 2. Request Signed URLs

**Endpoint**

```
POST /api/v1/media/sign
```

**Payload**

```json
{
  "postId": "uuid",
  "media": [ ... ]
}
```

---

### 3. Core Service Validation

The server performs:

* Authentication (user identity)
* Media constraints:

  * Max files: 100
  * Allowed MIME types
  * File size limits
* Ownership binding:

```
media/u/{userId}/p/{postId}/{mediaId}/raw
```

* Optional:

  * Checksum format validation
  * Metadata sanity checks

---

### 4. Create Media Records

A database record is created per media:

```json
{
  "_id": "mediaId",
  "userId": "userId",
  "postId": "postId",
  "status": "PENDING_UPLOAD",
  "type": "image",
  "mimeType": "image/jpeg",
  "size": 123456,
  "storageKey": "media/u/.../raw",
  "createdAt": "timestamp"
}
```

---

### 5. Generate Signed Upload URLs

The server returns pre-signed URLs (short-lived, e.g. 5–10 minutes):

```json
{
  "media": [
    {
      "mediaId": "uuid",
      "uploadUrl": "https://...",
      "storageKey": "media/u/.../raw",
      "expiresIn": 300
    }
  ]
}
```

---

### 6. Client Uploads Media

The client uploads files directly to storage:

```
PUT {uploadUrl}
Content-Type: image/jpeg

(binary data)
```

---

### 7. Upload Confirmation

The core service receive a webhook call from S3 worker to verify that the media is uploaded

**Endpoint**

```
POST /api/v1/media/confirm
```

**Payload**

```json
{
  "mediaIds": ["..."]
}
```

**Server actions:**

* Verify object existence in storage
* Validate:

  * File size
  * Checksum (if provided)
  * MIME type (magic byte sniffing)
* Update status:

```json
{
  "status": "UPLOADED"
}
```

---

### 8. Create Post

**Endpoint**

```
POST /api/v1/post/new
```

**Payload**

```json
{
  "postId": "uuid",
  "mediaIds": ["..."],
  "caption": "..."
}
```

---

### 9. Post Validation

The server ensures:

* Media belongs to the requesting user
* Media belongs to the same `postId`
* Media status is `"UPLOADED"`

This prevents:

* Invalid references
* Cross-user media injection
* Missing uploads

---

### 10. Post Creation

```json
{
  "_id": "postId",
  "userId": "userId",
  "mediaIds": ["..."],
  "status": "ACTIVE",
  "createdAt": "timestamp"
}
```

---

### 11. Async Media Processing

Triggered after post creation:

**Images**

* Resize
* Compress
* Generate thumbnails

**Videos**

* Transcode
* Generate preview frames

Update media records:

```json
{
  "status": "PROCESSED",
  "variants": {
    "thumbnail": "...",
    "optimized": "..."
  }
}
```

---

### 12. Cleanup Jobs

Scheduled background tasks:

* Remove expired `PENDING_UPLOAD` media
* Remove unused `UPLOADED` media (no associated post)
* Prevent storage bloat and cost leakage

---

## Media Lifecycle

```
PENDING_UPLOAD → UPLOADED → PROCESSED → ACTIVE
```

---

## Security Considerations

* All storage paths are user-scoped:

```
media/u/{userId}/p/{postId}/{mediaId}/raw
```

* Signed URLs are short-lived
* Server validates ownership and status before post creation
* Upload confirmation prevents fake or missing files

---

## Notes

* Direct-to-storage uploads reduce backend bandwidth usage
* Async processing improves responsiveness
* System is designed to scale horizontally
* Optional checksum validation adds strong integrity guarantees

---

## Future Improvements

* Resumable uploads (for large videos)
* Media deduplication (checksum-based)
* CDN optimization (AWS edge caching)
* Signed GET URLs vs public access strategy
* Real-time upload progress tracking

---

This pipeline is designed to be **secure, scalable, and production-ready** for high-volume media applications.
we need to add moderationStatus: {
  type: String,
  enum: ["PENDING", "APPROVED", "REJECTED", "REVIEW_REQUIRED"],
  default: "PENDING",
},  to media model. The reason is after creating a post a sperate worker will send the media for classification. The API validates the listing fields, then atomically claims the associated media records and creates the post. The post should reference stable media IDs, not arbitrary S3 keys supplied by the client.

Use an idempotency key or another reliable request-deduplication mechanism so that a client retry after a timeout doesn't create duplicate posts.

What if post creation fails? Keep the uploaded object temporarily available for a retry. After a defined recovery period, reconcile unclaimed uploads and clean them up according to your retention policy. Step 5 — Record durable processing jobs
Once the post and media claim succeed, create the required processing jobs.

For example:
- CLASSIFY_IMAGE
- OPTIMIZE_IMAGE
- GENERATE_VIDEO_RENDITIONS for video media
The API should persist the post, media claims, and job/outbox records together in a MongoDB transaction where supported by your deployment.

A dispatcher publishes pending jobs to Redis. If Redis is unavailable, the durable records remain available for later dispatch.

This avoids the classic failure where the database commit succeeds but the API crashes before enqueueing the job. Step 6 — Redis distributes the jobs
Redis acts as the job-distribution layer, not your only record of work.

Each job should contain identifiers and operation details, such as:
jobId
mediaId
postId
jobType
attempt
createdAt Workers should fetch the object from S3 using authorized credentials. Step 7 — Rust worker validates and optimizes the original
The Rust media worker:
1. Claims an optimization job.
2. Reads the original from S3.
3. Validates and decodes the file with appropriate resource limits.
4. Applies orientation handling and strips metadata where appropriate.
5. Produces optimized renditions.
6. Writes the renditions to new S3 keys.
7. Updates the database with rendition metadata.
8. Marks the optimization job complete.
Keep the original object separate from the optimized outputs. This preserves the source for reprocessing and future model experiments, subject to your retention policy.

For example:
media/u/{userId}/p/{postId}/{mediaId}/raw
media/u/{userId}/p/{postId}/{mediaId}/optimized/webp-1200
media/u/{userId}/p/{postId}/{mediaId}/optimized/webp-400 Step 8 — Classification worker calls Google Cloud Vision
The classification worker:
1. Claims a CLASSIFY_IMAGE job.
2. Checks whether a valid result already exists for the same media version and configuration.
3. Retrieves the eligible image from S3.
4. Calls Google Cloud Vision using server-side credentials.
5. Normalizes the response into Home4You's own label taxonomy.
6. Stores the result and marks the job complete.
Example normalized result:
{
  "status": "DONE",
  "provider": "google-cloud-vision",
  "labels": [
    { "name": "INTERIOR", "score": 0.96 },
    { "name": "BEDROOM", "score": 0.91 },
    { "name": "FURNITURE", "score": 0.88 }
  ]
}


The scores are illustrative. Google Vision may return different labels, and your normalization layer determines how provider labels map to your internal taxonomy.

Keep classification results distinct from user-entered listing fields. An image label should not automatically override a user's declared property type. Post becomes visible after upload and required synchronous validation; labels and renditions arrive asynchronously.import mongoose, {
  Schema,
  Types,
  model,
  type InferSchemaType,
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

export type MediaJobDocument = InferSchemaType<
  typeof MediaJobSchema
>;

export const MediaJob =
  mongoose.models.MediaJob ??
  model("MediaJob", MediaJobSchema); import mongoose, {
  Schema,
  model,
  type InferSchemaType,
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

export type MediaClassificationDocument =
  InferSchemaType<typeof MediaClassificationSchema>;

export const MediaClassification =
  mongoose.models.MediaClassification ??
  model(
    "MediaClassification",
    MediaClassificationSchema,
  ); Right now dont do the rust processor and classifier. But make plan files for later implmemtation
