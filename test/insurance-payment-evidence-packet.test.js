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
  assert.equal(Evidence.verifyInsurancePaymentEvidencePacket(packet), true);
  assert.doesNotMatch(JSON.stringify(packet), /residentId|patientName|FINANCIAL_GATEWAY_SECRET|PRIVATE KEY/);
  assert.match(Evidence.renderMarkdown(packet), /医保支付与按病种付费验收证据包/);
});

test("insurance payment evidence packet detects acceptance or artifact tampering", () => {
  const packet = Evidence.buildInsurancePaymentEvidencePacket({ generatedAt: "2026-07-22T12:00:00.000Z" });
  const tampered = structuredClone(packet);
  tampered.workflows[0].ready = false;
  assert.equal(Evidence.verifyInsurancePaymentEvidencePacket(tampered), false);
  assert.deepEqual(Evidence.parseArgs(["--output=tmp/evidence.json", "--markdown=tmp/evidence.md"]), { output: "tmp/evidence.json", markdown: "tmp/evidence.md" });
});
