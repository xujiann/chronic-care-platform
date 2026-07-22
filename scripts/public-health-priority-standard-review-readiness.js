#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const {
  PRIORITY_STANDARD_REVIEW_TRACKS,
  buildTrustedSiteEvidenceRegistry,
  buildPriorityStandardReviewPack,
  runPriorityStandardReviewAcceptanceScenario
} = require("../public-health-priority-standard-review-service");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT, "release", "public-health-priority-standard-review-readiness-report.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "public-health-priority-standard-review-readiness-report.md");

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function artifactAvailability() {
  return Object.fromEntries(
    PRIORITY_STANDARD_REVIEW_TRACKS.flatMap((track) => track.artifactEvidence).map((file) => [file, fs.existsSync(path.join(ROOT, file))])
  );
}

function check(id, passed, detail, category = "standard-review") {
  return { id, passed: Boolean(passed), detail, category };
}

function buildPublicHealthPriorityStandardReviewReadiness(options = {}) {
  const data = options.data || readJson("data/db.json");
  const ledger = options.ledger || data.publicHealthStandardImplementationLedger || [];
  const availability = options.artifactAvailability || artifactAvailability();
  const serviceSource = options.serviceSource ?? readText("public-health-priority-standard-review-service.js");
  const testSource = options.testSource ?? readText("test/public-health-priority-standard-review-service.test.js");
  const doc = options.doc ?? readText("docs/public-health-priority-standard-review.md");
  const sourcePack = buildPriorityStandardReviewPack({ ledger, data, artifactAvailability: availability });
  const trustedRegistry = buildTrustedSiteEvidenceRegistry({
    siteLaunchEvidence: data.siteLaunchEvidence,
    verificationTasks: data.publicHealthSiteEvidenceVerificationTasks
  });
  let reviewedPack = null;
  let scenarioError = "";
  try {
    reviewedPack = runPriorityStandardReviewAcceptanceScenario(sourcePack);
  } catch (error) {
    scenarioError = error.message;
  }

  const persistentReviewed = ledger.filter((item) => ["reviewed", "evidence-linked"].includes(String(item.status || "").toLowerCase())).length;
  const targetDomainIds = new Set(PRIORITY_STANDARD_REVIEW_TRACKS.flatMap((item) => item.domainIds));
  const targetLedgerReviewed = ledger.filter((item) => targetDomainIds.has(item.standardDomainId) && ["reviewed", "evidence-linked"].includes(String(item.status || "").toLowerCase())).length;
  const followup = sourcePack.tracks.find((item) => item.id === "phpsr-public-health-followup");
  const familyDoctor = sourcePack.tracks.find((item) => item.id === "phpsr-family-doctor");
  const checks = [
    check("scope:eight-business-tracks", sourcePack.summary.tracks === 8, `${sourcePack.summary.tracks}/8 tracks`, "scope"),
    check("scope:seven-standard-domains", sourcePack.summary.standardDomains === 7, `${sourcePack.summary.standardDomains}/7 unique standard domains`, "scope"),
    check("scope:followup-domain-reuse", JSON.stringify(followup?.domainIds) === JSON.stringify(["ph-chronic", "ph-archive"]), (followup?.domainIds || []).join(", "), "scope"),
    check("scope:family-doctor-domain-reuse", JSON.stringify(familyDoctor?.domainIds) === JSON.stringify(["ph-chronic", "ph-archive"]), (familyDoctor?.domainIds || []).join(", "), "scope"),
    check("responsibility:owners", sourcePack.tracks.every((item) => item.leadOwner && item.ownerRole && item.collaborators.length), `${sourcePack.tracks.filter((item) => item.leadOwner && item.ownerRole && item.collaborators.length).length}/8 owner matrices`, "responsibility"),
    check("mapping:ledger-domains", sourcePack.tracks.every((item) => !item.missingDomainIds.length && item.ledgerMappingComplete), `${sourcePack.tracks.filter((item) => !item.missingDomainIds.length && item.ledgerMappingComplete).length}/8 ledger mappings complete`, "mapping"),
    check("mapping:data-evidence", sourcePack.tracks.every((item) => !item.missingDataCollections.length), `${sourcePack.tracks.reduce((sum, item) => sum + item.dataCollections.length, 0)} data collection references`, "mapping"),
    check("mapping:artifact-evidence", sourcePack.tracks.every((item) => !item.missingArtifacts.length), `${Object.values(availability).filter(Boolean).length}/${Object.keys(availability).length} artifacts available`, "mapping"),
    check("mapping:ready", sourcePack.summary.mappingReady === 8 && sourcePack.status === "ready-for-owner-review", `${sourcePack.summary.mappingReady}/8 ready for owner review`, "mapping"),
    check("acceptance:review-scenario", reviewedPack?.summary?.mappingReviewed === 8 && reviewedPack?.status === "mapping-reviewed-site-evidence-pending", reviewedPack ? `${reviewedPack.summary.mappingReviewed}/8 reviewed` : scenarioError, "acceptance"),
    check("acceptance:auditable-actions", reviewedPack?.tracks?.every((item) => item.timeline.length === 2 && item.ownerConfirmation?.confirmedBy && item.mappingReview?.reviewedBy), `${reviewedPack?.tracks?.filter((item) => item.timeline.length === 2).length || 0}/8 auditable review tracks`, "acceptance"),
    check("launch:site-evidence-boundary", reviewedPack?.summary?.siteEvidencePending === 8 && reviewedPack?.summary?.formallyAccepted === 0 && reviewedPack?.summary?.productionBlockers === 8 && reviewedPack?.productionBlockers?.length === 8 && reviewedPack?.productionReady === false, `${reviewedPack?.summary?.siteEvidencePending ?? 8} site evidence packets pending / ${reviewedPack?.productionBlockers?.length || 0} explicit blockers`, "launch"),
    check("source:persistent-review-boundary", targetLedgerReviewed === 0 && persistentReviewed === 0, `${targetLedgerReviewed} target / ${persistentReviewed} total source ledger rows persisted as reviewed`, "source"),
    check("safety:negative-tests", ["incomplete domain", "trusted server evidence registry", "forged verified and signedBy evidence", "role, idempotency and version"].every((token) => testSource.includes(token)), "review completeness, forged evidence, trusted registry and concurrency safeguards are tested", "safety"),
    check("safety:trusted-evidence-gate", ["trustedSiteEvidenceRegistry", "signatureVerified", "verificationSource", "artifactDigest", "productionBlockers"].every((token) => serviceSource.includes(token)), "production readiness requires a server-controlled evidence registry result", "safety"),
    check("safety:trusted-registry-adapter", ["buildTrustedSiteEvidenceRegistry", "attestationOrigin", "verificationReceiptId", "TRUSTED_SIGNATURE_ALGORITHMS"].every((token) => serviceSource.includes(token)) && testSource.includes("rejects legacy verified rows"), `${trustedRegistry.summary.trustedRecords} trusted / ${trustedRegistry.summary.rejectedRecords} rejected current evidence rows`, "safety"),
    check("implementation:domain-service", ["buildPriorityStandardReviewPack", "applyPriorityStandardReviewAction", "confirm-responsibility", "review-standard-mapping", "link-site-evidence"].every((token) => serviceSource.includes(token)), "review pack and controlled actions are implemented", "implementation"),
    check("docs:t00-handoff", ["T00", "server.js", "package.json", "八个业务轨道", "七个标准域", "现场证据"].every((token) => doc.includes(token)), "scope, evidence boundary and T00 handoff are documented", "docs")
  ];

  return {
    generatedAt: new Date().toISOString(),
    ok: checks.every((item) => item.passed),
    functionalState: reviewedPack?.summary?.mappingReviewed === 8 ? "priority-standard-review-pack-runnable" : "incomplete",
    formalGoLiveState: "blocked-until-owner-review-persisted-and-site-evidence-verified",
    summary: {
      checks: checks.length,
      passed: checks.filter((item) => item.passed).length,
      tracks: sourcePack.summary.tracks,
      standardDomains: sourcePack.summary.standardDomains,
      mappingReady: sourcePack.summary.mappingReady,
      acceptanceReviewed: reviewedPack?.summary?.mappingReviewed || 0,
      sourceLedgerReviewed: targetLedgerReviewed,
      siteEvidencePending: reviewedPack?.summary?.siteEvidencePending ?? 8,
      trustedEvidenceRecords: trustedRegistry.summary.trustedRecords,
      rejectedEvidenceRecords: trustedRegistry.summary.rejectedRecords
    },
    trustedEvidenceRegistry: trustedRegistry,
    sourcePack,
    acceptanceScenario: reviewedPack,
    checks,
    artifacts: {
      service: "public-health-priority-standard-review-service.js",
      test: "test/public-health-priority-standard-review-service.test.js",
      documentation: "docs/public-health-priority-standard-review.md",
      report: "release/public-health-priority-standard-review-readiness-report.md"
    },
    t00Integration: [
      "Persist owner confirmation and mapping review actions through the existing standard implementation API.",
      "Generate trustedVerification and matching verificationReceiptId only after server-side signature and digest verification, then call buildTrustedSiteEvidenceRegistry.",
      "Add package.json check/test/readiness wiring and aggregate release evidence.",
      "Keep site evidence verification and production approval blocked until signed artifacts are verified."
    ]
  };
}

function table(value) {
  return String(value ?? "").replace(/\|/g, "/").replace(/\r?\n/g, " ");
}

function renderMarkdown(report) {
  return [
    "# Public health priority standard review readiness",
    "",
    `- Generated at: ${report.generatedAt}`,
    `- Result: ${report.ok ? "PASS" : "FAIL"}`,
    `- Functional state: ${report.functionalState}`,
    `- Formal go-live state: ${report.formalGoLiveState}`,
    `- Business tracks: ${report.summary.tracks}`,
    `- Standard domains: ${report.summary.standardDomains}`,
    `- Source ledger reviewed: ${report.summary.sourceLedgerReviewed}`,
    `- Site evidence pending: ${report.summary.siteEvidencePending}`,
    `- Trusted evidence registry: ${report.summary.trustedEvidenceRecords} trusted / ${report.summary.rejectedEvidenceRecords} rejected`,
    "",
    "## Checks",
    "",
    "| Status | Category | Check | Detail |",
    "|---|---|---|---|",
    ...report.checks.map((item) => `| ${item.passed ? "PASS" : "FAIL"} | ${item.category} | ${item.id} | ${table(item.detail)} |`),
    "",
    "## Review tracks",
    "",
    "| Track | Standard domains | Lead owner | Mapping state | Site evidence |",
    "|---|---|---|---|---|",
    ...report.acceptanceScenario.tracks.map((item) => `| ${table(item.name)} | ${item.domainIds.join("<br>")} | ${table(item.leadOwner)} | ${item.state} | ${item.formallyAccepted ? "verified" : "pending"} |`),
    "",
    "## T00 integration boundary",
    "",
    ...report.t00Integration.map((item) => `- ${item}`),
    ""
  ].join("\n");
}

function parseArgs(argv = process.argv.slice(2)) {
  const flags = {};
  argv.forEach((arg) => {
    if (!arg.startsWith("--")) return;
    const [key, ...rest] = arg.slice(2).split("=");
    flags[key] = rest.length ? rest.join("=") : true;
  });
  return { output: flags.output || DEFAULT_OUTPUT, markdown: flags.markdown || DEFAULT_MARKDOWN };
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
  const report = buildPublicHealthPriorityStandardReviewReadiness();
  writeOutput(report, parseArgs());
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
  artifactAvailability,
  buildPublicHealthPriorityStandardReviewReadiness,
  parseArgs,
  renderMarkdown,
  writeOutput
};
