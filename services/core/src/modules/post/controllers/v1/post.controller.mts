import type { CreatePostDto } from "@modules/post/dtos/addPost.dto.mjs";
import type { ListPostsDto } from "@modules/post/dtos/listPosts.dto.mjs";
import type { UpdatePostDto } from "@modules/post/dtos/updatePost.dto.mjs";
import { postService } from "@modules/post/post.service.mjs";
import { AppError } from "@utils";
import type { NextFunction, Request, Response } from "express";

export const postController = {
  /**
   * Creates a new post and associated property.
   * Logic flow:
   * 1. Checks if the user is authenticated.
   * 2. Extracts validated data from the request body.
   * 3. Calls postService to create the property and post within a transaction.
   * 4. Returns the created post with a 201 status.
   */
  async createPost(
    req: Request<unknown, unknown, CreatePostDto>,
    res: Response,
    next: NextFunction,
  ) {
    try {
      if (!req.user) {
        throw new AppError("Unauthorized", 401);
      }

      const validatedBody = req.validated!.body as CreatePostDto;
      const post = await postService.createPost(req.user.id, validatedBody);

      res.status(201).json(post);
    } catch (error) {
      next(error);
    }
  },

  /**
   * Updates an existing post and its associated property.
   * Logic flow:
   * 1. Checks if the user is authenticated.
   * 2. Extracts validated data from the request body and post ID from params.
   * 3. Calls postService to update the post and property data.
   * 4. Returns the updated post with a 200 status.
   */
  async updatePost(
    req: Request<{ postId: string }, unknown, UpdatePostDto>,
    res: Response,
    next: NextFunction,
  ) {
    try {
      if (!req.user) {
        throw new AppError("Unauthorized", 401);
      }

      const validatedBody = req.validated!.body as UpdatePostDto;
      const post = await postService.updatePost(
        req.user.id,
        req.params.postId,
        validatedBody,
      );

      res.status(200).json(post);
    } catch (error) {
      next(error);
    }
  },

  /**
   * Deletes a post and its associated property.
   * Logic flow:
   * 1. Checks if the user is authenticated.
   * 2. Extracts post ID from params.
   * 3. Calls postService to delete the post and its linked property.
   * 4. Returns a success message with a 200 status.
   */
  async deletePost(
    req: Request<{ postId: string }>,
    res: Response,
    next: NextFunction,
  ) {
    try {
      if (!req.user) {
        throw new AppError("Unauthorized", 401);
      }

      const result = await postService.deletePost(
        req.user.id,
        req.params.postId,
      );

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  },

  /**
   * Retrieves a single post by its ID.
   * Logic flow:
   * 1. Extracts post ID from params.
   * 2. Calls postService to fetch the post with populated details.
   * 3. Returns the post with a 200 status.
   */
  async getPost(
    req: Request<{ postId: string }>,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const post = await postService.getPostById(req.params.postId);

      res.status(200).json(post);
    } catch (error) {
      next(error);
    }
  },

  /**
   * Retrieves a list of posts with pagination and optional filtering.
   * Logic flow:
   * 1. Extracts validated query parameters (page, limit, userId).
   * 2. Calls postService to fetch a paginated list of posts.
   * 3. Returns the list of posts and metadata with a 200 status.
   */
  async getPosts(
    req: Request<unknown, unknown, unknown, ListPostsDto>,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const validatedQuery = req.validated!.query as ListPostsDto;
      const result = await postService.getPosts(validatedQuery);

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  },
};
