#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT, "release", "drug-consumable-readiness-report.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "drug-consumable-readiness-report.md");

const REQUIRED_BOUNDARIES = [
  "rational-medication",
  "fixed-pharmacy",
  "consumable-clue",
  "insurance-settlement",
  "remediation-loop"
];

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function normalizeStatus(value) {
  const text = String(value || "").toLowerCase();
  if (/closed|passed|complete|done|resolved|通过|完成/.test(text)) return "closed";
  if (/reject|return|补正|整改|退回/.test(text)) return "remediation";
  if (/pending|wait|待|初审|review/.test(text)) return "pending";
  return text || "tracking";
}

function buildTraceabilityEvidenceChecklist(rows, policySources, requirements) {
  const sourceIds = new Set((policySources || []).map((item) => item.id));
  return (requirements || []).map((requirement) => {
    const linkedRows = rows.filter((row) =>
      (requirement.boundaries || []).includes(row.boundary) ||
      ((requirement.boundaries || []).includes("insurance-settlement") && row.relatedClaimId) ||
      (requirement.id === "trace-remediation-audit" && row.remediationStatus)
    );
    const policySourceIds = (requirement.policySourceIds || []).filter((id) => sourceIds.has(id));
    return {
      ...requirement,
      policySourceIds,
      rowIds: linkedRows.map((row) => row.id),
      rowCount: linkedRows.length,
      ready: policySourceIds.length === (requirement.policySourceIds || []).length && linkedRows.length > 0
    };
  });
}

function buildDrugConsumableReadinessReport(options = {}) {
  const data = options.data ?? readJson("data/db.json");
  const pkg = options.pkg ?? readJson("package.json");
  const readme = options.readme ?? readText("README.md");
  const deployment = options.deployment ?? readText("DEPLOYMENT.md");
  const aboutPage = options.aboutPage ?? readText("about.html");
  const server = options.server ?? readText("server.js");
  const insurancePage = options.insurancePage ?? readText("insurance.html");
  const insuranceJs = options.insuranceJs ?? readText("insurance.js");
  const institutionPage = options.institutionPage ?? readText("institution.html");
  const institutionJs = options.institutionJs ?? readText("institution.js");
  const workbenchPage = options.workbenchPage ?? readText("workbench.html");
  const workbenchJs = options.workbenchJs ?? readText("workbench.js");
  const rows = Array.isArray(data.drugConsumableSupervisions) ? data.drugConsumableSupervisions : [];
  const pickups = Array.isArray(data.medicationPickups) ? data.medicationPickups : [];
  const claims = Array.isArray(data.insuranceClaims) ? data.insuranceClaims : [];
  const institutionSupervisions = Array.isArray(data.institutionSupervisions) ? data.institutionSupervisions : [];
  const contracts = Array.isArray(data.integrationContracts) ? data.integrationContracts : [];
  const policySources = Array.isArray(data.drugTraceabilityPolicySources) ? data.drugTraceabilityPolicySources : [];
  const evidenceRequirements = Array.isArray(data.drugTraceabilityEvidenceRequirements) ? data.drugTraceabilityEvidenceRequirements : [];
  const insuranceContract = contracts.find((item) => item.id === "insurance-settlement-v1");
  const boundaries = new Set(rows.map((item) => item.boundary));
  if (pickups.length) boundaries.add("fixed-pharmacy");
  if (claims.length && insuranceContract) boundaries.add("insurance-settlement");
  if (rows.some((item) => item.remediationStatus && normalizeStatus(item.remediationStatus) !== "closed")) boundaries.add("remediation-loop");
  const linkedRows = rows.map((item) => ({
    id: item.id,
    boundary: item.boundary,
    status: item.status,
    normalizedStatus: normalizeStatus(item.status || item.reviewStatus || item.insuranceStatus),
    pickupLinked: !item.relatedPickupId || pickups.some((row) => row.id === item.relatedPickupId),
    claimLinked: !item.relatedClaimId || claims.some((row) => row.id === item.relatedClaimId),
    supervisionLinked: item.sourceCollection !== "institutionSupervisions" || institutionSupervisions.some((row) => row.id === item.sourceId),
    auditTrailPresent: Array.isArray(item.auditTrail) && item.auditTrail.length > 0
  }));
  const traceabilityEvidenceChecklist = buildTraceabilityEvidenceChecklist(rows, policySources, evidenceRequirements);
  const evidenceRequirementsReady = evidenceRequirements.length >= 5 &&
    evidenceRequirements.every((item) =>
      item.id &&
      Array.isArray(item.boundaries) &&
      item.boundaries.length > 0 &&
      Array.isArray(item.policySourceIds) &&
      item.policySourceIds.length > 0 &&
      Array.isArray(item.evidenceFields) &&
      item.evidenceFields.length > 0 &&
      item.policySourceIds.every((id) => policySources.some((source) => source.id === id))
    );
  const docsMentionArtifacts = /drug-consumable-readiness-report\.md/.test(readme) && /drug-consumable-readiness-report\.md/.test(deployment);
  const checks = [
    { id: "drug-consumable:data", passed: rows.length >= 3 && pickups.length > 0 && claims.length > 0 && institutionSupervisions.length > 0, detail: `${rows.length} supervision rows; ${pickups.length} pickups; ${claims.length} claims` },
    { id: "drug-consumable:boundaries", passed: REQUIRED_BOUNDARIES.every((item) => boundaries.has(item)), detail: REQUIRED_BOUNDARIES.map((item) => `${item}:${boundaries.has(item) ? "present" : "missing"}`).join(";") },
    { id: "drug-consumable:links", passed: linkedRows.every((item) => item.pickupLinked && item.claimLinked && item.supervisionLinked), detail: linkedRows.map((item) => `${item.id}:${item.pickupLinked && item.claimLinked && item.supervisionLinked ? "linked" : "missing-link"}`).join(";") },
    { id: "drug-consumable:audit", passed: linkedRows.every((item) => item.auditTrailPresent) && /drug-consumable-review/.test(server) && /drug-consumable-remediation/.test(server), detail: "business auditTrail and securityEvents actions are wired" },
    { id: "drug-consumable:insurance-contract", passed: Boolean(insuranceContract?.status === "ready" && insuranceContract.signature && insuranceContract.retryPolicy), detail: insuranceContract ? `${insuranceContract.id}:${insuranceContract.status}` : "missing insurance-settlement-v1" },
    { id: "drug-consumable:workflow-reuse", passed: /WORKFLOW_COLLECTIONS[\s\S]*drugConsumableSupervisions/.test(server) && /appendDrugConsumableAuditTrail/.test(server) && /unified-task-action/.test(server) && /workflow-action/.test(server), detail: "/api/workflow-actions and /api/tasks/:id/actions reuse drugConsumableSupervisions with audit trail" },
    { id: "drug-consumable:traceability-policy", passed: policySources.length >= 5 && policySources.some((item) => item.id === "nhsa-2025-7") && policySources.some((item) => item.id === "nmpa-2022-label") && policySources.every((item) => /^https:\/\/(www\.)?(nhsa|nmpa)\.gov\.cn\//.test(item.url || "")) && /policy-source-rules/.test(aboutPage), detail: `${policySources.length} official traceability policy sources; about policy section ${/policy-source-rules/.test(aboutPage) ? "present" : "missing"}` },
    { id: "drug-consumable:traceability-evidence", passed: evidenceRequirementsReady && traceabilityEvidenceChecklist.length >= 5 && traceabilityEvidenceChecklist.every((item) => item.ready) && /buildDrugTraceabilityEvidenceChecklist/.test(server) && /traceabilityEvidenceChecklist/.test(server) && /renderTraceabilityEvidenceChecklist/.test(insuranceJs) && /renderInstitutionTraceabilityEvidenceChecklist/.test(institutionJs) && /renderDrugTraceabilityEvidenceChecklistRow/.test(workbenchJs), detail: `${traceabilityEvidenceChecklist.filter((item) => item.ready).length}/${traceabilityEvidenceChecklist.length} evidence groups ready from drugTraceabilityEvidenceRequirements` },
    { id: "drug-consumable:traceability-submission", passed: /buildDrugTraceabilityEvidenceSubmission/.test(server) && /\/traceability-evidence/.test(server) && /drug-consumable-traceability-evidence/.test(server) && /traceability-evidence/.test(insuranceJs) && /postInstitutionDrugConsumableAction/.test(institutionJs) && /Trace scan uploaded/.test(institutionJs), detail: "traceability evidence submission API and insurance/institution buttons are wired" },
    { id: "drug-consumable:traceability-coverage", passed: /buildDrugTraceabilityEvidenceCoverage/.test(server) && /traceabilityEvidenceCoverage/.test(server) && /traceabilityCoverageCompleteRows/.test(server) && /traceabilityEvidenceCoverage/.test(insuranceJs) && /traceabilityEvidenceCoverage/.test(institutionJs) && /traceabilityEvidenceCoverage/.test(workbenchJs), detail: "traceability evidence coverage is derived by API and displayed across supervision pages" },
    { id: "drug-consumable:frontend", passed: /drug-consumable-panel/.test(insurancePage) && /renderDrugConsumableSupervision/.test(insuranceJs) && /renderTraceabilityPolicySources/.test(insuranceJs) && /renderTraceabilityEvidenceChecklist/.test(insuranceJs) && /institution-drug-consumable-panel/.test(institutionPage) && /renderInstitutionDrugConsumableSupervision/.test(institutionJs) && /renderInstitutionTraceabilityPolicySources/.test(institutionJs) && /renderInstitutionTraceabilityEvidenceChecklist/.test(institutionJs) && /postInstitutionDrugConsumableRemediation/.test(institutionJs) && /drug-consumable-supervision-panel/.test(workbenchPage) && /loadDrugConsumableSupervision/.test(workbenchJs) && /renderDrugTraceabilityPolicyRow/.test(workbenchJs) && /renderDrugTraceabilityEvidenceChecklistRow/.test(workbenchJs), detail: "insurance portal, institution remediation panel, and commission workbench render actionable drug consumable supervision entries with traceability policy sources and evidence checklist" },
    { id: "drug-consumable:release", passed: Boolean(pkg.scripts?.["drug-consumable:readiness"] && docsMentionArtifacts), detail: docsMentionArtifacts ? "script and docs present" : "missing script or docs" }
  ];
  return {
    ok: checks.every((item) => item.passed),
    generatedAt: new Date().toISOString(),
    requiredBoundaries: REQUIRED_BOUNDARIES,
    summary: {
      supervisionRows: rows.length,
      openRows: linkedRows.filter((item) => item.normalizedStatus !== "closed").length,
      medicationPickups: pickups.length,
      insuranceClaims: claims.length,
      institutionSupervisions: institutionSupervisions.length,
      traceabilityPolicySources: policySources.length,
      traceabilityEvidenceRequirements: evidenceRequirements.length,
      traceabilityEvidenceReady: traceabilityEvidenceChecklist.filter((item) => item.ready).length,
      traceabilitySubmissionReady: checks.some((item) => item.id === "drug-consumable:traceability-submission" && item.passed),
      traceabilityCoverageReady: checks.some((item) => item.id === "drug-consumable:traceability-coverage" && item.passed),
      insuranceContractReady: Boolean(insuranceContract?.status === "ready"),
      workflowReuseReady: checks.some((item) => item.id === "drug-consumable:workflow-reuse" && item.passed),
      institutionRemediationReady: checks.some((item) => item.id === "drug-consumable:frontend" && item.passed)
    },
    linkedRows,
    policySources,
    traceabilityEvidenceChecklist,
    checks
  };
}

function renderMarkdown(report) {
  const checkRows = report.checks.map((item) => `| ${item.passed ? "PASS" : "FAIL"} | ${item.id} | ${String(item.detail || "").replace(/\|/g, "/")} |`);
  const rowLines = report.linkedRows.map((item) => `| ${item.id} | ${item.boundary} | ${item.normalizedStatus} | ${item.pickupLinked ? "yes" : "no"} | ${item.claimLinked ? "yes" : "no"} | ${item.auditTrailPresent ? "yes" : "no"} |`);
  const policyRows = (report.policySources || []).map((item) => `| ${String(item.documentNo || "").replace(/\|/g, "/")} | ${String(item.title || "").replace(/\|/g, "/")} | ${String(item.url || "").replace(/\|/g, "/")} |`);
  const evidenceRows = (report.traceabilityEvidenceChecklist || []).map((item) => `| ${item.ready ? "yes" : "no"} | ${String(item.id || "").replace(/\|/g, "/")} | ${String(item.owner || "").replace(/\|/g, "/")} | ${String((item.evidenceFields || []).join(", ")).replace(/\|/g, "/")} | ${String((item.policySourceIds || []).join(", ")).replace(/\|/g, "/")} | ${item.rowCount || 0} |`);
  return [
    "# Drug consumable readiness report",
    "",
    `- Generated at: ${report.generatedAt}`,
    `- Result: ${report.ok ? "PASS" : "FAIL"}`,
    `- Supervision rows: ${report.summary.supervisionRows}`,
    `- Open rows: ${report.summary.openRows}`,
    "",
    "## Checks",
    "",
    "| Result | Check | Detail |",
    "|---|---|---|",
    ...checkRows,
    "",
    "## Supervision links",
    "",
    "| Row | Boundary | Status | Pickup | Claim | Audit |",
    "|---|---|---|---|---|---|",
    ...rowLines,
    "",
    "## Traceability policy sources",
    "",
    "| Document | Title | Source link |",
    "|---|---|---|",
    ...policyRows,
    "",
    "## Traceability evidence requirements",
    "",
    "| Ready | Requirement | Owner | Evidence fields | Policy sources | Linked rows |",
    "|---|---|---|---|---|---|",
    ...evidenceRows,
    ""
  ].join("\n");
}

function parseArgs(argv = process.argv.slice(2)) {
  return Object.fromEntries(argv
    .filter((flag) => flag.startsWith("--"))
    .map((flag) => {
      const [key, ...rest] = flag.slice(2).split("=");
      return [key, rest.length ? rest.join("=") : true];
    }));
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
  const report = buildDrugConsumableReadinessReport();
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

module.exports = { REQUIRED_BOUNDARIES, buildDrugConsumableReadinessReport, buildTraceabilityEvidenceChecklist, normalizeStatus, parseArgs, renderMarkdown, writeOutput };
