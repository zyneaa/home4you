import { randomUUID } from "crypto";

import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { r2 } from "@config";
import { env } from "@shared/validations";
import { AppError } from "@utils";

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
  ) {
    const { key, mediaId } = await this.generateKey(userId, uploadId);

    const contentType =
      typeof image.mimeType === "string"
        ? image.mimeType
        : (image.mimeType as any).valueOf();
    if (!contentType.startsWith("image/")) {
      throw new AppError("Invalid image type", 400);
    }

    await Media.create({
      mediaId,
      userId,
      mediaOwnerId: null, // will be linked on post confirm
      mediaOwnerType: "POST",
      mediaType: "image",
      mimeType: contentType,
      key,
      status: "PENDING",
      order: image.order ?? 0,
      size: image.fileSize ?? 0,
    });

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

    const promises = images.map(image =>
      this.signSingleImage(userId, uploadId, image),
    );
    const results = await Promise.all(promises);

    return {
      uploadId,
      expiresIn: 600,
      files: results,
    };
  },
};
