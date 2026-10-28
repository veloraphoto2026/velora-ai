-- Velora AI: payment ledger groundwork (not activated in production)
-- Apply only after selecting payment provider and testing in staging.
BEGIN;
CREATE TABLE IF NOT EXISTS payment_orders (
 id BIGSERIAL PRIMARY KEY,
 user_id BIGINT NOT NULL REFERENCES users(id),
 provider TEXT NOT NULL,
 provider_payment_id TEXT,
 amount_kopecks BIGINT NOT NULL CHECK (amount_kopecks > 0),
 currency TEXT NOT NULL DEFAULT 'RUB' CHECK (currency = 'RUB'),
 product_code TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','failed','refunded')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 paid_at TIMESTAMPTZ,
 UNIQUE(provider, provider_payment_id)
);
CREATE INDEX IF NOT EXISTS payment_orders_user_created_idx ON payment_orders(user_id, created_at DESC);
CREATE TABLE IF NOT EXISTS payment_events (
 id BIGSERIAL PRIMARY KEY,
 provider TEXT NOT NULL,
 provider_event_id TEXT NOT NULL,
 order_id BIGINT REFERENCES payment_orders(id),
 received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(provider, provider_event_id)
);
COMMIT;
