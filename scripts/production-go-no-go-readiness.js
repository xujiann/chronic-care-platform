#!/usr/bin/env node
"use strict";

const { readRuntimeSource } = require("../src/http/runtime-source");

const fs = require("node:fs");
const path = require("node:path");
const { buildProductionGoNoGoCenter, seedProductionGoNoGoApprovals } = require("../production-go-no-go");
const { buildProductionSecurityAcceptanceCenter, seedProductionSecurityFindings, seedProductionSecurityReleaseApprovals } = require("../production-security-acceptance");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT, "release", "production-go-no-go-readiness-report.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "production-go-no-go-readiness-report.md");

function readText(file) { return fs.readFileSync(path.join(ROOT, file), "utf8"); }
function readJson(file, fallback = {}) { try { return JSON.parse(readText(file)); } catch { return fallback; } }
function check(id, passed, detail) { return { id, passed: Boolean(passed), detail }; }

function buildProductionGoNoGoReadiness(options = {}) {
  const data = options.data || readJson("data/db.json");
  const pkg = options.pkg || readJson("package.json");
  const server = options.server || readRuntimeSource(ROOT);
  const html = options.html || readText("platform.html");
  const ui = options.ui || readText("production-go-no-go-ui.js");
  const model = options.model || readText("production-go-no-go.js");
  const docs = options.docs || readText("docs/production-go-no-go-command-center.md");
  const findings = data.productionSecurityFindings || seedProductionSecurityFindings();
  const securityApprovals = data.productionSecurityReleaseApprovals || seedProductionSecurityReleaseApprovals();
  const securityCenter = buildProductionSecurityAcceptanceCenter(findings, securityApprovals, { now: options.now });
  const state = {
    ...data,
    productionGoNoGoApprovals: data.productionGoNoGoApprovals || seedProductionGoNoGoApprovals()
  };
  const cutoverArtifact = options.cutoverArtifact || readJson("release/production-cutover-checklist.json");
  const center = buildProductionGoNoGoCenter(state, {
    launchSmoke: options.launchSmoke || readJson("release/launch-smoke-report.json"),
    cutoverChecklist: options.cutoverChecklist || cutoverArtifact.checklist || [],
    cutoverProfile: options.cutoverProfile || cutoverArtifact.profile,
    drRehearsalSigned: options.drRehearsalSigned === true
  }, securityCenter);
  const checks = [
    check("goNoGoReadiness:model", ["evidenceFingerprint", "unique signers", "APPROVE PRODUCTION GO LIVE", "NO-GO", "production target", "original signer"].every((token) => model.includes(token)), "production-target evidence, fingerprint invalidation, signer ownership and explicit command decision modeled"),
    check("goNoGoReadiness:api", ["/api/production-go-no-go/center", "/api/production-go-no-go/approvals/:id/actions", "/api/production-go-no-go/decision", "production-go-no-go-decision"].every((token) => server.includes(token)), "global command APIs and audit event wired"),
    check("goNoGoReadiness:ui", html.includes('data-platform-section="production-go-no-go"') && html.includes("production-go-no-go-ui.js") && ui.includes("data-go-no-go-approval") && ui.includes("data-go-no-go-decision"), "platform command workbench wired"),
    check("goNoGoReadiness:prerequisites", ["goNoGo:siteAcceptances", "goNoGo:securityOpinion", "goNoGo:launchSmoke", "goNoGo:cutoverChecklist", "goNoGo:drSignoff", "goNoGo:trustedPreflightDecision"].every((id) => model.includes(id)), "six production prerequisite gates modeled, including trusted preflight receipt"),
    check("goNoGoReadiness:trustedReceipt", model.includes("isVerifiedProductionPreflightDecision") && server.includes("assessProductionPreflightDecisionReceipt") && docs.includes("single-use/replay-protected"), "runtime requires explicit trusted verifier projection; local evidence cannot substitute"),
    check("goNoGoReadiness:evidenceDrift", model.includes("staleApprovals") && model.includes("evidenceCurrent") && ui.includes("data-go-no-go-drift") && docs.includes("evidence drift"), `${center.summary.staleApprovals || 0} stale approvals against current evidence fingerprint`),
    check("goNoGoReadiness:boundary", center.gate.softwareControlReady && docs.includes("does not") && docs.includes("CUTOVER_DR_REHEARSAL_SIGNOFF"), `${center.status}; formal GO remains evidence-driven`),
    check("goNoGoReadiness:package", Boolean(pkg.scripts?.["production:go-no-go-readiness"]), pkg.scripts?.["production:go-no-go-readiness"] || "missing")
  ];
  return { ok: checks.every((item) => item.passed), generatedAt: new Date().toISOString(), summary: center.summary, checks, center };
}

function renderMarkdown(report) {
  return [
    "# Production global Go/No-Go readiness report", "",
    `Generated: ${report.generatedAt}`, `Automation: ${report.ok ? "PASS" : "FAIL"}`, `Runtime state: ${report.center.status}`, "",
    "## Gate summary", "",
    `- Prerequisites: ${report.summary.prerequisitesPassed}/${report.summary.prerequisites}`,
    `- P0 site acceptances: ${report.summary.siteAcceptances}/10`,
    `- Four-party approvals: ${report.summary.approvalsRecorded}/${report.summary.approvals}`,
    `- Stale approvals: ${report.summary.staleApprovals || 0}`,
    `- Effective GO: ${report.summary.decisionEffective}`, "",
    "## Automation checks", "", "| Check | Result | Detail |", "| --- | --- | --- |",
    ...report.checks.map((item) => `| ${item.id} | ${item.passed ? "PASS" : "FAIL"} | ${item.detail} |`), "",
    "## Runtime prerequisites", "", "| Prerequisite | Result | Detail |", "| --- | --- | --- |",
    ...report.center.checks.map((item) => `| ${item.id} | ${item.passed ? "PASS" : "BLOCKED"} | ${item.detail} |`), "",
    "## Boundary", "", report.center.boundary, ""
  ].join("\n");
}

function writeOutput(report, output = DEFAULT_OUTPUT, markdown = DEFAULT_MARKDOWN) {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2), "utf8");
  fs.writeFileSync(markdown, renderMarkdown(report), "utf8");
}

if (require.main === module) {
  const report = buildProductionGoNoGoReadiness({ drRehearsalSigned: /^(signed|true|yes|approved)$/i.test(String(process.env.CUTOVER_DR_REHEARSAL_SIGNOFF || "")) });
  writeOutput(report);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) process.exitCode = 1;
}

module.exports = { buildProductionGoNoGoReadiness, renderMarkdown, writeOutput };
