import axios from "axios";
import type {
  AdminOrganization,
  Impact,
  Need,
  NeedInput,
  OrganizationStatus,
  Role,
  User,
  VerificationDocument,
  VerificationDocumentKind,
  VolunteerEligibility,
} from "./types";

export type Organization = {
  id: string;
  name: string;
  city: string;
  organizationStatus: OrganizationStatus;
  description?: string;
  categories?: string[];
  activeTasks?: number;
  volunteerCount?: number;
  fundsRaised?: number;
  createdAt?: string;
};

export type Contribution = {
  id: string;
  kind: "volunteer" | "donation";
  amount: number;
  hours: number;
  status: "creating" | "pending" | "settling" | "completed" | "failed" | "expired" | "refund_required";
  createdAt: string;
  receiptReference?: string;
  need?: Partial<Need> & { organizationName?: string };
};
export type ItemDonationStatus =
  | "submitted" | "pending_ngo_review" | "accepted" | "rejected" | "needs_information"
  | "awaiting_pickup_assignment" | "pickup_assigned" | "pickup_in_progress" | "picked_up"
  | "delivered_or_received" | "completed" | "pickup_failed" | "disputed" | "cancelled";
export type ItemDonation = {
  id: string;
  category: string;
  description: string;
  quantity: number;
  condition: string;
  city: string;
  status: ItemDonationStatus;
  pickupWindowStart: string;
  pickupWindowEnd: string;
  createdAt: string;
  receiptReference?: string;
  pickupAddress?: string;
  specialHandling?: string;
  contact?: { name?: string; method: "phone" | "email" | "in_app"; value?: string };
  timeline?: Array<{ status: ItemDonationStatus; reason?: string; occurredAt: string }>;
  evidence?: Array<{ id: string; name: string; contentType: string; byteSize: number; kind: "donation_photo" | "pickup_photo" | "receipt" }>;
};
export type ItemPickupOffer = {
  assignmentId: string;
  donationId: string;
  category: string;
  quantity: number;
  condition: string;
  city: string;
  pickupWindowStart: string;
  pickupWindowEnd: string;
  approximateDistanceKm?: number;
  matchExplanation: string[];
  expiresAt: string;
};
export type ItemPickupAssignment = {
  id: string;
  donationId: string;
  status: string;
  category: string;
  quantity: number;
  condition: string;
  city: string;
  donationStatus: ItemDonationStatus;
  pickupWindowStart?: string;
  pickupWindowEnd?: string;
  progressNote?: string;
  canAccessDetails: boolean;
};
export type PrivateItemPickup = {
  assignmentId: string;
  donationId: string;
  category: string;
  description: string;
  quantity: number;
  condition: string;
  city: string;
  pickupAddress: string;
  coordinates?: { latitude: number; longitude: number };
  pickupWindowStart: string;
  pickupWindowEnd: string;
  specialHandling?: string;
  contact: { name: string; method: "phone" | "email" | "in_app"; value?: string };
  status: string;
};

export type Overview = {
  totalNgos: number;
  verifiedNgos: number;
  pendingNgos: number;
  volunteers: number;
  users: number;
  fundsRaised: number;
  activeTasks: number;
  completedHelpRequests: number;
  participatingCities: number;
  donationMonths: Array<{ month: string; total: number }>;
  userMonths: Array<{ month: string; total: number }>;
  causes: Array<{ cause: string; total: number }>;
};

export type InAppNotification = {
  id: string;
  type: string;
  payload: Record<string, string>;
  status: string;
  readAt?: string;
  createdAt: string;
};
export type NotificationPage = {
  notifications: InAppNotification[];
  page: number;
  pageSize: number;
  total: number;
  unreadCount: number;
};
export type AdminOperations = {
  integrations: Record<string, {
    configured: boolean;
    state: string;
    runtimeVerified: boolean;
    reason?: string;
    checkedAt?: string;
    mode?: string;
    productionReady?: boolean;
  }>;
  cases: {
    flaggedRequests: number;
    escalatedAssignments: number;
    disputedPickups: number;
    disputedItemDonations: number;
    refundRequiredPayments: number;
  };
};
export type AdminAuditPage = {
  page: number;
  pageSize: number;
  total: number;
  entries: Array<{
    id: string;
    actor: { name: string; role: string };
    action: string;
    resourceType: string;
    resourceId: string;
    previousStatus?: string;
    newStatus?: string;
    reason?: string;
    occurredAt: string;
  }>;
};

export type HelpRequestStatus =
  | "draft" | "submitted" | "screening" | "pending_ngo_review" | "needs_information"
  | "flagged_for_review" | "under_review" | "approved" | "matching_volunteer"
  | "assigned" | "matched" | "in_progress" | "pending_completion_review" | "more_evidence_required"
  | "completed" | "rejected" | "cancelled" | "withdrawn";
export type HelpRequestCategory =
  | "food" | "clothing" | "shelter" | "medical_assistance" | "education" | "emergency_support" | "other";
export type HelpRequestSummary = {
  id: string;
  title: string;
  category: HelpRequestCategory;
  urgency: "low" | "medium" | "high";
  peopleCount: number;
  city: string;
  status: HelpRequestStatus;
  screeningStatus: "pending" | "review_recommended" | "needs_information" | "clear_for_human_review" | "unavailable";
  createdAt: string;
  updatedAt: string;
};
export type RequestAttachment = {
  id: string;
  name: string;
  contentType: string;
  byteSize: number;
  status: string;
  ocrStatus: "pending" | "completed" | "unavailable" | "failed" | "unsupported";
  ocrProvider?: string;
  ocrMessage?: string;
  ocrProcessedAt?: string;
  contentEndpoint?: string;
};
export type RequestScreening = {
  status: string;
  reasons?: string[];
  missingFields?: string[];
  additionalInformation?: string[];
  confidence?: number;
  provider?: string;
  model?: string;
  assessedAt?: string;
  humanReviewRequired?: boolean;
  message?: string;
};
export type HelpRequestDetail = HelpRequestSummary & {
  description: string;
  addressLine?: string;
  assignedOrganization?: { id: string; name: string };
  preferredContactMethod: "phone" | "email" | "in_app";
  consentToProcess: boolean;
  screening: RequestScreening;
};
export type NgoMatch = {
  id: string;
  name: string;
  city: string;
  serviceArea: string;
  categories: string[];
  distanceKm?: number;
  currentlyAccepting: boolean;
  reasons: string[];
};
export type NgoRequestSummary = {
  id: string;
  reference: string;
  title: string;
  category: HelpRequestCategory;
  descriptionSummary: string;
  urgency: "low" | "medium" | "high";
  peopleCount: number;
  city: string;
  status: HelpRequestStatus;
  screeningStatus: HelpRequestSummary["screeningStatus"];
  reviewFlags: string[];
  createdAt: string;
};
export type NgoRequestDetail = Omit<NgoRequestSummary, "descriptionSummary" | "reviewFlags"> & {
  description: string;
  addressLine?: string;
  preferredContactMethod: "phone" | "email" | "in_app";
  screening: { reasons: string[]; missingFields: string[]; additionalInformation: string[]; assessedAt: string } | null;
  timeline: Array<{ status: HelpRequestStatus; reason?: string; occurredAt: string }>;
  documents: Array<{ id: string; name: string; contentType: string; byteSize: number; ocrStatus: string; ocrProvider?: string }>;
};
export type VolunteerAssignmentStatus =
  | "offered" | "accepted" | "in_progress" | "submitted_for_review" | "more_evidence_required"
  | "rejected_with_reason" | "flagged_for_manual_review" | "completed"
  | "declined" | "expired" | "cancelled" | "reassigned" | "disputed";
export type VolunteerTaskOffer = {
  assignmentId: string;
  summary: string;
  category: HelpRequestCategory;
  urgency: "low" | "medium" | "high";
  city: string;
  peopleCount: number;
  organizationName: string;
  matchExplanation: string[];
  approximateDistanceKm?: number;
  deadlineAt?: string;
  expiresAt: string;
  offeredAt: string;
};
export type VolunteerAssignmentSummary = {
  id: string;
  status: VolunteerAssignmentStatus;
  createdAt: string;
  updatedAt: string;
  category: HelpRequestCategory;
  summary: string;
  urgency: "low" | "medium" | "high";
  city: string;
  organizationName: string;
  offerExpiresAt?: string;
  acceptedAt?: string;
  startedAt?: string;
  submittedAt?: string;
  deadlineAt?: string;
  isOverdue?: boolean;
  progressNote?: string;
  canAccessDetails: boolean;
};
export type VolunteerPreferences = {
  city: string;
  eligibility: "pending" | "eligible" | "suspended";
  taskOptIn: boolean;
  serviceArea: string;
  serviceRadiusKm: number;
  maxActiveAssignments: number;
  activeAssignments: number;
  skills: string[];
  categories: string[];
  coordinates?: { latitude: number; longitude: number };
};
export type PrivateVolunteerTask = {
  id: string;
  summary: string;
  description: string;
  category: HelpRequestCategory;
  urgency: "low" | "medium" | "high";
  peopleCount: number;
  completionEvidenceChecklist: string[];
  city: string;
  addressLine?: string;
  coordinates?: { latitude: number; longitude: number };
  deadlineAt?: string;
  contact: { requesterName: string; preferredMethod: "phone" | "email" | "in_app"; value?: string };
  status: VolunteerAssignmentStatus;
  progressNote?: string;
};
export type NgoVolunteerAssignment = {
  id: string;
  status: VolunteerAssignmentStatus;
  offerExpiresAt?: string;
  acceptedAt?: string;
  startedAt?: string;
  submittedAt?: string;
  isOverdue?: boolean;
  progressNote?: string;
  volunteer?: { name: string; city: string; skills: string[] };
};
export type AssignmentEvidence = { id: string; name: string; contentType: string; byteSize: number; createdAt?: string };
export type CompletionAiReview = {
  recommendation: "ready_for_ngo_review" | "additional_evidence_recommended" | "manual_review_required" | "provider_unavailable";
  findings: string[];
  missingEvidence: string[];
  uncertainty: string;
  provider: string;
  model?: string;
  assessedAt?: string;
};
export type CompletionProofHistory = {
  id: string;
  summary: string;
  status: string;
  submittedAt: string;
  reviewedAt?: string;
  reviewReason?: string;
  unresolvedIssues?: string;
  aiReview?: CompletionAiReview;
};
export type NgoCompletionReviewSummary = {
  assignmentId: string;
  requestId: string;
  reference: string;
  title: string;
  category: HelpRequestCategory;
  urgency: "low" | "medium" | "high";
  city: string;
  summary: string;
  submittedAt: string;
  unresolvedIssues?: string;
  flagReason?: string;
  aiRecommendation: CompletionAiReview["recommendation"];
};
export type NgoCompletionReviewDetail = {
  assignment: { id: string; status: VolunteerAssignmentStatus; submittedAt?: string; history: Array<{ status: string; reason?: string; occurredAt: string }> };
  request: {
    id: string; reference: string; title: string; category: HelpRequestCategory; urgency: "low" | "medium" | "high";
    peopleCount: number; city: string; description: string; status: HelpRequestStatus;
    completionEvidenceChecklist: string[];
    timeline: Array<{ status: HelpRequestStatus; reason?: string; occurredAt: string }>;
  };
  proof: {
    id: string; summary: string; report: string; completedAt: string; submittedAt: string;
    unresolvedIssues?: string; recipientConfirmed?: boolean; aiReview: CompletionAiReview | null;
    reviewHistory: Array<{ status: string; reason?: string; occurredAt: string }>;
  };
  evidence: AssignmentEvidence[];
};

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? import.meta.env.VITE_API_URL ?? "http://localhost:4000/api",
  withCredentials: true,
  headers: { "Content-Type": "application/json" },
});

api.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    if (axios.isAxiosError(error)) {
      const message = error.response?.data?.message ?? error.message ?? "The request could not be completed.";
      return Promise.reject(Object.assign(new Error(message), { status: error.response?.status }));
    }
    return Promise.reject(error);
  },
);

export const services = {
  auth: {
    me: async () => (await api.get<{ user: User | null }>("/auth/me")).data.user,
    login: async (email: string, password: string) =>
      (await api.post<{ user: User }>("/auth/login", { email, password })).data.user,
    register: async (data: {
      name: string; email: string; password: string; role: Exclude<Role, "admin">; city: string;
      description?: string; categories?: string[]; phone?: string; website?: string;
      registrationNumber?: string; registrationType?: string; officialEmail?: string;
      officialPhone?: string; addressLine?: string; state?: string; postalCode?: string; serviceArea?: string;
      representativeName?: string; representativeDesignation?: string; issuingAuthority?: string; establishedDate?: string;
      skills?: string[]; interests?: string[]; languages?: string[]; volunteerAvailability?: string;
      volunteerServiceRadiusKm?: number; volunteerTaskOptIn?: boolean;
    }) =>
      (await api.post<{ user: User }>("/auth/register", data)).data.user,
    logout: async () => { await api.post("/auth/logout"); },
  },
  verification: {
    mine: async () => (await api.get<{
      status: string;
      reason?: string;
      reviewedAt?: string;
      history: Array<{ status: string; reason?: string; occurredAt: string }>;
      documents: VerificationDocument[];
    }>("/verification/me")).data,
    upload: async (file: File, kind: VerificationDocumentKind) =>
      (await api.post("/verification/me/documents", file, {
        headers: {
          "Content-Type": file.type,
          "X-Upload-Filename": encodeURIComponent(file.name),
          "X-Document-Kind": kind,
        },
      })).data,
    resubmit: async () => (await api.post<{ status: string }>("/verification/me/resubmit", {})).data,
  },
  ngos: {
    list: async (params?: URLSearchParams) =>
      (await api.get<{ ngos: Organization[] }>("/ngos", { params: Object.fromEntries(params ?? []) })).data.ngos,
    detail: async (id: string) =>
      (await api.get<{ ngo: Organization; needs: Need[] }>(`/ngos/${id}`)).data,
  },
  needs: {
    list: async (params?: URLSearchParams) =>
      (await api.get<{ needs: Need[] }>("/needs", { params: Object.fromEntries(params ?? []) })).data.needs,
    create: async (data: NeedInput) =>
      (await api.post<{ need: Need }>("/needs", data)).data.need,
    join: async (id: string) =>
      (await api.post<{ message: string }>(`/needs/${id}/fulfill`)).data,
  },
  payments: {
    createOrder: async (id: string, amount: number) =>
      (await api.post<{ orderId: string; amount: number; currency: string; keyId: string }>("/payments/order", { needId: id, amount })).data,
    verify: async (data: { orderId: string; paymentId: string; signature: string }) =>
      (await api.post<{ message: string; status: string; receiptReference?: string }>("/payments/verify", data)).data,
    status: async (orderId: string) =>
      (await api.get<{ status: Contribution["status"]; amount: number; currency: string; receiptReference?: string }>(`/payments/order/${encodeURIComponent(orderId)}/status`)).data,
    receipt: async (id: string) =>
      (await api.get<{ receipt: { reference: string; campaign: string; organizationName: string; amount: number; currency: string; confirmedAt: string; note: string } }>(`/impact/contributions/${id}/receipt`)).data.receipt,
  },
  itemDonations: {
    mine: async () => (await api.get<{ donations: ItemDonation[] }>("/item-donations/mine")).data.donations,
    create: async (data: {
      ngoId: string; category: string; description: string; quantity: number; condition: string;
      pickupAddress: string; city: string; coordinates?: { latitude: number; longitude: number };
      pickupWindowStart: string; pickupWindowEnd: string; preferredContactMethod: "phone" | "email" | "in_app";
      specialHandling?: string; consentToSharePickupDetails: true;
    }) => (await api.post<{ donation: ItemDonation }>("/item-donations", data)).data.donation,
    detail: async (id: string) => (await api.get<{ donation: ItemDonation }>(`/item-donations/${id}`)).data.donation,
    upload: async (id: string, file: File, kind: "donation_photo" | "pickup_photo" | "receipt") =>
      (await api.post<{ evidence: NonNullable<ItemDonation["evidence"]>[number] }>(
        `/item-donations/${id}/evidence?kind=${kind}`,
        file,
        { headers: { "Content-Type": file.type, "X-Upload-Filename": encodeURIComponent(file.name) } },
      )).data.evidence,
    downloadEvidence: async (id: string, evidenceId: string) =>
      (await api.get<Blob>(`/item-donations/${id}/evidence/${evidenceId}/content`, { responseType: "blob" })).data,
    cancel: async (id: string, reason: string) => (await api.post(`/item-donations/${id}/cancel`, { reason })).data,
    resubmit: async (id: string, data: Partial<{
      category: string; description: string; quantity: number; condition: string; pickupAddress: string;
      city: string; coordinates: { latitude: number; longitude: number }; pickupWindowStart: string;
      pickupWindowEnd: string; preferredContactMethod: "phone" | "email" | "in_app"; specialHandling: string;
    }>) => (await api.patch(`/item-donations/${id}/resubmit`, data)).data,
    receipt: async (id: string) =>
      (await api.get<{ receipt: { reference: string; category: string; quantity: number; condition: string; organizationName: string; completedAt?: string; note: string } }>(`/item-donations/${id}/receipt`)).data.receipt,
    ngoInbox: async () => (await api.get<{ donations: ItemDonation[] }>("/ngo/item-donations")).data.donations,
    ngoReview: async (id: string, action: "accept" | "reject" | "needs_information", reason?: string) =>
      (await api.patch<{ donation: ItemDonation }>(`/ngo/item-donations/${id}/review`, { action, ...(reason ? { reason } : {}) })).data.donation,
    reassignPickup: async (id: string, reason: string) => (await api.post(`/ngo/item-donations/${id}/reassign-pickup`, { reason })).data,
    offerPickup: async (id: string) => (await api.post<{ offeredCount: number; message: string }>(`/ngo/item-donations/${id}/offer-pickup`)).data,
    confirmReceived: async (id: string, reason: string) =>
      (await api.post<{ donation: ItemDonation }>(`/ngo/item-donations/${id}/confirm-received`, { reason })).data.donation,
    volunteerOffers: async () => (await api.get<{ tasks: ItemPickupOffer[]; eligibility?: string }>("/volunteer/item-pickups")).data,
    volunteerAssignments: async () => (await api.get<{ assignments: ItemPickupAssignment[] }>("/volunteer/item-pickups/mine")).data.assignments,
    acceptPickup: async (id: string) => (await api.post(`/volunteer/item-pickups/${id}/accept`)).data,
    declinePickup: async (id: string) => (await api.post(`/volunteer/item-pickups/${id}/decline`)).data,
    pickupDetails: async (id: string) => (await api.get<{ pickup: PrivateItemPickup }>(`/volunteer/item-pickups/${id}/details`)).data.pickup,
    startPickup: async (id: string) => (await api.post(`/volunteer/item-pickups/${id}/start`)).data,
    reportPickupIssue: async (id: string, reason: string) => (await api.post(`/volunteer/item-pickups/${id}/report-issue`, { reason })).data,
    submitPickup: async (id: string, reason: string) => (await api.post(`/volunteer/item-pickups/${id}/submit`, { reason })).data,
  },
  impact: {
    mine: async () => (await api.get<{ impact: Impact }>("/impact/me")).data.impact,
    overview: async () => (await api.get<{ overview: Overview }>("/impact/summary")).data.overview,
    contributions: async () => (await api.get<{ contributions: Contribution[] }>("/impact/contributions/me")).data.contributions,
  },
  profile: {
    update: async (data: { name?: string; city?: string; description?: string; skills?: string[]; interests?: string[]; categories?: string[] }) =>
      (await api.patch<{ user: User }>("/profile/me", data)).data.user,
  },
  volunteer: {
    dashboard: async () => (await api.get<{
      contributions: Contribution[];
      impact: Impact;
      stats: { availableOpportunities: number; assignedTasks: number; activeTasks: number; completedTasks: number };
    }>("/volunteer/dashboard")).data,
    applications: async () => (await api.get<{ contributions: Contribution[] }>("/volunteer/applications")).data.contributions,
    recommendations: async () => (await api.get<{ matches: Array<{ need: Need; score: number; reasons: string[] }> }>("/volunteer/recommendations")).data.matches,
    preferences: async () => (await api.get<{ preferences: VolunteerPreferences }>("/volunteer/preferences")).data.preferences,
    updatePreferences: async (data: {
      taskOptIn: boolean; city?: string; serviceArea?: string; serviceRadiusKm?: number;
      clearCoordinates?: boolean; coordinates?: { latitude: number; longitude: number };
    }) => (await api.patch<{ preferences: VolunteerPreferences }>("/volunteer/preferences", data)).data.preferences,
    availableTasks: async () => (await api.get<{ tasks: VolunteerTaskOffer[]; eligibility?: string }>("/volunteer/tasks/available")).data,
    assignments: async () => (await api.get<{ assignments: VolunteerAssignmentSummary[] }>("/volunteer/assignments")).data.assignments,
    acceptOffer: async (id: string) => (await api.post<{ assignment: { id: string; status: VolunteerAssignmentStatus; acceptedAt?: string } }>(`/volunteer/assignments/${id}/accept`)).data.assignment,
    declineOffer: async (id: string) => (await api.post(`/volunteer/assignments/${id}/decline`)).data,
    privateTask: async (id: string) => (await api.get<{ task: PrivateVolunteerTask }>(`/volunteer/assignments/${id}/details`)).data.task,
    startAssignment: async (id: string) => (await api.post(`/volunteer/assignments/${id}/start`)).data,
    updateProgress: async (id: string, note: string) => (await api.patch(`/volunteer/assignments/${id}/progress`, { note })).data,
    reportIssue: async (id: string, reason: string) => (await api.post(`/volunteer/assignments/${id}/report-issue`, { reason })).data,
    cancelAssignment: async (id: string, reason: string) => (await api.post(`/volunteer/assignments/${id}/cancel`, { reason })).data,
    evidence: async (id: string) => (await api.get<{ evidence: AssignmentEvidence[] }>(`/volunteer/assignments/${id}/evidence`)).data.evidence,
    uploadEvidence: async (assignmentId: string, file: File) => (await api.post<{ evidence: AssignmentEvidence }>(
      `/volunteer/assignments/${assignmentId}/evidence`,
      file,
      { headers: { "Content-Type": file.type, "X-Upload-Filename": encodeURIComponent(file.name) } },
    )).data.evidence,
    submitAssignment: async (id: string, report: string) => (await api.post(`/volunteer/assignments/${id}/submit`, { report })).data,
    submitCompletionProof: async (id: string, data: {
      summary: string; report: string; completedAt: string; unresolvedIssues?: string;
      recipientConfirmed?: boolean; consentedToAiReview: boolean;
    }) => (await api.post<{ proofId: string; aiReview: CompletionAiReview }>(`/volunteer/assignments/${id}/submit`, data)).data,
    completionProofs: async (id: string) =>
      (await api.get<{ proofs: CompletionProofHistory[] }>(`/volunteer/assignments/${id}/completion-proofs`)).data.proofs,
    downloadEvidence: async (assignmentId: string, evidenceId: string) => (await api.get<Blob>(
      `/volunteer/assignments/${assignmentId}/evidence/${evidenceId}/content`,
      { responseType: "blob" },
    )).data,
  },
  ngo: {
    dashboard: async () => (await api.get<{ organization: Organization; needs: Need[]; stats: {
      activeTasks: number; volunteers: number; donations: number; incomingRequests: number;
      pendingReviews: number; approvedRequests: number; activeAssignments: number; completedRequests: number;
    }; recentVolunteers: Array<{ id: string; name: string; city: string; status: string; createdAt: string }> }>("/ngo/dashboard")).data,
    donations: async () => (await api.get<{ donations: Array<{ id: string; campaign: string; category: string; city: string; amount: number; currency: string; confirmedAt: string; receiptReference?: string }> }>("/ngo/donations")).data.donations,
    requests: async () => (await api.get<{ requests: NgoRequestSummary[] }>("/ngo/requests")).data.requests,
    requestDetail: async (id: string) => (await api.get<{ request: Omit<NgoRequestDetail, "documents">; documents: NgoRequestDetail["documents"] }>(`/ngo/requests/${id}`)).data,
    reviewRequest: async (id: string, data: { action: "start_review" | "approve" | "needs_information" | "flag_for_review" | "decline"; reason?: string }) =>
      (await api.patch<{ request: HelpRequestSummary }>(`/ngo/requests/${id}/review`, data)).data.request,
    startVolunteerMatching: async (id: string, deadlineAt?: string) =>
      (await api.post<{ radiusKm: number; deadlineAt?: string; offers: Array<{ assignmentId: string; city: string; skills: string[]; distanceKm?: number; explanation: string[]; expiresAt: string }> }>(
        `/ngo/requests/${id}/volunteer-matches`,
        deadlineAt ? { deadlineAt } : {},
      )).data,
    assignments: async (id: string) =>
      (await api.get<{ requestStatus: HelpRequestStatus; completionEvidenceChecklist: string[]; assignments: NgoVolunteerAssignment[] }>(`/ngo/requests/${id}/assignments`)).data,
    updateCompletionChecklist: async (id: string, items: string[]) =>
      (await api.patch<{ completionEvidenceChecklist: string[] }>(`/ngo/requests/${id}/completion-evidence-checklist`, { items })).data.completionEvidenceChecklist,
    reassignAssignment: async (requestId: string, assignmentId: string, reason: string) =>
      (await api.post(`/ngo/requests/${requestId}/assignments/${assignmentId}/reassign`, { reason })).data,
    cancelAssignment: async (requestId: string, assignmentId: string, reason: string) =>
      (await api.post(`/ngo/requests/${requestId}/assignments/${assignmentId}/cancel`, { reason })).data,
    completionReviews: async () =>
      (await api.get<{ reviews: NgoCompletionReviewSummary[] }>("/ngo/completion-reviews")).data.reviews,
    completionReview: async (id: string) =>
      (await api.get<NgoCompletionReviewDetail>(`/ngo/assignments/${id}/completion-review`)).data,
    decideCompletion: async (id: string, data: {
      action: "approve" | "more_evidence_required" | "reject" | "flag_manual";
      reason: string; resolveOutstandingIssues?: boolean;
    }) => (await api.post(`/ngo/assignments/${id}/completion-review`, data)).data,
    assignmentEvidence: async (id: string) =>
      (await api.get<{ report: string; evidence: AssignmentEvidence[] }>(`/ngo/assignments/${id}/evidence`)).data,
    downloadAssignmentEvidence: async (assignmentId: string, evidenceId: string) => (await api.get<Blob>(
      `/ngo/assignments/${assignmentId}/evidence/${evidenceId}/content`,
      { responseType: "blob" },
    )).data,
    downloadRequestDocument: async (requestId: string, documentId: string) => (await api.get<Blob>(
      `/requests/${requestId}/documents/${documentId}/content`,
      { responseType: "blob" },
    )).data,
  },
  admin: {
    overview: async () => (await api.get<{ overview: Overview }>("/admin/overview")).data.overview,
    operations: async () => (await api.get<AdminOperations>("/admin/operations")).data,
    auditLogs: async (page = 1) => (await api.get<AdminAuditPage>("/admin/audit-logs", { params: { page, limit: 25 } })).data,
    accounts: async (page = 1, role = "all", status = "all") =>
      (await api.get<{ page: number; pageSize: number; total: number; accounts: Array<{ id: string; name: string; email: string; role: string; city: string; accountStatus: "active" | "suspended"; organizationStatus?: string; createdAt: string }> }>(
        "/admin/accounts", { params: { page, role, status } },
      )).data,
    updateAccountStatus: async (id: string, status: "active" | "suspended", reason?: string) =>
      (await api.patch(`/admin/accounts/${id}/status`, { status, ...(reason ? { reason } : {}) })).data,
    donations: async (page = 1, status = "all") =>
      (await api.get<{ page: number; pageSize: number; total: number; donations: Array<{ id: string; campaign: string; organizationId?: string; amount: number; currency: string; status: Contribution["status"]; receiptReference?: string; createdAt: string; updatedAt: string }> }>(
        "/admin/donations", { params: { page, status } },
      )).data,
    pendingOrganizations: async () => (await api.get<{ organizations: AdminOrganization[] }>("/admin/organizations")).data.organizations,
    organizationDetail: async (id: string) =>
      (await api.get<{ organization: AdminOrganization }>(`/admin/organizations/${id}`)).data.organization,
    volunteerDetail: async (id: string) =>
      (await api.get<{ volunteer: {
        id: string; name: string; email: string; city: string; phone?: string; skills: string[];
        interests: string[]; serviceArea?: string; serviceRadiusKm: number; eligibility: string;
        verificationReason?: string; reviewedAt?: string; createdAt: string;
        history: Array<{ status: string; reason?: string; occurredAt: string }>;
        documents: VerificationDocument[];
      } }>(`/admin/volunteers/${id}`)).data.volunteer,
    verificationDocument: async (id: string) =>
      (await api.get<Blob>(`/admin/verification-documents/${id}/content`, { responseType: "blob" })).data,
    reviewOrganization: async (id: string, status: "verified" | "rejected" | "resubmission_required", reason?: string) =>
      (await api.patch(`/admin/organizations/${id}`, { status, reason })).data,
    volunteers: async (status?: VolunteerEligibility) =>
      (await api.get<{ volunteers: Array<{ id: string; name: string; email: string; city: string; skills: string[]; interests: string[]; languages: string[]; availability?: string; serviceArea?: string; serviceRadiusKm: number; categories: string[]; eligibility: VolunteerEligibility; verificationReason?: string; reviewedAt?: string; documents: VerificationDocument[]; taskOptIn: boolean; accountStatus: string; createdAt: string }> }>(
        "/admin/volunteers",
        { params: status ? { status } : {} },
      )).data.volunteers,
    updateVolunteerEligibility: async (id: string, status: VolunteerEligibility, reason?: string) =>
      (await api.patch(`/admin/volunteers/${id}/eligibility`, { status, ...(reason ? { reason } : {}) })).data,
    completionReviews: async () =>
      (await api.get<{ reviews: NgoCompletionReviewSummary[] }>("/admin/completion-reviews")).data.reviews,
    clearManualReview: async (id: string, reason: string) =>
      (await api.post(`/admin/assignments/${id}/manual-review`, { reason })).data,
    assignmentEvidence: async (id: string) =>
      (await api.get<{ summary: string; report: string; status: string; aiReview: CompletionAiReview | null; evidence: AssignmentEvidence[]; reviewHistory: Array<{ status: string; reason?: string; occurredAt: string }> }>(`/admin/assignments/${id}/evidence`)).data,
    downloadAssignmentEvidence: async (assignmentId: string, evidenceId: string) =>
      (await api.get<Blob>(`/admin/assignments/${assignmentId}/evidence/${evidenceId}/content`, { responseType: "blob" })).data,
  },
  ngoVerification: {
    get: async () => (await api.get<{ organization: User & { coordinates?: { latitude: number; longitude: number }; acceptingRequests?: boolean; requestCapacity?: number; activeRequestCount?: number } }>("/ngo/verification")).data.organization,
    submit: async (data: {
      name: string; city: string; description: string; categories: string[];
      registrationNumber: string; registrationType: string; officialEmail: string;
      officialPhone: string; addressLine: string; state: string; postalCode: string; serviceArea: string;
      representativeName?: string; representativeDesignation?: string; issuingAuthority?: string; establishedDate?: string;
      coordinates?: { latitude: number; longitude: number }; acceptingRequests: boolean; requestCapacity?: number;
    }) => (await api.patch<{ organization: User }>("/ngo/verification", data)).data.organization,
    updateAvailability: async (data: {
      acceptingRequests: boolean;
      coordinates?: { latitude: number; longitude: number };
      clearCoordinates?: boolean;
      requestCapacity?: number;
    }) => (await api.patch<{ organization: { acceptingRequests: boolean; requestCapacity?: number; activeRequestCount: number } }>("/ngo/availability", data)).data.organization,
  },
  notifications: {
    mine: async (page = 1) => (await api.get<NotificationPage>("/notifications/me", { params: { page, limit: 20 } })).data,
    unreadCount: async () => (await api.get<{ unreadCount: number }>("/notifications/unread-count")).data.unreadCount,
    markRead: async (id: string) => (await api.patch(`/notifications/${id}/read`)).data,
    markAllRead: async () => (await api.post<{ updatedCount: number }>("/notifications/read-all")).data,
  },
  helpRequests: {
    uploadPolicy: async () => (await api.get<{ maxFileBytes: number; maxFiles: number; contentTypes: string[] }>("/requests/upload-policy")).data,
    mine: async () => (await api.get<{ requests: HelpRequestSummary[] }>("/requests/mine")).data.requests,
    detail: async (id: string) => (await api.get<{ request: HelpRequestDetail; documents: RequestAttachment[] }>(`/requests/${id}`)).data,
    matches: async (id: string) => (await api.get<{ radiusKm: number; matches: NgoMatch[]; assignedOrganization?: { id: string; name: string } }>(`/requests/${id}/matches`)).data,
    route: async (id: string, organizationId: string) =>
      (await api.post<{ request: HelpRequestSummary; organization: { id: string; name: string } }>(`/requests/${id}/route`, { organizationId })).data,
    update: async (id: string, data: Partial<{
      title: string; description: string; category: HelpRequestCategory; urgency: "low" | "medium" | "high";
      peopleCount: number; city: string; addressLine: string;
      coordinates: { latitude: number; longitude: number };
      preferredContactMethod: "phone" | "email" | "in_app"; consentToProcess: true;
    }>) => (await api.patch<{ request: HelpRequestSummary }>(`/requests/${id}`, data)).data.request,
    create: async (data: {
      title: string; description: string; category: HelpRequestCategory; urgency: "low" | "medium" | "high";
      peopleCount: number; city: string; addressLine?: string;
      coordinates?: { latitude: number; longitude: number };
      preferredContactMethod: "phone" | "email" | "in_app"; consentToProcess: true;
    }) => (await api.post<{ request: HelpRequestSummary; referenceId: string }>("/requests", data)).data,
    upload: async (requestId: string, file: File) => (await api.post<{ document: RequestAttachment }>(
      `/requests/${requestId}/documents`,
      file,
      { headers: { "Content-Type": file.type, "X-Upload-Filename": encodeURIComponent(file.name) } },
    )).data.document,
    screen: async (requestId: string) => (await api.post<{
      request: HelpRequestSummary; screening: RequestScreening; documents: RequestAttachment[];
    }>(`/requests/${requestId}/screen`)).data,
    timeline: async (requestId: string) => (await api.get<{ timeline: Array<{ status: HelpRequestStatus; reason?: string; occurredAt: string }> }>(`/requests/${requestId}/timeline`)).data.timeline,
    download: async (requestId: string, documentId: string) => (await api.get<Blob>(
      `/requests/${requestId}/documents/${documentId}/content`,
      { responseType: "blob" },
    )).data,
  },
};

export { api };
