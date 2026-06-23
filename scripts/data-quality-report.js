#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT, "release", "data-quality-report.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "data-quality-report.md");

const RESIDENT_REFERENCE_FIELDS = ["residentId", "maternalResidentId"];
const REQUIRED_RESIDENT_FIELDS = ["id", "name", "idCard", "phone", "personIndex"];

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

function arrayOf(data, key) {
  return Array.isArray(data[key]) ? data[key] : [];
}

function unique(values) {
  return [...new Set(values)];
}

function hasValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function findDuplicateValues(items, field) {
  const counts = new Map();
  items.forEach((item) => {
    if (!hasValue(item[field])) return;
    const value = String(item[field]);
    counts.set(value, (counts.get(value) || 0) + 1);
  });
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([value, count]) => ({ value, count }));
}

function findResidentReferenceIssues(data, residentIds) {
  const issues = [];
  Object.entries(data).forEach(([collection, value]) => {
    if (!Array.isArray(value)) return;
    value.forEach((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return;
      RESIDENT_REFERENCE_FIELDS.forEach((field) => {
        if (!hasValue(item[field])) return;
        if (!residentIds.has(String(item[field]))) {
          issues.push({
            collection,
            id: String(item.id || item.certificateNo || item.name || ""),
            field,
            residentId: String(item[field])
          });
        }
      });
    });
  });
  return issues;
}

function buildQualityIssues(data) {
  const residents = arrayOf(data, "residents");
  const residentIds = new Set(residents.map((item) => String(item.id || "")));
  const residentIndexById = new Map(residents.map((item) => [String(item.id || ""), String(item.personIndex || "")]));
  const duplicateResidentIds = findDuplicateValues(residents, "id");
  const duplicatePersonIndexes = findDuplicateValues(residents, "personIndex");
  const missingResidentFields = residents.flatMap((resident) => REQUIRED_RESIDENT_FIELDS
    .filter((field) => !hasValue(resident[field]))
    .map((field) => ({ collection: "residents", id: String(resident.id || ""), field })));
  const missingReferences = findResidentReferenceIssues(data, residentIds);
  const personIndexMismatches = Object.entries(data).flatMap(([collection, value]) => {
    if (!Array.isArray(value)) return [];
    return value
      .filter((item) => item && typeof item === "object" && hasValue(item.residentId) && hasValue(item.personIndex))
      .filter((item) => residentIndexById.has(String(item.residentId)) && residentIndexById.get(String(item.residentId)) !== String(item.personIndex))
      .map((item) => ({
        collection,
        id: String(item.id || item.name || ""),
        residentId: String(item.residentId),
        expected: residentIndexById.get(String(item.residentId)),
        actual: String(item.personIndex)
      }));
  });
  const unresolvedDeadLetters = arrayOf(data, "integrationGatewayEvents").filter((item) => ["dead-letter", "failed"].includes(String(item.status || "")));
  const openCreditRectifications = arrayOf(data, "institutionCreditEvaluations").filter((item) => /整改|待|复核|appeal|rectification/i.test(`${item.status || ""}${item.next || ""}`));
  const openSnapshotIssues = arrayOf(data, "dataQualityIssues").filter((item) => !["closed", "resolved"].includes(String(item.status || "").toLowerCase()));

  return {
    duplicateResidentIds,
    duplicatePersonIndexes,
    missingResidentFields,
    missingReferences,
    personIndexMismatches,
    unresolvedDeadLetters,
    openCreditRectifications,
    openSnapshotIssues
  };
}

function buildScorecard(data, issues) {
  const residents = arrayOf(data, "residents");
  const referencedCollections = unique(Object.entries(data)
    .filter(([, value]) => Array.isArray(value) && value.some((item) => item && typeof item === "object" && hasValue(item.residentId)))
    .map(([collection]) => collection));
  const residentIndexCompleteness = residents.length
    ? Math.round((residents.filter((item) => hasValue(item.personIndex)).length / residents.length) * 100)
    : 0;
  const sourceTrustRows = [
    ...arrayOf(data, "personalRecords").map((item) => item.meta?.sourceTrust || item.source),
    ...arrayOf(data, "diagnosticReports").map((item) => item.sourceInstitution),
    ...arrayOf(data, "integrationContracts").map((item) => item.domain)
  ].filter(hasValue);
  const blockingIssueCount = [
    issues.duplicateResidentIds,
    issues.duplicatePersonIndexes,
    issues.missingResidentFields,
    issues.missingReferences,
    issues.personIndexMismatches,
    issues.unresolvedDeadLetters,
    issues.openSnapshotIssues
  ].reduce((sum, value) => sum + value.length, 0);

  return {
    residentCount: residents.length,
    residentIndexCompleteness,
    referencedCollections,
    sourceTrustRows: sourceTrustRows.length,
    blockingIssueCount,
    trackedRectificationCount: issues.openCreditRectifications.length,
    closedLoopReady: blockingIssueCount === 0 && residentIndexCompleteness === 100 && referencedCollections.length >= 10
  };
}

function buildDataQualityReport(options = {}) {
  const data = options.data || readJson("data/db.json");
  const issues = buildQualityIssues(data);
  const scorecard = buildScorecard(data, issues);
  const checks = [
    { id: "quality:residentRequiredFields", passed: issues.missingResidentFields.length === 0, detail: `${issues.missingResidentFields.length} missing resident fields` },
    { id: "quality:duplicateResidentIds", passed: issues.duplicateResidentIds.length === 0, detail: `${issues.duplicateResidentIds.length} duplicate resident ids` },
    { id: "quality:duplicatePersonIndexes", passed: issues.duplicatePersonIndexes.length === 0, detail: `${issues.duplicatePersonIndexes.length} duplicate person indexes` },
    { id: "quality:residentReferences", passed: issues.missingReferences.length === 0, detail: `${issues.missingReferences.length} broken resident references` },
    { id: "quality:personIndexConsistency", passed: issues.personIndexMismatches.length === 0, detail: `${issues.personIndexMismatches.length} personIndex mismatches` },
    { id: "quality:sourceTraceability", passed: scorecard.referencedCollections.length >= 10 && scorecard.sourceTrustRows >= 10, detail: `${scorecard.referencedCollections.length} resident-linked collections, ${scorecard.sourceTrustRows} source rows` },
    { id: "quality:rectificationClosedLoop", passed: issues.unresolvedDeadLetters.length === 0 && issues.openSnapshotIssues.length === 0, detail: `${issues.unresolvedDeadLetters.length} dead letters, ${issues.openSnapshotIssues.length} open snapshot issues` }
  ];
  return {
    ok: checks.every((item) => item.passed),
    generatedAt: new Date().toISOString(),
    scorecard,
    issues,
    checks
  };
}

function renderMarkdown(report) {
  const checkRows = report.checks.map((item) => `| ${item.passed ? "PASS" : "FAIL"} | ${item.id} | ${String(item.detail || "").replace(/\|/g, "/")} |`);
  const issueRows = Object.entries(report.issues).map(([name, value]) => `| ${name} | ${Array.isArray(value) ? value.length : 0} |`);
  const collectionRows = report.scorecard.referencedCollections.map((name) => `| ${name} |`);
  return [
    "# Data quality and master index report",
    "",
    `- Generated at: ${report.generatedAt}`,
    `- Result: ${report.ok ? "PASS" : "FAIL"}`,
    `- Residents: ${report.scorecard.residentCount}`,
    `- Resident index completeness: ${report.scorecard.residentIndexCompleteness}%`,
    `- Blocking issue count: ${report.scorecard.blockingIssueCount}`,
    `- Tracked rectifications: ${report.scorecard.trackedRectificationCount}`,
    "",
    "## Checks",
    "",
    "| Result | Check | Detail |",
    "|---|---|---|",
    ...checkRows,
    "",
    "## Issue summary",
    "",
    "| Issue bucket | Count |",
    "|---|---:|",
    ...issueRows,
    "",
    "## Resident-linked collections",
    "",
    "| Collection |",
    "|---|",
    ...collectionRows,
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
  const report = buildDataQualityReport();
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

module.exports = { buildDataQualityReport, parseArgs, renderMarkdown, writeOutput };
