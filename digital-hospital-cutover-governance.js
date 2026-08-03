const { randomUUID } = require("node:crypto");

const { getExecutionRuntimeSummary, sha256 } = require("./digital-hospital-integration-execution");

const CUTOVER_EVIDENCE_REQUIREMENTS = Object.freeze([
  { id: "managed-vault-attestation", name: "托管保险库取钥证明", ownerRole: "security-owner", siteRequired: false },
  { id: "signed-callback-receipt", name: "签名回调与mTLS回执", ownerRole: "security-owner", siteRequired: true },
  { id: "joint-test-success", name: "联调成功场景", ownerRole: "integration-owner", siteRequired: true },
  { id: "joint-test-failure", name: "联调失败场景", ownerRole: "integration-owner", siteRequired: true },
  { id: "joint-test-retry", name: "重试与幂等场景", ownerRole: "integration-owner", siteRequired: true },
  { id: "joint-test-reconciliation", name: "对账补偿场景", ownerRole: "integration-owner", siteRequired: true },
  { id: "duty-roster", name: "切换值守表", ownerRole: "operations-owner", siteRequired: true },
  { id: "rollback-rehearsal", name: "回滚演练记录", ownerRole: "operations-owner", siteRequired: true },
  { id: "change-ticket", name: "生产变更单", ownerRole: "operations-owner", siteRequired: true },
  { id: "hospital-signoff", name: "试点医院现场签字", ownerRole: "hospital-owner", siteRequired: true }
]);

const REQUIRED_APPROVAL_ROLES = Object.freeze([
  "integration-owner",
  "security-owner",
  "operations-owner",
  "hospital-owner"
]);

function cutoverError(message, code, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function clean(value, maxLength = 500) {
  return String(value ?? "").trim().replace(/[\r\n]/g, " ").slice(0, maxLength);
}

function packById(state, packId) {
  const pack = state?.cutoverEvidencePacks?.find((item) => item.id === packId);
  if (!pack) throw cutoverError("cutover evidence pack was not found", "CUTOVER_EVIDENCE_PACK_NOT_FOUND", 404);
  return pack;
}

function recordCutoverEvent(state, input) {
  const event = {
    id: `CUT-EVENT-${randomUUID()}`,
    packId: clean(input.packId, 160),
    windowId: clean(input.windowId, 160),
    type: clean(input.type, 80),
    actor: clean(input.actor, 160),
    role: clean(input.role, 80),
    status: clean(input.status, 80),
    detail: clean(input.detail, 500),
    occurredAt: clean(input.now || new Date().toISOString(), 80)
  };
  state.cutoverEvents.unshift(event);
  state.cutoverEvents = state.cutoverEvents.slice(0, 2000);
  return event;
}

function createCutoverEvidencePack(state, input = {}) {
  const windowId = clean(input.windowId, 160);
  const window = state?.cutoverWindows?.find((item) => item.id === windowId);
  if (!window) throw cutoverError("cutover window was not found", "CUTOVER_NOT_FOUND", 404);
  if (state.cutoverEvidencePacks.some((item) => item.windowId === windowId && !["rolled-back", "closed"].includes(item.status))) {
    throw cutoverError("an active evidence pack already exists for the cutover window", "CUTOVER_EVIDENCE_PACK_CONFLICT", 409);
  }
  const now = clean(input.now || new Date().toISOString(), 80);
  const pack = {
    id: clean(input.id, 160) || `CUT-PACK-${randomUUID()}`,
    windowId,
    environmentId: window.environmentId,
    connectorIds: clone(window.connectorIds || []),
    institutionId: clean(input.institutionId, 160),
    institutionName: clean(input.institutionName, 200),
    releaseVersion: clean(input.releaseVersion, 80),
    status: "collecting",
    decision: "NO-GO",
    evidence: [],
    checks: {},
    createdBy: clean(input.createdBy, 160),
    createdAt: now,
    evaluatedAt: "",
    startedAt: "",
    completedAt: "",
    rolledBackAt: "",
    rollbackReason: ""
  };
  state.cutoverEvidencePacks.unshift(pack);
  recordCutoverEvent(state, {
    packId: pack.id,
    windowId,
    type: "pack-created",
    actor: pack.createdBy,
    role: clean(input.role, 80),
    status: pack.status,
    detail: `${pack.institutionId}:${pack.releaseVersion}`,
    now
  });
  return clone(pack);
}

function recordCutoverEvidence(state, packId, input = {}) {
  const pack = packById(state, packId);
  if (!["collecting", "blocked"].includes(pack.status)) {
    throw cutoverError("cutover evidence cannot be changed in the current state", "CUTOVER_EVIDENCE_STATE_INVALID", 409);
  }
  const requirementId = clean(input.requirementId, 160);
  if (!CUTOVER_EVIDENCE_REQUIREMENTS.some((item) => item.id === requirementId)) {
    throw cutoverError("cutover evidence requirement is unsupported", "CUTOVER_EVIDENCE_REQUIREMENT_INVALID");
  }
  const artifactDigest = clean(input.artifactDigest, 80).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(artifactDigest)) {
    throw cutoverError("artifactDigest must be SHA-256", "CUTOVER_EVIDENCE_DIGEST_INVALID");
  }
  const submittedBy = clean(input.submittedBy, 160);
  const artifactName = clean(input.artifactName, 240);
  const sourceSystem = clean(input.sourceSystem, 160);
  if (!submittedBy || !artifactName || !sourceSystem) {
    throw cutoverError("artifact name, source system and submitter are required", "CUTOVER_EVIDENCE_INPUT_REQUIRED");
  }
  if (["payload", "rawPayload", "content", "base64", "secret", "signature", "nonce"].some(
    (field) => Object.prototype.hasOwnProperty.call(input, field)
  )) {
    throw cutoverError("raw evidence content and security material cannot be persisted", "CUTOVER_EVIDENCE_RAW_CONTENT_FORBIDDEN");
  }
  const now = clean(input.now || new Date().toISOString(), 80);
  let evidence = pack.evidence.find((item) => item.requirementId === requirementId);
  if (!evidence) {
    evidence = { id: `CUT-EVD-${randomUUID()}`, requirementId };
    pack.evidence.push(evidence);
  }
  Object.assign(evidence, {
    artifactName,
    artifactDigest,
    sourceSystem,
    submittedBy,
    submittedAt: now,
    status: "recorded",
    verifiedBy: "",
    verifiedAt: "",
    verificationNote: "",
    signatureDigest: clean(input.signatureDigest, 80).toLowerCase()
  });
  pack.status = "collecting";
  recordCutoverEvent(state, {
    packId,
    windowId: pack.windowId,
    type: "evidence-recorded",
    actor: submittedBy,
    role: clean(input.role, 80),
    status: evidence.status,
    detail: requirementId,
    now
  });
  return clone(evidence);
}

function verifyCutoverEvidence(state, packId, evidenceId, input = {}) {
  const pack = packById(state, packId);
  const evidence = pack.evidence.find((item) => item.id === evidenceId);
  if (!evidence) throw cutoverError("cutover evidence was not found", "CUTOVER_EVIDENCE_NOT_FOUND", 404);
  const verifiedBy = clean(input.verifiedBy, 160);
  const verificationNote = clean(input.verificationNote, 500);
  if (!verifiedBy || verifiedBy === evidence.submittedBy || verificationNote.length < 8) {
    throw cutoverError(
      "cutover evidence requires an independent verifier and review note",
      "CUTOVER_EVIDENCE_INDEPENDENT_REVIEW_REQUIRED"
    );
  }
  const now = clean(input.now || new Date().toISOString(), 80);
  evidence.status = input.accepted === false ? "rejected" : "verified";
  evidence.verifiedBy = verifiedBy;
  evidence.verifiedAt = now;
  evidence.verificationNote = verificationNote;
  recordCutoverEvent(state, {
    packId,
    windowId: pack.windowId,
    type: "evidence-verified",
    actor: verifiedBy,
    role: clean(input.role, 80),
    status: evidence.status,
    detail: evidence.requirementId,
    now
  });
  return clone(evidence);
}

function approveCutover(state, packId, input = {}) {
  const pack = packById(state, packId);
  const role = clean(input.role, 80);
  const approver = clean(input.approver, 160);
  const decision = clean(input.decision || "approve", 40).toLowerCase();
  if (!REQUIRED_APPROVAL_ROLES.includes(role)) {
    throw cutoverError("cutover approval role is unsupported", "CUTOVER_APPROVAL_ROLE_INVALID");
  }
  if (!approver || !["approve", "reject"].includes(decision)) {
    throw cutoverError("cutover approver and decision are required", "CUTOVER_APPROVAL_INPUT_REQUIRED");
  }
  const evidenceSubmitters = new Set(pack.evidence.map((item) => item.submittedBy));
  if (evidenceSubmitters.has(approver)) {
    throw cutoverError("cutover approver must be independent from evidence submitters", "CUTOVER_APPROVAL_INDEPENDENCE_REQUIRED");
  }
  if (state.cutoverApprovals.some((item) => item.packId === packId && (item.role === role || item.approver === approver))) {
    throw cutoverError("cutover approval role and approver must be unique", "CUTOVER_APPROVAL_CONFLICT", 409);
  }
  const now = clean(input.now || new Date().toISOString(), 80);
  const approval = {
    id: `CUT-APP-${randomUUID()}`,
    packId,
    role,
    approver,
    decision,
    note: clean(input.note, 500),
    approvalDigest: sha256(`${packId}:${role}:${approver}:${decision}:${now}`),
    approvedAt: now
  };
  state.cutoverApprovals.unshift(approval);
  recordCutoverEvent(state, {
    packId,
    windowId: pack.windowId,
    type: "approval-recorded",
    actor: approver,
    role,
    status: decision,
    detail: approval.approvalDigest,
    now
  });
  return clone(approval);
}

function evaluateProductionCutover(state, packId, context = {}) {
  const pack = packById(state, packId);
  const runtime = getExecutionRuntimeSummary(state, context.now || new Date().toISOString());
  const verifiedRequirements = new Set(
    pack.evidence.filter((item) => item.status === "verified").map((item) => item.requirementId)
  );
  const approvals = state.cutoverApprovals.filter((item) => item.packId === packId);
  const approvedRoles = new Set(approvals.filter((item) => item.decision === "approve").map((item) => item.role));
  const rejected = approvals.some((item) => item.decision === "reject");
  const window = state.cutoverWindows.find((item) => item.id === pack.windowId);
  const checks = {
    evidenceComplete: CUTOVER_EVIDENCE_REQUIREMENTS.every((item) => verifiedRequirements.has(item.id)),
    independentEvidenceReview: pack.evidence.length >= CUTOVER_EVIDENCE_REQUIREMENTS.length
      && pack.evidence.every((item) => item.status === "verified" && item.submittedBy !== item.verifiedBy),
    approvalsComplete: !rejected && REQUIRED_APPROVAL_ROLES.every((role) => approvedRoles.has(role)),
    executionDrained: runtime.runningJobs === 0 && runtime.awaitingReceiptJobs === 0 && runtime.retryScheduledJobs === 0,
    noDeadLetters: runtime.openDeadLetters === 0,
    noQuarantines: state.quarantines.every((item) => item.status !== "active"),
    securityAdapterReady: context.security?.productionReady === true,
    persistentRuntimeReady: context.repository?.durableLeases === true && context.repository?.atomicClaims === true,
    cutoverWindowReady: window?.status === "ready"
  };
  pack.checks = checks;
  pack.evaluatedAt = clean(context.now || new Date().toISOString(), 80);
  pack.decision = Object.values(checks).every(Boolean) ? "GO" : "NO-GO";
  pack.status = pack.decision === "GO" ? "ready" : "blocked";
  recordCutoverEvent(state, {
    packId,
    windowId: pack.windowId,
    type: "go-no-go-evaluated",
    actor: clean(context.actor || "system", 160),
    role: clean(context.role || "governance", 80),
    status: pack.decision,
    detail: Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name).join(",") || "all-checks-passed",
    now: pack.evaluatedAt
  });
  return {
    pack: clone(pack),
    checks: clone(checks),
    runtime,
    evidence: {
      required: CUTOVER_EVIDENCE_REQUIREMENTS.length,
      verified: verifiedRequirements.size
    },
    approvals: {
      required: REQUIRED_APPROVAL_ROLES.length,
      approved: approvedRoles.size,
      rejected
    }
  };
}

function startProductionCutover(state, packId, input = {}) {
  const pack = packById(state, packId);
  if (pack.status !== "ready" || pack.decision !== "GO") {
    throw cutoverError("production cutover requires a current GO decision", "CUTOVER_GO_DECISION_REQUIRED", 409);
  }
  const now = clean(input.now || new Date().toISOString(), 80);
  pack.status = "running";
  pack.startedAt = now;
  recordCutoverEvent(state, {
    packId,
    windowId: pack.windowId,
    type: "cutover-started",
    actor: clean(input.actor, 160),
    role: clean(input.role, 80),
    status: pack.status,
    detail: clean(input.changeTicket, 160),
    now
  });
  return clone(pack);
}

function completeProductionCutover(state, packId, input = {}) {
  const pack = packById(state, packId);
  if (pack.status !== "running") throw cutoverError("cutover is not running", "CUTOVER_NOT_RUNNING", 409);
  const now = clean(input.now || new Date().toISOString(), 80);
  pack.status = "completed";
  pack.completedAt = now;
  recordCutoverEvent(state, {
    packId,
    windowId: pack.windowId,
    type: "cutover-completed",
    actor: clean(input.actor, 160),
    role: clean(input.role, 80),
    status: pack.status,
    detail: clean(input.receiptDigest, 80),
    now
  });
  return clone(pack);
}

function rollbackProductionCutover(state, packId, input = {}) {
  const pack = packById(state, packId);
  if (!["running", "completed"].includes(pack.status)) {
    throw cutoverError("only running or completed cutovers can be rolled back", "CUTOVER_ROLLBACK_STATE_INVALID", 409);
  }
  const reason = clean(input.reason, 500);
  if (reason.length < 8) throw cutoverError("rollback reason is required", "CUTOVER_ROLLBACK_REASON_REQUIRED");
  const now = clean(input.now || new Date().toISOString(), 80);
  pack.status = "rolled-back";
  pack.decision = "NO-GO";
  pack.rolledBackAt = now;
  pack.rollbackReason = reason;
  recordCutoverEvent(state, {
    packId,
    windowId: pack.windowId,
    type: "cutover-rolled-back",
    actor: clean(input.actor, 160),
    role: clean(input.role, 80),
    status: pack.status,
    detail: reason,
    now
  });
  return clone(pack);
}

function buildCutoverGovernanceBoard(state) {
  return {
    requirements: clone(CUTOVER_EVIDENCE_REQUIREMENTS),
    approvalRoles: clone(REQUIRED_APPROVAL_ROLES),
    packs: clone(state.cutoverEvidencePacks),
    approvals: clone(state.cutoverApprovals),
    events: clone(state.cutoverEvents.slice(0, 200)),
    summary: {
      packs: state.cutoverEvidencePacks.length,
      ready: state.cutoverEvidencePacks.filter((item) => item.status === "ready").length,
      running: state.cutoverEvidencePacks.filter((item) => item.status === "running").length,
      completed: state.cutoverEvidencePacks.filter((item) => item.status === "completed").length,
      blocked: state.cutoverEvidencePacks.filter((item) => item.status === "blocked").length,
      approvals: state.cutoverApprovals.length
    }
  };
}

module.exports = {
  CUTOVER_EVIDENCE_REQUIREMENTS,
  REQUIRED_APPROVAL_ROLES,
  approveCutover,
  buildCutoverGovernanceBoard,
  completeProductionCutover,
  createCutoverEvidencePack,
  cutoverError,
  evaluateProductionCutover,
  recordCutoverEvidence,
  rollbackProductionCutover,
  startProductionCutover,
  verifyCutoverEvidence
};
