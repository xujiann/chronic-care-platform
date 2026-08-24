#!/usr/bin/env node
"use strict";

const {
  readBoundedJsonFile
} = require("../src/platform/cutover/pilot-cutover-package");
const {
  evaluatePreproductionEnvironment
} = require("../src/platform/cutover/preproduction-environment-readiness");
const {
  buildRehearsalLedgerPayload,
  evaluatePilotCutoverRehearsalSession
} = require("../src/platform/cutover/pilot-cutover-rehearsal-session");
const {
  buildPilotCutoverCandidateReview
} = require("../src/platform/cutover/pilot-cutover-candidate-review");
const {
  evaluateExternalJointTestCampaign
} = require("../src/platform/integration/external-joint-test-campaign");
const {
  buildPilotCutoverAlertProjection
} = require("../src/platform/cutover/pilot-cutover-alert-lifecycle");
const {
  evaluatePilotCutoverMonitoringAcceptance
} = require("../src/platform/cutover/pilot-cutover-monitoring-acceptance");
const {
  createPilotCutoverTrustVerifier
} = require("../src/platform/cutover/pilot-cutover-trust-verifier");
const {
  assertMetadataOnly,
  SHA256,
  sha256
} = require("../src/platform/governance/technical-evidence");
const {
  readBoundedJsonFile: readProductionTrustFile,
  validateTrustAnchors
} = require("../src/platform/governance/production-evidence-trust-provider");

const MAX_REPORT_BYTES = 1024 * 1024;
const MAX_CANDIDATE_REPORT_AGE_HOURS = 48;
const VALUE_FLAGS = Object.freeze(new Set([
  "input",
  "release-id",
  "package-fingerprint",
  "campaign",
  "trust-registry",
  "evidence",
  "journal",
  "authorization",
  "preproduction",
  "joint-tests",
  "monitoring",
  "rehearsal"
]));
const BOOLEAN_FLAGS = Object.freeze(new Set([
  "require-ready",
  "ledger-payload",
  "require-go-candidate"
]));
const COMMAND_FLAGS = Object.freeze({
  environment: Object.freeze(new Set([
    "input", "release-id", "package-fingerprint", "require-ready"
  ])),
  "joint-test": Object.freeze(new Set([
    "campaign", "trust-registry", "evidence", "release-id",
    "package-fingerprint", "require-ready"
  ])),
  monitoring: Object.freeze(new Set([
    "journal", "input", "release-id", "package-fingerprint", "require-ready"
  ])),
  rehearsal: Object.freeze(new Set([
    "input", "release-id", "package-fingerprint", "require-ready", "ledger-payload"
  ])),
  candidate: Object.freeze(new Set([
    "authorization", "preproduction", "joint-tests", "monitoring", "rehearsal",
    "release-id", "package-fingerprint", "require-go-candidate"
  ]))
});
const CONTROL_ERROR_MESSAGES = Object.freeze({
  PLATFORM_PREPRODUCTION_COMMAND_INVALID: "platform pre-production command is invalid",
  PLATFORM_PREPRODUCTION_ARGUMENT_INVALID: "platform pre-production arguments are invalid",
  PLATFORM_PREPRODUCTION_OPTION_DUPLICATE: "platform pre-production option is duplicated",
  PLATFORM_PREPRODUCTION_OPTION_UNSUPPORTED: "platform pre-production option is not supported for this command",
  PLATFORM_PREPRODUCTION_OPTION_VALUE_INVALID: "platform pre-production option value is invalid",
  PLATFORM_PREPRODUCTION_OPTION_REQUIRED: "platform pre-production required option is missing",
  PLATFORM_PREPRODUCTION_INPUT_BOUNDARY_INVALID: "platform pre-production input file boundary is invalid",
  PLATFORM_PREPRODUCTION_INPUT_JSON_INVALID: "platform pre-production input is not valid JSON",
  PLATFORM_PREPRODUCTION_SENSITIVE_INPUT_REJECTED: "platform pre-production input contains forbidden sensitive metadata",
  PLATFORM_PREPRODUCTION_EVIDENCE_INVALID: "platform pre-production evidence is invalid",
  PLATFORM_PREPRODUCTION_CONTROL_FAILED: "platform pre-production control failed"
});

function controlError(code) {
  return Object.assign(new Error(CONTROL_ERROR_MESSAGES[code]), { code });
}

function parseArgs(argv = process.argv.slice(2)) {
  const [command = "", ...rest] = argv;
  const allowed = COMMAND_FLAGS[command];
  if (!allowed) throw controlError("PLATFORM_PREPRODUCTION_COMMAND_INVALID");
  const options = {};
  for (const item of rest) {
    if (typeof item !== "string" || !item.startsWith("--")) {
      throw controlError("PLATFORM_PREPRODUCTION_ARGUMENT_INVALID");
    }
    const match = /^--([a-z][a-z0-9-]*)(?:=(.*))?$/.exec(item);
    if (!match) throw controlError("PLATFORM_PREPRODUCTION_ARGUMENT_INVALID");
    const [, name, suppliedValue] = match;
    if (!allowed.has(name)) throw controlError("PLATFORM_PREPRODUCTION_OPTION_UNSUPPORTED");
    if (Object.hasOwn(options, name)) throw controlError("PLATFORM_PREPRODUCTION_OPTION_DUPLICATE");
    if (BOOLEAN_FLAGS.has(name)) {
      if (suppliedValue !== undefined) {
        throw controlError("PLATFORM_PREPRODUCTION_OPTION_VALUE_INVALID");
      }
      options[name] = true;
      continue;
    }
    if (!VALUE_FLAGS.has(name) || suppliedValue === undefined || !suppliedValue.trim()) {
      throw controlError("PLATFORM_PREPRODUCTION_OPTION_VALUE_INVALID");
    }
    options[name] = suppliedValue;
  }
  return { command, options };
}

function requireOption(options, name) {
  const value = String(options[name] || "").trim();
  if (!value) {
    throw Object.assign(new Error(`--${name} is required`), {
      code: "PLATFORM_PREPRODUCTION_OPTION_REQUIRED"
    });
  }
  return value;
}

function readReport(options, name, runtime = {}, maximumBytes = MAX_REPORT_BYTES) {
  return readBoundedJsonFile(requireOption(options, name), {
    label: "platform pre-production input",
    maximumBytes,
    fileSystem: runtime.fileSystem
  });
}

function requiredBindings(options) {
  return Object.freeze({
    releaseId: requireOption(options, "release-id"),
    packageFingerprint: requireOption(options, "package-fingerprint")
  });
}

function allChecksPassed(value, required = []) {
  return value && typeof value === "object" && !Array.isArray(value)
    && required.every((name) => value[name] === true);
}

function reportBound(report, bindings) {
  return report?.releaseId === bindings.releaseId
    && report?.packageFingerprint === bindings.packageFingerprint;
}

function candidateReportsReady(reports, bindings) {
  const authorization = reports.authorization;
  const ledger = authorization?.ledger;
  const approvals = ledger?.authorization?.approvals;
  const preproduction = reports.preproduction;
  const jointTests = reports.jointTests;
  const monitoring = reports.monitoring;
  const rehearsal = reports.rehearsal;
  const fingerprint = /^sha256:[a-f0-9]{64}$/;
  return authorization?.schema === "pilot-cutover-authorization-control-v1"
    && authorization.decision === "GO-CANDIDATE"
    && authorization.evidenceFingerprint === bindings.packageFingerprint
    && authorization.releaseId === bindings.releaseId
    && authorization.cutoverExecutionAuthorized === false
    && authorization.productionPrimary === false
    && authorization.productionReady === false
    && allChecksPassed(authorization.checks, [
      "authorizationLedger", "externalEvidenceRegistry",
      "trustedIdentitySignatures", "preProductionRehearsal"
    ])
    && ledger?.schema === "pilot-cutover-authorization-ledger-projection-v1"
    && reportBound(ledger, bindings)
    && ledger.chainValid === true
    && ledger.evidenceReady === true
    && ledger.approvalsReady === true
    && ledger.trustReady === true
    && ledger.rehearsalReady === true
    && ledger.productionReady === false
    && allChecksPassed(ledger.approvalChecks, [
      "roles", "independentAccounts", "currentWindow", "rollbackOwner", "trusted"
    ])
    && allChecksPassed(ledger.trustChecks, [
      "verifierConfigured", "allSelectedEventsTrusted", "noncesUnique"
    ])
    && Object.keys(ledger.evidenceChecks || {}).length === 4
    && Object.values(ledger.evidenceChecks || {}).every((value) => value === true)
    && Array.isArray(ledger.trust)
    && ledger.trust.length >= 9
    && ledger.trust.every((row) => row?.result?.trusted === true)
    && Array.isArray(approvals)
    && approvals.length === 4
    && new Set(approvals.map((row) => row?.role)).size === 4
    && new Set(approvals.map((row) => row?.account)).size === 4
    && approvals.every((row) => row?.status === "approved")
    && preproduction?.schema === "preproduction-environment-readiness-v1"
    && reportBound(preproduction, bindings)
    && preproduction.ready === true
    && preproduction.decision === "LOCAL-READY"
    && preproduction.productionReady === false
    && fingerprint.test(String(preproduction.technicalEvidenceFingerprint || ""))
    && allChecksPassed(preproduction.checks, [
      "packageBound", "components", "recovery", "independentVerification"
    ])
    && jointTests?.schema === "external-joint-test-campaign-evaluation-v1"
    && reportBound(jointTests, bindings)
    && jointTests.externalEvidenceVerified === true
    && jointTests.evidenceInferred === false
    && jointTests.decision === "JOINT-TEST-PASSED"
    && jointTests.productionReady === false
    && fingerprint.test(String(jointTests.technicalEvidenceFingerprint || ""))
    && jointTests.summary?.required === 96
    && jointTests.summary?.supplied === 96
    && jointTests.summary?.verified === 96
    && jointTests.summary?.unexpected === 0
    && Array.isArray(jointTests.interfaces)
    && jointTests.interfaces.length === 12
    && jointTests.interfaces.every((item) => item?.verified === true
      && Array.isArray(item.scenarios)
      && item.scenarios.length === 8
      && item.scenarios.every((scenario) => scenario?.verified === true))
    && monitoring?.schema === "pilot-cutover-monitoring-acceptance-report-v1"
    && reportBound(monitoring, bindings)
    && monitoring.ready === true
    && monitoring.deliveryReady === true
    && monitoring.monitoringAcceptanceProven === true
    && monitoring.decision === "MONITORING-ACCEPTED"
    && monitoring.cutoverExecutionAuthorized === false
    && monitoring.productionReady === false
    && fingerprint.test(String(monitoring.technicalEvidenceFingerprint || ""))
    && allChecksPassed(monitoring.checks, [
      "schema", "acceptedStatus", "releaseBinding", "independentReview",
      "observedWindow", "acceptanceEvidence", "requiredChecks", "journalChain",
      "lifecycleClosed"
    ])
    && Object.keys(monitoring.evidenceChecks || {}).length === 6
    && Object.values(monitoring.evidenceChecks || {}).every((value) => value === true)
    && rehearsal?.schema === "pilot-cutover-rehearsal-session-report-v1"
    && reportBound(rehearsal, bindings)
    && rehearsal.ready === true
    && rehearsal.decision === "REHEARSAL-PASSED"
    && rehearsal.cutoverExecutionAuthorized === false
    && rehearsal.productionReady === false
    && fingerprint.test(String(rehearsal.technicalEvidenceFingerprint || ""))
    && allChecksPassed(rehearsal.checks, [
      "packageBound", "sessionWindow", "dutySeats", "checkpoints",
      "rollbackCommand", "observations"
    ])
    && Array.isArray(rehearsal.seats)
    && rehearsal.seats.length === 7
    && Array.isArray(rehearsal.checkpoints)
    && rehearsal.checkpoints.length === 6;
}

const CANDIDATE_REPORT_SCOPES = Object.freeze({
  authorization: "preproduction-authorization-report",
  preproduction: "preproduction-environment-report",
  jointTests: "preproduction-joint-test-report",
  monitoring: "preproduction-monitoring-report",
  rehearsal: "preproduction-rehearsal-report"
});

function candidateReportsValid(reports, bindings) {
  const authorization = reports.authorization;
  const ledger = authorization?.ledger;
  const preproduction = reports.preproduction;
  const jointTests = reports.jointTests;
  const monitoring = reports.monitoring;
  const rehearsal = reports.rehearsal;
  return authorization?.schema === "pilot-cutover-authorization-control-v1"
    && authorization.releaseId === bindings.releaseId
    && authorization.evidenceFingerprint === bindings.packageFingerprint
    && ["GO-CANDIDATE", "NO-GO"].includes(authorization.decision)
    && authorization.cutoverExecutionAuthorized === false
    && authorization.productionPrimary === false
    && authorization.productionReady === false
    && ledger?.schema === "pilot-cutover-authorization-ledger-projection-v1"
    && reportBound(ledger, bindings)
    && ledger.productionReady === false
    && preproduction?.schema === "preproduction-environment-readiness-v1"
    && reportBound(preproduction, bindings)
    && preproduction.ready === (preproduction.decision === "LOCAL-READY")
    && ["LOCAL-READY", "NO-GO"].includes(preproduction.decision)
    && preproduction.productionReady === false
    && jointTests?.schema === "external-joint-test-campaign-evaluation-v1"
    && reportBound(jointTests, bindings)
    && jointTests.externalEvidenceVerified === (jointTests.decision === "JOINT-TEST-PASSED")
    && ["JOINT-TEST-PASSED", "NO-GO"].includes(jointTests.decision)
    && jointTests.evidenceInferred === false
    && jointTests.productionReady === false
    && monitoring?.schema === "pilot-cutover-monitoring-acceptance-report-v1"
    && reportBound(monitoring, bindings)
    && monitoring.ready === (monitoring.decision === "MONITORING-ACCEPTED")
    && ["MONITORING-ACCEPTED", "NO-GO"].includes(monitoring.decision)
    && monitoring.cutoverExecutionAuthorized === false
    && monitoring.productionReady === false
    && rehearsal?.schema === "pilot-cutover-rehearsal-session-report-v1"
    && reportBound(rehearsal, bindings)
    && rehearsal.ready === (rehearsal.decision === "REHEARSAL-PASSED")
    && ["REHEARSAL-PASSED", "NO-GO"].includes(rehearsal.decision)
    && rehearsal.cutoverExecutionAuthorized === false
    && rehearsal.productionReady === false;
}

function loadCandidateTrustRegistry(runtime = {}, now) {
  const env = runtime.env || process.env;
  const expectedDigest = String(env.PRODUCTION_EVIDENCE_TRUST_ANCHORS_SHA256 || "")
    .trim().toLowerCase();
  if (!SHA256.test(expectedDigest)) {
    throw controlError("PLATFORM_PREPRODUCTION_EVIDENCE_INVALID");
  }
  const anchorsFile = readProductionTrustFile(
    env.PRODUCTION_EVIDENCE_TRUST_ANCHORS_FILE
  );
  if (anchorsFile.digest !== expectedDigest) {
    throw controlError("PLATFORM_PREPRODUCTION_EVIDENCE_INVALID");
  }
  const anchors = validateTrustAnchors(anchorsFile.document);
  const sourceById = new Map(anchorsFile.document.keys.map((row) => [row.keyId, row]));
  const current = anchors.filter((row) => row.status === "active"
    && now >= row.validFrom && now < row.validUntil);
  return Object.freeze({
    registry: Object.freeze({
      schemaVersion: "pilot-cutover-trust-registry-v1",
      generatedAt: anchorsFile.document.generatedAt,
      keys: Object.freeze(current.map((row) => Object.freeze({
        keyId: row.keyId,
        account: row.signerId,
        algorithm: "Ed25519",
        status: "active",
        scopes: row.roles,
        validFrom: new Date(row.validFrom).toISOString(),
        validUntil: new Date(row.validUntil).toISOString(),
        publicKeyPem: sourceById.get(row.keyId).publicKeyPem
      })))
    }),
    publicKeyDigests: new Map(current.map((row) => [row.keyId, row.publicKeyDigest]))
  });
}

function readSignedCandidateReports(options, bindings, runtime = {}) {
  const now = Date.parse(runtime.now || new Date().toISOString());
  if (!Number.isFinite(now)) throw controlError("PLATFORM_PREPRODUCTION_EVIDENCE_INVALID");
  const trust = loadCandidateTrustRegistry(runtime, now);
  const registry = trust.registry;
  const verifier = createPilotCutoverTrustVerifier({ registry });
  const files = {
    authorization: "authorization",
    preproduction: "preproduction",
    jointTests: "joint-tests",
    monitoring: "monitoring",
    rehearsal: "rehearsal"
  };
  const reports = {};
  const keyIds = [];
  const accounts = [];
  const publicKeyDigests = [];
  const signedSubjectDigests = [];
  const maximumAgeMs = MAX_CANDIDATE_REPORT_AGE_HOURS * 60 * 60 * 1000;
  for (const [name, option] of Object.entries(files)) {
    const event = readReport(options, option, runtime);
    const result = verifier.verifyEvent(event, new Date(now).toISOString());
    const payload = event?.payload;
    const issuedAt = Date.parse(payload?.issuedAt || "");
    const expiresAt = Date.parse(payload?.expiresAt || "");
    const report = payload?.report;
    if (report && typeof report === "object" && !Array.isArray(report)) {
      assertMetadataOnly(report, `platformPreproductionCandidate.${name}`);
    }
    const valid = event?.type === "evidence-registered"
      && payload?.gateId === CANDIDATE_REPORT_SCOPES[name]
      && payload?.releaseId === bindings.releaseId
      && payload?.packageFingerprint === bindings.packageFingerprint
      && payload?.verifierAccount === event?.actorAccount
      && Number.isFinite(issuedAt)
      && Number.isFinite(expiresAt)
      && issuedAt <= now
      && expiresAt > now
      && now - issuedAt <= maximumAgeMs
      && expiresAt - issuedAt <= maximumAgeMs
      && report && typeof report === "object" && !Array.isArray(report)
      && payload?.evidenceDigest === sha256(report)
      && result.trusted === true;
    if (!valid) throw controlError("PLATFORM_PREPRODUCTION_EVIDENCE_INVALID");
    reports[name] = report;
    keyIds.push(result.keyId);
    accounts.push(result.account);
    publicKeyDigests.push(trust.publicKeyDigests.get(result.keyId));
    signedSubjectDigests.push(result.subjectDigest);
  }
  if (new Set(keyIds).size !== keyIds.length
    || new Set(accounts).size !== accounts.length
    || new Set(publicKeyDigests).size !== publicKeyDigests.length
    || new Set(signedSubjectDigests).size !== signedSubjectDigests.length) {
    throw controlError("PLATFORM_PREPRODUCTION_EVIDENCE_INVALID");
  }
  return Object.freeze(reports);
}

function nonAuthorizingReport(report) {
  return Object.freeze({
    ...report,
    cutoverExecutionAuthorized: false,
    executionAuthorized: false,
    runtimeCutoverEnabled: false,
    productionPrimary: false,
    productionReady: false
  });
}

function serializeControlError(error) {
  const sourceCode = String(error?.code || "");
  let code = "PLATFORM_PREPRODUCTION_CONTROL_FAILED";
  if (Object.hasOwn(CONTROL_ERROR_MESSAGES, sourceCode)) {
    code = sourceCode;
  } else if ([
    "PILOT_CUTOVER_PATH_INVALID",
    "PILOT_CUTOVER_FILE_UNAVAILABLE",
    "PILOT_CUTOVER_FILE_BOUNDARY_INVALID",
    "PILOT_CUTOVER_ALERT_JOURNAL_UNAVAILABLE",
    "PILOT_CUTOVER_ALERT_JOURNAL_BOUNDARY_INVALID"
  ].includes(sourceCode)) {
    code = "PLATFORM_PREPRODUCTION_INPUT_BOUNDARY_INVALID";
  } else if ([
    "PILOT_CUTOVER_JSON_INVALID",
    "PILOT_CUTOVER_ALERT_JOURNAL_JSON_INVALID"
  ].includes(sourceCode)) {
    code = "PLATFORM_PREPRODUCTION_INPUT_JSON_INVALID";
  } else if (sourceCode.startsWith("TECHNICAL_EVIDENCE_SENSITIVE")) {
    code = "PLATFORM_PREPRODUCTION_SENSITIVE_INPUT_REJECTED";
  } else if (sourceCode) {
    code = "PLATFORM_PREPRODUCTION_EVIDENCE_INVALID";
  }
  return Object.freeze({
    ok: false,
    code,
    message: CONTROL_ERROR_MESSAGES[code],
    cutoverExecutionAuthorized: false,
    executionAuthorized: false,
    runtimeCutoverEnabled: false,
    productionPrimary: false,
    productionReady: false
  });
}

function run(parsed = parseArgs(), runtime = {}) {
  const now = runtime.now;
  if (parsed.command === "environment") {
    const bindings = requiredBindings(parsed.options);
    const report = evaluatePreproductionEnvironment(
      readReport(parsed.options, "input", runtime), {
      releaseId: bindings.releaseId,
      packageFingerprint: bindings.packageFingerprint,
      now
    });
    return {
      report: nonAuthorizingReport(report),
      exitCode: parsed.options["require-ready"] === true && !report.ready ? 2 : 0
    };
  }
  if (parsed.command === "rehearsal") {
    const bindings = requiredBindings(parsed.options);
    const input = readReport(parsed.options, "input", runtime, 512 * 1024);
    const report = evaluatePilotCutoverRehearsalSession(input, {
      releaseId: bindings.releaseId,
      packageFingerprint: bindings.packageFingerprint,
      now
    });
    return {
      report: nonAuthorizingReport(parsed.options["ledger-payload"] === true
        ? buildRehearsalLedgerPayload(input, report)
        : report),
      exitCode: parsed.options["require-ready"] === true && !report.ready ? 2 : 0
    };
  }
  if (parsed.command === "joint-test") {
    const bindings = requiredBindings(parsed.options);
    const report = evaluateExternalJointTestCampaign({
      campaign: readReport(parsed.options, "campaign", runtime),
      trustRegistry: readReport(parsed.options, "trust-registry", runtime),
      evidenceBundle: readReport(parsed.options, "evidence", runtime),
      releaseId: bindings.releaseId,
      packageFingerprint: bindings.packageFingerprint,
      now
    });
    return {
      report: nonAuthorizingReport(report),
      exitCode: parsed.options["require-ready"] === true
        && !report.externalEvidenceVerified
        ? 2
        : 0
    };
  }
  if (parsed.command === "monitoring") {
    const bindings = requiredBindings(parsed.options);
    const journal = buildPilotCutoverAlertProjection({
      file: requireOption(parsed.options, "journal"),
      now,
      fileSystem: runtime.fileSystem
    });
    const report = evaluatePilotCutoverMonitoringAcceptance(
      readReport(parsed.options, "input", runtime, 512 * 1024), {
      journal,
      releaseId: bindings.releaseId,
      packageFingerprint: bindings.packageFingerprint,
      now
    });
    return {
      report: nonAuthorizingReport(report),
      exitCode: parsed.options["require-ready"] === true && !report.ready ? 2 : 0
    };
  }
  if (parsed.command === "candidate") {
    const bindings = requiredBindings(parsed.options);
    const reports = readSignedCandidateReports(parsed.options, bindings, runtime);
    if (!candidateReportsValid(reports, bindings)) {
      throw controlError("PLATFORM_PREPRODUCTION_EVIDENCE_INVALID");
    }
    let report = buildPilotCutoverCandidateReview(reports, { now });
    if (report.decision === "GO-CANDIDATE" && !candidateReportsReady(reports, bindings)) {
      throw controlError("PLATFORM_PREPRODUCTION_EVIDENCE_INVALID");
    }
    if (report.decision === "GO-CANDIDATE") {
      report = Object.freeze({
        ...report,
        ready: false,
        decision: "NO-GO",
        blockers: Object.freeze([
          ...report.blockers,
          "trusted report roots require an external deployment host integration"
        ])
      });
    }
    return {
      report: nonAuthorizingReport(report),
      exitCode: report.decision === "GO-CANDIDATE" ? 0 : 2
    };
  }
  throw Object.assign(new Error(
    "command must be environment, joint-test, monitoring, rehearsal or candidate"
  ), {
    code: "PLATFORM_PREPRODUCTION_COMMAND_INVALID"
  });
}

if (require.main === module) {
  try {
    const result = run();
    process.stdout.write(`${JSON.stringify(result.report, null, 2)}\n`);
    process.exitCode = result.exitCode;
  } catch (error) {
    process.stderr.write(`${JSON.stringify(serializeControlError(error))}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  COMMAND_FLAGS,
  CONTROL_ERROR_MESSAGES,
  MAX_CANDIDATE_REPORT_AGE_HOURS,
  MAX_REPORT_BYTES,
  candidateReportsValid,
  candidateReportsReady,
  parseArgs,
  run,
  serializeControlError
};
