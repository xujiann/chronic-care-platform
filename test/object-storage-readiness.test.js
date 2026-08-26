const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { buildObjectStorageReadiness, parseArgs, renderMarkdown, writeOutput } = require("../scripts/object-storage-readiness");

const ROOT = path.resolve(__dirname, "..");

test("object storage readiness separates adapter foundation from production acceptance", () => {
  const report = buildObjectStorageReadiness();
  assert.equal(report.ok, true);
  assert.equal(report.productionReady, false);
  assert.equal(report.status, "durable-v2-repository-ready-external-evidence-pending");
  assert.equal(report.summary.controlsReady, report.summary.controls);
  assert.equal(report.summary.apiGroupsReady, report.summary.apiGroups);
  assert.equal(report.controls.every((item) => item.passed), true);
  assert.equal(report.controls.some((item) => item.id === "gateway-response-trust" && item.passed), true);
  assert.equal(report.controls.some((item) => item.id === "signed-url-boundary" && item.passed), true);
  assert.equal(report.controls.some((item) => item.id === "explicit-receipts" && item.passed), true);
  assert.equal(report.apiRoutes.every((item) => item.passed), true);
  assert.equal(report.controls.some((item) => item.id === "durable-command-track" && item.passed), true);
  assert.equal(report.controls.some((item) => item.id === "fenced-worker-dlq" && item.passed), true);
  assert.equal(report.controls.some((item) => item.id === "sqlite-v17" && item.passed), true);
  assert.equal(report.blockers.length, 10);
});

test("object storage readiness fails when malware enforcement is removed", () => {
  const source = fs.readFileSync(path.join(ROOT, "secure-object-storage.js"), "utf8").replace("malware scan did not pass", "scan marker removed");
  const report = buildObjectStorageReadiness({ adapterSource: source });
  assert.equal(report.ok, false);
  assert.equal(report.checks.some((item) => item.id === "objectStorage:controls" && !item.passed), true);
});

test("object storage readiness fails when response trust or URL boundary enforcement is removed", () => {
  const source = fs.readFileSync(path.join(ROOT, "secure-object-storage.js"), "utf8")
    .replaceAll("verifyGatewayResponse", "response verification removed")
    .replaceAll("OBJECT_STORAGE_UPLOAD_URL_ALLOWED_ORIGINS", "upload origin marker removed");
  const report = buildObjectStorageReadiness({ adapterSource: source });
  assert.equal(report.ok, false);
  assert.equal(report.controls.some((item) => item.id === "gateway-response-trust" && !item.passed), true);
  assert.equal(report.controls.some((item) => item.id === "signed-url-boundary" && !item.passed), true);
});

test("object storage readiness renders and writes release artifacts", (t) => {
  const outputDir = path.join(ROOT, "tmp", "object-storage-readiness-test");
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
  const report = buildObjectStorageReadiness();
  const markdown = renderMarkdown(report);
  assert.match(markdown, /Object storage and attachment security readiness/);
  assert.match(markdown, /Production blockers/);
  assert.match(markdown, /\/api\/attachments\/upload-intents/);
  writeOutput(report, {
    output: "tmp/object-storage-readiness-test/report.json",
    markdown: "tmp/object-storage-readiness-test/report.md"
  });
  assert.equal(JSON.parse(fs.readFileSync(path.join(outputDir, "report.json"), "utf8")).ok, true);
  assert.match(fs.readFileSync(path.join(outputDir, "report.md"), "utf8"), /objectStorage:controls/);
});

test("object storage readiness CLI parser keeps output flags", () => {
  assert.deepEqual(parseArgs(["--output=release/object-storage.json", "--markdown=release/object-storage.md"]), {
    output: "release/object-storage.json",
    markdown: "release/object-storage.md"
  });
});
