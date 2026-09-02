"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { buildControlledImportDocument, inspectPdf } = require("../src/platform/productization/procurement-document-import");

function flags(argv) {
  return Object.fromEntries(argv.map((entry) => {
    const match = entry.match(/^--([^=]+)=(.*)$/s);
    if (!match) throw new TypeError(`unsupported argument: ${entry}`);
    return [match[1], match[2]];
  }));
}

function safeJsonFile(filePath, label) {
  const absolute = path.resolve(String(filePath || ""));
  if (!path.isAbsolute(String(filePath || ""))) throw new TypeError(`${label} path must be absolute`);
  const state = fs.lstatSync(absolute);
  if (!state.isFile() || state.isSymbolicLink() || state.size < 2 || state.size > 2 * 1024 * 1024) throw new Error(`${label} must be a bounded regular file`);
  return JSON.parse(fs.readFileSync(absolute, "utf8"));
}

function writeResult(outputPath, value) {
  const rendered = `${JSON.stringify(value, null, 2)}\n`;
  if (!outputPath) {
    process.stdout.write(rendered);
    return;
  }
  const absolute = path.resolve(outputPath);
  if (!path.isAbsolute(outputPath)) throw new TypeError("output path must be absolute");
  if (/(?:^|[\\/])OneDrive(?:[\\/]|$)/i.test(absolute)) throw new Error("output must remain outside OneDrive");
  if (fs.existsSync(absolute)) throw new Error("output already exists; importer never overwrites an artifact");
  const parent = path.dirname(absolute);
  if (!fs.statSync(parent).isDirectory()) throw new Error("output parent must already exist");
  fs.writeFileSync(absolute, rendered, { encoding: "utf8", flag: "wx" });
}

function main(argv = process.argv.slice(2)) {
  const options = flags(argv);
  if (!options.pdf || !options["allowed-root"] || !options.extraction) {
    throw new TypeError("usage: --pdf=<absolute.pdf> --allowed-root=<absolute-directory> --extraction=<absolute.json> [--output=<absolute.json>]");
  }
  const inspection = inspectPdf(options.pdf, { allowedRoot: options["allowed-root"] });
  const extraction = safeJsonFile(options.extraction, "extraction");
  const document = buildControlledImportDocument(inspection, extraction);
  writeResult(options.output, {
    schemaVersion: "procurement-controlled-import-v1",
    generatedAt: new Date().toISOString(),
    document,
    boundary: "untrusted PDF remains external; no path, filename, raw text, model action, state write or production authorization is included"
  });
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.code || "PROCUREMENT_IMPORT_FAILED"}: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { flags, main, safeJsonFile, writeResult };
