"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { auditHashFor } = require("../src/identity-security/audit-chain");
const {
  AuditGovernanceCenterError,
  buildAuditGovernanceCenter,
  deliveryConfiguration
} = require("../src/identity-security/audit-governance-center");

function sealNewestFirst(rows) {
  const sealed = new Array(rows.length);
  let previousAuditHash = "";
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = { ...rows[index], previousAuditHash };
    row.auditHash = auditHashFor(row);
    sealed[index] = row;
    previousAuditHash = row.auditHash;
  }
  return sealed;
}

function fixture() {
  return {
    securityEvents: sealNewestFirst([
      { id: "event-2", at: "2026-09-06T08:02:00.000Z", actor: "must-not-leak-actor", role: "commission", action: "登录", target: "must-not-leak-target", result: "允许", detail: "must-not-leak-detail" },
      { id: "event-1", at: "2026-09-05T08:01:00.000Z", actor: "must-not-leak-actor-2", role: "institution", action: "访问接口", target: "must-not-leak-target-2", result: "拒绝", detail: "scope denied" }
    ]),
    dataAccessLogs: sealNewestFirst([
      { id: "access-1", at: "2026/9/6 08:03:00", actor: "must-not-leak-access-actor", role: "医生", personIndex: "must-not-leak-person", residentId: "must-not-leak-resident", scope: "must-not-leak-scope", purpose: "must-not-leak-purpose", result: "允许" }
    ]),
    residents: [{ name: "must-not-read-residents" }],
    authUsers: [{ name: "must-not-read-auth-users" }]
  };
}

test("platform audit governance center exposes only fixed aggregate metadata", () => {
  const center = buildAuditGovernanceCenter(fixture(), { role: "commission", username: "health" }, {
    environment: {
      AUDIT_DELIVERY_SOURCE_CONTRACT: "append-only-audit-source-v2",
      SIEM_AUDIT_ENDPOINT: "https://audit.example.test/events"
    }
  });
  assert.equal(center.schemaVersion, "platform-audit-governance-center-v1");
  assert.equal(center.capabilityId, "L-GOV-AUDIT");
  assert.equal(center.productionReady, false);
  assert.equal(center.decision, "NO-GO");
  assert.equal(center.summary.sources, 2);
  assert.equal(center.summary.totalRecords, 3);
  assert.equal(center.summary.dataAccessRecords, 1);
  assert.equal(center.summary.deniedEvents, 1);
  assert.equal(center.summary.highRiskEvents, 1);
  assert.equal(center.sources.every((source) => source.integrityPassed && !source.detailVisible), true);
  assert.equal(center.delivery.sourceContractConfigured, true);
  assert.equal(center.delivery.exactlyOneDeliveryTargetConfigured, true);
  assert.equal(center.delivery.trustedExternalReceiptObserved, false);
  assert.equal(center.actions.viewRawEvents, false);
  assert.equal(center.actions.exportRawEvents, false);
  assert.equal(center.actions.repairAuditChain, false);
  assert.equal(center.actions.activateDeliveryWorker, false);
  const serialized = JSON.stringify(center);
  for (const forbidden of ["must-not-leak-actor", "must-not-leak-target", "must-not-leak-detail", "must-not-leak-person", "must-not-leak-resident", "must-not-leak-scope", "must-not-leak-purpose"]) {
    assert.doesNotMatch(serialized, new RegExp(forbidden));
  }
});

test("platform audit governance center reads only its two authorized audit sources", () => {
  const guarded = new Proxy(fixture(), {
    get(target, property, receiver) {
      if (!["securityEvents", "dataAccessLogs"].includes(String(property))) throw new Error(`forbidden source read: ${String(property)}`);
      return Reflect.get(target, property, receiver);
    }
  });
  const center = buildAuditGovernanceCenter(guarded, { role: "commission" });
  assert.equal(center.summary.totalRecords, 3);
});

test("platform audit governance center rejects unauthorized roles and malformed sources", () => {
  assert.throws(
    () => buildAuditGovernanceCenter(fixture(), { role: "institution" }),
    (error) => error instanceof AuditGovernanceCenterError && error.code === "AUDIT_GOVERNANCE_ROLE_FORBIDDEN" && error.statusCode === 403
  );
  const malformed = fixture();
  malformed.dataAccessLogs = {};
  assert.throws(
    () => buildAuditGovernanceCenter(malformed, { role: "commission" }),
    (error) => error instanceof AuditGovernanceCenterError && error.code === "AUDIT_GOVERNANCE_SOURCE_INVALID" && error.statusCode === 503
  );
});

test("platform audit governance center fails closed on any chain corruption", () => {
  const tampered = fixture();
  tampered.securityEvents[0] = { ...tampered.securityEvents[0], detail: "changed-after-seal" };
  assert.throws(
    () => buildAuditGovernanceCenter(tampered, { role: "commission" }),
    (error) => error instanceof AuditGovernanceCenterError && error.code === "AUDIT_GOVERNANCE_INTEGRITY_FAILED" && error.statusCode === 503
  );
});

test("delivery configuration exposes booleans without configuration values or authority", () => {
  const delivery = deliveryConfiguration({
    AUDIT_DELIVERY_SOURCE_CONTRACT: "append-only-audit-source-v2",
    AUDIT_WORM_DIRECTORY: "must-not-leak-worm-path",
    AUDIT_EXPORT_PATH: "must-not-leak-export-path"
  });
  assert.equal(delivery.sourceContractConfigured, true);
  assert.equal(delivery.wormTargetConfigured, true);
  assert.equal(delivery.retentionTargetConfigured, true);
  assert.equal(delivery.productionReady, false);
  assert.equal(delivery.workerActivationAuthorized, false);
  assert.doesNotMatch(JSON.stringify(delivery), /must-not-leak/);
});
