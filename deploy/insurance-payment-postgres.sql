BEGIN;

CREATE SCHEMA IF NOT EXISTS health_platform;

CREATE TABLE IF NOT EXISTS health_platform.insurance_payment_aggregates (
  aggregate_id text PRIMARY KEY,
  schema_version text NOT NULL,
  aggregate_version bigint NOT NULL DEFAULT 0 CHECK (aggregate_version >= 0),
  state jsonb NOT NULL,
  state_sha256 text NOT NULL CHECK (state_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CHECK (updated_at >= created_at)
);

CREATE TABLE IF NOT EXISTS health_platform.insurance_payment_commands (
  aggregate_id text NOT NULL REFERENCES health_platform.insurance_payment_aggregates(aggregate_id),
  command_id text NOT NULL,
  command_type text NOT NULL,
  command_sha256 text NOT NULL CHECK (command_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  aggregate_version bigint NOT NULL CHECK (aggregate_version > 0),
  result jsonb NOT NULL,
  result_sha256 text NOT NULL CHECK (result_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  committed_at timestamptz NOT NULL,
  PRIMARY KEY (aggregate_id, command_id),
  UNIQUE (aggregate_id, aggregate_version),
  UNIQUE (aggregate_id, command_id, aggregate_version)
);

CREATE TABLE IF NOT EXISTS health_platform.insurance_payment_outbox (
  event_id text PRIMARY KEY,
  aggregate_id text NOT NULL REFERENCES health_platform.insurance_payment_aggregates(aggregate_id),
  aggregate_version bigint NOT NULL CHECK (aggregate_version > 0),
  command_id text NOT NULL,
  command_type text NOT NULL,
  event_type text NOT NULL,
  occurred_at timestamptz NOT NULL,
  actor text NOT NULL,
  trace_id text NOT NULL,
  payload jsonb NOT NULL,
  event_sha256 text NOT NULL CHECK (event_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  status text NOT NULL CHECK (status IN ('pending', 'processing', 'published', 'dead-letter')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL CHECK (max_attempts BETWEEN 1 AND 100),
  next_attempt_at timestamptz NOT NULL,
  lease_owner text,
  lease_token text,
  lease_expires_at timestamptz,
  published_at timestamptz,
  dead_lettered_at timestamptz,
  last_error_code text,
  last_error_digest text,
  UNIQUE (aggregate_id, aggregate_version),
  UNIQUE (aggregate_id, command_id),
  FOREIGN KEY (aggregate_id, command_id, aggregate_version)
    REFERENCES health_platform.insurance_payment_commands(aggregate_id, command_id, aggregate_version),
  CHECK (attempts <= max_attempts),
  CHECK ((status = 'processing') = (lease_owner IS NOT NULL AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)),
  CHECK ((status <> 'published') OR published_at IS NOT NULL),
  CHECK ((status <> 'dead-letter') OR dead_lettered_at IS NOT NULL),
  CHECK (last_error_digest IS NULL OR last_error_digest ~ '^sha256:[a-f0-9]{64}$')
);

CREATE INDEX IF NOT EXISTS insurance_payment_outbox_dispatch_idx
  ON health_platform.insurance_payment_outbox(status, next_attempt_at, aggregate_version)
  WHERE status IN ('pending', 'processing');

CREATE INDEX IF NOT EXISTS insurance_payment_commands_committed_idx
  ON health_platform.insurance_payment_commands(aggregate_id, committed_at DESC);

COMMIT;
