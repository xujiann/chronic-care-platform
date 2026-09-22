-- OPS-045 v1: empty structures only; no historical identity or binding backfill.
CREATE TABLE health_platform.primary_identity_migrations (
  version integer PRIMARY KEY CHECK (version > 0),
  name text NOT NULL,
  checksum text NOT NULL CHECK (checksum ~ '^[a-f0-9]{64}$')
);
CREATE TABLE health_platform.primary_target_identity (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  target_instance_id text NOT NULL UNIQUE CHECK (target_instance_id ~ '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'),
  namespace text NOT NULL CHECK (namespace = 'health_platform'),
  created_at text NOT NULL
);
CREATE TABLE health_platform.primary_source_binding (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  target_instance_id text NOT NULL REFERENCES health_platform.primary_target_identity(target_instance_id) ON DELETE RESTRICT,
  namespace text NOT NULL CHECK (namespace = 'health_platform'),
  source_identity jsonb NOT NULL CHECK (jsonb_typeof(source_identity) = 'object')
);
CREATE FUNCTION health_platform.primary_identity_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'primary identity metadata is immutable' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER primary_target_identity_immutable BEFORE UPDATE OR DELETE OR TRUNCATE
  ON health_platform.primary_target_identity FOR EACH STATEMENT EXECUTE FUNCTION health_platform.primary_identity_immutable();
CREATE TRIGGER primary_source_binding_immutable BEFORE UPDATE OR DELETE OR TRUNCATE
  ON health_platform.primary_source_binding FOR EACH STATEMENT EXECUTE FUNCTION health_platform.primary_identity_immutable();
CREATE TRIGGER primary_identity_migrations_immutable BEFORE UPDATE OR DELETE OR TRUNCATE
  ON health_platform.primary_identity_migrations FOR EACH STATEMENT EXECUTE FUNCTION health_platform.primary_identity_immutable();
