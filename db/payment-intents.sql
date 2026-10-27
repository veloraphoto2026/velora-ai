-- Pending top-ups: server-owned payment intent, never trust webhook user/amount.
CREATE TABLE IF NOT EXISTS payment_intents (
 id BIGSERIAL PRIMARY KEY,
 user_id BIGINT NOT NULL REFERENCES users(id),
 amount_kopecks BIGINT NOT NULL CHECK(amount_kopecks > 0),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','confirmed','cancelled')),
 provider TEXT NOT NULL DEFAULT 'tbank',
 provider_payment_id TEXT UNIQUE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 confirmed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS payment_intents_user_created_idx ON payment_intents(user_id,created_at DESC);
