import mongoose from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUsers: vi.fn(),
  aggregateAssignments: vi.fn(),
}));

vi.mock("../models.js", () => ({
  HelpRequest: {},
  Notification: {},
  User: { find: mocks.findUsers },
  VolunteerAssignment: { aggregate: mocks.aggregateAssignments },
}));

import { findEligibleVolunteersForRequest } from "./volunteerMatchingService.js";

describe("findEligibleVolunteersForRequest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.aggregateAssignments.mockResolvedValue([]);
  });

  it("uses a conservative service-area fallback when the geospatial index is unavailable", async () => {
    const indexError = new mongoose.mongo.MongoServerError({ message: "unable to find index for $geoNear query" });
    indexError.code = 291;
    const volunteer = {
      _id: new mongoose.Types.ObjectId(),
      city: "Thane",
      skills: ["food assistance"],
      categories: [],
      interests: [],
      volunteerLocation: undefined,
      volunteerServiceArea: "Thane",
      volunteerServiceRadiusKm: 30,
      maxActiveAssignments: 3,
      activeVolunteerAssignmentCount: 0,
    };
    mocks.findUsers
      .mockReturnValueOnce({
        select: () => ({ limit: async () => Promise.reject(indexError) }),
      })
      .mockReturnValueOnce({
        select: () => ({ limit: async () => [volunteer] }),
      });

    const matches = await findEligibleVolunteersForRequest({
      category: "food",
      city: "Thane",
      urgency: "medium",
      location: { type: "Point", coordinates: [72.97, 19.22] },
    });

    expect(matches).toHaveLength(1);
    expect(matches[0]?.distanceKm).toBeUndefined();
    expect(mocks.findUsers).toHaveBeenCalledTimes(2);
    expect(mocks.aggregateAssignments).toHaveBeenCalledTimes(1);
  });

  it("does not suppress non-index database failures", async () => {
    const error = new mongoose.mongo.MongoServerError({ message: "database unavailable" });
    error.code = 123;
    mocks.findUsers.mockReturnValueOnce({
      select: () => ({ limit: async () => Promise.reject(error) }),
    });

    await expect(findEligibleVolunteersForRequest({
      category: "food",
      city: "Thane",
      urgency: "medium",
      location: { type: "Point", coordinates: [72.97, 19.22] },
    })).rejects.toBe(error);
  });

  it("calculates distance from coordinates and excludes candidates outside the allowed radius", async () => {
    const makeVolunteer = (longitude: number) => ({
      _id: new mongoose.Types.ObjectId(),
      city: "Thane",
      skills: ["food assistance"],
      categories: [],
      interests: [],
      volunteerLocation: { type: "Point" as const, coordinates: [longitude, 19.22] as [number, number] },
      volunteerServiceArea: "Thane",
      volunteerServiceRadiusKm: 30,
      maxActiveAssignments: 3,
      activeVolunteerAssignmentCount: 0,
    });
    const nearby = makeVolunteer(72.97);
    const outsideRadius = makeVolunteer(73.7);
    mocks.findUsers
      .mockReturnValueOnce({
        select: () => ({ limit: async () => [nearby, outsideRadius] }),
      })
      .mockReturnValueOnce({
        select: () => ({ limit: async () => [] }),
      });

    const matches = await findEligibleVolunteersForRequest({
      category: "food",
      city: "Thane",
      urgency: "medium",
      location: { type: "Point", coordinates: [72.97, 19.22] },
    });

    expect(matches).toHaveLength(1);
    expect(matches[0]?.distanceKm).toBe(0);
    expect(matches[0]?.volunteer._id).toEqual(nearby._id);
  });
});
