"use strict";

const { createHash } = require("node:crypto");
const {
  SPECIALTY_MODULE_BOUNDARIES,
  buildSpecialtyCutoverPack
} = require("./emergency-specialty-cutover");

const CONTRACT_VERSION = "t10-specialty-institution-modules-v1";
const MODULE_IDS = Object.freeze(Object.keys(SPECIALTY_MODULE_BOUNDARIES));
const FORBIDDEN_OVERRIDE_FIELDS = Object.freeze([
  "productionReady",
  "formalGoLiveState",
  "goNoGoDecision",
  "siteEvidence",
  "siteEvidenceWorkflow",
  "enabledModuleIds",
  "environment"
]);

class T10SpecialtyModuleGovernanceError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.name = "T10SpecialtyModuleGovernanceError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function text(value, maximum = 240) {
  return String(value == null ? "" : value).trim().slice(0, maximum);
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function normalizeEnabledModuleIds(value) {
  const requested = Array.isArray(value) ? value.map((item) => text(item, 80)).filter(Boolean) : [];
  const unique = [...new Set(requested)];
  const unknown = unique.filter((moduleId) => !MODULE_IDS.includes(moduleId));
  if (unknown.length) {
    throw new T10SpecialtyModuleGovernanceError(
      "T10_MODULE_UNKNOWN",
      `unknown T10 specialty module: ${unknown.join(", ")}`,
      400
    );
  }
  return MODULE_IDS.filter((moduleId) => unique.includes(moduleId));
}

function currentRecord(state = {}, institutionId) {
  const rows = Array.isArray(state.t10SpecialtyModuleSelections) ? state.t10SpecialtyModuleSelections : [];
  return rows.find((item) => item.institutionId === institutionId) || null;
}

function normalizedRecord(state = {}, institutionId) {
  const existing = currentRecord(state, institutionId);
  if (!existing) {
    return {
      institutionId,
      enabledModuleIds: [...MODULE_IDS],
      version: 0,
      updatedAt: "",
      updatedBy: "",
      actionHistory: [],
      productionReady: false,
      formalGoLiveState: "blocked-until-site-evidence-signed"
    };
  }
  const enabledModuleIds = normalizeEnabledModuleIds(existing.enabledModuleIds);
  if (!enabledModuleIds.length) {
    throw new T10SpecialtyModuleGovernanceError(
      "T10_MODULE_SELECTION_EMPTY",
      "at least one T10 specialty module must remain selected for a cutover pack",
      409
    );
  }
  return {
    ...existing,
    institutionId,
    enabledModuleIds,
    version: Number.isInteger(Number(existing.version)) ? Number(existing.version) : 0,
    actionHistory: Array.isArray(existing.actionHistory) ? existing.actionHistory.slice(0, 100) : [],
    productionReady: false,
    formalGoLiveState: "blocked-until-site-evidence-signed"
  };
}

function buildInstitutionModuleView(state = {}, institutionIdValue, options = {}) {
  const institutionId = text(institutionIdValue, 160);
  if (!institutionId) {
    throw new T10SpecialtyModuleGovernanceError(
      "T10_INSTITUTION_REQUIRED",
      "institutionId is required",
      400
    );
  }
  const record = normalizedRecord(state, institutionId);
  const pack = buildSpecialtyCutoverPack({
    generatedAt: options.at,
    enabledTrackIds: record.enabledModuleIds
  });
  return {
    contractVersion: CONTRACT_VERSION,
    institutionId,
    version: record.version,
    selectionMode: pack.moduleCatalog.selectionMode,
    enabledModuleIds: [...pack.moduleCatalog.enabledModuleIds],
    disabledModuleIds: [...pack.moduleCatalog.disabledModuleIds],
    modules: pack.moduleCatalog.modules.map((item) => ({
      id: item.id,
      name: item.name,
      selected: item.selected,
      independentlySelectable: item.independentlySelectable,
      deploymentUnit: item.deploymentUnit,
      requiredPeerModules: [...item.requiredPeerModules],
      controlState: item.selected ? "configured-for-controlled-rehearsal" : "not-configured"
    })),
    formalGoLiveState: pack.summary.formalGoLiveState,
    siteNoGoEnforced: pack.summary.productionReady === 0
      && pack.goNoGoDecision.currentDecision === "no-go-site-evidence-pending",
    productionReady: false
  };
}

function actorIdentity(actor = {}) {
  const id = text(actor.id || actor.username || actor.accountId, 160);
  const role = text(actor.role, 40).toLowerCase();
  if (!id || role !== "commission") {
    throw new T10SpecialtyModuleGovernanceError(
      "T10_MODULE_ACTOR_FORBIDDEN",
      "commission actor identity is required for T10 module selection changes",
      403
    );
  }
  return { id, role };
}

function applyInstitutionModuleAction(state = {}, institutionIdValue, input = {}, actorValue = {}, options = {}) {
  const institutionId = text(institutionIdValue, 160);
  if (!institutionId) {
    throw new T10SpecialtyModuleGovernanceError("T10_INSTITUTION_REQUIRED", "institutionId is required", 400);
  }
  if (typeof options.institutionExists !== "function" || options.institutionExists(institutionId) !== true) {
    throw new T10SpecialtyModuleGovernanceError(
      "T10_INSTITUTION_NOT_FOUND",
      "institution is not present in the trusted organization directory",
      404
    );
  }
  const actor = actorIdentity(actorValue);
  const forbidden = FORBIDDEN_OVERRIDE_FIELDS.filter((field) => Object.hasOwn(input, field));
  if (forbidden.length) {
    throw new T10SpecialtyModuleGovernanceError(
      "T10_MODULE_BOUNDARY_OVERRIDE_FORBIDDEN",
      `T10 module action cannot override protected fields: ${forbidden.join(", ")}`,
      400
    );
  }
  const action = text(input.action, 40).toLowerCase();
  if (!["enable-module", "disable-module"].includes(action)) {
    throw new T10SpecialtyModuleGovernanceError(
      "T10_MODULE_ACTION_INVALID",
      "action must be enable-module or disable-module",
      400
    );
  }
  const moduleId = text(input.moduleId, 80);
  if (!MODULE_IDS.includes(moduleId)) {
    throw new T10SpecialtyModuleGovernanceError("T10_MODULE_UNKNOWN", "unknown T10 specialty module", 400);
  }
  const expectedVersion = Number(input.expectedVersion);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
    throw new T10SpecialtyModuleGovernanceError(
      "T10_MODULE_EXPECTED_VERSION_REQUIRED",
      "non-negative integer expectedVersion is required",
      400
    );
  }
  const idempotencyKey = text(options.idempotencyKey, 160);
  if (!idempotencyKey) {
    throw new T10SpecialtyModuleGovernanceError(
      "T10_MODULE_IDEMPOTENCY_KEY_REQUIRED",
      "Idempotency-Key is required",
      400
    );
  }
  const evidenceRef = text(input.evidenceRef, 400);
  if (evidenceRef.length < 8 || /replace-with|placeholder|example|demo[-_]/i.test(evidenceRef)) {
    throw new T10SpecialtyModuleGovernanceError(
      "T10_MODULE_CHANGE_EVIDENCE_REQUIRED",
      "an immutable non-placeholder change evidence reference is required",
      400
    );
  }
  const at = new Date(options.at || Date.now()).toISOString();
  const data = structuredClone(state);
  const record = normalizedRecord(data, institutionId);
  const requestDigest = digest({ institutionId, action, moduleId, evidenceRef });
  const replay = record.actionHistory.find((item) => item.idempotencyKey === idempotencyKey);
  if (replay) {
    if (replay.requestDigest !== requestDigest) {
      throw new T10SpecialtyModuleGovernanceError(
        "T10_MODULE_IDEMPOTENCY_CONFLICT",
        "Idempotency-Key was already used for a different module action",
        409
      );
    }
    return {
      state: data,
      record,
      view: buildInstitutionModuleView(data, institutionId, { at }),
      replayed: true
    };
  }
  if (record.version !== expectedVersion) {
    throw new T10SpecialtyModuleGovernanceError(
      "T10_MODULE_VERSION_CONFLICT",
      `T10 module selection version conflict: expected ${expectedVersion}, current ${record.version}`,
      409
    );
  }
  const enabled = new Set(record.enabledModuleIds);
  if (action === "enable-module") {
    if (enabled.has(moduleId)) {
      throw new T10SpecialtyModuleGovernanceError("T10_MODULE_ALREADY_ENABLED", "module is already enabled", 409);
    }
    enabled.add(moduleId);
  } else {
    if (!enabled.has(moduleId)) {
      throw new T10SpecialtyModuleGovernanceError("T10_MODULE_ALREADY_DISABLED", "module is already disabled", 409);
    }
    if (enabled.size === 1) {
      throw new T10SpecialtyModuleGovernanceError(
        "T10_MODULE_SELECTION_EMPTY",
        "the last selected module cannot be disabled",
        409
      );
    }
    enabled.delete(moduleId);
  }
  const nextEnabledModuleIds = MODULE_IDS.filter((item) => enabled.has(item));
  const nextVersion = record.version + 1;
  const history = {
    idempotencyKey,
    requestDigest,
    action,
    moduleId,
    evidenceRef,
    at,
    actorId: actor.id,
    actorRole: actor.role,
    fromVersion: record.version,
    toVersion: nextVersion,
    productionReady: false,
    formalGoLiveState: "blocked-until-site-evidence-signed"
  };
  const nextRecord = {
    ...record,
    enabledModuleIds: nextEnabledModuleIds,
    version: nextVersion,
    updatedAt: at,
    updatedBy: actor.id,
    actionHistory: [history, ...record.actionHistory].slice(0, 100),
    productionReady: false,
    formalGoLiveState: "blocked-until-site-evidence-signed"
  };
  const rows = Array.isArray(data.t10SpecialtyModuleSelections) ? data.t10SpecialtyModuleSelections : [];
  data.t10SpecialtyModuleSelections = [
    nextRecord,
    ...rows.filter((item) => item.institutionId !== institutionId)
  ].slice(0, 500);
  data.t10SpecialtyModuleAudit = [
    {
      id: `t10-module-audit-${digest({ institutionId, idempotencyKey }).slice(0, 24)}`,
      ...history,
      institutionId,
      enabledModuleIds: nextEnabledModuleIds
    },
    ...(Array.isArray(data.t10SpecialtyModuleAudit) ? data.t10SpecialtyModuleAudit : [])
  ].slice(0, 5000);
  return {
    state: data,
    record: nextRecord,
    view: buildInstitutionModuleView(data, institutionId, { at }),
    replayed: false
  };
}

module.exports = {
  CONTRACT_VERSION,
  FORBIDDEN_OVERRIDE_FIELDS,
  MODULE_IDS,
  T10SpecialtyModuleGovernanceError,
  applyInstitutionModuleAction,
  buildInstitutionModuleView,
  normalizeEnabledModuleIds
};
