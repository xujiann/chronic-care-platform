#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT, "release", "launch-smoke-report.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "launch-smoke-report.md");

const REQUIRED_ROUTES = [
  "/api/health",
  "/api/metrics",
  "/api/system/readiness",
  "/api/production-cutover-checklist",
  "/api/site-readiness-pack"
];

const REQUIRED_ARTIFACTS = [
  "release/release-report.json",
  "release/release-report.md",
  "release/production-cutover-checklist.json",
  "release/production-cutover-checklist.md",
  "release/site-readiness-pack.json",
  "release/site-readiness-pack.md",
  "release/monitoring-readiness-report.md",
  "release/operations-readiness-report.md"
];

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

function check(id, passed, detail, category = "launch-smoke") {
  return { id, category, passed: Boolean(passed), detail };
}

function parseArgs(argv = process.argv.slice(2)) {
  const flags = {};
  argv.forEach((arg) => {
    if (!arg.startsWith("--")) return;
    const [key, ...rest] = arg.slice(2).split("=");
    flags[key] = rest.length ? rest.join("=") : true;
  });
  return {
    baseUrl: flags["base-url"] || flags.url || "",
    output: flags.output || DEFAULT_OUTPUT,
    markdown: flags.markdown || DEFAULT_MARKDOWN
  };
}

function buildOfflineChecks() {
  const pkg = readJson("package.json");
  const serverSource = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
  const manifestSource = fs.readFileSync(path.join(ROOT, "scripts", "release-artifact-manifest.js"), "utf8");
  const releaseReport = fs.existsSync(path.join(ROOT, "release", "release-report.json"))
    ? readJson("release/release-report.json")
    : null;
  const cutover = fs.existsSync(path.join(ROOT, "release", "production-cutover-checklist.json"))
    ? readJson("release/production-cutover-checklist.json")
    : null;

  return [
    check("launch:script", Boolean(pkg.scripts?.["launch:smoke"]), pkg.scripts?.["launch:smoke"] || "missing package script"),
    check("launch:routes", REQUIRED_ROUTES.every((route) => serverSource.includes(route)), `${REQUIRED_ROUTES.length} read-only runtime routes declared`),
    check("launch:artifacts", REQUIRED_ARTIFACTS.every((file) => fs.existsSync(path.join(ROOT, file))), `${REQUIRED_ARTIFACTS.filter((file) => fs.existsSync(path.join(ROOT, file))).length}/${REQUIRED_ARTIFACTS.length} release artifacts present`),
    check("launch:manifest", ["release-report", "production-cutover", "site-readiness", "monitoring-readiness", "operations-readiness"].every((id) => manifestSource.includes(id)), "release manifest indexes launch smoke evidence"),
    check("launch:releaseReport", releaseReport?.ok === true && releaseReport?.summary?.failed === 0, releaseReport ? `${releaseReport.summary?.passed || 0}/${releaseReport.summary?.total || 0} checks passed` : "release report missing"),
    check("launch:cutoverChecklist", Array.isArray(cutover?.checklist) && cutover.checklist.length >= 8, cutover ? `${cutover.checklist?.length || 0} cutover rows` : "cutover checklist missing")
  ];
}

async function fetchJson(fetcher, url) {
  const response = await fetcher(url);
  const body = await response.json();
  return { status: response.status, ok: response.ok, body };
}

async function buildLiveChecks(baseUrl, fetcher = globalThis.fetch) {
  if (!baseUrl) return [];
  if (typeof fetcher !== "function") {
    return [check("live:fetch", false, "fetch is unavailable", "live")];
  }
  const root = String(baseUrl).replace(/\/+$/, "");
  const checks = [];
  try {
    const health = await fetchJson(fetcher, `${root}/api/health`);
    checks.push(check("live:health", health.ok && health.body?.ok !== false, `HTTP ${health.status}`, "live"));
  } catch (error) {
    checks.push(check("live:health", false, error.message, "live"));
  }
  return checks;
}

async function buildLaunchSmokeReport(options = {}) {
  const offlineChecks = buildOfflineChecks();
  const liveChecks = await buildLiveChecks(options.baseUrl || "", options.fetcher);
  const checks = [...offlineChecks, ...liveChecks];
  return {
    ok: checks.every((item) => item.passed),
    generatedAt: new Date().toISOString(),
    project: readJson("package.json").name,
    baseUrl: options.baseUrl || "",
    summary: {
      total: checks.length,
      passed: checks.filter((item) => item.passed).length,
      failed: checks.filter((item) => !item.passed).length,
      liveChecks: liveChecks.length
    },
    routes: REQUIRED_ROUTES,
    artifacts: REQUIRED_ARTIFACTS,
    checks
  };
}

function renderMarkdown(report) {
  const rows = report.checks.map((item) => `| ${item.passed ? "PASS" : "FAIL"} | ${item.category} | ${item.id} | ${String(item.detail || "").replace(/\|/g, "/")} |`);
  return [
    "# Launch smoke report",
    "",
    `- Generated at: ${report.generatedAt}`,
    `- Result: ${report.ok ? "PASS" : "FAIL"}`,
    `- Base URL: ${report.baseUrl || "offline-source-check"}`,
    `- Checks: ${report.summary.passed}/${report.summary.total}`,
    "",
    "## Checks",
    "",
    "| Result | Category | Check | Detail |",
    "|---|---|---|---|",
    ...rows,
    "",
    "## Runtime Routes",
    "",
    ...report.routes.map((route) => `- ${route}`),
    "",
    "## Release Artifacts",
    "",
    ...report.artifacts.map((artifact) => `- ${artifact}`),
    ""
  ].join("\n");
}

function writeOutput(report, flags = {}) {
  const output = path.resolve(ROOT, String(flags.output || DEFAULT_OUTPUT));
  const markdown = path.resolve(ROOT, String(flags.markdown || DEFAULT_MARKDOWN));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2), "utf8");
  fs.mkdirSync(path.dirname(markdown), { recursive: true });
  fs.writeFileSync(markdown, renderMarkdown(report), "utf8");
}

async function runCli() {
  const flags = parseArgs();
  const report = await buildLaunchSmokeReport(flags);
  writeOutput(report, flags);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}

if (require.main === module) {
  runCli().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  buildLaunchSmokeReport,
  parseArgs,
  renderMarkdown,
  writeOutput
};
