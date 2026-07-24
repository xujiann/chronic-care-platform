"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  FOUR_PARTY_ROLES,
  MONITORING_SIGNOFF_ROLES,
  REQUIRED_GO_PREREQUISITES,
  REQUIRED_P0_TASKS,
  buildProductionReleaseEvidenceReadiness,
  createEvidenceFingerprint,
  parseArgs,
  renderMarkdown,
  writeOutput
} = require("../scripts/production-release-evidence-readiness");

const ROOT = path.resolve(__dirname, "..");
const DIGEST = `sha256:${"a".repeat(64)}`;

function controlled(name) {
  return `controlled://release-2026-001/${name}`;
}

function common(evidenceId, gateId, environment, ownerDepartment, independentVerifier) {
  return {
    evidenceId,
    gateId,
    environment,
    ownerDepartment,
    independentVerifier,
    releaseId: "release-2026-001",
    artifactDigest: DIGEST,
    changeTicket: "CHG-2026-001",
    executedAt: "2026-07-22T08:00:00.000Z",
    target: "production-cluster-a",
    steps: ["execute controlled rehearsal", "archive minimized receipt"],
    expectedResult: "controlled gate passes",
    actualResult: "controlled gate passed",
    result: "passed",
    attachments: [{ reference: controlled(`${evidenceId}.zip`), digest: DIGEST }],
    dataBoundary: { containsPatientData: false, containsSecretValues: false },
    exceptions: []
  };
}

function signoffs(roles, prefix) {
  return roles.map((role) => ({ role, account: `${prefix}-${role}` }));
}

function buildPassingRecords() {
  const records = {
    "security-assessment.json": {
      ...common("security-evidence-001", "P0-07", "production", "security-compliance", "independent-security-review"),
      assessments: ["classified-protection", "commercial-crypto", "penetration-test"].map((id) => ({ id, status: "accepted", reportRef: controlled(`${id}-report`) })),
      findings: { openCritical: 0, openHigh: 0, activeWaivers: [] },
      securityOpinions: [
        { role: "security-owner", account: "security-owner-a", status: "approved", evidenceRef: controlled("security-opinion-a") },
        { role: "release-owner", account: "release-owner-b", status: "approved", evidenceRef: controlled("security-opinion-b") }
      ]
    },
    "monitoring-drill.json": {
      ...common("monitoring-evidence-001", "P0-09", "production", "platform-ops", "independent-operations-review"),
      productionEndpoint: "https://platform.example.gov.cn/api/health",
      alertRoutes: [{ id: "siem", status: "verified", receiptRef: controlled("siem-receipt") }],
      drillScenarios: ["delivery", "retry", "escalation", "recovery"].map((id) => ({ id, passed: true, receiptRef: controlled(`${id}-receipt`) })),
      onCall: { rosterRef: controlled("on-call-roster"), escalationRef: controlled("escalation-policy") },
      signoffs: signoffs(MONITORING_SIGNOFF_ROLES, "monitoring")
    },
    "dr-rehearsal.json": {
      ...common("dr-evidence-001", "P0-10-DR", "disaster-recovery", "data-platform", "independent-dr-review"),
      objectives: { rpoMinutes: 15, rtoMinutes: 60 },
      measurements: { rpoMinutes: 5, rtoMinutes: 35 },
      nativeBackupRef: controlled("native-backup-manifest"),
      offsiteReplicaRef: controlled("offsite-replica-proof"),
      rehearsalScenarios: ["backup", "restore", "failover", "rollback"].map((id) => ({ id, passed: true, receiptRef: controlled(`${id}-receipt`) })),
      signoffs: signoffs(FOUR_PARTY_ROLES, "dr")
    },
    "site-acceptance.json": {
      ...common("site-acceptance-001", "P0-SITE-ACCEPTANCE", "production", "project-office", "hospital-acceptance-review"),
      tasks: REQUIRED_P0_TASKS.map((id) => ({
        id,
        status: "site-accepted",
        evidenceRef: controlled(`${id}-site-evidence`),
        signatures: signoffs(FOUR_PARTY_ROLES, id.toLowerCase())
      }))
    }
  };
  records["go-no-go.json"] = {
    ...common("go-no-go-evidence-001", "P0-10-GLOBAL", "production", "cutover-committee", "cab-reviewer"),
    evidenceFingerprint: createEvidenceFingerprint(records),
    prerequisites: REQUIRED_GO_PREREQUISITES.map((id) => ({ id, passed: true, evidenceRef: controlled(`${id}-evidence`) })),
    approvals: FOUR_PARTY_ROLES.map((role) => ({ role, account: `go-${role}`, status: "approved", evidenceRef: controlled(`${role}-approval`) })),
    decision: {
      value: "GO",
      account: "independent-command-owner",
      confirmation: "APPROVE PRODUCTION GO LIVE",
      rollbackOwner: "rollback-owner-a"
    }
  };
  return records;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test("empty production evidence remains an explicit NO-GO", () => {
  const report = buildProductionReleaseEvidenceReadiness({ records: {} });
  assert.equal(report.ok, false);
  assert.equal(report.status, "no-go-evidence-incomplete");
  assert.equal(report.summary.present, 0);
  assert.equal(report.gates.every((item) => item.present === false), true);
  assert.match(renderMarkdown(report), /Result: NO-GO/);
});

test("unfilled repository templates remain blocked and expose every evidence document", () => {
  const directory = path.join(ROOT, "docs", "evidence-templates", "production-security-release");
  const report = buildProductionReleaseEvidenceReadiness({ directory });
  assert.equal(report.ok, false);
  assert.equal(report.summary.present, 5);
  assert.equal(report.checks.some((item) => item.id.endsWith(":placeholders") && !item.passed), true);
  assert.equal(report.checks.some((item) => item.id === "evidence:go-no-go:decision" && !item.passed), true);
});

test("complete synthetic minimized evidence validates without claiming external certification", () => {
  const report = buildProductionReleaseEvidenceReadiness({ records: buildPassingRecords() });
  assert.equal(report.ok, true);
  assert.equal(report.status, "go-decision-evidence-validated");
  assert.equal(report.summary.present, 5);
  assert.equal(report.summary.failed, 0);
  assert.equal(report.checks.every((item) => item.passed), true);
  assert.match(report.boundary, /does not.*certify/i);
  assert.match(renderMarkdown(report), /Gate responsibility/);
});

test("evidence drift and duplicate four-party accounts invalidate an old GO", () => {
  const records = buildPassingRecords();
  records["security-assessment.json"].actualResult = "evidence changed after approval";
  records["go-no-go.json"].approvals[1].account = records["go-no-go.json"].approvals[0].account;
  const report = buildProductionReleaseEvidenceReadiness({ records });
  assert.equal(report.ok, false);
  assert.equal(report.checks.find((item) => item.id === "evidence:go-no-go:fingerprint").passed, false);
  assert.equal(report.checks.find((item) => item.id === "evidence:go-no-go:approvals").passed, false);
});

test("patient-data declarations and embedded secret material are hard blockers", () => {
  const records = clone(buildPassingRecords());
  records["monitoring-drill.json"].dataBoundary.containsPatientData = true;
  records["monitoring-drill.json"].api_token = "token-value-must-not-be-archived";
  records["go-no-go.json"].evidenceFingerprint = createEvidenceFingerprint(records);
  const report = buildProductionReleaseEvidenceReadiness({ records });
  assert.equal(report.ok, false);
  assert.equal(report.checks.find((item) => item.id === "evidence:monitoring-drill:dataBoundary").passed, false);
  assert.equal(report.checks.find((item) => item.id === "evidence:monitoring-drill:secretScan").passed, false);
});

test("CLI parsing is read-only by default and writes only explicitly requested reports", (t) => {
  const flags = parseArgs(["--evidence-dir=D:/controlled/release-001"]);
  assert.equal(flags["evidence-dir"], "D:/controlled/release-001");
  assert.equal(flags.output, undefined);
  assert.equal(flags.markdown, undefined);

  const outputDir = path.join(ROOT, "tmp", "production-release-evidence-test");
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
  const report = buildProductionReleaseEvidenceReadiness({ records: buildPassingRecords() });
  writeOutput(report, {
    output: "tmp/production-release-evidence-test/readiness.json",
    markdown: "tmp/production-release-evidence-test/readiness.md"
  });
  assert.equal(fs.existsSync(path.join(outputDir, "readiness.json")), true);
  assert.match(fs.readFileSync(path.join(outputDir, "readiness.md"), "utf8"), /Result: PASS/);
});
