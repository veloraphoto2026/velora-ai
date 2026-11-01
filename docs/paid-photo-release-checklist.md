# Velora AI — release gate for paid photo orders

Status: **NOT READY for live checkout**. This checklist is based on source review only. The successful one-off admin Ranvik test does not authorize further paid calls.

## Existing implementation
- Services: photo 99 RUB, edit 149 RUB, video 299 RUB. New orders are pending; client-supplied prices are ignored.
- A paid photo endpoint exists: `POST /api/orders/:id/generate-photo`. It requires authentication and atomically claims an order with `service='photo' AND status='paid'` before contacting Ranvik. Do not call this endpoint in release checks with a real paid order.
- A Robokassa **test-only** checkout link exists at `POST /api/orders/:id/test-payment`.
- The ResultURL handler verifies signatures and order amounts; test callbacks do not mark orders paid. Production callbacks may mark an order paid, but **no production checkout should be exposed yet**.
- `GET /api/services` explicitly reports `paymentsEnabled:false` and `generationEnabled:false`. The client displays payment unavailable.
- The current UI creates pending orders, but does not yet provide a paid-order generation and download flow.

## Blocking checks before taking real payments
1. Verify merchant activation and fiscal receipt handling for a self-employed seller, including Robokassa receipt payload and legal details. Do not assume configured credentials imply compliance.
2. Confirm webhook endpoint, signature algorithm, production vs test secrets, expected amounts, and callback idempotency with **sandbox** notifications.
3. Define how a paid order can be recovered if Ranvik times out after accepting a request; avoid charging again or automatically retrying.
4. Persist result metadata and a durable downloadable asset; currently a generated result cannot be assumed retrievable after the client closes the browser.
5. Implement a client UI that reads an owned order status, allows generation only when paid, shows processing/failure states, and provides download on iPhone.
6. Run `node tests/safety-regression.cjs`, syntax checks and endpoint tests in a non-production environment; review failures before merge.
7. Verify rate limiting, CORS allowlist, request-size controls and data retention for user-uploaded photos.
8. Review test-lock durability: the admin Ranvik one-shot flag is process-local and resets after a restart. **Do not rerun the admin test.**
9. Publish only after an explicit release review and Render configuration check. Keep existing registrations, orders, and the deployed site untouched until then.

## No-cost verification
- Read-only source review and static regression script.
- Robokassa sandbox payment callback with fake order records in a dedicated test database.
- Mocked Ranvik response tests; never contact live Ranvik without fresh authorization.

No production deploy, payment, or generation is authorized by this document.
