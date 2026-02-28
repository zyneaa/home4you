import type { CreatePostDto } from "@modules/post/dtos/addPost.dto.mjs";
import type { ListPostsDto } from "@modules/post/dtos/listPosts.dto.mjs";
import type { UpdatePostDto } from "@modules/post/dtos/updatePost.dto.mjs";
import { postService } from "@modules/post/post.service.mjs";
import { AppError } from "@utils";
import type { NextFunction, Request, Response } from "express";

export const postController = {
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
