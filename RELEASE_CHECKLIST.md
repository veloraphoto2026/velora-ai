# Velora AI pre-release verification

This branch is **not approved for production deployment**.

## Environment (do not commit actual values)
- DATABASE_URL: PostgreSQL connection string
- JWT_SECRET: long random signing secret
- REPLICATE_API_TOKEN: server-side provider token

## Staging checks
1. Start the app against a **separate staging database**, not production.
2. Verify GET /api/health returns running.
3. Register a new account and verify its credit balance is 2.
4. Log out and log in again; confirm /api/me requires a valid JWT.
5. Try generation without a JWT; expect HTTP 401 and no provider call.
6. Generate one valid image; verify credits change from 2 to 1.
7. Generate another; verify credits change from 1 to 0.
8. Attempt a third; expect HTTP 402 and no provider call.
9. Simulate a provider error; verify a reserved credit is returned.
10. Test concurrent requests against a one-credit account.
11. Check email uniqueness, invalid passwords, invalid image types and oversized requests.
12. Verify photos are not logged, tokens are never exposed, and billing is disabled until payment handling exists.

## Known limitations to resolve before launch
- No paid checkout or credit purchase implementation.
- No rate limiting or email verification.
- No persistent generation ledger or idempotency protection; a provider failure or server crash can leave credit accounting inconsistent.
- User photos are sent to an external image generation provider.
- Review database TLS verification and CORS settings before production.
- Avoid running schema changes automatically against production without a migration plan.
