const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  buildRegistrationReferralAcceptance,
  parseArgs,
  renderMarkdown,
  writeOutput
} = require("../scripts/registration-referral-acceptance");

test("T05 acceptance passes while reporting T00 public integration blockers", () => {
  const report = buildRegistrationReferralAcceptance({ asOf: "2026-07-22T00:00:00.000Z" });
  assert.equal(report.ok, true);
  assert.equal(report.threadReady, true);
  assert.equal(report.integrationReady, false);
  assert.equal(report.productionReady, false);
  assert.equal(report.status, "thread-ready-t00-integration-pending");
  assert.equal(report.summary.threadPassed, report.summary.threadChecks);
  assert.equal(report.summary.p0ConsistencyIssues, 0);
  assert.equal(report.summary.commands, 40);
  assert.ok(report.integrationChecks.some((item) => item.id.endsWith("serverReferralSeed") && item.passed));
  assert.ok(report.integrationChecks.some((item) => item.id.endsWith("serverMessageSeed") && !item.passed));
});

test("acceptance recognizes a fully wired synthetic T00 integration", () => {
  const serverSource = `
function seedReferralTeleconsultations() {
  return [
    { id: "rtc-001", collaborationOrderId: "cco-004" },
    { id: "rtc-002", collaborationOrderId: "cco-005" }
  ];
}
function seedTaskMessages() {
  return [
    { id: "msg-rtc-002-report-citizen", residentId: "r4" },
    { id: "msg-rtc-002-report-institution", residentId: "r4" }
  ];
}
const commandPath = "/api/registration-referral/commands";
applyClosureCommand(data, command, user);
`;
  const report = buildRegistrationReferralAcceptance({
    asOf: "2026-07-22T00:00:00.000Z",
    serverSource,
    pkg: { scripts: { "registration-referral:acceptance": "node scripts/registration-referral-acceptance.js" } },
    releaseWired: true
  });
  assert.equal(report.threadReady, true);
  assert.equal(report.integrationReady, true);
  assert.equal(report.productionReady, false);
  assert.equal(report.status, "integrated-local-ready-production-blocked");
});

test("acceptance renders and writes T00 handoff evidence", (t) => {
  const report = buildRegistrationReferralAcceptance({ asOf: "2026-07-22T00:00:00.000Z" });
  const markdown = renderMarkdown(report);
  assert.match(markdown, /Thread ready: PASS/);
  assert.match(markdown, /T00 integration ready: PENDING/);
  assert.match(markdown, /serverReferralSeed/);
  assert.match(markdown, /record-primary-care-assessment/);
  assert.match(markdown, /terminate-family-doctor-contract/);
  assert.match(markdown, /create-down-referral/);

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "registration-referral-acceptance-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const output = path.join(directory, "acceptance.json");
  const markdownOutput = path.join(directory, "acceptance.md");
  writeOutput(report, { output, markdown: markdownOutput });
  assert.equal(JSON.parse(fs.readFileSync(output, "utf8")).threadReady, true);
  assert.match(fs.readFileSync(markdownOutput, "utf8"), /T00 Blockers/);
});

test("acceptance parses artifact paths and as-of time", () => {
  const flags = parseArgs(["--output=output/acceptance.json", "--markdown=output/acceptance.md", "--as-of=2026-07-22T00:00:00.000Z"]);
  assert.match(flags.output, /output[\\/]acceptance\.json$/);
  assert.match(flags.markdown, /output[\\/]acceptance\.md$/);
  assert.equal(flags.asOf, "2026-07-22T00:00:00.000Z");
});
