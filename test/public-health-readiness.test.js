const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  STANDARD_TOTALS,
  buildPublicHealthReadinessReport,
  buildPublicHealthSystem,
  renderMarkdown,
  seedPublicHealthStandards
} = require("../scripts/public-health-readiness");

const ROOT = path.resolve(__dirname, "..");

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

test("public health system covers the full 21/125/421 standard matrix", () => {
  const data = readJson("data/db.json");
  const system = buildPublicHealthSystem({ data });

  assert.equal(system.ok, true);
  assert.deepEqual(system.standardCoverage, STANDARD_TOTALS);
  assert.equal(system.standardDomains.length, 21);
  assert.equal(system.standardCoverage.management.domains, 18);
  assert.equal(system.standardCoverage.management.secondary, 105);
  assert.equal(system.standardCoverage.management.tertiary, 365);
  assert.equal(system.standardCoverage.technology.domains, 3);
  assert.equal(system.standardCoverage.technology.secondary, 20);
  assert.equal(system.standardCoverage.technology.tertiary, 56);
  assert.equal(seedPublicHealthStandards().reduce((sum, item) => sum + item.tertiaryCount, 0), 421);
  assert.equal(system.standardDomains.some((item) => item.name === "传染病防控" && item.tertiaryCount === 49), true);
  assert.equal(system.standardDomains.some((item) => item.name === "网络安全管理" && item.tertiaryCount === 34), true);
});

test("public health readiness exposes institution scopes, event loop, and exchange tasks", () => {
  const data = readJson("data/db.json");
  const report = buildPublicHealthReadinessReport({ data });

  assert.equal(report.ok, true);
  assert.equal(report.institutionScopes.length >= 7, true);
  assert.equal(report.institutionScopes.some((item) => /疾病预防控制中心/.test(item.name)), true);
  assert.equal(report.institutionScopes.some((item) => /二级及以上医院/.test(item.name)), true);
  assert.equal(report.institutionScopes.some((item) => /卫生健康监督机构/.test(item.name)), true);
  assert.equal(report.riskQueue.length >= 3, true);
  assert.equal(report.riskQueue.every((item) => item.commandAction && item.followupAction && item.linkedStandardItems.length), true);
  ["direct-report", "laboratory", "immunization", "maternal-child", "emergency", "security"].forEach((category) => {
    assert.equal(report.exchangeTasks.some((item) => item.category === category), true, `${category} exchange task missing`);
  });
  assert.equal(report.exchangeRuns.length >= 6, true);
  assert.equal(report.exchangeRuns.every((item) => item.receiptStatus && item.compensationStatus), true);
  assert.equal(report.exchangeRuns.some((item) => item.compensationStatus === "replayed" || item.compensationStatus === "manual-review"), true);
  assert.equal(report.institutionTasks.length >= 7, true);
  assert.equal(report.institutionTasks.every((item) => item.scopeId && item.owner && item.handoffStatus && item.accountStatus), true);
  assert.equal(report.onsiteAcceptances.length >= 6, true);
  assert.equal(report.onsiteAcceptances.every((item) => item.owner && item.blocker && item.onsiteAction), true);
  ["exchange:runs", "exchange:compensation", "institution:tasks", "onsite:acceptance"].forEach((id) => {
    assert.equal(report.checks.some((item) => item.id === id && item.passed), true, `${id} check missing`);
  });
  assert.equal(report.checks.every((item) => item.passed), true);

  const markdown = renderMarkdown(report);
  assert.match(markdown, /Public health informatization readiness report/);
  assert.match(markdown, /传染病防控/);
  assert.match(markdown, /二级及以上医院/);
  assert.match(markdown, /direct-report/);
  assert.match(markdown, /Exchange runs/);
  assert.match(markdown, /On-site acceptance/);
});

test("public health page, API, docs and release manifest are wired", () => {
  const server = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "public-health.html"), "utf8");
  const js = fs.readFileSync(path.join(ROOT, "public-health.js"), "utf8");
  const auth = fs.readFileSync(path.join(ROOT, "auth.js"), "utf8");
  const pkg = readJson("package.json");
  const doc = fs.readFileSync(path.join(ROOT, "docs", "公共卫生信息化系统建设报告.md"), "utf8");
  const plan = fs.readFileSync(path.join(ROOT, "docs", "公共卫生信息化下一步开发计划.md"), "utf8");
  const manifest = fs.readFileSync(path.join(ROOT, "scripts", "release-artifact-manifest.js"), "utf8");

  assert.match(server, /\/api\/public-health\/system/);
  assert.match(server, /\/api\/public-health\/events\/:id\/actions/);
  assert.match(server, /\/api\/public-health\/exchange-tasks\/:id\/runs/);
  assert.match(server, /\/api\/public-health\/institution-tasks\/:id\/actions/);
  assert.match(server, /\/api\/public-health\/onsite-acceptances\/:id\/actions/);
  assert.match(server, /public-health-event-action/);
  assert.match(server, /public-health-exchange-run/);
  assert.match(server, /public-health-institution-task-action/);
  assert.match(server, /public-health-onsite-acceptance/);
  assert.match(server, /buildPublicHealthSystem/);
  assert.match(html, /public-health-metrics/);
  assert.match(html, /public-health-exchange-runs/);
  assert.match(html, /public-health-institution-tasks/);
  assert.match(html, /public-health-onsite-acceptances/);
  assert.match(js, /renderPublicHealthSystem/);
  assert.match(js, /data-public-health-action/);
  assert.match(js, /data-public-health-latest-action/);
  assert.match(js, /data-public-health-exchange-run/);
  assert.match(js, /data-public-health-institution-task/);
  assert.match(js, /data-public-health-onsite-acceptance/);
  assert.match(auth, /"public-health\.html": \["commission"\]/);
  assert.equal(pkg.scripts["public-health:readiness"], "node scripts/public-health-readiness.js");
  assert.match(doc, /21\/125\/421/);
  assert.match(doc, /平战结合/);
  assert.match(doc, /医防融合/);
  assert.match(doc, /\/api\/public-health\/system/);
  assert.match(doc, /\/api\/public-health\/events\/:id\/actions/);
  assert.match(doc, /\/api\/public-health\/exchange-tasks\/:id\/runs/);
  assert.match(doc, /publicHealthExchangeRuns/);
  assert.match(doc, /publicHealthInstitutionTasks/);
  assert.match(doc, /publicHealthOnsiteAcceptances/);
  assert.match(plan, /5 小时开发切片/);
  assert.match(plan, /事件处置闭环/);
  assert.match(plan, /验收清单/);
  assert.match(manifest, /public-health-readiness-report\.md/);
  assert.match(manifest, /public-health:readiness/);
});
