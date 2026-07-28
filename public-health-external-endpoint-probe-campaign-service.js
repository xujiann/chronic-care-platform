"use strict";

const crypto = require("node:crypto");
const {
  EXTERNAL_ADAPTER_PROFILES
} = require("./public-health-external-adapter-service");
const {
  TRUSTED_ATTESTATION_ORIGIN,
  TRUSTED_VERIFICATION_SOURCE,
  normalizedEndpointProbePayload,
  verifyPublicHealthExternalEndpointProbeReceipt
} = require("./public-health-external-endpoint-verification-service");
const {
  normalizeProbePolicy
} = require("./public-health-external-endpoint-probe-runner");
const {
  resolveVerificationKey,
  selectSigningKey
} = require("./public-health-external-keyring-service");

const ENDPOINT_PROBE_CAMPAIGN_SCHEMA_VERSION = "public-health-external-endpoint-probe-campaign/v2";
const DEFAULT_CAMPAIGN_TTL_SECONDS = 3600;
const MAX_CAMPAIGN_TTL_SECONDS = 3600;
const MAX_CAMPAIGN_DURATION_SECONDS = 300;
const DEFAULT_REQUIRED_CONSECUTIVE_CAMPAIGNS = 3;
const DEFAULT_MAX_CAMPAIGN_GAP_SECONDS = 900;
const ENDPOINT_PROBE_CAMPAIGN_KEYRING_PURPOSE = "public-health-endpoint-probe-campaign";

function clean(value) {
  return String(value ?? "").trim();
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

function timingSafeHexEqual(left, right) {
  if (!/^[a-f0-9]{64}$/i.test(clean(left)) || !/^[a-f0-9]{64}$/i.test(clean(right))) return false;
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function timeValue(value, label) {
  const parsed = new Date(value).getTime();
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be a valid date-time`);
  return parsed;
}

function digest(value, label) {
  const normalized = clean(value).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw new Error(`${label} must be a SHA-256 digest`);
  return normalized;
}

function profileForLane(laneId) {
  return EXTERNAL_ADAPTER_PROFILES.find((item) => item.laneId === clean(laneId));
}

function canonicalCampaignVerification(value = {}) {
  return {
    attestationOrigin: clean(value.attestationOrigin),
    verificationSource: clean(value.verificationSource),
    signatureVerified: value.signatureVerified === true
  };
}

function canonicalProbePolicy(value = {}) {
  const policy = normalizeProbePolicy(value);
  return {
    maxLatencyMs: policy.maxLatencyMs,
    timeoutMs: policy.timeoutMs,
    ttlSeconds: policy.ttlSeconds,
    method: policy.method,
    requireMutualTls: policy.requireMutualTls,
    certificatePins: [...policy.certificatePins].sort()
  };
}

function probePolicyDigest(value = {}) {
  return sha256(stableStringify(canonicalProbePolicy(value)));
}

function endpointProbeReceiptDigest(receipt = {}) {
  return sha256(stableStringify({
    ...normalizedEndpointProbePayload(receipt),
    signature: clean(receipt.signature).toLowerCase()
  }));
}

function canonicalCampaignEntry(value = {}) {
  return {
    laneId: clean(value.laneId),
    adapterId: clean(value.adapterId),
    contract: clean(value.contract),
    receiptId: clean(value.receiptId),
    receiptDigest: clean(value.receiptDigest).toLowerCase(),
    endpointDigest: clean(value.endpointDigest).toLowerCase(),
    policyDigest: clean(value.policyDigest).toLowerCase(),
    receiptIssuedAt: clean(value.receiptIssuedAt),
    receiptExpiresAt: clean(value.receiptExpiresAt)
  };
}

function normalizedEndpointProbeCampaignPayload(value = {}) {
  return {
    schemaVersion: ENDPOINT_PROBE_CAMPAIGN_SCHEMA_VERSION,
    campaignId: clean(value.campaignId),
    status: clean(value.status).toLowerCase(),
    previousCampaignDigest: clean(value.previousCampaignDigest).toLowerCase(),
    entries: (Array.isArray(value.entries) ? value.entries : [])
      .map(canonicalCampaignEntry)
      .sort((left, right) => left.laneId.localeCompare(right.laneId)),
    verification: canonicalCampaignVerification(value.verification),
    startedAt: clean(value.startedAt),
    completedAt: clean(value.completedAt),
    expiresAt: clean(value.expiresAt),
    nonce: clean(value.nonce),
    signingKeyId: clean(value.signingKeyId)
  };
}

function campaignSignaturePayload(value = {}) {
  return normalizedEndpointProbeCampaignPayload(value);
}

function endpointProbeCampaignAttestationDigest(value = {}) {
  const attestation = value.attestation || value;
  if (clean(attestation.schemaVersion) !== ENDPOINT_PROBE_CAMPAIGN_SCHEMA_VERSION) {
    throw new Error("endpoint probe campaign schema version is invalid");
  }
  const signature = digest(attestation.signature, "endpoint probe campaign signature");
  return sha256(stableStringify({
    ...campaignSignaturePayload(attestation),
    signature
  }));
}

function validateCampaignEnvelope(payload, options = {}) {
  if (!/^[a-z0-9][a-z0-9._:-]{7,127}$/i.test(payload.campaignId)) {
    throw new Error("endpoint probe campaignId is invalid");
  }
  if (!/^[a-z0-9][a-z0-9._:-]{7,127}$/i.test(payload.nonce)) {
    throw new Error("endpoint probe campaign nonce is invalid");
  }
  if (payload.status !== "completed") throw new Error("endpoint probe campaign status must be completed");
  if (payload.previousCampaignDigest) {
    digest(payload.previousCampaignDigest, "endpoint probe campaign previousCampaignDigest");
  }
  if (payload.verification.attestationOrigin !== TRUSTED_ATTESTATION_ORIGIN
    || payload.verification.verificationSource !== TRUSTED_VERIFICATION_SOURCE
    || payload.verification.signatureVerified !== true) {
    throw new Error("endpoint probe campaign trust metadata is not server verified");
  }
  if (payload.entries.length !== EXTERNAL_ADAPTER_PROFILES.length) {
    throw new Error("endpoint probe campaign must contain exactly eight lane receipts");
  }
  const laneIds = new Set();
  const receiptIds = new Set();
  payload.entries.forEach((entry) => {
    const profile = profileForLane(entry.laneId);
    if (!profile || entry.adapterId !== profile.adapterId) {
      throw new Error("endpoint probe campaign lane or adapter binding is invalid");
    }
    if (laneIds.has(entry.laneId)) throw new Error("endpoint probe campaign lane is duplicated");
    if (receiptIds.has(entry.receiptId)) throw new Error("endpoint probe campaign receipt is duplicated");
    laneIds.add(entry.laneId);
    receiptIds.add(entry.receiptId);
    if (!entry.contract || !entry.receiptId) throw new Error("endpoint probe campaign entry binding is incomplete");
    digest(entry.receiptDigest, "endpoint probe campaign receipt digest");
    digest(entry.endpointDigest, "endpoint probe campaign endpoint digest");
    digest(entry.policyDigest, "endpoint probe campaign policy digest");
    timeValue(entry.receiptIssuedAt, "endpoint probe campaign receiptIssuedAt");
    timeValue(entry.receiptExpiresAt, "endpoint probe campaign receiptExpiresAt");
  });
  if (laneIds.size !== EXTERNAL_ADAPTER_PROFILES.length) {
    throw new Error("endpoint probe campaign lane coverage is incomplete");
  }
  const startedAt = timeValue(payload.startedAt, "endpoint probe campaign startedAt");
  const completedAt = timeValue(payload.completedAt, "endpoint probe campaign completedAt");
  const expiresAt = timeValue(payload.expiresAt, "endpoint probe campaign expiresAt");
  if (completedAt < startedAt || completedAt - startedAt > MAX_CAMPAIGN_DURATION_SECONDS * 1000) {
    throw new Error("endpoint probe campaign duration is invalid");
  }
  if (expiresAt <= completedAt || expiresAt - completedAt > MAX_CAMPAIGN_TTL_SECONDS * 1000) {
    throw new Error("endpoint probe campaign validity window is invalid");
  }
  const at = timeValue(options.at || new Date().toISOString(), "endpoint probe campaign verification at");
  if (completedAt > at + 30000) throw new Error("endpoint probe campaign is completed in the future");
  if (expiresAt < at) throw new Error("endpoint probe campaign has expired");
  return { startedAt, completedAt, expiresAt };
}

function campaignKeyring(options, payload) {
  const keyring = typeof options.campaignKeyringResolver === "function"
    ? options.campaignKeyringResolver(payload.campaignId, payload)
    : options.campaignKeyring;
  if (clean(keyring?.purpose) !== ENDPOINT_PROBE_CAMPAIGN_KEYRING_PURPOSE) {
    throw new Error("endpoint probe campaign keyring purpose is invalid");
  }
  return keyring;
}

function lanePolicy(options, profile) {
  return typeof options.policyResolver === "function"
    ? options.policyResolver(profile.laneId, profile) || {}
    : options.policy || {};
}

function laneContract(options, profile) {
  return clean(typeof options.contractResolver === "function"
    ? options.contractResolver(profile.laneId, profile)
    : profile.contract);
}

function laneReceiptKeyring(options, profile, receipt) {
  return typeof options.keyringResolver === "function"
    ? options.keyringResolver(profile.laneId, receipt, profile)
    : options.keyring;
}

function assertCampaignKeySeparation(receipts, campaignSigningKey, options = {}) {
  if (!Array.isArray(receipts) || receipts.length !== EXTERNAL_ADAPTER_PROFILES.length) {
    throw new Error("endpoint probe campaign receipt set must contain exactly eight receipts");
  }
  const campaignSecretDigest = sha256(campaignSigningKey.secret);
  for (const receipt of receipts) {
    const profile = profileForLane(receipt?.laneId);
    if (!profile) throw new Error("endpoint probe campaign receipt lane is invalid");
    const resolution = resolveVerificationKey(
      laneReceiptKeyring(options, profile, receipt),
      clean(receipt.signingKeyId),
      clean(receipt.issuedAt)
    );
    if (!resolution.ok) {
      throw new Error(`endpoint probe campaign receipt key is invalid for lane ${profile.laneId}`);
    }
    if (timingSafeHexEqual(campaignSecretDigest, sha256(resolution.key.secret))) {
      throw new Error("endpoint probe campaign key must be independent from single-probe receipt keys");
    }
  }
}

function verifyCampaignReceipts(receipts, payload, options = {}) {
  if (!Array.isArray(receipts) || receipts.length !== EXTERNAL_ADAPTER_PROFILES.length) {
    throw new Error("endpoint probe campaign receipt set must contain exactly eight receipts");
  }
  const receiptsById = new Map();
  receipts.forEach((receipt) => {
    const receiptId = clean(receipt?.receiptId);
    if (!receiptId || receiptsById.has(receiptId)) {
      throw new Error("endpoint probe campaign receipt set contains a duplicate or missing receiptId");
    }
    receiptsById.set(receiptId, receipt);
  });
  const seenReceiptIds = options.seenReceiptIds || new Set();
  const seenNonces = options.seenNonces || new Set();
  const localSeenReceiptIds = new Set(seenReceiptIds);
  const localSeenNonces = new Set(seenNonces);
  const receiptIdsForCommit = [];
  const noncesForCommit = [];
  const verifiedEntries = payload.entries.map((entry) => {
    const profile = profileForLane(entry.laneId);
    const receipt = receiptsById.get(entry.receiptId);
    if (!receipt) throw new Error("endpoint probe campaign bound receipt is unavailable");
    const policy = lanePolicy(options, profile);
    if (!timingSafeHexEqual(entry.policyDigest, probePolicyDigest(policy))) {
      throw new Error("endpoint probe campaign policy snapshot does not match server policy");
    }
    if (!timingSafeHexEqual(entry.receiptDigest, endpointProbeReceiptDigest(receipt))) {
      throw new Error("endpoint probe campaign receipt digest is invalid");
    }
    const result = verifyPublicHealthExternalEndpointProbeReceipt(receipt, {
      expectedEndpoint: clean((options.env || {})[profile.endpointEnv]),
      expectedContract: laneContract(options, profile),
      keyring: laneReceiptKeyring(options, profile, receipt),
      at: payload.completedAt,
      maxLatencyMs: canonicalProbePolicy(policy).maxLatencyMs,
      certificatePins: canonicalProbePolicy(policy).certificatePins,
      requireMutualTls: canonicalProbePolicy(policy).requireMutualTls,
      seenReceiptIds: localSeenReceiptIds,
      seenNonces: localSeenNonces
    });
    if (!result.ok) throw new Error(`endpoint probe campaign receipt is invalid for lane ${profile.laneId}: ${result.reason}`);
    if (entry.adapterId !== result.payload.adapterId
      || entry.contract !== result.payload.contract
      || entry.endpointDigest !== result.payload.endpointDigest
      || entry.receiptIssuedAt !== result.payload.issuedAt
      || entry.receiptExpiresAt !== result.payload.expiresAt) {
      throw new Error("endpoint probe campaign receipt binding does not match its signed payload");
    }
    const issuedAt = timeValue(result.payload.issuedAt, "endpoint probe campaign bound receipt issuedAt");
    const receiptExpiresAt = timeValue(result.payload.expiresAt, "endpoint probe campaign bound receipt expiresAt");
    const startedAt = timeValue(payload.startedAt, "endpoint probe campaign startedAt");
    const completedAt = timeValue(payload.completedAt, "endpoint probe campaign completedAt");
    if (issuedAt < startedAt || issuedAt > completedAt || receiptExpiresAt < completedAt) {
      throw new Error("endpoint probe campaign receipt falls outside the campaign window");
    }
    receiptIdsForCommit.push(result.payload.receiptId);
    noncesForCommit.push(result.payload.nonce);
    localSeenReceiptIds.add(result.payload.receiptId);
    localSeenNonces.add(result.payload.nonce);
    return {
      laneId: profile.laneId,
      adapterId: profile.adapterId,
      contract: result.payload.contract,
      receiptId: result.payload.receiptId,
      receiptDigest: endpointProbeReceiptDigest(receipt),
      endpointDigest: result.payload.endpointDigest,
      policyDigest: probePolicyDigest(policy),
      receiptIssuedAt: result.payload.issuedAt,
      receiptExpiresAt: result.payload.expiresAt
    };
  });
  receiptIdsForCommit.forEach((value) => seenReceiptIds.add(value));
  noncesForCommit.forEach((value) => seenNonces.add(value));
  return verifiedEntries;
}

function createPublicHealthExternalEndpointProbeCampaign(receipts, options = {}) {
  const completedAt = new Date(options.at || new Date().toISOString());
  if (!Number.isFinite(completedAt.getTime())) throw new Error("endpoint probe campaign completion time is invalid");
  const receiptIssuedTimes = (Array.isArray(receipts) ? receipts : [])
    .map((item) => timeValue(item?.issuedAt, "endpoint probe receipt issuedAt"));
  if (receiptIssuedTimes.length !== EXTERNAL_ADAPTER_PROFILES.length) {
    throw new Error("endpoint probe campaign requires exactly eight receipts");
  }
  const startedAt = new Date(options.startedAt || Math.min(...receiptIssuedTimes));
  if (!Number.isFinite(startedAt.getTime())) throw new Error("endpoint probe campaign start time is invalid");
  const ttlSeconds = Number(options.ttlSeconds ?? DEFAULT_CAMPAIGN_TTL_SECONDS);
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > MAX_CAMPAIGN_TTL_SECONDS) {
    throw new Error(`endpoint probe campaign ttlSeconds must be an integer from 60 to ${MAX_CAMPAIGN_TTL_SECONDS}`);
  }
  const randomUUID = options.randomUUID || crypto.randomUUID;
  const previousCampaignDigest = options.previousCampaign
    ? endpointProbeCampaignAttestationDigest(options.previousCampaign)
    : clean(options.previousCampaignDigest).toLowerCase();
  if (previousCampaignDigest) {
    digest(previousCampaignDigest, "endpoint probe campaign previousCampaignDigest");
  }
  const unsigned = normalizedEndpointProbeCampaignPayload({
    campaignId: `ph-endpoint-probe-campaign-${randomUUID()}`,
    status: "completed",
    previousCampaignDigest,
    entries: receipts.map((receipt) => {
      const profile = profileForLane(receipt?.laneId);
      if (!profile) throw new Error("endpoint probe campaign receipt lane is invalid");
      const policy = lanePolicy(options, profile);
      return {
        laneId: profile.laneId,
        adapterId: profile.adapterId,
        contract: clean(receipt.contract),
        receiptId: clean(receipt.receiptId),
        receiptDigest: endpointProbeReceiptDigest(receipt),
        endpointDigest: clean(receipt.endpointDigest),
        policyDigest: probePolicyDigest(policy),
        receiptIssuedAt: clean(receipt.issuedAt),
        receiptExpiresAt: clean(receipt.expiresAt)
      };
    }),
    verification: {
      attestationOrigin: TRUSTED_ATTESTATION_ORIGIN,
      verificationSource: TRUSTED_VERIFICATION_SOURCE,
      signatureVerified: true
    },
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    expiresAt: new Date(completedAt.getTime() + ttlSeconds * 1000).toISOString(),
    nonce: `ph-endpoint-probe-campaign-nonce-${randomUUID()}`
  });
  verifyCampaignReceipts(receipts, unsigned, options);
  validateCampaignEnvelope(unsigned, { at: unsigned.completedAt });
  const signingKey = selectSigningKey(campaignKeyring(options, unsigned), unsigned.completedAt);
  assertCampaignKeySeparation(receipts, signingKey, options);
  const payload = normalizedEndpointProbeCampaignPayload({
    ...unsigned,
    signingKeyId: signingKey.keyId
  });
  const signature = crypto.createHmac("sha256", signingKey.secret)
    .update(stableStringify(campaignSignaturePayload(payload)))
    .digest("hex");
  return {
    attestation: { ...payload, signature },
    receipts: receipts.map((item) => ({ ...item })),
    productionReady: false
  };
}

function verifyPublicHealthExternalEndpointProbeCampaign(value = {}, options = {}) {
  const attestation = value.attestation || value;
  const receipts = options.receipts || value.receipts;
  let payload;
  try {
    payload = normalizedEndpointProbeCampaignPayload(attestation);
    if (clean(attestation.schemaVersion) !== ENDPOINT_PROBE_CAMPAIGN_SCHEMA_VERSION) {
      throw new Error("endpoint probe campaign schema version is invalid");
    }
    validateCampaignEnvelope(payload, options);
  } catch (error) {
    return { ok: false, reason: error.message, productionReady: false };
  }
  let keyResolution;
  try {
    keyResolution = resolveVerificationKey(
      campaignKeyring(options, payload),
      payload.signingKeyId,
      payload.completedAt
    );
  } catch (error) {
    return { ok: false, reason: error.message, productionReady: false };
  }
  if (!keyResolution.ok) {
    return { ok: false, reason: `endpoint-probe-campaign-${keyResolution.reason}`, productionReady: false };
  }
  const expectedSignature = crypto.createHmac("sha256", keyResolution.key.secret)
    .update(stableStringify(campaignSignaturePayload(payload)))
    .digest("hex");
  if (!timingSafeHexEqual(attestation.signature, expectedSignature)) {
    return { ok: false, reason: "endpoint probe campaign signature is invalid", productionReady: false };
  }
  try {
    assertCampaignKeySeparation(receipts, keyResolution.key, options);
  } catch (error) {
    return { ok: false, reason: error.message, productionReady: false };
  }
  if (options.seenCampaignIds?.has(payload.campaignId)) {
    return { ok: false, reason: "endpoint probe campaign replay detected", productionReady: false };
  }
  if (options.seenCampaignNonces?.has(payload.nonce)) {
    return { ok: false, reason: "endpoint probe campaign nonce replay detected", productionReady: false };
  }
  let entries;
  try {
    entries = verifyCampaignReceipts(receipts, payload, options);
  } catch (error) {
    return { ok: false, reason: error.message, productionReady: false };
  }
  return {
    ok: true,
    reason: "verified",
    campaignId: payload.campaignId,
    startedAt: payload.startedAt,
    completedAt: payload.completedAt,
    expiresAt: payload.expiresAt,
    previousCampaignDigest: payload.previousCampaignDigest,
    campaignDigest: endpointProbeCampaignAttestationDigest(attestation),
    summary: {
      lanes: entries.length,
      verifiedReceipts: entries.length
    },
    entries: entries.map((entry) => ({
      laneId: entry.laneId,
      adapterId: entry.adapterId,
      contract: entry.contract,
      receiptId: entry.receiptId,
      endpointDigest: entry.endpointDigest,
      policyDigest: entry.policyDigest,
      receiptIssuedAt: entry.receiptIssuedAt,
      receiptExpiresAt: entry.receiptExpiresAt
    })),
    campaignConnectivityReady: entries.length === EXTERNAL_ADAPTER_PROFILES.length,
    productionReady: false,
    blocker: "Consecutive endpoint probe campaigns do not replace trusted site evidence or launch approval."
  };
}

function integerOption(value, defaultValue, minimum, maximum, label) {
  const normalized = Number(value ?? defaultValue);
  if (!Number.isInteger(normalized) || normalized < minimum || normalized > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} to ${maximum}`);
  }
  return normalized;
}

function compareCampaignsNewestFirst(left, right) {
  const leftCompletedAt = new Date(clean(
    left?.attestation?.completedAt || left?.completedAt
  )).getTime();
  const rightCompletedAt = new Date(clean(
    right?.attestation?.completedAt || right?.completedAt
  )).getTime();
  const leftValid = Number.isFinite(leftCompletedAt);
  const rightValid = Number.isFinite(rightCompletedAt);
  if (leftValid && rightValid && leftCompletedAt !== rightCompletedAt) {
    return rightCompletedAt - leftCompletedAt;
  }
  if (leftValid !== rightValid) return leftValid ? 1 : -1;
  return clean(right?.attestation?.campaignId || right?.campaignId)
    .localeCompare(clean(left?.attestation?.campaignId || left?.campaignId));
}

function buildPublicHealthExternalEndpointProbeCampaignRegistry(options = {}) {
  const requiredConsecutiveCampaigns = integerOption(
    options.requiredConsecutiveCampaigns,
    DEFAULT_REQUIRED_CONSECUTIVE_CAMPAIGNS,
    1,
    12,
    "requiredConsecutiveCampaigns"
  );
  const maxCampaignGapSeconds = integerOption(
    options.maxCampaignGapSeconds,
    DEFAULT_MAX_CAMPAIGN_GAP_SECONDS,
    60,
    3600,
    "maxCampaignGapSeconds"
  );
  const campaigns = (Array.isArray(options.campaigns) ? options.campaigns : [])
    .slice()
    .sort(compareCampaignsNewestFirst);
  const seenCampaignIds = new Set();
  const seenCampaignNonces = new Set();
  const seenReceiptIds = new Set();
  const seenNonces = new Set();
  const verified = [];
  const rejected = [];
  const evaluations = [];
  campaigns.forEach((campaign) => {
    const result = verifyPublicHealthExternalEndpointProbeCampaign(campaign, {
      ...options,
      seenCampaignIds,
      seenCampaignNonces,
      seenReceiptIds,
      seenNonces
    });
    if (result.ok) {
      const attestation = campaign.attestation || campaign;
      seenCampaignIds.add(clean(attestation.campaignId));
      seenCampaignNonces.add(clean(attestation.nonce));
      verified.push(result);
      evaluations.push({ ok: true, result });
    } else {
      const rejection = {
        campaignId: /^[a-z0-9][a-z0-9._:-]{7,127}$/i.test(clean(campaign?.attestation?.campaignId || campaign?.campaignId))
          ? clean(campaign?.attestation?.campaignId || campaign?.campaignId)
          : "",
        reason: result.reason
      };
      rejected.push(rejection);
      evaluations.push({ ok: false, rejection });
    }
  });
  const consecutive = [];
  let campaignChainLinksVerified = 0;
  let continuityBreak = null;
  for (const evaluation of evaluations) {
    if (consecutive.length >= requiredConsecutiveCampaigns) break;
    if (!evaluation.ok) {
      continuityBreak = {
        campaignId: evaluation.rejection.campaignId,
        code: "campaign-verification-failed"
      };
      break;
    }
    const campaign = evaluation.result;
    if (!consecutive.length) {
      consecutive.push(campaign);
      continue;
    }
    const newer = consecutive[consecutive.length - 1];
    if (!newer.previousCampaignDigest) {
      continuityBreak = {
        campaignId: newer.campaignId,
        code: "campaign-chain-link-missing"
      };
      break;
    }
    if (!timingSafeHexEqual(newer.previousCampaignDigest, campaign.campaignDigest)) {
      continuityBreak = {
        campaignId: newer.campaignId,
        code: "campaign-chain-link-mismatch"
      };
      break;
    }
    campaignChainLinksVerified += 1;
    const gap = timeValue(newer.startedAt, "newer campaign startedAt")
      - timeValue(campaign.completedAt, "older campaign completedAt");
    if (gap < 0) {
      continuityBreak = {
        campaignId: campaign.campaignId,
        code: "campaign-window-overlap"
      };
      break;
    }
    if (gap > maxCampaignGapSeconds * 1000) {
      continuityBreak = {
        campaignId: campaign.campaignId,
        code: "campaign-gap-exceeded"
      };
      break;
    }
    consecutive.push(campaign);
  }
  const continuousConnectivityReady = consecutive.length >= requiredConsecutiveCampaigns;
  return {
    ok: true,
    functionalState: continuousConnectivityReady
      ? "consecutive-endpoint-probe-campaigns-verified"
      : continuityBreak
        ? "endpoint-probe-campaign-continuity-broken"
        : "endpoint-probe-campaign-continuity-pending",
    formalGoLiveState: "blocked-until-trusted-site-evidence-and-launch-approval",
    summary: {
      campaignsSubmitted: campaigns.length,
      campaignsVerified: verified.length,
      campaignsRejected: rejected.length,
      consecutiveCampaigns: consecutive.length,
      campaignChainLinksVerified,
      continuityBreaks: continuityBreak ? 1 : 0,
      requiredConsecutiveCampaigns,
      maxCampaignGapSeconds
    },
    campaigns: verified.map((item) => ({
      campaignId: item.campaignId,
      startedAt: item.startedAt,
      completedAt: item.completedAt,
      expiresAt: item.expiresAt,
      verifiedReceipts: item.summary.verifiedReceipts,
      campaignConnectivityReady: item.campaignConnectivityReady
    })),
    rejected,
    continuityBreak,
    continuousConnectivityReady,
    productionReady: false,
    blockers: continuousConnectivityReady
      ? [
          "Continuous endpoint connectivity is verified, but trusted site evidence is still required.",
          "Production handoffs, P0/P1 closure and launch approval remain required."
        ]
      : [
          `${requiredConsecutiveCampaigns} fresh non-overlapping endpoint probe campaigns are required.`,
          ...(continuityBreak
            ? [`Current endpoint probe campaign continuity is broken by ${continuityBreak.code}.`]
            : []),
          "Trusted site evidence, production handoffs, P0/P1 closure and launch approval remain required."
        ]
  };
}

module.exports = {
  DEFAULT_CAMPAIGN_TTL_SECONDS,
  DEFAULT_MAX_CAMPAIGN_GAP_SECONDS,
  DEFAULT_REQUIRED_CONSECUTIVE_CAMPAIGNS,
  ENDPOINT_PROBE_CAMPAIGN_KEYRING_PURPOSE,
  ENDPOINT_PROBE_CAMPAIGN_SCHEMA_VERSION,
  MAX_CAMPAIGN_DURATION_SECONDS,
  MAX_CAMPAIGN_TTL_SECONDS,
  buildPublicHealthExternalEndpointProbeCampaignRegistry,
  campaignSignaturePayload,
  canonicalProbePolicy,
  createPublicHealthExternalEndpointProbeCampaign,
  endpointProbeCampaignAttestationDigest,
  endpointProbeReceiptDigest,
  normalizedEndpointProbeCampaignPayload,
  probePolicyDigest,
  verifyPublicHealthExternalEndpointProbeCampaign
};
