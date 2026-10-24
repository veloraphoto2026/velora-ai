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
