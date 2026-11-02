# Security notes

This document records implemented controls and known gaps from a source review. It is not a penetration-test report or production certification.

## Implemented controls

- Passwords are bcrypt-hashed; password hashes are excluded from ordinary user selection. Authentication and profile routes are in [server/src/routes.ts](../server/src/routes.ts).
- Sessions use `express-session` and Mongo-backed storage. Cookies are HTTP-only; production cookies are secure and `SameSite=None`. Production configuration requires an explicit `SESSION_SECRET` (minimum 32 characters) in [server/src/config.ts](../server/src/config.ts).
- Unsafe API requests require an `Origin` or `Referer` matching `CLIENT_ORIGIN`, and reject `Sec-Fetch-Site: cross-site`. Razorpay webhook handling is mounted before this browser request middleware and is instead authenticated with the provider webhook signature.
- Helmet, CORS allow-listing, general API rate limiting, and stricter login/registration limits are configured in [server/src/app.ts](../server/src/app.ts).
- Zod schemas validate authentication, profile, opportunity, and payment inputs. Server routes enforce role checks; NGO dashboards query only needs belonging to the signed-in organization.
- Public NGO endpoints return verified organizations and omit public email addresses.
- Razorpay is restricted to `rzp_test_` keys. Amount/order/currency/captured status are checked server-side; the client cannot declare payment success.

## Residual risks and required review

- Test the origin policy in a browser deployment with the actual frontend/API origins. Do not weaken it to allow missing origins for browser state-changing requests.
- `SameSite=None` production cookies require HTTPS. Deploy behind a correctly configured trusted proxy and use a strict CORS origin.
- Session secret rotation, account recovery, email verification, MFA, and session revocation controls are not implemented.
- Rate limiting is process-local unless backed by a shared store; horizontally scaled production needs a shared limiter store.
- NGO verification currently reviews submitted profile fields only; there is no secure document upload or verification evidence workflow.
- There is no append-only admin audit trail, notification system, item-inventory authorization model, or task assignment/completion authorization flow.
- Late/mismatched payment captures require human refund review. Automatic refunds, reconciliation jobs, and a production payment review are outstanding.
- Review dependency advisories and run tests/deployment checks before production. Never use a production database for tests.

## Secret handling

Keep server `.env` files out of source control. Razorpay key secret, webhook secret, MongoDB credentials, administrator bootstrap password, and session secret must stay on the API host. The Vite `VITE_*` environment is browser-visible and must never contain server credentials. See [ENVIRONMENT_VARIABLES.md](./ENVIRONMENT_VARIABLES.md).
