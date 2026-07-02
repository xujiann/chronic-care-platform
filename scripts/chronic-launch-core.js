#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT, "release", "chronic-launch-core.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "chronic-launch-core.md");

const CORE_ITEMS = [
  {
    id: "institution-systems",
    title: "Medical institution system integration",
    collection: "chronicExternalIntegrations",
    owner: "institution-integration",
    requiredFields: ["system", "contractId", "endpoint", "signature", "idempotencyKey", "samplePayload", "receiptStatus"],
    closureFields: ["completionStatus", "latestReceiptId", "jointTestStatus"],
    evidence: ["docs/chronic-institution-interfaces.md", "/api/chronic/institution-interfaces"]
  },
  {
    id: "identity-scope",
    title: "Production identity and organization scope",
    collection: "chronicIdentityScopes",
    owner: "identity-integration",
    requiredFields: ["claim", "source", "mappedField", "role", "organizationScope", "sampleValue"],
    closureFields: ["completionStatus", "sampleTokenValidated", "scopeReviewStatus"],
    evidence: ["identity-contract", "canAccessResident", "scopeStateForUser"]
  },
  {
    id: "message-channels",
    title: "Message channel receipts and escalation",
    collection: "chronicMessageChannels",
    owner: "message-platform",
    requiredFields: ["channel", "provider", "receiptField", "retryPolicy", "escalationAfter", "fallback"],
    closureFields: ["completionStatus", "latestReceiptStatus", "escalationTested"],
    evidence: ["/api/chronic/reminder-outreach", "taskMessages.receipts"]
  },
  {
    id: "quality-model",
    title: "Chronic quality model governance",
    collection: "chronicModelGovernance",
    owner: "chronic-quality-office",
    requiredFields: ["modelId", "diseaseType", "version", "threshold", "reviewOwner", "manualReview", "sampleRule"],
    closureFields: ["completionStatus", "lastReviewStatus", "qualitySampleStatus"],
    evidence: ["diseaseRegistryModels", "chronicQualityMetrics"]
  },
  {
    id: "pharmacy-insurance",
    title: "Pharmacy and insurance settlement closure",
    collection: "chronicPharmacyInsuranceLinks",
    owner: "pharmacy-insurance",
    requiredFields: ["medicationPickupId", "insuranceClaimId", "longPrescription", "catalogVersion", "settlementStatus", "callbackStatus"],
    closureFields: ["completionStatus", "settlementReceiptStatus", "closureStatus"],
    evidence: ["medicationPickups", "insuranceClaims", "/api/chronic/pharmacy-callbacks"]
  }
];

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

function readText(relativePath, fallback = "") {
  const fullPath = path.join(ROOT, relativePath);
  return fs.existsSync(fullPath) ? fs.readFileSync(fullPath, "utf8") : fallback;
}

function parseArgs(argv = process.argv.slice(2)) {
  const flags = {};
  argv.forEach((arg) => {
    if (!arg.startsWith("--")) return;
    const [key, ...rest] = arg.slice(2).split("=");
    flags[key] = rest.length ? rest.join("=") : true;
  });
  return flags;
}

function hasValue(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") return Object.keys(value).length > 0;
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function rowReady(row, fields) {
  return fields.every((field) => hasValue(row?.[field]));
}

function buildCollectionEvidence(data, item) {
  const rows = Array.isArray(data[item.collection]) ? data[item.collection] : [];
  return {
    collection: item.collection,
    rows: rows.length,
    readyRows: rows.filter((row) => rowReady(row, item.requiredFields)).length,
    requiredFields: item.requiredFields,
    missingFields: item.requiredFields.filter((field) => !rows.some((row) => hasValue(row[field]))),
    samples: rows.slice(0, 3)
  };
}

function buildClosureEvidence(data, item) {
  const rows = Array.isArray(data[item.collection]) ? data[item.collection] : [];
  const fields = item.closureFields || [];
  return {
    fields,
    readyRows: rows.filter((row) => rowReady(row, fields)).length,
    rows: rows.length,
    missingFields: fields.filter((field) => !rows.some((row) => hasValue(row[field])))
  };
}

function buildSiteSignoffs(data) {
  const signoffs = Array.isArray(data.chronicLaunchCoreSignoffs) ? data.chronicLaunchCoreSignoffs : [];
  return {
    rows: signoffs,
    total: signoffs.length,
    signed: signoffs.filter((item) => /^signed|approved|completed$/i.test(String(item.signoffStatus || ""))).length,
    owners: [...new Set(signoffs.map((item) => item.owner).filter(Boolean))]
  };
}

function buildCrossEvidence(data, server, docs, item) {
  if (item.id === "institution-systems") {
    return [
      docs.includes("HIS/EMR/LIS/PACS"),
      docs.includes("/api/chronic/institution-interfaces"),
      server.includes("/api/chronic/institution-interfaces")
    ];
  }
  if (item.id === "identity-scope") {
    return [
      server.includes("canAccessResident"),
      server.includes("scopeStateForUser"),
      Array.isArray(data.authUsers) && data.authUsers.some((user) => user.orgCode && user.role)
    ];
  }
  if (item.id === "message-channels") {
    return [
      server.includes("/api/chronic/reminder-outreach"),
      (data.taskMessages || []).some((message) => message.chronicFollowup && Array.isArray(message.receipts)),
      (data.seniorServices || []).some((service) => service.outreachEvidence)
    ];
  }
  if (item.id === "quality-model") {
    return [
      Array.isArray(data.diseaseRegistryModels) && data.diseaseRegistryModels.length >= 2,
      Array.isArray(data.chronicQualityMetrics) && data.chronicQualityMetrics.length >= 5,
      (data.chronicModelGovernance || []).some((row) => row.manualReview)
    ];
  }
  if (item.id === "pharmacy-insurance") {
    return [
      Array.isArray(data.medicationPickups) && data.medicationPickups.some((row) => row.callbackExternalId || row.pickupConfirmedAt),
      Array.isArray(data.insuranceClaims) && data.insuranceClaims.length > 0,
      server.includes("/api/chronic/pharmacy-callbacks")
    ];
  }
  return [];
}

function buildChronicLaunchCoreReport(options = {}) {
  const data = options.data || readJson("data/db.json");
  const pkg = options.pkg || readJson("package.json");
  const server = options.server || readText("server.js");
  const docs = options.docs || [
    readText("docs/chronic-institution-interfaces.md"),
    readText("docs/chronic-followup-readiness.md"),
    readText("docs/chronic-launch-core.md")
  ].join("\n");

  const items = CORE_ITEMS.map((item) => {
    const collectionEvidence = buildCollectionEvidence(data, item);
    const closureEvidence = buildClosureEvidence(data, item);
    const crossEvidence = buildCrossEvidence(data, server, docs, item);
    const collectionReady = collectionEvidence.rows > 0 && collectionEvidence.readyRows === collectionEvidence.rows;
    const closureReady = closureEvidence.rows > 0 && closureEvidence.readyRows === closureEvidence.rows;
    const evidenceReady = crossEvidence.length > 0 && crossEvidence.every(Boolean);
    return {
      ...item,
      collectionEvidence,
      closureEvidence,
      evidenceReady,
      closureReady,
      ready: collectionReady && evidenceReady && closureReady
    };
  });
  const siteSignoffs = buildSiteSignoffs(data);

  const checks = [
    { id: "launch-core:items", passed: items.length === 5 && items.every((item) => item.ready), detail: `${items.filter((item) => item.ready).length}/${items.length} core items ready` },
    { id: "launch-core:dataCollections", passed: items.every((item) => item.collectionEvidence.rows > 0), detail: items.map((item) => `${item.collection}:${item.collectionEvidence.rows}`).join(";") },
    { id: "launch-core:actionClosure", passed: items.every((item) => item.closureReady), detail: items.map((item) => `${item.id}:${item.closureEvidence.readyRows}/${item.closureEvidence.rows}`).join(";") },
    { id: "launch-core:siteSignoffs", passed: siteSignoffs.total >= 6 && siteSignoffs.signed === siteSignoffs.total, detail: `${siteSignoffs.signed}/${siteSignoffs.total} signoffs signed` },
    { id: "launch-core:routes", passed: server.includes("/api/chronic/launch-core"), detail: "/api/chronic/launch-core" },
    { id: "launch-core:script", passed: Boolean(pkg.scripts?.["chronic:launch-core"]), detail: "chronic:launch-core" },
    { id: "launch-core:docs", passed: docs.includes("chronic-launch-core") && docs.includes("HIS/EMR/LIS/PACS"), detail: "docs/chronic-launch-core.md" }
  ];

  return {
    ok: checks.every((check) => check.passed),
    generatedAt: new Date().toISOString(),
    summary: {
      items: items.length,
      readyItems: items.filter((item) => item.ready).length,
      evidenceRows: items.reduce((sum, item) => sum + item.collectionEvidence.rows, 0),
      closureRows: items.reduce((sum, item) => sum + item.closureEvidence.readyRows, 0),
      signoffs: siteSignoffs.total,
      signedSignoffs: siteSignoffs.signed
    },
    items,
    siteSignoffs,
    checks,
    apiSurface: [
      "GET /api/chronic/launch-core",
      "POST /api/chronic/launch-core/actions"
    ]
  };
}

function renderMarkdown(report) {
  const checkRows = report.checks.map((item) => `| ${item.passed ? "PASS" : "FAIL"} | ${item.id} | ${String(item.detail || "").replace(/\|/g, "/")} |`);
  const itemRows = report.items.map((item) => `| ${item.ready ? "PASS" : "FAIL"} | ${item.id} | ${item.title} | ${item.collection} | ${item.collectionEvidence.readyRows}/${item.collectionEvidence.rows} | ${item.closureEvidence.readyRows}/${item.closureEvidence.rows} | ${item.owner} |`);
  const signoffRows = (report.siteSignoffs?.rows || []).map((item) => `| ${item.signoffStatus} | ${item.itemId} | ${item.owner} | ${item.artifact} | ${item.evidence} |`);
  return [
    "# Chronic launch core readiness",
    "",
    `- Generated at: ${report.generatedAt}`,
    `- Result: ${report.ok ? "PASS" : "FAIL"}`,
    `- Core items: ${report.summary.readyItems}/${report.summary.items}`,
    `- Evidence rows: ${report.summary.evidenceRows}`,
    "",
    "## Checks",
    "",
    "| Result | Check | Detail |",
    "|---|---|---|",
    ...checkRows,
    "",
    "## Core Items",
    "",
    "| Result | Item | Title | Collection | Ready rows | Closure rows | Owner |",
    "|---|---|---|---|---|---|---|",
    ...itemRows,
    "",
    "## Site Signoffs",
    "",
    "| Status | Item | Owner | Artifact | Evidence |",
    "|---|---|---|---|---|",
    ...signoffRows,
    "",
    "## API Surface",
    "",
    report.apiSurface.map((item) => `- ${item}`).join("\n"),
    ""
  ].join("\n");
}

function writeOutput(report, flags = {}) {
  const output = path.resolve(ROOT, String(flags.output || DEFAULT_OUTPUT));
  const markdown = path.resolve(ROOT, String(flags.markdown || DEFAULT_MARKDOWN));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2), "utf8");
  fs.mkdirSync(path.dirname(markdown), { recursive: true });
  fs.writeFileSync(markdown, renderMarkdown(report), "utf8");
  return { output, markdown };
}

if (require.main === module) {
  const flags = parseArgs();
  const report = buildChronicLaunchCoreReport();
  writeOutput(report, flags);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok && !flags.allowFailure) process.exitCode = 1;
}

module.exports = {
  CORE_ITEMS,
  buildChronicLaunchCoreReport,
  parseArgs,
  renderMarkdown,
  writeOutput
};
