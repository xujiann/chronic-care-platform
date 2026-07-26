const { createHash, randomUUID } = require("node:crypto");

const {
  stableStringify,
  validateAttachmentMetadata
} = require("./secure-object-storage");

const REVIEWER_ROLES = new Set(["auditor", "commission", "expert", "release-manager", "security-admin"]);
const FREEZER_ROLES = new Set(["commission", "release-manager"]);

const REQUIREMENT_TEMPLATES = Object.freeze([
  ...[
    ["site-01", "Production database and backup restore"],
    ["site-02", "Unified identity source and minimum privileges"],
    ["site-03", "SMS, notification and mobile release"],
    ["site-04", "Hospital interface network and credentials"],
    ["site-05", "Insurance and electronic certificate connectivity"],
    ["site-06", "Classified protection, crypto and penetration remediation"],
    ["site-07", "Audit retention and SIEM verification"],
    ["site-08", "Monitoring, alerting and on-call escalation"],
    ["site-09", "Disaster recovery and rollback rehearsal"],
    ["site-10", "Cutover checklist and production smoke test"]
  ].map(([id, title]) => ({ id, group: "site-task", title })),
  ...[
    ["interface-his", "HIS joint-test receipt"],
    ["interface-emr", "EMR joint-test receipt"],
    ["interface-lis", "LIS joint-test receipt"],
    ["interface-pacs", "PACS joint-test receipt"]
  ].map(([id, title]) => ({ id, group: "interface-receipt", title })),
  ...[
    ["alert-primary", "Primary alert route delivery and acknowledgement"],
    ["alert-escalation", "Escalation route delivery and acknowledgement"]
  ].map(([id, title]) => ({ id, group: "alert-route", title })),
  ...[
    ["signoff-commission", "Health commission release signoff"],
    ["signoff-hospital", "Pilot hospital release signoff"],
    ["signoff-vendor", "Platform vendor release signoff"],
    ["signoff-operations", "Operations provider release signoff"]
  ].map(([id, title]) => ({ id, group: "four-party-signoff", title }))
]);

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function timestamp(context = {}) {
  const value = context.now || new Date().toISOString();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error("audit timestamp is invalid");
  return parsed.toISOString();
}

function actorOf(context = {}) {
  const source = context.actor || context.user || context;
  const id = String(source.id || source.userId || source.username || "").trim();
  const name = String(source.name || source.displayName || id).trim();
  const role = String(source.role || "").trim().toLowerCase();
  if (!id || !role) throw new Error("actor id and role are required");
  return { id, name, role };
}

function assertOpen(batch) {
  if (!batch || batch.status !== "open") throw new Error("pilot evidence batch is not open");
}

function appendAuditEvent(batch, action, target, actor, detail, at) {
  const events = Array.isArray(batch.auditEvents) ? batch.auditEvents : (batch.auditEvents = []);
  const previousHash = events.at(-1)?.chainHash || "GENESIS";
  const event = {
    id: randomUUID(),
    sequence: events.length + 1,
    action,
    target,
    actorId: actor.id,
    actorRole: actor.role,
    at,
    detail: detail || {}
  };
  event.previousHash = previousHash;
  event.chainHash = sha256(`${previousHash}\n${stableStringify(event)}`);
  events.push(event);
  return event;
}

function verifyAuditChain(batch) {
  const events = Array.isArray(batch?.auditEvents) ? batch.auditEvents : [];
  let previousHash = "GENESIS";
  for (const event of events) {
    const { chainHash, ...payload } = event;
    const actual = sha256(`${previousHash}\n${stableStringify(payload)}`);
    if (event.previousHash !== previousHash || chainHash !== actual) {
      return {
        ok: false,
        failedSequence: event.sequence,
        expected: actual,
        actual: chainHash || ""
      };
    }
    previousHash = chainHash;
  }
  return {
    ok: true,
    events: events.length,
    tailHash: previousHash === "GENESIS" ? "" : previousHash
  };
}

function requirementById(batch, requirementId) {
  const requirement = (batch.requirements || []).find((item) => item.id === requirementId);
  if (!requirement) throw new Error(`pilot evidence requirement was not found: ${requirementId}`);
  return requirement;
}

function artifactById(batch, artifactId) {
  const artifact = (batch.artifacts || []).find((item) => item.id === artifactId);
  if (!artifact) throw new Error(`pilot evidence artifact was not found: ${artifactId}`);
  return artifact;
}

function createPilotEvidenceBatch(input = {}, context = {}) {
  const actor = actorOf(context);
  const createdAt = timestamp(context);
  const pilotId = String(input.pilotId || "").trim();
  const hospitalName = String(input.hospitalName || "").trim();
  if (!pilotId || !hospitalName) throw new Error("pilot id and hospital name are required");
  const batch = {
    schemaVersion: 1,
    id: String(input.id || randomUUID()),
    pilotId,
    hospitalName,
    organizationCode: String(input.organizationCode || "").trim(),
    title: String(input.title || `${hospitalName} pilot acceptance evidence`).trim(),
    status: "open",
    revision: 1,
    createdAt,
    createdBy: actor.id,
    requirements: REQUIREMENT_TEMPLATES.map((item) => ({
      ...item,
      required: true,
      status: "pending",
      activeArtifactId: "",
      artifactVersions: 0
    })),
    artifacts: [],
    auditEvents: [],
    acceptancePack: null
  };
  appendAuditEvent(batch, "batch-created", batch.id, actor, {
    pilotId,
    hospitalName,
    requirementCount: batch.requirements.length
  }, createdAt);
  return batch;
}

function registerEvidenceArtifact(batch, input = {}, context = {}) {
  assertOpen(batch);
  const actor = actorOf(context);
  const submittedAt = timestamp(context);
  const requirement = requirementById(batch, String(input.requirementId || "").trim());
  const metadata = validateAttachmentMetadata({
    filename: input.filename,
    contentType: input.contentType,
    sizeBytes: input.sizeBytes,
    checksumSha256: input.checksumSha256,
    classification: input.classification || "evidence",
    retentionPolicy: input.retentionPolicy || "audit-evidence"
  }, context.env || process.env);
  const scanStatus = String(input.scanStatus || "").trim().toLowerCase();
  const objectKey = String(input.objectKey || "").trim();
  const objectVersion = String(input.objectVersion || "").trim();
  if (metadata.classification !== "evidence") throw new Error("pilot evidence classification must be evidence");
  if (metadata.retentionPolicy !== "audit-evidence" || !metadata.immutable) throw new Error("pilot evidence requires immutable audit-evidence retention");
  if (scanStatus !== "clean") throw new Error("pilot evidence malware scan must pass before registration");
  if (!objectKey || !objectVersion) throw new Error("pilot evidence object key and version are required");
  const artifactId = String(input.id || randomUUID());
  if (batch.artifacts.some((item) => item.id === artifactId)) throw new Error("pilot evidence artifact id already exists");
  if (batch.artifacts.some((item) => item.objectKey === objectKey && item.objectVersion === objectVersion)) throw new Error("pilot evidence object version already exists");

  const activeArtifacts = batch.artifacts.filter((item) => item.requirementId === requirement.id && !["superseded", "void"].includes(item.status));
  activeArtifacts.forEach((item) => {
    item.status = "superseded";
    item.supersededAt = submittedAt;
    item.supersededBy = actor.id;
  });

  const version = requirement.artifactVersions + 1;
  const artifact = {
    id: artifactId,
    requirementId: requirement.id,
    version,
    status: "submitted",
    attachmentId: String(input.attachmentId || "").trim(),
    objectKey,
    objectVersion,
    filename: metadata.filename,
    contentType: metadata.contentType,
    sizeBytes: metadata.sizeBytes,
    checksumSha256: metadata.checksumSha256,
    classification: metadata.classification,
    retentionPolicy: metadata.retentionPolicy,
    retentionYears: metadata.retentionYears,
    immutable: metadata.immutable,
    scanStatus,
    scannedAt: String(input.scannedAt || submittedAt),
    submittedAt,
    submittedBy: actor.id,
    submittedByRole: actor.role,
    review: null
  };
  batch.artifacts.push(artifact);
  requirement.activeArtifactId = artifact.id;
  requirement.artifactVersions = version;
  requirement.status = "submitted";
  batch.revision += 1;
  appendAuditEvent(batch, "artifact-registered", artifact.id, actor, {
    requirementId: requirement.id,
    version,
    checksumSha256: artifact.checksumSha256,
    objectVersion
  }, submittedAt);
  return artifact;
}

function reviewEvidenceArtifact(batch, input = {}, context = {}) {
  assertOpen(batch);
  const actor = actorOf(context);
  const reviewedAt = timestamp(context);
  const artifact = artifactById(batch, String(input.artifactId || "").trim());
  const requirement = requirementById(batch, artifact.requirementId);
  const outcome = String(input.outcome || "").trim().toLowerCase();
  const evidenceDigest = String(input.evidenceDigest || "").trim().toLowerCase().replace(/^sha256:/, "");
  if (artifact.submittedBy === actor.id) throw new Error("pilot evidence requires an independent reviewer");
  if (!REVIEWER_ROLES.has(actor.role)) throw new Error("actor role cannot review pilot evidence");
  if (requirement.activeArtifactId !== artifact.id || ["superseded", "void"].includes(artifact.status)) throw new Error("only the active pilot evidence version can be reviewed");
  if (artifact.status !== "submitted") throw new Error("pilot evidence artifact has already been reviewed");
  if (!["verified", "rejected"].includes(outcome)) throw new Error("pilot evidence review outcome must be verified or rejected");
  if (evidenceDigest !== artifact.checksumSha256) throw new Error("pilot evidence review digest does not match the registered artifact");
  const note = String(input.note || "").trim();
  if (!note) throw new Error("pilot evidence review note is required");

  artifact.status = outcome;
  artifact.review = {
    outcome,
    note,
    reviewedAt,
    reviewedBy: actor.id,
    reviewedByRole: actor.role,
    evidenceDigest
  };
  requirement.status = outcome;
  batch.revision += 1;
  appendAuditEvent(batch, `artifact-${outcome}`, artifact.id, actor, {
    requirementId: requirement.id,
    evidenceDigest,
    note
  }, reviewedAt);
  return artifact;
}

function recordEvidenceAccess(batch, input = {}, context = {}) {
  const actor = actorOf(context);
  const accessedAt = timestamp(context);
  const artifact = artifactById(batch, String(input.artifactId || "").trim());
  const purpose = String(input.purpose || "").trim();
  const outcome = String(input.outcome || "allowed").trim().toLowerCase();
  if (!purpose) throw new Error("pilot evidence access purpose is required");
  if (!["allowed", "denied"].includes(outcome)) throw new Error("pilot evidence access outcome must be allowed or denied");
  batch.revision += 1;
  return appendAuditEvent(batch, "artifact-accessed", artifact.id, actor, {
    purpose,
    outcome,
    objectVersion: artifact.objectVersion
  }, accessedAt);
}

function acceptancePackPayload(batch) {
  const requirements = batch.requirements.map((requirement) => {
    const artifact = artifactById(batch, requirement.activeArtifactId);
    return {
      id: requirement.id,
      group: requirement.group,
      title: requirement.title,
      status: requirement.status,
      artifact: {
        id: artifact.id,
        attachmentId: artifact.attachmentId || "",
        version: artifact.version,
        filename: artifact.filename,
        contentType: artifact.contentType,
        sizeBytes: artifact.sizeBytes,
        checksumSha256: artifact.checksumSha256,
        objectKey: artifact.objectKey,
        objectVersion: artifact.objectVersion,
        classification: artifact.classification,
        retentionPolicy: artifact.retentionPolicy,
        retentionYears: artifact.retentionYears,
        immutable: artifact.immutable,
        scanStatus: artifact.scanStatus,
        submittedAt: artifact.submittedAt,
        submittedBy: artifact.submittedBy,
        reviewedAt: artifact.review.reviewedAt,
        reviewedBy: artifact.review.reviewedBy
      }
    };
  });
  return {
    schemaVersion: 1,
    batch: {
      id: batch.id,
      pilotId: batch.pilotId,
      hospitalName: batch.hospitalName,
      organizationCode: batch.organizationCode || "",
      title: batch.title,
      revision: batch.revision,
      frozenAt: batch.frozenAt,
      frozenBy: batch.frozenBy
    },
    summary: {
      requirements: requirements.length,
      verified: requirements.filter((item) => item.status === "verified").length,
      siteTasks: requirements.filter((item) => item.group === "site-task").length,
      interfaceReceipts: requirements.filter((item) => item.group === "interface-receipt").length,
      alertRoutes: requirements.filter((item) => item.group === "alert-route").length,
      signoffs: requirements.filter((item) => item.group === "four-party-signoff").length
    },
    requirements,
    audit: {
      events: batch.auditEvents.length,
      tailHash: batch.auditEvents.at(-1)?.chainHash || ""
    }
  };
}

function freezeAcceptancePack(batch, context = {}) {
  assertOpen(batch);
  const actor = actorOf(context);
  const frozenAt = timestamp(context);
  if (!FREEZER_ROLES.has(actor.role)) throw new Error("actor role cannot freeze pilot evidence batches");
  const incomplete = batch.requirements.filter((item) => item.status !== "verified");
  if (incomplete.length) throw new Error(`pilot evidence batch has ${incomplete.length} unverified requirements`);
  const auditVerification = verifyAuditChain(batch);
  if (!auditVerification.ok) throw new Error(`pilot evidence audit chain failed at sequence ${auditVerification.failedSequence}`);
  const invalid = batch.artifacts.filter((item) => item.status === "verified").filter((item) => (
    item.scanStatus !== "clean"
    || !item.immutable
    || item.retentionPolicy !== "audit-evidence"
    || !item.objectVersion
  ));
  if (invalid.length) throw new Error("pilot evidence batch contains artifacts that violate storage controls");

  batch.status = "frozen";
  batch.revision += 1;
  batch.frozenAt = frozenAt;
  batch.frozenBy = actor.id;
  appendAuditEvent(batch, "batch-frozen", batch.id, actor, {
    revision: batch.revision,
    requirementCount: batch.requirements.length
  }, frozenAt);
  const payload = acceptancePackPayload(batch);
  batch.acceptancePack = {
    ...payload,
    manifestSha256: sha256(stableStringify(payload))
  };
  return batch.acceptancePack;
}

function verifyAcceptancePack(pack) {
  if (!pack || typeof pack !== "object") return { ok: false, expected: "", actual: "" };
  const { manifestSha256: expected = "", ...payload } = pack;
  const actual = sha256(stableStringify(payload));
  return {
    ok: /^[a-f0-9]{64}$/.test(expected) && expected === actual,
    expected,
    actual
  };
}

function buildPilotEvidenceRepositoryCenter(batches = []) {
  const rows = Array.isArray(batches) ? batches : [];
  const requirements = rows.flatMap((batch) => batch.requirements || []);
  const artifacts = rows.flatMap((batch) => batch.artifacts || []);
  const auditEvents = rows.flatMap((batch) => batch.auditEvents || []);
  return {
    generatedAt: new Date().toISOString(),
    summary: {
      batches: rows.length,
      openBatches: rows.filter((item) => item.status === "open").length,
      frozenBatches: rows.filter((item) => item.status === "frozen").length,
      requirements: requirements.length,
      verifiedRequirements: requirements.filter((item) => item.status === "verified").length,
      artifacts: artifacts.length,
      cleanArtifacts: artifacts.filter((item) => item.scanStatus === "clean").length,
      accessAuditEvents: auditEvents.filter((item) => item.action === "artifact-accessed").length,
      validAuditChains: rows.filter((item) => verifyAuditChain(item).ok).length
    },
    batches: rows.map((batch) => ({
      id: batch.id,
      pilotId: batch.pilotId,
      hospitalName: batch.hospitalName,
      organizationCode: batch.organizationCode || "",
      status: batch.status,
      revision: batch.revision,
      verified: (batch.requirements || []).filter((item) => item.status === "verified").length,
      total: (batch.requirements || []).length,
      manifestSha256: batch.acceptancePack?.manifestSha256 || ""
    }))
  };
}

module.exports = {
  REQUIREMENT_TEMPLATES,
  buildPilotEvidenceRepositoryCenter,
  createPilotEvidenceBatch,
  freezeAcceptancePack,
  recordEvidenceAccess,
  registerEvidenceArtifact,
  reviewEvidenceArtifact,
  verifyAuditChain,
  verifyAcceptancePack
};
