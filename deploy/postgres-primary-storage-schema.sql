BEGIN;

CREATE SCHEMA IF NOT EXISTS health_platform;

CREATE TABLE IF NOT EXISTS health_platform.primary_storage_batches (
  batch_id text PRIMARY KEY,
  payload_sha256 char(64) NOT NULL CHECK (payload_sha256 ~ '^[a-f0-9]{64}$'),
  previous_chain_hash text NOT NULL DEFAULT ''
    CHECK (previous_chain_hash = '' OR previous_chain_hash ~ '^[a-f0-9]{64}$'),
  chain_hash char(64) NOT NULL UNIQUE CHECK (chain_hash ~ '^[a-f0-9]{64}$'),
  committed_at timestamptz NOT NULL,
  source_transaction_id text NOT NULL CHECK (length(source_transaction_id) >= 4),
  outbox_sequence bigint NOT NULL UNIQUE CHECK (outbox_sequence > 0),
  applied_changes integer NOT NULL CHECK (applied_changes >= 0),
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS primary_storage_batches_applied_idx
  ON health_platform.primary_storage_batches (applied_at DESC, outbox_sequence DESC);

CREATE TABLE IF NOT EXISTS health_platform.primary_collection_state (
  collection_name text PRIMARY KEY
    CHECK (collection_name ~ '^[A-Za-z][A-Za-z0-9_-]{0,239}$' AND collection_name <> 'storageMeta'),
  payload jsonb,
  payload_sha256 text NOT NULL DEFAULT '',
  source_version bigint NOT NULL CHECK (source_version >= 0),
  deleted boolean NOT NULL DEFAULT false,
  batch_id text NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT primary_collection_state_batch_fk
    FOREIGN KEY (batch_id)
    REFERENCES health_platform.primary_storage_batches(batch_id)
    ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT primary_collection_state_payload_check CHECK (
    (
      deleted = true
      AND payload IS NULL
      AND payload_sha256 = ''
    )
    OR
    (
      deleted = false
      AND payload IS NOT NULL
      AND payload_sha256 ~ '^[a-f0-9]{64}$'
    )
  )
);

CREATE INDEX IF NOT EXISTS primary_collection_state_active_idx
  ON health_platform.primary_collection_state (collection_name)
  WHERE deleted = false;

CREATE INDEX IF NOT EXISTS primary_collection_state_updated_idx
  ON health_platform.primary_collection_state (updated_at DESC);

COMMIT;
