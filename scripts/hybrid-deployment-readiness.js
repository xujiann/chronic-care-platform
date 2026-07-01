#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT, "release", "hybrid-deployment-readiness-report.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "hybrid-deployment-readiness-report.md");

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function hasText(text, pattern) {
  return pattern.test(String(text || ""));
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasRouteLiteral(source, route) {
  const routePattern = escapeRegExp(route);
  return new RegExp(`(?:req\\.url|url\\.pathname)\\s*===\\s*["']${routePattern}["']`).test(source);
}

function check(id, passed, detail, category = "hybrid-deployment") {
  return { id, category, passed: Boolean(passed), detail };
}

function buildHybridDeploymentReadinessReport(options = {}) {
  const pkg = options.pkg ?? readJson("package.json");
  const data = options.data ?? readJson("data/db.json");
  const serverSource = options.serverSource ?? readText("server.js");
  const sharedSource = options.sharedSource ?? readText("shared.js");
  const authSource = options.authSource ?? readText("auth.js");
  const readme = options.readme ?? readText("README.md");
  const deployment = options.deployment ?? readText("DEPLOYMENT.md");
  const manifestSource = options.manifestSource ?? readText("scripts/release-artifact-manifest.js");
  const releaseReportSource = options.releaseReportSource ?? readText("scripts/release-report.js");
  const deployCheckSource = options.deployCheckSource ?? readText("scripts/deploy-check.js");
  const ciSource = options.ciSource ?? readText(".github/workflows/ci.yml");
  const envExample = options.envExample ?? readText(".env.example");

  const productionTracks = Array.isArray(data.productionDeploymentPlan) ? data.productionDeploymentPlan : [];
  const requiredScripts = ["dev", "hybrid:deployment-readiness", "deploy:check", "release:report", "release:manifest", "env:check"];
  const staticEntries = ["index.html", "login.html", "workbench.html", "citizen.html", "institution.html", "insurance.html", "county.html"];
  const dynamicRoutes = ["/api/health", "/api/auth/login", "/api/auth/me", "/api/state", "/api/metrics"];
  const envVars = ["PORT", "NODE_ENV", "STORAGE_ENGINE", "DATA_DIR", "SESSION_SECRETS", "INTEGRATION_GATEWAY_SECRET"];

  const topology = {
    staticPreview: {
      entries: staticEntries,
      documented: hasText(readme, /static|GitHub Pages|data\/db\.json/i) && hasText(deployment, /GitHub Pages|static/i),
      snapshotFallback: hasText(sharedSource, /data\/db\.json/) && hasText(sharedSource, /localStorage/),
      pageHostCannotRunNode: hasText(deployment, /GitHub Pages/) && hasText(deployment, /Node\.js|Node API|server\.js/)
    },
    dynamicBackend: {
      entry: "server.js",
      routeCoverage: dynamicRoutes.map((route) => ({ route, present: hasRouteLiteral(serverSource, route) })),
      createServer: hasText(serverSource, /http\.createServer/),
      authClient: hasText(authSource, /API_BASE/) && hasText(authSource, /auth\/login/)
    },
    storageBoundary: {
      storageEngineGuard: hasText(serverSource, /STORAGE_ENGINE/) && hasText(serverSource, /RUNTIME_STORAGE_ENGINES/),
      sqliteMirror: hasText(serverSource, /node:sqlite/) && hasText(serverSource, /data\/db\.json|db\.json/),
      postgresBlocked: hasText(serverSource, /PostgreSQL is tracked in productionDeploymentPlan but the runtime adapter is not enabled yet/),
      productionTrack: productionTracks.some((item) => item.id === "prod-storage-adapter")
    },
    releaseWiring: {
      scripts: requiredScripts.map((name) => ({ name, present: Boolean(pkg.scripts?.[name]) })),
      manifest: manifestSource.includes("hybrid-deployment-readiness-report.md") && manifestSource.includes("hybrid:deployment-readiness"),
      releaseReport: releaseReportSource.includes("hybridDeployment:readiness") && releaseReportSource.includes("buildHybridDeploymentReadinessReport"),
      deployCheck: deployCheckSource.includes("hybrid:deployment-readiness"),
      ci: ciSource.includes("npm run hybrid:deployment-readiness")
    },
    environment: {
      variables: envVars.map((name) => ({ name, present: envExample.includes(`${name}=`) }))
    }
  };

  const routeDetail = topology.dynamicBackend.routeCoverage.map((item) => `${item.route}:${item.present ? "present" : "missing"}`).join(";");
  const scriptDetail = topology.releaseWiring.scripts.map((item) => `${item.name}:${item.present ? "present" : "missing"}`).join(";");
  const envDetail = topology.environment.variables.map((item) => `${item.name}:${item.present ? "present" : "missing"}`).join(";");
  const checks = [
    check("hybrid:staticPreviewBoundary", topology.staticPreview.documented && topology.staticPreview.snapshotFallback && topology.staticPreview.pageHostCannotRunNode, "GitHub Pages/static preview documented with data/db.json and localStorage fallback", "static-preview"),
    check("hybrid:dynamicBackendRoutes", topology.dynamicBackend.createServer && topology.dynamicBackend.routeCoverage.every((item) => item.present) && topology.dynamicBackend.authClient, routeDetail, "dynamic-backend"),
    check("hybrid:storageBoundary", topology.storageBoundary.storageEngineGuard && topology.storageBoundary.sqliteMirror && topology.storageBoundary.postgresBlocked && topology.storageBoundary.productionTrack, "auto/sqlite runtime supported; postgres remains guarded until adapter cutover", "storage"),
    check("hybrid:environmentTemplate", topology.environment.variables.every((item) => item.present), envDetail, "environment"),
    check("hybrid:releaseWiring", topology.releaseWiring.scripts.every((item) => item.present) && topology.releaseWiring.manifest && topology.releaseWiring.releaseReport && topology.releaseWiring.deployCheck, scriptDetail, "release"),
    check("hybrid:ciWiring", topology.releaseWiring.ci, "CI generates hybrid deployment readiness artifact", "release")
  ];

  return {
    ok: checks.every((item) => item.passed),
    generatedAt: new Date().toISOString(),
    topology,
    checks
  };
}

function renderMarkdown(report) {
  const checkRows = report.checks.map((item) => `| ${item.passed ? "PASS" : "FAIL"} | ${item.category} | ${item.id} | ${String(item.detail || "").replace(/\|/g, "/")} |`);
  const routeRows = report.topology.dynamicBackend.routeCoverage.map((item) => `| ${item.route} | ${item.present ? "present" : "missing"} |`);
  return [
    "# Hybrid deployment readiness report",
    "",
    `- Generated at: ${report.generatedAt}`,
    `- Result: ${report.ok ? "PASS" : "FAIL"}`,
    "- Static preview layer: GitHub Pages or direct HTML with `data/db.json` snapshot fallback.",
    "- Dynamic backend layer: `server.js` serving `/api/*` on a Node-capable host.",
    "- Production posture: keep PostgreSQL blocked until the adapter, migration, rollback, and backup path are complete.",
    "",
    "## Checks",
    "",
    "| Result | Category | Check | Detail |",
    "|---|---|---|---|",
    ...checkRows,
    "",
    "## Dynamic route coverage",
    "",
    "| Route | Status |",
    "|---|---|",
    ...routeRows,
    ""
  ].join("\n");
}

function parseArgs(argv = process.argv.slice(2)) {
  const flags = {};
  argv.forEach((flag) => {
    if (!flag.startsWith("--")) return;
    const [key, ...rest] = flag.slice(2).split("=");
    flags[key] = rest.length ? rest.join("=") : true;
  });
  return flags;
}

function writeOutput(report, flags = {}) {
  const output = path.resolve(ROOT, String(flags.output || DEFAULT_OUTPUT));
  const markdown = path.resolve(ROOT, String(flags.markdown || DEFAULT_MARKDOWN));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify({ generatedAt: report.generatedAt, ok: report.ok, hybridDeploymentReadiness: report }, null, 2), "utf8");
  fs.mkdirSync(path.dirname(markdown), { recursive: true });
  fs.writeFileSync(markdown, renderMarkdown(report), "utf8");
}

function runCli() {
  const flags = parseArgs();
  const report = buildHybridDeploymentReadinessReport();
  if (flags.write !== false) writeOutput(report, flags);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}

if (require.main === module) {
  try {
    runCli();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  buildHybridDeploymentReadinessReport,
  parseArgs,
  renderMarkdown,
  writeOutput
};
