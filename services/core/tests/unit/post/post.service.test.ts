import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "../../../src/utils/appError.mjs";
import { postService } from "../../../src/modules/post/post.service.mjs";
import { Media } from "../../../src/modules/media/media.model.mjs";
import { Post } from "../../../src/modules/post/post.model.mjs";
import { Property } from "../../../src/modules/property/property.model.mjs";
import mongoose from "mongoose";

// Mock models — mongoose sessions are mocked via model fns
vi.mock("../../../src/modules/media/media.model.mjs", () => ({
  Media: {
    updateMany: vi.fn(),
  },
}));

vi.mock("../../../src/modules/post/post.model.mjs", () => ({
  Post: {
    create: vi.fn(),
  },
}));

vi.mock("../../../src/modules/property/property.model.mjs", () => ({
  Property: {
    create: vi.fn(),
  },
}));

// mongoose.startSession/withTransaction — fake session passthrough
vi.mock("mongoose", async importOriginal => {
  const actual = await importOriginal<typeof mongoose>();
  const fakeSession = {
    withTransaction: async (fn: () => Promise<unknown>) => fn(),
    inTransaction: () => false,
    endSession: vi.fn(),
  };
  return {
    ...actual,
    default: {
      ...actual.default,
      startSession: vi.fn(async () => fakeSession),
    },
  };
});

const USER = "68cd9a9b1f9d3e2a4c5b6d7f";
const POST_ID = "01913b2e-7b6a-7cc2-8f4c-000000000001";
const KEY_A = `media/u/${USER}/p/${POST_ID}/11111111-1111-4111-8111-111111111111/raw`;
const KEY_B = `media/u/${USER}/p/${POST_ID}/22222222-2222-4222-8222-222222222222/raw`;

const baseDto = {
  postId: POST_ID,
  images: [KEY_A, KEY_B],
  price: 100,
  propertyType: "APARTMENT",
  transactionType: "RENT",
  locationReadable: "Yangon",
  locationCoordinates: { type: "Point", coordinates: [96.1, 16.8] },
  isAvailable: true,
} as any;

describe("postService.createPost media claim (rp-1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("claims UPLOADED unclaimed media and creates post+property", async () => {
    // -- arrange
    const fakePostId = new mongoose.Types.ObjectId();
    (Post.create as any).mockResolvedValue([
      { _id: fakePostId, postId: POST_ID },
    ]);
    (Property.create as any).mockResolvedValue([
      { _id: new mongoose.Types.ObjectId() },
    ]);
    (Media.updateMany as any).mockResolvedValue({
      modifiedCount: 2,
      matchedCount: 2,
    });

    // -- act
    const post = await postService.createPost(USER, baseDto);

    // -- assert
    expect(post.postId).toBe(POST_ID);
    expect(Property.create).toHaveBeenCalledWith(
      [expect.objectContaining({ photos: [KEY_A, KEY_B], listedBy: USER })],
      expect.anything(),
    );
    expect(Media.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER,
        key: { $in: [KEY_A, KEY_B] },
        uploadStatus: "UPLOADED",
        isClaimed: false,
      }),
      expect.objectContaining({
        $set: expect.objectContaining({
          isClaimed: true,
          mediaOwnerType: "POST",
        }),
      }),
      expect.anything(),
    );
  });

  it("rejects key from another post (path prefix mismatch)", async () => {
    (Post.create as any).mockResolvedValue([
      { _id: new mongoose.Types.ObjectId() },
    ]);
    (Property.create as any).mockResolvedValue([
      { _id: new mongoose.Types.ObjectId() },
    ]);

    const otherPostKey = KEY_A.replace(`p/${POST_ID}/`, "p/other-post-id/");
    await expect(
      postService.createPost(USER, { ...baseDto, images: [otherPostKey] }),
    ).rejects.toThrow(
      new AppError("One or more media files do not belong to this post", 400),
    );
  });

  it("rejects when media missing/not-owned/not-UPLOADED (count mismatch)", async () => {
    (Post.create as any).mockResolvedValue([
      { _id: new mongoose.Types.ObjectId() },
    ]);
    (Property.create as any).mockResolvedValue([
      { _id: new mongoose.Types.ObjectId() },
    ]);
    (Media.updateMany as any).mockResolvedValue({
      modifiedCount: 1,
      matchedCount: 1,
    });

    await expect(
      postService.createPost(USER, baseDto), // expects 2 claimed, only 1 modified
    ).rejects.toThrow(
      new AppError(
        "One or more media files are missing, not uploaded, already used, or not owned by you",
        400,
      ),
    );
  });
});
