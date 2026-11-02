import mongoose, { Schema } from "mongoose";
import type { HydratedDocument } from "mongoose";
import type {
  CompletionProofStatus,
  ContributionKind,
  ContributionStatus,
  HelpRequestContract,
  ItemDonationStatus,
  ItemPickupStatus,
  NeedKind,
  NeedStatus,
  NeedUrgency,
  NotificationStatus,
  OrganizationStatus,
  RequestDocumentStatus,
  RequestOcrStatus,
  Role,
  AssignmentStatus,
  VolunteerEligibility,
  VerificationDocumentKind,
} from "./types/domain.js";

export type UserDocument = {
  _id: mongoose.Types.ObjectId;
  name: string;
  email: string;
  passwordHash: string;
  role: Role;
  city: string;
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
  establishedDate?: Date;
  ngoLocation?: { type: "Point"; coordinates: [number, number] };
  acceptingRequests?: boolean;
  requestCapacity?: number;
  activeHelpRequestCount?: number;
  accountStatus: "active" | "suspended";
  volunteerEligibility: VolunteerEligibility;
  volunteerTaskOptIn: boolean;
  volunteerLocation?: { type: "Point"; coordinates: [number, number] };
  volunteerServiceArea?: string;
  volunteerServiceRadiusKm?: number;
  verificationDocumentCount?: number;
  maxActiveAssignments?: number;
  activeVolunteerAssignmentCount?: number;
  organizationStatus?: OrganizationStatus;
  verificationReason?: string;
  verificationReviewedBy?: mongoose.Types.ObjectId;
  verificationReviewedAt?: Date;
  verificationHistory: Array<{
    status: string;
    actorId: mongoose.Types.ObjectId;
    reason?: string;
    occurredAt: Date;
  }>;
  createdAt: Date;
  updatedAt: Date;
};

export type OrganizationDocument = Pick<
  UserDocument,
  "_id" | "name" | "city" | "description" | "categories" | "organizationStatus" |
  "serviceArea" | "ngoLocation" | "acceptingRequests" | "requestCapacity" | "activeHelpRequestCount"
>;

export type OrganizationSummaryDocument = Pick<UserDocument, "_id" | "name" | "organizationStatus"> & Partial<Pick<UserDocument, "accountStatus">>;

export type VolunteerUserDocument = Pick<UserDocument, "_id" | "name" | "city">;

const userSchema = new Schema<UserDocument>({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: ["user", "volunteer", "donor", "ngo", "admin"], required: true },
  city: { type: String, required: true, trim: true, maxlength: 100 },
  description: { type: String, trim: true, maxlength: 1000 },
  categories: { type: [String], default: [] },
  skills: { type: [String], default: [] },
  interests: { type: [String], default: [] },
  languages: { type: [String], default: [] },
  volunteerAvailability: { type: String, trim: true, maxlength: 300 },
  phone: { type: String, trim: true, maxlength: 30 },
  website: { type: String, trim: true, maxlength: 200 },
  registrationNumber: { type: String, trim: true, maxlength: 100 },
  registrationType: { type: String, trim: true, maxlength: 100 },
  officialEmail: { type: String, lowercase: true, trim: true, maxlength: 254 },
  officialPhone: { type: String, trim: true, maxlength: 30 },
  addressLine: { type: String, trim: true, maxlength: 300 },
  state: { type: String, trim: true, maxlength: 100 },
  postalCode: { type: String, trim: true, maxlength: 20 },
  serviceArea: { type: String, trim: true, maxlength: 500 },
  representativeName: { type: String, trim: true, maxlength: 100 },
  representativeDesignation: { type: String, trim: true, maxlength: 100 },
  issuingAuthority: { type: String, trim: true, maxlength: 150 },
  establishedDate: { type: Date },
  ngoLocation: {
    type: { type: String, enum: ["Point"] },
    coordinates: {
      type: [Number],
      validate: {
        validator: (value: number[]) => value.length === 2 && Number.isFinite(value[0]) && Number.isFinite(value[1]) &&
          Math.abs(value[0]) <= 180 && Math.abs(value[1]) <= 90,
        message: "NGO coordinates must be valid [longitude, latitude] values.",
      },
    },
  },
  acceptingRequests: { type: Boolean, default: true },
  requestCapacity: { type: Number, min: 1, max: 10000 },
  activeHelpRequestCount: { type: Number, min: 0, default: 0 },
  organizationStatus: { type: String, enum: ["draft", "pending_review", "verified", "rejected", "resubmission_required", "pending"] },
  verificationReason: { type: String, trim: true, maxlength: 1000 },
  verificationReviewedBy: { type: Schema.Types.ObjectId, ref: "User" },
  verificationReviewedAt: { type: Date },
  verificationHistory: [{
    status: { type: String, required: true, maxlength: 40 },
    actorId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    reason: { type: String, maxlength: 1000 },
    occurredAt: { type: Date, required: true, default: Date.now },
  }],
  accountStatus: { type: String, enum: ["active", "suspended"], default: "active", index: true },
  volunteerEligibility: { type: String, enum: ["pending", "under_review", "eligible", "rejected", "more_information_required", "suspended"], default: "pending", index: true },
  volunteerTaskOptIn: { type: Boolean, default: false, index: true },
  volunteerLocation: {
    type: { type: String, enum: ["Point"] },
    coordinates: {
      type: [Number],
      validate: {
        validator: (value: number[]) => value.length === 2 && Number.isFinite(value[0]) && Number.isFinite(value[1]) &&
          Math.abs(value[0]) <= 180 && Math.abs(value[1]) <= 90,
        message: "Volunteer coordinates must be valid [longitude, latitude] values.",
      },
    },
  },
  volunteerServiceArea: { type: String, trim: true, maxlength: 500 },
  volunteerServiceRadiusKm: { type: Number, min: 1, max: 500, default: 30 },
  verificationDocumentCount: { type: Number, min: 0, default: 0 },
  maxActiveAssignments: { type: Number, min: 1, max: 20, default: 3 },
  activeVolunteerAssignmentCount: { type: Number, min: 0, default: 0 },
}, { timestamps: true });
userSchema.index({ ngoLocation: "2dsphere" });
userSchema.index({ volunteerLocation: "2dsphere" });

export type PaymentReservationDocument = {
  _id?: mongoose.Types.ObjectId;
  token: string;
  amount: number;
  expiresAt: Date;
  settlementPaymentId?: string;
};

const paymentReservationSchema = new Schema<PaymentReservationDocument>({
  token: { type: String, required: true },
  amount: { type: Number, required: true, min: 1 },
  expiresAt: { type: Date, required: true },
  settlementPaymentId: { type: String },
});

export type NeedDocument = {
  _id: mongoose.Types.ObjectId;
  title: string;
  description: string;
  kind: NeedKind;
  category: string;
  city: string;
  organizationId: mongoose.Types.ObjectId;
  status: NeedStatus;
  urgency: NeedUrgency;
  targetAmount?: number;
  raisedAmount: number;
  reservedAmount: number;
  paymentReservations: PaymentReservationDocument[];
  volunteersNeeded: number;
  volunteersJoined: number;
  createdAt: Date;
  updatedAt: Date;
};

export type PopulatedNeedDocument = Omit<NeedDocument, "organizationId"> & {
  organizationId: OrganizationSummaryDocument;
};

const needSchema = new Schema<NeedDocument>({
  title: { type: String, required: true, trim: true, maxlength: 100 },
  description: { type: String, required: true, trim: true, maxlength: 1000 },
  kind: { type: String, enum: ["volunteer", "donation"], required: true },
  category: { type: String, required: true, trim: true, maxlength: 60 },
  city: { type: String, required: true, trim: true, maxlength: 100 },
  organizationId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  status: { type: String, enum: ["open", "closed"], default: "open", index: true },
  urgency: { type: String, enum: ["low", "medium", "high"], default: "medium" },
  targetAmount: { type: Number, min: 1 },
  raisedAmount: { type: Number, min: 0, default: 0 },
  reservedAmount: { type: Number, min: 0, default: 0 },
  paymentReservations: { type: [paymentReservationSchema], default: [] },
  volunteersNeeded: { type: Number, min: 1, max: 500, default: 1 },
  volunteersJoined: { type: Number, min: 0, default: 0 },
}, { timestamps: true });
needSchema.index({ "paymentReservations.expiresAt": 1 });

export type ContributionDocument = {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  needId: mongoose.Types.ObjectId;
  kind: ContributionKind;
  amount: number;
  currency?: "INR";
  hours: number;
  status: ContributionStatus;
  orderId?: string;
  paymentId?: string;
  receiptReference?: string;
  reservationToken?: string;
  reservationExpiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
};

export type VolunteerApplicationDocument = Omit<ContributionDocument, "userId"> & {
  userId: VolunteerUserDocument;
};

export type ContributionRecord = HydratedDocument<ContributionDocument>;

export type HelpRequestDocument = HelpRequestContract & {
  _id: mongoose.Types.ObjectId;
  assignedOrganizationId?: mongoose.Types.ObjectId;
  assignedVolunteerId?: mongoose.Types.ObjectId;
  volunteerDeadlineAt?: Date;
};

const requestScreeningSchema = new Schema<NonNullable<HelpRequestDocument["screening"]>>({
  reasons: { type: [String], default: [] },
  missingFields: { type: [String], default: [] },
  additionalInformation: { type: [String], default: [] },
  confidence: { type: Number, min: 0, max: 1 },
  provider: { type: String, required: true },
  model: { type: String },
  assessedAt: { type: Date, required: true },
}, { _id: false });

const helpRequestSchema = new Schema<HelpRequestDocument>({
  requesterId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  assignedOrganizationId: { type: Schema.Types.ObjectId, ref: "User", index: true },
  assignedVolunteerId: { type: Schema.Types.ObjectId, ref: "User", index: true },
  volunteerDeadlineAt: { type: Date },
  completedAt: { type: Date },
  status: { type: String, enum: ["draft", "submitted", "screening", "pending_ngo_review", "needs_information", "flagged_for_review", "under_review", "approved", "matching_volunteer", "assigned", "matched", "in_progress", "pending_completion_review", "more_evidence_required", "completed", "rejected", "cancelled", "withdrawn"], default: "submitted", index: true },
  title: { type: String, required: true, trim: true, maxlength: 120 },
  category: { type: String, enum: ["food", "clothing", "shelter", "medical_assistance", "education", "emergency_support", "other"], required: true },
  description: { type: String, required: true, trim: true, maxlength: 3000 },
  urgency: { type: String, enum: ["low", "medium", "high"], required: true },
  peopleCount: { type: Number, required: true, min: 1, max: 100 },
  city: { type: String, required: true, trim: true, maxlength: 100, index: true },
  addressLine: { type: String, trim: true, maxlength: 300 },
  location: {
    type: { type: String, enum: ["Point"] },
    coordinates: {
      type: [Number],
      validate: {
        validator: (value: number[]) => value.length === 2 && Number.isFinite(value[0]) && Number.isFinite(value[1]) &&
          Math.abs(value[0]) <= 180 && Math.abs(value[1]) <= 90,
        message: "Coordinates must be valid [longitude, latitude] values.",
      },
    },
  },
  preferredContactMethod: { type: String, enum: ["phone", "email", "in_app"], required: true },
  consentToProcess: { type: Boolean, required: true, validate: { validator: (value: boolean) => value === true, message: "Consent is required to submit a help request." } },
  attachmentCount: { type: Number, min: 0, max: 10, default: 0 },
  completionEvidenceChecklist: { type: [String], default: [], validate: (items: string[]) => items.length <= 10 },
  screeningStatus: { type: String, enum: ["pending", "review_recommended", "needs_information", "clear_for_human_review", "unavailable"], default: "pending", index: true },
  screening: { type: requestScreeningSchema, required: false },
  timeline: [{
    status: { type: String, required: true },
    actorId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    reason: { type: String, maxlength: 500 },
    occurredAt: { type: Date, required: true, default: Date.now },
  }],
}, { timestamps: true });
helpRequestSchema.index({ status: 1, city: 1, createdAt: -1 });
helpRequestSchema.index({ requesterId: 1, createdAt: -1 });
helpRequestSchema.index({ location: "2dsphere" });

export type RequestDocumentRecord = {
  _id: mongoose.Types.ObjectId;
  helpRequestId: mongoose.Types.ObjectId;
  uploadedBy: mongoose.Types.ObjectId;
  privateObjectKey: string;
  originalName: string;
  contentType: string;
  byteSize: number;
  checksum: string;
  status: RequestDocumentStatus;
  extractedTextEncrypted?: string;
  ocrStatus: RequestOcrStatus;
  ocrProvider?: string;
  ocrProcessedAt?: Date;
  ocrError?: string;
  createdAt: Date;
  updatedAt: Date;
};

export type VerificationDocumentDocument = {
  _id: mongoose.Types.ObjectId;
  applicantId: mongoose.Types.ObjectId;
  uploadedBy: mongoose.Types.ObjectId;
  kind: VerificationDocumentKind;
  privateObjectKey: string;
  originalName: string;
  contentType: string;
  byteSize: number;
  checksum: string;
  createdAt: Date;
  updatedAt: Date;
};

const verificationDocumentSchema = new Schema<VerificationDocumentDocument>({
  applicantId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  uploadedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  kind: { type: String, enum: ["volunteer_identity", "ngo_registration", "ngo_address", "ngo_authority", "ngo_additional"], required: true },
  privateObjectKey: { type: String, required: true, unique: true, maxlength: 512 },
  originalName: { type: String, required: true, maxlength: 120 },
  contentType: { type: String, required: true, maxlength: 100 },
  byteSize: { type: Number, required: true, min: 1 },
  checksum: { type: String, required: true, maxlength: 128 },
}, { timestamps: true });
verificationDocumentSchema.index({ applicantId: 1, createdAt: -1 });

const requestDocumentSchema = new Schema<RequestDocumentRecord>({
  helpRequestId: { type: Schema.Types.ObjectId, ref: "HelpRequest", required: true, index: true },
  uploadedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  privateObjectKey: { type: String, required: true, unique: true, maxlength: 512 },
  originalName: { type: String, required: true, maxlength: 120 },
  contentType: { type: String, required: true, maxlength: 100 },
  byteSize: { type: Number, required: true, min: 1 },
  checksum: { type: String, required: true, maxlength: 128 },
  status: { type: String, enum: ["pending_scan", "available", "rejected"], default: "pending_scan", index: true },
  extractedTextEncrypted: { type: String, select: false, maxlength: 30000 },
  ocrStatus: { type: String, enum: ["pending", "completed", "unavailable", "failed", "unsupported"], default: "pending" },
  ocrProvider: { type: String, maxlength: 100 },
  ocrProcessedAt: { type: Date },
  ocrError: { type: String, select: false, maxlength: 300 },
}, { timestamps: true });

export type VolunteerAssignmentDocument = {
  _id: mongoose.Types.ObjectId;
  requestId: mongoose.Types.ObjectId;
  volunteerId: mongoose.Types.ObjectId;
  ngoId: mongoose.Types.ObjectId;
  status: AssignmentStatus;
  offerExpiresAt: Date;
  acceptedAt?: Date;
  startedAt?: Date;
  submittedAt?: Date;
  completedAt?: Date;
  progressNote?: string;
  cancellationReason?: string;
  matchExplanation: string[];
  distanceKm?: number;
  evidenceCount?: number;
  history: Array<{
    status: AssignmentStatus;
    actorId: mongoose.Types.ObjectId;
    reason?: string;
    occurredAt: Date;
  }>;
  privateDetailsDisclosedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
};

const volunteerAssignmentSchema = new Schema<VolunteerAssignmentDocument>({
  requestId: { type: Schema.Types.ObjectId, ref: "HelpRequest", required: true, index: true },
  volunteerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  ngoId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  status: { type: String, enum: ["offered", "accepted", "in_progress", "submitted_for_review", "more_evidence_required", "rejected_with_reason", "flagged_for_manual_review", "completed", "declined", "expired", "cancelled", "reassigned", "disputed"], default: "offered", index: true },
  offerExpiresAt: { type: Date, required: true, index: true },
  acceptedAt: { type: Date },
  startedAt: { type: Date },
  submittedAt: { type: Date },
  completedAt: { type: Date },
  progressNote: { type: String, trim: true, maxlength: 500 },
  cancellationReason: { type: String, trim: true, maxlength: 500 },
  matchExplanation: { type: [String], default: [] },
  distanceKm: { type: Number, min: 0 },
  evidenceCount: { type: Number, min: 0, default: 0 },
  history: [{
    status: { type: String, enum: ["offered", "accepted", "in_progress", "submitted_for_review", "more_evidence_required", "rejected_with_reason", "flagged_for_manual_review", "completed", "declined", "expired", "cancelled", "reassigned", "disputed"], required: true },
    actorId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    reason: { type: String, maxlength: 500 },
    occurredAt: { type: Date, required: true, default: Date.now },
  }],
  privateDetailsDisclosedAt: { type: Date },
}, { timestamps: true });
volunteerAssignmentSchema.index({ requestId: 1, status: 1 });
volunteerAssignmentSchema.index({ volunteerId: 1, status: 1, createdAt: -1 });
volunteerAssignmentSchema.index({ requestId: 1, volunteerId: 1 }, { unique: true });

export type AssignmentEvidenceDocument = {
  _id: mongoose.Types.ObjectId;
  requestId: mongoose.Types.ObjectId;
  assignmentId: mongoose.Types.ObjectId;
  uploadedBy: mongoose.Types.ObjectId;
  privateObjectKey: string;
  originalName: string;
  contentType: string;
  byteSize: number;
  checksum: string;
  createdAt: Date;
};

const assignmentEvidenceSchema = new Schema<AssignmentEvidenceDocument>({
  requestId: { type: Schema.Types.ObjectId, ref: "HelpRequest", required: true, index: true },
  assignmentId: { type: Schema.Types.ObjectId, ref: "VolunteerAssignment", required: true, index: true },
  uploadedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  privateObjectKey: { type: String, required: true, unique: true, maxlength: 512 },
  originalName: { type: String, required: true, maxlength: 120 },
  contentType: { type: String, enum: ["image/jpeg", "image/png", "image/webp", "application/pdf"], required: true },
  byteSize: { type: Number, required: true, min: 1 },
  checksum: { type: String, required: true, maxlength: 128 },
}, { timestamps: true });
assignmentEvidenceSchema.index({ assignmentId: 1, createdAt: 1 });

export type CompletionProofDocument = {
  _id: mongoose.Types.ObjectId;
  requestId: mongoose.Types.ObjectId;
  assignmentId: mongoose.Types.ObjectId;
  submittedBy: mongoose.Types.ObjectId;
  privateObjectKeys: string[];
  evidenceIds: mongoose.Types.ObjectId[];
  summary: string;
  report: string;
  status: CompletionProofStatus;
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
    actorId: mongoose.Types.ObjectId;
    reason?: string;
    occurredAt: Date;
  }>;
  submittedAt: Date;
  reviewedAt?: Date;
  reviewedBy?: mongoose.Types.ObjectId;
  issuesResolvedAt?: Date;
  issuesResolvedBy?: mongoose.Types.ObjectId;
  issueResolutionReason?: string;
};

const completionProofSchema = new Schema<CompletionProofDocument>({
  requestId: { type: Schema.Types.ObjectId, ref: "HelpRequest", required: true, index: true },
  assignmentId: { type: Schema.Types.ObjectId, ref: "VolunteerAssignment", required: true, index: true },
  submittedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  privateObjectKeys: { type: [String], default: [] },
  evidenceIds: [{ type: Schema.Types.ObjectId, ref: "AssignmentEvidence", required: true }],
  summary: { type: String, required: true, trim: true, maxlength: 500 },
  report: { type: String, required: true, trim: true, maxlength: 5000 },
  status: { type: String, enum: ["submitted", "approved", "rejected", "more_evidence_required", "flagged_for_manual_review"], default: "submitted", index: true },
  completedAt: { type: Date, required: true },
  unresolvedIssues: { type: String, trim: true, maxlength: 2000 },
  recipientConfirmed: { type: Boolean },
  consentedToAiReview: { type: Boolean, required: true, default: false },
  aiReview: {
    recommendation: { type: String, enum: ["ready_for_ngo_review", "additional_evidence_recommended", "manual_review_required", "provider_unavailable"] },
    findings: { type: [String], default: [] },
    missingEvidence: { type: [String], default: [] },
    uncertainty: { type: String, maxlength: 500 },
    confidence: { type: Number, min: 0, max: 1 },
    provider: { type: String, maxlength: 100 },
    model: { type: String, maxlength: 100 },
    assessedAt: { type: Date },
  },
  reviewHistory: [{
    status: { type: String, enum: ["submitted", "approved", "rejected", "more_evidence_required", "flagged_for_manual_review"], required: true },
    actorId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    reason: { type: String, maxlength: 500 },
    occurredAt: { type: Date, required: true, default: Date.now },
  }],
  submittedAt: { type: Date, required: true, default: Date.now },
  reviewedAt: { type: Date },
  reviewedBy: { type: Schema.Types.ObjectId, ref: "User" },
  issuesResolvedAt: { type: Date },
  issuesResolvedBy: { type: Schema.Types.ObjectId, ref: "User" },
  issueResolutionReason: { type: String, trim: true, maxlength: 500 },
}, { versionKey: false });
completionProofSchema.index({ assignmentId:  1, submittedAt: -1 });

export type PhysicalItemDonationDocument = {
  _id: mongoose.Types.ObjectId;
  donorId: mongoose.Types.ObjectId;
  ngoId: mongoose.Types.ObjectId;
  category: string;
  description: string;
  quantity: number;
  condition: "new" | "like_new" | "good" | "fair";
  city: string;
  pickupAddress: string;
  location?: { type: "Point"; coordinates: [number, number] };
  pickupWindowStart: Date;
  pickupWindowEnd: Date;
  preferredContactMethod: "phone" | "email" | "in_app";
  specialHandling?: string;
  consentToSharePickupDetails: boolean;
  assignedVolunteerId?: mongoose.Types.ObjectId;
  assignedPickupId?: mongoose.Types.ObjectId;
  status: ItemDonationStatus;
  timeline: Array<{ status: ItemDonationStatus; actorId: mongoose.Types.ObjectId; reason?: string; occurredAt: Date }>;
  receiptReference?: string;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
};

const physicalItemDonationSchema = new Schema<PhysicalItemDonationDocument>({
  donorId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  ngoId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  category: { type: String, required: true, trim: true, maxlength: 60 },
  description: { type: String, required: true, trim: true, maxlength: 2000 },
  quantity: { type: Number, required: true, min: 1, max: 100000 },
  condition: { type: String, enum: ["new", "like_new", "good", "fair"], required: true },
  city: { type: String, required: true, trim: true, maxlength: 100 },
  pickupAddress: { type: String, required: true, trim: true, maxlength: 500 },
  location: { type: { type: String, enum: ["Point"] }, coordinates: { type: [Number] } },
  pickupWindowStart: { type: Date, required: true },
  pickupWindowEnd: { type: Date, required: true },
  preferredContactMethod: { type: String, enum: ["phone", "email", "in_app"], required: true },
  specialHandling: { type: String, trim: true, maxlength: 1000 },
  consentToSharePickupDetails: { type: Boolean, required: true },
  assignedVolunteerId: { type: Schema.Types.ObjectId, ref: "User", index: true },
  assignedPickupId: { type: Schema.Types.ObjectId, ref: "ItemPickupAssignment" },
  status: { type: String, enum: ["submitted", "pending_ngo_review", "accepted", "rejected", "needs_information", "awaiting_pickup_assignment", "pickup_assigned", "pickup_in_progress", "picked_up", "delivered_or_received", "completed", "pickup_failed", "disputed", "cancelled"], default: "submitted", index: true },
  timeline: [{
    status: { type: String, enum: ["submitted", "pending_ngo_review", "accepted", "rejected", "needs_information", "awaiting_pickup_assignment", "pickup_assigned", "pickup_in_progress", "picked_up", "delivered_or_received", "completed", "pickup_failed", "disputed", "cancelled"], required: true },
    actorId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    reason: { type: String, maxlength: 500 },
    occurredAt: { type: Date, required: true, default: Date.now },
  }],
  receiptReference: { type: String, unique: true, sparse: true, maxlength: 40 },
  completedAt: { type: Date },
}, { timestamps: true });
physicalItemDonationSchema.index({ ngoId: 1, status: 1, createdAt: -1 });
physicalItemDonationSchema.index({ location: "2dsphere" });

export type ItemDonationEvidenceDocument = {
  _id: mongoose.Types.ObjectId;
  donationId: mongoose.Types.ObjectId;
  uploaderId: mongoose.Types.ObjectId;
  kind: "donation_photo" | "pickup_photo" | "receipt";
  privateObjectKey: string;
  originalName: string;
  contentType: "image/jpeg" | "image/png" | "image/webp" | "application/pdf";
  byteSize: number;
  checksum: string;
  createdAt: Date;
};

const itemDonationEvidenceSchema = new Schema<ItemDonationEvidenceDocument>({
  donationId: { type: Schema.Types.ObjectId, ref: "PhysicalItemDonation", required: true, index: true },
  uploaderId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  kind: { type: String, enum: ["donation_photo", "pickup_photo", "receipt"], required: true },
  privateObjectKey: { type: String, required: true, select: false },
  originalName: { type: String, required: true, maxlength: 120 },
  contentType: { type: String, enum: ["image/jpeg", "image/png", "image/webp", "application/pdf"], required: true },
  byteSize: { type: Number, required: true, min: 1 },
  checksum: { type: String, required: true, maxlength: 128 },
}, { timestamps: { createdAt: true, updatedAt: false } });
itemDonationEvidenceSchema.index({ donationId: 1, createdAt: 1 });

export type ItemPickupAssignmentDocument = {
  _id: mongoose.Types.ObjectId;
  donationId: mongoose.Types.ObjectId;
  ngoId: mongoose.Types.ObjectId;
  volunteerId: mongoose.Types.ObjectId;
  status: ItemPickupStatus;
  offerExpiresAt: Date;
  distanceKm?: number;
  matchExplanation: string[];
  acceptedAt?: Date;
  startedAt?: Date;
  submittedAt?: Date;
  progressNote?: string;
  history: Array<{ status: ItemPickupStatus; actorId: mongoose.Types.ObjectId; reason?: string; occurredAt: Date }>;
  createdAt: Date;
  updatedAt: Date;
};

const itemPickupAssignmentSchema = new Schema<ItemPickupAssignmentDocument>({
  donationId: { type: Schema.Types.ObjectId, ref: "PhysicalItemDonation", required: true, index: true },
  ngoId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  volunteerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  status: { type: String, enum: ["offered", "accepted", "in_progress", "submitted_for_review", "completed", "declined", "expired", "cancelled", "reassigned", "disputed"], required: true, index: true },
  offerExpiresAt: { type: Date, required: true, index: true },
  distanceKm: { type: Number, min: 0 },
  matchExplanation: { type: [String], default: [] },
  acceptedAt: { type: Date },
  startedAt: { type: Date },
  submittedAt: { type: Date },
  progressNote: { type: String, trim: true, maxlength: 500 },
  history: [{
    status: { type: String, enum: ["offered", "accepted", "in_progress", "submitted_for_review", "completed", "declined", "expired", "cancelled", "reassigned", "disputed"], required: true },
    actorId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    reason: { type: String, maxlength: 500 },
    occurredAt: { type: Date, required: true, default: Date.now },
  }],
}, { timestamps: true });
itemPickupAssignmentSchema.index({ volunteerId: 1, status: 1, offerExpiresAt: 1 });
itemPickupAssignmentSchema.index({ donationId: 1, volunteerId: 1, status: 1 });
itemPickupAssignmentSchema.index(
  { donationId: 1, volunteerId: 1 },
  { unique: true, partialFilterExpression: { status: "offered" } },
);

export type NotificationDocument = {
  _id: mongoose.Types.ObjectId;
  recipientId: mongoose.Types.ObjectId;
  type: string;
  idempotencyKey: string;
  payload: Record<string, string>;
  status: NotificationStatus;
  readAt?: Date;
  createdAt: Date;
  updatedAt: Date;
};

const notificationSchema = new Schema<NotificationDocument>({
  recipientId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  type: { type: String, required: true, maxlength: 100 },
  idempotencyKey: { type: String, required: true, maxlength: 150 },
  payload: { type: Schema.Types.Mixed, required: true, default: {} },
  status: { type: String, enum: ["pending", "sent", "failed"], default: "pending", index: true },
  readAt: { type: Date },
}, { timestamps: true });
notificationSchema.index({ recipientId: 1, idempotencyKey: 1 }, { unique: true });
notificationSchema.index({ recipientId: 1, createdAt: -1 });
notificationSchema.index({ recipientId: 1, readAt: 1, createdAt: -1 });

export type AuditLogDocument = {
  _id: mongoose.Types.ObjectId;
  actorId: mongoose.Types.ObjectId;
  action: string;
  resourceType: string;
  resourceId: string;
  previousStatus?: string;
  newStatus?: string;
  reason?: string;
  occurredAt: Date;
};

const auditLogSchema = new Schema<AuditLogDocument>({
  actorId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  action: { type: String, required: true, maxlength: 100 },
  resourceType: { type: String, required: true, maxlength: 100 },
  resourceId: { type: String, required: true, maxlength: 100 },
  previousStatus: { type: String, maxlength: 40 },
  newStatus: { type: String, maxlength: 40 },
  reason: { type: String, maxlength: 1000 },
  occurredAt: { type: Date, required: true, default: Date.now, index: true },
}, { versionKey: false });
auditLogSchema.index({ resourceType: 1, resourceId: 1, occurredAt: -1 });

const contributionSchema = new Schema<ContributionDocument>({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  needId: { type: Schema.Types.ObjectId, ref: "Need", required: true, index: true },
  kind: { type: String, enum: ["volunteer", "donation"], required: true },
  amount: { type: Number, min: 0, default: 0 },
  currency: { type: String, enum: ["INR"], default: "INR" },
  hours: { type: Number, min: 0, default: 0 },
  status: { type: String, enum: ["creating", "pending", "settling", "completed", "failed", "expired", "refund_required"], default: "completed" },
  orderId: { type: String, sparse: true, unique: true },
  paymentId: { type: String, sparse: true, unique: true },
  receiptReference: { type: String, sparse: true, unique: true, maxlength: 40 },
  reservationToken: { type: String, sparse: true, unique: true },
  reservationExpiresAt: { type: Date, index: true },
}, { timestamps: true });
contributionSchema.index({ userId: 1, needId: 1, kind: 1 }, { unique: true, partialFilterExpression: { kind: "volunteer" } });
contributionSchema.index({ kind: 1, status: 1, reservationExpiresAt: 1 });

function modelFor<T>(name: string, schema: Schema<T>) {
  return mongoose.models[name] ? mongoose.model<T>(name) : mongoose.model<T>(name, schema);
}

export const User = modelFor("User", userSchema);
export const Need = modelFor("Need", needSchema);
export const Contribution = modelFor("Contribution", contributionSchema);
export const HelpRequest = modelFor("HelpRequest", helpRequestSchema);
export const RequestDocument = modelFor("RequestDocument", requestDocumentSchema);
export const VerificationDocument = modelFor("VerificationDocument", verificationDocumentSchema);
export const VolunteerAssignment = modelFor("VolunteerAssignment", volunteerAssignmentSchema);
export const AssignmentEvidence = modelFor("AssignmentEvidence", assignmentEvidenceSchema);
export const CompletionProof = modelFor("CompletionProof", completionProofSchema);
export const PhysicalItemDonation = modelFor("PhysicalItemDonation", physicalItemDonationSchema);
export const ItemDonationEvidence = modelFor("ItemDonationEvidence", itemDonationEvidenceSchema);
export const ItemPickupAssignment = modelFor("ItemPickupAssignment", itemPickupAssignmentSchema);
export const Notification = modelFor("Notification", notificationSchema);
export const AuditLog = modelFor("AuditLog", auditLogSchema);
