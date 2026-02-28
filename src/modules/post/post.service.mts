import { Property } from "@modules/property/property.model.mjs";
import { AppError } from "@utils";
import mongoose from "mongoose";

import type { CreatePostDto } from "./dtos/addPost.dto.mjs";
import type { ListPostsDto } from "./dtos/listPosts.dto.mjs";
import type { UpdatePostDto } from "./dtos/updatePost.dto.mjs";
import { Post } from "./post.model.mjs";

export const postService = {
  async createPost(userId: string, dto: CreatePostDto) {
    const session = await mongoose.startSession();
    try {
      let postArray: any[] = [];
      await session.withTransaction(async () => {
        const properties = await Property.create(
          [
            {
              ...dto,
              listedBy: userId,
            },
          ],
          { session },
        );

        if (!properties || properties.length === 0 || !properties[0]) {
          throw new AppError("Failed to create property", 500);
        }

        const createdProperty = properties[0];

        postArray = await Post.create(
          [
            {
              listedBy: userId,
              property: createdProperty._id,
              description: dto.description,
              likeCount: 0,
              commentCount: 0,
              shareCount: 0,
            },
          ],
          { session },
        );
      });
      return postArray[0];
    } catch (error) {
      if (session.inTransaction()) {
        await session.abortTransaction();
      }
      throw error;
    } finally {
      await session.endSession();
    }
  },

  async updatePost(userId: string, postId: string, dto: UpdatePostDto) {
    if (!mongoose.Types.ObjectId.isValid(postId)) {
      throw new AppError("Invalid Post ID", 400);
    }

    const session = await mongoose.startSession();
    try {
      let updatedPost;
      await session.withTransaction(async () => {
        const post = await Post.findById(postId).session(session);
        if (!post) {
          throw new AppError("Post not found", 404);
        }

        if (post.listedBy.toString() !== userId) {
          throw new AppError("Not authorized to update this post", 403);
        }

        const { description, ...propertyData } = dto;

        if (description !== undefined) {
          post.description = description;
          await post.save({ session });
        }

        if (Object.keys(propertyData).length > 0) {
          await Property.findByIdAndUpdate(
            post.property,
            { ...propertyData },
            { session, runValidators: true },
          );
        }

        updatedPost = post;
      });
      return updatedPost;
    } catch (error) {
      if (session.inTransaction()) {
        await session.abortTransaction();
      }
      throw error;
    } finally {
      await session.endSession();
    }
  },

  async deletePost(userId: string, postId: string) {
    if (!mongoose.Types.ObjectId.isValid(postId)) {
      throw new AppError("Invalid Post ID", 400);
    }

    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const post = await Post.findById(postId).session(session);
        if (!post) {
          throw new AppError("Post not found", 404);
        }

        if (post.listedBy.toString() !== userId) {
          throw new AppError("Not authorized to delete this post", 403);
        }

        await Property.findByIdAndDelete(post.property).session(session);
        await Post.findByIdAndDelete(postId).session(session);
      });
    } catch (error) {
      if (session.inTransaction()) {
        await session.abortTransaction();
      }
      throw error;
    } finally {
      await session.endSession();
    }
    return { message: "Post deleted successfully" };
  },

  async getPostById(postId: string) {
    if (!mongoose.Types.ObjectId.isValid(postId)) {
      throw new AppError("Invalid Post ID", 400);
    }

    const post = await Post.findById(postId)
      .populate("listedBy")
      .populate("property");
    if (!post) {
      throw new AppError("Post not found", 404);
    }
    return post;
  },

  async getPosts(options: ListPostsDto) {
    const { page = 1, limit = 10, userId } = options;
    const query: any = {};

    if (userId) {
      if (!mongoose.Types.ObjectId.isValid(userId)) {
        throw new AppError("Invalid User ID", 400);
      }
      query.listedBy = userId;
    }

    const skip = (page - 1) * limit;
    const [posts, total] = await Promise.all([
      Post.find(query)
        .populate("listedBy")
        .populate("property")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Post.countDocuments(query),
    ]);

    return {
      data: posts,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  },
};
