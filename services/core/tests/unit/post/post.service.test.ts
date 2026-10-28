import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "../../../src/utils/appError.mjs";
import { postService } from "../../../src/modules/post/post.service.mjs";
import { Media } from "../../../src/modules/media/media.model.mjs";
import { MediaJob } from "../../../src/modules/media/mediaJob.model.mjs";
import { Post } from "../../../src/modules/post/post.model.mjs";
import { Property } from "../../../src/modules/property/property.model.mjs";
import mongoose from "mongoose";

// Mock models — mongoose sessions are mocked via model fns
vi.mock("../../../src/modules/media/media.model.mjs", () => ({
  Media: {
    updateMany: vi.fn(),
    find: vi.fn(),
  },
}));

vi.mock("../../../src/modules/post/post.model.mjs", () => ({
  Post: {
    findOne: vi.fn(),
    create: vi.fn(),
  },
}));

vi.mock("../../../src/modules/property/property.model.mjs", () => ({
  Property: {
    create: vi.fn(),
    updateOne: vi.fn(),
  },
}));

vi.mock("../../../src/modules/media/mediaJob.model.mjs", () => ({
  MediaJob: {
    create: vi.fn(),
  },
  MediaJobStatus: { PENDING: "PENDING" },
  MediaJobType: {
    CLASSIFY_IMAGE: "CLASSIFY_IMAGE",
    OPTIMIZE_IMAGE: "OPTIMIZE_IMAGE",
    GENERATE_VIDEO_RENDITIONS: "GENERATE_VIDEO_RENDITIONS",
  },
}));

vi.mock("../../../src/jobs/mediaJobDispatcher.job.mjs", () => ({
  dispatchPendingJobs: vi.fn(async () => 0),
  startMediaJobDispatcherJob: vi.fn(),
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
const MEDIA_ID_A = "11111111-1111-4111-8111-111111111111";
const MEDIA_ID_B = "22222222-2222-4222-8222-222222222222";
const KEY_A = `media/u/${USER}/p/${POST_ID}/${MEDIA_ID_A}/raw`;
const KEY_B = `media/u/${USER}/p/${POST_ID}/${MEDIA_ID_B}/raw`;

const baseDto = {
  postId: POST_ID,
  mediaIds: [MEDIA_ID_A, MEDIA_ID_B],
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
    (Post.findOne as any).mockReturnValue({
      lean: async () => null,
    });
    (Property.updateOne as any).mockResolvedValue({});
  });

  it("claims UPLOADED unclaimed media by mediaId and creates post+property+jobs", async () => {
    // -- arrange
    const fakePostId = new mongoose.Types.ObjectId();
    (Post.create as any).mockResolvedValue([
      { _id: fakePostId, postId: POST_ID, mediaIds: baseDto.mediaIds },
    ]);
    (Property.create as any).mockResolvedValue([
      { _id: new mongoose.Types.ObjectId() },
    ]);
    (Media.updateMany as any).mockResolvedValue({
      modifiedCount: 2,
      matchedCount: 2,
    });
    (Media.find as any).mockReturnValue({
      select: () => ({
        session: () => ({
          lean: async () => [
            {
              _id: new mongoose.Types.ObjectId(),
              key: KEY_A,
              mediaType: "image",
            },
            {
              _id: new mongoose.Types.ObjectId(),
              key: KEY_B,
              mediaType: "image",
            },
          ],
        }),
      }),
    });

    // -- act
    const post = await postService.createPost(USER, baseDto);

    // -- assert
    expect(post.postId).toBe(POST_ID);
    expect(Media.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER,
        mediaId: { $in: baseDto.mediaIds },
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
    // Photos are derived server-side from claimed media keys, never from dto.
    expect(Property.create).toHaveBeenCalledWith(
      [expect.objectContaining({ photos: [], listedBy: USER })],
      expect.anything(),
    );
    expect(Property.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({}),
      { $set: { photos: [KEY_A, KEY_B] } },
      expect.anything(),
    );
    // One OPTIMIZE_IMAGE + one CLASSIFY_IMAGE job per image media.
    expect(MediaJob.create).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          jobType: "OPTIMIZE_IMAGE",
          postId: fakePostId,
        }),
        expect.objectContaining({
          jobType: "CLASSIFY_IMAGE",
          postId: fakePostId,
        }),
      ]),
      expect.anything(),
    );
    expect(MediaJob.create).toHaveBeenCalledTimes(1);
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

  it("returns the existing post on retry (idempotency via postId)", async () => {
    (Post.findOne as any).mockReturnValue({
      lean: async () => ({ postId: POST_ID, mediaIds: baseDto.mediaIds }),
    });

    const post = await postService.createPost(USER, baseDto);

    expect(post.postId).toBe(POST_ID);
    expect(Post.create).not.toHaveBeenCalled();
    expect(Media.updateMany).not.toHaveBeenCalled();
  });
});
