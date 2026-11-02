import express from "express";
import session from "express-session";
import type { Store } from "express-session";
import MongoStore from "connect-mongo";
import cors from "cors";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import swaggerJSDoc from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";
import mongoose from "mongoose";
import { errorHandler } from "./middleware/errorHandler.js";
import { config } from "./config.js";
import { User } from "./models.js";
import { createApiRouter, paymentWebhook } from "./routes.js";

const swaggerSpec = swaggerJSDoc({
  definition: {
    openapi: "3.0.3",
    info: { title: "Impact Match API", version: "1.0.0", description: "API for connecting verified nonprofits with volunteers and donors." },
    servers: [{ url: `${config.API_ORIGIN}/api` }],
    components: { securitySchemes: { sessionCookie: { type: "apiKey", in: "cookie", name: "impact.sid" } } },
    paths: {
      "/health": { get: { summary: "Check API and database readiness", responses: { "200": { description: "API and MongoDB are available" }, "503": { description: "MongoDB is unavailable" } } } },
      "/auth/register": { post: { summary: "Create a help seeker, volunteer, donor, or NGO account", responses: { "201": { description: "Account created" }, "400": { description: "Invalid input" } } } },
      "/auth/login": { post: { summary: "Start a secure session", responses: { "200": { description: "Signed in" }, "401": { description: "Invalid credentials" } } } },
      "/requests/upload-policy": { get: { summary: "Get the authenticated help-request upload limits", security: [{ sessionCookie: [] }], responses: { "200": { description: "Supported attachment types and limits" } } } },
      "/requests": { post: { summary: "Submit a private help request as a help seeker", security: [{ sessionCookie: [] }], responses: { "201": { description: "Request submitted with reference ID" }, "400": { description: "Invalid request details" } } } },
      "/requests/mine": { get: { summary: "List only the signed-in help seeker's requests", security: [{ sessionCookie: [] }], responses: { "200": { description: "Private request summaries" } } } },
      "/requests/{id}/matches": { get: { summary: "Recommend verified category/location-matched NGOs without exposing request details", security: [{ sessionCookie: [] }], parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }], responses: { "200": { description: "Eligible NGOs with public match reasons and approximate distance" } } } },
      "/requests/{id}/route": { post: { summary: "Route a pending or declined request to one eligible NGO selected by its owner", security: [{ sessionCookie: [] }], parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }], responses: { "200": { description: "Request routed to one verified organization" }, "409": { description: "Selected organization is not eligible or request was concurrently changed" } } } },
      "/requests/{id}": {
        get: { summary: "Read a request owned by the signed-in help seeker or specifically routed to their verified NGO", security: [{ sessionCookie: [] }], parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }], responses: { "200": { description: "Authorized request details and private attachment metadata" }, "404": { description: "Request not found or not assigned to this organization" } } },
        patch: { summary: "Edit request details while the request is submitted or needs information", security: [{ sessionCookie: [] }], parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }], responses: { "200": { description: "Request updated" }, "409": { description: "Request is not editable" } } },
      },
      "/requests/{id}/documents": {
        get: { summary: "List attachment metadata for an owned request or a routed NGO request", security: [{ sessionCookie: [] }], parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }], responses: { "200": { description: "Authorized private attachment metadata" } } },
        post: { summary: "Upload one private attachment as its binary request body", security: [{ sessionCookie: [] }], parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }, { in: "header", name: "X-Upload-Filename", required: true, schema: { type: "string" }, description: "URL-encoded original filename; storage uses a random key." }], requestBody: { required: true, content: { "image/jpeg": { schema: { type: "string", format: "binary" } }, "image/png": { schema: { type: "string", format: "binary" } }, "image/webp": { schema: { type: "string", format: "binary" } }, "application/pdf": { schema: { type: "string", format: "binary" } } } }, responses: { "201": { description: "Private attachment stored" }, "413": { description: "Configured file limit exceeded" } } },
      },
      "/requests/{id}/documents/{documentId}/content": { get: { summary: "Download a private attachment as its owner or the assigned verified NGO", security: [{ sessionCookie: [] }], parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }, { in: "path", name: "documentId", required: true, schema: { type: "string" } }], responses: { "200": { description: "Authorized private attachment bytes" }, "404": { description: "Attachment not found or access denied" } } } },
      "/requests/{id}/screen": { post: { summary: "Run configured OCR and optional AI-assisted screening; always requires human review", security: [{ sessionCookie: [] }], parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }], responses: { "200": { description: "OCR and screening status, including unavailable provider state" }, "409": { description: "Request is not available for screening" } } } },
      "/requests/{id}/timeline": { get: { summary: "Read the timeline for an owned help request", security: [{ sessionCookie: [] }], parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }], responses: { "200": { description: "Request status history" } } } },
      "/ngo/requests": { get: { summary: "List requests routed only to the signed-in verified NGO", security: [{ sessionCookie: [] }], responses: { "200": { description: "Private request summaries without exact address or requester contact details" }, "403": { description: "Verified NGO account required" } } } },
      "/ngo/requests/{id}": { get: { summary: "Read a request and documents routed to the signed-in verified NGO", security: [{ sessionCookie: [] }], parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }], responses: { "200": { description: "Authorized reviewer details and private document metadata" }, "404": { description: "Request is not routed to this NGO" } } } },
      "/ngo/requests/{id}/review": { patch: { summary: "Start review, approve, request information, flag, or decline a routed request", security: [{ sessionCookie: [] }], parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }], responses: { "200": { description: "Human decision recorded in request history and audit log" }, "409": { description: "Request state changed or action is not currently allowed" } } } },
      "/ngo/requests/{id}/completion-evidence-checklist": { patch: { summary: "Configure up to 10 completion-evidence items for an owned request", security: [{ sessionCookie: [] }], parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }], responses: { "200": { description: "Checklist saved and returned to the assigned volunteer's private task details" }, "400": { description: "Checklist is invalid or request is no longer editable" }, "404": { description: "Request is not owned by this verified NGO" } } } },
      "/ngo/requests/{id}/volunteer-matches": { post: { summary: "Offer an approved request to eligible volunteers", security: [{ sessionCookie: [] }], parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }], responses: { "200": { description: "Volunteer offers without exposing requester details" }, "409": { description: "Request is not approved or is already assigned" } } } },
      "/ngo/requests/{id}/assignments": { get: { summary: "Monitor offers and assignments for a request routed to this verified NGO", security: [{ sessionCookie: [] }], parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }], responses: { "200": { description: "Assignment states and accepted volunteer's limited profile summary" } } } },
      "/ngo/requests/{id}/assignments/{assignmentId}/reassign": { post: { summary: "Reassign an active volunteer and offer the request again", security: [{ sessionCookie: [] }], responses: { "200": { description: "Previous access revoked and eligible offers issued" }, "409": { description: "Assignment is no longer active" } } } },
      "/ngo/requests/{id}/assignments/{assignmentId}/cancel": { post: { summary: "Cancel an active volunteer assignment", security: [{ sessionCookie: [] }], responses: { "200": { description: "Assignment cancelled and private-detail access revoked" }, "409": { description: "Assignment is no longer active" } } } },
      "/ngo/availability": { patch: { summary: "Update verified NGO coordinates, accepting status, and active request capacity", security: [{ sessionCookie: [] }], responses: { "200": { description: "Availability updated" }, "409": { description: "Capacity cannot be lower than current active requests" } } } },
      "/needs": { get: { summary: "List open opportunities", responses: { "200": { description: "Open opportunities" } } }, post: { summary: "Publish a need for a verified NGO", security: [{ sessionCookie: [] }], responses: { "201": { description: "Opportunity created" } } } },
      "/needs/{id}/fulfill": { post: { summary: "Join a volunteer opportunity", security: [{ sessionCookie: [] }], parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }], responses: { "201": { description: "Volunteer joined" } } } },
      "/payments/order": { post: { summary: "Create a Razorpay test-mode donation order", security: [{ sessionCookie: [] }], responses: { "201": { description: "Order created" }, "503": { description: "Payment provider not configured" } } } },
      "/payments/webhook": { post: { summary: "Receive and validate Razorpay payment events", responses: { "200": { description: "Webhook received" }, "400": { description: "Invalid webhook signature" }, "503": { description: "Webhook secret not configured" } } } },
      "/ngos": { get: { summary: "Search verified organizations", responses: { "200": { description: "Verified organizations and impact summaries" } } } },
      "/ngos/{id}": { get: { summary: "View a verified organization and its open needs", parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }], responses: { "200": { description: "Organization profile and opportunities" }, "404": { description: "Organization not found" } } } },
      "/payments/verify": { post: { summary: "Verify a signed Razorpay payment", security: [{ sessionCookie: [] }], responses: { "200": { description: "Payment recorded" }, "400": { description: "Signature could not be verified" } } } },
      "/profile/me": { patch: { summary: "Update the signed-in user's profile", security: [{ sessionCookie: [] }], responses: { "200": { description: "Profile updated" }, "401": { description: "Authentication required" } } } },
      "/payments/order/{orderId}/status": { get: { summary: "Read the signed-in donor's own server-side order status", security: [{ sessionCookie: [] }], parameters: [{ in: "path", name: "orderId", required: true, schema: { type: "string" } }], responses: { "200": { description: "Payment state for the owned order" }, "404": { description: "Order not found or not owned by this user" } } } },
      "/impact/contributions/{id}/receipt": { get: { summary: "Read a confirmation record for a completed contribution; not a tax receipt", security: [{ sessionCookie: [] }], parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }], responses: { "200": { description: "Contribution confirmation reference" }, "404": { description: "Contribution not found or unavailable" } } } },
      "/ngo/donations": { get: { summary: "List confirmed contributions for the signed-in verified NGO's campaigns", security: [{ sessionCookie: [] }], responses: { "200": { description: "Confirmed contribution summaries without donor contact details" }, "403": { description: "Verified NGO account required" } } } },
      "/item-donations": { post: { summary: "Submit an item donation to a verified NGO with validated pickup details and consent", security: [{ sessionCookie: [] }], responses: { "201": { description: "Item donation submitted" }, "400": { description: "Invalid donation or pickup information" } } } },
      "/item-donations/mine": { get: { summary: "List the signed-in donor's own item donations", security: [{ sessionCookie: [] }], responses: { "200": { description: "Owned item donations and status history" } } } },
      "/item-donations/{id}": { get: { summary: "Read an item donation with role- and relationship-scoped private details", security: [{ sessionCookie: [] }], parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }], responses: { "200": { description: "Authorized details; exact pickup information is restricted" }, "404": { description: "Donation not found or access denied" } } } },
      "/item-donations/{id}/evidence": { post: { summary: "Upload private item or pickup evidence; no public URL is returned", security: [{ sessionCookie: [] }], parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }, { in: "query", name: "kind", required: true, schema: { type: "string", enum: ["donation_photo", "pickup_photo"] } }], responses: { "201": { description: "Private evidence stored" }, "413": { description: "Configured upload limit exceeded" } } } },
      "/item-donations/{id}/evidence/{evidenceId}/content": { get: { summary: "Download private evidence after server-side relationship authorization", security: [{ sessionCookie: [] }], parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }, { in: "path", name: "evidenceId", required: true, schema: { type: "string" } }], responses: { "200": { description: "Authorized private file bytes" }, "404": { description: "Evidence not found or access denied" } } } },
      "/item-donations/{id}/receipt": { get: { summary: "Read item confirmation after NGO receipt; not a tax receipt", security: [{ sessionCookie: [] }], parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }], responses: { "200": { description: "Item donation confirmation" }, "404": { description: "Receipt unavailable" } } } },
      "/ngo/item-donations": { get: { summary: "List item donations belonging to the signed-in verified NGO", security: [{ sessionCookie: [] }], responses: { "200": { description: "Relationship-scoped item donation inbox and history" } } } },
      "/ngo/item-donations/{id}/review": { patch: { summary: "Accept, reject, or request information for an owned item donation", security: [{ sessionCookie: [] }], parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }], responses: { "200": { description: "Human review decision recorded" }, "409": { description: "Donation state no longer permits this decision" } } } },
      "/ngo/item-donations/{id}/offer-pickup": { post: { summary: "Offer an accepted item pickup to eligible volunteers", security: [{ sessionCookie: [] }], responses: { "200": { description: "Private pickup offers created" }, "409": { description: "Donation is not available for pickup assignment" } } } },
      "/ngo/item-donations/{id}/reassign-pickup": { post: { summary: "Reassign an item pickup after an authorized failure or cancellation", security: [{ sessionCookie: [] }], responses: { "200": { description: "Previous access revoked and new offers created" }, "409": { description: "Pickup cannot be reassigned in its current state" } } } },
      "/ngo/item-donations/{id}/confirm-received": { post: { summary: "Confirm receipt after volunteer pickup submission", security: [{ sessionCookie: [] }], responses: { "200": { description: "Receipt and completion decision recorded" }, "409": { description: "No submitted pickup is awaiting confirmation" } } } },
      "/volunteer/item-pickups": { get: { summary: "List eligible pickup offers without exact donor location or contact", security: [{ sessionCookie: [] }], responses: { "200": { description: "Volunteer-specific pickup summaries" } } } },
      "/volunteer/item-pickups/mine": { get: { summary: "List the signed-in volunteer's pickup assignments and history", security: [{ sessionCookie: [] }], responses: { "200": { description: "Own pickup assignments" } } } },
      "/volunteer/item-pickups/{id}/accept": { post: { summary: "Atomically accept one pickup offer and claim the donation", security: [{ sessionCookie: [] }], responses: { "200": { description: "Pickup assigned; private-detail access enabled" }, "409": { description: "Offer expired or another volunteer claimed the pickup" } } } },
      "/volunteer/item-pickups/{id}/details": { get: { summary: "Read exact pickup details as the currently assigned volunteer", security: [{ sessionCookie: [] }], responses: { "200": { description: "Necessary private pickup and contact details" }, "404": { description: "Assignment not active or access denied" } } } },
      "/volunteer/item-pickups/{id}/start": { post: { summary: "Start the assigned pickup", security: [{ sessionCookie: [] }], responses: { "200": { description: "Pickup progress updated" } } } },
      "/volunteer/item-pickups/{id}/report-issue": { post: { summary: "Report an issue with the assigned pickup", security: [{ sessionCookie: [] }], responses: { "200": { description: "Issue recorded for the owning NGO" } } } },
      "/volunteer/item-pickups/{id}/submit": { post: { summary: "Submit pickup report after uploading private pickup photo evidence", security: [{ sessionCookie: [] }], responses: { "200": { description: "Pickup awaits NGO receipt confirmation" }, "409": { description: "Required pickup evidence is missing" } } } },
      "/impact/me": { get: { summary: "View your contribution summary", security: [{ sessionCookie: [] }], responses: { "200": { description: "Contribution summary" } } } },
      "/impact/contributions/me": { get: { summary: "List the signed-in user's contributions", security: [{ sessionCookie: [] }], responses: { "200": { description: "Contribution history" } } } },
      "/impact/summary": { get: { summary: "View public platform impact totals", responses: { "200": { description: "Platform-wide metrics and analytics" } } } },
      "/volunteer/dashboard": { get: { summary: "View the signed-in volunteer dashboard", security: [{ sessionCookie: [] }], responses: { "200": { description: "Volunteer contributions and impact" } } } },
      "/volunteer/recommendations": { get: { summary: "Get explainable volunteer opportunity matches", security: [{ sessionCookie: [] }], responses: { "200": { description: "Ranked open opportunities with match reasons" } } } },
      "/volunteer/applications": { get: { summary: "List the signed-in volunteer's applications", security: [{ sessionCookie: [] }], responses: { "200": { description: "Volunteer applications" } } } },
      "/volunteer/preferences": { get: { summary: "Read task opt-in, service area, and volunteer eligibility", security: [{ sessionCookie: [] }], responses: { "200": { description: "Private volunteer task preferences" } } }, patch: { summary: "Update task opt-in and service location; eligibility remains admin-controlled", security: [{ sessionCookie: [] }], responses: { "200": { description: "Volunteer preferences updated" }, "400": { description: "Invalid coordinates or preferences" } } } },
      "/volunteer/tasks/available": { get: { summary: "List unexpired offers addressed to the signed-in eligible volunteer", security: [{ sessionCookie: [] }], responses: { "200": { description: "Task summaries and approximate distance only; no requester contact or exact address" } } } },
      "/volunteer/assignments": { get: { summary: "List only the signed-in volunteer's assignments and history summaries", security: [{ sessionCookie: [] }], responses: { "200": { description: "Volunteer assignments" } } } },
      "/volunteer/assignments/{id}/accept": { post: { summary: "Atomically claim an offered task and disclose private details only after acceptance", security: [{ sessionCookie: [] }], responses: { "200": { description: "Task accepted" }, "409": { description: "Offer expired or another volunteer claimed the request" } } } },
      "/volunteer/assignments/{id}/details": { get: { summary: "Read exact location and preferred requester contact after a valid assignment", security: [{ sessionCookie: [] }], responses: { "200": { description: "Private task details for the currently assigned volunteer only" }, "404": { description: "Assignment access denied or revoked" } } } },
      "/volunteer/assignments/{id}/start": { post: { summary: "Start an accepted assignment", security: [{ sessionCookie: [] }], responses: { "200": { description: "Assignment and request moved to in progress" }, "409": { description: "Assignment is not accepted" } } } },
      "/volunteer/assignments/{id}/progress": { patch: { summary: "Record a limited progress note on an in-progress assignment", security: [{ sessionCookie: [] }], responses: { "200": { description: "Progress recorded" } } } },
      "/volunteer/assignments/{id}/evidence": { post: { summary: "Upload private completion evidence to an active assignment", security: [{ sessionCookie: [] }], responses: { "201": { description: "Evidence stored privately" }, "413": { description: "Configured upload limit exceeded" } } } },
      "/volunteer/assignments/{id}/submit": { post: { summary: "Submit completion report and evidence for NGO review without completing the request", security: [{ sessionCookie: [] }], responses: { "200": { description: "Submitted for human NGO review" }, "409": { description: "Assignment is not in progress" } } } },
      "/volunteer/assignments/{id}/completion-proofs": { get: { summary: "List the signed-in volunteer's prior completion submissions and review outcomes", security: [{ sessionCookie: [] }], responses: { "200": { description: "Private submission history without storage keys" } } } },
      "/ngo/completion-reviews": { get: { summary: "List only completion submissions assigned to the verified NGO", security: [{ sessionCookie: [] }], responses: { "200": { description: "Completion-review inbox with advisory AI status" }, "403": { description: "Verified NGO required" } } } },
      "/ngo/assignments/{id}/completion-review": {
        get: { summary: "Read a submitted proof, advisory assessment, assignment history, and authorized evidence metadata", security: [{ sessionCookie: [] }], responses: { "200": { description: "Private NGO-scoped completion review details" }, "404": { description: "Assignment is not assigned to this NGO" } } },
        post: { summary: "Approve and close, request more evidence, reject with reason, or flag for administrator review", security: [{ sessionCookie: [] }], responses: { "200": { description: "Human review decision recorded" }, "409": { description: "Submission changed or review conditions are not met" } } },
      },
      "/admin/completion-reviews": { get: { summary: "List completion cases explicitly flagged for administrator review", security: [{ sessionCookie: [] }], responses: { "200": { description: "Flagged manual-review queue" } } } },
      "/admin/assignments/{id}/manual-review": { post: { summary: "Record an administrator review and return a flagged proof to its owning NGO; does not close the request", security: [{ sessionCookie: [] }], responses: { "200": { description: "Manual review recorded" }, "409": { description: "The case is no longer flagged" } } } },
      "/admin/volunteers": { get: { summary: "List volunteers awaiting eligibility review", security: [{ sessionCookie: [] }], responses: { "200": { description: "Volunteer eligibility queue" } } } },
      "/admin/volunteers/{id}/eligibility": { patch: { summary: "Approve or restrict volunteer task eligibility", security: [{ sessionCookie: [] }], responses: { "200": { description: "Volunteer eligibility updated and audited" }, "409": { description: "Active assignments must be resolved before suspension" } } } },
      "/admin/operations": { get: { summary: "Read database-backed case counts and configured integration status; external health is not implied", security: [{ sessionCookie: [] }], responses: { "200": { description: "Runtime and configuration indicators for admins only" } } } },
      "/admin/audit-logs": { get: { summary: "List paginated audit events without private file contents or storage keys", security: [{ sessionCookie: [] }], parameters: [{ in: "query", name: "page", schema: { type: "integer", minimum: 1 } }, { in: "query", name: "limit", schema: { type: "integer", minimum: 1, maximum: 50 } }], responses: { "200": { description: "Paginated audit entries" } } } },
      "/admin/accounts": { get: { summary: "List non-administrator account status with role and status filters", security: [{ sessionCookie: [] }], responses: { "200": { description: "Paginated account summaries" } } } },
      "/admin/accounts/{id}/status": { patch: { summary: "Activate or suspend a non-administrator account; suspension requires a reason and resolved active work", security: [{ sessionCookie: [] }], parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }], responses: { "200": { description: "Account status updated and audited" }, "409": { description: "Active assignments or routed requests must be resolved first" } } } },
      "/admin/donations": { get: { summary: "View paginated monetary donation states without provider identifiers or donor contact details", security: [{ sessionCookie: [] }], responses: { "200": { description: "Authorized contribution status overview" } } } },
      "/notifications/me": { get: { summary: "List the signed-in user's paginated in-app notification history and unread count", security: [{ sessionCookie: [] }], parameters: [{ in: "query", name: "page", schema: { type: "integer", minimum: 1 } }, { in: "query", name: "limit", schema: { type: "integer", minimum: 1, maximum: 50 } }], responses: { "200": { description: "Recipient-scoped notifications with a safe payload allowlist" } } } },
      "/notifications/unread-count": { get: { summary: "Count unread notifications for the signed-in recipient", security: [{ sessionCookie: [] }], responses: { "200": { description: "Recipient's unread count" } } } },
      "/notifications/{id}/read": { patch: { summary: "Mark one owned notification as read", security: [{ sessionCookie: [] }], parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }], responses: { "200": { description: "Notification read timestamp" }, "404": { description: "Notification is not owned by this user" } } } },
      "/notifications/read-all": { post: { summary: "Mark all notifications belonging to the signed-in recipient as read", security: [{ sessionCookie: [] }], responses: { "200": { description: "Number of notifications updated" } } } },
      "/ngo/dashboard": { get: { summary: "View the signed-in NGO dashboard", security: [{ sessionCookie: [] }], responses: { "200": { description: "NGO tasks and statistics" } } } },
      "/admin/overview": { get: { summary: "View administrator dashboard metrics", security: [{ sessionCookie: [] }], responses: { "200": { description: "Platform metrics" } } } },
      "/admin/organizations": { get: { summary: "List pending NGO applications", security: [{ sessionCookie: [] }], responses: { "200": { description: "Pending organization reviews" } } } },
      "/admin/organizations/{id}": { patch: { summary: "Approve or reject an NGO application", security: [{ sessionCookie: [] }], parameters: [{ in: "path", name: "id", required: true, schema: { type: "string" } }], responses: { "200": { description: "Organization status updated" } } } },
    },
  },
  apis: [],
});

export function createApp(sessionStore?: Store) {
  const app = express();
  app.disable("x-powered-by");
  if (config.isProduction) app.set("trust proxy", 1);
  app.use(helmet());
  app.use(cors({ origin: config.CLIENT_ORIGIN, credentials: true }));
  app.post("/api/payments/webhook", express.raw({ type: "application/json", limit: "256kb" }), paymentWebhook);
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: false, limit: "1mb" }));
  app.use("/api/health", (_req, res) => {
    const databaseConnected = mongoose.connection.readyState === 1;
    res.status(databaseConnected ? 200 : 503).json({
      status: databaseConnected ? "ok" : "unavailable",
      service: "impact-match-api",
      database: databaseConnected ? "connected" : "disconnected",
    });
  });
  app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

  app.use(session({
    name: "impact.sid",
    secret: config.SESSION_SECRET,
    store: sessionStore ?? MongoStore.create({
      mongoUrl: config.MONGODB_URI,
      collectionName: "sessions",
      ttl: config.SESSION_TTL_DAYS * 24 * 60 * 60,
    }),
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: config.isProduction,
      sameSite: config.isProduction ? "none" : "lax",
      maxAge: config.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
    },
  }));

  app.use("/api", rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { message: "Too many requests. Please try again in a few minutes." },
  }));
  app.use("/api/auth/login", rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { message: "Too many login attempts. Please wait a few minutes and try again." },
  }));
  app.use("/api/auth/register", rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 8,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { message: "Too many accounts were created from this address. Please try again later." },
  }));

  app.use("/api", (req, res, next) => {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
      next();
      return;
    }

    const origin = req.get("origin");
    const fetchSite = req.get("sec-fetch-site");
    const allowedOrigin = new URL(config.CLIENT_ORIGIN).origin;
    let requestOrigin = origin;
    if (!requestOrigin) {
      const referer = req.get("referer");
      if (referer) {
        try {
          requestOrigin = new URL(referer).origin;
        } catch {
          requestOrigin = undefined;
        }
      }
    }
    if (!requestOrigin || requestOrigin !== allowedOrigin || fetchSite === "cross-site") {
      res.status(403).json({ message: "Cross-origin requests are not allowed." });
      return;
    }
    next();
  });

  app.use("/api", async (req, res, next) => {
    if (!req.session.userId) { next(); return; }
    try {
      const user = await User.findById(req.session.userId);
      if (!user) {
        req.session.destroy((error) => error ? next(error) : next());
        return;
      }
      if (user.accountStatus === "suspended") {
        req.session.destroy((error) => {
          if (error) { next(error); return; }
          res.clearCookie("impact.sid");
          res.status(403).json({ message: "This account is suspended. Contact support or an administrator for assistance." });
        });
        return;
      }
      req.user = {
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
        ...(user.representativeName ? { representativeName: user.representativeName } : {}),
        ...(user.representativeDesignation ? { representativeDesignation: user.representativeDesignation } : {}),
        ...(user.issuingAuthority ? { issuingAuthority: user.issuingAuthority } : {}),
        ...(user.establishedDate ? { establishedDate: user.establishedDate.toISOString() } : {}),
        ...(user.officialEmail ? { officialEmail: user.officialEmail } : {}),
        ...(user.officialPhone ? { officialPhone: user.officialPhone } : {}),
        ...(user.addressLine ? { addressLine: user.addressLine } : {}),
        ...(user.state ? { state: user.state } : {}),
        ...(user.postalCode ? { postalCode: user.postalCode } : {}),
        ...(user.serviceArea ? { serviceArea: user.serviceArea } : {}),
        ...(user.verificationReason ? { verificationReason: user.verificationReason } : {}),
      };
      next();
    } catch (error) {
      next(error);
    }
  });
  app.use("/api", createApiRouter());

  app.use((_req, res) => res.status(404).json({ message: "This endpoint does not exist." }));
  app.use(errorHandler);
  return app;
}
