#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const {
  createCipheriv,
  createDecipheriv,
  createHash,
  getCiphers,
  getCurves,
  getHashes,
  randomUUID
} = require("node:crypto");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT, "release", "commercial-crypto-readiness-report.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "commercial-crypto-readiness-report.md");

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function seedCommercialCryptoCapabilities() {
  return [
    {
      id: "cc-gm-tls",
      name: "国密 HTTPS 与传输保护",
      domain: "transport",
      adapterKind: "gm-tls-gateway",
      requiredPrimitives: ["SM2", "SM3", "SM4"],
      contract: "由通过检测的国密 SSL 网关或服务端组件终止国密 TLS，并保留证书链、套件和兼容性记录。",
      status: "contract-ready",
      owner: "平台技术组/安全管理",
      evidenceRefs: ["securityAcceptanceLedger:security-crypto"],
      blockers: ["certified GM TLS provider", "production certificate chain", "secure browser compatibility record"],
      onsiteVerification: "not-requested",
      productionReady: false,
      actionHistory: []
    },
    {
      id: "cc-signature-service",
      name: "电子签名与验签服务",
      domain: "signature",
      adapterKind: "signing-server",
      requiredPrimitives: ["SM2", "SM3"],
      contract: "对接签名验签服务器、时间戳服务和电子签章系统，业务系统仅保存签名标识与验证结果。",
      status: "contract-ready",
      owner: "安全管理/业务应用组",
      evidenceRefs: ["identity-contract.md"],
      blockers: ["signing server", "timestamp authority", "electronic seal approval"],
      onsiteVerification: "not-requested",
      productionReady: false,
      actionHistory: []
    },
    {
      id: "cc-data-encryption",
      name: "重要数据与数据库加密",
      domain: "data-at-rest",
      adapterKind: "kms-database-encryption",
      requiredPrimitives: ["SM4"],
      contract: "通过密码机、KMS 或数据库透明加密保护重要数据，应用侧不持久化生产明文密钥。",
      status: "contract-ready",
      owner: "数据管理/安全管理",
      evidenceRefs: ["production-database-cutover-center.md"],
      blockers: ["production KMS or crypto appliance", "key custody procedure", "encrypted backup verification"],
      onsiteVerification: "not-requested",
      productionReady: false,
      actionHistory: []
    },
    {
      id: "cc-audit-integrity",
      name: "审计日志完整性保护",
      domain: "audit-integrity",
      adapterKind: "sm3-timestamp-worm",
      requiredPrimitives: ["SM3"],
      contract: "在现有审计哈希链外接 SM3、可信时间戳与不可改写归档，并验证抽样恢复和链路连续性。",
      status: "contract-ready",
      owner: "安全管理/运维中心",
      evidenceRefs: ["audit-retention-report.md", "securityAcceptanceLedger:security-level3"],
      blockers: ["trusted timestamp service", "WORM archive", "signed retention policy"],
      onsiteVerification: "not-requested",
      productionReady: false,
      actionHistory: []
    },
    {
      id: "cc-ca-usbkey",
      name: "CA 身份认证与 USBKey",
      domain: "identity",
      adapterKind: "ca-usbkey",
      requiredPrimitives: ["SM2", "SM3"],
      contract: "统一认证接入机构 CA、人员证书和 USBKey，完成证书生命周期、吊销状态和岗位授权映射。",
      status: "contract-ready",
      owner: "统一认证组/安全管理",
      evidenceRefs: ["identity-source-mapping"],
      blockers: ["CA trust agreement", "USBKey device selection", "certificate revocation integration"],
      onsiteVerification: "not-requested",
      productionReady: false,
      actionHistory: []
    },
    {
      id: "cc-secure-browser",
      name: "安全浏览器与终端兼容",
      domain: "client-compatibility",
      adapterKind: "secure-browser-bridge",
      requiredPrimitives: ["SM2", "SM3", "SM4"],
      contract: "验证国密浏览器、USBKey 中间件和签章控件的版本矩阵、升级策略及业务页面兼容性。",
      status: "contract-ready",
      owner: "终端运维/安全管理",
      evidenceRefs: ["environment-matrix-report.md"],
      blockers: ["secure browser procurement", "middleware compatibility matrix", "managed endpoint pilot"],
      onsiteVerification: "not-requested",
      productionReady: false,
      actionHistory: []
    }
  ];
}

function seedCommercialCryptoEvidencePackets() {
  return [
    {
      id: "cc-evidence-runtime-contract",
      capabilityId: "all",
      type: "adapter-contract",
      reference: "docs/commercial-crypto-adapter-center.md",
      note: "能力合同和生产边界已建档。",
      status: "demo-evidence",
      recordedAt: "2026-07-10T00:00:00.000Z",
      recordedBy: "platform-seed",
      productionEvidence: false
    },
    {
      id: "cc-evidence-security-ledger",
      capabilityId: "all",
      type: "existing-ledger",
      reference: "securityAcceptanceLedger",
      note: "复用等保、密评和国密改造验收台账。",
      status: "demo-evidence",
      recordedAt: "2026-07-10T00:00:00.000Z",
      recordedBy: "platform-seed",
      productionEvidence: false
    }
  ];
}

function mergeRows(defaultRows, currentRows, key = "id") {
  const merged = new Map();
  (Array.isArray(defaultRows) ? defaultRows : []).forEach((item) => merged.set(item[key], item));
  (Array.isArray(currentRows) ? currentRows : []).forEach((item) => {
    if (!item?.[key]) return;
    merged.set(item[key], { ...(merged.get(item[key]) || {}), ...item });
  });
  return [...merged.values()];
}

function probeCommercialCryptoRuntime(options = {}) {
  const hashes = (options.hashes || getHashes()).map((item) => String(item).toLowerCase());
  const ciphers = (options.ciphers || getCiphers()).map((item) => String(item).toLowerCase());
  const curves = (options.curves || getCurves()).map((item) => String(item).toLowerCase());
  const sm3Available = hashes.includes("sm3");
  const sm4Cipher = ["sm4-cbc", "sm4-ctr", "sm4-ecb"].find((item) => ciphers.includes(item)) || "";
  const sm2Available = curves.includes("sm2");
  let sm3SelfTest = { passed: false, detail: sm3Available ? "not-run" : "algorithm-unavailable" };
  let sm4SelfTest = { passed: false, detail: sm4Cipher || "algorithm-unavailable" };
  if (sm3Available) {
    try {
      const digest = createHash("sm3").update("abc").digest("hex");
      sm3SelfTest = {
        passed: digest === "66c7f0f462eeedd9d1f2d46bdc10e4e24167c4875cf2f7a2297da02b8f4ba8e0",
        detail: `known-answer:${digest.slice(0, 16)}`
      };
    } catch (error) {
      sm3SelfTest = { passed: false, detail: error.message };
    }
  }
  if (sm4Cipher) {
    try {
      const key = Buffer.alloc(16, 0x11);
      const iv = sm4Cipher.endsWith("ecb") ? null : Buffer.alloc(16, 0x22);
      const cipher = createCipheriv(sm4Cipher, key, iv);
      const encrypted = Buffer.concat([cipher.update("commercial-crypto-runtime-probe", "utf8"), cipher.final()]);
      const decipher = createDecipheriv(sm4Cipher, key, iv);
      const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
      sm4SelfTest = { passed: decrypted === "commercial-crypto-runtime-probe", detail: `${sm4Cipher}:round-trip` };
    } catch (error) {
      sm4SelfTest = { passed: false, detail: error.message };
    }
  }
  const primitives = [
    { id: "SM2", available: sm2Available, selfTestPassed: false, evidence: sm2Available ? "OpenSSL curve registry only; signing operation not exercised" : "curve unavailable" },
    { id: "SM3", available: sm3Available, selfTestPassed: sm3SelfTest.passed, evidence: sm3SelfTest.detail },
    { id: "SM4", available: Boolean(sm4Cipher), selfTestPassed: sm4SelfTest.passed, evidence: sm4SelfTest.detail }
  ];
  return {
    probedAt: new Date().toISOString(),
    runtime: `${process.release.name} ${process.version}`,
    openssl: process.versions.openssl || "unknown",
    primitives,
    availablePrimitives: primitives.filter((item) => item.available).map((item) => item.id),
    passedSelfTests: primitives.filter((item) => item.selfTestPassed).length,
    caveat: "Runtime primitive availability is compatibility evidence only. It is not product certification, key-management validation or a commercial-crypto assessment conclusion."
  };
}

function buildCommercialCryptoCenter(data = {}, options = {}) {
  const capabilities = mergeRows(seedCommercialCryptoCapabilities(), data.commercialCryptoCapabilities).map((item) => ({
    ...item,
    evidenceRefs: Array.from(new Set(Array.isArray(item.evidenceRefs) ? item.evidenceRefs : [])),
    productionReady: false
  }));
  const probeRuns = Array.isArray(data.commercialCryptoProbeRuns) ? data.commercialCryptoProbeRuns : [];
  const evidencePackets = mergeRows(seedCommercialCryptoEvidencePackets(), data.commercialCryptoEvidencePackets);
  const runtimeProbe = options.runtimeProbe || probeCommercialCryptoRuntime(options.runtimeOptions);
  const available = new Set(runtimeProbe.availablePrimitives);
  const capabilityViews = capabilities.map((item) => ({
    ...item,
    runtimeCompatibility: item.requiredPrimitives.every((primitive) => available.has(primitive)) ? "runtime-compatible" : "runtime-partial",
    missingRuntimePrimitives: item.requiredPrimitives.filter((primitive) => !available.has(primitive))
  }));
  const onsiteBlockers = [
    "certified commercial-crypto products and supplier qualification",
    "production CA certificates, USBKey and signing/timestamp services",
    "production key generation, custody, rotation, recovery and destruction procedure",
    "database encryption, backup recovery and audit archive onsite verification",
    "third-party commercial-crypto assessment report and rectification signoff"
  ];
  return {
    ok: capabilityViews.length === 6 && capabilityViews.every((item) => item.productionReady === false),
    status: "adapter-center-ready-procurement-blocked",
    summary: {
      capabilities: capabilityViews.length,
      contractsReady: capabilityViews.filter((item) => /contract-ready|runtime-probe-recorded|evidence-recorded|onsite-requested/.test(item.status)).length,
      runtimeCompatible: capabilityViews.filter((item) => item.runtimeCompatibility === "runtime-compatible").length,
      primitiveAvailability: runtimeProbe.availablePrimitives.length,
      probeRuns: probeRuns.length,
      evidencePackets: evidencePackets.length,
      onsiteRequested: capabilityViews.filter((item) => item.onsiteVerification === "requested").length,
      productionReady: 0,
      onsiteBlockers: onsiteBlockers.length
    },
    capabilities: capabilityViews,
    runtimeProbe,
    probeRuns,
    evidencePackets,
    onsiteBlockers,
    boundary: "The adapter center records contracts, runtime compatibility and evidence workflow only. Production use remains blocked until certified products, production keys and certificates, onsite verification and an official third-party assessment are complete."
  };
}

const ACTIONS = new Set(["run-runtime-probe", "record-evidence", "request-onsite"]);

function applyCommercialCryptoAction(item, payload = {}, user = {}, options = {}) {
  const action = String(payload.action || "").trim();
  const note = String(payload.note || "").trim();
  const evidenceRef = String(payload.evidenceRef || "").trim();
  if (!ACTIONS.has(action)) throw new Error("unsupported commercial crypto action");
  if (!note) throw new Error("commercial crypto action requires note");
  if (action === "record-evidence" && !evidenceRef) throw new Error("commercial crypto evidence action requires evidenceRef");
  const at = new Date().toISOString();
  const actor = user.name || user.username || user.role || "commission";
  let status = item.status || "contract-ready";
  let probeRun = null;
  let evidencePacket = null;
  if (action === "run-runtime-probe") {
    const runtimeProbe = options.runtimeProbe || probeCommercialCryptoRuntime(options.runtimeOptions);
    status = "runtime-probe-recorded";
    probeRun = {
      id: randomUUID(),
      capabilityId: item.id,
      action,
      note,
      actor,
      at,
      runtime: runtimeProbe.runtime,
      openssl: runtimeProbe.openssl,
      primitives: runtimeProbe.primitives,
      productionEvidence: false,
      caveat: runtimeProbe.caveat
    };
  }
  if (action === "record-evidence") {
    status = "evidence-recorded";
    evidencePacket = {
      id: randomUUID(),
      capabilityId: item.id,
      type: "operator-evidence-reference",
      reference: evidenceRef,
      note,
      status: "pending-onsite-validation",
      recordedAt: at,
      recordedBy: actor,
      productionEvidence: false
    };
  }
  if (action === "request-onsite") status = "onsite-requested";
  const history = {
    id: randomUUID(),
    at,
    action,
    note,
    evidenceRef,
    actor,
    role: user.role || "commission",
    fromStatus: item.status || "contract-ready",
    toStatus: status,
    productionReady: false
  };
  const updated = {
    ...item,
    status,
    onsiteVerification: action === "request-onsite" ? "requested" : item.onsiteVerification || "not-requested",
    evidenceRefs: evidenceRef ? Array.from(new Set([...(item.evidenceRefs || []), evidenceRef])) : item.evidenceRefs || [],
    lastProbeRunId: probeRun?.id || item.lastProbeRunId || "",
    updatedAt: at,
    updatedBy: actor,
    productionReady: false,
    actionHistory: [history, ...(Array.isArray(item.actionHistory) ? item.actionHistory : [])].slice(0, 20)
  };
  return { item: updated, history, probeRun, evidencePacket };
}

function check(id, passed, detail) {
  return { id, passed: Boolean(passed), detail };
}

function clean(value) {
  return String(value ?? "").replace(/\|/g, "/");
}

function buildCommercialCryptoReadiness(options = {}) {
  const data = options.data ?? readJson("data/db.json");
  const pkg = options.pkg ?? readJson("package.json");
  const serverSource = options.serverSource ?? readText("server.js");
  const platformSource = options.platformSource ?? readText("platform.js");
  const platformHtml = options.platformHtml ?? readText("platform.html");
  const documentation = options.documentation ?? readText(path.join("docs", "commercial-crypto-adapter-center.md"));
  const manifestSource = options.manifestSource ?? readText(path.join("scripts", "release-artifact-manifest.js"));
  const deployCheckSource = options.deployCheckSource ?? readText(path.join("scripts", "deploy-check.js"));
  const releaseReportSource = options.releaseReportSource ?? readText(path.join("scripts", "release-report.js"));
  const center = buildCommercialCryptoCenter(data, options);
  const checks = [
    check("commercialCrypto:contracts", center.summary.capabilities === 6 && center.summary.contractsReady === 6, `${center.summary.contractsReady}/${center.summary.capabilities} adapter contracts ready`),
    check("commercialCrypto:runtime-probe", center.runtimeProbe.primitives.length === 3 && center.runtimeProbe.primitives.every((item) => typeof item.available === "boolean"), `${center.summary.primitiveAvailability}/3 primitives reported by ${center.runtimeProbe.runtime}`),
    check("commercialCrypto:evidence-ledger", center.evidencePackets.length >= 2 && center.capabilities.every((item) => item.evidenceRefs.length > 0), `${center.evidencePackets.length} evidence packets and capability references`),
    check("commercialCrypto:production-boundary", center.summary.productionReady === 0 && center.capabilities.every((item) => item.productionReady === false) && center.onsiteBlockers.length >= 5, `production ready 0 / ${center.onsiteBlockers.length} onsite blockers`),
    check("commercialCrypto:runtime-api", ["/api/commercial-crypto/center", "commercial-crypto-action"].every((marker) => serverSource.includes(marker)), "commission center API and audited actions are wired"),
    check("commercialCrypto:platform-ui", platformHtml.includes("commercial-crypto-center") && platformSource.includes("renderCommercialCryptoCenter") && platformSource.includes("data-commercial-crypto-action"), "platform adapter center is visible and actionable"),
    check("commercialCrypto:documentation", ["runtime compatibility", "production approval", "/api/commercial-crypto/center", "USBKey"].every((marker) => documentation.includes(marker)), "contracts, APIs and production boundary are documented"),
    check("commercialCrypto:release-wiring", Boolean(pkg.scripts?.["security:commercial-crypto-readiness"]) && manifestSource.includes("commercial-crypto-readiness-report.md") && deployCheckSource.includes("commercialCryptoReadiness") && releaseReportSource.includes("commercialCrypto"), "package script, manifest, deploy check and release report are wired")
  ];
  return { ...center, generatedAt: new Date().toISOString(), checks, ok: checks.every((item) => item.passed) };
}

function renderMarkdown(report) {
  return [
    "# Commercial crypto adapter center readiness report",
    "",
    `- Generated at: ${report.generatedAt}`,
    `- Result: ${report.ok ? "PASS" : "FAIL"}`,
    `- Adapter contracts: ${report.summary.contractsReady}/${report.summary.capabilities}`,
    `- Runtime-compatible contracts: ${report.summary.runtimeCompatible}`,
    `- Runtime primitives available: ${report.summary.primitiveAvailability}/3`,
    `- Production ready: ${report.summary.productionReady}`,
    "",
    "## Checks",
    "",
    "| Result | Check | Detail |",
    "|---|---|---|",
    ...report.checks.map((item) => `| ${item.passed ? "PASS" : "FAIL"} | ${item.id} | ${clean(item.detail)} |`),
    "",
    "## Runtime compatibility probe",
    "",
    `- Runtime: ${clean(report.runtimeProbe.runtime)}`,
    `- OpenSSL: ${clean(report.runtimeProbe.openssl)}`,
    ...report.runtimeProbe.primitives.map((item) => `- ${item.id}: available=${item.available}; self-test=${item.selfTestPassed}; evidence=${clean(item.evidence)}`),
    `- Caveat: ${report.runtimeProbe.caveat}`,
    "",
    "## Capability contracts",
    "",
    "| Capability | Adapter | Required primitives | Runtime | Status | Production ready |",
    "|---|---|---|---|---|---|",
    ...report.capabilities.map((item) => `| ${clean(item.name)} | ${clean(item.adapterKind)} | ${clean(item.requiredPrimitives.join(", "))} | ${item.runtimeCompatibility} | ${item.status} | no |`),
    "",
    "## Production boundary",
    "",
    report.boundary,
    "",
    ...report.onsiteBlockers.map((item) => `- ${item}`),
    ""
  ].join("\n");
}

function parseArgs(argv = process.argv.slice(2)) {
  const flags = {};
  argv.forEach((flag) => {
    if (!flag.startsWith("--")) return;
    const [key, ...rest] = flag.slice(2).split("=");
    flags[key] = rest.length ? rest.join("=") : true;
  });
  return flags;
}

function writeOutput(report, flags = {}) {
  const output = path.resolve(ROOT, String(flags.output || DEFAULT_OUTPUT));
  const markdown = path.resolve(ROOT, String(flags.markdown || DEFAULT_MARKDOWN));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2), "utf8");
  fs.writeFileSync(markdown, renderMarkdown(report), "utf8");
}

function runCli() {
  const flags = parseArgs();
  const report = buildCommercialCryptoReadiness();
  if (flags.write !== "false" && flags.write !== false) writeOutput(report, flags);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}

if (require.main === module) {
  try {
    runCli();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  applyCommercialCryptoAction,
  buildCommercialCryptoCenter,
  buildCommercialCryptoReadiness,
  parseArgs,
  probeCommercialCryptoRuntime,
  renderMarkdown,
  seedCommercialCryptoCapabilities,
  seedCommercialCryptoEvidencePackets,
  writeOutput
};
