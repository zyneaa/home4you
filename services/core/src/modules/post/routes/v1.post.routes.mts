import { validateDto } from "@middlewares";
import { Router } from "express";

import { postController } from "../controllers/v1/post.controller.mjs";
import { createPostDtoSchema } from "../dtos/addPost.dto.mjs";
import { deletePostDtoSchema } from "../dtos/deletePost.dto.mjs";
import { listPostsDtoSchema } from "../dtos/listPosts.dto.mjs";
import { updatePostDtoSchema } from "../dtos/updatePost.dto.mjs";

const router = Router();

router.post(
  "/new",
  validateDto(createPostDtoSchema),
  postController.createPost,
);

router.patch(
  "/update/:postId",
  validateDto(updatePostDtoSchema),
  postController.updatePost,
);

router.delete(
  "/delete/:postId",
  validateDto(deletePostDtoSchema),
  postController.deletePost,
);

router.get("/find/:postId", postController.getPost);

router.get("/find", validateDto(listPostsDtoSchema), postController.getPosts);

export default router;
