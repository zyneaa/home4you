import { Media } from "@modules/media/media.model.mjs";
import {
  MediaJob,
  MediaJobStatus,
  MediaJobType,
} from "@modules/media/mediaJob.model.mjs";
import { Property } from "@modules/property/property.model.mjs";
import { AppError } from "@utils";
import mongoose from "mongoose";

import { dispatchPendingJobs } from "../../jobs/mediaJobDispatcher.job.mjs";

import type { CreatePostDto } from "./dtos/addPost.dto.mjs";
import type { ListPostsDto } from "./dtos/listPosts.dto.mjs";
import type { UpdatePostDto } from "./dtos/updatePost.dto.mjs";
import { Post } from "./post.model.mjs";

// Bump when the processing pipeline changes so existing jobs are not
// re-enqueued for media processed under an older pipeline.
const MEDIA_PIPELINE_VERSION = "1";

// Per mediaType: jobs created when the post claims the media.
const JOBS_BY_MEDIA_TYPE: Record<string, string[]> = {
  image: [MediaJobType.OPTIMIZE_IMAGE, MediaJobType.CLASSIFY_IMAGE],
  video: [MediaJobType.GENERATE_VIDEO_RENDITIONS],
};

export const postService = {
  /**
   * Creates a new property and an associated post in a database transaction.
   *
   * Logic flow:
   * 1. Idempotency: postId is a client-generated uuidv7 with a unique
   *    index — a retry after a timeout returns the original post.
   * 2. Atomically claims the media records passed as stable mediaIds
   *    (client S3 keys are never trusted) and creates the post, property,
   *    and processing jobs (outbox records) in the same transaction.
   * 3. After the commit, a dispatcher publishes pending jobs to Redis. If
   *    Redis is unavailable the durable job records remain for later
   *    dispatch, avoiding the lost-enqueue failure mode.
   *
   * @param userId - The ID of the user creating the post.
   * @param dto - Data for creating the post and property.
   * @returns The created (or already existing) post object.
   * @throws {AppError} If property creation or media claiming fails.
   */
  async createPost(userId: string, dto: CreatePostDto) {
    // Fast idempotency check outside the transaction; the unique index is
    // the true guard for concurrent duplicates (loser surfaces below).
    const existing = await Post.findOne({ postId: dto.postId }).lean();
    if (existing) {
      return existing;
    }

    const mediaIds = [...new Set(dto.mediaIds)];

    const session = await mongoose.startSession();
    try {
      let postArray: any[] = [];
      await session.withTransaction(async () => {
        const property = await Property.create(
          [
            {
              ...dto,
              photos: [], // filled below from claimed media keys, never from the client
              listedBy: userId,
            },
          ],
          { session },
        );

        if (!property || property.length === 0 || !property[0]) {
          throw new AppError("Failed to create property", 500);
        }

        const createdProperty = property[0];

        const postDoc = await Post.create(
          [
            {
              postId: dto.postId,
              listedBy: userId,
              property: createdProperty._id,
              mediaIds,

              description: dto.description,
              likeCount: 0,
              commentCount: 0,
              shareCount: 0,

              currentComplianceScore: 10, // placeholder
              currentActivityModifier: 10, // placeholder
              qualityScore: 10, // placeholder
            },
          ],
          { session },
        );
        const createdPost = postDoc[0];
        if (!createdPost) {
          throw new AppError("Failed to create post", 500);
        }

        // Atomic claim by stable mediaId: filter includes isClaimed:false so
        // a concurrent double-claim gets modifiedCount mismatch -> abort tx.
        // The transaction rolls back on failure, leaving the uploads
        // unclaimed and available for a retry (cleanup only reclaims
        // unclaimed uploads after the grace period).
        if (mediaIds.length > 0) {
          const claim = await Media.updateMany(
            {
              userId,
              mediaId: { $in: mediaIds },
              uploadStatus: "UPLOADED",
              isClaimed: false,
              isDeleted: { $ne: true },
            },
            {
              $set: {
                isClaimed: true,
                mediaOwnerId: createdPost._id,
                mediaOwnerType: "POST",
              },
            },
            { session },
          );

          if (claim.modifiedCount !== mediaIds.length) {
            throw new AppError(
              "One or more media files are missing, not uploaded, already used, or not owned by you",
              400,
            );
          }

          const claimed = await Media.find({
            userId,
            mediaId: { $in: mediaIds },
            isClaimed: true,
            mediaOwnerId: createdPost._id,
          })
            .select("_id key mediaType")
            .session(session)
            .lean();

          // Photos are derived server-side from claimed media documents.
          await Property.updateOne(
            { _id: createdProperty._id },
            { $set: { photos: claimed.map(m => m.key) } },
            { session },
          );

          // Durable outbox: one processing job per media per job type,
          // created in the SAME transaction as the post + claims so the
          // commit never succeeds without the jobs existing.
          const jobDocs = claimed.flatMap(media =>
            (JOBS_BY_MEDIA_TYPE[media.mediaType] ?? []).map(jobType => ({
              mediaId: media._id,
              postId: createdPost._id,
              jobType,
              status: MediaJobStatus.PENDING,
              idempotencyKey: `${dto.postId}:${media._id.toString()}:${jobType}:v${MEDIA_PIPELINE_VERSION}`,
              pipelineVersion: MEDIA_PIPELINE_VERSION,
              priority: 0,
              attempts: 0,
              maxAttempts: 5,
              availableAt: new Date(),
            })),
          );

          if (jobDocs.length) {
            await MediaJob.insertMany(jobDocs, {
              session,
              ordered: true,
            });
          }
        }

        postArray = postDoc;
      });

      // Best-effort dispatch after commit. If Redis is down, the PENDING
      // job records remain durable and the dispatcher cron re-publishes.
      void dispatchPendingJobs().catch(() => undefined);

      return postArray[0];
    } catch (error: any) {
      // Lost the idempotency race: the unique index rejected the duplicate.
      if (error?.code === 11000 || error?.message?.includes("E11000")) {
        const existingPost = await Post.findOne({ postId: dto.postId }).lean();
        if (existingPost) {
          return existingPost;
        }
      }
      if (session.inTransaction()) {
        await session.abortTransaction();
      }
      throw error;
    } finally {
      await session.endSession();
    }
  },

  /**
   * Updates a post's description and its associated property data.
   *
   * @param userId - The ID of the user attempting the update.
   * @param postId - The ID of the post to update.
   * @param dto - The update data.
   * @returns The updated post object.
   * @throws {AppError} If post not found or user not authorized.
   */
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

  /**
   * Deletes a post and its associated property.
   *
   * @param userId - The ID of the user attempting the deletion.
   * @param postId - The ID of the post to delete.
   * @returns A success message object.
   * @throws {AppError} If post not found or user not authorized.
   */
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

  /**
   * Retrieves a single post by ID with populated details.
   *
   * @param postId - The ID of the post to retrieve.
   * @returns The post document with populated listedBy and property fields.
   * @throws {AppError} If post not found.
   */
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

  /**
   * Retrieves a paginated list of posts, optionally filtered by userId.
   *
   * @param options - Pagination and filter options.
   * @returns Paginated posts and metadata.
   */
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
