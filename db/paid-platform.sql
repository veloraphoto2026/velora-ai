-- Staging migration only. Do not run in production before backup and approval.
BEGIN;
ALTER TABLE users ALTER COLUMN credits SET DEFAULT 0;
CREATE TABLE IF NOT EXISTS wallets (
 user_id BIGINT PRIMARY KEY REFERENCES users(id),
 balance_kopecks BIGINT NOT NULL DEFAULT 0 CHECK (balance_kopecks >= 0),
 reserved_kopecks BIGINT NOT NULL DEFAULT 0 CHECK (reserved_kopecks >= 0)
);
CREATE TABLE IF NOT EXISTS payment_events (
 id BIGSERIAL PRIMARY KEY,
 provider TEXT NOT NULL,
 provider_event_id TEXT NOT NULL,
 user_id BIGINT REFERENCES users(id),
 amount_kopecks BIGINT NOT NULL CHECK (amount_kopecks > 0),
 status TEXT NOT NULL,
 received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(provider, provider_event_id)
);
CREATE TABLE IF NOT EXISTS generation_jobs (
 id BIGSERIAL PRIMARY KEY,
 user_id BIGINT NOT NULL REFERENCES users(id),
 idempotency_key TEXT NOT NULL,
 modality TEXT NOT NULL,
 model_id TEXT NOT NULL,
 quoted_price_kopecks BIGINT NOT NULL CHECK (quoted_price_kopecks > 0),
 status TEXT NOT NULL DEFAULT 'pending',
 provider_task_id TEXT,
 result_url TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(user_id, idempotency_key)
);
CREATE TABLE IF NOT EXISTS wallet_ledger (
 id BIGSERIAL PRIMARY KEY,
 user_id BIGINT NOT NULL REFERENCES users(id),
 job_id BIGINT REFERENCES generation_jobs(id),
 payment_event_id BIGINT REFERENCES payment_events(id),
 delta_kopecks BIGINT NOT NULL,
 reason TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMIT;
