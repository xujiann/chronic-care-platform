#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const { buildGovernanceCatalog } = require("../quality-operations-governance-adapter");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT, "release", "quality-operations-governance-readiness-report.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "quality-operations-governance-readiness-report.md");
const REQUIRED_ROUTES = [
  { route: "/api/quality-operations-governance/catalog", marker: 'pathname === "/api/quality-operations-governance/catalog"' },
  { route: "/api/quality-operations-governance/items", marker: 'pathname === "/api/quality-operations-governance/items"' },
  { route: "/api/quality-operations-governance/items/:id/audit", marker: "governanceAuditMatch" },
  { route: "/api/quality-operations-governance/items/:id/actions", marker: "governanceActionMatch" }
];

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function check(id, passed, detail) {
  return { id, passed: Boolean(passed), detail };
}

function buildQualityOperationsGovernanceReadiness(options = {}) {
  const data = options.data || readJson(path.join(ROOT, "data", "db.json"));
  const pkg = options.pkg || readJson(path.join(ROOT, "package.json"));
  const serverSource = options.serverSource ?? fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
  const catalog = buildGovernanceCatalog(data);
  const routeChecks = REQUIRED_ROUTES.map(({ route, marker }) => ({
    route,
    registered: serverSource.includes(marker)
  }));
  const checks = [
    check("governance:collections", catalog.sourceCollections.length === 3 && catalog.sourceCollections.every((item) => item.rows > 0), catalog.sourceCollections.map((item) => `${item.collection}:${item.rows}`).join(",")),
    check("governance:mapping", catalog.summary.unmapped === 0, `${catalog.summary.records} records / ${catalog.summary.unmapped} unmapped`),
    check("governance:metrics", catalog.metricCatalog.ok, `${catalog.metricCatalog.metrics} governed metrics`),
    check("governance:routes", routeChecks.every((item) => item.registered), routeChecks.map((item) => `${item.route}:${item.registered ? "yes" : "no"}`).join(",")),
    check("governance:script", Boolean(pkg.scripts?.["quality-operations:governance-readiness"]), pkg.scripts?.["quality-operations:governance-readiness"] || "missing"),
    check("governance:production-boundary", catalog.productionReady === false && catalog.blockers.length >= 4, `${catalog.blockers.length} production blockers retained`)
  ];
  return {
    ok: checks.every((item) => item.passed),
    productionReady: false,
    generatedAt: new Date().toISOString(),
    catalog,
    routes: routeChecks,
    checks,
    blockers: catalog.blockers,
    boundary: "Local governance routing and audit persistence do not replace trusted identity, live source interfaces, production storage, SIEM, duty or disaster-recovery evidence."
  };
}

function renderMarkdown(report) {
  return [
    "# Quality operations governance readiness",
    "",
    `- Local readiness: ${report.ok ? "PASS" : "BLOCKED"}`,
    `- Production ready: ${report.productionReady ? "yes" : "no"}`,
    `- Unified records: ${report.catalog.summary.records}`,
    `- Unmapped source statuses: ${report.catalog.summary.unmapped}`,
    "",
    "## Checks",
    "",
    "| Result | Check | Detail |",
    "|---|---|---|",
    ...report.checks.map((item) => `| ${item.passed ? "PASS" : "BLOCKED"} | ${item.id} | ${String(item.detail).replace(/\|/g, "/")} |`),
    "",
    "## Source collections",
    "",
    "| Collection | Domain | Rows |",
    "|---|---|---:|",
    ...report.catalog.sourceCollections.map((item) => `| ${item.collection} | ${item.domain} | ${item.rows} |`),
    "",
    "## Production blockers",
    "",
    ...report.blockers.map((item) => `- ${item}`),
    "",
    report.boundary,
    ""
  ].join("\n");
}

function parseArgs(argv = process.argv.slice(2)) {
  const options = {};
  argv.forEach((arg) => {
    if (arg.startsWith("--output=")) options.output = path.resolve(ROOT, arg.slice("--output=".length));
    if (arg.startsWith("--markdown=")) options.markdown = path.resolve(ROOT, arg.slice("--markdown=".length));
    if (arg === "--check") options.checkOnly = true;
  });
  return options;
}

function writeReport(options = {}) {
  const report = buildQualityOperationsGovernanceReadiness(options);
  if (!options.checkOnly) {
    const output = options.output || DEFAULT_OUTPUT;
    const markdown = options.markdown || DEFAULT_MARKDOWN;
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.mkdirSync(path.dirname(markdown), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(report, null, 2), "utf8");
    fs.writeFileSync(markdown, renderMarkdown(report), "utf8");
  }
  return report;
}

if (require.main === module) {
  const report = writeReport(parseArgs());
  console.log(JSON.stringify({ ok: report.ok, productionReady: report.productionReady, checks: report.checks.length }, null, 2));
  if (!report.ok) process.exitCode = 1;
}

module.exports = {
  DEFAULT_MARKDOWN,
  DEFAULT_OUTPUT,
  REQUIRED_ROUTES,
  buildQualityOperationsGovernanceReadiness,
  parseArgs,
  renderMarkdown,
  writeReport
};
