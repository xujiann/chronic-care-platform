#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const RELEASE_DIR = path.join(ROOT, "release");

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

function check(id, passed, detail, severity = "error") {
  return { id, passed: Boolean(passed), detail, severity };
}

function datasetReady(item) {
  return item.authorizationStatus === "approved" &&
    (item.ethicsStatus === "approved" || (!item.ethicsStatus && item.ethicsApproval)) &&
    (["released", "approved", "completed"].includes(String(item.deidentificationStatus || "")) || (!item.deidentificationStatus && item.anonymization)) &&
    governanceReady(item) &&
    evidenceReady(item) &&
    ["published", "active"].includes(String(item.status || ""));
}

function governanceReady(item) {
  const governance = item?.governance || {};
  return Boolean(
    governance.dataUseAgreement &&
    governance.minimumNecessary === true &&
    governance.reidentificationProhibited === true &&
    Number(governance.retentionDays || 0) > 0
  );
}

function evidenceReady(item) {
  const documents = Array.isArray(item?.evidenceDocuments) ? item.evidenceDocuments : [];
  return ["ethics-approval", "data-use-agreement"].every((type) => documents.some((doc) => doc.type === type && doc.status !== "rejected"));
}

function buildPreLaunchDevelopmentBacklog() {
  return [
    { id: "launch:identity-project-auth", owner: "identity-integration", status: "site-required", item: "Connect real researcher identity, project membership, and organization authorization before issuing sandbox accounts." },
    { id: "launch:ethics-document-vault", owner: "research-governance", status: "site-required", item: "Attach live IRB approval, consent or waiver evidence, review period, and continuing-review records to every dataset." },
    { id: "launch:minimization-dictionary", owner: "data-governance", status: "site-required", item: "Map approved research fields to source-system dictionaries and block fields outside the minimum-necessary review." },
    { id: "launch:deidentification-risk", owner: "security-and-data", status: "site-required", item: "Run de-identification and re-identification risk assessment for each release version before sandbox publication." },
    { id: "launch:sandbox-isolation-export", owner: "platform-ops", status: "site-required", item: "Bind datasets to isolated compute, export review, watermarking, and short-lived access-token controls." },
    { id: "launch:audit-retention-siem", owner: "security-ops", status: "site-required", item: "Route application, sandbox, export, and outcome audit trails to SIEM or WORM retention with incident review procedures." },
    { id: "launch:outcome-model-review", owner: "clinical-research", status: "site-required", item: "Convert returned outcomes into disease-registry model review tasks with clinical expert signoff." }
  ];
}

function buildResearchSandboxReadiness(data = readJson("data/db.json")) {
  const datasets = Array.isArray(data.researchDatasets) ? data.researchDatasets : [];
  const models = Array.isArray(data.diseaseRegistryModels) ? data.diseaseRegistryModels : [];
  const accessLogs = (Array.isArray(data.dataAccessLogs) ? data.dataAccessLogs : []).filter((item) => /research|科研|数据集|沙箱/i.test(`${item.scope || ""} ${item.purpose || ""}`));
  const requiredCollections = ["researchDatasets", "diseaseRegistryModels", "dataAccessLogs", "securityAcceptanceLedger", "personalRecords", "diagnosticReports"];
  const checks = [
    check("research:collections", requiredCollections.every((key) => data[key]), requiredCollections.filter((key) => !data[key]).join(",") || "all reusable collections present"),
    check("research:datasets", datasets.length >= 2, `${datasets.length} datasets`),
    check("research:dataset-fields", datasets.every((item) => item.id && item.diseaseType && item.name && item.version && item.authorizationStatus && item.status), "dataset identity, status, and version fields populated"),
    check("research:ethics", datasets.some((item) => item.ethicsApproval && (item.ethicsStatus === "approved" || !item.ethicsStatus)), "approved ethics evidence exists"),
    check("research:deidentification", datasets.some((item) => item.anonymization && (item.deidentificationStatus === "released" || !item.deidentificationStatus)), "de-identification release evidence exists"),
    check("research:policy-controls", datasets.every(governanceReady), `${datasets.filter(governanceReady).length}/${datasets.length} datasets have data-use agreement, minimum-necessary, no re-identification, and retention controls`),
    check("research:evidence-documents", datasets.every(evidenceReady), `${datasets.filter(evidenceReady).length}/${datasets.length} datasets have ethics approval and data-use agreement documents`),
    check("research:sandbox", datasets.some(datasetReady), `${datasets.filter(datasetReady).length} sandbox-ready datasets`),
    check("research:models", models.length >= 2 && models.every((item) => item.id && item.diseaseType && item.version && item.reviewStatus), `${models.length} disease registry models`),
    check("research:audit", datasets.some((item) => Array.isArray(item.usageAudit)) && accessLogs.length >= 1, `${accessLogs.length} research access logs`),
    check("research:outcome-return", datasets.some((item) => Array.isArray(item.outcomes)), "outcome return arrays are modeled")
  ];
  return {
    ok: checks.every((item) => item.passed || item.severity !== "error"),
    generatedAt: new Date().toISOString(),
    summary: {
      datasets: datasets.length,
      sandboxReady: datasets.filter(datasetReady).length,
      policyReady: datasets.filter(governanceReady).length,
      evidenceReady: datasets.filter(evidenceReady).length,
      diseaseModels: models.length,
      accessLogs: accessLogs.length,
      outcomes: datasets.reduce((sum, item) => sum + (Array.isArray(item.outcomes) ? item.outcomes.length : 0), 0)
    },
    boundaries: [
      "research dataset catalog",
      "disease registry model",
      "ethics approval",
      "de-identification release",
      "policy controls",
      "sandbox access",
      "usage audit",
      "outcome return"
    ],
    reusableCollections: requiredCollections,
    checks,
    preLaunchDevelopment: buildPreLaunchDevelopmentBacklog(),
    datasets: datasets.map((item) => ({
      id: item.id,
      diseaseType: item.diseaseType,
      status: item.status,
      authorizationStatus: item.authorizationStatus,
      ethicsStatus: item.ethicsStatus || (item.ethicsApproval ? "approved" : "pending"),
      deidentificationStatus: item.deidentificationStatus || "pending",
      dataUseAgreement: item.governance?.dataUseAgreement || "",
      retentionDays: item.governance?.retentionDays || 0,
      governanceStatus: governanceReady(item) ? "ready" : "pending",
      evidenceStatus: evidenceReady(item) ? "ready" : "pending",
      evidenceDocuments: Array.isArray(item.evidenceDocuments) ? item.evidenceDocuments.length : 0,
      sandboxStatus: item.sandbox?.status || "not-modeled",
      sourceCollections: item.sourceCollections || [],
      records: item.records || 0
    }))
  };
}

function renderMarkdown(report) {
  const rows = report.checks.map((item) => `| ${item.passed ? "PASS" : "FAIL"} | ${item.id} | ${item.detail} |`);
  const datasetRows = report.datasets.map((item) => `| ${item.id} | ${item.diseaseType} | ${item.status} | ${item.authorizationStatus} | ${item.ethicsStatus} | ${item.deidentificationStatus} | ${item.governanceStatus} | ${item.evidenceStatus} | ${item.evidenceDocuments || 0} | ${item.dataUseAgreement || "pending"} | ${item.retentionDays || 0} | ${item.sandboxStatus} | ${item.records} |`);
  const preLaunchRows = (report.preLaunchDevelopment || []).map((item) => `| ${item.id} | ${item.owner} | ${item.status} | ${item.item} |`);
  return [
    "# Research Sandbox Readiness",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    `Result: ${report.ok ? "PASS" : "FAIL"}`,
    "",
    "## Boundaries",
    "",
    ...report.boundaries.map((item) => `- ${item}`),
    "",
    "## Reused Collections",
    "",
    ...report.reusableCollections.map((item) => `- ${item}`),
    "",
    "## Checks",
    "",
    "| Result | Check | Detail |",
    "|---|---|---|",
    ...rows,
    "",
    "## Datasets",
    "",
    "| Dataset | Disease | Status | Authorization | Ethics | De-identification | Governance | Evidence | Documents | Agreement | Retention days | Sandbox | Records |",
    "|---|---|---|---|---|---|---|---|---:|---|---:|---|---:|",
    ...datasetRows,
    "",
    "## Pre-launch Development",
    "",
    "| Item | Owner | Status | Scope |",
    "|---|---|---|---|",
    ...preLaunchRows
  ].join("\n");
}

function writeReport(report) {
  fs.mkdirSync(RELEASE_DIR, { recursive: true });
  fs.writeFileSync(path.join(RELEASE_DIR, "research-sandbox-readiness-report.json"), JSON.stringify(report, null, 2), "utf8");
  fs.writeFileSync(path.join(RELEASE_DIR, "research-sandbox-readiness-report.md"), renderMarkdown(report), "utf8");
}

function main() {
  const report = buildResearchSandboxReadiness();
  writeReport(report);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exit(1);
}

if (require.main === module) main();

module.exports = {
  buildResearchSandboxReadiness,
  renderMarkdown
};
