"use strict";

const { createHash, randomUUID } = require("node:crypto");

const { ContractRegistry } = require("../platform/contracts/contract-registry");
const { DomainRepository } = require("../platform/data/domain-repository");
const { createDomainEvent } = require("../platform/events/domain-event-runtime");

const DOMAIN = "care-coordination";
const CONTRACT_ID = "referral-order.v1";
const EVENT_TYPE = "care-coordination.referral-updated.v1";
const OUTBOX_COLLECTION = "referralOutbox";
const INBOX_COLLECTION = "referralCommandInbox";
const REPLAY_COLLECTION = "referralDeliveryReplays";
const DEAD_LETTER_COLLECTION = "referralDeliveryDeadLetters";
let referralStateQueue = Promise.resolve();

class ReferralCommandError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.name = "ReferralCommandError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(value) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function serializeReferralState(operation) {
  const execution = referralStateQueue.then(operation);
  referralStateQueue = execution.catch(() => undefined);
  return execution;
}

function text(value, max = 300) {
  return String(value || "").trim().slice(0, max);
}

function boundedCommandText(value, { field, max, code, required = false, requiredCode = code }) {
  const normalized = String(value || "").trim();
  if (required && !normalized) {
    throw new ReferralCommandError(requiredCode, `${field} is required`);
  }
  if (normalized.length > max) {
    throw new ReferralCommandError(code, `${field} exceeds ${max} characters`);
  }
  return normalized;
}

function normalizeCommandActor(actor = {}) {
  const identityValues = [actor.id, actor.username].filter((value) => value !== undefined && value !== null);
  for (const value of identityValues) {
    boundedCommandText(value, { field: "actor id", max: 120, code: "REFERRAL_ACTOR_ID_TOO_LONG" });
  }
  const organizationValues = [actor.orgCode, actor.orgName].filter((value) => value !== undefined && value !== null);
  for (const value of organizationValues) {
    boundedCommandText(value, { field: "actor organization", max: 200, code: "REFERRAL_ACTOR_ORG_TOO_LONG" });
  }
  const regionValues = [actor.regionCode, actor.region, actor.district, actor.dataScope]
    .filter((value) => value !== undefined && value !== null);
  for (const value of regionValues) {
    boundedCommandText(value, { field: "actor region", max: 200, code: "REFERRAL_ACTOR_REGION_TOO_LONG" });
  }
  return Object.freeze({
    id: boundedCommandText(actor.id, { field: "actor id", max: 120, code: "REFERRAL_ACTOR_ID_TOO_LONG" }),
    username: boundedCommandText(actor.username, { field: "actor username", max: 120, code: "REFERRAL_ACTOR_ID_TOO_LONG" }),
    name: boundedCommandText(actor.name, { field: "actor name", max: 120, code: "REFERRAL_ACTOR_NAME_TOO_LONG" }),
    role: boundedCommandText(actor.role, { field: "actor role", max: 40, code: "REFERRAL_ACTOR_ROLE_TOO_LONG" }),
    orgCode: boundedCommandText(actor.orgCode, { field: "actor organization code", max: 120, code: "REFERRAL_ACTOR_ORG_TOO_LONG" }),
    orgName: boundedCommandText(actor.orgName, { field: "actor organization name", max: 200, code: "REFERRAL_ACTOR_ORG_TOO_LONG" }),
    orgType: boundedCommandText(actor.orgType, { field: "actor organization type", max: 80, code: "REFERRAL_ACTOR_ORG_TOO_LONG" }),
    orgLevel: boundedCommandText(actor.orgLevel, { field: "actor organization level", max: 80, code: "REFERRAL_ACTOR_ORG_TOO_LONG" }),
    regionCode: boundedCommandText(actor.regionCode, { field: "actor region code", max: 120, code: "REFERRAL_ACTOR_REGION_TOO_LONG" }),
    region: boundedCommandText(actor.region || actor.district, { field: "actor region", max: 120, code: "REFERRAL_ACTOR_REGION_TOO_LONG" }),
    dataScope: boundedCommandText(actor.dataScope, { field: "actor data scope", max: 200, code: "REFERRAL_ACTOR_REGION_TOO_LONG" }),
    residentId: boundedCommandText(actor.residentId, { field: "actor resident id", max: 200, code: "REFERRAL_ACTOR_ID_TOO_LONG" }),
    residentIds: Array.isArray(actor.residentIds)
      ? actor.residentIds.map((value) => boundedCommandText(value, { field: "actor resident id", max: 200, code: "REFERRAL_ACTOR_ID_TOO_LONG" }))
      : []
  });
}

function normalizedScopeValue(value) {
  return String(value || "").trim().toLocaleLowerCase("zh-CN").replace(/[\s·・,，。()（）_-]+/g, "");
}

function scopeValuesMatch(left, right) {
  const a = normalizedScopeValue(left);
  const b = normalizedScopeValue(right);
  return Boolean(a && b && (a === b || (a.length >= 3 && b.includes(a)) || (b.length >= 3 && a.includes(b))));
}

function organizationValuesMatch(left, right) {
  const organizationRoot = (value) => normalizedScopeValue(String(value || "").split(/[·・]/, 1)[0]);
  const a = organizationRoot(left);
  const b = organizationRoot(right);
  return Boolean(a && b && a === b);
}

function referralOrganizationValues(referral) {
  return [
    referral?.from,
    referral?.to,
    referral?.sourceInstitution,
    referral?.targetInstitution,
    referral?.fromInstitution,
    referral?.toInstitution,
    referral?.sourceInstitutionCode,
    referral?.targetInstitutionCode,
    referral?.fromInstitutionCode,
    referral?.toInstitutionCode,
    referral?.sourceOrgCode,
    referral?.targetOrgCode
  ].filter(Boolean);
}

function organizationAliases(state, actor) {
  const aliases = new Set([actor.orgCode, actor.orgName].filter(Boolean));
  for (const organization of Array.isArray(state?.authOrganizations) ? state.authOrganizations : []) {
    if ([organization.orgCode, organization.name].some((value) => [...aliases].some((alias) => organizationValuesMatch(value, alias)))) {
      if (organization.orgCode) aliases.add(organization.orgCode);
      if (organization.name) aliases.add(organization.name);
    }
  }
  for (const resource of Array.isArray(state?.medicalResources) ? state.medicalResources : []) {
    if ([resource.id, resource.institution, resource.orgCode].some((value) => [...aliases].some((alias) => organizationValuesMatch(value, alias)))) {
      if (resource.id) aliases.add(resource.id);
      if (resource.institution) aliases.add(resource.institution);
      if (resource.orgCode) aliases.add(resource.orgCode);
    }
  }
  return [...aliases];
}

function referralRegions(state, referral) {
  const values = [referral?.regionCode, referral?.region, referral?.district].filter(Boolean);
  const organizations = referralOrganizationValues(referral);
  const resident = (Array.isArray(state?.residents) ? state.residents : [])
    .find((item) => item.id === referral?.residentId);
  if (resident?.organization) organizations.push(resident.organization);
  for (const resource of Array.isArray(state?.medicalResources) ? state.medicalResources : []) {
    if (organizations.some((value) => [resource.id, resource.institution, resource.orgCode]
      .some((candidate) => scopeValuesMatch(value, candidate)))) {
      if (resource.region) values.push(resource.region);
      if (resource.regionCode) values.push(resource.regionCode);
      if (resource.district) values.push(resource.district);
    }
  }
  return values;
}

function actorRegions(state, actor) {
  const values = [actor.regionCode, actor.region, actor.orgName, actor.dataScope].filter(Boolean);
  for (const organization of Array.isArray(state?.authOrganizations) ? state.authOrganizations : []) {
    if ([organization.orgCode, organization.name].some((value) => [actor.orgCode, actor.orgName]
      .some((candidate) => scopeValuesMatch(value, candidate)))) {
      values.push(organization.orgCode, organization.name, organization.parentCode, organization.dataScope);
    }
  }
  return values.filter(Boolean);
}

const COMMAND_SOURCE_ROLES = Object.freeze({
  direct: new Set(["institution", "county", "commission"]),
  workflow: new Set(["institution", "commission"]),
  task: new Set(["institution", "commission", "citizen"]),
  internal: new Set(["system"])
});

function authorizeReferralCommand({ state, referral, actor, source, commandInput, canAccessResident }) {
  if (!actor.role) {
    throw new ReferralCommandError("REFERRAL_ACTOR_REQUIRED", "authenticated referral command actor is required", 403);
  }
  const allowedRoles = COMMAND_SOURCE_ROLES[source];
  if (!allowedRoles || !allowedRoles.has(actor.role)) {
    throw new ReferralCommandError("REFERRAL_ACTION_DENIED", "actor role cannot use this referral command path", 403);
  }
  if (actor.role === "citizen") {
    if (!canAccessResident(actor, referral.residentId, state)) {
      throw new ReferralCommandError("REFERRAL_SCOPE_DENIED", "resident or family authorization scope denied", 403);
    }
    return;
  }
  if (actor.role === "system" && source === "internal") return;
  if (actor.role === "institution") {
    const aliases = organizationAliases(state, actor);
    const sourceOrganizations = [
      referral?.from,
      referral?.sourceInstitution,
      referral?.fromInstitution,
      referral?.sourceInstitutionCode,
      referral?.fromInstitutionCode,
      referral?.sourceOrgCode
    ].filter(Boolean);
    const targetOrganizations = [
      referral?.to,
      referral?.targetInstitution,
      referral?.toInstitution,
      referral?.targetInstitutionCode,
      referral?.toInstitutionCode,
      referral?.targetOrgCode
    ].filter(Boolean);
    const matches = (organizations) => aliases.some((alias) =>
      organizations.some((value) => organizationValuesMatch(alias, value)));
    if (!matches([...sourceOrganizations, ...targetOrganizations])) {
      throw new ReferralCommandError("REFERRAL_SCOPE_DENIED", "referral institution scope denied", 403);
    }
    const requestedStatus = String(commandInput?.patch?.status || "").trim();
    if (["accepted", "已接诊", "基层承接"].includes(requestedStatus) && !matches(targetOrganizations)) {
      throw new ReferralCommandError("REFERRAL_ACTION_SCOPE_DENIED", "receiving institution scope is required", 403);
    }
    return;
  }
  const regionScoped = actor.role === "county" || actor.orgType === "district" || /区市县|本区/.test(actor.orgLevel + actor.dataScope);
  if (regionScoped) {
    const allowedRegions = actorRegions(state, actor);
    const resourceRegions = referralRegions(state, referral);
    if (!allowedRegions.some((allowed) => resourceRegions.some((resource) => scopeValuesMatch(allowed, resource)))) {
      throw new ReferralCommandError("REFERRAL_SCOPE_DENIED", "referral region scope denied", 403);
    }
  }
}

function dateValue(value, label = "timestamp") {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new ReferralCommandError("REFERRAL_DELIVERY_TIME_INVALID", `${label} is invalid`, 500);
  }
  return date;
}

function normalizeDeliveryState(state) {
  state.referralSystem = state.referralSystem || {};
  for (const collection of [OUTBOX_COLLECTION, INBOX_COLLECTION, REPLAY_COLLECTION, DEAD_LETTER_COLLECTION]) {
    state.referralSystem[collection] = Array.isArray(state.referralSystem[collection])
      ? state.referralSystem[collection]
      : [];
  }
  return state.referralSystem;
}

function referralRows(state) {
  return Array.isArray(state?.referralSystem?.referrals) ? state.referralSystem.referrals : [];
}

function currentVersion(referral) {
  const version = Number(referral?.version || 1);
  if (!Number.isInteger(version) || version < 1) {
    throw new ReferralCommandError("REFERRAL_VERSION_INVALID", "referral aggregate version is invalid", 409);
  }
  return version;
}

function domainEventFromOutbox(event) {
  return createDomainEvent({
    id: event.id,
    domain: event.domain,
    type: event.type,
    aggregateId: event.aggregateId,
    aggregateVersion: event.aggregateVersion,
    correlationId: event.correlationId,
    causationId: event.causationId,
    occurredAt: event.occurredAt,
    payload: structuredClone(event.payload)
  });
}

function buildReferralOrderContract(referral) {
  const registry = new ContractRegistry();
  const contract = registry.get(CONTRACT_ID);
  if (contract.owner !== DOMAIN) {
    throw new ReferralCommandError("REFERRAL_CONTRACT_OWNER_INVALID", "referral contract owner mismatch", 500);
  }
  const value = {
    contractId: contract.id,
    contractVersion: contract.version,
    referralId: text(referral?.id, 200),
    residentId: text(referral?.residentId, 200),
    status: text(referral?.status, 100),
    version: currentVersion(referral),
    type: text(referral?.type, 100),
    priority: text(referral?.priority, 80),
    sourceInstitution: text(referral?.from || referral?.sourceInstitution, 200),
    targetInstitution: text(referral?.to || referral?.targetInstitution, 200),
    updatedAt: text(referral?.lastUpdated || referral?.updatedAt, 80)
  };
  const missing = contract.requiredFields.filter((field) => value[field] === undefined || value[field] === "");
  if (missing.length) {
    throw new ReferralCommandError(
      "REFERRAL_CONTRACT_INVALID",
      `${CONTRACT_ID} is missing: ${missing.join(", ")}`,
      409
    );
  }
  return Object.freeze(value);
}

function createReferralOrderAntiCorruptionAdapter(consumer) {
  const registry = new ContractRegistry();
  registry.registerAntiCorruptionAdapter({
    contractId: CONTRACT_ID,
    consumer,
    fromExternal(payload) {
      return {
        referralId: text(payload.referralId || payload.referral_id, 200),
        residentId: text(payload.residentId || payload.resident_id, 200),
        status: text(payload.status, 100),
        version: Number(payload.version),
        type: text(payload.type, 100),
        priority: text(payload.priority, 80),
        sourceInstitution: text(payload.sourceInstitution || payload.source_institution, 200),
        targetInstitution: text(payload.targetInstitution || payload.target_institution, 200),
        updatedAt: text(payload.updatedAt || payload.updated_at, 80)
      };
    },
    toExternal(value) {
      return {
        contract_id: CONTRACT_ID,
        contract_version: registry.get(CONTRACT_ID).version,
        referral_id: text(value.referralId, 200),
        resident_id: text(value.residentId, 200),
        status: text(value.status, 100),
        version: Number(value.version),
        type: text(value.type, 100),
        priority: text(value.priority, 80),
        source_institution: text(value.sourceInstitution, 200),
        target_institution: text(value.targetInstitution, 200),
        updated_at: text(value.updatedAt, 80)
      };
    }
  });
  return Object.freeze({
    decode(payload) {
      const value = registry.decode(CONTRACT_ID, consumer, payload);
      if (!Number.isInteger(value.version) || value.version < 1) {
        throw new TypeError(`${CONTRACT_ID} version must be a positive integer`);
      }
      return value;
    },
    encode: (value) => registry.encode(CONTRACT_ID, consumer, value)
  });
}

function createStateRepositoryAdapter({ readState, writeState }) {
  if (typeof readState !== "function" || typeof writeState !== "function") {
    throw new TypeError("referral repository adapter requires readState and writeState");
  }
  return {
    async read(collection, id) {
      if (collection !== "referrals") return null;
      const row = referralRows(readState()).find((item) => item.id === id);
      return row ? structuredClone(row) : null;
    },
    async transact(callback) {
      const working = structuredClone(readState());
      working.referralSystem = working.referralSystem || {};
      working.referralSystem.referrals = referralRows(working);
      working.referralSystem[OUTBOX_COLLECTION] = Array.isArray(working.referralSystem[OUTBOX_COLLECTION])
        ? working.referralSystem[OUTBOX_COLLECTION]
        : [];
      working.referralSystem[INBOX_COLLECTION] = Array.isArray(working.referralSystem[INBOX_COLLECTION])
        ? working.referralSystem[INBOX_COLLECTION]
        : [];
      let changed = false;
      const transaction = {
        async apply(operation) {
          if (operation.type !== "put" || operation.collection !== "referrals") {
            throw new ReferralCommandError("REFERRAL_REPOSITORY_OPERATION_INVALID", "unsupported referral repository operation", 500);
          }
          const rows = working.referralSystem.referrals;
          const index = rows.findIndex((item) => item.id === operation.id);
          if (index < 0) {
            throw new ReferralCommandError("REFERRAL_NOT_FOUND", "referral was not found", 404);
          }
          const actualVersion = currentVersion(rows[index]);
          if (operation.expectedVersion !== undefined && Number(operation.expectedVersion) !== actualVersion) {
            throw new ReferralCommandError(
              "REFERRAL_VERSION_CONFLICT",
              `referral version conflict: expected ${operation.expectedVersion}, current ${actualVersion}`,
              409
            );
          }
          rows[index] = structuredClone(operation.value);
          changed = true;
        },
        async appendOutbox(event) {
          if (working.referralSystem[OUTBOX_COLLECTION].some((item) => item.id === event.id)) {
            throw new ReferralCommandError("REFERRAL_OUTBOX_DUPLICATE", "referral outbox event already exists", 409);
          }
          const relaySequence = working.referralSystem[OUTBOX_COLLECTION].reduce(
            (maximum, item) => Math.max(maximum, Number(item.relaySequence) || 0),
            working.referralSystem[OUTBOX_COLLECTION].length
          ) + 1;
          working.referralSystem[OUTBOX_COLLECTION] = [
            {
              ...structuredClone(event),
              contractId: CONTRACT_ID,
              relaySequence,
              status: "pending",
              attempts: 0,
              nextAttemptAt: event.occurredAt,
              deliveryVersion: 0,
              createdAt: event.occurredAt
            },
            ...working.referralSystem[OUTBOX_COLLECTION]
          ];
          working.referralSystem[INBOX_COLLECTION] = [
            {
              commandId: event.payload.commandId,
              eventId: event.id,
              aggregateId: event.aggregateId,
              aggregateVersion: event.aggregateVersion,
              intentDigest: event.payload.intentDigest,
              result: structuredClone(working.referralSystem.referrals
                .find((item) => item.id === event.aggregateId)),
              completedAt: event.occurredAt
            },
            ...working.referralSystem[INBOX_COLLECTION]
          ];
          changed = true;
        }
      };
      const result = await callback(transaction);
      if (changed) await writeState(working);
      return result;
    }
  };
}

const REFERRAL_PATCH_LIMITS = Object.freeze({
  status: 100,
  priority: 80,
  reservedResource: 300,
  insurancePolicy: 300,
  reason: 1000,
  receivingFeedback: 1000,
  nextAction: 300
});

function cleanReferralPatch(input = {}) {
  const patch = input.patch && typeof input.patch === "object" && !Array.isArray(input.patch)
    ? input.patch
    : input;
  return Object.fromEntries(Object.keys(REFERRAL_PATCH_LIMITS)
    .filter((field) => Object.hasOwn(patch, field))
    .map((field) => [field, boundedCommandText(patch[field], {
      field: `referral patch ${field}`,
      max: REFERRAL_PATCH_LIMITS[field],
      code: "REFERRAL_PATCH_FIELD_TOO_LONG"
    })]));
}

function taskCommandIntent(input, actor) {
  const action = boundedCommandText(input.action || "update", {
    field: "referral task action",
    max: 80,
    code: "REFERRAL_ACTION_TOO_LONG",
    required: true
  });
  const allowedActions = actor.role === "citizen"
    ? new Set(["resident-confirm", "cancel-request"])
    : new Set(["update", "accept", "complete", "return", "cancel"]);
  if (!allowedActions.has(action)) {
    throw new ReferralCommandError("REFERRAL_ACTION_DENIED", "unsupported referral task action", 403);
  }
  const comment = boundedCommandText(input.comment || input.note, {
    field: "referral task comment",
    max: 1000,
    code: "REFERRAL_PATCH_FIELD_TOO_LONG"
  });
  const satisfaction = boundedCommandText(input.satisfaction, {
    field: "referral satisfaction",
    max: 100,
    code: "REFERRAL_PATCH_FIELD_TOO_LONG"
  });
  const patch = actor.role === "citizen" ? {} : cleanReferralPatch(input);
  if (actor.role !== "citizen" && Object.keys(patch).length === 0 && action === "update") {
    throw new ReferralCommandError("REFERRAL_PATCH_REQUIRED", "referral update requires allowed fields");
  }
  return Object.freeze({ action, comment, satisfaction, patch });
}

function buildTaskPatch(intent, actor, current, occurredAt) {
  const handledBy = actor.username || actor.id || actor.role;
  const patch = {
    ...intent.patch,
    taskAction: intent.action,
    taskComment: intent.comment,
    handledAt: occurredAt,
    handledBy,
    handledByName: actor.name
  };
  if (actor.role === "citizen") {
    patch.residentActionAt = occurredAt;
    patch.residentActionBy = actor.name || handledBy || "居民";
    if (intent.action === "resident-confirm") patch.residentConfirmation = "confirmed";
    if (intent.action === "cancel-request") {
      patch.status = "cancel-requested";
      patch.cancellationReason = intent.comment || "居民端申请取消";
    }
  }
  patch.auditTrail = [
    { at: occurredAt, action: intent.action, by: handledBy, note: intent.comment || patch.status || intent.satisfaction || "referral task action" },
    ...(Array.isArray(current.auditTrail) ? current.auditTrail : [])
  ].slice(0, 30);
  return patch;
}

function validateReferralContractFields(referral) {
  const fields = [
    [referral?.id, "referral id", 200],
    [referral?.residentId, "resident id", 200],
    [referral?.status, "status", 100],
    [referral?.type, "type", 100],
    [referral?.priority, "priority", 80],
    [referral?.from || referral?.sourceInstitution, "source institution", 200],
    [referral?.to || referral?.targetInstitution, "target institution", 200],
    [referral?.lastUpdated || referral?.updatedAt, "updated timestamp", 80]
  ];
  for (const [value, field, max] of fields) {
    boundedCommandText(value, { field, max, code: "REFERRAL_AGGREGATE_FIELD_TOO_LONG" });
  }
}

function createReferralCommandService({
  readState,
  writeState,
  now = () => new Date().toISOString(),
  canAccessResident = (actor, residentId) => actor.role !== "citizen" ||
    actor.residentId === residentId || actor.residentIds.includes(residentId)
}) {
  const adapter = createStateRepositoryAdapter({ readState, writeState });
  const repository = new DomainRepository({ domain: DOMAIN, adapter });

  async function executeUpdate({
    referralId,
    commandId,
    expectedVersion,
    correlationId,
    actor = {},
    input = {},
    source = "direct"
  }) {
    const normalizedReferralId = boundedCommandText(referralId, {
      field: "referral id", max: 200, code: "REFERRAL_ID_TOO_LONG", required: true, requiredCode: "REFERRAL_ID_REQUIRED"
    });
    const normalizedCommandId = boundedCommandText(commandId, {
      field: "Idempotency-Key", max: 160, code: "REFERRAL_COMMAND_ID_TOO_LONG", required: true, requiredCode: "REFERRAL_COMMAND_ID_REQUIRED"
    });
    const normalizedCorrelationId = boundedCommandText(correlationId, {
      field: "correlation id", max: 240, code: "REFERRAL_CORRELATION_ID_TOO_LONG"
    });
    const normalizedSource = boundedCommandText(source, {
      field: "command source", max: 20, code: "REFERRAL_COMMAND_SOURCE_INVALID", required: true
    });
    if (!Object.hasOwn(COMMAND_SOURCE_ROLES, normalizedSource)) {
      throw new ReferralCommandError("REFERRAL_COMMAND_SOURCE_INVALID", "unsupported referral command source");
    }
    const normalizedActor = normalizeCommandActor(actor);
    if (!Number.isInteger(Number(expectedVersion)) || Number(expectedVersion) < 1) {
      throw new ReferralCommandError("REFERRAL_EXPECTED_VERSION_REQUIRED", "positive expectedVersion is required");
    }
    const commandInput = normalizedSource === "task"
      ? taskCommandIntent(input, normalizedActor)
      : Object.freeze({ patch: cleanReferralPatch(input) });
    if (normalizedSource !== "task" && Object.keys(commandInput.patch).length === 0) {
      throw new ReferralCommandError("REFERRAL_PATCH_REQUIRED", "referral update requires allowed fields");
    }
    const intent = {
      referralId: normalizedReferralId,
      expectedVersion: Number(expectedVersion),
      source: normalizedSource,
      actor: {
        id: normalizedActor.id || normalizedActor.username || normalizedActor.role,
        role: normalizedActor.role,
        orgCode: normalizedActor.orgCode,
        residentId: normalizedActor.residentId
      },
      input: commandInput
    };
    const intentDigest = digest(intent);
    const state = readState();
    const authorizationTarget = referralRows(state).find((item) => item.id === normalizedReferralId);
    if (!authorizationTarget) throw new ReferralCommandError("REFERRAL_NOT_FOUND", "referral was not found", 404);
    authorizeReferralCommand({
      state,
      referral: authorizationTarget,
      actor: normalizedActor,
      source: normalizedSource,
      commandInput,
      canAccessResident
    });
    const receipt = (Array.isArray(state.referralSystem?.[INBOX_COLLECTION])
      ? state.referralSystem[INBOX_COLLECTION]
      : [])
      .find((item) => item.commandId === normalizedCommandId);
    if (receipt) {
      if (receipt.intentDigest !== intentDigest || receipt.aggregateId !== normalizedReferralId) {
        throw new ReferralCommandError(
          "REFERRAL_COMMAND_IDEMPOTENCY_CONFLICT",
          "idempotency key was already used for a different referral command",
          409
        );
      }
      const referral = referralRows(state).find((item) => item.id === receipt.aggregateId);
      const event = (Array.isArray(state.referralSystem?.[OUTBOX_COLLECTION])
        ? state.referralSystem[OUTBOX_COLLECTION]
        : [])
        .find((item) => item.id === receipt.eventId);
      if (!referral || !event || !receipt.result) {
        throw new ReferralCommandError("REFERRAL_REPLAY_INTEGRITY_FAILED", "idempotent referral receipt is incomplete", 500);
      }
      return Object.freeze({
        replayed: true,
        referral: structuredClone(receipt.result),
        contract: structuredClone(event.payload.contract),
        event: domainEventFromOutbox(event)
      });
    }

    const current = await repository.get("referrals", normalizedReferralId);
    if (!current) throw new ReferralCommandError("REFERRAL_NOT_FOUND", "referral was not found", 404);
    const actualVersion = currentVersion(current);
    if (Number(expectedVersion) !== actualVersion) {
      throw new ReferralCommandError(
        "REFERRAL_VERSION_CONFLICT",
        `referral version conflict: expected ${expectedVersion}, current ${actualVersion}`,
        409
      );
    }
    const occurredAt = now();
    const patch = normalizedSource === "task"
      ? buildTaskPatch(commandInput, normalizedActor, current, occurredAt)
      : commandInput.patch;
    const next = {
      ...current,
      ...patch,
      version: actualVersion + 1,
      lastUpdated: occurredAt,
      updatedBy: normalizedActor.username || normalizedActor.id || normalizedActor.role,
      updatedByName: normalizedActor.name
    };
    validateReferralContractFields(next);
    const contract = buildReferralOrderContract(next);
    const eventId = `referral-event-${digest({ commandId: normalizedCommandId, referralId: normalizedReferralId }).slice(0, 32)}`;
    const event = createDomainEvent({
      id: eventId,
      domain: DOMAIN,
      type: EVENT_TYPE,
      aggregateId: normalizedReferralId,
      aggregateVersion: next.version,
      correlationId: normalizedCorrelationId,
      causationId: normalizedCommandId,
      occurredAt,
      payload: {
        commandId: normalizedCommandId,
        intentDigest,
        contract
      }
    });
    const unitOfWork = repository.unitOfWork({ correlationId: normalizedCorrelationId });
    unitOfWork
      .put("referrals", normalizedReferralId, next, actualVersion)
      .publish(event);
    await unitOfWork.commit();
    return Object.freeze({
      replayed: false,
      referral: structuredClone(next),
      contract,
      event: structuredClone(event)
    });
  }

  function update(input) {
    return serializeReferralState(() => executeUpdate(input));
  }

  return Object.freeze({ update });
}

function deliveryError(code, message, statusCode = 409) {
  return new ReferralCommandError(code, message, statusCode);
}

function leaseDigest(token) {
  return digest({ leaseToken: String(token || "") });
}

function publicDeliveryItem(event) {
  return Object.freeze({
    id: event.id,
    type: event.type,
    status: event.status || "pending",
    attempts: Number(event.attempts || 0),
    deliveryVersion: Number(event.deliveryVersion || 0),
    createdAt: event.createdAt || event.occurredAt,
    nextAttemptAt: event.nextAttemptAt || null,
    leaseExpiresAt: event.lease?.expiresAt || null,
    deliveredAt: event.deliveredAt || null,
    deadLetteredAt: event.deadLetteredAt || null,
    lastErrorCode: event.lastError?.code || null,
    replayCount: Number(event.replayCount || 0)
  });
}

function buildReferralDeliveryOperations(state, options = {}) {
  const rows = Array.isArray(state?.referralSystem?.[OUTBOX_COLLECTION])
    ? state.referralSystem[OUTBOX_COLLECTION]
    : [];
  const limit = Math.min(500, Math.max(1, Number(options.limit) || 100));
  const statuses = ["pending", "retry_wait", "leased", "delivered", "dead_letter"];
  const summary = Object.fromEntries(statuses.map((status) => [
    status,
    rows.filter((event) => (event.status || "pending") === status).length
  ]));
  const now = dateValue(options.now || new Date().toISOString()).toISOString();
  return Object.freeze({
    generatedAt: now,
    summary: Object.freeze({ total: rows.length, ...summary }),
    events: rows.slice(0, limit).map(publicDeliveryItem),
    returnedEvents: Math.min(rows.length, limit),
    replayEvidenceCount: Array.isArray(state?.referralSystem?.[REPLAY_COLLECTION])
      ? state.referralSystem[REPLAY_COLLECTION].length
      : 0,
    transportConfigured: false,
    signingConfigured: false,
    productionReady: false,
    blockers: Object.freeze([
      "external referral transport is not configured",
      "transport signing credentials are not configured",
      "claim serialization is process-local; cross-process database CAS is not implemented",
      "production referral delivery worker is not configured"
    ])
  });
}

function createReferralDeliveryService({
  readState,
  writeState,
  now = () => new Date().toISOString(),
  maxAttempts = 5,
  retryBaseMs = 1000,
  retryMaxMs = 15 * 60 * 1000
}) {
  if (typeof readState !== "function" || typeof writeState !== "function") {
    throw new TypeError("referral delivery service requires readState and writeState");
  }
  const attemptLimit = Math.min(100, Math.max(1, Number(maxAttempts) || 5));
  const retryBase = Math.max(1, Number(retryBaseMs) || 1000);
  const retryCap = Math.max(retryBase, Number(retryMaxMs) || 15 * 60 * 1000);

  function transact(mutate) {
    return serializeReferralState(async () => {
      const working = structuredClone(readState());
      normalizeDeliveryState(working);
      const result = await mutate(working);
      if (result.changed) await writeState(working);
      return result.value;
    });
  }

  function claim({ workerId, limit = 10, leaseSeconds = 60 } = {}) {
    const normalizedWorkerId = text(workerId, 160);
    if (!normalizedWorkerId) {
      return Promise.reject(deliveryError("REFERRAL_DELIVERY_WORKER_REQUIRED", "workerId is required", 400));
    }
    const claimLimit = Math.min(100, Math.max(1, Number(limit) || 10));
    const leaseMs = Math.min(15 * 60 * 1000, Math.max(1000, (Number(leaseSeconds) || 60) * 1000));
    return transact((working) => {
      const claimedAt = dateValue(now()).toISOString();
      const claimedAtMs = Date.parse(claimedAt);
      let expiredToDeadLetter = false;
      for (const event of working.referralSystem[OUTBOX_COLLECTION]) {
        if (event.status !== "leased"
          || Date.parse(event.lease?.expiresAt || 0) > claimedAtMs
          || Number(event.attempts || 0) < attemptLimit) continue;
        event.status = "dead_letter";
        event.deadLetteredAt = claimedAt;
        event.nextAttemptAt = null;
        event.lastError = {
          code: "DELIVERY_LEASE_EXPIRED",
          messageDigest: digest("delivery lease expired at the maximum attempt limit"),
          failedAt: claimedAt
        };
        event.lease = null;
        const evidence = {
          id: `referral-dead-letter-${event.id}-${event.attempts}`,
          eventId: event.id,
          attempt: event.attempts,
          errorCode: event.lastError.code,
          errorDigest: digest(event.lastError),
          payloadDigest: digest(event.payload),
          recordedAt: claimedAt
        };
        if (!working.referralSystem[DEAD_LETTER_COLLECTION].some((item) => item.id === evidence.id)) {
          working.referralSystem[DEAD_LETTER_COLLECTION].push(evidence);
        }
        expiredToDeadLetter = true;
      }
      const candidates = working.referralSystem[OUTBOX_COLLECTION]
        .filter((event) => {
          const status = event.status || "pending";
          if (status === "leased") return Date.parse(event.lease?.expiresAt || 0) <= claimedAtMs;
          if (!new Set(["pending", "retry_wait"]).has(status)) return false;
          return Date.parse(event.nextAttemptAt || event.createdAt || event.occurredAt || 0) <= claimedAtMs;
        })
        .sort((left, right) => Date.parse(left.createdAt || left.occurredAt || 0) - Date.parse(right.createdAt || right.occurredAt || 0))
        .slice(0, claimLimit);
      const claims = candidates.map((event) => {
        const leaseToken = randomUUID();
        event.status = "leased";
        event.attempts = Number(event.attempts || 0) + 1;
        event.deliveryVersion = Number(event.deliveryVersion || 0) + 1;
        event.lease = {
          token: leaseToken,
          workerId: normalizedWorkerId,
          claimedAt,
          expiresAt: new Date(claimedAtMs + leaseMs).toISOString(),
          deliveryVersion: event.deliveryVersion
        };
        event.nextAttemptAt = null;
        return Object.freeze({
          id: event.id,
          type: event.type,
          payload: structuredClone(event.payload),
          contractId: event.contractId,
          aggregateVersion: event.aggregateVersion,
          correlationId: event.correlationId,
          leaseToken,
          leaseExpiresAt: event.lease.expiresAt,
          deliveryVersion: event.deliveryVersion,
          attempt: event.attempts
        });
      });
      return { changed: expiredToDeadLetter || claims.length > 0, value: Object.freeze(claims) };
    });
  }

  function validateActiveLease(event, token, workerId, at) {
    if (!event) throw deliveryError("REFERRAL_DELIVERY_EVENT_NOT_FOUND", "referral delivery event was not found", 404);
    const digestValue = leaseDigest(token);
    if (event.status === "delivered" && event.deliveryReceipt?.leaseDigest === digestValue) {
      return { replayed: true, digestValue };
    }
    if (event.status !== "leased"
      || !event.lease
      || event.lease.token !== String(token || "")
      || (workerId && event.lease.workerId !== text(workerId, 160))
      || Date.parse(event.lease.expiresAt) <= Date.parse(at)
      || Number(event.lease.deliveryVersion) !== Number(event.deliveryVersion)) {
      throw deliveryError("REFERRAL_DELIVERY_LEASE_STALE", "referral delivery lease is stale or invalid");
    }
    return { replayed: false, digestValue };
  }

  function acknowledge({ eventId, leaseToken, workerId, receipt = {} } = {}) {
    return transact((working) => {
      const acknowledgedAt = dateValue(now()).toISOString();
      const event = working.referralSystem[OUTBOX_COLLECTION].find((item) => item.id === text(eventId, 240));
      const lease = validateActiveLease(event, leaseToken, workerId, acknowledgedAt);
      const receiptDigest = digest(receipt);
      if (lease.replayed) {
        if (event.deliveryReceipt?.receiptDigest !== receiptDigest) {
          throw deliveryError(
            "REFERRAL_DELIVERY_ACK_CONFLICT",
            "acknowledgement receipt differs from the persisted receipt"
          );
        }
        return { changed: false, value: Object.freeze({ replayed: true, event: publicDeliveryItem(event) }) };
      }
      event.status = "delivered";
      event.deliveredAt = acknowledgedAt;
      event.deliveryReceipt = {
        leaseDigest: lease.digestValue,
        receiptDigest,
        transportMessageId: text(receipt.transportMessageId, 240),
        statusCode: Number(receipt.statusCode || 0),
        acceptedAt: text(receipt.acceptedAt || acknowledgedAt, 80)
      };
      event.lease = null;
      event.lastError = null;
      return { changed: true, value: Object.freeze({ replayed: false, event: publicDeliveryItem(event) }) };
    });
  }

  function fail({ eventId, leaseToken, workerId, error = {} } = {}) {
    return transact((working) => {
      const failedAt = dateValue(now()).toISOString();
      const event = working.referralSystem[OUTBOX_COLLECTION].find((item) => item.id === text(eventId, 240));
      const lease = validateActiveLease(event, leaseToken, workerId, failedAt);
      if (lease.replayed) {
        throw deliveryError("REFERRAL_DELIVERY_LEASE_STALE", "delivered referral event cannot be failed");
      }
      event.lastError = {
        code: text(error.code || "DELIVERY_FAILED", 120),
        messageDigest: digest(text(error.message || "referral delivery failed", 500)),
        failedAt
      };
      event.lease = null;
      if (Number(event.attempts || 0) >= attemptLimit) {
        event.status = "dead_letter";
        event.deadLetteredAt = failedAt;
        event.nextAttemptAt = null;
        const evidence = {
          id: `referral-dead-letter-${event.id}-${event.attempts}`,
          eventId: event.id,
          attempt: event.attempts,
          errorCode: event.lastError.code,
          errorDigest: digest(event.lastError),
          payloadDigest: digest(event.payload),
          recordedAt: failedAt
        };
        if (!working.referralSystem[DEAD_LETTER_COLLECTION].some((item) => item.id === evidence.id)) {
          working.referralSystem[DEAD_LETTER_COLLECTION].push(evidence);
        }
      } else {
        const backoffMs = Math.min(retryCap, retryBase * (2 ** Math.max(0, event.attempts - 1)));
        event.status = "retry_wait";
        event.nextAttemptAt = new Date(Date.parse(failedAt) + backoffMs).toISOString();
      }
      return { changed: true, value: Object.freeze({ event: publicDeliveryItem(event) }) };
    });
  }

  function replayDeadLetter({ eventId, replayId, actor = {}, reason } = {}) {
    const normalizedReplayId = text(replayId, 160);
    const normalizedEventId = text(eventId, 240);
    const normalizedReason = text(reason, 500);
    if (!normalizedReplayId) {
      return Promise.reject(deliveryError("REFERRAL_DELIVERY_REPLAY_ID_REQUIRED", "Idempotency-Key is required", 400));
    }
    if (normalizedReason.length < 12) {
      return Promise.reject(deliveryError("REFERRAL_DELIVERY_REPLAY_REASON_REQUIRED", "replay reason must contain at least 12 characters", 400));
    }
    return transact((working) => {
      const requestedAt = dateValue(now()).toISOString();
      const intentDigest = digest({ eventId: normalizedEventId, reason: normalizedReason });
      const replayKeyDigest = digest({ replayId: normalizedReplayId });
      let migratedReplayEvidence = false;
      for (const item of working.referralSystem[REPLAY_COLLECTION]) {
        if (!item.replayId) continue;
        item.replayKeyDigest = item.replayKeyDigest || digest({ replayId: text(item.replayId, 160) });
        delete item.replayId;
        migratedReplayEvidence = true;
      }
      const existing = working.referralSystem[REPLAY_COLLECTION]
        .find((item) => item.replayKeyDigest === replayKeyDigest);
      if (existing) {
        if (existing.intentDigest !== intentDigest) {
          throw deliveryError("REFERRAL_DELIVERY_REPLAY_CONFLICT", "replay id was already used for another intent");
        }
        const event = working.referralSystem[OUTBOX_COLLECTION].find((item) => item.id === existing.eventId);
        if (!event || !existing.result) {
          throw deliveryError("REFERRAL_DELIVERY_REPLAY_INTEGRITY_FAILED", "replay evidence is incomplete", 500);
        }
        return {
          changed: migratedReplayEvidence,
          value: Object.freeze({ replayed: true, event: structuredClone(existing.result), evidenceId: existing.id })
        };
      }
      const event = working.referralSystem[OUTBOX_COLLECTION].find((item) => item.id === normalizedEventId);
      if (!event) throw deliveryError("REFERRAL_DELIVERY_EVENT_NOT_FOUND", "referral delivery event was not found", 404);
      if (event.status !== "dead_letter") {
        throw deliveryError("REFERRAL_DELIVERY_NOT_DEAD_LETTER", "only dead-letter referral events can be replayed");
      }
      const evidence = {
        id: `referral-replay-${replayKeyDigest.slice(0, 32)}`,
        replayKeyDigest,
        eventId: normalizedEventId,
        intentDigest,
        reasonDigest: digest(normalizedReason),
        requestedBy: text(actor.username || actor.id || actor.role, 160),
        requestedAt
      };
      working.referralSystem[REPLAY_COLLECTION].push(evidence);
      event.status = "retry_wait";
      event.attempts = 0;
      event.nextAttemptAt = requestedAt;
      event.deadLetteredAt = null;
      event.lastError = null;
      event.lease = null;
      event.replayCount = Number(event.replayCount || 0) + 1;
      event.lastReplayEvidenceId = evidence.id;
      evidence.result = structuredClone(publicDeliveryItem(event));
      return {
        changed: true,
        value: Object.freeze({ replayed: false, event: structuredClone(evidence.result), evidenceId: evidence.id })
      };
    });
  }

  return Object.freeze({ acknowledge, claim, fail, replayDeadLetter });
}

module.exports = {
  CONTRACT_ID,
  DEAD_LETTER_COLLECTION,
  EVENT_TYPE,
  INBOX_COLLECTION,
  OUTBOX_COLLECTION,
  REPLAY_COLLECTION,
  ReferralCommandError,
  buildReferralOrderContract,
  buildReferralDeliveryOperations,
  createReferralCommandService,
  createReferralDeliveryService,
  createReferralOrderAntiCorruptionAdapter
};
