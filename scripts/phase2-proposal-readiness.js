#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const PLAN_DOC = path.join("docs", "二期可研对标差距与下一步开发计划.md");
const DEFAULT_OUTPUT = path.join(ROOT, "release", "phase2-proposal-readiness-report.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "phase2-proposal-readiness-report.md");

const REQUIRED_PLAN_TOKENS = [
  "13 家医院",
  "5 家区市县平台",
  "216 张表",
  "PostgreSQL",
  "HIS/EMR/LIS/PACS",
  "78 项",
  "17 家医院",
  "SM2/SM3/SM4",
  "24x365",
  "P0",
  "P1",
  "P2",
  "release gate",
  "phase2:proposal-readiness"
];

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function check(id, passed, detail) {
  return { id, passed: Boolean(passed), detail };
}

function clean(value) {
  return String(value || "").replace(/\|/g, "/");
}

function defaultGapLedger() {
  return [
    {
      id: "data-center-integration",
      priority: "P0",
      domain: "data-center",
      proposalRequirement: "Connect 13 hospitals, 5 district/county platforms, 2 provincial systems, and 1 municipal system.",
      currentEvidence: "Interface contracts, gateway samples, signing, retry, dead-letter and reconciliation patterns exist.",
      gap: "Live endpoints, formal field maps, vendor payloads, joint-test signoff and migration baseline are missing.",
      nextStep: "Build institution-system-interface-field-sample-signoff ledger and start with one tertiary hospital, one county platform and one primary institution.",
      owner: "integration",
      status: "onsite-blocked",
      stage: "joint-test-sample"
    },
    {
      id: "data-service-catalog",
      priority: "P0",
      domain: "data-governance",
      proposalRequirement: "Expand data resource catalog, service catalog, standards and 216 table mapping.",
      currentEvidence: "phase2:catalog-readiness, /api/phase2/catalog and the platform catalog board now cover 216/216 table slots, 13 service rows, 10 field-lineage rows, 12 quality rules, owners, sources and release evidence.",
      gap: "Live source-system table names, vendor field versions, formal data owners and signed acceptance baselines remain onsite blockers.",
      nextStep: "Use the completed catalog MVP during pilot joint testing and replace range-level slots with signed institution-specific table and field versions.",
      owner: "data-governance",
      status: "mvp-ready-onsite-blocked",
      stage: "catalog-mvp"
    },
    {
      id: "production-database",
      priority: "P0",
      domain: "storage",
      proposalRequirement: "Adapt domestic/production database and distributed data center deployment.",
      currentEvidence: "SQLite/JSON storage, production-db:readiness and the cutover center now cover four migration batches, resident/encounter/report/statistic sample checks, SHA-256 evidence, rollback checkpoints, commission review actions and audit events.",
      gap: "The live PostgreSQL-compatible adapter, masked full-volume rehearsal, native backup, capacity/failover tests, object storage and signed production parameters are not landed.",
      nextStep: "Bind the cutover center to the selected database driver and run a masked full-volume migration, rollback and capacity rehearsal with DBA signoff.",
      owner: "platform-storage",
      status: "rehearsal-center-ready-onsite-blocked",
      stage: "cutover-rehearsal"
    },
    {
      id: "chronic-disease-reporting",
      priority: "P1",
      domain: "public-health",
      proposalRequirement: "Coordinate chronic, infectious disease and severe mental disorder reporting with district/county push.",
      currentEvidence: "phase2:disease-reporting-readiness, /api/phase2/disease-reporting and platform board cover diagnosis rules, report queue, county receipts, patient-center import/export, exception loop and supervision metrics.",
      gap: "Live HIS/EMR diagnosis triggers, district direct-report endpoints and multi-party site signoff remain onsite blockers.",
      nextStep: "Use the MVP queue for pilot joint testing, then replace demo trigger sources with signed HIS/county-platform endpoints.",
      owner: "public-health",
      status: "mvp-ready-onsite-blocked",
      stage: "disease-card-mvp"
    },
    {
      id: "clinical-treatment-assistance",
      priority: "P1",
      domain: "clinical-assist",
      proposalRequirement: "Provide reminders, message center, instant messaging, service integration and duplicate diagnosis/lab/drug reminders.",
      currentEvidence: "phase2:clinical-assist-readiness, /api/phase2/clinical-assist, doctor workstation board and platform board cover duplicate diagnosis/check/lab/medication rules, alerts, receipts and plugin contracts.",
      gap: "Live HIS/EMR workstation embedding, hospital message-center fields, doctor e-signature and quality-center rule signoff remain onsite blockers.",
      nextStep: "Use the clinical-assist plugin contract in the first hospital pilot and archive real workstation receipt screenshots.",
      owner: "clinical-quality",
      status: "mvp-ready-onsite-blocked",
      stage: "plugin-contract"
    },
    {
      id: "lab-mutual-recognition-ledger",
      priority: "P1",
      domain: "mutual-recognition",
      proposalRequirement: "Support 78 lab item mappings, mutual-recognition browser, processing, report citation, supervision and evidence ledger.",
      currentEvidence: "phase2:mutual-recognition-readiness, /api/phase2/mutual-recognition and county board cover 78-item mapping, report browser, decision loop, citation chain and supervision stats.",
      gap: "Live PDF/LIS/PACS report viewers, city chain resources, node/channel metadata and site signatures remain onsite blockers.",
      nextStep: "Ship business-loop MVP first: item mapping, report browser, recognize/not-recognize, citation record, supervision metrics and hash adapter.",
      owner: "medical-resource-center",
      status: "mvp-ready-onsite-blocked",
      stage: "business-loop-mvp"
    },
    {
      id: "citizen-unified-entry",
      priority: "P1",
      domain: "citizen-service",
      proposalRequirement: "Use Liaoshitong/e-Dalian unified entry for health archive lookup, one-stop appointments and family doctor contract.",
      currentEvidence: "Resident archive, EMR, authorization, nursing, escort and mobile preview exist; the registration journey covers cross-role actions, while appointment-order-v1 adds signed callbacks, idempotent landing, dead-letter retry, order reconciliation and an institution callback center.",
      gap: "Government unified entry, real-name verification, 17 live hospital appointment sources, certified payment/refund endpoints, insurance production credentials, signed status dictionaries and official triage knowledge base remain external blockers.",
      nextStep: "Use the callback integration center during onsite joint testing and bind government identity, live schedule, payment/refund, insurance and messaging endpoints with signed dictionaries and cutover evidence.",
      owner: "citizen-service",
      status: "journey-mvp-onsite-blocked",
      stage: "appointment-callback-integration-mvp"
    },
    {
      id: "family-doctor-contract",
      priority: "P1",
      domain: "primary-care",
      proposalRequirement: "Manage family doctor templates, teams, service packages, contracts, fulfillment, renewal and applications.",
      currentEvidence: "Phase-2 family doctor MVP now includes templates, teams, service packages, resident applications, institution review, contract generation, fulfillment records, renewal/satisfaction evidence, role-scoped API and citizen/institution/platform UI.",
      gap: "Government unified entry, real e-signature/e-seal, payment-policy settlement, live team roster, public-health finance rules and onsite signoff remain external or production blockers.",
      nextStep: "Move the MVP into onsite joint testing: connect unified entry, real signature/seal, service package policy, live team registry and supervision signoff evidence.",
      owner: "primary-care",
      status: "mvp-ready-onsite-blocked",
      stage: "contract-lifecycle"
    },
    {
      id: "consumer-operations-backend",
      priority: "P2",
      domain: "consumer-ops",
      proposalRequirement: "Operate banner, content, messages, agreements, user, order, blacklist, real-name and hospital service settings.",
      currentEvidence: "phase2:citizen-operations-readiness, /api/citizen-operations/center, the platform operations center and resident public feed now cover content publishing, agreement versions, real-name review, cross-service order lookup, blacklist controls and hospital service enablement.",
      gap: "Government identity, legally approved agreements, live hospital service authorization, payment/refund/insurance callbacks and signed blacklist policy remain onsite blockers.",
      nextStep: "Move the operations MVP into onsite review and replace demo statuses with government identity, signed content/agreement versions, live hospital service catalogs and payment/refund receipts.",
      owner: "consumer-ops",
      status: "mvp-ready-onsite-blocked",
      stage: "ops-console-mvp"
    },
    {
      id: "industry-governance-center",
      priority: "P1",
      domain: "industry-governance",
      proposalRequirement: "Govern physical exam, fever clinic, disease reporting, clinical assistance, archive lookup, appointment, family doctor and regional performance.",
      currentEvidence: "The health dashboard now exposes eight phase-2 governance indicators, monthly/yearly snapshot views, source and owner metadata, exception explanations, drilldown, JSON export and a commission-only API.",
      gap: "Live physical-exam and fever-clinic feeds, 17-hospital appointment sources, event-date filtering, official metric versions and signed report review remain onsite blockers.",
      nextStep: "Use the indicator center in onsite joint testing and replace blocked demo sources with signed production feeds and official report versions.",
      owner: "commission-governance",
      status: "mvp-ready-onsite-blocked",
      stage: "indicator-center-mvp"
    },
    {
      id: "commercial-crypto-assessment",
      priority: "P2",
      domain: "security",
      proposalRequirement: "Support commercial crypto, SM algorithms, secure browser, USBKey, signing server, crypto appliance and timestamp.",
      currentEvidence: "HMAC signing, audit hash chain and security evidence ledger now feed a commercial-crypto adapter center with six provider-neutral contracts, SM2/SM3/SM4 runtime probes, evidence actions and a production gate.",
      gap: "Certified crypto products, production certificate authority, USBKey, signing/timestamp servers, key-custody procedures, onsite verification and an official assessment report remain missing.",
      nextStep: "Use the adapter contracts during procurement and onsite joint testing; bind certified GM HTTPS, signing, log integrity and data encryption products, then archive third-party assessment evidence.",
      owner: "security",
      status: "adapter-center-ready-procurement-blocked",
      stage: "adapter-contract"
    },
    {
      id: "ops-backup-dr",
      priority: "P2",
      domain: "operations",
      proposalRequirement: "Meet grade-level protection, audit, backup, disaster recovery and 24x365 operations requirements.",
      currentEvidence: "The operations dashboard now includes a production run center with four service-level policies, three 24x365 duty templates, incident actions, three recovery scenarios, RPO/RTO sample measurements, evidence packets and a production gate.",
      gap: "Production audit retention, database audit device, remote backup, live paging/ticket channels, named duty roster, full-volume recovery measurements and signed multi-party drills remain onsite blockers.",
      nextStep: "Bind the run center to production monitoring, SIEM, paging and ticket systems; configure remote backup and complete a full-volume recovery and rollback drill with signed RPO/RTO evidence.",
      owner: "operations",
      status: "run-center-ready-onsite-blocked",
      stage: "run-center-mvp"
    }
  ];
}

function defaultWorkPackages() {
  return [
    {
      id: "p0-phase2-ledger",
      priority: "P0",
      title: "Phase-2 proposal gap ledger and readiness gate",
      deliverables: ["gap ledger", "work packages", "onsite blockers", "release artifact"],
      acceptance: "phase2:proposal-readiness produces JSON/Markdown and is indexed by release/deploy checks.",
      status: "implemented-in-code"
    },
    {
      id: "p0-data-service-catalog",
      priority: "P0",
      title: "Data and service catalog with 216-table acceptance path",
      deliverables: ["data catalog", "service catalog", "table mapping", "field lineage", "quality rules"],
      acceptance: "Catalog rows link business module, source system, owner, interface contract, quality rule and acceptance evidence.",
      status: "mvp-ready-onsite-blocked"
    },
    {
      id: "p0-production-db-gateway",
      priority: "P0",
      title: "Production database and integration gateway baseline",
      deliverables: ["database adapter", "migration rollback", "gateway validation", "sample payloads"],
      acceptance: "One resident, one encounter, one lab report and one statistic load through the gateway with replay evidence.",
      status: "rehearsal-center-ready-onsite-blocked"
    },
    {
      id: "p0-onsite-joint-test-sample",
      priority: "P0",
      title: "Minimum onsite joint-test sample",
      deliverables: ["one tertiary hospital", "one county platform", "one primary institution", "issue ledger", "retest log"],
      acceptance: "At least two paths among identity, master index, HIS/EMR/LIS, archive, appointment or disease reporting run end-to-end.",
      status: "onsite-required"
    },
    {
      id: "p1-clinical-and-mutual-recognition",
      priority: "P1",
      title: "Clinical assistance and lab mutual-recognition MVP",
      deliverables: ["diagnosis/reporting rules", "duplicate reminder", "lab mapping", "recognition browser", "citation record"],
      acceptance: "Doctor-facing events are traceable and supervision metrics identify accepted/rejected recognition decisions.",
      status: "mvp-ready-onsite-blocked"
    },
    {
      id: "p1-citizen-and-family-doctor",
      priority: "P1",
      title: "Citizen unified entry, appointment and family doctor lifecycle",
      deliverables: ["unified-entry adapter", "appointment-source gateway", "family doctor templates", "fulfillment records"],
      acceptance: "Resident flows have agreement, real-name, order/refund/payment state and institution review evidence.",
      status: "mvp-ready-onsite-blocked"
    },
    {
      id: "p1-governance-indicator-center",
      priority: "P1",
      title: "Industry governance indicator center",
      deliverables: ["topic catalog", "metric formulas", "monthly/yearly reports", "exports", "responsible department"],
      acceptance: "Each supervision topic has source, metric definition, chart/export and exception explanation.",
      status: "mvp-ready-onsite-blocked"
    },
    {
      id: "p2-security-ops-assessment",
      priority: "P2",
      title: "Commercial crypto, grade protection, backup and operations",
      deliverables: ["crypto abstraction", "assessment ledger", "backup policy", "restore drill", "duty roster"],
      acceptance: "Formal production readiness is blocked until equipment, assessment reports, remote backup and signed drills are present.",
      status: "external-required"
    }
  ];
}

function defaultOnsiteBlockers() {
  return [
    { id: "live-institution-endpoints", owner: "integration", requiredFor: "13 hospitals and 5 district/county platforms", blocker: "live endpoint, account, field mapping and vendor payload signoff" },
    { id: "government-unified-entry", owner: "citizen-service", requiredFor: "Liaoshitong/e-Dalian unified entry", blocker: "government identity, real-name verification and redirect agreement" },
    { id: "production-database-signoff", owner: "platform-storage", requiredFor: "production database cutover", blocker: "DBA credentials, production parameters, migration window and rollback approval" },
    { id: "payment-insurance-joint-test", owner: "citizen-service", requiredFor: "appointment payment/refund and insurance status", blocker: "payment channel, refund callback and insurance agency joint testing" },
    { id: "lab-chain-resource", owner: "medical-resource-center", requiredFor: "78 lab item mapping and evidence chain", blocker: "mutual-recognition catalog, report PDF source and city-level chain/node resources" },
    { id: "commercial-crypto-devices", owner: "security", requiredFor: "commercial crypto assessment", blocker: "SM device, certificate authority, USBKey, signing server and official assessment report" },
    { id: "remote-backup-dr", owner: "operations", requiredFor: "disaster recovery and 24x365 operations", blocker: "remote backup target, 30/7 retention, 2h/12h RPO/RTO targets and signed drill" },
    { id: "onsite-acceptance-signoff", owner: "project-office", requiredFor: "production launch", blocker: "multi-party acceptance form, measured baseline and signed issue closure" }
  ];
}

function buildPhase2ProposalReadiness(options = {}) {
  const pkg = options.pkg ?? readJson("package.json");
  const planDoc = options.planDoc ?? readText(PLAN_DOC);
  const manifestSource = options.manifestSource ?? readText(path.join("scripts", "release-artifact-manifest.js"));
  const deployCheckSource = options.deployCheckSource ?? readText(path.join("scripts", "deploy-check.js"));
  const releaseReportSource = options.releaseReportSource ?? readText(path.join("scripts", "release-report.js"));
  const ledger = options.ledger ?? defaultGapLedger();
  const workPackages = options.workPackages ?? defaultWorkPackages();
  const onsiteBlockers = options.onsiteBlockers ?? defaultOnsiteBlockers();
  const missingPlanTokens = REQUIRED_PLAN_TOKENS.filter((token) => !planDoc.includes(token));
  const priorities = new Set(workPackages.map((item) => item.priority));
  const p0WorkPackages = workPackages.filter((item) => item.priority === "P0");
  const blockedLedgerRows = ledger.filter((item) => /blocked|required/i.test(String(item.status)));
  const requiredDomains = new Set(ledger.map((item) => item.domain));
  const requiredOwners = new Set(ledger.map((item) => item.owner));
  const checks = [
    check("phase2:plan-document", planDoc.includes("大连市全民健康信息化项目（二期）") && missingPlanTokens.length === 0, missingPlanTokens.length ? `missing ${missingPlanTokens.join(", ")}` : `${REQUIRED_PLAN_TOKENS.length} plan markers present`),
    check("phase2:gap-ledger", ledger.length >= 12 && ledger.every((item) => item.id && item.priority && item.domain && item.owner && item.currentEvidence && item.gap && item.nextStep && item.status), `${ledger.length} gap rows / ${requiredDomains.size} domains / ${requiredOwners.size} owners`),
    check("phase2:priority-roadmap", ["P0", "P1", "P2"].every((priority) => priorities.has(priority)) && p0WorkPackages.length >= 4, `${p0WorkPackages.length} P0 packages and ${workPackages.length} total packages`),
    check("phase2:proposal-scope", ["data-center-integration", "data-service-catalog", "production-database", "lab-mutual-recognition-ledger", "family-doctor-contract", "commercial-crypto-assessment"].every((id) => ledger.some((item) => item.id === id)), "critical phase-2 proposal domains are represented"),
    check("phase2:external-boundary", onsiteBlockers.length >= 8 && blockedLedgerRows.length >= 4, `${onsiteBlockers.length} onsite blockers and ${blockedLedgerRows.length} blocked ledger rows surfaced`),
    check("phase2:no-production-claim", ledger.every((item) => !/production-ready/i.test(String(item.status))) && workPackages.every((item) => !/production-ready/i.test(String(item.status))), "demo and joint-test states stay separate from production readiness"),
    check("phase2:onsite-sample", p0WorkPackages.some((item) => item.id === "p0-onsite-joint-test-sample" && /tertiary hospital/i.test(item.deliverables.join(" ")) && /county platform/i.test(item.deliverables.join(" "))), "minimum onsite sample is explicit"),
    check("phase2:release-wiring", Boolean(pkg.scripts?.["phase2:proposal-readiness"]) && manifestSource.includes("phase2-proposal-readiness-report.md") && manifestSource.includes("phase2:proposal-readiness") && deployCheckSource.includes("phase2ProposalReadiness") && releaseReportSource.includes("phase2Proposal") && releaseReportSource.includes("phase2-proposal-readiness-report.md"), "package script, release manifest, deploy check and release report are wired")
  ];
  return {
    ok: checks.every((item) => item.passed),
    generatedAt: new Date().toISOString(),
    source: {
      proposalPlan: PLAN_DOC,
      requiredPlanTokens: REQUIRED_PLAN_TOKENS,
      missingPlanTokens
    },
    summary: {
      gapRows: ledger.length,
      domains: requiredDomains.size,
      owners: requiredOwners.size,
      p0WorkPackages: p0WorkPackages.length,
      p1WorkPackages: workPackages.filter((item) => item.priority === "P1").length,
      p2WorkPackages: workPackages.filter((item) => item.priority === "P2").length,
      onsiteBlockers: onsiteBlockers.length,
      blockedLedgerRows: blockedLedgerRows.length,
      missingPlanTokens: missingPlanTokens.length
    },
    gapLedger: ledger,
    workPackages,
    onsiteBlockers,
    checks
  };
}

function renderMarkdown(report) {
  return [
    "# Phase 2 proposal readiness report",
    "",
    `- Generated at: ${report.generatedAt}`,
    `- Result: ${report.ok ? "PASS" : "FAIL"}`,
    `- Gap rows: ${report.summary.gapRows}`,
    `- Domains: ${report.summary.domains}`,
    `- Owners: ${report.summary.owners}`,
    `- P0/P1/P2 packages: ${report.summary.p0WorkPackages}/${report.summary.p1WorkPackages}/${report.summary.p2WorkPackages}`,
    `- Onsite/external blockers: ${report.summary.onsiteBlockers}`,
    "",
    "## Checks",
    "",
    "| Result | Check | Detail |",
    "|---|---|---|",
    ...report.checks.map((item) => `| ${item.passed ? "PASS" : "FAIL"} | ${item.id} | ${clean(item.detail)} |`),
    "",
    "## Gap ledger",
    "",
    "| Priority | Domain | Requirement | Gap | Next step | Owner | Status |",
    "|---|---|---|---|---|---|---|",
    ...report.gapLedger.map((item) => `| ${item.priority} | ${item.domain} | ${clean(item.proposalRequirement)} | ${clean(item.gap)} | ${clean(item.nextStep)} | ${item.owner} | ${item.status} |`),
    "",
    "## Work packages",
    "",
    "| Priority | ID | Package | Deliverables | Acceptance | Status |",
    "|---|---|---|---|---|---|",
    ...report.workPackages.map((item) => `| ${item.priority} | ${item.id} | ${clean(item.title)} | ${(item.deliverables || []).map(clean).join(", ")} | ${clean(item.acceptance)} | ${item.status} |`),
    "",
    "## Onsite and external blockers",
    "",
    "| Blocker | Owner | Required for | Blocking condition |",
    "|---|---|---|---|",
    ...report.onsiteBlockers.map((item) => `| ${item.id} | ${item.owner} | ${clean(item.requiredFor)} | ${clean(item.blocker)} |`),
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
  const report = buildPhase2ProposalReadiness();
  if (flags.write !== "false" && flags.write !== false) writeOutput(report, flags);
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
  buildPhase2ProposalReadiness,
  defaultGapLedger,
  defaultOnsiteBlockers,
  defaultWorkPackages,
  parseArgs,
  renderMarkdown,
  writeOutput
};
