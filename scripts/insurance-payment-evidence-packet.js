#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { buildInsurancePaymentAcceptance } = require("./insurance-payment-acceptance");
const Handoff = require("../insurance-payment-production-handoff");

const ROOT = path.resolve(__dirname, "..");
const EVIDENCE_FILES = Object.freeze([
  "disease-payment-grouper-contract.js",
  "disease-payment-service.js",
  "disease-payment-settlement.js",
  "disease-payment-special-case.js",
  "online-payment-refunds.js",
  "insurance-payment-operating-model.js",
  "insurance-payment-production-handoff.js",
  "docs/t07-insurance-payment-t00-handoff.md",
  "scripts/insurance-payment-acceptance.js",
  "scripts/insurance-payment-evidence-packet.js",
  "test/insurance-payment-production-handoff.test.js",
  "test/insurance-payment-evidence-packet.test.js",
  "test/insurance-payment-acceptance.test.js"
]);

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function packetPayload(packet = {}) {
  const { packetDigest: _packetDigest, ...payload } = packet;
  return payload;
}

function buildEvidenceProductionGate(packet = {}) {
  const handoff = packet.productionHandoff || {};
  const checks = [
    { id: "local-domain-ready", passed: packet.localReady === true, detail: `${packet.workflows?.filter((item) => item.ready).length || 0}/${packet.workflows?.length || 0} workflows ready` },
    { id: "evidence-artifact-manifest-valid", passed: verifyArtifactManifest(packet.artifacts), detail: `${packet.artifacts?.length || 0}/${EVIDENCE_FILES.length} artifacts verified` },
    { id: "t00-public-wiring-complete", passed: (packet.t00PendingRoutes?.length || 0) === 0, detail: `${packet.t00PendingRoutes?.length || 0} routes pending` },
    { id: "handoff-ledger-valid", passed: handoff.ledgerValid === true, detail: handoff.ledgerValid === true ? "handoff ledger valid" : "handoff ledger invalid" },
    { id: "handoff-evidence-complete", passed: handoff.evidenceComplete === true, detail: `${handoff.summary?.verified || 0}/${handoff.summary?.required || 0} requirements verified` },
    { id: "live-site-acceptance-confirmed", passed: handoff.productionReady === true, detail: handoff.productionReady === true ? "live acceptance confirmed" : "live access and signed site acceptance pending" }
  ];
  return {
    passed: checks.every((item) => item.passed),
    blockers: checks.filter((item) => !item.passed).map((item) => item.id),
    checks
  };
}

function buildInsurancePaymentEvidencePacket(options = {}) {
  const acceptance = options.acceptance || buildInsurancePaymentAcceptance();
  const generatedAt = options.generatedAt || new Date().toISOString();
  const productionHandoff = Handoff.buildProductionHandoffStatus(options.handoffData || {}, acceptance, generatedAt);
  const artifacts = EVIDENCE_FILES.map((relativePath) => {
    const source = fs.readFileSync(path.join(ROOT, relativePath));
    return { path: relativePath, sha256: sha256(source), bytes: source.length };
  });
  const t00PendingRoutes = acceptance.integrationHandoff.routes.filter((item) => !item.wired).map((item) => ({ id: item.id, method: item.method, path: item.path, handler: item.handler || item.handlers }));
  const packet = {
    schema: "insurance-payment-acceptance-evidence-v1",
    generatedAt,
    domainOwner: "T07",
    integrationOwner: "T00",
    status: acceptance.status,
    localReady: acceptance.localReady,
    productionReady: acceptance.productionReady === true && productionHandoff.productionReady === true && t00PendingRoutes.length === 0,
    summary: acceptance.summary,
    workflows: acceptance.workflows.map((item) => ({ id: item.id, label: item.label, ready: item.ready, evidence: item.evidence })),
    responsibilityChecks: acceptance.operatingModel.checks,
    productionHandoff,
    t00PendingRoutes,
    externalBlockers: acceptance.externalBlockers,
    artifacts,
    validationCommands: [
      "node --test test/disease-payment*.test.js test/financial*.test.js test/insurance-payment*.test.js",
      "node scripts/insurance-payment-acceptance.js"
    ],
    boundary: "The packet proves local domain behavior and handoff completeness only. Production readiness requires real provider credentials, callbacks, statements, security assessment and signed site acceptance."
  };
  packet.productionGate = buildEvidenceProductionGate(packet);
  return { ...packet, packetDigest: `sha256:${sha256(stableStringify(packet))}` };
}

function verifyArtifactManifest(artifacts = [], artifactRoot = ROOT) {
  if (!Array.isArray(artifacts) || artifacts.length !== EVIDENCE_FILES.length) return false;
  const resolvedRoot = path.resolve(artifactRoot);
  return artifacts.every((artifact, index) => {
    const expectedPath = EVIDENCE_FILES[index];
    if (!artifact || artifact.path !== expectedPath || !/^[a-f0-9]{64}$/.test(String(artifact.sha256 || "")) || !Number.isSafeInteger(artifact.bytes) || artifact.bytes < 0) return false;
    const absolutePath = path.resolve(resolvedRoot, expectedPath);
    const relativePath = path.relative(resolvedRoot, absolutePath);
    if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) return false;
    try {
      const source = fs.readFileSync(absolutePath);
      return artifact.bytes === source.length && artifact.sha256 === sha256(source);
    } catch {
      return false;
    }
  });
}

function verifyInsurancePaymentEvidencePacket(packet = {}, options = {}) {
  const digestValid = /^sha256:[a-f0-9]{64}$/.test(String(packet.packetDigest || ""))
    && packet.packetDigest === `sha256:${sha256(stableStringify(packetPayload(packet)))}`;
  return digestValid && verifyArtifactManifest(packet.artifacts, options.artifactRoot || ROOT);
}

function renderMarkdown(packet) {
  return [
    "# T07 医保支付与按病种付费验收证据包",
    "",
    `- 证据包摘要：${packet.packetDigest}`,
    `- 本地领域能力：${packet.localReady ? "通过" : "未通过"}`,
    `- 生产就绪：${packet.productionReady ? "是" : "否"}`,
    `- T00待接项：${packet.t00PendingRoutes.length}`,
    `- 外部阻断项：${packet.externalBlockers.length}`,
    "",
    "| 主链 | 结果 |",
    "|---|---|",
    ...packet.workflows.map((item) => `| ${item.label} | ${item.ready ? "PASS" : "FAIL"} |`),
    "",
    "## 文件证据",
    "",
    ...packet.artifacts.map((item) => `- \`${item.path}\`：\`sha256:${item.sha256}\`（${item.bytes} bytes）`),
    "",
    "## 生产边界",
    "",
    packet.boundary,
    ""
  ].join("\n");
}

function parseArgs(argv = process.argv.slice(2)) {
  return Object.fromEntries(argv.filter((item) => item.startsWith("--")).map((item) => {
    const [key, ...value] = item.slice(2).split("=");
    return [key, value.length ? value.join("=") : true];
  }));
}

function shouldFailEvidencePacket(packet = {}, args = {}) {
  return packet.localReady !== true
    || !verifyInsurancePaymentEvidencePacket(packet)
    || (args["require-production"] === true && packet.productionGate?.passed !== true);
}

if (require.main === module) {
  const args = parseArgs();
  const packet = buildInsurancePaymentEvidencePacket();
  if (args.output) fs.writeFileSync(path.resolve(ROOT, args.output), `${JSON.stringify(packet, null, 2)}\n`, "utf8");
  if (args.markdown) fs.writeFileSync(path.resolve(ROOT, args.markdown), renderMarkdown(packet), "utf8");
  process.stdout.write(`${JSON.stringify({ packetDigest: packet.packetDigest, localReady: packet.localReady, productionReady: packet.productionReady, workflows: packet.workflows.length, t00PendingRoutes: packet.t00PendingRoutes.length, externalBlockers: packet.externalBlockers.length }, null, 2)}\n`);
  if (shouldFailEvidencePacket(packet, args)) process.exitCode = 1;
}

module.exports = { EVIDENCE_FILES, buildEvidenceProductionGate, buildInsurancePaymentEvidencePacket, packetPayload, parseArgs, renderMarkdown, sha256, shouldFailEvidencePacket, stableStringify, verifyArtifactManifest, verifyInsurancePaymentEvidencePacket };
