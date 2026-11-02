import mongoose from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findNgos: vi.fn(),
  aggregateNgos: vi.fn(),
  aggregateRequests: vi.fn(),
}));

vi.mock("../models.js", () => ({
  HelpRequest: { aggregate: mocks.aggregateRequests },
  User: { aggregate: mocks.aggregateNgos, find: mocks.findNgos },
}));

import { matchVerifiedNgos } from "./ngoMatchingService.js";

describe("matchVerifiedNgos", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.aggregateRequests.mockResolvedValue([]);
    mocks.findNgos.mockReturnValue({
      select: () => ({
        sort: () => ({
          limit: () => ({
            lean: async () => [{
              _id: new mongoose.Types.ObjectId(),
              name: "Community Food Support",
              city: "Mumbai",
              categories: ["food"],
              serviceArea: "Mumbai, Thane",
              acceptingRequests: true,
              activeHelpRequestCount: 0,
            }],
          }),
        }),
      }),
    });
  });

  it("matches verified organizations by category and service area", async () => {
    const matches = await matchVerifiedNgos({
      _id: new mongoose.Types.ObjectId(),
      category: "food",
      city: "Thane",
      urgency: "medium",
      location: undefined,
    });

    expect(matches).toHaveLength(1);
    expect(matches[0]?.organization.name).toBe("Community Food Support");
    expect(matches[0]?.reasons).toContain("Service area includes Thane.");
  });

  it("returns no matches for requests without a city", async () => {
    const matches = await matchVerifiedNgos({
      _id: new mongoose.Types.ObjectId(),
      category: "food",
      city: "",
      urgency: "medium",
      location: undefined,
    });

    expect(matches).toEqual([]);
    expect(mocks.findNgos).not.toHaveBeenCalled();
  });

  it("falls back to city and service-area matching when the geospatial index is missing", async () => {
    const error = new mongoose.mongo.MongoServerError({ message: "unable to find index for $geoNear query" });
    error.code = 291;
    mocks.aggregateNgos.mockRejectedValueOnce(error);

    const matches = await matchVerifiedNgos({
      _id: new mongoose.Types.ObjectId(),
      category: "food",
      city: "Thane",
      urgency: "medium",
      location: { type: "Point", coordinates: [72.97, 19.22] },
    });

    expect(matches).toHaveLength(1);
    expect(matches[0]?.organization.name).toBe("Community Food Support");
    expect(matches[0]?.distanceKm).toBeUndefined();
    expect(mocks.findNgos).toHaveBeenCalledWith(expect.objectContaining({
      ngoLocation: { $exists: false },
    }));
  });

  it("rethrows geospatial database errors other than a missing index", async () => {
    const error = new mongoose.mongo.MongoServerError({ message: "database unavailable" });
    error.code = 123;
    mocks.aggregateNgos.mockRejectedValueOnce(error);

    await expect(matchVerifiedNgos({
      _id: new mongoose.Types.ObjectId(),
      category: "food",
      city: "Thane",
      urgency: "medium",
      location: { type: "Point", coordinates: [72.97, 19.22] },
    })).rejects.toBe(error);
  });
});
