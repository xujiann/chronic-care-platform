#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");

function readText(root, relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function evidenceValue(value) {
  const text = String(value || "").trim();
  if (!text || /replace|example|demo|localhost|127\.0\.0\.1/i.test(text)) return "";
  return text;
}

function assessCitizenRecordsReadiness(options = {}) {
  const root = options.root || ROOT;
  const env = options.env || process.env;
  const supplied = options.files || {};
  const file = (relativePath) => supplied[relativePath] ?? readText(root, relativePath);
  const v1 = file("citizen-records-v1.js");
  const v2 = file("citizen-records-v2.js");
  const v3 = file("citizen-records-v3.js");
  const policy = file("citizen-records-policy.js");
  const html = file("citizen.html");
  const ui = file("citizen.js");
  const uiZh = file("citizen-ui-zh.js");
  const css = file("citizen.css");
  const documentation = file("docs/citizen-records-first-increment.md");
  const unit = file("test/citizen-records-v2.test.js");
  const nextStageUnit = file("test/citizen-records-v3.test.js");
  const policyTest = file("test/citizen-records-policy.test.js");
  const e2e = file("test/e2e/citizen-records-v1.spec.js");
  const server = file("server.js");
  const serviceWorker = file("service-worker.js");

  const softwareChecks = [
    { id: "resident-projection", label: "居民数据最小化投影", passed: /function projectRecord/.test(v1) && /SAFE_META_FIELDS/.test(v1) },
    { id: "authorization-fail-closed", label: "授权状态与范围 fail-closed", passed: /ACTIVE_AUTHORIZATION_STATUSES/.test(v1) && /authorizationState/.test(v1) && /authorizationAllowsScope/.test(v2) },
    { id: "authorization-write-trust", label: "授权创建与撤销响应信任边界", passed: /projectAuthorizationCreateResponse/.test(v2) && /projectAuthorizationRevocationResponse/.test(v2) && /authorization-create/.test(ui) && /authorization-revoke/.test(ui) },
    { id: "authorization-receipt-ledger", label: "授权操作回执按居民核验", passed: /buildAuthorizationReceiptLedger/.test(v2) && /creationReceiptId/.test(v1) && /revocationReceiptId/.test(v1) && /citizen-authorization-receipt-summary/.test(html) && /receipt-auth-renew-e2e/.test(e2e) },
    { id: "authorization-receipt-export", label: "授权回执证据最小化导出", passed: /buildAuthorizationReceiptExportRows/.test(v2) && /data-export-authorization-receipts/.test(html) && /exportCitizenAuthorizationReceipts/.test(ui) && /'=HYPERLINK/.test(e2e) },
    { id: "portable-record-export", label: "居民健康档案最小化可携带副本", passed: /buildResidentPortableArchive/.test(v2) && /sealResidentPortableArchive/.test(v2) && /parseResidentPortableArchive/.test(v2) && /verifyResidentPortableArchive/.test(v2) && /health-record-verify-file/.test(html) && /verifyCitizenHealthRecordFile/.test(ui) && /完整性校验失败/.test(e2e) },
    { id: "authorization-status-consistency", label: "居民端有效授权统计与提醒一致", passed: /getAuthorizationLifecycle/.test(ui) && /pending", "rejected", "suspended/.test(unit) && /1\/4 条有效授权/.test(e2e) },
    { id: "authorization-calendar-boundary", label: "授权有效期自然日边界一致", passed: /authorizationExpiryDate/.test(v2) && /calendarDayDistance/.test(v2) && /day-30/.test(unit) && /day-31/.test(unit) },
    { id: "controlled-access", label: "原文影像附件短时受控调阅", passed: /validateControlledCredential/.test(v2) && /oneTime/.test(v2) && /ttlSeconds/.test(v2) },
    { id: "resident-search", label: "居民范围档案检索", passed: /filterResidentRecords/.test(v2) && /vault-search-keyword/.test(html) },
    { id: "consent-disclosure", label: "授权范围影响说明", passed: /buildAuthorizationScopeDisclosure/.test(v2) && /auth-scope-preview/.test(html) },
    { id: "privacy-review", label: "访问复核确认异议与最小化导出", passed: /buildAccessReviewQueue/.test(v2) && /buildAccessDispute/.test(v2) && /buildAccessExportRows/.test(v2) },
    { id: "server-policy-contract", label: "服务端授权策略契约", passed: /evaluateCitizenRecordAccess/.test(policy) && /buildCitizenControlledAccessIntent/.test(policy) },
    { id: "negative-policy-tests", label: "非激活授权与跨居民负向测试", passed: /pending rejected or suspended/.test(policyTest) && /cross-resident|resident scoped/.test(`${unit}\n${policyTest}`) },
    { id: "resident-journey-e2e", label: "居民创建撤销续授权与检索旅程", passed: /idempotency-key/.test(e2e) && /auth-scope-preview/.test(e2e) && /vault-search-keyword/.test(e2e) },
    { id: "chinese-only-interface", label: "居民端全中文展示与内部面板隐藏", passed: /translateVisibleText/.test(uiZh) && /MutationObserver/.test(uiZh) && /\[data-internal-launch-panel\]\[hidden\]/.test(css) && /English business copy/.test(e2e) },
    { id: "next-stage-eight-capabilities", label: "居民健康档案八项增强服务", passed: /buildNextStageWorkspace/.test(v3) && /生产接入状态只接受/.test(nextStageUnit) && /citizen-operations-v3/.test(html) },
    { id: "next-stage-action-intents", label: "八项增强服务安全操作闭环", passed: /buildSafeActionIntent/.test(v3) && /handleCitizenRecordsV3Action/.test(ui) && /紧急和家庭授权草稿保持最小范围/.test(nextStageUnit) && /准备紧急授权/.test(e2e) },
    { id: "acceptance-documentation", label: "居民验收标准与外部依赖", passed: /第二十三增量/.test(documentation) && /## 外部依赖/.test(documentation) }
  ];

  const integrationChecks = [
    {
      id: "t00-policy-wiring",
      label: "T00 公共服务端接入居民授权策略",
      passed: /citizen-records-policy/.test(server) && /evaluateCitizenRecordAccess/.test(server)
    },
    {
      id: "t00-workspace-routes",
      label: "T00 公共服务端接入持续照护写入与同步接口",
      passed: ["record-care-workspace", "record-corrections", "record-share-packages"].every((route) => server.includes(route))
    },
    {
      id: "t00-pwa-cache",
      label: "T00 Service Worker 缓存当前居民脚本版本",
      passed: /citizen-records-v2\.js\?v=20260725care16/.test(serviceWorker) && /citizen-records-v3\.js\?v=20260727next3/.test(serviceWorker) && /citizen\.js\?v=20260727next2/.test(serviceWorker)
    }
  ];

  const externalChecks = [
    {
      id: "identity-provider",
      label: "真实居民身份提供方",
      passed: ["OIDC_ISSUER_URL", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET"].every((key) => evidenceValue(env[key]))
    },
    {
      id: "clinical-connectors",
      label: "HIS/EMR/LIS/PACS 正式连接器",
      passed: ["HIS_ADAPTER_URL", "EMR_ADAPTER_URL", "LIS_ADAPTER_URL", "PACS_ADAPTER_URL"].every((key) => evidenceValue(env[key]))
    },
    {
      id: "object-storage",
      label: "对象存储网关与签名密钥",
      passed: ["OBJECT_STORAGE_GATEWAY_URL", "OBJECT_STORAGE_BUCKET", "OBJECT_STORAGE_SIGNING_SECRET"].every((key) => evidenceValue(env[key]))
    },
    {
      id: "audit-retention",
      label: "统一审计或 SIEM 留存目标",
      passed: Boolean(evidenceValue(env.AUDIT_EXPORT_PATH) || evidenceValue(env.SIEM_ENDPOINT))
    },
    {
      id: "relationship-provider",
      label: "家庭与监护关系权威核验",
      passed: Boolean(evidenceValue(env.CITIZEN_RELATIONSHIP_PROVIDER_URL))
    },
    {
      id: "legal-consent",
      label: "授权告知书法务批准版本",
      passed: Boolean(evidenceValue(env.CITIZEN_AUTHORIZATION_LEGAL_APPROVAL))
    },
    {
      id: "release-signoff",
      label: "医院、监管、安全和居民代表上线签字",
      passed: Boolean(evidenceValue(env.CITIZEN_RECORDS_RELEASE_SIGNOFF))
    },
    {
      id: "public-tls",
      label: "居民端生产 HTTPS 地址",
      passed: /^https:\/\//i.test(evidenceValue(env.PUBLIC_BASE_URL))
    }
  ];

  const softwareReady = softwareChecks.every((item) => item.passed);
  const integrationReady = integrationChecks.every((item) => item.passed);
  const externalReady = externalChecks.every((item) => item.passed);
  const productionReady = softwareReady && integrationReady && externalReady;
  const blockers = [...softwareChecks, ...integrationChecks, ...externalChecks]
    .filter((item) => !item.passed)
    .map(({ id, label }) => ({ id, label }));
  return {
    generatedAt: new Date().toISOString(),
    profile: options.profile || "software",
    summary: { softwareReady, integrationReady, externalReady, productionReady },
    softwareChecks,
    integrationChecks,
    externalChecks,
    blockers
  };
}

function main() {
  const profileArg = process.argv.find((arg) => arg.startsWith("--profile="));
  const profile = profileArg ? profileArg.split("=")[1] : "software";
  const report = assessCitizenRecordsReadiness({ profile });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  const passed = profile === "production" ? report.summary.productionReady : report.summary.softwareReady;
  if (!passed) process.exitCode = 2;
}

if (require.main === module) main();

module.exports = { assessCitizenRecordsReadiness, evidenceValue };
