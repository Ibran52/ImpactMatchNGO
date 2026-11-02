import mongoose from "mongoose";
import {
  AssignmentEvidence,
  CompletionProof,
  HelpRequest,
  Notification,
  User,
  VolunteerAssignment,
} from "../models.js";
import { recordAuditEvent } from "./auditService.js";
import { releaseCompletedVolunteerSlot } from "./volunteerAssignmentService.js";

export type CompletionReviewAction = "approve" | "more_evidence_required" | "reject" | "flag_manual";

const reviewTargets: Record<CompletionReviewAction, {
  proofStatus: "approved" | "more_evidence_required" | "rejected" | "flagged_for_manual_review";
  assignmentStatus: "completed" | "more_evidence_required" | "rejected_with_reason" | "flagged_for_manual_review";
  requestStatus: "completed" | "more_evidence_required" | "in_progress" | "flagged_for_review";
  notificationStatus: string;
}> = {
  approve: {
    proofStatus: "approved",
    assignmentStatus: "completed",
    requestStatus: "completed",
    notificationStatus: "completed",
  },
  more_evidence_required: {
    proofStatus: "more_evidence_required",
    assignmentStatus: "more_evidence_required",
    requestStatus: "more_evidence_required",
    notificationStatus: "more_evidence_required",
  },
  reject: {
    proofStatus: "rejected",
    assignmentStatus: "rejected_with_reason",
    requestStatus: "in_progress",
    notificationStatus: "rejected",
  },
  flag_manual: {
    proofStatus: "flagged_for_manual_review",
    assignmentStatus: "flagged_for_manual_review",
    requestStatus: "flagged_for_review",
    notificationStatus: "flagged_for_manual_review",
  },
};

async function notifyReviewParties(input: {
  requestId: mongoose.Types.ObjectId;
  assignmentId: mongoose.Types.ObjectId;
  proofId: mongoose.Types.ObjectId;
  requesterId: mongoose.Types.ObjectId;
  volunteerId: mongoose.Types.ObjectId;
  ngoId: mongoose.Types.ObjectId;
  status: string;
}): Promise<void> {
  const recipients = [
    { recipientId: input.requesterId, type: "help_request_completion_updated" },
    { recipientId: input.volunteerId, type: "volunteer_completion_updated" },
    { recipientId: input.ngoId, type: "ngo_completion_updated" },
  ];
  const admins = input.status === "flagged_for_manual_review"
    ? await User.find({ role: "admin", accountStatus: "active" }).select("_id")
    : [];
  const allRecipients = [
    ...recipients,
    ...admins.map((admin) => ({ recipientId: admin._id, type: "admin_completion_review_required" })),
  ];
  await Promise.all(allRecipients.map((recipient, index) => {
    const audience = index === 0 ? "requester" : index === 1 ? "volunteer" : index === 2 ? "ngo" : `admin-${recipient.recipientId.toString()}`;
    const idempotencyKey = `completion:${input.proofId}:${input.status}:${audience}`;
    return Notification.updateOne(
      { recipientId: recipient.recipientId, idempotencyKey },
      {
        $setOnInsert: {
          recipientId: recipient.recipientId,
          type: recipient.type,
          idempotencyKey,
          payload: { requestId: input.requestId.toString(), assignmentId: input.assignmentId.toString(), status: input.status },
          status: "sent",
        },
      },
      { upsert: true },
    );
  }));
}

export async function reviewCompletionProof(input: {
  assignmentId: string;
  organizationId: string;
  actorId: string;
  action: CompletionReviewAction;
  reason: string;
  resolveOutstandingIssues?: boolean;
}) {
  const assignment = await VolunteerAssignment.findOne({
    _id: input.assignmentId,
    ngoId: input.organizationId,
    status: "submitted_for_review",
  });
  if (!assignment) return { error: "This assignment is not awaiting review by your organization." } as const;
  const request = await HelpRequest.findOne({
    _id: assignment.requestId,
    assignedOrganizationId: input.organizationId,
    assignedVolunteerId: assignment.volunteerId,
    status: "pending_completion_review",
  });
  const proof = request
    ? await CompletionProof.findOne({
      assignmentId: assignment._id,
      requestId: request._id,
      submittedBy: assignment.volunteerId,
      status: "submitted",
    }).sort({ submittedAt: -1 })
    : null;
  if (!request || !proof) return { error: "The submitted proof is no longer available for review." } as const;
  if (input.action === "approve" && proof.unresolvedIssues?.trim() && input.resolveOutstandingIssues !== true) {
    return { error: "The volunteer reported unresolved follow-up. Confirm it has been resolved before approving closure." } as const;
  }
  const validEvidenceCount = proof.evidenceIds?.length
    ? await AssignmentEvidence.countDocuments({
      _id: { $in: proof.evidenceIds },
      requestId: request._id,
      assignmentId: assignment._id,
      uploadedBy: assignment.volunteerId,
    })
    : await AssignmentEvidence.countDocuments({
      privateObjectKey: { $in: proof.privateObjectKeys },
      assignmentId: assignment._id,
      uploadedBy: assignment.volunteerId,
    });
  if (validEvidenceCount === 0) return { error: "The proof has no associated private evidence and cannot be reviewed." } as const;

  const target = reviewTargets[input.action];
  const now = new Date();
  const proofUpdate: Record<string, unknown> = {
    status: target.proofStatus,
    reviewedBy: input.actorId,
    reviewedAt: now,
  };
  if (input.action === "approve" && proof.unresolvedIssues?.trim()) {
    proofUpdate.issuesResolvedBy = input.actorId;
    proofUpdate.issuesResolvedAt = now;
    proofUpdate.issueResolutionReason = input.reason;
  }
  const reviewedProof = await CompletionProof.findOneAndUpdate(
    { _id: proof._id, assignmentId: assignment._id, requestId: request._id, status: "submitted" },
    {
      $set: proofUpdate,
      $push: { reviewHistory: { status: target.proofStatus, actorId: input.actorId, reason: input.reason, occurredAt: now } },
    },
    { new: true },
  );
  if (!reviewedProof) return { error: "Another reviewer already changed this submission." } as const;

  const updatedAssignment = await VolunteerAssignment.findOneAndUpdate(
    { _id: assignment._id, ngoId: input.organizationId, status: "submitted_for_review" },
    {
      $set: { status: target.assignmentStatus, ...(input.action === "approve" ? { completedAt: now } : {}) },
      $push: { history: { status: target.assignmentStatus, actorId: input.actorId, reason: input.reason, occurredAt: now } },
    },
    { new: true },
  );
  if (!updatedAssignment) {
    const restoredProof = await CompletionProof.findOneAndUpdate(
      { _id: reviewedProof._id, status: target.proofStatus, reviewedBy: input.actorId },
      {
        $set: { status: "submitted" },
        $unset: { reviewedAt: 1, reviewedBy: 1, issuesResolvedAt: 1, issuesResolvedBy: 1, issueResolutionReason: 1 },
        $push: { reviewHistory: { status: "submitted", actorId: input.actorId, reason: "Decision could not be applied because the assignment changed.", occurredAt: new Date() } },
      },
    );
    if (!restoredProof) throw new Error("Review conflict occurred and the proof state could not be restored.");
    return { error: "The assignment changed before this review could be saved." } as const;
  }

  const updatedRequest = await HelpRequest.findOneAndUpdate(
    {
      _id: request._id,
      assignedOrganizationId: input.organizationId,
      assignedVolunteerId: assignment.volunteerId,
      status: "pending_completion_review",
    },
    {
      $set: { status: target.requestStatus, ...(input.action === "approve" ? { completedAt: now } : {}) },
      $push: { timeline: { status: target.requestStatus, actorId: input.actorId, reason: input.reason, occurredAt: now } },
    },
    { new: true },
  );
  if (!updatedRequest) {
    const restoredAssignment = await VolunteerAssignment.findOneAndUpdate(
      { _id: updatedAssignment._id, status: target.assignmentStatus, ngoId: input.organizationId },
      {
        $set: { status: "submitted_for_review" },
        $unset: { completedAt: 1 },
        $push: { history: { status: "submitted_for_review", actorId: input.actorId, reason: "Request changed before review could be applied.", occurredAt: new Date() } },
      },
    );
    const restoredProof = await CompletionProof.findOneAndUpdate(
      { _id: reviewedProof._id, status: target.proofStatus, reviewedBy: input.actorId },
      {
        $set: { status: "submitted" },
        $unset: { reviewedAt: 1, reviewedBy: 1, issuesResolvedAt: 1, issuesResolvedBy: 1, issueResolutionReason: 1 },
        $push: { reviewHistory: { status: "submitted", actorId: input.actorId, reason: "Request changed before review could be applied.", occurredAt: new Date() } },
      },
    );
    if (!restoredAssignment || !restoredProof) throw new Error("Review conflict occurred and workflow rollback was incomplete.");
    return { error: "The request changed before this review could be saved." } as const;
  }

  if (input.action === "approve") await releaseCompletedVolunteerSlot(assignment.volunteerId);
  await recordAuditEvent({
    actorId: input.actorId,
    action: `completion_proof.${input.action}`,
    resourceType: "completion_proof",
    resourceId: proof._id.toString(),
    previousStatus: "submitted",
    newStatus: target.proofStatus,
    reason: input.reason,
  });
  await notifyReviewParties({
    requestId: updatedRequest._id,
    assignmentId: assignment._id,
    proofId: proof._id,
    requesterId: updatedRequest.requesterId,
    volunteerId: assignment.volunteerId,
    ngoId: new mongoose.Types.ObjectId(input.organizationId),
    status: target.notificationStatus,
  });
  return {
    proof: { id: reviewedProof._id.toString(), status: reviewedProof.status, reviewedAt: now.toISOString() },
    assignment: { id: updatedAssignment._id.toString(), status: updatedAssignment.status },
    request: { id: updatedRequest._id.toString(), status: updatedRequest.status },
  } as const;
}

export async function returnFlaggedProofToNgo(input: { assignmentId: string; actorId: string; reason: string }) {
  const assignment = await VolunteerAssignment.findOne({ _id: input.assignmentId, status: "flagged_for_manual_review" });
  if (!assignment) return { error: "This assignment is not awaiting manual review." } as const;
  const request = await HelpRequest.findOne({
    _id: assignment.requestId,
    assignedOrganizationId: assignment.ngoId,
    assignedVolunteerId: assignment.volunteerId,
    status: "flagged_for_review",
  });
  const proof = request
    ? await CompletionProof.findOne({ assignmentId: assignment._id, requestId: request._id, status: "flagged_for_manual_review" }).sort({ submittedAt: -1 })
    : null;
  if (!request || !proof) return { error: "The flagged proof is no longer available." } as const;
  const now = new Date();
  const returnedProof = await CompletionProof.findOneAndUpdate(
    { _id: proof._id, status: "flagged_for_manual_review" },
    {
      $set: { status: "submitted" },
      $unset: { reviewedBy: 1, reviewedAt: 1 },
      $push: { reviewHistory: { status: "submitted", actorId: input.actorId, reason: input.reason, occurredAt: now } },
    },
    { new: true },
  );
  if (!returnedProof) return { error: "Another administrator already changed this proof." } as const;
  const returnedAssignment = await VolunteerAssignment.findOneAndUpdate(
    { _id: assignment._id, status: "flagged_for_manual_review" },
    {
      $set: { status: "submitted_for_review" },
      $push: { history: { status: "submitted_for_review", actorId: input.actorId, reason: input.reason, occurredAt: now } },
    },
    { new: true },
  );
  if (!returnedAssignment) {
    const restoredProof = await CompletionProof.findOneAndUpdate(
      { _id: returnedProof._id, status: "submitted" },
      {
        $set: { status: "flagged_for_manual_review" },
        $push: { reviewHistory: { status: "flagged_for_manual_review", actorId: input.actorId, reason: "Manual review transition conflicted; proof remains flagged.", occurredAt: new Date() } },
      },
    );
    if (!restoredProof) throw new Error("Manual review conflicted and proof state could not be restored.");
    return { error: "The assignment changed before it could return to NGO review." } as const;
  }
  const returnedRequest = await HelpRequest.findOneAndUpdate(
    { _id: request._id, status: "flagged_for_review", assignedOrganizationId: assignment.ngoId },
    {
      $set: { status: "pending_completion_review" },
      $push: { timeline: { status: "pending_completion_review", actorId: input.actorId, reason: input.reason, occurredAt: now } },
    },
    { new: true },
  );
  if (!returnedRequest) {
    const restoredAssignment = await VolunteerAssignment.findOneAndUpdate(
      { _id: returnedAssignment._id, status: "submitted_for_review" },
      {
        $set: { status: "flagged_for_manual_review" },
        $push: { history: { status: "flagged_for_manual_review", actorId: input.actorId, reason: "Request changed; assignment remains flagged.", occurredAt: new Date() } },
      },
    );
    const restoredProof = await CompletionProof.findOneAndUpdate(
      { _id: returnedProof._id, status: "submitted" },
      {
        $set: { status: "flagged_for_manual_review" },
        $push: { reviewHistory: { status: "flagged_for_manual_review", actorId: input.actorId, reason: "Request changed; proof remains flagged.", occurredAt: new Date() } },
      },
    );
    if (!restoredAssignment || !restoredProof) throw new Error("Manual review transition conflicted and workflow rollback was incomplete.");
    return { error: "The request changed before it could return to NGO review." } as const;
  }
  await recordAuditEvent({
    actorId: input.actorId,
    action: "completion_proof.manual_review_cleared",
    resourceType: "completion_proof",
    resourceId: proof._id.toString(),
    previousStatus: "flagged_for_manual_review",
    newStatus: "submitted",
    reason: input.reason,
  });
  await notifyReviewParties({
    requestId: returnedRequest._id,
    assignmentId: assignment._id,
    proofId: proof._id,
    requesterId: returnedRequest.requesterId,
    volunteerId: assignment.volunteerId,
    ngoId: assignment.ngoId,
    status: "manual_review_cleared",
  });
  return {
    proof: { id: returnedProof._id.toString(), status: returnedProof.status },
    assignment: { id: returnedAssignment._id.toString(), status: returnedAssignment.status },
    request: { id: returnedRequest._id.toString(), status: returnedRequest.status },
  } as const;
}
