const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildPilotEvidencePostgresReadiness,
  buildPilotEvidenceProjection,
  pilotEvidenceLoadSql,
  pilotEvidenceSchemaStatements,
  pilotEvidenceVerifySql,
  projectPilotEvidenceBatch
} = require("../pilot-evidence-postgres");

function sampleBatch(overrides = {}) {
  return {
    id: "pilot-batch-1",
    organizationCode: "ORG-PILOT-01",
    pilotId: "DL-PILOT-01",
    hospitalName: "Pilot Hospital",
    title: "First pilot acceptance",
    status: "open",
    revision: 3,
    createdAt: "2026-07-26T00:00:00.000Z",
    requirements: [],
    artifacts: [],
    auditEvents: [{
      sequence: 1,
      action: "batch-created",
      at: "2026-07-26T01:00:00.000Z",
      chainHash: "a".repeat(64)
    }],
    acceptancePack: null,
    ...overrides
  };
}

test("pilot evidence PostgreSQL projection validates identity revision retention and digest", () => {
  const rows = buildPilotEvidenceProjection([sampleBatch()], { retentionYears: 12 });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].organizationCode, "ORG-PILOT-01");
  assert.equal(rows[0].revision, 3);
  assert.equal(rows[0].retentionUntil, "2038-07-26T00:00:00.000Z");
  assert.match(rows[0].payloadSha256, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify({
    batchId: rows[0].batchId,
    payloadSha256: rows[0].payloadSha256
  }), /Pilot Hospital/);

  assert.throws(
    () => projectPilotEvidenceBatch(sampleBatch({ revision: 0 })),
    (error) => error.code === "PILOT_EVIDENCE_PROJECTION_INVALID"
  );
  assert.throws(
    () => projectPilotEvidenceBatch(sampleBatch(), { retentionYears: 5 }),
    (error) => error.code === "PILOT_EVIDENCE_RETENTION_INVALID"
  );
});

test("frozen pilot evidence projection requires a valid manifest", () => {
  const frozen = sampleBatch({
    status: "frozen",
    frozenAt: "2026-07-26T04:00:00.000Z",
    acceptancePack: { manifestSha256: "b".repeat(64) }
  });
  const row = projectPilotEvidenceBatch(frozen);
  assert.equal(row.status, "frozen");
  assert.equal(row.manifestSha256, "b".repeat(64));
  assert.equal(row.retentionUntil, "2036-07-26T04:00:00.000Z");
  assert.throws(
    () => projectPilotEvidenceBatch({ ...frozen, acceptancePack: null }),
    (error) => error.code === "PILOT_EVIDENCE_MANIFEST_INVALID"
  );
});

test("pilot evidence SQL contract keeps versions append-only and independently verifiable", () => {
  const schema = pilotEvidenceSchemaStatements().join("\n");
  assert.match(schema, /health_platform\.pilot_evidence_batches/);
  assert.match(schema, /health_platform\.pilot_evidence_batch_versions/);
  assert.match(schema, /reject_pilot_evidence_version_mutation/);
  assert.match(schema, /BEFORE UPDATE OR DELETE/);
  assert.match(schema, /retention_until/);
  assert.match(pilotEvidenceLoadSql(), /pilotEvidenceBatches/);
  assert.match(pilotEvidenceLoadSql(), /baseline-migration/);
  assert.match(pilotEvidenceVerifySql(), /missing_versions/);
});

test("pilot evidence PostgreSQL readiness separates software controls from site evidence", () => {
  const pending = buildPilotEvidencePostgresReadiness({ batches: [sampleBatch()] });
  assert.equal(pending.softwareReady, true);
  assert.equal(pending.productionReady, false);
  assert.equal(pending.checks.filter((item) => item.passed).length, 2);

  const accepted = buildPilotEvidencePostgresReadiness({
    batches: [sampleBatch()],
    env: {
      PILOT_EVIDENCE_RETENTION_YEARS: "15",
      POSTGRES_BACKUP_EVIDENCE_ID: "BACKUP-2026-001",
      POSTGRES_RTO_RPO_EVIDENCE_ID: "DR-2026-001",
      PILOT_EVIDENCE_RESTORE_EVIDENCE_ID: "RESTORE-2026-001",
      POSTGRES_CUTOVER_APPROVAL_ID: "CAB-2026-001"
    }
  });
  assert.equal(accepted.productionReady, true);
  assert.equal(accepted.retentionYears, 15);
  assert.equal(accepted.evidencePersisted, false);
});
