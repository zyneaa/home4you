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

