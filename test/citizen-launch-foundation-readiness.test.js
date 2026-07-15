const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildCitizenLaunchFoundationReadiness,
  renderMarkdown,
  writeReport
} = require("../scripts/citizen-launch-foundation-readiness");

test("citizen launch foundation readiness captures phase-one gates", () => {
  const phaseDoc = fs.readFileSync(path.join(__dirname, "..", "docs", "citizen-launch-foundation-plan.md"), "utf8");
  const report = buildCitizenLaunchFoundationReadiness({ phaseDoc });
  assert.equal(report.ok, true);
  assert.equal(report.phase, "Phase 1 - launch foundation");
  assert.equal(report.launchState, "controlled-pilot-ready");
  assert.equal(report.acceptancePanel.entry, "citizen.html?client=app&page=health-record&launch=1#citizen-pipeline-panel");
  assert.equal(report.acceptancePanel.panelId, "citizen-pipeline-panel");
  assert.equal(report.acceptancePanel.copyActionId, "copy-citizen-pipeline-audit");
  assert.equal(report.acceptancePanel.checklistTitle, "C端全管线现场验收清单");
  assert.deepEqual(report.summary.channels, ["mini-program", "app", "pwa"]);
  assert.equal(report.externalDependencies.some((item) => item.id === "sms-gateway"), true);
  assert.equal(report.externalDependencies.some((item) => item.id === "real-name-identity"), true);
  assert.equal(report.externalDependencies.some((item) => item.id === "guardian-relation"), true);
  assert.equal(report.externalDependencies.every((item) => item.status === "required-before-production" && item.owner && item.cutoverBlocker && item.evidence && item.onsiteAcceptance), true);
  assert.equal(report.externalDependencies.find((item) => item.id === "sms-gateway").owner, "platform-ops");
  assert.match(report.externalDependencies.find((item) => item.id === "sms-gateway").cutoverBlocker, /phone-code login/);
  assert.match(report.externalDependencies.find((item) => item.id === "real-name-identity").evidence, /claim mapping/);
  assert.match(report.externalDependencies.find((item) => item.id === "guardian-relation").onsiteAcceptance, /guardian-binding sample/);
  assert.equal(report.checks.some((item) => item.id === "citizen-foundation:phone-login" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "citizen-foundation:phone-code-delivery" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "citizen-foundation:sms-delivery-callback" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "citizen-foundation:account-provisioning-boundary" && item.passed), true);
  assert.equal(report.checks.find((item) => item.id === "citizen-foundation:account-provisioning-boundary").detail.includes("self-registration"), true);
  assert.equal(report.checks.find((item) => item.id === "citizen-foundation:phone-code-delivery").detail.includes("cooldown"), true);
  assert.equal(report.checks.find((item) => item.id === "citizen-foundation:phone-login").detail.includes("failed-attempt lockout"), true);
  assert.equal(report.checks.some((item) => item.id === "citizen-foundation:mobile-install-shell" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "citizen-foundation:app-shortcuts" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "citizen-foundation:mobile-preview-service-switch" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "citizen-foundation:pipeline-acceptance-checklist" && item.passed), true);
  assert.equal(report.checks.find((item) => item.id === "citizen-foundation:pipeline-acceptance-checklist").detail.includes("copyable onsite acceptance checklist"), true);
  assert.equal(report.checks.find((item) => item.id === "citizen-foundation:mobile-preview-service-switch").detail.includes("visible swipe hint"), true);
  assert.equal(report.checks.find((item) => item.id === "citizen-foundation:mobile-preview-service-switch").detail.includes("swipe gestures"), true);
  assert.equal(report.checks.find((item) => item.id === "citizen-foundation:mobile-preview-service-switch").detail.includes("resident in-page swipe navigation"), true);
  assert.equal(report.checks.find((item) => item.id === "citizen-foundation:mobile-preview-service-switch").detail.includes("acceptance summary"), true);
  assert.equal(report.checks.find((item) => item.id === "citizen-foundation:mobile-preview-service-switch").detail.includes("priority roadmap"), true);
  assert.equal(report.checks.find((item) => item.id === "citizen-foundation:mobile-preview-service-switch").detail.includes("focus-mode layout"), true);
  assert.equal(report.checks.find((item) => item.id === "citizen-foundation:mobile-preview-service-switch").detail.includes("auto-aligned viewport"), true);
  assert.equal(report.checks.some((item) => item.id === "citizen-foundation:launch-gates" && item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "citizen-foundation:production-requirements" && item.passed), true);
  assert.match(renderMarkdown(report), /Citizen launch foundation readiness/);
  assert.match(renderMarkdown(report), /Resident Acceptance Panel/);
  assert.match(renderMarkdown(report), /citizen\.html\?client=app&page=health-record&launch=1#citizen-pipeline-panel/);
  assert.match(renderMarkdown(report), /copy-citizen-pipeline-audit/);
  assert.match(renderMarkdown(report), /phone-code delivery/);
  assert.match(renderMarkdown(report), /sms-delivery-callback/);
  assert.match(renderMarkdown(report), /mobile-preview-service-switch/);
  assert.match(renderMarkdown(report), /pipeline-acceptance-checklist/);
  assert.match(renderMarkdown(report), /account-provisioning-boundary/);
  assert.match(renderMarkdown(report), /production SMS gateway/);
  assert.match(renderMarkdown(report), /Cutover blocker/);
  assert.match(renderMarkdown(report), /Required evidence/);
  assert.match(renderMarkdown(report), /Onsite acceptance/);
  assert.match(renderMarkdown(report), /platform-ops/);
});

test("citizen launch foundation readiness writes release artifacts", (t) => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "citizen-launch-foundation-"));
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
  const phaseDoc = fs.readFileSync(path.join(__dirname, "..", "docs", "citizen-launch-foundation-plan.md"), "utf8");
  const report = buildCitizenLaunchFoundationReadiness({ phaseDoc });
  const output = path.join(outputDir, "citizen-launch-foundation-readiness.json");
  const markdown = path.join(outputDir, "citizen-launch-foundation-readiness.md");
  writeReport(report, output, markdown);
  const json = JSON.parse(fs.readFileSync(output, "utf8"));
  const md = fs.readFileSync(markdown, "utf8");
  assert.equal(json.ok, true);
  assert.equal(json.citizenLaunchFoundationReadiness.ok, true);
  assert.equal(json.citizenLaunchFoundationReadiness.acceptancePanel.panelId, "citizen-pipeline-panel");
  assert.match(md, /External Dependencies/);
});
