"use strict";

const { createHash } = require("node:crypto");
const program = require("../../config/care-integration-v2-program.json");

const SHA256 = /^sha256:[a-f0-9]{64}$/;
const REF = /^(?:artifact|cmdb|evidence|ticket|vault):\/\/[A-Za-z0-9._~:/?#@!$&'()*+,;=%-]+$/;
const MACHINE_CODE = /^[A-Z0-9][A-Z0-9._:-]{2,119}$/;
const RUN_ID = /^acr-[a-f0-9]{20}$/;
const FORBIDDEN = /^(?:body|credential|credentials|endpoint|message|patient|payload|privateKey|raw|rawMessage|secret|signature|token)$/i;

function sdkError(code, message, statusCode = 409) {
  return Object.assign(new Error(message), { code, statusCode });
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(typeof value === "string" ? value : stable(value)).digest("hex")}`;
}

function clean(value, maximum = 240) {
  return String(value || "").trim().replace(/[\r\n\t]+/g, " ").slice(0, maximum);
}

function required(value, label, maximum = 240) {
  const result = clean(value, maximum);
  if (!result) throw sdkError("ADAPTER_CONTRACT_INPUT_INVALID", `${label} is required`, 400);
  return result;
}

function commandId(value) {
  const result = clean(value, 72);
  if (!/^[A-Za-z0-9._:-]{8,72}$/.test(result)) throw sdkError("ADAPTER_CONTRACT_COMMAND_INVALID", "commandId is invalid", 400);
  return result;
}

function digest(value, label) {
  const result = clean(value, 80);
  if (!SHA256.test(result)) throw sdkError("ADAPTER_CONTRACT_DIGEST_INVALID", `${label} must be a SHA-256 digest`, 400);
  return result;
}

function evidenceRef(value, label) {
  const result = clean(value, 240);
  if (!REF.test(result)) throw sdkError("ADAPTER_CONTRACT_EVIDENCE_INVALID", `${label} must be a controlled reference`, 400);
  return result;
}

function time(value, label) {
  const result = Date.parse(value || "");
  if (!Number.isFinite(result)) throw sdkError("ADAPTER_CONTRACT_TIME_INVALID", `${label} is invalid`, 400);
  return result;
}

function now(value) {
  return new Date(value ? time(value, "current time") : Date.now()).toISOString();
}

function endpoint(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:" || url.username || url.password
      || new Set(["localhost", "127.0.0.1", "::1"]).has(url.hostname.toLowerCase())) throw new Error("unsafe");
    return url.toString();
  } catch {
    throw sdkError("ADAPTER_CONTRACT_HTTPS_REQUIRED", "runtime adapter endpoint must be credential-free HTTPS", 400);
  }
}

function noRawMaterial(value) {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN.test(key)) throw sdkError("ADAPTER_CONTRACT_RAW_MATERIAL_REJECTED", "adapter response contains forbidden raw material", 400);
    noRawMaterial(child);
  }
}

function validateProgram(value = program) {
  const systems = new Set();
  const ids = new Set();
  const policy = value?.transportPolicy || {};
  if (value?.schemaVersion !== "care-integration-v2-program-v1"
    || !Array.isArray(value.adapterContracts) || value.adapterContracts.length < 4
    || !Array.isArray(value.requiredContractControls) || value.requiredContractControls.length !== 6
    || !Array.isArray(value.continuousCareSequence) || value.continuousCareSequence.length !== 6
    || !Array.isArray(value.requiredExternalReceiptTypes) || value.requiredExternalReceiptTypes.length !== 2
    || policy.httpsRequired !== true || !Number.isInteger(policy.maximumClockSkewSeconds)
    || !Number.isInteger(policy.nonceRetentionSeconds) || !Number.isInteger(policy.maxAttempts)
    || !Number.isInteger(policy.baseDelaySeconds) || !Number.isInteger(policy.maximumDelaySeconds)
    || value?.evidencePolicy?.storeRawMessages !== false || value.evidencePolicy.storeCredentials !== false
    || value.evidencePolicy.storeEndpoints !== false || value.evidencePolicy.storeSignatures !== false
    || value.evidencePolicy.storePatientData !== false || !Array.isArray(value.productionBlockers)) {
    throw new TypeError("care integration v2 program is invalid");
  }
  for (const contract of value.adapterContracts) {
    if (!/^[a-z0-9-]+$/.test(contract.id || "") || ids.has(contract.id)
      || !/^[A-Z]+$/.test(contract.system || "") || systems.has(contract.system)
      || !Array.isArray(contract.operations) || contract.operations.length === 0) {
      throw new TypeError("care integration adapter contracts must have unique ids and systems");
    }
    ids.add(contract.id);
    systems.add(contract.system);
  }
  for (const requiredSystem of ["HIS", "EMR", "LIS", "PACS"]) {
    if (!systems.has(requiredSystem)) throw new TypeError(`care integration contract ${requiredSystem} is missing`);
  }
  return true;
}

function normalize(data) {
  const next = structuredClone(data || {});
  next.careAdapterContractRuns = Array.isArray(next.careAdapterContractRuns) ? next.careAdapterContractRuns : [];
  next.careAdapterContractCommands = Array.isArray(next.careAdapterContractCommands) ? next.careAdapterContractCommands : [];
  next.careAdapterNonceDigests = Array.isArray(next.careAdapterNonceDigests) ? next.careAdapterNonceDigests : [];
  return next;
}

function publicRun(run) {
  return Object.freeze({
    runId: run.runId, contractId: run.contractId, system: run.system,
    correlationId: run.correlationId, requestDigest: run.requestDigest,
    requestEvidenceRef: run.requestEvidenceRef, endpointDigest: run.endpointDigest,
    idempotencyKeyDigest: run.idempotencyKeyDigest, status: run.status,
    version: run.version, attemptCount: run.attempts.length, nextRetryAt: run.nextRetryAt || null,
    receipt: run.receipt ? Object.freeze(structuredClone(run.receipt)) : null,
    updatedAt: run.updatedAt, externalEvidenceVerified: false, productionReady: false
  });
}

function findRun(data, runId) {
  if (!RUN_ID.test(runId || "")) throw sdkError("ADAPTER_CONTRACT_RUN_INVALID", "runId is invalid", 400);
  const run = data.careAdapterContractRuns.find((item) => item.runId === runId);
  if (!run) throw sdkError("ADAPTER_CONTRACT_RUN_NOT_FOUND", "adapter contract run was not found", 404);
  return run;
}

function replay(data, id, fingerprint) {
  const item = data.careAdapterContractCommands.find((row) => row.commandId === id);
  if (!item) return null;
  if (item.fingerprint !== fingerprint) throw sdkError("ADAPTER_CONTRACT_COMMAND_CONFLICT", "commandId was reused with different metadata");
  return item;
}

function startAdapterContractRun(data, command = {}, options = {}) {
  const active = options.program || program;
  validateProgram(active);
  const id = commandId(command.commandId);
  const contractId = required(command.contractId, "contractId", 80);
  const contract = active.adapterContracts.find((item) => item.id === contractId);
  if (!contract) throw sdkError("ADAPTER_CONTRACT_NOT_FOUND", "adapter contract was not found", 404);
  const correlationId = required(command.correlationId, "correlationId", 120);
  const requestDigest = digest(command.requestDigest, "requestDigest");
  const requestEvidenceRef = evidenceRef(command.requestEvidenceRef, "requestEvidenceRef");
  const idempotencyKeyDigest = sha256(required(command.idempotencyKey, "idempotencyKey", 160));
  const runtimeEndpoint = endpoint(options.endpoint);
  let next = normalize(data);
  const fingerprint = sha256({ contractId, correlationId, requestDigest, requestEvidenceRef, idempotencyKeyDigest });
  const previous = replay(next, id, fingerprint);
  if (previous) return Object.freeze({ data: next, result: publicRun(findRun(next, previous.runId)), replayed: true });
  const sameKey = next.careAdapterContractRuns.find((item) => item.idempotencyKeyDigest === idempotencyKeyDigest);
  if (sameKey) {
    if (sameKey.requestDigest !== requestDigest || sameKey.contractId !== contractId
      || sameKey.correlationId !== correlationId || sameKey.requestEvidenceRef !== requestEvidenceRef) {
      throw sdkError("ADAPTER_CONTRACT_IDEMPOTENCY_CONFLICT", "idempotency key was reused for a different contract request");
    }
    next.careAdapterContractCommands.push({ commandId: id, fingerprint, runId: sameKey.runId, recordedAt: now(options.now) });
    return Object.freeze({ data: next, result: publicRun(sameKey), replayed: true });
  }
  const recordedAt = now(options.now);
  const run = {
    runId: `acr-${sha256({ contractId, correlationId, idempotencyKeyDigest }).slice(7, 27)}`,
    contractId, system: contract.system, correlationId, requestDigest, requestEvidenceRef,
    endpointDigest: sha256(runtimeEndpoint), idempotencyKeyDigest, status: "prepared", version: 0,
    attempts: [], nextRetryAt: null, receipt: null, createdAt: recordedAt, updatedAt: recordedAt
  };
  next.careAdapterContractRuns.push(run);
  next.careAdapterContractCommands.push({ commandId: id, fingerprint, runId: run.runId, recordedAt });
  return Object.freeze({ data: next, result: publicRun(run), replayed: false });
}

function receiptProjection(receipt = {}) {
  return Object.freeze({
    acknowledgedRequestDigest: digest(receipt.acknowledgedRequestDigest, "acknowledgedRequestDigest"),
    responseDigest: digest(receipt.responseDigest, "responseDigest"),
    signatureDigest: digest(receipt.signatureDigest, "signatureDigest"),
    receiptEvidenceRef: evidenceRef(receipt.receiptEvidenceRef, "receiptEvidenceRef"),
    receivedAt: new Date(time(receipt.receivedAt, "receipt receivedAt")).toISOString()
  });
}

function createReceiptDigest(receipt) {
  return sha256(receiptProjection(receipt));
}

function createInstitutionAdapterSdk(dependencies = {}) {
  if (typeof dependencies.dispatch !== "function" || typeof dependencies.verifyReceipt !== "function") {
    throw new TypeError("institution adapter SDK requires dispatch and verifyReceipt dependencies");
  }
  return Object.freeze({
    async execute(data, command = {}, runtime = {}) {
      const active = runtime.program || program;
      validateProgram(active);
      let next = normalize(data);
      const id = commandId(command.commandId);
      const runId = required(command.runId, "runId", 32);
      const fingerprint = sha256({ runId, expectedVersion: Number(command.expectedVersion) });
      const prior = replay(next, id, fingerprint);
      if (prior) return Object.freeze({ data: next, result: publicRun(findRun(next, runId)), replayed: true });
      let run = findRun(next, runId);
      if (!Number.isInteger(Number(command.expectedVersion)) || Number(command.expectedVersion) !== run.version) {
        throw sdkError("ADAPTER_CONTRACT_VERSION_CONFLICT", "expectedVersion does not match adapter run");
      }
      if (!["prepared", "retry-wait", "reconciliation-required"].includes(run.status)) {
        throw sdkError("ADAPTER_CONTRACT_ATTEMPT_NOT_ALLOWED", "adapter run does not accept another attempt");
      }
      const runtimeEndpoint = endpoint(runtime.endpoint);
      if (sha256(runtimeEndpoint) !== run.endpointDigest) throw sdkError("ADAPTER_CONTRACT_ENDPOINT_CHANGED", "runtime endpoint digest changed", 400);
      const current = now(runtime.now);
      const requestedAt = new Date(time(runtime.requestTimestamp, "request timestamp")).toISOString();
      if (Math.abs(Date.parse(current) - Date.parse(requestedAt)) > active.transportPolicy.maximumClockSkewSeconds * 1000) {
        throw sdkError("ADAPTER_CONTRACT_REQUEST_EXPIRED", "request timestamp is outside the accepted window", 400);
      }
      if (run.status === "retry-wait" && Date.parse(run.nextRetryAt) > Date.parse(current)) {
        throw sdkError("ADAPTER_CONTRACT_RETRY_NOT_DUE", "adapter retry backoff has not elapsed");
      }
      const nonceDigest = sha256(required(runtime.nonce, "nonce", 160));
      const cutoff = Date.parse(current) - active.transportPolicy.nonceRetentionSeconds * 1000;
      next.careAdapterNonceDigests = next.careAdapterNonceDigests.filter((item) => Date.parse(item.recordedAt) >= cutoff);
      if (next.careAdapterNonceDigests.some((item) => item.nonceDigest === nonceDigest)) {
        throw sdkError("ADAPTER_CONTRACT_REPLAY_BLOCKED", "adapter nonce replay was blocked");
      }
      let response;
      try {
        response = await dependencies.dispatch(Object.freeze({
          endpoint: runtimeEndpoint, contractId: run.contractId, system: run.system,
          correlationId: run.correlationId, requestDigest: run.requestDigest,
          requestEvidenceRef: run.requestEvidenceRef, idempotencyKeyDigest: run.idempotencyKeyDigest,
          nonceDigest, requestTimestamp: requestedAt
        }));
      } catch {
        response = { outcome: "retryable-failure", errorCode: "ADAPTER_TRANSPORT_ERROR" };
      }
      noRawMaterial(response);
      const outcome = clean(response?.outcome, 40);
      if (!["accepted", "retryable-failure", "permanent-failure"].includes(outcome)) {
        throw sdkError("ADAPTER_CONTRACT_OUTCOME_INVALID", "adapter outcome is invalid", 400);
      }
      next.careAdapterNonceDigests.push({ nonceDigest, runId, recordedAt: current });
      let receipt = null;
      let errorCode = null;
      if (outcome === "accepted") {
        const projection = receiptProjection(response.receipt);
        const receiptDigest = digest(response.receipt?.receiptDigest, "receiptDigest");
        if (receiptDigest !== sha256(projection)) throw sdkError("ADAPTER_CONTRACT_RECEIPT_INTEGRITY", "receipt digest mismatch", 400);
        if (Math.abs(Date.parse(current) - Date.parse(projection.receivedAt)) > active.transportPolicy.maximumClockSkewSeconds * 1000
          || Date.parse(projection.receivedAt) < Date.parse(requestedAt)) {
          throw sdkError("ADAPTER_CONTRACT_RECEIPT_EXPIRED", "receipt is outside the accepted window", 400);
        }
        const verification = await dependencies.verifyReceipt(Object.freeze({
          contractId: run.contractId, system: run.system, receiptDigest,
          signatureDigest: projection.signatureDigest, receiptEvidenceRef: projection.receiptEvidenceRef
        }));
        noRawMaterial(verification);
        if (verification?.verified !== true) throw sdkError("ADAPTER_CONTRACT_SIGNATURE_UNVERIFIED", "receipt signature digest was not verified", 400);
        receipt = Object.freeze({
          ...projection, receiptDigest,
          signatureVerificationEvidenceRef: evidenceRef(verification.evidenceRef, "signature verification evidence"),
          matched: projection.acknowledgedRequestDigest === run.requestDigest,
          externalEvidenceVerified: false
        });
      } else {
        errorCode = clean(response?.errorCode, 120);
        if (!MACHINE_CODE.test(errorCode)) throw sdkError("ADAPTER_CONTRACT_ERROR_CODE_INVALID", "adapter errorCode is invalid", 400);
      }
      run = findRun(next, runId);
      const attemptNumber = run.attempts.length + 1;
      run.attempts.push({
        attemptDigest: sha256({ id, nonceDigest, outcome, receiptDigest: receipt?.receiptDigest || null }),
        nonceDigest, outcome, errorCode, receiptDigest: receipt?.receiptDigest || null, attemptedAt: current,
        rawMessageStored: false, credentialsStored: false, endpointStored: false, signatureStored: false
      });
      run.receipt = receipt;
      run.nextRetryAt = null;
      if (receipt) run.status = receipt.matched ? "passed" : "reconciliation-required";
      else if (outcome === "permanent-failure" || attemptNumber >= active.transportPolicy.maxAttempts) run.status = "dead-letter";
      else {
        const delay = Math.min(active.transportPolicy.maximumDelaySeconds,
          active.transportPolicy.baseDelaySeconds * (2 ** (attemptNumber - 1)));
        run.status = "retry-wait";
        run.nextRetryAt = new Date(Date.parse(current) + delay * 1000).toISOString();
      }
      run.version += 1;
      run.updatedAt = current;
      next.careAdapterContractCommands.push({ commandId: id, fingerprint, runId, recordedAt: current });
      return Object.freeze({ data: next, result: publicRun(run), replayed: false });
    }
  });
}

function buildAdapterContractReadiness(data, options = {}) {
  const active = options.program || program;
  validateProgram(active);
  const state = normalize(data);
  const runs = state.careAdapterContractRuns.map(publicRun);
  const passedSystems = [...new Set(runs.filter((item) => item.status === "passed").map((item) => item.system))];
  const requiredSystems = active.adapterContracts.map((item) => item.system);
  const openFailures = runs.filter((item) => ["retry-wait", "dead-letter", "reconciliation-required"].includes(item.status)).length;
  const allSystemsPassed = requiredSystems.every((item) => passedSystems.includes(item));
  return Object.freeze({
    schema: "institution-adapter-contract-readiness-v1", generatedAt: now(options.now),
    ok: allSystemsPassed && openFailures === 0, localTechnicalReady: allSystemsPassed && openFailures === 0,
    declaredControls: Object.freeze([...active.requiredContractControls]),
    summary: Object.freeze({ runs: runs.length, passedSystems: passedSystems.length, requiredSystems: requiredSystems.length, openFailures }),
    runs: Object.freeze(runs), productionGate: "NO-GO", productionReady: false, externalEvidenceVerified: false,
    blockers: Object.freeze([...active.productionBlockers])
  });
}

module.exports = {
  buildAdapterContractReadiness,
  createInstitutionAdapterSdk,
  createReceiptDigest,
  sha256,
  startAdapterContractRun,
  validateProgram
};
