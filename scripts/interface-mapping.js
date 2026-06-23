#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT, "release", "interface-mapping-report.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "interface-mapping-report.md");

const FIELD_MAPPINGS = {
  "his-patient-v1": {
    targetCollection: "personalRecords",
    owner: "institution-integration",
    fields: {
      externalId: "source.externalId",
      residentId: "residentId",
      institution: "sourceInstitution",
      visitedAt: "recordDate"
    }
  },
  "emr-summary-v1": {
    targetCollection: "personalRecords",
    owner: "institution-integration",
    fields: {
      externalId: "source.externalId",
      residentId: "residentId",
      diagnosis: "diagnosis",
      recordDate: "recordDate"
    }
  },
  "lis-report-v1": {
    targetCollection: "diagnosticReports",
    owner: "medical-resource-center",
    fields: {
      externalId: "source.externalId",
      residentId: "residentId",
      item: "item",
      result: "result",
      reportedAt: "reportedAt"
    }
  },
  "pacs-report-v1": {
    targetCollection: "diagnosticReports",
    owner: "medical-resource-center",
    fields: {
      externalId: "source.externalId",
      residentId: "residentId",
      modality: "modality",
      conclusion: "conclusion",
      reportedAt: "reportedAt"
    }
  },
  "insurance-settlement-v1": {
    targetCollection: "insuranceClaims",
    owner: "cross-agency-integration",
    fields: {
      externalId: "source.externalId",
      residentId: "residentId",
      claimStatus: "status",
      amount: "amount"
    }
  },
  "certificate-sync-v1": {
    targetCollection: "digitalCredentials",
    owner: "cross-agency-integration",
    fields: {
      externalId: "source.externalId",
      certificateNo: "credentialNo",
      status: "status"
    }
  },
  "statistics-report-v1": {
    targetCollection: "healthStatisticsIngestion",
    owner: "commission-statistics",
    fields: {
      externalId: "jobs[].externalId",
      period: "period",
      institution: "institution",
      metrics: "metrics"
    }
  },
  "referral-schedule-callback-v1": {
    targetCollection: "referralTeleconsultations",
    owner: "referral-center",
    fields: {
      externalId: "externalScheduleId",
      teleconsultationId: "id",
      residentId: "residentId",
      meetingWindow: "meetingWindow",
      targetInstitution: "targetInstitution",
      department: "department"
    }
  },
  "referral-report-callback-v1": {
    targetCollection: "referralTeleconsultations",
    owner: "referral-center",
    fields: {
      externalId: "externalReportId",
      teleconsultationId: "id",
      residentId: "residentId",
      reportSummary: "reportSummary",
      reportReturnedAt: "reportReturnedAt",
      sourceSystem: "reportSourceSystem"
    }
  }
};

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function buildInterfaceMappingReport(options = {}) {
  const data = options.data ?? readJson("data/db.json");
  const pkg = options.pkg ?? readJson("package.json");
  const readme = options.readme ?? readText("README.md");
  const deployment = options.deployment ?? readText("DEPLOYMENT.md");
  const contracts = Array.isArray(data.integrationContracts) ? data.integrationContracts : [];
  const mappings = contracts.map((contract) => {
    const mapping = FIELD_MAPPINGS[contract.id] || { targetCollection: "", owner: "", fields: {} };
    const requiredFields = Array.isArray(contract.requiredFields) ? contract.requiredFields : [];
    const fieldCoverage = requiredFields.map((field) => ({
      field,
      targetField: mapping.fields[field] || "",
      mapped: Boolean(mapping.fields[field])
    }));
    return {
      contractId: contract.id,
      domain: contract.domain,
      direction: contract.direction,
      resource: contract.resource,
      targetCollection: mapping.targetCollection,
      owner: mapping.owner,
      targetCollectionPresent: Boolean(mapping.targetCollection && Object.prototype.hasOwnProperty.call(data, mapping.targetCollection)),
      requiredFields,
      fieldCoverage,
      idempotencyMapped: Boolean(contract.idempotencyKey && mapping.fields[contract.idempotencyKey]),
      signatureReady: Boolean(contract.signature),
      retryPolicyReady: Boolean(contract.retryPolicy),
      ready: Boolean(mapping.targetCollection && Object.prototype.hasOwnProperty.call(data, mapping.targetCollection)) && fieldCoverage.every((item) => item.mapped) && Boolean(contract.idempotencyKey && mapping.fields[contract.idempotencyKey]) && Boolean(contract.signature && contract.retryPolicy)
    };
  });
  const docsMentionArtifacts = /interface-mapping-report\.md/.test(readme) && /interface-mapping-report\.md/.test(deployment);
  const checks = [
    { id: "interface-mapping:contracts", passed: contracts.length >= 7 && mappings.length === contracts.length, detail: `${contracts.length} contracts` },
    { id: "interface-mapping:targetCollections", passed: mappings.every((item) => item.targetCollectionPresent), detail: mappings.map((item) => `${item.contractId}:${item.targetCollectionPresent ? item.targetCollection : "missing"}`).join(";") },
    { id: "interface-mapping:requiredFields", passed: mappings.every((item) => item.fieldCoverage.every((field) => field.mapped)), detail: mappings.map((item) => `${item.contractId}:${item.fieldCoverage.filter((field) => field.mapped).length}/${item.requiredFields.length}`).join(";") },
    { id: "interface-mapping:idempotency", passed: mappings.every((item) => item.idempotencyMapped), detail: mappings.map((item) => `${item.contractId}:${item.idempotencyMapped ? "mapped" : "missing"}`).join(";") },
    { id: "interface-mapping:gatewayGuards", passed: mappings.every((item) => item.signatureReady && item.retryPolicyReady), detail: "signature and retry policy configured for every mapped contract" },
    { id: "interface-mapping:releaseArtifacts", passed: Boolean(pkg.scripts?.["interface:mapping"] && docsMentionArtifacts), detail: docsMentionArtifacts ? "script and docs present" : "missing script or docs" }
  ];
  return {
    ok: checks.every((item) => item.passed),
    generatedAt: new Date().toISOString(),
    contractCount: contracts.length,
    mappings,
    checks
  };
}

function renderMarkdown(report) {
  const checkRows = report.checks.map((item) => `| ${item.passed ? "PASS" : "FAIL"} | ${item.id} | ${String(item.detail || "").replace(/\|/g, "/")} |`);
  const mappingRows = report.mappings.map((item) => `| ${item.ready ? "PASS" : "FAIL"} | ${item.contractId} | ${item.domain} | ${item.resource} | ${item.targetCollection} | ${item.fieldCoverage.map((field) => `${field.field}->${field.targetField || "missing"}`).join(", ")} |`);
  return [
    "# Interface mapping report",
    "",
    `- Generated at: ${report.generatedAt}`,
    `- Result: ${report.ok ? "PASS" : "FAIL"}`,
    `- Contracts: ${report.contractCount}`,
    "",
    "## Checks",
    "",
    "| Result | Check | Detail |",
    "|---|---|---|",
    ...checkRows,
    "",
    "## Contract field mappings",
    "",
    "| Result | Contract | Domain | Resource | Target collection | Required field mappings |",
    "|---|---|---|---|---|---|",
    ...mappingRows,
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
  const report = buildInterfaceMappingReport();
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

module.exports = { FIELD_MAPPINGS, buildInterfaceMappingReport, parseArgs, renderMarkdown, writeOutput };
