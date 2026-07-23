const crypto = require("node:crypto");
const {
  signPublicHealthExternalContractAttestation
} = require("./public-health-external-contract-governance-service");

function clean(value) {
  return String(value ?? "").trim();
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function digest(value, label) {
  const normalized = clean(value).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw new Error(`${label} must be a SHA-256 digest`);
  return normalized;
}

function timeValue(value, label) {
  const parsed = new Date(value).getTime();
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be a valid date-time`);
  return parsed;
}

function parsePublicHealthContractReleaseEvidence(value) {
  if (Array.isArray(value)) return value;
  const serialized = clean(value);
  if (!serialized) return [];
  let parsed;
  try {
    parsed = JSON.parse(serialized);
  } catch (error) {
    throw new Error(`PUBLIC_HEALTH_EXTERNAL_CONTRACT_RELEASE_EVIDENCE must be valid JSON: ${error.message}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error("PUBLIC_HEALTH_EXTERNAL_CONTRACT_RELEASE_EVIDENCE must be a JSON array");
  }
  return parsed;
}

function publicHealthContractRuntimeReleaseDigest(t08ReleaseDigest, t00ReleaseDigest) {
  return sha256(`T08:${digest(t08ReleaseDigest, "t08ReleaseDigest")}\nT00:${digest(t00ReleaseDigest, "t00ReleaseDigest")}`);
}

function trustedReleaseEvidenceFor(value, evidenceId, at) {
  const evidence = parsePublicHealthContractReleaseEvidence(value)
    .find((item) => clean(item?.id) === clean(evidenceId));
  if (!evidence) throw new Error("trusted public health contract release evidence is unavailable");
  if (clean(evidence.status) !== "deployed-and-verified") {
    throw new Error("public health contract release evidence is not deployed and verified");
  }
  const verifiedAt = timeValue(evidence.verifiedAt, "contract release evidence verifiedAt");
  const deployedAt = timeValue(evidence.deployedAt, "contract release evidence deployedAt");
  const serverAt = timeValue(at, "contract release evidence server at");
  if (verifiedAt > serverAt || deployedAt > serverAt) {
    throw new Error("public health contract release evidence is not yet deployed");
  }
  const t08ReleaseDigest = digest(evidence.t08ReleaseDigest, "t08ReleaseDigest");
  const t00ReleaseDigest = digest(evidence.t00ReleaseDigest, "t00ReleaseDigest");
  const runtimeReleaseDigest = digest(evidence.runtimeReleaseDigest, "runtimeReleaseDigest");
  if (runtimeReleaseDigest !== publicHealthContractRuntimeReleaseDigest(t08ReleaseDigest, t00ReleaseDigest)) {
    throw new Error("runtimeReleaseDigest does not bind the deployed T08 and T00 release artifacts");
  }
  [
    "fieldDictionaryDigest",
    "sampleRequestDigest",
    "sampleReceiptDigest"
  ].forEach((field) => digest(evidence[field], field));
  if (!clean(evidence.jointTestEvidenceRef) || !clean(evidence.rollbackEvidenceRef)) {
    throw new Error("joint-test and rollback evidence references are required");
  }
  return evidence;
}

function assertPublicHealthContractGovernanceActor(user = {}) {
  if (clean(user.role) !== "commission" || clean(user.orgType) !== "health_admin") {
    throw new Error("public health contract governance role not allowed");
  }
  if (!clean(user.id || user.username) || !clean(user.orgCode)) {
    throw new Error("public health contract governance actor identity and institution scope are required");
  }
  return {
    actorIdHash: sha256(clean(user.id || user.username)),
    organizationId: clean(user.orgCode),
    role: "public-health-contract-governance"
  };
}

function signTrustedPublicHealthContractAttestation({
  payload = {},
  evidenceConfig,
  signingMaterial,
  user,
  at
} = {}) {
  const actor = assertPublicHealthContractGovernanceActor(user);
  const serverAt = clean(at);
  const evidence = trustedReleaseEvidenceFor(evidenceConfig, payload.evidenceId, serverAt);
  const effectiveAt = clean(payload.effectiveAt);
  const sunsetAt = clean(payload.sunsetAt);
  const effectiveValue = timeValue(effectiveAt, "contract effectiveAt");
  const sunsetValue = timeValue(sunsetAt, "contract sunsetAt");
  const issuedValue = timeValue(serverAt, "contract issuedAt");
  if (effectiveValue < issuedValue) throw new Error("contract effectiveAt cannot precede server approval time");
  if (sunsetValue <= effectiveValue) throw new Error("contract sunsetAt must follow effectiveAt");
  const evidenceRefs = [
    ...(Array.isArray(evidence.evidenceRefs) ? evidence.evidenceRefs : []),
    clean(evidence.jointTestEvidenceRef),
    clean(evidence.rollbackEvidenceRef),
    `release-evidence:${clean(evidence.id)}`
  ];
  const attestation = signPublicHealthExternalContractAttestation({
    laneId: evidence.laneId,
    fromContract: evidence.fromContract,
    toContract: evidence.toContract,
    requestSchemaVersion: evidence.requestSchemaVersion,
    receiptSchemaVersion: evidence.receiptSchemaVersion,
    changeType: evidence.changeType,
    fieldDictionaryDigest: evidence.fieldDictionaryDigest,
    sampleRequestDigest: evidence.sampleRequestDigest,
    sampleReceiptDigest: evidence.sampleReceiptDigest,
    runtimeReleaseDigest: evidence.runtimeReleaseDigest,
    producerApproval: evidence.producerApproval,
    consumerApproval: evidence.consumerApproval,
    evidenceRefs,
    effectiveAt,
    sunsetAt,
    status: "approved",
    issuedAt: serverAt,
    expiresAt: new Date(sunsetValue + 24 * 60 * 60 * 1000).toISOString()
  }, signingMaterial);
  return {
    attestation,
    actor,
    releaseEvidence: {
      id: clean(evidence.id),
      t08ReleaseDigest: digest(evidence.t08ReleaseDigest, "t08ReleaseDigest"),
      t00ReleaseDigest: digest(evidence.t00ReleaseDigest, "t00ReleaseDigest"),
      deployedAt: clean(evidence.deployedAt),
      verifiedAt: clean(evidence.verifiedAt),
      jointTestEvidenceRef: clean(evidence.jointTestEvidenceRef),
      rollbackEvidenceRef: clean(evidence.rollbackEvidenceRef)
    }
  };
}

function contractAttestationUniqueKey(value = {}) {
  const laneId = clean(value.laneId);
  const fromContract = clean(value.fromContract);
  if (!laneId || !fromContract) throw new Error("contract attestation unique key requires laneId and fromContract");
  return `${laneId}:${fromContract}`;
}

function assertUniquePublicHealthContractAttestations(attestations = []) {
  const seen = new Set();
  (Array.isArray(attestations) ? attestations : []).forEach((item) => {
    const key = contractAttestationUniqueKey(item);
    if (seen.has(key)) throw new Error(`public health contract attestation unique conflict: ${key}`);
    seen.add(key);
  });
}

module.exports = {
  assertPublicHealthContractGovernanceActor,
  assertUniquePublicHealthContractAttestations,
  contractAttestationUniqueKey,
  parsePublicHealthContractReleaseEvidence,
  publicHealthContractRuntimeReleaseDigest,
  signTrustedPublicHealthContractAttestation,
  trustedReleaseEvidenceFor
};
