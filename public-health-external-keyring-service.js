const KEY_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{2,63}$/i;
const KEY_STATUSES = Object.freeze(["active", "grace", "revoked"]);
const LEGACY_KEY_ID = "legacy-static";

function clean(value) {
  return String(value ?? "").trim();
}

function timeValue(value, label) {
  const parsed = new Date(value).getTime();
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be a valid date-time`);
  return parsed;
}

function normalizeKeyRecord(record = {}) {
  const keyId = clean(record.keyId);
  const secret = clean(record.secret);
  const status = clean(record.status).toLowerCase();
  const notBefore = clean(record.notBefore);
  const expiresAt = clean(record.expiresAt);
  const revokedAt = clean(record.revokedAt);
  if (!KEY_ID_PATTERN.test(keyId)) throw new Error("external signing keyId must contain 3 to 64 safe characters");
  if (secret.length < 32) throw new Error(`external signing key ${keyId} must contain at least 32 characters`);
  if (!KEY_STATUSES.includes(status)) throw new Error(`external signing key ${keyId} status must be active, grace or revoked`);
  const notBeforeValue = timeValue(notBefore, `external signing key ${keyId} notBefore`);
  const expiresAtValue = timeValue(expiresAt, `external signing key ${keyId} expiresAt`);
  if (expiresAtValue <= notBeforeValue) throw new Error(`external signing key ${keyId} expiresAt must be after notBefore`);
  if (status === "revoked" && !revokedAt) throw new Error(`external signing key ${keyId} revokedAt is required`);
  if (revokedAt) timeValue(revokedAt, `external signing key ${keyId} revokedAt`);
  return { keyId, secret, status, notBefore, expiresAt, revokedAt };
}

function normalizeKeyring(keyring = {}) {
  const purpose = clean(keyring.purpose || "external-signing");
  const activeKeyId = clean(keyring.activeKeyId);
  const keys = Array.isArray(keyring.keys) ? keyring.keys.map(normalizeKeyRecord) : [];
  if (!keys.length) throw new Error(`${purpose} keyring must contain at least one key`);
  if (new Set(keys.map((item) => item.keyId)).size !== keys.length) {
    throw new Error(`${purpose} keyring contains duplicate keyId values`);
  }
  const active = keys.filter((item) => item.status === "active");
  if (active.length !== 1) throw new Error(`${purpose} keyring must contain exactly one active key`);
  if (!activeKeyId || active[0].keyId !== activeKeyId) {
    throw new Error(`${purpose} keyring activeKeyId must identify its active key`);
  }
  return { purpose, activeKeyId, keys };
}

function legacyKey(secret) {
  const value = clean(secret);
  if (value.length < 32) throw new Error("external signing secret must contain at least 32 characters");
  return {
    keyId: LEGACY_KEY_ID,
    secret: value,
    status: "active",
    notBefore: "1970-01-01T00:00:00.000Z",
    expiresAt: "9999-12-31T23:59:59.999Z",
    revokedAt: "",
    legacy: true
  };
}

function keyringFrom(material) {
  if (typeof material === "string") {
    const key = legacyKey(material);
    return { purpose: "legacy-static", activeKeyId: key.keyId, keys: [key], legacy: true };
  }
  if (material && typeof material === "object" && clean(material.secret)) {
    const keyId = clean(material.keyId || LEGACY_KEY_ID);
    const key = {
      ...legacyKey(material.secret),
      keyId,
      legacy: true
    };
    return { purpose: clean(material.purpose || "single-key"), activeKeyId: key.keyId, keys: [key], legacy: true };
  }
  return { ...normalizeKeyring(material), legacy: false };
}

function keyValidAt(key, at) {
  const value = timeValue(at, "key resolution at");
  return value >= timeValue(key.notBefore, `external signing key ${key.keyId} notBefore`)
    && value < timeValue(key.expiresAt, `external signing key ${key.keyId} expiresAt`);
}

function selectSigningKey(material, at = new Date().toISOString()) {
  const keyring = keyringFrom(material);
  const key = keyring.keys.find((item) => item.keyId === keyring.activeKeyId);
  if (!key || key.status !== "active") throw new Error("external signing keyring has no active signing key");
  if (!keyValidAt(key, at)) throw new Error(`external signing key ${key.keyId} is not valid at signing time`);
  return { ...key, purpose: keyring.purpose, legacy: Boolean(keyring.legacy || key.legacy) };
}

function resolveVerificationKey(material, keyId, at = new Date().toISOString()) {
  let keyring;
  try {
    keyring = keyringFrom(material);
  } catch {
    return { ok: false, reason: "keyring-invalid" };
  }
  const requestedKeyId = clean(keyId);
  const key = keyring.keys.find((item) => item.keyId === requestedKeyId);
  if (!key) return { ok: false, reason: "key-unknown" };
  if (key.status === "revoked") return { ok: false, reason: "key-revoked" };
  if (!["active", "grace"].includes(key.status)) return { ok: false, reason: "key-status-invalid" };
  try {
    if (!keyValidAt(key, at)) return { ok: false, reason: "key-expired-or-not-yet-valid" };
  } catch {
    return { ok: false, reason: "key-time-invalid" };
  }
  return {
    ok: true,
    reason: "verified",
    key: { ...key, purpose: keyring.purpose, legacy: Boolean(keyring.legacy || key.legacy) }
  };
}

function summarizeKeyring(material, at = new Date().toISOString()) {
  let keyring;
  try {
    keyring = keyringFrom(material);
  } catch (error) {
    return {
      ok: false,
      productionReady: false,
      activeKeyId: "",
      keys: [],
      blockers: [error.message]
    };
  }
  const keys = keyring.keys.map((key) => ({
    keyId: key.keyId,
    status: key.status,
    notBefore: key.notBefore,
    expiresAt: key.expiresAt,
    revokedAt: key.revokedAt,
    validNow: key.status !== "revoked" && keyValidAt(key, at)
  }));
  const active = keys.find((item) => item.keyId === keyring.activeKeyId);
  const productionReady = !keyring.legacy && Boolean(active?.status === "active" && active.validNow);
  return {
    ok: true,
    purpose: keyring.purpose,
    activeKeyId: keyring.activeKeyId,
    keys,
    productionReady,
    blockers: productionReady ? [] : [
      keyring.legacy
        ? "Legacy static signing material is compatible for tests but is not production-ready."
        : "The active signing key is not currently valid."
    ]
  };
}

module.exports = {
  KEY_STATUSES,
  LEGACY_KEY_ID,
  normalizeKeyring,
  resolveVerificationKey,
  selectSigningKey,
  summarizeKeyring
};
