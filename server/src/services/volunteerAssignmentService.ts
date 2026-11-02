import mongoose from "mongoose";
import type { HydratedDocument } from "mongoose";
import {
  AssignmentEvidence,
  CompletionProof,
  HelpRequest,
  Notification,
  User,
  VolunteerAssignment,
} from "../models.js";
import type { CompletionProofDocument } from "../models.js";
import { recordAuditEvent } from "./auditService.js";
import { assessCompletionEvidence } from "./aiVerificationService.js";
import { extractRequestText } from "./ocrService.js";

async function releaseVolunteerSlot(volunteerId: mongoose.Types.ObjectId): Promise<void> {
  const result = await User.updateOne(
    { _id: volunteerId, activeVolunteerAssignmentCount: { $gt: 0 } },
    { $inc: { activeVolunteerAssignmentCount: -1 } },
  );
  if (!result.modifiedCount) throw new Error("The volunteer assignment limit could not be released.");
}

export async function releaseCompletedVolunteerSlot(volunteerId: mongoose.Types.ObjectId): Promise<void> {
  await releaseVolunteerSlot(volunteerId);
}

async function reserveVolunteerSlot(volunteerId: string): Promise<boolean> {
  const user = await User.findOneAndUpdate(
    {
      _id: volunteerId,
      role: "volunteer",
      accountStatus: { $ne: "suspended" },
      volunteerEligibility: "eligible",
      volunteerTaskOptIn: true,
      $expr: {
        $lt: [
          { $ifNull: ["$activeVolunteerAssignmentCount", 0] },
          { $ifNull: ["$maxActiveAssignments", 3] },
        ],
      },
    },
    { $inc: { activeVolunteerAssignmentCount: 1 } },
    { new: true },
  ).select("_id");
  return Boolean(user);
}

async function notifyAssignmentParties(input: {
  requestId: string;
  assignmentId: string;
  requesterId: mongoose.Types.ObjectId;
  ngoId: mongoose.Types.ObjectId;
  status: string;
  volunteerId?: mongoose.Types.ObjectId;
}): Promise<void> {
  const nowKey = `${input.assignmentId}:${input.status}:${Date.now()}`;
  const recipients = [
    { id: input.requesterId, type: "help_request_assignment_updated" },
    { id: input.ngoId, type: "ngo_assignment_updated" },
    ...(input.volunteerId ? [{ id: input.volunteerId, type: "volunteer_assignment_updated" }] : []),
  ];
  await Notification.create(recipients.map(({ id, type }) => ({
    recipientId: id,
    type,
    idempotencyKey: `${type}:${nowKey}:${id.toString()}`,
    payload: { requestId: input.requestId, assignmentId: input.assignmentId, status: input.status },
    status: "sent",
  })));
}

export async function expireVolunteerOffers(volunteerId?: string): Promise<void> {
  const expiredOffers = await VolunteerAssignment.find({
    status: "offered",
    offerExpiresAt: { $lte: new Date() },
    ...(volunteerId ? { volunteerId } : {}),
  }).select("_id volunteerId requestId ngoId history");
  for (const offer of expiredOffers) {
    const now = new Date();
    const expired = await VolunteerAssignment.findOneAndUpdate(
      { _id: offer._id, status: "offered", offerExpiresAt: { $lte: now } },
      {
        $set: { status: "expired" },
        $push: { history: { status: "expired", actorId: offer.ngoId, reason: "Offer acceptance window elapsed.", occurredAt: now } },
      },
      { new: true },
    );
    if (!expired) continue;
    await Notification.updateOne(
      { recipientId: offer.volunteerId, idempotencyKey: `volunteer-offer-expired:${offer._id.toString()}` },
      {
        $setOnInsert: {
          recipientId: offer.volunteerId,
          type: "volunteer_task_offer_expired",
          idempotencyKey: `volunteer-offer-expired:${offer._id.toString()}`,
          payload: { assignmentId: offer._id.toString(), status: "expired" },
          status: "sent",
        },
      },
      { upsert: true },
    );
    await Notification.updateOne(
      { recipientId: offer.ngoId, idempotencyKey: `ngo-volunteer-offer-expired:${offer._id.toString()}` },
      {
        $setOnInsert: {
          recipientId: offer.ngoId,
          type: "ngo_assignment_updated",
          idempotencyKey: `ngo-volunteer-offer-expired:${offer._id.toString()}`,
          payload: { assignmentId: offer._id.toString(), requestId: offer.requestId.toString(), status: "expired" },
          status: "sent",
        },
      },
      { upsert: true },
    );
  }
}

async function cancelSiblingOffers(requestId: mongoose.Types.ObjectId, acceptedId: mongoose.Types.ObjectId, actorId: string): Promise<void> {
  const offers = await VolunteerAssignment.find({
    requestId,
    _id: { $ne: acceptedId },
    status: "offered",
  }).select("_id volunteerId ngoId");
  for (const offer of offers) {
    const now = new Date();
    const cancelled = await VolunteerAssignment.findOneAndUpdate(
      { _id: offer._id, status: "offered" },
      {
        $set: { status: "cancelled", cancellationReason: "Another volunteer accepted this request." },
        $push: { history: { status: "cancelled", actorId, reason: "Another volunteer accepted this request.", occurredAt: now } },
      },
      { new: true },
    );
    if (!cancelled) continue;
    await Notification.updateOne(
      { recipientId: offer.volunteerId, idempotencyKey: `volunteer-offer-cancelled:${offer._id.toString()}` },
      {
        $setOnInsert: {
          recipientId: offer.volunteerId,
          type: "volunteer_task_offer_cancelled",
          idempotencyKey: `volunteer-offer-cancelled:${offer._id.toString()}`,
          payload: { assignmentId: offer._id.toString(), status: "cancelled" },
          status: "sent",
        },
      },
      { upsert: true },
    );
  }
}

export async function acceptVolunteerOffer(assignmentId: string, volunteerId: string) {
  const assignment = await VolunteerAssignment.findOne({
    _id: assignmentId,
    volunteerId,
    status: "offered",
    offerExpiresAt: { $gt: new Date() },
  });
  if (!assignment) return { error: "This offer is no longer available." } as const;
  const request = await HelpRequest.findOne({
    _id: assignment.requestId,
    assignedOrganizationId: assignment.ngoId,
    status: "matching_volunteer",
    $or: [{ assignedVolunteerId: { $exists: false } }, { assignedVolunteerId: null }],
  });
  if (!request) return { error: "This task has already been claimed or is no longer open." } as const;
  const slotReserved = await reserveVolunteerSlot(volunteerId);
  if (!slotReserved) return { error: "Your account is not eligible or has reached its active assignment limit." } as const;

  const now = new Date();
  const claimedRequest = await HelpRequest.findOneAndUpdate(
    {
      _id: request._id,
      assignedOrganizationId: assignment.ngoId,
      status: "matching_volunteer",
      $or: [{ assignedVolunteerId: { $exists: false } }, { assignedVolunteerId: null }],
    },
    {
      $set: { status: "assigned", assignedVolunteerId: volunteerId },
      $push: {
        timeline: {
          status: "assigned",
          actorId: volunteerId,
          reason: "An eligible volunteer accepted the task offer.",
          occurredAt: now,
        },
      },
    },
    { new: true },
  );
  if (!claimedRequest) {
    await releaseVolunteerSlot(assignment.volunteerId);
    return { error: "Another volunteer claimed this task first." } as const;
  }

  const accepted = await VolunteerAssignment.findOneAndUpdate(
    { _id: assignment._id, volunteerId, status: "offered", offerExpiresAt: { $gt: now } },
    {
      $set: { status: "accepted", acceptedAt: now, privateDetailsDisclosedAt: now },
      $push: { history: { status: "accepted", actorId: volunteerId, occurredAt: now } },
    },
    { new: true },
  );
  if (!accepted) {
    const rolledBack = await HelpRequest.findOneAndUpdate(
      { _id: claimedRequest._id, status: "assigned", assignedVolunteerId: volunteerId },
      {
        $set: { status: "matching_volunteer" },
        $unset: { assignedVolunteerId: 1 },
        $push: {
          timeline: {
            status: "matching_volunteer",
            actorId: volunteerId,
            reason: "Offer expired or changed during acceptance; task returned to matching.",
            occurredAt: new Date(),
          },
        },
      },
    );
    await releaseVolunteerSlot(assignment.volunteerId);
    if (!rolledBack) throw new Error("Assignment acceptance could not be completed or safely rolled back.");
    return { error: "This offer expired before acceptance completed." } as const;
  }

  await recordAuditEvent({
    actorId: volunteerId,
    action: "volunteer_assignment.accepted",
    resourceType: "volunteer_assignment",
    resourceId: accepted._id.toString(),
    previousStatus: "offered",
    newStatus: "accepted",
  });
  await cancelSiblingOffers(request._id, accepted._id, volunteerId);
  await notifyAssignmentParties({
    requestId: request._id.toString(),
    assignmentId: accepted._id.toString(),
    requesterId: request.requesterId,
    ngoId: assignment.ngoId,
    status: "accepted",
    volunteerId: assignment.volunteerId,
  });
  return { assignment: accepted, request: claimedRequest } as const;
}

export async function declineVolunteerOffer(assignmentId: string, volunteerId: string) {
  const now = new Date();
  const assignment = await VolunteerAssignment.findOneAndUpdate(
    { _id: assignmentId, volunteerId, status: "offered", offerExpiresAt: { $gt: now } },
    {
      $set: { status: "declined" },
      $push: { history: { status: "declined", actorId: volunteerId, occurredAt: now } },
    },
    { new: true },
  );
  if (!assignment) return null;
  await recordAuditEvent({
    actorId: volunteerId,
    action: "volunteer_assignment.declined",
    resourceType: "volunteer_assignment",
    resourceId: assignment._id.toString(),
    previousStatus: "offered",
    newStatus: "declined",
  });
  await Notification.create({
    recipientId: assignment.ngoId,
    type: "ngo_assignment_updated",
    idempotencyKey: `ngo-assignment-declined:${assignment._id.toString()}`,
    payload: { assignmentId: assignment._id.toString(), requestId: assignment.requestId.toString(), status: "declined" },
    status: "sent",
  });
  return assignment;
}

export async function startVolunteerAssignment(assignmentId: string, volunteerId: string) {
  const assignment = await VolunteerAssignment.findOne({
    _id: assignmentId,
    volunteerId,
    status: "accepted",
  });
  if (!assignment) return null;
  const now = new Date();
  const started = await VolunteerAssignment.findOneAndUpdate(
    { _id: assignment._id, volunteerId, status: "accepted" },
    {
      $set: { status: "in_progress", startedAt: now },
      $push: { history: { status: "in_progress", actorId: volunteerId, occurredAt: now } },
    },
    { new: true },
  );
  if (!started) return null;
  const request = await HelpRequest.findOneAndUpdate(
    { _id: assignment.requestId, assignedVolunteerId: volunteerId, assignedOrganizationId: assignment.ngoId, status: "assigned" },
    {
      $set: { status: "in_progress" },
      $push: { timeline: { status: "in_progress", actorId: volunteerId, reason: "Volunteer started the task.", occurredAt: now } },
    },
    { new: true },
  );
  if (!request) {
    const rollback = await VolunteerAssignment.findOneAndUpdate(
      { _id: started._id, volunteerId, status: "in_progress" },
      {
        $set: { status: "accepted" },
        $unset: { startedAt: 1 },
        $push: { history: { status: "accepted", actorId: volunteerId, reason: "Start action conflicted; assignment remains accepted.", occurredAt: new Date() } },
      },
    );
    if (!rollback) throw new Error("The task start could not be recorded or safely rolled back.");
    return null;
  }
  await recordAuditEvent({ actorId: volunteerId, action: "volunteer_assignment.started", resourceType: "volunteer_assignment", resourceId: started._id.toString(), previousStatus: "accepted", newStatus: "in_progress" });
  await notifyAssignmentParties({ requestId: request._id.toString(), assignmentId: started._id.toString(), requesterId: request.requesterId, ngoId: assignment.ngoId, status: "in_progress", volunteerId: assignment.volunteerId });
  return started;
}

export async function updateVolunteerProgress(assignmentId: string, volunteerId: string, note: string) {
  const now = new Date();
  const assignment = await VolunteerAssignment.findOneAndUpdate(
    { _id: assignmentId, volunteerId, status: "in_progress" },
    {
      $set: { progressNote: note },
      $push: { history: { status: "in_progress", actorId: volunteerId, reason: note, occurredAt: now } },
    },
    { new: true },
  );
  if (!assignment) return null;
  const request = await HelpRequest.findOneAndUpdate(
    { _id: assignment.requestId, assignedVolunteerId: volunteerId, status: "in_progress" },
    { $push: { timeline: { status: "in_progress", actorId: volunteerId, reason: "Volunteer reported task progress.", occurredAt: now } } },
  );
  if (!request) throw new Error("Assignment progress was saved but the linked request is no longer active.");
  await recordAuditEvent({ actorId: volunteerId, action: "volunteer_assignment.progress_updated", resourceType: "volunteer_assignment", resourceId: assignment._id.toString(), previousStatus: "in_progress", newStatus: "in_progress", reason: "Progress note recorded." });
  await notifyAssignmentParties({ requestId: assignment.requestId.toString(), assignmentId: assignment._id.toString(), requesterId: request.requesterId, ngoId: assignment.ngoId, status: "in_progress", volunteerId: assignment.volunteerId });
  return assignment;
}

export async function endVolunteerAssignment(input: {
  assignmentId: string;
  actorId: string;
  actorRole: "volunteer" | "ngo" | "admin";
  reason: string;
  status: "cancelled" | "reassigned" | "disputed";
}) {
  const accessFilter: Record<string, unknown> = {
    _id: input.assignmentId,
    status: { $in: ["accepted", "in_progress", "more_evidence_required", "rejected_with_reason"] },
  };
  if (input.actorRole === "volunteer") accessFilter.volunteerId = input.actorId;
  if (input.actorRole === "ngo") accessFilter.ngoId = input.actorId;
  const assignment = await VolunteerAssignment.findOne(accessFilter);
  if (!assignment) return null;
  const now = new Date();
  const ended = await VolunteerAssignment.findOneAndUpdate(
    { _id: assignment._id, status: assignment.status, volunteerId: assignment.volunteerId },
    {
      $set: { status: input.status, cancellationReason: input.reason },
      $push: { history: { status: input.status, actorId: input.actorId, reason: input.reason, occurredAt: now } },
    },
    { new: true },
  );
  if (!ended) return null;
  const requestStatuses = assignment.status === "accepted"
    ? ["assigned"]
    : assignment.status === "more_evidence_required"
      ? ["more_evidence_required"]
      : ["in_progress"];
  const request = await HelpRequest.findOneAndUpdate(
    {
      _id: assignment.requestId,
      assignedOrganizationId: assignment.ngoId,
      assignedVolunteerId: assignment.volunteerId,
      status: { $in: requestStatuses },
    },
    {
      $set: { status: "matching_volunteer" },
      $unset: { assignedVolunteerId: 1 },
      $push: {
        timeline: { status: "matching_volunteer", actorId: input.actorId, reason: input.reason, occurredAt: now },
      },
    },
    { new: true },
  );
  if (!request) {
    const restored = await VolunteerAssignment.findOneAndUpdate(
      { _id: ended._id, status: input.status, volunteerId: assignment.volunteerId },
      {
        $set: {
          status: assignment.status,
        },
        $unset: { cancellationReason: 1 },
        $push: {
          history: {
            status: assignment.status,
            actorId: input.actorId,
            reason: "Assignment closure conflicted; active assignment status restored.",
            occurredAt: new Date(),
          },
        },
      },
    );
    if (!restored) throw new Error("Assignment closure conflicted and could not be safely rolled back.");
    return null;
  }
  await releaseVolunteerSlot(assignment.volunteerId);
  await recordAuditEvent({
    actorId: input.actorId,
    action: `volunteer_assignment.${input.status}`,
    resourceType: "volunteer_assignment",
    resourceId: ended._id.toString(),
    previousStatus: assignment.status,
    newStatus: input.status,
    reason: input.reason,
  });
  await notifyAssignmentParties({ requestId: request._id.toString(), assignmentId: ended._id.toString(), requesterId: request.requesterId, ngoId: assignment.ngoId, status: input.status, volunteerId: assignment.volunteerId });
  return { assignment: ended, request };
}

export async function submitAssignmentProof(input: {
  assignmentId: string;
  volunteerId: string;
  summary: string;
  report: string;
  completedAt: Date;
  unresolvedIssues?: string;
  recipientConfirmed?: boolean;
  consentedToAiReview: boolean;
}) {
  const assignment = await VolunteerAssignment.findOne({
    _id: input.assignmentId,
    volunteerId: input.volunteerId,
    status: { $in: ["in_progress", "more_evidence_required", "rejected_with_reason"] },
  });
  if (!assignment) return null;
  const request = await HelpRequest.findOne({
    _id: assignment.requestId,
    assignedVolunteerId: input.volunteerId,
    assignedOrganizationId: assignment.ngoId,
    status: { $in: ["in_progress", "more_evidence_required"] },
  });
  if (!request) return null;
  const previousProof = await CompletionProof.findOne({ assignmentId: assignment._id }).sort({ submittedAt: -1 });
  const previousEvidenceIds = new Set((previousProof?.evidenceIds ?? []).map((id: mongoose.Types.ObjectId) => id.toString()));
  const evidence = await AssignmentEvidence.find({ assignmentId: assignment._id, uploadedBy: input.volunteerId }).sort({ createdAt: 1 });
  const newEvidence = previousProof
    ? evidence.filter((item) => !previousEvidenceIds.has(item._id.toString()))
    : evidence;
  if (!newEvidence.length) {
    return {
      error: previousProof
        ? "Upload at least one new completion evidence file since the previous submission."
        : "Upload at least one completion photo or document before submitting.",
    } as const;
  }
  const priorAssignmentStatus = assignment.status;
  const priorRequestStatus = request.status;
  const priorSubmittedAt = assignment.submittedAt;
  const now = new Date();
  const submitted = await VolunteerAssignment.findOneAndUpdate(
    { _id: assignment._id, volunteerId: input.volunteerId, status: priorAssignmentStatus },
    {
      $set: { status: "submitted_for_review", submittedAt: now },
      $push: { history: { status: "submitted_for_review", actorId: input.volunteerId, occurredAt: now } },
    },
    { new: true },
  );
  if (!submitted) return null;
  const updatedRequest = await HelpRequest.findOneAndUpdate(
    { _id: request._id, assignedVolunteerId: input.volunteerId, assignedOrganizationId: assignment.ngoId, status: priorRequestStatus },
    {
      $set: { status: "pending_completion_review" },
      $push: { timeline: { status: "pending_completion_review", actorId: input.volunteerId, reason: "Volunteer submitted completion evidence for NGO review.", occurredAt: now } },
    },
    { new: true },
  );
  if (!updatedRequest) {
    const restored = await VolunteerAssignment.findOneAndUpdate(
      { _id: submitted._id, volunteerId: input.volunteerId, status: "submitted_for_review" },
      {
        $set: { status: priorAssignmentStatus, ...(priorSubmittedAt ? { submittedAt: priorSubmittedAt } : {}) },
        ...(!priorSubmittedAt ? { $unset: { submittedAt: 1 } } : {}),
        $push: { history: { status: priorAssignmentStatus, actorId: input.volunteerId, reason: "Evidence submission conflicted; task remains available for correction.", occurredAt: new Date() } },
      },
    );
    if (!restored) throw new Error("Completion submission conflicted and could not be safely rolled back.");
    return null;
  }
  let proof: HydratedDocument<CompletionProofDocument>;
  try {
    proof = await CompletionProof.create({
      requestId: request._id,
      assignmentId: submitted._id,
      submittedBy: input.volunteerId,
      privateObjectKeys: newEvidence.map((item) => item.privateObjectKey),
      evidenceIds: newEvidence.map((item) => item._id),
      summary: input.summary,
      report: input.report,
      status: "submitted",
      completedAt: input.completedAt,
      ...(input.unresolvedIssues ? { unresolvedIssues: input.unresolvedIssues } : {}),
      ...(input.recipientConfirmed === undefined ? {} : { recipientConfirmed: input.recipientConfirmed }),
      consentedToAiReview: input.consentedToAiReview,
      reviewHistory: [{ status: "submitted", actorId: input.volunteerId, occurredAt: now }],
      submittedAt: now,
    });
  } catch (error) {
    const restoredRequest = await HelpRequest.findOneAndUpdate(
      { _id: request._id, assignedVolunteerId: input.volunteerId, status: "pending_completion_review" },
      {
        $set: { status: priorRequestStatus },
        $push: { timeline: { status: priorRequestStatus, actorId: input.volunteerId, reason: "Completion proof could not be stored; task remains available for correction.", occurredAt: new Date() } },
      },
    );
    const restoredAssignment = await VolunteerAssignment.findOneAndUpdate(
      { _id: submitted._id, volunteerId: input.volunteerId, status: "submitted_for_review" },
      {
        $set: { status: priorAssignmentStatus, ...(priorSubmittedAt ? { submittedAt: priorSubmittedAt } : {}) },
        ...(!priorSubmittedAt ? { $unset: { submittedAt: 1 } } : {}),
        $push: { history: { status: priorAssignmentStatus, actorId: input.volunteerId, reason: "Completion proof could not be stored; task remains available for correction.", occurredAt: new Date() } },
      },
    );
    if (!restoredRequest || !restoredAssignment) throw new Error("Completion proof storage failed and workflow rollback was incomplete.");
    throw error;
  }
  const aiReview = input.consentedToAiReview
    ? await assessCompletionEvidence({
      category: request.category,
      taskDescription: request.description,
      summary: input.summary,
      report: input.report,
      ...(input.unresolvedIssues ? { unresolvedIssues: input.unresolvedIssues } : {}),
      completedAt: input.completedAt.toISOString(),
      requiredEvidenceChecklist: request.completionEvidenceChecklist ?? [],
      evidence: await Promise.all(newEvidence.map(async (item) => {
        const ocr = await extractRequestText(item.privateObjectKey, item.contentType);
        return {
          contentType: item.contentType,
          ocrStatus: ocr.status,
          ...(ocr.status === "completed" ? { ocrText: ocr.text } : {}),
        };
      })),
    })
    : {
      recommendation: "manual_review_required" as const,
      findings: [],
      missingEvidence: [],
      uncertainty: "Automated review was not authorized for this submission. Human NGO review is still required.",
      provider: "not_requested",
      assessedAt: new Date(),
    };
  const assessmentUpdate = await CompletionProof.findOneAndUpdate(
    { _id: proof._id, status: "submitted" },
    { $set: { aiReview } },
    { new: true },
  );
  if (!assessmentUpdate) throw new Error("Completion evidence was submitted but its review assessment could not be saved.");
  await recordAuditEvent({
    actorId: input.volunteerId,
    action: "volunteer_assignment.submitted_for_review",
    resourceType: "volunteer_assignment",
    resourceId: submitted._id.toString(),
    previousStatus: priorAssignmentStatus,
    newStatus: "submitted_for_review",
  });
  await notifyAssignmentParties({
    requestId: updatedRequest._id.toString(),
    assignmentId: submitted._id.toString(),
    requesterId: updatedRequest.requesterId,
    ngoId: assignment.ngoId,
    status: "submitted_for_review",
    volunteerId: assignment.volunteerId,
  });
  return { assignment: submitted, proof: assessmentUpdate };
}
