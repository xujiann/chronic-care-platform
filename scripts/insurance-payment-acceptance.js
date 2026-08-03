#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { buildDiseasePaymentReadiness } = require("./disease-payment-readiness");
const { buildFinancialGatewayReadiness } = require("./financial-gateway-readiness");
const OperatingModel = require("../insurance-payment-operating-model");
const Persistence = require("../insurance-payment-persistence");
const PostgresPersistence = require("../insurance-payment-postgres-repository");
const OutboxWorker = require("../insurance-payment-outbox-worker");

const ROOT = path.resolve(__dirname, "..");
const FINANCIAL_GATEWAY_EVIDENCE_POLICY = Object.freeze([
  Object.freeze({ id: "financial-1", owner: "金融网关与证书责任方", reviewerRole: "security-reviewer" }),
  Object.freeze({ id: "financial-2", owner: "金融网关适配责任方", reviewerRole: "security-reviewer" }),
  Object.freeze({ id: "financial-3", owner: "医院财务与医保经办", reviewerRole: "finance-auditor" }),
  Object.freeze({ id: "financial-4", owner: "金融网关适配责任方", reviewerRole: "acceptance-reviewer" }),
  Object.freeze({ id: "financial-5", owner: "信息安全责任方", reviewerRole: "security-reviewer" }),
  Object.freeze({ id: "financial-6", owner: "现场实施与医保经办", reviewerRole: "acceptance-reviewer" })
]);
const EXTERNAL_REVIEWER_ROLES = new Set(["acceptance-reviewer", "security-reviewer", "finance-auditor"]);

function checkById(report, id) {
  return report.checks.find((item) => item.id === id)?.ok === true;
}

function capabilityById(report, id) {
  return report.capabilities.find((item) => item.id === id)?.passed === true;
}

function diseasePaymentExternalEvidence(blockers = []) {
  return blockers.flatMap((item) => {
    const requirements = Array.isArray(item.evidenceRequirements) && item.evidenceRequirements.length
      ? item.evidenceRequirements
      : [{ id: "acceptance", detail: item.name, reviewerRole: "acceptance-reviewer" }];
    return requirements.map((requirement) => ({
      source: "disease-payment",
      id: `${item.id}:${requirement.id}`,
      dependencyId: item.id,
      detail: requirement.detail,
      owner: item.owner,
      reviewerRole: requirement.reviewerRole
    }));
  });
}

function financialGatewayExternalEvidence(blockers = []) {
  return blockers.map((detail, index) => {
    const policy = FINANCIAL_GATEWAY_EVIDENCE_POLICY[index] || {};
    return {
      source: "financial-gateway",
      id: policy.id || `financial-unmapped-${index + 1}`,
      detail,
      owner: policy.owner || "",
      reviewerRole: policy.reviewerRole || ""
    };
  });
}

function buildAcceptanceProductionGate(report = {}) {
  const checks = [
    { id: "local-domain-ready", passed: report.localReady === true, detail: `${report.summary?.workflowsReady || 0}/${report.summary?.workflows || 0} workflows ready` },
    { id: "external-evidence-governed", passed: report.summary?.externalEvidenceGoverned === true, detail: `${report.summary?.externalBlockers || 0} external requirements assigned` },
    { id: "persistence-production-cutover-complete", passed: report.persistence?.productionPrimary === true, detail: report.persistence?.productionPrimary === true ? "production persistence cutover confirmed" : "database migration, restore drill and T00 cutover pending" },
    { id: "t00-public-wiring-complete", passed: report.summary?.t00RoutesPending === 0, detail: `${report.summary?.t00RoutesPending || 0} routes pending` },
    { id: "live-site-acceptance-confirmed", passed: report.productionReady === true, detail: report.productionReady === true ? "live acceptance confirmed" : "live access and signed site acceptance pending" }
  ];
  return {
    passed: checks.every((item) => item.passed),
    blockers: checks.filter((item) => !item.passed).map((item) => item.id),
    checks
  };
}

function buildPersistenceAcceptance(env = process.env) {
  const contract = Persistence.persistenceContract();
  const postgres = PostgresPersistence.buildPostgresInsurancePaymentConfig(env);
  const checks = [
    { id: "optimistic-concurrency", passed: contract.invariants.some((item) => item.includes("expectedVersion")) },
    { id: "command-idempotency", passed: contract.invariants.some((item) => item.includes("commandId")) },
    { id: "transactional-outbox", passed: contract.invariants.some((item) => item.includes("同一数据库事务")) },
    { id: "leased-delivery", passed: contract.invariants.some((item) => item.includes("至少一次投递")) },
    { id: "dead-letter", passed: contract.invariants.some((item) => item.includes("dead-letter")) },
    { id: "checkpoint-integrity", passed: typeof Persistence.verifyPersistenceRecord === "function" },
    { id: "postgres-adapter", passed: typeof PostgresPersistence.createPostgresInsurancePaymentRepository === "function" },
    { id: "postgres-migration", passed: /^sha256:[a-f0-9]{64}$/.test(postgres.migration.sha256) },
    { id: "outbox-delivery-worker", passed: typeof OutboxWorker.runInsurancePaymentOutboxBatch === "function" && typeof OutboxWorker.buildOutboxHealth === "function" }
  ];
  return {
    contractId: contract.id,
    ready: checks.every((item) => item.passed),
    checks,
    productionAdapterRequired: true,
    productionAdapterConfigured: postgres.writeEnabled,
    productionPrimary: false,
    postgres: {
      adapter: postgres.adapter,
      mode: postgres.mode,
      configured: postgres.configured,
      evidenceReady: postgres.evidenceReady,
      writeEnabled: postgres.writeEnabled,
      requirements: postgres.requirements,
      migration: postgres.migration,
      credentialsPersisted: false
    },
    boundary: contract.productionBoundary
  };
}

function buildInsurancePaymentAcceptance(options = {}) {
  const diseasePayment = options.diseasePayment || buildDiseasePaymentReadiness();
  const financialGateway = options.financialGateway || buildFinancialGatewayReadiness();
  const serverSource = options.serverSource ?? fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
  const operatingModel = OperatingModel.validateOperatingModel();
  const persistence = options.persistence || buildPersistenceAcceptance();
  const integrationHandoff = OperatingModel.buildT00IntegrationHandoff(serverSource);
  const workflows = [
    { id: "online-payment-refund", label: "在线支付退费", ready: capabilityById(financialGateway, "online-refund-closed-loop") && capabilityById(financialGateway, "online-refund-sla-operations"), evidence: ["dual-domain-review", "decision-bound-resubmission", "fresh-correction-evidence", "immutable-review-history", "ledger-guarded-transitions", "ledger-state-projection-cross-check", "trusted-callback", "provider-reversal", "phase-sla", "redacted-exception-queue", "daily-reconciliation", "voucher-close"] },
    { id: "insurance-settlement", label: "医保核心结算", ready: checkById(diseasePayment, "settlement") && checkById(diseasePayment, "settlement-core-correction") && checkById(diseasePayment, "settlement-payment-retry"), evidence: ["formal-grouping-gate", "integer-fen-contract", "trusted-core-callback", "digest-bound-return-requirements", "correction-sla", "resubmission-identity-rotation", "trusted-payment-failure", "payment-failure-sla", "bounded-payment-retry", "multi-cycle-return-ledger", "hash-ledger", "ledger-state-projection"] },
    { id: "drg-dip", label: "DRG/DIP分组测算", ready: ["dual-mode", "official-receipt-contract", "formal-grouping-async", "formal-grouper-production-config-contract", "formal-grouping-compensation", "formal-grouping-integrity", "parameter-dual-review"].every((id) => checkById(diseasePayment, id)), evidence: ["signed-grouper-contract", "trusted-transport-callback", "callback-replay-ledger", "redacted-production-configuration-gate", "simulation-isolation", "formal-job-state-projection", "job-result-ledger-cross-check", "dead-letter-state-projection", "redacted-operations", "versioned-parameters", "impact-analysis"] },
    { id: "special-case", label: "特例单议", ready: checkById(diseasePayment, "special-case") && checkById(diseasePayment, "special-case-appeal"), evidence: ["digest-only-evidence", "expert-avoidance", "dual-review", "original-review-state-projection", "decision-bound-appeal", "fresh-appeal-panel", "appeal-review-state-projection", "appeal-sla", "settlement-binding", "privacy-disclosure"] },
    { id: "monthly-settlement", label: "月度结算", ready: checkById(diseasePayment, "settlement") && checkById(diseasePayment, "settlement-sla") && checkById(diseasePayment, "settlement-difference-governance"), evidence: ["frozen-batch", "30-working-day-sla", "digest-bound-difference-evidence", "dual-domain-difference-resolution", "difference-state-projection", "payment-receipt"] },
    { id: "annual-clearance", label: "年度清算", ready: checkById(diseasePayment, "annual-clearance") && checkById(diseasePayment, "annual-clearance-institution-confirmation"), evidence: ["per-institution-confirmation", "institution-bound-dispute", "aggregate-confirmation-digest", "adjustment-fund", "retained-balance", "risk-reserve", "finance-posting", "locked-ledger", "clearance-state-projection"] }
  ];
  const externalBlockers = [...diseasePaymentExternalEvidence(diseasePayment.externalBlockers), ...financialGatewayExternalEvidence(financialGateway.blockers)];
  const externalEvidenceGoverned = externalBlockers.every((item) => item.owner && EXTERNAL_REVIEWER_ROLES.has(item.reviewerRole));
  const localReady = diseasePayment.ready && financialGateway.ok && operatingModel.ok && persistence.ready && workflows.every((item) => item.ready) && externalEvidenceGoverned;
  const report = {
    generatedAt: new Date().toISOString(),
    status: localReady ? "domain-ready-public-wiring-and-site-acceptance-pending" : "domain-incomplete",
    localReady,
    productionReady: false,
    summary: { workflows: workflows.length, workflowsReady: workflows.filter((item) => item.ready).length, persistenceContractReady: persistence.ready, t00RoutesPending: integrationHandoff.pending, externalBlockers: externalBlockers.length, externalEvidenceGoverned },
    workflows,
    persistence,
    operatingModel,
    integrationHandoff,
    externalBlockers
  };
  report.productionGate = buildAcceptanceProductionGate(report);
  return report;
}

function renderMarkdown(report) {
  return [
    "# T07 医保支付与按病种付费统一验收",
    "",
    `- 本地领域能力：${report.localReady ? "通过" : "未通过"}`,
    `- 生产就绪：${report.productionReady ? "是" : "否"}`,
    `- T00待接端点：${report.summary.t00RoutesPending}`,
    "",
    "| 主链 | 结果 | 验收证据 |",
    "|---|---|---|",
    ...report.workflows.map((item) => `| ${item.label} | ${item.ready ? "PASS" : "FAIL"} | ${item.evidence.join("、")} |`),
    "",
    "生产资格仍以真实凭据、正式规则、账单与回调联调、安全测评和现场签字证据为准。",
    ""
  ].join("\n");
}

function parseArgs(argv = process.argv.slice(2)) {
  return Object.fromEntries(argv.filter((item) => item.startsWith("--")).map((item) => {
    const [key, ...value] = item.slice(2).split("=");
    return [key, value.length ? value.join("=") : true];
  }));
}

function shouldFailAcceptance(report = {}, args = {}) {
  return report.localReady !== true || (args["require-production"] === true && report.productionGate?.passed !== true);
}

if (require.main === module) {
  const args = parseArgs();
  const report = buildInsurancePaymentAcceptance();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (shouldFailAcceptance(report, args)) process.exitCode = 1;
}

module.exports = { FINANCIAL_GATEWAY_EVIDENCE_POLICY, buildAcceptanceProductionGate, buildInsurancePaymentAcceptance, buildPersistenceAcceptance, diseasePaymentExternalEvidence, financialGatewayExternalEvidence, parseArgs, renderMarkdown, shouldFailAcceptance };
