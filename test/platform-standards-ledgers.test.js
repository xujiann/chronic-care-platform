const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { buildPlatformStandardsLedgers, renderPlatformStandardsLedgersMarkdown } = require("../platform-standards-ledgers");
const { buildPlatformStandardsLedgersReport, parseArgs, writeOutput } = require("../scripts/platform-standards-ledgers");

function sampleData() {
  const rows = [{ id: "row-1", title: "Sample", owner: "owner", status: "registered", productionReady: false }];
  return {
    platformRoadmap: rows, platformDeliveryBatches: rows, platformEvidence: rows, applicationCatalog: rows,
    digitalHospitalPolicyRegister: rows, digitalHospitalStandards: rows, publicHealthStandards: rows, policyAlignment: rows,
    dataGovernanceAssets: rows, standardDataDictionaries: rows, dataLineageControls: rows, authOrganizations: rows,
    integrationContracts: rows, platformInterfaces: rows, interfaceRequirements: rows, phase2GatewayTraces: rows,
    securityAcceptanceLedger: rows, commercialCryptoEvidencePackets: rows, securityEvents: rows, dataAccessLogs: rows,
    siteLaunchEvidence: [], productionDeploymentPlan: rows, operationsEvidencePackets: rows, platformProductionBlockerReviews: rows
  };
}

test("six standards ledgers are traceable and keep production boundary explicit", () => {
  const report = buildPlatformStandardsLedgers(sampleData(), { manifest: { artifacts: [] } });
  assert.equal(report.ok, true);
  assert.equal(report.summary.ledgers, 6);
  assert.equal(report.summary.implemented, 6);
  assert.equal(report.summary.formalGoLiveReady, 0);
  assert.equal(report.ledgers.every((item) => item.acceptanceCriteria.length >= 4), true);
  assert.equal(report.ledgers.every((item) => item.formalGoLiveState === "blocked-until-onsite-evidence"), true);
});

test("policy register uses the existing runtime seed when the static snapshot omits it", () => {
  const data = sampleData();
  delete data.digitalHospitalPolicyRegister;
  const report = buildPlatformStandardsLedgers(data, { manifest: { artifacts: [] } });
  const ledger = report.ledgers.find((item) => item.id === "policy-standard-register");
  assert.equal(ledger.functionalState, "implemented");
  assert.equal(ledger.missingCollections.length, 0);
  assert.equal(ledger.rows.some((item) => item.collection === "digitalHospitalPolicyRegister"), true);
});

test("standards ledger readiness report exports json and markdown", (t) => {
  const outputDir = path.join(__dirname, "..", "tmp", "platform-standards-ledgers-test");
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
  const report = buildPlatformStandardsLedgersReport({
    data: sampleData(),
    releaseReport: { ok: true, checks: [], summary: { total: 0 } },
    manifest: { ok: true, artifacts: [] }
  });
  const markdown = renderPlatformStandardsLedgersMarkdown(report);
  assert.match(markdown, /六类可验收台账/);
  assert.match(markdown, /项目文件台账/);
  assert.match(markdown, /安全合规与授权审计台账/);
  writeOutput(report, { output: path.join(outputDir, "report.json"), markdown: path.join(outputDir, "report.md") });
  assert.equal(JSON.parse(fs.readFileSync(path.join(outputDir, "report.json"), "utf8")).ok, true);
  assert.match(fs.readFileSync(path.join(outputDir, "report.md"), "utf8"), /正式上线状态/);
  assert.deepEqual(parseArgs(["--output=release/a.json", "--markdown=release/a.md"]), { output: "release/a.json", markdown: "release/a.md" });
});
