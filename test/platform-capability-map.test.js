const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { buildCapabilityMap, renderCapabilityMapMarkdown } = require("../platform-capability-map");
const { buildPlatformCapabilityMapReport, parseArgs, writeOutput } = require("../scripts/platform-capability-map");

test("platform capability map summarizes release artifacts scripts and data collections", (t) => {
  const evidenceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "platform-capability-map-"));
  t.after(() => fs.rmSync(evidenceRoot, { recursive: true, force: true }));
  fs.mkdirSync(path.join(evidenceRoot, "release"), { recursive: true });
  fs.writeFileSync(path.join(evidenceRoot, "release", "release-report.json"), JSON.stringify({ ok: true }));
  const manifest = {
    ok: true,
    summary: { artifacts: 3, templateReadmes: 1 },
    artifacts: [
      { id: "release-report", category: "release", title: "Release report", command: "release:report", commandAvailable: true, json: "release/release-report.json", markdown: "release/release-report.md", evidence: "/api/release-report" },
      { id: "data-governance", category: "data", title: "Data governance", command: "data-governance:readiness", commandAvailable: true, json: "release/data-governance-readiness-report.json", markdown: "release/data-governance-readiness-report.md", evidence: "/api/data-governance" },
      { id: "emergency-readiness", category: "emergency", title: "Emergency readiness", command: "emergency:readiness", commandAvailable: true, json: "release/emergency-readiness-report.json", markdown: "release/emergency-readiness-report.md", evidence: "/api/emergency/production-center" }
    ],
    templateReadmes: [{ id: "production-signoff", file: "release/templates/production-signoff/README.md" }]
  };
  const pkg = {
    scripts: {
      "release:report": "node scripts/release-report.js report --profile=demo",
      "data-governance:readiness": "node scripts/data-governance-readiness.js",
      "emergency:readiness": "node scripts/emergency-readiness.js",
      "deploy:check": "node scripts/deploy-check.js",
      "test": "node --test"
    }
  };
  const data = {
    residents: [{ id: "r1" }],
    personalRecords: [{ id: "pr1" }],
    dataGovernanceAssets: [{ id: "asset-his" }],
    emergencySignals: [{ id: "emg1" }],
    securityEvents: [{ id: "sec1" }],
    platformProductionBlockerReviews: [{ id: "ppbr-1", blockerId: "P0-01", workflowStatus: "open", owner: "platform-ops", productionReady: false }],
    publicHealthCutoverBlockers: [{ id: "phcb-1", severity: "P0", name: "Direct report endpoint", status: "open", owner: "cdc", resolutionAction: "Upload receipt sample." }]
  };
  const report = buildCapabilityMap({ manifest, pkg, data, root: evidenceRoot });
  assert.equal(report.ok, true);
  assert.equal(report.summary.releaseArtifacts, 3);
  assert.equal(report.summary.packageScripts, 5);
  assert.equal(report.summary.dataCollections, 7);
  assert.equal(report.summary.totalRecords, 7);
  assert.equal(report.breakdowns.scriptsByKind["readiness-report"] >= 3, true);
  assert.equal(report.breakdowns.collectionsByDomain["resident-record"], 2);
  assert.equal(report.domains.some((item) => item.id === "emergency" && item.artifacts === 1), true);
  assert.equal(report.summary.openRisks >= 2, true);
  assert.equal(report.summary.p0Risks >= 1, true);
  assert.equal(report.riskRegister.items.some((item) => item.source === "public-health-cutover"), true);
  assert.equal(report.checks.every((item) => item.passed), true);
});

test("platform capability map markdown is exportable", () => {
  const report = buildCapabilityMap({
    manifest: {
      ok: true,
      artifacts: [{ id: "release-report", category: "release", title: "Release report", command: "release:report", commandAvailable: true, evidence: "/api/release-report" }],
      templateReadmes: []
    },
    pkg: { scripts: { "release:report": "node scripts/release-report.js report --profile=demo" } },
    data: { residents: [{ id: "r1" }] }
  });
  const markdown = renderCapabilityMapMarkdown(report);
  assert.match(markdown, /Platform capability map/);
  assert.match(markdown, /Release artifacts: 1/);
  assert.match(markdown, /Package scripts: 1/);
  assert.match(markdown, /Capability Domains/);
  assert.match(markdown, /Risk Register/);
  assert.match(markdown, /\/api\/release-report/);
});

test("platform capability map script writes release artifacts", (t) => {
  const outputDir = path.join(__dirname, "..", "tmp", "platform-capability-map-test");
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
  const report = buildPlatformCapabilityMapReport({
    manifest: {
      ok: true,
      artifacts: [{ id: "release-artifact-manifest", category: "release", title: "Release artifact manifest", command: "release:manifest", markdown: "package.json", evidence: "release/release-artifact-manifest.md" }],
      templateReadmes: []
    },
    pkg: { scripts: { "release:manifest": "node scripts/release-artifact-manifest.js", "platform:capability-map": "node scripts/platform-capability-map.js" } },
    data: { residents: [{ id: "r1" }], integrationContracts: [{ id: "c1" }] }
  });
  assert.equal(report.ok, true);
  assert.equal(report.summary.packageScripts, 2);
  writeOutput(report, {
    output: path.join(outputDir, "platform-capability-map.json"),
    markdown: path.join(outputDir, "platform-capability-map.md")
  });
  const writtenJson = JSON.parse(fs.readFileSync(path.join(outputDir, "platform-capability-map.json"), "utf8"));
  const writtenMarkdown = fs.readFileSync(path.join(outputDir, "platform-capability-map.md"), "utf8");
  assert.equal(writtenJson.summary.releaseArtifacts, 1);
  assert.match(writtenMarkdown, /Platform capability map/);
  assert.deepEqual(parseArgs(["--output=release/a.json", "--markdown=release/a.md"]), {
    output: "release/a.json",
    markdown: "release/a.md"
  });
});
