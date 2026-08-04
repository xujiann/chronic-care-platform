"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const {
  EVIDENCE_DIGEST_IDS,
  createPilotCutoverEvidenceBindings,
  createPilotCutoverEvidenceFingerprint,
  evaluatePilotCutover
} = require("./pilot-cutover-orchestrator");
const {
  SHA256,
  assertMetadataOnly,
  sha256,
  stableStringify
} = require("../governance/technical-evidence");

const MAX_SOURCE_BYTES = 1024 * 1024;
const MAX_PACKAGE_BYTES = 4 * 1024 * 1024;
const REPORT_IDS = Object.freeze([
  "adapterRuntime",
  "reconciliation",
  "jointTests",
  "businessLoop",
  "operations",
  "externalReleaseEvidence"
]);

function packageError(code, message, statusCode = 400) {
  return Object.assign(new Error(message), { code, statusCode });
}

function resolveAbsoluteFile(value, label) {
  const file = String(value || "").trim();
  if (!file || !path.isAbsolute(file)) {
    throw packageError(
      "PILOT_CUTOVER_PATH_INVALID",
      `${label} must use an absolute path`
    );
  }
  return path.resolve(file);
}

function readBoundedJsonFile(file, options = {}) {
  const label = options.label || "pilot cutover file";
  const resolved = resolveAbsoluteFile(file, label);
  let stat;
  try {
    stat = fs.lstatSync(resolved);
  } catch {
    throw packageError("PILOT_CUTOVER_FILE_UNAVAILABLE", `${label} is unavailable`);
  }
  const maximumBytes = Number(options.maximumBytes) || MAX_SOURCE_BYTES;
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size <= 0 || stat.size > maximumBytes) {
    throw packageError(
      "PILOT_CUTOVER_FILE_BOUNDARY_INVALID",
      `${label} must be a non-empty regular file within the size limit`
    );
  }
  try {
    return JSON.parse(fs.readFileSync(resolved, "utf8"));
  } catch {
    throw packageError("PILOT_CUTOVER_JSON_INVALID", `${label} is not valid JSON`);
  }
}

function assertEvidenceBindings(input = {}) {
  const bindings = createPilotCutoverEvidenceBindings(input);
  const claimed = {
    adapterRuntime: input.reports?.adapterRuntime?.technicalEvidenceFingerprint,
    reconciliation: input.reports?.reconciliation?.technicalEvidenceFingerprint,
    jointTests: input.reports?.jointTests?.technicalEvidenceFingerprint,
    businessLoop: input.reports?.businessLoop?.technicalEvidenceFingerprint,
    operations: input.reports?.operations?.technicalEvidenceFingerprint,
    externalReleaseEvidence: input.reports?.externalReleaseEvidence?.evidenceFingerprint
  };
  for (const id of REPORT_IDS) {
    if (!SHA256.test(String(claimed[id] || "")) || claimed[id] !== bindings[id]) {
      throw packageError(
        "PILOT_CUTOVER_REPORT_FINGERPRINT_INVALID",
        `${id} report fingerprint does not match its current technical projection`
      );
    }
  }
  for (const id of EVIDENCE_DIGEST_IDS) {
    if (input.evidenceDigests
      && Object.hasOwn(input.evidenceDigests, id)
      && input.evidenceDigests?.[id] !== bindings[id]) {
      throw packageError(
        "PILOT_CUTOVER_EVIDENCE_DIGEST_INVALID",
        `${id} evidence digest does not match the bound evidence`
      );
    }
  }
  return bindings;
}

function loadPilotCutoverManifest(file) {
  const manifest = readBoundedJsonFile(file, { label: "pilot cutover manifest" });
  if (manifest?.schemaVersion !== "pilot-cutover-package-manifest-v1"
    || !manifest.release || typeof manifest.release !== "object"
    || !manifest.reportFiles || typeof manifest.reportFiles !== "object"
    || REPORT_IDS.some((id) => !manifest.reportFiles[id])
    || !manifest.rollbackFile || !manifest.disasterRecoveryFile) {
    throw packageError(
      "PILOT_CUTOVER_MANIFEST_INVALID",
      "pilot cutover manifest is incomplete or uses an unsupported schema"
    );
  }
  assertMetadataOnly(manifest, "cutoverManifest");
  return Object.freeze(structuredClone(manifest));
}

function buildPilotCutoverPackage(manifest = {}) {
  if (manifest?.schemaVersion !== "pilot-cutover-package-manifest-v1") {
    throw packageError("PILOT_CUTOVER_MANIFEST_INVALID", "pilot cutover manifest schema is invalid");
  }
  assertMetadataOnly(manifest, "cutoverManifest");
  const reports = Object.fromEntries(REPORT_IDS.map((id) => [
    id,
    readBoundedJsonFile(manifest.reportFiles?.[id], { label: `${id} report` })
  ]));
  const input = {
    schemaVersion: "pilot-cutover-input-v1",
    status: "pending-committee-authorization",
    release: structuredClone(manifest.release || {}),
    evidenceDigests: {},
    reports,
    rollback: readBoundedJsonFile(manifest.rollbackFile, { label: "rollback evidence" }),
    disasterRecovery: readBoundedJsonFile(
      manifest.disasterRecoveryFile,
      { label: "disaster recovery evidence" }
    ),
    authorization: {
      decision: "NO-GO",
      confirmation: "",
      evidenceFingerprint: "",
      approvedAt: "",
      expiresAt: "",
      rollbackOwner: "",
      approvals: []
    },
    productionReady: false,
    boundary: "This package binds technical evidence only. It contains no production authorization and cannot execute cutover."
  };
  const bindings = assertEvidenceBindings(input);
  input.evidenceDigests = Object.freeze(Object.fromEntries(
    EVIDENCE_DIGEST_IDS.map((id) => [id, bindings[id]])
  ));
  input.candidateEvidenceFingerprint = createPilotCutoverEvidenceFingerprint(input);
  assertMetadataOnly(input, "cutoverPackage");
  return Object.freeze(structuredClone(input));
}

function serializePilotCutoverPackage(input) {
  return `${stableStringify(input)}\n`;
}

function writePilotCutoverPackage(file, input) {
  const resolved = resolveAbsoluteFile(file, "pilot cutover output");
  const directory = path.dirname(resolved);
  let directoryStat;
  try {
    directoryStat = fs.lstatSync(directory);
  } catch {
    throw packageError("PILOT_CUTOVER_OUTPUT_DIRECTORY_INVALID", "output directory is unavailable");
  }
  if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
    throw packageError(
      "PILOT_CUTOVER_OUTPUT_DIRECTORY_INVALID",
      "output directory must be a real directory"
    );
  }
  if (fs.existsSync(resolved)) {
    throw packageError(
      "PILOT_CUTOVER_OUTPUT_EXISTS",
      "pilot cutover packages are immutable; choose a new output path"
    );
  }
  const serialized = serializePilotCutoverPackage(input);
  const bytes = Buffer.byteLength(serialized);
  if (bytes <= 0 || bytes > MAX_PACKAGE_BYTES) {
    throw packageError("PILOT_CUTOVER_PACKAGE_SIZE_INVALID", "pilot cutover package exceeds the size limit");
  }
  const temporary = path.join(
    directory,
    `.${path.basename(resolved)}.${process.pid}.${randomUUID()}.tmp`
  );
  let descriptor = null;
  try {
    descriptor = fs.openSync(temporary, "wx", 0o600);
    fs.writeFileSync(descriptor, serialized, "utf8");
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    fs.renameSync(temporary, resolved);
  } catch (error) {
    if (descriptor !== null) fs.closeSync(descriptor);
    try {
      if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
    } catch {}
    throw packageError(
      "PILOT_CUTOVER_PACKAGE_WRITE_FAILED",
      "pilot cutover package could not be written atomically",
      500
    );
  }
  return Object.freeze({
    file: resolved,
    bytes,
    packageDigest: sha256(serialized)
  });
}

function readPilotCutoverInput(file) {
  const input = readBoundedJsonFile(file, {
    label: "pilot cutover input",
    maximumBytes: MAX_PACKAGE_BYTES
  });
  if (input?.schemaVersion !== "pilot-cutover-input-v1"
    || !input.release || !input.reports || !input.rollback
    || !input.disasterRecovery || !input.authorization
    || EVIDENCE_DIGEST_IDS.some((id) =>
      !SHA256.test(String(input.evidenceDigests?.[id] || "")))
    || !SHA256.test(String(input.candidateEvidenceFingerprint || ""))) {
    throw packageError(
      "PILOT_CUTOVER_INPUT_INVALID",
      "pilot cutover input is incomplete or uses an unsupported schema"
    );
  }
  assertMetadataOnly(input, "cutoverPackage");
  assertEvidenceBindings(input);
  const expected = createPilotCutoverEvidenceFingerprint(input);
  if (input.candidateEvidenceFingerprint !== expected) {
    throw packageError(
      "PILOT_CUTOVER_CANDIDATE_FINGERPRINT_INVALID",
      "pilot cutover candidate fingerprint does not match the current package"
    );
  }
  return Object.freeze(structuredClone(input));
}

function evaluatePilotCutoverFile(options = {}) {
  const input = options.input || readPilotCutoverInput(
    options.file || options.env?.PLATFORM_PILOT_CUTOVER_INPUT_FILE
      || process.env.PLATFORM_PILOT_CUTOVER_INPUT_FILE
  );
  return evaluatePilotCutover(input, options.now || new Date().toISOString());
}

module.exports = {
  MAX_PACKAGE_BYTES,
  MAX_SOURCE_BYTES,
  REPORT_IDS,
  assertEvidenceBindings,
  buildPilotCutoverPackage,
  evaluatePilotCutoverFile,
  loadPilotCutoverManifest,
  readBoundedJsonFile,
  readPilotCutoverInput,
  resolveAbsoluteFile,
  serializePilotCutoverPackage,
  writePilotCutoverPackage
};
