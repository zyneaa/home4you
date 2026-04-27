import { randomUUID } from "crypto";
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import pLimit from "p-limit";
import mongoose from "mongoose";

import { r2 } from "@config";
import { env } from "@shared/validations";
import { AppError } from "@utils";
import { Media } from "./media.model.mjs";
import type { ImageUploadCheckDto, SingleImageDto } from "./dtos/imageUploadCheck.dto.mjs";
import type { ImageExistenceCheckDto } from "./dtos/imageExistenceCheck.dto.mjs";

const limit = pLimit(5);

export const mediaService = {
  generateKey(userId: string, uploadId: string) {
    const mediaId = randomUUID();
    const key = `media/u/${userId}/p/${uploadId}/${mediaId}/raw`;

    return { key, mediaId };
  },

  async signSingleImage(userId: string, uploadId: string, image: SingleImageDto) {
    const { key, mediaId } = this.generateKey(userId, uploadId);

    if (!image.mimeType.startsWith("image/")) {
      throw new AppError("Invalid image type", 400);
    }

    const command = new PutObjectCommand({
      Bucket: env.R2_BUCKET_NAME,
      Key: key,
      ContentType: image.mimeType,
      ContentLength: env.MAX_PHOTO_SIZE
    });

    const signedUrl = await getSignedUrl(r2, command, { expiresIn: 600 });

    const doc = {
      uploadId,
      mediaId,
      userId,
      mediaOwnerId: null,
      mediaOwnerType: "POST",
      mediaType: "image",
      mimeType: image.mimeType,
      key,
      status: "PENDING",
      order: image.order ?? 1,
      size: image.fileSize ?? 0,
    };

    const response = {
      mediaId,
      key,
      signedUrl,
      fileName: image.fileName,
      order: image.order,
      mimeType: image.mimeType,
    };

    return { doc, response };
  },

  async signMultipleImages(userId: string, data: ImageUploadCheckDto) {
    const { images, uploadId } = data;

    if (!images?.length) {
      throw new AppError("No images provided", 400);
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
        uploadId,
        isClaimed: true,
        uploadStatus: { $in: ["UPLOADED"] },
      }).session(session);

      if (used) {
        throw new AppError("Upload session already finalized", 400);
      }

      const signed = await Promise.all(
        images.map((img: SingleImageDto) =>
          this.signSingleImage(userId, uploadId, img)
        )
      );

      const docs = signed.map((s) => s.doc);
      const responses = signed.map((s) => s.response);

      await Media.insertMany(docs, { session });

      await session.commitTransaction();

      return {
        uploadId,
        expiresIn: 600,
        files: responses,
      };
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      session.endSession();
    }
  },

  async verifyMediaExistence(keys: string[]) {
    const checks = keys.map((key) =>
      limit(async () => {
        try {
          const res = await r2.send(
            new HeadObjectCommand({
              Bucket: env.R2_BUCKET_NAME,
              Key: key,
            })
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
      })
    );

    return Promise.all(checks);
  },

  async confirmMediaUploads(userId: string, dto: ImageExistenceCheckDto) {
    const rawKeys = dto.images.map((i) => i.key);

    const medias = await Media.find({
      userId,
      key: { $in: rawKeys },
      uploadStatus: "PENDING",
    }).lean();

    if (!medias.length) {
      throw new AppError("No pending media found", 404);
    }

    const mediaMap = new Map(medias.map((m) => [m.key, m]));

    const existenceResults = await this.verifyMediaExistence(rawKeys);
    const existenceMap = new Map(
      existenceResults.map((r) => [r.key, r])
    );

    const checks = rawKeys.map((key) =>
      limit(async () => {
        const media = mediaMap.get(key);
        if (!media) return { key, error: "not_found_in_db" };

        const exist = existenceMap.get(key);
        if (!exist?.exists) return { key, error: "not_uploaded" };

        if (media.size && exist.size !== media.size) {
          return { key, error: "size_mismatch" };
        }

        const valid = await this.verifyFileSignature(
          key,
          media.mimeType
        );

        if (!valid) return { key, error: "invalid_signature" };

        return { key, error: null };
      })
    );

    const results = await Promise.all(checks);

    const has = (type: string) =>
      results.some((r) => r.error === type);

    if (has("not_found_in_db")) {
      throw new AppError("Unauthorized media detected", 404);
    }

    if (has("not_uploaded")) {
      throw new AppError("Some files were not uploaded", 400);
    }

    if (has("size_mismatch")) {
      throw new AppError("File size mismatch detected", 400);
    }

    if (has("invalid_signature")) {
      throw new AppError("Invalid file signature detected", 400);
    }

    const update = await Media.updateMany(
      {
        userId,
        key: { uploadStatus: rawKeys },
        uploadStatus: "PENDING",
      },
      { $set: { uploadStatus: "UPLOADED" } }
    );

    return {
      confirmedCount: update.modifiedCount,
      keys: rawKeys,
    };
  },

  async verifyFileSignature(key: string, mime: string) {
    try {
      const res = await r2.send(
        new GetObjectCommand({
          Bucket: env.R2_BUCKET_NAME,
          Key: key,
          Range: "bytes=0-11",
        })
      );

      const bytes = await res.Body?.transformToByteArray();
      if (!bytes) return false;

      return this.validateMagicNumber(Buffer.from(bytes), mime);
    } catch {
      return false;
    }
  },

  validateMagicNumber(buffer: Buffer, mime: string) {
    if (!buffer.length) return false;

    const hex = buffer.toString("hex").toUpperCase();

    if (mime === "image/jpeg" || mime === "image/jpg") {
      return hex.startsWith("FFD8FF");
    }

    if (mime === "image/png") {
      return hex.startsWith("89504E47");
    }

    if (mime === "image/webp") {
      return (
        hex.startsWith("52494646") &&
        hex.slice(16, 24) === "57454250"
      );
    }

    return false;
  },

  async checkUploadId(uploadId: string) {
    return !!(await Media.exists({
      uploadId,
      isClaimed: true,
      uploadStatus: { $in: ["UPLOADED"] },
    }));
  },
};
