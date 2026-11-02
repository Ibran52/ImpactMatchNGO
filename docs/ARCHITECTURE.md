# Architecture

## Current system

```text
Browser
  React + TypeScript + Vite
  React Router + TanStack Query + Axios
       | session cookie / JSON API
       v
Express + TypeScript API
  Helmet / CORS / rate limits / origin checks / Zod validation
  auth + role checks + opportunity, impact, and payment routes
       | Mongoose
       v
MongoDB: users, needs, contributions, sessions
       |
       +---- Razorpay Test Mode (optional; server credentials only)
```

The frontend is in `client/`; the API is in `server/`; browser smoke tests are in `e2e/`; development process orchestration is in `scripts/`. Root npm workspaces and scripts are defined by [package.json](../package.json). The supplied architecture diagram was not available as a workspace file, so this diagram reflects inspected implementation, not a claim about a supplied reference image.

## Existing boundaries

- Express app/middleware and readiness endpoint: [server/src/app.ts](../server/src/app.ts).
- Route validation, role checks and workflows: [server/src/routes.ts](../server/src/routes.ts).
- Mongoose schemas and indexes: [server/src/models.ts](../server/src/models.ts).
- Environment parsing and production/payment guards: [server/src/config.ts](../server/src/config.ts).
- Frontend routes, dashboards and API-driven UI: [client/src/App.tsx](../client/src/App.tsx) and [client/src/api.ts](../client/src/api.ts).
- Explainable local matching: [server/src/matching.ts](../server/src/matching.ts).

The matching score is a transparent heuristic: same city adds 35 points, matching cause terms add 40, and shared profile/opportunity terms add up to 25. This is not a trained model or third-party AI result.

## Data and trust boundaries

The server is authoritative for account role, NGO verification status, campaign goal capacity, payment order amounts, payment-provider verification, and impact totals. The client supplies identifiers and user choices, but not a trusted successful-payment result or final fundraising total. Razorpay secrets are server-only. Browser sessions are cookie-backed and stored in MongoDB.

The current data model includes `User`, `Need`, and `Contribution`; it does not yet include separate application/assignment, uploaded document, item inventory, receipt, notification, or audit event aggregates. See [IMPLEMENTATION_AUDIT.md](./IMPLEMENTATION_AUDIT.md) for precise status and gaps.

## Payments and database deployment

Replica-set or sharded MongoDB is required for MongoDB multi-document transactions. The implementation uses transactions when supported. Standalone MongoDB uses a single-campaign-document atomic reservation and conditional/retryable contribution settlement; this is a recoverable saga-style fallback, not cross-document ACID. See [DONATIONS.md](./DONATIONS.md).

## Optional integrations not implemented

There are no configured map/geocoding, private-file-storage, external AI, notification-delivery, or item-inventory providers. The volunteer recommendation service is deterministic and explainable; it must not be described as AI. Razorpay operates only when Test Mode credentials are configured.
