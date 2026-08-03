BEGIN;

CREATE SCHEMA IF NOT EXISTS health_platform;

CREATE TABLE IF NOT EXISTS health_platform.emergency_signal_delivery_outbox (
  event_id text PRIMARY KEY,
  event_payload jsonb NOT NULL,
  event_payload_sha256 text NOT NULL CHECK (event_payload_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  CHECK (octet_length(event_payload::text) <= 16384),
  delivery_state jsonb NOT NULL,
  delivery_state_sha256 text NOT NULL CHECK (delivery_state_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  status text NOT NULL CHECK (status IN ('pending', 'processing', 'published', 'dead-letter')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL CHECK (max_attempts BETWEEN 1 AND 100),
  generation integer NOT NULL DEFAULT 1 CHECK (generation >= 1),
  next_attempt_at timestamptz NOT NULL,
  lease_owner text,
  lease_token text,
  lease_expires_at timestamptz,
  published_at timestamptz,
  dead_lettered_at timestamptz,
  last_error_code text,
  last_error_digest text,
  receipt_digest text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CHECK (attempts <= max_attempts),
  CHECK ((status = 'processing') = (lease_owner IS NOT NULL AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)),
  CHECK ((status <> 'published') OR (published_at IS NOT NULL AND receipt_digest IS NOT NULL)),
  CHECK ((status <> 'dead-letter') OR dead_lettered_at IS NOT NULL),
  CHECK (last_error_digest IS NULL OR last_error_digest ~ '^sha256:[a-f0-9]{64}$'),
  CHECK (receipt_digest IS NULL OR receipt_digest ~ '^sha256:[a-f0-9]{64}$'),
  CHECK (updated_at >= created_at)
);

CREATE TABLE IF NOT EXISTS health_platform.emergency_signal_delivery_replays (
  replay_key_sha256 text PRIMARY KEY CHECK (replay_key_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  event_id text NOT NULL REFERENCES health_platform.emergency_signal_delivery_outbox(event_id),
  intent_sha256 text NOT NULL CHECK (intent_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  reason_sha256 text NOT NULL CHECK (reason_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  requested_by_sha256 text NOT NULL CHECK (requested_by_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  requested_at timestamptz NOT NULL,
  result jsonb NOT NULL,
  result_sha256 text NOT NULL CHECK (result_sha256 ~ '^sha256:[a-f0-9]{64}$')
);

CREATE INDEX IF NOT EXISTS emergency_signal_delivery_dispatch_idx
  ON health_platform.emergency_signal_delivery_outbox(status, next_attempt_at, created_at, event_id)
  WHERE status IN ('pending', 'processing');

CREATE INDEX IF NOT EXISTS emergency_signal_delivery_replay_event_idx
  ON health_platform.emergency_signal_delivery_replays(event_id, requested_at);

COMMIT;
