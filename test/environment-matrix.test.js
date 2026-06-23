const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { buildEnvironmentMatrixReport, parseArgs, renderMarkdown, writeOutput } = require("../scripts/environment-matrix");

const ROOT = path.resolve(__dirname, "..");

test("environment matrix validates demo staging and production gates", () => {
  const report = buildEnvironmentMatrixReport();
  assert.equal(report.ok, true);
  assert.deepEqual(report.profiles.map((item) => item.id), ["demo", "staging", "production"]);
  assert.equal(report.profiles.every((item) => item.missingScripts.length === 0), true);
  assert.equal(report.profiles.every((item) => item.missingTemplateVars.length === 0), true);
  assert.equal(report.profiles.some((item) => item.id === "production" && item.blockedVars.includes("STORAGE_ENGINE=postgres")), true);
  assert.equal(report.checks.some((item) => item.id === "environment:productionTracks" && item.passed), true);
});

test("environment matrix fails when production variables are absent from template", () => {
  const report = buildEnvironmentMatrixReport({
    envTemplate: "PORT=5173\nNODE_ENV=production\nSTORAGE_ENGINE=auto\nSESSION_SECRETS=secret\nINTEGRATION_GATEWAY_SECRET=secret\n",
    pkg: {
      scripts: {
        "env:check": "x",
        "env:check:production": "x",
        "release:report": "x",
        "deploy:check:full": "x",
        "release:report:full": "x",
        "integration:readiness": "x",
        "operations:readiness": "x",
        "monitoring:readiness": "x"
      }
    },
    data: { productionDeploymentPlan: [{ id: "prod-release", nextAction: "production" }, { id: "prod-storage" }, { id: "prod-identity" }, { id: "prod-audit" }] },
    readme: "env:check:production release:report",
    deployment: ".env.example env:check:production"
  });
  assert.equal(report.ok, false);
  assert.equal(report.checks.some((item) => item.id === "environment:templateVars" && !item.passed), true);
});

test("environment matrix renders and writes artifacts", (t) => {
  const outputDir = path.join(ROOT, "tmp", "environment-matrix-test");
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
  const report = buildEnvironmentMatrixReport();
  const markdown = renderMarkdown(report);
  assert.match(markdown, /Environment matrix report/);
  assert.match(markdown, /staging/);
  assert.match(markdown, /Production cutover/);

  writeOutput(report, {
    output: path.join("tmp", "environment-matrix-test", "environment-matrix-report.json"),
    markdown: path.join("tmp", "environment-matrix-test", "environment-matrix-report.md")
  });

  const writtenJson = JSON.parse(fs.readFileSync(path.join(outputDir, "environment-matrix-report.json"), "utf8"));
  const writtenMarkdown = fs.readFileSync(path.join(outputDir, "environment-matrix-report.md"), "utf8");
  assert.equal(writtenJson.ok, true);
  assert.match(writtenMarkdown, /Gate scripts/);
});

test("environment matrix CLI parser keeps output flags", () => {
  const parsed = parseArgs(["--output=release/environment-matrix-report.json", "--markdown=release/environment-matrix-report.md"]);
  assert.equal(parsed.output, "release/environment-matrix-report.json");
  assert.equal(parsed.markdown, "release/environment-matrix-report.md");
});
