"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createPublicKey, verify } = require("node:crypto");
const {
  SHA256,
  assertMetadataOnly,
  createTechnicalEvidenceFingerprint,
  sha256,
  stableStringify
} = require("../governance/technical-evidence");

const CAMPAIGN_FILE = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "config",
  "external-joint-test-campaign.json"
);
const MAX_METADATA_BYTES = 2 * 1024 * 1024;
const CONTROLLED_REFERENCE = /^(?:vault|evidence|artifact|cmdb|ticket):\/\/[A-Za-z0-9._~:/?#@!$&'()*+,;=%-]+$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,159}$/;
const NONCE = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/;
const SIGNATURE = /^[A-Za-z0-9_-]{80,160}$/;
const RECEIPT_FIELDS = new Set([
  "schemaVersion",
  "campaignId",
  "campaignDigest",
  "interfaceId",
  "scenarioId",
  "runId",
  "executedAt",
  "expiresAt",
  "result",
  "traceRef",
  "receiptRef",
  "requestDigest",
  "responseDigest",
  "assertions",
  "attestations"
]);
const ATTESTATION_FIELDS = new Set([
  "schemaVersion",
  "party",
  "keyId",
  "account",
  "algorithm",
  "issuedAt",
  "nonce",
  "subjectDigest",
  "signature"
]);
const REQUIRED_SYSTEMS = Object.freeze([
  "HIS",
  "EMR",
  "LIS",
  "PACS",
  "OIDC",
  "SMS",
  "INSURANCE",
  "PAYMENT",
  "CERTIFICATE",
  "PUBLIC_HEALTH",
  "SIEM",
  "DUTY_TICKETING"
]);
const SCENARIOS = Object.freeze([
  Object.freeze({
    id: "happy-path",
    assertions: Object.freeze({
      accepted: true,
      correlationBound: true,
      receiptReturned: true
    })
  }),
  Object.freeze({
    id: "idempotent-replay",
    assertions: Object.freeze({
      duplicateSuppressed: true,
      sameBusinessResult: true,
      sideEffectCount: 1
    })
  }),
  Object.freeze({
    id: "timeout-retry",
    assertions: Object.freeze({
      boundedRetry: true,
      sameIdempotencyKey: true,
      eventuallyAccepted: true
    })
  }),
  Object.freeze({
    id: "rejection-compensation",
    assertions: Object.freeze({
      providerRejected: true,
      compensationRecorded: true,
      uncommittedSideEffectCount: 0
    })
  }),
  Object.freeze({
    id: "out-of-order-callback",
    assertions: Object.freeze({
      outOfOrderDetected: true,
      correlationBound: true,
      stateRegressed: false
    })
  }),
  Object.freeze({
    id: "duplicate-callback",
    assertions: Object.freeze({
      duplicateSuppressed: true,
      correlationBound: true,
      sideEffectCount: 1
    })
  }),
  Object.freeze({
    id: "key-rotation",
    assertions: Object.freeze({
      oldKeyRejected: true,
      newKeyAccepted: true,
      rotationAuditRecorded: true
    })
  }),
  Object.freeze({
    id: "reconciliation",
    assertions: Object.freeze({
      matched: true,
      differenceCount: 0,
      ownerConfirmed: true
    })
  })
]);

function jointTestError(code, message, statusCode = 400) {
  return Object.assign(new Error(message), { code, statusCode });
}

function clean(value, maximum = 240) {
  return String(value || "").trim().replace(/[\r\n\t]+/g, " ").slice(0, maximum);
}

function timestamp(value) {
  const result = Date.parse(value || "");
  return Number.isFinite(result) ? result : NaN;
}

function readBoundedMetadataFile(file, label) {
  const resolved = path.resolve(String(file || ""));
  if (!path.isAbsolute(String(file || ""))) {
    throw jointTestError(
      "EXTERNAL_JOINT_TEST_FILE_NOT_ABSOLUTE",
      `${label} file must be an absolute path`
    );
  }
  const link = fs.lstatSync(resolved);
  if (link.isSymbolicLink()) {
    throw jointTestError(
      "EXTERNAL_JOINT_TEST_FILE_SYMLINK_REJECTED",
      `${label} file must not be a symbolic link`
    );
  }
  const stat = fs.statSync(resolved);
  if (!stat.isFile() || stat.size < 2 || stat.size > MAX_METADATA_BYTES) {
    throw jointTestError(
      "EXTERNAL_JOINT_TEST_FILE_INVALID",
      `${label} file must be a bounded regular file`
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(resolved, "utf8"));
  } catch {
    throw jointTestError(
      "EXTERNAL_JOINT_TEST_JSON_INVALID",
      `${label} file must contain valid JSON`
    );
  }
  assertMetadataOnly(parsed, label);
  return parsed;
}

function normalizeCampaign(registry = {}) {
  assertMetadataOnly(registry, "externalJointTestCampaign");
  const interfaces = Array.isArray(registry.interfaces) ? registry.interfaces : [];
  const maximumEvidenceAgeHours = Number(registry.maximumEvidenceAgeHours);
  if (registry.schemaVersion !== "external-joint-test-campaign-registry-v1"
    || !IDENTIFIER.test(clean(registry.campaignId, 160))
    || registry.environment !== "pre-production"
    || !Number.isInteger(maximumEvidenceAgeHours)
    || maximumEvidenceAgeHours < 1
    || maximumEvidenceAgeHours > 720
    || interfaces.length !== REQUIRED_SYSTEMS.length) {
    throw jointTestError(
      "EXTERNAL_JOINT_TEST_CAMPAIGN_INVALID",
      "external joint-test campaign metadata is invalid"
    );
  }
  const ids = new Set();
  const systems = new Set();
  const normalizedInterfaces = interfaces.map((item) => {
    const id = clean(item?.id, 160);
    const system = clean(item?.system, 40);
    const operations = Array.isArray(item?.operations)
      ? [...new Set(item.operations.map((operation) => clean(operation, 120)).filter(Boolean))]
      : [];
    if (!IDENTIFIER.test(id)
      || ids.has(id)
      || !REQUIRED_SYSTEMS.includes(system)
      || systems.has(system)
      || !CONTROLLED_REFERENCE.test(clean(item?.contractRef, 240))
      || !IDENTIFIER.test(clean(item?.externalParty, 160))
      || operations.length < 1) {
      throw jointTestError(
        "EXTERNAL_JOINT_TEST_INTERFACE_INVALID",
        `external joint-test interface ${id || "(missing)"} is invalid`
      );
    }
    ids.add(id);
    systems.add(system);
    return Object.freeze({
      id,
      system,
      contractRef: clean(item.contractRef, 240),
      externalParty: clean(item.externalParty, 160),
      operations: Object.freeze(operations)
    });
  });
  if (REQUIRED_SYSTEMS.some((system) => !systems.has(system))) {
    throw jointTestError(
      "EXTERNAL_JOINT_TEST_SYSTEM_MISSING",
      "campaign must cover every required external system"
    );
  }
  const projection = Object.freeze({
    schemaVersion: registry.schemaVersion,
    campaignId: clean(registry.campaignId, 160),
    environment: "pre-production",
    maximumEvidenceAgeHours,
    interfaces: Object.freeze(normalizedInterfaces)
  });
  return Object.freeze({
    ...projection,
    campaignDigest: sha256(projection)
  });
}

function loadExternalJointTestCampaign(file = CAMPAIGN_FILE) {
  return normalizeCampaign(readBoundedMetadataFile(file, "externalJointTestCampaign"));
}

function buildExternalJointTestCampaign(options = {}) {
  const registry = options.registry
    ? normalizeCampaign(options.registry)
    : loadExternalJointTestCampaign(options.file || CAMPAIGN_FILE);
  const interfaces = registry.interfaces.map((item) => Object.freeze({
    ...item,
    scenarios: Object.freeze(SCENARIOS.map((scenario) => Object.freeze({
      id: scenario.id,
      requiredAssertions: scenario.assertions,
      status: "pending-external"
    }))),
    signedReceiptReady: false
  }));
  return Object.freeze({
    schema: "external-joint-test-campaign-plan-v1",
    campaignId: registry.campaignId,
    campaignDigest: registry.campaignDigest,
    environment: registry.environment,
    maximumEvidenceAgeHours: registry.maximumEvidenceAgeHours,
    interfaces: Object.freeze(interfaces),
    requiredScenarioCount: interfaces.length * SCENARIOS.length,
    externalEvidenceVerified: false,
    decision: "NO-GO",
    productionReady: false,
    credentialsExposed: false,
    patientDataExposed: false,
    boundary: "This plan contains contract metadata only. It neither calls an external system nor manufactures joint-test evidence."
  });
}

function normalizeTrustRegistry(registry = {}, campaign) {
  assertMetadataOnly(registry, "externalJointTestTrustRegistry");
  const rows = Array.isArray(registry.keys) ? registry.keys : [];
  if (registry.schemaVersion !== "external-joint-test-trust-registry-v1"
    || rows.length < 2
    || rows.length > 1000) {
    throw jointTestError(
      "EXTERNAL_JOINT_TEST_TRUST_REGISTRY_INVALID",
      "joint-test trust registry must contain active platform and external public keys"
    );
  }
  const keyIds = new Set();
  const keys = rows.map((row) => {
    const keyId = clean(row?.keyId, 160);
    const account = clean(row?.account, 160);
    const party = clean(row?.party, 40);
    const allowedInterfaceIds = Array.isArray(row?.allowedInterfaceIds)
      ? [...new Set(row.allowedInterfaceIds.map((item) => clean(item, 160)).filter(Boolean))]
      : [];
    const validFrom = timestamp(row?.validFrom);
    const validUntil = timestamp(row?.validUntil);
    if (!IDENTIFIER.test(keyId)
      || keyIds.has(keyId)
      || !IDENTIFIER.test(account)
      || !["platform", "external"].includes(party)
      || row?.algorithm !== "Ed25519"
      || row?.status !== "active"
      || allowedInterfaceIds.length < 1
      || allowedInterfaceIds.some((id) => !campaign.interfaces.some((item) => item.id === id))
      || !Number.isFinite(validFrom)
      || !Number.isFinite(validUntil)
      || validUntil <= validFrom
      || !String(row?.publicKeyPem || "").includes("BEGIN PUBLIC KEY")) {
      throw jointTestError(
        "EXTERNAL_JOINT_TEST_TRUST_KEY_INVALID",
        `joint-test trust key ${keyId || "(missing)"} is invalid`
      );
    }
    let publicKey;
    try {
      publicKey = createPublicKey(row.publicKeyPem);
    } catch {
      throw jointTestError(
        "EXTERNAL_JOINT_TEST_PUBLIC_KEY_INVALID",
        `joint-test trust key ${keyId} is not a valid public key`
      );
    }
    if (publicKey.asymmetricKeyType !== "ed25519") {
      throw jointTestError(
        "EXTERNAL_JOINT_TEST_KEY_ALGORITHM_INVALID",
        `joint-test trust key ${keyId} must be Ed25519`
      );
    }
    keyIds.add(keyId);
    return Object.freeze({
      keyId,
      account,
      party,
      allowedInterfaceIds: Object.freeze(allowedInterfaceIds),
      validFrom,
      validUntil,
      publicKey
    });
  });
  return Object.freeze(keys);
}

function loadExternalJointTestTrustRegistry(file) {
  return readBoundedMetadataFile(file, "externalJointTestTrustRegistry");
}

function createExternalJointTestReceiptSubject(receipt = {}) {
  return Object.freeze({
    schemaVersion: clean(receipt.schemaVersion, 80),
    campaignId: clean(receipt.campaignId, 160),
    campaignDigest: clean(receipt.campaignDigest, 80),
    interfaceId: clean(receipt.interfaceId, 160),
    scenarioId: clean(receipt.scenarioId, 120),
    runId: clean(receipt.runId, 160),
    executedAt: clean(receipt.executedAt, 40),
    expiresAt: clean(receipt.expiresAt, 40),
    result: clean(receipt.result, 40),
    traceRef: clean(receipt.traceRef, 240),
    receiptRef: clean(receipt.receiptRef, 240),
    requestDigest: clean(receipt.requestDigest, 80),
    responseDigest: clean(receipt.responseDigest, 80),
    assertions: receipt.assertions && typeof receipt.assertions === "object"
      ? structuredClone(receipt.assertions)
      : {}
  });
}

function assertionsMatch(actual = {}, expected = {}) {
  return Object.entries(expected).every(([key, value]) => actual[key] === value);
}

function verifyPartyAttestation(attestation, subject, party, interfaceId, keys, now, executedAt) {
  const issuedAt = timestamp(attestation?.issuedAt);
  const key = keys.find((item) => item.keyId === clean(attestation?.keyId, 160));
  const subjectDigest = sha256(subject);
  const signature = clean(attestation?.signature, 200);
  const checks = Object.freeze({
    exactShape: Boolean(attestation)
      && Object.keys(attestation).length === ATTESTATION_FIELDS.size
      && Object.keys(attestation).every((field) => ATTESTATION_FIELDS.has(field)),
    schema: attestation?.schemaVersion === "external-joint-test-attestation-v1",
    algorithm: attestation?.algorithm === "Ed25519",
    party: attestation?.party === party,
    keyKnown: Boolean(key),
    account: Boolean(key) && key.account === clean(attestation?.account, 160),
    keyParty: Boolean(key) && key.party === party,
    interfaceAllowed: Boolean(key) && key.allowedInterfaceIds.includes(interfaceId),
    keyActiveAtIssuance: Boolean(key)
      && Number.isFinite(issuedAt)
      && issuedAt >= key.validFrom
      && issuedAt < key.validUntil,
    keyCurrent: Boolean(key) && now >= key.validFrom && now < key.validUntil,
    issuedAfterExecution: Number.isFinite(issuedAt)
      && Number.isFinite(executedAt)
      && issuedAt >= executedAt
      && issuedAt <= now,
    nonce: NONCE.test(clean(attestation?.nonce, 160)),
    subjectDigest: SHA256.test(clean(attestation?.subjectDigest, 80))
      && attestation.subjectDigest === subjectDigest,
    signatureFormat: SIGNATURE.test(signature)
  });
  let signatureValid = false;
  if (Object.values(checks).every(Boolean)) {
    try {
      signatureValid = verify(
        null,
        Buffer.from(stableStringify(subject)),
        key.publicKey,
        Buffer.from(signature, "base64url")
      );
    } catch {
      signatureValid = false;
    }
  }
  return Object.freeze({
    trusted: Object.values(checks).every(Boolean) && signatureValid,
    party,
    account: clean(attestation?.account, 160),
    keyId: clean(attestation?.keyId, 160),
    checks: Object.freeze({ ...checks, signature: signatureValid })
  });
}

function validRevocations(rows = [], now) {
  if (!Array.isArray(rows)) return Object.freeze({ valid: false, digests: new Set() });
  const digests = new Set();
  let valid = true;
  for (const row of rows) {
    const revokedAt = timestamp(row?.revokedAt);
    const subjectDigest = clean(row?.subjectDigest, 80);
    const rowValid = SHA256.test(subjectDigest)
      && Number.isFinite(revokedAt)
      && revokedAt <= now
      && CONTROLLED_REFERENCE.test(clean(row?.evidenceRef, 240))
      && SHA256.test(clean(row?.evidenceDigest, 80));
    valid = valid && rowValid;
    if (rowValid) digests.add(subjectDigest);
  }
  return Object.freeze({ valid, digests });
}

function evaluateReceipt(options) {
  const {
    campaign,
    item,
    scenario,
    receipt,
    duplicate,
    keys,
    revocations,
    now
  } = options;
  if (!receipt) {
    return Object.freeze({
      id: scenario.id,
      status: "missing",
      verified: false,
      checks: Object.freeze({ present: false })
    });
  }
  assertMetadataOnly(receipt, `externalJointTestReceipt.${item.id}.${scenario.id}`);
  const subject = createExternalJointTestReceiptSubject(receipt);
  const subjectDigest = sha256(subject);
  const executedAt = timestamp(subject.executedAt);
  const expiresAt = timestamp(subject.expiresAt);
  const maximumAgeMs = campaign.maximumEvidenceAgeHours * 60 * 60 * 1000;
  const attestations = Array.isArray(receipt.attestations) ? receipt.attestations : [];
  const platformRows = attestations.filter((row) => row?.party === "platform");
  const externalRows = attestations.filter((row) => row?.party === "external");
  const platform = verifyPartyAttestation(
    platformRows[0],
    subject,
    "platform",
    item.id,
    keys,
    now,
    executedAt
  );
  const external = verifyPartyAttestation(
    externalRows[0],
    subject,
    "external",
    item.id,
    keys,
    now,
    executedAt
  );
  const independent = platform.account
    && external.account
    && platform.account !== external.account
    && platform.keyId !== external.keyId;
  const checks = Object.freeze({
    present: true,
    uniqueReceipt: !duplicate,
    exactShape: Object.keys(receipt).length === RECEIPT_FIELDS.size
      && Object.keys(receipt).every((field) => RECEIPT_FIELDS.has(field)),
    schema: subject.schemaVersion === "external-joint-test-scenario-receipt-v1",
    campaign: subject.campaignId === campaign.campaignId
      && subject.campaignDigest === campaign.campaignDigest,
    interface: subject.interfaceId === item.id,
    scenario: subject.scenarioId === scenario.id,
    run: IDENTIFIER.test(subject.runId),
    result: subject.result === "passed",
    references: CONTROLLED_REFERENCE.test(subject.traceRef)
      && CONTROLLED_REFERENCE.test(subject.receiptRef),
    digests: SHA256.test(subject.requestDigest)
      && SHA256.test(subject.responseDigest),
    assertions: assertionsMatch(subject.assertions, scenario.assertions)
      && (scenario.id !== "timeout-retry"
        || (Number.isInteger(subject.assertions.attemptCount)
          && subject.assertions.attemptCount >= 2
          && subject.assertions.attemptCount <= 4)),
    executionWindow: Number.isFinite(executedAt)
      && executedAt <= now
      && Number.isFinite(expiresAt)
      && expiresAt > executedAt
      && expiresAt - executedAt <= maximumAgeMs
      && expiresAt > now,
    twoPartyAttestations: attestations.length === 2
      && platformRows.length === 1
      && externalRows.length === 1
      && platform.trusted
      && external.trusted
      && independent,
    notRevoked: revocations.valid && !revocations.digests.has(subjectDigest)
  });
  const verified = Object.values(checks).every(Boolean);
  let status = "invalid";
  if (verified) status = "verified";
  else if (!checks.executionWindow) status = "expired";
  else if (!checks.notRevoked) status = "revoked";
  return Object.freeze({
    id: scenario.id,
    status,
    verified,
    subjectDigest,
    checks,
    attestations: Object.freeze({ platform, external, independent: Boolean(independent) })
  });
}

function buildRegionalJointTestEvidenceProjection(evaluation = {}) {
  const base = Object.freeze({
    schema: "regional-joint-test-evidence-v1",
    registryDigest: clean(evaluation.campaignDigest, 80),
    contracts: Object.freeze((evaluation.interfaces || []).map((item) => Object.freeze({
      contractId: item.id,
      system: item.system,
      verified: item.verified,
      checks: Object.freeze({
        requiredScenarioCoverage: item.scenarios.every((scenario) => scenario.verified),
        twoPartySignatures: item.scenarios.every((scenario) =>
          scenario.attestations?.platform?.trusted === true
          && scenario.attestations?.external?.trusted === true),
        currentEvidence: item.scenarios.every((scenario) => scenario.checks?.executionWindow === true),
        notRevoked: item.scenarios.every((scenario) => scenario.checks?.notRevoked === true)
      })
    }))),
    externalEvidenceVerified: evaluation.externalEvidenceVerified === true,
    evidenceInferred: false
  });
  return Object.freeze({
    ...base,
    technicalEvidenceFingerprint: createTechnicalEvidenceFingerprint(base.schema, base),
    productionReady: false
  });
}

function evaluateExternalJointTestCampaign(options = {}) {
  const campaign = options.campaign
    ? normalizeCampaign(options.campaign)
    : loadExternalJointTestCampaign(options.campaignFile || CAMPAIGN_FILE);
  const trustRegistry = options.trustRegistry
    || loadExternalJointTestTrustRegistry(options.trustRegistryFile);
  const keys = normalizeTrustRegistry(trustRegistry, campaign);
  const bundle = options.evidenceBundle || {};
  assertMetadataOnly(bundle, "externalJointTestEvidenceBundle");
  if (bundle.schemaVersion !== "external-joint-test-evidence-bundle-v1"
    || clean(bundle.campaignId, 160) !== campaign.campaignId
    || clean(bundle.campaignDigest, 80) !== campaign.campaignDigest
    || !Array.isArray(bundle.receipts)) {
    throw jointTestError(
      "EXTERNAL_JOINT_TEST_EVIDENCE_BUNDLE_INVALID",
      "external joint-test evidence bundle is invalid or not bound to the campaign"
    );
  }
  const now = timestamp(options.now || new Date().toISOString());
  if (!Number.isFinite(now)) {
    throw jointTestError(
      "EXTERNAL_JOINT_TEST_EVALUATION_TIME_INVALID",
      "external joint-test evaluation time is invalid"
    );
  }
  const revocations = validRevocations(bundle.revocations || [], now);
  const grouped = new Map();
  const expectedKeys = new Set(campaign.interfaces.flatMap((item) =>
    SCENARIOS.map((scenario) => `${item.id}\u0000${scenario.id}`)));
  let unexpectedReceipts = 0;
  for (const receipt of bundle.receipts) {
    const key = `${clean(receipt?.interfaceId, 160)}\u0000${clean(receipt?.scenarioId, 120)}`;
    if (!expectedKeys.has(key)) unexpectedReceipts += 1;
    grouped.set(key, [...(grouped.get(key) || []), receipt]);
  }
  const interfaces = campaign.interfaces.map((item) => {
    const scenarios = SCENARIOS.map((scenario) => {
      const receipts = grouped.get(`${item.id}\u0000${scenario.id}`) || [];
      return evaluateReceipt({
        campaign,
        item,
        scenario,
        receipt: receipts[0],
        duplicate: receipts.length > 1,
        keys,
        revocations,
        now
      });
    });
    return Object.freeze({
      id: item.id,
      system: item.system,
      scenarios: Object.freeze(scenarios),
      verified: scenarios.every((scenario) => scenario.verified)
    });
  });
  const results = interfaces.flatMap((item) => item.scenarios);
  const externalEvidenceVerified = revocations.valid
    && bundle.receipts.length === campaign.interfaces.length * SCENARIOS.length
    && unexpectedReceipts === 0
    && interfaces.every((item) => item.verified);
  const evaluationBase = Object.freeze({
    schema: "external-joint-test-campaign-evaluation-v1",
    campaignId: campaign.campaignId,
    campaignDigest: campaign.campaignDigest,
    evaluatedAt: new Date(now).toISOString(),
    interfaces: Object.freeze(interfaces),
    summary: Object.freeze({
      required: campaign.interfaces.length * SCENARIOS.length,
      supplied: bundle.receipts.length,
      unexpected: unexpectedReceipts,
      verified: results.filter((item) => item.status === "verified").length,
      missing: results.filter((item) => item.status === "missing").length,
      invalid: results.filter((item) => item.status === "invalid").length,
      expired: results.filter((item) => item.status === "expired").length,
      revoked: results.filter((item) => item.status === "revoked").length
    }),
    trustKeyCount: keys.length,
    revocationRegistryValid: revocations.valid,
    externalEvidenceVerified,
    evidenceInferred: false,
    decision: externalEvidenceVerified ? "JOINT-TEST-PASSED" : "NO-GO"
  });
  const evaluation = Object.freeze({
    ...evaluationBase,
    technicalEvidenceFingerprint: createTechnicalEvidenceFingerprint(
      evaluationBase.schema,
      evaluationBase
    ),
    productionReady: false,
    credentialsExposed: false,
    patientDataExposed: false,
    boundary: "A passed result verifies supplied metadata, Ed25519 attestations and evidence freshness only. Production cutover remains separately authorized and human controlled."
  });
  return Object.freeze({
    ...evaluation,
    regionalJointTestEvidence: buildRegionalJointTestEvidenceProjection(evaluation)
  });
}

module.exports = {
  CAMPAIGN_FILE,
  CONTROLLED_REFERENCE,
  MAX_METADATA_BYTES,
  REQUIRED_SYSTEMS,
  SCENARIOS,
  buildExternalJointTestCampaign,
  buildRegionalJointTestEvidenceProjection,
  createExternalJointTestReceiptSubject,
  evaluateExternalJointTestCampaign,
  loadExternalJointTestCampaign,
  loadExternalJointTestTrustRegistry,
  normalizeCampaign
};
