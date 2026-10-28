import { randomUUID } from "crypto";

import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { s3 } from "@config";
import { MediaSessionStatus, MimeType } from "@shared/types";
import { env } from "@shared/validations";
import { AppError } from "@utils";
import mongoose from "mongoose";
import pLimit from "p-limit";

import type { ImageExistenceCheckDto } from "./dtos/imageExistenceCheck.dto.mjs";
import type {
  ImageUploadCheckDto,
  SingleImageDto,
} from "./dtos/imageUploadCheck.dto.mjs";
import { Media } from "./media.model.mjs";
import { MediaSession } from "./mediaSession.model.mjs";

const limit = pLimit(5);

// Explicit allowlist: only formats validateMagicNumber() can actually verify.
// A loose startsWith("image/") would admit e.g. image/gif, which passes
// signing but fails signature validation at confirm time.
const ALLOWED_MIME_TYPES = new Set<string>(Object.values(MimeType));

const IMAGE_MIME_PREFIX = "image/";

function normalizeMimeType(raw: string): string {
  return raw.trim().toLowerCase();
}

export const mediaService = {
  generateKey(userId: string, uploadId: string) {
    const mediaId = randomUUID();
    const key = `media/u/${userId}/p/${uploadId}/${mediaId}/raw`;

    return { key, mediaId };
  },

  async signSingleImage(
    userId: string,
    uploadId: string,
    image: SingleImageDto,
  ) {
    const { key, mediaId } = this.generateKey(userId, uploadId);

    const mimeType = normalizeMimeType(image.mimeType);

    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      throw new AppError("Unsupported media type", 400);
    }

    const mediaType = mimeType.startsWith(IMAGE_MIME_PREFIX)
      ? "image"
      : "video";

    const command = new PutObjectCommand({
      Bucket: env.AWS_S3_BUCKET_NAME,
      Key: key,
      ContentType: mimeType,
      ContentLength: image.fileSize,
      // Conditional write: PUT fails with 412 if the object already exists,
      // so a reused/expired URL can never overwrite a verified source.
      IfNoneMatch: "*",
    });

    const signedUrl = await getSignedUrl(s3, command, {
      expiresIn: 600,
    });

    const doc = {
      uploadId,
      mediaId,
      userId,
      isClaimed: false,
      mediaOwnerId: null,
      mediaOwnerType: "POST",
      mediaType,
      mimeType,
      key,
      uploadStatus: "PENDING",
      order: image.order ?? 1,
      size: image.fileSize,
      width: image.width,
      height: image.height,
      duration: image.duration,
    };

    const response = {
      mediaId,
      key,
      signedUrl,
      fileName: image.fileName,
      order: image.order,
      mimeType,
    };

    return { doc, response };
  },

  async signMultipleImages(userId: string, data: ImageUploadCheckDto) {
    const { images, uploadId } = data;
    if (!images?.length) {
      throw new AppError("No images provided", 400);
    }

    const isExist = await this.checkUploadId(userId, uploadId);
    if (isExist) {
      throw new AppError("Media already exist", 409);
    }

    const seen = new Set<string>();
    for (const img of images) {
      const sig = `${img.fileName}-${img.mimeType}-${img.fileSize}`;
      if (seen.has(sig)) {
        throw new AppError("Duplicate images detected", 400);
      }
      seen.add(sig);
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const used = await Media.exists({
        userId,
        uploadId,
        isClaimed: true,
        uploadStatus: { $in: ["UPLOADED"] },
      }).session(session);

      if (used) {
        throw new AppError("Upload session already finalized", 400);
      }

      const existingSession = await MediaSession.findOne({
        userId,
        uploadId,
      }).session(session);

      if (existingSession) {
        throw new AppError("Upload session already exists", 409);
      }

      // The unique { userId, uploadId } index is the real guard: two
      // concurrent requests can both pass the findOne above, but only one
      // insert succeeds — the loser gets E11000, surfaced as 409.
      await MediaSession.create(
        [
          {
            userId,
            uploadId,
            status: MediaSessionStatus.OPEN,
            expiresAt: new Date(Date.now() + 1 * 60 * 1000),
          },
        ],
        { session },
      );

      const signed = await Promise.all(
        images.map((img: SingleImageDto) =>
          this.signSingleImage(userId, uploadId, img),
        ),
      );

      const docs = signed.map(s => s.doc);
      const responses = signed.map(s => s.response);

      await Media.insertMany(docs, { session });

      await session.commitTransaction();

      return {
        uploadId,
        expiresIn: 600,
        files: responses,
      };
    } catch (err) {
      // Lost the create race: the unique index rejected the duplicate.
      if (
        (err as { code?: number }).code === 11000 ||
        (err as { message?: string }).message?.includes("E11000")
      ) {
        await session.abortTransaction();
        throw new AppError("Upload session already exists", 409);
      }
      await session.abortTransaction();
      throw err;
    } finally {
      session.endSession();
    }
  },

  async verifyMediaExistence(keys: string[]) {
    const checks = keys.map(key =>
      limit(async () => {
        try {
          const res = await s3.send(
            new HeadObjectCommand({
              Bucket: env.AWS_S3_BUCKET_NAME,
              Key: key,
            }),
          );

          return {
            key,
            exists: true,
            size: res.ContentLength ?? 0,
          };
        } catch (err: any) {
          if (
            err.name === "NoSuchKey" ||
            err.name === "NotFound" ||
            err.$metadata?.httpStatusCode === 404
          ) {
            return { key, exists: false, size: 0 };
          }
          throw err;
        }
      }),
    );

    return Promise.all(checks);
  },

  async confirmMediaUploads(userId: string, dto: ImageExistenceCheckDto) {
    const rawKeys = dto.images.map(i => i.key);

    const medias = await Media.find({
      userId,
      key: { $in: rawKeys },
    }).lean();

    if (!medias.length) {
      throw new AppError("No media found", 404);
    }

    const keyCounts = new Map<string, number>();
    for (const m of medias) {
      keyCounts.set(m.key, (keyCounts.get(m.key) ?? 0) + 1);
    }
    const missingKeys = rawKeys.filter(key => !keyCounts.has(key));
    const duplicateKeys = [...keyCounts.entries()]
      .filter(([, n]) => n > 1)
      .map(([key]) => key);

    // Every requested key must have exactly one record owned by this user.
    if (missingKeys.length || duplicateKeys.length) {
      throw new AppError(
        "Some keys are unknown, duplicated, or not owned by this user",
        403,
      );
    }

    // A concurrent cleanup run has claimed (and may be deleting) these
    // objects — confirmation must not race with the janitor.
    if (medias.some(m => m.uploadStatus === "CLEANING")) {
      throw new AppError("Media is being cleaned up", 409);
    }

    // Idempotent success only when EVERY requested record is confirmed.
    const nonConfirmed = medias.filter(m => m.uploadStatus !== "UPLOADED");
    if (!nonConfirmed.length) {
      return {
        confirmedCount: 0,
        keys: rawKeys,
        alreadyConfirmed: true,
      };
    }

    // Mixed/failed states must not be silently absorbed: FAILED records in
    // particular were rejected by an earlier verification round.
    if (nonConfirmed.some(m => m.uploadStatus !== "PENDING")) {
      throw new AppError("Some media are in an invalid state", 409);
    }

    const mediaMap = new Map(medias.map(m => [m.key, m]));

    const existenceResults = await this.verifyMediaExistence(rawKeys);
    const existenceMap = new Map(existenceResults.map(r => [r.key, r]));

    const checks = rawKeys.map(key =>
      limit(async () => {
        const media = mediaMap.get(key);
        if (!media) {
          return { key, error: "not_found_in_db" };
        }

        const exist = existenceMap.get(key);
        if (!exist?.exists) {
          return { key, error: "not_uploaded" };
        }

        if (exist.size !== media.size) {
          return { key, error: "size_mismatch" };
        }

        const valid = await this.verifyFileSignature(key, media.mimeType);

        if (!valid) {
          return { key, error: "invalid_signature" };
        }

        return { key, error: null };
      }),
    );

    const results = await Promise.all(checks);

    // Structured per-file errors: report every failing key, not just the
    // first failure category.
    const failures = results.filter(r => r.error !== null);
    if (failures.length) {
      throw new AppError(
        failures.map(r => `${r.key}: ${r.error}`),
        409,
      );
    }

    // All-or-nothing transition inside a transaction: if fewer rows than the
    // pending set get updated (concurrent writer, conflict), abort entirely.
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const update = await Media.updateMany(
        {
          userId,
          key: { $in: rawKeys },
          uploadStatus: "PENDING",
        },
        { $set: { uploadStatus: "UPLOADED" } },
        { session },
      );

      if (update.modifiedCount !== nonConfirmed.length) {
        throw new AppError("Media confirmation partially failed", 409);
      }

      const uniqueUploadIds = [...new Set(nonConfirmed.map(m => m.uploadId))];

      const sessionUpdate = await MediaSession.updateMany(
        {
          userId,
          uploadId: { $in: uniqueUploadIds },
          status: MediaSessionStatus.OPEN,
        },
        { $set: { status: MediaSessionStatus.FINALIZED } },
        { session },
      );

      if (sessionUpdate.matchedCount !== uniqueUploadIds.length) {
        throw new AppError(
          "Upload session state changed during confirmation",
          409,
        );
      }

      await session.commitTransaction();

      return {
        confirmedCount: update.modifiedCount,
        keys: rawKeys,
      };
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      session.endSession();
    }
  },

  async verifyFileSignature(key: string, mime: string) {
    try {
      const res = await s3.send(
        new GetObjectCommand({
          Bucket: env.AWS_S3_BUCKET_NAME,
          Key: key,
          Range: "bytes=0-11",
        }),
      );

      const bytes = await res.Body?.transformToByteArray();
      if (!bytes) {
        return false;
      }

      return this.validateMagicNumber(Buffer.from(bytes), mime);
    } catch {
      return false;
    }
  },

  validateMagicNumber(buffer: Buffer, mime: string) {
    if (!buffer.length) {
      return false;
    }

    const hex = buffer.toString("hex").toUpperCase();

    if (mime === "image/jpeg" || mime === "image/jpg") {
      return hex.startsWith("FFD8FF");
    }

    if (mime === "image/png") {
      return hex.startsWith("89504E47");
    }

    if (mime === "image/webp") {
      return hex.startsWith("52494646") && hex.slice(16, 24) === "57454250";
    }

    // AVIF and MP4 are ISO-BMFF: "ftyp" box at bytes 4-8.
    // AVIF brands are "avif"/"avis" at bytes 8-12.
    if (mime === "image/avif") {
      return (
        hex.slice(8, 16) === "46545950" &&
        (hex.slice(16, 24) === "61766966" || hex.slice(16, 24) === "61766973")
      );
    }

    if (mime === "video/mp4") {
      return hex.slice(8, 16) === "46545950";
    }

    if (mime === "video/webm") {
      return hex.startsWith("1A45DFA3");
    }

    if (mime === "video/ogg") {
      return hex.startsWith("4F676753");
    }

    return false;
  },

  async checkUploadId(userId: string, uploadId: string) {
    const session = await MediaSession.findOne({
      userId,
      uploadId,
    }).lean();

    if (!session) {
      return false;
    }

    if (session.status === MediaSessionStatus.FINALIZED) {
      return true;
    }

    if (session.status === MediaSessionStatus.EXPIRED) {
      return false;
    }

    if (session.expiresAt && session.expiresAt < new Date()) {
      await MediaSession.updateOne(
        { userId, uploadId },
        { $set: { status: MediaSessionStatus.EXPIRED } },
      );
      return false;
    }

    return true;
  },

  // Invoked by a scheduler (cron/worker). Deletes S3 objects and DB records
  // belonging to expired upload sessions. Uses an atomic CLEANING claim so it
  // cannot race with confirmation: confirmMediaUploads() rejects CLEANING
  // records, and the claim update itself only matches records that are still
  // eligible at claim time. Failed S3 deletions revert their records to
  // PENDING so a later run can retry them.
  async cleanupOrphanedUploads(graceMinutes = 30) {
    const cutoff = new Date(Date.now() - graceMinutes * 60 * 1000);

    const expiredSessions = await MediaSession.find({
      status: { $in: [MediaSessionStatus.OPEN, MediaSessionStatus.EXPIRED] },
      expiresAt: { $lt: cutoff },
    }).lean();

    if (!expiredSessions.length) {
      return {
        sessionsChecked: 0,
        objectsDeleted: 0,
        mediaDeleted: 0,
        s3DeleteFailures: 0,
      };
    }

    const uploadIds = expiredSessions.map(s => s.uploadId);

    // Atomic claim: flips PENDING/FAILED -> CLEANING only for records that
    // are still eligible at the moment of the update. A record confirmed
    // concurrently is already UPLOADED and never matches this filter.
    const claim = await Media.updateMany(
      {
        uploadId: { $in: uploadIds },
        uploadStatus: { $in: ["PENDING", "FAILED"] },
        processingStatus: "PENDING",
        isDeleted: { $ne: true },
      },
      { $set: { uploadStatus: "CLEANING" } },
    );

    if (!claim.modifiedCount) {
      await MediaSession.updateMany(
        { _id: { $in: expiredSessions.map(s => s._id) } },
        { $set: { status: MediaSessionStatus.EXPIRED } },
      );

      return {
        sessionsChecked: expiredSessions.length,
        objectsDeleted: 0,
        mediaDeleted: 0,
        s3DeleteFailures: 0,
      };
    }

    const claimed = await Media.find({
      uploadId: { $in: uploadIds },
      uploadStatus: "CLEANING",
    })
      .select("_id key")
      .lean();

    const claimedKeys = claimed.map(m => m.key);

    let failedKeys: string[] = [];
    try {
      const res = await s3.send(
        new DeleteObjectsCommand({
          Bucket: env.AWS_S3_BUCKET_NAME,
          Delete: {
            Objects: claimedKeys.map(key => ({ Key: key })),
            Quiet: true,
          },
        }),
      );
      failedKeys = (res.Errors ?? [])
        .map(e => e.Key)
        .filter((k): k is string => !!k);
    } catch {
      failedKeys = claimedKeys;
    }

    // One retry for partial/complete failures.
    if (failedKeys.length) {
      try {
        const retry = await s3.send(
          new DeleteObjectsCommand({
            Bucket: env.AWS_S3_BUCKET_NAME,
            Delete: {
              Objects: failedKeys.map(key => ({ Key: key })),
              Quiet: true,
            },
          }),
        );
        failedKeys = (retry.Errors ?? [])
          .map(e => e.Key)
          .filter((k): k is string => !!k);
      } catch {
        // keep failedKeys as-is
      }
    }

    const failedSet = new Set(failedKeys);
    const deletedIds = claimed
      .filter(m => !failedSet.has(m.key))
      .map(m => m._id);
    const revertedIds = claimed
      .filter(m => failedSet.has(m.key))
      .map(m => m._id);

    // S3 deletion failed for these: unclaim so the next run can retry.
    if (revertedIds.length) {
      await Media.updateMany(
        { _id: { $in: revertedIds }, uploadStatus: "CLEANING" },
        { $set: { uploadStatus: "PENDING" } },
      );
    }

    // Final DB delete re-checks the CLEANING state — never deletes a record
    // that was re-claimed or confirmed after the S3 delete.
    const result = deletedIds.length
      ? await Media.deleteMany({
          _id: { $in: deletedIds },
          uploadStatus: "CLEANING",
        })
      : { deletedCount: 0 };

    await MediaSession.updateMany(
      { _id: { $in: expiredSessions.map(s => s._id) } },
      { $set: { status: MediaSessionStatus.EXPIRED } },
    );

    return {
      sessionsChecked: expiredSessions.length,
      objectsDeleted: result.deletedCount,
      mediaDeleted: result.deletedCount,
      s3DeleteFailures: failedSet.size,
    };
  },
};
