"use strict";

const { createHash } = require("node:crypto");

const commandTails = new Map();

class StateCommandError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.name = "StateCommandError";
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

function sha256(value) {
  return createHash("sha256")
    .update(typeof value === "string" ? value : stableStringify(value))
    .digest("hex");
}

function actorScope(user = {}) {
  return {
    role: String(user.role || ""),
    id: String(user.username || user.id || user.residentId || ""),
    orgCode: String(user.orgCode || ""),
    residentId: String(user.residentId || "")
  };
}

function buildStateCommand({ req, payload = {}, user, endpoint, naturalKey, canonicalPayload }) {
  const headerKey = String(req?.headers?.["idempotency-key"] || "").trim();
  const bodyKey = String(payload.idempotencyKey || payload.commandId || "").trim();
  if (headerKey && bodyKey && headerKey !== bodyKey) {
    throw new StateCommandError("STATE_COMMAND_IDEMPOTENCY_KEY_MISMATCH", "body idempotency key must match Idempotency-Key");
  }
  const selectedKey = headerKey || bodyKey || String(naturalKey || "").trim();
  if (!selectedKey) {
    throw new StateCommandError("STATE_COMMAND_IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key is required");
  }
  if (selectedKey.length > 200) {
    throw new StateCommandError("STATE_COMMAND_IDEMPOTENCY_KEY_INVALID", "Idempotency-Key exceeds 200 characters");
  }
  return Object.freeze({
    commandKeyHash: sha256({ endpoint, actor: actorScope(user), selectedKey }),
    requestDigest: sha256(canonicalPayload),
    explicitKey: Boolean(headerKey || bodyKey)
  });
}

function withStateCommandLock(lockKey, work) {
  const normalizedKey = String(lockKey || "").trim();
  const previous = commandTails.get(normalizedKey) || Promise.resolve();
  const current = previous.catch(() => undefined).then(work);
  const tail = current.catch(() => undefined);
  commandTails.set(normalizedKey, tail);
  return current.finally(() => {
    if (commandTails.get(normalizedKey) === tail) commandTails.delete(normalizedKey);
  });
}

function collectionVersion(data, collection) {
  const value = data?.storageMeta?.collectionVersions?.[collection];
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function assertExpectedVersion(data, collection, expectedVersion, code) {
  if (expectedVersion === undefined || expectedVersion === null || expectedVersion === "") return collectionVersion(data, collection);
  const expected = Number(expectedVersion);
  if (!Number.isSafeInteger(expected) || expected < 0) {
    throw new StateCommandError(`${code}_INVALID`, "expectedVersion must be a non-negative safe integer");
  }
  const current = collectionVersion(data, collection);
  if (expected !== current) throw new StateCommandError(code, "state version conflict", 409);
  return expected;
}

function prepareCollectionCas(data, collections, primaryCollection, expectedVersion, conflictCode) {
  const versions = {};
  for (const collection of collections) versions[collection] = collectionVersion(data, collection);
  versions[primaryCollection] = assertExpectedVersion(data, primaryCollection, expectedVersion, conflictCode);
  data.storageMeta = {
    ...(data.storageMeta || {}),
    collectionVersions: versions
  };
  return versions;
}

function isStorageConflict(error) {
  return Boolean(error && (error.code === "STORAGE_CONFLICT" || error.name === "StorageConflictError"));
}

module.exports = {
  StateCommandError,
  buildStateCommand,
  collectionVersion,
  isStorageConflict,
  prepareCollectionCas,
  sha256,
  stableStringify,
  withStateCommandLock
};
