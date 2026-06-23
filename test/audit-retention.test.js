const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { buildAuditRetentionReport, parseArgs, renderMarkdown, verifyAuditTrail, writeOutput } = require("../scripts/audit-retention");

const ROOT = path.resolve(__dirname, "..");

test("audit retention report verifies hash chains and export evidence", () => {
  const report = buildAuditRetentionReport({ env: { AUDIT_EXPORT_PATH: "/var/log/chronic-care-platform/audit" } });
  assert.equal(report.ok, true);
  assert.equal(report.trails.securityEvents.passed, true);
  assert.equal(report.trails.dataAccessLogs.passed, true);
  assert.equal(report.exportCounts.total > 0, true);
  assert.equal(Boolean(report.exportDigest), true);
  assert.equal(report.retentionTargets.some((item) => item.configured), true);
  assert.equal(report.checks.some((item) => item.id === "audit:productionTrack" && item.passed), true);
});

test("audit retention report detects tampered audit rows", () => {
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "db.json"), "utf8"));
  data.securityEvents = data.securityEvents.map((item) => ({ ...item }));
  data.securityEvents[0].detail = "tampered";
  const report = buildAuditRetentionReport({ data, env: { AUDIT_EXPORT_PATH: "/var/log/chronic-care-platform/audit" } });
  assert.equal(report.ok, false);
  assert.equal(report.trails.securityEvents.passed, false);
  assert.equal(verifyAuditTrail(data.securityEvents).broken.length > 0, true);
});

test("audit retention report renders and writes release artifacts", (t) => {
  const outputDir = path.join(ROOT, "tmp", "audit-retention-test");
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
  const report = buildAuditRetentionReport();
  const markdown = renderMarkdown(report);
  assert.match(markdown, /Audit retention report/);
  assert.match(markdown, /Audit chains/);

  writeOutput(report, {
    output: path.join("tmp", "audit-retention-test", "audit-retention-report.json"),
    markdown: path.join("tmp", "audit-retention-test", "audit-retention-report.md")
  });

  const writtenJson = JSON.parse(fs.readFileSync(path.join(outputDir, "audit-retention-report.json"), "utf8"));
  const writtenMarkdown = fs.readFileSync(path.join(outputDir, "audit-retention-report.md"), "utf8");
  assert.equal(writtenJson.ok, true);
  assert.match(writtenMarkdown, /Retention targets/);
});

test("audit retention CLI parser keeps output flags", () => {
  const parsed = parseArgs(["--output=release/audit-retention-report.json", "--markdown=release/audit-retention-report.md"]);
  assert.equal(parsed.output, "release/audit-retention-report.json");
  assert.equal(parsed.markdown, "release/audit-retention-report.md");
});
