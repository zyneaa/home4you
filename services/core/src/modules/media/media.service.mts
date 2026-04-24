import { randomUUID } from "crypto";

import { HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { r2 } from "@config";
import { env } from "@shared/validations";
import { AppError } from "@utils";
import type { ClientSession } from "mongoose";
import mongoose from "mongoose";

import type { ImageExistenceCheckDto } from "./dtos/imageExistenceCheck.dto.mjs";
import type {
  ImageUploadCheckDto,
  SingleImageDto,
} from "./dtos/imageUploadCheck.dto.mjs";
import { Media } from "./media.model.mjs";

export const mediaService = {
  async generateKey(userId: string, uploadId: string) {
    const mediaId = randomUUID();
    const key = `media/u/${userId}/p/${uploadId}/${mediaId}/raw`;

    return { key, mediaId };
  },

  async signSingleImage(
    userId: string,
    uploadId: string,
    image: SingleImageDto,
    session: ClientSession,
  ) {
    const { key, mediaId } = await this.generateKey(userId, uploadId);

    const contentType =
      typeof image.mimeType === "string"
        ? image.mimeType
        : (image.mimeType as any).valueOf();
    if (!contentType.startsWith("image/")) {
      throw new AppError("Invalid image type", 400);
    }

    await Media.create(
      [
        {
          mediaId,
          userId,
          mediaOwnerId: null,
          mediaOwnerType: "POST",
          mediaType: "image",
          mimeType: contentType,
          key,
          status: "PENDING",
          order: image.order ?? 0,
          size: image.fileSize ?? 0,
        },
      ],
      { session },
    );

    const command = new PutObjectCommand({
      Bucket: env.R2_BUCKET_NAME,
      Key: key,
      ContentType: contentType,
    });

    // URL expires in 600 seconds (10 mins)
    const signedUrl = await getSignedUrl(r2, command, { expiresIn: 600 });

    // Return the key so the client/TS server can track this asset in the DB
    return {
      mediaId: key.split("/").at(-2), // optional debug id
      key,
      signedUrl,
      fileName: image.fileName,
      order: image.order,
      mimeType: contentType,
    };
  },

  async signMultipleImages(userId: string, data: ImageUploadCheckDto) {
    const { images, uploadId } = data;

    if (!images || images.length === 0) {
      throw new AppError("No images provided", 400);
    }

    const seen = new Set<string>();
    for (const img of images) {
      const key = `${img.fileName}-${img.mimeType}`;
      if (seen.has(key)) {
        throw new AppError("Duplicate images detected", 400);
      }
      seen.add(key);
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const isUploadUsed = await Media.exists({
        uploadId,
        status: { $in: ["UPLOADED", "CLAIMED"] },
      }).session(session);

      if (isUploadUsed) {
        throw new AppError(
          "This upload session is already finalized. Start a new one.",
          400,
        );
      }

      const promises = images.map(image =>
        this.signSingleImage(userId, uploadId, image, session),
      );

      const results = await Promise.all(promises);

      await session.commitTransaction();

      return {
        uploadId,
        expiresIn: 600,
        files: results,
      };
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  },

  async verifyMediaExistence(images: Array<{ key: string }>) {
    const checks = images.map(async image => {
      const { key } = image;

      try {
        await r2.send(
          new HeadObjectCommand({
            Bucket: env.R2_BUCKET_NAME,
            Key: key,
          }),
        );
        return { key, exists: true };
      } catch (err: any) {
        if (err.name === "NotFound" || err.$metadata?.httpStatusCode === 404) {
          return { key, exists: false };
        }
        throw err;
      }
    });

    return Promise.all(checks);
  },

  async confirmMediaUploads(userId: string, dto: ImageExistenceCheckDto) {
    const imageObjects = dto.images;
    const rawKeys = imageObjects.map(img => img.key);

    const results = await this.verifyMediaExistence(imageObjects);
    const missing = results.filter(r => !r.exists).map(r => r.key);

    if (missing.length > 0) {
      throw new AppError(
        `Some files were not found in storage: ${missing.join(", ")}`,
        404,
      );
    }

    const updateResult = await Media.updateMany(
      {
        userId,
        key: { $in: rawKeys },
        status: "PENDING",
      },
      {
        $set: { status: "UPLOADED" },
      },
    );

    return {
      confirmedCount: updateResult.modifiedCount,
      keys: rawKeys,
    };
  },

  async checkUploadId(uploadId: string) {
    const isIdUsed = await Media.exists({
      uploadId,
      status: { $in: ["UPLOADED", "CLAIMED"] },
    });

    return isIdUsed;
  },
};
