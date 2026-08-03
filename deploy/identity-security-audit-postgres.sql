BEGIN;

CREATE SCHEMA IF NOT EXISTS health_platform;

CREATE TABLE IF NOT EXISTS health_platform.identity_security_audit_streams (
  stream_id text PRIMARY KEY,
  stream_version bigint NOT NULL DEFAULT 0 CHECK (stream_version >= 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CHECK (updated_at >= created_at)
);

CREATE TABLE IF NOT EXISTS health_platform.identity_security_controls (
  control_id text PRIMARY KEY,
  control_version bigint NOT NULL DEFAULT 0 CHECK (control_version >= 0),
  status text NOT NULL,
  evidence text NOT NULL DEFAULT '',
  next_action text NOT NULL DEFAULT '',
  last_action text NOT NULL DEFAULT '',
  updated_by_ref_sha256 text NOT NULL CHECK (updated_by_ref_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CHECK (updated_at >= created_at)
);

CREATE TABLE IF NOT EXISTS health_platform.identity_security_audit_commands (
  stream_id text NOT NULL REFERENCES health_platform.identity_security_audit_streams(stream_id),
  command_key_sha256 text NOT NULL CHECK (command_key_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  intent_sha256 text NOT NULL CHECK (intent_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  stream_version bigint NOT NULL CHECK (stream_version > 0),
  result_snapshot jsonb NOT NULL,
  result_sha256 text NOT NULL CHECK (result_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  committed_at timestamptz NOT NULL,
  PRIMARY KEY (stream_id, command_key_sha256),
  UNIQUE (stream_id, stream_version),
  UNIQUE (stream_id, command_key_sha256, stream_version)
);

CREATE TABLE IF NOT EXISTS health_platform.identity_security_audit_events (
  event_id text PRIMARY KEY,
  stream_id text NOT NULL REFERENCES health_platform.identity_security_audit_streams(stream_id),
  stream_version bigint NOT NULL CHECK (stream_version > 0),
  command_key_sha256 text NOT NULL CHECK (command_key_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  intent_sha256 text NOT NULL CHECK (intent_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  occurred_at timestamptz NOT NULL,
  correlation_id text NOT NULL,
  actor_ref_sha256 text NOT NULL CHECK (actor_ref_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  role text NOT NULL,
  action text NOT NULL,
  target_ref_sha256 text NOT NULL CHECK (target_ref_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  result text NOT NULL,
  detail_sha256 text NOT NULL CHECK (detail_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  request_method text NOT NULL,
  request_path text NOT NULL CHECK (position('?' in request_path) = 0),
  client_ref_sha256 text NOT NULL CHECK (client_ref_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  session_ref_sha256 text NOT NULL CHECK (session_ref_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  event_sha256 text NOT NULL CHECK (event_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  UNIQUE (stream_id, stream_version),
  UNIQUE (stream_id, command_key_sha256),
  FOREIGN KEY (stream_id, command_key_sha256, stream_version)
    REFERENCES health_platform.identity_security_audit_commands(stream_id, command_key_sha256, stream_version)
);

CREATE INDEX IF NOT EXISTS identity_security_audit_events_time_idx
  ON health_platform.identity_security_audit_events(stream_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS identity_security_controls_updated_idx
  ON health_platform.identity_security_controls(updated_at DESC);

COMMIT;
