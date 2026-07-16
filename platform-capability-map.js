const fs = require("node:fs");
const path = require("node:path");

const ROOT = __dirname;
const DEFAULT_DATA_PATH = path.join(ROOT, "data", "db.json");
const DEFAULT_PACKAGE_PATH = path.join(ROOT, "package.json");

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    return fallback;
  }
}

function countCollection(value) {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === "object") return Object.keys(value).length;
  return value == null ? 0 : 1;
}

function groupBy(items, key) {
  return items.reduce((acc, item) => {
    const value = item[key] || "uncategorized";
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function classifyScript(name) {
  if (/readiness|report|manifest|audit|coverage|evidence|summary|pack/.test(name)) return "readiness-report";
  if (/test/.test(name)) return "test";
  if (/production|postgres|deployment|env|launch|deploy|storage|identity|audit/.test(name)) return "production";
  if (/check|verify/.test(name)) return "verification";
  return "runtime";
}

function classifyCollection(name) {
  if (/resident|personal|diagnostic|physical|imaging|healthArchive/i.test(name)) return "resident-record";
  if (/chronic|followup|disease|familyDoctor/i.test(name)) return "chronic-care";
  if (/emergency|ambulance|dispatch|handover/i.test(name)) return "emergency";
  if (/publicHealth|immunization|maternal|birth|death/i.test(name)) return "public-health";
  if (/insurance|drug|medication|financial|gateway/i.test(name)) return "insurance-pharmacy";
  if (/blood/i.test(name)) return "blood-system";
  if (/integration|lineage|contract|gateway|phase2|catalog|dictionary|governance|dataQuality/i.test(name)) return "data-integration";
  if (/production|postgres|audit|security|session|operations|monitoring/i.test(name)) return "production-operations";
  if (/research|sandbox|registry/i.test(name)) return "research";
  return "other";
}

function artifactReadiness(item, root = ROOT) {
  const jsonPath = item.json ? path.join(root, item.json) : "";
  const markdownPath = item.markdown ? path.join(root, item.markdown) : "";
  const jsonExists = Boolean(jsonPath && fs.existsSync(jsonPath));
  const markdownExists = Boolean(markdownPath && fs.existsSync(markdownPath));
  let ok = null;
  let generatedAt = "";
  if (jsonExists && /\.json$/i.test(jsonPath)) {
    const report = readJson(jsonPath, null);
    if (report && typeof report === "object") {
      ok = typeof report.ok === "boolean" ? report.ok : ok;
      generatedAt = report.generatedAt || report.checkedAt || "";
    }
  }
  return {
    jsonExists,
    markdownExists,
    ok,
    generatedAt,
    status: ok === false ? "attention" : (jsonExists || markdownExists ? "evidence-present" : "declared-only")
  };
}

function looksOpenStatus(value) {
  const text = String(value || "").toLowerCase();
  if (!text) return false;
  return /open|pending|scheduled|blocked|no-go|awaiting|site-pending|external|待|缺|未|阻塞|现场|审批/.test(text);
}

function normalizeRiskItem(source, item, fallback = {}) {
  const title = item.title || item.name || item.blocker || item.blockerId || item.id || fallback.title || source;
  const status = item.status || item.workflowStatus || item.remediationStatus || item.signoffStatus || fallback.status || "";
  return {
    id: item.id || item.blockerId || `${source}-${fallback.index || 0}`,
    source,
    title,
    severity: item.severity || item.priority || fallback.severity || "P2",
    owner: item.owner || item.assignee || fallback.owner || "",
    status,
    domain: item.category || item.domain || item.blockerSource || fallback.domain || source,
    nextAction: item.nextAction || item.resolutionAction || item.next || item.blocker || fallback.nextAction || "",
    evidence: item.evidenceRef || item.evidence || item.requiredEvidence || item.evidenceRefs || []
  };
}

function buildRiskRegister(data, artifacts) {
  const riskRows = [];
  artifacts.forEach((artifact) => {
    if (artifact.readiness.status === "attention" || artifact.readiness.status === "declared-only") {
      riskRows.push(normalizeRiskItem("release-artifact", {
        id: `artifact-${artifact.id}`,
        title: artifact.title,
        severity: artifact.readiness.status === "attention" ? "P1" : "P2",
        status: artifact.readiness.status,
        owner: artifact.category,
        nextAction: artifact.command ? `Run ${artifact.command} and publish the generated evidence.` : "Publish generated evidence files.",
        evidence: artifact.evidence || artifact.markdown || artifact.json
      }));
    }
  });

  const collections = [
    ["platform-production-blocker", data.platformProductionBlockerReviews],
    ["public-health-cutover", data.publicHealthCutoverBlockers],
    ["public-health-site-evidence", data.publicHealthSiteEvidenceVerificationTasks],
    ["digital-hospital-risk", data.digitalHospitalRiskItems],
    ["digital-hospital-launch", data.digitalHospitalLaunchRequirements],
    ["emergency-launch", data.emergencyLaunchRequirements],
    ["emergency-cutover", data.emergencyCutoverApprovals]
  ];
  collections.forEach(([source, rows]) => {
    (Array.isArray(rows) ? rows : []).forEach((item, index) => {
      const open = item.productionReady === false || item.siteSigned === false || item.cutoverBlocker === true || looksOpenStatus(item.status || item.workflowStatus || item.remediationStatus || item.signoffStatus);
      if (open) riskRows.push(normalizeRiskItem(source, item, { index }));
    });
  });

  const bySeverity = groupBy(riskRows, "severity");
  const bySource = groupBy(riskRows, "source");
  return {
    total: riskRows.length,
    p0: riskRows.filter((item) => item.severity === "P0").length,
    p1: riskRows.filter((item) => item.severity === "P1").length,
    bySeverity,
    bySource,
    items: riskRows.slice(0, 60)
  };
}

function buildCapabilityMap(options = {}) {
  const root = options.root || ROOT;
  const pkg = options.pkg || readJson(options.packagePath || DEFAULT_PACKAGE_PATH, { scripts: {} });
  const data = options.data || readJson(options.dataPath || DEFAULT_DATA_PATH, {});
  const manifest = options.manifest;
  if (!manifest) throw new Error("buildCapabilityMap requires a release artifact manifest");

  const scripts = Object.keys(pkg.scripts || {}).sort();
  const scriptRows = scripts.map((name) => ({
    name,
    kind: classifyScript(name),
    command: pkg.scripts[name]
  }));
  const collections = Object.keys(data || {}).sort().map((name) => ({
    name,
    domain: classifyCollection(name),
    records: countCollection(data[name])
  }));
  const artifacts = (manifest.artifacts || []).map((item) => ({
    id: item.id,
    category: item.category,
    title: item.title,
    command: item.command,
    commandAvailable: Boolean(item.commandAvailable),
    evidence: item.evidence,
    json: item.json,
    markdown: item.markdown,
    readiness: artifactReadiness(item, root)
  }));
  const scriptByKind = groupBy(scriptRows, "kind");
  const collectionByDomain = groupBy(collections, "domain");
  const artifactByCategory = groupBy(artifacts, "category");
  const releaseEvidencePresent = artifacts.filter((item) => item.readiness.status !== "declared-only").length;
  const releaseAttention = artifacts.filter((item) => item.readiness.status === "attention").length;
  const riskRegister = buildRiskRegister(data, artifacts);
  const domains = Object.keys(artifactByCategory).sort().map((category) => {
    const categoryArtifacts = artifacts.filter((item) => item.category === category);
    const relatedScripts = scriptRows.filter((item) => categoryArtifacts.some((artifact) => artifact.command === item.name));
    const relatedCollections = collections.filter((item) => item.domain === category || category.includes(item.domain));
    return {
      id: category,
      title: category,
      artifacts: categoryArtifacts.length,
      scripts: relatedScripts.length,
      collections: relatedCollections.length,
      evidencePresent: categoryArtifacts.filter((item) => item.readiness.status !== "declared-only").length,
      attention: categoryArtifacts.filter((item) => item.readiness.status === "attention").length,
      primaryEvidence: categoryArtifacts.slice(0, 5).map((item) => item.evidence).filter(Boolean)
    };
  });

  const checks = [
    { id: "capability-map:manifest", passed: Boolean(manifest.ok && artifacts.length >= 1), detail: `${artifacts.length} release artifacts indexed` },
    { id: "capability-map:scripts", passed: scripts.length >= 1, detail: `${scripts.length} package scripts indexed` },
    { id: "capability-map:data", passed: collections.length >= 1, detail: `${collections.length} data collections indexed` },
    { id: "capability-map:evidence", passed: releaseEvidencePresent >= 1, detail: `${releaseEvidencePresent}/${artifacts.length} artifacts have generated evidence files` }
  ];

  return {
    ok: checks.every((item) => item.passed),
    generatedAt: new Date().toISOString(),
    summary: {
      releaseArtifacts: artifacts.length,
      templateReadmes: (manifest.templateReadmes || []).length,
      packageScripts: scripts.length,
      readinessScripts: scriptByKind["readiness-report"] || 0,
      testScripts: scriptByKind.test || 0,
      productionScripts: scriptByKind.production || 0,
      dataCollections: collections.length,
      totalRecords: collections.reduce((sum, item) => sum + item.records, 0),
      capabilityDomains: domains.length,
      releaseEvidencePresent,
      releaseAttention,
      openRisks: riskRegister.total,
      p0Risks: riskRegister.p0,
      p1Risks: riskRegister.p1
    },
    breakdowns: {
      artifactsByCategory: artifactByCategory,
      scriptsByKind: scriptByKind,
      collectionsByDomain: collectionByDomain
    },
    domains,
    artifacts,
    riskRegister,
    scripts: scriptRows,
    collections,
    templateReadmes: manifest.templateReadmes || [],
    checks
  };
}

function cleanCell(value) {
  return String(value ?? "").replace(/\|/g, "/");
}

function renderCapabilityMapMarkdown(report) {
  const domainRows = report.domains.map((item) => `| ${cleanCell(item.title)} | ${item.artifacts} | ${item.scripts} | ${item.collections} | ${item.evidencePresent} | ${item.attention} |`);
  const artifactRows = report.artifacts.slice(0, 80).map((item) => `| ${cleanCell(item.category)} | ${cleanCell(item.title)} | ${cleanCell(item.command)} | ${cleanCell(item.readiness.status)} | ${cleanCell(item.evidence)} |`);
  const riskRows = (report.riskRegister?.items || []).slice(0, 40).map((item) => `| ${cleanCell(item.severity)} | ${cleanCell(item.source)} | ${cleanCell(item.title)} | ${cleanCell(item.owner)} | ${cleanCell(item.status)} | ${cleanCell(item.nextAction)} |`);
  const checkRows = report.checks.map((item) => `| ${item.passed ? "PASS" : "FAIL"} | ${cleanCell(item.id)} | ${cleanCell(item.detail)} |`);
  return [
    "# Platform capability map",
    "",
    `- Generated at: ${report.generatedAt}`,
    `- Result: ${report.ok ? "PASS" : "ATTENTION"}`,
    `- Release artifacts: ${report.summary.releaseArtifacts}`,
    `- Package scripts: ${report.summary.packageScripts}`,
    `- Readiness/report scripts: ${report.summary.readinessScripts}`,
    `- Data collections: ${report.summary.dataCollections}`,
    `- Total records: ${report.summary.totalRecords}`,
    `- Open risks: ${report.summary.openRisks || 0}`,
    "",
    "## Checks",
    "",
    "| Result | Check | Detail |",
    "|---|---|---|",
    ...checkRows,
    "",
    "## Capability Domains",
    "",
    "| Domain | Artifacts | Scripts | Collections | Evidence Files | Attention |",
    "|---|---:|---:|---:|---:|---:|",
    ...domainRows,
    "",
    "## Risk Register",
    "",
    "| Severity | Source | Risk | Owner | Status | Next Action |",
    "|---|---|---|---|---|---|",
    ...riskRows,
    "",
    "## Release Artifacts",
    "",
    "| Category | Artifact | Command | Evidence Status | Evidence |",
    "|---|---|---|---|---|",
    ...artifactRows,
    ""
  ].join("\n");
}

module.exports = {
  buildCapabilityMap,
  renderCapabilityMapMarkdown,
  classifyCollection,
  classifyScript
};
