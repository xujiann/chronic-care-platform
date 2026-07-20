const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { buildPilotAcceptanceCenter } = require("../pilot-acceptance");
const { parseArgs, renderMarkdown, writeOutput } = require("../scripts/pilot-acceptance-readiness");

const ROOT = path.resolve(__dirname, "..");

test("pilot acceptance center covers all planned development tracks", () => {
  const center = buildPilotAcceptanceCenter({ env: {} });
  assert.equal(center.ok, true);
  assert.equal(center.functionalState, "pilot-acceptance-tooling-ready");
  assert.equal(center.formalGoLiveState, "blocked-until-site-evidence-signed");
  assert.equal(center.applications.length, 8);
  assert.equal(center.applications.every((item) => item.status === "regression-ready"), true);
  assert.equal(center.alerting.contractReady, true);
  assert.equal(center.alerting.adapterReady, false);
  assert.equal(center.onsiteTasks.length, 10);
  assert.equal(center.onsiteTasks.every((item) => item.owner && item.targetWindow && item.evidence && item.doneWhen), true);
  assert.deepEqual(center.interfaceSamples.map((item) => item.id), ["official-grouper", "insurance-core", "his-emr-feed", "physical-exam-feed"]);
  assert.equal(center.interfaceSamples.every((item) => !item.containsPatientData && item.idempotencyKey && item.retryPolicy), true);
  assert.equal(center.trialRun.scenarios.length, 7);
  assert.equal(center.trialRun.scenarios.every((item) => item.passed && item.mode === "synthetic-no-patient-data"), true);
  assert.equal(center.issues.some((item) => item.id === "PILOT-ISSUE-ALERTING"), true);
  assert.match(center.boundary, /does not configure a real receiver/);
});

test("pilot alerting preflight recognizes a configured HTTPS route without claiming production signoff", () => {
  const center = buildPilotAcceptanceCenter({
    env: {
      NODE_ENV: "production",
      SIEM_ENDPOINT: "https://siem.example.invalid/alerts",
      SIEM_SIGNING_SECRET: "a-strong-synthetic-secret-with-32-characters",
      CUTOVER_MONITORING_SIGNOFF: "false"
    }
  });
  assert.equal(center.alerting.adapterReady, true);
  assert.equal(center.alerting.routes.find((item) => item.route === "SIEM").status, "configured");
  assert.equal(center.alerting.signoffRecorded, false);
  assert.equal(center.formalGoLiveState, "blocked-until-site-evidence-signed");
  assert.equal(center.issues.some((item) => item.id === "PILOT-ISSUE-ALERTING"), false);
});

test("pilot acceptance readiness renders and writes release artifacts", (t) => {
  const outputDir = path.join(ROOT, "tmp", "pilot-acceptance-test");
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
  const center = buildPilotAcceptanceCenter({ env: {} });
  const markdown = renderMarkdown(center);
  assert.match(markdown, /Eight-application regression matrix/);
  assert.match(markdown, /P0 on-site acceptance task pack/);
  assert.match(markdown, /synthetic identifiers and contain no patient data/);
  assert.match(markdown, /Issue ledger/);

  writeOutput(center, {
    output: path.join("tmp", "pilot-acceptance-test", "pilot-acceptance.json"),
    markdown: path.join("tmp", "pilot-acceptance-test", "pilot-acceptance.md")
  });
  assert.equal(JSON.parse(fs.readFileSync(path.join(outputDir, "pilot-acceptance.json"), "utf8")).summary.applications, 8);
  assert.match(fs.readFileSync(path.join(outputDir, "pilot-acceptance.md"), "utf8"), /blocked-until-site-evidence-signed/);
});

test("pilot acceptance CLI parser keeps output and environment flags", () => {
  assert.deepEqual(parseArgs(["--output=tmp/report.json", "--markdown=tmp/report.md", "--config-env=.env.pilot"]), {
    output: "tmp/report.json",
    markdown: "tmp/report.md",
    envFile: ".env.pilot"
  });
});
