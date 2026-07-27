const crypto = require("node:crypto");
const {
  LEGACY_KEY_ID,
  resolveVerificationKey,
  selectSigningKey
} = require("./public-health-external-keyring-service");

const RESILIENCE_SCHEMA_VERSION = "public-health-external-resilience/v1";
const RESILIENCE_AUDIT_SCHEMA_VERSION = "public-health-external-resilience-audit/v1";
const CIRCUIT_STATES = Object.freeze(["closed", "open", "half-open"]);

function clean(value) {
  return String(value ?? "").trim();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
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

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function timeValue(value, label) {
  const parsed = new Date(value).getTime();
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be a valid date-time`);
  return parsed;
}

function timingSafeHexEqual(left, right) {
  if (!/^[a-f0-9]{64}$/i.test(clean(left)) || !/^[a-f0-9]{64}$/i.test(clean(right))) return false;
  return crypto.timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function integerWithin(value, fallback, minimum, maximum, label) {
  const number = Number(value ?? fallback);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} to ${maximum}`);
  }
  return number;
}

function reasonCode(value) {
  const normalized = clean(value).toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{1,63}$/.test(normalized)) {
    throw new Error("external lane outcome reason must be a minimized reason code");
  }
  return normalized;
}

function normalizePublicHealthExternalResiliencePolicy(policy = {}) {
  return {
    failureThreshold: integerWithin(policy.failureThreshold, 3, 1, 20, "failureThreshold"),
    openSeconds: integerWithin(policy.openSeconds, 120, 30, 3600, "openSeconds"),
    halfOpenMaxProbes: integerWithin(policy.halfOpenMaxProbes, 1, 1, 10, "halfOpenMaxProbes"),
    rateLimitPerMinute: integerWithin(policy.rateLimitPerMinute, 30, 1, 1000, "rateLimitPerMinute"),
    maxPending: integerWithin(policy.maxPending, 100, 1, 10000, "maxPending")
  };
}

function rows(data, key) {
  return Array.isArray(data?.[key]) ? data[key] : [];
}

function baseLaneControl(laneId, at) {
  return {
    schemaVersion: RESILIENCE_SCHEMA_VERSION,
    laneId: clean(laneId),
    version: 0,
    circuitState: "closed",
    consecutiveFailures: 0,
    openUntil: null,
    halfOpenProbesInFlight: 0,
    rateWindowStartedAt: clean(at),
    claimsInWindow: 0,
    auditHead: "",
    updatedAt: clean(at),
    productionReady: false
  };
}

function controlPayload(control) {
  return {
    schemaVersion: control.schemaVersion,
    laneId: control.laneId,
    version: control.version,
    circuitState: control.circuitState,
    consecutiveFailures: control.consecutiveFailures,
    openUntil: control.openUntil,
    halfOpenProbesInFlight: control.halfOpenProbesInFlight,
    rateWindowStartedAt: control.rateWindowStartedAt,
    claimsInWindow: control.claimsInWindow,
    auditHead: control.auditHead,
    updatedAt: control.updatedAt,
    signatureKeyId: clean(control.signatureKeyId || LEGACY_KEY_ID),
    productionReady: false
  };
}

function signLaneControl(control, signingMaterial, at) {
  const key = selectSigningKey(signingMaterial, at);
  const unsigned = {
    ...control,
    signatureAlgorithm: "HMAC-SHA256",
    signatureKeyId: key.keyId
  };
  const signature = crypto.createHmac("sha256", key.secret)
    .update(stableStringify(controlPayload(unsigned)))
    .digest("hex");
  return { ...unsigned, signature };
}

function verifyPublicHealthExternalLaneControl(control, signingMaterial) {
  if (!control || control.schemaVersion !== RESILIENCE_SCHEMA_VERSION) {
    return { ok: false, reason: "lane-control-schema-invalid" };
  }
  if (!CIRCUIT_STATES.includes(clean(control.circuitState))) {
    return { ok: false, reason: "lane-control-state-invalid" };
  }
  const keyResolution = resolveVerificationKey(
    signingMaterial,
    clean(control.signatureKeyId || LEGACY_KEY_ID),
    clean(control.updatedAt)
  );
  if (!keyResolution.ok) return { ok: false, reason: `lane-control-${keyResolution.reason}` };
  const expected = crypto.createHmac("sha256", keyResolution.key.secret)
    .update(stableStringify(controlPayload(control)))
    .digest("hex");
  if (clean(control.signatureAlgorithm) !== "HMAC-SHA256" || !timingSafeHexEqual(control.signature, expected)) {
    return { ok: false, reason: "lane-control-signature-invalid" };
  }
  return { ok: true, reason: "verified" };
}

function resilienceAuditPayload(entry) {
  const { auditHash, auditSignature, ...payload } = entry;
  return payload;
}

function signResilienceAudit(entry, previousAuditHash, signingMaterial) {
  const key = selectSigningKey(signingMaterial, entry.at);
  const payload = {
    ...entry,
    auditSchemaVersion: RESILIENCE_AUDIT_SCHEMA_VERSION,
    previousAuditHash: clean(previousAuditHash),
    auditKeyId: key.keyId
  };
  const auditHash = sha256(stableStringify(payload));
  const auditSignature = crypto.createHmac("sha256", key.secret).update(auditHash).digest("hex");
  return { ...payload, auditHash, auditSignature };
}

function verifyPublicHealthExternalLaneControlAuditChain(data = {}, laneId, signingMaterial) {
  const normalizedLaneId = clean(laneId);
  const control = rows(data, "publicHealthExternalLaneControls")
    .find((item) => item.laneId === normalizedLaneId);
  const audit = rows(data, "publicHealthExternalLaneControlAudit")
    .filter((item) => item.laneId === normalizedLaneId);
  if (!control) {
    return audit.length
      ? { ok: false, reason: "lane-control-missing", entries: audit.length, auditHead: "" }
      : { ok: true, reason: "not-initialized", entries: 0, auditHead: "" };
  }
  const controlVerification = verifyPublicHealthExternalLaneControl(control, signingMaterial);
  if (!controlVerification.ok) {
    return { ok: false, reason: controlVerification.reason, entries: audit.length, auditHead: "" };
  }
  let previousAuditHash = "";
  for (const entry of audit) {
    if (entry.auditSchemaVersion !== RESILIENCE_AUDIT_SCHEMA_VERSION
      || clean(entry.previousAuditHash) !== previousAuditHash) {
      return { ok: false, reason: "lane-control-audit-link-invalid", entries: audit.length, auditHead: previousAuditHash };
    }
    const expectedHash = sha256(stableStringify(resilienceAuditPayload(entry)));
    const keyResolution = resolveVerificationKey(signingMaterial, clean(entry.auditKeyId || LEGACY_KEY_ID), clean(entry.at));
    if (!keyResolution.ok) {
      return { ok: false, reason: `lane-control-audit-${keyResolution.reason}`, entries: audit.length, auditHead: previousAuditHash };
    }
    const expectedSignature = crypto.createHmac("sha256", keyResolution.key.secret)
      .update(expectedHash)
      .digest("hex");
    if (!timingSafeHexEqual(entry.auditHash, expectedHash)
      || !timingSafeHexEqual(entry.auditSignature, expectedSignature)) {
      return { ok: false, reason: "lane-control-audit-signature-invalid", entries: audit.length, auditHead: previousAuditHash };
    }
    previousAuditHash = entry.auditHash;
  }
  if (clean(control.auditHead) !== previousAuditHash) {
    return { ok: false, reason: "lane-control-audit-head-mismatch", entries: audit.length, auditHead: previousAuditHash };
  }
  return { ok: true, reason: "verified", entries: audit.length, auditHead: previousAuditHash };
}

function assertLaneControlIntegrity(data, laneId, signingMaterial) {
  const verification = verifyPublicHealthExternalLaneControlAuditChain(data, laneId, signingMaterial);
  if (!verification.ok) throw new Error(`public health external lane control rejected: ${verification.reason}`);
  return verification;
}

function appendLaneControlChange(data, current, updated, action, detail, signingMaterial) {
  const auditRows = clone(rows(data, "publicHealthExternalLaneControlAudit"));
  const signedAudit = signResilienceAudit({
    id: `${updated.laneId}:resilience:${updated.version}:${action}`,
    laneId: updated.laneId,
    action,
    from: current.circuitState,
    to: updated.circuitState,
    fromVersion: current.version,
    toVersion: updated.version,
    at: updated.updatedAt,
    consecutiveFailures: updated.consecutiveFailures,
    claimsInWindow: updated.claimsInWindow,
    detail: clean(detail)
  }, current.auditHead, signingMaterial);
  const signedControl = signLaneControl({
    ...updated,
    auditHead: signedAudit.auditHash
  }, signingMaterial, updated.updatedAt);
  const controls = clone(rows(data, "publicHealthExternalLaneControls"));
  const index = controls.findIndex((item) => item.laneId === updated.laneId);
  if (index < 0) controls.push(signedControl);
  else controls[index] = signedControl;
  return {
    control: clone(signedControl),
    audit: clone(signedAudit),
    nextData: {
      ...data,
      publicHealthExternalLaneControls: controls,
      publicHealthExternalLaneControlAudit: [...auditRows, signedAudit]
    }
  };
}

function assertPublicHealthExternalBackpressure(data = {}, laneId, policy = {}) {
  const normalizedPolicy = normalizePublicHealthExternalResiliencePolicy(policy);
  const queued = rows(data, "publicHealthExternalDispatches")
    .filter((item) => item.laneId === clean(laneId) && ["pending", "retry-scheduled"].includes(item.deliveryState))
    .length;
  if (queued >= normalizedPolicy.maxPending) {
    throw new Error(`public health external lane backpressure limit reached: ${queued}/${normalizedPolicy.maxPending}`);
  }
  return { ok: true, laneId: clean(laneId), queued, available: normalizedPolicy.maxPending - queued };
}

function reservePublicHealthExternalLaneCapacityToState(
  data = {},
  laneId,
  input = {},
  signingMaterial,
  policy = {}
) {
  const normalizedLaneId = clean(laneId);
  const normalizedPolicy = normalizePublicHealthExternalResiliencePolicy(policy);
  const at = clean(input.at || new Date().toISOString());
  const atValue = timeValue(at, "lane capacity reservation at");
  assertLaneControlIntegrity(data, normalizedLaneId, signingMaterial);
  const persisted = rows(data, "publicHealthExternalLaneControls")
    .find((item) => item.laneId === normalizedLaneId);
  const current = clone(persisted || baseLaneControl(normalizedLaneId, at));
  if (input.expectedVersion === undefined || Number(input.expectedVersion) !== Number(current.version)) {
    throw new Error(`external lane control version conflict: expected ${input.expectedVersion ?? "missing"}, current ${current.version}`);
  }
  if (timeValue(current.rateWindowStartedAt, "rateWindowStartedAt") + 60_000 <= atValue) {
    current.rateWindowStartedAt = at;
    current.claimsInWindow = 0;
  }
  if (current.circuitState === "open") {
    if (timeValue(current.openUntil, "openUntil") > atValue) {
      throw new Error(`public health external lane circuit is open until ${current.openUntil}`);
    }
    current.circuitState = "half-open";
    current.openUntil = null;
    current.halfOpenProbesInFlight = 0;
  }
  if (current.circuitState === "half-open"
    && current.halfOpenProbesInFlight >= normalizedPolicy.halfOpenMaxProbes) {
    throw new Error("public health external lane half-open probe limit reached");
  }
  if (current.claimsInWindow >= normalizedPolicy.rateLimitPerMinute) {
    throw new Error(`public health external lane rate limit reached: ${current.claimsInWindow}/${normalizedPolicy.rateLimitPerMinute}`);
  }
  const updated = {
    ...current,
    version: Number(current.version) + 1,
    claimsInWindow: Number(current.claimsInWindow) + 1,
    halfOpenProbesInFlight: current.circuitState === "half-open"
      ? Number(current.halfOpenProbesInFlight) + 1
      : Number(current.halfOpenProbesInFlight),
    updatedAt: at,
    productionReady: false
  };
  return appendLaneControlChange(
    data,
    persisted || baseLaneControl(normalizedLaneId, at),
    updated,
    "reserve-lane-capacity",
    current.circuitState === "half-open" ? "half-open-probe" : "rate-capacity",
    signingMaterial
  );
}

function recordPublicHealthExternalLaneOutcomeToState(
  data = {},
  laneId,
  outcome = {},
  input = {},
  signingMaterial,
  policy = {}
) {
  const normalizedLaneId = clean(laneId);
  const normalizedPolicy = normalizePublicHealthExternalResiliencePolicy(policy);
  const at = clean(input.at || new Date().toISOString());
  const atValue = timeValue(at, "lane outcome at");
  assertLaneControlIntegrity(data, normalizedLaneId, signingMaterial);
  const persisted = rows(data, "publicHealthExternalLaneControls")
    .find((item) => item.laneId === normalizedLaneId);
  if (!persisted) throw new Error(`public health external lane control is not initialized: ${normalizedLaneId}`);
  const current = clone(persisted);
  if (input.expectedVersion === undefined || Number(input.expectedVersion) !== Number(current.version)) {
    throw new Error(`external lane control version conflict: expected ${input.expectedVersion ?? "missing"}, current ${current.version}`);
  }
  const outcomeType = clean(outcome.type).toLowerCase();
  if (!["success", "failure"].includes(outcomeType)) throw new Error("external lane outcome type must be success or failure");
  const normalizedReason = reasonCode(outcome.reason);
  let circuitState = current.circuitState;
  let consecutiveFailures = Number(current.consecutiveFailures);
  let openUntil = current.openUntil;
  if (outcomeType === "success") {
    circuitState = "closed";
    consecutiveFailures = 0;
    openUntil = null;
  } else {
    consecutiveFailures += 1;
    if (current.circuitState === "half-open" || consecutiveFailures >= normalizedPolicy.failureThreshold) {
      circuitState = "open";
      openUntil = new Date(atValue + normalizedPolicy.openSeconds * 1000).toISOString();
    } else {
      circuitState = "closed";
      openUntil = null;
    }
  }
  const updated = {
    ...current,
    version: Number(current.version) + 1,
    circuitState,
    consecutiveFailures,
    openUntil,
    halfOpenProbesInFlight: 0,
    updatedAt: at,
    productionReady: false
  };
  return appendLaneControlChange(
    data,
    current,
    updated,
    `record-lane-${outcomeType}`,
    normalizedReason,
    signingMaterial
  );
}

function buildPublicHealthExternalResilienceRuntime(data = {}) {
  const controls = clone(rows(data, "publicHealthExternalLaneControls"));
  const audit = clone(rows(data, "publicHealthExternalLaneControlAudit"));
  return {
    ok: true,
    functionalState: "external-lane-resilience-controls-ready",
    summary: {
      lanes: controls.length,
      closed: controls.filter((item) => item.circuitState === "closed").length,
      open: controls.filter((item) => item.circuitState === "open").length,
      halfOpen: controls.filter((item) => item.circuitState === "half-open").length,
      auditEntries: audit.length
    },
    controls: controls.map((item) => ({
      laneId: item.laneId,
      version: item.version,
      circuitState: item.circuitState,
      consecutiveFailures: item.consecutiveFailures,
      openUntil: item.openUntil,
      claimsInWindow: item.claimsInWindow,
      rateWindowStartedAt: item.rateWindowStartedAt
    })),
    productionReady: false,
    blockers: [
      "T00 must atomically persist lane-control and dispatch state changes.",
      "Production policies, metrics, alerts and load evidence remain required."
    ]
  };
}

module.exports = {
  CIRCUIT_STATES,
  RESILIENCE_AUDIT_SCHEMA_VERSION,
  RESILIENCE_SCHEMA_VERSION,
  assertPublicHealthExternalBackpressure,
  buildPublicHealthExternalResilienceRuntime,
  normalizePublicHealthExternalResiliencePolicy,
  recordPublicHealthExternalLaneOutcomeToState,
  reservePublicHealthExternalLaneCapacityToState,
  verifyPublicHealthExternalLaneControl,
  verifyPublicHealthExternalLaneControlAuditChain
};
