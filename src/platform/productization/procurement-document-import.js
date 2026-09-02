"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const defaultGovernance = require("../../../config/procurement-requirement-governance.json");
const defaultRegistry = require("../../../config/platform-capability-registry.json");
const { boundedText, validateGovernanceCatalog } = require("./procurement-requirement-contracts");

const ACTIVE_PDF_MARKERS = Object.freeze([
  "/JavaScript", "/JS", "/OpenAction", "/AA", "/Launch", "/EmbeddedFile", "/RichMedia", "/XFA"
]);

function withinRoot(filePath, rootPath) {
  const relative = path.relative(path.resolve(rootPath), path.resolve(filePath));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function inspectPdf(filePath, options = {}) {
  const absolute = path.resolve(String(filePath || ""));
  if (!path.isAbsolute(String(filePath || ""))) throw new TypeError("PDF path must be absolute");
  const allowedRoot = path.resolve(String(options.allowedRoot || ""));
  if (!options.allowedRoot || !withinRoot(absolute, allowedRoot)) throw new Error("PDF path is outside the allowlisted source root");
  if (path.extname(absolute).toLowerCase() !== ".pdf") throw new TypeError("source extension must be .pdf");
  const linkState = fs.lstatSync(absolute);
  if (linkState.isSymbolicLink() || !linkState.isFile()) throw new Error("source must be a regular non-symbolic file");
  const maximum = options.maximumPdfBytes || defaultGovernance.limits.maximumPdfBytes;
  if (linkState.size < 5 || linkState.size > maximum) throw new Error("PDF size is outside the controlled limit");
  const noFollow = fs.constants.O_NOFOLLOW || 0;
  const descriptor = fs.openSync(absolute, fs.constants.O_RDONLY | noFollow);
  try {
    const before = fs.fstatSync(descriptor);
    if (!before.isFile() || before.size !== linkState.size) throw new Error("PDF identity changed before inspection");
    const hash = crypto.createHash("sha256");
    const chunks = [];
    const buffer = Buffer.allocUnsafe(Math.min(1024 * 1024, before.size));
    let offset = 0;
    while (offset < before.size) {
      const read = fs.readSync(descriptor, buffer, 0, Math.min(buffer.length, before.size - offset), offset);
      if (read < 1) throw new Error("PDF ended before the declared file size");
      const chunk = Buffer.from(buffer.subarray(0, read));
      hash.update(chunk);
      chunks.push(chunk);
      offset += read;
    }
    const after = fs.fstatSync(descriptor);
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) throw new Error("PDF changed during inspection");
    const bytes = Buffer.concat(chunks);
    if (bytes.subarray(0, 5).toString("ascii") !== "%PDF-") throw new TypeError("source magic bytes are not PDF");
    const structuralText = bytes.toString("latin1");
    const activeMarkers = ACTIVE_PDF_MARKERS.filter((marker) => structuralText.includes(marker));
    if (activeMarkers.length) {
      const error = new Error("PDF contains active or embedded content and is not eligible for the MVP importer");
      error.code = "PROCUREMENT_PDF_ACTIVE_CONTENT";
      error.markers = activeMarkers;
      throw error;
    }
    if (structuralText.includes("/Encrypt")) {
      const error = new Error("encrypted PDF is not eligible for the MVP importer");
      error.code = "PROCUREMENT_PDF_ENCRYPTED";
      throw error;
    }
    return Object.freeze({
      sha256: `sha256:${hash.digest("hex")}`,
      mediaType: "application/pdf",
      byteSize: before.size,
      securityStatus: "unscanned-external-source",
      hasAcroForm: structuralText.includes("/AcroForm"),
      productionReady: false
    });
  } finally {
    fs.closeSync(descriptor);
  }
}

function buildControlledImportDocument(pdfInspection, extraction, options = {}) {
  if (!extraction || typeof extraction !== "object" || Array.isArray(extraction)) throw new TypeError("extraction manifest must be an object");
  const allowed = new Set(["schemaVersion", "sourceAlias", "reviewedPageCount", "extractionMode", "textQuality", "candidates"]);
  const unknown = Object.keys(extraction).filter((key) => !allowed.has(key));
  if (unknown.length) throw new TypeError(`extraction manifest contains unknown fields: ${unknown.join(", ")}`);
  if (extraction.schemaVersion !== "procurement-pdf-extraction-v1") throw new TypeError("extraction manifest schema is invalid");
  const sourceAlias = boundedText("sourceAlias", extraction.sourceAlias, 4, 80);
  if (/[/\\]|OneDrive|^[A-Za-z]:/i.test(sourceAlias)) throw new TypeError("sourceAlias must be neutral and path-free");
  const document = {
    id: `DOC-${pdfInspection.sha256.slice(7, 19).toUpperCase()}`,
    sourceAlias,
    sha256: pdfInspection.sha256,
    mediaType: pdfInspection.mediaType,
    byteSize: pdfInspection.byteSize,
    reviewedPageCount: extraction.reviewedPageCount,
    extractionMode: extraction.extractionMode,
    textQuality: extraction.textQuality,
    securityStatus: pdfInspection.securityStatus,
    status: "candidate-review",
    candidates: structuredClone(extraction.candidates).map((candidate) => ({ ...candidate, evidenceStatus: "provisional" }))
  };
  const catalog = structuredClone(options.catalog || defaultGovernance);
  catalog.documents = [document];
  validateGovernanceCatalog(catalog, { ...options, registry: options.registry || defaultRegistry });
  return Object.freeze(document);
}

module.exports = { ACTIVE_PDF_MARKERS, buildControlledImportDocument, inspectPdf, withinRoot };
