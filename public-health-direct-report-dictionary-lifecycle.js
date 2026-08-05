"use strict";

const {
  normalizeDictionary,
  sha256,
  stableStringify
} = require("./public-health-direct-report-control-package");

const SCHEMA_VERSION = "public-health-direct-report-dictionary-lifecycle-v1";
const CONTROLLED_REFERENCE = /^(?:artifact|cmdb|evidence|ticket|vault):\/\/[A-Za-z0-9._~:/?#@!$&'()*+,;=%-]+$/;
const DIGEST = /^[a-f0-9]{64}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,159}$/;
const ACTIONS = new Set([
  "propose",
  "review",
  "activate",
  "request-rollback",
  "review-rollback",
  "execute-rollback"
]);
const ACTION_ROLES = Object.freeze({
  propose: Object.freeze(["data-governance", "commission"]),
  review: Object.freeze([
    "disease-control-office",
    "hospital-information-center",
    "commission"
  ]),
  activate: Object.freeze(["platform-operations"]),
  "request-rollback": Object.freeze(["platform-operations"]),
  "review-rollback": Object.freeze([
    "disease-control-office",
    "hospital-information-center",
    "commission"
  ]),
  "execute-rollback": Object.freeze(["platform-operations"])
});

class DictionaryLifecycleError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.name = "DictionaryLifecycleError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function clean(value, maximum = 240) {
  return String(value ?? "").trim().replace(/[\r\n\t]+/g, " ").slice(0, maximum);
}

function requiredId(value, label) {
  const result = clean(value, 160);
  if (!SAFE_ID.test(result)) {
    throw new DictionaryLifecycleError(
      "PUBLIC_HEALTH_DIRECT_REPORT_DICTIONARY_LIFECYCLE_INPUT_INVALID",
      `${label} must be a safe identifier`
    );
  }
  return result;
}

function isoTime(value, label) {
  const parsed = Date.parse(String(value || ""));
  if (!Number.isFinite(parsed)) {
    throw new DictionaryLifecycleError(
      "PUBLIC_HEALTH_DIRECT_REPORT_DICTIONARY_LIFECYCLE_TIME_INVALID",
      `${label} must be a valid date-time`
    );
  }
  return new Date(parsed).toISOString();
}

function controlledReference(value, label) {
  const result = clean(value, 400);
  if (!CONTROLLED_REFERENCE.test(result)) {
    throw new DictionaryLifecycleError(
      "PUBLIC_HEALTH_DIRECT_REPORT_DICTIONARY_LIFECYCLE_REFERENCE_INVALID",
      `${label} must be a controlled reference`
    );
  }
  return result;
}

function digest(value, label) {
  const result = clean(value, 64).toLowerCase();
  if (!DIGEST.test(result)) {
    throw new DictionaryLifecycleError(
      "PUBLIC_HEALTH_DIRECT_REPORT_DICTIONARY_LIFECYCLE_DIGEST_INVALID",
      `${label} must be a SHA-256 digest`
    );
  }
  return result;
}

function actor(input = {}) {
  return {
    actorRef: `sha256:${sha256(requiredId(input.id, "actor id"))}`,
    role: requiredId(input.role, "actor role")
  };
}

function dictionarySnapshot(result) {
  return {
    dictionaryId: result.dictionary.dictionaryId,
    dictionaryVersion: result.dictionary.version,
    dictionaryDigest: result.dictionaryDigest,
    mappingFingerprint: result.mappingFingerprint,
    effectiveAt: result.dictionary.effectiveAt,
    expiresAt: result.dictionary.expiresAt,
    sourceRef: result.dictionary.sourceRef,
    mappedFields: result.dictionary.fieldMappings.length,
    codeSystems: result.dictionary.codeSystems.map(({ id, version, digest: codeDigest }) => ({
      id,
      version,
      digest: codeDigest
    }))
  };
}

function normalizeCandidate(dictionary, nowMs) {
  const effectiveAtMs = Date.parse(String(dictionary?.effectiveAt || ""));
  const evaluationMs = Math.max(Number(nowMs), Number.isFinite(effectiveAtMs) ? effectiveAtMs : 0);
  return normalizeDictionary(dictionary, { nowMs: evaluationMs });
}

function dictionaryDiff(active, candidate) {
  const activeMappings = new Map(
    active.dictionary.fieldMappings.map((item) => [item.platformField, item])
  );
  const candidateMappings = new Map(
    candidate.dictionary.fieldMappings.map((item) => [item.platformField, item])
  );
  const fields = [...new Set([...activeMappings.keys(), ...candidateMappings.keys()])].sort();
  const addedFields = fields.filter((field) => !activeMappings.has(field));
  const removedFields = fields.filter((field) => !candidateMappings.has(field));
  const changedFields = fields.filter((field) => {
    const left = activeMappings.get(field);
    const right = candidateMappings.get(field);
    return left && right && stableStringify(left) !== stableStringify(right);
  });
  const activeSystems = new Map(active.dictionary.codeSystems.map((item) => [item.id, item]));
  const candidateSystems = new Map(candidate.dictionary.codeSystems.map((item) => [item.id, item]));
  const changedCodeSystems = [...candidateSystems.keys()]
    .filter((id) => {
      const left = activeSystems.get(id);
      const right = candidateSystems.get(id);
      return !left || left.version !== right.version || left.digest !== right.digest;
    })
    .sort();
  return {
    addedFields,
    removedFields,
    changedFields,
    changedCodeSystems,
    mappingChanged: active.mappingFingerprint !== candidate.mappingFingerprint,
    dictionaryChanged: active.dictionaryDigest !== candidate.dictionaryDigest,
    codeValuesExposed: false
  };
}

function eventDigest(event) {
  const { digest: ignored, ...subject } = event;
  return sha256(subject);
}

function appendEvent(state, details) {
  const previousDigest = state.events.at(-1)?.digest || "0".repeat(64);
  const event = {
    sequence: state.events.length + 1,
    previousDigest,
    ...details
  };
  event.digest = eventDigest(event);
  state.events.push(event);
  return event;
}

function assertLedger(state) {
  if (
    !state
    || state.schemaVersion !== SCHEMA_VERSION
    || !SAFE_ID.test(clean(state.ledgerId, 160))
    || !Number.isInteger(state.version)
    || state.version < 1
    || !state.active?.dictionaryDigest
    || !Array.isArray(state.events)
    || !Array.isArray(state.commands)
  ) {
    throw new DictionaryLifecycleError(
      "PUBLIC_HEALTH_DIRECT_REPORT_DICTIONARY_LIFECYCLE_STATE_INVALID",
      "dictionary lifecycle state is invalid"
    );
  }
  let previousDigest = "0".repeat(64);
  state.events.forEach((event, index) => {
    if (
      event.sequence !== index + 1
      || event.previousDigest !== previousDigest
      || event.digest !== eventDigest(event)
    ) {
      throw new DictionaryLifecycleError(
        "PUBLIC_HEALTH_DIRECT_REPORT_DICTIONARY_LIFECYCLE_CHAIN_INVALID",
        "dictionary lifecycle event chain is invalid",
        409
      );
    }
    previousDigest = event.digest;
  });
}

function createDictionaryLifecycleLedger(activeDictionary, options = {}) {
  const now = isoTime(options.now || new Date().toISOString(), "creation time");
  const normalized = normalizeDictionary(activeDictionary, { nowMs: Date.parse(now) });
  const createdBy = actor(options.actor || {});
  const state = {
    schemaVersion: SCHEMA_VERSION,
    ledgerId: requiredId(options.ledgerId || "public-health-direct-report-dictionary", "ledger id"),
    version: 1,
    active: dictionarySnapshot(normalized),
    previousActive: null,
    candidate: null,
    rollbackRequest: null,
    events: [],
    commands: [],
    productionReady: false
  };
  appendEvent(state, {
    type: "ledger-created",
    at: now,
    actorRef: createdBy.actorRef,
    actorRole: createdBy.role,
    dictionaryDigest: state.active.dictionaryDigest,
    mappingFingerprint: state.active.mappingFingerprint
  });
  return state;
}

function commandSubject(command, performedBy) {
  return {
    action: clean(command.action, 80),
    expectedVersion: Number(command.expectedVersion),
    idempotencyKey: clean(command.idempotencyKey, 160),
    actorRef: performedBy.actorRef,
    actorRole: performedBy.role,
    payload: command.payload || {}
  };
}

function requireActionRole(action, performedBy) {
  if (!ACTION_ROLES[action]?.includes(performedBy.role)) {
    throw new DictionaryLifecycleError(
      "PUBLIC_HEALTH_DIRECT_REPORT_DICTIONARY_LIFECYCLE_ROLE_FORBIDDEN",
      `actor role is not allowed to perform ${action}`,
      403
    );
  }
}

function existingReceipt(state, idempotencyKey, commandDigest) {
  const existing = state.commands.find((item) => item.idempotencyKey === idempotencyKey);
  if (!existing) return null;
  if (existing.commandDigest !== commandDigest) {
    throw new DictionaryLifecycleError(
      "PUBLIC_HEALTH_DIRECT_REPORT_DICTIONARY_LIFECYCLE_IDEMPOTENCY_CONFLICT",
      "dictionary lifecycle idempotency key was reused for a different command",
      409
    );
  }
  return existing;
}

function requireExpectedVersion(state, command) {
  if (!Number.isInteger(command.expectedVersion) || command.expectedVersion !== state.version) {
    throw new DictionaryLifecycleError(
      "PUBLIC_HEALTH_DIRECT_REPORT_DICTIONARY_LIFECYCLE_VERSION_CONFLICT",
      "dictionary lifecycle expectedVersion does not match",
      409
    );
  }
}

function proposalPayload(payload, activeResult, nowMs) {
  const candidateResult = normalizeCandidate(payload.dictionary, nowMs);
  if (
    candidateResult.dictionary.dictionaryId !== activeResult.dictionary.dictionaryId
    || candidateResult.dictionary.version === activeResult.dictionary.version
    || candidateResult.dictionaryDigest === activeResult.dictionaryDigest
  ) {
    throw new DictionaryLifecycleError(
      "PUBLIC_HEALTH_DIRECT_REPORT_DICTIONARY_CANDIDATE_INVALID",
      "candidate must be a new version of the active dictionary",
      409
    );
  }
  return {
    proposalId: requiredId(payload.proposalId, "proposal id"),
    dictionary: dictionarySnapshot(candidateResult),
    diff: dictionaryDiff(activeResult, candidateResult),
    reason: clean(payload.reason, 300),
    evidenceRef: controlledReference(payload.evidenceRef, "proposal evidence"),
    evidenceDigest: digest(payload.evidenceDigest, "proposal evidence digest")
  };
}

function applyDictionaryLifecycleCommand(currentState, command = {}, options = {}) {
  const state = structuredClone(currentState);
  assertLedger(state);
  const action = clean(command.action, 80);
  if (!ACTIONS.has(action)) {
    throw new DictionaryLifecycleError(
      "PUBLIC_HEALTH_DIRECT_REPORT_DICTIONARY_LIFECYCLE_ACTION_INVALID",
      "dictionary lifecycle action is not supported"
    );
  }
  const performedBy = actor(command.actor || {});
  requireActionRole(action, performedBy);
  const idempotencyKey = requiredId(command.idempotencyKey, "idempotency key");
  const subject = commandSubject(command, performedBy);
  const commandDigest = sha256(subject);
  const receipt = existingReceipt(state, idempotencyKey, commandDigest);
  if (receipt) {
    return {
      state: structuredClone(currentState),
      receipt: structuredClone(receipt),
      idempotent: true
    };
  }
  requireExpectedVersion(state, command);
  const now = isoTime(options.now || new Date().toISOString(), "command time");
  const payload = command.payload || {};
  let result = {};

  if (action === "propose") {
    if (state.candidate && state.candidate.status !== "rejected") {
      throw new DictionaryLifecycleError(
        "PUBLIC_HEALTH_DIRECT_REPORT_DICTIONARY_CANDIDATE_OPEN",
        "an unresolved dictionary candidate already exists",
        409
      );
    }
    if (state.candidate?.status === "rejected") state.candidate = null;
    const activeDictionary = options.activeDictionary;
    if (!activeDictionary) {
      throw new DictionaryLifecycleError(
        "PUBLIC_HEALTH_DIRECT_REPORT_DICTIONARY_ACTIVE_SOURCE_REQUIRED",
        "the active dictionary source is required to calculate a candidate diff"
      );
    }
    const activeResult = normalizeDictionary(activeDictionary, { nowMs: Date.parse(now) });
    if (activeResult.dictionaryDigest !== state.active.dictionaryDigest) {
      throw new DictionaryLifecycleError(
        "PUBLIC_HEALTH_DIRECT_REPORT_DICTIONARY_ACTIVE_DRIFT",
        "active dictionary source no longer matches the lifecycle ledger",
        409
      );
    }
    const proposal = proposalPayload(payload, activeResult, Date.parse(now));
    state.candidate = {
      ...proposal,
      status: "pending-review",
      proposedAt: now,
      proposedBy: performedBy.actorRef,
      reviewedAt: "",
      reviewedBy: "",
      reviewEvidenceRef: "",
      reviewEvidenceDigest: ""
    };
    result = {
      proposalId: proposal.proposalId,
      candidateDigest: proposal.dictionary.dictionaryDigest,
      status: state.candidate.status
    };
  } else if (action === "review") {
    if (!state.candidate || state.candidate.status !== "pending-review") {
      throw new DictionaryLifecycleError(
        "PUBLIC_HEALTH_DIRECT_REPORT_DICTIONARY_REVIEW_NOT_ALLOWED",
        "no pending dictionary candidate is available for review",
        409
      );
    }
    if (state.candidate.proposedBy === performedBy.actorRef) {
      throw new DictionaryLifecycleError(
        "PUBLIC_HEALTH_DIRECT_REPORT_DICTIONARY_REVIEW_NOT_INDEPENDENT",
        "dictionary candidate reviewer must differ from proposer",
        403
      );
    }
    const decision = clean(payload.decision, 40);
    if (!["approve", "reject"].includes(decision)) {
      throw new DictionaryLifecycleError(
        "PUBLIC_HEALTH_DIRECT_REPORT_DICTIONARY_REVIEW_DECISION_INVALID",
        "dictionary review decision must be approve or reject"
      );
    }
    state.candidate.status = decision === "approve" ? "approved" : "rejected";
    state.candidate.reviewedAt = now;
    state.candidate.reviewedBy = performedBy.actorRef;
    state.candidate.reviewEvidenceRef = controlledReference(
      payload.evidenceRef,
      "review evidence"
    );
    state.candidate.reviewEvidenceDigest = digest(
      payload.evidenceDigest,
      "review evidence digest"
    );
    result = { proposalId: state.candidate.proposalId, status: state.candidate.status };
  } else if (action === "activate") {
    if (!state.candidate || state.candidate.status !== "approved") {
      throw new DictionaryLifecycleError(
        "PUBLIC_HEALTH_DIRECT_REPORT_DICTIONARY_ACTIVATION_NOT_ALLOWED",
        "only an independently approved candidate can be activated",
        409
      );
    }
    if (Date.parse(now) < Date.parse(state.candidate.dictionary.effectiveAt)) {
      throw new DictionaryLifecycleError(
        "PUBLIC_HEALTH_DIRECT_REPORT_DICTIONARY_ACTIVATION_TOO_EARLY",
        "candidate dictionary effective time has not arrived",
        409
      );
    }
    const activationEvidenceRef = controlledReference(
      payload.evidenceRef,
      "activation evidence"
    );
    const activationEvidenceDigest = digest(
      payload.evidenceDigest,
      "activation evidence digest"
    );
    state.previousActive = structuredClone(state.active);
    state.active = structuredClone(state.candidate.dictionary);
    state.active.activatedAt = now;
    state.active.activationEvidenceRef = activationEvidenceRef;
    state.active.activationEvidenceDigest = activationEvidenceDigest;
    result = {
      proposalId: state.candidate.proposalId,
      dictionaryDigest: state.active.dictionaryDigest,
      status: "activated"
    };
    state.candidate = null;
    state.rollbackRequest = null;
  } else if (action === "request-rollback") {
    if (
      !state.previousActive
      || (state.rollbackRequest && state.rollbackRequest.status !== "rejected")
    ) {
      throw new DictionaryLifecycleError(
        "PUBLIC_HEALTH_DIRECT_REPORT_DICTIONARY_ROLLBACK_NOT_AVAILABLE",
        "dictionary rollback is not available",
        409
      );
    }
    if (state.rollbackRequest?.status === "rejected") state.rollbackRequest = null;
    state.rollbackRequest = {
      requestId: requiredId(payload.requestId, "rollback request id"),
      target: structuredClone(state.previousActive),
      reason: clean(payload.reason, 300),
      evidenceRef: controlledReference(payload.evidenceRef, "rollback request evidence"),
      evidenceDigest: digest(payload.evidenceDigest, "rollback request evidence digest"),
      status: "pending-review",
      requestedAt: now,
      requestedBy: performedBy.actorRef,
      reviewedAt: "",
      reviewedBy: ""
    };
    result = { requestId: state.rollbackRequest.requestId, status: "pending-review" };
  } else if (action === "review-rollback") {
    if (!state.rollbackRequest || state.rollbackRequest.status !== "pending-review") {
      throw new DictionaryLifecycleError(
        "PUBLIC_HEALTH_DIRECT_REPORT_DICTIONARY_ROLLBACK_REVIEW_NOT_ALLOWED",
        "no pending rollback request is available",
        409
      );
    }
    if (state.rollbackRequest.requestedBy === performedBy.actorRef) {
      throw new DictionaryLifecycleError(
        "PUBLIC_HEALTH_DIRECT_REPORT_DICTIONARY_ROLLBACK_REVIEW_NOT_INDEPENDENT",
        "rollback reviewer must differ from requester",
        403
      );
    }
    const decision = clean(payload.decision, 40);
    if (!["approve", "reject"].includes(decision)) {
      throw new DictionaryLifecycleError(
        "PUBLIC_HEALTH_DIRECT_REPORT_DICTIONARY_REVIEW_DECISION_INVALID",
        "rollback review decision must be approve or reject"
      );
    }
    state.rollbackRequest.status = decision === "approve" ? "approved" : "rejected";
    state.rollbackRequest.reviewedAt = now;
    state.rollbackRequest.reviewedBy = performedBy.actorRef;
    state.rollbackRequest.reviewEvidenceRef = controlledReference(
      payload.evidenceRef,
      "rollback review evidence"
    );
    state.rollbackRequest.reviewEvidenceDigest = digest(
      payload.evidenceDigest,
      "rollback review evidence digest"
    );
    result = {
      requestId: state.rollbackRequest.requestId,
      status: state.rollbackRequest.status
    };
  } else if (action === "execute-rollback") {
    if (!state.rollbackRequest || state.rollbackRequest.status !== "approved") {
      throw new DictionaryLifecycleError(
        "PUBLIC_HEALTH_DIRECT_REPORT_DICTIONARY_ROLLBACK_EXECUTION_NOT_ALLOWED",
        "only an independently approved rollback can be executed",
        409
      );
    }
    const rollbackEvidenceRef = controlledReference(
      payload.evidenceRef,
      "rollback execution evidence"
    );
    const rollbackEvidenceDigest = digest(
      payload.evidenceDigest,
      "rollback execution evidence digest"
    );
    const replaced = structuredClone(state.active);
    state.active = structuredClone(state.rollbackRequest.target);
    state.active.activatedAt = now;
    state.active.activationEvidenceRef = rollbackEvidenceRef;
    state.active.activationEvidenceDigest = rollbackEvidenceDigest;
    state.previousActive = replaced;
    result = {
      requestId: state.rollbackRequest.requestId,
      dictionaryDigest: state.active.dictionaryDigest,
      status: "rolled-back"
    };
    state.rollbackRequest = null;
    state.candidate = null;
  }

  state.version += 1;
  const event = appendEvent(state, {
    type: action,
    at: now,
    actorRef: performedBy.actorRef,
    actorRole: performedBy.role,
    commandDigest,
    resultDigest: sha256(result),
    activeDictionaryDigest: state.active.dictionaryDigest,
    activeMappingFingerprint: state.active.mappingFingerprint
  });
  const nextReceipt = {
    idempotencyKey,
    commandDigest,
    stateVersion: state.version,
    eventDigest: event.digest,
    result
  };
  state.commands = [...state.commands, nextReceipt].slice(-200);
  assertLedger(state);
  return { state, receipt: nextReceipt, idempotent: false };
}

function projectDictionaryLifecycle(state, options = {}) {
  assertLedger(state);
  const now = isoTime(options.now || new Date().toISOString(), "projection time");
  const warningHours = Number(options.warningHours ?? 168);
  const remainingMs = Date.parse(state.active.expiresAt) - Date.parse(now);
  const activeValidity = remainingMs <= 0
    ? "expired"
    : remainingMs <= warningHours * 60 * 60 * 1000
      ? "expiring"
      : "active";
  return {
    schemaVersion: state.schemaVersion,
    ledgerId: state.ledgerId,
    version: state.version,
    active: structuredClone(state.active),
    previousActive: state.previousActive ? {
      dictionaryId: state.previousActive.dictionaryId,
      dictionaryVersion: state.previousActive.dictionaryVersion,
      dictionaryDigest: state.previousActive.dictionaryDigest,
      mappingFingerprint: state.previousActive.mappingFingerprint
    } : null,
    candidate: state.candidate ? {
      proposalId: state.candidate.proposalId,
      status: state.candidate.status,
      dictionary: structuredClone(state.candidate.dictionary),
      diff: structuredClone(state.candidate.diff),
      proposedAt: state.candidate.proposedAt,
      reviewedAt: state.candidate.reviewedAt,
      activationEligible: state.candidate.status === "approved"
        && Date.parse(now) >= Date.parse(state.candidate.dictionary.effectiveAt)
    } : null,
    rollbackRequest: state.rollbackRequest ? {
      requestId: state.rollbackRequest.requestId,
      status: state.rollbackRequest.status,
      targetDictionaryVersion: state.rollbackRequest.target.dictionaryVersion,
      requestedAt: state.rollbackRequest.requestedAt,
      reviewedAt: state.rollbackRequest.reviewedAt
    } : null,
    eventCount: state.events.length,
    chainHead: state.events.at(-1)?.digest || "",
    activeValidity,
    activeExpiresAt: state.active.expiresAt,
    dictionaryLifecycleReady: activeValidity !== "expired"
      && !state.rollbackRequest,
    codeValuesExposed: false,
    credentialsExposed: false,
    productionReady: false,
    boundary: "Dictionary activation or rollback does not authorize direct-report production cutover."
  };
}

module.exports = {
  ACTIONS,
  ACTION_ROLES,
  DictionaryLifecycleError,
  SCHEMA_VERSION,
  applyDictionaryLifecycleCommand,
  assertLedger,
  createDictionaryLifecycleLedger,
  dictionaryDiff,
  projectDictionaryLifecycle
};
