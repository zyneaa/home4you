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

export const imageService = {
  async generateKey(userId: string, uploadId: string): Promise<string> {
    const mediaId = randomUUID();
    const key = `media/u/${userId}/p/${uploadId}/${mediaId}/raw`;

    return key;
  },

  async signImageUrl(userId: string, uploadId: string, image: SingleImageDto) {
    const key = await this.generateKey(userId, uploadId);

    const contentType =
      typeof image.mimeType === "string"
        ? image.mimeType
        : (image.mimeType as any).valueOf();
    if (!contentType.startsWith("image/")) {
      throw new AppError("Invalid image type");
    }

    const command = new PutObjectCommand({
      Bucket: env.R2_BUCKET_NAME,
      Key: key,
      ContentType: contentType,
    });

    // URL expires in 600 seconds (10 mins)
    const signedUrl = await getSignedUrl(r2, command, { expiresIn: 600 });

    // Return the key so the client/TS server can track this asset in the DB
    return {
      key,
      signedUrl,
      fileName: image.fileName,
    };
  },

  async signMultipleImages(userId: string, data: ImageUploadCheckDto) {
    const { images } = data;

    const promises = images.map(image =>
      this.signImageUrl(userId, data.uploadId, image),
    );
    const results = await Promise.all(promises);

    return results;
  },
};
