"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  deepFreeze,
  sha256,
  stableJson
} = require("./region-manifest");
const { buildCompositeRegionalRelease } = require("./composite-release");
const { buildExpectedSites } = require("./multi-region-operations");

const DEFAULT_ROOT = path.resolve(__dirname, "..", "..", "..");
const MAX_EVIDENCE_FILE_BYTES = 512 * 1024;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const REGION_CODE_PATTERN = /^\d{6}$/;
const CONTROLLED_REF_PATTERN = /^controlled:\/\/[a-z0-9][a-z0-9._/-]{2,255}$/;
const EVIDENCE_SCOPES = Object.freeze([
  "identity-and-institution",
  "hospital-joint-test",
  "security-and-compliance",
  "operations-and-disaster-recovery",
  "independent-site-acceptance"
]);
const MANIFEST_KEYS = Object.freeze([
  "schemaVersion",
  "regionCode",
  "releaseId",
  "compositeDigest",
  "regionalContentDigest",
  "issuedAt",
  "expiresAt",
  "evidence"
]);
const EVIDENCE_KEYS = Object.freeze([
  "scope",
  "ref",
  "digest",
  "subjectDigest",
  "verifiedAt",
  "expiresAt",
  "custodianRole",
  "reviewerRole"
]);

function evidenceError(code, message) {
  return Object.assign(new Error(message), { code, statusCode: 400 });
}

function exactKeys(value, expected) {
  return value && typeof value === "object" && !Array.isArray(value)
    && stableJson(Object.keys(value).sort()) === stableJson([...expected].sort());
}

function validTimestamp(value) {
  return typeof value === "string" && value.length <= 40 && Number.isFinite(Date.parse(value));
}

function normalizeDigest(value) {
  const clean = String(value || "").trim().toLowerCase();
  if (/^[a-f0-9]{64}$/.test(clean)) return `sha256:${clean}`;
  return clean;
}

function environmentKeys(regionCode) {
  if (!REGION_CODE_PATTERN.test(String(regionCode || ""))) {
    throw evidenceError("REGIONAL_SITE_EVIDENCE_REGION_INVALID", "regional site evidence requires a six-digit region code");
  }
  return Object.freeze({
    file: `REGIONAL_SITE_${regionCode}_EVIDENCE_FILE`,
    digest: `REGIONAL_SITE_${regionCode}_EVIDENCE_SHA256`
  });
}

function resolveEvidenceFile(value) {
  const file = String(value || "").trim();
  if (!file || !path.isAbsolute(file)) {
    throw evidenceError("REGIONAL_SITE_EVIDENCE_PATH_INVALID", "regional site evidence file must use an absolute path");
  }
  return path.resolve(file);
}

function readRegionalSiteEvidenceFile(file, expectedDigest, options = {}) {
  const resolved = resolveEvidenceFile(file);
  let stat;
  try {
    stat = fs.lstatSync(resolved);
  } catch {
    throw evidenceError("REGIONAL_SITE_EVIDENCE_FILE_UNAVAILABLE", "regional site evidence file is unavailable");
  }
  const maximumBytes = Number(options.maximumBytes) || MAX_EVIDENCE_FILE_BYTES;
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size <= 0 || stat.size > maximumBytes) {
    throw evidenceError("REGIONAL_SITE_EVIDENCE_FILE_BOUNDARY_INVALID", "regional site evidence must be a bounded non-empty regular file");
  }
  const pinnedDigest = normalizeDigest(expectedDigest);
  if (!SHA256_PATTERN.test(pinnedDigest)) {
    throw evidenceError("REGIONAL_SITE_EVIDENCE_DIGEST_INVALID", "regional site evidence requires a SHA-256 pin");
  }
  const bytes = fs.readFileSync(resolved);
  const actualDigest = `sha256:${sha256(bytes)}`;
  if (actualDigest !== pinnedDigest) {
    throw evidenceError("REGIONAL_SITE_EVIDENCE_DIGEST_MISMATCH", "regional site evidence does not match its SHA-256 pin");
  }
  let manifest;
  try {
    manifest = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw evidenceError("REGIONAL_SITE_EVIDENCE_JSON_INVALID", "regional site evidence is not valid JSON");
  }
  return Object.freeze({ manifest, sourceDigest: actualDigest });
}

function validateManifestStructure(manifest) {
  if (!exactKeys(manifest, MANIFEST_KEYS)
    || manifest.schemaVersion !== "regional-site-evidence-v1"
    || !REGION_CODE_PATTERN.test(String(manifest.regionCode || ""))
    || !String(manifest.releaseId || "").trim()
    || !SHA256_PATTERN.test(normalizeDigest(manifest.compositeDigest))
    || !SHA256_PATTERN.test(normalizeDigest(manifest.regionalContentDigest))
    || !validTimestamp(manifest.issuedAt)
    || !validTimestamp(manifest.expiresAt)
    || !Array.isArray(manifest.evidence)) {
    throw evidenceError("REGIONAL_SITE_EVIDENCE_MANIFEST_INVALID", "regional site evidence manifest contract is invalid");
  }
  for (const item of manifest.evidence) {
    if (!exactKeys(item, EVIDENCE_KEYS)
      || !EVIDENCE_SCOPES.includes(item.scope)
      || !CONTROLLED_REF_PATTERN.test(String(item.ref || ""))
      || !SHA256_PATTERN.test(normalizeDigest(item.digest))
      || !SHA256_PATTERN.test(normalizeDigest(item.subjectDigest))
      || !validTimestamp(item.verifiedAt)
      || !validTimestamp(item.expiresAt)
      || !String(item.custodianRole || "").trim()
      || !String(item.reviewerRole || "").trim()) {
      throw evidenceError("REGIONAL_SITE_EVIDENCE_ITEM_INVALID", "regional site evidence item contract is invalid");
    }
  }
}

function assessRegionalSiteEvidenceManifest(manifest, expected = {}, options = {}) {
  validateManifestStructure(manifest);
  const generatedAt = options.generatedAt || options.now || new Date().toISOString();
  if (!validTimestamp(generatedAt)) {
    throw evidenceError("REGIONAL_SITE_EVIDENCE_TIME_INVALID", "regional site evidence assessment time is invalid");
  }
  const now = Date.parse(generatedAt);
  const normalized = {
    regionCode: String(manifest.regionCode),
    releaseId: String(manifest.releaseId),
    compositeDigest: normalizeDigest(manifest.compositeDigest),
    regionalContentDigest: normalizeDigest(manifest.regionalContentDigest),
    issuedAt: manifest.issuedAt,
    expiresAt: manifest.expiresAt
  };
  const expectedBinding = {
    regionCode: String(expected.regionCode || ""),
    releaseId: String(expected.releaseId || ""),
    compositeDigest: normalizeDigest(expected.compositeDigest),
    regionalContentDigest: normalizeDigest(expected.regionalContentDigest)
  };
  const manifestCurrent = Date.parse(normalized.issuedAt) <= now && Date.parse(normalized.expiresAt) > now;
  const bindingMatches = Object.entries(expectedBinding).every(([key, value]) => value && normalized[key] === value);
  const scopes = EVIDENCE_SCOPES.map((scope) => {
    const items = manifest.evidence.filter((item) => item.scope === scope);
    const item = items[0];
    const presentOnce = items.length === 1;
    const current = presentOnce && Date.parse(item.verifiedAt) <= now && Date.parse(item.expiresAt) > now;
    const independentReview = presentOnce
      && item.custodianRole.trim().toLowerCase() !== item.reviewerRole.trim().toLowerCase();
    const subjectMatches = presentOnce && normalizeDigest(item.subjectDigest) === normalized.compositeDigest;
    const timelineValid = presentOnce
      && Date.parse(item.verifiedAt) >= Date.parse(normalized.issuedAt)
      && Date.parse(item.verifiedAt) < Date.parse(item.expiresAt)
      && Date.parse(item.expiresAt) <= Date.parse(normalized.expiresAt);
    return Object.freeze({
      scope,
      presentOnce,
      current,
      independentReview,
      subjectMatches,
      timelineValid,
      evidenceDigest: presentOnce ? normalizeDigest(item.digest) : "",
      verifiedAt: presentOnce ? item.verifiedAt : "",
      expiresAt: presentOnce ? item.expiresAt : "",
      ready: presentOnce && current && independentReview && subjectMatches && timelineValid
    });
  });
  const blockers = [
    !bindingMatches && "regional-site-evidence-binding-mismatch",
    !manifestCurrent && "regional-site-evidence-manifest-not-current",
    ...scopes.filter((item) => !item.presentOnce).map((item) => `regional-site-evidence-${item.scope}-missing-or-duplicate`),
    ...scopes.filter((item) => item.presentOnce && !item.current).map((item) => `regional-site-evidence-${item.scope}-not-current`),
    ...scopes.filter((item) => item.presentOnce && !item.independentReview).map((item) => `regional-site-evidence-${item.scope}-review-not-independent`),
    ...scopes.filter((item) => item.presentOnce && !item.subjectMatches).map((item) => `regional-site-evidence-${item.scope}-subject-mismatch`),
    ...scopes.filter((item) => item.presentOnce && !item.timelineValid).map((item) => `regional-site-evidence-${item.scope}-timeline-invalid`)
  ].filter(Boolean);
  const base = {
    schemaVersion: "regional-site-evidence-status-v1",
    generatedAt,
    regionCode: normalized.regionCode,
    configured: true,
    ok: true,
    evidenceReady: bindingMatches && manifestCurrent && scopes.every((item) => item.ready),
    productionReady: false,
    containsEvidenceBodies: false,
    containsReviewerIdentities: false,
    sourceDigest: options.sourceDigest || `sha256:${sha256(stableJson(manifest))}`,
    binding: {
      releaseId: normalized.releaseId,
      compositeDigest: normalized.compositeDigest,
      regionalContentDigest: normalized.regionalContentDigest,
      matches: bindingMatches
    },
    validity: {
      issuedAt: normalized.issuedAt,
      expiresAt: normalized.expiresAt,
      current: manifestCurrent
    },
    summary: {
      requiredScopes: EVIDENCE_SCOPES.length,
      presentOnce: scopes.filter((item) => item.presentOnce).length,
      current: scopes.filter((item) => item.current).length,
      independentlyReviewed: scopes.filter((item) => item.independentReview).length,
      subjectBound: scopes.filter((item) => item.subjectMatches).length,
      timelineValid: scopes.filter((item) => item.timelineValid).length,
      ready: scopes.filter((item) => item.ready).length
    },
    scopes,
    blockers
  };
  return deepFreeze({
    ...base,
    statusDigest: `sha256:${sha256(stableJson(base))}`
  });
}

function unavailableStatus(regionCode, generatedAt, code, configured = false) {
  const base = {
    schemaVersion: "regional-site-evidence-status-v1",
    generatedAt,
    regionCode,
    configured,
    ok: !configured,
    evidenceReady: false,
    productionReady: false,
    containsEvidenceBodies: false,
    containsReviewerIdentities: false,
    sourceDigest: "",
    binding: { releaseId: "", compositeDigest: "", regionalContentDigest: "", matches: false },
    validity: { issuedAt: "", expiresAt: "", current: false },
    summary: {
      requiredScopes: EVIDENCE_SCOPES.length,
      presentOnce: 0,
      current: 0,
      independentlyReviewed: 0,
      subjectBound: 0,
      timelineValid: 0,
      ready: 0
    },
    scopes: EVIDENCE_SCOPES.map((scope) => Object.freeze({
      scope,
      presentOnce: false,
      current: false,
      independentReview: false,
      subjectMatches: false,
      timelineValid: false,
      evidenceDigest: "",
      verifiedAt: "",
      expiresAt: "",
      ready: false
    })),
    blockers: [code]
  };
  return deepFreeze({ ...base, statusDigest: `sha256:${sha256(stableJson(base))}` });
}

function buildRegionalSiteEvidenceStatus(options = {}) {
  const regionCode = String(options.regionCode || options.expected?.regionCode || "");
  const generatedAt = options.generatedAt || options.now || new Date().toISOString();
  environmentKeys(regionCode);
  if (options.manifest) {
    try {
      return assessRegionalSiteEvidenceManifest(options.manifest, options.expected || {}, {
        generatedAt,
        sourceDigest: options.sourceDigest
      });
    } catch (error) {
      return unavailableStatus(regionCode, generatedAt, error.code || "REGIONAL_SITE_EVIDENCE_INVALID", true);
    }
  }
  const env = options.env || {};
  const keys = environmentKeys(regionCode);
  const file = options.file || env[keys.file];
  const digest = options.digest || env[keys.digest];
  if (!file && !digest) {
    return unavailableStatus(regionCode, generatedAt, "regional-site-evidence-unconfigured", false);
  }
  if (!file || !digest) {
    return unavailableStatus(regionCode, generatedAt, "REGIONAL_SITE_EVIDENCE_CONFIGURATION_INCOMPLETE", true);
  }
  try {
    const loaded = readRegionalSiteEvidenceFile(file, digest, options);
    return assessRegionalSiteEvidenceManifest(loaded.manifest, options.expected || {}, {
      generatedAt,
      sourceDigest: loaded.sourceDigest
    });
  } catch (error) {
    return unavailableStatus(regionCode, generatedAt, error.code || "REGIONAL_SITE_EVIDENCE_INVALID", true);
  }
}

function buildRegionalSiteEvidencePortfolio(options = {}) {
  const root = options.root || DEFAULT_ROOT;
  const generatedAt = options.generatedAt || options.now || new Date().toISOString();
  const regions = buildExpectedSites({ root, generatedAt }).map((site) => {
    const composite = buildCompositeRegionalRelease({
      root,
      regionCode: site.regionCode,
      generatedAt
    });
    return buildRegionalSiteEvidenceStatus({
      ...options,
      root,
      generatedAt,
      regionCode: site.regionCode,
      expected: {
        regionCode: site.regionCode,
        releaseId: composite.releaseId,
        compositeDigest: composite.artifact.digest,
        regionalContentDigest: `sha256:${composite.region.contentDigest}`
      }
    });
  });
  return deepFreeze({
    schemaVersion: "regional-site-evidence-portfolio-v1",
    generatedAt,
    ok: regions.every((item) => item.ok),
    productionReady: false,
    containsEvidenceBodies: false,
    summary: {
      regions: regions.length,
      verifierHealthy: regions.filter((item) => item.ok).length,
      configured: regions.filter((item) => item.configured).length,
      evidenceReady: regions.filter((item) => item.evidenceReady).length,
      blocked: regions.filter((item) => !item.evidenceReady).length
    },
    regions
  });
}

module.exports = {
  CONTROLLED_REF_PATTERN,
  EVIDENCE_SCOPES,
  MAX_EVIDENCE_FILE_BYTES,
  SHA256_PATTERN,
  assessRegionalSiteEvidenceManifest,
  buildRegionalSiteEvidencePortfolio,
  buildRegionalSiteEvidenceStatus,
  environmentKeys,
  normalizeDigest,
  readRegionalSiteEvidenceFile,
  resolveEvidenceFile,
  validateManifestStructure
};
