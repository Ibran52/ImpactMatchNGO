# Environment variables

Copy `server/.env.example` to `server/.env` and `client/.env.example` to `client/.env` as needed. Never commit actual credentials. Example values are placeholders.

## API (`server/.env`)

| Variable | Required | Purpose |
|---|---|---|
| `NODE_ENV` | No; defaults to `development` | `development`, `test`, or `production`. |
| `PORT` | No; defaults to `4000` | API listen port. |
| `MONGODB_URI` | Required in production | MongoDB connection string; the database name is selected in the URI. Use an isolated `_test` database for tests. `MONGODB_DB_NAME` is not read by the application. |
| `SESSION_SECRET` | Required explicitly in production | Random secret of at least 32 characters. Development generates a new random value if omitted, so sessions are lost after restart. |
| `CLIENT_ORIGIN` | Required explicitly in production | Exact browser origin allowed by CORS and unsafe-request origin checks. |
| `API_ORIGIN` | Required explicitly in production | Public API origin used in OpenAPI server metadata. |
| `RAZORPAY_KEY_ID` | Optional | Razorpay Test Mode key ID; must start with `rzp_test_`. |
| `RAZORPAY_KEY_SECRET` | Paired with key ID | Razorpay Test Mode API secret. Server only. |
| `RAZORPAY_WEBHOOK_SECRET` | Required when payments are enabled | Razorpay webhook signature secret. Server only. |
| `ADMIN_EMAIL` | Optional | Bootstrap administrator email. |
| `ADMIN_PASSWORD` | Optional | Bootstrap password; at least 12 characters. Avoid reusing a production account credential. |
| `PAYMENT_TEST_MONGODB_URI` | Test runner only | Opts into payment integration tests; database name must end in `test`. Never set to production. |

The server parser and production checks are in [server/src/config.ts](../server/src/config.ts). Payment keys must be configured together; live keys are rejected. The checked-in `server/.env.example` contains placeholders only. If any earlier copy of that example was used as a real credential source, rotate those credentials.

## Frontend (`client/.env`)

| Variable | Purpose |
|---|---|
| `VITE_API_BASE_URL` | Browser-visible API URL ending with `/api`; preferred variable. |
| `VITE_API_URL` | Legacy fallback API URL; `VITE_API_BASE_URL` takes precedence. |

All Vite-prefixed variables are bundled into browser code. Do not place session secrets, MongoDB credentials, Razorpay secret keys, webhook secrets, or admin passwords in frontend variables.

## Planned providers (not yet implemented)

The following optional names are documented in `server/.env.example` for future adapter configuration but are **not parsed or consumed by the running application**. Setting them does not enable an integration:

| Variable | Intended future use |
|---|---|
| `STORAGE_ENDPOINT`, `STORAGE_BUCKET`, `STORAGE_CREDENTIALS` | Private object storage. Requires private access controls and server-authorized download/upload URLs. |
| `OCR_PROVIDER`, `OCR_API_KEY` | OCR extraction behind a server-side provider adapter. |
| `AI_PROVIDER`, `AI_API_KEY` | Advisory verification only; decisions remain with a human reviewer. |
| `NOTIFICATION_PROVIDER`, `NOTIFICATION_CREDENTIALS` | Notification delivery and retry handling. |

Maps/geocoding, email, item inventory, and automated refunds do not have configured adapters or environment variables yet. Never use `VITE_*` variables for server credentials.
