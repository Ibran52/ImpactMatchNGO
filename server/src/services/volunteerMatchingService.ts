import mongoose from "mongoose";
import { config } from "../config.js";
import { HelpRequest, Notification, User, VolunteerAssignment } from "../models.js";
import type { HelpRequestDocument, NeedDocument, UserDocument } from "../models.js";
import { rankVolunteerMatches } from "../matching.js";
import { distanceBetweenKm } from "./locationService.js";

const activeAssignmentStatuses = ["accepted", "in_progress", "submitted_for_review", "more_evidence_required", "rejected_with_reason", "flagged_for_manual_review"];
const categoryTerms: Record<string, string[]> = {
  food: ["food", "food & essentials", "nutrition", "meal"],
  clothing: ["clothing", "clothes", "apparel"],
  shelter: ["shelter", "housing", "accommodation"],
  medical_assistance: ["medical_assistance", "medical", "health", "healthcare"],
  education: ["education", "learning", "school", "tutoring"],
  emergency_support: ["emergency_support", "emergency", "disaster relief", "crisis"],
  other: ["other", "community", "general"],
};

function normalized(value: string): string {
  return value.trim().toLowerCase().replace(/[_-]/g, " ");
}

function escapedRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function categoryProfileMatches(user: UserDocument, category: string): boolean {
  const terms = categoryTerms[category] ?? [category];
  const profileTags = [...(user.categories ?? []), ...(user.skills ?? []), ...(user.interests ?? [])]
    .map(normalized);
  return terms.some((term) => profileTags.some((tag) => tag === normalized(term) || tag.includes(normalized(term))));
}

export type VolunteerMatch = {
  volunteer: Pick<UserDocument, "_id" | "city" | "skills" | "categories" | "volunteerLocation" | "volunteerServiceArea" | "volunteerServiceRadiusKm" | "activeVolunteerAssignmentCount" | "maxActiveAssignments">;
  distanceKm?: number;
  activeAssignments: number;
  explanation: string[];
};

export async function findEligibleVolunteersForRequest(request: Pick<
  HelpRequestDocument,
  "category" | "city" | "urgency" | "location"
>): Promise<VolunteerMatch[]> {
  const baseFilter = {
    role: "volunteer",
    accountStatus: "active",
    volunteerEligibility: "eligible",
    volunteerTaskOptIn: true,
  };
  const categoryPatterns = (categoryTerms[request.category] ?? [request.category])
    .map((term) => new RegExp(escapedRegex(term), "i"));
  const skillFilter = {
    $or: [
      { categories: { $in: categoryPatterns } },
      { skills: { $in: categoryPatterns } },
      { interests: { $in: categoryPatterns } },
    ],
  };
  const city = escapedRegex(request.city.trim());
  let candidatesWithLocation: UserDocument[] = [];
  if (request.location) {
    try {
      candidatesWithLocation = await User.find({
        ...baseFilter,
        ...skillFilter,
        volunteerLocation: {
          $near: {
            $geometry: request.location,
            $maxDistance: config.VOLUNTEER_MATCH_RADIUS_KM * 1000,
          },
        },
      }).select("_id city categories skills interests volunteerLocation volunteerServiceArea volunteerServiceRadiusKm maxActiveAssignments activeVolunteerAssignmentCount").limit(250);
    } catch (error) {
      if (!(error instanceof mongoose.mongo.MongoServerError) || error.code !== 291) throw error;
    }
  }
  const fallbackCandidates = await User.find({
    ...baseFilter,
    ...skillFilter,
    ...(request.location
      ? {
        volunteerLocation: { $exists: false },
        $or: [
          { city: { $regex: `^${city}$`, $options: "i" } },
          { volunteerServiceArea: { $regex: city, $options: "i" } },
        ],
      }
      : {
        $or: [
          { city: { $regex: `^${city}$`, $options: "i" } },
          { volunteerServiceArea: { $regex: city, $options: "i" } },
        ],
      }),
  }).select("_id city categories skills interests volunteerLocation volunteerServiceArea volunteerServiceRadiusKm maxActiveAssignments activeVolunteerAssignmentCount").limit(250);

  const seen = new Set<string>();
  const candidates = [...candidatesWithLocation, ...fallbackCandidates].filter((candidate) => {
    const id = candidate._id.toString();
    if (seen.has(id) || !categoryProfileMatches(candidate, request.category)) return false;
    seen.add(id);
    if (!request.location || !candidate.volunteerLocation) return true;
    const kilometers = distanceBetweenKm(request.location.coordinates, candidate.volunteerLocation.coordinates);
    return kilometers <= config.VOLUNTEER_MATCH_RADIUS_KM &&
      kilometers <= (candidate.volunteerServiceRadiusKm ?? config.VOLUNTEER_MATCH_RADIUS_KM);
  });
  if (!candidates.length) return [];

  const ids = candidates.map((candidate) => candidate._id);
  const workload = await VolunteerAssignment.aggregate<{ _id: mongoose.Types.ObjectId; count: number }>([
    { $match: { volunteerId: { $in: ids }, status: { $in: activeAssignmentStatuses } } },
    { $group: { _id: "$volunteerId", count: { $sum: 1 } } },
  ]);
  const workloadByVolunteer = new Map(workload.map((item) => [item._id.toString(), item.count]));
  return candidates
    .flatMap((volunteer) => {
      const activeAssignments = workloadByVolunteer.get(volunteer._id.toString()) ?? 0;
      const assignmentLimit = volunteer.maxActiveAssignments ?? 3;
      if (activeAssignments >= assignmentLimit) return [];
      const kilometers = request.location && volunteer.volunteerLocation
        ? distanceBetweenKm(request.location.coordinates, volunteer.volunteerLocation.coordinates)
        : undefined;
      const explanation = [
        `Profile skills/categories match ${request.category.replace(/_/g, " ")}.`,
        ...(request.urgency === "high" ? ["High urgency: prioritizing volunteers with available capacity."] : []),
        kilometers === undefined
          ? `Serving ${volunteer.city || volunteer.volunteerServiceArea || request.city}; precise distance is unavailable.`
          : `Within service radius at ${kilometers.toFixed(1)} km.`,
        `${activeAssignments} of ${assignmentLimit} active assignment slots are in use.`,
      ];
      return [{
        volunteer,
        ...(kilometers === undefined ? {} : { distanceKm: kilometers }),
        activeAssignments,
        explanation,
      }];
    })
    .sort((first, second) => {
      const firstDistance = first.distanceKm ?? Number.MAX_SAFE_INTEGER;
      const secondDistance = second.distanceKm ?? Number.MAX_SAFE_INTEGER;
      const workloadOrder = first.activeAssignments - second.activeAssignments;
      const distanceOrder = firstDistance - secondDistance;
      return (request.urgency === "high" ? workloadOrder || distanceOrder : distanceOrder || workloadOrder) ||
        first.volunteer._id.toString().localeCompare(second.volunteer._id.toString());
    });
}

export async function offerRequestToEligibleVolunteers(
  request: HelpRequestDocument,
  actorId: string,
): Promise<Array<{ assignmentId: string; volunteerId: string; expiresAt: Date; explanation: string[]; distanceKm?: number }>> {
  if (!request.assignedOrganizationId || !["approved", "matching_volunteer"].includes(request.status)) {
    throw new Error("Only an NGO-approved request can be offered to volunteers.");
  }
  const currentStatus = request.status;
  if (currentStatus === "approved") {
    const updated = await HelpRequest.findOneAndUpdate(
      { _id: request._id, assignedOrganizationId: request.assignedOrganizationId, status: "approved" },
      {
        $set: { status: "matching_volunteer" },
        $push: { timeline: { status: "matching_volunteer", actorId, reason: "NGO opened volunteer matching.", occurredAt: new Date() } },
      },
      { new: true },
    );
    if (!updated) throw new Error("Request status changed before volunteer matching started.");
  }

  const matches = (await findEligibleVolunteersForRequest(request))
    .slice(0, config.VOLUNTEER_MATCH_MAX_OFFERS);
  const expiresAt = new Date(Date.now() + config.VOLUNTEER_OFFER_TTL_HOURS * 60 * 60 * 1000);
  const results: Array<{ assignmentId: string; volunteerId: string; expiresAt: Date; explanation: string[]; distanceKm?: number }> = [];
  for (const match of matches) {
    const volunteerId = match.volunteer._id.toString();
    const offer = await VolunteerAssignment.findOneAndUpdate(
      { requestId: request._id, volunteerId, status: { $in: ["declined", "expired", "cancelled", "reassigned"] } },
      {
        $set: {
          ngoId: request.assignedOrganizationId,
          status: "offered",
          offerExpiresAt: expiresAt,
          matchExplanation: match.explanation,
          ...(match.distanceKm === undefined ? {} : { distanceKm: match.distanceKm }),
        },
        $unset: {
          acceptedAt: 1,
          startedAt: 1,
          submittedAt: 1,
          progressNote: 1,
          privateDetailsDisclosedAt: 1,
          ...(match.distanceKm === undefined ? { distanceKm: 1 } : {}),
        },
        $push: { history: { status: "offered", actorId, reason: "Task offer issued to eligible volunteer.", occurredAt: new Date() } },
      },
      { new: true },
    );
    const assignment = offer ?? await VolunteerAssignment.create({
      requestId: request._id,
      volunteerId,
      ngoId: request.assignedOrganizationId,
      status: "offered",
      offerExpiresAt: expiresAt,
      matchExplanation: match.explanation,
      ...(match.distanceKm === undefined ? {} : { distanceKm: match.distanceKm }),
      history: [{ status: "offered", actorId, reason: "Task offer issued to eligible volunteer.", occurredAt: new Date() }],
    }).catch((error: unknown) => {
      if (error && typeof error === "object" && "code" in error && error.code === 11000) return null;
      throw error;
    });
    if (!assignment) continue;
    await Notification.updateOne(
      { recipientId: match.volunteer._id, idempotencyKey: `volunteer-offer:${assignment._id.toString()}:${expiresAt.getTime()}` },
      {
        $setOnInsert: {
          recipientId: match.volunteer._id,
          type: "volunteer_task_offer",
          idempotencyKey: `volunteer-offer:${assignment._id.toString()}:${expiresAt.getTime()}`,
          payload: {
            assignmentId: assignment._id.toString(),
            category: request.category,
            urgency: request.urgency,
            city: request.city,
          },
          status: "sent",
        },
      },
      { upsert: true },
    );
    results.push({
      assignmentId: assignment._id.toString(),
      volunteerId,
      expiresAt,
      explanation: match.explanation,
      ...(match.distanceKm === undefined ? {} : { distanceKm: match.distanceKm }),
    });
  }
  return results;
}

export function matchVolunteerToNeeds(
  profile: Pick<UserDocument, "city" | "skills" | "interests" | "categories">,
  needs: NeedDocument[],
) {
  return rankVolunteerMatches(profile, needs);
}
