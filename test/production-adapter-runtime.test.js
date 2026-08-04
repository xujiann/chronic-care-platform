"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createProductionAdapterRuntime,
  validateExternalAuthorization
} = require("../src/platform/composition/production-adapter-runtime");

const NOW = "2030-08-04T00:00:00.000Z";

function approval() {
  return {
    releaseId: "release-20300804",
    evidenceFingerprint: `sha256:${"a".repeat(64)}`,
    approvedAt: "2030-08-03T23:00:00.000Z",
    expiresAt: "2030-08-04T02:00:00.000Z",
    decision: "GO",
    confirmation: "APPROVE PRODUCTION ADAPTER CUTOVER",
    approvals: [
      { role: "platform-operations", account: "ops-1", status: "approved", evidenceRef: "vault://approval/ops" },
      { role: "security-compliance", account: "security-1", status: "approved", evidenceRef: "vault://approval/security" },
      { role: "data-platform", account: "data-1", status: "approved", evidenceRef: "vault://approval/data" },
      { role: "project-owner", account: "owner-1", status: "approved", evidenceRef: "vault://approval/owner" }
    ]
  };
}

function productionEnv() {
  return {
    PLATFORM_PRODUCTION_ADAPTER_MODE: "cutover-gated",
    PLATFORM_PRODUCTION_WORKERS_ENABLED: "true",
    PLATFORM_PRODUCTION_WORKER_ID: "central-worker-1",
    DATABASE_URL: "postgresql://runtime.invalid/platform",
    POSTGRES_SSL_MODE: "verify-full",
    IDENTITY_SECURITY_AUDIT_POSTGRES_MODE: "evidence-gated",
    IDENTITY_SECURITY_AUDIT_MIGRATION_EVIDENCE_ID: "migration-identity",
    IDENTITY_SECURITY_AUDIT_BACKUP_EVIDENCE_ID: "backup-identity",
    IDENTITY_SECURITY_AUDIT_RECOVERY_EVIDENCE_ID: "recovery-identity",
    IDENTITY_SECURITY_AUDIT_CUTOVER_APPROVAL_ID: "cutover-identity",
    REFERRAL_DELIVERY_POSTGRES_MODE: "evidence-gated",
    REFERRAL_DELIVERY_MIGRATION_EVIDENCE_ID: "migration-referral",
    REFERRAL_DELIVERY_BACKUP_EVIDENCE_ID: "backup-referral",
    REFERRAL_DELIVERY_RECOVERY_EVIDENCE_ID: "recovery-referral",
    REFERRAL_DELIVERY_CUTOVER_APPROVAL_ID: "cutover-referral",
    REFERRAL_DELIVERY_POSTGRES_TLS_PROBE_EVIDENCE_ID: "tls-referral",
    EMERGENCY_SIGNAL_POSTGRES_MODE: "evidence-gated",
    EMERGENCY_SIGNAL_MIGRATION_EVIDENCE_ID: "migration-emergency",
    EMERGENCY_SIGNAL_BACKUP_EVIDENCE_ID: "backup-emergency",
    EMERGENCY_SIGNAL_RECOVERY_EVIDENCE_ID: "recovery-emergency",
    EMERGENCY_SIGNAL_CUTOVER_APPROVAL_ID: "cutover-emergency"
  };
}

function fakeFactories(records = []) {
  const repository = (id) => ({
    verifySchema: async () => ({
      ok: true,
      checks: { outbox: true, audit: true },
      migration: { sha256: `sha256:${id[0].repeat(64)}` }
    }),
    claim: async () => [],
    acknowledge: async () => undefined,
    fail: async () => undefined,
    close: async () => records.push(`closed:${id}`)
  });
  return {
    identityRepository: () => repository("identity"),
    referralRepository: () => repository("referral"),
    emergencyRepository: () => repository("emergency"),
    referralTransport: () => async () => ({ status: "accepted" }),
    emergencyTransport: () => async () => ({ status: "delivered" })
  };
}

test("environment flags alone never create external authorization", async () => {
  const runtime = createProductionAdapterRuntime({
    env: productionEnv(),
    factories: fakeFactories(),
    now: () => NOW
  });
  try {
    const report = await runtime.readiness({ verifySchemas: true });
    assert.equal(report.localChecks.schemaVerified, true);
    assert.equal(report.externalAuthorization.ok, false);
    assert.equal(report.workersEligible, false);
    assert.equal(report.productionReady, false);
    assert.equal(report.productionPrimary, false);
    assert.doesNotMatch(JSON.stringify(report), /postgresql:\/\/|password|secret/i);
  } finally {
    await runtime.close();
  }
});

test("central runtime verifies every schema before an explicitly activated worker can run", async () => {
  const closed = [];
  const runtime = createProductionAdapterRuntime({
    env: productionEnv(),
    externalAuthorization: approval(),
    activateWorkers: true,
    factories: fakeFactories(closed),
    now: () => NOW
  });
  await assert.rejects(
    () => runtime.runWorkerOnce("referral"),
    (error) => error.code === "PLATFORM_PRODUCTION_WORKER_GATE_BLOCKED"
  );
  const report = await runtime.readiness({ verifySchemas: true });
  assert.equal(report.workersEligible, true);
  const result = await runtime.runWorkerOnce("referral", { runId: "run-1" });
  assert.equal(result.claimed, 0);
  assert.equal(result.productionReady, false);
  await runtime.close();
  assert.deepEqual(closed.sort(), ["closed:emergency", "closed:identity", "closed:referral"]);
});

test("external authorization requires four independent roles and a current explicit decision", () => {
  const valid = validateExternalAuthorization(approval(), NOW);
  assert.equal(valid.ok, true);
  const duplicate = approval();
  duplicate.approvals[3].account = "ops-1";
  assert.equal(validateExternalAuthorization(duplicate, NOW).ok, false);
  assert.equal(validateExternalAuthorization({ ...approval(), decision: "NO-GO" }, NOW).ok, false);
});

test("central composition forwards pool TLS evidence and the injected transport implementation", async () => {
  const captured = {};
  const makeRepository = (id) => (options) => {
    captured[id] = options;
    return {
      verifySchema: async () => ({ ok: true, checks: { schema: true } }),
      claim: async () => [],
      acknowledge: async () => undefined,
      fail: async () => undefined,
      close: async () => undefined
    };
  };
  const fetchImpl = async () => { throw new Error("not called without claims"); };
  const runtime = createProductionAdapterRuntime({
    env: productionEnv(),
    externalAuthorization: approval(),
    activateWorkers: true,
    pools: { identity: {}, referral: {}, emergency: {} },
    poolSecurityEvidence: {
      identity: { evidenceId: "identity-tls" },
      referral: { evidenceId: "referral-tls" },
      emergency: { evidenceId: "emergency-tls" }
    },
    fetch: fetchImpl,
    factories: {
      identityRepository: makeRepository("identity"),
      referralRepository: makeRepository("referral"),
      emergencyRepository: makeRepository("emergency"),
      referralTransport: (options) => {
        captured.referralTransport = options;
        return async () => ({});
      },
      emergencyTransport: () => async () => ({})
    },
    now: () => NOW
  });
  await runtime.readiness({ verifySchemas: true });
  await runtime.runWorkerOnce("referral");
  assert.equal(captured.identity.poolTlsVerification.evidenceId, "identity-tls");
  assert.equal(captured.referral.tlsProbeEvidence.evidenceId, "referral-tls");
  assert.equal(captured.emergency.poolTlsVerification.evidenceId, "emergency-tls");
  assert.equal(captured.referralTransport.fetchImpl, fetchImpl);
  await runtime.close();
});

test("shadow relay eligibility is adapter-local and never grants production cutover", async () => {
  const runtime = createProductionAdapterRuntime({
    env: { ...productionEnv(), PLATFORM_PRODUCTION_ADAPTER_MODE: "shadow" },
    factories: fakeFactories(),
    now: () => NOW
  });
  const before = await runtime.shadowRelayReadiness("referral");
  assert.equal(before.eligible, false);
  assert.equal(before.checks.schemaVerified, false);
  const verified = await runtime.shadowRelayReadiness("referral", { verifySchema: true });
  assert.equal(verified.eligible, true);
  assert.equal(verified.externalAuthorizationRequired, false);
  assert.equal(verified.productionReady, false);
  assert.equal(verified.productionPrimary, false);
  await runtime.close();
});
