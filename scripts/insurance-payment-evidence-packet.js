#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { buildInsurancePaymentAcceptance } = require("./insurance-payment-acceptance");

const ROOT = path.resolve(__dirname, "..");
const EVIDENCE_FILES = Object.freeze([
  "disease-payment-grouper-contract.js",
  "disease-payment-settlement.js",
  "disease-payment-special-case.js",
  "online-payment-refunds.js",
  "insurance-payment-operating-model.js",
  "scripts/insurance-payment-acceptance.js"
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

function buildInsurancePaymentEvidencePacket(options = {}) {
  const acceptance = options.acceptance || buildInsurancePaymentAcceptance();
  const generatedAt = options.generatedAt || new Date().toISOString();
  const artifacts = EVIDENCE_FILES.map((relativePath) => {
    const source = fs.readFileSync(path.join(ROOT, relativePath));
    return { path: relativePath, sha256: sha256(source), bytes: source.length };
  });
  const packet = {
    schema: "insurance-payment-acceptance-evidence-v1",
    generatedAt,
    domainOwner: "T07",
    integrationOwner: "T00",
    status: acceptance.status,
    localReady: acceptance.localReady,
    productionReady: false,
    summary: acceptance.summary,
    workflows: acceptance.workflows.map((item) => ({ id: item.id, label: item.label, ready: item.ready, evidence: item.evidence })),
    responsibilityChecks: acceptance.operatingModel.checks,
    t00PendingRoutes: acceptance.integrationHandoff.routes.filter((item) => !item.wired).map((item) => ({ id: item.id, method: item.method, path: item.path, handler: item.handler || item.handlers })),
    externalBlockers: acceptance.externalBlockers,
    artifacts,
    validationCommands: [
      "node --test test/disease-payment*.test.js test/financial*.test.js test/insurance-payment*.test.js",
      "node scripts/insurance-payment-acceptance.js"
    ],
    boundary: "The packet proves local domain behavior and handoff completeness only. Production readiness requires real provider credentials, callbacks, statements, security assessment and signed site acceptance."
  };
  return { ...packet, packetDigest: `sha256:${sha256(stableStringify(packet))}` };
}

function verifyInsurancePaymentEvidencePacket(packet = {}) {
  return /^sha256:[a-f0-9]{64}$/.test(String(packet.packetDigest || "")) && packet.packetDigest === `sha256:${sha256(stableStringify(packetPayload(packet)))}`;
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
  return Object.fromEntries(argv.filter((item) => item.startsWith("--") && item.includes("=")).map((item) => {
    const [key, ...value] = item.slice(2).split("=");
    return [key, value.join("=")];
  }));
}

if (require.main === module) {
  const args = parseArgs();
  const packet = buildInsurancePaymentEvidencePacket();
  if (args.output) fs.writeFileSync(path.resolve(ROOT, args.output), `${JSON.stringify(packet, null, 2)}\n`, "utf8");
  if (args.markdown) fs.writeFileSync(path.resolve(ROOT, args.markdown), renderMarkdown(packet), "utf8");
  process.stdout.write(`${JSON.stringify({ packetDigest: packet.packetDigest, localReady: packet.localReady, productionReady: packet.productionReady, workflows: packet.workflows.length, t00PendingRoutes: packet.t00PendingRoutes.length, externalBlockers: packet.externalBlockers.length }, null, 2)}\n`);
  if (!packet.localReady || !verifyInsurancePaymentEvidencePacket(packet)) process.exitCode = 1;
}

module.exports = { EVIDENCE_FILES, buildInsurancePaymentEvidencePacket, packetPayload, parseArgs, renderMarkdown, sha256, stableStringify, verifyInsurancePaymentEvidencePacket };
