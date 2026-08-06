"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  deepFreeze,
  sha256,
  stableJson
} = require("./region-manifest");
const { verifyCompositeRegionalRelease } = require("./composite-release");

const REGISTRY_SCHEMA_VERSION = "regional-release-governance-v1";
const RELEASE_STATES = Object.freeze([
  "draft",
  "validation",
  "approved-candidate",
  "deployed",
  "verified",
  "rolled-back"
]);
const DATA_IMPACTS = Object.freeze(["none", "backward-compatible", "breaking"]);
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const REGION_CODE_PATTERN = /^\d{6}$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const CONTROLLED_REF_PATTERN = /^controlled:\/\/[A-Za-z0-9._/-]+$/;
const LEGAL_TRANSITIONS = Object.freeze({
  draft: Object.freeze(["validation"]),
  validation: Object.freeze(["approved-candidate"]),
  "approved-candidate": Object.freeze(["deployed"]),
  deployed: Object.freeze(["verified", "rolled-back"]),
  verified: Object.freeze(["rolled-back"]),
  "rolled-back": Object.freeze([])
});

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
}

function assertExactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  if (stableJson(actual) !== stableJson(required)) {
    throw new TypeError(`${label} must contain only: ${required.join(", ")}`);
  }
}

function assertTimestamp(value, label) {
  if (!value || !Number.isFinite(Date.parse(value))) {
    throw new TypeError(`${label} must be an ISO timestamp`);
  }
}

function assertDigest(value, label) {
  if (!DIGEST_PATTERN.test(String(value || ""))) {
    throw new TypeError(`${label} must be sha256:<64 lowercase hex>`);
  }
}

function assertControlledEvidence(value, label) {
  assertObject(value, label);
  assertExactKeys(value, ["ref", "digest", "recordedAt", "recordedBy"], label);
  if (!CONTROLLED_REF_PATTERN.test(String(value.ref || ""))) {
    throw new TypeError(`${label}.ref must be a controlled:// reference`);
  }
  assertDigest(value.digest, `${label}.digest`);
  assertTimestamp(value.recordedAt, `${label}.recordedAt`);
  if (!String(value.recordedBy || "").trim()) {
    throw new TypeError(`${label}.recordedBy is required`);
  }
  return value;
}

function normalizeReleaseBinding(release) {
  assertObject(release, "regional release");
  const normalized = {
    regionCode: String(release.regionCode || ""),
    releaseId: String(release.releaseId || "").trim(),
    regionVersion: String(release.regionVersion || ""),
    deploymentClass: String(release.deploymentClass || ""),
    platform: {
      version: String(release.platform?.version || ""),
      digest: String(release.platform?.digest || "").toLowerCase()
    },
    compositeDigest: String(release.compositeDigest || "").toLowerCase(),
    regionalContentDigest: String(release.regionalContentDigest || "").toLowerCase(),
    dataImpact: String(release.dataImpact || "none"),
    rollbackSnapshot: release.rollbackSnapshot ? clone(release.rollbackSnapshot) : null
  };
  if (!REGION_CODE_PATTERN.test(normalized.regionCode)) {
    throw new TypeError("regional release regionCode must be six digits");
  }
  if (!normalized.releaseId) throw new TypeError("regional release releaseId is required");
  if (!VERSION_PATTERN.test(normalized.regionVersion)) {
    throw new TypeError("regional release regionVersion must be semantic version");
  }
  if (!VERSION_PATTERN.test(normalized.platform.version)) {
    throw new TypeError("regional release platform.version must be semantic version");
  }
  if (!["production", "test"].includes(normalized.deploymentClass)) {
    throw new TypeError("regional release deploymentClass must be production or test");
  }
  assertDigest(normalized.platform.digest, "regional release platform.digest");
  assertDigest(normalized.compositeDigest, "regional release compositeDigest");
  assertDigest(normalized.regionalContentDigest, "regional release regionalContentDigest");
  if (!DATA_IMPACTS.includes(normalized.dataImpact)) {
    throw new TypeError(`regional release dataImpact must be one of ${DATA_IMPACTS.join(", ")}`);
  }
  if (normalized.rollbackSnapshot) {
    assertControlledEvidence(normalized.rollbackSnapshot, "regional release rollbackSnapshot");
  }
  const identityPayload = clone(normalized);
  return deepFreeze({
    ...normalized,
    identityDigest: `sha256:${sha256(stableJson(identityPayload))}`
  });
}

function buildReleaseBindingFromComposite(composite, options = {}) {
  const verification = verifyCompositeRegionalRelease(composite, {
    root: options.root,
    regionCode: composite?.region?.code
  });
  if (!verification.ok || composite?.technicalReady !== true || composite?.productionReady !== false) {
    throw new TypeError("regional composite release integrity verification failed");
  }
  return normalizeReleaseBinding({
    regionCode: composite.region.code,
    releaseId: composite.releaseId,
    regionVersion: composite.region.version,
    deploymentClass: composite.region.deploymentClass,
    platform: {
      version: composite.platform.version,
      digest: options.platformDigest
    },
    compositeDigest: composite.artifact.digest,
    regionalContentDigest: `sha256:${composite.region.contentDigest}`,
    dataImpact: options.dataImpact,
    rollbackSnapshot: options.rollbackSnapshot
  });
}

function createEmptyRegistry() {
  return {
    schemaVersion: REGISTRY_SCHEMA_VERSION,
    productionReady: false,
    approvalBoundary: "external-authority-only",
    appendOnly: true,
    events: []
  };
}

function eventPayload(event) {
  const { eventDigest, ...payload } = event;
  return payload;
}

function registryDigest(registry) {
  return `sha256:${sha256(stableJson(registry ?? null))}`;
}

function currentStateMap(registry) {
  const states = new Map();
  for (const event of registry.events || []) {
    states.set(`${event.release.regionCode}/${event.release.releaseId}`, event.toState);
  }
  return states;
}

function releaseMap(registry) {
  const releases = new Map();
  for (const event of registry.events || []) {
    const key = `${event.release.regionCode}/${event.release.releaseId}`;
    const known = releases.get(key);
    if (known && stableJson(known) !== stableJson(event.release)) {
      throw new TypeError(`immutable release identity changed for ${key}`);
    }
    releases.set(key, event.release);
  }
  return releases;
}

function validateTransition(fromState, toState) {
  if (fromState === null && toState === "draft") return;
  if (!RELEASE_STATES.includes(fromState) || !RELEASE_STATES.includes(toState)) {
    throw new TypeError(`invalid regional release state transition: ${fromState} -> ${toState}`);
  }
  if (!LEGAL_TRANSITIONS[fromState].includes(toState)) {
    throw new TypeError(`illegal regional release state transition: ${fromState} -> ${toState}`);
  }
}

function validateCandidateGate(event) {
  if (event.toState !== "approved-candidate") return;
  if (event.release.deploymentClass !== "production") {
    throw new TypeError("only a production-class regional release can become an approved candidate");
  }
  assertControlledEvidence(event.externalEvidence, "approved candidate externalEvidence");
  assertObject(event.review, "approved candidate review");
  assertExactKeys(
    event.review,
    ["reviewerId", "reviewedAt"],
    "approved candidate review"
  );
  if (!String(event.review.reviewerId || "").trim()) {
    throw new TypeError("approved candidate review.reviewerId is required");
  }
  assertTimestamp(event.review.reviewedAt, "approved candidate review.reviewedAt");
  if (event.review.reviewerId === event.actor) {
    throw new TypeError("approved candidate requires an independent reviewer");
  }
}

function validateDeploymentGate(event) {
  if (event.toState !== "deployed") return;
  assertControlledEvidence(event.externalAuthorization, "deployment externalAuthorization");
  if (event.externalAuthorization.recordedBy === event.actor) {
    throw new TypeError("deployment authorization must be recorded by an authority independent of the deploy actor");
  }
}

function validateTransitionMetadata(event) {
  if (event.toState !== "approved-candidate"
    && (event.externalEvidence !== null || event.review !== null)) {
    throw new TypeError("external evidence and review are allowed only for approved-candidate");
  }
  if (event.toState !== "deployed" && event.externalAuthorization !== null) {
    throw new TypeError("external authorization is allowed only for deployed");
  }
  if (event.toState !== "rolled-back" && event.rollback !== null) {
    throw new TypeError("rollback decision is allowed only for rolled-back");
  }
}

function verifyRegistry(registry) {
  const checks = [];
  const events = Array.isArray(registry?.events) ? registry.events : [];
  const registryShape = registry
    && typeof registry === "object"
    && !Array.isArray(registry)
    && Array.isArray(registry.events)
    && stableJson(Object.keys(registry).sort()) === stableJson([
      "appendOnly",
      "approvalBoundary",
      "events",
      "productionReady",
      "schemaVersion"
    ]);
  checks.push({
    id: "regionalReleaseRegistry:schema",
    passed: registry?.schemaVersion === REGISTRY_SCHEMA_VERSION,
    detail: registry?.schemaVersion || "missing"
  });
  checks.push({
    id: "regionalReleaseRegistry:shape",
    passed: registryShape,
    detail: registryShape ? `${events.length} append-only events` : "registry fields or events array are invalid"
  });
  checks.push({
    id: "regionalReleaseRegistry:production-boundary",
    passed: registry?.productionReady === false
      && registry?.approvalBoundary === "external-authority-only"
      && registry?.appendOnly === true,
    detail: "repository governance records external decisions but cannot authorize production"
  });
  let previousDigest = "";
  const states = new Map();
  const identities = new Map();
  const composites = new Map();
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    const key = `${event?.release?.regionCode}/${event?.release?.releaseId}`;
    let error = "";
    try {
      assertExactKeys(event, [
        "actor",
        "eventDigest",
        "externalAuthorization",
        "externalEvidence",
        "fromState",
        "previousEventDigest",
        "productionReady",
        "reason",
        "recordedAt",
        "release",
        "review",
        "rollback",
        "sequence",
        "toState"
      ], `release event ${index + 1}`);
      const release = normalizeReleaseBinding(event.release);
      if (stableJson(release) !== stableJson(event.release)) {
        throw new TypeError("release binding is not normalized");
      }
      if (event.sequence !== index + 1) throw new TypeError("sequence mismatch");
      if (event.previousEventDigest !== previousDigest) throw new TypeError("previous event digest mismatch");
      if (event.eventDigest !== `sha256:${sha256(stableJson(eventPayload(event)))}`) {
        throw new TypeError("event digest mismatch");
      }
      assertTimestamp(event.recordedAt, "release event recordedAt");
      if (!String(event.actor || "").trim()) throw new TypeError("release event actor is required");
      if (!String(event.reason || "").trim()) throw new TypeError("release event reason is required");
      const expectedFrom = states.has(key) ? states.get(key) : null;
      if (event.fromState !== expectedFrom) throw new TypeError("fromState does not match current state");
      validateTransition(event.fromState, event.toState);
      const knownIdentity = identities.get(key);
      if (knownIdentity && knownIdentity !== event.release.identityDigest) {
        throw new TypeError("immutable release identity changed");
      }
      const compositeOwner = composites.get(event.release.compositeDigest);
      if (compositeOwner && compositeOwner !== key) {
        throw new TypeError(`composite digest is already bound to ${compositeOwner}`);
      }
      validateCandidateGate(event);
      validateDeploymentGate(event);
      validateTransitionMetadata(event);
      if (event.productionReady !== false) {
        throw new TypeError("release event productionReady must remain false");
      }
      if (event.toState === "rolled-back") {
        assertObject(event.rollback, "rollback event rollback");
        const prefix = { ...registry, events: events.slice(0, index) };
        const expectedRollback = computeRollbackDecision(prefix, event.release);
        if (!expectedRollback.executable
          || stableJson(event.rollback) !== stableJson(expectedRollback)) {
          throw new TypeError("rollback event decision does not match the previous stable release and data policy");
        }
      }
      identities.set(key, event.release.identityDigest);
      composites.set(event.release.compositeDigest, key);
      states.set(key, event.toState);
    } catch (caught) {
      error = caught.message;
    }
    checks.push({
      id: `regionalReleaseRegistry:event-${index + 1}`,
      passed: !error,
      detail: error || `${key}: ${event.fromState ?? "new"} -> ${event.toState}`
    });
    previousDigest = String(event?.eventDigest || "");
  }
  return deepFreeze({
    ok: checks.every((check) => check.passed),
    productionReady: false,
    eventCount: events.length,
    registryDigest: registryDigest(registry),
    headEventDigest: events.at(-1)?.eventDigest || "",
    checks
  });
}

function readRegistry(registryPath) {
  if (!fs.existsSync(registryPath)) return createEmptyRegistry();
  const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  const verification = verifyRegistry(registry);
  if (!verification.ok) {
    const failed = verification.checks.find((check) => !check.passed);
    throw new TypeError(`regional release registry verification failed: ${failed.id}: ${failed.detail}`);
  }
  return registry;
}

function getReleaseState(registry, regionCode, releaseId) {
  return currentStateMap(registry).get(`${regionCode}/${releaseId}`) || null;
}

function getRelease(registry, regionCode, releaseId) {
  return releaseMap(registry).get(`${regionCode}/${releaseId}`) || null;
}

function findPreviousStableRelease(registry, regionCode, beforeReleaseId) {
  const cutoff = registry.events.find(
    (event) => event.release.regionCode === regionCode
      && event.release.releaseId === beforeReleaseId
      && event.toState === "deployed"
  )?.sequence ?? Number.POSITIVE_INFINITY;
  const latestVerifiedSequence = new Map();
  const rolledBack = new Set();
  for (const event of registry.events) {
    if (event.sequence >= cutoff
      || event.release.regionCode !== regionCode
      || event.release.releaseId === beforeReleaseId) continue;
    if (event.toState === "verified") latestVerifiedSequence.set(event.release.releaseId, event.sequence);
    if (event.toState === "rolled-back") rolledBack.add(event.release.releaseId);
  }
  const releaseId = [...latestVerifiedSequence.entries()]
    .filter(([candidate]) => !rolledBack.has(candidate))
    .sort((left, right) => right[1] - left[1])[0]?.[0];
  return releaseId ? getRelease(registry, regionCode, releaseId) : null;
}

function findActiveRelease(registry, regionCode) {
  let activeReleaseId = "";
  for (const event of registry.events) {
    if (event.release.regionCode !== regionCode) continue;
    if (event.toState === "deployed") activeReleaseId = event.release.releaseId;
    if (event.toState === "rolled-back" && activeReleaseId === event.release.releaseId) {
      activeReleaseId = event.rollback.previousStableReleaseId;
    }
  }
  return activeReleaseId ? getRelease(registry, regionCode, activeReleaseId) : null;
}

function computeRollbackDecision(registry, release) {
  const state = getReleaseState(registry, release.regionCode, release.releaseId);
  if (!["deployed", "verified"].includes(state)) {
    throw new TypeError(`release ${release.releaseId} is not deployed or verified`);
  }
  const active = findActiveRelease(registry, release.regionCode);
  if (active?.releaseId !== release.releaseId) {
    throw new TypeError(`release ${release.releaseId} is not the active regional deployment`);
  }
  const previous = findPreviousStableRelease(registry, release.regionCode, release.releaseId);
  const application = previous
    ? {
      allowed: true,
      action: "redeploy-previous-stable",
      targetReleaseId: previous.releaseId,
      targetIdentityDigest: previous.identityDigest
    }
    : {
      allowed: false,
      action: "blocked",
      targetReleaseId: "",
      targetIdentityDigest: "",
      reason: "no previous verified release is available"
    };
  let data;
  if (release.dataImpact === "none") {
    data = { allowed: true, action: "not-required", evidence: null };
  } else if (release.rollbackSnapshot) {
    data = {
      allowed: true,
      action: "restore-controlled-snapshot",
      evidence: clone(release.rollbackSnapshot)
    };
  } else {
    data = {
      allowed: false,
      action: "blocked",
      evidence: null,
      reason: `${release.dataImpact} data change has no controlled rollback snapshot`
    };
  }
  return deepFreeze({
    schemaVersion: "regional-rollback-decision-v1",
    productionReady: false,
    regionCode: release.regionCode,
    sourceReleaseId: release.releaseId,
    sourceState: state,
    previousStableReleaseId: previous?.releaseId || "",
    application,
    data,
    executable: application.allowed && data.allowed,
    boundary: "this decision does not perform application or data rollback"
  });
}

function buildRollbackDecision(registry, options = {}) {
  const verification = verifyRegistry(registry);
  if (!verification.ok) throw new TypeError("cannot decide rollback from an invalid regional release registry");
  const release = getRelease(registry, String(options.regionCode || ""), String(options.releaseId || ""));
  if (!release) throw new TypeError("rollback source release is not registered");
  return computeRollbackDecision(registry, release);
}

function buildVersionDiff(registry, options = {}) {
  const from = getRelease(registry, options.regionCode, options.fromReleaseId);
  const to = getRelease(registry, options.regionCode, options.toReleaseId);
  if (!from || !to) throw new TypeError("both regional releases must be registered before diff");
  const fields = [
    ["platform.version", from.platform.version, to.platform.version],
    ["platform.digest", from.platform.digest, to.platform.digest],
    ["regionVersion", from.regionVersion, to.regionVersion],
    ["regionalContentDigest", from.regionalContentDigest, to.regionalContentDigest],
    ["compositeDigest", from.compositeDigest, to.compositeDigest],
    ["dataImpact", from.dataImpact, to.dataImpact]
  ];
  const changes = fields
    .filter(([, left, right]) => left !== right)
    .map(([field, before, after]) => ({ field, before, after }));
  return deepFreeze({
    schemaVersion: "regional-release-diff-v1",
    productionReady: false,
    regionCode: options.regionCode,
    fromReleaseId: from.releaseId,
    toReleaseId: to.releaseId,
    changed: changes.length > 0,
    applicationChanged: from.platform.digest !== to.platform.digest,
    regionalContentChanged: from.regionalContentDigest !== to.regionalContentDigest,
    dataReviewRequired: to.dataImpact !== "none",
    changes
  });
}

function buildTransitionPlan(registry, options = {}) {
  const verification = verifyRegistry(registry);
  if (!verification.ok) throw new TypeError("cannot plan against an invalid regional release registry");
  const release = normalizeReleaseBinding(options.release);
  const existing = getRelease(registry, release.regionCode, release.releaseId);
  if (existing && existing.identityDigest !== release.identityDigest) {
    throw new TypeError(`immutable release identity collision: ${release.releaseId}`);
  }
  const compositeOwner = [...releaseMap(registry).values()].find(
    (candidate) => candidate.compositeDigest === release.compositeDigest
      && candidate.identityDigest !== release.identityDigest
  );
  if (compositeOwner) {
    throw new TypeError(`composite digest is already bound to ${compositeOwner.releaseId}`);
  }
  const fromState = getReleaseState(registry, release.regionCode, release.releaseId);
  const toState = String(options.toState || "");
  validateTransition(fromState, toState);
  const recordedAt = options.recordedAt || new Date().toISOString();
  assertTimestamp(recordedAt, "release transition recordedAt");
  const actor = String(options.actor || "").trim();
  const reason = String(options.reason || "").trim();
  if (!actor) throw new TypeError("release transition actor is required");
  if (!reason) throw new TypeError("release transition reason is required");
  const payload = {
    sequence: registry.events.length + 1,
    release,
    fromState,
    toState,
    actor,
    reason,
    recordedAt,
    productionReady: false,
    externalEvidence: options.externalEvidence ? clone(options.externalEvidence) : null,
    review: options.review ? clone(options.review) : null,
    externalAuthorization: options.externalAuthorization ? clone(options.externalAuthorization) : null,
    rollback: null,
    previousEventDigest: registry.events.at(-1)?.eventDigest || ""
  };
  if (toState === "rolled-back") {
    const decision = buildRollbackDecision(registry, {
      regionCode: release.regionCode,
      releaseId: release.releaseId
    });
    if (!decision.executable) throw new TypeError("rollback is blocked by application or data rollback decision");
    payload.rollback = decision;
  }
  validateCandidateGate(payload);
  validateDeploymentGate(payload);
  validateTransitionMetadata(payload);
  const event = {
    ...payload,
    eventDigest: `sha256:${sha256(stableJson(payload))}`
  };
  return deepFreeze({
    schemaVersion: "regional-release-transition-plan-v1",
    writes: false,
    productionReady: false,
    expectedRegistryDigest: verification.registryDigest,
    expectedHeadEventDigest: verification.headEventDigest,
    event
  });
}

function applyTransitionPlanToRegistry(registry, plan) {
  if (plan?.schemaVersion !== "regional-release-transition-plan-v1") {
    throw new TypeError("invalid regional release transition plan");
  }
  const verification = verifyRegistry(registry);
  if (!verification.ok) throw new TypeError("cannot apply to an invalid regional release registry");
  if (verification.registryDigest !== plan.expectedRegistryDigest
    || verification.headEventDigest !== plan.expectedHeadEventDigest) {
    throw new TypeError("regional release transition plan is stale");
  }
  const rebuilt = buildTransitionPlan(registry, {
    release: plan.event.release,
    toState: plan.event.toState,
    actor: plan.event.actor,
    reason: plan.event.reason,
    recordedAt: plan.event.recordedAt,
    externalEvidence: plan.event.externalEvidence,
    review: plan.event.review,
    externalAuthorization: plan.event.externalAuthorization
  });
  if (stableJson(rebuilt.event) !== stableJson(plan.event)) {
    throw new TypeError("regional release transition plan was modified");
  }
  const next = clone(registry);
  next.events.push(clone(plan.event));
  const nextVerification = verifyRegistry(next);
  if (!nextVerification.ok) throw new TypeError("applied regional release registry failed verification");
  return deepFreeze({
    writes: false,
    productionReady: false,
    registry: next,
    event: clone(plan.event),
    verification: nextVerification
  });
}

function applyTransitionPlan(registryPath, plan) {
  const absolutePath = path.resolve(registryPath);
  const lockPath = `${absolutePath}.lock`;
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  let lock;
  let temporaryPath;
  try {
    lock = fs.openSync(lockPath, "wx");
  } catch (error) {
    if (error.code === "EEXIST") throw new TypeError("regional release governance operation is in progress");
    throw error;
  }
  try {
    const registry = readRegistry(absolutePath);
    const result = applyTransitionPlanToRegistry(registry, plan);
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

function summarizeRegistry(registry) {
  const verification = verifyRegistry(registry);
  const states = currentStateMap(registry);
  const releases = [...releaseMap(registry).values()].map((release) => ({
    regionCode: release.regionCode,
    releaseId: release.releaseId,
    identityDigest: release.identityDigest,
    state: states.get(`${release.regionCode}/${release.releaseId}`)
  }));
  return deepFreeze({
    schemaVersion: "regional-release-governance-summary-v1",
    ok: verification.ok,
    productionReady: false,
    registryDigest: verification.registryDigest,
    eventCount: verification.eventCount,
    releases
  });
}

module.exports = {
  CONTROLLED_REF_PATTERN,
  DATA_IMPACTS,
  DIGEST_PATTERN,
  LEGAL_TRANSITIONS,
  REGISTRY_SCHEMA_VERSION,
  RELEASE_STATES,
  applyTransitionPlan,
  applyTransitionPlanToRegistry,
  buildReleaseBindingFromComposite,
  buildRollbackDecision,
  buildTransitionPlan,
  buildVersionDiff,
  createEmptyRegistry,
  findActiveRelease,
  findPreviousStableRelease,
  getRelease,
  getReleaseState,
  normalizeReleaseBinding,
  readRegistry,
  registryDigest,
  summarizeRegistry,
  verifyRegistry
};
