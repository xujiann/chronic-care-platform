const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { buildPriorityApplicationTemplates } = require("../scripts/health-dashboard-summary");
const { parseArgs, renderMarkdown, writeOutput } = require("../scripts/priority-application-templates");

const ROOT = path.resolve(__dirname, "..");

test("priority application template artifact renders every application handoff", (t) => {
  const outputDir = path.join(ROOT, "tmp", "priority-application-templates-test");
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));

  const report = buildPriorityApplicationTemplates();
  const markdown = renderMarkdown(report);

  assert.equal(report.ok, true);
  assert.equal(report.templates.length, 8);
  assert.equal(report.templates.some((item) => item.id === "regional-data-sharing"), true);
  assert.equal(report.templates.some((item) => item.id === "health-dashboard" && item.aggregateApplication), true);
  assert.equal(report.templates.every((item) => item.conversationStarter.includes(item.id) && item.conversationStarter.includes(item.frontendEntry)), true);
  assert.equal(report.templates.every((item) => item.implementationChecklist.length >= 8), true);
  assert.equal(report.templates.every((item) => item.acceptanceGate.readyWhen.length >= 4 && item.acceptanceGate.evidence.length), true);
  assert.match(markdown, /Priority application templates/);
  assert.match(markdown, /Conversation handoff/);
  assert.match(markdown, /Conversation starters/);
  assert.match(markdown, /Acceptance gates/);
  assert.match(markdown, /Starter prompt/);
  assert.match(markdown, /Current blockers/);
  assert.match(markdown, /Policy and documentation/);
  assert.match(markdown, /docs\/maternal-child-policy\.md/);
  assert.match(markdown, /docs\/<module-name>\.md/);
  assert.match(markdown, /docs\/妇幼健康全模块说明\.md/);
  assert.match(markdown, /Codex loop/);
  assert.match(markdown, /regional-data-sharing/);
  assert.match(markdown, /health-dashboard/);

  writeOutput(report, {
    output: path.join("tmp", "priority-application-templates-test", "priority-application-templates.json"),
    markdown: path.join("tmp", "priority-application-templates-test", "priority-application-templates.md")
  });

  const writtenJson = JSON.parse(fs.readFileSync(path.join(outputDir, "priority-application-templates.json"), "utf8"));
  const writtenMarkdown = fs.readFileSync(path.join(outputDir, "priority-application-templates.md"), "utf8");
  assert.equal(writtenJson.summary.applications, 8);
  assert.match(writtenJson.templates[0].conversationStarter, /regional-data-sharing/);
  assert.equal(writtenJson.templates.every((item) => item.acceptanceGate.readyWhen.length >= 4), true);
  assert.match(writtenMarkdown, /Implementation checklist/);
  assert.match(writtenMarkdown, /docs\/maternal-child-policy\.md/);
});

test("priority application template CLI parser keeps output flags", () => {
  const parsed = parseArgs(["--output=release/priority-application-templates.json", "--markdown=release/priority-application-templates.md"]);
  assert.equal(parsed.output, "release/priority-application-templates.json");
  assert.equal(parsed.markdown, "release/priority-application-templates.md");
});
