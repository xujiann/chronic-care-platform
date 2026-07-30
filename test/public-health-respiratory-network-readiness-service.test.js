"use strict";

const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const test = require("node:test");
const {
  RESPIRATORY_PANEL,
  RESPIRATORY_PATHOGENS,
  ingestPublicHealthRespiratoryPathogenBatchToState,
  verifyPublicHealthRespiratoryPathogenBatchToState
} = require("../public-health-respiratory-pathogen-surveillance-service");
const {
  MINIMUM_EVIDENCE_VALIDITY_DAYS_AT_LAUNCH,
  REQUIRED_RESPIRATORY_NETWORK_EVIDENCE,
  RESPIRATORY_NETWORK_EVIDENCE_PURPOSE,
  buildPublicHealthRespiratoryNetworkEvidenceLifecycle,
  buildPublicHealthRespiratoryNetworkReadiness,
  issueTrustedRespiratoryNetworkLifecycleEvent,
  issueTrustedRespiratoryNetworkEvidenceReceipt,
  verifyTrustedRespiratoryNetworkLifecycleEvent,
  verifyTrustedRespiratoryNetworkEvidence
} = require("../public-health-respiratory-network-readiness-service");

const NOW = "2026-07-29T12:00:00.000Z";
const INSTITUTION_ID = "sentinel-respiratory-laboratory-001";
const KEYRING = {
  purpose: RESPIRATORY_NETWORK_EVIDENCE_PURPOSE,
  activeKeyId: "respiratory-evidence-2026-07",
  keys: [{
    keyId: "respiratory-evidence-2026-07",
    secret: "respiratory-network-evidence-key-2026-07-very-secret",
    status: "active",
    notBefore: "2026-07-01T00:00:00.000Z",
    expiresAt: "2027-01-01T00:00:00.000Z",
    revokedAt: ""
  }]
};

function artifactDigest(type) {
  return createHash("sha256").update(`trusted-artifact:${type}`).digest("hex");
}

function evidence(type, index = 0, overrides = {}) {
  return issueTrustedRespiratoryNetworkEvidenceReceipt({
    id: `respiratory-evidence-${String(index + 1).padStart(2, "0")}`,
    institutionId: INSTITUTION_ID,
    evidenceType: type,
    panelId: RESPIRATORY_PANEL.id,
    panelVersion: RESPIRATORY_PANEL.version,
    status: "verified",
    artifactName: `${type}.pdf`,
    artifactDigest: artifactDigest(type),
    validFrom: "2026-07-01T00:00:00.000Z",
    expiresAt: "2026-12-31T23:59:59.999Z",
    ...overrides
  }, {
    signedBy: `external-owner:${type}`,
    verifiedBy: "server-evidence-verifier",
    verifiedAt: "2026-07-29T10:00:00.000Z",
    signatureVerified: true,
    receiptId: `respiratory-receipt-${String(index + 1).padStart(2, "0")}`
  }, KEYRING);
}

function panelResults() {
  return RESPIRATORY_PATHOGENS.map((item) => ({
    pathogenCode: item.code,
    testedSpecimens: 20,
    positiveSpecimens: item.code === "influenza-a" ? 2 : 0
  }));
}

function threeDayVerifiedData() {
  let data = {};
  [27, 28, 29].forEach((day, index) => {
    const intake = ingestPublicHealthRespiratoryPathogenBatchToState(data, {
      sourceId: "ph-source-laboratory-pathogen",
      externalBatchId: `RESP-QUALITY-202607${day}`,
      panelId: RESPIRATORY_PANEL.id,
      panelVersion: RESPIRATORY_PANEL.version,
      institutionId: INSTITUTION_ID,
      regionCode: "210202",
      observedAt: `2026-07-${day}T08:00:00.000Z`,
      receivedAt: `2026-07-${day}T08:10:00.000Z`,
      specimenCount: 20,
      ageGroup: index === 0 ? "child" : index === 2 ? "older-adult" : "general",
      placeType: index === 0 ? "school" : index === 2 ? "elderly-care" : "medical-institution",
      results: panelResults(),
      evidenceRefs: [`RESP-QUALITY-QC-${day}`],
      idempotencyKey: `resp-quality-intake-${day}`
    }, { name: "sentinel laboratory", role: "laboratory" });
    const verified = verifyPublicHealthRespiratoryPathogenBatchToState(intake.nextData, intake.batch.id, {
      decision: "confirmed",
      note: "human review confirmed the panel version and aggregate quality result",
      evidenceRefs: [`RESP-QUALITY-VERIFY-${day}`],
      idempotencyKey: `resp-quality-verify-${day}`,
      expectedVersion: 1,
      at: `2026-07-${day}T08:20:00.000Z`
    }, { name: "cdc reviewer", role: "cdc-surveillance" });
    data = verified.nextData;
  });
  return data;
}

function trustedEvidence() {
  return REQUIRED_RESPIRATORY_NETWORK_EVIDENCE.map((item, index) => evidence(item.type, index));
}

function lifecycleEvent(eventType, target, successor = null, index = 1, approvedAt = "2026-07-29T10:30:00.000Z") {
  return issueTrustedRespiratoryNetworkLifecycleEvent({
    id: `respiratory-lifecycle-event-${String(index).padStart(2, "0")}`,
    eventType,
    reasonCode: `${eventType}-approved`
  }, target, successor, {
    requestedBy: `respiratory-evidence-owner-${index}`,
    approvedBy: `respiratory-independent-approver-${index}`,
    approvedAt,
    receiptId: `respiratory-lifecycle-receipt-${String(index).padStart(2, "0")}`
  }, KEYRING);
}

test("trusted network evidence plus three consecutive quality days makes the software release ready only", () => {
  const board = buildPublicHealthRespiratoryNetworkReadiness({
    data: threeDayVerifiedData(),
    evidenceRecords: trustedEvidence(),
    keyring: KEYRING,
    at: NOW
  });
  assert.equal(board.ok, true);
  assert.equal(board.functionalState, "software-release-ready");
  assert.equal(board.technicalLaunchReady, true);
  assert.equal(board.productionReady, false);
  assert.equal(board.summary.requiredEvidenceTypes, 6);
  assert.equal(board.summary.trustedEvidence, 6);
  assert.equal(board.summary.technicalLaunchReadyInstitutions, 1);
  assert.equal(board.institutions[0].consecutiveQualityDays, 3);
  assert.equal(board.externalProductionBlockers.length, 2);
});

test("missing evidence or non-consecutive quality observations fail closed", () => {
  const records = trustedEvidence().slice(0, -1);
  const data = threeDayVerifiedData();
  data.publicHealthRespiratoryPathogenBatches[1].observedAt = "2026-07-25T08:00:00.000Z";
  const board = buildPublicHealthRespiratoryNetworkReadiness({ data, evidenceRecords: records, keyring: KEYRING, at: NOW });
  assert.equal(board.technicalLaunchReady, false);
  assert.equal(board.productionReady, false);
  assert.ok(board.institutions[0].missingEvidenceTypes.includes("continuity-observation-acceptance"));
  assert.equal(board.institutions[0].continuityReady, false);
});

test("forged trust fields and post-signing trust metadata tampering are rejected", () => {
  const signed = evidence("panel-standard-mapping", 0);
  const forged = {
    ...signed,
    trustedVerification: {
      ...signed.trustedVerification,
      receiptSignature: "f".repeat(64),
      signedBy: "client-claimed-owner"
    }
  };
  assert.equal(verifyTrustedRespiratoryNetworkEvidence(forged, KEYRING, NOW).ok, false);

  for (const mutation of [
    { attestationOrigin: "client-generated" },
    { verificationSource: "untrusted-client" },
    { signatureVerified: false },
    { signedBy: "tampered-signer" },
    { verifiedBy: "tampered-verifier" }
  ]) {
    const tampered = {
      ...signed,
      trustedVerification: { ...signed.trustedVerification, ...mutation }
    };
    assert.equal(verifyTrustedRespiratoryNetworkEvidence(tampered, KEYRING, NOW).ok, false);
  }
});

test("artifact status panel dates and key lifecycle are bound to the receipt", () => {
  const signed = evidence("privacy-security-review", 4);
  const mutations = [
    { status: "verified-client" },
    { artifactDigest: "a".repeat(64) },
    { panelVersion: 2 },
    { expiresAt: "2027-12-31T23:59:59.999Z" }
  ];
  mutations.forEach((mutation) => {
    assert.equal(verifyTrustedRespiratoryNetworkEvidence({ ...signed, ...mutation }, KEYRING, NOW).ok, false);
  });

  const revoked = {
    ...KEYRING,
    activeKeyId: "respiratory-evidence-2026-08",
    keys: [
      { ...KEYRING.keys[0], status: "revoked", revokedAt: "2026-07-29T11:00:00.000Z" },
      {
        ...KEYRING.keys[0],
        keyId: "respiratory-evidence-2026-08",
        secret: "respiratory-network-evidence-key-2026-08-very-secret",
        notBefore: "2026-07-29T11:00:00.000Z"
      }
    ]
  };
  assert.match(verifyTrustedRespiratoryNetworkEvidence(signed, revoked, NOW).reason, /key-revoked/);
  assert.equal(verifyTrustedRespiratoryNetworkEvidence(signed, KEYRING, "2027-01-02T00:00:00.000Z").ok, false);
});

test("client-originated records cannot become trusted by self-reporting verified and signedBy", () => {
  const clientRecord = {
    id: "client-forged-evidence",
    institutionId: INSTITUTION_ID,
    evidenceType: "sentinel-network-authorization",
    panelId: RESPIRATORY_PANEL.id,
    panelVersion: RESPIRATORY_PANEL.version,
    status: "verified",
    artifactName: "forged.pdf",
    artifactDigest: "a".repeat(64),
    validFrom: "2026-07-01T00:00:00.000Z",
    expiresAt: "2026-12-31T23:59:59.999Z",
    trustedVerification: {
      attestationOrigin: "server-generated",
      verificationSource: "server-evidence-store",
      signatureVerified: true,
      signedBy: "client-claimed-signer",
      verifiedBy: "client-claimed-verifier",
      verifiedAt: "2026-07-29T10:00:00.000Z",
      algorithm: "HMAC-SHA256",
      keyId: KEYRING.activeKeyId,
      receiptId: "client-receipt",
      receiptSignature: "a".repeat(64)
    }
  };
  const board = buildPublicHealthRespiratoryNetworkReadiness({
    data: threeDayVerifiedData(),
    evidenceRecords: [clientRecord],
    keyring: KEYRING,
    at: NOW
  });
  assert.equal(board.summary.trustedEvidence, 0);
  assert.equal(board.summary.rejectedEvidence, 1);
  assert.equal(board.technicalLaunchReady, false);
  assert.equal(board.productionReady, false);
});

test("evidence id and server receipt replay block network release readiness", () => {
  const records = trustedEvidence();
  records.push(records[0]);
  const board = buildPublicHealthRespiratoryNetworkReadiness({
    data: threeDayVerifiedData(),
    evidenceRecords: records,
    keyring: KEYRING,
    at: NOW
  });
  assert.equal(board.ok, false);
  assert.equal(board.technicalLaunchReady, false);
  assert.equal(board.productionReady, false);
  assert.equal(board.summary.integrityFindings, 2);
  assert.deepEqual(board.integrityFindings.map((item) => item.code).sort(), [
    "respiratory-network-evidence-id-replay",
    "respiratory-network-receipt-replay"
  ]);
});

test("signed supersede keeps one active evidence per track and preserves technical launch readiness", () => {
  const records = trustedEvidence();
  const predecessor = records[0];
  const successor = evidence("panel-standard-mapping", 20, {
    artifactName: "panel-standard-mapping-renewal.pdf",
    artifactDigest: artifactDigest("panel-standard-mapping-renewal")
  });
  records.push(successor);
  const supersede = lifecycleEvent("supersede", predecessor, successor);
  const board = buildPublicHealthRespiratoryNetworkReadiness({
    data: threeDayVerifiedData(),
    evidenceRecords: records,
    lifecycleEvents: [supersede],
    keyring: KEYRING,
    at: NOW
  });
  assert.equal(board.ok, true);
  assert.equal(board.technicalLaunchReady, true);
  assert.equal(board.productionReady, false);
  assert.equal(board.summary.lifecycleEvents, 1);
  assert.equal(board.summary.supersededEvidence, 1);
  assert.equal(board.summary.trustedEvidence, 6);
  assert.equal(board.institutions[0].duplicateEvidenceTypes.length, 0);
});

test("suspension blocks readiness and a later independently approved reinstatement restores it", () => {
  const records = trustedEvidence();
  const target = records[1];
  const suspend = lifecycleEvent("suspend", target, null, 2, "2026-07-29T10:20:00.000Z");
  const suspended = buildPublicHealthRespiratoryNetworkReadiness({
    data: threeDayVerifiedData(),
    evidenceRecords: records,
    lifecycleEvents: [suspend],
    keyring: KEYRING,
    at: NOW
  });
  assert.equal(suspended.technicalLaunchReady, false);
  assert.equal(suspended.summary.suspendedEvidence, 1);
  assert.ok(suspended.institutions[0].missingEvidenceTypes.includes("sentinel-network-authorization"));

  const reinstate = lifecycleEvent("reinstate", target, null, 3, "2026-07-29T10:40:00.000Z");
  const restored = buildPublicHealthRespiratoryNetworkReadiness({
    data: threeDayVerifiedData(),
    evidenceRecords: records,
    lifecycleEvents: [suspend, reinstate],
    keyring: KEYRING,
    at: NOW
  });
  assert.equal(restored.ok, true);
  assert.equal(restored.technicalLaunchReady, true);
  assert.equal(restored.summary.lifecycleEvents, 2);
  assert.equal(restored.summary.suspendedEvidence, 0);
});

test("revocation is terminal and an attempted reinstatement fails closed", () => {
  const records = trustedEvidence();
  const target = records[2];
  const revoke = lifecycleEvent("revoke", target, null, 4, "2026-07-29T10:20:00.000Z");
  const reinstate = lifecycleEvent("reinstate", target, null, 5, "2026-07-29T10:40:00.000Z");
  const registry = buildPublicHealthRespiratoryNetworkEvidenceLifecycle({
    evidenceRecords: records,
    lifecycleEvents: [revoke, reinstate],
    keyring: KEYRING,
    at: NOW
  });
  assert.equal(registry.ok, false);
  assert.equal(registry.summary.revoked, 1);
  assert.equal(registry.summary.findings, 1);
  assert.match(registry.findings[0].reasons.join(" "), /revoked -> reinstate is not allowed/);
});

test("lifecycle receipt binds transition, evidence, approvers and trust metadata", () => {
  const records = trustedEvidence();
  const signed = lifecycleEvent("suspend", records[3], null, 6);
  const mutations = [
    { eventType: "revoke" },
    { targetBindingDigest: "a".repeat(64) },
    { requestedBy: "tampered-requester" },
    { approvedBy: "tampered-approver" }
  ];
  mutations.forEach((mutation) => {
    assert.equal(verifyTrustedRespiratoryNetworkLifecycleEvent(
      { ...signed, ...mutation },
      KEYRING,
      NOW
    ).ok, false);
  });
  for (const mutation of [
    { attestationOrigin: "client-generated" },
    { verificationSource: "untrusted-client" },
    { signatureVerified: false },
    { receiptId: "tampered-receipt" }
  ]) {
    assert.equal(verifyTrustedRespiratoryNetworkLifecycleEvent({
      ...signed,
      trustedVerification: { ...signed.trustedVerification, ...mutation }
    }, KEYRING, NOW).ok, false);
  }
});

test("lifecycle event and receipt replay block readiness", () => {
  const records = trustedEvidence();
  const suspend = lifecycleEvent("suspend", records[4], null, 7);
  const board = buildPublicHealthRespiratoryNetworkReadiness({
    data: threeDayVerifiedData(),
    evidenceRecords: records,
    lifecycleEvents: [suspend, suspend],
    keyring: KEYRING,
    at: NOW
  });
  assert.equal(board.ok, false);
  assert.equal(board.technicalLaunchReady, false);
  assert.equal(board.productionReady, false);
  assert.ok(board.integrityFindings.some((item) =>
    item.code === "respiratory-network-lifecycle-event-invalid"
      && item.reasons.some((reason) => /replay/.test(reason))));
});

test("evidence due within the launch validity window blocks technical readiness", () => {
  const records = trustedEvidence();
  records[5] = evidence("continuity-observation-acceptance", 5, {
    expiresAt: "2026-08-15T00:00:00.000Z"
  });
  const board = buildPublicHealthRespiratoryNetworkReadiness({
    data: threeDayVerifiedData(),
    evidenceRecords: records,
    keyring: KEYRING,
    at: NOW
  });
  assert.equal(MINIMUM_EVIDENCE_VALIDITY_DAYS_AT_LAUNCH, 30);
  assert.equal(board.ok, true);
  assert.equal(board.technicalLaunchReady, false);
  assert.equal(board.summary.renewalDueEvidence, 1);
  assert.deepEqual(board.institutions[0].renewalDueEvidenceTypes, [
    "continuity-observation-acceptance"
  ]);
});

test("malformed active evidence expiry is rejected without crashing the lifecycle board", () => {
  const records = trustedEvidence();
  records[0] = {
    ...records[0],
    expiresAt: "not-a-timestamp"
  };
  const board = buildPublicHealthRespiratoryNetworkReadiness({
    data: threeDayVerifiedData(),
    evidenceRecords: records,
    keyring: KEYRING,
    at: NOW
  });
  assert.equal(board.ok, false);
  assert.equal(board.technicalLaunchReady, false);
  assert.equal(board.summary.rejectedEvidence, 1);
  assert.match(board.rejectedEvidence[0].reasons.join(" "), /evidence expiresAt/);
  assert.equal(board.productionReady, false);
});

test("lifecycle signing requires dual control and valid same-track successor evidence", () => {
  const records = trustedEvidence();
  assert.throws(() => issueTrustedRespiratoryNetworkLifecycleEvent({
    id: "invalid-dual-control",
    eventType: "suspend",
    reasonCode: "quality-review"
  }, records[0], null, {
    requestedBy: "same-person",
    approvedBy: "same-person",
    approvedAt: "2026-07-29T10:30:00.000Z",
    receiptId: "invalid-dual-control-receipt"
  }, KEYRING), /independent lifecycle requester and approver/);

  assert.throws(() => issueTrustedRespiratoryNetworkLifecycleEvent({
    id: "invalid-successor",
    eventType: "supersede",
    reasonCode: "renewal"
  }, records[0], records[1], {
    requestedBy: "requester",
    approvedBy: "approver",
    approvedAt: "2026-07-29T10:30:00.000Z",
    receiptId: "invalid-successor-receipt"
  }, KEYRING), /same institution, type and panel/);
});

test("revoking the lifecycle signing key invalidates the signed transition", () => {
  const records = trustedEvidence();
  const suspend = lifecycleEvent("suspend", records[0], null, 8);
  const revokedKeyring = {
    ...KEYRING,
    activeKeyId: "respiratory-evidence-2026-08",
    keys: [
      {
        ...KEYRING.keys[0],
        status: "revoked",
        revokedAt: "2026-07-29T11:00:00.000Z"
      },
      {
        keyId: "respiratory-evidence-2026-08",
        secret: "respiratory-network-evidence-key-2026-08-rotated-secret",
        status: "active",
        notBefore: "2026-07-29T11:00:00.000Z",
        expiresAt: "2027-07-29T00:00:00.000Z",
        revokedAt: ""
      }
    ]
  };
  const verification = verifyTrustedRespiratoryNetworkLifecycleEvent(suspend, revokedKeyring, NOW);
  assert.equal(verification.ok, false);
  assert.match(verification.reasons.join(" "), /key-revoked/);
  const registry = buildPublicHealthRespiratoryNetworkEvidenceLifecycle({
    evidenceRecords: records,
    lifecycleEvents: [suspend],
    keyring: revokedKeyring,
    at: NOW
  });
  assert.equal(registry.ok, false);
  assert.equal(registry.summary.lifecycleEvents, 0);
  assert.equal(registry.productionReady, false);
});
