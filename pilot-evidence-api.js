const {
  buildPilotEvidenceRepositoryCenter,
  createPilotEvidenceBatch,
  freezeAcceptancePack,
  recordEvidenceAccess,
  registerEvidenceArtifact,
  reviewEvidenceArtifact,
  verifyAcceptancePack
} = require("./pilot-evidence-repository");
const { createObjectDownloadIntent } = require("./secure-object-storage");

class PilotEvidenceApiError extends Error {
  constructor(message, status = 400, code = "PILOT_EVIDENCE_INVALID") {
    super(message);
    this.name = "PilotEvidenceApiError";
    this.status = status;
    this.code = code;
  }
}

function normalizeState(data = {}) {
  return {
    pilotEvidenceBatches: Array.isArray(data.pilotEvidenceBatches)
      ? data.pilotEvidenceBatches.filter((item) => item && item.id).slice(0, 100)
      : []
  };
}

function actorContext(user, now) {
  return {
    actor: {
      id: String(user.username || user.accountId || user.name || user.role),
      name: String(user.name || user.username || user.role),
      role: String(user.role || "")
    },
    ...(now ? { now } : {})
  };
}

function canAccessBatch(user, batch) {
  if (user?.role === "commission") return true;
  if (user?.role !== "institution") return false;
  const userOrg = String(user.orgCode || "").trim().toLowerCase();
  const batchOrg = String(batch.organizationCode || "").trim().toLowerCase();
  if (userOrg && batchOrg) return userOrg === batchOrg;
  return String(batch.createdBy || "") === String(user.username || user.accountId || "");
}

function scopedBatches(data, user) {
  return normalizeState(data).pilotEvidenceBatches.filter((item) => canAccessBatch(user, item));
}

function findBatch(data, user, batchId) {
  const batch = normalizeState(data).pilotEvidenceBatches.find((item) => item.id === batchId);
  if (!batch) throw new PilotEvidenceApiError("pilot evidence batch was not found", 404, "PILOT_EVIDENCE_BATCH_NOT_FOUND");
  if (!canAccessBatch(user, batch)) throw new PilotEvidenceApiError("pilot evidence batch scope is forbidden", 403, "PILOT_EVIDENCE_SCOPE_FORBIDDEN");
  return batch;
}

function assertRevision(batch, value) {
  const expectedRevision = Number(value);
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
    throw new PilotEvidenceApiError("expectedRevision is required", 400, "PILOT_EVIDENCE_REVISION_REQUIRED");
  }
  if (expectedRevision !== batch.revision) {
    throw new PilotEvidenceApiError(
      `pilot evidence batch revision changed from ${expectedRevision} to ${batch.revision}`,
      409,
      "PILOT_EVIDENCE_REVISION_CONFLICT"
    );
  }
}

function canAccessAttachment(user, attachment) {
  if (user?.role === "commission") return true;
  const userOrg = String(user?.orgCode || "").trim().toLowerCase();
  const attachmentOrg = String(attachment?.createdByOrgCode || "").trim().toLowerCase();
  if (userOrg && attachmentOrg) return userOrg === attachmentOrg;
  return String(attachment?.createdBy || "") === String(user?.username || user?.accountId || "");
}

function completedEvidenceAttachment(data, user, batch, attachmentId) {
  const attachment = (Array.isArray(data.secureAttachments) ? data.secureAttachments : [])
    .find((item) => item.id === attachmentId);
  if (!attachment) throw new PilotEvidenceApiError("secure evidence attachment was not found", 404, "PILOT_EVIDENCE_ATTACHMENT_NOT_FOUND");
  if (!canAccessAttachment(user, attachment) || !canAccessBatch(user, batch)) {
    throw new PilotEvidenceApiError("secure evidence attachment scope is forbidden", 403, "PILOT_EVIDENCE_ATTACHMENT_SCOPE_FORBIDDEN");
  }
  if (attachment.status !== "active" || attachment.scanStatus !== "clean") {
    throw new PilotEvidenceApiError("secure evidence attachment is not active and clean", 409, "PILOT_EVIDENCE_ATTACHMENT_NOT_READY");
  }
  if (attachment.classification !== "evidence"
    || attachment.retentionPolicy !== "audit-evidence"
    || attachment.immutable !== true
    || !attachment.objectVersion
    || !/^[a-f0-9]{64}$/.test(String(attachment.checksumSha256 || ""))) {
    throw new PilotEvidenceApiError("secure evidence attachment violates evidence storage controls", 409, "PILOT_EVIDENCE_ATTACHMENT_CONTROL_FAILED");
  }
  if (attachment.sourceCollection === "pilotEvidenceBatches" && attachment.sourceId && attachment.sourceId !== batch.id) {
    throw new PilotEvidenceApiError("secure evidence attachment is already linked to another batch", 409, "PILOT_EVIDENCE_ATTACHMENT_ALREADY_LINKED");
  }
  return attachment;
}

function apiCenter(data, user) {
  const batches = scopedBatches(data, user);
  return {
    ok: true,
    productionReady: false,
    ...buildPilotEvidenceRepositoryCenter(batches),
    capabilities: {
      persistentBatches: true,
      secureAttachmentLink: true,
      optimisticRevision: true,
      independentReview: true,
      accessAudit: true,
      frozenAcceptancePack: true
    },
    blockers: [
      "real object-storage and WORM acceptance",
      "production malware-engine acceptance",
      "pilot hospital evidence and four-party signoff originals"
    ]
  };
}

function domainError(error) {
  if (error instanceof PilotEvidenceApiError) return error;
  const message = String(error?.message || "pilot evidence operation failed");
  const conflict = /not open|already|unverified|active .* version|reviewed|audit chain|storage controls/i.test(message);
  return new PilotEvidenceApiError(
    message,
    conflict ? 409 : 400,
    conflict ? "PILOT_EVIDENCE_CONFLICT" : "PILOT_EVIDENCE_INVALID"
  );
}

function sendError(sendJson, res, error) {
  const normalized = domainError(error);
  sendJson(res, normalized.status, {
    ok: false,
    error: normalized.code,
    message: normalized.message
  });
}

async function handlePilotEvidenceApi(req, res, dependencies) {
  const {
    url,
    requireApiRole,
    readDatabase,
    writeDatabase,
    collectJson,
    sendJson,
    sendDownload
  } = dependencies;
  if (!url.pathname.startsWith("/api/pilot-evidence")) return false;

  const user = requireApiRole(req, res, ["commission", "institution"], "/api/pilot-evidence");
  if (!user) return true;

  try {
    if (req.method === "GET" && url.pathname === "/api/pilot-evidence") {
      sendJson(res, 200, apiCenter(readDatabase(), user));
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/pilot-evidence/batches") {
      const payload = await collectJson(req);
      const data = readDatabase();
      const batch = createPilotEvidenceBatch({
        pilotId: payload.pilotId,
        hospitalName: payload.hospitalName,
        organizationCode: user.orgCode || "",
        title: payload.title
      }, actorContext(user));
      data.pilotEvidenceBatches = [batch, ...normalizeState(data).pilotEvidenceBatches].slice(0, 100);
      writeDatabase(data);
      sendJson(res, 201, { ok: true, batch, center: apiCenter(data, user) });
      return true;
    }

    const packMatch = url.pathname.match(/^\/api\/pilot-evidence\/batches\/([^/]+)\/acceptance-pack$/);
    if (req.method === "GET" && packMatch) {
      const data = readDatabase();
      const batch = findBatch(data, user, decodeURIComponent(packMatch[1]));
      if (batch.status !== "frozen" || !batch.acceptancePack) {
        throw new PilotEvidenceApiError("pilot evidence acceptance pack is not frozen", 409, "PILOT_EVIDENCE_PACK_NOT_FROZEN");
      }
      const verification = verifyAcceptancePack(batch.acceptancePack);
      if (!verification.ok) {
        throw new PilotEvidenceApiError("pilot evidence acceptance pack verification failed", 409, "PILOT_EVIDENCE_PACK_TAMPERED");
      }
      if (url.searchParams.get("download") === "1") {
        sendDownload(
          res,
          200,
          JSON.stringify(batch.acceptancePack, null, 2),
          "application/json; charset=utf-8",
          `pilot-evidence-${batch.id}.json`
        );
      } else {
        sendJson(res, 200, { ok: true, acceptancePack: batch.acceptancePack, verification });
      }
      return true;
    }

    const batchMatch = url.pathname.match(/^\/api\/pilot-evidence\/batches\/([^/]+)$/);
    if (req.method === "GET" && batchMatch) {
      const data = readDatabase();
      const batch = findBatch(data, user, decodeURIComponent(batchMatch[1]));
      sendJson(res, 200, { ok: true, batch, verification: batch.acceptancePack ? verifyAcceptancePack(batch.acceptancePack) : null });
      return true;
    }

    const artifactRegisterMatch = url.pathname.match(/^\/api\/pilot-evidence\/batches\/([^/]+)\/artifacts$/);
    if (req.method === "POST" && artifactRegisterMatch) {
      const payload = await collectJson(req);
      const data = readDatabase();
      const batch = findBatch(data, user, decodeURIComponent(artifactRegisterMatch[1]));
      assertRevision(batch, payload.expectedRevision);
      const attachmentId = String(payload.attachmentId || "").trim();
      const attachment = completedEvidenceAttachment(data, user, batch, attachmentId);
      const artifact = registerEvidenceArtifact(batch, {
        requirementId: payload.requirementId,
        attachmentId,
        filename: attachment.filename,
        contentType: attachment.contentType,
        sizeBytes: attachment.sizeBytes,
        checksumSha256: attachment.checksumSha256,
        classification: attachment.classification,
        retentionPolicy: attachment.retentionPolicy,
        scanStatus: attachment.scanStatus,
        scannedAt: attachment.scannedAt,
        objectKey: attachment.objectKey,
        objectVersion: attachment.objectVersion
      }, actorContext(user));
      attachment.sourceCollection = "pilotEvidenceBatches";
      attachment.sourceId = batch.id;
      attachment.pilotEvidenceRequirementId = artifact.requirementId;
      attachment.pilotEvidenceArtifactId = artifact.id;
      writeDatabase(data);
      sendJson(res, 201, { ok: true, artifact, batch });
      return true;
    }

    const reviewMatch = url.pathname.match(/^\/api\/pilot-evidence\/batches\/([^/]+)\/artifacts\/([^/]+)\/review$/);
    if (req.method === "POST" && reviewMatch) {
      if (user.role !== "commission") {
        throw new PilotEvidenceApiError("only commission reviewers can verify pilot evidence", 403, "PILOT_EVIDENCE_REVIEW_FORBIDDEN");
      }
      const payload = await collectJson(req);
      const data = readDatabase();
      const batch = findBatch(data, user, decodeURIComponent(reviewMatch[1]));
      assertRevision(batch, payload.expectedRevision);
      const artifact = reviewEvidenceArtifact(batch, {
        artifactId: decodeURIComponent(reviewMatch[2]),
        outcome: payload.outcome,
        evidenceDigest: payload.evidenceDigest,
        note: payload.note
      }, actorContext(user));
      writeDatabase(data);
      sendJson(res, 200, { ok: true, artifact, batch });
      return true;
    }

    const accessMatch = url.pathname.match(/^\/api\/pilot-evidence\/batches\/([^/]+)\/artifacts\/([^/]+)\/access$/);
    if (req.method === "POST" && accessMatch) {
      const payload = await collectJson(req);
      const data = readDatabase();
      const batch = findBatch(data, user, decodeURIComponent(accessMatch[1]));
      assertRevision(batch, payload.expectedRevision);
      const event = recordEvidenceAccess(batch, {
        artifactId: decodeURIComponent(accessMatch[2]),
        purpose: payload.purpose,
        outcome: "allowed"
      }, actorContext(user));
      writeDatabase(data);
      sendJson(res, 200, { ok: true, accessAudit: event, batch });
      return true;
    }

    const downloadMatch = url.pathname.match(/^\/api\/pilot-evidence\/batches\/([^/]+)\/artifacts\/([^/]+)\/download-intent$/);
    if (req.method === "POST" && downloadMatch) {
      const payload = await collectJson(req);
      const data = readDatabase();
      const batch = findBatch(data, user, decodeURIComponent(downloadMatch[1]));
      assertRevision(batch, payload.expectedRevision);
      const artifact = (batch.artifacts || []).find((item) => item.id === decodeURIComponent(downloadMatch[2]));
      if (!artifact) throw new PilotEvidenceApiError("pilot evidence artifact was not found", 404, "PILOT_EVIDENCE_ARTIFACT_NOT_FOUND");
      const attachment = completedEvidenceAttachment(data, user, batch, artifact.attachmentId);
      const downloadIntent = await createObjectDownloadIntent({
        attachmentId: attachment.id,
        objectKey: attachment.objectKey,
        objectVersion: attachment.objectVersion
      });
      recordEvidenceAccess(batch, {
        artifactId: artifact.id,
        purpose: payload.purpose || "pilot evidence review",
        outcome: "allowed"
      }, actorContext(user));
      writeDatabase(data);
      sendJson(res, 200, {
        ok: true,
        batchRevision: batch.revision,
        attachmentId: attachment.id,
        filename: attachment.filename,
        downloadIntent
      });
      return true;
    }

    const freezeMatch = url.pathname.match(/^\/api\/pilot-evidence\/batches\/([^/]+)\/freeze$/);
    if (req.method === "POST" && freezeMatch) {
      if (user.role !== "commission") {
        throw new PilotEvidenceApiError("only commission release managers can freeze pilot evidence", 403, "PILOT_EVIDENCE_FREEZE_FORBIDDEN");
      }
      const payload = await collectJson(req);
      const data = readDatabase();
      const batch = findBatch(data, user, decodeURIComponent(freezeMatch[1]));
      assertRevision(batch, payload.expectedRevision);
      const acceptancePack = freezeAcceptancePack(batch, actorContext(user));
      writeDatabase(data);
      sendJson(res, 200, {
        ok: true,
        batch,
        acceptancePack,
        verification: verifyAcceptancePack(acceptancePack)
      });
      return true;
    }

    sendJson(res, 404, { ok: false, error: "PILOT_EVIDENCE_ROUTE_NOT_FOUND", message: "pilot evidence route was not found" });
    return true;
  } catch (error) {
    sendError(sendJson, res, error);
    return true;
  }
}

module.exports = {
  PilotEvidenceApiError,
  apiCenter,
  canAccessBatch,
  completedEvidenceAttachment,
  handlePilotEvidenceApi,
  normalizeState
};
