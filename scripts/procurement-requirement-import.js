"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const defaultGovernance = require("../config/procurement-requirement-governance.json");
const { assertSafeAbsolutePath, buildControlledImportBatch, inspectPdf, preflightPdfSource } = require("../src/platform/productization/procurement-document-import");

const BATCH_KEYS = new Set(["schemaVersion", "items"]);
const BATCH_ITEM_KEYS = new Set(["pdf", "extraction"]);

function flags(argv) {
  return Object.fromEntries(argv.map((entry) => {
    const match = entry.match(/^--([^=]+)=(.*)$/s);
    if (!match) throw new TypeError(`unsupported argument: ${entry}`);
    return [match[1], match[2]];
  }));
}

function safeJsonFile(filePath, label) {
  const absolute = assertSafeAbsolutePath(filePath, label);
  const state = fs.lstatSync(absolute);
  if (!state.isFile() || state.isSymbolicLink() || state.size < 2 || state.size > 2 * 1024 * 1024) throw new Error(`${label} must be a bounded regular file`);
  const value = JSON.parse(fs.readFileSync(absolute, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must contain a JSON object`);
  return value;
}

function writeResult(outputPath, value) {
  const rendered = `${JSON.stringify(value, null, 2)}\n`;
  if (!outputPath) {
    process.stdout.write(rendered);
    return;
  }
  const absolute = assertSafeAbsolutePath(outputPath, "output");
  if (fs.existsSync(absolute)) throw new Error("output already exists; importer never overwrites an artifact");
  const parent = path.dirname(absolute);
  const parentState = fs.lstatSync(parent);
  if (!parentState.isDirectory() || parentState.isSymbolicLink()) throw new Error("output parent must be a real existing directory");
  const realParent = fs.realpathSync.native(parent);
  assertSafeAbsolutePath(realParent, "resolved output parent");
  if (/(?:^|[\\/])OneDrive(?:[\\/]|$)/i.test(realParent)) throw new Error("output must remain outside OneDrive");
  const finalPath = path.join(realParent, path.basename(absolute));
  const temporaryPath = path.join(realParent, `.${path.basename(absolute)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  let descriptor;
  try {
    descriptor = fs.openSync(temporaryPath, "wx", 0o600);
    fs.writeFileSync(descriptor, rendered, { encoding: "utf8" });
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.linkSync(temporaryPath, finalPath);
    try { fs.unlinkSync(temporaryPath); } catch {}
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    try { fs.unlinkSync(temporaryPath); } catch {}
    throw error;
  }
}

function validateBatchManifest(manifest) {
  const unknown = Object.keys(manifest).filter((key) => !BATCH_KEYS.has(key));
  if (unknown.length || manifest.schemaVersion !== "procurement-pdf-batch-v1") throw new TypeError("batch manifest schema is invalid");
  if (!Array.isArray(manifest.items) || manifest.items.length < 1 || manifest.items.length > defaultGovernance.limits.maximumBatchDocuments) throw new TypeError("batch manifest item count is invalid");
  for (const [index, item] of manifest.items.entries()) {
    if (!item || typeof item !== "object" || Array.isArray(item) || Object.keys(item).length !== BATCH_ITEM_KEYS.size || Object.keys(item).some((key) => !BATCH_ITEM_KEYS.has(key))) throw new TypeError(`batch manifest item ${index} is invalid`);
    assertSafeAbsolutePath(item.pdf, `batch manifest item ${index} PDF`);
    assertSafeAbsolutePath(item.extraction, `batch manifest item ${index} extraction`);
  }
  return manifest.items;
}

function validateBatchAggregates(prepared, limits = defaultGovernance.limits) {
  const aggregates = prepared.reduce((summary, item) => ({
    bytes: summary.bytes + Number(item.source?.byteSize || 0),
    candidates: summary.candidates + (Array.isArray(item.extractionManifest?.candidates) ? item.extractionManifest.candidates.length : 0),
    reviewedPages: summary.reviewedPages + Number(item.extractionManifest?.reviewedPageCount || 0)
  }), { bytes: 0, candidates: 0, reviewedPages: 0 });
  if (aggregates.bytes > limits.maximumBatchBytes || aggregates.candidates > limits.maximumBatchCandidates || aggregates.reviewedPages > limits.maximumBatchReviewedPages) throw new Error("controlled import batch exceeds its aggregate limit before PDF inspection");
  return Object.freeze(aggregates);
}

function main(argv = process.argv.slice(2)) {
  const options = flags(argv);
  if (!options["allowed-root"] || Boolean(options.batch) === Boolean(options.pdf || options.extraction)) {
    throw new TypeError("usage: --allowed-root=<absolute-directory> (--batch=<absolute.json> | --pdf=<absolute.pdf> --extraction=<absolute.json>) [--output=<absolute.json>]");
  }
  if (!options.batch && (!options.pdf || !options.extraction)) throw new TypeError("single import requires both --pdf and --extraction");
  const items = options.batch
    ? validateBatchManifest(safeJsonFile(options.batch, "batch manifest"))
    : [{ pdf: options.pdf, extraction: options.extraction }];
  const prepared = items.map((item) => ({
    ...item,
    extractionManifest: safeJsonFile(item.extraction, "extraction"),
    source: preflightPdfSource(item.pdf, { allowedRoot: options["allowed-root"] })
  }));
  validateBatchAggregates(prepared);
  const sourceIdentities = new Set();
  for (const item of prepared) {
    if (sourceIdentities.has(item.source.pathIdentity)) throw new Error("batch contains a duplicate PDF source");
    sourceIdentities.add(item.source.pathIdentity);
  }
  const digests = new Set();
  let inspectedBytes = 0;
  const entries = prepared.map((item) => {
    const inspection = inspectPdf(item.pdf, { allowedRoot: options["allowed-root"], expectedIdentity: item.source.identity });
    inspectedBytes += inspection.byteSize;
    if (inspectedBytes > defaultGovernance.limits.maximumBatchBytes) throw new Error("controlled import batch changed beyond its aggregate byte limit during inspection");
    if (digests.has(inspection.sha256)) throw new Error("batch contains duplicate PDF content");
    digests.add(inspection.sha256);
    return { inspection, extraction: item.extractionManifest };
  });
  const result = buildControlledImportBatch(entries);
  writeResult(options.output, { ...result, generatedAt: new Date().toISOString() });
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.code || "PROCUREMENT_IMPORT_FAILED"}: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { flags, main, safeJsonFile, validateBatchAggregates, validateBatchManifest, writeResult };
