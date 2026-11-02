import type { Types } from "mongoose";

export type Role = "user" | "volunteer" | "donor" | "ngo" | "admin";
export type OrganizationStatus = "draft" | "pending_review" | "verified" | "rejected" | "resubmission_required" | "pending";
export type VolunteerEligibility = "pending" | "under_review" | "eligible" | "rejected" | "more_information_required" | "suspended";
export type VerificationDocumentKind = "volunteer_identity" | "ngo_registration" | "ngo_address" | "ngo_authority" | "ngo_additional";
export type NeedKind = "volunteer" | "donation";
export type NeedStatus = "open" | "closed";
export type NeedUrgency = "low" | "medium" | "high";
export type ContributionKind = NeedKind;
export type ContributionStatus =
  | "creating"
  | "pending"
  | "settling"
  | "completed"
  | "failed"
  | "expired"
  | "refund_required";

export type AssignmentStatus =
  | "offered"
  | "accepted"
  | "in_progress"
  | "submitted_for_review"
  | "more_evidence_required"
  | "rejected_with_reason"
  | "flagged_for_manual_review"
  | "completed"
  | "declined"
  | "expired"
  | "cancelled"
  | "reassigned"
  | "disputed";
export type HelpRequestStatus =
  | "submitted"
  | "draft"
  | "screening"
  | "pending_ngo_review"
  | "needs_information"
  | "flagged_for_review"
  | "under_review"
  | "approved"
  | "matching_volunteer"
  | "assigned"
  | "matched"
  | "in_progress"
  | "pending_completion_review"
  | "more_evidence_required"
  | "completed"
  | "rejected"
  | "cancelled"
  | "withdrawn";
export type HelpRequestCategory =
  | "food"
  | "clothing"
  | "shelter"
  | "medical_assistance"
  | "education"
  | "emergency_support"
  | "other";
export type PreferredContactMethod = "phone" | "email" | "in_app";
export type ItemDonationStatus =
  | "submitted"
  | "pending_ngo_review"
  | "accepted"
  | "rejected"
  | "needs_information"
  | "awaiting_pickup_assignment"
  | "pickup_assigned"
  | "pickup_in_progress"
  | "picked_up"
  | "delivered_or_received"
  | "completed"
  | "pickup_failed"
  | "disputed"
  | "cancelled";
export type ItemPickupStatus =
  | "offered"
  | "accepted"
  | "in_progress"
  | "submitted_for_review"
  | "completed"
  | "declined"
  | "expired"
  | "cancelled"
  | "reassigned"
  | "disputed";
export type CompletionProofStatus =
  | "submitted"
  | "approved"
  | "rejected"
  | "more_evidence_required"
  | "flagged_for_manual_review";
export type RequestDocumentStatus = "pending_scan" | "available" | "rejected";
export type RequestOcrStatus = "pending" | "completed" | "unavailable" | "failed" | "unsupported";
export type RequestScreeningStatus = "pending" | "review_recommended" | "needs_information" | "clear_for_human_review" | "unavailable";
export type NotificationStatus = "pending" | "sent" | "failed";

export type SafeUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
  city: string;
  organizationStatus?: OrganizationStatus;
  volunteerEligibility?: VolunteerEligibility;
  description?: string;
  categories?: string[];
  skills?: string[];
  interests?: string[];
  languages?: string[];
  volunteerAvailability?: string;
  phone?: string;
  website?: string;
  registrationNumber?: string;
  registrationType?: string;
  officialEmail?: string;
  officialPhone?: string;
  addressLine?: string;
  state?: string;
  postalCode?: string;
  serviceArea?: string;
  representativeName?: string;
  representativeDesignation?: string;
  issuingAuthority?: string;
  establishedDate?: string;
  verificationReason?: string;
};

export type NgoProfile = {
  userId: Types.ObjectId;
  status: OrganizationStatus;
  categories: string[];
  registrationNumber?: string;
  verificationReviewedBy?: Types.ObjectId;
  verificationReviewedAt?: Date;
};

export type HelpRequestContract = {
  requesterId: Types.ObjectId;
  status: HelpRequestStatus;
  title: string;
  category: HelpRequestCategory;
  description: string;
  urgency: NeedUrgency;
  peopleCount: number;
  city: string;
  addressLine?: string;
  location?: { type: "Point"; coordinates: [number, number] };
  preferredContactMethod: PreferredContactMethod;
  consentToProcess: boolean;
  attachmentCount: number;
  completionEvidenceChecklist?: string[];
  screeningStatus: RequestScreeningStatus;
  screening?: {
    reasons: string[];
    missingFields: string[];
    additionalInformation: string[];
    confidence?: number;
    provider: string;
    model?: string;
    assessedAt: Date;
  };
  timeline: Array<{
    status: HelpRequestStatus;
    actorId: Types.ObjectId;
    reason?: string;
    occurredAt: Date;
  }>;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
};

export type NgoAssistanceNeedContract = {
  organizationId: Types.ObjectId;
  kind: NeedKind;
  status: NeedStatus;
  title: string;
  category: string;
  city: string;
};

export type MoneyContributionContract = {
  userId: Types.ObjectId;
  needId: Types.ObjectId;
  kind: "donation";
  amount: number;
  currency: "INR";
  status: ContributionStatus;
  orderId?: string;
  paymentId?: string;
};

export type VolunteerAssignmentContract = {
  requestId: Types.ObjectId;
  volunteerId: Types.ObjectId;
  ngoId: Types.ObjectId;
  status: AssignmentStatus;
  offerExpiresAt: Date;
  acceptedAt?: Date;
  startedAt?: Date;
  submittedAt?: Date;
  progressNote?: string;
  history: Array<{
    status: AssignmentStatus;
    actorId: Types.ObjectId;
    reason?: string;
    occurredAt: Date;
  }>;
  privateDetailsDisclosedAt?: Date;
};

export type CompletionProofContract = {
  requestId: Types.ObjectId;
  assignmentId: Types.ObjectId;
  submittedBy: Types.ObjectId;
  privateObjectKeys: string[];
  evidenceIds: Types.ObjectId[];
  summary: string;
  status: CompletionProofStatus;
  report: string;
  completedAt: Date;
  unresolvedIssues?: string;
  recipientConfirmed?: boolean;
  consentedToAiReview: boolean;
  aiReview?: {
    recommendation: "ready_for_ngo_review" | "additional_evidence_recommended" | "manual_review_required" | "provider_unavailable";
    findings: string[];
    missingEvidence: string[];
    uncertainty: string;
    confidence?: number;
    provider: string;
    model?: string;
    assessedAt: Date;
  };
  reviewHistory: Array<{
    status: CompletionProofStatus;
    actorId: Types.ObjectId;
    reason?: string;
    occurredAt: Date;
  }>;
  submittedAt: Date;
  reviewedAt?: Date;
  reviewedBy?: Types.ObjectId;
};

export type PhysicalItemDonationContract = {
  donorId: Types.ObjectId;
  ngoId: Types.ObjectId;
  status: ItemDonationStatus;
  category: string;
  description: string;
  quantity: number;
  condition: "new" | "like_new" | "good" | "fair";
  pickupAddress: string;
  city: string;
  pickupWindowStart: Date;
  pickupWindowEnd: Date;
  preferredContactMethod: PreferredContactMethod;
  consentToSharePickupDetails: boolean;
  timeline: Array<{ status: ItemDonationStatus; actorId: Types.ObjectId; reason?: string; occurredAt: Date }>;
};

export type NotificationContract = {
  recipientId: Types.ObjectId;
  type: string;
  idempotencyKey: string;
  status: NotificationStatus;
  readAt?: Date;
  createdAt: Date;
};

export type AuditLogContract = {
  actorId: Types.ObjectId;
  action: string;
  resourceType: string;
  resourceId: string;
  occurredAt: Date;
};
