#!/usr/bin/env node
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const {
  buildPilotEvidenceRepositoryCenter,
  createPilotEvidenceBatch,
  freezeAcceptancePack,
  recordEvidenceAccess,
  registerEvidenceArtifact,
  reviewEvidenceArtifact,
  verifyAuditChain,
  verifyAcceptancePack
} = require("../pilot-evidence-repository");
const { buildPilotEvidencePostgresReadiness } = require("../pilot-evidence-postgres");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT, "release", "pilot-evidence-repository-readiness.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "pilot-evidence-repository-readiness.md");

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

function digest(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function buildExercisedBatch() {
  const owner = { actor: { id: "pilot-owner", name: "Pilot owner", role: "institution" }, now: "2026-07-26T01:00:00.000Z" };
  const reviewer = { actor: { id: "pilot-reviewer", name: "Pilot reviewer", role: "commission" } };
  const batch = createPilotEvidenceBatch({
    id: "pilot-evidence-readiness",
    pilotId: "pilot-readiness",
    hospitalName: "Pilot hospital",
    organizationCode: "ORG-PILOT-READINESS"
  }, owner);
  batch.requirements.forEach((requirement, index) => {
    const checksumSha256 = digest(requirement.id);
    const artifact = registerEvidenceArtifact(batch, {
      id: `artifact-${requirement.id}`,
      requirementId: requirement.id,
      filename: `${requirement.id}.pdf`,
      contentType: "application/pdf",
      sizeBytes: 1024 + index,
      checksumSha256,
      classification: "evidence",
      retentionPolicy: "audit-evidence",
      scanStatus: "clean",
      objectKey: `pilot-evidence/${batch.id}/${requirement.id}.pdf`,
      objectVersion: "version-1"
    }, { ...owner, now: `2026-07-26T01:${String(index).padStart(2, "0")}:00.000Z` });
    reviewEvidenceArtifact(batch, {
      artifactId: artifact.id,
      outcome: "verified",
      evidenceDigest: checksumSha256,
      note: "Readiness lifecycle verification"
    }, { ...reviewer, now: `2026-07-26T02:${String(index).padStart(2, "0")}:00.000Z` });
  });
  recordEvidenceAccess(batch, {
    artifactId: batch.artifacts[0].id,
    purpose: "Readiness access audit",
    outcome: "allowed"
  }, { ...reviewer, now: "2026-07-26T03:00:00.000Z" });
  const pack = freezeAcceptancePack(batch, { ...reviewer, now: "2026-07-26T04:00:00.000Z" });
  return { batch, pack };
}

function buildPilotEvidenceRepositoryReadiness(options = {}) {
  const pkg = options.pkg || readJson("package.json");
  const serviceSource = options.serviceSource ?? read("pilot-evidence-repository.js");
  const apiSource = options.apiSource ?? read("pilot-evidence-api.js");
  const storageSource = options.storageSource ?? read("secure-object-storage.js");
  const serverSource = options.serverSource ?? read("server.js");
  const htmlSource = options.htmlSource ?? read("pilot-evidence.html");
  const clientSource = options.clientSource ?? read("pilot-evidence.js");
  const postgresSource = options.postgresSource ?? read("pilot-evidence-postgres.js");
  const postgresAdapterSource = options.postgresAdapterSource ?? read("postgres-production-adapter.js");
  const migrationSource = options.migrationSource ?? read("scripts/postgres-migration-package.js");
  const documentation = options.documentation ?? read("docs/pilot-evidence-repository.md");
  const releaseSource = options.releaseSource ?? read("scripts/release-report.js");
  const manifestSource = options.manifestSource ?? read("scripts/release-artifact-manifest.js");
  const { batch, pack } = buildExercisedBatch();
  const verification = verifyAcceptancePack(pack);
  const auditVerification = verifyAuditChain(batch);
  const center = buildPilotEvidenceRepositoryCenter([batch]);
  const databaseReadiness = buildPilotEvidencePostgresReadiness({
    batches: [batch],
    env: options.env || {}
  });
  const groupCounts = Object.fromEntries(["site-task", "interface-receipt", "alert-route", "four-party-signoff"].map((group) => [
    group,
    batch.requirements.filter((item) => item.group === group).length
  ]));
  const controls = [
    {
      id: "batch-scope",
      passed: groupCounts["site-task"] === 10
        && groupCounts["interface-receipt"] === 4
        && groupCounts["alert-route"] === 2
        && groupCounts["four-party-signoff"] === 4,
      detail: `${groupCounts["site-task"]}/10 site, ${groupCounts["interface-receipt"]}/4 interface, ${groupCounts["alert-route"]}/2 alert, ${groupCounts["four-party-signoff"]}/4 signoff`
    },
    {
      id: "storage-controls",
      passed: ["validateAttachmentMetadata", "malware scan must pass", "audit-evidence", "objectVersion"].every((marker) => serviceSource.includes(marker))
        && ["checksumSha256", "serverSideMalwareScanRequired", "immutableRetentionPolicies"].every((marker) => storageSource.includes(marker)),
      detail: "checksum, clean scan, object version, evidence classification and immutable retention enforced"
    },
    {
      id: "independent-review",
      passed: ["independent reviewer", "REVIEWER_ROLES", "evidenceDigest"].every((marker) => serviceSource.includes(marker)),
      detail: "submitter and reviewer separation with digest confirmation"
    },
    {
      id: "version-and-audit",
      passed: ["superseded", "artifact-accessed", "previousHash", "chainHash", "verifyAuditChain"].every((marker) => serviceSource.includes(marker))
        && center.summary.accessAuditEvents === 1
        && auditVerification.ok,
      detail: `${batch.artifacts.length} versioned artifacts / ${batch.auditEvents.length} chained audit events`
    },
    {
      id: "freeze-and-verify",
      passed: batch.status === "frozen"
        && center.summary.verifiedRequirements === 20
        && verification.ok
        && pack.summary.requirements === 20,
      detail: `${pack.summary.verified}/20 requirements frozen with ${pack.manifestSha256}`
    },
    {
      id: "persistent-api",
      passed: [
        "handlePilotEvidenceApi",
        "expectedRevision",
        "completedEvidenceAttachment",
        "acceptance-pack",
        "download-intent"
      ].every((marker) => apiSource.includes(marker))
        && ["PilotEvidenceApi.normalizeState", "PilotEvidenceApi.handlePilotEvidenceApi"].every((marker) => serverSource.includes(marker)),
      detail: "role-scoped persistent API, attachment linkage, optimistic locking, freeze and export routes"
    },
    {
      id: "operations-ui",
      passed: [
        "pilot-evidence-batch-form",
        "pilot-evidence-requirements",
        "pilot-evidence-artifact-dialog",
        "pilot-evidence-review-dialog",
        "pilot-evidence-freeze"
      ].every((marker) => htmlSource.includes(marker))
        && ["/api/pilot-evidence", "expectedRevision", "acceptance-pack?download=1"].every((marker) => clientSource.includes(marker)),
      detail: "batch, requirement, attachment, review, freeze and export workflows are available in the operations UI"
    },
    {
      id: "postgres-domain-adapter",
      passed: databaseReadiness.softwareReady
        && [
          "pilot_evidence_batches",
          "pilot_evidence_batch_versions",
          "reject_pilot_evidence_version_mutation",
          "retention_until"
        ].every((marker) => postgresSource.includes(marker))
        && ["syncPilotEvidenceProjection", "PILOT_EVIDENCE_COLLECTION_DELETE_BLOCKED"].every((marker) => postgresAdapterSource.includes(marker))
        && ["pilot-evidence-load.sql", "pilot-evidence-verify.sql"].every((marker) => migrationSource.includes(marker)),
      detail: `${databaseReadiness.projectedBatches} batch projected with append-only revisions and ${databaseReadiness.retentionYears}-year minimum retention`
    },
    {
      id: "documentation",
      passed: ["20 required controls", "immutable", "independent review", "manifest SHA-256", "production boundary"].every((marker) => documentation.includes(marker)),
      detail: "workflow, controls, acceptance pack and production boundary documented"
    },
    {
      id: "release-wiring",
      passed: Boolean(pkg.scripts?.["pilot-evidence:readiness"])
        && releaseSource.includes("buildPilotEvidenceRepositoryReadiness")
        && manifestSource.includes("pilot-evidence-repository-readiness"),
      detail: "package, release report and artifact manifest wiring"
    }
  ];
  const blockers = [
    "full-volume PostgreSQL migration, native backup and signed restore rehearsal evidence",
    "real object-storage bucket, KMS policy and WORM/object-lock acceptance",
    "production malware engine and signature update receipt",
    "pilot hospital identities, interface receipts and alert acknowledgements",
    "four-party electronic or handwritten signoff originals",
    "retention, backup restore and access-audit site acceptance"
  ];
  return {
    ok: controls.every((item) => item.passed),
    generatedAt: new Date().toISOString(),
    status: "postgres-domain-adapter-ready-site-acceptance-pending",
    productionReady: false,
    summary: {
      controls: controls.length,
      controlsReady: controls.filter((item) => item.passed).length,
      requiredItems: batch.requirements.length,
      verifiedItems: center.summary.verifiedRequirements,
      auditEvents: batch.auditEvents.length,
      productionBlockers: blockers.length
    },
    template: {
      siteTasks: groupCounts["site-task"],
      interfaceReceipts: groupCounts["interface-receipt"],
      alertRoutes: groupCounts["alert-route"],
      fourPartySignoffs: groupCounts["four-party-signoff"]
    },
    exercisedPack: {
      batchId: batch.id,
      status: batch.status,
      manifestSha256: pack.manifestSha256,
      verification,
      auditVerification
    },
    database: databaseReadiness,
    controls,
    blockers
  };
}

function renderMarkdown(report) {
  return [
    "# Pilot evidence repository readiness",
    "",
    `- Generated at: ${report.generatedAt}`,
    `- Result: ${report.ok ? "PASS" : "FAIL"}`,
    `- Status: ${report.status}`,
    `- Production ready: ${report.productionReady ? "yes" : "no"}`,
    `- Required evidence: ${report.summary.verifiedItems}/${report.summary.requiredItems} lifecycle exercised`,
    "",
    "## Batch template",
    "",
    "| Group | Required |",
    "|---|---:|",
    `| Site tasks | ${report.template.siteTasks} |`,
    `| Interface receipts | ${report.template.interfaceReceipts} |`,
    `| Alert routes | ${report.template.alertRoutes} |`,
    `| Four-party signoffs | ${report.template.fourPartySignoffs} |`,
    "",
    "## Controls",
    "",
    "| Result | Control | Detail |",
    "|---|---|---|",
    ...report.controls.map((item) => `| ${item.passed ? "PASS" : "FAIL"} | ${item.id} | ${String(item.detail).replace(/\|/g, "/")} |`),
    "",
    "## Production blockers",
    "",
    ...report.blockers.map((item) => `- ${item}`),
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
  const report = buildPilotEvidenceRepositoryReadiness();
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
  buildPilotEvidenceRepositoryReadiness,
  parseArgs,
  renderMarkdown,
  writeOutput
};
