# ImpactMatchNGO implementation audit

## Scope and evidence

This is a source review of the current workspace, not a claim that the application has been run successfully. Feature status describes code presence and observed wiring; **runtime behavior remains unverified unless explicitly stated**. Test files are evidence that checks are authored, not that they passed.

The workspace has root npm workspaces for `client/` and `server/`, plus `e2e/` and `scripts/`. The supplied architecture diagram and visual design board were not present as workspace files during inspection. The project is not configured with a lint script or lint tool.

## Status summary

| Area | Status | Evidence and limitations |
|---|---|---|
| React/TypeScript/Vite frontend | Implemented; runtime unverified | Client source, route tree and query/API wiring are in [App.tsx](../client/src/App.tsx) and [api.ts](../client/src/api.ts); package scripts are in [client/package.json](../client/package.json). Visual fidelity and responsive behavior have not been browser-verified here. |
| Express/TypeScript API | Implemented; runtime unverified | Middleware and application setup: [app.ts](../server/src/app.ts); business routes: [routes.ts](../server/src/routes.ts); runtime entry: [index.ts](../server/src/index.ts). |
| MongoDB schemas and indexes | Partial | [models.ts](../server/src/models.ts) defines users, needs, contributions, help-request/document metadata, assignment/completion proof, item offers, notifications, and audit logs. These workflow models do not yet have feature routes or workers. |
| Authentication and profiles | Implemented; runtime unverified | Register/login/logout/me/profile endpoints in [routes.ts](../server/src/routes.ts); bcrypt hashing and Mongo-backed session setup in [app.ts](../server/src/app.ts). Existing tests are in [app.test.ts](../server/src/app.test.ts), but execution is unverified. |
| Session authorization and role checks | Implemented; runtime unverified | `requireAuth` / `requireRole` live in [authorization.ts](../server/src/middleware/authorization.ts); protected route declarations are in [routes.ts](../server/src/routes.ts). A reusable owner-check middleware exists for future private-resource routes. Broad role/ownership coverage remains incomplete. |
| NGO registration and review | Partial | NGO accounts and admin approve/reject routes exist in [routes.ts](../server/src/routes.ts). Admin status changes are recorded by [auditService.ts](../server/src/services/auditService.ts), but the update and log insert are not atomic on standalone MongoDB. No document upload, independent evidence workflow, appeals, or notifications exist. Public listing selects verified organizations and excludes private contact fields. |
| Opportunity discovery and publishing | Implemented; runtime unverified | Search/list, NGO-owned creation, volunteer fulfillment, capacity checks, and public NGO detail routes are in [routes.ts](../server/src/routes.ts). Volunteer fulfillment is a commitment record, not a moderated application/assignment/completion workflow. |
| Explainable volunteer matching | Implemented; runtime unverified | [matching.ts](../server/src/matching.ts) applies documented city/cause/term weights to profile and opportunity text. The authenticated endpoint is `/api/volunteer/recommendations`; this is deterministic matching, not AI or an external provider. Unit tests are in [matching.test.ts](../server/src/matching.test.ts). |
| Donation reservations and settlement | Implemented in source; runtime unverified | Reservation and settlement helpers, Razorpay order/verify routes, raw webhook handling and expiry recovery are in [routes.ts](../server/src/routes.ts). Scenarios are authored in [payments.integration.test.ts](../server/src/payments.integration.test.ts), gated on a dedicated test database. Standalone MongoDB fallback is not cross-document ACID. |
| Physical-item donation and inventory | Schema only | `PhysicalItemDonation` is modeled, but no item/inventory/fulfillment APIs are present. The UI labels these workflows unavailable. |
| Volunteer assignment, completion and hours | Foundation schemas only | Assignment and completion-proof records are modeled, but there is no NGO review/assignment route, completion approval, verified hours, or certificate service. Do not interpret sign-ups as completed hours. |
| Notifications and audit logs | Partial | An append-only audit model records NGO status review events, but coverage is incomplete. A notification schema exists without delivery/read routes; the UI identifies notifications as unavailable. |
| Impact and admin analytics | Partial | `/api/impact/summary`, `/api/admin/overview`, and dashboards aggregate database records in [routes.ts](../server/src/routes.ts). Sign-up counts are not completed volunteer hours; analytics have not been runtime-checked against a populated database. |
| Map and private file storage | Missing/external | Private request-document metadata and an owner-check middleware foundation exist, but no map provider, geospatial search, configured storage, or authorized upload/download routes are operational. Discovery uses city text. |
| AI integration | Missing/external | No external AI provider is configured. The implemented deterministic matching service is not represented as AI. |
| API documentation | Partial | Swagger UI and OpenAPI 3.0.3 definition are configured in [app.ts](../server/src/app.ts). It documents principal routes, not every request/response schema or error. |
| Deployment and environment validation | Partial | Setup and deployment guidance is in [README.md](../README.md), [server/.env.example](../server/.env.example), and [client/.env.example](../client/.env.example). No deployment manifests, external credentials, or production hosting verification are included. |
| Automated checks | Authored; results unverified | Vitest/Supertest tests in `server/src` and `client/src`, and Playwright smoke coverage in [home.spec.ts](../e2e/home.spec.ts). Dependencies could not be installed in the previous sandboxed run; no successful test/build/typecheck result is claimed. |

## Security observations

- Password hashes are excluded from normal selection; session cookies are HTTP-only and sessions use MongoDB storage. Production sets secure cookies and requires an explicit session secret.
- Unsafe API requests now require the configured frontend origin in `Origin` or `Referer`, and reject `Sec-Fetch-Site: cross-site`. The signed Razorpay webhook is mounted before that browser-origin middleware and uses its own signature validation.
- Role checks are enforced at protected routes. The role model is limited to authentication, NGO publishing/review, donor payment creation, and volunteer sign-up/recommendations; it does not implement the broader assignment/task moderation permissions.
- Rate limiting and Zod input validation are configured. This source review is not a penetration test or a substitute for deployment configuration review.
- Payment correctness depends on isolated testing against MongoDB and an actual Razorpay Test Mode account/webhook. Automated refunds are not implemented; late or mismatched captures require operator review.

## Runtime-validation record

The original Windows audit checks are recorded in [WORK_LOG.md](./WORK_LOG.md). A subsequent Phase 2 backend-only `npm run typecheck -w server` also passed. The previously recorded `npm run build` passed; `npm test` did not pass overall (server reported 28 passed and 18 skipped; one client test failed because multiple “Find Opportunities” links matched a singular query). Server tests were collected from both `src` and generated `dist`. `npm run test:e2e` could not launch because the Playwright Chromium headless-shell executable is not installed. No tests or final QA were run in Phase 2. No lint script is configured. MongoDB/payment runtime behavior was not re-exercised in this audit.

The test/build commands use dependencies already present in the workspace; `npm install` was not rerun. Do not interpret authored or skipped tests as runtime verification. See [TESTING.md](./TESTING.md) and [IMPLEMENTATION_ROADMAP.md](./IMPLEMENTATION_ROADMAP.md) for the next steps and required test isolation.

## Prioritized gaps

1. Run install/build/typecheck/unit tests and payment tests against a dedicated replica-set test database; fix all failures.
2. Add workflow integration tests for registration/login/session persistence, NGO review, opportunity ownership, volunteer sign-up limits, and public data privacy.
3. Implement volunteer application review, assignment, completion approval, verified hours, and NGO-facing applicant controls.
4. Add notifications and auditable admin/NGO state changes.
5. Add physical-item donation/inventory and receipt/refund workflows before advertising them as available.
6. Configure private NGO document storage, map/geospatial provider, and optional AI providers with access controls and failure handling.
7. Complete the OpenAPI schemas, validate responsive screens in a browser, and conduct a production security and payment review.
