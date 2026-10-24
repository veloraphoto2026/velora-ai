# Velora AI — isolated iPhone preview checklist

This branch is a draft preview only. Do not merge into main or connect it to the existing production Render service until the owner approves.

## Create an isolated preview on Render
1. Create a **new** Render Web Service using branch `feature/auth-credits-safe-preview`. Do not edit the production service.
2. Use Node 22, build command `npm install --ignore-scripts`, start command `node server.js`.
3. Use a **separate preview PostgreSQL database**. Never point the preview to production DATABASE_URL.
4. Configure preview-only environment variables:
   - `DATABASE_URL`: separate preview PostgreSQL connection string.
   - `JWT_SECRET`: random secret at least 32 characters, unique to preview.
   - `VELORA_GENERATION_ENABLED=false` (default).
   - `VELORA_DAILY_GENERATION_LIMIT=0` (default).
   - Do **not** set `REPLICATE_API_TOKEN` for the first preview.
5. Verify `/api/health` returns `success: true`.
6. On iPhone Safari: register a disposable test account, confirm 2 credits, log out, log in, and check balance remains 2. Do not upload sensitive photos during preview.
7. Verify generation is blocked with HTTP 503 and does not deduct a credit.
8. Only after explicit owner approval, configure paid provider access and a small daily limit, then test with a non-sensitive photo.

## Important launch blockers
- Preview accounts are not email-verified; free credits can be abused through repeated registrations. Do not enable paid generation for public traffic until account verification and abuse protection are implemented.
- Rate limiting is in-memory per process, not shared across multiple instances.
- Add privacy notice/consent, data retention policy, support contact, payment provider, and billing reconciliation before accepting customers.
- Provider output links may expire; production needs secure image storage or clear expiry information.
- Do not publish credentials or copy real customer data into preview.

This checklist does not deploy anything or incur API charges.

## Prepared Blueprint (not deployed)

`render.preview.yaml` describes only NEW resources named
`velora-auth-credits-preview` and `velora-auth-credits-preview-db`. It uses the
`feature/auth-credits-safe-preview` branch and requests Free for both. The
website and API share one HTTPS origin, suitable for Safari on iPhone; no
production frontend/API URL is used. Do not infer a public URL from the names:
report only Render's actual service URL after deployment and readiness checks.

Before applying, use authorized Render access to confirm both names are unused,
the workspace permits a free database, both plans cost $0, and new usage cannot
affect production quotas. Prefer a separate test workspace if available for
free. Render's Free database limit is one active database per workspace, 1 GB,
with expiry after 30 days. Free web-service hours and other allowances are
shared; bandwidth/build overages can incur charges if billing is enabled. Stop
if quota isolation or absence of costs cannot be established. Never upgrade,
replace or delete an existing database to make the preview fit. Do not copy
production environment groups or credentials. See https://render.com/docs/free .

The Blueprint generates a distinct JWT secret, binds only its new PostgreSQL,
sets generation to false and its limit to zero, omits provider credentials, and
disables automatic deployment. Check these values again in Render before the
initial deployment. Neither this file nor saving it to GitHub deploys resources.

## Meaningful local checks

Use a newly created local database named `velora_test` or `velora_test_*` and
pass its connection as `TEST_DATABASE_URL` to `npm test`. Integration tests now
reject remote and production database destinations and explicitly report a
skip when the connection is absent. They create/remove only disposable test
accounts. Files run sequentially, matching CI and avoiding schema-init races.
Provider tests use `tests/mock-replicate.cjs`, so they never contact Replicate.
The PostgreSQL test covers registration, login, profile, exactly 2 initial
credits, duplicate rejection, disabled generation without debit, SQL debits and
refund. The provider test covers a mocked failure/refund, one successful mocked
HTTP generation, and daily-quota rejection. Neither proves a real provider call
or browser-level Safari behavior, which remain unrun until a reachable preview
exists.
