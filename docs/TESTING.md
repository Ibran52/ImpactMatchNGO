# Testing and local validation

## Prerequisites

- Node.js 20.19+ or 22.12+, npm, and dependencies installed from the root workspace.
- MongoDB for runtime/API and payment integration testing. Use only a dedicated test database.
- Razorpay Test Mode account/webhook only for manual provider integration checks.

## Windows PowerShell commands

From the repository root:

```powershell
Copy-Item server\.env.example server\.env
# Edit server\.env with local settings. Set the test URI only for payment integration tests.
npm install
npm run build
npm run typecheck
npm test
npm run test:e2e
```

The root `test` runs server and client Vitest suites. `test:e2e` runs Playwright. No lint script or linter is configured in the package manifests. Root and workspace scripts are defined in [package.json](../package.json), [server/package.json](../server/package.json), and [client/package.json](../client/package.json).

## Test coverage and gates

- API route/middleware tests: [server/src/app.test.ts](../server/src/app.test.ts), using an in-memory session store. Mongo-backed workflows are not covered by this file.
- Matching tests: [server/src/matching.test.ts](../server/src/matching.test.ts).
- Payment integration tests: [server/src/payments.integration.test.ts](../server/src/payments.integration.test.ts). Set `$env:PAYMENT_TEST_MONGODB_URI = "mongodb://127.0.0.1:27017/impact_match_payment_test"` only when that database is isolated and disposable. The suite inserts unique rows and does not clear collections. A standalone server exercises the fallback; a replica set exercises transactions.
- Frontend tests: [client/src/App.test.tsx](../client/src/App.test.tsx).
- Browser smoke test: [e2e/home.spec.ts](../e2e/home.spec.ts); it stubs API responses and does not verify a real database or payment provider.

## Phase 10 attempt (2026-10-30)

- Attempted `npm run typecheck; npm run build; npm test`; the sandbox prevented the shell command from starting because local-network access is disabled. None of those npm commands executed, so no current Phase 10 build, typecheck, or automated test result is available.
- `npm run test:e2e` was not executed. VS Code test discovery found no runnable/matching test at discovery time; that is not a test result. Existing test files remain as listed above.
- No lint command is configured. No dependency installation was attempted; the workspace already contained `node_modules` and a root lockfile, and network-backed installation was unavailable.
- Browser inspection of the homepage at 1440×900, 768×1024, 390×844, and 320×700 found no measured horizontal overflow and confirmed the hero image loaded. API requests and direct navigation to `/api/health` failed with `ERR_CONNECTION_REFUSED`; backend/API workflows were not testable.
- See [FINAL_QA_REPORT.md](./FINAL_QA_REPORT.md) for the complete Phase 10 record and release recommendation.

## Phase 12 integration QA rerun (2026-10-30)

- `npm run typecheck`: **PASS**, server and client.
- `npm run build`: **PASS**, server and client. Vite emitted non-fatal Zod annotation and large-bundle warnings.
- `npm test`: the first run **FAILED before tests** because the server environment's `ADMIN_PASSWORD` did not meet the minimum length in server configuration. Re-run through a temporary Node wrapper (`node .qa-runner.cjs test`) with a process-only override: **PASS**, 17 server tests and 3 client tests. The 9 payment integration tests were **SKIPPED** because `PAYMENT_TEST_MONGODB_URI` was not set. `dotenv` loaded the local environment implicitly; its contents were not inspected, recorded, or modified.
- `npm run test:e2e`: **PASS**, 1 Playwright browser smoke test. `e2e/home.spec.ts` intercepts/stubs API responses; this is frontend-only and does not verify backend integration.
- Browser check: `/register` rendered its role-selection UI. Homepage impact metrics stayed in a loading state. Direct navigation to `http://localhost:4000/api/health` returned `ERR_FAILED`; backend and MongoDB workflows are **BLOCKED / NOT RUN** in this run.
- A follow-up local MongoDB port probe after the user confirmed local access was available was still rejected by the sandbox, which reported that local-network access remained disabled.
- Fixed the session-hydrated `req.user` projection to include saved volunteer eligibility, matching preferences, and NGO representative fields. Typecheck/build and VS Code Problems completed without diagnostics after the change.
- No dependency installation, lint command (none is configured), MongoDB access, provider call, or destructive database operation was performed. A PowerShell launch was blocked by disabled local-network access in the sandbox.
- This section supersedes the earlier Phase 10 attempt above for the checks rerun here. See [FINAL_QA_REPORT.md](./FINAL_QA_REPORT.md) for exact evidence and remaining gaps.

## Historical workspace results (2026-10-29; not rerun in Phase 10)

Recorded 2026-10-29 in [WORK_LOG.md](./WORK_LOG.md); these are historical and are not current Phase 10 results:

- `npm run build`: passed; server TypeScript and client TypeScript/Vite builds completed with dependency-annotation and large-chunk warnings.
- `npm run typecheck`: passed for server and client.
- `npm test`: failed overall. Server tests reported 28 passed and 18 skipped; payment integration tests were skipped because `PAYMENT_TEST_MONGODB_URI` was not configured. Generated `server/dist` test copies were also discovered. The client suite had one passing test and one failing test because the home page contains multiple links named “Find Opportunities”.
- `npm run test:e2e`: could not launch because the Playwright Chromium headless-shell browser is missing.

Authored or skipped test cases do not count as passing. Install the matching Playwright browser and configure only a dedicated test MongoDB before retrying. Do not use production credentials or data.

## Phase 13 live integration QA continuation (2026-10-30)

This phase supersedes the earlier Phase 12 statement that no backend/database workflow had run. A real Express server was started with a dedicated database, `impactmatch_e2e_20261030_0241_test`, test-only credentials, and provider credentials disabled. The database and synthetic records were retained; no production data or destructive database operation was used.

### Commands executed

| Command | Result |
|---|---|
| `npm run typecheck` | **PASS** — server and client. |
| `npm run build` | **PASS** — server and client. Vite emitted existing dependency-comment and large-bundle warnings. |
| `cmd.exe /c "set ADMIN_PASSWORD=<throwaway test-only value>&& npm test"` | **PASS** — 19 server tests and 4 client tests passed; 9 payment integration tests skipped because `PAYMENT_TEST_MONGODB_URI` was not configured. |
| `npm run test --workspace=@impact-match/client` | **PASS** — 4 tests, including the login-submit regression test. |
| `npm run test:e2e` | **NOT RUN in this phase.** The previously recorded single Playwright smoke test stubs API responses and is not full-stack evidence. |
| `npm install` | **NOT RUN** — dependencies were already present and no dependency manifest changed. |
| `npm run lint` | **UNAVAILABLE** — no lint script is configured. |

### Live application scenarios

- **PASS:** Browser `fetch` to `GET /api/health` returned HTTP 200 and reported MongoDB `connected`.
- **PASS:** User registration/login and a synthetic food help request with location, urgency, and a private synthetic PDF. `POST /api/requests` returned 201; the request appeared in the owner's UI and the owner could access the private document. Optional screening returned unavailable because no AI provider was configured.
- **PASS:** NGO registration, private verification document upload, admin review, and approval through the actual UI. Admin login worked through the UI after the login-validation fix.
- **PASS:** Volunteer registration, private verification-document upload, pending eligibility state, and admin approval through the actual UI.
- **PASS:** A second synthetic NGO registered, was approved by admin, and created a volunteer opportunity through its dashboard. An eligible volunteer joined the opportunity through the UI; the NGO's task count and the opportunity's participant count updated.
- **PASS:** `GET /api/volunteer/tasks/available` returned `eligibility: "pending_or_opted_out"` with no offers for a pending test volunteer. After admin approval, the endpoint returned `eligibility: "eligible"`; no volunteer task-assignment offer existed at that point. Public opportunity sign-up is distinct from task assignment.
- **PASS:** From a volunteer session, `GET /api/admin/operations` returned HTTP 403 with a permission error.
- **PASS:** `GET /api/notifications/unread-count` initially returned 404 because route declarations were nested under a contribution handler. The route placement was corrected; subsequent browser requests returned 200 and the UI displayed an unread count.
- **PASS:** Volunteer notification was marked read through the UI; unread count changed from 1 to 0 and the record rendered as read.
- **PASS:** Synthetic volunteer profile biography was updated through the profile form and remained after a full browser-page reload, confirming session hydration and persisted profile state.
- **PASS:** A synthetic admin login through the actual UI navigated to `/admin/dashboard`; a client regression test now verifies the login API is called with submitted credentials.

### Not completed

**NOT RUN:** request-to-NGO routing/review/approval, actual volunteer task offer acceptance, concurrent single-winner assignment, private recipient details for an assigned volunteer, completion evidence, evidence resubmission, NGO completion approval/closure, cross-owner and cross-NGO data access, anonymous private-file access, profile update after a separate new login, physical-item donation/pickup, Razorpay order/webhook/idempotency persistence, mobile viewport pass, and concurrent multi-context browser testing. These gaps prevent calling the application fully E2E verified.

**Provider limitation:** OCR/AI fallback was observed only as unavailable; no Razorpay, OCR, AI, external storage, email, SMS, or push provider was configured or called. Payment integration tests remain skipped without an isolated `PAYMENT_TEST_MONGODB_URI`.

## Phase 14 regression rerun (2026-10-30)

- `npm run typecheck`: **PASS**; `npm run build`: **PASS** for server and client.
- `cmd.exe /c "set ADMIN_PASSWORD=<throwaway test-only value>&& npm test"`: **PASS** — 30 server tests and 5 client tests; 9 payment tests skipped.
- NGO-matching and GeoJSON focused tests: **PASS** — 11 tests. NGO registration confirmation UI regression: **PASS**.
- The live authenticated help-seeker API returned 200 for request listing/detail, but `GET /api/requests/:id/matches` returned 500 in the already-running `node dist/index.js` process. The shared session was a help-seeker, so its `GET /api/volunteer/preferences` response was the expected 403; the reported volunteer 500 was not reproduced.
- The four live verified seed organizations had empty category lists. Seed profiles were updated in development code to include matching categories/service areas; the food seed NGO now serves Thane.
- The backend was not restarted because the current runtime's database could not be tied to the previously documented isolated URI without reading the local `.env`. No new registration or database writes were made. Full-stack authenticated Playwright E2E is **BLOCKED** pending confirmation of the isolated database and restart.
- See [FINAL_QA_REPORT.md](./FINAL_QA_REPORT.md) for exact live observations, current limitations, and follow-up.

See [FINAL_QA_REPORT.md](./FINAL_QA_REPORT.md) for the current status matrix, bugs fixed, and prioritized follow-up.

## Phase 15 live matching and preferences rerun (2026-10-30)

- The rebuilt backend started against the confirmed isolated test database; `GET /api/health` returned 200 / `database: connected`.
- `GET /api/requests/6ae3d2869c7ce32359f1d998/matches` returned 200 for the owning help-seeker and returned the verified food NGO serving Thane. `POST /api/requests/6ae3d2869c7ce32359f1d998/route` returned 200. A read-only MongoDB check confirmed the assigned organization ID persisted and the request remained `pending_ngo_review`.
- MongoDB reported missing `$geoNear` index (code 291); startup then showed that a malformed legacy location prevents building the 2dsphere indexes (code 16755). Startup now warns and continues in degraded mode; matching falls back to category/city/service-area candidates without coordinates only for missing-index errors, avoiding false distance eligibility. No legacy profile data was changed.
- A new synthetic pending volunteer registered through the real API (`POST /api/auth/register` 201). Preferences GET and PATCH returned 200; a fresh GET retained changes. The authenticated `/volunteer/settings` UI loaded and saved preferences, displaying “Task preferences saved.” No API stubs were used.
- `npm run typecheck`: **PASS** (server/client); `npm run build -w server`: **PASS**; focused NGO matching/location tests: **PASS** (13); complete `npm test`: **PASS** (32 server, 5 client; 9 payment tests skipped).
- Verified NGO inbox/review and the rest of assignment/completion are **BLOCKED / NOT RUN** because a verified NGO session is unavailable. Full registration-to-closure Playwright E2E remains **NOT RUN**. See [FINAL_QA_REPORT.md](./FINAL_QA_REPORT.md) for exact workflow status and evidence.

## Phase 16 provider runtime audit and registration/matching regression tests (2026-10-30)

- `npm run typecheck`: **PASS** for server and client.
- `npm run build`: **PASS** for server and client; existing Vite dependency-comment and large-bundle warnings remain.
- `npm test`: **PASS** — 39 server tests passed, 9 payment tests skipped, and 5 client tests passed.
- Focused provider-status, location, NGO-matching, and volunteer-matching tests: **PASS** — 20 tests.
- NGO registration regression: **PASS** after fixing the second-step validation so a complete form can reach review; full profile validation remains on submit.
- Live synthetic OCR: `POST /api/requests/:id/documents` returned 201; `POST /api/requests/:id/screen` returned 200 while Google Vision returned 403. OCR extraction was not verified.
- Live synthetic AI review: screening endpoint returned 200 while OpenAI returned 429. AI remains advisory; the provider check did not authorize a human decision.
- Private storage create/read/delete probe **PASS** for local filesystem storage. Owner file retrieval returned 200; anonymous retrieval returned 401.
- In-app notification list, mark-read, and unread-count checks returned 200; read state persisted and unread count reached 0.
- `GET /api/admin/operations` returned 200 and accurately reported failed OCR/AI provider checks, verified local storage, connected MongoDB, unconfigured Razorpay/geocoding, and unavailable email/push/SMS. Provider runtime state resets on backend restart.
- Razorpay was not configured; no order/payment was created. Email, push, SMS, and geocoding providers were not called.
- Authenticated Playwright against real APIs from registration through request closure: **NOT RUN**. The existing browser smoke test stubs APIs. The browser tool exposed only an admin session at `/user/dashboard`; NGO/volunteer pages were not accessible, and isolated context creation was rejected by the browser sandbox. NGO review, assignment concurrency, completion evidence, and closure therefore remain blocked. No credentials or session tokens were requested.

See [FINAL_QA_REPORT.md](./FINAL_QA_REPORT.md) for exact provider results and remaining workflow blockers.
