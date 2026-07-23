const crypto = require("node:crypto");
const {
  EXTERNAL_ADAPTER_PROFILES,
  RECEIPT_SCHEMA_VERSION,
  REQUEST_SCHEMA_VERSION
} = require("./public-health-external-adapter-service");
const {
  resolveVerificationKey,
  selectSigningKey
} = require("./public-health-external-keyring-service");

const CONTRACT_ATTESTATION_SCHEMA_VERSION = "public-health-external-contract-attestation/v1";
const CHANGE_TYPES = Object.freeze(["additive", "breaking"]);
const APPROVAL_ROLES = Object.freeze({
  producer: "producer-contract-owner",
  consumer: "consumer-contract-owner"
});

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
  return crypto.timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function timeValue(value, label) {
  const parsed = new Date(value).getTime();
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be a valid date-time`);
  return parsed;
}

function profileForLane(laneId) {
  return EXTERNAL_ADAPTER_PROFILES.find((item) => item.laneId === clean(laneId));
}

function contractVersion(contract, label = "contract") {
  const match = clean(contract).match(/^(.*)-v([1-9]\d*)$/);
  if (!match) throw new Error(`${label} must end with a positive -vN version`);
  return { family: match[1], version: Number(match[2]) };
}

function schemaVersion(schema, family, label) {
  const match = clean(schema).match(new RegExp(`^public-health-external-${family}/v([1-9]\\d*)$`));
  if (!match) throw new Error(`${label} is invalid`);
  return Number(match[1]);
}

function digest(value, label) {
  const normalized = clean(value).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw new Error(`${label} must be a SHA-256 digest`);
  return normalized;
}

function normalizeApproval(value = {}, side) {
  const organizationId = clean(value.organizationId);
  const role = clean(value.role);
  const approverIdHash = digest(value.approverIdHash, `${side} approverIdHash`);
  const approvedAt = clean(value.approvedAt);
  if (!/^[a-z0-9][a-z0-9._-]{2,63}$/i.test(organizationId)) {
    throw new Error(`${side} organizationId must contain 3 to 64 safe characters`);
  }
  if (role !== APPROVAL_ROLES[side]) throw new Error(`${side} approval role is invalid`);
  timeValue(approvedAt, `${side} approvedAt`);
  return { organizationId, role, approverIdHash, approvedAt };
}

function canonicalApproval(value = {}) {
  return {
    organizationId: clean(value.organizationId),
    role: clean(value.role),
    approverIdHash: clean(value.approverIdHash).toLowerCase(),
    approvedAt: clean(value.approvedAt)
  };
}

function normalizedContractAttestation(value = {}) {
  const evidenceRefs = Array.isArray(value.evidenceRefs)
    ? [...new Set(value.evidenceRefs.map(clean).filter(Boolean))].sort()
    : [];
  return {
    schemaVersion: CONTRACT_ATTESTATION_SCHEMA_VERSION,
    laneId: clean(value.laneId),
    fromContract: clean(value.fromContract),
    toContract: clean(value.toContract),
    requestSchemaVersion: clean(value.requestSchemaVersion),
    receiptSchemaVersion: clean(value.receiptSchemaVersion),
    changeType: clean(value.changeType).toLowerCase(),
    fieldDictionaryDigest: clean(value.fieldDictionaryDigest).toLowerCase(),
    sampleRequestDigest: clean(value.sampleRequestDigest).toLowerCase(),
    sampleReceiptDigest: clean(value.sampleReceiptDigest).toLowerCase(),
    runtimeReleaseDigest: clean(value.runtimeReleaseDigest).toLowerCase(),
    producerApproval: canonicalApproval(value.producerApproval),
    consumerApproval: canonicalApproval(value.consumerApproval),
    evidenceRefs,
    effectiveAt: clean(value.effectiveAt),
    sunsetAt: clean(value.sunsetAt),
    status: clean(value.status).toLowerCase(),
    issuedAt: clean(value.issuedAt),
    expiresAt: clean(value.expiresAt),
    nonce: clean(value.nonce),
    signingKeyId: clean(value.signingKeyId)
  };
}

function validateContractAttestationPayload(payload, options = {}) {
  const profile = profileForLane(payload.laneId);
  if (!profile) throw new Error("contract attestation lane is invalid");
  if (payload.fromContract !== profile.contract) throw new Error("contract attestation fromContract does not match the registered lane contract");
  const from = contractVersion(payload.fromContract, "fromContract");
  const to = contractVersion(payload.toContract, "toContract");
  if (from.family !== to.family || to.version !== from.version + 1) {
    throw new Error("contract attestation must advance exactly one version in the same contract family");
  }
  const requestVersion = schemaVersion(payload.requestSchemaVersion, "dispatch", "requestSchemaVersion");
  const receiptVersion = schemaVersion(payload.receiptSchemaVersion, "receipt", "receiptSchemaVersion");
  if (requestVersion !== to.version || receiptVersion !== to.version) {
    throw new Error("contract and request/receipt schema versions must advance together");
  }
  if (!CHANGE_TYPES.includes(payload.changeType)) throw new Error("contract changeType must be additive or breaking");
  digest(payload.fieldDictionaryDigest, "fieldDictionaryDigest");
  digest(payload.sampleRequestDigest, "sampleRequestDigest");
  digest(payload.sampleReceiptDigest, "sampleReceiptDigest");
  digest(payload.runtimeReleaseDigest, "runtimeReleaseDigest");
  const producerApproval = normalizeApproval(payload.producerApproval, "producer");
  const consumerApproval = normalizeApproval(payload.consumerApproval, "consumer");
  if (producerApproval.organizationId === consumerApproval.organizationId
    || producerApproval.approverIdHash === consumerApproval.approverIdHash) {
    throw new Error("producer and consumer approvals must be independent");
  }
  if (payload.evidenceRefs.length < 3) throw new Error("contract attestation requires at least three evidence references");
  if (payload.status !== "approved") throw new Error("contract attestation status must be approved");
  const issuedAt = timeValue(payload.issuedAt, "contract attestation issuedAt");
  const expiresAt = timeValue(payload.expiresAt, "contract attestation expiresAt");
  const effectiveAt = timeValue(payload.effectiveAt, "contract attestation effectiveAt");
  const sunsetAt = timeValue(payload.sunsetAt, "contract attestation sunsetAt");
  if (expiresAt <= issuedAt || expiresAt < sunsetAt) {
    throw new Error("contract attestation expiresAt must cover the full transition window");
  }
  if (timeValue(producerApproval.approvedAt, "producer approvedAt") > issuedAt
    || timeValue(consumerApproval.approvedAt, "consumer approvedAt") > issuedAt) {
    throw new Error("contract approvals cannot occur after attestation issuance");
  }
  if (effectiveAt < issuedAt || sunsetAt <= effectiveAt) {
    throw new Error("contract effectiveAt and sunsetAt window is invalid");
  }
  if (!/^[a-z0-9][a-z0-9._-]{7,127}$/i.test(payload.nonce)) {
    throw new Error("contract attestation nonce is invalid");
  }
  if (options.at !== undefined) {
    const verificationAt = timeValue(options.at, "contract attestation verification at");
    if (verificationAt < issuedAt) throw new Error("contract attestation is not yet issued");
    if (verificationAt > expiresAt) throw new Error("contract attestation has expired");
  }
  return {
    profile,
    from,
    to,
    producerApproval,
    consumerApproval,
    issuedAt,
    expiresAt,
    effectiveAt,
    sunsetAt
  };
}

function signPublicHealthExternalContractAttestation(value, signingMaterial) {
  const issuedAt = clean(value.issuedAt || new Date().toISOString());
  const key = selectSigningKey(signingMaterial, issuedAt);
  const payload = normalizedContractAttestation({
    ...value,
    issuedAt,
    signingKeyId: key.keyId,
    nonce: clean(value.nonce || sha256([
      value.laneId,
      value.fromContract,
      value.toContract,
      issuedAt,
      key.keyId
    ].join(":")).slice(0, 32))
  });
  validateContractAttestationPayload(payload);
  return {
    ...payload,
    signatureAlgorithm: "HMAC-SHA256",
    signature: crypto.createHmac("sha256", key.secret)
      .update(stableStringify(payload))
      .digest("hex")
  };
}

function verifyPublicHealthExternalContractAttestation(value, signingMaterial, options = {}) {
  const payload = normalizedContractAttestation(value);
  try {
    validateContractAttestationPayload(payload, options);
  } catch (error) {
    return { ok: false, reason: error.message, payload };
  }
  const keyResolution = resolveVerificationKey(
    signingMaterial,
    payload.signingKeyId,
    clean(options.at || payload.issuedAt)
  );
  if (!keyResolution.ok) return { ok: false, reason: `contract-attestation-${keyResolution.reason}`, payload };
  const expected = crypto.createHmac("sha256", keyResolution.key.secret)
    .update(stableStringify(payload))
    .digest("hex");
  if (clean(value.signatureAlgorithm) !== "HMAC-SHA256" || !timingSafeHexEqual(value.signature, expected)) {
    return { ok: false, reason: "contract-attestation-signature-invalid", payload };
  }
  return { ok: true, reason: "verified", payload };
}

function baseContractEntry(profile) {
  return {
    laneId: profile.laneId,
    adapterId: profile.adapterId,
    currentContract: profile.contract,
    acceptedContracts: [profile.contract],
    contracts: [{
      contract: profile.contract,
      requestSchemaVersion: REQUEST_SCHEMA_VERSION,
      receiptSchemaVersion: RECEIPT_SCHEMA_VERSION,
      state: "active",
      effectiveAt: "",
      sunsetAt: ""
    }],
    transition: null,
    blockers: []
  };
}

function buildPublicHealthExternalContractGovernance({
  attestations = [],
  signingMaterial,
  at = new Date().toISOString()
} = {}) {
  const atValue = timeValue(at, "contract governance at");
  const entries = EXTERNAL_ADAPTER_PROFILES.map(baseContractEntry);
  const issues = [];
  const valid = [];
  (Array.isArray(attestations) ? attestations : []).forEach((attestation, index) => {
    const verification = verifyPublicHealthExternalContractAttestation(
      attestation,
      signingMaterial,
      { at }
    );
    if (!verification.ok) {
      issues.push({
        severity: "P0",
        code: "contract-attestation-invalid",
        laneId: clean(attestation?.laneId),
        index,
        detail: verification.reason
      });
    } else {
      valid.push(verification.payload);
    }
  });
  entries.forEach((entry) => {
    const transitions = valid.filter((item) => item.laneId === entry.laneId);
    if (transitions.length > 1) {
      issues.push({
        severity: "P0",
        code: "contract-transition-conflict",
        laneId: entry.laneId,
        detail: `${transitions.length} approved transitions target the same lane`
      });
      entry.blockers.push("Conflicting approved contract transitions require governance review.");
      return;
    }
    const transition = transitions[0];
    if (!transition) return;
    const effectiveAt = timeValue(transition.effectiveAt, "transition effectiveAt");
    const sunsetAt = timeValue(transition.sunsetAt, "transition sunsetAt");
    entry.transition = {
      fromContract: transition.fromContract,
      toContract: transition.toContract,
      changeType: transition.changeType,
      effectiveAt: transition.effectiveAt,
      sunsetAt: transition.sunsetAt,
      fieldDictionaryDigest: transition.fieldDictionaryDigest,
      runtimeReleaseDigest: transition.runtimeReleaseDigest,
      evidenceRefs: transition.evidenceRefs
    };
    if (atValue < effectiveAt) {
      entry.contracts.push({
        contract: transition.toContract,
        requestSchemaVersion: transition.requestSchemaVersion,
        receiptSchemaVersion: transition.receiptSchemaVersion,
        state: "scheduled",
        effectiveAt: transition.effectiveAt,
        sunsetAt: transition.sunsetAt
      });
    } else {
      entry.currentContract = transition.toContract;
      entry.contracts[0].state = atValue < sunsetAt ? "deprecated" : "retired";
      entry.contracts[0].sunsetAt = transition.sunsetAt;
      entry.contracts.push({
        contract: transition.toContract,
        requestSchemaVersion: transition.requestSchemaVersion,
        receiptSchemaVersion: transition.receiptSchemaVersion,
        state: "active",
        effectiveAt: transition.effectiveAt,
        sunsetAt: ""
      });
      entry.acceptedContracts = atValue < sunsetAt
        ? [transition.toContract, transition.fromContract]
        : [transition.toContract];
      if (atValue < sunsetAt) {
        entry.blockers.push(`Deprecated contract ${transition.fromContract} remains accepted until ${transition.sunsetAt}.`);
      }
    }
  });
  const contracts = entries.flatMap((entry) => entry.contracts);
  return {
    generatedAt: new Date(atValue).toISOString(),
    ok: issues.every((item) => item.severity !== "P0"),
    functionalState: "external-contract-version-governance-ready",
    entries,
    issues,
    summary: {
      lanes: entries.length,
      attestations: attestations.length,
      verifiedAttestations: valid.length,
      invalidAttestations: issues.filter((item) => item.code === "contract-attestation-invalid").length,
      conflicts: issues.filter((item) => item.code === "contract-transition-conflict").length,
      active: contracts.filter((item) => item.state === "active").length,
      scheduled: contracts.filter((item) => item.state === "scheduled").length,
      deprecated: contracts.filter((item) => item.state === "deprecated").length,
      retired: contracts.filter((item) => item.state === "retired").length
    },
    productionReady: false,
    blockers: [
      ...issues.filter((item) => item.severity === "P0").map((item) => `${item.code}:${item.laneId || item.index}`),
      "Signed contract approval is governance evidence, not production deployment or site acceptance evidence."
    ]
  };
}

function authorizePublicHealthExternalContract(
  governance,
  laneId,
  contract,
  requestSchemaVersion,
  receiptSchemaVersion
) {
  const entry = governance?.entries?.find((item) => item.laneId === clean(laneId));
  if (!governance?.ok || !entry) return { ok: false, reason: "contract-governance-unavailable" };
  const contractEntry = entry.contracts.find((item) => item.contract === clean(contract));
  if (!contractEntry) return { ok: false, reason: "contract-version-unknown" };
  if (!entry.acceptedContracts.includes(contractEntry.contract) || ["scheduled", "retired"].includes(contractEntry.state)) {
    return { ok: false, reason: `contract-version-${contractEntry.state}` };
  }
  if (contractEntry.requestSchemaVersion !== clean(requestSchemaVersion)
    || contractEntry.receiptSchemaVersion !== clean(receiptSchemaVersion)) {
    return { ok: false, reason: "contract-schema-version-mismatch" };
  }
  return {
    ok: true,
    reason: contractEntry.state === "deprecated" ? "contract-version-deprecated" : "verified",
    state: contractEntry.state,
    warning: contractEntry.state === "deprecated"
      ? `Contract ${contractEntry.contract} is deprecated until ${contractEntry.sunsetAt}.`
      : ""
  };
}

module.exports = {
  APPROVAL_ROLES,
  CHANGE_TYPES,
  CONTRACT_ATTESTATION_SCHEMA_VERSION,
  authorizePublicHealthExternalContract,
  buildPublicHealthExternalContractGovernance,
  normalizedContractAttestation,
  signPublicHealthExternalContractAttestation,
  verifyPublicHealthExternalContractAttestation
};
