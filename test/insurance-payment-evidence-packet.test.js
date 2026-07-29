"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const Evidence = require("../scripts/insurance-payment-evidence-packet");

test("insurance payment evidence packet is complete digest-bound and privacy-safe", () => {
  const packet = Evidence.buildInsurancePaymentEvidencePacket({ generatedAt: "2026-07-22T12:00:00.000Z" });
  assert.equal(packet.schema, "insurance-payment-acceptance-evidence-v1");
  assert.equal(packet.localReady, true);
  assert.equal(packet.productionReady, false);
  assert.equal(packet.workflows.length, 6);
  assert.equal(packet.artifacts.length, Evidence.EVIDENCE_FILES.length);
  assert.equal(packet.productionHandoff.summary.required, packet.t00PendingRoutes.length + packet.externalBlockers.length);
  assert.equal(packet.productionHandoff.ledgerValid, true);
  assert.equal(packet.productionHandoff.evidenceComplete, false);
  assert.equal(packet.productionHandoff.productionReady, false);
  assert.equal(packet.productionGate.passed, false);
  assert.deepEqual(packet.productionGate.blockers, ["persistence-production-cutover-complete", "t00-public-wiring-complete", "handoff-evidence-complete", "live-site-acceptance-confirmed"]);
  assert.equal(packet.persistence.productionPrimary, false);
  assert.equal(packet.productionGate.checks.find((item) => item.id === "evidence-artifact-manifest-valid").passed, true);
  assert.equal(Evidence.verifyInsurancePaymentEvidencePacket(packet), true);
  assert.equal(Evidence.shouldFailEvidencePacket(packet), false);
  assert.equal(Evidence.shouldFailEvidencePacket(packet, { "require-signature": true, "trusted-fingerprints": "f".repeat(64) }), true);
  assert.equal(Evidence.shouldFailEvidencePacket(packet, { "require-production": true }), true);
  assert.doesNotMatch(JSON.stringify(packet), /residentId|patientName|FINANCIAL_GATEWAY_SECRET|PRIVATE KEY/);
  assert.match(Evidence.renderMarkdown(packet), /医保支付与按病种付费验收证据包/);
});

test("insurance payment evidence packet detects acceptance or artifact tampering", () => {
  const packet = Evidence.buildInsurancePaymentEvidencePacket({ generatedAt: "2026-07-22T12:00:00.000Z" });
  const tampered = structuredClone(packet);
  tampered.workflows[0].ready = false;
  assert.equal(Evidence.verifyInsurancePaymentEvidencePacket(tampered), false);

  const rehashedArtifactTampering = structuredClone(packet);
  rehashedArtifactTampering.artifacts[0].sha256 = "f".repeat(64);
  rehashedArtifactTampering.packetDigest = `sha256:${Evidence.sha256(Evidence.stableStringify(Evidence.packetPayload(rehashedArtifactTampering)))}`;
  assert.equal(Evidence.verifyInsurancePaymentEvidencePacket(rehashedArtifactTampering), false);

  const missingArtifact = structuredClone(packet);
  missingArtifact.artifacts.pop();
  missingArtifact.packetDigest = `sha256:${Evidence.sha256(Evidence.stableStringify(Evidence.packetPayload(missingArtifact)))}`;
  assert.equal(Evidence.verifyInsurancePaymentEvidencePacket(missingArtifact), false);

  const wrongRoot = structuredClone(packet);
  assert.equal(Evidence.verifyInsurancePaymentEvidencePacket(wrongRoot, { artifactRoot: __dirname }), false);
  assert.equal(Evidence.shouldFailEvidencePacket(tampered), true);
  assert.deepEqual(Evidence.parseArgs(["--output=tmp/evidence.json", "--markdown=tmp/evidence.md", "--require-production"]), { output: "tmp/evidence.json", markdown: "tmp/evidence.md", "require-production": true });
  assert.deepEqual(Evidence.trustedFingerprints([`sha256:${"a".repeat(64)}`, "B".repeat(64)].join(";")), ["a".repeat(64), "b".repeat(64)]);
});
