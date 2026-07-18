#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  buildProductionSecurityAcceptanceCenter,
  seedProductionSecurityFindings,
  seedProductionSecurityReleaseApprovals
} = require("../production-security-acceptance");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT, "release", "production-security-readiness-report.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "production-security-readiness-report.md");

function readText(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function readJson(file) {
  return JSON.parse(readText(file));
}

function check(id, passed, detail) {
  return { id, passed: Boolean(passed), detail };
}

function buildProductionSecurityReadiness(options = {}) {
  const data = options.data || readJson("data/db.json");
  const pkg = options.pkg || readJson("package.json");
  const findings = Array.isArray(data.productionSecurityFindings) ? data.productionSecurityFindings : seedProductionSecurityFindings();
  const approvals = Array.isArray(data.productionSecurityReleaseApprovals) ? data.productionSecurityReleaseApprovals : seedProductionSecurityReleaseApprovals();
  const center = buildProductionSecurityAcceptanceCenter(findings, approvals, { now: options.now });
  const server = options.server || readText("server.js");
  const html = options.html || readText("platform.html");
  const ui = options.ui || readText("production-security.js");
  const tests = options.tests || readText("test/production-security-acceptance.test.js");
  const checks = [
    check("productionSecurity:model", center.summary.findings >= 4 && ["critical", "high", "medium", "low"].every((severity) => findings.some((item) => item.severity === severity) || severity === "low"), `${center.summary.findings} governed findings`),
    check("productionSecurity:stateMachine", ["record-remediation", "submit-retest", "verify-retest", "request-waiver", "approve-waiver", "approve-release"].every((marker) => tests.includes(marker)), "remediation, independent retest, waiver and release controls covered"),
    check("productionSecurity:api", ["/api/production-security/center", "/api/production-security/findings/:id/actions", "/api/production-security/release-approvals/:id/actions", "production-security-finding-action"].every((marker) => server.includes(marker)), "commission API and security audit markers wired"),
    check("productionSecurity:ui", html.includes('data-platform-section="production-security-acceptance"') && html.includes("production-security.js") && ui.includes("data-production-security-action") && ui.includes("data-production-security-approval"), "platform security acceptance workbench wired"),
    check("productionSecurity:releaseBoundary", center.productionGate.softwareControlReady && center.productionGate.formalProductionReady === false && center.boundary.includes("does not replace"), `${center.status}; formal production remains externally governed`),
    check("productionSecurity:package", Boolean(pkg.scripts?.["security:production-readiness"]), pkg.scripts?.["security:production-readiness"] || "missing")
  ];
  return {
    ok: checks.every((item) => item.passed),
    generatedAt: new Date().toISOString(),
    summary: center.summary,
    checks,
    center
  };
}

function renderMarkdown(report) {
  return [
    "# Production security acceptance readiness report",
    "",
    `Generated: ${report.generatedAt}`,
    `Status: ${report.ok ? "PASS" : "FAIL"}`,
    `Runtime gate: ${report.center.status}`,
    "",
    "## Summary",
    "",
    `- Findings: ${report.summary.findings}`,
    `- Open: ${report.summary.openFindings}`,
    `- Critical/high blockers: ${report.summary.criticalOpen + report.summary.highOpen}`,
    `- Active waivers: ${report.summary.activeWaivers}`,
    `- Release opinions: ${report.summary.approvedReleaseOpinions}/${report.summary.releaseApprovals}`,
    "",
    "## Automated checks",
    "",
    "| Check | Result | Detail |",
    "| --- | --- | --- |",
    ...report.checks.map((item) => `| ${item.id} | ${item.passed ? "PASS" : "FAIL"} | ${item.detail} |`),
    "",
    "## Production boundary",
    "",
    report.center.boundary,
    ""
  ].join("\n");
}

function writeOutput(report, output = DEFAULT_OUTPUT, markdown = DEFAULT_MARKDOWN) {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2), "utf8");
  fs.writeFileSync(markdown, renderMarkdown(report), "utf8");
}

if (require.main === module) {
  const report = buildProductionSecurityReadiness();
  writeOutput(report);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) process.exitCode = 1;
}

module.exports = { buildProductionSecurityReadiness, renderMarkdown, writeOutput };
