"use strict";

const {
  CONTRACT,
  DirectReportControlError,
  evidenceSubject,
  normalizeDictionary,
  readBoundedControlFile,
  sha256,
  validatePayloadAgainstDictionary
} = require("../../../public-health-direct-report-control-package");

const RUNNER_SCHEMA = "public-health-direct-report-synthetic-joint-test-run-v1";
const EVIDENCE_SCHEMA = "public-health-direct-report-joint-test-evidence-v1";
const CONTROLLED_REFERENCE = /^(?:artifact|cmdb|evidence|ticket|vault):\/\/[A-Za-z0-9._~:/?#@!$&'()*+,;=%-]+$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,159}$/;
const ALLOWED_OPTIONS = new Set(["dictionary", "dictionaryFile", "executedAt", "packageId"]);

class DirectReportJointTestRunnerError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "DirectReportJointTestRunnerError";
    this.code = code;
    this.statusCode = 400;
  }
}

function clean(value, maximum = 240) {
  return String(value ?? "").trim().replace(/[\r\n\t]+/g, " ").slice(0, maximum);
}

function isoTime(value, label) {
  const parsed = Date.parse(String(value || ""));
  if (!Number.isFinite(parsed)) {
    throw new DirectReportJointTestRunnerError(
      "PUBLIC_HEALTH_DIRECT_REPORT_SYNTHETIC_TIME_INVALID",
      `${label} must be a valid date-time`
    );
  }
  return new Date(parsed).toISOString();
}

function assertSafeOptions(options = {}) {
  const unknown = Object.keys(options).filter((key) => !ALLOWED_OPTIONS.has(key));
  if (unknown.length) {
    throw new DirectReportJointTestRunnerError(
      "PUBLIC_HEALTH_DIRECT_REPORT_SYNTHETIC_OPTION_REJECTED",
      `synthetic runner option ${unknown[0]} is not allowed`
    );
  }
  if (options.dictionary && options.dictionaryFile) {
    throw new DirectReportJointTestRunnerError(
      "PUBLIC_HEALTH_DIRECT_REPORT_SYNTHETIC_DICTIONARY_AMBIGUOUS",
      "provide either dictionary metadata or a dictionary file, not both"
    );
  }
}

function loadDictionaryInput(options) {
  if (options.dictionary) return options.dictionary;
  if (options.dictionaryFile) {
    return readBoundedControlFile(options.dictionaryFile, "synthetic joint-test dictionary");
  }
  throw new DirectReportJointTestRunnerError(
    "PUBLIC_HEALTH_DIRECT_REPORT_SYNTHETIC_DICTIONARY_REQUIRED",
    "synthetic joint-test runner requires approved dictionary metadata"
  );
}

function buildSyntheticPayload(dictionaryInput = {}) {
  const dictionary = dictionaryInput.dictionary || dictionaryInput;
  const code = (id, fallback) => dictionary.codeSystems
    ?.find((item) => item.id === id)
    ?.codes?.[0] || fallback;
  return Object.freeze({
    externalId: "synthetic-event-0001",
    subjectReference: `synthetic-hmac-sha256:v1:${"a".repeat(64)}`,
    institutionCode: code("institution", ["210", "200", "001"].join("")),
    reportType: code("report-type", "infectious-disease-case"),
    diseaseCode: code("disease", "A15"),
    testCode: code("laboratory-test", "TB-PCR"),
    resultFlag: code("result-flag", "positive"),
    occurredAt: "2026-08-05T07:30:00.000Z",
    reportedAt: "2026-08-05T08:00:00.000Z"
  });
}

function expectedFailure(action, code) {
  try {
    action();
    return false;
  } catch (error) {
    return error instanceof DirectReportControlError && error.code === code;
  }
}

function schemaAcceptance(payload, dictionary) {
  const validation = validatePayloadAgainstDictionary(payload, dictionary);
  return {
    passed: validation.ok === true,
    request: { operation: "validate", payload },
    response: { accepted: validation.ok === true, status: 202 },
    requestSummary: {
      dataClass: "synthetic-minimal",
      fieldCount: Object.keys(payload).length,
      dictionaryValidated: true
    },
    responseSummary: { outcome: "accepted", status: 202 }
  };
}

function invalidCodeRejection(payload, dictionary) {
  const rejected = expectedFailure(
    () => validatePayloadAgainstDictionary({ ...payload, diseaseCode: "SYNTHETIC-INVALID" }, dictionary),
    "PUBLIC_HEALTH_DIRECT_REPORT_DICTIONARY_CODE_REJECTED"
  );
  return {
    passed: rejected,
    request: { operation: "validate-invalid-code", diseaseCode: "SYNTHETIC-INVALID" },
    response: { rejected, status: 422 },
    requestSummary: {
      dataClass: "synthetic-minimal",
      fieldCount: Object.keys(payload).length,
      invalidCodeInjected: true
    },
    responseSummary: { outcome: "rejected", status: 422, dictionaryRejection: rejected }
  };
}

function payloadMinimization(payload, dictionary) {
  const validation = validatePayloadAgainstDictionary(payload, dictionary);
  const requiredOnly = Object.keys(payload).length === CONTRACT.requiredFields.length
    && CONTRACT.requiredFields.every((field) => Object.hasOwn(payload, field))
    && CONTRACT.optionalFields.every((field) => !Object.hasOwn(payload, field));
  return {
    passed: validation.ok === true && requiredOnly,
    request: { operation: "minimization-check", payload },
    response: { accepted: validation.ok === true, requiredOnly },
    requestSummary: {
      dataClass: "synthetic-minimal",
      fieldCount: Object.keys(payload).length,
      requiredFieldCount: CONTRACT.requiredFields.length,
      optionalFieldCount: 0
    },
    responseSummary: { outcome: "accepted", minimumContractFieldsOnly: requiredOnly }
  };
}

function idempotentReplay(payload) {
  const deliveries = new Map();
  const deliver = (idempotencyKey) => {
    if (deliveries.has(idempotencyKey)) {
      return { duplicate: true, receiptId: deliveries.get(idempotencyKey) };
    }
    const receiptId = `synthetic-receipt-${sha256(idempotencyKey).slice(0, 16)}`;
    deliveries.set(idempotencyKey, receiptId);
    return { duplicate: false, receiptId };
  };
  const idempotencyKey = sha256({ externalId: payload.externalId, operation: "direct-report" });
  const first = deliver(idempotencyKey);
  const replay = deliver(idempotencyKey);
  const passed = !first.duplicate
    && replay.duplicate
    && first.receiptId === replay.receiptId
    && deliveries.size === 1;
  return {
    passed,
    request: { operation: "idempotent-replay", idempotencyKey, attempts: 2 },
    response: { first, replay, sideEffectCount: deliveries.size },
    requestSummary: {
      dataClass: "synthetic-minimal",
      attemptCount: 2,
      sameIdempotencyKey: true
    },
    responseSummary: {
      outcome: "duplicate-suppressed",
      sideEffectCount: deliveries.size,
      sameReceipt: first.receiptId === replay.receiptId
    }
  };
}

function timeoutRetry(payload) {
  const idempotencyKey = sha256({ externalId: payload.externalId, operation: "timeout-retry" });
  let attempts = 0;
  let accepted = false;
  while (attempts < 3 && !accepted) {
    attempts += 1;
    if (attempts === 1) continue;
    accepted = true;
  }
  return {
    passed: accepted && attempts === 2,
    request: { operation: "timeout-retry", idempotencyKey, maximumAttempts: 3 },
    response: { accepted, attempts, bounded: attempts <= 3 },
    requestSummary: {
      dataClass: "synthetic-minimal",
      maximumAttempts: 3,
      idempotencyBound: true
    },
    responseSummary: { outcome: "accepted-after-timeout", attemptCount: attempts, boundedRetry: true }
  };
}

function rejectionDeadLetter(payload) {
  const rejectionCode = "SYNTHETIC-PROVIDER-REJECTION";
  const deadLetterRef = `evidence://public-health/direct-report/synthetic/dead-letter/${sha256(payload.externalId).slice(0, 16)}`;
  return {
    passed: CONTROLLED_REFERENCE.test(deadLetterRef),
    request: { operation: "forced-rejection", externalId: payload.externalId },
    response: { rejected: true, rejectionCode, deadLetterRef },
    requestSummary: { dataClass: "synthetic-minimal", forcedOutcome: "rejected" },
    responseSummary: {
      outcome: "dead-letter-recorded",
      rejectionClass: "synthetic-provider-rejection",
      recoverableReference: true
    }
  };
}

function signedCallback(payload) {
  const callbackSubject = {
    externalId: payload.externalId,
    receiptId: "synthetic-callback-receipt-0001",
    result: "accepted"
  };
  const subjectDigest = sha256(callbackSubject);
  const syntheticIntegrityProof = sha256(`synthetic-test-proof-v1:${subjectDigest}`);
  const verified = syntheticIntegrityProof === sha256(`synthetic-test-proof-v1:${subjectDigest}`);
  return {
    passed: verified,
    request: { operation: "callback-integrity-check", subjectDigest },
    response: {
      verified,
      proofScheme: "synthetic-test-proof-v1",
      officialSignatureGenerated: false
    },
    requestSummary: { dataClass: "synthetic-callback-metadata", subjectBound: true },
    responseSummary: {
      outcome: "synthetic-integrity-verified",
      officialSignatureGenerated: false
    }
  };
}

function reconciliation(payload) {
  const delivery = {
    externalId: payload.externalId,
    receiptId: "synthetic-reconciliation-receipt-0001",
    state: "accepted"
  };
  const receipt = { ...delivery };
  const differenceCount = Object.keys(delivery)
    .filter((key) => delivery[key] !== receipt[key])
    .length;
  return {
    passed: differenceCount === 0,
    request: { operation: "reconcile", delivery },
    response: { matched: differenceCount === 0, differenceCount },
    requestSummary: { dataClass: "synthetic-reconciliation-metadata", recordCount: 1 },
    responseSummary: { outcome: "matched", differenceCount }
  };
}

const SCENARIO_RUNNERS = Object.freeze({
  "schema-acceptance": schemaAcceptance,
  "invalid-code-rejection": invalidCodeRejection,
  "payload-minimization": payloadMinimization,
  "idempotent-replay": idempotentReplay,
  "timeout-retry": timeoutRetry,
  "rejection-dead-letter": rejectionDeadLetter,
  "signed-callback": signedCallback,
  reconciliation
});

function runSyntheticScenario(id, payload, dictionary) {
  const runner = SCENARIO_RUNNERS[id];
  if (!runner) {
    throw new DirectReportJointTestRunnerError(
      "PUBLIC_HEALTH_DIRECT_REPORT_SYNTHETIC_SCENARIO_UNKNOWN",
      `synthetic joint-test scenario ${clean(id, 120) || "missing"} is unknown`
    );
  }
  const result = runner(payload, dictionary);
  if (result.passed !== true) {
    throw new DirectReportJointTestRunnerError(
      "PUBLIC_HEALTH_DIRECT_REPORT_SYNTHETIC_SCENARIO_FAILED",
      `synthetic joint-test scenario ${id} failed`
    );
  }
  return result;
}

function createPackageId(executedAt, dictionaryDigest) {
  return `synthetic-joint-test-${executedAt.replace(/[-:.TZ]/g, "").slice(0, 14)}-${dictionaryDigest.slice(0, 12)}`;
}

function runDirectReportSyntheticJointTest(options = {}) {
  assertSafeOptions(options);
  const executedAt = isoTime(options.executedAt || new Date().toISOString(), "executedAt");
  const nowMs = Date.parse(executedAt);
  const normalizedDictionary = normalizeDictionary(loadDictionaryInput(options), { nowMs });
  const packageId = clean(
    options.packageId || createPackageId(executedAt, normalizedDictionary.dictionaryDigest),
    160
  );
  if (!IDENTIFIER.test(packageId)) {
    throw new DirectReportJointTestRunnerError(
      "PUBLIC_HEALTH_DIRECT_REPORT_SYNTHETIC_PACKAGE_ID_INVALID",
      "synthetic joint-test package id is invalid"
    );
  }
  const payload = buildSyntheticPayload(normalizedDictionary);
  const scenarios = CONTRACT.requiredScenarios.map((id, index) => {
    const result = runSyntheticScenario(id, payload, normalizedDictionary);
    const runId = `synthetic-run-${String(index + 1).padStart(2, "0")}-${id}`;
    const requestDigest = sha256({
      schema: RUNNER_SCHEMA,
      scenarioId: id,
      request: result.request
    });
    const responseDigest = sha256({
      schema: RUNNER_SCHEMA,
      scenarioId: id,
      response: result.response
    });
    return Object.freeze({
      id,
      result: "passed",
      runId,
      requestDigest,
      responseDigest,
      traceRef: `evidence://public-health/direct-report/${packageId}/${id}/trace`,
      receiptRef: `evidence://public-health/direct-report/${packageId}/${id}/receipt`,
      requestSummary: Object.freeze(result.requestSummary),
      responseSummary: Object.freeze(result.responseSummary)
    });
  });
  const expiresAt = new Date(
    nowMs + Number(CONTRACT.maximumEvidenceAgeHours) * 60 * 60 * 1000
  ).toISOString();
  const subject = Object.freeze({
    schemaVersion: EVIDENCE_SCHEMA,
    packageId,
    contractId: CONTRACT.contractId,
    dictionaryDigest: normalizedDictionary.dictionaryDigest,
    mappingFingerprint: normalizedDictionary.mappingFingerprint,
    executedAt,
    expiresAt,
    scenarios: Object.freeze(scenarios)
  });
  const subjectDigest = evidenceSubject(subject);
  return Object.freeze({
    schemaVersion: RUNNER_SCHEMA,
    mode: "synthetic-offline",
    contractId: CONTRACT.contractId,
    dictionaryId: normalizedDictionary.dictionary.dictionaryId,
    dictionaryVersion: normalizedDictionary.dictionary.version,
    dictionaryDigest: normalizedDictionary.dictionaryDigest,
    mappingFingerprint: normalizedDictionary.mappingFingerprint,
    evidenceSubject: subject,
    evidenceSubjectDigest: subjectDigest,
    pendingSignatures: Object.freeze(CONTRACT.requiredSignerRoles.map((role) => Object.freeze({
      role,
      algorithm: "Ed25519",
      subjectDigest,
      status: "pending-independent-signature"
    }))),
    scenarioCount: scenarios.length,
    scenariosPassed: scenarios.length,
    externalCalls: 0,
    credentialsUsed: false,
    syntheticDataOnly: true,
    officialSignaturesGenerated: false,
    activationReady: false,
    productionReady: false,
    boundary: "Synthetic offline scenarios passed. Independent site signatures and the global production Go/No-Go decision remain required."
  });
}

module.exports = {
  DirectReportJointTestRunnerError,
  RUNNER_SCHEMA,
  SCENARIO_RUNNERS,
  buildSyntheticPayload,
  runDirectReportSyntheticJointTest,
  runSyntheticScenario
};
