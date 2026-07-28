#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT, "release", "t10-runtime-smoke-report.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "t10-runtime-smoke-report.md");

const {
  buildSpecialtyCutoverPack,
  writeCutoverPack
} = require("../emergency-specialty-cutover");

function check(id, passed, detail, category = "t10-runtime-smoke") {
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
    output: flags.output || DEFAULT_OUTPUT,
    markdown: flags.markdown || DEFAULT_MARKDOWN,
    baseUrl: flags["base-url"] || flags.url || ""
  };
}

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function buildOfflineChecks(pack, options = {}) {
  const exists = options.exists || ((relativePath) => fs.existsSync(path.join(ROOT, relativePath)));
  const html = options.html !== undefined ? options.html : readText("t10-specialty-cutover.html");
  const client = options.client !== undefined ? options.client : readText("t10-specialty-cutover.js");
  const reportSource = options.releaseReportSource !== undefined
    ? options.releaseReportSource
    : exists("scripts/release-report.js")
    ? readText("scripts/release-report.js")
    : "";

  const runtimeSuites = pack.runtimeSmokePlan?.suites || [];
  const routeRows = pack.runtimeSmokePlan?.trackRoutes || [];
  const observationArtifacts = pack.observationSignalBoard?.requiredArtifacts || [];

  return [
    check("t10:artifact-generation", exists("release/t10-specialty-cutover-pack.json") && exists("release/t10-specialty-cutover-pack.md"), "cutover JSON and Markdown artifacts exist"),
    check("t10:production-boundary", pack.summary?.productionReady === 0 && pack.summary?.formalGoLiveState === "blocked-until-site-evidence-signed", `${pack.summary?.productionReady || 0}/${pack.summary?.tracks || 0} production-ready; formal state ${pack.summary?.formalGoLiveState || "unknown"}`),
    check("t10:independent-module-selection", pack.moduleCatalog?.enabledModuleIds?.length === pack.tracks?.length && pack.moduleCatalog?.peerModuleDependencyCount === 0 && pack.moduleCatalog?.modules?.every((item) => item.independentlySelectable), `${pack.moduleCatalog?.enabledModuleIds?.length || 0} enabled modules; ${pack.moduleCatalog?.peerModuleDependencyCount ?? "unknown"} peer dependencies`),
    check("t10:institution-deployment-gate", pack.institutionDeploymentGate?.ok === true && pack.institutionDeploymentGate?.summary?.failed === 0, `${pack.institutionDeploymentGate?.summary?.passed || 0}/${pack.institutionDeploymentGate?.summary?.total || 0} deployment contract checks passed`),
    check("t10:institution-package-plan", pack.institutionPackagePlan?.status === "ready-to-build-institution-package" && pack.specialtyCompatibilityMatrix?.passedCombinations === 15 && pack.specialtyCompatibilityMatrix?.failedCombinations === 0, `${pack.specialtyCompatibilityMatrix?.passedCombinations || 0}/${pack.specialtyCompatibilityMatrix?.totalCombinations || 0} specialty combinations compatible`),
    check("t10:runtime-smoke-plan", pack.runtimeSmokePlan?.status === "ready-for-runtime-smoke" && pack.runtimeSmokePlan?.launchMode === "controlled-rehearsal-only" && runtimeSuites.length === 5, `${runtimeSuites.length} smoke suites / ${pack.runtimeSmokePlan?.launchMode || "unknown"}`),
    check("t10:runtime-smoke-suites", ["smoke-artifact-generation", "smoke-static-preview", "smoke-server-api", "smoke-release-gates", "smoke-observation-artifacts"].every((id) => runtimeSuites.some((suite) => suite.id === id)), "artifact, preview, API, release gates and observation artifact suites are declared"),
    check(
      "t10:static-preview",
      html.includes('id="runtime-smoke-plan"')
        && /t10-specialty-cutover\.js\?v=[a-z0-9-]+/i.test(html)
        && client.includes("renderRuntimeSmokePlan"),
      "runtime smoke panel, versioned client and renderer are wired"
    ),
    check("t10:route-contracts", routeRows.length === pack.tracks?.length && routeRows.every((route) => pack.tracks.some((track) => track.id === route.trackId && track.page === route.page && track.api === route.api)), `${routeRows.length}/${pack.tracks?.length || 0} route contracts match tracks`),
    check("t10:site-evidence-boundary", pack.evidenceDossier?.status === "site-evidence-pending" && pack.evidenceDossier?.hardStopOpen > 0 && pack.evidenceDossier?.reviewPolicy?.submitterMustDifferFromReviewer, `${pack.evidenceDossier?.hardStopOpen || 0} open hard stops; four-eyes ${pack.evidenceDossier?.reviewPolicy?.submitterMustDifferFromReviewer ? "on" : "off"}`),
    check("t10:command-and-observation", pack.cutoverCommandCenter?.roster?.some((item) => item.seat === "release-commander") && pack.observationSignalBoard?.summary?.lanes === 4 && observationArtifacts.includes("t-plus-1-observation-memo"), `${pack.observationSignalBoard?.summary?.lanes || 0} observation lanes; ${observationArtifacts.length} artifacts`),
    check("t10:scenario-evidence", pack.scenarioEvidenceMatrix?.summary?.scenarios === 5 && pack.scenarioEvidenceMatrix?.rows?.some((row) => row.goNoGoImpact === "review-scorecard-after-replay"), `${pack.scenarioEvidenceMatrix?.summary?.scenarios || 0} scenario evidence rows`),
    check("t10:release-report-integration", !reportSource.includes("specialtyCutoverChecks") || reportSource.includes("specialtyCutover:runtimeSmokePlan"), reportSource.includes("specialtyCutoverChecks") ? "release-report checks runtime smoke plan" : "release-report integration is owned by T00")
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
    return [check("t10:live-fetch", false, "fetch is unavailable", "live")];
  }
  const root = String(baseUrl).replace(/\/+$/, "");
  const checks = [];
  try {
    const response = await fetchJson(fetcher, `${root}/api/t10-specialty/cutover-pack`);
    checks.push(check("t10:live-cutover-pack", response.ok && response.body?.module === "t10-emergency-blood-imaging-physical-exam-cutover", `HTTP ${response.status}`, "live"));
  } catch (error) {
    checks.push(check("t10:live-cutover-pack", false, error.message, "live"));
  }
  return checks;
}

async function buildT10RuntimeSmokeReport(options = {}) {
  const pack = options.pack || buildSpecialtyCutoverPack();
  if (options.writeCutoverArtifacts !== false) {
    writeCutoverPack(pack, options.cutoverOutput ? { outputDir: options.cutoverOutput } : {});
  }
  const offlineChecks = buildOfflineChecks(pack, options);
  const liveChecks = await buildLiveChecks(options.baseUrl || "", options.fetcher);
  const checks = [...offlineChecks, ...liveChecks];
  return {
    ok: checks.every((item) => item.passed),
    generatedAt: new Date().toISOString(),
    module: pack.module,
    launchMode: pack.runtimeSmokePlan?.launchMode || "controlled-rehearsal-only",
    formalGoLiveState: pack.summary?.formalGoLiveState,
    summary: {
      total: checks.length,
      passed: checks.filter((item) => item.passed).length,
      failed: checks.filter((item) => !item.passed).length,
      liveChecks: liveChecks.length
    },
    checks,
    runtimeSmokePlan: pack.runtimeSmokePlan
  };
}

function renderMarkdown(report) {
  const rows = report.checks.map((item) => `| ${item.passed ? "PASS" : "FAIL"} | ${item.category} | ${item.id} | ${String(item.detail || "").replace(/\|/g, "/")} |`);
  return [
    "# T10 runtime smoke report",
    "",
    `- Generated at: ${report.generatedAt}`,
    `- Result: ${report.ok ? "PASS" : "FAIL"}`,
    `- Launch mode: ${report.launchMode}`,
    `- Formal Go-Live state: ${report.formalGoLiveState}`,
    `- Checks: ${report.summary.passed}/${report.summary.total}`,
    "",
    "## Checks",
    "",
    "| Result | Category | Check | Detail |",
    "|---|---|---|---|",
    ...rows,
    "",
    "## Runtime Smoke Suites",
    "",
    ...(report.runtimeSmokePlan?.suites || []).map((suite) => `- ${suite.id}: ${suite.command}`),
    ""
  ].join("\n");
}

function writeOutput(report, flags = {}) {
  const output = path.resolve(ROOT, String(flags.output || DEFAULT_OUTPUT));
  const markdown = path.resolve(ROOT, String(flags.markdown || DEFAULT_MARKDOWN));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.mkdirSync(path.dirname(markdown), { recursive: true });
  fs.writeFileSync(markdown, renderMarkdown(report), "utf8");
}

async function runCli() {
  const flags = parseArgs();
  const report = await buildT10RuntimeSmokeReport(flags);
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
  buildT10RuntimeSmokeReport,
  buildOfflineChecks,
  buildLiveChecks,
  parseArgs,
  renderMarkdown,
  writeOutput
};
