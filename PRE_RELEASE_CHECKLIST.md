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
- Rate-limit registration, login, and generation; add abuse controls.
- Enforce unique, idempotent generation requests and reconcile ambiguous provider failures.
- Remove or restrict test-key generation endpoint to administrators.
- Verify database TLS certificates rather than disabling verification.
- Verify actual image bytes, file type and size server-side.
- Add clear photo retention/deletion policy and user terms.
- Add verified payment integration before selling credits.
- Ensure persistent database backups and safe schema migrations.

No production data should be deleted during rollout.
