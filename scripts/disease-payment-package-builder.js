"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const Service = require("../disease-payment-service");

function parseArgs(argv) {
  const [command = "help", ...rest] = argv;
  const options = {};
  rest.forEach((arg) => {
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (match) options[match[1]] = match[2];
    else if (arg.startsWith("--")) options[arg.slice(2)] = true;
  });
  return { command, options };
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const source = String(text || "").replace(/^\uFEFF/, "");
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === '"' && quoted && source[index + 1] === '"') { field += '"'; index += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { row.push(field); field = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && source[index + 1] === "\n") index += 1;
      row.push(field); field = "";
      if (row.some((item) => item !== "")) rows.push(row);
      row = [];
    } else field += char;
  }
  if (field || row.length) { row.push(field); if (row.some((item) => item !== "")) rows.push(row); }
  if (!rows.length) return [];
  const headers = rows[0].map((item) => item.trim());
  return rows.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, String(values[index] || "").trim()])));
}

function list(value) {
  return String(value || "").split(/[|；;]/).map((item) => item.trim()).filter(Boolean);
}

function bool(value) {
  return ["1", "true", "yes", "是", "Y"].includes(String(value || "").trim());
}

function catalogRow(row, mode) {
  const common = { code: row.code, name: row.name, diagnosisPrefixes: list(row.diagnosisPrefixes), adjustment: Number(row.adjustment || 1), primaryCare: bool(row.primaryCare) };
  if (mode === "DRG") return { ...common, mdcCode: row.mdcCode, mdcName: row.mdcName, adrgCode: row.adrgCode, adrgName: row.adrgName, groupType: row.groupType, complicationLevel: row.complicationLevel, weight: Number(row.weight || 0) };
  return { ...common, mainOperationPrefixes: list(row.mainOperationPrefixes), relatedOperationPrefixes: list(row.relatedOperationPrefixes), treatmentTags: list(row.treatmentTags), score: Number(row.score || 0) };
}

function coefficientRow(row) {
  return { institutionCode: row.institutionCode, institution: row.institution, coefficient: Number(row.coefficient || 0), effectiveFrom: row.effectiveFrom, effectiveTo: row.effectiveTo, basisDocumentNo: row.basisDocumentNo };
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function splitPaths(value) {
  return String(value || "").split(";").map((item) => item.trim()).filter(Boolean).map((item) => path.resolve(item));
}

function buildPackage(options) {
  if (!options.base || !options.catalog) throw new Error("build需要--base和--catalog参数");
  const basePath = path.resolve(options.base);
  const catalogPath = path.resolve(options.catalog);
  const base = JSON.parse(fs.readFileSync(basePath, "utf8"));
  const mode = base.mode === "DIP" ? "DIP" : "DRG";
  const catalog = parseCsv(fs.readFileSync(catalogPath, "utf8")).map((row) => catalogRow(row, mode));
  const coefficients = options.coefficients ? parseCsv(fs.readFileSync(path.resolve(options.coefficients), "utf8")).map(coefficientRow) : (base.payment?.institutionCoefficients || []);
  const sourcePaths = [...new Set([catalogPath, ...(options.coefficients ? [path.resolve(options.coefficients)] : []), ...splitPaths(options.source)])];
  const verificationStatus = options.verified ? "verified" : "待核验";
  const result = {
    ...base,
    catalogCount: catalog.length,
    catalog,
    payment: { ...(base.payment || {}), institutionCoefficients: coefficients },
    sourceFiles: sourcePaths.map((file) => ({ name: path.basename(file), sha256: sha256(file), verificationStatus }))
  };
  if (options.approval) {
    const approvalPath = path.resolve(options.approval);
    result.approvalDocument = { ...(result.approvalDocument || {}), fileDigest: sha256(approvalPath) };
  }
  const validation = Service.validateLocalPaymentPackage(result);
  return { package: result, validation };
}

function validateFile(file) {
  const payload = JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
  return Service.validateLocalPaymentPackage(payload);
}

function usage() {
  return [
    "当地医保规则包构建工具",
    "",
    "构建：node scripts/disease-payment-package-builder.js build --base=<基础JSON> --catalog=<目录CSV> [--coefficients=<机构系数CSV>] [--source=<原始文件1;原始文件2>] [--approval=<批复文件>] --output=<输出JSON> [--verified]",
    "校验：node scripts/disease-payment-package-builder.js validate --file=<规则包JSON>",
    "",
    "注意：--verified仅在人工确认文件来自当地医保正式渠道后使用。Excel文件可先用LibreOffice另存为UTF-8 CSV。"
  ].join("\n");
}

function main(argv = process.argv.slice(2)) {
  const { command, options } = parseArgs(argv);
  if (command === "build") {
    const result = buildPackage(options);
    const output = options.output ? path.resolve(options.output) : path.resolve(`local-${result.package.mode.toLowerCase()}-package.json`);
    fs.writeFileSync(output, `${JSON.stringify(result.package, null, 2)}\n`, "utf8");
    process.stdout.write(`${JSON.stringify({ output, validation: result.validation }, null, 2)}\n`);
    if (!result.validation.ok) process.exitCode = 2;
    return result;
  }
  if (command === "validate") {
    if (!options.file) throw new Error("validate需要--file参数");
    const validation = validateFile(options.file);
    process.stdout.write(`${JSON.stringify(validation, null, 2)}\n`);
    if (!validation.ok) process.exitCode = 2;
    return validation;
  }
  process.stdout.write(`${usage()}\n`);
  return null;
}

if (require.main === module) {
  try { main(); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}

module.exports = { buildPackage, catalogRow, main, parseArgs, parseCsv, sha256, validateFile };
