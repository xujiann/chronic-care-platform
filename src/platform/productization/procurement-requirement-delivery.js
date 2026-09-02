"use strict";

const crypto = require("node:crypto");
const { buildProcurementRequirementGovernance } = require("./procurement-requirement-governance");
const { StateCommandError } = require("../storage/state-command-consistency");

const REQUIRED_EVIDENCE = Object.freeze(["implementation", "test", "review"]);
const RELEASE_WINDOWS = new Set(["current-release", "next-release", "backlog"]);
const ACTIONS = new Set([
  "plan",
  "start-delivery",
  "submit-evidence",
  "verify-evidence",
  "request-acceptance",
  "accept-delivery",
  "return-delivery",
  "resubmit-delivery"
]);
const FORBIDDEN_KEYS = /(?:path|filename|raw|excerpt|prompt|instruction|patient|resident|identity|credential|password|secret|token|note|title|name)/i;

function digest(value) {
  return `sha256:${crypto.createHash("sha256").update(String(value)).digest("hex")}`;
}

function baseState(value) {
  const state = value && typeof value === "object" && !Array.isArray(value) ? structuredClone(value) : {};
  if (state.schemaVersion && state.schemaVersion !== "procurement-requirement-delivery-state-v1") throw new TypeError("procurement requirement delivery state is invalid");
  state.schemaVersion = "procurement-requirement-delivery-state-v1";
  state.plans = Array.isArray(state.plans) ? state.plans : [];
  state.events = Array.isArray(state.events) ? state.events : [];
  state.commands = Array.isArray(state.commands) ? state.commands : [];
  return state;
}

function assertSafe(value, location = "command") {
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.test(key)) throw new TypeError(`${location}.${key} is not allowed`);
    assertSafe(nested, `${location}.${key}`);
  }
}

function recommendation(requirement) {
  const gap = requirement.gap?.overall || "unverified";
  let strategyCode = "VERIFY_REPOSITORY_EVIDENCE";
  if (gap === "external-evidence-required") strategyCode = "PREPARE_SITE_ACCEPTANCE";
  else if (requirement.decision === "BUILD") strategyCode = "BUILD_MINIMUM_CAPABILITY_SLICE";
  else if (requirement.decision === "ENHANCE") strategyCode = "ENHANCE_EXISTING_CAPABILITY";
  else if (requirement.decision === "CONFIGURE") strategyCode = "PREPARE_CONFIGURATION_PACKAGE";
  else if (requirement.decision === "DEPLOY") strategyCode = "PREPARE_DEPLOYMENT_VERIFICATION";
  else if (gap === "covered-in-repository") strategyCode = "REUSE_WITH_REGRESSION";
  return Object.freeze({
    workPackageId: `WP-${requirement.logicalRequirementId.slice(4)}`,
    strategyCode,
    ownerProcess: requirement.ownerProcess,
    priority: requirement.priority,
    targetCapabilityIds: Object.freeze([...requirement.targetCapabilityIds]),
    milestoneCodes: Object.freeze(["CONTRACT", "IMPLEMENT", "TEST", "INDEPENDENT_REVIEW"]),
    acceptanceCodes: Object.freeze(REQUIRED_EVIDENCE.map((type) => `REPOSITORY_${type.toUpperCase()}_VERIFIED`)),
    externalEvidenceRequired: gap === "external-evidence-required",
    productionReady: false
  });
}

function requirementSnapshot(requirement) {
  return Object.freeze({
    id: requirement.id,
    logicalRequirementId: requirement.logicalRequirementId,
    seriesId: requirement.seriesId,
    sourceRevision: requirement.sourceRevision,
    decision: requirement.decision,
    ownerProcess: requirement.ownerProcess,
    priority: requirement.priority,
    targetCapabilityIds: Object.freeze([...requirement.targetCapabilityIds]),
    gap: Object.freeze({ overall: requirement.gap?.overall || "unverified" }),
    reviewBindingDigest: requirement.reviewBindingDigest || ""
  });
}

function requirementBindingDigest(requirement) {
  const snapshot = requirementSnapshot(requirement);
  return digest(JSON.stringify({
    logicalRequirementId: snapshot.logicalRequirementId,
    seriesId: snapshot.seriesId,
    sourceRevision: snapshot.sourceRevision,
    decision: snapshot.decision,
    ownerProcess: snapshot.ownerProcess,
    priority: snapshot.priority,
    targetCapabilityIds: snapshot.targetCapabilityIds,
    gap: snapshot.gap.overall,
    reviewBindingDigest: snapshot.reviewBindingDigest
  }));
}

function evidenceSetDigest(evidence) {
  return digest(JSON.stringify([...evidence]
    .sort((left, right) => left.type.localeCompare(right.type))
    .map((item) => ({ type: item.type, digest: item.digest, status: item.status }))));
}

function publicPlan(requirement, plan, options = {}) {
  const sourceCurrent = options.sourceCurrent !== false;
  const evidence = REQUIRED_EVIDENCE.map((type) => {
    const item = plan?.evidence?.find((entry) => entry.type === type);
    return Object.freeze({ type, status: item?.status || "missing", digest: item?.digest || null, submittedAt: item?.submittedAt || "", verifiedAt: item?.verifiedAt || "" });
  });
  return Object.freeze({
    requirementId: requirement.id,
    logicalRequirementId: requirement.logicalRequirementId,
    seriesId: requirement.seriesId,
    sourceRevision: requirement.sourceRevision,
    status: sourceCurrent ? plan?.status || "awaiting-plan" : "source-stale",
    priorStatus: sourceCurrent ? "" : plan?.status || "awaiting-plan",
    sourceCurrent,
    actionAllowed: sourceCurrent,
    releaseWindow: plan?.releaseWindow || "",
    version: plan?.version || 0,
    acceptanceStatus: plan?.acceptanceStatus || "not-requested",
    acceptanceRevision: plan?.acceptanceRevision || 0,
    recommendation: recommendation(requirement),
    evidence: Object.freeze(evidence),
    verifiedEvidence: evidence.filter((item) => item.status === "verified").length,
    requiredEvidence: REQUIRED_EVIDENCE.length,
    updatedAt: plan?.updatedAt || "",
    productionReady: false
  });
}

function buildSafeExport(governance, items, now) {
  return Object.freeze({
    schemaVersion: "procurement-requirement-governance-export-v1",
    generatedAt: now,
    productionReady: false,
    summary: Object.freeze({
      ...governance.summary,
      planned: items.filter((item) => !["awaiting-plan", "source-stale"].includes(item.status)).length,
      repositoryVerified: items.filter((item) => item.sourceCurrent && item.verifiedEvidence === item.requiredEvidence).length,
      deliveryAccepted: items.filter((item) => item.status === "delivery-accepted").length,
      stalePlans: items.filter((item) => item.status === "source-stale").length
    }),
    requirements: Object.freeze(items.map((item) => Object.freeze({
      logicalRequirementId: item.logicalRequirementId,
      seriesId: item.seriesId,
      sourceRevision: item.sourceRevision,
      status: item.status,
      priorStatus: item.priorStatus,
      sourceCurrent: item.sourceCurrent,
      acceptanceStatus: item.acceptanceStatus,
      releaseWindow: item.releaseWindow,
      strategyCode: item.recommendation.strategyCode,
      ownerProcess: item.recommendation.ownerProcess,
      priority: item.recommendation.priority,
      targetCapabilityIds: item.recommendation.targetCapabilityIds,
      evidence: Object.freeze(item.evidence.map((entry) => Object.freeze({ type: entry.type, status: entry.status, digest: entry.digest })))
    }))),
    boundary: "台账仅证明本地治理和仓库证据状态，不包含招标原文、路径、地域机构信息，也不代表现场验收或生产授权。"
  });
}

function buildProcurementRequirementDelivery(data = {}, options = {}) {
  const governance = buildProcurementRequirementGovernance(data, options);
  const state = baseState(data.procurementRequirementDelivery);
  const plans = new Map(state.plans.map((plan) => [plan.requirementId, plan]));
  const approved = new Map(governance.approvedRequirements.map((requirement) => [requirement.id, requirement]));
  const items = governance.approvedRequirements.map((requirement) => {
    const plan = plans.get(requirement.id);
    const sourceCurrent = !plan || plan.requirementBindingDigest === requirementBindingDigest(requirement);
    return publicPlan(requirement, plan, { sourceCurrent });
  });
  for (const plan of state.plans) {
    if (approved.has(plan.requirementId)) continue;
    const snapshot = plan.requirementSnapshot;
    if (snapshot) items.push(publicPlan(snapshot, plan, { sourceCurrent: false }));
  }
  const now = options.now || new Date().toISOString();
  return Object.freeze({
    schemaVersion: "procurement-requirement-delivery-view-v1",
    generatedAt: now,
    ok: true,
    productionReady: false,
    requiredEvidenceTypes: REQUIRED_EVIDENCE,
    summary: Object.freeze({
      approved: governance.approvedRequirements.length,
      awaitingPlan: items.filter((item) => item.status === "awaiting-plan").length,
      planned: items.filter((item) => item.status === "planned").length,
      inDelivery: items.filter((item) => item.status === "in-delivery").length,
      evidenceReview: items.filter((item) => item.status === "evidence-review").length,
      repositoryVerified: items.filter((item) => item.sourceCurrent && item.verifiedEvidence === item.requiredEvidence).length,
      acceptanceReview: items.filter((item) => item.status === "acceptance-review").length,
      acceptanceReturned: items.filter((item) => item.status === "acceptance-returned").length,
      deliveryAccepted: items.filter((item) => item.status === "delivery-accepted").length,
      stalePlans: items.filter((item) => item.status === "source-stale").length,
      evidenceMissing: items.reduce((count, item) => count + item.evidence.filter((entry) => entry.status !== "verified").length, 0)
    }),
    items: Object.freeze(items),
    exportBundle: buildSafeExport(governance, items, now),
    boundary: "已采纳需求可进入规划、实施、独立仓库证据核验和人工交付验收；现场验收与生产授权继续保持关闭。"
  });
}

function inputError() {
  return new StateCommandError("PROCUREMENT_DELIVERY_INPUT_INVALID", "招标需求交付治理请求无效。", 400);
}

function applyProcurementRequirementDeliveryAction(data = {}, command = {}, user = {}, options = {}) {
  let commandId;
  let requirementId;
  let action;
  let expectedVersion;
  let actor;
  try {
    assertSafe(command);
    const allowed = new Set(["commandId", "requirementId", "action", "expectedVersion", "releaseWindow", "evidenceType", "evidenceDigest"]);
    if (!command || typeof command !== "object" || Array.isArray(command) || Object.keys(command).some((key) => !allowed.has(key))) throw new TypeError("unknown fields");
    commandId = String(command.commandId || "").trim();
    requirementId = String(command.requirementId || "").trim();
    action = String(command.action || "").trim();
    expectedVersion = Number(command.expectedVersion);
    actor = String(user.id || user.username || user.name || "").trim();
    if (!/^[A-Za-z0-9]+(?:[._:-][A-Za-z0-9]+)*$/.test(commandId) || commandId.length < 8 || commandId.length > 96) throw new TypeError("invalid command");
    if (!/^[A-Za-z0-9]+(?:[._:-][A-Za-z0-9]+)*$/.test(requirementId) || requirementId.length < 8 || requirementId.length > 96) throw new TypeError("invalid requirement");
    if (!ACTIONS.has(action) || !Number.isInteger(expectedVersion) || expectedVersion < 0 || !actor || actor.length > 120) throw new TypeError("invalid common fields");
    if (action === "plan" && !RELEASE_WINDOWS.has(command.releaseWindow)) throw new TypeError("invalid release window");
    if (["submit-evidence", "verify-evidence"].includes(action) && !REQUIRED_EVIDENCE.includes(command.evidenceType)) throw new TypeError("invalid evidence type");
    if (action === "submit-evidence" && !/^sha256:[a-f0-9]{64}$/.test(String(command.evidenceDigest || ""))) throw new TypeError("invalid evidence digest");
    const expectedKeys = action === "plan" ? ["releaseWindow"] : action === "submit-evidence" ? ["evidenceType", "evidenceDigest"] : action === "verify-evidence" ? ["evidenceType"] : [];
    const actionKeys = Object.keys(command).filter((key) => !["commandId", "requirementId", "action", "expectedVersion"].includes(key));
    if (actionKeys.sort().join(",") !== expectedKeys.sort().join(",")) throw new TypeError("invalid action fields");
  } catch {
    throw inputError();
  }
  if (user.role !== "commission") throw new StateCommandError("PROCUREMENT_DELIVERY_SCOPE_FORBIDDEN", "当前身份不能治理交付。", 403);
  const next = structuredClone(data || {});
  const state = baseState(next.procurementRequirementDelivery);
  const commandKeyDigest = digest(commandId);
  const actorDigest = digest(actor);
  const requestDigest = digest(JSON.stringify({ requirementId, action, expectedVersion, releaseWindow: command.releaseWindow || "", evidenceType: command.evidenceType || "", evidenceDigest: command.evidenceDigest || "", actorDigest }));
  const previous = state.commands.find((item) => item.commandKeyDigest === commandKeyDigest);
  if (previous) {
    if (previous.requestDigest !== requestDigest) throw new StateCommandError("PROCUREMENT_DELIVERY_COMMAND_CONFLICT", "幂等键已用于不同的交付治理请求。", 409);
    if (!previous.resultSnapshot) throw new StateCommandError("PROCUREMENT_DELIVERY_REPLAY_UNAVAILABLE", "历史交付回执缺少精确结果快照，不能重放。", 409);
    return Object.freeze({ data: { ...next, procurementRequirementDelivery: state }, result: Object.freeze(structuredClone(previous.resultSnapshot)), replayed: true });
  }
  const governance = buildProcurementRequirementGovernance(data, options);
  const requirement = governance.approvedRequirements.find((item) => item.id === requirementId);
  if (!requirement) throw new StateCommandError("PROCUREMENT_DELIVERY_NOT_FOUND", "已采纳招标需求不存在。", 404);
  let plan = state.plans.find((item) => item.requirementId === requirementId);
  const currentVersion = plan?.version || 0;
  if (currentVersion !== expectedVersion) throw new StateCommandError("PROCUREMENT_DELIVERY_VERSION_CONFLICT", "招标需求交付治理版本冲突。", 409);
  const now = options.now || new Date().toISOString();
  if (action === "plan") {
    if (plan) throw new StateCommandError("PROCUREMENT_DELIVERY_TRANSITION_CONFLICT", "该需求已经形成产品计划。", 409);
    plan = {
      requirementId,
      requirementBindingDigest: requirementBindingDigest(requirement),
      requirementSnapshot: structuredClone(requirementSnapshot(requirement)),
      status: "planned",
      releaseWindow: command.releaseWindow,
      evidence: [],
      acceptanceStatus: "not-requested",
      acceptanceRevision: 0,
      acceptanceRequesterDigest: null,
      acceptanceActorDigest: null,
      acceptanceEvidenceDigest: null,
      returnedEvidenceDigest: null,
      acceptedAt: "",
      version: 1,
      actorDigest,
      updatedAt: now
    };
    state.plans.push(plan);
  } else {
    if (!plan) throw new StateCommandError("PROCUREMENT_DELIVERY_TRANSITION_CONFLICT", "该需求尚未形成产品计划。", 409);
    if (plan.requirementBindingDigest !== requirementBindingDigest(requirement)) throw new StateCommandError("PROCUREMENT_DELIVERY_SOURCE_STALE", "产品计划绑定的需求复核证据已经失效。", 409);
    if (action === "start-delivery") {
      if (plan.status !== "planned") throw new StateCommandError("PROCUREMENT_DELIVERY_TRANSITION_CONFLICT", "当前状态不能开始实施。", 409);
      plan.status = "in-delivery";
    } else if (action === "submit-evidence") {
      if (!["in-delivery", "evidence-review", "acceptance-returned"].includes(plan.status)) throw new StateCommandError("PROCUREMENT_DELIVERY_TRANSITION_CONFLICT", "当前状态不能提交仓库证据。", 409);
      const existing = plan.evidence.find((item) => item.type === command.evidenceType);
      const evidence = { type: command.evidenceType, digest: command.evidenceDigest, status: "submitted", submitterDigest: actorDigest, submittedAt: now, verifierDigest: null, verifiedAt: "" };
      if (existing) Object.assign(existing, evidence); else plan.evidence.push(evidence);
      plan.status = "evidence-review";
    } else if (action === "verify-evidence") {
      if (plan.status !== "evidence-review") throw new StateCommandError("PROCUREMENT_DELIVERY_TRANSITION_CONFLICT", "当前状态不能核验仓库证据。", 409);
      const evidence = plan.evidence.find((item) => item.type === command.evidenceType);
      if (!evidence || evidence.status !== "submitted") throw new StateCommandError("PROCUREMENT_DELIVERY_EVIDENCE_NOT_FOUND", "待核验仓库证据不存在。", 404);
      if (evidence.submitterDigest === actorDigest) throw new StateCommandError("PROCUREMENT_DELIVERY_INDEPENDENCE_REQUIRED", "证据提交人与核验人必须相互独立。", 409);
      evidence.status = "verified";
      evidence.verifierDigest = actorDigest;
      evidence.verifiedAt = now;
      if (REQUIRED_EVIDENCE.every((type) => plan.evidence.some((item) => item.type === type && item.status === "verified"))) plan.status = plan.acceptanceStatus === "returned" ? "acceptance-returned" : "repository-verified";
    } else if (action === "request-acceptance") {
      if (plan.status !== "repository-verified" || !REQUIRED_EVIDENCE.every((type) => plan.evidence.some((item) => item.type === type && item.status === "verified"))) throw new StateCommandError("PROCUREMENT_DELIVERY_TRANSITION_CONFLICT", "仓库证据未全部核验，不能申请交付验收。", 409);
      plan.status = "acceptance-review";
      plan.acceptanceStatus = "pending";
      plan.acceptanceRevision += 1;
      plan.acceptanceRequesterDigest = actorDigest;
      plan.acceptanceActorDigest = null;
      plan.acceptanceEvidenceDigest = evidenceSetDigest(plan.evidence);
      plan.acceptedAt = "";
    } else if (["accept-delivery", "return-delivery"].includes(action)) {
      if (plan.status !== "acceptance-review" || plan.acceptanceStatus !== "pending") throw new StateCommandError("PROCUREMENT_DELIVERY_TRANSITION_CONFLICT", "当前状态不能形成交付验收结论。", 409);
      if (plan.acceptanceRequesterDigest === actorDigest) throw new StateCommandError("PROCUREMENT_DELIVERY_ACCEPTANCE_INDEPENDENCE_REQUIRED", "交付验收申请人与验收人必须相互独立。", 409);
      plan.acceptanceActorDigest = actorDigest;
      if (action === "accept-delivery") {
        plan.status = "delivery-accepted";
        plan.acceptanceStatus = "accepted";
        plan.acceptedAt = now;
      } else {
        plan.status = "acceptance-returned";
        plan.acceptanceStatus = "returned";
        plan.returnedEvidenceDigest = plan.acceptanceEvidenceDigest;
        plan.acceptedAt = "";
      }
    } else if (action === "resubmit-delivery") {
      if (plan.status !== "acceptance-returned" || plan.acceptanceStatus !== "returned" || !REQUIRED_EVIDENCE.every((type) => plan.evidence.some((item) => item.type === type && item.status === "verified"))) throw new StateCommandError("PROCUREMENT_DELIVERY_TRANSITION_CONFLICT", "整改后证据未全部核验，不能重新提交交付验收。", 409);
      const currentEvidenceDigest = evidenceSetDigest(plan.evidence);
      if (currentEvidenceDigest === plan.returnedEvidenceDigest) throw new StateCommandError("PROCUREMENT_DELIVERY_TRANSITION_CONFLICT", "整改证据没有变化，不能重新提交交付验收。", 409);
      plan.status = "acceptance-review";
      plan.acceptanceStatus = "pending";
      plan.acceptanceRevision += 1;
      plan.acceptanceRequesterDigest = actorDigest;
      plan.acceptanceActorDigest = null;
      plan.acceptanceEvidenceDigest = currentEvidenceDigest;
      plan.acceptedAt = "";
    }
    plan.version += 1;
    plan.actorDigest = actorDigest;
    plan.updatedAt = now;
  }
  const view = publicPlan(requirement, plan);
  state.events.push({ eventId: `prd-${commandKeyDigest.slice(7, 23)}`, requirementId, action, resultingStatus: view.status, actorDigest, version: view.version, at: now });
  state.commands.push({ commandKeyDigest, requestDigest, requirementId, resultingVersion: view.version, resultSnapshot: structuredClone(view), recordedAt: now });
  if (state.events.length > 5000 || state.commands.length > 5000) throw new StateCommandError("PROCUREMENT_DELIVERY_CAPACITY_EXCEEDED", "招标需求交付治理记录已达到容量上限。", 409);
  next.procurementRequirementDelivery = state;
  return Object.freeze({ data: next, result: view, replayed: false });
}

module.exports = { ACTIONS, REQUIRED_EVIDENCE, RELEASE_WINDOWS, applyProcurementRequirementDeliveryAction, buildProcurementRequirementDelivery, buildSafeExport, recommendation };
