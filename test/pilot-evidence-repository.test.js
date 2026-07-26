const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

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
const {
  buildPilotEvidenceRepositoryReadiness,
  parseArgs,
  renderMarkdown,
  writeOutput
} = require("../scripts/pilot-evidence-repository-readiness");

const ROOT = path.resolve(__dirname, "..");
const OWNER = { actor: { id: "hospital-owner", name: "Hospital owner", role: "institution" } };
const REVIEWER = { actor: { id: "commission-reviewer", name: "Commission reviewer", role: "commission" } };

function digest(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function createBatch() {
  return createPilotEvidenceBatch({
    id: "batch-test",
    pilotId: "pilot-test",
    hospitalName: "Test hospital"
  }, { ...OWNER, now: "2026-07-26T01:00:00.000Z" });
}

function register(batch, requirementId, suffix = "v1", context = OWNER) {
  const checksumSha256 = digest(`${requirementId}-${suffix}`);
  const artifact = registerEvidenceArtifact(batch, {
    id: `${requirementId}-${suffix}`,
    requirementId,
    filename: `${requirementId}-${suffix}.pdf`,
    contentType: "application/pdf",
    sizeBytes: 2048,
    checksumSha256,
    classification: "evidence",
    retentionPolicy: "audit-evidence",
    scanStatus: "clean",
    objectKey: `pilot/${batch.id}/${requirementId}-${suffix}.pdf`,
    objectVersion: suffix
  }, context);
  return { artifact, checksumSha256 };
}

function verify(batch, artifact, checksumSha256, context = REVIEWER) {
  return reviewEvidenceArtifact(batch, {
    artifactId: artifact.id,
    outcome: "verified",
    evidenceDigest: checksumSha256,
    note: "Independent verification passed"
  }, context);
}

function completeBatch(batch) {
  batch.requirements.forEach((requirement, index) => {
    const receipt = register(batch, requirement.id, `v${index + 1}`, {
      ...OWNER,
      now: `2026-07-26T01:${String(index).padStart(2, "0")}:00.000Z`
    });
    verify(batch, receipt.artifact, receipt.checksumSha256, {
      ...REVIEWER,
      now: `2026-07-26T02:${String(index).padStart(2, "0")}:00.000Z`
    });
  });
}

test("pilot evidence batch contains the complete P0-B acceptance scope", () => {
  const batch = createBatch();
  assert.equal(batch.status, "open");
  assert.equal(batch.requirements.length, 20);
  assert.equal(batch.requirements.filter((item) => item.group === "site-task").length, 10);
  assert.equal(batch.requirements.filter((item) => item.group === "interface-receipt").length, 4);
  assert.equal(batch.requirements.filter((item) => item.group === "alert-route").length, 2);
  assert.equal(batch.requirements.filter((item) => item.group === "four-party-signoff").length, 4);
  assert.equal(batch.auditEvents[0].action, "batch-created");
  assert.match(batch.auditEvents[0].chainHash, /^[a-f0-9]{64}$/);
  assert.equal(verifyAuditChain(batch).ok, true);
});

test("artifact registration enforces storage controls, independent review and version history", () => {
  const batch = createBatch();
  assert.throws(() => registerEvidenceArtifact(batch, {
    requirementId: "site-01",
    filename: "infected.pdf",
    contentType: "application/pdf",
    sizeBytes: 2048,
    checksumSha256: "a".repeat(64),
    classification: "evidence",
    retentionPolicy: "audit-evidence",
    scanStatus: "infected",
    objectKey: "pilot/infected.pdf",
    objectVersion: "v1"
  }, OWNER), /malware scan must pass/);

  const first = register(batch, "site-01", "v1");
  assert.throws(() => register(batch, "site-01", "v1"), /artifact id already exists/);
  assert.throws(() => reviewEvidenceArtifact(batch, {
    artifactId: first.artifact.id,
    outcome: "verified",
    evidenceDigest: first.checksumSha256,
    note: "Self review"
  }, OWNER), /independent reviewer/);
  assert.throws(() => reviewEvidenceArtifact(batch, {
    artifactId: first.artifact.id,
    outcome: "verified",
    evidenceDigest: "0".repeat(64),
    note: "Wrong digest"
  }, REVIEWER), /does not match/);
  verify(batch, first.artifact, first.checksumSha256);
  assert.throws(() => verify(batch, first.artifact, first.checksumSha256), /already been reviewed/);

  const second = register(batch, "site-01", "v2");
  assert.equal(first.artifact.status, "superseded");
  assert.equal(second.artifact.version, 2);
  assert.equal(batch.requirements.find((item) => item.id === "site-01").status, "submitted");
  verify(batch, second.artifact, second.checksumSha256);
  assert.equal(batch.requirements.find((item) => item.id === "site-01").status, "verified");

  const access = recordEvidenceAccess(batch, {
    artifactId: second.artifact.id,
    purpose: "Acceptance sampling",
    outcome: "allowed"
  }, REVIEWER);
  assert.equal(access.action, "artifact-accessed");
  assert.equal(access.previousHash, batch.auditEvents.at(-2).chainHash);
});

test("batch freezing requires all independent reviews and produces a tamper-evident manifest", () => {
  const batch = createBatch();
  assert.throws(() => freezeAcceptancePack(batch, REVIEWER), /20 unverified requirements/);
  completeBatch(batch);
  const pack = freezeAcceptancePack(batch, { ...REVIEWER, now: "2026-07-26T04:00:00.000Z" });

  assert.equal(batch.status, "frozen");
  assert.equal(pack.summary.requirements, 20);
  assert.equal(pack.summary.verified, 20);
  assert.equal(pack.summary.interfaceReceipts, 4);
  assert.equal(pack.summary.alertRoutes, 2);
  assert.equal(pack.summary.signoffs, 4);
  assert.equal(verifyAcceptancePack(pack).ok, true);
  assert.equal(verifyAuditChain(batch).ok, true);
  assert.match(pack.manifestSha256, /^[a-f0-9]{64}$/);

  const tampered = structuredClone(pack);
  tampered.requirements[0].artifact.objectVersion = "tampered-version";
  assert.equal(verifyAcceptancePack(tampered).ok, false);
  const auditTampered = structuredClone(batch);
  auditTampered.auditEvents[1].detail.objectVersion = "tampered-version";
  assert.equal(verifyAuditChain(auditTampered).ok, false);
  assert.throws(() => register(batch, "site-01", "v99"), /not open/);

  const center = buildPilotEvidenceRepositoryCenter([batch]);
  assert.equal(center.summary.frozenBatches, 1);
  assert.equal(center.summary.verifiedRequirements, 20);
  assert.equal(center.batches[0].manifestSha256, pack.manifestSha256);
});

test("pilot evidence readiness exercises controls and writes release artifacts", (t) => {
  const outputDir = path.join(ROOT, "tmp", "pilot-evidence-repository-test");
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
  const report = buildPilotEvidenceRepositoryReadiness();
  const markdown = renderMarkdown(report);
  assert.equal(report.ok, true);
  assert.equal(report.productionReady, false);
  assert.equal(report.summary.requiredItems, 20);
  assert.equal(report.summary.verifiedItems, 20);
  assert.equal(report.exercisedPack.verification.ok, true);
  assert.match(markdown, /Four-party signoffs/);
  assert.match(markdown, /Production blockers/);

  writeOutput(report, {
    output: path.join("tmp", "pilot-evidence-repository-test", "readiness.json"),
    markdown: path.join("tmp", "pilot-evidence-repository-test", "readiness.md")
  });
  const written = JSON.parse(fs.readFileSync(path.join(outputDir, "readiness.json"), "utf8"));
  assert.equal(written.exercisedPack.verification.ok, true);
  assert.match(fs.readFileSync(path.join(outputDir, "readiness.md"), "utf8"), /freeze-and-verify/);
});

test("pilot evidence readiness CLI parser keeps output flags", () => {
  assert.deepEqual(parseArgs([
    "--output=release/pilot-evidence.json",
    "--markdown=release/pilot-evidence.md",
    "--write=false"
  ]), {
    output: "release/pilot-evidence.json",
    markdown: "release/pilot-evidence.md",
    write: "false"
  });
});
