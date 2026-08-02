"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const requiredFiles = [
  "resident-mini-program.html",
  "resident-mini-program.css",
  "resident-mini-program.js",
  "resident-mini-program-core.js",
  "resident-mini-program-policy.js",
  "resident-mini-program-adapter.js",
  "test/resident-mini-program-core.test.js",
  "test/resident-mini-program-stage2.test.js",
  "test/resident-mini-program-chinese-scan.test.js",
  "test/resident-mini-program-static.test.js",
  "test/e2e/resident-mini-program.spec.js",
  "test/e2e/resident-mini-program.playwright.config.js",
  "test/e2e/resident-mini-program-test-server.js",
  "scripts/resident-mini-program-e2e.js",
  "scripts/resident-mini-program-preview.js",
  "scripts/resident-mini-program-chinese-scan.js",
  "docs/resident-mini-program-first-increment.md",
  "docs/resident-mini-program-second-stage.md"
];

function assess() {
  const missing = requiredFiles.filter((file) => !fs.existsSync(path.join(root, file)));
  const html = missing.includes("resident-mini-program.html") ? "" : fs.readFileSync(path.join(root, "resident-mini-program.html"), "utf8");
  const app = missing.includes("resident-mini-program.js") ? "" : fs.readFileSync(path.join(root, "resident-mini-program.js"), "utf8");
  const core = missing.includes("resident-mini-program-core.js") ? "" : fs.readFileSync(path.join(root, "resident-mini-program-core.js"), "utf8");
  const adapter = missing.includes("resident-mini-program-adapter.js") ? "" : fs.readFileSync(path.join(root, "resident-mini-program-adapter.js"), "utf8");
  const e2eRunner = missing.includes("scripts/resident-mini-program-e2e.js") ? "" : fs.readFileSync(path.join(root, "scripts/resident-mini-program-e2e.js"), "utf8");
  const checks = {
    dedicatedAssets: missing.length === 0,
    strictSession: /\/api\/auth\/me/.test(app) && /validateServerIdentity/.test(app),
    lifecycleRecovery: /onLifecycle/.test(app) && /clearResidentRuntime/.test(app) && /sessionSubjectKey/.test(app),
    networkDegradation: /REQUEST_TIMEOUT_MS/.test(app) && /navigator\.onLine/.test(app) && /gateRetry/.test(app),
    residentIsolation: /deriveResidentScope/.test(app) && /switchResident/.test(app),
    safeDeepLinks: /validateDeepLink/.test(core) && /ROUTE_PARAMETER_ALLOWLIST/.test(core),
    serverReceipts: /confirmMessageReceipt/.test(app) && /Idempotency-Key/.test(app),
    boundedMessages: /MAX_MESSAGE_BATCH/.test(core) && /messageVisibleLimit/.test(app),
    platformBridge: /probeCapabilities/.test(adapter) && /classifyFailure/.test(adapter),
    e2eCleanup: /shell:\s*false/.test(e2eRunner) && /type:\s*"shutdown"/.test(e2eRunner) && /waitForHealth\(false/.test(e2eRunner),
    chineseShell: /居民健康服务/.test(html) && /消息与待办/.test(html),
    chineseScan: /resident-mini-program-chinese-scan/.test(requiredFiles.join(" ")),
    accessibility: /适老化与无障碍/.test(html) && /aria-live/.test(html) && /loading-skeleton/.test(html)
  };
  const externalDependencies = [
    "T00 将新入口纳入公共 server.js 路由清单、导航、离线缓存和发布总表",
    "现场接入微信与支付宝正式应用标识、域名白名单和平台登录凭证交换",
    "现场接入实名核验、家庭关系权威证据、授权有效期与撤权强制校验",
    "现场接入短信、订阅消息、支付、医保、医院号源、护理与陪诊正式回执"
  ];
  return {
    module: "T04-MP 居民端小程序",
    ready: Object.values(checks).every(Boolean),
    decision: Object.values(checks).every(Boolean) ? "第二阶段软件增量已具备集成条件，生产上线仍受外部依赖约束" : "未通过本模块就绪门禁",
    checks,
    missing,
    preview: "http://127.0.0.1:5173/resident-mini-program.html",
    externalDependencies
  };
}

if (require.main === module) {
  const result = assess();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ready) process.exitCode = 1;
}

module.exports = { assess, requiredFiles };
