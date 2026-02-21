import { describe, it, expect, vi, beforeEach } from "vitest";

import { propertyService } from "../../../src/modules/property/property.service.mjs";
import { Property } from "../../../src/modules/property/property.model.mjs";
import { AppError } from "../../../src/utils/appError.mjs";
import mongoose from "mongoose";

// Mock Property model
vi.mock("../../../src/modules/property/property.model.mjs", () => ({
  Property: {
    create: vi.fn(),
    find: vi.fn(),
    findById: vi.fn(),
    countDocuments: vi.fn(),
    findByIdAndUpdate: vi.fn(),
    findByIdAndDelete: vi.fn(),
  },
}));

describe("Property Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createProperty", () => {
    it("should create a property", async () => {
      const mockProperty = { id: "prop1", title: "Test Property" };
      (Property.create as any).mockResolvedValue(mockProperty);

      const result = await propertyService.createProperty("user1", {
        title: "Test Property",
      } as any);

      expect(result).toBe(mockProperty);
      expect(Property.create).toHaveBeenCalledWith(
        expect.objectContaining({ listedBy: "user1", title: "Test Property" }),
      );
    });
  });

  describe("getProperties", () => {
    it("should return paged properties with filters", async () => {
      const mockProperties = [{ id: "prop1" }];
      // Mock chain: find().populate().skip().sort().limit()
      const mockQuery = {
        populate: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue(mockProperties),
      };
      (Property.find as any).mockReturnValue(mockQuery);
      (Property.countDocuments as any).mockResolvedValue(10);

      const result = await propertyService.getProperties({
        page: 1,
        limit: 10,
        minPrice: 100,
      });

      expect(result.data).toBe(mockProperties);
      expect(result.meta.total).toBe(10);
      expect(Property.find).toHaveBeenCalledWith(
        expect.objectContaining({
          price: { $gte: 100 },
        }),
      );
    });
  });

  describe("getNearbyProperties", () => {
    it("should find nearby properties", async () => {
      const mockProperties = [{ id: "prop1" }];
      const mockQuery = {
        populate: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue(mockProperties),
      };
      (Property.find as any).mockReturnValue(mockQuery);

      const result = await propertyService.getNearbyProperties(90, 45);

      expect(Property.find).toHaveBeenCalledWith(
        expect.objectContaining({
          locationCoordinates: {
            $near: expect.objectContaining({
              $geometry: expect.objectContaining({ coordinates: [90, 45] }),
            }),
          },
        }),
      );
      expect(result).toBe(mockProperties);
    });
  });

  describe("updateProperty", () => {
    it("should update property if owned by user", async () => {
      const mockProperty = { _id: "prop1", listedBy: "user1" }; // ensure listedBy matches
      (Property.findById as any).mockResolvedValue(mockProperty);
      (Property.findByIdAndUpdate as any).mockResolvedValue({
        ...mockProperty,
        title: "Updates",
      });

      const result = await propertyService.updateProperty("user1", "prop1", {
        title: "Updates",
      } as any);

      expect(result.title).toBe("Updates");
    });

    it("should throw 403 if user is not owner", async () => {
      const mockProperty = { _id: "prop1", listedBy: "otherUser" };
      (Property.findById as any).mockResolvedValue(mockProperty);

      await expect(
        propertyService.updateProperty("user1", "prop1", {} as any),
      ).rejects.toThrow(AppError);
      await expect(
        propertyService.updateProperty("user1", "prop1", {} as any),
      ).rejects.toThrow("Not authorized");
    });
  });
});
