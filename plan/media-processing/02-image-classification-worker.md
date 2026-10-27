# EP — Image Classification Worker (CLASSIFY_IMAGE via Google Cloud Vision)

Status: NOT IMPLEMENTED — plan only. `MediaJob` records of type
CLASSIFY_IMAGE are already persisted in the same transaction as post +
media claim and dispatched to Redis (`media:jobs:queue`). This document
covers the worker that consumes them.

## Responsibilities

1. Claim a CLASSIFY_IMAGE job (same lease protocol as
   `plan/media-processing/01-rust-optimization-worker.md`).
2. Idempotency pre-check: if a `MediaClassification` already exists for the
   same `mediaId` + `pipelineVersion` + `sourceFingerprint`, mark the job
   COMPLETED and skip.
3. Retrieve the eligible image from S3 — the **optimized** rendition if it
   exists, otherwise the raw original. Never user-supplied URLs.
4. Call Google Cloud Vision with server-side credentials (service account
   JSON via secret store; never in the repo or client bundle). Rate-limit
   and batch requests per quota.
5. Normalize the response into Home4You's own label taxonomy
   (`plan` normalization layer owns the provider-label -> internal-label
   mapping; unknown labels are dropped or mapped to REVIEW_REQUIRED).
6. Store the result and mark the job complete.

## Result shape (illustrative)

```json
{
  "status": "DONE",
  "provider": "google-cloud-vision",
  "labels": [
    { "name": "INTERIOR", "score": 0.96, "providerLabel": "room" },
    { "name": "BEDROOM", "score": 0.91, "providerLabel": "bed" },
    { "name": "FURNITURE", "score": 0.88, "providerLabel": "furniture" }
  ]
}
```

Provider labels are kept on each normalized label (`providerLabel`) for
auditing. Scores are provider-supplied confidences in [0, 1].

## Invariants

- Classification results are stored in `MediaClassification`, **distinct
  from user-entered listing fields**. An image label must never override
  the user's declared property type; it only feeds
  `Media.moderationStatus` (APPROVED / REVIEW_REQUIRED / REJECTED) and
  search/facets.
- The post is visible immediately after upload + synchronous validation;
  moderation status arrives asynchronously and can only downgrade
  visibility (hide on REJECTED), never block creation.
- `Media.moderationStatus` (added to the Media model) is the only field the
  worker mutates on Media. It transitions PENDING -> APPROVED |
  REVIEW_REQUIRED | REJECTED based on normalized label confidence
  thresholds.

## Policy config

- Thresholds (e.g. score >= 0.8 -> APPROVED, 0.5-0.8 -> REVIEW_REQUIRED,
  blocked-labels -> REJECTED) live in config/env, not hardcoded.
- Blocked-label list is taxonomy-owned and versioned.

## Failure handling

- Provider errors: retryable -> FAILED + `availableAt` backoff (max
  `maxAttempts`), then REVIEW_REQUIRED as the safe fallback so media is
  never lost.
- Quota exhaustion: non-retryable short-term; the dispatcher's natural
  retry cadence spreads load.
- All provider calls logged with jobId + mediaId + duration for auditing.
