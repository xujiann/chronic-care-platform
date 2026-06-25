const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { buildSiteReadinessPack, parseArgs, renderMarkdown, renderTemplateReadmes, writeOutput } = require("../scripts/site-readiness-pack");

const ROOT = path.resolve(__dirname, "..");

test("site readiness pack creates implementation templates", () => {
  const report = buildSiteReadinessPack();
  assert.equal(report.ok, true);
  assert.equal(report.packs.length, 4);
  assert.equal(report.templates.identity.length >= 5, true);
  assert.equal(report.templates.interfaces.length >= 5, true);
  assert.equal(report.templates.monitoring.length >= 4, true);
  assert.equal(report.templates.identity.some((item) => item.field === "sub"), true);
  assert.equal(report.templates.interfaces.some((item) => item.requiredFields.includes("residentId")), true);
  assert.equal(report.templates.monitoring.some((item) => item.signal === "/api/health"), true);
  assert.equal(report.templates.identity.some((item) => item.id.includes("undefined")), false);
  assert.equal(report.templates.monitoring.some((item) => item.id.includes("undefined")), false);
  assert.equal(report.templates.signoff.some((item) => item.id === "signoff-cutover-institution-interfaces"), true);
  assert.equal(report.policySourceRules.required, true);
  assert.equal(report.policySourceRules.sources.length >= 5, true);
  assert.equal(report.policySourceRules.sources.some((item) => item.documentNo === "医保发〔2025〕7号"), true);
  assert.equal(report.checks.some((item) => item.id === "site-pack:policy-source-links" && item.passed), true);
  assert.equal(report.checks.every((item) => item.passed), true);
});

test("site readiness pack fails when field mappings are absent", () => {
  const report = buildSiteReadinessPack({
    interfaceMapping: {
      mappings: [
        { contractId: "broken", owner: "test-owner", fieldCoverage: [] }
      ]
    }
  });
  assert.equal(report.ok, false);
  assert.equal(report.checks.some((item) => item.id === "site-pack:interfaces" && !item.passed), true);
});

test("site readiness pack renders and writes release artifacts", (t) => {
  const outputDir = path.join(ROOT, "tmp", "site-readiness-pack-test");
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
  const report = buildSiteReadinessPack();
  const markdown = renderMarkdown(report);
  const readmes = renderTemplateReadmes(report);
  assert.match(markdown, /Site readiness pack/);
  assert.match(markdown, /Identity source mapping template/);
  assert.match(markdown, /Interface joint-test template/);
  assert.match(markdown, /Site signoff template/);
  assert.match(markdown, /Platform policy source rule/);
  assert.match(markdown, /医保发〔2025〕7号/);
  assert.match(readmes["identity-source-mapping/README.md"], /What this template supports now/);
  assert.match(readmes["identity-source-mapping/README.md"], /Current implementation coverage/);
  assert.match(readmes["interface-joint-test/README.md"], /\/api\/integrations\/gateway/);
  assert.match(readmes["monitoring-on-call/README.md"], /\/api\/metrics/);
  assert.match(readmes["production-signoff/README.md"], /production-cutover-checklist\.md/);

  writeOutput(report, {
    output: path.join("tmp", "site-readiness-pack-test", "site-readiness-pack.json"),
    markdown: path.join("tmp", "site-readiness-pack-test", "site-readiness-pack.md")
  });

  const writtenJson = JSON.parse(fs.readFileSync(path.join(outputDir, "site-readiness-pack.json"), "utf8"));
  const writtenMarkdown = fs.readFileSync(path.join(outputDir, "site-readiness-pack.md"), "utf8");
  const identityReadme = fs.readFileSync(path.join(outputDir, "templates", "identity-source-mapping", "README.md"), "utf8");
  const interfaceReadme = fs.readFileSync(path.join(outputDir, "templates", "interface-joint-test", "README.md"), "utf8");
  assert.equal(writtenJson.ok, true);
  assert.match(writtenMarkdown, /Monitoring and on-call template/);
  assert.match(identityReadme, /Current status: template-ready/);
  assert.match(identityReadme, /How to verify now/);
  assert.match(interfaceReadme, /Rows preview/);
  assert.match(interfaceReadme, /Platform policy source rule/);
  assert.match(interfaceReadme, /Drug traceability policy sources/);
  assert.match(interfaceReadme, /NMPAB\/T 1011-2022/);
});

test("site readiness CLI parser keeps output and env flags", () => {
  const parsed = parseArgs(["--output=release/site-readiness-pack.json", "--markdown=release/site-readiness-pack.md", "--config-env=.env"]);
  assert.equal(parsed.output, "release/site-readiness-pack.json");
  assert.equal(parsed.markdown, "release/site-readiness-pack.md");
  assert.equal(parsed.envFile, ".env");
});
