# Isolated Render preview — no paid generations

This is a preparation branch based on PR #3. Nothing in this directory changes
`npm start` or the existing Render services `velora-ai` / `velora-ai-api`.
The separate entrypoint uses an in-process mock; it never constructs a real
Replicate client. Use fictional emails/passwords and non-sensitive test photos.

## Cost check before creating anything

The Blueprint requests **only `plan: free`** for both a new web service and a new
PostgreSQL database. No disk, paid plan, cron, worker, Redis or paid API is requested.
Actual Free availability, account allowances, expiry, payment requirements and
pricing MUST be checked against current Render documentation and the account's
creation screen/API before applying. Free has historically had shared web-service
hours, sleep/cold starts, an ephemeral filesystem and expiring PostgreSQL databases;
these are not verified current account entitlements. If Free is unavailable or
any charge/payment upgrade is proposed, stop and obtain separate consent. Never
upgrade automatically. See https://render.com/docs/free . Do not attach a billing
method just to continue this setup.

## Deployment (not executed yet)

1. Use a **new** Blueprint with `render.preview.yaml` from the
   `test/render-free-preview` branch. Confirm new names `velora-account-preview`
   and `velora-preview-db` are unused and are not existing production resources.
   Do not sync this Blueprint into an existing service/Blueprint or environment group.
2. Inspect the proposed changes: exactly one Free web service and one Free database,
   $0, no changes to any existing resource. Otherwise stop before applying.
3. The Blueprint generates an independent JWT secret and connects only the new DB
   named `velora_preview`. Do not copy production DATABASE_URL, JWT_SECRET,
   environment groups, REPLICATE_API_TOKEN or VELORA_TEST_KEY. External database
   access is disabled. Existing user accounts/data are never imported or deleted.
4. Build: `npm ci --ignore-scripts`. Start: `npm run start:preview`.
   Auto deploy is disabled; do not change it without review. Initial deployment is
   permitted only after step 2 confirms Free. The preview requires the Render
   `RENDER_EXTERNAL_URL` HTTPS origin. If DB TLS verification fails, configure
   its proper trust chain; never disable TLS verification.
5. Check `/api/health`, the visible mock banner and `/preview-result.svg`. Verify
   the service and database IDs belong to this new preview before running tests.

Deployment needs authorized Render access and allowed HTTPS egress to `render.com`
(documentation) and `api.render.com` (account checks/resource creation). No Render
integration or credentials were available during preparation. Credentials, if
required, belong only in protected environment settings, never chat or Git.

## Acceptance checks in the preview

- Register a unique fictional email: profile shows 2 free generations.
- Logout/login: balance remains 2. Re-registering the same normalized email fails.
- Upload a non-sensitive test PNG/JPEG: generate twice and see clearly labelled
  mock images; balance changes 2 → 1 → 0. Third attempt fails without a mock call.
- Retry a pending request with its existing Idempotency-Key: no second debit.
- With a fresh test account, include `[mock:fail]` in the prompt: simulated provider
  failure returns 502 and restores the credit exactly once. It never calls Replicate.
- Sign out: account endpoints require authorization. Expired/forged JWTs fail.
- Restart the preview: PostgreSQL retains balances and request records while the
  Free database remains available. Do not reset balances or remove test accounts.

`npm test` runs all account and preview integration tests locally on dedicated
new databases, with mock responses. The existing smoke suite is invoked against
the isolated local app. No production service URL is used by these tests.

## Status and limits

This configuration was tested locally, not deployed or validated on Render.
A mock portrait validates authentication, balance and the account UI's response
path; it does not validate real AI generation quality or the paid provider.
Provider reconciliation, email verification, shared rate limiting and trusted
proxy configuration remain pre-release work from PRE_RELEASE_CHECKLIST.md.
Free database expiry can eventually make this disposable preview unavailable;
never migrate production data to it or upgrade/delete resources automatically.
