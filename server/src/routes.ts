import { randomUUID } from "node:crypto";
import express from "express";
import type { Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import mongoose from "mongoose";
import type { HydratedDocument } from "mongoose";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { rateLimit } from "express-rate-limit";
import { config } from "./config.js";
import { requireAuth, requireRole } from "./middleware/authorization.js";
import {
  AssignmentEvidence,
  AuditLog,
  CompletionProof,
  Contribution,
  HelpRequest,
  ItemDonationEvidence,
  ItemPickupAssignment,
  Need,
  Notification,
  PhysicalItemDonation,
  RequestDocument,
  VerificationDocument,
  User,
  VolunteerAssignment,
} from "./models.js";
import type {
  AssignmentEvidenceDocument,
  ContributionDocument,
  ContributionRecord,
  HelpRequestDocument,
  NeedDocument,
  OrganizationDocument,
  OrganizationSummaryDocument,
  PopulatedNeedDocument,
  UserDocument,
  VolunteerApplicationDocument,
  VerificationDocumentDocument,
} from "./models.js";
import type { SafeUser } from "./types/domain.js";
import { recordAuditEvent } from "./services/auditService.js";
import { createPaymentOrder, fetchPayment, verifyProviderSignature } from "./services/paymentService.js";
import {
  matchVolunteerToNeeds,
  offerRequestToEligibleVolunteers,
} from "./services/volunteerMatchingService.js";
import {
  acceptVolunteerOffer,
  declineVolunteerOffer,
  endVolunteerAssignment,
  expireVolunteerOffers,
  startVolunteerAssignment,
  submitAssignmentProof,
  updateVolunteerProgress,
} from "./services/volunteerAssignmentService.js";
import { assessHelpRequest } from "./services/aiVerificationService.js";
import { reviewCompletionProof, returnFlaggedProofToNgo } from "./services/completionReviewService.js";
import { extractRequestText } from "./services/ocrService.js";
import {
  decryptPrivateText,
  deletePrivateObject,
  encryptPrivateText,
  readPrivateObject,
  savePrivateObject,
  verifyPrivateStorageRuntime,
} from "./services/privateStorageService.js";
import { integrationStatus } from "./services/integrationStatusService.js";
import { declineNgoRequest, routeHelpRequestToNgo, transitionHelpRequestStatus } from "./services/helpRequestService.js";
import { findEligibleNgoForRequest, matchVerifiedNgos } from "./services/ngoMatchingService.js";
import { readGeoPointCoordinates } from "./services/locationService.js";

const userSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(254),
  password: z.string().min(8).max(72).refine((value) => Buffer.byteLength(value, "utf8") <= 72, "Password exceeds the supported byte length."),
  role: z.enum(["user", "volunteer", "donor", "ngo"]),
  city: z.string().trim().min(2).max(100),
  description: z.string().trim().max(1000).optional(),
  categories: z.array(z.string().trim().min(2).max(60)).max(12).optional(),
  phone: z.string().trim().max(30).optional(),
  website: z.string().trim().url().max(200).optional().or(z.literal("")),
  registrationNumber: z.string().trim().max(100).optional(),
  registrationType: z.string().trim().max(100).optional(),
  representativeName: z.string().trim().max(100).optional(),
  representativeDesignation: z.string().trim().max(100).optional(),
  issuingAuthority: z.string().trim().max(150).optional(),
  establishedDate: z.string().date().optional(),
  officialEmail: z.string().trim().email().max(254).optional(),
  officialPhone: z.string().trim().max(30).optional(),
  addressLine: z.string().trim().max(300).optional(),
  state: z.string().trim().max(100).optional(),
  postalCode: z.string().trim().max(20).optional(),
  serviceArea: z.string().trim().max(500).optional(),
  skills: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
  interests: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
  languages: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
  volunteerAvailability: z.string().trim().max(300).optional(),
  volunteerServiceRadiusKm: z.coerce.number().int().min(1).max(500).optional(),
  volunteerTaskOptIn: z.boolean().optional(),
}).superRefine((value, context) => {
  if (value.role === "volunteer") {
    if (!value.skills?.length) {
      context.addIssue({ code: "custom", path: ["skills"], message: "Add at least one volunteer skill." });
    }
    if (!value.serviceArea?.trim()) {
      context.addIssue({ code: "custom", path: ["serviceArea"], message: "Volunteer service area is required." });
    }
  }
  if (value.role === "ngo") {
    const requiredFields: Array<[keyof typeof value, string]> = [
      ["registrationNumber", "Registration number is required for NGO applications."],
      ["registrationType", "Registration type is required for NGO applications."],
      ["addressLine", "Organization address is required for NGO applications."],
      ["state", "Organization state is required for NGO applications."],
      ["postalCode", "Organization postal code is required for NGO applications."],
      ["officialPhone", "Official contact phone is required for NGO applications."],
      ["serviceArea", "Organization service area is required for NGO applications."],
    ];
    for (const [field, message] of requiredFields) {
      if (typeof value[field] !== "string" || !value[field].trim()) {
        context.addIssue({ code: "custom", path: [field], message });
      }
    }
    if (!value.categories?.length) {
      context.addIssue({ code: "custom", path: ["categories"], message: "Add at least one service category." });
    }
  }
});
const loginSchema = z.object({ email: z.string().trim().email().max(254), password: z.string().min(1).max(72) });
const createNeedSchema = z.object({
  title: z.string().trim().min(5).max(100),
  description: z.string().trim().min(20).max(1000),
  kind: z.enum(["volunteer", "donation"]),
  category: z.string().trim().min(2).max(60),
  city: z.string().trim().min(2).max(100),
  urgency: z.enum(["low", "medium", "high"]).default("medium"),
  targetAmount: z.coerce.number().int().positive().max(10_000_000).optional(),
  volunteersNeeded: z.coerce.number().int().min(1).max(500).optional(),
}).superRefine((value, context) => {
  if (value.kind === "donation" && !value.targetAmount) {
    context.addIssue({ code: "custom", path: ["targetAmount"], message: "A fundraising goal is required." });
  }
});
const paymentOrderSchema = z.object({
  needId: z.string().regex(/^[a-f\d]{24}$/i),
  amount: z.coerce.number().int().min(1).max(100_000),
});
const paymentVerifySchema = z.object({
  orderId: z.string().min(1).max(100),
  paymentId: z.string().min(1).max(100),
  signature: z.string().min(1).max(256),
});
const itemDonationSchema = z.object({
  ngoId: z.string().regex(/^[a-f\d]{24}$/i),
  category: z.enum(["clothes_footwear", "furniture", "books_education", "household_essentials", "food_supplies", "other"]),
  description: z.string().trim().min(10).max(2000),
  quantity: z.number().int().min(1).max(100000),
  condition: z.enum(["new", "like_new", "good", "fair"]),
  pickupAddress: z.string().trim().min(5).max(500),
  city: z.string().trim().min(2).max(100),
  coordinates: z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
  }).optional(),
  pickupWindowStart: z.string().datetime(),
  pickupWindowEnd: z.string().datetime(),
  preferredContactMethod: z.enum(["phone", "email", "in_app"]),
  specialHandling: z.string().trim().max(1000).optional(),
  consentToSharePickupDetails: z.literal(true),
}).strict().superRefine((value, context) => {
  if (new Date(value.pickupWindowEnd) <= new Date(value.pickupWindowStart)) {
    context.addIssue({ code: "custom", path: ["pickupWindowEnd"], message: "Pickup window must end after it starts." });
  }
  if (new Date(value.pickupWindowEnd) < new Date()) {
    context.addIssue({ code: "custom", path: ["pickupWindowEnd"], message: "Choose a future pickup window." });
  }
});
const itemDonationReviewSchema = z.object({
  action: z.enum(["accept", "reject", "needs_information"]),
  reason: z.string().trim().max(500).optional(),
}).strict().superRefine((value, context) => {
  if (value.action !== "accept" && !value.reason) {
    context.addIssue({ code: "custom", path: ["reason"], message: "Provide a reason or list the missing information." });
  }
});
const itemDonationReasonSchema = z.object({ reason: z.string().trim().min(5).max(500) }).strict();
const itemEvidenceKindSchema = z.enum(["donation_photo", "pickup_photo", "receipt"]);
const profileSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  city: z.string().trim().min(2).max(100).optional(),
  description: z.string().trim().max(1000).optional(),
  categories: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
  skills: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
  interests: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
}).refine((value) => Object.keys(value).length > 0, "Add at least one profile detail.");
const ngoVerificationSchema = z.object({
  name: z.string().trim().min(2).max(100),
  city: z.string().trim().min(2).max(100),
  description: z.string().trim().min(20).max(1000),
  categories: z.array(z.string().trim().min(2).max(60)).min(1).max(12),
  registrationNumber: z.string().trim().min(2).max(100),
  registrationType: z.string().trim().min(2).max(100),
  representativeName: z.string().trim().max(100).optional(),
  representativeDesignation: z.string().trim().max(100).optional(),
  issuingAuthority: z.string().trim().max(150).optional(),
  establishedDate: z.string().date().optional(),
  officialEmail: z.string().trim().email().max(254),
  officialPhone: z.string().trim().min(7).max(30),
  addressLine: z.string().trim().min(5).max(300),
  state: z.string().trim().min(2).max(100),
  postalCode: z.string().trim().min(3).max(20),
  serviceArea: z.string().trim().min(2).max(500),
  coordinates: z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
  }).optional(),
  acceptingRequests: z.boolean().default(true),
  requestCapacity: z.number().int().min(1).max(10000).optional(),
});
const ngoAvailabilitySchema = z.object({
  acceptingRequests: z.boolean(),
  clearCoordinates: z.boolean().default(false),
  coordinates: z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
  }).optional(),
  requestCapacity: z.number().int().min(1).max(10000).optional(),
}).strict();
const routeRequestSchema = z.object({ organizationId: z.string().regex(/^[a-f\d]{24}$/i) }).strict();
const ngoRequestReviewSchema = z.object({
  action: z.enum(["start_review", "approve", "needs_information", "flag_for_review", "decline"]),
  reason: z.string().trim().max(500).optional(),
}).strict().superRefine((value, context) => {
  if (["needs_information", "flag_for_review", "decline"].includes(value.action) && !value.reason) {
    context.addIssue({ code: "custom", path: ["reason"], message: "Add a reason or the information needed for this action." });
  }
});
const ngoReviewSchema = z.object({
  status: z.enum(["verified", "rejected", "resubmission_required"]),
  reason: z.string().trim().max(1000).optional(),
}).superRefine((value, context) => {
  if (value.status !== "verified" && !value.reason) {
    context.addIssue({ code: "custom", path: ["reason"], message: "A reason is required for this decision." });
  }
});
const volunteerPreferencesSchema = z.object({
  taskOptIn: z.boolean(),
  city: z.string().trim().min(2).max(100).optional(),
  serviceArea: z.string().trim().max(500).optional(),
  serviceRadiusKm: z.number().int().min(1).max(500).optional(),
  clearCoordinates: z.boolean().default(false),
  coordinates: z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
  }).optional(),
}).strict().refine((value) => Object.keys(value).length > 1, "Change at least one task preference.");
const volunteerAssignmentReasonSchema = z.object({
  reason: z.string().trim().min(5).max(500),
}).strict();
const volunteerProgressSchema = z.object({
  note: z.string().trim().min(5).max(500),
}).strict();
const volunteerProofSchema = z.object({
  report: z.string().trim().min(10).max(5000),
  summary: z.string().trim().min(5).max(500).optional(),
  completedAt: z.string().datetime().optional(),
  unresolvedIssues: z.string().trim().max(2000).optional(),
  recipientConfirmed: z.boolean().optional(),
  consentedToAiReview: z.boolean().default(false),
}).strict();
const completionReviewSchema = z.object({
  action: z.enum(["approve", "more_evidence_required", "reject", "flag_manual"]),
  reason: z.string().trim().min(5).max(500),
  resolveOutstandingIssues: z.boolean().optional(),
}).strict();
const completionChecklistSchema = z.object({
  items: z.array(z.string().trim().min(3).max(200)).max(10),
}).strict();
const manualReviewResolutionSchema = z.object({
  reason: z.string().trim().min(5).max(500),
}).strict();
const volunteerEligibilitySchema = z.object({
  status: z.enum(["pending", "under_review", "eligible", "rejected", "more_information_required", "suspended"]),
  reason: z.string().trim().max(500).optional(),
}).strict().superRefine((value, context) => {
  if (value.status !== "eligible" && !value.reason) {
    context.addIssue({ code: "custom", path: ["reason"], message: "A reason is required when eligibility is restricted." });
  }
});
const volunteerMatchingSchema = z.object({
  deadlineAt: z.string().datetime().refine((value) => new Date(value).getTime() > Date.now(), "Choose a future deadline.").optional(),
}).strict();
const helpRequestSchema = z.object({
  title: z.string().trim().min(5).max(120),
  description: z.string().trim().min(30).max(3000),
  category: z.enum(["food", "clothing", "shelter", "medical_assistance", "education", "emergency_support", "other"]),
  urgency: z.enum(["low", "medium", "high"]),
  peopleCount: z.coerce.number().int().min(1).max(100),
  city: z.string().trim().min(2).max(100),
  addressLine: z.string().trim().max(300).optional(),
  coordinates: z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
  }).optional(),
  preferredContactMethod: z.enum(["phone", "email", "in_app"]),
  consentToProcess: z.literal(true),
}).strict();
const helpRequestEditSchema = helpRequestSchema.partial().extend({
  consentToProcess: z.literal(true).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "Change at least one allowed field.");

const requestFileTypes: Record<string, { extension: string; magic: (bytes: Buffer) => boolean }> = {
  "image/jpeg": { extension: ".jpg", magic: (bytes) => bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff },
  "image/png": { extension: ".png", magic: (bytes) => bytes.length > 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) },
  "image/webp": { extension: ".webp", magic: (bytes) => bytes.length > 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP" },
  "application/pdf": { extension: ".pdf", magic: (bytes) => bytes.length > 5 && bytes.toString("ascii", 0, 5) === "%PDF-" },
};
const requestUploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { message: "Too many attachment uploads. Try again later." },
});
const verificationDocumentKinds = z.enum([
  "volunteer_identity",
  "ngo_registration",
  "ngo_address",
  "ngo_authority",
  "ngo_additional",
]);
const requestScreeningLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { message: "Too many screening requests. Please try again later." },
});
const volunteerTaskLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 90,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { message: "Too many task requests. Try again later." },
});

function requestSummary(request: {
  _id: mongoose.Types.ObjectId;
  title: string;
  description: string;
  category: string;
  urgency: string;
  peopleCount: number;
  city: string;
  addressLine?: string;
  preferredContactMethod: string;
  status: string;
  screeningStatus: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: request._id.toString(),
    title: request.title,
    description: request.description,
    category: request.category,
    urgency: request.urgency,
    peopleCount: request.peopleCount,
    city: request.city,
    ...(request.addressLine ? { addressLine: request.addressLine } : {}),
    preferredContactMethod: request.preferredContactMethod,
    status: request.status,
    screeningStatus: request.screeningStatus,
    createdAt: request.createdAt.toISOString(),
    updatedAt: request.updatedAt.toISOString(),
  };
}

function validRouteObjectId(req: Request, name: string): string | undefined {
  const value = req.params[name];
  return typeof value === "string" && mongoose.isValidObjectId(value) ? value : undefined;
}

function volunteerCoordinates(location: UserDocument["volunteerLocation"]): { latitude: number; longitude: number } | undefined {
  const coordinates = readGeoPointCoordinates(location);
  return coordinates ? { latitude: coordinates[1], longitude: coordinates[0] } : undefined;
}

async function findRequestForViewer(requestId: string, userId: string, role: string): Promise<HelpRequestDocument | null> {
  if (role === "user") {
    return HelpRequest.findOne({ _id: requestId, requesterId: userId });
  }
  if (role === "ngo") {
    const organization = await User.findOne({ _id: userId, role: "ngo", organizationStatus: "verified" }).select("_id");
    if (!organization) return null;
    return HelpRequest.findOne({ _id: requestId, assignedOrganizationId: organization._id });
  }
  return null;
}

function safeUser(user: Pick<UserDocument, "_id" | "name" | "email" | "role" | "city" | "organizationStatus" | "volunteerEligibility" | "description" | "categories" | "skills" | "interests" | "languages" | "volunteerAvailability" | "phone" | "website" | "registrationNumber" | "registrationType" | "officialEmail" | "officialPhone" | "addressLine" | "state" | "postalCode" | "serviceArea" | "representativeName" | "representativeDesignation" | "issuingAuthority" | "establishedDate" | "verificationReason">): SafeUser {
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    role: user.role,
    city: user.city,
    ...(user.organizationStatus ? { organizationStatus: user.organizationStatus } : {}),
    ...(user.volunteerEligibility ? { volunteerEligibility: user.volunteerEligibility } : {}),
    ...(user.description ? { description: user.description } : {}),
    ...(user.categories?.length ? { categories: user.categories } : {}),
    ...(user.skills?.length ? { skills: user.skills } : {}),
    ...(user.interests?.length ? { interests: user.interests } : {}),
    ...(user.languages?.length ? { languages: user.languages } : {}),
    ...(user.volunteerAvailability ? { volunteerAvailability: user.volunteerAvailability } : {}),
    ...(user.phone ? { phone: user.phone } : {}),
    ...(user.website ? { website: user.website } : {}),
    ...(user.registrationNumber ? { registrationNumber: user.registrationNumber } : {}),
    ...(user.registrationType ? { registrationType: user.registrationType } : {}),
    ...(user.officialEmail ? { officialEmail: user.officialEmail } : {}),
    ...(user.officialPhone ? { officialPhone: user.officialPhone } : {}),
    ...(user.addressLine ? { addressLine: user.addressLine } : {}),
    ...(user.state ? { state: user.state } : {}),
    ...(user.postalCode ? { postalCode: user.postalCode } : {}),
    ...(user.serviceArea ? { serviceArea: user.serviceArea } : {}),
    ...(user.representativeName ? { representativeName: user.representativeName } : {}),
    ...(user.representativeDesignation ? { representativeDesignation: user.representativeDesignation } : {}),
    ...(user.issuingAuthority ? { issuingAuthority: user.issuingAuthority } : {}),
    ...(user.establishedDate ? { establishedDate: user.establishedDate.toISOString() } : {}),
    ...(user.verificationReason ? { verificationReason: user.verificationReason } : {}),
  };
}

const DONATION_RESERVATION_MS = 15 * 60 * 1000;

function transactionsUnavailable(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? error.code : undefined;
  const message = "message" in error && typeof error.message === "string" ? error.message : "";
  return code === 20 || code === 303 ||
    /Transaction numbers are only allowed|does not support transactions|replica set member or mongos/i.test(message);
}

async function reserveCampaignAmount(
  needId: mongoose.Types.ObjectId,
  token: string,
  amount: number,
  expiresAt: Date,
  session?: mongoose.ClientSession,
): Promise<boolean> {
  const need = await Need.findOneAndUpdate(
    {
      _id: needId,
      kind: "donation",
      status: "open",
      $expr: {
        $lte: [
          { $add: [{ $ifNull: ["$raisedAmount", 0] }, { $ifNull: ["$reservedAmount", 0] }, amount] },
          "$targetAmount",
        ],
      },
    },
    {
      $inc: { reservedAmount: amount },
      $push: { paymentReservations: { token, amount, expiresAt } },
    },
    { new: true, session },
  );
  return Boolean(need);
}

async function releaseCampaignReservation(needId: mongoose.Types.ObjectId, token: string): Promise<void> {
  const reservation = await Need.findOne({
    _id: needId,
    paymentReservations: { $elemMatch: { token, settlementPaymentId: { $exists: false } } },
  }).select("paymentReservations").lean<Pick<NeedDocument, "paymentReservations"> | null>();
  const held = reservation?.paymentReservations.find((item) => item.token === token && !item.settlementPaymentId);
  if (!held) return;
  await Need.updateOne(
    {
      _id: needId,
      paymentReservations: { $elemMatch: { token, amount: held.amount, settlementPaymentId: { $exists: false } } },
    },
    {
      $inc: { reservedAmount: -held.amount },
      $pull: { paymentReservations: { token } },
    },
  );
}

async function createDonationReservation(
  userId: string,
  needId: mongoose.Types.ObjectId,
  amount: number,
): Promise<{ id: mongoose.Types.ObjectId; token: string; expiresAt: Date }> {
  const token = randomUUID();
  const expiresAt = new Date(Date.now() + DONATION_RESERVATION_MS);
  const session = await mongoose.startSession();
  try {
    try {
      let contributionId: mongoose.Types.ObjectId | undefined;
      await session.withTransaction(async () => {
        const reserved = await reserveCampaignAmount(needId, token, amount, expiresAt, session);
        if (!reserved) throw new Error("CAMPAIGN_GOAL_REACHED");
        const [contribution] = await Contribution.create([{
          userId,
          needId,
          kind: "donation",
          amount,
          status: "creating",
          reservationToken: token,
          reservationExpiresAt: expiresAt,
        }], { session });
        contributionId = contribution._id;
      });
      if (!contributionId) throw new Error("Donation reservation was not saved.");
      return { id: contributionId, token, expiresAt };
    } catch (error) {
      if (!transactionsUnavailable(error)) throw error;
    }

    // On standalone MongoDB, a hold lives in the campaign document itself so it can be
    // atomically admitted and later expired even if the process stops before order creation.
    const reserved = await reserveCampaignAmount(needId, token, amount, expiresAt);
    if (!reserved) throw new Error("CAMPAIGN_GOAL_REACHED");
    try {
      const contribution = await Contribution.create({
        userId,
        needId,
        kind: "donation",
        amount,
        status: "creating",
        reservationToken: token,
        reservationExpiresAt: expiresAt,
      });
      return { id: contribution._id, token, expiresAt };
    } catch (error) {
      await releaseCampaignReservation(needId, token);
      throw error;
    }
  } finally {
    await session.endSession();
  }
}

async function releaseFailedOrder(orderId: string): Promise<void> {
  const failed = await Contribution.findOneAndUpdate(
    { orderId, kind: "donation", status: { $in: ["creating", "pending"] } },
    { $set: { status: "failed" } },
    { new: true },
  );
  if (failed?.reservationToken) await releaseCampaignReservation(failed.needId, failed.reservationToken);
}

export async function expireDonationReservations(now = new Date()): Promise<void> {
  const interruptedSettlements = await Contribution.find({
    kind: "donation",
    status: "settling",
    reservationToken: { $exists: true },
  }).select("_id needId orderId paymentId reservationToken reservationExpiresAt");
  for (const contribution of interruptedSettlements) {
    const activeReservation = await Need.findOne({
      _id: contribution.needId,
      paymentReservations: { $elemMatch: { token: contribution.reservationToken } },
    }).select("paymentReservations").lean<Pick<NeedDocument, "paymentReservations"> | null>();
    const reservation = activeReservation?.paymentReservations.find((item) => item.token === contribution.reservationToken);
    if ((!reservation || reservation.settlementPaymentId === contribution.paymentId) &&
        contribution.orderId && contribution.paymentId) {
      const result = await settlePayment(contribution.orderId, contribution.paymentId);
      if (result === "completed") await notifyConfirmedDonation(contribution.orderId);
    } else if (contribution.reservationExpiresAt && contribution.reservationExpiresAt <= now && contribution.paymentId) {
      await requireRefund(contribution, contribution.paymentId);
    }
  }

  const expired = await Contribution.find({
    kind: "donation",
    status: { $in: ["creating", "pending"] },
    reservationExpiresAt: { $lte: now },
  }).select("_id needId reservationToken");
  for (const contribution of expired) {
    const marked = await Contribution.updateOne(
      { _id: contribution._id, status: { $in: ["creating", "pending"] }, reservationExpiresAt: { $lte: now } },
      { $set: { status: "expired" } },
    );
    if (marked.modifiedCount && contribution.reservationToken) {
      await releaseCampaignReservation(contribution.needId, contribution.reservationToken);
    }
  }

  // Also remove holds orphaned if the process stopped after reserving the campaign but before saving the order.
  const campaigns = await Need.find({ paymentReservations: { $elemMatch: { expiresAt: { $lte: now } } } })
    .select("_id paymentReservations")
    .lean<Pick<NeedDocument, "_id" | "paymentReservations">[]>();
  for (const campaign of campaigns) {
    for (const reservation of campaign.paymentReservations) {
      if (reservation.expiresAt <= now) {
        const settling = await Contribution.exists({ reservationToken: reservation.token, status: "settling" });
        if (!settling) await releaseCampaignReservation(campaign._id, reservation.token);
      }
    }
  }
}

type SettlementResult = "completed" | "refund_required" | "not_found" | "conflict";

async function requireRefund(contribution: ContributionRecord | null, paymentId: string): Promise<void> {
  if (!contribution) return;
  const updated = await Contribution.updateOne(
    {
      _id: contribution._id,
      $or: [
        { status: { $in: ["pending", "failed", "expired"] } },
        { status: "settling", paymentId },
      ],
    },
    { $set: { status: "refund_required", paymentId } },
  );
  if (updated.modifiedCount && contribution.reservationToken) {
    await releaseCampaignReservation(contribution.needId, contribution.reservationToken);
  }
}

async function settlePayment(orderId: string, paymentId: string, amountMinor?: number): Promise<SettlementResult> {
  const contribution = await Contribution.findOne({ orderId, kind: "donation" });
  if (!contribution) return "not_found";
  const paymentUsed = await Contribution.exists({ paymentId, _id: { $ne: contribution._id } });
  if (paymentUsed) return "conflict";
  if (amountMinor !== undefined && amountMinor !== contribution.amount * 100) {
    await requireRefund(contribution, paymentId);
    return "refund_required";
  }
  if (contribution.status === "completed") {
    return contribution.paymentId === paymentId ? "completed" : "conflict";
  }
  if (contribution.status === "expired" || contribution.status === "failed" || contribution.status === "refund_required") {
    if (contribution.status === "refund_required") return "refund_required";
    await requireRefund(contribution, paymentId);
    return "refund_required";
  }
  if (!contribution.reservationToken) return "conflict";
  if (contribution.status === "pending" &&
      contribution.reservationExpiresAt &&
      contribution.reservationExpiresAt <= new Date()) {
    await requireRefund(contribution, paymentId);
    return "refund_required";
  }
  const settlementNow = new Date();

  const finalizeCampaign = async (session?: mongoose.ClientSession): Promise<boolean> => {
    const claimed = await Need.updateOne(
      {
        _id: contribution.needId,
        paymentReservations: {
          $elemMatch: {
            token: contribution.reservationToken,
            amount: contribution.amount,
            expiresAt: { $gt: settlementNow },
            settlementPaymentId: { $exists: false },
          },
        },
      },
      { $set: { "paymentReservations.$.settlementPaymentId": paymentId } },
      { session },
    );
    if (!claimed.modifiedCount) {
      const alreadyClaimed = await Need.exists({
        _id: contribution.needId,
        paymentReservations: { $elemMatch: { token: contribution.reservationToken, settlementPaymentId: paymentId } },
      }).session(session ?? null);
      if (!alreadyClaimed) {
        const alreadySettled = await Contribution.exists({
          _id: contribution._id,
          status: "completed",
          paymentId,
        }).session(session ?? null);
        return Boolean(alreadySettled);
      }
    }

    const settled = await Need.updateOne(
      {
        _id: contribution.needId,
        paymentReservations: { $elemMatch: { token: contribution.reservationToken, settlementPaymentId: paymentId } },
      },
      {
        $inc: { raisedAmount: contribution.amount, reservedAmount: -contribution.amount },
        $pull: { paymentReservations: { token: contribution.reservationToken } },
      },
      { session },
    );
    return settled.modifiedCount === 1;
  };
  const receiptReference = `IM-${new Date().getUTCFullYear()}-${contribution._id.toString().slice(-8).toUpperCase()}`;

  const session = await mongoose.startSession();
  try {
    try {
      let completed = false;
      await session.withTransaction(async () => {
        const current = await Contribution.findById(contribution._id).session(session);
        if (!current) throw new Error("Donation order disappeared during settlement.");
        if (current.status === "completed") {
          completed = current.paymentId === paymentId;
          return;
        }
        if (!["pending", "settling"].includes(current.status) ||
            (current.status === "settling" && current.paymentId !== paymentId) ||
            current.reservationToken !== contribution.reservationToken) {
          throw new Error("Donation reservation is no longer active.");
        }
        const holdExists = await Need.exists({
          _id: contribution.needId,
          paymentReservations: { $elemMatch: { token: contribution.reservationToken } },
        }).session(session);
        if (holdExists) {
          const finalized = await finalizeCampaign(session);
          if (!finalized) throw new Error("Donation reservation could not be settled.");
        } else if (current.status !== "settling") {
          throw new Error("Donation reservation could not be settled.");
        }
        const result = await Contribution.updateOne(
          { _id: current._id, status: current.status, ...(current.status === "settling" ? { paymentId } : {}) },
          { $set: { status: "completed", paymentId, receiptReference }, $unset: { reservationExpiresAt: 1 } },
          { session },
        );
        if (!result.modifiedCount) throw new Error("Donation record could not be completed.");
        completed = true;
      });
      return completed ? "completed" : "conflict";
    } catch (error) {
      if (!transactionsUnavailable(error)) throw error;
    }

    // Standalone MongoDB fallback: each step is conditional and idempotent. A `settling`
    // record plus its embedded campaign hold lets a later webhook retry finish after a crash.
    const claimedContribution = await Contribution.findOneAndUpdate(
      {
        _id: contribution._id,
        $or: [{ status: "pending" }, { status: "settling", paymentId }],
      },
      { $set: { status: "settling", paymentId } },
      { new: true },
    );
    if (!claimedContribution) {
      const latest = await Contribution.findById(contribution._id);
      if (latest?.status === "completed" && latest.paymentId === paymentId) return "completed";
      if (latest && ["expired", "failed"].includes(latest.status)) {
        await requireRefund(latest, paymentId);
        return "refund_required";
      }
      return "conflict";
    }

    const claimedCampaign = await Need.updateOne(
      {
        _id: contribution.needId,
        paymentReservations: {
          $elemMatch: {
            token: contribution.reservationToken,
            amount: contribution.amount,
            expiresAt: { $gt: settlementNow },
            settlementPaymentId: { $exists: false },
          },
        },
      },
      { $set: { "paymentReservations.$.settlementPaymentId": paymentId } },
    );
    const claimAlreadyExists = claimedCampaign.modifiedCount === 0 && await Need.exists({
      _id: contribution.needId,
      paymentReservations: { $elemMatch: { token: contribution.reservationToken, settlementPaymentId: paymentId } },
    });
    const latestBeforeFinalize = await Contribution.findById(contribution._id);
    if (latestBeforeFinalize?.status === "completed") {
      return latestBeforeFinalize.paymentId === paymentId ? "completed" : "conflict";
    }
    if (!claimedCampaign.modifiedCount && !claimAlreadyExists) {
      if (latestBeforeFinalize?.status === "settling" && latestBeforeFinalize.paymentId === paymentId) {
        const holdStillReserved = await Need.findOne({
          _id: contribution.needId,
          paymentReservations: { $elemMatch: { token: contribution.reservationToken } },
        }).select("paymentReservations").lean<Pick<NeedDocument, "paymentReservations"> | null>();
        const hold = holdStillReserved?.paymentReservations.find((item) => item.token === contribution.reservationToken);
        if (!hold) {
          const completedAfterPriorAttempt = await Contribution.updateOne(
            { _id: contribution._id, status: "settling", paymentId },
            { $set: { status: "completed" }, $unset: { reservationExpiresAt: 1 } },
          );
          return completedAfterPriorAttempt.modifiedCount ? "completed" : "conflict";
        }
        if (hold.settlementPaymentId && hold.settlementPaymentId !== paymentId) return "conflict";
      }
      await requireRefund(claimedContribution, paymentId);
      return "refund_required";
    }

    const finalized = await Need.updateOne(
      {
        _id: contribution.needId,
        paymentReservations: { $elemMatch: { token: contribution.reservationToken, settlementPaymentId: paymentId } },
      },
      {
        $inc: { raisedAmount: contribution.amount, reservedAmount: -contribution.amount },
        $pull: { paymentReservations: { token: contribution.reservationToken } },
      },
    );
    if (!finalized.modifiedCount) {
      const holdStillExists = await Need.exists({
        _id: contribution.needId,
        paymentReservations: { $elemMatch: { token: contribution.reservationToken, settlementPaymentId: paymentId } },
      });
      if (holdStillExists) return "conflict";
    }
    const completed = await Contribution.updateOne(
      { _id: contribution._id, status: "settling", paymentId },
      { $set: { status: "completed", receiptReference }, $unset: { reservationExpiresAt: 1 } },
    );
    if (!completed.modifiedCount) {
      const latest = await Contribution.findById(contribution._id);
      return latest?.status === "completed" && latest.paymentId === paymentId ? "completed" : "conflict";
    }
    return "completed";
  } finally {
    await session.endSession();
  }
}

export async function notifyConfirmedDonation(orderId: string): Promise<void> {
  const contribution = await Contribution.findOne({ orderId, kind: "donation", status: "completed" });
  if (!contribution) return;
  const need = await Need.findById(contribution.needId).select("organizationId");
  if (!need) return;
  const receiptReference = contribution.receiptReference ??
    `IM-${contribution.updatedAt.getUTCFullYear()}-${contribution._id.toString().slice(-8).toUpperCase()}`;
  if (!contribution.receiptReference) {
    await Contribution.updateOne(
      { _id: contribution._id, status: "completed", receiptReference: { $exists: false } },
      { $set: { receiptReference } },
    );
  }
  const recipients = [contribution.userId, need.organizationId];
  for (const recipientId of recipients) {
    const idempotencyKey = `money-donation-confirmed:${contribution._id.toString()}`;
    try {
      await Notification.updateOne(
        { recipientId, idempotencyKey },
        {
          $setOnInsert: {
            recipientId,
            type: "money_donation_confirmed",
            idempotencyKey,
            payload: {
              contributionId: contribution._id.toString(),
              needId: contribution.needId.toString(),
              status: "completed",
              receiptReference,
            },
            status: "sent",
          },
        },
        { upsert: true },
      );
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === 11000)) throw error;
    }
  }
}

export async function paymentWebhook(req: Request, res: Response) {
  if (!config.RAZORPAY_WEBHOOK_SECRET) {
    res.status(503).json({ message: "Payment webhook is not configured." });
    return;
  }
  const signature = req.header("x-razorpay-signature") ?? "";
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
  if (!verifyProviderSignature(rawBody, signature, config.RAZORPAY_WEBHOOK_SECRET)) {
    res.status(400).json({ message: "Invalid webhook signature." });
    return;
  }
  let event: {
    event?: string;
    payload?: {
      payment?: { entity?: { order_id?: string; id?: string; amount?: number; currency?: string; status?: string } };
    };
  };
  try {
    event = JSON.parse(rawBody.toString("utf8")) as typeof event;
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    res.status(400).json({ message: "Webhook payload is not valid JSON." });
    return;
  }
  if (!event || typeof event !== "object" || typeof event.event !== "string") {
    res.status(400).json({ message: "Webhook payload is malformed." });
    return;
  }
  const payment = event.payload?.payment?.entity;
  if (event.event === "payment.captured" || event.event === "payment.failed") {
    if (!payment || typeof payment.order_id !== "string" || typeof payment.id !== "string") {
      res.status(400).json({ message: "Webhook payment details are incomplete." });
      return;
    }
    if (event.event === "payment.captured") {
      if (!Number.isSafeInteger(payment.amount) || payment.amount! < 1 ||
          payment.currency !== "INR" || payment.status !== "captured") {
        res.status(400).json({ message: "Webhook payment amount, currency, or status is invalid." });
        return;
      }
      const result = await settlePayment(payment.order_id, payment.id, payment.amount);
      if (result === "not_found") {
        res.status(503).json({ message: "The order record is not ready yet. Retry this webhook delivery." });
        return;
      }
      if (result === "completed") await notifyConfirmedDonation(payment.order_id);
    } else {
      await releaseFailedOrder(payment.order_id);
    }
  }
  res.status(200).json({ received: true });
}

function formatNeed(document: PopulatedNeedDocument) {
  return {
    id: document._id.toString(),
    title: document.title,
    description: document.description,
    kind: document.kind,
    category: document.category,
    city: document.city,
    urgency: document.urgency,
    targetAmount: document.targetAmount,
    raisedAmount: document.raisedAmount,
    ...(document.targetAmount === undefined ? {} : {
      availableAmount: Math.max(0, document.targetAmount - document.raisedAmount - document.reservedAmount),
    }),
    volunteersNeeded: document.volunteersNeeded,
    volunteersJoined: document.volunteersJoined,
    createdAt: document.createdAt.toISOString(),
    organizationName: document.organizationId.name,
    organizationVerified: document.organizationId.organizationStatus === "verified",
  };
}

function itemDonationSummary(item: {
  _id: mongoose.Types.ObjectId;
  category: string;
  description: string;
  quantity: number;
  condition: string;
  city: string;
  status: string;
  pickupWindowStart: Date;
  pickupWindowEnd: Date;
  createdAt: Date;
  receiptReference?: string;
}) {
  return {
    id: item._id.toString(),
    category: item.category,
    description: item.description,
    quantity: item.quantity,
    condition: item.condition,
    city: item.city,
    status: item.status,
    pickupWindowStart: item.pickupWindowStart.toISOString(),
    pickupWindowEnd: item.pickupWindowEnd.toISOString(),
    createdAt: item.createdAt.toISOString(),
    ...(item.receiptReference ? { receiptReference: item.receiptReference } : {}),
  };
}

async function notifyItemDonation(
  recipientId: mongoose.Types.ObjectId | string,
  donationId: string,
  type: string,
  status: string,
  suffix = status,
): Promise<void> {
  const idempotencyKey = `item-donation:${donationId}:${suffix}:${recipientId.toString()}`;
  try {
    await Notification.updateOne(
      { recipientId, idempotencyKey },
      {
        $setOnInsert: {
          recipientId,
          type,
          idempotencyKey,
          payload: { donationId, status },
          status: "sent",
        },
      },
      { upsert: true },
    );
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === 11000)) throw error;
  }
}

function distanceBetweenKm(
  from: [number, number],
  to: [number, number],
): number {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const [longitude1, latitude1] = from;
  const [longitude2, latitude2] = to;
  const deltaLatitude = radians(latitude2 - latitude1);
  const deltaLongitude = radians(longitude2 - longitude1);
  const a = Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(radians(latitude1)) * Math.cos(radians(latitude2)) * Math.sin(deltaLongitude / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function createItemPickupOffers(
  donation: {
    _id: mongoose.Types.ObjectId;
    ngoId: mongoose.Types.ObjectId;
    category: string;
    city: string;
    location?: { type: "Point"; coordinates: [number, number] };
  },
  actorId: string,
): Promise<number> {
  const now = new Date();
  const volunteers = await User.find({
    role: "volunteer",
    accountStatus: "active",
    volunteerEligibility: "eligible",
    volunteerTaskOptIn: true,
  }).select("_id city skills categories volunteerLocation volunteerServiceArea volunteerServiceRadiusKm maxActiveAssignments activeVolunteerAssignmentCount");
  const category = donation.category.toLowerCase().replaceAll("_", " ");
  const categoryTerms: Record<string, string[]> = {
    clothes_footwear: ["clothes", "clothing", "footwear"],
    furniture: ["furniture", "household"],
    books_education: ["books", "education", "teaching"],
    household_essentials: ["household", "essentials", "supplies"],
    food_supplies: ["food", "supplies", "nutrition"],
    other: ["other", "general", "supplies"],
  };
  const terms = categoryTerms[donation.category] ?? [category];
  const eligible = volunteers.flatMap((volunteer) => {
    const activeCount = volunteer.activeVolunteerAssignmentCount ?? 0;
    if (activeCount >= (volunteer.maxActiveAssignments ?? 3)) return [];
    const tags = [...(volunteer.skills ?? []), ...(volunteer.categories ?? [])].map((tag) => tag.toLowerCase());
    if (!tags.some((tag) => terms.some((term) => tag.includes(term) || term.includes(tag)))) return [];
    let distanceKm: number | undefined;
    if (donation.location && volunteer.volunteerLocation) {
      distanceKm = distanceBetweenKm(donation.location.coordinates, volunteer.volunteerLocation.coordinates);
      if (distanceKm > Math.min(config.VOLUNTEER_MATCH_RADIUS_KM, volunteer.volunteerServiceRadiusKm ?? config.VOLUNTEER_MATCH_RADIUS_KM)) return [];
    } else {
      const locationText = `${volunteer.city} ${volunteer.volunteerServiceArea ?? ""}`.toLowerCase();
      if (!locationText.includes(donation.city.toLowerCase())) return [];
    }
    return [{
      volunteer,
      distanceKm,
      explanation: [
        `Category match: ${category}`,
        distanceKm === undefined ? `Service area includes ${donation.city}` : `Pickup is about ${distanceKm.toFixed(1)} km away`,
        "Volunteer opted in and has assignment capacity",
      ],
    }];
  }).sort((left, right) => (left.distanceKm ?? Number.MAX_SAFE_INTEGER) - (right.distanceKm ?? Number.MAX_SAFE_INTEGER))
    .slice(0, config.VOLUNTEER_MATCH_MAX_OFFERS);
  const expiresAt = new Date(now.getTime() + config.VOLUNTEER_OFFER_TTL_HOURS * 60 * 60 * 1000);
  let created = 0;
  for (const match of eligible) {
    let assignment;
    try {
      assignment = await ItemPickupAssignment.create({
        donationId: donation._id,
        ngoId: donation.ngoId,
        volunteerId: match.volunteer._id,
        status: "offered",
        offerExpiresAt: expiresAt,
        ...(match.distanceKm === undefined ? {} : { distanceKm: match.distanceKm }),
        matchExplanation: match.explanation,
        history: [{ status: "offered", actorId, occurredAt: now }],
      });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === 11000) continue;
      throw error;
    }
    await notifyItemDonation(match.volunteer._id, donation._id.toString(), "item_pickup_offer", "offered", `offer:${assignment._id.toString()}`);
    created++;
  }
  return created;
}

async function getImpactOverview() {
  const [totalNgos, verifiedNgos, pendingNgos, volunteers, users, funds, activeTasks, completedHelpRequests, cities, monthly, userMonths, causes] = await Promise.all([
    User.countDocuments({ role: "ngo" }),
    User.countDocuments({ role: "ngo", organizationStatus: "verified" }),
    User.countDocuments({ role: "ngo", organizationStatus: { $in: ["pending", "pending_review", "resubmission_required"] } }),
    User.countDocuments({ role: "volunteer" }),
    User.countDocuments({ role: { $in: ["volunteer", "donor", "ngo"] } }),
    Contribution.aggregate([
      { $match: { kind: "donation", status: "completed" } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]),
    User.distinct("_id", { role: "ngo", organizationStatus: "verified" }).then((organizationIds) =>
      Need.countDocuments({ status: "open", organizationId: { $in: organizationIds } }),
    ),
    HelpRequest.countDocuments({ status: "completed" }),
    User.distinct("city", { role: "ngo", organizationStatus: "verified" }),
    Contribution.aggregate([
      { $match: { kind: "donation", status: "completed" } },
      { $group: { _id: { $dateToString: { format: "%Y-%m", date: "$createdAt" } }, total: { $sum: "$amount" } } },
      { $sort: { _id: -1 } },
      { $limit: 12 },
      { $sort: { _id: 1 } },
    ]),
    User.aggregate([
      { $match: { role: { $in: ["volunteer", "donor", "ngo"] } } },
      { $group: { _id: { $dateToString: { format: "%Y-%m", date: "$createdAt" } }, total: { $sum: 1 } } },
      { $sort: { _id: -1 } },
      { $limit: 12 },
      { $sort: { _id: 1 } },
    ]),
    Contribution.aggregate([
      { $match: { kind: "donation", status: "completed" } },
      { $lookup: { from: "needs", localField: "needId", foreignField: "_id", as: "need" } },
      { $unwind: "$need" },
      { $group: { _id: "$need.category", total: { $sum: "$amount" } } },
      { $sort: { total: -1 } },
      { $limit: 8 },
    ]),
  ]);
  const recentMonths = Array.from({ length: 12 }, (_, index) => {
    const date = new Date();
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() - 11 + index);
    return date.toISOString().slice(0, 7);
  });
  const donationsByMonth = new Map<string, number>(monthly.map((item: { _id: string; total: number }) => [item._id, item.total] as const));
  const usersByMonth = new Map<string, number>(userMonths.map((item: { _id: string; total: number }) => [item._id, item.total] as const));
  return {
    totalNgos,
    verifiedNgos,
    pendingNgos,
    volunteers,
    users,
    fundsRaised: funds[0]?.total ?? 0,
    activeTasks,
    completedHelpRequests,
    participatingCities: cities.length,
    donationMonths: recentMonths.map((month) => ({ month, total: donationsByMonth.get(month) ?? 0 })),
    userMonths: recentMonths.map((month) => ({ month, total: usersByMonth.get(month) ?? 0 })),
    causes: causes.map((item: { _id: string; total: number }) => ({ cause: item._id, total: item.total })),
  };
}

export function createApiRouter(): Router {
  const router = createRouter();

  router.get("/requests/upload-policy", requireAuth, requireRole("user"), (_req, res) => {
    res.json({
      maxFileBytes: config.UPLOAD_MAX_BYTES,
      maxFiles: config.UPLOAD_MAX_FILES,
      contentTypes: Object.keys(requestFileTypes),
    });
  });

  router.post("/requests", requireAuth, requireRole("user"), async (req, res) => {
    const parsed = helpRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Check the help request details." });
      return;
    }
    const data = parsed.data;
    const request = await HelpRequest.create({
      requesterId: req.user!.id,
      title: data.title,
      description: data.description,
      category: data.category,
      urgency: data.urgency,
      peopleCount: data.peopleCount,
      city: data.city,
      addressLine: data.addressLine,
      ...(data.coordinates ? {
        location: { type: "Point", coordinates: [data.coordinates.longitude, data.coordinates.latitude] },
      } : {}),
      preferredContactMethod: data.preferredContactMethod,
      consentToProcess: data.consentToProcess,
      status: "submitted",
      screeningStatus: "pending",
      timeline: [{ status: "submitted", actorId: req.user!.id, occurredAt: new Date() }],
    });
    await recordAuditEvent({
      actorId: req.user!.id,
      action: "help_request.submitted",
      resourceType: "help_request",
      resourceId: request._id.toString(),
      newStatus: "submitted",
    });
    await Notification.create({
      recipientId: req.user!.id,
      type: "help_request_submitted",
      idempotencyKey: `help-request-submitted:${request._id.toString()}`,
      payload: { requestId: request._id.toString(), status: "submitted" },
      status: "sent",
    });
    res.status(201).json({ request: requestSummary(request), referenceId: request._id.toString() });
  });

  router.get("/requests/:id/matches", requireAuth, requireRole("user"), async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) {
      res.status(404).json({ message: "Help request not found." });
      return;
    }
    const request = await HelpRequest.findOne({ _id: req.params.id, requesterId: req.user!.id });
    if (!request) {
      res.status(404).json({ message: "Help request not found." });
      return;
    }
    if (!["pending_ngo_review", "rejected"].includes(request.status)) {
      res.status(409).json({ message: "NGO matching is available when the request is awaiting an organization." });
      return;
    }
    if (request.assignedOrganizationId) {
      const assigned = await User.findOne({
        _id: request.assignedOrganizationId,
        role: "ngo",
        organizationStatus: "verified",
      }).select("name");
      res.json({
        radiusKm: config.NGO_MATCH_RADIUS_KM,
        matches: [],
        ...(assigned ? { assignedOrganization: { id: assigned._id.toString(), name: assigned.name } } : {}),
      });
      return;
    }
    const matches = await matchVerifiedNgos(request);
    res.json({
      radiusKm: config.NGO_MATCH_RADIUS_KM,
      matches: matches.map((match) => ({
        id: match.organization._id.toString(),
        name: match.organization.name,
        city: match.organization.city,
        serviceArea: match.organization.serviceArea ?? "",
        categories: match.organization.categories ?? [],
        ...(match.distanceKm !== undefined ? { distanceKm: Math.round(match.distanceKm * 10) / 10 } : {}),
        currentlyAccepting: match.organization.acceptingRequests !== false,
        reasons: match.reasons,
      })),
    });
  });

  router.post("/requests/:id/route", requireAuth, requireRole("user"), async (req, res) => {
    const parsed = routeRequestSchema.safeParse(req.body);
    if (!parsed.success || !mongoose.isValidObjectId(req.params.id)) {
      res.status(400).json({ message: parsed.success ? "Choose a valid help request." : parsed.error.issues[0]?.message ?? "Choose a verified organization." });
      return;
    }
    const request = await HelpRequest.findOne({ _id: req.params.id, requesterId: req.user!.id });
    if (!request) {
      res.status(404).json({ message: "Help request not found." });
      return;
    }
    if (!["pending_ngo_review", "rejected"].includes(request.status) || request.assignedOrganizationId) {
      res.status(409).json({ message: "This request is already routed or cannot be reassigned yet." });
      return;
    }
    const eligible = await findEligibleNgoForRequest(request, parsed.data.organizationId);
    if (!eligible) {
      res.status(409).json({ message: "That organization is no longer eligible for this request. Refresh the recommendations." });
      return;
    }
    const routed = await routeHelpRequestToNgo({
      requestId: request._id.toString(),
      requesterId: req.user!.id,
      organizationId: parsed.data.organizationId,
    });
    if (!routed) {
      res.status(409).json({ message: "This request was routed or changed by another action. Refresh its status." });
      return;
    }
    res.json({ request: requestSummary(routed), organization: { id: eligible.organization._id.toString(), name: eligible.organization.name } });
  });

  router.get("/ngo/requests", requireAuth, requireRole("ngo"), async (req, res) => {
    const organization = await User.findOne({ _id: req.user!.id, role: "ngo", organizationStatus: "verified" }).select("_id");
    if (!organization) {
      res.status(403).json({ message: "Only verified organizations can review help requests." });
      return;
    }
    const requests = await HelpRequest.find({
      assignedOrganizationId: organization._id,
      status: {
        $in: [
          "pending_ngo_review",
          "under_review",
          "needs_information",
          "flagged_for_review",
          "approved",
          "matching_volunteer",
          "assigned",
          "in_progress",
          "pending_completion_review",
          "more_evidence_required",
        ],
      },
    }).sort({ createdAt: 1 }).limit(100);
    res.json({
      requests: requests.map((request) => ({
        id: request._id.toString(),
        reference: request._id.toString().slice(-8).toUpperCase(),
        title: request.title,
        category: request.category,
        descriptionSummary: request.description.slice(0, 240),
        urgency: request.urgency,
        peopleCount: request.peopleCount,
        city: request.city,
        status: request.status,
        screeningStatus: request.screeningStatus,
        reviewFlags: request.screening?.reasons ?? [],
        createdAt: request.createdAt.toISOString(),
      })),
    });
  });

  router.get("/ngo/requests/:id", requireAuth, requireRole("ngo"), async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) {
      res.status(404).json({ message: "Help request not found." });
      return;
    }
    const organization = await User.findOne({ _id: req.user!.id, role: "ngo", organizationStatus: "verified" }).select("_id");
    const request = organization
      ? await HelpRequest.findOne({ _id: req.params.id, assignedOrganizationId: organization._id })
      : null;
    if (!request) {
      res.status(404).json({ message: "This request is not routed to your verified organization." });
      return;
    }
    const documents = await RequestDocument.find({ helpRequestId: request._id })
      .select("originalName contentType byteSize status ocrStatus ocrProvider ocrProcessedAt +ocrError")
      .sort({ createdAt: 1 });
    res.json({
      request: {
        id: request._id.toString(),
        reference: request._id.toString().slice(-8).toUpperCase(),
        title: request.title,
        description: request.description,
        category: request.category,
        urgency: request.urgency,
        peopleCount: request.peopleCount,
        city: request.city,
        ...(request.addressLine ? { addressLine: request.addressLine } : {}),
        preferredContactMethod: request.preferredContactMethod,
        status: request.status,
        screeningStatus: request.screeningStatus,
        screening: request.screening ? {
          reasons: request.screening.reasons,
          missingFields: request.screening.missingFields,
          additionalInformation: request.screening.additionalInformation,
          assessedAt: request.screening.assessedAt.toISOString(),
        } : null,
        timeline: request.timeline.map((event) => ({
          status: event.status,
          ...(event.reason ? { reason: event.reason } : {}),
          occurredAt: event.occurredAt.toISOString(),
        })),
        createdAt: request.createdAt.toISOString(),
      },
      documents: documents.map((document) => ({
        id: document._id.toString(),
        name: document.originalName,
        contentType: document.contentType,
        byteSize: document.byteSize,
        ocrStatus: document.ocrStatus,
        ...(document.ocrProvider ? { ocrProvider: document.ocrProvider } : {}),
      })),
    });
  });

  router.patch("/ngo/requests/:id/review", requireAuth, requireRole("ngo"), async (req, res) => {
    const parsed = ngoRequestReviewSchema.safeParse(req.body);
    if (!parsed.success || !mongoose.isValidObjectId(req.params.id)) {
      res.status(400).json({ message: parsed.success ? "Choose a valid help request." : parsed.error.issues[0]?.message ?? "Check the review decision." });
      return;
    }
    const organization = await User.findOne({ _id: req.user!.id, role: "ngo", organizationStatus: "verified" }).select("_id");
    if (!organization) {
      res.status(403).json({ message: "Only verified organizations can review help requests." });
      return;
    }
    const request = await HelpRequest.findOne({ _id: req.params.id, assignedOrganizationId: organization._id });
    if (!request) {
      res.status(404).json({ message: "This request is not routed to your organization." });
      return;
    }
    if (parsed.data.action === "decline") {
      const declined = await declineNgoRequest({
        requestId: request._id.toString(),
        actorId: req.user!.id,
        organizationId: organization._id.toString(),
        reason: parsed.data.reason!,
      });
      if (!declined) {
        res.status(409).json({ message: "This request changed before your decision was recorded." });
        return;
      }
      res.json({ request: requestSummary(declined) });
      return;
    }
    const destination = {
      start_review: "under_review",
      approve: "approved",
      needs_information: "needs_information",
      flag_for_review: "flagged_for_review",
    } as const;
    const updated = await transitionHelpRequestStatus({
      requestId: request._id.toString(),
      actorId: req.user!.id,
      expectedOrganizationId: organization._id.toString(),
      to: destination[parsed.data.action],
      ...(parsed.data.reason ? { reason: parsed.data.reason } : {}),
    });
    if (!updated) {
      res.status(409).json({ message: "This request status changed or this action is not allowed now." });
      return;
    }
    res.json({ request: requestSummary(updated) });
  });

  router.post("/ngo/requests/:id/volunteer-matches", requireAuth, requireRole("ngo"), volunteerTaskLimiter, async (req, res) => {
    const parsed = volunteerMatchingSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Choose a valid task deadline." });
      return;
    }
    if (!mongoose.isValidObjectId(req.params.id)) {
      res.status(404).json({ message: "Help request not found." });
      return;
    }
    const organization = await User.findOne({ _id: req.user!.id, role: "ngo", organizationStatus: "verified" }).select("_id");
    const request = organization
      ? await HelpRequest.findOne({
        _id: req.params.id,
        assignedOrganizationId: organization._id,
        status: { $in: ["approved", "matching_volunteer"] },
        $or: [{ assignedVolunteerId: { $exists: false } }, { assignedVolunteerId: null }],
      })
      : null;
    if (!request) {
      res.status(404).json({ message: "Only an unassigned, approved request routed to your verified organization can be matched." });
      return;
    }
    const matchingRequest = parsed.data.deadlineAt
      ? await HelpRequest.findOneAndUpdate(
        { _id: request._id, assignedOrganizationId: organization!._id, status: request.status, $or: [{ assignedVolunteerId: { $exists: false } }, { assignedVolunteerId: null }] },
        { $set: { volunteerDeadlineAt: new Date(parsed.data.deadlineAt) } },
        { new: true },
      )
      : request;
    if (!matchingRequest) {
      res.status(409).json({ message: "Request changed before matching could start." });
      return;
    }
    await expireVolunteerOffers();
    const offers = await offerRequestToEligibleVolunteers(matchingRequest, req.user!.id);
    const volunteers = await User.find({ _id: { $in: offers.map((offer) => offer.volunteerId) } })
      .select("_id city skills categories")
      .lean<Array<Pick<UserDocument, "_id" | "city" | "skills" | "categories">>>();
    const profiles = new Map(volunteers.map((volunteer) => [volunteer._id.toString(), volunteer]));
    res.json({
      radiusKm: config.VOLUNTEER_MATCH_RADIUS_KM,
      ...(matchingRequest.volunteerDeadlineAt ? { deadlineAt: matchingRequest.volunteerDeadlineAt.toISOString() } : {}),
      offers: offers.map((offer) => {
        const profile = profiles.get(offer.volunteerId);
        return {
          assignmentId: offer.assignmentId,
          city: profile?.city ?? "",
          skills: [...(profile?.skills ?? []), ...(profile?.categories ?? [])],
          ...(offer.distanceKm === undefined ? {} : { distanceKm: Math.round(offer.distanceKm * 10) / 10 }),
          explanation: offer.explanation,
          expiresAt: offer.expiresAt.toISOString(),
        };
      }),
    });
  });

  router.get("/ngo/requests/:id/assignments", requireAuth, requireRole("ngo"), async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) {
      res.status(404).json({ message: "Help request not found." });
      return;
    }
    const activeOrganization = await User.exists({ _id: req.user!.id, role: "ngo", organizationStatus: "verified" });
    if (!activeOrganization) {
      res.status(403).json({ message: "Only verified organizations can monitor volunteer assignments." });
      return;
    }
    const request = await HelpRequest.findOne({ _id: req.params.id, assignedOrganizationId: req.user!.id });
    if (!request) {
      res.status(404).json({ message: "This request is not routed to your organization." });
      return;
    }
    await expireVolunteerOffers();
    const assignments = await VolunteerAssignment.find({ requestId: request._id })
      .sort({ createdAt: -1 })
      .limit(100);
    const assigned = assignments.find((item) => item.volunteerId.toString() === request.assignedVolunteerId?.toString());
    const volunteer = assigned
      ? await User.findOne({ _id: assigned.volunteerId, role: "volunteer", accountStatus: "active" })
        .select("name city skills categories volunteerEligibility")
      : null;
    res.json({
      requestStatus: request.status,
      completionEvidenceChecklist: request.completionEvidenceChecklist ?? [],
      assignments: assignments.map((item) => ({
        id: item._id.toString(),
        status: item.status,
        ...(item.status === "offered" && item.offerExpiresAt ? { offerExpiresAt: item.offerExpiresAt.toISOString() } : {}),
        ...(item.acceptedAt ? { acceptedAt: item.acceptedAt.toISOString() } : {}),
        ...(item.startedAt ? { startedAt: item.startedAt.toISOString() } : {}),
        ...(item.submittedAt ? { submittedAt: item.submittedAt.toISOString() } : {}),
        ...(item.progressNote ? { progressNote: item.progressNote } : {}),
        isOverdue: Boolean(request.volunteerDeadlineAt && request.volunteerDeadlineAt.getTime() < Date.now() &&
          ["accepted", "in_progress"].includes(item.status)),
        ...(item.status === "accepted" || item.status === "in_progress" || item.status === "submitted_for_review"
          ? {
            volunteer: volunteer ? {
              name: volunteer.name,
              city: volunteer.city,
              skills: [...(volunteer.skills ?? []), ...(volunteer.categories ?? [])],
            } : undefined,
          }
          : {}),
      })),
    });
  });

  router.patch("/ngo/requests/:id/completion-evidence-checklist", requireAuth, requireRole("ngo"), volunteerTaskLimiter, async (req, res) => {
    const parsed = completionChecklistSchema.safeParse(req.body);
    if (!parsed.success || !mongoose.isValidObjectId(req.params.id)) {
      res.status(400).json({ message: parsed.success ? "Choose a valid request." : parsed.error.issues[0]?.message ?? "Enter a valid checklist." });
      return;
    }
    const verifiedOrganization = await User.exists({ _id: req.user!.id, role: "ngo", organizationStatus: "verified" });
    if (!verifiedOrganization) {
      res.status(403).json({ message: "Only verified organizations can set completion requirements." });
      return;
    }
    const request = await HelpRequest.findOneAndUpdate(
      {
        _id: req.params.id,
        assignedOrganizationId: req.user!.id,
        status: { $in: ["approved", "matching_volunteer", "assigned", "in_progress"] },
      },
      { $set: { completionEvidenceChecklist: parsed.data.items } },
      { new: true },
    );
    if (!request) {
      res.status(409).json({ message: "The checklist can be changed only for your routed request before completion evidence is submitted." });
      return;
    }
    await recordAuditEvent({
      actorId: req.user!.id,
      action: "help_request.completion_checklist_updated",
      resourceType: "help_request",
      resourceId: request._id.toString(),
    });
    res.json({ completionEvidenceChecklist: request.completionEvidenceChecklist ?? [] });
  });

  router.post("/ngo/requests/:id/assignments/:assignmentId/reassign", requireAuth, requireRole("ngo"), volunteerTaskLimiter, async (req, res) => {
    const parsed = volunteerAssignmentReasonSchema.safeParse(req.body);
    if (!parsed.success || !mongoose.isValidObjectId(req.params.id) || !mongoose.isValidObjectId(req.params.assignmentId)) {
      res.status(400).json({ message: parsed.success ? "Choose a valid assignment." : parsed.error.issues[0]?.message ?? "Add a reason for reassignment." });
      return;
    }
    const activeOrganization = await User.exists({ _id: req.user!.id, role: "ngo", organizationStatus: "verified" });
    if (!activeOrganization) {
      res.status(403).json({ message: "Only verified organizations can reassign tasks." });
      return;
    }
    const request = await HelpRequest.findOne({ _id: req.params.id, assignedOrganizationId: req.user!.id });
    const assignment = request
      ? await VolunteerAssignment.findOne({ _id: req.params.assignmentId, requestId: request._id, ngoId: req.user!.id })
      : null;
    if (!assignment || !request) {
      res.status(404).json({ message: "Assignment not found for your organization." });
      return;
    }
    const ended = await endVolunteerAssignment({
      assignmentId: assignment._id.toString(),
      actorId: req.user!.id,
      actorRole: "ngo",
      reason: parsed.data.reason,
      status: "reassigned",
    });
    if (!ended) {
      res.status(409).json({ message: "This assignment is no longer active or has changed." });
      return;
    }
    await expireVolunteerOffers();
    const offers = await offerRequestToEligibleVolunteers(ended.request, req.user!.id);
    res.json({
      request: requestSummary(ended.request),
      offeredCount: offers.length,
      assignments: offers.map((offer) => ({ id: offer.assignmentId, expiresAt: offer.expiresAt.toISOString() })),
    });
  });

  router.post("/ngo/requests/:id/assignments/:assignmentId/cancel", requireAuth, requireRole("ngo"), volunteerTaskLimiter, async (req, res) => {
    const parsed = volunteerAssignmentReasonSchema.safeParse(req.body);
    if (!parsed.success || !mongoose.isValidObjectId(req.params.id) || !mongoose.isValidObjectId(req.params.assignmentId)) {
      res.status(400).json({ message: parsed.success ? "Choose a valid assignment." : parsed.error.issues[0]?.message ?? "Add a cancellation reason." });
      return;
    }
    const activeOrganization = await User.exists({ _id: req.user!.id, role: "ngo", organizationStatus: "verified" });
    if (!activeOrganization) {
      res.status(403).json({ message: "Only verified organizations can cancel assignments." });
      return;
    }
    const request = await HelpRequest.findOne({ _id: req.params.id, assignedOrganizationId: req.user!.id });
    const assignment = request
      ? await VolunteerAssignment.findOne({ _id: req.params.assignmentId, requestId: request._id, ngoId: req.user!.id })
      : null;
    if (!assignment || !request) {
      res.status(404).json({ message: "Assignment not found for your organization." });
      return;
    }
    const ended = await endVolunteerAssignment({
      assignmentId: assignment._id.toString(),
      actorId: req.user!.id,
      actorRole: "ngo",
      reason: parsed.data.reason,
      status: "cancelled",
    });
    if (!ended) {
      res.status(409).json({ message: "This assignment is no longer active or has changed." });
      return;
    }
    res.json({ request: requestSummary(ended.request), assignment: { id: ended.assignment._id.toString(), status: ended.assignment.status } });
  });

  router.get("/ngo/completion-reviews", requireAuth, requireRole("ngo"), async (req, res) => {
    const activeOrganization = await User.exists({ _id: req.user!.id, role: "ngo", organizationStatus: "verified" });
    if (!activeOrganization) {
      res.status(403).json({ message: "Only verified organizations can review completion evidence." });
      return;
    }
    const assignments = await VolunteerAssignment.find({ ngoId: req.user!.id, status: "submitted_for_review" })
      .sort({ submittedAt: -1 })
      .limit(100);
    const rows = await Promise.all(assignments.map(async (assignment) => {
      const [request, proof] = await Promise.all([
        HelpRequest.findOne({
          _id: assignment.requestId,
          assignedOrganizationId: req.user!.id,
          assignedVolunteerId: assignment.volunteerId,
          status: "pending_completion_review",
        }).select("_id title category urgency peopleCount city"),
        CompletionProof.findOne({ assignmentId: assignment._id, status: "submitted" })
          .sort({ submittedAt: -1 })
          .select("summary submittedAt aiReview unresolvedIssues"),
      ]);
      if (!request || !proof) return null;
      return {
        assignmentId: assignment._id.toString(),
        requestId: request._id.toString(),
        reference: request._id.toString(),
        title: request.title,
        category: request.category,
        urgency: request.urgency,
        peopleCount: request.peopleCount,
        city: request.city,
        summary: proof.summary || request.title,
        submittedAt: proof.submittedAt.toISOString(),
        ...(proof.unresolvedIssues ? { unresolvedIssues: proof.unresolvedIssues } : {}),
        aiRecommendation: proof.aiReview?.recommendation ?? "provider_unavailable",
      };
    }));
    res.json({ reviews: rows.filter((item): item is NonNullable<typeof item> => item !== null) });
  });

  router.get("/ngo/assignments/:id/completion-review", requireAuth, requireRole("ngo"), async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) {
      res.status(404).json({ message: "Completion review not found." });
      return;
    }
    const activeOrganization = await User.exists({ _id: req.user!.id, role: "ngo", organizationStatus: "verified" });
    if (!activeOrganization) {
      res.status(403).json({ message: "Only verified organizations can review completion evidence." });
      return;
    }
    const assignment = await VolunteerAssignment.findOne({
      _id: req.params.id,
      ngoId: req.user!.id,
      status: "submitted_for_review",
    });
    const request = assignment
      ? await HelpRequest.findOne({
        _id: assignment.requestId,
        assignedOrganizationId: req.user!.id,
        assignedVolunteerId: assignment.volunteerId,
        status: "pending_completion_review",
      })
      : null;
    const proof = assignment && request
      ? await CompletionProof.findOne({ assignmentId: assignment._id, requestId: request._id, submittedBy: assignment.volunteerId, status: "submitted" })
        .sort({ submittedAt: -1 })
      : null;
    if (!assignment || !request || !proof) {
      res.status(404).json({ message: "This completion review is not available to your organization." });
      return;
    }
    const evidence = await AssignmentEvidence.find(proof.evidenceIds?.length
      ? {
        _id: { $in: proof.evidenceIds },
        requestId: request._id,
        assignmentId: assignment._id,
        uploadedBy: assignment.volunteerId,
      }
      : {
        privateObjectKey: { $in: proof.privateObjectKeys },
        assignmentId: assignment._id,
        uploadedBy: assignment.volunteerId,
      }).sort({ createdAt: 1 });
    await recordAuditEvent({
      actorId: req.user!.id,
      action: "completion_proof.reviewed_details_viewed",
      resourceType: "completion_proof",
      resourceId: proof._id.toString(),
    });
    res.setHeader("Cache-Control", "private, no-store");
    res.json({
      assignment: {
        id: assignment._id.toString(),
        status: assignment.status,
        submittedAt: assignment.submittedAt?.toISOString(),
        history: assignment.history.map((item) => ({
          status: item.status,
          ...(item.reason ? { reason: item.reason } : {}),
          occurredAt: item.occurredAt.toISOString(),
        })),
      },
      request: {
        id: request._id.toString(),
        reference: request._id.toString(),
        title: request.title,
        category: request.category,
        urgency: request.urgency,
        peopleCount: request.peopleCount,
        city: request.city,
        description: request.description,
        status: request.status,
        completionEvidenceChecklist: request.completionEvidenceChecklist ?? [],
        timeline: request.timeline.map((item) => ({
          status: item.status,
          ...(item.reason ? { reason: item.reason } : {}),
          occurredAt: item.occurredAt.toISOString(),
        })),
      },
      proof: {
        id: proof._id.toString(),
        summary: proof.summary || request.title,
        report: proof.report,
        completedAt: proof.completedAt?.toISOString() ?? proof.submittedAt.toISOString(),
        submittedAt: proof.submittedAt.toISOString(),
        ...(proof.unresolvedIssues ? { unresolvedIssues: proof.unresolvedIssues } : {}),
        ...(proof.recipientConfirmed === undefined ? {} : { recipientConfirmed: proof.recipientConfirmed }),
        aiReview: proof.aiReview ? {
          recommendation: proof.aiReview.recommendation,
          findings: proof.aiReview.findings,
          missingEvidence: proof.aiReview.missingEvidence,
          uncertainty: proof.aiReview.uncertainty,
          provider: proof.aiReview.provider,
          ...(proof.aiReview.model ? { model: proof.aiReview.model } : {}),
          ...(proof.aiReview.confidence === undefined ? {} : { confidence: proof.aiReview.confidence }),
          assessedAt: proof.aiReview.assessedAt?.toISOString(),
        } : null,
        reviewHistory: proof.reviewHistory.map((item) => ({
          status: item.status,
          ...(item.reason ? { reason: item.reason } : {}),
          occurredAt: item.occurredAt.toISOString(),
        })),
      },
      evidence: evidence.map((item) => ({
        id: item._id.toString(),
        name: item.originalName,
        contentType: item.contentType,
        byteSize: item.byteSize,
        createdAt: item.createdAt.toISOString(),
      })),
    });
  });

  router.post("/ngo/assignments/:id/completion-review", requireAuth, requireRole("ngo"), volunteerTaskLimiter, async (req, res) => {
    const parsed = completionReviewSchema.safeParse(req.body);
    const assignmentId = validRouteObjectId(req, "id");
    if (!parsed.success || !assignmentId) {
      res.status(400).json({ message: parsed.success ? "Choose a valid assignment." : parsed.error.issues[0]?.message ?? "Complete the review decision." });
      return;
    }
    const activeOrganization = await User.exists({ _id: req.user!.id, role: "ngo", organizationStatus: "verified" });
    if (!activeOrganization) {
      res.status(403).json({ message: "Only verified organizations can make completion decisions." });
      return;
    }
    const result = await reviewCompletionProof({
      assignmentId,
      organizationId: req.user!.id,
      actorId: req.user!.id,
      action: parsed.data.action,
      reason: parsed.data.reason,
      resolveOutstandingIssues: parsed.data.resolveOutstandingIssues,
    });
    if ("error" in result) {
      res.status(409).json({ message: result.error });
      return;
    }
    res.json(result);
  });

  router.get("/ngo/assignments/:id/evidence", requireAuth, requireRole("ngo"), async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) {
      res.status(404).json({ message: "Assignment evidence not found." });
      return;
    }
    const activeOrganization = await User.exists({ _id: req.user!.id, role: "ngo", organizationStatus: "verified" });
    if (!activeOrganization) {
      res.status(403).json({ message: "Only verified organizations can review assignment evidence." });
      return;
    }
    const assignment = await VolunteerAssignment.findOne({
      _id: req.params.id,
      ngoId: req.user!.id,
      status: "submitted_for_review",
    });
    const request = assignment
      ? await HelpRequest.findOne({
        _id: assignment.requestId,
        assignedOrganizationId: req.user!.id,
        assignedVolunteerId: assignment.volunteerId,
        status: "pending_completion_review",
      }).select("_id")
      : null;
    if (!assignment || !request) {
      res.status(404).json({ message: "Submitted evidence is available only to the assigned verified NGO." });
      return;
    }
    const proof = await CompletionProof.findOne({ assignmentId: assignment._id, status: "submitted" });
    const evidence = await AssignmentEvidence.find(proof?.evidenceIds?.length
      ? { _id: { $in: proof.evidenceIds }, requestId: request._id, assignmentId: assignment._id }
      : { privateObjectKey: { $in: proof?.privateObjectKeys ?? [] }, assignmentId: assignment._id })
      .sort({ createdAt: 1 });
    await recordAuditEvent({
      actorId: req.user!.id,
      action: "completion_evidence.listed",
      resourceType: "volunteer_assignment",
      resourceId: assignment._id.toString(),
    });
    res.json({
      report: proof?.report ?? "",
      evidence: evidence.map((item) => ({
        id: item._id.toString(),
        name: item.originalName,
        contentType: item.contentType,
        byteSize: item.byteSize,
      })),
    });
  });

  router.get("/ngo/assignments/:id/evidence/:evidenceId/content", requireAuth, requireRole("ngo"), async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id) || !mongoose.isValidObjectId(req.params.evidenceId)) {
      res.status(404).json({ message: "Evidence not found." });
      return;
    }
    const activeOrganization = await User.exists({ _id: req.user!.id, role: "ngo", organizationStatus: "verified" });
    if (!activeOrganization) {
      res.status(403).json({ message: "Only verified organizations can access assignment evidence." });
      return;
    }
    const assignment = await VolunteerAssignment.findOne({ _id: req.params.id, ngoId: req.user!.id, status: "submitted_for_review" });
    const request = assignment
      ? await HelpRequest.findOne({ _id: assignment.requestId, assignedOrganizationId: req.user!.id, assignedVolunteerId: assignment.volunteerId, status: "pending_completion_review" }).select("_id")
      : null;
    const evidence = assignment && request
      ? await AssignmentEvidence.findOne({ _id: req.params.evidenceId, assignmentId: assignment._id })
      : null;
    if (!evidence) {
      res.status(404).json({ message: "Evidence not found." });
      return;
    }
    await recordAuditEvent({
      actorId: req.user!.id,
      action: "completion_evidence.downloaded",
      resourceType: "assignment_evidence",
      resourceId: evidence._id.toString(),
    });
    const content = await readPrivateObject(evidence.privateObjectKey);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", `attachment; filename="${evidence.originalName.replace(/["\r\n]/g, "_")}"`);
    res.type(evidence.contentType).send(content);
  });

  router.get("/requests/mine", requireAuth, requireRole("user"), async (req, res) => {
    const requests = await HelpRequest.find({ requesterId: req.user!.id })
      .sort({ createdAt: -1 })
      .limit(100);
    res.json({ requests: requests.map((request) => ({
      id: request._id.toString(),
      title: request.title,
      category: request.category,
      urgency: request.urgency,
      peopleCount: request.peopleCount,
      city: request.city,
      status: request.status,
      screeningStatus: request.screeningStatus,
      createdAt: request.createdAt.toISOString(),
      updatedAt: request.updatedAt.toISOString(),
    })) });
  });

  router.get("/requests/:id", requireAuth, async (req, res) => {
    const requestId = validRouteObjectId(req, "id");
    if (!requestId) {
      res.status(404).json({ message: "Help request not found." });
      return;
    }
    const request = await findRequestForViewer(requestId, req.user!.id, req.user!.role);
    if (!request) {
      res.status(404).json({ message: "Help request not found." });
      return;
    }
    const documents = await RequestDocument.find({ helpRequestId: request._id })
      .select("originalName contentType byteSize status ocrStatus ocrProvider ocrProcessedAt +ocrError")
      .sort({ createdAt: 1 });
    const assignedOrganization = request.assignedOrganizationId
      ? await User.findOne({ _id: request.assignedOrganizationId, role: "ngo", organizationStatus: "verified" }).select("name")
      : null;
    res.json({
      request: {
        ...requestSummary(request),
        ...(assignedOrganization ? {
          assignedOrganization: { id: assignedOrganization._id.toString(), name: assignedOrganization.name },
        } : {}),
        consentToProcess: request.consentToProcess,
        ...(request.screening ? {
          screening: {
            status: request.screeningStatus,
            reasons: request.screening.reasons,
            missingFields: request.screening.missingFields,
            additionalInformation: request.screening.additionalInformation,
            confidence: request.screening.confidence,
            provider: request.screening.provider,
            model: request.screening.model,
            assessedAt: request.screening.assessedAt.toISOString(),
            ...(request.screeningStatus === "unavailable" && request.screening.reasons[0] ? { message: request.screening.reasons[0] } : {}),
          },
        } : { screening: { status: request.screeningStatus } }),
      },
      documents: documents.map((document) => ({
        id: document._id.toString(),
        name: document.originalName,
        contentType: document.contentType,
        byteSize: document.byteSize,
        status: document.status,
        ocrStatus: document.ocrStatus,
        ...(document.ocrProvider ? { ocrProvider: document.ocrProvider } : {}),
        ...(document.ocrError ? { ocrMessage: document.ocrError } : {}),
        ...(document.ocrProcessedAt ? { ocrProcessedAt: document.ocrProcessedAt.toISOString() } : {}),
      })),
    });
  });

  router.patch("/requests/:id", requireAuth, requireRole("user"), async (req, res) => {
    const parsed = helpRequestEditSchema.safeParse(req.body);
    if (!parsed.success || !mongoose.isValidObjectId(req.params.id)) {
      res.status(400).json({ message: parsed.success ? "Choose a valid help request." : parsed.error.issues[0]?.message ?? "Check the request details." });
      return;
    }
    const current = await HelpRequest.findOne({ _id: req.params.id, requesterId: req.user!.id });
    if (!current) {
      res.status(404).json({ message: "Help request not found." });
      return;
    }
    if (!["submitted", "needs_information"].includes(current.status)) {
      res.status(409).json({ message: "This request can no longer be edited." });
      return;
    }
    const { coordinates, ...fields } = parsed.data;
    const setFields: Record<string, unknown> = { ...fields };
    if (coordinates) setFields.location = { type: "Point", coordinates: [coordinates.longitude, coordinates.latitude] };
    const request = await HelpRequest.findOneAndUpdate(
      { _id: current._id, requesterId: req.user!.id, status: { $in: ["submitted", "needs_information"] } },
      {
        $set: setFields,
        $push: { timeline: { status: current.status, actorId: req.user!.id, reason: "Requester updated request details.", occurredAt: new Date() } },
      },
      { new: true, runValidators: true },
    );
    if (!request) {
      res.status(409).json({ message: "This request changed and can no longer be edited." });
      return;
    }
    await recordAuditEvent({
      actorId: req.user!.id,
      action: "help_request.updated",
      resourceType: "help_request",
      resourceId: request._id.toString(),
      previousStatus: current.status,
      newStatus: request.status,
    });
    res.json({ request: requestSummary(request) });
  });

  router.post(
    "/requests/:id/documents",
    requireAuth,
    requireRole("user"),
    requestUploadLimiter,
    express.raw({ type: () => true, limit: config.UPLOAD_MAX_BYTES }),
    async (req, res) => {
      if (!mongoose.isValidObjectId(req.params.id)) {
        res.status(404).json({ message: "Help request not found." });
        return;
      }
      const request = await HelpRequest.findOne({ _id: req.params.id, requesterId: req.user!.id });
      if (!request) {
        res.status(404).json({ message: "Help request not found." });
        return;
      }
      if (!["submitted", "needs_information"].includes(request.status)) {
        res.status(409).json({ message: "Attachments can no longer be added to this request." });
        return;
      }
      const contentType = req.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
      const fileType = requestFileTypes[contentType];
      const encodedName = req.get("x-upload-filename");
      const body = req.body;
      if (!Buffer.isBuffer(body) || body.length === 0) {
        res.status(400).json({ message: "Choose a non-empty image or PDF file." });
        return;
      }
      let suppliedName: string | undefined;
      try {
        suppliedName = encodedName ? decodeURIComponent(encodedName) : undefined;
      } catch {
        res.status(400).json({ message: "The attachment filename is invalid." });
        return;
      }
      if (!fileType || !suppliedName || suppliedName.length > 200) {
        res.status(415).json({ message: "Supported files are JPEG, PNG, WebP, or PDF." });
        return;
      }
      const extension = suppliedName.split(/[\\/]/).pop()?.split(".").pop()?.toLowerCase();
      if (extension !== fileType.extension.slice(1) || !fileType.magic(body)) {
        res.status(415).json({ message: "The filename, MIME type, and file content must match a supported format." });
        return;
      }
      const reservedRequest = await HelpRequest.findOneAndUpdate(
        {
          _id: request._id,
          requesterId: req.user!.id,
          status: { $in: ["submitted", "needs_information"] },
          $expr: { $lt: [{ $ifNull: ["$attachmentCount", 0] }, config.UPLOAD_MAX_FILES] },
        },
        { $inc: { attachmentCount: 1 } },
        { new: true },
      ).select("_id");
      if (!reservedRequest) {
        const existingCount = await RequestDocument.countDocuments({ helpRequestId: request._id });
        if (existingCount >= config.UPLOAD_MAX_FILES) {
        res.status(413).json({ message: `A request can include up to ${config.UPLOAD_MAX_FILES} files.` });
        } else {
          res.status(409).json({ message: "This request changed and can no longer accept attachments." });
        }
        return;
      }
      const originalName = (suppliedName.split(/[\\/]/).pop() ?? "attachment")
        .replace(/[^\w .()-]/g, "_")
        .trim()
        .slice(0, 120) || `attachment${fileType.extension}`;
      let stored: Awaited<ReturnType<typeof savePrivateObject>> | undefined;
      let document;
      try {
        stored = await savePrivateObject(body);
        document = await RequestDocument.create({
          helpRequestId: request._id,
          uploadedBy: req.user!.id,
          privateObjectKey: stored.key,
          originalName,
          contentType,
          byteSize: body.length,
          checksum: stored.checksum,
          status: "available",
          ocrStatus: "pending",
        });
      } catch (error) {
        await Promise.all([
          stored ? deletePrivateObject(stored.key) : Promise.resolve(),
          HelpRequest.updateOne({ _id: request._id }, { $inc: { attachmentCount: -1 } }),
        ]);
        throw error;
      }
      await recordAuditEvent({
        actorId: req.user!.id,
        action: "help_request.document_uploaded",
        resourceType: "help_request",
        resourceId: request._id.toString(),
      });
      res.status(201).json({
        document: {
          id: document._id.toString(),
          name: document.originalName,
          contentType: document.contentType,
          byteSize: document.byteSize,
          status: document.status,
          ocrStatus: document.ocrStatus,
        },
      });
    },
  );

  router.get("/requests/:id/documents", requireAuth, async (req, res) => {
    const requestId = validRouteObjectId(req, "id");
    if (!requestId) {
      res.status(404).json({ message: "Help request not found." });
      return;
    }
    const request = await findRequestForViewer(requestId, req.user!.id, req.user!.role);
    if (!request) {
      res.status(404).json({ message: "Help request not found." });
      return;
    }
    const documents = await RequestDocument.find({ helpRequestId: request._id })
      .select("originalName contentType byteSize status ocrStatus ocrProvider ocrProcessedAt +ocrError")
      .sort({ createdAt: 1 });
    res.json({ documents: documents.map((document) => ({
      id: document._id.toString(),
      name: document.originalName,
      contentType: document.contentType,
      byteSize: document.byteSize,
      status: document.status,
      ocrStatus: document.ocrStatus,
      ...(document.ocrProvider ? { ocrProvider: document.ocrProvider } : {}),
      ...(document.ocrError ? { ocrMessage: document.ocrError } : {}),
      ...(document.ocrProcessedAt ? { ocrProcessedAt: document.ocrProcessedAt.toISOString() } : {}),
    })) });
  });

  router.get("/requests/:id/documents/:documentId/content", requireAuth, async (req, res) => {
    const requestId = validRouteObjectId(req, "id");
    const documentId = validRouteObjectId(req, "documentId");
    if (!requestId || !documentId) {
      res.status(404).json({ message: "Document not found." });
      return;
    }
    const request = await findRequestForViewer(requestId, req.user!.id, req.user!.role);
    if (!request) {
      res.status(404).json({ message: "Document not found." });
      return;
    }
    const document = await RequestDocument.findOne({ _id: documentId, helpRequestId: request._id });
    if (!document) {
      res.status(404).json({ message: "Document not found." });
      return;
    }
    const content = await readPrivateObject(document.privateObjectKey);
    const safeName = document.originalName.replace(/["\r\n]/g, "_");
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}"`);
    res.type(document.contentType).send(content);
  });

  router.get("/requests/:id/timeline", requireAuth, requireRole("user"), async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) {
      res.status(404).json({ message: "Help request not found." });
      return;
    }
    const request = await HelpRequest.findOne({ _id: req.params.id, requesterId: req.user!.id }).select("timeline");
    if (!request) {
      res.status(404).json({ message: "Help request not found." });
      return;
    }
    res.json({ timeline: request.timeline.map((event) => ({
      status: event.status,
      ...(event.reason ? { reason: event.reason } : {}),
      occurredAt: event.occurredAt.toISOString(),
    })) });
  });

  router.post("/requests/:id/screen", requireAuth, requireRole("user"), requestScreeningLimiter, async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) {
      res.status(404).json({ message: "Help request not found." });
      return;
    }
    const request = await HelpRequest.findOne({ _id: req.params.id, requesterId: req.user!.id });
    if (!request) {
      res.status(404).json({ message: "Help request not found." });
      return;
    }
    if (!request.consentToProcess) {
      res.status(409).json({ message: "Consent to process this request is required before screening." });
      return;
    }
    if (!["submitted", "needs_information", "pending_ngo_review", "screening"].includes(request.status)) {
      res.status(409).json({ message: "This request is not available for screening." });
      return;
    }

    const screeningRequest = await transitionHelpRequestStatus({
      requestId: request._id.toString(),
      actorId: req.user!.id,
      to: "screening",
      screening: null,
    });
    if (!screeningRequest || screeningRequest.requesterId.toString() !== req.user!.id) {
      res.status(409).json({ message: "This request changed and is no longer available for screening." });
      return;
    }
    const documents = await RequestDocument.find({ helpRequestId: request._id }).select("+extractedTextEncrypted");
    const ocrTexts: string[] = [];
    let remainingOcrText = 20_000;
    await Promise.all(documents.map(async (document) => {
      if (document.ocrStatus === "completed" && document.extractedTextEncrypted) {
        const cached = decryptPrivateText(document.extractedTextEncrypted);
        if (cached.status === "completed") {
          if (remainingOcrText > 0) {
            ocrTexts.push(cached.text.slice(0, remainingOcrText));
            remainingOcrText = Math.max(0, remainingOcrText - cached.text.length);
          }
          return;
        }
        await RequestDocument.updateOne(
          { _id: document._id },
          { $set: { ocrStatus: "failed", ocrError: cached.error, ocrProcessedAt: new Date() } },
        );
        return;
      }
      const result = await extractRequestText(document.privateObjectKey, document.contentType);
      if (result.status === "completed") {
        const encryptedText = encryptPrivateText(result.text);
        if (!encryptedText) {
          await RequestDocument.updateOne(
            { _id: document._id },
            { $set: { ocrStatus: "unavailable", ocrProvider: "not_configured", ocrError: "OCR text storage is unavailable because REQUEST_DATA_ENCRYPTION_KEY is not configured.", ocrProcessedAt: new Date() } },
          );
          return;
        }
        if (remainingOcrText > 0) {
          ocrTexts.push(result.text.slice(0, remainingOcrText));
          remainingOcrText = Math.max(0, remainingOcrText - result.text.length);
        }
        await RequestDocument.updateOne(
          { _id: document._id },
          { $set: { extractedTextEncrypted: encryptedText, ocrStatus: "completed", ocrProvider: result.provider, ocrProcessedAt: new Date() }, $unset: { ocrError: 1 } },
        );
      } else {
        await RequestDocument.updateOne(
          { _id: document._id },
          { $set: { ocrStatus: result.status, ocrProvider: result.provider, ocrError: result.error, ocrProcessedAt: new Date() } },
        );
      }
    }));
    const possibleDuplicates = await HelpRequest.find({
      requesterId: req.user!.id,
      _id: { $ne: request._id },
      category: request.category,
      status: { $nin: ["rejected", "cancelled", "withdrawn"] },
      title: { $regex: `^${request.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" },
    }).select("title category").sort({ createdAt: -1 }).limit(5).lean();
    const screening = await assessHelpRequest({
      title: request.title,
      description: request.description,
      category: request.category,
      urgency: request.urgency,
      peopleCount: request.peopleCount,
      ocrText: ocrTexts,
      possibleDuplicates: possibleDuplicates.map((candidate) => ({
        title: candidate.title,
        category: candidate.category,
      })),
    });
    const assessedAt = new Date();
    const screeningStatus = screening.status === "available" ? screening.assessment.status : "unavailable";
    const updatedRequest = await transitionHelpRequestStatus({
      requestId: request._id.toString(),
      actorId: req.user!.id,
      to: "pending_ngo_review",
      ...(screening.status === "available" ? {
        screeningStatus,
        screening: screening.assessment,
        reason: "Automated screening completed for human review.",
      } : {
        screeningStatus: "unavailable",
        screening: {
          reasons: [screening.error],
          missingFields: [],
          additionalInformation: [],
          provider: screening.provider,
          assessedAt,
        },
        reason: screening.error,
      }),
    });
    if (!updatedRequest) {
      res.status(409).json({ message: "This request changed while screening was in progress." });
      return;
    }
    if (request.assignedOrganizationId) {
      await Notification.create({
        recipientId: request.assignedOrganizationId,
        type: "ngo_request_updated",
        idempotencyKey: `help-request:${request._id.toString()}:updated:${assessedAt.getTime()}`,
        payload: { requestId: request._id.toString(), status: "pending_ngo_review" },
        status: "sent",
      });
    }
    const updatedDocuments = await RequestDocument.find({ helpRequestId: request._id })
      .select("originalName contentType byteSize status ocrStatus ocrProvider ocrProcessedAt +ocrError")
      .sort({ createdAt: 1 });
    res.json({
      request: requestSummary(updatedRequest),
      screening: screening.status === "available" ? {
        status: screening.assessment.status,
        reasons: screening.assessment.reasons,
        missingFields: screening.assessment.missingFields,
        additionalInformation: screening.assessment.additionalInformation,
        confidence: screening.assessment.confidence,
        provider: screening.assessment.provider,
        model: screening.assessment.model,
        assessedAt: screening.assessment.assessedAt.toISOString(),
        humanReviewRequired: true,
      } : { status: "unavailable", provider: screening.provider, message: screening.error, humanReviewRequired: true },
      documents: updatedDocuments.map((document) => ({
        id: document._id.toString(),
        name: document.originalName,
        contentType: document.contentType,
        byteSize: document.byteSize,
        status: document.status,
        ocrStatus: document.ocrStatus,
        ...(document.ocrProvider ? { ocrProvider: document.ocrProvider } : {}),
        ...(document.ocrError ? { ocrMessage: document.ocrError } : {}),
      })),
    });
  });

  router.get("/auth/me", async (req, res) => {
    res.json({ user: req.user ?? null });
  });

  router.post("/auth/register", async (req, res) => {
    const parsed = userSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Check your details and try again." });
      return;
    }
    const {
      name, email, password, role, city, description, categories, phone, website,
      registrationNumber, registrationType, officialEmail, officialPhone,
      addressLine, state, postalCode, serviceArea, skills, interests,
      languages, volunteerAvailability,
      volunteerServiceRadiusKm, volunteerTaskOptIn, representativeName,
      representativeDesignation, issuingAuthority, establishedDate,
    } = parsed.data;
    const passwordHash = await bcrypt.hash(password, 12);
    try {
      const user = new User({
        name, email: email.trim().toLowerCase(), passwordHash, role, city,
        ...(role === "ngo" ? {
          description,
          categories,
          phone: officialPhone ?? phone,
          website,
          registrationNumber,
          registrationType,
          officialEmail: (officialEmail ?? email).trim().toLowerCase(),
          officialPhone: officialPhone ?? phone,
          addressLine,
          state,
          postalCode,
          serviceArea,
          representativeName,
          representativeDesignation,
          issuingAuthority,
          ...(establishedDate ? { establishedDate: new Date(`${establishedDate}T00:00:00.000Z`) } : {}),
          organizationStatus: "pending_review",
        } : role === "volunteer" ? {
          skills,
          interests,
          languages,
          volunteerAvailability,
          volunteerServiceArea: serviceArea,
          volunteerServiceRadiusKm,
          volunteerTaskOptIn: volunteerTaskOptIn === true,
          volunteerEligibility: "pending",
        } : {}),
      });
      if (role === "ngo" || role === "volunteer") {
        user.verificationHistory.push({
          status: role === "ngo" ? "pending_review" : "pending",
          actorId: user._id,
          occurredAt: new Date(),
        });
      }
      await user.save();
      await new Promise<void>((resolve, reject) => {
        req.session.regenerate((error) => error ? reject(error) : resolve());
      });
      req.session.userId = user._id.toString();
      await new Promise<void>((resolve, reject) => {
        req.session.save((error) => error ? reject(error) : resolve());
      });
      res.status(201).json({ user: safeUser(user) });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === 11000) {
        res.status(409).json({ message: "An account with that email already exists." });
        return;
      }
      throw error;
    }
  });

  router.post("/auth/login", async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Enter a valid email address and password." });
      return;
    }
    const user = await User.findOne({ email: parsed.data.email.trim().toLowerCase() }).select("+passwordHash");
    if (!user || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) {
      res.status(401).json({ message: "Email or password is incorrect." });
      return;
    }
    if (user.accountStatus === "suspended") {
      res.status(403).json({ message: "This account is suspended. Contact support or an administrator for assistance." });
      return;
    }
    await new Promise<void>((resolve, reject) => {
      req.session.regenerate((error) => error ? reject(error) : resolve());
    });
    req.session.userId = user._id.toString();
    await new Promise<void>((resolve, reject) => {
      req.session.save((error) => error ? reject(error) : resolve());
    });
    res.json({ user: safeUser(user) });
  });

  router.post("/auth/logout", requireAuth, (req, res, next) => {
    req.session.destroy((error) => {
      if (error) { next(error); return; }
      res.clearCookie("impact.sid");
      res.status(204).end();
    });
  });

  router.patch("/profile/me", requireAuth, async (req, res) => {
    const parsed = profileSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Check your profile details." });
      return;
    }
    const user = await User.findByIdAndUpdate(req.user!.id, { $set: parsed.data }, { new: true, runValidators: true });
    if (!user) {
      res.status(404).json({ message: "Your account could not be found." });
      return;
    }
    res.json({ user: safeUser(user) });
  });

  router.get("/verification/me", requireAuth, async (req, res) => {
    if (req.user!.role !== "ngo" && req.user!.role !== "volunteer") {
      res.status(403).json({ message: "Verification applications are available only to NGO and volunteer accounts." });
      return;
    }
    const applicant = await User.findById(req.user!.id).select(
      "role organizationStatus volunteerEligibility verificationReason verificationReviewedAt verificationHistory",
    );
    if (!applicant) {
      res.status(404).json({ message: "Applicant account not found." });
      return;
    }
    const documents = await VerificationDocument.find({ applicantId: applicant._id })
      .select("kind originalName contentType byteSize createdAt")
      .sort({ createdAt: 1 });
    const history = applicant.verificationHistory.map((entry) => ({
      status: entry.status,
      ...(entry.reason ? { reason: entry.reason } : {}),
      occurredAt: entry.occurredAt.toISOString(),
    }));
    res.json({
      status: applicant.role === "ngo"
        ? (applicant.organizationStatus ?? "pending_review")
        : (applicant.volunteerEligibility ?? "pending"),
      ...(applicant.verificationReason ? { reason: applicant.verificationReason } : {}),
      ...(applicant.verificationReviewedAt ? { reviewedAt: applicant.verificationReviewedAt.toISOString() } : {}),
      history,
      documents: documents.map((document) => ({
        id: document._id.toString(),
        kind: document.kind,
        name: document.originalName,
        contentType: document.contentType,
        byteSize: document.byteSize,
        createdAt: document.createdAt.toISOString(),
      })),
    });
  });

  router.post(
    "/verification/me/documents",
    requireAuth,
    requestUploadLimiter,
    express.raw({ type: () => true, limit: config.UPLOAD_MAX_BYTES }),
    async (req, res) => {
      const kindResult = verificationDocumentKinds.safeParse(req.get("x-document-kind"));
      if (!kindResult.success) {
        res.status(400).json({ message: "Choose a supported verification document type." });
        return;
      }
      const kind = kindResult.data;
      const isVolunteerDocument = kind === "volunteer_identity";
      if ((req.user!.role === "volunteer") !== isVolunteerDocument || !["volunteer", "ngo"].includes(req.user!.role)) {
        res.status(403).json({ message: "This document type is not available for your account." });
        return;
      }
      const applicant = await User.findById(req.user!.id).select("role organizationStatus volunteerEligibility");
      if (!applicant) {
        res.status(404).json({ message: "Applicant account not found." });
        return;
      }
      const applicationStatus = applicant.role === "ngo"
        ? applicant.organizationStatus
        : applicant.volunteerEligibility;
      if (["verified", "eligible", "suspended"].includes(applicationStatus ?? "")) {
        res.status(409).json({ message: "Documents cannot be changed while this application is approved or suspended." });
        return;
      }
      const contentType = req.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
      const fileType = requestFileTypes[contentType];
      const encodedName = req.get("x-upload-filename");
      const body = req.body;
      if (!Buffer.isBuffer(body) || body.length === 0) {
        res.status(400).json({ message: "Choose a non-empty image or PDF file." });
        return;
      }
      let suppliedName: string | undefined;
      try {
        suppliedName = encodedName ? decodeURIComponent(encodedName) : undefined;
      } catch {
        res.status(400).json({ message: "The document filename is invalid." });
        return;
      }
      const extension = suppliedName?.split(/[\\/]/).pop()?.split(".").pop()?.toLowerCase();
      if (!fileType || !suppliedName || suppliedName.length > 200 ||
          extension !== fileType.extension.slice(1) || !fileType.magic(body)) {
        res.status(415).json({ message: "Supported files are matching JPEG, PNG, WebP, or PDF files." });
        return;
      }
      const countField = "verificationDocumentCount";
      const statusField = applicant.role === "ngo" ? "organizationStatus" : "volunteerEligibility";
      const blockedStatuses = applicant.role === "ngo" ? ["verified", "suspended"] : ["eligible", "suspended"];
      const reservedApplicant = await User.findOneAndUpdate(
        {
          _id: applicant._id,
          role: applicant.role,
          [statusField]: { $nin: blockedStatuses },
          $expr: { $lt: [{ $ifNull: [`$${countField}`, 0] }, config.UPLOAD_MAX_FILES] },
        },
        { $inc: { [countField]: 1 } },
        { new: true },
      ).select("_id");
      if (!reservedApplicant) {
        const documentCount = await VerificationDocument.countDocuments({ applicantId: applicant._id });
        if (documentCount >= config.UPLOAD_MAX_FILES) {
          res.status(413).json({ message: `An application can include up to ${config.UPLOAD_MAX_FILES} documents.` });
        } else {
          res.status(409).json({ message: "Your application status changed; refresh and try again." });
        }
        return;
      }
      const originalName = (suppliedName.split(/[\\/]/).pop() ?? "document")
        .replace(/[^\w .()-]/g, "_")
        .trim()
        .slice(0, 120) || `document${fileType.extension}`;
      let stored: Awaited<ReturnType<typeof savePrivateObject>> | undefined;
      let document: VerificationDocumentDocument;
      try {
        stored = await savePrivateObject(body);
        document = await VerificationDocument.create({
          applicantId: applicant._id,
          uploadedBy: applicant._id,
          kind,
          privateObjectKey: stored.key,
          originalName,
          contentType,
          byteSize: body.length,
          checksum: stored.checksum,
        });
      } catch (error) {
        await Promise.all([
          stored ? deletePrivateObject(stored.key) : Promise.resolve(),
          User.updateOne({ _id: applicant._id }, { $inc: { [countField]: -1 } }),
        ]);
        throw error;
      }
      await recordAuditEvent({
        actorId: applicant._id.toString(),
        action: "verification.document_uploaded",
        resourceType: "verification_application",
        resourceId: applicant._id.toString(),
      });
      res.status(201).json({
        document: {
          id: document._id.toString(),
          kind: document.kind,
          name: document.originalName,
          contentType: document.contentType,
          byteSize: document.byteSize,
          createdAt: document.createdAt.toISOString(),
        },
      });
    },
  );

  router.post("/verification/me/resubmit", requireAuth, async (req, res) => {
    if (req.user!.role !== "ngo" && req.user!.role !== "volunteer") {
      res.status(403).json({ message: "Only NGO and volunteer applicants can resubmit verification." });
      return;
    }
    if (!req.body || Object.keys(req.body).length !== 0) {
      res.status(400).json({ message: "Resubmission does not accept additional fields." });
      return;
    }
    const ngo = req.user!.role === "ngo";
    const allowedStatuses = ngo
      ? ["rejected", "resubmission_required"]
      : ["rejected", "more_information_required"];
    const nextStatus = ngo ? "pending_review" : "under_review";
    const applicant = await User.findOneAndUpdate(
      { _id: req.user!.id, role: req.user!.role, [ngo ? "organizationStatus" : "volunteerEligibility"]: { $in: allowedStatuses } },
      {
        $set: {
          [ngo ? "organizationStatus" : "volunteerEligibility"]: nextStatus,
        },
        $unset: { verificationReason: 1, verificationReviewedBy: 1, verificationReviewedAt: 1 },
        $push: { verificationHistory: { status: nextStatus, actorId: req.user!.id, occurredAt: new Date() } },
      },
      { new: true, runValidators: true },
    ).select("organizationStatus volunteerEligibility");
    if (!applicant) {
      res.status(409).json({ message: "This application is not currently eligible for resubmission." });
      return;
    }
    await recordAuditEvent({
      actorId: req.user!.id,
      action: "verification.application_resubmitted",
      resourceType: "verification_application",
      resourceId: applicant._id.toString(),
      newStatus: nextStatus,
    });
    res.json({ status: ngo ? applicant.organizationStatus : applicant.volunteerEligibility });
  });

  router.get("/ngo/verification", requireAuth, requireRole("ngo"), async (req, res) => {
    const organization = await User.findById(req.user!.id).select(
      "name email city description categories phone website registrationNumber registrationType representativeName representativeDesignation issuingAuthority establishedDate officialEmail officialPhone addressLine state postalCode serviceArea organizationStatus verificationReason ngoLocation acceptingRequests requestCapacity activeHelpRequestCount",
    );
    if (!organization) {
      res.status(404).json({ message: "Organization account not found." });
      return;
    }
    res.json({
      organization: {
        ...safeUser(organization),
        ...(organization.ngoLocation ? {
          coordinates: {
            longitude: organization.ngoLocation.coordinates[0],
            latitude: organization.ngoLocation.coordinates[1],
          },
        } : {}),
        acceptingRequests: organization.acceptingRequests !== false,
        ...(organization.requestCapacity ? { requestCapacity: organization.requestCapacity } : {}),
        activeRequestCount: organization.activeHelpRequestCount ?? 0,
      },
    });
  });

  router.patch("/ngo/verification", requireAuth, requireRole("ngo"), async (req, res) => {
    const parsed = ngoVerificationSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Complete all required organization details." });
      return;
    }
    const current = await User.findOne({ _id: req.user!.id, role: "ngo" }).select("organizationStatus");
    if (!current) {
      res.status(404).json({ message: "Organization account not found." });
      return;
    }
    if (current.organizationStatus === "verified") {
      res.status(409).json({ message: "Verified organization details cannot be resubmitted through this form." });
      return;
    }
    const { coordinates, establishedDate, ...profile } = parsed.data;
    const setFields: Record<string, unknown> = {
      ...profile,
      officialEmail: profile.officialEmail.toLowerCase(),
      organizationStatus: "pending_review",
    };
    if (establishedDate) setFields.establishedDate = new Date(`${establishedDate}T00:00:00.000Z`);
    const unsetFields: Record<string, 1> = { verificationReason: 1 };
    if (profile.requestCapacity === undefined) unsetFields.requestCapacity = 1;
    if (coordinates) {
      setFields.ngoLocation = { type: "Point", coordinates: [coordinates.longitude, coordinates.latitude] };
    } else {
      unsetFields.ngoLocation = 1;
    }
    const organization = await User.findOneAndUpdate(
      { _id: req.user!.id, role: "ngo" },
      {
        $set: setFields,
        $unset: unsetFields,
        $push: { verificationHistory: { status: "pending_review", actorId: req.user!.id, occurredAt: new Date() } },
      },
      { new: true, runValidators: true },
    );
    if (!organization) {
      res.status(404).json({ message: "Organization account not found." });
      return;
    }
    res.json({ organization: safeUser(organization) });
  });

  router.patch("/ngo/availability", requireAuth, requireRole("ngo"), async (req, res) => {
    const parsed = ngoAvailabilitySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Check your organization availability settings." });
      return;
    }
    const { coordinates, clearCoordinates, requestCapacity, ...settings } = parsed.data;
    const setFields: Record<string, unknown> = { ...settings };
    if (coordinates) setFields.ngoLocation = { type: "Point", coordinates: [coordinates.longitude, coordinates.latitude] };
    const update: Record<string, unknown> = { $set: setFields };
    const unsetFields: Record<string, 1> = {};
    if (!coordinates && clearCoordinates) unsetFields.ngoLocation = 1;
    if (requestCapacity === undefined) unsetFields.requestCapacity = 1;
    else setFields.requestCapacity = requestCapacity;
    if (Object.keys(unsetFields).length) update.$unset = unsetFields;
    const filter: Record<string, unknown> = { _id: req.user!.id, role: "ngo", organizationStatus: "verified" };
    if (requestCapacity !== undefined) {
      filter.$expr = { $lte: [{ $ifNull: ["$activeHelpRequestCount", 0] }, requestCapacity] };
    }
    const organization = await User.findOneAndUpdate(filter, update, { new: true, runValidators: true })
      .select("name organizationStatus acceptingRequests requestCapacity activeHelpRequestCount ngoLocation");
    if (!organization) {
      const verified = await User.exists({ _id: req.user!.id, role: "ngo", organizationStatus: "verified" });
      res.status(verified ? 409 : 403).json({
        message: verified
          ? "The capacity limit cannot be lower than your current active request count."
          : "Only verified organizations can update availability.",
      });
      return;
    }
    res.json({
      organization: {
        id: organization._id.toString(),
        name: organization.name,
        acceptingRequests: organization.acceptingRequests !== false,
        ...(organization.requestCapacity ? { requestCapacity: organization.requestCapacity } : {}),
        activeRequestCount: organization.activeHelpRequestCount ?? 0,
        ...(organization.ngoLocation ? {
          coordinates: {
            latitude: organization.ngoLocation.coordinates[1],
            longitude: organization.ngoLocation.coordinates[0],
          },
        } : {}),
      },
    });
  });

  router.get("/item-donations/mine", requireAuth, async (req, res) => {
    const donations = await PhysicalItemDonation.find({ donorId: req.user!.id }).sort({ createdAt: -1 }).limit(100);
    res.setHeader("Cache-Control", "private, no-store");
    res.json({
      donations: donations.map((donation) => ({
        ...itemDonationSummary(donation),
        timeline: donation.timeline.map((entry) => ({
          status: entry.status,
          ...(entry.reason ? { reason: entry.reason } : {}),
          occurredAt: entry.occurredAt.toISOString(),
        })),
      })),
    });
  });

  router.post("/item-donations", requireAuth, requireRole("user", "donor", "volunteer"), async (req, res) => {
    const parsed = itemDonationSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Check the donation details." });
      return;
    }
    const ngo = await User.findOne({
      _id: parsed.data.ngoId,
      role: "ngo",
      organizationStatus: "verified",
    }).select("_id");
    if (!ngo) {
      res.status(400).json({ message: "Choose an eligible verified NGO." });
      return;
    }
    const donor = await User.findById(req.user!.id).select("phone");
    if (parsed.data.preferredContactMethod === "phone" && !donor?.phone) {
      res.status(400).json({ message: "Add a phone number to your profile or choose another contact method." });
      return;
    }
    const now = new Date();
    const donation = await PhysicalItemDonation.create({
      ...parsed.data,
      donorId: req.user!.id,
      ngoId: ngo._id,
      pickupWindowStart: new Date(parsed.data.pickupWindowStart),
      pickupWindowEnd: new Date(parsed.data.pickupWindowEnd),
      ...(parsed.data.coordinates ? {
        location: { type: "Point", coordinates: [parsed.data.coordinates.longitude, parsed.data.coordinates.latitude] },
      } : {}),
      status: "pending_ngo_review",
      timeline: [{ status: "pending_ngo_review", actorId: req.user!.id, occurredAt: now }],
    });
    await recordAuditEvent({
      actorId: req.user!.id,
      action: "item_donation.submitted",
      resourceType: "item_donation",
      resourceId: donation._id.toString(),
      newStatus: donation.status,
    });
    await notifyItemDonation(ngo._id, donation._id.toString(), "item_donation_received", donation.status);
    res.status(201).json({ donation: itemDonationSummary(donation) });
  });

  router.patch("/item-donations/:id/resubmit", requireAuth, async (req, res) => {
    const parsed = itemDonationSchema.omit({ ngoId: true, consentToSharePickupDetails: true }).partial().strict().safeParse(req.body);
    if (!parsed.success || !mongoose.isValidObjectId(req.params.id)) {
      res.status(400).json({ message: parsed.success ? "Choose a valid item donation." : parsed.error.issues[0]?.message ?? "Check the updated details." });
      return;
    }
    const donation = await PhysicalItemDonation.findOneAndUpdate(
      { _id: req.params.id, donorId: req.user!.id, status: "needs_information" },
      {
        $set: { ...parsed.data, ...(parsed.data.coordinates ? { location: { type: "Point", coordinates: [parsed.data.coordinates.longitude, parsed.data.coordinates.latitude] } } : {}), status: "pending_ngo_review" },
        $push: { timeline: { status: "pending_ngo_review", actorId: req.user!.id, reason: "Donor submitted requested information.", occurredAt: new Date() } },
      },
      { new: true, runValidators: true },
    );
    if (!donation) {
      res.status(409).json({ message: "Only an item donation requesting more information can be updated." });
      return;
    }
    await recordAuditEvent({
      actorId: req.user!.id,
      action: "item_donation.information_submitted",
      resourceType: "item_donation",
      resourceId: donation._id.toString(),
      previousStatus: "needs_information",
      newStatus: donation.status,
    });
    await notifyItemDonation(donation.ngoId, donation._id.toString(), "item_donation_updated", donation.status, `resubmitted:${Date.now()}`);
    res.json({ donation: itemDonationSummary(donation) });
  });

  router.post("/item-donations/:id/cancel", requireAuth, async (req, res) => {
    const parsed = itemDonationReasonSchema.safeParse(req.body);
    if (!parsed.success || !mongoose.isValidObjectId(req.params.id)) {
      res.status(400).json({ message: parsed.success ? "Choose a valid item donation." : parsed.error.issues[0]?.message ?? "Add a cancellation reason." });
      return;
    }
    const donation = await PhysicalItemDonation.findOneAndUpdate(
      {
        _id: req.params.id,
        donorId: req.user!.id,
        status: { $in: ["pending_ngo_review", "needs_information", "awaiting_pickup_assignment"] },
        $or: [{ assignedPickupId: { $exists: false } }, { assignedPickupId: null }],
      },
      {
        $set: { status: "cancelled" },
        $push: { timeline: { status: "cancelled", actorId: req.user!.id, reason: parsed.data.reason, occurredAt: new Date() } },
      },
      { new: true },
    );
    if (!donation) {
      res.status(409).json({ message: "This item donation can no longer be cancelled by the donor." });
      return;
    }
    await ItemPickupAssignment.updateMany(
      { donationId: donation._id, status: "offered" },
      { $set: { status: "cancelled" }, $push: { history: { status: "cancelled", actorId: req.user!.id, reason: parsed.data.reason, occurredAt: new Date() } } },
    );
    await recordAuditEvent({
      actorId: req.user!.id,
      action: "item_donation.cancelled",
      resourceType: "item_donation",
      resourceId: donation._id.toString(),
      previousStatus: "pending_ngo_review",
      newStatus: "cancelled",
      reason: parsed.data.reason,
    });
    await notifyItemDonation(donation.ngoId, donation._id.toString(), "item_donation_updated", donation.status);
    res.json({ donation: itemDonationSummary(donation) });
  });

  router.get("/item-donations/:id", requireAuth, async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) {
      res.status(404).json({ message: "Item donation not found." });
      return;
    }
    const donation = await PhysicalItemDonation.findById(req.params.id);
    if (!donation) {
      res.status(404).json({ message: "Item donation not found." });
      return;
    }
    const owner = donation.donorId.toString() === req.user!.id;
    const assignedNgo = req.user!.role === "ngo" && donation.ngoId.toString() === req.user!.id &&
      await User.exists({ _id: req.user!.id, role: "ngo", organizationStatus: "verified" });
    const assignedVolunteer = req.user!.role === "volunteer" &&
      donation.assignedVolunteerId?.toString() === req.user!.id &&
      ["pickup_assigned", "pickup_in_progress", "picked_up", "delivered_or_received", "completed"].includes(donation.status);
    if (!owner && !assignedNgo && !assignedVolunteer) {
      res.status(404).json({ message: "Item donation not found." });
      return;
    }
    const evidence = await ItemDonationEvidence.find({ donationId: donation._id })
      .select("originalName contentType byteSize kind createdAt")
      .sort({ createdAt: 1 });
    const response: Record<string, unknown> = {
      ...itemDonationSummary(donation),
      timeline: donation.timeline.map((entry) => ({
        status: entry.status,
        ...(entry.reason ? { reason: entry.reason } : {}),
        occurredAt: entry.occurredAt.toISOString(),
      })),
      evidence: evidence.map((item) => ({
        id: item._id.toString(),
        name: item.originalName,
        contentType: item.contentType,
        byteSize: item.byteSize,
        kind: item.kind,
      })),
    };
    if (owner || assignedNgo || assignedVolunteer) {
      const donor = await User.findById(donation.donorId).select("name phone email");
      response.pickupAddress = donation.pickupAddress;
      response.specialHandling = donation.specialHandling;
      if (assignedNgo || assignedVolunteer) {
        response.contact = {
          name: donor?.name,
          method: donation.preferredContactMethod,
          ...(donation.preferredContactMethod === "phone" && donor?.phone ? { value: donor.phone } : {}),
          ...(donation.preferredContactMethod === "email" && donor?.email ? { value: donor.email } : {}),
        };
      }
    }
    res.setHeader("Cache-Control", "private, no-store");
    res.json({ donation: response });
  });

  router.post(
    "/item-donations/:id/evidence",
    requireAuth,
    requestUploadLimiter,
    express.raw({ type: () => true, limit: config.UPLOAD_MAX_BYTES }),
    async (req, res) => {
      if (!mongoose.isValidObjectId(req.params.id)) {
        res.status(404).json({ message: "Item donation not found." });
        return;
      }
      const parsedKind = itemEvidenceKindSchema.safeParse(req.query.kind);
      if (!parsedKind.success) {
        res.status(400).json({ message: "Choose a valid item donation evidence type." });
        return;
      }
      const donation = await PhysicalItemDonation.findById(req.params.id);
      const assignedVolunteer = donation?.assignedVolunteerId?.toString() === req.user!.id &&
        parsedKind.data === "pickup_photo";
      if (!donation || (donation.donorId.toString() !== req.user!.id && !assignedVolunteer)) {
        res.status(404).json({ message: "Item donation not found." });
        return;
      }
      if (donation.donorId.toString() === req.user!.id &&
          !["pending_ngo_review", "needs_information", "awaiting_pickup_assignment", "submitted"].includes(donation.status)) {
        res.status(409).json({ message: "Donor photos can be uploaded only while the organization reviews the donation." });
        return;
      }
      if (assignedVolunteer && !["pickup_in_progress", "pickup_assigned"].includes(donation.status)) {
        res.status(409).json({ message: "Pickup evidence can be uploaded only by the active assigned volunteer." });
        return;
      }
      const contentType = req.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
      const fileType = requestFileTypes[contentType];
      let filename: string | undefined;
      try {
        filename = req.get("x-upload-filename") ? decodeURIComponent(req.get("x-upload-filename")!) : undefined;
      } catch {
        res.status(400).json({ message: "The filename is invalid." });
        return;
      }
      const body = req.body;
      if (!Buffer.isBuffer(body) || body.length === 0 || !fileType || !filename || filename.length > 200) {
        res.status(415).json({ message: "Upload a non-empty JPEG, PNG, WebP, or PDF file." });
        return;
      }
      const extension = filename.split(/[\\/]/).pop()?.split(".").pop()?.toLowerCase();
      if (extension !== fileType.extension.slice(1) || !fileType.magic(body)) {
        res.status(415).json({ message: "The filename, MIME type, and file content must match a supported format." });
        return;
      }
      if (await ItemDonationEvidence.countDocuments({ donationId: donation._id }) >= config.UPLOAD_MAX_FILES) {
        res.status(413).json({ message: `This donation can include up to ${config.UPLOAD_MAX_FILES} files.` });
        return;
      }
      let stored: Awaited<ReturnType<typeof savePrivateObject>> | undefined;
      try {
        stored = await savePrivateObject(body);
        const evidence = await ItemDonationEvidence.create({
          donationId: donation._id,
          uploaderId: req.user!.id,
          kind: parsedKind.data,
          privateObjectKey: stored.key,
          originalName: (filename.split(/[\\/]/).pop() ?? "evidence").replace(/[^\w .()-]/g, "_").slice(0, 120),
          contentType,
          byteSize: body.length,
          checksum: stored.checksum,
        });
        await recordAuditEvent({
          actorId: req.user!.id,
          action: "item_donation.evidence_uploaded",
          resourceType: "item_donation_evidence",
          resourceId: evidence._id.toString(),
        });
        res.status(201).json({
          evidence: {
            id: evidence._id.toString(),
            name: evidence.originalName,
            contentType: evidence.contentType,
            byteSize: evidence.byteSize,
            kind: evidence.kind,
          },
        });
      } catch (error) {
        if (stored) await deletePrivateObject(stored.key);
        throw error;
      }
    },
  );

  router.get("/item-donations/:id/evidence/:evidenceId/content", requireAuth, async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id) || !mongoose.isValidObjectId(req.params.evidenceId)) {
      res.status(404).json({ message: "Evidence not found." });
      return;
    }
    const donation = await PhysicalItemDonation.findById(req.params.id);
    const allowed = donation && (
      donation.donorId.toString() === req.user!.id ||
      (req.user!.role === "ngo" && donation.ngoId.toString() === req.user!.id &&
        Boolean(await User.exists({ _id: req.user!.id, role: "ngo", organizationStatus: "verified" }))) ||
      (req.user!.role === "volunteer" && donation.assignedVolunteerId?.toString() === req.user!.id &&
        ["pickup_assigned", "pickup_in_progress", "picked_up", "delivered_or_received", "completed"].includes(donation.status))
    );
    const evidence = allowed
      ? await ItemDonationEvidence.findOne({ _id: req.params.evidenceId, donationId: donation!._id }).select("+privateObjectKey")
      : null;
    if (!evidence) {
      res.status(404).json({ message: "Evidence not found." });
      return;
    }
    await recordAuditEvent({
      actorId: req.user!.id,
      action: "item_donation.evidence_downloaded",
      resourceType: "item_donation_evidence",
      resourceId: evidence._id.toString(),
    });
    const content = await readPrivateObject(evidence.privateObjectKey);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", `attachment; filename="${evidence.originalName.replace(/["\r\n]/g, "_")}"`);
    res.type(evidence.contentType).send(content);
  });

  router.get("/ngo/item-donations", requireAuth, requireRole("ngo"), async (req, res) => {
    const verified = await User.exists({ _id: req.user!.id, role: "ngo", organizationStatus: "verified" });
    if (!verified) {
      res.status(403).json({ message: "Only verified organizations can review item donations." });
      return;
    }
    const donations = await PhysicalItemDonation.find({ ngoId: req.user!.id }).sort({ createdAt: -1 }).limit(100);
    res.setHeader("Cache-Control", "private, no-store");
    res.json({ donations: donations.map(itemDonationSummary) });
  });

  router.patch("/ngo/item-donations/:id/review", requireAuth, requireRole("ngo"), async (req, res) => {
    const parsed = itemDonationReviewSchema.safeParse(req.body);
    if (!parsed.success || !mongoose.isValidObjectId(req.params.id)) {
      res.status(400).json({ message: parsed.success ? "Choose a valid item donation." : parsed.error.issues[0]?.message ?? "Check your review." });
      return;
    }
    const verified = await User.exists({ _id: req.user!.id, role: "ngo", organizationStatus: "verified" });
    if (!verified) {
      res.status(403).json({ message: "Only verified organizations can review item donations." });
      return;
    }
    const targetStatus = parsed.data.action === "accept" ? "awaiting_pickup_assignment"
      : parsed.data.action === "reject" ? "rejected" : "needs_information";
    const previous = await PhysicalItemDonation.findOneAndUpdate(
      { _id: req.params.id, ngoId: req.user!.id, status: { $in: ["pending_ngo_review", "needs_information"] } },
      {
        $set: { status: targetStatus },
        $push: { timeline: { status: targetStatus, actorId: req.user!.id, reason: parsed.data.reason, occurredAt: new Date() } },
      },
      { new: false },
    );
    if (!previous) {
      res.status(409).json({ message: "This item donation is no longer available for review." });
      return;
    }
    const donation = await PhysicalItemDonation.findById(previous._id);
    if (!donation) throw new Error("Reviewed item donation could not be loaded.");
    await recordAuditEvent({
      actorId: req.user!.id,
      action: `item_donation.${parsed.data.action}`,
      resourceType: "item_donation",
      resourceId: donation._id.toString(),
      previousStatus: previous.status,
      newStatus: donation.status,
      reason: parsed.data.reason,
    });
    await notifyItemDonation(donation.donorId, donation._id.toString(), "item_donation_updated", donation.status);
    if (donation.status === "awaiting_pickup_assignment") {
      await createItemPickupOffers(donation, req.user!.id);
    }
    res.json({ donation: itemDonationSummary(donation) });
  });

  router.post("/ngo/item-donations/:id/offer-pickup", requireAuth, requireRole("ngo"), async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) {
      res.status(404).json({ message: "Item donation not found." });
      return;
    }
    const verified = await User.exists({ _id: req.user!.id, role: "ngo", organizationStatus: "verified" });
    const donation = verified
      ? await PhysicalItemDonation.findOne({ _id: req.params.id, ngoId: req.user!.id, status: "awaiting_pickup_assignment" })
      : null;
    if (!donation) {
      res.status(409).json({ message: "Only accepted, unassigned donations from your verified organization can be offered for pickup." });
      return;
    }
    const count = await createItemPickupOffers(donation, req.user!.id);
    res.json({ offeredCount: count, message: count ? "Pickup offers sent to eligible volunteers." : "No eligible volunteers matched this pickup right now." });
  });

  router.post("/ngo/item-donations/:id/reassign-pickup", requireAuth, requireRole("ngo"), async (req, res) => {
    const parsed = itemDonationReasonSchema.safeParse(req.body);
    if (!parsed.success || !mongoose.isValidObjectId(req.params.id)) {
      res.status(400).json({ message: parsed.success ? "Choose a valid item donation." : parsed.error.issues[0]?.message ?? "Add a reassignment reason." });
      return;
    }
    const donation = await PhysicalItemDonation.findOne({
      _id: req.params.id,
      ngoId: req.user!.id,
      status: { $in: ["pickup_assigned", "pickup_in_progress", "pickup_failed", "disputed"] },
    });
    const verified = await User.exists({ _id: req.user!.id, role: "ngo", organizationStatus: "verified" });
    if (!donation || !verified) {
      res.status(404).json({ message: "An active pickup for your verified organization was not found." });
      return;
    }
    const previousAssignmentId = donation.assignedPickupId;
    if (previousAssignmentId) {
      const previousAssignment = await ItemPickupAssignment.findOneAndUpdate(
        { _id: previousAssignmentId, status: { $in: ["accepted", "in_progress", "submitted_for_review", "disputed"] } },
        {
          $set: { status: "reassigned" },
          $push: { history: { status: "reassigned", actorId: req.user!.id, reason: parsed.data.reason, occurredAt: new Date() } },
        },
        { new: true },
      );
      if (previousAssignment) {
        await User.updateOne(
          { _id: previousAssignment.volunteerId, activeVolunteerAssignmentCount: { $gt: 0 } },
          { $inc: { activeVolunteerAssignmentCount: -1 } },
        );
        await notifyItemDonation(
          previousAssignment.volunteerId,
          donation._id.toString(),
          "item_pickup_reassigned",
          "reassigned",
          `reassigned:${previousAssignment._id.toString()}`,
        );
      }
    }
    const changed = await PhysicalItemDonation.findOneAndUpdate(
      { _id: donation._id, ngoId: req.user!.id, assignedPickupId: previousAssignmentId },
      {
        $set: { status: "awaiting_pickup_assignment" },
        $unset: { assignedVolunteerId: 1, assignedPickupId: 1 },
        $push: { timeline: { status: "awaiting_pickup_assignment", actorId: req.user!.id, reason: parsed.data.reason, occurredAt: new Date() } },
      },
      { new: true },
    );
    if (!changed) {
      res.status(409).json({ message: "Pickup changed concurrently; refresh and try again." });
      return;
    }
    await recordAuditEvent({
      actorId: req.user!.id,
      action: "item_donation.pickup_reassigned",
      resourceType: "item_donation",
      resourceId: changed._id.toString(),
      previousStatus: donation.status,
      newStatus: changed.status,
      reason: parsed.data.reason,
    });
    await notifyItemDonation(changed.donorId, changed._id.toString(), "item_donation_updated", changed.status, `reassigned:${Date.now()}`);
    await createItemPickupOffers(changed, req.user!.id);
    res.json({ donation: itemDonationSummary(changed) });
  });

  router.get("/volunteer/item-pickups", requireAuth, requireRole("volunteer"), async (req, res) => {
    const volunteer = await User.findOne({
      _id: req.user!.id,
      role: "volunteer",
      accountStatus: "active",
      volunteerEligibility: "eligible",
      volunteerTaskOptIn: true,
    }).select("volunteerLocation city volunteerServiceArea volunteerServiceRadiusKm");
    if (!volunteer) {
      res.json({ tasks: [], eligibility: "pending_or_opted_out" });
      return;
    }
    const offers = await ItemPickupAssignment.find({ volunteerId: volunteer._id, status: "offered", offerExpiresAt: { $gt: new Date() } }).sort({ createdAt: -1 }).limit(50);
    const donations = await PhysicalItemDonation.find({
      _id: { $in: offers.map((offer) => offer.donationId) },
      status: "awaiting_pickup_assignment",
      $or: [{ assignedPickupId: { $exists: false } }, { assignedPickupId: null }],
    }).select("_id category quantity condition city pickupWindowStart pickupWindowEnd");
    const byId = new Map(donations.map((item) => [item._id.toString(), item]));
    res.json({
      eligibility: "eligible",
      tasks: offers.flatMap((offer) => {
        const donation = byId.get(offer.donationId.toString());
        return donation ? [{
          assignmentId: offer._id.toString(),
          donationId: donation._id.toString(),
          category: donation.category,
          quantity: donation.quantity,
          condition: donation.condition,
          city: donation.city,
          pickupWindowStart: donation.pickupWindowStart.toISOString(),
          pickupWindowEnd: donation.pickupWindowEnd.toISOString(),
          ...(offer.distanceKm === undefined ? {} : { approximateDistanceKm: Math.round(offer.distanceKm * 10) / 10 }),
          matchExplanation: offer.matchExplanation,
          expiresAt: offer.offerExpiresAt.toISOString(),
        }] : [];
      }),
    });
  });

  router.get("/volunteer/item-pickups/mine", requireAuth, requireRole("volunteer"), async (req, res) => {
    const assignments = await ItemPickupAssignment.find({ volunteerId: req.user!.id }).sort({ updatedAt: -1 }).limit(100);
    const donations = await PhysicalItemDonation.find({ _id: { $in: assignments.map((item) => item.donationId) } })
      .select("_id category quantity condition city status pickupWindowStart pickupWindowEnd assignedPickupId");
    const byId = new Map(donations.map((item) => [item._id.toString(), item]));
    res.setHeader("Cache-Control", "private, no-store");
    res.json({
      assignments: assignments.map((assignment) => {
        const donation = byId.get(assignment.donationId.toString());
        return {
          id: assignment._id.toString(),
          donationId: assignment.donationId.toString(),
          status: assignment.status,
          category: donation?.category ?? "item pickup",
          quantity: donation?.quantity ?? 0,
          condition: donation?.condition ?? "unknown",
          city: donation?.city ?? "",
          donationStatus: donation?.status ?? "cancelled",
          pickupWindowStart: donation?.pickupWindowStart.toISOString(),
          pickupWindowEnd: donation?.pickupWindowEnd.toISOString(),
          ...(assignment.progressNote ? { progressNote: assignment.progressNote } : {}),
          canAccessDetails: Boolean(
            donation?.assignedPickupId?.equals(assignment._id) &&
            ["accepted", "in_progress", "submitted_for_review", "completed"].includes(assignment.status),
          ),
        };
      }),
    });
  });

  router.post("/volunteer/item-pickups/:id/accept", requireAuth, requireRole("volunteer"), async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) {
      res.status(404).json({ message: "Pickup offer not found." });
      return;
    }
    const offer = await ItemPickupAssignment.findOne({
      _id: req.params.id,
      volunteerId: req.user!.id,
      status: "offered",
      offerExpiresAt: { $gt: new Date() },
    });
    if (!offer) {
      res.status(409).json({ message: "This pickup offer is expired or no longer available." });
      return;
    }
    const volunteer = await User.findOneAndUpdate(
      {
        _id: req.user!.id,
        role: "volunteer",
        accountStatus: "active",
        volunteerEligibility: "eligible",
        volunteerTaskOptIn: true,
        $expr: { $lt: [{ $ifNull: ["$activeVolunteerAssignmentCount", 0] }, { $ifNull: ["$maxActiveAssignments", 3] }] },
      },
      { $inc: { activeVolunteerAssignmentCount: 1 } },
      { new: true },
    ).select("_id");
    if (!volunteer) {
      res.status(409).json({ message: "Your volunteer account is no longer eligible or has reached its active task limit." });
      return;
    }
    const now = new Date();
    const claimed = await PhysicalItemDonation.findOneAndUpdate(
      {
        _id: offer.donationId,
        ngoId: offer.ngoId,
        status: "awaiting_pickup_assignment",
        $or: [{ assignedPickupId: { $exists: false } }, { assignedPickupId: null }],
      },
      {
        $set: { status: "pickup_assigned", assignedPickupId: offer._id, assignedVolunteerId: volunteer._id },
        $push: { timeline: { status: "pickup_assigned", actorId: volunteer._id, occurredAt: now } },
      },
      { new: true },
    );
    if (!claimed) {
      await User.updateOne({ _id: volunteer._id, activeVolunteerAssignmentCount: { $gt: 0 } }, { $inc: { activeVolunteerAssignmentCount: -1 } });
      await ItemPickupAssignment.updateOne(
        { _id: offer._id, status: "offered" },
        { $set: { status: "expired" }, $push: { history: { status: "expired", actorId: volunteer._id, occurredAt: now } } },
      );
      res.status(409).json({ message: "Another volunteer has already accepted this pickup." });
      return;
    }
    const accepted = await ItemPickupAssignment.findOneAndUpdate(
      { _id: offer._id, status: "offered", offerExpiresAt: { $gt: now } },
      { $set: { status: "accepted", acceptedAt: now }, $push: { history: { status: "accepted", actorId: volunteer._id, occurredAt: now } } },
      { new: true },
    );
    if (!accepted) {
      await PhysicalItemDonation.updateOne(
        { _id: claimed._id, assignedPickupId: offer._id, status: "pickup_assigned" },
        { $set: { status: "awaiting_pickup_assignment" }, $unset: { assignedPickupId: 1, assignedVolunteerId: 1 } },
      );
      await User.updateOne({ _id: volunteer._id, activeVolunteerAssignmentCount: { $gt: 0 } }, { $inc: { activeVolunteerAssignmentCount: -1 } });
      res.status(409).json({ message: "This pickup offer changed; refresh and try again." });
      return;
    }
    await ItemPickupAssignment.updateMany(
      { donationId: claimed._id, _id: { $ne: accepted._id }, status: "offered" },
      { $set: { status: "cancelled" }, $push: { history: { status: "cancelled", actorId: volunteer._id, reason: "Another volunteer accepted this pickup.", occurredAt: now } } },
    );
    await recordAuditEvent({
      actorId: volunteer._id.toString(),
      action: "item_donation.pickup_accepted",
      resourceType: "item_donation",
      resourceId: claimed._id.toString(),
      previousStatus: "awaiting_pickup_assignment",
      newStatus: "pickup_assigned",
    });
    await notifyItemDonation(claimed.donorId, claimed._id.toString(), "item_pickup_assigned", "pickup_assigned");
    await notifyItemDonation(claimed.ngoId, claimed._id.toString(), "item_pickup_assigned", "pickup_assigned");
    res.json({ assignment: { id: accepted._id.toString(), status: accepted.status } });
  });

  router.post("/volunteer/item-pickups/:id/decline", requireAuth, requireRole("volunteer"), async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) {
      res.status(404).json({ message: "Pickup offer not found." });
      return;
    }
    const now = new Date();
    const assignment = await ItemPickupAssignment.findOneAndUpdate(
      { _id: req.params.id, volunteerId: req.user!.id, status: "offered" },
      { $set: { status: "declined" }, $push: { history: { status: "declined", actorId: req.user!.id, occurredAt: now } } },
      { new: true },
    );
    if (!assignment) {
      res.status(409).json({ message: "This pickup offer is no longer available." });
      return;
    }
    await recordAuditEvent({
      actorId: req.user!.id,
      action: "item_donation.pickup_declined",
      resourceType: "item_donation",
      resourceId: assignment.donationId.toString(),
      previousStatus: "offered",
      newStatus: "declined",
    });
    await notifyItemDonation(assignment.ngoId, assignment.donationId.toString(), "item_pickup_declined", "declined", `declined:${assignment._id.toString()}`);
    res.json({ status: assignment.status });
  });

  router.get("/volunteer/item-pickups/:id/details", requireAuth, requireRole("volunteer"), async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) {
      res.status(404).json({ message: "Pickup details not found." });
      return;
    }
    const assignment = await ItemPickupAssignment.findOne({
      _id: req.params.id,
      volunteerId: req.user!.id,
      status: { $in: ["accepted", "in_progress", "submitted_for_review", "completed"] },
    });
    const donation = assignment ? await PhysicalItemDonation.findOne({
      _id: assignment.donationId,
      assignedPickupId: assignment._id,
      assignedVolunteerId: req.user!.id,
      status: { $in: ["pickup_assigned", "pickup_in_progress", "picked_up", "delivered_or_received", "completed"] },
      consentToSharePickupDetails: true,
    }) : null;
    if (!assignment || !donation) {
      res.status(404).json({ message: "Private pickup details are available only to the assigned volunteer." });
      return;
    }
    const donor = await User.findOne({ _id: donation.donorId, accountStatus: "active" }).select("name phone email");
    if (!donor) {
      res.status(404).json({ message: "Donor contact details are unavailable." });
      return;
    }
    res.setHeader("Cache-Control", "private, no-store");
    res.json({
      pickup: {
        assignmentId: assignment._id.toString(),
        donationId: donation._id.toString(),
        category: donation.category,
        description: donation.description,
        quantity: donation.quantity,
        condition: donation.condition,
        city: donation.city,
        pickupAddress: donation.pickupAddress,
        ...(donation.location ? { coordinates: { latitude: donation.location.coordinates[1], longitude: donation.location.coordinates[0] } } : {}),
        pickupWindowStart: donation.pickupWindowStart.toISOString(),
        pickupWindowEnd: donation.pickupWindowEnd.toISOString(),
        specialHandling: donation.specialHandling,
        contact: {
          name: donor.name,
          method: donation.preferredContactMethod,
          ...(donation.preferredContactMethod === "phone" && donor.phone ? { value: donor.phone } : {}),
          ...(donation.preferredContactMethod === "email" && donor.email ? { value: donor.email } : {}),
        },
        status: assignment.status,
      },
    });
  });

  router.post("/volunteer/item-pickups/:id/start", requireAuth, requireRole("volunteer"), async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) {
      res.status(404).json({ message: "Pickup assignment not found." });
      return;
    }
    const now = new Date();
    const assignment = await ItemPickupAssignment.findOneAndUpdate(
      { _id: req.params.id, volunteerId: req.user!.id, status: "accepted" },
      { $set: { status: "in_progress", startedAt: now }, $push: { history: { status: "in_progress", actorId: req.user!.id, occurredAt: now } } },
      { new: true },
    );
    if (!assignment) {
      res.status(409).json({ message: "Only your accepted pickup can be started." });
      return;
    }
    const donation = await PhysicalItemDonation.findOneAndUpdate(
      { _id: assignment.donationId, assignedPickupId: assignment._id, assignedVolunteerId: req.user!.id, status: "pickup_assigned" },
      { $set: { status: "pickup_in_progress" }, $push: { timeline: { status: "pickup_in_progress", actorId: req.user!.id, occurredAt: now } } },
      { new: true },
    );
    if (!donation) {
      await ItemPickupAssignment.updateOne(
        { _id: assignment._id, status: "in_progress" },
        { $set: { status: "accepted" }, $push: { history: { status: "accepted", actorId: req.user!.id, reason: "Pickup status changed concurrently.", occurredAt: now } } },
      );
      res.status(409).json({ message: "This donation changed; refresh before starting the pickup." });
      return;
    }
    await notifyItemDonation(donation.ngoId, donation._id.toString(), "item_pickup_progress", donation.status);
    res.json({ status: assignment.status });
  });

  router.post("/volunteer/item-pickups/:id/report-issue", requireAuth, requireRole("volunteer"), async (req, res) => {
    const parsed = itemDonationReasonSchema.safeParse(req.body);
    if (!parsed.success || !mongoose.isValidObjectId(req.params.id)) {
      res.status(400).json({ message: parsed.success ? "Choose a valid pickup assignment." : parsed.error.issues[0]?.message ?? "Describe the pickup issue." });
      return;
    }
    const now = new Date();
    const assignment = await ItemPickupAssignment.findOneAndUpdate(
      { _id: req.params.id, volunteerId: req.user!.id, status: { $in: ["accepted", "in_progress"] } },
      {
        $set: { status: "disputed", progressNote: parsed.data.reason },
        $push: { history: { status: "disputed", actorId: req.user!.id, reason: parsed.data.reason, occurredAt: now } },
      },
      { new: true },
    );
    if (!assignment) {
      res.status(409).json({ message: "Only your active pickup can be reported." });
      return;
    }
    const donation = await PhysicalItemDonation.findOneAndUpdate(
      { _id: assignment.donationId, assignedPickupId: assignment._id, assignedVolunteerId: req.user!.id, status: { $in: ["pickup_assigned", "pickup_in_progress"] } },
      {
        $set: { status: "pickup_failed" },
        $push: { timeline: { status: "pickup_failed", actorId: req.user!.id, reason: parsed.data.reason, occurredAt: now } },
      },
      { new: true },
    );
    if (!donation) {
      await ItemPickupAssignment.updateOne(
        { _id: assignment._id, status: "disputed" },
        { $set: { status: "accepted" }, $push: { history: { status: "accepted", actorId: req.user!.id, reason: "Donation status changed concurrently.", occurredAt: now } } },
      );
      res.status(409).json({ message: "This pickup changed; refresh and try again." });
      return;
    }
    await recordAuditEvent({
      actorId: req.user!.id,
      action: "item_donation.pickup_issue_reported",
      resourceType: "item_donation",
      resourceId: donation._id.toString(),
      previousStatus: "pickup_in_progress",
      newStatus: "pickup_failed",
      reason: parsed.data.reason,
    });
    await notifyItemDonation(donation.ngoId, donation._id.toString(), "item_pickup_issue", donation.status);
    await notifyItemDonation(donation.donorId, donation._id.toString(), "item_pickup_issue", donation.status);
    res.json({ status: assignment.status });
  });

  router.post("/volunteer/item-pickups/:id/submit", requireAuth, requireRole("volunteer"), async (req, res) => {
    const parsed = itemDonationReasonSchema.safeParse(req.body);
    if (!parsed.success || !mongoose.isValidObjectId(req.params.id)) {
      res.status(400).json({ message: parsed.success ? "Choose a valid pickup assignment." : parsed.error.issues[0]?.message ?? "Add a collection report." });
      return;
    }
    const currentAssignment = await ItemPickupAssignment.findOne({
      _id: req.params.id,
      volunteerId: req.user!.id,
      status: "in_progress",
    }).select("donationId");
    if (!currentAssignment) {
      res.status(409).json({ message: "Only your active pickup can be submitted for NGO review." });
      return;
    }
    const pickupEvidenceCount = await ItemDonationEvidence.countDocuments({
      donationId: currentAssignment.donationId,
      uploaderId: req.user!.id,
      kind: "pickup_photo",
    });
    if (!pickupEvidenceCount) {
      res.status(409).json({ message: "Upload at least one private pickup photo before submitting collection for NGO review." });
      return;
    }
    const now = new Date();
    const assignment = await ItemPickupAssignment.findOneAndUpdate(
      { _id: req.params.id, volunteerId: req.user!.id, status: "in_progress" },
      {
        $set: { status: "submitted_for_review", submittedAt: now, progressNote: parsed.data.reason },
        $push: { history: { status: "submitted_for_review", actorId: req.user!.id, reason: parsed.data.reason, occurredAt: now } },
      },
      { new: true },
    );
    if (!assignment) {
      res.status(409).json({ message: "Only your active pickup can be submitted for NGO review." });
      return;
    }
    const donation = await PhysicalItemDonation.findOneAndUpdate(
      { _id: assignment.donationId, assignedPickupId: assignment._id, assignedVolunteerId: req.user!.id, status: "pickup_in_progress" },
      { $set: { status: "picked_up" }, $push: { timeline: { status: "picked_up", actorId: req.user!.id, reason: parsed.data.reason, occurredAt: now } } },
      { new: true },
    );
    if (!donation) {
      await ItemPickupAssignment.updateOne(
        { _id: assignment._id, status: "submitted_for_review" },
        { $set: { status: "in_progress" }, $push: { history: { status: "in_progress", actorId: req.user!.id, reason: "Donation status changed concurrently.", occurredAt: now } } },
      );
      res.status(409).json({ message: "This donation changed; refresh and try again." });
      return;
    }
    await notifyItemDonation(donation.ngoId, donation._id.toString(), "item_pickup_submitted", donation.status);
    await notifyItemDonation(donation.donorId, donation._id.toString(), "item_pickup_progress", donation.status);
    res.json({ status: assignment.status });
  });

  router.post("/ngo/item-donations/:id/confirm-received", requireAuth, requireRole("ngo"), async (req, res) => {
    const parsed = itemDonationReasonSchema.safeParse(req.body);
    if (!parsed.success || !mongoose.isValidObjectId(req.params.id)) {
      res.status(400).json({ message: parsed.success ? "Choose a valid item donation." : parsed.error.issues[0]?.message ?? "Add receipt details." });
      return;
    }
    const verified = await User.exists({ _id: req.user!.id, role: "ngo", organizationStatus: "verified" });
    const donation = verified ? await PhysicalItemDonation.findOneAndUpdate(
      { _id: req.params.id, ngoId: req.user!.id, status: "picked_up" },
      {
        $set: {
          status: "completed",
          completedAt: new Date(),
          receiptReference: `IM-ITEM-${new Date().getUTCFullYear()}-${randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`,
        },
        $push: { timeline: { $each: [
          { status: "delivered_or_received", actorId: req.user!.id, reason: parsed.data.reason, occurredAt: new Date() },
          { status: "completed", actorId: req.user!.id, reason: parsed.data.reason, occurredAt: new Date() },
        ] } },
      },
      { new: true },
    ) : null;
    if (!donation) {
      res.status(409).json({ message: "Only a picked-up donation routed to your verified organization can be marked received." });
      return;
    }
    if (donation.assignedPickupId) {
      const assignment = await ItemPickupAssignment.findOneAndUpdate(
        { _id: donation.assignedPickupId, status: "submitted_for_review" },
        { $set: { status: "completed" }, $push: { history: { status: "completed", actorId: req.user!.id, reason: parsed.data.reason, occurredAt: new Date() } } },
        { new: true },
      );
      if (assignment) {
        await User.updateOne({ _id: assignment.volunteerId, activeVolunteerAssignmentCount: { $gt: 0 } }, { $inc: { activeVolunteerAssignmentCount: -1 } });
      }
    }
    await recordAuditEvent({
      actorId: req.user!.id,
      action: "item_donation.received",
      resourceType: "item_donation",
      resourceId: donation._id.toString(),
      previousStatus: "picked_up",
      newStatus: "completed",
      reason: parsed.data.reason,
    });
    await notifyItemDonation(donation.donorId, donation._id.toString(), "item_donation_completed", donation.status);
    if (donation.assignedVolunteerId) await notifyItemDonation(donation.assignedVolunteerId, donation._id.toString(), "item_donation_completed", donation.status);
    res.json({ donation: itemDonationSummary(donation) });
  });

  router.get("/item-donations/:id/receipt", requireAuth, async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) {
      res.status(404).json({ message: "Item receipt not found." });
      return;
    }
    const donation = await PhysicalItemDonation.findOne({
      _id: req.params.id,
      status: "completed",
      $or: [{ donorId: req.user!.id }, ...(req.user!.role === "ngo" ? [{ ngoId: req.user!.id }] : [])],
    });
    if (!donation) {
      res.status(404).json({ message: "An item receipt is available only to the donor and receiving NGO after confirmation." });
      return;
    }
    const ngo = await User.findOne({ _id: donation.ngoId, role: "ngo", organizationStatus: "verified" }).select("name");
    res.setHeader("Cache-Control", "private, no-store");
    res.json({
      receipt: {
        reference: donation.receiptReference,
        category: donation.category,
        quantity: donation.quantity,
        condition: donation.condition,
        organizationName: ngo?.name ?? "Organization",
        completedAt: donation.completedAt?.toISOString(),
        note: "Item receipt confirming the organization marked this donation received. Not a tax-deductible receipt.",
      },
    });
  });

  router.get("/needs", async (req, res) => {
    const query: Record<string, unknown> = {
      status: "open",
      $expr: {
        $or: [
          { $eq: ["$kind", "volunteer"] },
          { $lt: [{ $add: [{ $ifNull: ["$raisedAmount", 0] }, { $ifNull: ["$reservedAmount", 0] }] }, "$targetAmount"] },
        ],
      },
    };
    if (typeof req.query.category === "string" && req.query.category.length <= 60) query.category = req.query.category;
    if (typeof req.query.city === "string" && req.query.city.length <= 100) query.city = req.query.city;
    if (typeof req.query.search === "string" && req.query.search.trim()) {
      const escaped = req.query.search.trim().slice(0, 100).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      query.$or = [
        { title: { $regex: escaped, $options: "i" } },
        { description: { $regex: escaped, $options: "i" } },
        { city: { $regex: escaped, $options: "i" } },
        { category: { $regex: escaped, $options: "i" } },
      ];
    }
    const needs = await Need.find(query)
      .sort({ createdAt: -1 })
      .limit(60)
      .populate<{ organizationId: OrganizationSummaryDocument }>("organizationId", "name organizationStatus accountStatus")
      .lean<PopulatedNeedDocument[]>();
    res.json({ needs: needs.filter((item) => item.organizationId?.organizationStatus === "verified" && item.organizationId.accountStatus === "active").map(formatNeed) });
  });

  router.get("/ngos", async (req, res) => {
    const filter: Record<string, unknown> = { role: "ngo", accountStatus: "active", organizationStatus: "verified" };
    const search = typeof req.query.search === "string" ? req.query.search.trim().slice(0, 100) : "";
    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      filter.$or = [
        { name: { $regex: escaped, $options: "i" } },
        { city: { $regex: escaped, $options: "i" } },
        { description: { $regex: escaped, $options: "i" } },
        { categories: { $regex: escaped, $options: "i" } },
      ];
    }
    if (typeof req.query.city === "string" && req.query.city.length <= 100) filter.city = req.query.city;
    if (typeof req.query.category === "string" && req.query.category.length <= 60) filter.categories = req.query.category;
    const organizations = await User.find(filter)
      .select("name city description categories organizationStatus")
      .sort({ name: 1 })
      .limit(60)
      .lean<Pick<OrganizationDocument, "_id" | "name" | "city" | "description" | "categories" | "organizationStatus">[]>();
    const ids = organizations.map((organization) => organization._id);
    const [taskCounts, volunteerCounts, donations] = await Promise.all([
      Need.aggregate([{ $match: { organizationId: { $in: ids }, status: "open" } }, { $group: { _id: "$organizationId", count: { $sum: 1 } } }]),
      Contribution.aggregate([
        { $match: { kind: "volunteer" } },
        { $lookup: { from: "needs", localField: "needId", foreignField: "_id", as: "need" } },
        { $unwind: "$need" },
        { $match: { "need.organizationId": { $in: ids } } },
        { $group: { _id: "$need.organizationId", count: { $sum: 1 } } },
      ]),
      Contribution.aggregate([
        { $match: { kind: "donation", status: "completed" } },
        { $lookup: { from: "needs", localField: "needId", foreignField: "_id", as: "need" } },
        { $unwind: "$need" },
        { $match: { "need.organizationId": { $in: ids } } },
        { $group: { _id: "$need.organizationId", total: { $sum: "$amount" } } },
      ]),
    ]);
    const countBy = (items: Array<{ _id: mongoose.Types.ObjectId; count?: number; total?: number }>, key: mongoose.Types.ObjectId, value: "count" | "total") =>
      items.find((item) => item._id.equals(key))?.[value] ?? 0;
    res.json({
      ngos: organizations.map((organization) => ({
        id: organization._id.toString(),
        name: organization.name,
        city: organization.city,
        description: organization.description ?? "",
        categories: organization.categories ?? [],
        organizationStatus: "verified",
        activeTasks: countBy(taskCounts, organization._id, "count"),
        volunteerCount: countBy(volunteerCounts, organization._id, "count"),
        fundsRaised: countBy(donations, organization._id, "total"),
      })),
    });
  });

  router.get("/ngos/:id", async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) {
      res.status(400).json({ message: "That organization could not be found." });
      return;
    }
    const organization = await User.findOne({
      _id: req.params.id,
      role: "ngo",
      accountStatus: "active",
      organizationStatus: "verified",
    }).select("name city description categories organizationStatus");
    if (!organization) {
      res.status(404).json({ message: "That verified organization could not be found." });
      return;
    }
    const needs = await Need.find({
      organizationId: organization._id,
      status: "open",
      $expr: {
        $or: [
          { $eq: ["$kind", "volunteer"] },
          { $lt: [{ $add: [{ $ifNull: ["$raisedAmount", 0] }, { $ifNull: ["$reservedAmount", 0] }] }, "$targetAmount"] },
        ],
      },
    })
      .sort({ createdAt: -1 })
      .limit(30)
      .lean<NeedDocument[]>();
    const [volunteerResult, donationResult] = await Promise.all([
      Contribution.aggregate([
        { $match: { kind: "volunteer" } },
        { $lookup: { from: "needs", localField: "needId", foreignField: "_id", as: "need" } },
        { $unwind: "$need" },
        { $match: { "need.organizationId": organization._id } },
        { $count: "count" },
      ]),
      Contribution.aggregate([
        { $match: { kind: "donation", status: "completed" } },
        { $lookup: { from: "needs", localField: "needId", foreignField: "_id", as: "need" } },
        { $unwind: "$need" },
        { $match: { "need.organizationId": organization._id } },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]),
    ]);
    res.json({
      ngo: {
        id: organization._id.toString(),
        name: organization.name,
        city: organization.city,
        description: organization.description ?? "",
        categories: organization.categories ?? [],
        organizationStatus: "verified",
        activeTasks: needs.length,
        volunteerCount: volunteerResult[0]?.count ?? 0,
        fundsRaised: donationResult[0]?.total ?? 0,
      },
      needs: needs.map((need) => ({
        id: need._id.toString(),
        title: need.title,
        description: need.description,
        kind: need.kind,
        category: need.category,
        city: need.city,
        urgency: need.urgency,
        targetAmount: need.targetAmount,
        raisedAmount: need.raisedAmount,
        volunteersNeeded: need.volunteersNeeded,
        volunteersJoined: need.volunteersJoined,
        createdAt: need.createdAt.toISOString(),
        organizationName: organization.name,
        organizationVerified: true,
      })),
    });
  });

  router.post("/needs", requireAuth, requireRole("ngo"), async (req, res) => {
    const parsed = createNeedSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Check the opportunity details." });
      return;
    }
    const user = await User.findById(req.user!.id);
    if (!user || user.organizationStatus !== "verified") {
      res.status(403).json({ message: "Your organization must be verified before posting opportunities." });
      return;
    }
    const need = await Need.create({
      ...parsed.data,
      organizationId: user._id,
      ...(parsed.data.kind === "volunteer" ? { volunteersNeeded: parsed.data.volunteersNeeded ?? 1 } : {}),
    });
    const populated = await Need.findById(need._id)
      .populate<{ organizationId: OrganizationSummaryDocument }>("organizationId", "name organizationStatus")
      .lean<PopulatedNeedDocument | null>();
    if (!populated) throw new Error("New opportunity could not be loaded.");
    res.status(201).json({ need: formatNeed(populated) });
  });

  router.post("/needs/:id/fulfill", requireAuth, requireRole("volunteer"), async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) {
      res.status(400).json({ message: "That opportunity could not be found." });
      return;
    }
    const need = await Need.findOne({ _id: req.params.id, kind: "volunteer", status: "open" });
    if (!need) {
      res.status(404).json({ message: "This volunteer opportunity is no longer available." });
      return;
    }
    try {
      await Contribution.create({
        userId: req.user!.id,
        needId: need._id,
        kind: "volunteer",
        hours: 0,
        status: "pending",
      });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === 11000) {
        res.status(409).json({ message: "You’ve already joined this opportunity." });
        return;
      }
      throw error;
    }
    const reserved = await Need.updateOne(
      { _id: need._id, status: "open", $expr: { $lt: ["$volunteersJoined", "$volunteersNeeded"] } },
      { $inc: { volunteersJoined: 1 } },
    );
    if (reserved.modifiedCount !== 1) {
      await Contribution.deleteOne({ userId: req.user!.id, needId: need._id, kind: "volunteer" });
      res.status(409).json({ message: "This opportunity has filled all its volunteer spots." });
      return;
    }
    res.status(201).json({ message: "You’ve joined this volunteer opportunity." });
  });

  router.post("/payments/order", requireAuth, requireRole("donor", "volunteer"), async (req, res) => {
    const parsed = paymentOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Enter a valid donation amount." });
      return;
    }
    if (!config.RAZORPAY_KEY_ID || !config.RAZORPAY_KEY_SECRET) {
      res.status(503).json({ message: "Donations are not enabled yet. Add Razorpay test credentials to the server environment." });
      return;
    }
    await expireDonationReservations();
    const need = await Need.findOne({ _id: parsed.data.needId, kind: "donation", status: "open" });
    if (!need) {
      res.status(404).json({ message: "This donation opportunity is no longer available." });
      return;
    }
    let reservation: Awaited<ReturnType<typeof createDonationReservation>>;
    try {
      reservation = await createDonationReservation(req.user!.id, need._id, parsed.data.amount);
    } catch (error) {
      if (error instanceof Error && error.message === "CAMPAIGN_GOAL_REACHED") {
        res.status(400).json({ message: "That amount is more than the remaining fundraising goal." });
        return;
      }
      throw error;
    }

    let order: { id: string; amount: number; currency: string } | undefined;
    try {
      order = await createPaymentOrder({
        amountMinor: parsed.data.amount * 100,
        receipt: randomUUID(),
        notes: { needId: need._id.toString(), userId: req.user!.id, reservationToken: reservation.token },
      });
      const saved = await Contribution.updateOne(
        { _id: reservation.id, status: "creating", reservationToken: reservation.token },
        { $set: { status: "pending", orderId: order.id } },
      );
      if (!saved.modifiedCount) throw new Error("Payment order could not be attached to its reservation.");
    } catch (error) {
      await Contribution.updateOne(
        { _id: reservation.id, status: "creating" },
        { $set: { status: "failed" } },
      );
      await releaseCampaignReservation(need._id, reservation.token);
      throw error;
    }
    if (!order) throw new Error("Payment provider order was not created.");
    res.status(201).json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: config.RAZORPAY_KEY_ID,
    });
  });

  router.post("/payments/verify", requireAuth, requireRole("donor", "volunteer"), async (req, res) => {
    const parsed = paymentVerifySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Payment details are incomplete." });
      return;
    }
    if (!config.RAZORPAY_KEY_ID || !config.RAZORPAY_KEY_SECRET) {
      res.status(503).json({ message: "Payment verification is not configured." });
      return;
    }
    const { orderId, paymentId, signature } = parsed.data;
    if (!verifyProviderSignature(`${orderId}|${paymentId}`, signature, config.RAZORPAY_KEY_SECRET)) {
      res.status(400).json({ message: "Payment signature could not be verified." });
      return;
    }
    const contribution = await Contribution.findOne({ orderId, userId: req.user!.id, kind: "donation" });
    if (!contribution) {
      res.status(409).json({ message: "This payment is already recorded or its order could not be found." });
      return;
    }
    const payment = await fetchPayment(paymentId);
    if (payment.order_id !== orderId || payment.amount !== contribution.amount * 100 || payment.currency !== "INR") {
      res.status(409).json({ message: "Payment details do not match this donation order." });
      return;
    }
    if (payment.status !== "captured" || payment.captured !== true) {
      res.status(409).json({ message: "The payment has not been captured yet." });
      return;
    }
    const result = await settlePayment(orderId, paymentId, payment.amount);
    if (result === "refund_required") {
      res.status(409).json({ message: "This payment arrived after its campaign reservation expired. It requires a refund review." });
      return;
    }
    if (result !== "completed") {
      res.status(409).json({ message: "This payment could not be confirmed for the order." });
      return;
    }
    await notifyConfirmedDonation(orderId);
    const settled = await Contribution.findOne({ orderId, userId: req.user!.id }).select("receiptReference");
    res.json({
      message: "Donation confirmed. Thank you for making a difference.",
      status: "completed",
      receiptReference: settled?.receiptReference,
    });
  });

  router.get("/payments/order/:orderId/status", requireAuth, requireRole("donor", "volunteer"), async (req, res) => {
    const contribution = await Contribution.findOne({
      orderId: req.params.orderId,
      userId: req.user!.id,
      kind: "donation",
    }).select("status amount currency receiptReference updatedAt");
    if (!contribution) {
      res.status(404).json({ message: "Payment order was not found for this account." });
      return;
    }
    res.setHeader("Cache-Control", "private, no-store");
    res.json({
      status: contribution.status,
      amount: contribution.amount,
      currency: contribution.currency,
      ...(contribution.receiptReference ? { receiptReference: contribution.receiptReference } : {}),
      updatedAt: contribution.updatedAt.toISOString(),
    });
  });

  router.get("/impact/me", requireAuth, async (req, res) => {
    const contributions = await Contribution.find({ userId: req.user!.id }).lean<ContributionDocument[]>();
    const completed = contributions.filter((item) => item.status === "completed");
    res.json({
      impact: {
        donations: completed.reduce((sum, item) => sum + (item.kind === "donation" ? item.amount : 0), 0),
        volunteerSignups: contributions.filter((item) => item.kind === "volunteer" && item.status === "pending").length,
        completedActions: completed.length,
      },
    });
  });

  router.get("/impact/contributions/me", requireAuth, async (req, res) => {
    const contributions = await Contribution.find({ userId: req.user!.id })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean<ContributionDocument[]>();
    const needIds = contributions.map((item) => item.needId);
    const needs = await Need.find({ _id: { $in: needIds } })
      .select("title category city organizationId")
      .lean<Pick<NeedDocument, "_id" | "title" | "category" | "city" | "organizationId">[]>();
    const organizationIds = [...new Set(needs.map((item) => item.organizationId.toString()))];
    const organizations = await User.find({ _id: { $in: organizationIds } })
      .select("name")
      .lean<Pick<OrganizationDocument, "_id" | "name">[]>();
    const organizationsById = new Map(organizations.map((item) => [item._id.toString(), item.name]));
    const needsById = new Map(needs.map((item) => [item._id.toString(), item]));
    res.json({
      contributions: contributions.map((item) => {
        const need = needsById.get(item.needId.toString());
        return {
          id: item._id.toString(),
          kind: item.kind,
          amount: item.amount,
          hours: item.hours,
          status: item.status,
          createdAt: item.createdAt.toISOString(),
          ...(item.receiptReference ? { receiptReference: item.receiptReference } : {}),
          need: need ? {
            id: need._id.toString(),
            title: need.title,
            category: need.category,
            city: need.city,
            organizationName: organizationsById.get(need.organizationId.toString()) ?? "Organization",
          } : undefined,
        };
      }),
    });
  });

  router.get("/impact/contributions/:id/receipt", requireAuth, requireRole("donor", "volunteer"), async (req, res) => {
      if (!mongoose.isValidObjectId(req.params.id)) {
        res.status(404).json({ message: "Donation receipt not found." });
        return;
      }
      const contribution = await Contribution.findOne({
        _id: req.params.id,
        userId: req.user!.id,
        kind: "donation",
        status: "completed",
      }).select("needId amount currency receiptReference paymentId createdAt");
      if (!contribution) {
        res.status(404).json({ message: "A receipt is available only for a confirmed donation on your account." });
        return;
      }
      const need = await Need.findById(contribution.needId).select("title organizationId");
      const organization = need ? await User.findOne({ _id: need.organizationId, role: "ngo", organizationStatus: "verified" }).select("name") : null;
      const receiptReference = contribution.receiptReference ??
        `IM-${contribution.createdAt.getUTCFullYear()}-${contribution._id.toString().slice(-8).toUpperCase()}`;
      if (!contribution.receiptReference) {
        await Contribution.updateOne(
          { _id: contribution._id, status: "completed", receiptReference: { $exists: false } },
          { $set: { receiptReference } },
        );
      }
      res.setHeader("Cache-Control", "private, no-store");
      res.json({
        receipt: {
          reference: receiptReference,
          campaign: need?.title ?? "Community donation",
          organizationName: organization?.name ?? "Organization",
          amount: contribution.amount,
          currency: contribution.currency,
          confirmedAt: contribution.updatedAt.toISOString(),
          note: "Donation confirmation record. This is not a tax-deductible receipt.",
        },
      });
  });

  router.get("/notifications/me", requireAuth, async (req, res) => {
      const page = typeof req.query.page === "string" ? Number(req.query.page) : 1;
      const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : 20;
      if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 50) {
        res.status(400).json({ message: "Choose a valid notification page and page size (1–50)." });
        return;
      }
      const filter = { recipientId: req.user!.id };
      const [notifications, total, unreadCount] = await Promise.all([
        Notification.find(filter)
        .sort({ createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .lean(),
        Notification.countDocuments(filter),
        Notification.countDocuments({ ...filter, readAt: { $exists: false } }),
      ]);
      res.json({
        page,
        pageSize: limit,
        total,
        unreadCount,
        notifications: notifications.map((notification) => {
          const safePayload: Record<string, string> = {};
          for (const key of ["status", "requestId", "assignmentId", "donationId", "contributionId", "needId", "category", "urgency", "city", "receiptReference"]) {
            const value = notification.payload[key];
            if (typeof value === "string") safePayload[key] = value;
          }
          return {
            id: notification._id.toString(),
            type: notification.type,
            payload: safePayload,
            status: notification.status,
            readAt: notification.readAt?.toISOString(),
            createdAt: notification.createdAt.toISOString(),
          };
        }),
      });
  });

  router.get("/notifications/unread-count", requireAuth, async (req, res) => {
      const unreadCount = await Notification.countDocuments({
        recipientId: req.user!.id,
        readAt: { $exists: false },
      });
      res.json({ unreadCount });
  });

  router.patch("/notifications/:id/read", requireAuth, async (req, res) => {
      if (!mongoose.isValidObjectId(req.params.id)) {
        res.status(404).json({ message: "Notification not found." });
        return;
      }
      const notification = await Notification.findOneAndUpdate(
        { _id: req.params.id, recipientId: req.user!.id, readAt: { $exists: false } },
        { $set: { readAt: new Date() } },
        { new: true },
      ).select("_id readAt");
      if (!notification) {
        const owned = await Notification.exists({ _id: req.params.id, recipientId: req.user!.id });
        if (!owned) {
          res.status(404).json({ message: "Notification not found." });
          return;
        }
      }
      res.json({ readAt: notification?.readAt?.toISOString() });
  });

  router.post("/notifications/read-all", requireAuth, async (req, res) => {
      const result = await Notification.updateMany(
        { recipientId: req.user!.id, readAt: { $exists: false } },
        { $set: { readAt: new Date() } },
      );
      res.json({ updatedCount: result.modifiedCount });
  });

  router.get("/impact/summary", async (_req, res) => {
    res.json({ overview: await getImpactOverview() });
  });

  router.get("/ngo/donations", requireAuth, requireRole("ngo"), async (req, res) => {
    const verified = await User.exists({ _id: req.user!.id, role: "ngo", organizationStatus: "verified" });
    if (!verified) {
      res.status(403).json({ message: "Only verified organizations can view donation records." });
      return;
    }
    const campaigns = await Need.find({ organizationId: req.user!.id, kind: "donation" }).select("_id title category city");
    const campaignById = new Map(campaigns.map((campaign) => [campaign._id.toString(), campaign]));
    const contributions = await Contribution.find({
      needId: { $in: campaigns.map((campaign) => campaign._id) },
      kind: "donation",
      status: "completed",
    }).sort({ updatedAt: -1 }).limit(200);
    res.setHeader("Cache-Control", "private, no-store");
    res.json({
      donations: contributions.map((item) => {
        const campaign = campaignById.get(item.needId.toString());
        return {
          id: item._id.toString(),
          campaign: campaign?.title ?? "Campaign",
          category: campaign?.category ?? "",
          city: campaign?.city ?? "",
          amount: item.amount,
          currency: item.currency ?? "INR",
          confirmedAt: item.updatedAt.toISOString(),
          ...(item.receiptReference ? { receiptReference: item.receiptReference } : {}),
        };
      }),
    });
  });

  router.get("/volunteer/dashboard", requireAuth, requireRole("volunteer"), async (req, res) => {
    const [contributions, availableOpportunities, assignedTasks, activeTasks, completedTasks] = await Promise.all([
      Contribution.find({ userId: req.user!.id, kind: "volunteer" })
        .sort({ createdAt: -1 })
        .limit(50)
        .lean<ContributionDocument[]>(),
      VolunteerAssignment.countDocuments({
        volunteerId: req.user!.id,
        status: "offered",
        offerExpiresAt: { $gt: new Date() },
      }),
      VolunteerAssignment.countDocuments({
        volunteerId: req.user!.id,
        status: { $in: ["accepted", "in_progress", "submitted_for_review", "more_evidence_required", "rejected_with_reason", "flagged_for_manual_review"] },
      }),
      VolunteerAssignment.countDocuments({
        volunteerId: req.user!.id,
        status: { $in: ["accepted", "in_progress"] },
      }),
      VolunteerAssignment.countDocuments({ volunteerId: req.user!.id, status: "completed" }),
    ]);
    const needIds = contributions.map((item) => item.needId);
    const needs = await Need.find({ _id: { $in: needIds } }).lean<NeedDocument[]>();
    const organizationIds = [...new Set(needs.map((item) => item.organizationId.toString()))];
    const organizations = await User.find({ _id: { $in: organizationIds } })
      .select("name organizationStatus")
      .lean<Pick<OrganizationDocument, "_id" | "name" | "organizationStatus">[]>();
    const organizationById = new Map(organizations.map((item) => [item._id.toString(), item]));
    const needById = new Map(needs.map((item) => [item._id.toString(), item]));
    const impact = await Contribution.find({ userId: req.user!.id, status: "completed" }).lean<ContributionDocument[]>();
    res.json({
      contributions: contributions.map((item) => {
        const need = needById.get(item.needId.toString());
        const organization = need ? organizationById.get(need.organizationId.toString()) : undefined;
        return {
          id: item._id.toString(),
          kind: item.kind,
          amount: item.amount,
          hours: item.hours,
          status: item.status,
          createdAt: item.createdAt.toISOString(),
          need: need && organization ? {
            id: need._id.toString(),
            title: need.title,
            description: need.description,
            kind: need.kind,
            category: need.category,
            city: need.city,
            urgency: need.urgency,
            targetAmount: need.targetAmount,
            raisedAmount: need.raisedAmount,
            volunteersNeeded: need.volunteersNeeded,
            volunteersJoined: need.volunteersJoined,
            createdAt: need.createdAt.toISOString(),
            organizationName: organization.name,
            organizationVerified: organization.organizationStatus === "verified",
          } : undefined,
        };
      }),
      impact: {
        donations: impact.reduce((sum, item) => sum + (item.kind === "donation" ? item.amount : 0), 0),
        volunteerSignups: contributions.filter((item) => item.status === "pending").length,
        completedActions: impact.length,
      },
      stats: { availableOpportunities, assignedTasks, activeTasks, completedTasks },
    });
  });

  router.get("/volunteer/preferences", requireAuth, requireRole("volunteer"), async (req, res) => {
    const volunteer = await User.findOne({ _id: req.user!.id, role: "volunteer" })
      .select("city volunteerEligibility volunteerTaskOptIn volunteerLocation volunteerServiceArea volunteerServiceRadiusKm maxActiveAssignments activeVolunteerAssignmentCount skills categories");
    if (!volunteer) {
      res.status(404).json({ message: "Volunteer profile not found." });
      return;
    }
    const coordinates = volunteerCoordinates(volunteer.volunteerLocation);
    res.json({
      preferences: {
        city: volunteer.city ?? "",
        eligibility: volunteer.volunteerEligibility ?? "pending",
        taskOptIn: volunteer.volunteerTaskOptIn === true,
        serviceArea: volunteer.volunteerServiceArea ?? "",
        serviceRadiusKm: typeof volunteer.volunteerServiceRadiusKm === "number" &&
          Number.isFinite(volunteer.volunteerServiceRadiusKm)
          ? volunteer.volunteerServiceRadiusKm
          : config.VOLUNTEER_MATCH_RADIUS_KM,
        maxActiveAssignments: volunteer.maxActiveAssignments ?? 3,
        activeAssignments: volunteer.activeVolunteerAssignmentCount ?? 0,
        skills: volunteer.skills ?? [],
        categories: volunteer.categories ?? [],
        ...(coordinates ? { coordinates } : {}),
      },
    });
  });

  router.patch("/volunteer/preferences", requireAuth, requireRole("volunteer"), async (req, res) => {
    const parsed = volunteerPreferencesSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Check your task preferences." });
      return;
    }
    const volunteer = await User.findOne({ _id: req.user!.id, role: "volunteer", accountStatus: "active" })
      .select("volunteerEligibility");
    if (!volunteer) {
      res.status(403).json({ message: "Only active volunteer accounts can update task preferences." });
      return;
    }
    const { coordinates, clearCoordinates, serviceArea, serviceRadiusKm, ...fields } = parsed.data;
    const setFields: Record<string, unknown> = { volunteerTaskOptIn: fields.taskOptIn };
    if (fields.city) setFields.city = fields.city;
    if (serviceArea !== undefined) setFields.volunteerServiceArea = serviceArea;
    if (serviceRadiusKm !== undefined) setFields.volunteerServiceRadiusKm = serviceRadiusKm;
    if (coordinates) setFields.volunteerLocation = { type: "Point", coordinates: [coordinates.longitude, coordinates.latitude] };
    const update: Record<string, unknown> = { $set: setFields };
    if (!coordinates && clearCoordinates) update.$unset = { volunteerLocation: 1 };
    const updated = await User.findOneAndUpdate(
      { _id: req.user!.id, role: "volunteer", accountStatus: "active" },
      update,
      { new: true, runValidators: true },
    ).select("city volunteerEligibility volunteerTaskOptIn volunteerLocation volunteerServiceArea volunteerServiceRadiusKm maxActiveAssignments activeVolunteerAssignmentCount skills categories");
    if (!updated) {
      res.status(409).json({ message: "Volunteer profile changed; refresh and try again." });
      return;
    }
    const updatedCoordinates = volunteerCoordinates(updated.volunteerLocation);
    res.json({
      preferences: {
        city: updated.city ?? "",
        eligibility: updated.volunteerEligibility ?? "pending",
        taskOptIn: updated.volunteerTaskOptIn === true,
        serviceArea: updated.volunteerServiceArea ?? "",
        serviceRadiusKm: typeof updated.volunteerServiceRadiusKm === "number" &&
          Number.isFinite(updated.volunteerServiceRadiusKm)
          ? updated.volunteerServiceRadiusKm
          : config.VOLUNTEER_MATCH_RADIUS_KM,
        maxActiveAssignments: updated.maxActiveAssignments ?? 3,
        activeAssignments: updated.activeVolunteerAssignmentCount ?? 0,
        skills: updated.skills ?? [],
        categories: updated.categories ?? [],
        ...(updatedCoordinates ? { coordinates: updatedCoordinates } : {}),
      },
    });
  });

  router.get("/volunteer/tasks/available", requireAuth, requireRole("volunteer"), async (req, res) => {
    await expireVolunteerOffers(req.user!.id);
    const volunteer = await User.findOne({
      _id: req.user!.id,
      role: "volunteer",
      accountStatus: "active",
      volunteerEligibility: "eligible",
      volunteerTaskOptIn: true,
    }).select("_id");
    if (!volunteer) {
      res.json({ tasks: [], eligibility: "pending_or_opted_out" });
      return;
    }
    const offers = await VolunteerAssignment.find({
      volunteerId: volunteer._id,
      status: "offered",
      offerExpiresAt: { $gt: new Date() },
    }).sort({ createdAt: -1 }).limit(50);
    const requests = await HelpRequest.find({
      _id: { $in: offers.map((offer) => offer.requestId) },
      status: "matching_volunteer",
      $or: [{ assignedVolunteerId: { $exists: false } }, { assignedVolunteerId: null }],
    }).select("_id category urgency city peopleCount volunteerDeadlineAt");
    const requestById = new Map(requests.map((request) => [request._id.toString(), request]));
    const ngos = await User.find({
      _id: { $in: offers.map((offer) => offer.ngoId) },
      role: "ngo",
      organizationStatus: "verified",
    }).select("_id name");
    const ngoById = new Map(ngos.map((ngo) => [ngo._id.toString(), ngo]));
    res.json({
      eligibility: "eligible",
      tasks: offers.flatMap((offer) => {
        const request = requestById.get(offer.requestId.toString());
        const ngo = ngoById.get(offer.ngoId.toString());
        if (!request || !ngo) return [];
        return [{
          assignmentId: offer._id.toString(),
          summary: `${request.category.replace(/_/g, " ")} assistance request`,
          category: request.category,
          urgency: request.urgency,
          city: request.city,
          peopleCount: request.peopleCount,
          organizationName: ngo.name,
          matchExplanation: offer.matchExplanation,
          ...(offer.distanceKm === undefined ? {} : { approximateDistanceKm: Math.round(offer.distanceKm * 10) / 10 }),
          ...(request.volunteerDeadlineAt ? { deadlineAt: request.volunteerDeadlineAt.toISOString() } : {}),
          expiresAt: offer.offerExpiresAt.toISOString(),
          offeredAt: offer.createdAt.toISOString(),
        }];
      }),
    });
  });

  router.get("/volunteer/assignments", requireAuth, requireRole("volunteer"), async (req, res) => {
    const assignments = await VolunteerAssignment.find({ volunteerId: req.user!.id }).sort({ updatedAt: -1 }).limit(100);
    const requests = await HelpRequest.find({ _id: { $in: assignments.map((item) => item.requestId) } })
      .select("_id category urgency city assignedVolunteerId volunteerDeadlineAt");
    const requestById = new Map(requests.map((request) => [request._id.toString(), request]));
    const ngos = await User.find({ _id: { $in: assignments.map((item) => item.ngoId) }, role: "ngo" })
      .select("_id name");
    const ngoById = new Map(ngos.map((ngo) => [ngo._id.toString(), ngo]));
    res.json({
      assignments: assignments.map((assignment) => {
        const request = requestById.get(assignment.requestId.toString());
        return {
          id: assignment._id.toString(),
          status: assignment.status,
          createdAt: assignment.createdAt.toISOString(),
          updatedAt: assignment.updatedAt.toISOString(),
          category: request?.category ?? "other",
          summary: `${(request?.category ?? "Help").replace(/_/g, " ")} assistance task`,
          urgency: request?.urgency ?? "medium",
          city: request?.city ?? "",
          organizationName: ngoById.get(assignment.ngoId.toString())?.name ?? "Verified organization",
          ...(assignment.offerExpiresAt ? { offerExpiresAt: assignment.offerExpiresAt.toISOString() } : {}),
          ...(assignment.acceptedAt ? { acceptedAt: assignment.acceptedAt.toISOString() } : {}),
          ...(assignment.startedAt ? { startedAt: assignment.startedAt.toISOString() } : {}),
          ...(assignment.submittedAt ? { submittedAt: assignment.submittedAt.toISOString() } : {}),
          ...(assignment.progressNote ? { progressNote: assignment.progressNote } : {}),
          ...(request?.volunteerDeadlineAt ? { deadlineAt: request.volunteerDeadlineAt.toISOString() } : {}),
          isOverdue: Boolean(request?.volunteerDeadlineAt && request.volunteerDeadlineAt.getTime() < Date.now() &&
            ["accepted", "in_progress"].includes(assignment.status)),
          canAccessDetails: request?.assignedVolunteerId?.toString() === req.user!.id &&
            ["accepted", "in_progress", "submitted_for_review", "more_evidence_required", "rejected_with_reason", "flagged_for_manual_review", "completed"].includes(assignment.status),
        };
      }),
    });
  });

  router.get("/volunteer/assignments/:id/timeline", requireAuth, requireRole("volunteer"), async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) {
      res.status(404).json({ message: "Assignment not found." });
      return;
    }
    const assignment = await VolunteerAssignment.findOne({ _id: req.params.id, volunteerId: req.user!.id }).select("history");
    if (!assignment) {
      res.status(404).json({ message: "Assignment not found." });
      return;
    }
    res.json({
      timeline: assignment.history.map((item) => ({
        status: item.status,
        ...(item.reason ? { reason: item.reason } : {}),
        occurredAt: item.occurredAt.toISOString(),
      })),
    });
  });

  router.post("/volunteer/assignments/:id/accept", requireAuth, requireRole("volunteer"), volunteerTaskLimiter, async (req, res) => {
    const assignmentId = validRouteObjectId(req, "id");
    if (!assignmentId) {
      res.status(404).json({ message: "Task offer not found." });
      return;
    }
    await expireVolunteerOffers(req.user!.id);
    const result = await acceptVolunteerOffer(assignmentId, req.user!.id);
    if ("error" in result) {
      res.status(409).json({ message: result.error });
      return;
    }
    res.json({ assignment: { id: result.assignment._id.toString(), status: result.assignment.status, acceptedAt: result.assignment.acceptedAt?.toISOString() } });
  });

  router.post("/volunteer/assignments/:id/decline", requireAuth, requireRole("volunteer"), volunteerTaskLimiter, async (req, res) => {
    const assignmentId = validRouteObjectId(req, "id");
    if (!assignmentId) {
      res.status(404).json({ message: "Task offer not found." });
      return;
    }
    const assignment = await declineVolunteerOffer(assignmentId, req.user!.id);
    if (!assignment) {
      res.status(409).json({ message: "This offer is no longer available." });
      return;
    }
    res.json({ assignment: { id: assignment._id.toString(), status: assignment.status } });
  });

  router.get("/volunteer/assignments/:id/details", requireAuth, requireRole("volunteer"), async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) {
      res.status(404).json({ message: "Assigned task not found." });
      return;
    }
    const assignment = await VolunteerAssignment.findOne({
      _id: req.params.id,
      volunteerId: req.user!.id,
      status: { $in: ["accepted", "in_progress", "submitted_for_review", "more_evidence_required", "rejected_with_reason", "flagged_for_manual_review", "completed"] },
    });
    const request = assignment
      ? await HelpRequest.findOne({
        _id: assignment.requestId,
        assignedOrganizationId: assignment.ngoId,
        assignedVolunteerId: req.user!.id,
        status: { $in: ["assigned", "in_progress", "pending_completion_review", "more_evidence_required", "flagged_for_review", "completed"] },
      })
      : null;
    if (!assignment || !request) {
      res.status(404).json({ message: "Private task details are available only to the currently assigned volunteer." });
      return;
    }
    const requester = await User.findOne({ _id: request.requesterId, accountStatus: "active" }).select("name email phone");
    if (!requester) {
      res.status(404).json({ message: "Requester contact details are unavailable." });
      return;
    }
    const contact = request.preferredContactMethod === "phone" && requester.phone
      ? { method: "phone" as const, value: requester.phone }
      : request.preferredContactMethod === "email"
        ? { method: "email" as const, value: requester.email }
        : { method: "in_app" as const };
    res.setHeader("Cache-Control", "private, no-store");
    res.json({
      task: {
        id: assignment._id.toString(),
        summary: `${request.category.replace(/_/g, " ")} assistance request`,
        description: request.description,
        category: request.category,
        urgency: request.urgency,
        peopleCount: request.peopleCount,
        completionEvidenceChecklist: request.completionEvidenceChecklist ?? [],
        city: request.city,
        ...(request.volunteerDeadlineAt ? { deadlineAt: request.volunteerDeadlineAt.toISOString() } : {}),
        ...(request.addressLine ? { addressLine: request.addressLine } : {}),
        ...(request.location ? {
          coordinates: { latitude: request.location.coordinates[1], longitude: request.location.coordinates[0] },
        } : {}),
        contact: {
          requesterName: requester.name,
          preferredMethod: contact.method,
          ...(contact.value ? { value: contact.value } : {}),
        },
        status: assignment.status,
        progressNote: assignment.progressNote,
      },
    });
  });

  router.post("/volunteer/assignments/:id/start", requireAuth, requireRole("volunteer"), volunteerTaskLimiter, async (req, res) => {
    const assignmentId = validRouteObjectId(req, "id");
    if (!assignmentId) {
      res.status(404).json({ message: "Assignment not found." });
      return;
    }
    const assignment = await startVolunteerAssignment(assignmentId, req.user!.id);
    if (!assignment) {
      res.status(409).json({ message: "Only an accepted assignment can be started." });
      return;
    }
    res.json({ assignment: { id: assignment._id.toString(), status: assignment.status, startedAt: assignment.startedAt?.toISOString() } });
  });

  router.patch("/volunteer/assignments/:id/progress", requireAuth, requireRole("volunteer"), volunteerTaskLimiter, async (req, res) => {
    const parsed = volunteerProgressSchema.safeParse(req.body);
    const assignmentId = validRouteObjectId(req, "id");
    if (!parsed.success || !assignmentId) {
      res.status(400).json({ message: parsed.success ? "Choose a valid assignment." : parsed.error.issues[0]?.message ?? "Add a progress update." });
      return;
    }
    const assignment = await updateVolunteerProgress(assignmentId, req.user!.id, parsed.data.note);
    if (!assignment) {
      res.status(409).json({ message: "Progress can be updated only for your in-progress assignment." });
      return;
    }
    res.json({ assignment: { id: assignment._id.toString(), status: assignment.status, progressNote: assignment.progressNote } });
  });

  router.post("/volunteer/assignments/:id/report-issue", requireAuth, requireRole("volunteer"), volunteerTaskLimiter, async (req, res) => {
    const parsed = volunteerAssignmentReasonSchema.safeParse(req.body);
    const assignmentId = validRouteObjectId(req, "id");
    if (!parsed.success || !assignmentId) {
      res.status(400).json({ message: parsed.success ? "Choose a valid assignment." : parsed.error.issues[0]?.message ?? "Explain the issue." });
      return;
    }
    const ended = await endVolunteerAssignment({
      assignmentId,
      actorId: req.user!.id,
      actorRole: "volunteer",
      reason: parsed.data.reason,
      status: "disputed",
    });
    if (!ended) {
      res.status(409).json({ message: "This assignment cannot be changed in its current state." });
      return;
    }
    res.json({ assignment: { id: ended.assignment._id.toString(), status: ended.assignment.status }, request: requestSummary(ended.request) });
  });

  router.post("/volunteer/assignments/:id/cancel", requireAuth, requireRole("volunteer"), volunteerTaskLimiter, async (req, res) => {
    const parsed = volunteerAssignmentReasonSchema.safeParse(req.body);
    const assignmentId = validRouteObjectId(req, "id");
    if (!parsed.success || !assignmentId) {
      res.status(400).json({ message: parsed.success ? "Choose a valid assignment." : parsed.error.issues[0]?.message ?? "Add a cancellation reason." });
      return;
    }
    const ended = await endVolunteerAssignment({
      assignmentId,
      actorId: req.user!.id,
      actorRole: "volunteer",
      reason: parsed.data.reason,
      status: "cancelled",
    });
    if (!ended) {
      res.status(409).json({ message: "This assignment cannot be cancelled in its current state." });
      return;
    }
    res.json({ assignment: { id: ended.assignment._id.toString(), status: ended.assignment.status } });
  });

  router.post("/volunteer/assignments/:id/evidence", requireAuth, requireRole("volunteer"), requestUploadLimiter, express.raw({ type: () => true, limit: config.UPLOAD_MAX_BYTES }), async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) {
      res.status(404).json({ message: "Assignment not found." });
      return;
    }
    const assignment = await VolunteerAssignment.findOne({
      _id: req.params.id,
      volunteerId: req.user!.id,
      status: { $in: ["in_progress", "more_evidence_required", "rejected_with_reason"] },
    });
    const request = assignment
      ? await HelpRequest.findOne({
        _id: assignment.requestId,
        assignedVolunteerId: req.user!.id,
        status: { $in: ["in_progress", "more_evidence_required"] },
      }).select("_id")
      : null;
    if (!assignment || !request) {
      res.status(404).json({ message: "Completion evidence can be uploaded only to your active assignment." });
      return;
    }
    const body = req.body;
    const contentType = req.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
    const fileType = requestFileTypes[contentType];
    let suppliedName: string | undefined;
    try {
      const encodedName = req.get("x-upload-filename");
      suppliedName = encodedName ? decodeURIComponent(encodedName) : undefined;
    } catch {
      res.status(400).json({ message: "The evidence filename is invalid." });
      return;
    }
    if (!Buffer.isBuffer(body) || body.length === 0 || !fileType || !suppliedName || suppliedName.length > 200) {
      res.status(415).json({ message: "Upload one non-empty JPEG, PNG, WebP, or PDF file." });
      return;
    }
    const extension = suppliedName.split(/[\\/]/).pop()?.split(".").pop()?.toLowerCase();
    if (extension !== fileType.extension.slice(1) || !fileType.magic(body)) {
      res.status(415).json({ message: "The filename, MIME type, and file content must match a supported format." });
      return;
    }
    const reservedAssignment = await VolunteerAssignment.findOneAndUpdate(
      {
        _id: assignment._id,
        volunteerId: req.user!.id,
        status: { $in: ["in_progress", "more_evidence_required", "rejected_with_reason"] },
        $expr: { $lt: [{ $ifNull: ["$evidenceCount", 0] }, config.UPLOAD_MAX_FILES] },
      },
      { $inc: { evidenceCount: 1 } },
      { new: true },
    ).select("_id");
    if (!reservedAssignment) {
      const count = await AssignmentEvidence.countDocuments({ assignmentId: assignment._id });
      if (count >= config.UPLOAD_MAX_FILES) {
      res.status(413).json({ message: `An assignment can include up to ${config.UPLOAD_MAX_FILES} evidence files.` });
      } else {
        res.status(409).json({ message: "The assignment changed and can no longer accept evidence." });
      }
      return;
    }
    const originalName = (suppliedName.split(/[\\/]/).pop() ?? "evidence")
      .replace(/[^\w .()-]/g, "_").trim().slice(0, 120) || `evidence${fileType.extension}`;
    let stored: Awaited<ReturnType<typeof savePrivateObject>> | undefined;
    let evidence: HydratedDocument<AssignmentEvidenceDocument>;
    try {
      stored = await savePrivateObject(body);
      evidence = await AssignmentEvidence.create({
        requestId: request._id,
        assignmentId: assignment._id,
        uploadedBy: req.user!.id,
        privateObjectKey: stored.key,
        originalName,
        contentType,
        byteSize: body.length,
        checksum: stored.checksum,
      });
    } catch (error) {
      await Promise.all([
        stored ? deletePrivateObject(stored.key) : Promise.resolve(),
        VolunteerAssignment.updateOne({ _id: assignment._id }, { $inc: { evidenceCount: -1 } }),
      ]);
      throw error;
    }
    await recordAuditEvent({
      actorId: req.user!.id,
      action: "volunteer_assignment.evidence_uploaded",
      resourceType: "volunteer_assignment",
      resourceId: assignment._id.toString(),
    });
    res.status(201).json({
      evidence: {
        id: evidence._id.toString(),
        name: evidence.originalName,
        contentType: evidence.contentType,
        byteSize: evidence.byteSize,
      },
    });
  });

  router.get("/volunteer/assignments/:id/evidence", requireAuth, requireRole("volunteer"), async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) {
      res.status(404).json({ message: "Evidence not found." });
      return;
    }
    const assignment = await VolunteerAssignment.findOne({
      _id: req.params.id,
      volunteerId: req.user!.id,
      status: { $in: ["in_progress", "submitted_for_review", "more_evidence_required", "rejected_with_reason", "flagged_for_manual_review", "completed"] },
    });
    const request = assignment
      ? await HelpRequest.findOne({
        _id: assignment.requestId,
        assignedVolunteerId: req.user!.id,
        status: { $in: ["in_progress", "more_evidence_required", "pending_completion_review", "flagged_for_review", "completed"] },
      }).select("_id")
      : null;
    if (!assignment || !request) {
      res.status(404).json({ message: "Evidence is available only to the assigned volunteer." });
      return;
    }
    const evidence = await AssignmentEvidence.find({ assignmentId: assignment._id, uploadedBy: req.user!.id }).sort({ createdAt: 1 });
    await recordAuditEvent({
      actorId: req.user!.id,
      action: "completion_evidence.listed",
      resourceType: "volunteer_assignment",
      resourceId: assignment._id.toString(),
    });
    res.json({
      evidence: evidence.map((item) => ({
        id: item._id.toString(),
        name: item.originalName,
        contentType: item.contentType,
        byteSize: item.byteSize,
        createdAt: item.createdAt.toISOString(),
      })),
    });
  });

  router.get("/volunteer/assignments/:id/completion-proofs", requireAuth, requireRole("volunteer"), async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) {
      res.status(404).json({ message: "Completion history not found." });
      return;
    }
    const assignment = await VolunteerAssignment.findOne({ _id: req.params.id, volunteerId: req.user!.id });
    const request = assignment
      ? await HelpRequest.findOne({ _id: assignment.requestId, assignedVolunteerId: req.user!.id }).select("_id")
      : null;
    if (!assignment || !request) {
      res.status(404).json({ message: "Completion history is available only to the assigned volunteer." });
      return;
    }
    const proofs = await CompletionProof.find({ assignmentId: assignment._id, submittedBy: req.user!.id })
      .sort({ submittedAt: -1 })
      .select("summary status submittedAt reviewedAt reviewHistory aiReview unresolvedIssues completedAt");
    await recordAuditEvent({
      actorId: req.user!.id,
      action: "completion_proof.history_viewed",
      resourceType: "volunteer_assignment",
      resourceId: assignment._id.toString(),
    });
    res.json({
      proofs: proofs.map((proof) => ({
        id: proof._id.toString(),
        summary: proof.summary,
        status: proof.status,
        submittedAt: proof.submittedAt.toISOString(),
        ...(proof.reviewedAt ? { reviewedAt: proof.reviewedAt.toISOString() } : {}),
        ...(proof.reviewHistory.at(-1)?.reason ? { reviewReason: proof.reviewHistory.at(-1)!.reason } : {}),
        ...(proof.unresolvedIssues ? { unresolvedIssues: proof.unresolvedIssues } : {}),
        ...(proof.aiReview ? {
          aiReview: {
            recommendation: proof.aiReview.recommendation,
            findings: proof.aiReview.findings,
            missingEvidence: proof.aiReview.missingEvidence,
            uncertainty: proof.aiReview.uncertainty,
            provider: proof.aiReview.provider,
            ...(proof.aiReview.model ? { model: proof.aiReview.model } : {}),
            assessedAt: proof.aiReview.assessedAt?.toISOString(),
          },
        } : {}),
      })),
    });
  });

  router.post("/volunteer/assignments/:id/submit", requireAuth, requireRole("volunteer"), volunteerTaskLimiter, async (req, res) => {
    const parsed = volunteerProofSchema.safeParse(req.body);
    const assignmentId = validRouteObjectId(req, "id");
    if (!parsed.success || !assignmentId) {
      res.status(400).json({ message: parsed.success ? "Choose a valid assignment." : parsed.error.issues[0]?.message ?? "Complete the report." });
      return;
    }
    const result = await submitAssignmentProof({
      assignmentId,
      volunteerId: req.user!.id,
      summary: parsed.data.summary ?? parsed.data.report.slice(0, 500),
      report: parsed.data.report,
      completedAt: parsed.data.completedAt ? new Date(parsed.data.completedAt) : new Date(),
      ...(parsed.data.unresolvedIssues ? { unresolvedIssues: parsed.data.unresolvedIssues } : {}),
      ...(parsed.data.recipientConfirmed === undefined ? {} : { recipientConfirmed: parsed.data.recipientConfirmed }),
      consentedToAiReview: parsed.data.consentedToAiReview,
    });
    if (!result) {
      res.status(409).json({ message: "Only your in-progress assignment can be submitted for review." });
      return;
    }
    if ("error" in result) {
      res.status(400).json({ message: result.error });
      return;
    }
    res.json({
      assignment: { id: result.assignment._id.toString(), status: result.assignment.status, submittedAt: result.assignment.submittedAt?.toISOString() },
      proofId: result.proof._id.toString(),
      aiReview: {
        recommendation: result.proof.aiReview?.recommendation ?? "provider_unavailable",
        findings: result.proof.aiReview?.findings ?? [],
        missingEvidence: result.proof.aiReview?.missingEvidence ?? [],
        uncertainty: result.proof.aiReview?.uncertainty ?? "Automated review is unavailable; human NGO review is still required.",
        provider: result.proof.aiReview?.provider ?? "not_configured",
        ...(result.proof.aiReview?.model ? { model: result.proof.aiReview.model } : {}),
        assessedAt: result.proof.aiReview?.assessedAt?.toISOString(),
      },
    });
  });

  router.get("/volunteer/assignments/:id/evidence/:evidenceId/content", requireAuth, async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id) || !mongoose.isValidObjectId(req.params.evidenceId)) {
      res.status(404).json({ message: "Evidence not found." });
      return;
    }
    const assignment = await VolunteerAssignment.findById(req.params.id);
    const request = assignment && assignment.volunteerId.toString() === req.user!.id
      ? await HelpRequest.findOne({
        _id: assignment.requestId,
        assignedVolunteerId: req.user!.id,
        status: { $in: ["assigned", "in_progress", "pending_completion_review", "more_evidence_required", "flagged_for_review", "completed"] },
      }).select("_id")
      : null;
    if (!assignment || !request || !["accepted", "in_progress", "submitted_for_review", "more_evidence_required", "rejected_with_reason", "flagged_for_manual_review", "completed"].includes(assignment.status)) {
      res.status(404).json({ message: "Evidence not found." });
      return;
    }
    const evidence = await AssignmentEvidence.findOne({ _id: req.params.evidenceId, assignmentId: assignment._id, uploadedBy: req.user!.id });
    if (!evidence) {
      res.status(404).json({ message: "Evidence not found." });
      return;
    }
    await recordAuditEvent({
      actorId: req.user!.id,
      action: "completion_evidence.downloaded",
      resourceType: "assignment_evidence",
      resourceId: evidence._id.toString(),
    });
    const content = await readPrivateObject(evidence.privateObjectKey);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", `attachment; filename="${evidence.originalName.replace(/["\r\n]/g, "_")}"`);
    res.type(evidence.contentType).send(content);
  });

  router.get("/volunteer/recommendations", requireAuth, requireRole("volunteer"), async (req, res) => {
    const organizations = await User.find({ role: "ngo", accountStatus: "active", organizationStatus: "verified" })
      .select("_id name")
      .lean<Pick<OrganizationDocument, "_id" | "name" | "organizationStatus">[]>();
    const needs = await Need.find({
      organizationId: { $in: organizations.map((organization) => organization._id) },
      kind: "volunteer",
      status: "open",
    })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean<NeedDocument[]>();
    const matches = matchVolunteerToNeeds(req.user!, needs).slice(0, 6);
    const needsById = new Map(needs.map((need) => [need._id.toString(), need]));
    const organizationsById = new Map(organizations.map((organization) => [organization._id.toString(), organization]));
    res.json({
      matches: matches.map((match) => {
        const need = needsById.get(match.needId)!;
        const organization = organizationsById.get(need.organizationId.toString());
        return {
          score: match.score,
          reasons: match.reasons,
          need: {
            id: need._id.toString(),
            title: need.title,
            description: need.description,
            kind: need.kind,
            category: need.category,
            city: need.city,
            organizationName: organization?.name ?? "Verified organization",
            organizationVerified: true,
            urgency: need.urgency,
            targetAmount: need.targetAmount,
            raisedAmount: need.raisedAmount,
            volunteersNeeded: need.volunteersNeeded,
            volunteersJoined: need.volunteersJoined,
            createdAt: need.createdAt.toISOString(),
          },
        };
      }),
    });
  });

  router.get("/volunteer/applications", requireAuth, requireRole("volunteer"), async (req, res) => {
    const contributions = await Contribution.find({ userId: req.user!.id, kind: "volunteer" })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean<ContributionDocument[]>();
    res.json({
      contributions: contributions.map((item) => ({
        id: item._id.toString(),
        kind: item.kind,
        amount: item.amount,
        hours: item.hours,
        status: item.status,
        createdAt: item.createdAt.toISOString(),
      })),
    });
  });

  router.get("/ngo/dashboard", requireAuth, requireRole("ngo"), async (req, res) => {
    const organization = await User.findById(req.user!.id);
    if (!organization) {
      res.status(404).json({ message: "Organization account not found." });
      return;
    }
    const needs = await Need.find({ organizationId: organization._id })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean<NeedDocument[]>();
    const needIds = needs.map((item) => item._id);
    const contributions = await Contribution.find({ needId: { $in: needIds }, kind: "volunteer" })
      .sort({ createdAt: -1 })
      .limit(10)
      .populate<{ userId: VolunteerApplicationDocument["userId"] }>("userId", "name city")
      .lean<VolunteerApplicationDocument[]>();
    const donations = await Contribution.aggregate([
      { $match: { needId: { $in: needIds }, kind: "donation", status: "completed" } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);
    const [
      incomingRequests,
      pendingReviews,
      approvedRequests,
      completedRequests,
      activeAssignments,
    ] = await Promise.all([
      HelpRequest.countDocuments({
        assignedOrganizationId: organization._id,
        status: { $in: ["pending_ngo_review", "under_review", "needs_information", "flagged_for_review"] },
      }),
      HelpRequest.countDocuments({
        assignedOrganizationId: organization._id,
        status: { $in: ["pending_ngo_review", "under_review", "pending_completion_review", "more_evidence_required"] },
      }),
      HelpRequest.countDocuments({
        assignedOrganizationId: organization._id,
        status: { $in: ["approved", "matching_volunteer", "assigned", "matched", "in_progress"] },
      }),
      HelpRequest.countDocuments({ assignedOrganizationId: organization._id, status: "completed" }),
      VolunteerAssignment.countDocuments({
        ngoId: organization._id,
        status: { $in: ["accepted", "in_progress", "submitted_for_review", "more_evidence_required", "rejected_with_reason", "flagged_for_manual_review"] },
      }),
    ]);
    const recentVolunteers = contributions.map((item) => ({
      id: item._id.toString(),
      name: item.userId.name,
      city: item.userId.city,
      status: item.status,
      createdAt: item.createdAt.toISOString(),
    }));
    res.json({
      organization: safeUser(organization),
      needs: needs.map((item) => ({
        id: item._id.toString(),
        title: item.title,
        description: item.description,
        kind: item.kind,
        category: item.category,
        city: item.city,
        urgency: item.urgency,
        targetAmount: item.targetAmount,
        raisedAmount: item.raisedAmount,
        volunteersNeeded: item.volunteersNeeded,
        volunteersJoined: item.volunteersJoined,
        createdAt: item.createdAt.toISOString(),
        organizationName: organization.name,
        organizationVerified: organization.organizationStatus === "verified",
      })),
      stats: {
        activeTasks: needs.filter((item) => item.status === "open").length,
        volunteers: needs.reduce((sum, item) => sum + item.volunteersJoined, 0),
        donations: donations[0]?.total ?? 0,
        incomingRequests,
        pendingReviews,
        approvedRequests,
        activeAssignments,
        completedRequests,
      },
      recentVolunteers,
    });
  });

  router.get("/admin/volunteers", requireAuth, requireRole("admin"), async (req, res) => {
    const status = typeof req.query.status === "string" &&
      ["pending", "under_review", "eligible", "rejected", "more_information_required", "suspended"].includes(req.query.status)
      ? req.query.status
      : undefined;
    const volunteers = await User.find({
      role: "volunteer",
      ...(status ? { volunteerEligibility: status } : {}),
    }).select("name email city skills interests languages volunteerAvailability volunteerServiceArea volunteerServiceRadiusKm categories volunteerEligibility volunteerTaskOptIn accountStatus verificationReason verificationReviewedAt createdAt")
      .sort({ createdAt: 1 }).limit(200);
    const verificationDocuments = await VerificationDocument.find({
    applicantId: { $in: volunteers.map((volunteer) => volunteer._id) },
    }).select("applicantId kind originalName contentType byteSize createdAt").sort({ createdAt: 1 });
    const documentsByApplicant = new Map<string, typeof verificationDocuments>();
    for (const document of verificationDocuments) {
    const applicantId = document.applicantId.toString();
    const documents = documentsByApplicant.get(applicantId) ?? [];
    documents.push(document);
    documentsByApplicant.set(applicantId, documents);
    }
    res.json({
      volunteers: volunteers.map((volunteer) => ({
        id: volunteer._id.toString(),
        name: volunteer.name,
        email: volunteer.email,
        city: volunteer.city,
        skills: volunteer.skills ?? [],
        interests: volunteer.interests ?? [],
        languages: volunteer.languages ?? [],
        ...(volunteer.volunteerAvailability ? { availability: volunteer.volunteerAvailability } : {}),
        ...(volunteer.volunteerServiceArea ? { serviceArea: volunteer.volunteerServiceArea } : {}),
        serviceRadiusKm: volunteer.volunteerServiceRadiusKm ?? 30,
        categories: volunteer.categories ?? [],
        eligibility: volunteer.volunteerEligibility ?? "pending",
        ...(volunteer.verificationReason ? { verificationReason: volunteer.verificationReason } : {}),
        ...(volunteer.verificationReviewedAt ? { reviewedAt: volunteer.verificationReviewedAt.toISOString() } : {}),
        documents: (documentsByApplicant.get(volunteer._id.toString()) ?? []).map((document) => ({
          id: document._id.toString(),
          kind: document.kind,
          name: document.originalName,
          contentType: document.contentType,
          byteSize: document.byteSize,
          createdAt: document.createdAt.toISOString(),
        })),
        taskOptIn: volunteer.volunteerTaskOptIn === true,
        accountStatus: volunteer.accountStatus ?? "active",
        createdAt: volunteer.createdAt.toISOString(),
      })),
    });
  });

  router.get("/admin/volunteers/:id", requireAuth, requireRole("admin"), async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) {
      res.status(400).json({ message: "Choose a valid volunteer." });
      return;
    }
    const volunteer = await User.findOne({ _id: req.params.id, role: "volunteer" })
      .select("name email city phone skills interests volunteerServiceArea volunteerServiceRadiusKm volunteerEligibility volunteerTaskOptIn verificationReason verificationReviewedBy verificationReviewedAt verificationHistory createdAt");
    if (!volunteer) {
      res.status(404).json({ message: "Volunteer account not found." });
      return;
    }
    const documents = await VerificationDocument.find({ applicantId: volunteer._id })
      .select("kind originalName contentType byteSize createdAt")
      .sort({ createdAt: 1 });
    res.json({
      volunteer: {
        id: volunteer._id.toString(),
        name: volunteer.name,
        email: volunteer.email,
        city: volunteer.city,
        ...(volunteer.phone ? { phone: volunteer.phone } : {}),
        skills: volunteer.skills ?? [],
        interests: volunteer.interests ?? [],
        ...(volunteer.volunteerServiceArea ? { serviceArea: volunteer.volunteerServiceArea } : {}),
        serviceRadiusKm: volunteer.volunteerServiceRadiusKm ?? 30,
        eligibility: volunteer.volunteerEligibility ?? "pending",
        ...(volunteer.verificationReason ? { verificationReason: volunteer.verificationReason } : {}),
        ...(volunteer.verificationReviewedAt ? { reviewedAt: volunteer.verificationReviewedAt.toISOString() } : {}),
        createdAt: volunteer.createdAt.toISOString(),
        history: volunteer.verificationHistory.map((entry) => ({
          status: entry.status,
          ...(entry.reason ? { reason: entry.reason } : {}),
          occurredAt: entry.occurredAt.toISOString(),
        })),
        documents: documents.map((document) => ({
          id: document._id.toString(),
          kind: document.kind,
          name: document.originalName,
          contentType: document.contentType,
          byteSize: document.byteSize,
          createdAt: document.createdAt.toISOString(),
        })),
      },
    });
  });

  router.get("/admin/verification-documents/:documentId/content", requireAuth, requireRole("admin"), async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.documentId)) {
      res.status(404).json({ message: "Verification document not found." });
      return;
    }
    const document = await VerificationDocument.findById(req.params.documentId);
    if (!document) {
      res.status(404).json({ message: "Verification document not found." });
      return;
    }
    const content = await readPrivateObject(document.privateObjectKey);
    await recordAuditEvent({
      actorId: req.user!.id,
      action: "verification.document_accessed",
      resourceType: "verification_application",
      resourceId: document.applicantId.toString(),
    });
    const safeName = document.originalName.replace(/["\r\n]/g, "_");
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}"`);
    res.type(document.contentType).send(content);
  });

  router.patch("/admin/volunteers/:id/eligibility", requireAuth, requireRole("admin"), async (req, res) => {
    const parsed = volunteerEligibilitySchema.safeParse(req.body);
    if (!parsed.success || !mongoose.isValidObjectId(req.params.id)) {
      res.status(400).json({ message: parsed.success ? "Choose a valid volunteer." : parsed.error.issues[0]?.message ?? "Choose an eligibility status." });
      return;
    }
    const current = await User.findOne({ _id: req.params.id, role: "volunteer" })
      .select("volunteerEligibility volunteerTaskOptIn activeVolunteerAssignmentCount");
    if (!current) {
      res.status(404).json({ message: "Volunteer account not found." });
      return;
    }
    const [currentAssignments, currentPickups] = await Promise.all([
      VolunteerAssignment.countDocuments({
        volunteerId: req.params.id,
        status: { $in: ["accepted", "in_progress", "submitted_for_review", "more_evidence_required", "rejected_with_reason", "flagged_for_manual_review"] },
      }),
      ItemPickupAssignment.countDocuments({
        volunteerId: req.params.id,
        status: { $in: ["accepted", "in_progress", "submitted_for_review", "disputed"] },
      }),
    ]);
    if (parsed.data.status === "suspended" && (currentAssignments > 0 || currentPickups > 0 || (current.activeVolunteerAssignmentCount ?? 0) > 0)) {
      res.status(409).json({ message: "Reassign active tasks before suspending this volunteer." });
      return;
    }
    const eligibilityFilter: Record<string, unknown> = {
      _id: req.params.id,
      role: "volunteer",
      volunteerEligibility: current.volunteerEligibility,
    };
    if (parsed.data.status === "suspended") {
      eligibilityFilter.$expr = { $eq: [{ $ifNull: ["$activeVolunteerAssignmentCount", 0] }, 0] };
    }
    const volunteer = await User.findOneAndUpdate(
      eligibilityFilter,
      {
        $set: {
          volunteerEligibility: parsed.data.status,
          verificationReviewedBy: req.user!.id,
          verificationReviewedAt: new Date(),
          ...(parsed.data.status === "suspended" ? { volunteerTaskOptIn: false } : {}),
          ...(parsed.data.reason ? { verificationReason: parsed.data.reason } : {}),
        },
        ...(parsed.data.status === "eligible" ? { $unset: { verificationReason: 1 } } : {}),
        $push: {
          verificationHistory: {
            status: parsed.data.status,
            actorId: req.user!.id,
            ...(parsed.data.reason ? { reason: parsed.data.reason } : {}),
            occurredAt: new Date(),
          },
        },
      },
      { new: true, runValidators: true },
    ).select("name volunteerEligibility volunteerTaskOptIn");
    if (!volunteer) {
      res.status(409).json({ message: "Volunteer eligibility changed; refresh and try again." });
      return;
    }
    await recordAuditEvent({
      actorId: req.user!.id,
      action: "volunteer.eligibility_reviewed",
      resourceType: "volunteer",
      resourceId: volunteer._id.toString(),
      previousStatus: current.volunteerEligibility ?? "pending",
      newStatus: volunteer.volunteerEligibility,
      reason: parsed.data.reason,
    });
    await Notification.create({
      recipientId: volunteer._id,
      type: "volunteer_eligibility_updated",
      idempotencyKey: `volunteer-eligibility:${volunteer._id.toString()}:${Date.now()}`,
      payload: { status: volunteer.volunteerEligibility },
      status: "sent",
    });
    res.json({ volunteer: { id: volunteer._id.toString(), eligibility: volunteer.volunteerEligibility, taskOptIn: volunteer.volunteerTaskOptIn } });
  });

  router.get("/admin/assignments/:id/details", requireAuth, requireRole("admin"), async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) {
      res.status(404).json({ message: "Assignment not found." });
      return;
    }
    const assignment = await VolunteerAssignment.findById(req.params.id);
    const request = assignment ? await HelpRequest.findById(assignment.requestId) : null;
    if (!assignment || !request) {
      res.status(404).json({ message: "Assignment not found." });
      return;
    }
    const requester = await User.findById(request.requesterId).select("name email phone");
    if (!requester) {
      res.status(404).json({ message: "Requester not found." });
      return;
    }
    res.setHeader("Cache-Control", "private, no-store");
    res.json({
      task: {
        id: assignment._id.toString(),
        requestId: request._id.toString(),
        category: request.category,
        urgency: request.urgency,
        description: request.description,
        city: request.city,
        addressLine: request.addressLine,
        coordinates: request.location ? {
          latitude: request.location.coordinates[1],
          longitude: request.location.coordinates[0],
        } : undefined,
        requester: { name: requester.name, email: requester.email, phone: requester.phone },
        status: assignment.status,
      },
    });
  });

  router.get("/admin/assignments/:id/evidence", requireAuth, requireRole("admin"), async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) {
      res.status(404).json({ message: "Evidence not found." });
      return;
    }
    const assignment = await VolunteerAssignment.findById(req.params.id);
    if (!assignment) {
      res.status(404).json({ message: "Evidence not found." });
      return;
    }
    const proof = await CompletionProof.findOne({ assignmentId: assignment._id }).sort({ submittedAt: -1 });
    const evidence = await AssignmentEvidence.find({
      _id: { $in: proof?.evidenceIds ?? [] },
      assignmentId: assignment._id,
    }).sort({ createdAt: 1 });
    await recordAuditEvent({
      actorId: req.user!.id,
      action: "completion_evidence.listed",
      resourceType: "volunteer_assignment",
      resourceId: assignment._id.toString(),
    });
    res.json({
      summary: proof?.summary ?? "",
      report: proof?.report ?? "",
      status: proof?.status ?? "submitted",
      aiReview: proof?.aiReview ? {
        recommendation: proof.aiReview.recommendation,
        findings: proof.aiReview.findings,
        missingEvidence: proof.aiReview.missingEvidence,
        uncertainty: proof.aiReview.uncertainty,
        provider: proof.aiReview.provider,
        ...(proof.aiReview.model ? { model: proof.aiReview.model } : {}),
        assessedAt: proof.aiReview.assessedAt?.toISOString(),
      } : null,
      reviewHistory: proof?.reviewHistory.map((item) => ({
        status: item.status,
        ...(item.reason ? { reason: item.reason } : {}),
        occurredAt: item.occurredAt.toISOString(),
      })) ?? [],
      evidence: evidence.map((item) => ({
        id: item._id.toString(),
        name: item.originalName,
        contentType: item.contentType,
        byteSize: item.byteSize,
      })),
    });
  });

  router.get("/admin/assignments/:id/evidence/:evidenceId/content", requireAuth, requireRole("admin"), async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id) || !mongoose.isValidObjectId(req.params.evidenceId)) {
      res.status(404).json({ message: "Evidence not found." });
      return;
    }
    const assignment = await VolunteerAssignment.findById(req.params.id).select("_id");
    const evidence = assignment
      ? await AssignmentEvidence.findOne({ _id: req.params.evidenceId, assignmentId: assignment._id })
      : null;
    if (!evidence) {
      res.status(404).json({ message: "Evidence not found." });
      return;
    }
    await recordAuditEvent({
      actorId: req.user!.id,
      action: "completion_evidence.downloaded",
      resourceType: "assignment_evidence",
      resourceId: evidence._id.toString(),
    });
    const content = await readPrivateObject(evidence.privateObjectKey);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", `attachment; filename="${evidence.originalName.replace(/["\r\n]/g, "_")}"`);
    res.type(evidence.contentType).send(content);
  });

  router.get("/admin/completion-reviews", requireAuth, requireRole("admin"), async (_req, res) => {
    const assignments = await VolunteerAssignment.find({ status: "flagged_for_manual_review" })
      .sort({ updatedAt: -1 })
      .limit(100);
    const reviews = await Promise.all(assignments.map(async (assignment) => {
      const [request, proof] = await Promise.all([
        HelpRequest.findOne({ _id: assignment.requestId, assignedOrganizationId: assignment.ngoId, assignedVolunteerId: assignment.volunteerId, status: "flagged_for_review" })
          .select("_id title category urgency city"),
        CompletionProof.findOne({ assignmentId: assignment._id, status: "flagged_for_manual_review" })
          .sort({ submittedAt: -1 })
          .select("summary submittedAt reviewHistory aiReview"),
      ]);
      if (!request || !proof) return null;
      return {
        assignmentId: assignment._id.toString(),
        requestId: request._id.toString(),
        reference: request._id.toString(),
        title: request.title,
        category: request.category,
        urgency: request.urgency,
        city: request.city,
        summary: proof.summary,
        submittedAt: proof.submittedAt.toISOString(),
        ...(proof.reviewHistory.at(-1)?.reason ? { flagReason: proof.reviewHistory.at(-1)!.reason } : {}),
        aiRecommendation: proof.aiReview?.recommendation ?? "provider_unavailable",
      };
    }));
    res.json({ reviews: reviews.filter((item): item is NonNullable<typeof item> => item !== null) });
  });

  router.post("/admin/assignments/:id/manual-review", requireAuth, requireRole("admin"), volunteerTaskLimiter, async (req, res) => {
    const parsed = manualReviewResolutionSchema.safeParse(req.body);
    const assignmentId = validRouteObjectId(req, "id");
    if (!parsed.success || !assignmentId) {
      res.status(400).json({ message: parsed.success ? "Choose a valid assignment." : parsed.error.issues[0]?.message ?? "Explain the manual review outcome." });
      return;
    }
    const result = await returnFlaggedProofToNgo({
      assignmentId,
      actorId: req.user!.id,
      reason: parsed.data.reason,
    });
    if ("error" in result) {
      res.status(409).json({ message: result.error });
      return;
    }
    res.json(result);
  });

  router.get("/admin/overview", requireAuth, requireRole("admin"), async (_req, res) => {
    res.json({ overview: await getImpactOverview() });
  });

  router.get("/admin/operations", requireAuth, requireRole("admin"), async (_req, res) => {
    const mongoConnected = mongoose.connection.readyState === 1;
    const privateStorage = await verifyPrivateStorageRuntime();
    const ocrConfigured = Boolean(config.GOOGLE_VISION_API_KEY && config.REQUEST_DATA_ENCRYPTION_KEY);
    const aiConfigured = Boolean(config.OPENAI_API_KEY);
    const razorpayConfigured = Boolean(config.RAZORPAY_KEY_ID && config.RAZORPAY_KEY_SECRET && config.RAZORPAY_WEBHOOK_SECRET);
    const [
      flaggedRequests,
      escalatedAssignments,
      disputedPickups,
      disputedItemDonations,
      refundRequiredPayments,
    ] = await Promise.all([
      HelpRequest.countDocuments({ status: "flagged_for_review" }),
      VolunteerAssignment.countDocuments({ status: { $in: ["flagged_for_manual_review", "disputed"] } }),
      ItemPickupAssignment.countDocuments({ status: "disputed" }),
      PhysicalItemDonation.countDocuments({ status: "disputed" }),
      Contribution.countDocuments({ kind: "donation", status: "refund_required" }),
    ]);
    res.json({
      integrations: {
        mongodb: {
          configured: true,
          state: mongoConnected ? "connected" : "error",
          runtimeVerified: mongoConnected,
          ...(!mongoConnected ? { reason: "MongoDB is not connected." } : {}),
        },
        ocr: integrationStatus(
          "ocr",
          ocrConfigured,
          "Set GOOGLE_VISION_API_KEY and REQUEST_DATA_ENCRYPTION_KEY to enable Google Cloud Vision OCR with encrypted text persistence.",
          "Configured; no real OCR request has succeeded in this backend process yet.",
        ),
        ai: integrationStatus(
          "ai",
          aiConfigured,
          "Set OPENAI_API_KEY to enable advisory AI screening and completion-evidence review.",
          "Configured; no real AI assessment has succeeded in this backend process yet.",
        ),
        privateStorage,
        razorpay: {
          configured: razorpayConfigured,
          state: razorpayConfigured ? "configured_but_unverified" : "unconfigured",
          runtimeVerified: false,
          reason: razorpayConfigured
            ? "Only Razorpay Test Mode credentials are accepted; no provider request was made by this status check."
            : "Razorpay is disabled. Test-mode key ID, key secret, and webhook secret are all required.",
        },
        inAppNotifications: {
          configured: true,
          state: mongoConnected ? "available" : "unavailable",
          runtimeVerified: mongoConnected,
          reason: mongoConnected
            ? "Recipient-scoped notifications are persisted in MongoDB."
            : "Notification persistence requires an active MongoDB connection.",
        },
        email: { configured: false, state: "unavailable", runtimeVerified: false, reason: "No email provider adapter or provider configuration is implemented." },
        push: { configured: false, state: "unavailable", runtimeVerified: false, reason: "No push-notification provider adapter or provider configuration is implemented." },
        sms: { configured: false, state: "unavailable", runtimeVerified: false, reason: "No SMS provider adapter or provider configuration is implemented." },
        geospatialMatching: {
          configured: true,
          state: "available",
          runtimeVerified: false,
          reason: "Coordinate matching is attempted when valid; malformed legacy GeoJSON currently prevents 2dsphere index creation. The service uses city/service-area fallback for candidates without coordinates and never reports an estimated distance.",
        },
        geocoding: {
          configured: false,
          state: "unconfigured",
          runtimeVerified: false,
          reason: "No geocoding provider or API key is used; users provide coordinates or city/service-area text.",
        },
      },
      cases: { flaggedRequests, escalatedAssignments, disputedPickups, disputedItemDonations, refundRequiredPayments },
    });
  });

  router.get("/admin/audit-logs", requireAuth, requireRole("admin"), async (req, res) => {
    const page = typeof req.query.page === "string" ? Number(req.query.page) : 1;
    const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : 25;
    if (!Number.isInteger(page) || page < 1 || page > 10000 || !Number.isInteger(limit) || limit < 1 || limit > 50) {
      res.status(400).json({ message: "Choose a valid audit-log page and page size (1–50)." });
      return;
    }
    const [entries, total] = await Promise.all([
      AuditLog.find({})
        .sort({ occurredAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      AuditLog.countDocuments({}),
    ]);
    const actorIds = [...new Set(entries.map((entry) => entry.actorId.toString()))];
    const actors = await User.find({ _id: { $in: actorIds } }).select("name role").lean();
    const actorById = new Map(actors.map((actor) => [actor._id.toString(), { name: actor.name, role: actor.role }]));
    res.json({
      page,
      pageSize: limit,
      total,
      entries: entries.map((entry) => ({
        id: entry._id.toString(),
        actor: actorById.get(entry.actorId.toString()) ?? { name: "Former account", role: "unknown" },
        action: entry.action,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId,
        previousStatus: entry.previousStatus,
        newStatus: entry.newStatus,
        reason: entry.reason,
        occurredAt: entry.occurredAt.toISOString(),
      })),
    });
  });

  router.get("/admin/accounts", requireAuth, requireRole("admin"), async (req, res) => {
    const page = typeof req.query.page === "string" ? Number(req.query.page) : 1;
    const role = typeof req.query.role === "string" ? req.query.role : "all";
    const status = typeof req.query.status === "string" ? req.query.status : "all";
    if (!Number.isInteger(page) || page < 1 || page > 10000 ||
        !["all", "user", "donor", "volunteer", "ngo"].includes(role) ||
        !["all", "active", "suspended"].includes(status)) {
      res.status(400).json({ message: "Choose valid account filters and page." });
      return;
    }
    const filter = {
      role: role === "all" ? { $in: ["user", "donor", "volunteer", "ngo"] } : role,
      ...(status === "all" ? {} : { accountStatus: status }),
    };
    const [accounts, total] = await Promise.all([
      User.find(filter)
        .select("name email role city accountStatus organizationStatus createdAt")
        .sort({ createdAt: -1 })
        .skip((page - 1) * 25)
        .limit(25)
        .lean(),
      User.countDocuments(filter),
    ]);
    res.json({
      page,
      pageSize: 25,
      total,
      accounts: accounts.map((account) => ({
        id: account._id.toString(),
        name: account.name,
        email: account.email,
        role: account.role,
        city: account.city,
        accountStatus: account.accountStatus,
        organizationStatus: account.organizationStatus,
        createdAt: account.createdAt.toISOString(),
      })),
    });
  });

  router.patch("/admin/accounts/:id/status", requireAuth, requireRole("admin"), async (req, res) => {
    const parsed = z.object({
      status: z.enum(["active", "suspended"]),
      reason: z.string().trim().min(5).max(500).optional(),
    }).strict().safeParse(req.body);
    if (!parsed.success || !mongoose.isValidObjectId(req.params.id)) {
      res.status(400).json({ message: parsed.success ? "Choose a valid account." : parsed.error.issues[0]?.message ?? "Choose an account status." });
      return;
    }
    if (parsed.data.status === "suspended" && !parsed.data.reason) {
      res.status(400).json({ message: "Enter a reason before suspending an account." });
      return;
    }
    const current = await User.findOne({
      _id: req.params.id,
      role: { $in: ["user", "donor", "volunteer", "ngo"] },
    }).select("role accountStatus activeVolunteerAssignmentCount activeHelpRequestCount");
    if (!current) {
      res.status(404).json({ message: "Account not found." });
      return;
    }
    if (parsed.data.status === "suspended") {
      const activeVolunteerAssignments = current.role === "volunteer" ? await VolunteerAssignment.countDocuments({
        volunteerId: current._id,
        status: { $in: ["accepted", "in_progress", "submitted_for_review", "more_evidence_required", "rejected_with_reason", "flagged_for_manual_review", "disputed"] },
      }) : 0;
      const activePickups = current.role === "volunteer" ? await ItemPickupAssignment.countDocuments({
        volunteerId: current._id,
        status: { $in: ["accepted", "in_progress", "submitted_for_review", "disputed"] },
      }) : current.role === "ngo" ? await ItemPickupAssignment.countDocuments({
        ngoId: current._id,
        status: { $in: ["accepted", "in_progress", "submitted_for_review", "disputed"] },
      }) : 0;
      const activeNgoRequests = current.role === "ngo" ? await HelpRequest.countDocuments({
        assignedOrganizationId: current._id,
        status: { $in: ["under_review", "approved", "matching_volunteer", "assigned", "matched", "in_progress", "pending_completion_review", "more_evidence_required", "flagged_for_review"] },
      }) : 0;
      if ((current.role === "volunteer" && (activeVolunteerAssignments > 0 || activePickups > 0 || (current.activeVolunteerAssignmentCount ?? 0) > 0)) ||
          (current.role === "ngo" && (activeNgoRequests > 0 || activePickups > 0 || (current.activeHelpRequestCount ?? 0) > 0))) {
        res.status(409).json({ message: "Resolve active assignments and routed requests before suspending this account." });
        return;
      }
    }
    const updated = await User.findOneAndUpdate(
      { _id: current._id, role: current.role, accountStatus: current.accountStatus },
      { $set: { accountStatus: parsed.data.status } },
      { new: true, runValidators: true },
    ).select("name role accountStatus");
    if (!updated) {
      res.status(409).json({ message: "Account status changed; refresh and try again." });
      return;
    }
    await recordAuditEvent({
      actorId: req.user!.id,
      action: "account.status_changed",
      resourceType: "user",
      resourceId: updated._id.toString(),
      previousStatus: current.accountStatus,
      newStatus: updated.accountStatus,
      reason: parsed.data.reason,
    });
    const notificationKey = `account-status:${updated._id.toString()}:${updated.accountStatus}:${Date.now()}`;
    await Notification.updateOne(
      { recipientId: updated._id, idempotencyKey: notificationKey },
      {
        $setOnInsert: {
          recipientId: updated._id,
          type: "account_status_updated",
          idempotencyKey: notificationKey,
          payload: { status: updated.accountStatus },
          status: "sent",
        },
      },
      { upsert: true },
    );
    res.json({ account: { id: updated._id.toString(), name: updated.name, role: updated.role, accountStatus: updated.accountStatus } });
  });

  router.get("/admin/donations", requireAuth, requireRole("admin"), async (req, res) => {
    const page = typeof req.query.page === "string" ? Number(req.query.page) : 1;
    const status = typeof req.query.status === "string" ? req.query.status : "all";
    const allowedStatuses = ["all", "creating", "pending", "settling", "completed", "failed", "expired", "refund_required"];
    if (!Number.isInteger(page) || page < 1 || page > 10000 || !allowedStatuses.includes(status)) {
      res.status(400).json({ message: "Choose a valid donation status and page." });
      return;
    }
    const filter = { kind: "donation" as const, ...(status === "all" ? {} : { status }) };
    const [contributions, total] = await Promise.all([
      Contribution.find(filter).select("needId amount currency status receiptReference createdAt updatedAt")
        .sort({ createdAt: -1, _id: -1 }).skip((page - 1) * 25).limit(25).lean(),
      Contribution.countDocuments(filter),
    ]);
    const needIds = [...new Set(contributions.map((item) => item.needId.toString()))];
    const needs = await Need.find({ _id: { $in: needIds } }).select("title organizationId").lean();
    const needById = new Map(needs.map((item) => [item._id.toString(), item]));
    res.json({
      page,
      pageSize: 25,
      total,
      donations: contributions.map((item) => ({
        id: item._id.toString(),
        campaign: needById.get(item.needId.toString())?.title ?? "Campaign unavailable",
        organizationId: needById.get(item.needId.toString())?.organizationId.toString(),
        amount: item.amount,
        currency: item.currency,
        status: item.status,
        receiptReference: item.receiptReference,
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
      })),
    });
  });

  router.get("/admin/organizations", requireAuth, requireRole("admin"), async (_req, res) => {
    const organizations = await User.find({
      role: "ngo",
      organizationStatus: { $in: ["pending", "pending_review", "resubmission_required"] },
    })
      .select("name email city createdAt description categories phone website registrationNumber registrationType representativeName representativeDesignation issuingAuthority establishedDate officialEmail officialPhone addressLine state postalCode serviceArea organizationStatus verificationReason")
      .sort({ createdAt: 1 })
      .limit(100)
      .lean<Pick<UserDocument, "_id" | "name" | "email" | "city" | "createdAt" | "description" | "categories" | "phone" | "website" | "registrationNumber" | "registrationType" | "representativeName" | "representativeDesignation" | "issuingAuthority" | "establishedDate" | "officialEmail" | "officialPhone" | "addressLine" | "state" | "postalCode" | "serviceArea" | "organizationStatus" | "verificationReason">[]>();
    const verificationDocuments = await VerificationDocument.find({
      applicantId: { $in: organizations.map((organization) => organization._id) },
    }).select("applicantId kind originalName contentType byteSize createdAt").sort({ createdAt: 1 });
    const documentsByApplicant = new Map<string, typeof verificationDocuments>();
    for (const document of verificationDocuments) {
      const applicantId = document.applicantId.toString();
      const documents = documentsByApplicant.get(applicantId) ?? [];
      documents.push(document);
      documentsByApplicant.set(applicantId, documents);
    }
    res.json({ organizations: organizations.map((organization) => ({
      id: organization._id.toString(),
      name: organization.name,
      email: organization.email,
      city: organization.city,
      createdAt: organization.createdAt.toISOString(),
      description: organization.description,
      categories: organization.categories,
      phone: organization.phone,
      website: organization.website,
      registrationNumber: organization.registrationNumber,
      registrationType: organization.registrationType,
      representativeName: organization.representativeName,
      representativeDesignation: organization.representativeDesignation,
      issuingAuthority: organization.issuingAuthority,
      ...(organization.establishedDate ? { establishedDate: organization.establishedDate.toISOString() } : {}),
      documents: (documentsByApplicant.get(organization._id.toString()) ?? []).map((document) => ({
        id: document._id.toString(),
        kind: document.kind,
        name: document.originalName,
        contentType: document.contentType,
        byteSize: document.byteSize,
        createdAt: document.createdAt.toISOString(),
      })),
      officialEmail: organization.officialEmail,
      officialPhone: organization.officialPhone,
      addressLine: organization.addressLine,
      state: organization.state,
      postalCode: organization.postalCode,
      serviceArea: organization.serviceArea,
      organizationStatus: organization.organizationStatus === "pending" ? "pending_review" : organization.organizationStatus,
      verificationReason: organization.verificationReason,
    })) });
  });

  router.get("/admin/organizations/:id", requireAuth, requireRole("admin"), async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) {
      res.status(400).json({ message: "Choose a valid organization." });
      return;
    }
    const organization = await User.findOne({ _id: req.params.id, role: "ngo" })
      .select("name email city createdAt description categories phone website registrationNumber registrationType representativeName representativeDesignation issuingAuthority establishedDate officialEmail officialPhone addressLine state postalCode serviceArea organizationStatus verificationReason verificationReviewedAt verificationHistory");
    if (!organization) {
      res.status(404).json({ message: "Organization not found." });
      return;
    }
    const documents = await VerificationDocument.find({ applicantId: organization._id })
      .select("kind originalName contentType byteSize createdAt")
      .sort({ createdAt: 1 });
    res.json({
      organization: {
        id: organization._id.toString(),
        name: organization.name,
        email: organization.email,
        city: organization.city,
        createdAt: organization.createdAt.toISOString(),
        description: organization.description,
        categories: organization.categories ?? [],
        phone: organization.phone,
        website: organization.website,
        registrationNumber: organization.registrationNumber,
        registrationType: organization.registrationType,
        representativeName: organization.representativeName,
        representativeDesignation: organization.representativeDesignation,
        issuingAuthority: organization.issuingAuthority,
        ...(organization.establishedDate ? { establishedDate: organization.establishedDate.toISOString() } : {}),
        officialEmail: organization.officialEmail,
        officialPhone: organization.officialPhone,
        addressLine: organization.addressLine,
        state: organization.state,
        postalCode: organization.postalCode,
        serviceArea: organization.serviceArea,
        organizationStatus: organization.organizationStatus === "pending" ? "pending_review" : organization.organizationStatus,
        verificationReason: organization.verificationReason,
        ...(organization.verificationReviewedAt ? { reviewedAt: organization.verificationReviewedAt.toISOString() } : {}),
        history: organization.verificationHistory.map((entry) => ({
          status: entry.status,
          ...(entry.reason ? { reason: entry.reason } : {}),
          occurredAt: entry.occurredAt.toISOString(),
        })),
        documents: documents.map((document) => ({
          id: document._id.toString(),
          kind: document.kind,
          name: document.originalName,
          contentType: document.contentType,
          byteSize: document.byteSize,
          createdAt: document.createdAt.toISOString(),
        })),
      },
    });
  });

  router.patch("/admin/organizations/:id", requireAuth, requireRole("admin"), async (req, res) => {
    const parsed = ngoReviewSchema.safeParse(req.body);
    if (!parsed.success || !mongoose.isValidObjectId(req.params.id)) {
      res.status(400).json({ message: "Choose a valid organization status." });
      return;
    }
    const previous = await User.findOne({ _id: req.params.id, role: "ngo" })
      .select("organizationStatus")
      .lean<Pick<UserDocument, "organizationStatus"> | null>();
    const organization = await User.findOneAndUpdate(
      { _id: req.params.id, role: "ngo" },
      {
        $set: {
          organizationStatus: parsed.data.status,
          verificationReviewedBy: req.user!.id,
          verificationReviewedAt: new Date(),
          ...(parsed.data.reason ? { verificationReason: parsed.data.reason } : {}),
        },
        ...(parsed.data.status === "verified" ? { $unset: { verificationReason: 1 } } : {}),
        $push: {
          verificationHistory: {
            status: parsed.data.status,
            actorId: req.user!.id,
            ...(parsed.data.reason ? { reason: parsed.data.reason } : {}),
            occurredAt: new Date(),
          },
        },
      },
      { new: true, runValidators: true },
    );
    if (!organization) {
      res.status(404).json({ message: "Organization not found." });
      return;
    }
    await recordAuditEvent({
      actorId: req.user!.id,
      action: "ngo.verification.reviewed",
      resourceType: "organization",
      resourceId: organization._id.toString(),
      previousStatus: previous?.organizationStatus,
      newStatus: organization.organizationStatus,
      reason: parsed.data.reason,
    });
    await Notification.create({
      recipientId: organization._id,
      type: "ngo_verification_decision",
      idempotencyKey: randomUUID(),
      payload: {
        status: parsed.data.status,
        ...(parsed.data.reason ? { reason: parsed.data.reason } : {}),
      },
      status: "sent",
    });
    res.json({ organization: safeUser(organization) });
  });

  return router;
}

export async function createAdminFromEnvironment() {
  if (!config.ADMIN_EMAIL || !config.ADMIN_PASSWORD) return;
  const email = config.ADMIN_EMAIL.toLowerCase();
  if (await User.exists({ email })) return;
  await User.create({
    name: "Impact Match Admin",
    email,
    passwordHash: await bcrypt.hash(config.ADMIN_PASSWORD, 12),
    role: "admin",
    city: "India",
  });
  console.info("Created the configured Impact Match admin account.");
}
