const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { buildIntegrationReadinessReport, parseArgs, renderMarkdown, writeOutput } = require("../scripts/integration-readiness");

const ROOT = path.resolve(__dirname, "..");

test("integration readiness validates P0 interface and external contract coverage", () => {
  const report = buildIntegrationReadinessReport();
  assert.equal(report.ok, true);
  assert.equal(report.p0InterfaceCount >= 5, true);
  assert.equal(report.contractCount >= 7, true);
  assert.equal(report.p0Coverage.every((item) => item.ready), true);
  assert.equal(report.contracts.every((item) => item.idempotencyKey && item.signature && item.retryPolicy), true);
  assert.equal(report.p0Coverage.find((item) => item.interfaceId === "if-medical").domainCoverage.every((item) => item.ready), true);
});

test("integration readiness fails when a required medical contract is absent", () => {
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "db.json"), "utf8"));
  data.integrationContracts = data.integrationContracts.filter((item) => item.domain !== "PACS");
  const report = buildIntegrationReadinessReport({ data });
  assert.equal(report.ok, false);
  assert.equal(report.checks.some((item) => item.id === "integration:medicalCoverage" && !item.passed), true);
});

test("integration readiness renders and writes release artifacts", (t) => {
  const outputDir = path.join(ROOT, "tmp", "integration-readiness-test");
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
  const report = buildIntegrationReadinessReport();
  const markdown = renderMarkdown(report);
  assert.match(markdown, /Integration readiness report/);
  assert.match(markdown, /P0 coverage/);

  writeOutput(report, {
    output: path.join("tmp", "integration-readiness-test", "integration-readiness-report.json"),
    markdown: path.join("tmp", "integration-readiness-test", "integration-readiness-report.md")
  });

  const writtenJson = JSON.parse(fs.readFileSync(path.join(outputDir, "integration-readiness-report.json"), "utf8"));
  const writtenMarkdown = fs.readFileSync(path.join(outputDir, "integration-readiness-report.md"), "utf8");
  assert.equal(writtenJson.ok, true);
  assert.match(writtenMarkdown, /his-patient-v1/);
});

test("integration readiness CLI parser keeps output flags", () => {
  const parsed = parseArgs(["--output=release/integration-readiness-report.json", "--markdown=release/integration-readiness-report.md"]);
  assert.equal(parsed.output, "release/integration-readiness-report.json");
  assert.equal(parsed.markdown, "release/integration-readiness-report.md");
});
