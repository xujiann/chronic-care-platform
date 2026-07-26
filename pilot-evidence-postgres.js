const { createHash } = require("node:crypto");

const PILOT_EVIDENCE_COLLECTION = "pilotEvidenceBatches";
const MINIMUM_RETENTION_YEARS = 10;

class PilotEvidencePostgresError extends Error {
  constructor(message, code, statusCode = 400) {
    super(message);
    this.name = "PilotEvidencePostgresError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function canonicalStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(",")}]`;
  return `{${Object.keys(value)
    .filter((key) => value[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalStringify(value[key])}`)
    .join(",")}}`;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function requiredText(value, field, maxLength = 200) {
  const text = String(value || "").trim();
  if (!text || text.length > maxLength || /[\r\n]/.test(text)) {
    throw new PilotEvidencePostgresError(`pilot evidence ${field} is invalid`, "PILOT_EVIDENCE_PROJECTION_INVALID");
  }
  return text;
}

function validTimestamp(value, field) {
  const text = requiredText(value, field, 80);
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) {
    throw new PilotEvidencePostgresError(`pilot evidence ${field} is invalid`, "PILOT_EVIDENCE_PROJECTION_INVALID");
  }
  return date;
}

function retentionYears(value) {
  const years = Number(value || MINIMUM_RETENTION_YEARS);
  if (!Number.isInteger(years) || years < MINIMUM_RETENTION_YEARS || years > 100) {
    throw new PilotEvidencePostgresError(
      `pilot evidence retention must be ${MINIMUM_RETENTION_YEARS}-100 years`,
      "PILOT_EVIDENCE_RETENTION_INVALID"
    );
  }
  return years;
}

function addUtcYears(date, years) {
  const result = new Date(date);
  result.setUTCFullYear(result.getUTCFullYear() + years);
  return result.toISOString();
}

function projectPilotEvidenceBatch(batch, options = {}) {
  if (!batch || typeof batch !== "object" || Array.isArray(batch)) {
    throw new PilotEvidencePostgresError("pilot evidence batch must be an object", "PILOT_EVIDENCE_PROJECTION_INVALID");
  }
  const status = String(batch.status || "").trim().toLowerCase();
  if (!["open", "frozen"].includes(status)) {
    throw new PilotEvidencePostgresError("pilot evidence status is invalid", "PILOT_EVIDENCE_PROJECTION_INVALID");
  }
  const revision = Number(batch.revision);
  if (!Number.isInteger(revision) || revision < 1) {
    throw new PilotEvidencePostgresError("pilot evidence revision is invalid", "PILOT_EVIDENCE_PROJECTION_INVALID");
  }
  const createdAt = validTimestamp(batch.createdAt, "createdAt");
  const updatedAt = batch.frozenAt
    ? validTimestamp(batch.frozenAt, "frozenAt")
    : new Date((batch.auditEvents || []).at(-1)?.at || createdAt);
  if (Number.isNaN(updatedAt.getTime())) {
    throw new PilotEvidencePostgresError("pilot evidence updatedAt is invalid", "PILOT_EVIDENCE_PROJECTION_INVALID");
  }
  const manifestSha256 = String(batch.acceptancePack?.manifestSha256 || "").trim().toLowerCase();
  if (status === "frozen" && !/^[a-f0-9]{64}$/.test(manifestSha256)) {
    throw new PilotEvidencePostgresError("frozen pilot evidence manifest is invalid", "PILOT_EVIDENCE_MANIFEST_INVALID");
  }
  const payload = canonicalStringify(batch);
  const years = retentionYears(options.retentionYears);
  return {
    batchId: requiredText(batch.id, "id", 160),
    organizationCode: requiredText(batch.organizationCode, "organizationCode", 120),
    pilotId: requiredText(batch.pilotId, "pilotId", 160),
    hospitalName: requiredText(batch.hospitalName, "hospitalName", 240),
    title: requiredText(batch.title, "title", 300),
    status,
    revision,
    payload,
    payloadSha256: sha256(payload),
    manifestSha256,
    createdAt: createdAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
    frozenAt: status === "frozen" ? validTimestamp(batch.frozenAt, "frozenAt").toISOString() : null,
    retentionUntil: addUtcYears(status === "frozen" ? validTimestamp(batch.frozenAt, "frozenAt") : createdAt, years),
    legalHold: Boolean(batch.legalHold),
    retentionYears: years
  };
}

function buildPilotEvidenceProjection(batches, options = {}) {
  if (!Array.isArray(batches)) {
    throw new PilotEvidencePostgresError("pilotEvidenceBatches must be an array", "PILOT_EVIDENCE_COLLECTION_INVALID");
  }
  const rows = batches.map((batch) => projectPilotEvidenceBatch(batch, options));
  if (new Set(rows.map((row) => row.batchId)).size !== rows.length) {
    throw new PilotEvidencePostgresError("pilot evidence batch ids must be unique", "PILOT_EVIDENCE_BATCH_DUPLICATE");
  }
  return rows;
}

function pilotEvidenceSchemaStatements() {
  return [
    "CREATE TABLE IF NOT EXISTS health_platform.pilot_evidence_batches (",
    "  batch_id text PRIMARY KEY,",
    "  organization_code text NOT NULL,",
    "  pilot_id text NOT NULL,",
    "  hospital_name text NOT NULL,",
    "  title text NOT NULL,",
    "  status text NOT NULL CHECK (status IN ('open', 'frozen')),",
    "  revision bigint NOT NULL CHECK (revision > 0),",
    "  payload jsonb NOT NULL,",
    "  payload_sha256 char(64) NOT NULL CHECK (payload_sha256 ~ '^[a-f0-9]{64}$'),",
    "  manifest_sha256 text NOT NULL DEFAULT '' CHECK (manifest_sha256 = '' OR manifest_sha256 ~ '^[a-f0-9]{64}$'),",
    "  created_at timestamptz NOT NULL,",
    "  updated_at timestamptz NOT NULL,",
    "  frozen_at timestamptz,",
    "  retention_until timestamptz NOT NULL,",
    "  legal_hold boolean NOT NULL DEFAULT false,",
    "  CHECK ((status = 'open' AND frozen_at IS NULL) OR (status = 'frozen' AND frozen_at IS NOT NULL AND manifest_sha256 != '')),",
    "  CHECK (retention_until >= created_at)",
    ");",
    "CREATE INDEX IF NOT EXISTS pilot_evidence_batches_org_status_idx ON health_platform.pilot_evidence_batches (organization_code, status, updated_at DESC);",
    "CREATE INDEX IF NOT EXISTS pilot_evidence_batches_retention_idx ON health_platform.pilot_evidence_batches (retention_until) WHERE legal_hold = false;",
    "CREATE TABLE IF NOT EXISTS health_platform.pilot_evidence_batch_versions (",
    "  batch_id text NOT NULL REFERENCES health_platform.pilot_evidence_batches(batch_id) ON DELETE RESTRICT,",
    "  revision bigint NOT NULL CHECK (revision > 0),",
    "  payload jsonb NOT NULL,",
    "  payload_sha256 char(64) NOT NULL CHECK (payload_sha256 ~ '^[a-f0-9]{64}$'),",
    "  actor text NOT NULL,",
    "  recorded_at timestamptz NOT NULL,",
    "  PRIMARY KEY (batch_id, revision)",
    ");",
    "CREATE INDEX IF NOT EXISTS pilot_evidence_versions_recorded_idx ON health_platform.pilot_evidence_batch_versions (recorded_at DESC);",
    "CREATE OR REPLACE FUNCTION health_platform.reject_pilot_evidence_version_mutation() RETURNS trigger AS $$",
    "BEGIN",
    "  RAISE EXCEPTION 'pilot evidence versions are append-only';",
    "END;",
    "$$ LANGUAGE plpgsql;",
    "DROP TRIGGER IF EXISTS pilot_evidence_versions_immutable ON health_platform.pilot_evidence_batch_versions;",
    "CREATE TRIGGER pilot_evidence_versions_immutable",
    "BEFORE UPDATE OR DELETE ON health_platform.pilot_evidence_batch_versions",
    "FOR EACH ROW EXECUTE FUNCTION health_platform.reject_pilot_evidence_version_mutation();",
    "REVOKE UPDATE, DELETE, TRUNCATE ON health_platform.pilot_evidence_batch_versions FROM PUBLIC;"
  ];
}

function pilotEvidenceLoadSql() {
  return [
    "\\set ON_ERROR_STOP on",
    "BEGIN;",
    "WITH source AS (",
    "  SELECT payload, payload_sha256",
    "  FROM health_platform.collection_records",
    "  WHERE migration_run_id = :'migration_run_id' AND collection_name = 'pilotEvidenceBatches'",
    ")",
    "INSERT INTO health_platform.pilot_evidence_batches (",
    "  batch_id, organization_code, pilot_id, hospital_name, title, status, revision, payload,",
    "  payload_sha256, manifest_sha256, created_at, updated_at, frozen_at, retention_until, legal_hold",
    ")",
    "SELECT",
    "  payload->>'id', payload->>'organizationCode', payload->>'pilotId', payload->>'hospitalName', payload->>'title',",
    "  payload->>'status', (payload->>'revision')::bigint, payload,",
    "  payload_sha256,",
    "  COALESCE(payload#>>'{acceptancePack,manifestSha256}', ''),",
    "  (payload->>'createdAt')::timestamptz,",
    "  COALESCE((payload->>'frozenAt')::timestamptz, (payload->>'createdAt')::timestamptz),",
    "  NULLIF(payload->>'frozenAt', '')::timestamptz,",
    "  COALESCE((payload->>'frozenAt')::timestamptz, (payload->>'createdAt')::timestamptz) + interval '10 years',",
    "  COALESCE((payload->>'legalHold')::boolean, false)",
    "FROM source",
    "ON CONFLICT (batch_id) DO NOTHING;",
    "INSERT INTO health_platform.pilot_evidence_batch_versions (batch_id, revision, payload, payload_sha256, actor, recorded_at)",
    "SELECT batch_id, revision, payload, payload_sha256, 'baseline-migration', updated_at",
    "FROM health_platform.pilot_evidence_batches",
    "ON CONFLICT (batch_id, revision) DO NOTHING;",
    "COMMIT;",
    ""
  ].join("\n");
}

function pilotEvidenceVerifySql() {
  return [
    "\\set ON_ERROR_STOP on",
    "SELECT count(*) AS projected_batches FROM health_platform.pilot_evidence_batches;",
    "SELECT count(*) AS projected_versions FROM health_platform.pilot_evidence_batch_versions;",
    "SELECT count(*) AS invalid_batches FROM health_platform.pilot_evidence_batches",
    "WHERE revision < 1 OR retention_until < created_at",
    "   OR payload_sha256 !~ '^[a-f0-9]{64}$'",
    "   OR (status = 'frozen' AND (frozen_at IS NULL OR manifest_sha256 !~ '^[a-f0-9]{64}$'));",
    "SELECT count(*) AS missing_versions FROM health_platform.pilot_evidence_batches b",
    "WHERE NOT EXISTS (",
    "  SELECT 1 FROM health_platform.pilot_evidence_batch_versions v",
    "  WHERE v.batch_id = b.batch_id AND v.revision = b.revision AND v.payload_sha256 = b.payload_sha256",
    ");",
    ""
  ].join("\n");
}

function buildPilotEvidencePostgresReadiness(options = {}) {
  const batches = options.batches || [];
  const env = options.env || {};
  const years = retentionYears(env.PILOT_EVIDENCE_RETENTION_YEARS || options.retentionYears);
  const rows = buildPilotEvidenceProjection(batches, { retentionYears: years });
  const evidence = {
    backup: String(env.POSTGRES_BACKUP_EVIDENCE_ID || "").trim(),
    recovery: String(env.POSTGRES_RTO_RPO_EVIDENCE_ID || "").trim(),
    restoreRehearsal: String(env.PILOT_EVIDENCE_RESTORE_EVIDENCE_ID || "").trim(),
    cutoverApproval: String(env.POSTGRES_CUTOVER_APPROVAL_ID || "").trim()
  };
  const checks = [
    { id: "pilotEvidencePostgres:projection", passed: rows.length === batches.length, detail: `${rows.length} batches projected` },
    { id: "pilotEvidencePostgres:retention", passed: years >= MINIMUM_RETENTION_YEARS, detail: `${years} years` },
    { id: "pilotEvidencePostgres:backupEvidence", passed: evidence.backup.length >= 4, detail: evidence.backup ? "provided" : "missing" },
    { id: "pilotEvidencePostgres:recoveryEvidence", passed: evidence.recovery.length >= 4 && evidence.restoreRehearsal.length >= 4, detail: evidence.recovery && evidence.restoreRehearsal ? "provided" : "missing" },
    { id: "pilotEvidencePostgres:cutoverApproval", passed: evidence.cutoverApproval.length >= 4, detail: evidence.cutoverApproval ? "provided" : "missing" }
  ];
  return {
    softwareReady: checks.slice(0, 2).every((item) => item.passed),
    productionReady: checks.every((item) => item.passed),
    retentionYears: years,
    projectedBatches: rows.length,
    checks,
    evidencePersisted: false,
    payloadsExposed: false
  };
}

module.exports = {
  MINIMUM_RETENTION_YEARS,
  PILOT_EVIDENCE_COLLECTION,
  PilotEvidencePostgresError,
  buildPilotEvidencePostgresReadiness,
  buildPilotEvidenceProjection,
  pilotEvidenceLoadSql,
  pilotEvidenceSchemaStatements,
  pilotEvidenceVerifySql,
  projectPilotEvidenceBatch
};
