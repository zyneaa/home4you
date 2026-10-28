# home4you-media (Rust media worker)

Separate service (not part of `services/core`). One executable, two
independent libraries:

```
services/media-worker/
├── Cargo.toml                 # Workspace root
├── crates/
│   ├── media-classification/  # Google Vision client, taxonomy normalization,
│   │                          # moderation policy
│   └── media-processing/      # Safe image/video decode, renditions
└── apps/
    └── media-worker/          # Binary: Redis queue, Mongo leases, S3, retries
```

## How it fits

1. The core API persists `MediaJob` records (outbox) **in the same MongoDB
   transaction** as the post + media claim, and a dispatcher (core cron
   worker) publishes pending jobs to Redis `media:jobs:queue` with payload:
   `{ jobId, mediaId, postId, jobType, attempt, createdAt, pipelineVersion }`.
2. This worker `BRPOPLPUSH`es messages onto `media:jobs:inflight`, claims
   the job in MongoDB with a lease, and executes it.
3. **Redis is the distribution layer, not the record of work.** Durable
   `MediaJob` documents are the source of truth. A lost queue message is
   recovered by the dispatcher's periodic re-publish; a crashed worker's
   message is recovered by draining the in-flight list at startup and by the
   lease reaper reclaiming expired `PROCESSING` jobs.

## Job types

- `OPTIMIZE_IMAGE` — validate/decode with resource limits (pixel-count
  ceiling before decode), EXIF orientation applied, metadata stripped by
  re-encode, WebP renditions (`webp-1200`, `webp-400`) uploaded to
  `media/u/{userId}/p/{postId}/{mediaId}/optimized/{name}`. The raw original
  is never modified.
- `GENERATE_VIDEO_RENDITIONS` — FFmpeg CLI (`mp4-720`, `mp4-360`) with a
  per-job timeout, writing to the same `optimized/` layout.
- `CLASSIFY_IMAGE` — idempotency pre-check on
  (`mediaId`, `pipelineVersion`, `sourceFingerprint`), fetch the eligible
  image (optimized rendition preferred, raw fallback), Google Cloud Vision
  LABEL_DETECTION via server-side credentials, normalize into Home4You's
  taxonomy, upsert `MediaClassification`, set `Media.moderationStatus`.

## Moderation policy (explicit rules)

| Result | Action |
|---|---|
| Corrupt/unsupported file | Reject (permanent, no retry) |
| Safety check clearly fails policy | Reject |
| Ambiguous result | `REVIEW_REQUIRED` (conservative) |
| Vision API outage | Retry with backoff — never auto-reject |
| Valid image, checks pass | `APPROVED` |

Labels never override user-entered listing fields; they only drive
moderation status and search facets. Publication is not blocked by the
pipeline: posts are visible after synchronous validation.

## Idempotency

- Optimization skips when `processingStatus == DONE` and all expected
  variant keys already match the canonical layout.
- Classification skips when a result exists for the same
  media + pipeline version + source fingerprint.
- Job completion is guarded by the lease token; a stale worker cannot
  clobber a reclaimed job.

## Concurrency

`MAX_CONCURRENT_JOBS` (default 2) bounds simultaneous media jobs. Tune by
measuring memory/CPU — compressed size is a poor predictor of decoded size.

## Run

```sh
cp .env.example .env   # fill values
cargo run -p media-worker
```

Local dev assumes MongoDB (replica set) + Redis are reachable per env vars.

## Notes / follow-ups

- The `image` crate's WebP encoder is lossless-only; swap to libwebp if
  smaller files matter more than pure-Rust decoding.
- Video renditions call the `ffmpeg` binary (installed in the Docker image).
