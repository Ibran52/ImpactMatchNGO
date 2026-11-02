import mongoose from "mongoose";
import { HelpRequest, User } from "../models.js";
import type { HelpRequestDocument, OrganizationDocument } from "../models.js";
import { config } from "../config.js";
import { readGeoPointCoordinates } from "./locationService.js";

export type NgoMatch = {
  organization: Pick<OrganizationDocument, "_id" | "name" | "city" | "categories" | "serviceArea" | "acceptingRequests" | "requestCapacity">;
  reasons: string[];
  distanceKm?: number;
  activeRequests: number;
};

type GeoCandidate = Pick<OrganizationDocument, "_id" | "name" | "city" | "categories" | "serviceArea" | "acceptingRequests" | "requestCapacity" | "activeHelpRequestCount"> & {
  distanceMeters?: number;
};

function escaped(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function categoryPatterns(category: string): RegExp[] {
  const aliases: Record<string, string[]> = {
    food: ["food", "food & essentials", "food assistance"],
    clothing: ["clothing", "clothes"],
    shelter: ["shelter", "housing"],
    medical_assistance: ["medical assistance", "medical", "health"],
    education: ["education", "educational"],
    emergency_support: ["emergency support", "emergency", "disaster relief"],
    other: ["other", "community"],
  };
  return [...new Set([category, ...(aliases[category] ?? [])])]
    .map((value) => new RegExp(`^${escaped(value)}$`, "i"));
}

export async function matchVerifiedNgos(request: Pick<HelpRequestDocument, "_id" | "city" | "category" | "urgency" | "location">): Promise<NgoMatch[]> {
  const category = typeof request.category === "string" ? request.category.trim() : "";
  const city = typeof request.city === "string" ? request.city.trim() : "";
  if (!category || !city) return [];
  const baseFilter = {
    role: "ngo",
    accountStatus: "active",
    organizationStatus: "verified",
    acceptingRequests: { $ne: false },
    categories: { $in: categoryPatterns(category) },
  };
  const candidates = new Map<string, GeoCandidate>();
  const requestCoordinates = readGeoPointCoordinates(request.location);

  if (
    requestCoordinates &&
    requestCoordinates.length === 2 &&
    Number.isFinite(requestCoordinates[0]) &&
    Number.isFinite(requestCoordinates[1]) &&
    Math.abs(requestCoordinates[0]) <= 180 &&
    Math.abs(requestCoordinates[1]) <= 90
  ) {
    try {
      const nearby = await User.aggregate<GeoCandidate>([
        {
          $geoNear: {
            near: { type: "Point", coordinates: requestCoordinates },
            key: "ngoLocation",
            distanceField: "distanceMeters",
            maxDistance: config.NGO_MATCH_RADIUS_KM * 1000,
            spherical: true,
            query: baseFilter,
          },
        },
        { $limit: Math.min(250, config.NGO_MATCH_MAX_RESULTS * 5) },
        { $project: { name: 1, city: 1, categories: 1, serviceArea: 1, acceptingRequests: 1, requestCapacity: 1, activeHelpRequestCount: 1, distanceMeters: 1 } },
      ]);
      nearby.forEach((ngo) => candidates.set(ngo._id.toString(), ngo));
    } catch (error) {
      if (!(error instanceof mongoose.mongo.MongoServerError) || error.code !== 291) throw error;
    }
  }

  const cityPattern = new RegExp(`^${escaped(city)}$`, "i");
  const fallback = await User.find({
    ...baseFilter,
    ...(requestCoordinates ? { ngoLocation: { $exists: false } } : {}),
    $or: [{ city: cityPattern }, { serviceArea: new RegExp(escaped(city), "i") }],
  })
    .select("name city categories serviceArea acceptingRequests requestCapacity activeHelpRequestCount")
    .sort({ name: 1 })
    .limit(Math.min(250, config.NGO_MATCH_MAX_RESULTS * 5))
    .lean<GeoCandidate[]>();
  fallback.forEach((ngo) => {
    if (candidates.size < config.NGO_MATCH_MAX_RESULTS) candidates.set(ngo._id.toString(), ngo);
  });

  const ids = [...candidates.values()].map((ngo) => ngo._id);
  const activeStatuses = ["pending_ngo_review", "under_review", "needs_information", "flagged_for_review", "approved", "matching_volunteer", "assigned", "in_progress", "pending_completion_review", "more_evidence_required"];
  const activeCounts = ids.length
    ? await HelpRequest.aggregate<{ _id: mongoose.Types.ObjectId; count: number }>([
      { $match: { assignedOrganizationId: { $in: ids }, status: { $in: activeStatuses } } },
      { $group: { _id: "$assignedOrganizationId", count: { $sum: 1 } } },
    ])
    : [];
  const countById = new Map(activeCounts.map((entry) => [entry._id.toString(), entry.count]));

  return [...candidates.values()]
    .map((organization) => {
      const organizationCity = typeof organization.city === "string" ? organization.city.trim() : "";
      const organizationName = typeof organization.name === "string" ? organization.name.trim() : "";
      if (!organizationCity || !organizationName) return null;
      const activeRequests = countById.get(organization._id.toString()) ?? 0;
      const distanceKm = typeof organization.distanceMeters === "number" ? organization.distanceMeters / 1000 : undefined;
      const activeCount = Math.max(activeRequests, organization.activeHelpRequestCount ?? 0);
      const capacityAvailable = organization.requestCapacity === undefined || activeCount < organization.requestCapacity;
      const reasons = [`Verified organization supporting ${category.replaceAll("_", " ")}.`];
      if (distanceKm !== undefined) reasons.push(`${distanceKm.toFixed(1)} km away, within the ${config.NGO_MATCH_RADIUS_KM} km search radius.`);
      else if (organizationCity.toLocaleLowerCase() === city.toLocaleLowerCase()) reasons.push(`Located in ${city}.`);
      else reasons.push(`Service area includes ${city}.`);
      if (request.urgency === "high") reasons.push("High-urgency requests are reviewed by the organization before any action.");
      if (organization.requestCapacity !== undefined) reasons.push(`${Math.max(0, organization.requestCapacity - activeCount)} request capacity remaining.`);
      return {
        organization: { ...organization, name: organizationName, city: organizationCity },
        reasons,
        ...(distanceKm !== undefined ? { distanceKm } : {}),
        activeRequests: activeCount,
        eligible: capacityAvailable,
      };
    })
    .filter((match): match is NonNullable<typeof match> => Boolean(match?.eligible))
    .slice(0, config.NGO_MATCH_MAX_RESULTS)
    .map(({ eligible: _eligible, ...match }) => match);
}

export async function findEligibleNgoForRequest(request: Pick<HelpRequestDocument, "_id" | "city" | "category" | "urgency" | "location">, organizationId: string): Promise<NgoMatch | null> {
  const matches = await matchVerifiedNgos(request);
  return matches.find((match) => match.organization._id.equals(organizationId)) ?? null;
}
