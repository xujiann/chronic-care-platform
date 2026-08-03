"use strict";

const { createHash } = require("node:crypto");

const { ContractRegistry } = require("../platform/contracts/contract-registry");
const { DomainRepository } = require("../platform/data/domain-repository");
const { createDomainEvent } = require("../platform/events/domain-event-runtime");

const DOMAIN = "care-coordination";
const CONTRACT_ID = "referral-order.v1";
const EVENT_TYPE = "care-coordination.referral-updated.v1";
const OUTBOX_COLLECTION = "referralOutbox";
const INBOX_COLLECTION = "referralCommandInbox";
let referralCommandQueue = Promise.resolve();

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

function text(value, max = 300) {
  return String(value || "").trim().slice(0, max);
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
          working.referralSystem[OUTBOX_COLLECTION] = [
            {
              ...structuredClone(event),
              contractId: CONTRACT_ID,
              status: "pending",
              attempts: 0,
              createdAt: event.occurredAt
            },
            ...working.referralSystem[OUTBOX_COLLECTION]
          ].slice(0, 1000);
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
          ].slice(0, 1000);
          changed = true;
        }
      };
      const result = await callback(transaction);
      if (changed) await writeState(working);
      return result;
    }
  };
}

function cleanReferralPatch(input = {}) {
  const patch = input.patch && typeof input.patch === "object" && !Array.isArray(input.patch)
    ? input.patch
    : input;
  const allowed = [
    "status", "priority", "reservedResource", "insurancePolicy", "reason",
    "receivingFeedback", "nextAction"
  ];
  return Object.fromEntries(allowed
    .filter((field) => Object.hasOwn(patch, field))
    .map((field) => [field, text(patch[field], field === "reason" || field === "receivingFeedback" ? 1000 : 300)]));
}

function createReferralCommandService({ readState, writeState, now = () => new Date().toISOString() }) {
  const adapter = createStateRepositoryAdapter({ readState, writeState });
  const repository = new DomainRepository({ domain: DOMAIN, adapter });

  async function executeUpdate({
    referralId,
    commandId,
    expectedVersion,
    correlationId,
    actor = {},
    input = {}
  }) {
    const normalizedReferralId = text(referralId, 200);
    const normalizedCommandId = text(commandId, 160);
    if (!normalizedReferralId) throw new ReferralCommandError("REFERRAL_ID_REQUIRED", "referral id is required");
    if (!normalizedCommandId) {
      throw new ReferralCommandError("REFERRAL_COMMAND_ID_REQUIRED", "Idempotency-Key is required");
    }
    if (!Number.isInteger(Number(expectedVersion)) || Number(expectedVersion) < 1) {
      throw new ReferralCommandError("REFERRAL_EXPECTED_VERSION_REQUIRED", "positive expectedVersion is required");
    }
    const patch = cleanReferralPatch(input);
    if (Object.keys(patch).length === 0) {
      throw new ReferralCommandError("REFERRAL_PATCH_REQUIRED", "referral update requires allowed fields");
    }
    const intent = {
      referralId: normalizedReferralId,
      expectedVersion: Number(expectedVersion),
      patch
    };
    const intentDigest = digest(intent);
    const state = readState();
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
        event: structuredClone(event)
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
    const next = {
      ...current,
      ...patch,
      version: actualVersion + 1,
      lastUpdated: occurredAt,
      updatedBy: text(actor.username || actor.id || actor.role, 120),
      updatedByName: text(actor.name, 120)
    };
    const contract = buildReferralOrderContract(next);
    const eventId = `referral-event-${digest({ commandId: normalizedCommandId, referralId: normalizedReferralId }).slice(0, 32)}`;
    const event = createDomainEvent({
      id: eventId,
      domain: DOMAIN,
      type: EVENT_TYPE,
      aggregateId: normalizedReferralId,
      aggregateVersion: next.version,
      correlationId,
      occurredAt,
      payload: {
        commandId: normalizedCommandId,
        intentDigest,
        contract
      }
    });
    const unitOfWork = repository.unitOfWork({ correlationId });
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
    const execution = referralCommandQueue.then(() => executeUpdate(input));
    referralCommandQueue = execution.catch(() => undefined);
    return execution;
  }

  return Object.freeze({ update });
}

module.exports = {
  CONTRACT_ID,
  EVENT_TYPE,
  INBOX_COLLECTION,
  OUTBOX_COLLECTION,
  ReferralCommandError,
  buildReferralOrderContract,
  createReferralCommandService,
  createReferralOrderAntiCorruptionAdapter
};
