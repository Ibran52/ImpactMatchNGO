# Deployment

## Supported shape

- Build and deploy `client/` to Vercel or another static frontend host.
- Run `server/` as a Node.js service on a Node 20.19+ or 22.12+ host.
- Use MongoDB Atlas or another managed MongoDB service. Use a replica set for transaction-backed campaign payment operations.

No hosting manifests or provider-specific deployment pipeline are included. The following is deployment guidance, not evidence that a deployment has been completed.

## Build and start

From PowerShell at the workspace root:

```powershell
npm install
npm run build
npm run start -w server
```

Set the frontend `VITE_API_BASE_URL` to the deployed API base ending in `/api` at frontend build time. Configure server variables using [ENVIRONMENT_VARIABLES.md](./ENVIRONMENT_VARIABLES.md). Keep the frontend and API on HTTPS and configure the exact frontend origin as `CLIENT_ORIGIN`.

## Production checklist

1. Set `NODE_ENV=production`, `MONGODB_URI`, a random `SESSION_SECRET` with at least 32 characters, `CLIENT_ORIGIN`, `API_ORIGIN`, and `PORT`.
2. Configure TLS, a correct trusted proxy, production CORS, database network allow-listing, backups, monitoring, and log retention.
3. Use a dedicated Razorpay Test Mode account until payment logic, webhook retries, reconciliation, and refund operations have been reviewed. The current server explicitly rejects live-mode keys.
4. Do not configure production demo seed data. Demo opportunity seeding only runs in development.
5. Verify `/api/health` returns 200 after MongoDB connection; it returns 503 while disconnected.
6. Run build/typecheck/tests using a dedicated test database before deployment. Never point tests at production.
7. Test session persistence, secure cookies, account roles, NGO privacy, campaign reservations, webhooks, browser/webhook races, and recovery with the actual deployed origin.
8. Configure alerting and an operator procedure for `refund_required` contributions. Automated refund handling is not implemented.

Detailed functional and security gaps are listed in [IMPLEMENTATION_AUDIT.md](./IMPLEMENTATION_AUDIT.md) and [SECURITY.md](./SECURITY.md).
