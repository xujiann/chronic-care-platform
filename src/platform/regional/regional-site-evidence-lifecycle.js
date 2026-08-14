"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { deepFreeze, sha256, stableJson } = require("./region-manifest");

const REGISTRY_SCHEMA = "regional-site-evidence-lifecycle-v1";
const PLAN_SCHEMA = "regional-site-evidence-lifecycle-plan-v1";
const MAX_REGISTRY_BYTES = 1024 * 1024;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const REGION_CODE_PATTERN = /^\d{6}$/;
const REASON_CODE_PATTERN = /^[a-z][a-z0-9-]{2,79}$/;
const STATES = Object.freeze([
  "submitted",
  "under-review",
  "returned",
  "accepted",
  "revoked",
  "superseded"
]);
const ACTIONS = Object.freeze(["submit", "review", "return", "accept", "revoke", "supersede"]);
const ACTION_CONTRACT = Object.freeze({
  submit: Object.freeze({ from: Object.freeze([null, "returned", "revoked", "superseded"]), to: "submitted", role: "custodian" }),
  review: Object.freeze({ from: Object.freeze(["submitted"]), to: "under-review", role: "reviewer" }),
  return: Object.freeze({ from: Object.freeze(["under-review"]), to: "returned", role: "reviewer" }),
  accept: Object.freeze({ from: Object.freeze(["under-review"]), to: "accepted", role: "authority" }),
  revoke: Object.freeze({ from: Object.freeze(["accepted"]), to: "revoked", role: "authority" }),
  supersede: Object.freeze({ from: Object.freeze(["accepted"]), to: "superseded", role: "authority" })
});
const REGISTRY_KEYS = Object.freeze([
  "schemaVersion",
  "productionReady",
  "appendOnly",
  "authorizationBoundary",
  "events"
]);
const EVENT_KEYS = Object.freeze([
  "sequence",
  "regionCode",
  "releaseId",
  "compositeDigest",
  "regionalContentDigest",
  "evidenceSourceDigest",
  "revision",
  "predecessorEvidenceSourceDigest",
  "replacementEvidenceSourceDigest",
  "action",
  "fromState",
  "toState",
  "actorRole",
  "actorDigest",
  "reasonCode",
  "recordedAt",
  "productionReady",
  "previousEventDigest",
  "eventDigest"
]);

function lifecycleError(code, message) {
  return Object.assign(new Error(message), { code, statusCode: 400 });
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function exactKeys(value, expected) {
  return value && typeof value === "object" && !Array.isArray(value)
    && stableJson(Object.keys(value).sort()) === stableJson([...expected].sort());
}

function validTimestamp(value) {
  return typeof value === "string" && value.length <= 40 && Number.isFinite(Date.parse(value));
}

function assertDigest(value, label) {
  if (!SHA256_PATTERN.test(String(value || ""))) {
    throw lifecycleError("REGIONAL_SITE_EVIDENCE_LIFECYCLE_DIGEST_INVALID", `${label} must be sha256:<64 lowercase hex>`);
  }
}

function eventPayload(event) {
  const { eventDigest, ...payload } = event;
  return payload;
}

function lifecycleRegistryDigest(registry) {
  return `sha256:${sha256(stableJson(registry ?? null))}`;
}

function createEmptyEvidenceLifecycleRegistry() {
  return {
    schemaVersion: REGISTRY_SCHEMA,
    productionReady: false,
    appendOnly: true,
    authorizationBoundary: "external-production-authorization-required",
    events: []
  };
}

function chainKey(regionCode, releaseId) {
  return `${regionCode}/${releaseId}`;
}

function normalizeBinding(value = {}) {
  const binding = {
    regionCode: String(value.regionCode || ""),
    releaseId: String(value.releaseId || "").trim(),
    compositeDigest: String(value.compositeDigest || "").toLowerCase(),
    regionalContentDigest: String(value.regionalContentDigest || "").toLowerCase()
  };
  if (!REGION_CODE_PATTERN.test(binding.regionCode) || !binding.releaseId) {
    throw lifecycleError("REGIONAL_SITE_EVIDENCE_LIFECYCLE_BINDING_INVALID", "lifecycle binding requires a six-digit region and release ID");
  }
  assertDigest(binding.compositeDigest, "lifecycle compositeDigest");
  assertDigest(binding.regionalContentDigest, "lifecycle regionalContentDigest");
  return Object.freeze(binding);
}

function sameBinding(event, current) {
  return event.regionCode === current.regionCode
    && event.releaseId === current.releaseId
    && event.compositeDigest === current.compositeDigest
    && event.regionalContentDigest === current.regionalContentDigest;
}

function validateLifecycleEvent(event, current, context = {}) {
  if (!exactKeys(event, EVENT_KEYS)
    || !Number.isInteger(event.sequence)
    || event.sequence < 1
    || !ACTIONS.includes(event.action)
    || !STATES.includes(event.toState)
    || (event.fromState !== null && !STATES.includes(event.fromState))
    || !SHA256_PATTERN.test(String(event.actorDigest || ""))
    || !REASON_CODE_PATTERN.test(String(event.reasonCode || ""))
    || !validTimestamp(event.recordedAt)
    || event.productionReady !== false) {
    throw lifecycleError("REGIONAL_SITE_EVIDENCE_LIFECYCLE_EVENT_INVALID", "regional site evidence lifecycle event contract is invalid");
  }
  const binding = normalizeBinding(event);
  assertDigest(event.evidenceSourceDigest, "lifecycle evidenceSourceDigest");
  if (!Number.isInteger(event.revision) || event.revision < 1) {
    throw lifecycleError("REGIONAL_SITE_EVIDENCE_LIFECYCLE_REVISION_INVALID", "lifecycle revision must be a positive integer");
  }
  if (event.predecessorEvidenceSourceDigest) {
    assertDigest(event.predecessorEvidenceSourceDigest, "lifecycle predecessorEvidenceSourceDigest");
  }
  if (event.replacementEvidenceSourceDigest) {
    assertDigest(event.replacementEvidenceSourceDigest, "lifecycle replacementEvidenceSourceDigest");
  }
  const contract = ACTION_CONTRACT[event.action];
  const currentState = current?.state ?? null;
  if (!contract.from.includes(currentState)
    || event.fromState !== currentState
    || event.toState !== contract.to
    || event.actorRole !== contract.role) {
    throw lifecycleError(
      "REGIONAL_SITE_EVIDENCE_LIFECYCLE_TRANSITION_INVALID",
      `illegal lifecycle transition ${currentState ?? "new"} -> ${event.toState}`
    );
  }
  if (context.previousRecordedAt && Date.parse(event.recordedAt) < Date.parse(context.previousRecordedAt)) {
    throw lifecycleError("REGIONAL_SITE_EVIDENCE_LIFECYCLE_TIME_REVERSED", "lifecycle events must be globally time ordered");
  }
  if (event.action === "submit") {
    const expectedRevision = current ? current.revision + 1 : 1;
    const expectedPredecessor = current?.evidenceSourceDigest || "";
    if (event.revision !== expectedRevision
      || event.predecessorEvidenceSourceDigest !== expectedPredecessor
      || event.replacementEvidenceSourceDigest !== ""
      || (current && event.evidenceSourceDigest === current.evidenceSourceDigest)
      || (current?.state === "superseded" && current.replacementEvidenceSourceDigest !== event.evidenceSourceDigest)) {
      throw lifecycleError("REGIONAL_SITE_EVIDENCE_LIFECYCLE_VERSION_CHAIN_INVALID", "submitted evidence does not extend the version chain");
    }
    if (current && !sameBinding(event, current)) {
      throw lifecycleError("REGIONAL_SITE_EVIDENCE_LIFECYCLE_BINDING_DRIFT", "evidence lifecycle release binding cannot change within a chain");
    }
  } else {
    if (!current
      || !sameBinding(event, current)
      || event.evidenceSourceDigest !== current.evidenceSourceDigest
      || event.revision !== current.revision
      || event.predecessorEvidenceSourceDigest !== current.predecessorEvidenceSourceDigest) {
      throw lifecycleError("REGIONAL_SITE_EVIDENCE_LIFECYCLE_BINDING_DRIFT", "lifecycle transition changed immutable evidence binding");
    }
    if (event.action === "supersede") {
      if (!event.replacementEvidenceSourceDigest
        || event.replacementEvidenceSourceDigest === current.evidenceSourceDigest) {
        throw lifecycleError("REGIONAL_SITE_EVIDENCE_LIFECYCLE_REPLACEMENT_INVALID", "supersede requires a different replacement evidence digest");
      }
    } else if (event.replacementEvidenceSourceDigest !== "") {
      throw lifecycleError("REGIONAL_SITE_EVIDENCE_LIFECYCLE_REPLACEMENT_INVALID", "replacement digest is allowed only for supersede");
    }
  }
  if (event.action === "review" && event.actorDigest === current.submitActorDigest) {
    throw lifecycleError("REGIONAL_SITE_EVIDENCE_LIFECYCLE_REVIEW_NOT_INDEPENDENT", "reviewer must differ from the evidence submitter");
  }
  if (event.action === "return" && event.actorDigest !== current.reviewActorDigest) {
    throw lifecycleError("REGIONAL_SITE_EVIDENCE_LIFECYCLE_REVIEWER_DRIFT", "the active reviewer must return the evidence");
  }
  if (event.action === "accept"
    && [current.submitActorDigest, current.reviewActorDigest].includes(event.actorDigest)) {
    throw lifecycleError("REGIONAL_SITE_EVIDENCE_LIFECYCLE_ACCEPTANCE_NOT_INDEPENDENT", "acceptance authority must differ from submitter and reviewer");
  }
  return binding;
}

function nextChainState(event, current) {
  return Object.freeze({
    regionCode: event.regionCode,
    releaseId: event.releaseId,
    compositeDigest: event.compositeDigest,
    regionalContentDigest: event.regionalContentDigest,
    evidenceSourceDigest: event.evidenceSourceDigest,
    predecessorEvidenceSourceDigest: event.predecessorEvidenceSourceDigest,
    replacementEvidenceSourceDigest: event.replacementEvidenceSourceDigest,
    revision: event.revision,
    state: event.toState,
    submitActorDigest: event.action === "submit" ? event.actorDigest : current?.submitActorDigest || "",
    reviewActorDigest: event.action === "review" ? event.actorDigest : current?.reviewActorDigest || "",
    latestAt: event.recordedAt,
    latestEventDigest: event.eventDigest
  });
}

function replayLifecycleRegistry(registry) {
  const chains = new Map();
  let previousEventDigest = "";
  let previousRecordedAt = "";
  for (let index = 0; index < registry.events.length; index += 1) {
    const event = registry.events[index];
    if (event.sequence !== index + 1
      || event.previousEventDigest !== previousEventDigest
      || event.eventDigest !== `sha256:${sha256(stableJson(eventPayload(event)))}`) {
      throw lifecycleError("REGIONAL_SITE_EVIDENCE_LIFECYCLE_CHAIN_INVALID", `lifecycle event ${index + 1} breaks the append-only digest chain`);
    }
    const key = chainKey(event.regionCode, event.releaseId);
    const current = chains.get(key);
    validateLifecycleEvent(event, current, { previousRecordedAt });
    chains.set(key, nextChainState(event, current));
    previousEventDigest = event.eventDigest;
    previousRecordedAt = event.recordedAt;
  }
  return chains;
}

function verifyEvidenceLifecycleRegistry(registry) {
  const checks = [];
  const shape = exactKeys(registry, REGISTRY_KEYS) && Array.isArray(registry?.events);
  checks.push({ id: "regionalEvidenceLifecycle:schema", passed: registry?.schemaVersion === REGISTRY_SCHEMA, detail: registry?.schemaVersion || "missing" });
  checks.push({ id: "regionalEvidenceLifecycle:shape", passed: shape, detail: shape ? `${registry.events.length} append-only events` : "invalid registry shape" });
  checks.push({
    id: "regionalEvidenceLifecycle:productionBoundary",
    passed: registry?.productionReady === false
      && registry?.appendOnly === true
      && registry?.authorizationBoundary === "external-production-authorization-required",
    detail: "lifecycle acceptance never grants production authorization"
  });
  let chains = new Map();
  let error = "";
  if (shape) {
    try {
      chains = replayLifecycleRegistry(registry);
    } catch (caught) {
      error = caught.code || caught.message;
    }
  } else {
    error = "REGIONAL_SITE_EVIDENCE_LIFECYCLE_REGISTRY_INVALID";
  }
  checks.push({ id: "regionalEvidenceLifecycle:eventChain", passed: !error, detail: error || `${chains.size} evidence chains verified` });
  const base = {
    schemaVersion: "regional-site-evidence-lifecycle-verification-v1",
    ok: checks.every((row) => row.passed),
    productionReady: false,
    eventCount: shape ? registry.events.length : 0,
    chainCount: chains.size,
    registryDigest: lifecycleRegistryDigest(registry),
    headEventDigest: shape ? registry.events.at(-1)?.eventDigest || "" : "",
    checks
  };
  return deepFreeze(base);
}

function getLifecycleChain(registry, regionCode, releaseId) {
  const verification = verifyEvidenceLifecycleRegistry(registry);
  if (!verification.ok) throw lifecycleError("REGIONAL_SITE_EVIDENCE_LIFECYCLE_REGISTRY_INVALID", "cannot read an invalid evidence lifecycle registry");
  return replayLifecycleRegistry(registry).get(chainKey(regionCode, releaseId)) || null;
}

function buildEvidenceLifecycleTransitionPlan(registry, options = {}) {
  const verification = verifyEvidenceLifecycleRegistry(registry);
  if (!verification.ok) throw lifecycleError("REGIONAL_SITE_EVIDENCE_LIFECYCLE_REGISTRY_INVALID", "cannot plan against an invalid evidence lifecycle registry");
  const action = String(options.action || "");
  if (!ACTIONS.includes(action)) throw lifecycleError("REGIONAL_SITE_EVIDENCE_LIFECYCLE_ACTION_INVALID", "unsupported evidence lifecycle action");
  const binding = normalizeBinding(options.binding || options);
  const current = getLifecycleChain(registry, binding.regionCode, binding.releaseId);
  const contract = ACTION_CONTRACT[action];
  const evidenceSourceDigest = action === "submit"
    ? String(options.evidenceSourceDigest || "").toLowerCase()
    : current?.evidenceSourceDigest || "";
  assertDigest(evidenceSourceDigest, "lifecycle evidenceSourceDigest");
  const actorDigest = String(options.actorDigest || "").toLowerCase();
  assertDigest(actorDigest, "lifecycle actorDigest");
  const recordedAt = options.recordedAt || new Date().toISOString();
  if (!validTimestamp(recordedAt)) throw lifecycleError("REGIONAL_SITE_EVIDENCE_LIFECYCLE_TIME_INVALID", "lifecycle recordedAt is invalid");
  const reasonCode = String(options.reasonCode || "");
  if (!REASON_CODE_PATTERN.test(reasonCode)) throw lifecycleError("REGIONAL_SITE_EVIDENCE_LIFECYCLE_REASON_INVALID", "lifecycle reasonCode is invalid");
  const payload = {
    sequence: registry.events.length + 1,
    ...binding,
    evidenceSourceDigest,
    revision: action === "submit" ? (current?.revision || 0) + 1 : current?.revision || 1,
    predecessorEvidenceSourceDigest: action === "submit" ? current?.evidenceSourceDigest || "" : current?.predecessorEvidenceSourceDigest || "",
    replacementEvidenceSourceDigest: action === "supersede" ? String(options.replacementEvidenceSourceDigest || "").toLowerCase() : "",
    action,
    fromState: current?.state || null,
    toState: contract.to,
    actorRole: contract.role,
    actorDigest,
    reasonCode,
    recordedAt,
    productionReady: false,
    previousEventDigest: verification.headEventDigest
  };
  const event = { ...payload, eventDigest: `sha256:${sha256(stableJson(payload))}` };
  validateLifecycleEvent(event, current, { previousRecordedAt: registry.events.at(-1)?.recordedAt || "" });
  return deepFreeze({
    schemaVersion: PLAN_SCHEMA,
    writes: false,
    productionReady: false,
    expectedRegistryDigest: verification.registryDigest,
    expectedHeadEventDigest: verification.headEventDigest,
    event
  });
}

function applyEvidenceLifecycleTransitionPlanToRegistry(registry, plan) {
  if (plan?.schemaVersion !== PLAN_SCHEMA) throw lifecycleError("REGIONAL_SITE_EVIDENCE_LIFECYCLE_PLAN_INVALID", "invalid evidence lifecycle plan");
  const verification = verifyEvidenceLifecycleRegistry(registry);
  if (!verification.ok
    || verification.registryDigest !== plan.expectedRegistryDigest
    || verification.headEventDigest !== plan.expectedHeadEventDigest) {
    throw lifecycleError("REGIONAL_SITE_EVIDENCE_LIFECYCLE_PLAN_STALE", "evidence lifecycle plan is stale");
  }
  const rebuilt = buildEvidenceLifecycleTransitionPlan(registry, {
    binding: plan.event,
    evidenceSourceDigest: plan.event.evidenceSourceDigest,
    replacementEvidenceSourceDigest: plan.event.replacementEvidenceSourceDigest,
    action: plan.event.action,
    actorDigest: plan.event.actorDigest,
    reasonCode: plan.event.reasonCode,
    recordedAt: plan.event.recordedAt
  });
  if (stableJson(rebuilt.event) !== stableJson(plan.event)) {
    throw lifecycleError("REGIONAL_SITE_EVIDENCE_LIFECYCLE_PLAN_MODIFIED", "evidence lifecycle plan was modified");
  }
  const next = clone(registry);
  next.events.push(clone(plan.event));
  const nextVerification = verifyEvidenceLifecycleRegistry(next);
  if (!nextVerification.ok) throw lifecycleError("REGIONAL_SITE_EVIDENCE_LIFECYCLE_APPLY_INVALID", "applied evidence lifecycle registry failed verification");
  return deepFreeze({ writes: false, productionReady: false, registry: next, event: clone(plan.event), verification: nextVerification });
}

function assertAbsoluteRegularFile(file, label, maximumBytes = MAX_REGISTRY_BYTES) {
  if (!file || !path.isAbsolute(file)) throw lifecycleError("REGIONAL_SITE_EVIDENCE_LIFECYCLE_PATH_INVALID", `${label} must use an absolute path`);
  const resolved = path.resolve(file);
  let stat;
  try {
    stat = fs.lstatSync(resolved);
  } catch {
    throw lifecycleError("REGIONAL_SITE_EVIDENCE_LIFECYCLE_FILE_UNAVAILABLE", `${label} is unavailable`);
  }
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size <= 0 || stat.size > maximumBytes) {
    throw lifecycleError("REGIONAL_SITE_EVIDENCE_LIFECYCLE_FILE_BOUNDARY_INVALID", `${label} must be a bounded non-empty regular file`);
  }
  return resolved;
}

function parseRegistryBytes(bytes) {
  let registry;
  try {
    registry = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw lifecycleError("REGIONAL_SITE_EVIDENCE_LIFECYCLE_JSON_INVALID", "evidence lifecycle registry is not valid JSON");
  }
  const verification = verifyEvidenceLifecycleRegistry(registry);
  if (!verification.ok) throw lifecycleError("REGIONAL_SITE_EVIDENCE_LIFECYCLE_REGISTRY_INVALID", "evidence lifecycle registry failed verification");
  return registry;
}

function readEvidenceLifecycleRegistry(file) {
  const resolved = assertAbsoluteRegularFile(file, "evidence lifecycle registry");
  return parseRegistryBytes(fs.readFileSync(resolved));
}

function readEvidenceLifecycleRegistryFile(file, expectedDigest, options = {}) {
  const resolved = assertAbsoluteRegularFile(file, "evidence lifecycle registry", Number(options.maximumBytes) || MAX_REGISTRY_BYTES);
  assertDigest(String(expectedDigest || "").toLowerCase(), "evidence lifecycle registry pin");
  const bytes = fs.readFileSync(resolved);
  const sourceDigest = `sha256:${sha256(bytes)}`;
  if (sourceDigest !== String(expectedDigest).toLowerCase()) {
    throw lifecycleError("REGIONAL_SITE_EVIDENCE_LIFECYCLE_DIGEST_MISMATCH", "evidence lifecycle registry does not match its SHA-256 pin");
  }
  return Object.freeze({ registry: parseRegistryBytes(bytes), sourceDigest });
}

function applyEvidenceLifecycleTransitionPlan(registryPath, plan) {
  if (!path.isAbsolute(String(registryPath || ""))) throw lifecycleError("REGIONAL_SITE_EVIDENCE_LIFECYCLE_PATH_INVALID", "evidence lifecycle registry path must be absolute");
  const absolutePath = path.resolve(registryPath);
  const lockPath = `${absolutePath}.lock`;
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  let lock;
  let temporaryPath;
  try {
    lock = fs.openSync(lockPath, "wx");
  } catch (error) {
    if (error.code === "EEXIST") throw lifecycleError("REGIONAL_SITE_EVIDENCE_LIFECYCLE_LOCKED", "evidence lifecycle operation is already in progress");
    throw error;
  }
  try {
    const registry = fs.existsSync(absolutePath)
      ? readEvidenceLifecycleRegistry(absolutePath)
      : createEmptyEvidenceLifecycleRegistry();
    const result = applyEvidenceLifecycleTransitionPlanToRegistry(registry, plan);
    temporaryPath = `${absolutePath}.tmp-${process.pid}`;
    fs.writeFileSync(temporaryPath, `${JSON.stringify(result.registry, null, 2)}\n`, "utf8");
    fs.renameSync(temporaryPath, absolutePath);
    return deepFreeze({ ...result, writes: true });
  } finally {
    if (lock !== undefined) fs.closeSync(lock);
    if (temporaryPath && fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath, { force: true });
    fs.rmSync(lockPath, { force: true });
  }
}

function summarizeEvidenceLifecycle(registry, expected = {}) {
  const verification = verifyEvidenceLifecycleRegistry(registry);
  const binding = normalizeBinding(expected);
  const evaluatedAt = Date.parse(expected.generatedAt || expected.now || new Date().toISOString());
  if (!Number.isFinite(evaluatedAt)) throw lifecycleError("REGIONAL_SITE_EVIDENCE_LIFECYCLE_TIME_INVALID", "lifecycle evaluation time is invalid");
  let current = null;
  let otherAcceptedRelease = false;
  if (verification.ok) {
    const chains = replayLifecycleRegistry(registry);
    current = chains.get(chainKey(binding.regionCode, binding.releaseId)) || null;
    otherAcceptedRelease = [...chains.values()].some((row) =>
      row.regionCode === binding.regionCode && row.releaseId !== binding.releaseId && row.state === "accepted"
    );
  }
  const bindingMatches = Boolean(current)
    && current.compositeDigest === binding.compositeDigest
    && current.regionalContentDigest === binding.regionalContentDigest;
  const evidenceMatches = Boolean(current)
    && current.evidenceSourceDigest === String(expected.evidenceSourceDigest || "").toLowerCase();
  const currentAtEvaluation = !current || Date.parse(current.latestAt) <= evaluatedAt;
  const accepted = verification.ok
    && current?.state === "accepted"
    && bindingMatches
    && evidenceMatches
    && currentAtEvaluation;
  const blockers = [
    !verification.ok && "REGIONAL_SITE_EVIDENCE_LIFECYCLE_REGISTRY_INVALID",
    verification.ok && !current && otherAcceptedRelease && "regional-site-evidence-lifecycle-release-stale",
    verification.ok && !current && !otherAcceptedRelease && "regional-site-evidence-lifecycle-not-submitted",
    current && !bindingMatches && "regional-site-evidence-lifecycle-binding-mismatch",
    current && !evidenceMatches && "regional-site-evidence-lifecycle-revision-mismatch",
    current && !currentAtEvaluation && "regional-site-evidence-lifecycle-event-in-future",
    current && current.state !== "accepted" && `regional-site-evidence-lifecycle-${current.state}`
  ].filter(Boolean);
  return deepFreeze({
    schemaVersion: "regional-site-evidence-lifecycle-status-v1",
    ok: verification.ok,
    productionReady: false,
    containsActorIdentities: false,
    containsEvidenceBodies: false,
    configured: true,
    accepted,
    state: current?.state || (otherAcceptedRelease ? "stale-release" : "not-submitted"),
    revision: current?.revision || 0,
    latestAt: current?.latestAt || "",
    bindingMatches,
    evidenceMatches,
    currentAtEvaluation,
    eventCount: verification.eventCount,
    registryDigest: verification.registryDigest,
    blockers
  });
}

function lifecycleEnvironmentKeys() {
  return Object.freeze({
    file: "REGIONAL_SITE_EVIDENCE_LIFECYCLE_REGISTRY_FILE",
    digest: "REGIONAL_SITE_EVIDENCE_LIFECYCLE_REGISTRY_SHA256"
  });
}

function unavailableLifecycleStatus(code, configured, ok = true) {
  return deepFreeze({
    schemaVersion: "regional-site-evidence-lifecycle-status-v1",
    ok,
    productionReady: false,
    containsActorIdentities: false,
    containsEvidenceBodies: false,
    configured,
    accepted: false,
    state: configured ? "invalid" : "unconfigured",
    revision: 0,
    latestAt: "",
    bindingMatches: false,
    evidenceMatches: false,
    currentAtEvaluation: false,
    eventCount: 0,
    registryDigest: "",
    blockers: [code]
  });
}

function loadEvidenceLifecycleStatus(options = {}) {
  if (options.lifecycleRegistry) return summarizeEvidenceLifecycle(options.lifecycleRegistry, options.expected || {});
  const env = options.env || {};
  const keys = lifecycleEnvironmentKeys();
  const file = options.lifecycleRegistryFile || env[keys.file];
  const digest = options.lifecycleRegistryDigest || env[keys.digest];
  if (!file && !digest) return unavailableLifecycleStatus("regional-site-evidence-lifecycle-unconfigured", false, true);
  if (!file || !digest) return unavailableLifecycleStatus("REGIONAL_SITE_EVIDENCE_LIFECYCLE_CONFIGURATION_INCOMPLETE", true, false);
  try {
    const loaded = readEvidenceLifecycleRegistryFile(file, digest, options);
    return summarizeEvidenceLifecycle(loaded.registry, options.expected || {});
  } catch (error) {
    return unavailableLifecycleStatus(error.code || "REGIONAL_SITE_EVIDENCE_LIFECYCLE_INVALID", true, false);
  }
}

module.exports = {
  ACTIONS,
  ACTION_CONTRACT,
  EVENT_KEYS,
  MAX_REGISTRY_BYTES,
  PLAN_SCHEMA,
  REGISTRY_SCHEMA,
  STATES,
  applyEvidenceLifecycleTransitionPlan,
  applyEvidenceLifecycleTransitionPlanToRegistry,
  buildEvidenceLifecycleTransitionPlan,
  createEmptyEvidenceLifecycleRegistry,
  getLifecycleChain,
  lifecycleEnvironmentKeys,
  lifecycleRegistryDigest,
  loadEvidenceLifecycleStatus,
  normalizeBinding,
  readEvidenceLifecycleRegistry,
  readEvidenceLifecycleRegistryFile,
  summarizeEvidenceLifecycle,
  verifyEvidenceLifecycleRegistry
};
