# API reference

The API base path is `/api`. Swagger UI is served at `/api/docs`; its OpenAPI 3.0.3 definition is in [server/src/app.ts](../server/src/app.ts). All request bodies are validated in the API, but the current OpenAPI document does not describe every field or error response.

## Phase 10 runtime check (2026-08-09)

A local API instance connected to a dedicated MongoDB test database and returned `200` with `database: connected` from `/api/health`. Registration, session persistence, logout/login, donor authorization denial from an administrator route, and the explicit `503` response when Razorpay is unconfigured were exercised. The payment integration suite passed against a separate isolated test database with mocked provider responses. The complete help-request, NGO-review, and item-pickup workflows and all live providers remain unverified. See [FINAL_QA_REPORT.md](./FINAL_QA_REPORT.md) for the exact run evidence and limitations.

## Public routes

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | MongoDB readiness; returns 503 when disconnected. |
| GET | `/needs` | Search open opportunities. |
| GET | `/ngos` | Search verified NGOs without public email exposure. |
| GET | `/ngos/:id` | View a verified NGO and its open needs. |
| GET | `/impact/summary` | Public database-backed impact overview. |
| POST | `/auth/register` | Register a help seeker, volunteer, donor, or NGO. |
| POST | `/auth/login` | Start a session. |
| GET | `/auth/me` | Read current session user; `user` may be null. |

## Authenticated routes

| Method | Path | Required role/ownership |
|---|---|---|
| POST | `/auth/logout` | Signed-in user. |
| PATCH | `/profile/me` | Signed-in user; updates only their own profile. |
| GET | `/verification/me` | NGO or volunteer applicant; read own verification status, reviewer history, and document metadata only. |
| POST | `/verification/me/documents` | NGO or volunteer applicant; private raw-binary upload. Set `X-Document-Kind`, `X-Upload-Filename`, and matching `Content-Type`; supports JPEG, PNG, WebP, and PDF. |
| POST | `/verification/me/resubmit` | NGO or volunteer applicant whose application was rejected or returned for more information; move the application back to human review. |
| GET/PATCH | `/ngo/verification` | NGO; read or submit verification profile, including optional representative/legal details and location/service settings. |
| PATCH | `/ngo/availability` | Verified NGO; update matching coordinates, acceptance status, and active-request capacity without changing verification status. |
| GET | `/requests/upload-policy` | Help seeker upload limits and supported MIME types. |
| POST | `/requests` | Help seeker; validates consent and creates a private database-backed request with a reference ID. |
| GET | `/requests/mine` | Help seeker; list only their request summaries. |
| GET | `/requests/:id` | Request owner, or the verified NGO to which it is routed; NGO access is relationship-scoped. |
| PATCH | `/requests/:id` | Help seeker; edit allowed fields only while submitted or awaiting information. Status is never client-set. |
| POST | `/requests/:id/documents` | Help seeker; upload one raw binary file for their request. Supply the original name in `X-Upload-Filename`; `Content-Type` must match the file. |
| GET | `/requests/:id/matches` | Help seeker; list eligible verified NGOs by category plus geospatial proximity or city/service-area fallback. |
| POST | `/requests/:id/route` | Help seeker; route their unassigned request to one server-validated eligible NGO. |
| GET | `/requests/:id/documents` | Help seeker or the verified assigned NGO; list authorized attachment metadata. |
| GET | `/requests/:id/documents/:documentId/content` | Help seeker or the verified assigned NGO; authenticated private download; no public or permanent signed URL is returned. |
| POST | `/requests/:id/screen` | Help seeker; trigger configured OCR/AI screening and controlled status transitions. Human review remains mandatory. |
| GET | `/requests/:id/timeline` | Help seeker; status history for their own request. |
| GET | `/ngo/requests` | Verified NGO; inbox contains only requests routed to that organization, with city-level location and no requester contact details. |
| GET | `/ngo/requests/:id` | Verified assigned NGO; details and private documents for that routed request only. |
| PATCH | `/ngo/requests/:id/review` | Verified assigned NGO; start review, approve, request missing information, flag, or decline with a reason where required. |
| PATCH | `/ngo/requests/:id/completion-evidence-checklist` | Verified owning NGO; configure up to 10 completion-evidence checklist items while the request is eligible for matching/review. The assigned volunteer sees the list in authorized private task details. |
| POST | `/needs` | Verified NGO role; creates an opportunity owned by that account. |
| POST | `/needs/:id/fulfill` | Volunteer role; joins an open opportunity subject to capacity/duplicate checks. |
| POST | `/payments/order` | Donor or volunteer role; server reserves the requested campaign amount. |
| POST | `/payments/verify` | Donor or volunteer role; server verifies provider signature and payment status. |
| GET | `/payments/order/:orderId/status` | Donor/volunteer who owns the order; private status refresh for browser/webhook reconciliation. |
| GET | `/impact/contributions/:id/receipt` | Donor/volunteer who owns a completed contribution; returns a confirmation record, not a tax receipt. |
| GET | `/impact/me` | Signed-in user's own aggregate. |
| GET | `/impact/contributions/me` | Signed-in user's own contribution history. |
| GET | `/ngo/donations` | Verified NGO; completed monetary contributions for its campaigns without donor contact details. |
| GET | `/item-donations/mine` | Signed-in donor; own physical-item donations and status timeline. |
| POST | `/item-donations` | User, donor, or volunteer; submit an item donation to a verified NGO with validated pickup details and explicit consent. |
| PATCH | `/item-donations/:id/resubmit` | Item donor; update only their own donation while the NGO has requested information. |
| POST | `/item-donations/:id/cancel` | Item donor; cancel before a pickup assignment is claimed. |
| GET | `/item-donations/:id` | Donor, owning verified NGO, or current assigned volunteer; private exact pickup details appear only to the donor/authorized NGO/assigned volunteer. |
| POST | `/item-donations/:id/evidence?kind=donation_photo` | Donor; upload private JPEG/PNG/WebP/PDF evidence as raw bytes with `X-Upload-Filename`. |
| GET | `/item-donations/:id/evidence/:evidenceId/content` | Donor, owning verified NGO, or currently assigned volunteer; audited private evidence download. |
| GET | `/item-donations/:id/receipt` | Donor or receiving NGO; available after NGO receipt confirmation, explicitly not tax-deductible. |
| GET | `/ngo/item-donations` | Verified NGO; incoming/history summaries for that organization without donor contact or exact address. |
| PATCH | `/ngo/item-donations/:id/review` | Verified owning NGO; accept, reject, or request missing information with reason where required. |
| POST | `/ngo/item-donations/:id/offer-pickup` | Verified owning NGO; create private offers for eligible volunteers on an accepted unassigned donation. |
| POST | `/ngo/item-donations/:id/reassign-pickup` | Verified owning NGO; reasoned reassignment after pickup failure, dispute, or active pickup. |
| POST | `/ngo/item-donations/:id/confirm-received` | Verified owning NGO; confirm a volunteer-submitted pickup and complete the donation. |
| GET | `/volunteer/item-pickups` | Eligible opted-in volunteer; private offer summaries with no donor contact or exact pickup address. |
| GET | `/volunteer/item-pickups/mine` | Volunteer; own pickup assignments and history summaries. |
| POST | `/volunteer/item-pickups/:id/accept` or `/decline` | Addressed volunteer; accept uses atomic item claim and assignment-capacity reservation. |
| GET | `/volunteer/item-pickups/:id/details` | Currently assigned volunteer after acceptance; returns necessary exact pickup address and preferred contact method. |
| POST | `/volunteer/item-pickups/:id/start` | Assigned volunteer; start the accepted pickup. |
| POST | `/item-donations/:id/evidence?kind=pickup_photo` | Currently assigned volunteer; upload private pickup proof. |
| POST | `/volunteer/item-pickups/:id/report-issue` or `/submit` | Assigned volunteer; report a pickup problem or submit a collection report; a photo is required before submit. |
| GET | `/volunteer/dashboard` | Volunteer role; signed-in user's activity. |
| GET | `/volunteer/recommendations` | Volunteer role; returns up to six open opportunities from verified NGOs with a 0–100 deterministic fit score and reasons. |
| GET | `/volunteer/applications` | Volunteer role; signed-in user's sign-ups. |
| GET/PATCH | `/volunteer/preferences` | Volunteer role; read/update task opt-in, city/service area, optional coordinates, and service radius. Only an administrator can mark a volunteer eligible. |
| GET | `/volunteer/tasks/available` | Eligible opted-in volunteer; list only unexpired offers addressed to that account, with a summary and approximate distance only when calculated. |
| GET | `/volunteer/assignments` | Volunteer role; own assignment summaries and history only. |
| POST | `/volunteer/assignments/:id/accept` | Volunteer role; conditionally claims one NGO-approved request. A competing acceptance receives `409`. |
| POST | `/volunteer/assignments/:id/decline` | Volunteer role; decline only the signed-in volunteer's unexpired offer. |
| GET | `/volunteer/assignments/:id/details` | Assigned volunteer only after successful acceptance; returns necessary task description, exact location, and the requester's chosen contact method. |
| POST | `/volunteer/assignments/:id/start` | Assigned volunteer; start an accepted task. |
| PATCH | `/volunteer/assignments/:id/progress` | Assigned volunteer; add a limited progress note while in progress. |
| POST | `/volunteer/assignments/:id/report-issue` or `/cancel` | Assigned volunteer; report an obstacle or cancel with a reason; private access is revoked and the request returns to matching. |
| POST | `/volunteer/assignments/:id/evidence` | Assigned volunteer; upload one private JPEG, PNG, WebP, or PDF evidence file using a binary body and `X-Upload-Filename`. |
| POST | `/volunteer/assignments/:id/submit` | Currently assigned volunteer; submit summary, work report, completion time, optional recipient confirmation/follow-up, and optional AI/OCR consent with new private evidence. Legacy `{report}` bodies remain accepted. |
| GET | `/volunteer/assignments/:id/completion-proofs` | Currently assigned volunteer; read their own submission and review history. |
| GET | `/volunteer/assignments/:id/evidence/:evidenceId/content` | Currently assigned volunteer only; authorized private evidence download, audited without recording file content. |
| POST | `/ngo/requests/:id/volunteer-matches` | Verified owning NGO; send an offer for an approved, unassigned request; optional future `deadlineAt`. |
| GET | `/ngo/requests/:id/assignments` | Verified owning NGO; monitor offers, active assignment status, progress, and limited profile data for the accepted volunteer. |
| POST | `/ngo/requests/:id/assignments/:assignmentId/reassign` or `/cancel` | Verified owning NGO; reasoned reassignment/cancellation with private access revocation. |
| GET | `/ngo/assignments/:id/evidence` | Verified owning NGO; read a submitted completion report and evidence metadata. |
| GET | `/ngo/assignments/:id/evidence/:evidenceId/content` | Verified owning NGO; authorized private evidence download. |
| GET | `/ngo/completion-reviews` | Verified NGO; completion-review inbox for submissions routed to that organization only. |
| GET | `/ngo/assignments/:id/completion-review` | Verified owning NGO; task summary, proof/report, advisory AI findings, assignment history, and evidence metadata. |
| POST | `/ngo/assignments/:id/completion-review` | Verified owning NGO; `approve`, `more_evidence_required`, `reject`, or `flag_manual`, with a required human rationale. Only approval closes the request. |
| GET | `/admin/volunteers` and `/admin/volunteers/:id` | Admin role; volunteer review queue and application details with private-document metadata. |
| PATCH | `/admin/volunteers/:id/eligibility` | Admin role; approve, reject, request more information, mark under review, or suspend; active work must be reassigned before suspension. Decisions are recorded with reviewer/time/history and audited. |
| GET | `/admin/verification-documents/:documentId/content` | Admin role; authorized private document download, audited without recording file contents. |
| GET | `/admin/assignments/:id/details` | Admin role; authorized private task details. |
| GET | `/admin/assignments/:id/evidence` and `/admin/assignments/:id/evidence/:evidenceId/content` | Admin role; authorized evidence review/download. |
| GET | `/admin/completion-reviews` | Admin role; view cases explicitly flagged for manual review. |
| POST | `/admin/assignments/:id/manual-review` | Admin role; record a reason and return a flagged case to the owning NGO; this action does not close the request. |
| GET | `/admin/accounts?page=1&role=all&status=all` | Admin role; paginated non-admin account summaries with role/status filters. |
| PATCH | `/admin/accounts/:id/status` | Admin role; activate or suspend a non-admin account. Suspension requires a reason and is blocked while active volunteer work or NGO-routed requests remain. |
| GET | `/admin/donations?page=1&status=all` | Admin role; paginated contribution state overview without provider IDs or donor contact details. |
| GET | `/admin/operations` | Admin role; case counts and integration configuration/runtime-state distinctions. |
| GET | `/admin/audit-logs?page=1&limit=25` | Admin role; paginated audit events with actor, action, resource and decision metadata; excludes private file contents/keys. |
| GET | `/ngo/dashboard` | NGO role; needs, volunteer activity, and persisted incoming/review/approved/assignment/completed request counts scoped to the signed-in organization. |
| GET | `/admin/overview` | Admin role. |
| GET | `/admin/organizations` and `/admin/organizations/:id` | Admin role; pending NGO application details and private-document metadata. |
| PATCH | `/admin/organizations/:id` | Admin role; approve, reject with reason, or request more information; decisions are reviewed, timestamped, audited, and added to application history. |
| GET | `/notifications/me?page=1&limit=20` | Authenticated recipient only; paginated in-app history and unread count. Limit is 1–50. |
| GET | `/notifications/unread-count` | Authenticated recipient only; unread count. |
| PATCH | `/notifications/:id/read` | Authenticated owner only; mark one notification read. |
| POST | `/notifications/read-all` | Authenticated recipient only; mark all of their notifications read. |

## Payment webhook

`POST /payments/webhook` is a provider-to-server endpoint, not a browser session route. The Express raw-body parser is installed before JSON parsing; Razorpay signature verification uses those exact raw bytes. Captures must match a known order, expected INR amount, signed currency, and captured status. An unknown order record returns retryable 503 so an early webhook is not silently discarded.

Notification read state is separate from delivery `status`; the API only updates `readAt` and always scopes writes by the current recipient ID. Payload responses use an allowlist of record IDs and safe summaries, never storage keys, private addresses, contact data, payment secrets, or file URLs. In-app records are persisted in MongoDB. Email, push, and SMS are not implemented/configured.

Administrator `/admin/operations` reports live MongoDB connectivity and whether integration credentials/settings are configured. OCR, AI, Razorpay, local storage accessibility, and geospatial matching do not have provider health probes here; they are marked runtime-unverified. Configuration must not be interpreted as provider availability.

Route implementation and request schemas are in [server/src/routes.ts](../server/src/routes.ts); middleware and readiness are in [server/src/app.ts](../server/src/app.ts). Webhook retries must be expected. Browser and webhook settlement are idempotent and successful confirmed payments receive a private receipt reference. Current outcomes for delayed/out-of-order captures that cannot safely credit a campaign are `refund_required` for manual follow-up; automated refunds and an administrator refund UI are not available.

## Request lifecycle and matching

After screening (including when external screening is unavailable), a request remains eligible for human review; AI/OCR never approve or reject it. A requester can view eligible NGO recommendations and choose one. The matching service requires verified status, a matching service category (including common category aliases), and an accepting/available capacity. With valid request and NGO GeoJSON coordinates, MongoDB `$geoNear` is used with a 2dsphere index and configurable radius. Without coordinates, exact city or a service-area city match is used; missing coordinates are never treated as `(0,0)`. Match results contain public name, city, categories, service area, distance when available, and explanation only. Matching does not automatically route a request.

Set `NGO_MATCH_RADIUS_KM` (default 50, maximum 500) and `NGO_MATCH_MAX_RESULTS` (default 10, maximum 50). NGOs can enter optional latitude/longitude coordinates, service categories, an accepting-requests flag, and optional maximum active-request capacity through their verification profile. The `users.ngoLocation` GeoJSON field has a 2dsphere index; existing profiles without coordinates continue to use city/service-area fallback.

Routing stores one `assignedOrganizationId` per request and uses a conditional update to prevent concurrent conflicting NGO assignments. The routed NGO alone can see request details and download private documents; the inbox shows city but not exact address/contact details. Human review transitions are `pending_ngo_review → under_review → approved`, with `needs_information`, `flagged_for_review`, and `rejected` outcomes. More-information requests and flags require a reason. Approval requires an authorized verified NGO and is recorded with actor/time in the timeline and audit log. A decline requires a reason, clears the route, and returns the request to the requester as rejected by that NGO; the requester may select another currently eligible NGO, which resets it to pending review. Stale-request automatic expiry/reassignment is not implemented.

In-app notifications are recorded for requester routing, review/status changes, reassignment, and new NGO inbox items. Email, SMS, and push delivery are not configured.

## Volunteer matching, assignments, and disclosure

Only active volunteer accounts with admin-controlled `volunteerEligibility=eligible`, `volunteerTaskOptIn=true`, category/skill compatibility, service-area or radius eligibility, and remaining active-assignment capacity are matched. NGO users explicitly open matching only after human approval; offers use `VOLUNTEER_MATCH_RADIUS_KM` (default 30 km), `VOLUNTEER_MATCH_MAX_OFFERS` (default 10), and `VOLUNTEER_OFFER_TTL_HOURS` (default 24). Coordinates are validated and stored as `users.volunteerLocation` GeoJSON with a 2dsphere index. MongoDB geospatial `$near` is used when both request and volunteer coordinates are available. City/service-area fallback is used when coordinates are missing, with no fabricated distance.

Offers contain only a generated category summary, urgency, city, people count, public NGO name, transparent match explanation, optional approximate distance, and expiry. Acceptance first reserves the volunteer's assignment capacity and conditionally claims the request's currently-unassigned volunteer slot. If another volunteer wins, the competing claim returns a conflict; sibling offers are cancelled and notified. Offer expiry is enforced at acceptance and reconciled when volunteers or NGOs load assignment lists. There is no scheduled expiry/reassignment worker.

The status lifecycle is `offered → accepted → in_progress → submitted_for_review`; other recorded statuses include `declined`, `expired`, `cancelled`, `reassigned`, and `disputed`. Request status stays synchronized through conditional status updates and timelines. A missed NGO-set deadline is surfaced as overdue in the volunteer/NGO dashboards; the volunteer can report an issue and the NGO can cancel or reassign. A background missed-deadline worker is not configured.

## Completion proof and request closure

The owning NGO may set up to 10 checklist items before matching/assignment; those requirements are returned only in the assigned volunteer's authorized private task details. The currently assigned volunteer uploads private JPEG, PNG, WebP, or PDF evidence and submits a completion summary, work/outcome report, completion time, optional recipient confirmation, and optional unresolved follow-up. Every submission creates a separate `CompletionProof` record and snapshots the evidence IDs/keys; earlier submissions and evidence are retained. The API requires new evidence after a request for more evidence or rejection. Existing per-file size/count limits, MIME/extension/signature checks, random private object keys, and authenticated download controls apply. APIs return file metadata, never storage keys or permanent public URLs.

When the volunteer separately consents to automated assistance, configured image OCR may use Google Cloud Vision and text review may use OpenAI. OCR text is not treated as authentication; the AI sees the report and text extraction, not image pixels, and may only produce advisory missing-evidence/inconsistency findings. If consent or provider credentials are absent, provider output is explicitly marked unavailable/manual review; submission and NGO review continue. No AI result can approve completion or close the request.

Only the verified NGO owning the request can decide an active completion submission. Transitions include `submitted_for_review → completed` (explicit NGO approval), `more_evidence_required` (volunteer may add evidence and submit a new proof), `rejected_with_reason` (volunteer may resubmit), and `flagged_for_manual_review` (admin records a review outcome and returns it to the NGO). Assignment and request statuses use conditional updates with conflict compensation and actor/time/reason histories; private evidence views and downloads are audited without contents. Approval is blocked when the volunteer-reported follow-up remains unresolved unless the reviewer explicitly confirms its resolution. A request is never closed by volunteer or AI action.

Completion notifications are in-app database records only. Evidence stays in the existing private filesystem adapter; configure a persistent private volume in production. No antivirus scanning, external object-store retention/deletion policy, automated evidence expiry, or email/SMS/push delivery is configured.

Before acceptance, exact addresses, coordinates, descriptions, names, and contact details are withheld from volunteers. Following acceptance, the server returns only the assigned task's necessary details and only the requester's preferred contact channel to the currently assigned volunteer. The owning verified NGO and admins have their authorized reviewer routes; unrelated volunteers and NGOs are denied. Cancellation/reassignment clears the request's assigned volunteer and blocks private-detail/evidence access for the previous volunteer. In-app notifications carry assignment IDs/status only, not contact details, exact addresses, evidence links, or private documents.

Completion evidence uses private random-key storage through the existing local filesystem adapter. Each file is checked by extension, MIME and basic file signature, and the configured upload byte/file limits apply. The report and evidence are retained for human NGO review. Volunteers cannot mark a request completed; only an authorized owning NGO's explicit approval closes it. External object storage, signed URLs, antivirus scanning, background expiry workers, and email/SMS/push providers are not configured.

Uploads accept JPEG, PNG, WebP, and PDF with configurable limits (`UPLOAD_MAX_BYTES`, default 5 MiB; `UPLOAD_MAX_FILES`, default 5). Files are stored under a private local directory and accessed only by the requester or the verified NGO specifically assigned to the request. The service checks extension, declared MIME type, and basic file signatures. There is no virus scanner, object-store signed URL support, or automatic retention/deletion policy yet. Ensure the private filesystem is not web-served and use a persistent protected volume in deployment.

OCR uses Google Cloud Vision when `GOOGLE_VISION_API_KEY` and `REQUEST_DATA_ENCRYPTION_KEY` are set; image OCR supports JPEG/PNG/WebP only. The encryption key must encode 32 random bytes as 64 hex characters or standard base64. Extracted text is stored using AES-256-GCM and is not included in ordinary API responses. AI-assisted screening uses the OpenAI API when `OPENAI_API_KEY` is set (`OPENAI_MODEL` defaults to `gpt-4o-mini`). With consent, image bytes may be sent to Google and request details/OCR text to OpenAI; exact address and city are excluded from AI input. Any model-reported confidence is an uncalibrated estimate, not a probability used for a decision. Missing credentials/provider failures are explicitly returned as unavailable/failed; requests remain eligible for human review and are not auto-rejected or auto-approved. OCR extracts text, not authenticity.

Money donations using Razorpay test-mode orders are implemented. Physical-item donations, inventory, receipt downloads, NGO registration-document upload, external email/SMS delivery, audit-log query APIs, and interactive maps are not implemented yet.
