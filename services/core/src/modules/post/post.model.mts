import { model, Schema } from "mongoose";

import type { IPost } from "./types/post.type.mjs";

const PostSchema = new Schema<IPost>(
  {
    listedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    property: {
      type: Schema.Types.ObjectId,
      ref: "Property",
      required: true,
      index: true,
    },
    description: {
      type: String,
    },
    likeCount: {
      type: Number,
      required: true,
    },
    commentCount: {
      type: Number,
      required: true,
    },
    shareCount: {
      type: Number,
      required: true,
    },
  },
  {
    timestamps: true,
    optimisticConcurrency: true,
    toJSON: {
      transform(_doc, ret) {
        return ret;
      },
    },
  },
);

export const Post = model<IPost>("Post", PostSchema);
