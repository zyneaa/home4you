# EP — Rust Media Optimization Worker (OPTIMIZE_IMAGE / GENERATE_VIDEO_RENDITIONS)

Status: NOT IMPLEMENTED — plan only. The API already persists durable
`MediaJob` records (status PENDING, lease fields ready) and a dispatcher
publishes them to the Redis list `media:jobs:queue` (see
`services/core/src/jobs/mediaJobDispatcher.job.mts`). This document covers the
worker that consumes them.

## Responsibilities

1. Claim an optimization job (see "Claim protocol").
2. Read the original object from S3 (`media/u/{userId}/p/{postId}/{mediaId}/raw`)
   using authorized server-side credentials only.
3. Validate and decode the file with hard resource limits:
   - max dimensions (reject absurd resolutions before decoding),
   - max decompressed buffer size (decompression-bomb guard),
   - wall-clock timeout + memory cap per job,
   - re-derive MIME from magic bytes; never trust stored metadata alone.
4. Apply EXIF orientation handling; strip metadata (GPS, camera, user
   comments) where appropriate.
5. Produce optimized renditions:
   - images: `optimized/webp-1200`, `optimized/webp-400` (plus small thumbnail
     if needed by the UI),
   - videos: renditions defined by the video pipeline (separate episode).
6. Write renditions to new S3 keys (separate from the raw original; the
   original is retained for reprocessing/future model experiments per the
   retention policy).
7. Update the database:
   - `Media.variants` map: rendition key per variant name,
   - `Media.checksum` of the source (set/verified here, not by the API),
   - `Media.processingStatus`: PENDING -> PROCESSING -> DONE | FAILED.
8. Mark the job COMPLETED (or FAILED with retryable flag + backoff via
   `availableAt`).

## Key naming

```
media/u/{userId}/p/{postId}/{mediaId}/raw
media/u/{userId}/p/{postId}/{mediaId}/optimized/webp-1200
media/u/{userId}/p/{postId}/{mediaId}/optimized/webp-400
```

## Claim protocol (lease-based, DB is the source of truth)

```
 findOneAndUpdate(
   { _id, status: "PENDING", availableAt: { $lte: now } },
   { $set: { status: "PROCESSING", startedAt: now, lockedBy: workerId,
             lockToken: <uuid>, leaseExpiresAt: now + lease } },
 )
```

- Worker renews the lease while processing.
- On crash, a reaper (can run inside the existing core worker) resets
  PROCESSING jobs with `leaseExpiresAt < now` back to PENDING with
  `attempts + 1`; jobs exceeding `maxAttempts` become FAILED.
- Attempt counter drives Redis re-dispatch (`dispatched:{jobId}:{attempt}`).
- Redis is only the distribution layer: losing a queue message is safe
  because the dispatcher re-publishes PENDING jobs every minute.

## Output contract (write-back)

The worker updates Media + MediaJob in one transaction (replica set rs0
supports it), then optionally publishes a `media.processed` event to Redis
for the feed/cache layer. Idempotency: re-running on an already-processed
media must be a no-op (check `variants`/`processingStatus` before work).

## Tech notes

- Rust + `image`/`rimage` (webp encoders), `ffmpeg` binding for video
  renditions, S3 client (`aws-sdk-s3`), MongoDB driver, Redis client.
- Concurrency: bounded worker pool (e.g. p-limit equivalent, 2-4 concurrent
  jobs per replica), each job memory-capped.
- Deploy: separate container in `infrastructure/docker` (same pattern as
  `cleanup-worker`), scaled horizontally; Redis `BRPOPLPUSH` for work
  stealing with an in-flight list for observability.
