"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  activatePublicHealthSurveillanceRuleChangeToState,
  buildPublicHealthSurveillanceRuleGovernance,
  buildTrustedPublicHealthSurveillanceRuleRegistry,
  proposePublicHealthSurveillanceRuleChangeToState,
  reviewPublicHealthSurveillanceRuleChangeToState,
  verifyPublicHealthSurveillanceRuleActivationReceipt
} = require("../public-health-surveillance-rule-governance-service");

const SECRET = "public-health-rule-governance-test-secret-2026";
const NEXT_SECRET = "public-health-rule-governance-next-secret-2026";
const OLD_KEYRING = {
  purpose: "public-health-surveillance-rule-activation",
  activeKeyId: "rule-key-2026-a",
  keys: [{
    keyId: "rule-key-2026-a",
    secret: SECRET,
    status: "active",
    notBefore: "2026-01-01T00:00:00.000Z",
    expiresAt: "2027-01-01T00:00:00.000Z",
    revokedAt: ""
  }]
};
const ROTATED_KEYRING = {
  purpose: "public-health-surveillance-rule-activation",
  activeKeyId: "rule-key-2026-b",
  keys: [
    {
      ...OLD_KEYRING.keys[0],
      status: "grace"
    },
    {
      keyId: "rule-key-2026-b",
      secret: NEXT_SECRET,
      status: "active",
      notBefore: "2026-07-28T11:11:00.000Z",
      expiresAt: "2027-07-28T00:00:00.000Z",
      revokedAt: ""
    }
  ]
};

function proposalPayload(overrides = {}) {
  return {
    ruleId: "ph-rule-clinical-syndrome",
    expectedCurrentVersion: 1,
    threshold: 10,
    severity: "high",
    status: "active",
    reason: "经流行病学复核调整症候群聚集阈值",
    evidenceRefs: ["RULE-CHANGE-EVIDENCE-001"],
    idempotencyKey: "rule-change-submit-001",
    at: "2026-07-28T11:00:00.000Z",
    ...overrides
  };
}

function activateTrustedChange(data = {}, activationOptions = {
  verificationSecret: SECRET,
  keyId: "rule-governance-test-key"
}) {
  let result = proposePublicHealthSurveillanceRuleChangeToState(
    data,
    proposalPayload(),
    { name: "疾控规则管理员", role: "cdc-surveillance" }
  );
  result = reviewPublicHealthSurveillanceRuleChangeToState(
    result.nextData,
    result.change.id,
    {
      decision: "approved",
      note: "委级独立复核通过",
      evidenceRefs: ["COMMISSION-REVIEW-001"],
      idempotencyKey: "rule-change-review-001",
      expectedVersion: 1,
      at: "2026-07-28T11:05:00.000Z"
    },
    { name: "委级规则复核员", role: "commission" }
  );
  return activatePublicHealthSurveillanceRuleChangeToState(
    result.nextData,
    result.change.id,
    {
      note: "进入受控规则生效窗口",
      evidenceRefs: ["CONTROLLED-ACTIVATION-001"],
      idempotencyKey: "rule-change-activate-001",
      expectedVersion: 2,
      at: "2026-07-28T11:10:00.000Z"
    },
    { name: "规则配置服务", role: "system" },
    activationOptions
  );
}

test("trusted independent review and server activation advances one rule version", () => {
  const activated = activateTrustedChange();
  assert.equal(activated.change.status, "activated");
  assert.equal(activated.change.toVersion, 2);
  assert.equal(verifyPublicHealthSurveillanceRuleActivationReceipt(activated.change, SECRET), true);
  const registry = buildTrustedPublicHealthSurveillanceRuleRegistry(
    activated.nextData,
    { verificationSecret: SECRET }
  );
  const rule = registry.rules.find((item) => item.id === "ph-rule-clinical-syndrome");
  assert.equal(registry.ok, true);
  assert.equal(registry.trustedChanges.length, 1);
  assert.equal(rule.version, 2);
  assert.equal(rule.threshold, 10);
  assert.equal(registry.productionReady, false);
  const board = buildPublicHealthSurveillanceRuleGovernance({
    data: activated.nextData,
    verificationSecret: SECRET
  });
  assert.equal(board.summary.rules, 8);
  assert.equal(board.summary.trustedActivations, 1);
  assert.equal(board.productionReady, false);
});

test("direct persisted threshold replacement is ignored and surfaced", () => {
  const registry = buildTrustedPublicHealthSurveillanceRuleRegistry({
    publicHealthSurveillanceRules: [{
      id: "ph-rule-clinical-syndrome",
      version: 99,
      signalType: "clinical-syndrome",
      metricCode: "fever-respiratory-count",
      operator: ">=",
      threshold: 999,
      severity: "low",
      status: "active",
      owner: "伪造规则来源"
    }]
  });
  const rule = registry.rules.find((item) => item.id === "ph-rule-clinical-syndrome");
  assert.equal(registry.ok, false);
  assert.equal(registry.findings.some((item) => item.code === "ungoverned-rule-materialization"), true);
  assert.equal(rule.version, 1);
  assert.equal(rule.threshold, 5);
});

test("post-signing threshold source and signature flags cannot preserve trust", () => {
  const activated = activateTrustedChange();
  const tamperedThreshold = JSON.parse(JSON.stringify(activated.nextData));
  tamperedThreshold.publicHealthSurveillanceRuleChanges[0].proposed.threshold = 1;
  let registry = buildTrustedPublicHealthSurveillanceRuleRegistry(
    tamperedThreshold,
    { verificationSecret: SECRET }
  );
  assert.equal(registry.ok, false);
  assert.equal(registry.trustedChanges.length, 0);
  assert.equal(registry.findings.some((item) => item.code === "trusted-rule-activation-receipt-invalid"), true);

  const tamperedSource = JSON.parse(JSON.stringify(activated.nextData));
  tamperedSource.publicHealthSurveillanceRuleChanges[0].activation.receipt.verificationSource = "untrusted-client";
  registry = buildTrustedPublicHealthSurveillanceRuleRegistry(
    tamperedSource,
    { verificationSecret: SECRET }
  );
  assert.equal(registry.trustedChanges.length, 0);
  assert.equal(registry.findings.some((item) => item.code === "trusted-rule-activation-receipt-invalid"), true);

  const tamperedFlag = JSON.parse(JSON.stringify(activated.nextData));
  tamperedFlag.publicHealthSurveillanceRuleChanges[0].activation.receipt.signatureVerified = false;
  registry = buildTrustedPublicHealthSurveillanceRuleRegistry(
    tamperedFlag,
    { verificationSecret: SECRET }
  );
  assert.equal(registry.trustedChanges.length, 0);
  assert.equal(registry.productionReady, false);
});

test("rule governance enforces roles independent review versions and payload-bound idempotency", () => {
  assert.throws(() => proposePublicHealthSurveillanceRuleChangeToState(
    {},
    proposalPayload(),
    { name: "居民", role: "resident" }
  ), /not allowed/);
  const proposed = proposePublicHealthSurveillanceRuleChangeToState(
    {},
    proposalPayload(),
    { name: "同一操作员", role: "commission" }
  );
  const replay = proposePublicHealthSurveillanceRuleChangeToState(
    proposed.nextData,
    proposalPayload(),
    { name: "同一操作员", role: "commission" }
  );
  assert.equal(replay.idempotent, true);
  assert.throws(() => proposePublicHealthSurveillanceRuleChangeToState(
    proposed.nextData,
    proposalPayload({ threshold: 1 }),
    { name: "同一操作员", role: "commission" }
  ), /already targets/);
  assert.throws(() => reviewPublicHealthSurveillanceRuleChangeToState(
    proposed.nextData,
    proposed.change.id,
    {
      decision: "approved",
      note: "本人复核",
      evidenceRefs: ["SELF-REVIEW"],
      idempotencyKey: "self-review"
    },
    { name: "同一操作员", role: "commission" }
  ), /independent/);
  assert.throws(() => activatePublicHealthSurveillanceRuleChangeToState(
    proposed.nextData,
    proposed.change.id,
    {
      note: "越过复核",
      evidenceRefs: ["FORGED-ACTIVATION"],
      idempotencyKey: "forged-activation"
    },
    { name: "规则配置服务", role: "system" },
    { verificationSecret: SECRET }
  ), /not allowed from submitted/);
});

test("managed key rotation verifies grace history and signs the next version with the active key", () => {
  const firstActivation = activateTrustedChange({}, { activationKeyring: OLD_KEYRING });
  assert.equal(firstActivation.change.activation.receipt.keyId, "rule-key-2026-a");
  let registry = buildTrustedPublicHealthSurveillanceRuleRegistry(
    firstActivation.nextData,
    { activationKeyring: ROTATED_KEYRING }
  );
  assert.equal(registry.ok, true);
  assert.equal(registry.trustedChanges.length, 1);

  let second = proposePublicHealthSurveillanceRuleChangeToState(
    firstActivation.nextData,
    {
      ruleId: "ph-rule-clinical-syndrome",
      expectedCurrentVersion: 2,
      threshold: 12,
      severity: "medium",
      status: "active",
      reason: "轮换后创建第三版规则",
      evidenceRefs: ["RULE-V3-PROPOSAL"],
      idempotencyKey: "rule-v3-submit",
      at: "2026-07-28T11:12:00.000Z"
    },
    { id: "cdc-rule-owner-002", name: "疾控规则管理员二", role: "cdc-surveillance" },
    { activationKeyring: ROTATED_KEYRING }
  );
  second = reviewPublicHealthSurveillanceRuleChangeToState(
    second.nextData,
    second.change.id,
    {
      decision: "approved",
      note: "独立复核第三版规则",
      evidenceRefs: ["RULE-V3-REVIEW"],
      idempotencyKey: "rule-v3-review",
      expectedVersion: 1,
      at: "2026-07-28T11:13:00.000Z"
    },
    { id: "commission-reviewer-002", name: "委级规则复核员二", role: "commission" }
  );
  second = activatePublicHealthSurveillanceRuleChangeToState(
    second.nextData,
    second.change.id,
    {
      note: "使用轮换后活动密钥激活",
      evidenceRefs: ["RULE-V3-ACTIVATION"],
      idempotencyKey: "rule-v3-activate",
      expectedVersion: 2,
      at: "2026-07-28T11:14:00.000Z"
    },
    { id: "rule-service-002", name: "规则配置服务", role: "system" },
    { activationKeyring: ROTATED_KEYRING }
  );
  assert.equal(second.change.activation.receipt.keyId, "rule-key-2026-b");
  registry = buildTrustedPublicHealthSurveillanceRuleRegistry(
    second.nextData,
    { activationKeyring: ROTATED_KEYRING }
  );
  const current = registry.rules.find((item) => item.id === "ph-rule-clinical-syndrome");
  assert.equal(registry.ok, true);
  assert.equal(registry.trustedChanges.length, 2);
  assert.equal(registry.ruleVersions.length, 10);
  assert.equal(current.version, 3);
  assert.equal(current.threshold, 12);

  const board = buildPublicHealthSurveillanceRuleGovernance({
    data: second.nextData,
    activationKeyring: ROTATED_KEYRING,
    at: "2026-07-28T11:15:00.000Z"
  });
  assert.equal(board.summary.managedKeyringReady, true);
  assert.equal(board.keyring.activeKeyId, "rule-key-2026-b");
  assert.equal(JSON.stringify(board).includes(SECRET), false);
  assert.equal(JSON.stringify(board).includes(NEXT_SECRET), false);
  assert.equal(board.productionReady, false);
});

test("revoked historical keys and post-signing keyId changes fail closed", () => {
  const firstActivation = activateTrustedChange({}, { activationKeyring: OLD_KEYRING });
  const revokedKeyring = {
    ...ROTATED_KEYRING,
    keys: ROTATED_KEYRING.keys.map((item) => item.keyId === "rule-key-2026-a"
      ? { ...item, status: "revoked", revokedAt: "2026-07-28T11:20:00.000Z" }
      : item)
  };
  let registry = buildTrustedPublicHealthSurveillanceRuleRegistry(
    firstActivation.nextData,
    { activationKeyring: revokedKeyring }
  );
  assert.equal(registry.ok, false);
  assert.equal(registry.trustedChanges.length, 0);
  assert.equal(registry.findings.some((item) => item.code === "trusted-rule-activation-receipt-invalid"), true);

  const tampered = JSON.parse(JSON.stringify(firstActivation.nextData));
  tampered.publicHealthSurveillanceRuleChanges[0].activation.receipt.keyId = "rule-key-2026-b";
  registry = buildTrustedPublicHealthSurveillanceRuleRegistry(
    tampered,
    { activationKeyring: ROTATED_KEYRING }
  );
  assert.equal(registry.ok, false);
  assert.equal(registry.trustedChanges.length, 0);
  assert.equal(registry.productionReady, false);

  const wrongPurposeKeyring = {
    ...OLD_KEYRING,
    purpose: "public-health-external-request-signing"
  };
  assert.throws(
    () => activateTrustedChange({}, { activationKeyring: wrongPurposeKeyring }),
    /keyring purpose must be public-health-surveillance-rule-activation/
  );

  registry = buildTrustedPublicHealthSurveillanceRuleRegistry(
    firstActivation.nextData,
    { activationKeyring: { ...ROTATED_KEYRING, purpose: "public-health-external-request-signing" } }
  );
  assert.equal(registry.ok, false);
  assert.equal(registry.findings.some((item) => item.code === "trusted-rule-activation-receipt-invalid"), true);
});
