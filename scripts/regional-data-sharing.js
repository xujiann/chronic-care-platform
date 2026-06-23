#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT, "release", "regional-data-sharing-report.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "regional-data-sharing-report.md");

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function hasRequiredPackageFields(item) {
  return [
    "id",
    "residentId",
    "sourceInstitution",
    "sourceOrgCode",
    "targetInstitutions",
    "targetOrgCodes",
    "sharedCollections",
    "recordRefs",
    "contractRefs",
    "consentStatus",
    "qualityStatus",
    "status"
  ].every((key) => Object.prototype.hasOwnProperty.call(item, key));
}

function buildRegionalDataSharingReport(options = {}) {
  const data = options.data ?? readJson("data/db.json");
  const pkg = options.pkg ?? readJson("package.json");
  const server = options.server ?? readText("server.js");
  const html = options.html ?? readText("regional-data-sharing.html");
  const client = options.client ?? readText("regional-data-sharing.js");
  const scope = data.regionalDataSharingScope || {};
  const packages = Array.isArray(data.regionalSharingPackages) ? data.regionalSharingPackages : [];
  const snapshots = data.regionalSharingSnapshots || {};
  const reviews = Array.isArray(data.regionalSharingAccessReviews) ? data.regionalSharingAccessReviews : [];
  const contracts = new Set((data.integrationContracts || []).map((item) => item.id));
  const reused = new Set(scope.reusedCollections || []);
  const statuses = new Set(["ready", "pending_review", "blocked", "archived"]);
  const packageStatuses = packages.map((item) => item.status);
  const contractRefs = packages.flatMap((item) => item.contractRefs || []);
  const checks = [
    { id: "regional:boundary", passed: (scope.boundary || []).length >= 3 && (scope.exclusions || []).length >= 3 && (scope.roles || []).length >= 3, detail: `${(scope.boundary || []).length} boundaries, ${(scope.exclusions || []).length} exclusions` },
    { id: "regional:reuseCollections", passed: ["residents", "personalRecords", "diagnosticReports", "integrationContracts", "platformEvidence"].every((key) => reused.has(key)), detail: [...reused].join(",") },
    { id: "regional:packages", passed: packages.length >= 3 && packages.every(hasRequiredPackageFields), detail: `${packages.length} packages` },
    { id: "regional:statusNorms", passed: packageStatuses.every((status) => statuses.has(status)) && Object.keys(snapshots.statusNorms || {}).length >= 4, detail: packageStatuses.join(",") },
    { id: "regional:contractRefs", passed: contractRefs.length >= 4 && contractRefs.every((id) => contracts.has(id)), detail: [...new Set(contractRefs)].join(",") },
    { id: "regional:accessReviews", passed: reviews.length >= 1 && reviews.every((item) => item.packageId && item.residentId && item.purpose && item.decision), detail: `${reviews.length} reviews` },
    { id: "regional:apiRoutes", passed: /\/api\/regional-data-sharing/.test(server) && /createRegionalSharingAccessReview/.test(server), detail: "GET and POST regional routes present" },
    { id: "regional:frontendEntry", passed: /regional-data-sharing\.js/.test(html) && /登记留痕/.test(html) && /authFetch/.test(client), detail: "page and client workflow present" },
    { id: "regional:releaseScript", passed: Boolean(pkg.scripts?.["regional-data-sharing:report"]), detail: pkg.scripts?.["regional-data-sharing:report"] || "missing" }
  ];
  return {
    ok: checks.every((item) => item.passed),
    generatedAt: new Date().toISOString(),
    scope: {
      name: scope.name || "",
      roles: (scope.roles || []).map((item) => item.role),
      exclusions: scope.exclusions || [],
      reusedCollections: scope.reusedCollections || []
    },
    summary: {
      packages: packages.length,
      ready: packages.filter((item) => item.status === "ready").length,
      pendingReview: packages.filter((item) => item.status === "pending_review").length,
      accessReviews: reviews.length,
      contractRefs: [...new Set(contractRefs)].length
    },
    packages: packages.map((item) => ({
      id: item.id,
      residentId: item.residentId,
      sourceOrgCode: item.sourceOrgCode,
      targetOrgCodes: item.targetOrgCodes,
      status: item.status,
      consentStatus: item.consentStatus,
      qualityStatus: item.qualityStatus,
      contractRefs: item.contractRefs,
      sharedCollections: item.sharedCollections
    })),
    checks
  };
}

function renderMarkdown(report) {
  return [
    "# Regional data sharing report",
    "",
    `- Generated at: ${report.generatedAt}`,
    `- Result: ${report.ok ? "PASS" : "FAIL"}`,
    `- Packages: ${report.summary.packages}`,
    `- Ready packages: ${report.summary.ready}`,
    `- Access reviews: ${report.summary.accessReviews}`,
    "",
    "## Checks",
    "",
    "| Result | Check | Detail |",
    "|---|---|---|",
    ...report.checks.map((item) => `| ${item.passed ? "PASS" : "FAIL"} | ${item.id} | ${String(item.detail || "").replace(/\|/g, "/")} |`),
    "",
    "## Packages",
    "",
    "| Package | Resident | Source | Targets | Status | Contracts |",
    "|---|---|---|---|---|---|",
    ...report.packages.map((item) => `| ${item.id} | ${item.residentId} | ${item.sourceOrgCode} | ${(item.targetOrgCodes || []).join(", ")} | ${item.status} | ${(item.contractRefs || []).join(", ")} |`),
    "",
    "## Site Joint-Test Boundary",
    "",
    "- Confirm production resident master index and authorization source before enabling real cross-institution access.",
    "- Confirm HIS/EMR/LIS/PACS payload signatures, idempotency keys, report identifiers, and receiving physician acknowledgement screenshots.",
    "- Keep insurance settlement, billing, research de-identification, and cross-agency certificates outside this application unless separate signoff is provided.",
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
  fs.writeFileSync(output, JSON.stringify(report, null, 2), "utf8");
  fs.mkdirSync(path.dirname(markdown), { recursive: true });
  fs.writeFileSync(markdown, renderMarkdown(report), "utf8");
}

function runCli() {
  const flags = parseArgs();
  const report = buildRegionalDataSharingReport();
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

module.exports = { buildRegionalDataSharingReport, parseArgs, renderMarkdown, writeOutput };
