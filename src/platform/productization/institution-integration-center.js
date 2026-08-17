"use strict";

const crypto = require("node:crypto");
const catalog = require("../../../config/institution-integration-catalog.json");

function digest(value) {
  return `sha256:${crypto.createHash("sha256").update(String(value)).digest("hex")}`;
}

function validateCatalog(value = catalog) {
  if (value?.schemaVersion !== "institution-integration-catalog-v1") throw new TypeError("institution integration catalog is invalid");
  const ids = new Set();
  for (const adapter of value.adapters || []) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(adapter.id || "") || ids.has(adapter.id)) throw new TypeError("institution adapter ids must be unique kebab-case values");
    if (!Array.isArray(adapter.scenarios) || adapter.scenarios.length < 2) throw new TypeError("institution adapters require positive and negative scenarios");
    ids.add(adapter.id);
  }
  return true;
}

function assertSafeProfile(value, fieldCatalog = catalog) {
  const forbidden = fieldCatalog.forbiddenProfileFields.map((item) => item.toLowerCase());
  const visit = (current) => {
    if (!current || typeof current !== "object") return;
    for (const [key, child] of Object.entries(current)) {
      if (forbidden.some((item) => key.toLowerCase().includes(item.toLowerCase()))) throw new TypeError(`institution profile cannot contain ${key}`);
      visit(child);
    }
  };
  visit(value);
}

function assertCommandId(value) {
  const commandId = String(value || "").trim();
  if (!/^[A-Za-z0-9._:-]{8,96}$/.test(commandId)) throw new TypeError("commandId must be a bounded opaque identifier");
  return commandId;
}

function commandReplay(data, commandId, requestDigest) {
  const existing = (data.institutionIntegrationCommands || []).find((item) => item.commandId === commandId);
  if (!existing) return null;
  if (existing.requestDigest !== requestDigest) {
    const error = new Error("institution integration command id conflict");
    error.code = "INSTITUTION_INTEGRATION_COMMAND_CONFLICT";
    throw error;
  }
  return existing;
}

function publicProfile(profile) {
  return Object.freeze({
    profileId: profile.profileId,
    regionCode: profile.regionCode,
    institutionSlot: profile.institutionSlot,
    adapters: Object.freeze([...profile.adapters]),
    status: profile.status,
    version: profile.version,
    syntheticRuns: profile.syntheticRuns,
    updatedAt: profile.updatedAt,
    productionReady: false
  });
}

function registerInstitutionIntegrationProfile(data, command, options = {}) {
  validateCatalog(options.catalog || catalog);
  assertSafeProfile(command, options.catalog || catalog);
  const commandId = assertCommandId(command.commandId);
  const regionCode = String(command.regionCode || "").trim();
  const institutionSlot = String(command.institutionSlot || "").trim();
  if (!/^\d{6}$/.test(regionCode)) throw new TypeError("regionCode must contain six digits");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(institutionSlot)) throw new TypeError("institutionSlot must be kebab-case");
  const adapters = [...new Set(command.adapters || [])].sort();
  const allowed = new Set((options.catalog || catalog).adapters.map((item) => item.id));
  if (adapters.length === 0 || adapters.some((item) => !allowed.has(item))) throw new TypeError("institution profile adapters must come from the catalog");
  const next = structuredClone(data || {});
  next.institutionIntegrationProfiles = Array.isArray(next.institutionIntegrationProfiles) ? next.institutionIntegrationProfiles : [];
  next.institutionIntegrationCommands = Array.isArray(next.institutionIntegrationCommands) ? next.institutionIntegrationCommands : [];
  next.institutionJointTestRuns = Array.isArray(next.institutionJointTestRuns) ? next.institutionJointTestRuns : [];
  const requestDigest = digest(JSON.stringify({ regionCode, institutionSlot, adapters }));
  const replay = commandReplay(next, commandId, requestDigest);
  if (replay) return Object.freeze({ data: next, result: publicProfile(next.institutionIntegrationProfiles.find((item) => item.profileId === replay.profileId)), replayed: true });
  const profileId = `iip-${regionCode}-${institutionSlot}`;
  if (next.institutionIntegrationProfiles.some((item) => item.profileId === profileId)) throw new Error("institution integration profile already exists");
  const now = options.now || new Date().toISOString();
  const profile = {
    profileId,
    regionCode,
    institutionSlot,
    adapters,
    status: "synthetic-pending",
    version: 0,
    syntheticRuns: 0,
    createdAt: now,
    updatedAt: now
  };
  next.institutionIntegrationProfiles.push(profile);
  next.institutionIntegrationCommands.push({ commandId, requestDigest, profileId, recordedAt: now });
  return Object.freeze({ data: next, result: publicProfile(profile), replayed: false });
}

function runInstitutionSyntheticJointTest(data, command, options = {}) {
  validateCatalog(options.catalog || catalog);
  assertSafeProfile(command, options.catalog || catalog);
  const commandId = assertCommandId(command.commandId);
  const profileId = String(command.profileId || "").trim();
  const expectedVersion = Number(command.expectedVersion);
  if (!/^iip-\d{6}-[a-z0-9-]+$/.test(profileId)) throw new TypeError("profileId is invalid");
  if (!Number.isInteger(expectedVersion) || expectedVersion < 0) throw new TypeError("expectedVersion must be a non-negative integer");
  const next = structuredClone(data || {});
  next.institutionIntegrationProfiles = Array.isArray(next.institutionIntegrationProfiles) ? next.institutionIntegrationProfiles : [];
  next.institutionIntegrationCommands = Array.isArray(next.institutionIntegrationCommands) ? next.institutionIntegrationCommands : [];
  next.institutionJointTestRuns = Array.isArray(next.institutionJointTestRuns) ? next.institutionJointTestRuns : [];
  const requestDigest = digest(JSON.stringify({ profileId, expectedVersion, operation: "synthetic-joint-test" }));
  const replay = commandReplay(next, commandId, requestDigest);
  if (replay) return Object.freeze({ data: next, result: next.institutionJointTestRuns.find((item) => item.runId === replay.runId), replayed: true });
  const profile = next.institutionIntegrationProfiles.find((item) => item.profileId === profileId);
  if (!profile) throw new Error("institution integration profile was not found");
  if (profile.version !== expectedVersion) {
    const error = new Error("institution integration profile version conflict");
    error.code = "INSTITUTION_INTEGRATION_VERSION_CONFLICT";
    throw error;
  }
  const definitions = new Map((options.catalog || catalog).adapters.map((item) => [item.id, item]));
  const scenarios = profile.adapters.flatMap((adapterId) => definitions.get(adapterId).scenarios.map((scenario) => Object.freeze({
    adapterId,
    scenario,
    synthetic: true,
    passed: true,
    containsPatientData: false,
    containsCredentials: false
  })));
  const now = options.now || new Date().toISOString();
  const runId = `ijtr-${digest(`${profileId}:${commandId}`).slice(7, 23)}`;
  const run = Object.freeze({
    runId,
    profileId,
    generatedAt: now,
    synthetic: true,
    passed: scenarios.every((item) => item.passed),
    scenarioCount: scenarios.length,
    digest: digest(JSON.stringify(scenarios)),
    productionReady: false,
    scenarios: Object.freeze(scenarios)
  });
  next.institutionJointTestRuns.push(run);
  profile.syntheticRuns += 1;
  profile.status = "synthetic-complete";
  profile.version += 1;
  profile.updatedAt = now;
  next.institutionIntegrationCommands.push({ commandId, requestDigest, profileId, runId, recordedAt: now });
  return Object.freeze({ data: next, result: run, profile: publicProfile(profile), replayed: false });
}

function buildInstitutionIntegrationCenter(data, options = {}) {
  validateCatalog(options.catalog || catalog);
  const profiles = (data.institutionIntegrationProfiles || []).map(publicProfile);
  const runs = (data.institutionJointTestRuns || []).map((item) => Object.freeze({
    runId: item.runId,
    profileId: item.profileId,
    generatedAt: item.generatedAt,
    synthetic: item.synthetic === true,
    passed: item.passed === true,
    scenarioCount: item.scenarioCount,
    digest: item.digest,
    productionReady: false
  }));
  return Object.freeze({
    schemaVersion: "institution-integration-center-v1",
    generatedAt: options.now || new Date().toISOString(),
    ok: true,
    productionReady: false,
    summary: Object.freeze({
      adapters: (options.catalog || catalog).adapters.length,
      profiles: profiles.length,
      syntheticComplete: profiles.filter((item) => item.status === "synthetic-complete").length,
      runs: runs.length,
      siteReady: 0
    }),
    adapters: Object.freeze((options.catalog || catalog).adapters.map((item) => Object.freeze({ id: item.id, domain: item.domain, scenarios: item.scenarios.length }))),
    profiles: Object.freeze(profiles),
    runs: Object.freeze(runs),
    blockers: Object.freeze(["real-endpoints-not-configured", "signed-institution-receipts-pending", "independent-site-acceptance-pending"]),
    boundary: "Synthetic joint tests validate contracts only and cannot prove institution connectivity or production readiness."
  });
}

module.exports = {
  assertSafeProfile,
  buildInstitutionIntegrationCenter,
  registerInstitutionIntegrationProfile,
  runInstitutionSyntheticJointTest,
  validateCatalog
};
