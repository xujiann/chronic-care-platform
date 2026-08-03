#!/usr/bin/env node
const { readRuntimeSource } = require("../src/http/runtime-source");
const fs = require("node:fs");
const path = require("node:path");
const { buildInterfaceMappingReport } = require("./interface-mapping");
const { buildDataQualityReport } = require("./data-quality-report");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT, "release", "data-governance-readiness-report.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "data-governance-readiness-report.md");

const REQUIRED_SOURCE_SYSTEMS = ["HIS", "EMR", "LIS", "PACS", "Insurance core", "Public health/statistics", "Follow-up / internet nursing"];
const REQUIRED_DICTIONARY_DOMAINS = ["master-data", "clinical-standard", "pharmacy-insurance", "diagnostic-standard", "indicator-standard"];
const REQUIRED_BUS_DOMAINS = ["master-data", "standard-dictionary", "lineage-quality", "external-blocker"];

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function defaultAssets() {
  return [
    { id: "asset-his", sourceSystem: "HIS", domain: "patient-visit", owner: "institution-integration", status: "demo-contract-ready", updateFrequency: "near-real-time", platformCollections: ["personalRecords", "careOrders"], qualityScore: 92, risk: "onsite blocked: live HIS endpoint and signed sample messages are still required" },
    { id: "asset-emr", sourceSystem: "EMR", domain: "clinical-summary", owner: "institution-integration", status: "demo-contract-ready", updateFrequency: "near-real-time", platformCollections: ["personalRecords", "diagnosticReports"], qualityScore: 91, risk: "onsite blocked: live EMR document templates and doctor signature policy are pending" },
    { id: "asset-lis", sourceSystem: "LIS", domain: "lab-report", owner: "medical-resource-center", status: "demo-contract-ready", updateFrequency: "hourly", platformCollections: ["diagnosticReports", "countyMutualRecognitionRecords"], qualityScore: 90, risk: "onsite blocked: lab item dictionary and abnormal-value confirmation need hospital signoff" },
    { id: "asset-pacs", sourceSystem: "PACS", domain: "image-report", owner: "medical-resource-center", status: "demo-contract-ready", updateFrequency: "hourly", platformCollections: ["diagnosticReports", "imageCloudStudies", "personalRecords"], qualityScore: 89, risk: "onsite blocked: image index, report callback, and storage authorization remain external" },
    { id: "asset-insurance", sourceSystem: "Insurance core", domain: "settlement-and-benefit", owner: "cross-agency-integration", status: "demo-contract-ready", updateFrequency: "daily-or-event", platformCollections: ["insuranceClaims", "medicationPickups", "institutionSupervisions"], qualityScore: 88, risk: "external blocked: production settlement fields require insurance agency joint testing" },
    { id: "asset-public-health", sourceSystem: "Public health/statistics", domain: "statistics-and-public-health", owner: "commission-statistics", status: "demo-ingestion-ready", updateFrequency: "daily/monthly", platformCollections: ["healthStatistics", "healthStatisticsIngestion", "chronicScreeningTasks"], qualityScore: 90, risk: "onsite blocked: national direct-report interface and reconciliation threshold need configuration" },
    { id: "asset-followup-nursing", sourceSystem: "Follow-up / internet nursing", domain: "continuity-care", owner: "primary-care-and-nursing", status: "demo-closed-loop-ready", updateFrequency: "event", platformCollections: ["followups", "chronicManagementPlans", "internetNursingOrders", "personalRecords"], qualityScore: 87, risk: "onsite blocked: mobile service records, nurse qualification source, and payment callback are pending" }
  ];
}

function defaultDictionaries() {
  return [
    { id: "dict-person-index", name: "Resident master index", domain: "master-data", standardItems: ["personIndex", "residentId", "idCard", "phone", "accountId"], owner: "resident-master-index", platformCollections: ["residents", "accounts", "personalRecords"], status: "implemented-demo", blocker: "production population registry and electronic health code source are pending" },
    { id: "dict-org-staff", name: "Organization, department and staff", domain: "master-data", standardItems: ["orgCode", "institutionId", "doctorId", "nurseId", "orgType"], owner: "platform-identity", platformCollections: ["authOrganizations", "authUsers", "medicalResources", "doctorProfiles", "internetNursingNurses"], status: "implemented-demo", blocker: "live unified social credit code, department code and staff registry need onsite mapping" },
    { id: "dict-disease-surgery", name: "Disease and procedure dictionary", domain: "clinical-standard", standardItems: ["diseaseType", "diagnosis", "icdCode", "procedureCode"], owner: "medical-quality", platformCollections: ["diseases", "chronicManagementPlans", "diagnosticReports", "diseaseRegistryModels"], status: "structured-summary", blocker: "formal ICD/procedure version and mapping signoff are pending" },
    { id: "dict-drug-consumable", name: "Drug and consumable dictionary", domain: "pharmacy-insurance", standardItems: ["drugCode", "consumableCode", "medication", "catalogVersion"], owner: "pharmacy-insurance", platformCollections: ["medicationPickups", "drugConsumableSupervisions", "insuranceClaims"], status: "structured-summary", blocker: "production drug/consumable catalog and insurance catalog version are pending" },
    { id: "dict-lab-imaging", name: "Lab, examination and imaging dictionary", domain: "diagnostic-standard", standardItems: ["item", "modality", "result", "reportedAt", "recognitionRecordId"], owner: "medical-resource-center", platformCollections: ["diagnosticReports", "countyMutualRecognitionRecords", "imageCloudStudies"], status: "structured-summary", blocker: "LIS/PACS item code dictionary and mutual-recognition catalog need site confirmation" },
    { id: "dict-indicator", name: "Statistics and operation indicators", domain: "indicator-standard", standardItems: ["period", "institution", "metrics", "varianceRate", "qualityScore"], owner: "commission-statistics", platformCollections: ["healthStatistics", "healthStatisticsIngestion", "hospitalOperationSnapshots", "dataQualityIssues"], status: "implemented-demo", blocker: "official direct-report indicator version and monthly reconciliation rules are pending" }
  ];
}

function defaultLineage() {
  return [
    { id: "lineage-his-patient", contractId: "his-patient-v1", sourceSystem: "HIS", targetCollection: "personalRecords", requiredControls: ["externalId", "residentId", "institution", "visitedAt", "HMAC-SHA256", "idempotency"], status: "demo-ready" },
    { id: "lineage-emr-summary", contractId: "emr-summary-v1", sourceSystem: "EMR", targetCollection: "personalRecords", requiredControls: ["externalId", "residentId", "diagnosis", "recordDate", "HMAC-SHA256", "idempotency"], status: "demo-ready" },
    { id: "lineage-lis-report", contractId: "lis-report-v1", sourceSystem: "LIS", targetCollection: "diagnosticReports", requiredControls: ["externalId", "residentId", "item", "result", "reportedAt", "HMAC-SHA256"], status: "demo-ready" },
    { id: "lineage-pacs-report", contractId: "pacs-report-v1", sourceSystem: "PACS", targetCollection: "diagnosticReports", requiredControls: ["externalId", "residentId", "modality", "conclusion", "reportedAt", "HMAC-SHA256"], status: "demo-ready" },
    { id: "lineage-insurance", contractId: "insurance-settlement-v1", sourceSystem: "Insurance core", targetCollection: "insuranceClaims", requiredControls: ["externalId", "residentId", "claimStatus", "amount", "idempotency"], status: "external-blocked" },
    { id: "lineage-statistics", contractId: "statistics-report-v1", sourceSystem: "Public health/statistics", targetCollection: "healthStatisticsIngestion", requiredControls: ["externalId", "period", "institution", "metrics", "manual-review"], status: "demo-ready" },
    { id: "lineage-followup-nursing", contractId: "internet-nursing-readiness", sourceSystem: "Follow-up / internet nursing", targetCollection: "personalRecords", requiredControls: ["residentId", "serviceRecord", "nurseQualification", "auditTrail"], status: "onsite-blocked" }
  ];
}

function defaultBusChannels() {
  return [
    { id: "bus-master-data-directory", name: "Master data directory bus", domain: "master-data", owner: "resident-master-index", producerCollections: ["residents", "authOrganizations", "authUsers", "medicalResources"], consumerModules: ["platform", "health-dashboard", "citizen", "institution", "county"], evidence: ["dict-person-index", "dict-org-staff"], blockerSource: "production population registry and staff registry onsite mapping", status: "implemented-demo" },
    { id: "bus-standard-dictionary", name: "Standard dictionary bus", domain: "standard-dictionary", owner: "medical-quality", producerCollections: ["diseases", "diagnosticReports", "medicationPickups", "drugConsumableSupervisions"], consumerModules: ["quality-safety", "drug-consumable", "referral", "internet-nursing"], evidence: ["dict-disease-surgery", "dict-drug-consumable", "dict-lab-imaging"], blockerSource: "formal ICD, procedure, drug, consumable, LIS and PACS dictionary signoff", status: "structured-summary" },
    { id: "bus-lineage-evidence", name: "Lineage evidence bus", domain: "lineage-quality", owner: "institution-integration", producerCollections: ["integrationContracts", "personalRecords", "diagnosticReports", "healthStatisticsIngestion"], consumerModules: ["release-report", "deploy-check", "interface-mapping", "data-quality"], evidence: ["lineage-his-patient", "lineage-emr-summary", "lineage-lis-report", "lineage-pacs-report", "lineage-statistics"], blockerSource: "live HIS/EMR/LIS/PACS endpoint, signature sample and callback joint testing", status: "demo-ready" },
    { id: "bus-interface-blockers", name: "Interface blocker bus", domain: "external-blocker", owner: "cross-agency-integration", producerCollections: ["platformInterfaces", "productionDeploymentPlan", "siteLaunchEvidence", "securityAcceptanceLedger"], consumerModules: ["site-readiness", "onsite-launch", "operations", "release-manifest"], evidence: ["insurance-settlement-v1", "lineage-insurance", "lineage-followup-nursing"], blockerSource: "insurance agency settlement joint testing, image authorization, nurse qualification and payment callback", status: "external-blocked" }
  ];
}

function check(id, passed, detail) {
  return { id, passed: Boolean(passed), detail };
}

function listMissing(required, actual) {
  const set = new Set(actual);
  return required.filter((item) => !set.has(item));
}

function buildDataGovernanceReadiness(options = {}) {
  const data = options.data ?? readJson("data/db.json");
  const pkg = options.pkg ?? readJson("package.json");
  const readme = options.readme ?? readText("README.md");
  const deployment = options.deployment ?? readText("DEPLOYMENT.md");
  const serverSource = options.serverSource ?? readRuntimeSource(ROOT);
  const platformSource = options.platformSource ?? readText("platform.js");
  const assets = options.assets ?? (Array.isArray(data.dataGovernanceAssets) && data.dataGovernanceAssets.length ? data.dataGovernanceAssets : defaultAssets());
  const dictionaries = options.dictionaries ?? (Array.isArray(data.standardDataDictionaries) && data.standardDataDictionaries.length ? data.standardDataDictionaries : defaultDictionaries());
  const lineage = options.lineage ?? (Array.isArray(data.dataLineageControls) && data.dataLineageControls.length ? data.dataLineageControls : defaultLineage());
  const busChannels = options.busChannels ?? (Array.isArray(data.platformDataBusChannels) && data.platformDataBusChannels.length ? data.platformDataBusChannels : defaultBusChannels());
  const interfaceMapping = options.interfaceMapping ?? buildInterfaceMappingReport({ data, pkg, readme, deployment });
  const dataQuality = options.dataQuality ?? buildDataQualityReport({ data });
  const contracts = Array.isArray(data.integrationContracts) ? data.integrationContracts : [];
  const contractIds = new Set(contracts.map((item) => item.id));
  const sourceSystems = assets.map((item) => item.sourceSystem);
  const dictionaryDomains = [...new Set(dictionaries.map((item) => item.domain))];
  const enrichedLineage = lineage.map((item) => {
    const contract = contracts.find((entry) => entry.id === item.contractId);
    return {
      ...item,
      contractPresent: item.contractId === "internet-nursing-readiness" || contractIds.has(item.contractId),
      targetCollectionPresent: Boolean(item.targetCollection && Object.prototype.hasOwnProperty.call(data, item.targetCollection)),
      signatureReady: item.contractId === "internet-nursing-readiness" || Boolean(contract?.signature),
      idempotencyReady: item.contractId === "internet-nursing-readiness" || Boolean(contract?.idempotencyKey),
      onsiteBlocked: /blocked/i.test(String(item.status || ""))
    };
  });
  const missingSources = listMissing(REQUIRED_SOURCE_SYSTEMS, sourceSystems);
  const missingDomains = listMissing(REQUIRED_DICTIONARY_DOMAINS, dictionaryDomains);
  const missingBusDomains = listMissing(REQUIRED_BUS_DOMAINS, [...new Set(busChannels.map((item) => item.domain))]);
  const onsiteBlockers = [
    ...assets.filter((item) => /blocked/i.test(String(item.risk || item.status || ""))),
    ...enrichedLineage.filter((item) => item.onsiteBlocked)
  ];
  const checks = [
    check("data-governance:asset-catalog", missingSources.length === 0 && assets.every((item) => item.owner && item.platformCollections?.length && item.updateFrequency), missingSources.length ? `missing ${missingSources.join(",")}` : `${assets.length} assets with owners and collections`),
    check("data-governance:standard-dictionaries", missingDomains.length === 0 && dictionaries.every((item) => item.standardItems?.length && item.platformCollections?.length), missingDomains.length ? `missing ${missingDomains.join(",")}` : `${dictionaries.length} dictionary groups`),
    check("data-governance:lineage-controls", enrichedLineage.every((item) => item.contractPresent && item.targetCollectionPresent && item.signatureReady && item.idempotencyReady), `${enrichedLineage.filter((item) => item.contractPresent && item.targetCollectionPresent).length}/${enrichedLineage.length} lineage rows linked`),
    check("data-governance:quality-reuse", interfaceMapping.ok && dataQuality.ok, `interfaceMapping=${interfaceMapping.ok}; dataQuality=${dataQuality.ok}`),
    check("data-governance:platform-bus", missingBusDomains.length === 0 && busChannels.every((item) => item.owner && item.producerCollections?.length && item.consumerModules?.length && item.evidence?.length), missingBusDomains.length ? `missing ${missingBusDomains.join(",")}` : `${busChannels.length} reusable platform bus channels`),
    check("data-governance:onsite-boundary", onsiteBlockers.length >= 3 && assets.some((item) => /external blocked/i.test(String(item.risk || ""))), `${onsiteBlockers.length} onsite/external blockers surfaced`),
    check("data-governance:runtime-api", serverSource.includes("/api/data-governance") && serverSource.includes("buildDataGovernanceOverview"), "runtime API and builder are wired"),
    check("data-governance:platform-ui", platformSource.includes("data-governance-foundation") && platformSource.includes("renderDataGovernanceFoundation"), "platform UI renders governance cards"),
    check("data-governance:release-wiring", Boolean(pkg.scripts?.["data-governance:readiness"]) && /data-governance-readiness-report\.md/.test(readme) && /data-governance-readiness-report\.md/.test(deployment), "package script and docs mention readiness artifact")
  ];
  const averageQualityScore = Math.round(assets.reduce((sum, item) => sum + Number(item.qualityScore || 0), 0) / Math.max(assets.length, 1));
  return {
    ok: checks.every((item) => item.passed),
    generatedAt: new Date().toISOString(),
    summary: {
      assets: assets.length,
      sourceSystems: sourceSystems.length,
      dictionaries: dictionaries.length,
      lineage: enrichedLineage.length,
      busChannels: busChannels.length,
      averageQualityScore,
      onsiteBlockers: onsiteBlockers.length
    },
    assets,
    dictionaries,
    lineage: enrichedLineage,
    busChannels,
    qualityEvidence: {
      interfaceMappingOk: interfaceMapping.ok,
      dataQualityOk: dataQuality.ok,
      dataQualityIssues: dataQuality.issues?.missingReferences?.length || 0
    },
    onsiteBlockers,
    checks
  };
}

function renderMarkdown(report) {
  return [
    "# Data governance readiness report",
    "",
    `- Generated at: ${report.generatedAt}`,
    `- Result: ${report.ok ? "PASS" : "FAIL"}`,
    `- Assets: ${report.summary.assets}`,
    `- Dictionaries: ${report.summary.dictionaries}`,
    `- Lineage rows: ${report.summary.lineage}`,
    `- Platform bus channels: ${report.summary.busChannels}`,
    `- Average quality score: ${report.summary.averageQualityScore}`,
    `- Onsite/external blockers surfaced: ${report.summary.onsiteBlockers}`,
    "",
    "## Checks",
    "",
    "| Result | Check | Detail |",
    "|---|---|---|",
    ...report.checks.map((item) => `| ${item.passed ? "PASS" : "FAIL"} | ${item.id} | ${String(item.detail || "").replace(/\|/g, "/")} |`),
    "",
    "## Data assets",
    "",
    "| Source | Domain | Owner | Status | Collections | Risk |",
    "|---|---|---|---|---|---|",
    ...report.assets.map((item) => `| ${item.sourceSystem} | ${item.domain} | ${item.owner} | ${item.status} | ${(item.platformCollections || []).join(", ")} | ${String(item.risk || "").replace(/\|/g, "/")} |`),
    "",
    "## Standard dictionaries",
    "",
    "| Dictionary | Domain | Owner | Items | Collections | Status |",
    "|---|---|---|---|---|---|",
    ...report.dictionaries.map((item) => `| ${item.name} | ${item.domain} | ${item.owner} | ${(item.standardItems || []).join(", ")} | ${(item.platformCollections || []).join(", ")} | ${item.status} |`),
    "",
    "## Lineage controls",
    "",
    "| Source | Target collection | Contract | Controls | Status |",
    "|---|---|---|---|---|",
    ...report.lineage.map((item) => `| ${item.sourceSystem} | ${item.targetCollection} | ${item.contractId} | ${(item.requiredControls || []).join(", ")} | ${item.status} |`),
    "",
    "## Platform bus channels",
    "",
    "| Channel | Domain | Owner | Producers | Consumers | Status | Blocker source |",
    "|---|---|---|---|---|---|---|",
    ...report.busChannels.map((item) => `| ${item.name} | ${item.domain} | ${item.owner} | ${(item.producerCollections || []).join(", ")} | ${(item.consumerModules || []).join(", ")} | ${item.status} | ${String(item.blockerSource || "").replace(/\|/g, "/")} |`),
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
  const report = buildDataGovernanceReadiness();
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

module.exports = { buildDataGovernanceReadiness, parseArgs, renderMarkdown, writeOutput };
