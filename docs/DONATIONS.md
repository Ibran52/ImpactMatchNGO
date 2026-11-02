# Monetary donation accounting

## Source of truth

The API owns the amount, goal, reservation, and settled contribution state. A browser payment callback is not proof of success. Order creation requires a signed-in donor or volunteer, validates amount and campaign, reserves available goal capacity, and creates a Razorpay Test Mode order. Browser verification validates the Razorpay payment signature and fetches the payment from Razorpay's server API before settlement. The frontend polls the authenticated server status so webhook-first settlement is reflected.

## Reservation lifecycle

The `Need` document stores `raisedAmount`, `reservedAmount`, and reservation entries with token and expiry. A conditional atomic update reserves only capacity still within the campaign target. Reservations expire after 15 minutes. A sweep releases expired holds and can recover settlement work interrupted between writes.

The installed Razorpay Node SDK's order-create request does not accept `expire_by`, so the provider order itself is not expired by this API. A provider order can remain pending after the server-side reservation is released; a later capture is not credited to the campaign and is flagged for refund review.

Statuses used by donation contributions include `creating`, `pending`, `settling`, `completed`, `failed`, `expired`, and `refund_required`. `completed` is the only state counted in fundraising totals. Duplicate volunteer/payment records are constrained by database indexes.

## Webhook handling

The webhook route consumes raw JSON bytes before the general JSON parser and compares the Razorpay HMAC signature in constant time. Captures are checked against the known order, expected server-side amount and currency, and provider-captured status. Browser and webhook settlement share idempotency state; duplicate callbacks must not increment campaign totals twice. An event for an order not yet persisted is retryable (503), not treated as a successful no-op. Delayed or mismatched captures that cannot safely be credited are flagged for refund review. Duplicate, unknown, and out-of-order deliveries must not be assumed to have been exercised unless the integration tests actually ran.

## MongoDB consistency

With replica-set/sharded MongoDB, reservation+contribution creation and settlement use transactions. On standalone MongoDB, the campaign reservation is atomic within its campaign document and contribution settlement is guarded by conditional state transitions and recovery. This fallback is not cross-document ACID; production should use a replica set. See reservation, release, settlement, webhook, and recovery code in [server/src/routes.ts](../server/src/routes.ts) and sweep startup in [server/src/index.ts](../server/src/index.ts).

## Confirmations and refunds

Only `completed` contributions contribute to campaign totals. The authenticated order-status route reports the donor's current order state; the contribution receipt endpoint returns a unique confirmation reference for completed payments. Receipt wording is informational and explicitly does not claim tax deductibility. Public campaign statistics are based on confirmed database records; capacity shown for active campaigns subtracts active payment reservations.

Captured payments that cannot be safely credited become `refund_required`. This state is surfaced for follow-up, but automated Razorpay refunds and an administrator refund workflow are not implemented. Do not describe a refund as complete without provider confirmation. The installed Razorpay SDK order-create request has no `expire_by`; the 15-minute server-side reservation expiry does not expire the provider order itself.

## Physical-item donation and pickup

Users submit a selected verified NGO, category, item details, quantity/condition, pickup window, location, contact preference, special handling notes, private photos, and explicit consent to share necessary pickup details. The server validates the NGO, form fields, upload extension/MIME/signature/size, and ownership. Private files use `PRIVATE_STORAGE_DIR` and shared `UPLOAD_MAX_BYTES`/`UPLOAD_MAX_FILES`; APIs return metadata only, never storage keys or permanent public URLs.

The lifecycle is `submitted → pending_ngo_review → accepted → awaiting_pickup_assignment → pickup_assigned → pickup_in_progress → picked_up → delivered_or_received → completed`. Alternate states include `rejected`, `needs_information`, `cancelled`, `pickup_failed`, and `disputed`. NGO acceptance is not proof of pickup or receipt. Donors can resubmit when information is requested or cancel before a pickup is claimed. Verified owning NGO staff can review, offer/reassign a pickup, and explicitly confirm receipt after volunteer submission.

Pickup offers are limited to active/admin-eligible, opted-in volunteers with matching item categories, availability/capacity, and service-area eligibility. Distance is only included when calculable; otherwise city/service-area matching is used without inventing a distance. An atomic conditional donation claim allows one volunteer to accept a single-volunteer pickup; assignment capacity is reserved and compensated on detected conflicts. Exact pickup location and contact preference are returned only to the donor, owning verified NGO, or current assigned volunteer after acceptance. Other volunteers and unrelated NGOs do not receive those fields.

Pickup evidence is privately stored and downloadable only after relationship/role authorization; access and status changes are audited without logging evidence contents. The volunteer submits a report and photo; the owning NGO must confirm receipt before the item is completed and receives a confirmation reference. The reference is not a tax receipt.

Item pickup consistency uses conditional document updates and compensating cleanup, not a transaction spanning the donation, assignment, and volunteer account. Offer expiry is not currently automated. Item matching uses application-side eligible-volunteer filtering and distance/service-area fallback, not MongoDB geospatial indexing. The private filesystem adapter requires a protected persistent production volume; external object storage, malware scanning, SMS/email/push delivery, and automatic refunds are not configured.

## Tests and operational gaps

[payments.integration.test.ts](../server/src/payments.integration.test.ts) contains cases for concurrent reservations, expiration, delayed captures, duplicate webhooks, browser/webhook races, interrupted settlement recovery, amount mismatch, failure followed by capture, and malformed JSON. These tests are opt-in through `PAYMENT_TEST_MONGODB_URI`, which must end in a dedicated database name ending in `test`. The provider is mocked; actual Razorpay Test Mode webhook delivery is still an external manual check.

Provider delivery, MongoDB behavior, and payment/pickup runtime have not been verified in this implementation session. Existing automated payment tests are documented above but were intentionally not run during this phase.
