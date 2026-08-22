#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { assertMetadataOnly, sha256 } = require("../src/platform/governance/technical-evidence");
const { readBoundedJsonFile } = require("../src/platform/governance/production-evidence-trust-provider");

const RECEIPT_SCHEMA = "platform-governance.production-promotion-receipt.v1";
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const SOURCE_SHA = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,159}$/;

function promotionError(code) {
  return Object.assign(new Error("production promotion receipt failed closed"), { code, statusCode: 400 });
}

function buildProductionPromotionReceipt(report, context = {}) {
  const sourceSha = String(report?.sourceSha || "").toLowerCase();
  const workflowSourceSha = String(context.sourceSha || "").toLowerCase();
  if (report?.schemaVersion !== "production-preflight-v2"
    || report?.decision !== "GO"
    || report?.productionReady !== true
    || !IDENTIFIER.test(String(report?.releaseId || ""))
    || !SOURCE_SHA.test(sourceSha)
    || workflowSourceSha !== sourceSha
    || !SHA256.test(String(report?.artifactDigest || "").toLowerCase())
    || report?.productionEvidenceTrustProvider?.verified !== true
    || !SHA256.test(String(report?.productionEvidenceTrustProvider?.envelopeDigest || ""))
    || report?.cutoverActionEvidence?.productionReady !== true
    || report?.cutoverActionEvidence?.releaseId !== report.releaseId
    || String(report?.cutoverActionEvidence?.artifactDigest || "").toLowerCase() !== String(report.artifactDigest).toLowerCase()
    || !SHA256.test(String(report?.cutoverActionEvidence?.reportDigest || ""))) {
    throw promotionError("PRODUCTION_PROMOTION_PREFLIGHT_INVALID");
  }
  const generatedAt = new Date(context.now || Date.now()).toISOString();
  const receipt = {
    schema: RECEIPT_SCHEMA,
    status: "verified-preflight",
    releaseId: report.releaseId,
    sourceSha,
    artifactDigest: String(report.artifactDigest).toLowerCase(),
    preflightReportDigest: sha256(report),
    productionEvidenceEnvelopeDigest: report.productionEvidenceTrustProvider.envelopeDigest,
    cutoverActionReportDigest: report.cutoverActionEvidence.reportDigest,
    evidenceFingerprint: String(report?.productionEvidence?.evidenceFingerprint || ""),
    workflowRunId: String(context.workflowRunId || ""),
    workflowRunAttempt: String(context.workflowRunAttempt || ""),
    generatedAt,
    productionPromotionEligible: true,
    deploymentExecuted: false,
    externalAuthorizationRequired: true,
    boundary: "This digest-only receipt proves strict preflight eligibility; it does not prove deployment, site acceptance or final change authorization."
  };
  if (!/^[0-9]{1,32}$/.test(receipt.workflowRunId)
    || !/^[0-9]{1,8}$/.test(receipt.workflowRunAttempt)
    || !/^[a-f0-9]{64}$/.test(receipt.evidenceFingerprint)) {
    throw promotionError("PRODUCTION_PROMOTION_CONTEXT_INVALID");
  }
  assertMetadataOnly(receipt, "productionPromotionReceipt");
  return Object.freeze(receipt);
}

function parseArgs(argv = process.argv.slice(2)) {
  return Object.fromEntries(argv.filter((arg) => arg.startsWith("--")).map((arg) => {
    const [key, ...parts] = arg.slice(2).split("=");
    return [key, parts.join("=")];
  }));
}

function writeReceipt(receipt, output) {
  const target = path.resolve(String(output || ""));
  if (!output || !path.isAbsolute(String(output))) throw promotionError("PRODUCTION_PROMOTION_OUTPUT_INVALID");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  return target;
}

function runCli(env = process.env) {
  const flags = parseArgs();
  const report = readBoundedJsonFile(flags.report).document;
  const receipt = buildProductionPromotionReceipt(report, {
    sourceSha: env.GITHUB_SHA,
    workflowRunId: env.GITHUB_RUN_ID,
    workflowRunAttempt: env.GITHUB_RUN_ATTEMPT
  });
  writeReceipt(receipt, flags.output);
  process.stdout.write(`${JSON.stringify({ schema: receipt.schema, status: receipt.status, releaseId: receipt.releaseId, preflightReportDigest: receipt.preflightReportDigest })}\n`);
}

if (require.main === module) {
  try {
    runCli();
  } catch {
    process.stderr.write(`${JSON.stringify({ code: "PRODUCTION_PROMOTION_RECEIPT_FAILED_CLOSED" })}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  RECEIPT_SCHEMA,
  buildProductionPromotionReceipt,
  parseArgs,
  promotionError,
  writeReceipt
};
