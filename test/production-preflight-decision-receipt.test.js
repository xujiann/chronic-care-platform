"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { assessProductionPreflightDecisionReceipt } = require("../production-preflight-decision-receipt");
const { buildRuntimeProductionGoNoGoCenter } = require("../server");
const { seedPlatformProductionBlockerReviews } = require("../platform-capability-operations");
const { seedProductionSecurityFindings, seedProductionSecurityReleaseApprovals } = require("../production-security-acceptance");

const NOW = "2026-08-23T08:00:00.000Z";
const expected = {
  releaseId: "release-2026-08-23-001",
  artifactDigest: `sha256:${"a".repeat(64)}`,
  evidenceFingerprint: "b".repeat(64)
};

function receipt(overrides = {}) {
  return {
    contract: "production-preflight-decision-receipt.v1",
    receiptId: "receipt-20260823-0001",
    decision: "GO",
    ...expected,
    issuedAt: "2026-08-23T07:50:00.000Z",
    expiresAt: "2026-08-23T08:10:00.000Z",
    ...overrides
  };
}

function verdict(candidate, overrides = {}) {
  return {
    verified: true,
    verifierId: "change-authority-verifier",
    receiptId: candidate.receiptId,
    releaseId: candidate.releaseId,
    artifactDigest: candidate.artifactDigest,
    evidenceFingerprint: candidate.evidenceFingerprint,
    replayDetected: false,
    singleUseEnforced: true,
    verifiedAt: "2026-08-23T07:55:00.000Z",
    ...overrides
  };
}

test("trusted receipt requires exact release, artifact and evidence binding", () => {
  for (const [field, value, code] of [
    ["releaseId", "release-drift", "trusted-receipt-release-mismatch"],
    ["artifactDigest", `sha256:${"c".repeat(64)}`, "trusted-receipt-artifact-mismatch"],
    ["evidenceFingerprint", "d".repeat(64), "trusted-receipt-evidence-mismatch"]
  ]) {
    const candidate = receipt({ [field]: value });
    const result = assessProductionPreflightDecisionReceipt(candidate, expected, { now: NOW, verifier: () => verdict(candidate) });
    assert.equal(result.verified, false);
    assert.equal(result.code, code);
  }
});

test("trusted receipt rejects expired, future and malformed validity windows", () => {
  for (const [candidate, code] of [
    [receipt({ expiresAt: NOW }), "trusted-receipt-expired"],
    [receipt({ issuedAt: "2026-08-23T08:00:01.000Z" }), "trusted-receipt-issued-in-future"],
    [receipt({ issuedAt: "not-a-date" }), "trusted-receipt-time-invalid"]
  ]) {
    const result = assessProductionPreflightDecisionReceipt(candidate, expected, { now: NOW, verifier: () => verdict(candidate) });
    assert.equal(result.code, code);
  }
});

test("trusted receipt rejects an overlong validity window", () => {
  const candidate = receipt({ expiresAt: "2026-08-24T07:50:00.001Z" });
  const result = assessProductionPreflightDecisionReceipt(candidate, expected, { now: NOW, verifier: () => verdict(candidate) });
  assert.equal(result.code, "trusted-receipt-validity-window-too-long");
});

test("trusted receipt rejects extra fields and redacts malicious identifiers", () => {
  const withSecret = receipt({ providerSecret: "receipt-provider-secret-123" });
  const extra = assessProductionPreflightDecisionReceipt(withSecret, expected, { now: NOW, verifier: () => verdict(withSecret) });
  assert.equal(extra.code, "trusted-receipt-fields-invalid");
  assert.doesNotMatch(JSON.stringify(extra), /providerSecret|receipt-provider-secret-123/);

  const maliciousId = receipt({ receiptId: "receipt/path?token=receipt-secret-456" });
  const invalidId = assessProductionPreflightDecisionReceipt(maliciousId, expected, { now: NOW, verifier: () => verdict(maliciousId) });
  assert.equal(invalidId.code, "trusted-receipt-contract-invalid");
  assert.equal(invalidId.receiptId, "");
  assert.doesNotMatch(JSON.stringify(invalidId), /receipt-secret-456/);

  const candidate = receipt();
  const invalidVerifier = assessProductionPreflightDecisionReceipt(candidate, expected, {
    now: NOW,
    verifier: () => verdict(candidate, { verifierId: "verifier/path?token=verifier-secret-789" })
  });
  assert.equal(invalidVerifier.code, "trusted-receipt-verdict-invalid");
  assert.doesNotMatch(JSON.stringify(invalidVerifier), /verifier-secret-789/);
});

test("trusted receipt rejects accessors and Proxy inspection failures without invoking or leaking them", () => {
  let getterInvoked = false;
  const accessorReceipt = receipt();
  Object.defineProperty(accessorReceipt, "receiptId", {
    enumerable: true,
    get() {
      getterInvoked = true;
      throw new Error("receipt-getter-secret-123");
    }
  });
  const accessorResult = assessProductionPreflightDecisionReceipt(accessorReceipt, expected, { now: NOW, verifier: () => ({}) });
  assert.equal(accessorResult.code, "trusted-receipt-fields-invalid");
  assert.equal(getterInvoked, false);
  assert.doesNotMatch(JSON.stringify(accessorResult), /receipt-getter-secret-123/);

  const proxyReceipt = new Proxy(receipt(), {
    ownKeys() { throw new Error("receipt-proxy-secret-456"); }
  });
  const proxyResult = assessProductionPreflightDecisionReceipt(proxyReceipt, expected, { now: NOW, verifier: () => ({}) });
  assert.equal(proxyResult.code, "trusted-receipt-inspection-failed");
  assert.doesNotMatch(JSON.stringify(proxyResult), /receipt-proxy-secret-456/);
});

test("trusted verifier verdict rejects accessors and Proxy inspection failures without invoking or leaking them", () => {
  const candidate = receipt();
  let getterInvoked = false;
  const accessorResult = assessProductionPreflightDecisionReceipt(candidate, expected, {
    now: NOW,
    verifier() {
      const candidateVerdict = verdict(candidate);
      Object.defineProperty(candidateVerdict, "verifierId", {
        enumerable: true,
        get() {
          getterInvoked = true;
          throw new Error("verdict-getter-secret-789");
        }
      });
      return candidateVerdict;
    }
  });
  assert.equal(accessorResult.code, "trusted-receipt-verdict-invalid");
  assert.equal(getterInvoked, false);
  assert.doesNotMatch(JSON.stringify(accessorResult), /verdict-getter-secret-789/);

  const proxyResult = assessProductionPreflightDecisionReceipt(candidate, expected, {
    now: NOW,
    verifier: () => new Proxy(verdict(candidate), {
      getOwnPropertyDescriptor() { throw new Error("verdict-proxy-secret-abc"); }
    })
  });
  assert.equal(proxyResult.code, "trusted-receipt-verdict-inspection-failed");
  assert.doesNotMatch(JSON.stringify(proxyResult), /verdict-proxy-secret-abc/);
});

test("trusted receipt rejects missing, exceptional, async and replaying verifiers without leaking errors", () => {
  const candidate = receipt();
  const missing = assessProductionPreflightDecisionReceipt(candidate, expected, { now: NOW });
  assert.equal(missing.code, "trusted-receipt-verifier-missing");

  const exceptional = assessProductionPreflightDecisionReceipt(candidate, expected, {
    now: NOW,
    verifier() { throw new Error("provider-secret-token-123"); }
  });
  assert.equal(exceptional.code, "trusted-receipt-verification-failed");
  assert.doesNotMatch(JSON.stringify(exceptional), /provider-secret-token-123/);

  const asyncVerdict = assessProductionPreflightDecisionReceipt(candidate, expected, {
    now: NOW,
    verifier: async () => verdict(candidate)
  });
  assert.equal(asyncVerdict.code, "trusted-receipt-verdict-invalid");

  const booleanVerdict = assessProductionPreflightDecisionReceipt(candidate, expected, {
    now: NOW,
    verifier: () => true
  });
  assert.equal(booleanVerdict.code, "trusted-receipt-verdict-invalid");

  const replay = assessProductionPreflightDecisionReceipt(candidate, expected, {
    now: NOW,
    verifier: () => verdict(candidate, { replayDetected: true })
  });
  assert.equal(replay.code, "trusted-receipt-verdict-invalid");
});

test("trusted receipt accepts only a structured verifier-confirmed single-use verdict", () => {
  const candidate = receipt();
  const result = assessProductionPreflightDecisionReceipt(candidate, expected, {
    now: NOW,
    verifier: () => verdict(candidate)
  });
  assert.equal(result.verified, true);
  assert.equal(result.code, "trusted-receipt-verified");
  assert.equal(result.evidenceFingerprint, expected.evidenceFingerprint);
});

test("runtime remains NO-GO for legacy local evidence and only accepts the explicit trusted verifier port", () => {
  const data = {
    platformProductionBlockerReviews: seedPlatformProductionBlockerReviews().map((item, index) => ({
      ...item,
      workflowStatus: "site-accepted",
      siteAcceptance: {
        status: "accepted",
        acceptanceId: `site-acceptance-${index}`,
        signers: ["business", "information", "operations", "security"].map((role) => ({ role, name: `${role}-signer` }))
      }
    })),
    productionSecurityFindings: seedProductionSecurityFindings().map((item) => ({ ...item, status: "closed" })),
    productionSecurityReleaseApprovals: seedProductionSecurityReleaseApprovals().map((item, index) => ({
      ...item,
      status: "approved",
      approvedBy: `security-release-signer-${index}`,
      approvedAt: `2026-08-23T07:3${index}:00.000Z`
    }))
  };
  const runtimeOptions = {
    now: NOW,
    releaseId: expected.releaseId,
    artifactDigest: expected.artifactDigest,
    launchSmoke: {
      ok: true,
      baseUrl: "https://health.example.gov.cn",
      generatedAt: "2026-08-23T07:40:00.000Z",
      summary: { total: 9, passed: 9, failed: 0, liveChecks: 2 }
    },
    cutoverArtifact: {
      profile: "production",
      checklist: Array.from({ length: 10 }, (_, index) => ({ id: `cutover-${index}`, passed: true }))
    },
    drRehearsalSigned: true
  };
  const preliminary = buildRuntimeProductionGoNoGoCenter(data, runtimeOptions);
  data.productionGoNoGoApprovals = ["business", "information", "operations", "security"].map((role, index) => ({
    id: `pgng-approval-${role}`,
    role,
    status: "approved",
    approvedBy: `signer-${index}`,
    approvedAt: "2026-08-23T07:45:00.000Z",
    evidenceFingerprint: preliminary.evidenceFingerprint,
    evidenceRef: `controlled/${role}.pdf`
  }));
  data.productionGoNoGoDecision = {
    decision: "GO",
    status: "recorded",
    evidenceFingerprint: preliminary.evidenceFingerprint
  };
  const legacy = buildRuntimeProductionGoNoGoCenter(data, runtimeOptions);
  assert.equal(legacy.gate.productionGoRecorded, false);
  assert.equal(legacy.trustedPreflightDecision.code, "trusted-receipt-missing");

  const candidate = receipt({ evidenceFingerprint: preliminary.evidenceFingerprint });
  const withoutVerifier = buildRuntimeProductionGoNoGoCenter(data, { ...runtimeOptions, preflightDecisionReceipt: candidate });
  assert.equal(withoutVerifier.gate.productionGoRecorded, false);
  assert.equal(withoutVerifier.trustedPreflightDecision.code, "trusted-receipt-verifier-missing");

  const verified = buildRuntimeProductionGoNoGoCenter(data, {
    ...runtimeOptions,
    preflightDecisionReceipt: candidate,
    preflightDecisionVerifier: () => verdict(candidate)
  });
  assert.equal(verified.gate.productionGoRecorded, true, JSON.stringify({ status: verified.status, checks: verified.checks, summary: verified.summary, receipt: verified.trustedPreflightDecision }));
});
