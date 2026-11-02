import mongoose from "mongoose";
import { HelpRequest, Notification, User } from "../models.js";
import type { HelpRequestDocument } from "../models.js";
import type { HelpRequestStatus, RequestScreeningStatus } from "../types/domain.js";
import { recordAuditEvent } from "./auditService.js";

const allowedTransitions: Partial<Record<HelpRequestStatus, HelpRequestStatus[]>> = {
  submitted: ["screening", "cancelled"],
  needs_information: ["screening", "submitted", "cancelled"],
  pending_ngo_review: ["screening", "under_review", "needs_information", "flagged_for_review", "approved", "rejected", "cancelled"],
  screening: ["screening", "pending_ngo_review", "flagged_for_review"],
  flagged_for_review: ["pending_ngo_review", "under_review", "needs_information", "approved", "rejected"],
  under_review: ["needs_information", "flagged_for_review", "approved", "rejected"],
  approved: ["matching_volunteer", "cancelled"],
  matching_volunteer: ["assigned", "approved", "cancelled"],
  matched: ["assigned", "cancelled"],
  assigned: ["in_progress", "cancelled"],
  in_progress: ["pending_completion_review", "more_evidence_required", "cancelled"],
  pending_completion_review: ["completed", "in_progress", "more_evidence_required"],
  more_evidence_required: ["pending_completion_review", "in_progress", "cancelled"],
};

const notifyRequesterStatuses = new Set<HelpRequestStatus>([
  "under_review", "needs_information", "flagged_for_review", "approved", "matching_volunteer",
  "assigned", "in_progress", "pending_completion_review", "more_evidence_required", "completed", "rejected", "cancelled",
]);

async function releaseNgoCapacity(organizationId: mongoose.Types.ObjectId): Promise<void> {
  const updated = await User.findOneAndUpdate(
    { _id: organizationId, activeHelpRequestCount: { $gt: 0 } },
    { $inc: { activeHelpRequestCount: -1 } },
    { new: true },
  ).select("_id");
  if (!updated) throw new Error("The organization request-capacity counter could not be released.");
}

async function restoreNgoCapacity(organizationId: mongoose.Types.ObjectId): Promise<void> {
  const updated = await User.updateOne({ _id: organizationId }, { $inc: { activeHelpRequestCount: 1 } });
  if (!updated.matchedCount) throw new Error("The organization request-capacity reservation could not be restored.");
}

export async function transitionHelpRequestStatus(input: {
  requestId: string;
  actorId: string;
  to: HelpRequestStatus;
  reason?: string;
  screeningStatus?: RequestScreeningStatus;
  screening?: HelpRequestDocument["screening"] | null;
  expectedOrganizationId?: string;
}): Promise<HelpRequestDocument | null> {
  const current = await HelpRequest.findById(input.requestId);
  if (!current || !allowedTransitions[current.status]?.includes(input.to)) return null;

  const now = new Date();
  const setFields: Record<string, unknown> = { status: input.to };
  const unsetFields: Record<string, 1> = {};
  if (input.screeningStatus) setFields.screeningStatus = input.screeningStatus;
  if (input.screening) setFields.screening = input.screening;
  if (input.screening === null || input.to === "submitted") unsetFields.screening = 1;
  if (input.to === "submitted" || input.to === "screening") setFields.screeningStatus = "pending";
  const releasingOrganization = ["completed", "cancelled", "rejected"].includes(input.to) ? current.assignedOrganizationId : undefined;
  if (releasingOrganization) await releaseNgoCapacity(releasingOrganization);
  let updated: HelpRequestDocument | null;
  try {
    updated = await HelpRequest.findOneAndUpdate(
      {
        _id: current._id,
        status: current.status,
        ...(input.expectedOrganizationId ? { assignedOrganizationId: input.expectedOrganizationId } : {}),
      },
      {
        $set: setFields,
        $push: { timeline: { status: input.to, actorId: new mongoose.Types.ObjectId(input.actorId), reason: input.reason, occurredAt: now } },
        ...(Object.keys(unsetFields).length ? { $unset: unsetFields } : {}),
      },
      { new: true, runValidators: true },
    );
  } catch (error) {
    if (releasingOrganization) await restoreNgoCapacity(releasingOrganization);
    throw error;
  }
  if (!updated) {
    if (releasingOrganization) await restoreNgoCapacity(releasingOrganization);
    return null;
  }

  await recordAuditEvent({
    actorId: input.actorId,
    action: "help_request.status_changed",
    resourceType: "help_request",
    resourceId: updated._id.toString(),
    previousStatus: current.status,
    newStatus: updated.status,
    reason: input.reason,
  });
  if (notifyRequesterStatuses.has(input.to)) {
    await Notification.create({
      recipientId: updated.requesterId,
      type: "help_request_status_changed",
      idempotencyKey: `help-request:${updated._id.toString()}:${input.to}:${now.getTime()}`,
      payload: {
        requestId: updated._id.toString(),
        status: input.to,
        ...(input.reason && ["needs_information", "flagged_for_review", "rejected"].includes(input.to) ? { reason: input.reason.slice(0, 400) } : {}),
      },
      status: "sent",
    });
  }
  return updated;
}

export async function routeHelpRequestToNgo(input: {
  requestId: string;
  requesterId: string;
  organizationId: string;
}): Promise<HelpRequestDocument | null> {
  const capacityReservation = await User.findOneAndUpdate(
    {
      _id: input.organizationId,
      role: "ngo",
      organizationStatus: "verified",
      acceptingRequests: { $ne: false },
      $or: [
        { requestCapacity: { $exists: false } },
        { $expr: { $lt: [{ $ifNull: ["$activeHelpRequestCount", 0] }, "$requestCapacity"] } },
      ],
    },
    { $inc: { activeHelpRequestCount: 1 } },
    { new: true },
  ).select("_id");
  if (!capacityReservation) return null;
  const now = new Date();
  let updated: HelpRequestDocument | null;
  try {
    updated = await HelpRequest.findOneAndUpdate(
      {
        _id: input.requestId,
        requesterId: input.requesterId,
        status: { $in: ["pending_ngo_review", "rejected"] },
        $or: [{ assignedOrganizationId: { $exists: false } }, { assignedOrganizationId: null }],
      },
      {
        $set: {
          status: "pending_ngo_review",
          assignedOrganizationId: new mongoose.Types.ObjectId(input.organizationId),
        },
        $push: {
          timeline: {
            status: "pending_ngo_review",
            actorId: new mongoose.Types.ObjectId(input.requesterId),
            reason: "Request routed to a verified organization selected by the requester.",
            occurredAt: now,
          },
        },
      },
      { new: true, runValidators: true },
    );
  } catch (error) {
    await releaseNgoCapacity(capacityReservation._id);
    throw error;
  }
  if (!updated) {
    await releaseNgoCapacity(capacityReservation._id);
    return null;
  }

  await recordAuditEvent({
    actorId: input.requesterId,
    action: "help_request.routed_to_ngo",
    resourceType: "help_request",
    resourceId: updated._id.toString(),
    newStatus: updated.status,
  });
  await Notification.create([
    {
      recipientId: updated.requesterId,
      type: "help_request_routed",
      idempotencyKey: `help-request:${updated._id.toString()}:routed:${now.getTime()}`,
      payload: { requestId: updated._id.toString(), status: "pending_ngo_review" },
      status: "sent",
    },
    {
      recipientId: new mongoose.Types.ObjectId(input.organizationId),
      type: "ngo_request_received",
      idempotencyKey: `help-request:${updated._id.toString()}:ngo:${input.organizationId}:${now.getTime()}`,
      payload: { requestId: updated._id.toString(), category: updated.category, urgency: updated.urgency },
      status: "sent",
    },
  ]);
  return updated;
}

export async function declineNgoRequest(input: {
  requestId: string;
  actorId: string;
  organizationId: string;
  reason: string;
}): Promise<HelpRequestDocument | null> {
  const current = await HelpRequest.findOne({
    _id: input.requestId,
    assignedOrganizationId: input.organizationId,
    status: { $in: ["pending_ngo_review", "under_review", "needs_information", "flagged_for_review"] },
  });
  if (!current) return null;
  const assignedOrganization = current.assignedOrganizationId;
  if (!assignedOrganization) return null;
  await releaseNgoCapacity(assignedOrganization);
  const now = new Date();
  let updated: HelpRequestDocument | null;
  try {
    updated = await HelpRequest.findOneAndUpdate(
      {
        _id: input.requestId,
        assignedOrganizationId: input.organizationId,
        status: current.status,
      },
      {
        $unset: { assignedOrganizationId: 1 },
        $set: { status: "rejected" },
        $push: {
          timeline: {
            status: "rejected",
            actorId: new mongoose.Types.ObjectId(input.actorId),
            reason: `Organization declined this request: ${input.reason.slice(0, 400)}`,
            occurredAt: now,
          },
        },
      },
      { new: true, runValidators: true },
    );
  } catch (error) {
    await restoreNgoCapacity(assignedOrganization);
    throw error;
  }
  if (!updated) {
    await restoreNgoCapacity(assignedOrganization);
    return null;
  }

  await recordAuditEvent({
    actorId: input.actorId,
    action: "ngo_request.declined",
    resourceType: "help_request",
    resourceId: updated._id.toString(),
    previousStatus: current.status,
    newStatus: updated.status,
    reason: input.reason,
  });
  await Notification.create({
    recipientId: updated.requesterId,
    type: "help_request_ngo_declined",
    idempotencyKey: `help-request:${updated._id.toString()}:declined:${now.getTime()}`,
    payload: { requestId: updated._id.toString(), status: "rejected", reason: input.reason.slice(0, 400) },
    status: "sent",
  });
  return updated;
}
