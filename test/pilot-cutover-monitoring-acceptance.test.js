"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  REQUIRED_CHECKS,
  evaluatePilotCutoverMonitoringAcceptance
} = require("../src/platform/cutover/pilot-cutover-monitoring-acceptance");

const DIGEST = `sha256:${"a".repeat(64)}`;
const PACKAGE = `sha256:${"b".repeat(64)}`;

function fixture() {
  return {
    schemaVersion: "pilot-cutover-monitoring-acceptance-v1",
    status: "verified",
    releaseId: "release-20260804",
    packageFingerprint: PACKAGE,
    monitoringOwnerAccount: "monitoring-owner",
    securityReviewerAccount: "security-reviewer",
    observedWindow: {
      startedAt: "2026-08-04T08:00:00.000Z",
      completedAt: "2026-08-04T09:00:00.000Z"
    },
    checks: REQUIRED_CHECKS.map((id) => ({
      id,
      status: "verified",
      evidenceRef: `evidence://monitoring/${id}`,
      evidenceDigest: DIGEST
    })),
    journalHeadDigest: DIGEST,
    acceptanceEvidenceRef: "evidence://monitoring/acceptance",
    acceptanceEvidenceDigest: DIGEST,
    boundary: {
      metadataOnly: true,
      patientDataIncluded: false,
      secretsIncluded: false,
      productionReady: false
    }
  };
}

const journal = Object.freeze({
  chainValid: true,
  headDigest: DIGEST,
  summary: Object.freeze({ open: 0, critical: 0, deadLetter: 0, recovered: 4 })
});

test("monitoring acceptance requires independent review and a closed hash chain", () => {
  const ready = evaluatePilotCutoverMonitoringAcceptance(fixture(), {
    journal,
    now: "2026-08-04T10:00:00.000Z"
  });
  assert.equal(ready.ready, true);
  assert.equal(ready.deliveryReady, true);
  assert.equal(ready.decision, "MONITORING-ACCEPTED");
  assert.equal(ready.productionReady, false);

  const sameReviewer = fixture();
  sameReviewer.securityReviewerAccount = sameReviewer.monitoringOwnerAccount;
  assert.equal(evaluatePilotCutoverMonitoringAcceptance(sameReviewer, {
    journal,
    now: "2026-08-04T10:00:00.000Z"
  }).ready, false);

  assert.equal(evaluatePilotCutoverMonitoringAcceptance(fixture(), {
    journal: { ...journal, summary: { ...journal.summary, deadLetter: 1 } },
    now: "2026-08-04T10:00:00.000Z"
  }).ready, false);
});

test("missing delivery evidence and journal fingerprint drift remain NO-GO", () => {
  const missing = fixture();
  missing.checks.pop();
  assert.equal(evaluatePilotCutoverMonitoringAcceptance(missing, {
    journal,
    now: "2026-08-04T10:00:00.000Z"
  }).decision, "NO-GO");

  const drifted = evaluatePilotCutoverMonitoringAcceptance(fixture(), {
    journal: { ...journal, headDigest: `sha256:${"c".repeat(64)}` },
    now: "2026-08-04T10:00:00.000Z"
  });
  assert.equal(drifted.checks.journalChain, false);
  assert.equal(drifted.monitoringAcceptanceProven, false);
});
