"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const defaultGovernance = require("../../../config/procurement-requirement-governance.json");
const defaultRegistry = require("../../../config/platform-capability-registry.json");
const { validateGovernanceCatalog } = require("./procurement-requirement-contracts");
const { buildProcurementRevisionComparisons } = require("./procurement-requirement-versioning");

const ACTIVE_PDF_MARKERS = Object.freeze([
  "/JavaScript", "/JS", "/OpenAction", "/AA", "/Launch", "/EmbeddedFile", "/RichMedia", "/XFA"
]);
const SCAN_POLICIES = new Set(["unscanned-review", "required-clean"]);
const EXTRACTION_KEYS = new Set(["schemaVersion", "seriesId", "revision", "supersedesDocumentId", "reviewedPageCount", "extractionMode", "textQuality", "candidates"]);
const SCAN_RESULT_KEYS = new Set(["verdict", "artifactDigest", "byteSize", "mediaType", "evidenceDigest", "engineVersion", "signatureVersion", "scannedAt"]);

function normalizedPath(value) {
  return process.platform === "win32" ? value.toLowerCase() : value;
}

function withinRoot(filePath, rootPath) {
  const relative = path.relative(normalizedPath(path.resolve(rootPath)), normalizedPath(path.resolve(filePath)));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function assertSafeAbsolutePath(value, label) {
  const supplied = String(value || "");
  if (!path.isAbsolute(supplied)) throw new TypeError(`${label} path must be absolute`);
  if (/^[\\/]{2}/.test(supplied)) throw new TypeError(`${label} path must not use a device or network namespace`);
  const absolute = path.resolve(supplied);
  const root = path.parse(absolute).root;
  if (process.platform === "win32" && absolute.slice(root.length).includes(":")) throw new TypeError(`${label} path must not use an alternate data stream`);
  return absolute;
}

function resolvePdfSource(filePath, options = {}) {
  const absolute = assertSafeAbsolutePath(filePath, "PDF");
  const allowedRoot = assertSafeAbsolutePath(options.allowedRoot, "allowlisted source root");
  const rootState = fs.lstatSync(allowedRoot);
  if (rootState.isSymbolicLink() || !rootState.isDirectory()) throw new Error("allowlisted source root must be a real directory");
  const realRoot = fs.realpathSync.native(allowedRoot);
  assertSafeAbsolutePath(realRoot, "resolved allowlisted source root");
  const linkState = fs.lstatSync(absolute);
  if (linkState.isSymbolicLink() || !linkState.isFile()) throw new Error("source must be a regular non-symbolic file");
  const realFile = fs.realpathSync.native(absolute);
  assertSafeAbsolutePath(realFile, "resolved PDF");
  if (!withinRoot(absolute, allowedRoot) || !withinRoot(realFile, realRoot)) throw new Error("PDF path is outside the allowlisted source root");
  if (path.extname(realFile).toLowerCase() !== ".pdf") throw new TypeError("source extension must be .pdf");
  const realState = fs.lstatSync(realFile);
  if (realState.isSymbolicLink() || !realState.isFile() || !sameIdentity(linkState, realState)) throw new Error("PDF identity changed before inspection");
  const maximum = options.maximumPdfBytes || defaultGovernance.limits.maximumPdfBytes;
  if (realState.size < 5 || realState.size > maximum) throw new Error("PDF size is outside the controlled limit");
  return Object.freeze({ absolute, realFile, realState });
}

function preflightPdfSource(filePath, options = {}) {
  const resolved = resolvePdfSource(filePath, options);
  const pathIdentity = `sha256:${crypto.createHash("sha256").update(normalizedPath(resolved.realFile)).digest("hex")}`;
  const identity = Object.freeze({
    dev: resolved.realState.dev,
    ino: resolved.realState.ino,
    size: resolved.realState.size,
    mtimeMs: resolved.realState.mtimeMs,
    ctimeMs: resolved.realState.ctimeMs
  });
  return Object.freeze({ pathIdentity, byteSize: resolved.realState.size, identity });
}

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}

function stableInspectionError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function validateScanResult(result, inspection) {
  if (!result || typeof result !== "object" || Array.isArray(result)) throw stableInspectionError("PROCUREMENT_PDF_SCAN_INVALID", "scanner returned an invalid attestation");
  const unknown = Object.keys(result).filter((key) => !SCAN_RESULT_KEYS.has(key));
  if (unknown.length || Object.keys(result).length !== SCAN_RESULT_KEYS.size) throw stableInspectionError("PROCUREMENT_PDF_SCAN_INVALID", "scanner attestation fields are invalid");
  if (result.verdict !== "clean") throw stableInspectionError("PROCUREMENT_PDF_SCAN_NOT_CLEAN", "scanner did not attest the PDF as clean");
  if (result.artifactDigest !== inspection.sha256 || result.byteSize !== inspection.byteSize || result.mediaType !== inspection.mediaType) throw stableInspectionError("PROCUREMENT_PDF_SCAN_INVALID", "scanner attestation does not match the inspected PDF");
  if (!/^sha256:[a-f0-9]{64}$/.test(String(result.evidenceDigest || ""))) throw stableInspectionError("PROCUREMENT_PDF_SCAN_INVALID", "scanner evidence digest is invalid");
  for (const key of ["engineVersion", "signatureVersion"]) {
    const value = String(result[key] || "").trim();
    if (value.length < 1 || value.length > 80 || /[\u0000-\u001f]/.test(value)) throw stableInspectionError("PROCUREMENT_PDF_SCAN_INVALID", "scanner version evidence is invalid");
  }
  if (typeof result.scannedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(result.scannedAt) || Number.isNaN(Date.parse(result.scannedAt))) throw stableInspectionError("PROCUREMENT_PDF_SCAN_INVALID", "scanner timestamp is invalid");
  return result.evidenceDigest;
}

function inspectPdf(filePath, options = {}) {
  const { absolute, realFile, realState } = resolvePdfSource(filePath, options);
  if (options.expectedIdentity && !sameIdentity(realState, options.expectedIdentity)) throw new Error("PDF identity changed after batch preflight");
  const scanPolicy = options.scanPolicy || "unscanned-review";
  if (!SCAN_POLICIES.has(scanPolicy)) throw new TypeError("PDF scan policy is invalid");
  if (scanPolicy === "required-clean" && typeof options.scanPdf !== "function") throw stableInspectionError("PROCUREMENT_PDF_SCAN_REQUIRED", "a clean scanner attestation is required");

  const noFollow = fs.constants.O_NOFOLLOW || 0;
  const descriptor = fs.openSync(realFile, fs.constants.O_RDONLY | noFollow);
  try {
    const before = fs.fstatSync(descriptor);
    if (!before.isFile() || !sameIdentity(before, realState)) throw new Error("PDF identity changed before inspection");
    const hash = crypto.createHash("sha256");
    const buffer = Buffer.allocUnsafe(Math.min(1024 * 1024, before.size));
    let structuralText = "";
    let offset = 0;
    while (offset < before.size) {
      const read = fs.readSync(descriptor, buffer, 0, Math.min(buffer.length, before.size - offset), offset);
      if (read < 1) throw new Error("PDF ended before the declared file size");
      const chunk = buffer.subarray(0, read);
      hash.update(chunk);
      structuralText += chunk.toString("latin1");
      offset += read;
    }
    const after = fs.fstatSync(descriptor);
    const postReadState = fs.lstatSync(realFile);
    const postReadRealFile = fs.realpathSync.native(absolute);
    if (!sameIdentity(after, before) || !sameIdentity(postReadState, before) || normalizedPath(postReadRealFile) !== normalizedPath(realFile)) throw new Error("PDF changed during inspection");
    if (structuralText.slice(0, 5) !== "%PDF-") throw new TypeError("source magic bytes are not PDF");
    const activeMarkers = ACTIVE_PDF_MARKERS.filter((marker) => structuralText.includes(marker));
    if (activeMarkers.length) {
      const error = stableInspectionError("PROCUREMENT_PDF_ACTIVE_CONTENT", "PDF contains active or embedded content and is not eligible for the controlled importer");
      error.markers = activeMarkers;
      throw error;
    }
    if (structuralText.includes("/Encrypt")) throw stableInspectionError("PROCUREMENT_PDF_ENCRYPTED", "encrypted PDF is not eligible for the controlled importer");
    const base = { sha256: `sha256:${hash.digest("hex")}`, mediaType: "application/pdf", byteSize: before.size };
    let securityStatus = "unscanned-external-source";
    let scanEvidenceDigest = null;
    if (typeof options.scanPdf === "function") {
      const attestation = options.scanPdf(Object.freeze({ descriptor, ...base }));
      scanEvidenceDigest = validateScanResult(attestation, base);
      const afterScan = fs.fstatSync(descriptor);
      const postScanState = fs.lstatSync(realFile);
      const postScanRealFile = fs.realpathSync.native(absolute);
      if (!sameIdentity(afterScan, before) || !sameIdentity(postScanState, before) || normalizedPath(postScanRealFile) !== normalizedPath(realFile)) throw new Error("PDF changed during scanner attestation");
      securityStatus = "scanner-attested-clean";
    }
    return Object.freeze({
      ...base,
      securityStatus,
      scanEvidenceDigest,
      hasAcroForm: structuralText.includes("/AcroForm"),
      productionReady: false
    });
  } finally {
    fs.closeSync(descriptor);
  }
}

function buildControlledImportDocument(pdfInspection, extraction, options = {}) {
  if (!pdfInspection || typeof pdfInspection !== "object" || Array.isArray(pdfInspection)) throw new TypeError("PDF inspection must be an object");
  if (!extraction || typeof extraction !== "object" || Array.isArray(extraction)) throw new TypeError("extraction manifest must be an object");
  const unknown = Object.keys(extraction).filter((key) => !EXTRACTION_KEYS.has(key));
  if (unknown.length) throw new TypeError(`extraction manifest contains unknown fields: ${unknown.join(", ")}`);
  if (extraction.schemaVersion !== "procurement-pdf-extraction-v2") throw new TypeError("extraction manifest schema is invalid");
  const seriesId = String(extraction.seriesId || "");
  const document = {
    id: `DOC-${pdfInspection.sha256.slice(7, 19).toUpperCase()}`,
    seriesId,
    sourceAlias: `需求来源 ${seriesId.slice(4)}`,
    revision: extraction.revision,
    supersedesDocumentId: extraction.supersedesDocumentId,
    sha256: pdfInspection.sha256,
    mediaType: pdfInspection.mediaType,
    byteSize: pdfInspection.byteSize,
    reviewedPageCount: extraction.reviewedPageCount,
    extractionMode: extraction.extractionMode,
    textQuality: extraction.textQuality,
    securityStatus: pdfInspection.securityStatus,
    scanEvidenceDigest: pdfInspection.scanEvidenceDigest ?? null,
    status: "candidate-review",
    candidates: structuredClone(extraction.candidates).map((candidate) => ({ ...candidate, evidenceStatus: "provisional" }))
  };
  const catalog = structuredClone(options.catalog || defaultGovernance);
  catalog.documents.push(document);
  validateGovernanceCatalog(catalog, { ...options, registry: options.registry || defaultRegistry });
  return Object.freeze(document);
}

function buildControlledImportBatch(entries, options = {}) {
  const catalog = structuredClone(options.catalog || defaultGovernance);
  const limits = catalog.limits;
  if (!Array.isArray(entries) || entries.length < 1 || entries.length > limits.maximumBatchDocuments) throw new TypeError("controlled import batch size is invalid");
  const documents = [];
  let bytes = 0;
  let candidates = 0;
  let reviewedPages = 0;
  for (const [index, entry] of entries.entries()) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) || Object.keys(entry).some((key) => !["inspection", "extraction"].includes(key))) throw new TypeError(`batch entry ${index} is invalid`);
    bytes += Number(entry.inspection?.byteSize || 0);
    candidates += Array.isArray(entry.extraction?.candidates) ? entry.extraction.candidates.length : 0;
    reviewedPages += Number(entry.extraction?.reviewedPageCount || 0);
    if (bytes > limits.maximumBatchBytes || candidates > limits.maximumBatchCandidates || reviewedPages > limits.maximumBatchReviewedPages) throw new Error("controlled import batch exceeds its aggregate limit");
    const document = buildControlledImportDocument(entry.inspection, entry.extraction, { ...options, catalog });
    documents.push(document);
    catalog.documents.push(document);
  }
  validateGovernanceCatalog(catalog, { ...options, registry: options.registry || defaultRegistry });
  const newIds = new Set(documents.map((document) => document.id));
  const revisionComparisons = buildProcurementRevisionComparisons(catalog).filter((comparison) => newIds.has(comparison.toDocumentId));
  return Object.freeze({
    schemaVersion: "procurement-controlled-import-batch-v2",
    documents: Object.freeze(documents),
    revisionComparisons: Object.freeze(revisionComparisons),
    summary: Object.freeze({ documents: documents.length, byteSize: bytes, candidates, reviewedPages }),
    productionReady: false,
    boundary: "外部 PDF 仅形成离线候选与版本差异；不包含路径、文件名、原文，不自动写入平台或形成生产授权。"
  });
}

module.exports = {
  ACTIVE_PDF_MARKERS,
  SCAN_POLICIES,
  buildControlledImportBatch,
  buildControlledImportDocument,
  inspectPdf,
  preflightPdfSource,
  assertSafeAbsolutePath,
  withinRoot
};
