"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const Readiness = require("../scripts/insurance-payment-postgres-readiness");

const readyEnv = {
  INSURANCE_PAYMENT_POSTGRES_MODE: "evidence-gated",
  DATABASE_URL: "postgresql://db.example/insurance",
  POSTGRES_SSL_MODE: "verify-full",
  INSURANCE_PAYMENT_MIGRATION_EVIDENCE_ID: "migration-change-001",
  INSURANCE_PAYMENT_BACKUP_EVIDENCE_ID: "backup-evidence-001",
  INSURANCE_PAYMENT_RECOVERY_EVIDENCE_ID: "restore-drill-001",
  INSURANCE_PAYMENT_CUTOVER_APPROVAL_ID: "cutover-approval-001"
};

test("PostgreSQL readiness keeps local foundation separate from live cutover", () => {
  const report = Readiness.buildReadiness({}, null, "2026-07-29T03:00:00.000Z");
  assert.equal(report.localFoundationReady, true);
  assert.equal(report.writeEnabled, false);
  assert.equal(report.schemaVerified, false);
  assert.equal(report.productionPrimary, false);
  assert.ok(report.blockers.includes("database-url-configured"));
  assert.ok(report.blockers.includes("schema-verified"));
  assert.equal(Readiness.shouldFail(report), false);
  assert.equal(Readiness.shouldFail(report, { "require-write-ready": true }), true);
  assert.equal(Readiness.shouldFail(report, { "require-schema": true }), true);
  assert.doesNotMatch(JSON.stringify(report), /DATABASE_URL|password|secret@/i);
});

test("PostgreSQL readiness requires both evidence-gated config and verified schema in strict mode", () => {
  const withoutSchema = Readiness.buildReadiness(readyEnv, null, "2026-07-29T03:00:00.000Z");
  assert.equal(withoutSchema.writeEnabled, true);
  assert.equal(Readiness.shouldFail(withoutSchema, { "require-write-ready": true }), false);
  assert.equal(Readiness.shouldFail(withoutSchema, { "require-schema": true }), true);

  const complete = Readiness.buildReadiness(readyEnv, {
    ok: true,
    checks: { aggregates: true, commands: true, outbox: true }
  }, "2026-07-29T03:01:00.000Z");
  assert.equal(complete.schemaVerified, true);
  assert.deepEqual(complete.blockers, []);
  assert.equal(Readiness.shouldFail(complete, { "require-write-ready": true, "require-schema": true }), false);
  assert.equal(complete.productionPrimary, false);
});

test("PostgreSQL readiness parser preserves strict and output flags", () => {
  assert.deepEqual(Readiness.parseArgs(["--verify-schema", "--require-schema", "--require-write-ready", "--output=tmp/pg.json"]), {
    "verify-schema": true,
    "require-schema": true,
    "require-write-ready": true,
    output: "tmp/pg.json"
  });
});
