BEGIN;

CREATE SCHEMA IF NOT EXISTS health_platform;

CREATE TABLE IF NOT EXISTS health_platform.referral_delivery_outbox (
  event_id text PRIMARY KEY,
  event_type text NOT NULL,
  contract_id text NOT NULL CHECK (contract_id = 'referral-order.v1'),
  aggregate_version bigint NOT NULL CHECK (aggregate_version > 0),
  correlation_id text NOT NULL,
  payload jsonb NOT NULL,
  payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  status text NOT NULL CHECK (status IN ('pending', 'leased', 'delivered', 'dead-letter')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL CHECK (max_attempts BETWEEN 1 AND 100),
  next_attempt_at timestamptz,
  lease_owner text,
  lease_token_sha256 text,
  lease_version bigint NOT NULL DEFAULT 0 CHECK (lease_version >= 0),
  lease_expires_at timestamptz,
  ack_lease_token_sha256 text,
  receipt jsonb,
  receipt_sha256 text,
  delivered_at timestamptz,
  dead_lettered_at timestamptz,
  last_error_code text,
  last_error_sha256 text,
  replay_count integer NOT NULL DEFAULT 0 CHECK (replay_count >= 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CHECK (attempts <= max_attempts),
  CHECK ((status = 'leased') = (lease_owner IS NOT NULL AND lease_token_sha256 IS NOT NULL AND lease_expires_at IS NOT NULL)),
  CHECK ((status <> 'delivered') OR (delivered_at IS NOT NULL AND receipt IS NOT NULL AND receipt_sha256 IS NOT NULL)),
  CHECK ((status <> 'dead-letter') OR dead_lettered_at IS NOT NULL),
  CHECK (lease_token_sha256 IS NULL OR lease_token_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  CHECK (ack_lease_token_sha256 IS NULL OR ack_lease_token_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  CHECK (receipt_sha256 IS NULL OR receipt_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  CHECK (last_error_sha256 IS NULL OR last_error_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  CHECK (updated_at >= created_at)
);

CREATE TABLE IF NOT EXISTS health_platform.referral_delivery_replays (
  replay_key_sha256 text PRIMARY KEY CHECK (replay_key_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  event_id text NOT NULL REFERENCES health_platform.referral_delivery_outbox(event_id),
  intent_sha256 text NOT NULL CHECK (intent_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  result jsonb NOT NULL,
  result_sha256 text NOT NULL CHECK (result_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  requested_by text NOT NULL,
  requested_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS referral_delivery_claim_idx
  ON health_platform.referral_delivery_outbox(status, next_attempt_at, lease_expires_at, created_at)
  WHERE status IN ('pending', 'leased');

CREATE INDEX IF NOT EXISTS referral_delivery_status_idx
  ON health_platform.referral_delivery_outbox(status, updated_at DESC);

CREATE INDEX IF NOT EXISTS referral_delivery_replay_event_idx
  ON health_platform.referral_delivery_replays(event_id, requested_at DESC);

COMMIT;
