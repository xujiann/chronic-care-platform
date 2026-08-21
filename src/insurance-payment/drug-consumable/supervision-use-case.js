"use strict";

const { createHash } = require("node:crypto");

const CONTRACT = Object.freeze({
  id: "drug-consumable-supervision-decision.v1",
  version: "1.0.0",
  owner: "insurance-payment",
  processOwner: "T07"
});

const ACTIONS = Object.freeze({
  SUBMIT_REVIEW: "submit-review",
  PHARMACIST_REVIEW: "pharmacist-review",
  COMMITTEE_CONFIRM: "committee-confirm",
  COMMITTEE_RETURN: "committee-return"
});

const DECISION_STATUSES = Object.freeze({
  DRAFT: "draft",
  REVIEW_SUBMITTED: "review-submitted",
  PHARMACIST_REVIEWED: "pharmacist-reviewed",
  COMMITTEE_CONFIRMED: "committee-confirmed",
  COMMITTEE_RETURNED: "committee-returned"
});

const ACTION_ROLES = Object.freeze({
  [ACTIONS.SUBMIT_REVIEW]: "doctor",
  [ACTIONS.PHARMACIST_REVIEW]: "pharmacist",
  [ACTIONS.COMMITTEE_CONFIRM]: "pharmacy-committee",
  [ACTIONS.COMMITTEE_RETURN]: "pharmacy-committee"
});

const TRANSITIONS = Object.freeze({
  [DECISION_STATUSES.DRAFT]: Object.freeze({
    [ACTIONS.SUBMIT_REVIEW]: DECISION_STATUSES.REVIEW_SUBMITTED
  }),
  [DECISION_STATUSES.REVIEW_SUBMITTED]: Object.freeze({
    [ACTIONS.PHARMACIST_REVIEW]: DECISION_STATUSES.PHARMACIST_REVIEWED
  }),
  [DECISION_STATUSES.PHARMACIST_REVIEWED]: Object.freeze({
    [ACTIONS.COMMITTEE_CONFIRM]: DECISION_STATUSES.COMMITTEE_CONFIRMED,
    [ACTIONS.COMMITTEE_RETURN]: DECISION_STATUSES.COMMITTEE_RETURNED
  }),
  [DECISION_STATUSES.COMMITTEE_CONFIRMED]: Object.freeze({}),
  [DECISION_STATUSES.COMMITTEE_RETURNED]: Object.freeze({
    [ACTIONS.SUBMIT_REVIEW]: DECISION_STATUSES.REVIEW_SUBMITTED
  })
});

class DrugConsumableSupervisionError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.name = "DrugConsumableSupervisionError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = stableValue(value[key]);
      return result;
    }, {});
  }
  return value;
}

function digest(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex")}`;
}

function text(value) {
  return String(value ?? "").trim();
}

function supervisionError(code, message, statusCode) {
  throw new DrugConsumableSupervisionError(code, message, statusCode);
}

function boundedText(value, maximum, code, label) {
  const normalized = text(value);
  if (normalized.length > maximum) {
    supervisionError(code, `${label} must not exceed ${maximum} characters`);
  }
  return normalized;
}

function normalizeRecord(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    supervisionError("DRUG_SUPERVISION_RECORD_REQUIRED", "drug supervision record is required");
  }
  const record = structuredClone(input);
  record.id = boundedText(
    record.id,
    200,
    "DRUG_SUPERVISION_RECORD_ID_TOO_LONG",
    "drug supervision record id"
  );
  if (!record.id) {
    supervisionError("DRUG_SUPERVISION_RECORD_ID_REQUIRED", "drug supervision record id is required");
  }
  record.orgCode = boundedText(
    record.orgCode,
    160,
    "DRUG_SUPERVISION_RECORD_ORG_CODE_TOO_LONG",
    "drug supervision record orgCode"
  );
  record.regionCode = boundedText(
    record.regionCode,
    160,
    "DRUG_SUPERVISION_RECORD_REGION_CODE_TOO_LONG",
    "drug supervision record regionCode"
  );

  if (record.domainVersion === undefined || record.domainVersion === null || record.domainVersion === "") {
    record.domainVersion = 0;
  } else if (!Number.isInteger(record.domainVersion) || record.domainVersion < 0) {
    supervisionError(
      "DRUG_SUPERVISION_DOMAIN_VERSION_INVALID",
      "drug supervision domainVersion must be a non-negative integer",
      409
    );
  }

  record.decisionStatus = text(record.decisionStatus || DECISION_STATUSES.DRAFT);
  if (!Object.hasOwn(TRANSITIONS, record.decisionStatus)) {
    supervisionError(
      "DRUG_SUPERVISION_DECISION_STATUS_INVALID",
      "drug supervision decision status is not supported",
      409
    );
  }
  if (record.decisionHistory === undefined || record.decisionHistory === null) {
    record.decisionHistory = [];
  } else if (!Array.isArray(record.decisionHistory)) {
    supervisionError(
      "DRUG_SUPERVISION_DECISION_HISTORY_INVALID",
      "drug supervision decisionHistory must be an array",
      409
    );
  }
  return record;
}

function normalizeCommand(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    supervisionError("DRUG_SUPERVISION_COMMAND_REQUIRED", "drug supervision command is required");
  }
  const commandId = boundedText(
    input.commandId,
    160,
    "DRUG_SUPERVISION_COMMAND_ID_TOO_LONG",
    "drug supervision commandId"
  );
  const recordId = boundedText(
    input.recordId,
    200,
    "DRUG_SUPERVISION_COMMAND_RECORD_ID_TOO_LONG",
    "drug supervision command recordId"
  );
  const action = text(input.action);
  if (!commandId) {
    supervisionError("DRUG_SUPERVISION_COMMAND_ID_REQUIRED", "drug supervision commandId is required");
  }
  if (!recordId) {
    supervisionError("DRUG_SUPERVISION_COMMAND_RECORD_ID_REQUIRED", "drug supervision command recordId is required");
  }
  if (!Object.values(ACTIONS).includes(action)) {
    supervisionError("DRUG_SUPERVISION_ACTION_INVALID", "drug supervision action is not supported");
  }
  if (!Number.isInteger(input.expectedDomainVersion) || input.expectedDomainVersion < 0) {
    supervisionError(
      "DRUG_SUPERVISION_EXPECTED_VERSION_REQUIRED",
      "expectedDomainVersion must be a non-negative integer"
    );
  }
  if (input.payload !== undefined && (
    !input.payload
    || typeof input.payload !== "object"
    || Array.isArray(input.payload)
  )) {
    supervisionError("DRUG_SUPERVISION_PAYLOAD_INVALID", "drug supervision payload must be an object");
  }
  const actor = input.actor && typeof input.actor === "object" && !Array.isArray(input.actor)
    ? input.actor
    : {};
  const normalizedActor = {
    id: boundedText(
      actor.id,
      160,
      "DRUG_SUPERVISION_ACTOR_ID_TOO_LONG",
      "drug supervision actor id"
    ),
    role: text(actor.role),
    orgCode: boundedText(
      actor.orgCode,
      160,
      "DRUG_SUPERVISION_ACTOR_ORG_CODE_TOO_LONG",
      "drug supervision actor orgCode"
    ),
    regionCode: boundedText(
      actor.regionCode,
      160,
      "DRUG_SUPERVISION_ACTOR_REGION_CODE_TOO_LONG",
      "drug supervision actor regionCode"
    )
  };
  if (!normalizedActor.id) {
    supervisionError("DRUG_SUPERVISION_ACTOR_REQUIRED", "drug supervision actor id is required");
  }
  const payload = structuredClone(input.payload || {});
  for (const field of ["note", "reason"]) {
    if (Object.hasOwn(payload, field) && text(payload[field]).length > 500) {
      supervisionError(
        "DRUG_SUPERVISION_NOTE_TOO_LONG",
        `drug supervision ${field} must not exceed 500 characters`
      );
    }
  }
  const occurredAt = text(input.occurredAt);
  if (occurredAt.length > 80) {
    supervisionError(
      "DRUG_SUPERVISION_OCCURRED_AT_INVALID",
      "drug supervision command occurredAt is invalid"
    );
  }
  return {
    commandId,
    recordId,
    action,
    expectedDomainVersion: input.expectedDomainVersion,
    actor: normalizedActor,
    payload,
    occurredAt
  };
}

function commandDigest(command) {
  return digest({
    contractId: CONTRACT.id,
    recordId: command.recordId,
    action: command.action,
    expectedDomainVersion: command.expectedDomainVersion,
    actor: command.actor,
    payload: command.payload
  });
}

function authorize(record, command) {
  const requiredRole = ACTION_ROLES[command.action];
  if (command.actor.role !== requiredRole) {
    supervisionError(
      "DRUG_SUPERVISION_ROLE_DENIED",
      `drug supervision action ${command.action} requires role ${requiredRole}`,
      403
    );
  }
  const resourceOrgCode = record.orgCode;
  if (!resourceOrgCode || !command.actor.orgCode || command.actor.orgCode !== resourceOrgCode) {
    supervisionError(
      "DRUG_SUPERVISION_ORG_SCOPE_DENIED",
      "drug supervision record is outside the actor organization scope",
      403
    );
  }
  const resourceRegionCode = record.regionCode;
  if (!resourceRegionCode || !command.actor.regionCode || command.actor.regionCode !== resourceRegionCode) {
    supervisionError(
      "DRUG_SUPERVISION_REGION_SCOPE_DENIED",
      "drug supervision record is outside the actor region scope",
      403
    );
  }
}

function latestDecisionIndex(history, action) {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (history[index]?.action === action) return index;
  }
  return -1;
}

function decisionActorId(decision) {
  const actorId = text(decision?.actor?.id);
  return actorId && actorId.length <= 160 ? actorId : "";
}

function enforceSeparationOfDuties(record, command) {
  if (command.action === ACTIONS.SUBMIT_REVIEW) return;

  const submitIndex = latestDecisionIndex(record.decisionHistory, ACTIONS.SUBMIT_REVIEW);
  const submitterId = decisionActorId(record.decisionHistory[submitIndex]);
  if (submitIndex < 0 || !submitterId) {
    supervisionError(
      "DRUG_SUPERVISION_SEPARATION_OF_DUTIES_UNVERIFIABLE",
      "drug supervision responsibility chain cannot be verified",
      409
    );
  }
  if (command.actor.id === submitterId) {
    supervisionError(
      "DRUG_SUPERVISION_SEPARATION_OF_DUTIES_DENIED",
      "drug supervision actor must be separated from the current review submitter",
      403
    );
  }
  if (command.action === ACTIONS.PHARMACIST_REVIEW) return;

  const pharmacistIndex = latestDecisionIndex(record.decisionHistory, ACTIONS.PHARMACIST_REVIEW);
  const pharmacistId = decisionActorId(record.decisionHistory[pharmacistIndex]);
  if (pharmacistIndex <= submitIndex || !pharmacistId) {
    supervisionError(
      "DRUG_SUPERVISION_SEPARATION_OF_DUTIES_UNVERIFIABLE",
      "drug supervision responsibility chain cannot be verified",
      409
    );
  }
  if (command.actor.id === pharmacistId) {
    supervisionError(
      "DRUG_SUPERVISION_SEPARATION_OF_DUTIES_DENIED",
      "drug supervision committee actor must be separated from the current pharmacist reviewer",
      403
    );
  }
}

function decisionTimestamp(command, options = {}) {
  const supplied = command.occurredAt || text(
    typeof options.now === "function" ? options.now() : new Date().toISOString()
  );
  if (supplied.length > 80) {
    supervisionError(
      "DRUG_SUPERVISION_OCCURRED_AT_INVALID",
      "drug supervision command occurredAt is invalid"
    );
  }
  const parsed = Date.parse(supplied);
  if (!Number.isFinite(parsed)) {
    supervisionError(
      "DRUG_SUPERVISION_OCCURRED_AT_INVALID",
      "drug supervision command occurredAt is invalid"
    );
  }
  return new Date(parsed).toISOString();
}

function replayResult(record, command, requestDigest) {
  const previous = record.decisionHistory.find((item) => item?.commandId === command.commandId);
  if (!previous) return null;
  if (previous.requestDigest !== requestDigest) {
    supervisionError(
      "DRUG_SUPERVISION_IDEMPOTENCY_CONFLICT",
      "drug supervision commandId was already used for a different command",
      409
    );
  }
  return deepFreeze({
    record: structuredClone(record),
    decision: structuredClone(previous),
    replayed: true
  });
}

function applyDrugConsumableSupervisionCommand(inputRecord, inputCommand, options = {}) {
  const record = normalizeRecord(inputRecord);
  const command = normalizeCommand(inputCommand);
  if (record.id !== command.recordId) {
    supervisionError(
      "DRUG_SUPERVISION_RECORD_MISMATCH",
      "drug supervision command recordId does not match the aggregate",
      409
    );
  }
  authorize(record, command);
  const targetStatus = TRANSITIONS[record.decisionStatus]?.[command.action];
  const replayCandidate = record.decisionHistory.some((item) => item?.commandId === command.commandId);
  if (targetStatus || replayCandidate) enforceSeparationOfDuties(record, command);

  const requestDigest = commandDigest(command);
  const replay = replayResult(record, command, requestDigest);
  if (replay) return replay;
  if (record.domainVersion !== command.expectedDomainVersion) {
    supervisionError(
      "DRUG_SUPERVISION_VERSION_CONFLICT",
      `expected domainVersion ${command.expectedDomainVersion}, current ${record.domainVersion}`,
      409
    );
  }

  if (!targetStatus) {
    supervisionError(
      "DRUG_SUPERVISION_INVALID_TRANSITION",
      `${command.action} is not allowed from ${record.decisionStatus}`,
      409
    );
  }

  const occurredAt = decisionTimestamp(command, options);
  const resultingDomainVersion = record.domainVersion + 1;
  const decision = {
    contractId: CONTRACT.id,
    commandId: command.commandId,
    requestDigest,
    payloadDigest: digest(command.payload),
    occurredAt,
    actor: command.actor,
    action: command.action,
    fromStatus: record.decisionStatus,
    toStatus: targetStatus,
    resultingDomainVersion,
    note: text(command.payload.note) || text(command.payload.reason)
  };
  const updated = {
    ...record,
    decisionStatus: targetStatus,
    domainVersion: resultingDomainVersion,
    decisionHistory: [...record.decisionHistory, decision],
    lastDecisionAt: occurredAt,
    lastDecisionBy: {
      id: command.actor.id,
      role: command.actor.role
    }
  };
  return deepFreeze({
    record: updated,
    decision,
    replayed: false
  });
}

module.exports = {
  ACTION_ROLES,
  ACTIONS,
  CONTRACT,
  DECISION_STATUSES,
  TRANSITIONS,
  DrugConsumableSupervisionError,
  applyDrugConsumableSupervisionCommand
};
