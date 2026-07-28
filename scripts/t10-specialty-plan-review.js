#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const {
  buildSpecialtyPlanReview,
  renderSpecialtyPlanReviewMarkdown
} = require("../t10-specialty-plan-review");

const ROOT = path.resolve(__dirname, "..");

function writeSpecialtyPlanReview(review, options = {}) {
  const outputDir = path.resolve(options.outputDir || path.join(ROOT, "release", "t10-specialty-plan-review"));
  fs.mkdirSync(outputDir, { recursive: true });
  const documents = {
    "specialty-plan-review.json": `${JSON.stringify(review, null, 2)}\n`,
    "specialty-plan-review.md": `${renderSpecialtyPlanReviewMarkdown(review)}\n`,
    "external-action-register.json": `${JSON.stringify({
      generatedAt: review.generatedAt,
      productionBoundary: review.productionBoundary,
      actions: review.externalActions
    }, null, 2)}\n`
  };
  const payloadArtifacts = Object.entries(documents).map(([file, content]) => {
    fs.writeFileSync(path.join(outputDir, file), content, "utf8");
    return { file, bytes: Buffer.byteLength(content, "utf8"), digest: digest(content) };
  });
  const index = {
    contractVersion: "1.0.0",
    generatedAt: review.generatedAt,
    reviewDigest: review.integrity.digest,
    payloadArtifacts
  };
  fs.writeFileSync(path.join(outputDir, "artifact-index.json"), `${JSON.stringify(index, null, 2)}\n`, "utf8");
  return { outputDir, index };
}

function verifySpecialtyPlanReview(outputDir) {
  const indexPath = path.resolve(outputDir, "artifact-index.json");
  if (!fs.existsSync(indexPath)) return invalid([{ id: "artifact-index", passed: false, detail: "missing" }]);
  const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
  const checks = (index.payloadArtifacts || []).map((item) => {
    const target = path.resolve(outputDir, item.file);
    const exists = fs.existsSync(target);
    const content = exists ? fs.readFileSync(target, "utf8") : "";
    return {
      id: `artifact:${item.file}`,
      passed: exists && item.bytes === Buffer.byteLength(content, "utf8") && item.digest === digest(content),
      detail: exists ? digest(content) : "missing"
    };
  });
  return checks.every((item) => item.passed)
    ? { ok: true, status: "specialty-plan-review-artifacts-verified", checks, summary: summarize(checks) }
    : invalid(checks);
}

function invalid(checks) {
  return { ok: false, status: "specialty-plan-review-artifacts-invalid", checks, summary: summarize(checks) };
}

function summarize(checks) {
  const passed = checks.filter((item) => item.passed).length;
  return { total: checks.length, passed, failed: checks.length - passed };
}

function digest(content) {
  return `sha256:${crypto.createHash("sha256").update(content).digest("hex")}`;
}

function parseArgs(argv = process.argv.slice(2)) {
  const options = {};
  for (const argument of argv) {
    if (argument.startsWith("--tracks=")) options.selectedTrackIds = argument.slice("--tracks=".length).split(",").map((item) => item.trim()).filter(Boolean);
    else if (argument.startsWith("--output=")) options.outputDir = argument.slice("--output=".length);
    else throw new Error(`unknown argument: ${argument}`);
  }
  return options;
}

function runCli() {
  const options = parseArgs();
  const review = buildSpecialtyPlanReview({ selectedTrackIds: options.selectedTrackIds });
  const output = writeSpecialtyPlanReview(review, { outputDir: options.outputDir });
  const verification = verifySpecialtyPlanReview(output.outputDir);
  console.log(JSON.stringify({ status: review.status, summary: review.summary, outputDir: output.outputDir, verification }, null, 2));
  if (!review.ok || !verification.ok) process.exitCode = 1;
}

if (require.main === module) runCli();

module.exports = {
  writeSpecialtyPlanReview,
  verifySpecialtyPlanReview,
  parseArgs
};
