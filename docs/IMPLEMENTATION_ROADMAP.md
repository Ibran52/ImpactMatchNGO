# ImpactMatchNGO implementation roadmap

This roadmap reflects the current implementation through Phase 9 and the partial Phase 10 verification attempt recorded below. It supersedes the earlier MVP audit plan and its statements that request, assignment, item donation, and notification routes did not exist.

## Current architecture

- **Client:** React, TypeScript, Vite, React Router, TanStack Query, React Hook Form, Zod, Lucide, Framer Motion, and the existing responsive design system.
- **API:** Node.js, Express, TypeScript, MongoDB/Mongoose, Zod validation, Mongo-backed HTTP-only sessions, Helmet, origin checks, and rate limiting.
- **Persistence:** Existing `User`, `Need`, `Contribution`, `HelpRequest`, assignment, proof, item-donation, notification, and audit models. No parallel workflow models were added for the same concepts.
- **External integrations:** Razorpay Test Mode, Google Vision OCR, and OpenAI AI review are optional server-side adapters. Their configuration does not prove provider health. Private evidence currently uses the local filesystem adapter.

## Workflow status and authority

### Help requests

`submitted → screening → pending_ngo_review → under_review → approved → matching_volunteer → assigned → in_progress → pending_completion_review → completed`

Additional-information, screening-unavailable, decline, reassignment, dispute, and manual-review states are represented by their request/assignment status branches. The help seeker owns submission and resubmission; a selected verified NGO reviews and approves the request; an eligible volunteer accepts an atomic offer and may submit private completion evidence; only the owning verified NGO can approve evidence and close the request. AI/OCR is advisory and does not decide eligibility or closure.

### Money donations

Verified active NGO campaign → server-created Razorpay Test Mode order and capacity reservation → Checkout → server-side callback verification and/or raw-body signed webhook → idempotent settlement → confirmed contribution and reference.

Only confirmed contributions affect fundraising totals. The donor can read their own status and confirmation; the owning NGO can see campaign contribution records; administrators can inspect paginated status summaries. Refund-required cases need operator follow-up; automated refunds are not implemented. Confirmation documents are not tax receipts.

### Physical items and pickups

`submitted → pending_ngo_review → accepted → awaiting_pickup_assignment → pickup_assigned → pickup_in_progress → picked_up → delivered_or_received → completed`

Other supported states include rejection, needs-information, cancellation, pickup failure, and dispute. Donors submit and view their own item records; the owning verified NGO reviews/accepts and explicitly confirms receipt; an eligible volunteer accepts a single-winner pickup offer, receives private pickup details only after acceptance, and submits private evidence. NGO acceptance alone never marks pickup or receipt complete.

### Notifications and access

In-app notifications persist in MongoDB, are recipient-scoped, paginated, support unread counts and read operations, and return a safe payload allowlist. Email, push, and SMS are unavailable. Sensitive APIs enforce role, owner, organization, and assignment relationships server-side. Account suspension is administrator-controlled, reasoned and audited, ends existing sessions on the next API request, rejects new logins, and is blocked while active volunteer/NGO work remains.

## Role dashboards

- **Help seeker:** request status, attention-needed items, private request detail/timeline, NGO matching, and notification history.
- **Volunteer:** eligible offers, acceptance/progress, assigned task details/evidence, item pickup, activity, profile/preferences, and notifications.
- **NGO:** routed requests and volunteer assignments, completion-review inbox, verification profile, monetary contributions, item donation/pickup inbox, and notifications.
- **Donor:** confirmed money history/receipts, physical-item history/status, profile, and notifications.
- **Administrator:** NGO verification, volunteer eligibility, non-admin account status, completion escalations, payment status, audit history, case counts, and integration configuration indicators.

Dashboard figures are sourced from database-backed APIs. Operational integration displays distinguish current MongoDB readiness from provider runtime results. The 2026-10-30 isolated QA run found malformed legacy GeoJSON prevents MongoDB 2dsphere index creation; NGO and volunteer matching warn and fall back to city/service-area candidates without coordinates only when MongoDB reports a missing geo index. Coordinate candidates still use distance/radius checks; unrelated Mongo errors propagate. Runtime geospatial index health is not otherwise monitored.

## Configuration and known limitations

- Razorpay requires server-only `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and `RAZORPAY_WEBHOOK_SECRET` in Test Mode. Browser and webhook deliveries have not been independently verified in this phase.
- OCR requires `GOOGLE_VISION_API_KEY` and `REQUEST_DATA_ENCRYPTION_KEY`; AI screening requires `OPENAI_API_KEY`. Missing credentials leave requests eligible for human review.
- Private storage uses `PRIVATE_STORAGE_DIR` and shared upload limits. Production requires a protected persistent volume or a separately implemented private object-storage adapter. Malware scanning and a defined retention/deletion worker are absent.
- MongoDB transaction behavior requires replica-set/sharded deployment. Donation settlement has a conditional standalone fallback; physical pickup multi-document consistency uses conditional updates and compensating cleanup rather than a cross-document transaction.
- Item pickup matching is application-side filtering and distance calculation with city/service-area fallback, not a MongoDB geospatial query. Item offer expiry is not automated.
- Payment cases marked `refund_required` have an admin status overview but no automated refund or provider reconciliation workflow.
- Audit and notification delivery are stored in MongoDB. External email/push/SMS delivery is not implemented.
- Item donation dispute counts are visible to admins, but a dedicated dispute-resolution workflow and administrator private item-evidence detail screen remain unimplemented.
- Admin operations lists disputed/refund case counts and provides a money donation-state table. The dashboard does not claim successful live OCR, AI, storage, Razorpay, email, push, SMS, or geospatial provider health.
- No tests, builds, live API flows, providers, or MongoDB checks were run for Phase 9. Comprehensive verification is intentionally deferred.

## Phase 10 — Verification status (2026-08-09)

1. **Passed:** server/client TypeScript checks and production builds. Vite emitted non-fatal dependency-comment and large-chunk warnings; no compiler/build errors remain.
2. **Passed:** ordinary unit tests (14 server, 2 client), the isolated MongoDB-backed server suite (23 server tests, including 9 payment tests using a mocked Razorpay provider), and one API-stubbed Playwright smoke test.
3. **Partially verified:** a live local API connected to a dedicated test MongoDB and passed readiness, registration, login/logout, session persistence, donor-to-admin authorization denial, and the explicit Razorpay-unconfigured response. The database is isolated; test data was retained and no destructive database command was run.
4. **Not verified end to end:** NGO verification decisions, private help-request documents, matching/assignment/completion, physical-item pickup/receipt, and the full authenticated browser/viewport matrix.
5. **Not live-verified:** Razorpay, OCR/AI, external storage, email/SMS/push, and deployment configuration. Payment tests mock the provider and do not establish its operational health.
6. The prior static review documented a MEDIUM credential-template finding in `server/.env.example`; the example was sanitized. Rotation, repository history, and deployed secrets remain unverified.
7. Detailed results, commands, test database names, required environment variables, and blockers are in [FINAL_QA_REPORT.md](./FINAL_QA_REPORT.md).

**Phase 10 acceptance:** partial. The build and available test gates pass, but the release recommendation remains **not ready** until the remaining business workflows and deployment integrations are verified.

## Phase 11 — Role onboarding and verification integration (2026-10-30)

**Audit findings before changes:** role-specific workspaces and API authorization already exist for help seekers, volunteers, NGOs, donors, and administrators. NGO verification and volunteer eligibility decisions already have admin-protected routes and audit events. Request documents and completion evidence use private storage and relationship-checked downloads. Identified gaps: registration routes used a generic role selector rather than separate user/volunteer/NGO entry forms; volunteer registration did not collect matching preferences; NGO registration had no representative fields or private verification-document upload; volunteer applicants could not view/resubmit verification state; administrators could not inspect applicant documents because no verification-document model/route existed; and the volunteer dashboard did not summarize task assignment status from the assignment API.

**Implementation:** separate help-seeker, volunteer, NGO, and donor registration paths are connected to the existing auth API. Volunteer matching profile and NGO representative fields are persisted. Applicants can read their own status/history, upload role-appropriate private documents, and resubmit eligible applications. Admins can inspect private documents through an authorization-checked and audited download route; review decisions now retain reviewer/time/history. Volunteer and NGO dashboard counts include database-backed task/request states.

**Verification:** VS Code task runner completed `npm run typecheck` and `npm run build` successfully for both workspaces. Server tests passed (17; 9 payment integration tests skipped without an isolated test database URI); client tests passed (3). Vite emitted non-fatal dependency annotation and large-chunk warnings. Editor diagnostics reported no errors. Live MongoDB, provider integrations, and browser E2E were not run for this implementation segment. See the latest entry in [WORK_LOG.md](./WORK_LOG.md).

## Phase 12 — Integration QA rerun (2026-10-30)

- **Passed:** server/client typecheck, production build, 17 non-payment server tests, 3 client tests, and 1 API-stubbed Playwright smoke test.
- **Skipped:** 9 payment integration tests because an isolated `PAYMENT_TEST_MONGODB_URI` was not configured. No MongoDB workflow tests ran.
- **Blocked/not run:** live `/api/health` returned browser `ERR_FAILED`; authenticated database workflows, registration/session persistence, role/ownership API boundaries, verification review, request/document handling, matching/assignment/completion, payment persistence, and authenticated browser E2E remain unverified.
- **Bug fixed:** session hydration now includes the stored volunteer eligibility/preferences and NGO representative fields returned at signup/login. No type errors or editor diagnostics remained.
- **Release status:** partial verification only; the passing browser test mocks the API and is not a full-stack E2E result. See [FINAL_QA_REPORT.md](./FINAL_QA_REPORT.md).

## Phase 13 — Live integration QA continuation (2026-10-30)

- **Passed:** typecheck, production build, combined unit suites (19 server and 4 client tests), live health/MongoDB readiness, help-seeker request creation and owner document access, NGO and volunteer registration/review/approval, volunteer pending-eligibility restriction, verified NGO opportunity creation, volunteer opportunity sign-up, UI login, notification read/unread update, volunteer profile persistence after page reload, and a non-admin `403` on an admin API.
- **Fixed during live use:** optional request-screening subdocument validation; notification route registration scope; login form validation incorrectly requiring volunteer registration fields. Added model, API-route, and client login regression tests.
- **Not completed:** NGO request routing/review, assignment offers and atomic concurrent acceptance, private assigned-volunteer details, completion evidence/resubmission/closure, cross-owner access attempts, profile/notification read-state updates, item donation and pickup, payment persistence/webhooks, mobile matrix, and provider integrations. Opportunity sign-up did not exercise assignment acceptance.
- **Skipped:** 9 payment integration tests because a separate payment-test URI was not supplied. No Razorpay, OCR/AI, external storage, email, SMS, or push provider was called.
- **Acceptance:** partial, not complete E2E certification. The isolated test database and synthetic records are retained. Current evidence and prioritized next steps are in [FINAL_QA_REPORT.md](./FINAL_QA_REPORT.md).

## Phase 16 — Provider runtime audit and registration/matching recovery (2026-10-30)

- **Provider checks:** Google Vision credentials were detected; synthetic upload returned 201 and screening returned 200 while the provider returned 403. OpenAI credentials/model were detected; the screening endpoint returned 200 while the provider returned 429. Both report runtime errors with safe reasons, not verified. Local private storage create/read/delete passed; owner file retrieval returned 200 and anonymous retrieval returned 401. In-app notification list/read/unread persistence passed.
- **Unavailable integrations:** Razorpay test credentials were absent and no payment was attempted. Email, push, and SMS adapters/providers were unavailable. No geocoding provider was configured. Operations status returned 200 and reflected these outcomes; in-process verification states reset on backend restart.
- **Fixes:** NGO registration validates only visible account fields for its step transition and performs full profile validation on final submit. Volunteer matching returns typed user records without an invalid Mongoose conversion, falls back conservatively on Mongo missing-index code 291, and shares tested Haversine/radius filtering.
- **Verification:** typecheck and build **PASS**; `npm test` **PASS** (39 server tests, 5 client tests; 9 payment tests skipped); focused provider/location/matching tests **PASS** (20).
- **Still incomplete:** full authenticated Playwright against real APIs from registration to NGO closure, NGO approval, eligible volunteer assignment/concurrent acceptance, evidence resubmission, and closure remain **BLOCKED / NOT RUN**. The browser tool exposed only an admin page, and the sandbox rejected isolated context creation; no credentials or session tokens were requested. No real payment or production data was used.
- See [FINAL_QA_REPORT.md](./FINAL_QA_REPORT.md) for exact endpoint/provider results and remaining gates.
