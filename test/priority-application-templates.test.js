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
  assert.equal(report.templates.some((item) => item.conversationTitle === "区域诊疗数据共享平台"), true);
  assert.equal(report.templates.some((item) => item.conversationTitle === "卫生健康综合驾驶舱" && item.aggregateApplication), true);
  assert.match(markdown, /Priority application templates/);
  assert.match(markdown, /Conversation handoff/);
  assert.match(markdown, /Policy and documentation/);
  assert.match(markdown, /docs\/政策依据说明\.md/);
  assert.match(markdown, /docs\/<module-name>\.md/);
  assert.match(markdown, /科研数据集与数据沙箱平台/);

  writeOutput(report, {
    output: path.join("tmp", "priority-application-templates-test", "priority-application-templates.json"),
    markdown: path.join("tmp", "priority-application-templates-test", "priority-application-templates.md")
  });

  const writtenJson = JSON.parse(fs.readFileSync(path.join(outputDir, "priority-application-templates.json"), "utf8"));
  const writtenMarkdown = fs.readFileSync(path.join(outputDir, "priority-application-templates.md"), "utf8");
  assert.equal(writtenJson.summary.applications, 8);
  assert.match(writtenMarkdown, /医联体转诊与远程会诊平台/);
  assert.match(writtenMarkdown, /docs\/政策依据说明\.md/);
});

test("priority application template CLI parser keeps output flags", () => {
  const parsed = parseArgs(["--output=release/priority-application-templates.json", "--markdown=release/priority-application-templates.md"]);
  assert.equal(parsed.output, "release/priority-application-templates.json");
  assert.equal(parsed.markdown, "release/priority-application-templates.md");
});
