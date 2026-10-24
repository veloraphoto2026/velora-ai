# Velora AI — pre-release checklist

This branch is **not production-ready**. Do not merge until these checks pass.

## Render environment (never paste values in issues or chats)
- DATABASE_URL points to the intended PostgreSQL database.
- JWT_SECRET is long, random, private and configured on the server.
- REPLICATE_API_TOKEN is configured privately on the server.
- VELORA_TEST_KEY is private; disable test access before public launch.
- Do not expose secrets in browser HTML, client JavaScript or logs.

## Manual staging tests
1. Register a fresh test email: profile shows 2 credits.
2. Sign out and back in: balance persists.
3. Generate one photo: balance becomes 1.
4. Generate another photo: balance becomes 0.
5. Third attempt is rejected without invoking Replicate.
6. Trigger a controlled generation failure: verify the credit is returned.
7. Test two simultaneous requests with 1 remaining credit.
8. Verify image result and download on mobile.
9. Check invalid passwords, duplicate emails, expired sessions.
10. Review server logs for leaked secrets and personal image data.

## Must fix before public launch
- Validate IP attribution behind the production proxy; add shared rate limiting and abuse controls.
- Add operator/provider reconciliation for ambiguous generation outcomes (idempotency is implemented below).
- Keep the legacy test-key endpoint disabled in production (disabled by default).
- Validate verified database TLS and CA configuration against staging (verification is enforced below).
- Verify actual image bytes, file type and size server-side.
- Add clear photo retention/deletion policy and user terms.
- Add verified payment integration before selling credits.
- Ensure persistent database backups and safe schema migrations.

No production data should be deleted during rollout.

## Account/credit fixes (local branch, not deployed)

Run `npm ci --ignore-scripts` and `npm test`. The suite requires a **local,
throwaway PostgreSQL server** on 127.0.0.1:5432, postgres role, able to create
new databases. Override only `VELORA_TEST_PGPORT` if needed. It ignores
`DATABASE_URL`, creates a distinct `velora_test_*` database on every run and
retains it for inspection. No existing users/databases are deleted. All
Replicate responses are injected in process; no real provider client, token,
payment or generation network call is used. The existing five smoke checks
also run against this isolated local app, never Render.

Implemented controls:
- Registration explicitly inserts exactly 2 credits, ignoring client balances.
  Case-insensitive unique email index also protects concurrent registrations.
  Login and startup never replenish balances.
- Account generations require `Idempotency-Key` (16–128 safe ASCII characters).
  Reserve one credit and insert the durable request in a single transaction.
  Duplicate keys cannot invoke the provider or debit/refund twice; changing
  the payload for an existing key returns 409. Frontend keeps pending keys
  in sessionStorage, indexed by a payload/session digest, including page reloads.
- Confirmed provider failure refunds once in a transaction. Unknown outcomes
  (timeouts, process crashes, or failure to persist a successful result) stay
  `processing` with a reserved credit, preventing automatic paid retries.
  **These need operator reconciliation before release**: verify the provider
  result and resolve the retained row transactionally; never blindly refund
  or rerun. There is no automatic reconciliation worker yet.
- JWT signing secret requires 32 bytes before initialization, verification
  accepts HS256 only and validates user IDs. Passwords are limited to 72 UTF-8
  bytes to prevent bcrypt's silent truncation. Existing passwords originally
  exceeding that limit will need a separately designed secure reset flow.
- Generic login failures, dummy password comparison for unknown accounts,
  per-process IP rate limits, no-store responses and redacted error logs.
  Before multiple replicas, add a shared rate-limit store. Before deploying
  behind Render's proxy, verify a trusted proxy configuration and limiter IP
  behavior; arbitrary forwarded headers are intentionally not trusted.
- Test-key generation is disabled by default; opt-in requires
  `ENABLE_LEGACY_GENERATION=true` in addition to its private key.
- Remote PostgreSQL uses verified TLS. Set DATABASE_SSL_CA securely if needed;
  URL flags cannot disable verification. Check staging connectivity before rollout.

Additive schema initialization creates `generation_requests` and a unique index
on `lower(btrim(email))`; it does not reset or delete existing balances. If
historical case-variant duplicate accounts exist, index creation fails safely
and startup stops. Resolve these only with an explicit, reviewed migration;
do not delete accounts automatically.

Remaining release limitations: uniqueness is per normalized email, **not per
person**. Preventing multiple free accounts through different addresses needs
email verification and an abuse policy; Gmail dots/plus aliases are deliberately
not guessed or merged. Full image decoding/validation, provider reconciliation,
shared rate limiting, password reset and production proxy/TLS validation remain
release requirements. No production readiness or deployment is claimed here.
