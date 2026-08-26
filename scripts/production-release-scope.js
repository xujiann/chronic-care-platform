#!/usr/bin/env node
"use strict";

const {
  buildProductionReleaseScopeReport,
  loadDefaultAuthorities
} = require("../src/platform/governance/production-release-scope");

function run(options = {}) {
  return buildProductionReleaseScopeReport({ ...loadDefaultAuthorities(options.root), ...options });
}

function runCli(argv = process.argv.slice(2)) {
  const report = run();
  const output = argv.includes("--check")
    ? {
        schemaVersion: report.schemaVersion,
        scopeId: report.scopeId,
        ok: report.ok,
        status: report.status,
        scopeFingerprint: report.scopeFingerprint,
        productionReady: report.productionReady,
        externalEvidenceRequired: report.externalEvidenceRequired,
        summary: report.summary,
        repositoryReview: {
          apiReviewRequired: report.repositoryReview.apiReviewRequired.length,
          collectionReviewRequired: report.repositoryReview.collectionReviewRequired.length
        },
        failedChecks: report.checks.filter((item) => !item.passed),
        blockers: report.blockers,
        boundary: report.boundary
      }
    : report;
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (!report.ok) process.exitCode = 1;
}

if (require.main === module) {
  try {
    runCli();
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, code: "PRODUCTION_RELEASE_SCOPE_FAILED", message: error.message })}\n`);
    process.exitCode = 1;
  }
}

module.exports = { run, runCli };
