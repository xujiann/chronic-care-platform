#!/usr/bin/env node
const { readRuntimeSource } = require("../src/http/runtime-source");
const fs = require("node:fs");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT, "release", "citizen-operations-readiness-report.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "citizen-operations-readiness-report.md");

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function evidenceHash(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function seedCitizenOperationContents() {
  return [
    {
      id: "cop-content-banner-registration",
      type: "banner",
      title: "预约挂号试点服务",
      summary: "展示预约确认、退号、支付和医保预校验状态；正式号源以医院联调结果为准。",
      channels: ["citizen-web", "app-shell"],
      position: "citizen-home",
      status: "published-demo",
      publishAt: "2026-07-10T08:00:00+08:00",
      expireAt: "2026-12-31T23:59:59+08:00",
      owner: "居民服务运营岗",
      productionReady: false,
      actionHistory: []
    },
    {
      id: "cop-content-family-doctor",
      type: "article",
      title: "家庭医生签约与履约说明",
      summary: "居民可查看签约申请、机构审核、履约、续约和满意度演示记录。",
      channels: ["citizen-web"],
      position: "service-center",
      status: "published-demo",
      publishAt: "2026-07-10T08:30:00+08:00",
      expireAt: "",
      owner: "基层卫生处",
      productionReady: false,
      actionHistory: []
    },
    {
      id: "cop-content-nursing-safety",
      type: "message",
      title: "互联网护理服务安全提示",
      summary: "上门前核验护士、知情同意和服务地址，服务过程保留定位与护理记录。",
      channels: ["citizen-web", "in-app-message"],
      position: "service-notice",
      status: "published-demo",
      publishAt: "2026-07-10T09:00:00+08:00",
      expireAt: "",
      owner: "护理运营组",
      productionReady: false,
      actionHistory: []
    },
    {
      id: "cop-content-refund-policy",
      type: "article",
      title: "预约退号与退费规则草案",
      summary: "待医院、支付渠道和医保联调后发布正式时限、原路退回和异常申诉规则。",
      channels: ["citizen-web"],
      position: "service-center",
      status: "review-pending",
      publishAt: "",
      expireAt: "",
      owner: "财务与居民服务组",
      productionReady: false,
      actionHistory: []
    }
  ];
}

function seedCitizenAgreementVersions() {
  return [
    {
      id: "cop-agreement-privacy-v2",
      agreementCode: "citizen-privacy",
      name: "居民端隐私政策",
      version: "2.0-demo",
      status: "active-demo",
      effectiveAt: "2026-07-10T00:00:00+08:00",
      acceptanceMode: "explicit-checkbox",
      requiredScopes: ["identity", "health-archive", "service-order"],
      contentHash: evidenceHash("citizen-privacy/2.0-demo"),
      legalReviewStatus: "onsite-pending",
      productionReady: false
    },
    {
      id: "cop-agreement-service-v1",
      agreementCode: "citizen-service-terms",
      name: "居民服务使用协议",
      version: "1.0-demo",
      status: "active-demo",
      effectiveAt: "2026-07-10T00:00:00+08:00",
      acceptanceMode: "explicit-checkbox",
      requiredScopes: ["appointment", "internet-nursing", "escort", "family-doctor"],
      contentHash: evidenceHash("citizen-service-terms/1.0-demo"),
      legalReviewStatus: "onsite-pending",
      productionReady: false
    },
    {
      id: "cop-agreement-health-auth-v1",
      agreementCode: "health-data-authorization",
      name: "健康数据调阅授权书",
      version: "1.0-demo",
      status: "active-demo",
      effectiveAt: "2026-07-10T00:00:00+08:00",
      acceptanceMode: "signed-consent",
      requiredScopes: ["archive-read", "report-share", "family-proxy"],
      contentHash: evidenceHash("health-data-authorization/1.0-demo"),
      legalReviewStatus: "onsite-pending",
      productionReady: false
    },
    {
      id: "cop-agreement-privacy-v1",
      agreementCode: "citizen-privacy",
      name: "居民端隐私政策",
      version: "1.0-demo",
      status: "archived",
      effectiveAt: "2026-06-01T00:00:00+08:00",
      acceptanceMode: "explicit-checkbox",
      requiredScopes: ["identity", "health-archive"],
      contentHash: evidenceHash("citizen-privacy/1.0-demo"),
      legalReviewStatus: "superseded",
      productionReady: false
    }
  ];
}

function seedCitizenIdentityReviewCases() {
  return [
    {
      id: "cop-identity-r3",
      residentId: "r3",
      residentName: "演示居民 C",
      source: "citizen-phone-login",
      riskLevel: "medium",
      status: "pending-review",
      submittedEvidence: ["phone-token", "masked-id-card"],
      requestedAt: "2026-07-10T09:10:00+08:00",
      reviewer: "",
      decisionNote: "",
      productionReady: false,
      actionHistory: []
    },
    {
      id: "cop-identity-r4",
      residentId: "r4",
      residentName: "演示居民 D",
      source: "family-proxy",
      riskLevel: "high",
      status: "material-requested",
      submittedEvidence: ["phone-token", "guardian-statement"],
      requestedAt: "2026-07-09T14:00:00+08:00",
      reviewer: "居民服务窗口",
      decisionNote: "待补监护关系证明。",
      productionReady: false,
      actionHistory: []
    },
    {
      id: "cop-identity-r1",
      residentId: "r1",
      residentName: "演示居民 A",
      source: "commission-demo-index",
      riskLevel: "low",
      status: "approved-demo",
      submittedEvidence: ["phone-token", "masked-id-card", "master-index-match"],
      requestedAt: "2026-07-08T11:00:00+08:00",
      reviewer: "居民服务窗口",
      decisionNote: "演示主索引核验通过，不替代政务实名结果。",
      productionReady: false,
      actionHistory: []
    }
  ];
}

function seedCitizenServiceBlacklist() {
  return [
    {
      id: "cop-block-provider-demo",
      subjectType: "provider",
      subjectId: "provider-demo-suspended",
      subjectName: "演示暂停服务商",
      reasonCode: "credential-expired",
      reason: "演示资质到期，暂停居民端服务展示。",
      status: "active-demo",
      effectiveAt: "2026-07-10T08:00:00+08:00",
      expireAt: "",
      reviewer: "居民服务运营岗",
      productionReady: false,
      actionHistory: []
    },
    {
      id: "cop-block-account-review",
      subjectType: "account",
      subjectId: "citizen-risk-demo",
      subjectName: "异常频次演示账号",
      reasonCode: "abnormal-order-frequency",
      reason: "短时间重复提交服务订单，等待人工复核。",
      status: "under-review",
      effectiveAt: "",
      expireAt: "",
      reviewer: "风控复核岗",
      productionReady: false,
      actionHistory: []
    },
    {
      id: "cop-block-device-lifted",
      subjectType: "device",
      subjectId: "device-demo-001",
      subjectName: "已解除演示设备",
      reasonCode: "login-risk",
      reason: "设备登录风险已完成复核。",
      status: "lifted-demo",
      effectiveAt: "2026-07-01T08:00:00+08:00",
      expireAt: "2026-07-09T18:00:00+08:00",
      reviewer: "安全运营岗",
      productionReady: false,
      actionHistory: []
    }
  ];
}

function seedCitizenHospitalServiceConfigs() {
  return [
    {
      id: "cop-hospital-mr1",
      institutionCode: "MR1",
      institutionName: "区域中心医院",
      enabledServices: ["appointment", "report-query", "internet-nursing", "escort"],
      orderChannels: ["citizen-web", "app-shell"],
      paymentMode: "demo-precheck",
      refundMode: "onsite-pending",
      status: "active-demo",
      launchScope: "white-list-demo",
      onsiteBlocker: "正式号源、支付退费、医保状态和医院服务协议待现场联调。",
      productionReady: false,
      actionHistory: []
    },
    {
      id: "cop-hospital-mr3",
      institutionCode: "MR3",
      institutionName: "青泥洼桥社区卫生服务中心",
      enabledServices: ["family-doctor", "chronic-followup", "internet-nursing"],
      orderChannels: ["citizen-web"],
      paymentMode: "policy-demo",
      refundMode: "not-applicable",
      status: "active-demo",
      launchScope: "white-list-demo",
      onsiteBlocker: "真实团队名册、服务包政策、电子签章和经费规则待现场确认。",
      productionReady: false,
      actionHistory: []
    },
    {
      id: "cop-hospital-mr5",
      institutionCode: "MR5",
      institutionName: "甘井子区人民医院",
      enabledServices: ["appointment", "report-query"],
      orderChannels: ["citizen-web"],
      paymentMode: "onsite-pending",
      refundMode: "onsite-pending",
      status: "onsite-confirmation-pending",
      launchScope: "disabled",
      onsiteBlocker: "医院服务开通授权、号源目录和回调白名单待签字。",
      productionReady: false,
      actionHistory: []
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

function isOpenOrderStatus(status) {
  return !/completed|closed|cancelled|canceled|refunded|rejected|已完成|已关闭|已取消/i.test(String(status || ""));
}

function buildCitizenServiceOrderSnapshot(data = {}) {
  const sources = [
    ["registration", data.registrationOrders],
    ["internet-nursing", data.internetNursingOrders],
    ["escort", data.escortServiceOrders],
    ["family-doctor", data.phase2FamilyDoctorApplications]
  ];
  const orders = sources.flatMap(([serviceType, rows]) => (Array.isArray(rows) ? rows : []).map((item) => ({
    id: item.id,
    serviceType,
    residentId: item.residentId || "",
    institutionCode: item.institutionCode || item.hospitalCode || item.reviewInstitutionCode || "",
    status: item.status || item.reviewStatus || "pending",
    paymentStatus: item.paymentStatus || item.settlement?.paymentStatus || "not-applicable",
    refundStatus: item.refundStatus || "none",
    createdAt: item.createdAt || item.requestedAt || item.applicationAt || ""
  })));
  const byService = Object.fromEntries(sources.map(([serviceType]) => [serviceType, orders.filter((item) => item.serviceType === serviceType).length]));
  return {
    total: orders.length,
    open: orders.filter((item) => isOpenOrderStatus(item.status)).length,
    paymentPending: orders.filter((item) => /pending|precheck/i.test(item.paymentStatus)).length,
    refundPending: orders.filter((item) => /pending|processing/i.test(item.refundStatus)).length,
    byService,
    orders
  };
}

function buildCitizenOperationsCenter(data = {}) {
  const contents = mergeRows(seedCitizenOperationContents(), data.citizenOperationContents);
  const agreements = mergeRows(seedCitizenAgreementVersions(), data.citizenAgreementVersions);
  const identityReviews = mergeRows(seedCitizenIdentityReviewCases(), data.citizenIdentityReviewCases);
  const blacklist = mergeRows(seedCitizenServiceBlacklist(), data.citizenServiceBlacklist);
  const hospitalServices = mergeRows(seedCitizenHospitalServiceConfigs(), data.citizenHospitalServiceConfigs);
  const orderSnapshot = buildCitizenServiceOrderSnapshot(data);
  const onsiteBlockers = [
    "government unified entry and authoritative real-name verification",
    "live hospital appointment, payment, refund and insurance callbacks",
    "legally reviewed agreement versions and consent archive",
    "signed hospital service enablement and blacklist policy"
  ];
  return {
    ok: contents.length >= 4 && agreements.length >= 4 && identityReviews.length >= 3 && blacklist.length >= 3 && hospitalServices.length >= 3,
    status: "operations-mvp-onsite-blocked",
    summary: {
      contents: contents.length,
      publishedContents: contents.filter((item) => item.status === "published-demo").length,
      activeAgreements: agreements.filter((item) => item.status === "active-demo").length,
      pendingIdentityReviews: identityReviews.filter((item) => /pending|material-requested/i.test(item.status)).length,
      activeBlacklistEntries: blacklist.filter((item) => item.status === "active-demo").length,
      enabledHospitals: hospitalServices.filter((item) => item.status === "active-demo").length,
      productionReadyHospitals: hospitalServices.filter((item) => item.productionReady === true).length,
      orders: orderSnapshot.total,
      openOrders: orderSnapshot.open,
      onsiteBlockers: onsiteBlockers.length
    },
    contents,
    agreements,
    identityReviews,
    blacklist,
    hospitalServices,
    orderSnapshot,
    onsiteBlockers,
    boundary: "Demo publishing, review and service-enablement actions do not authorize production access. Government identity, live hospital/payment callbacks, legal agreement review and signed operating policies remain required."
  };
}

function buildCitizenOperationsPublic(data = {}) {
  const center = buildCitizenOperationsCenter(data);
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    contents: center.contents.filter((item) => item.status === "published-demo").map(({ actionHistory, ...item }) => item),
    agreements: center.agreements.filter((item) => item.status === "active-demo"),
    hospitalServices: center.hospitalServices
      .filter((item) => item.status === "active-demo")
      .map(({ actionHistory, onsiteBlocker, ...item }) => item),
    boundary: "当前为演示公开信息，不代表生产服务已经开通；正式服务范围、协议版本、实名结果及支付退费规则以现场联调和审核发布结果为准。"
  };
}

const ACTIONS = {
  contents: {
    publish: "published-demo",
    withdraw: "withdrawn",
    "request-review": "review-pending"
  },
  "identity-reviews": {
    approve: "approved-demo",
    reject: "rejected-demo",
    "request-material": "material-requested"
  },
  blacklist: {
    activate: "active-demo",
    lift: "lifted-demo",
    review: "under-review"
  },
  hospitals: {
    "enable-demo": "active-demo",
    "disable-demo": "disabled-demo",
    "request-onsite": "onsite-confirmation-pending"
  }
};

function applyCitizenOperationsAction(resource, item, payload = {}, user = {}) {
  const action = String(payload.action || "").trim();
  const note = String(payload.note || "").trim();
  const nextStatus = ACTIONS[resource]?.[action];
  if (!nextStatus) throw new Error("unsupported citizen operations action");
  if (!note) throw new Error("citizen operations action requires note");
  const history = {
    id: randomUUID(),
    at: new Date().toISOString(),
    action,
    note,
    actor: user.name || user.username || user.role || "commission",
    role: user.role || "commission",
    fromStatus: item.status || "",
    toStatus: nextStatus
  };
  const updated = {
    ...item,
    status: nextStatus,
    productionReady: false,
    updatedAt: history.at,
    updatedBy: history.actor,
    actionHistory: [history, ...(Array.isArray(item.actionHistory) ? item.actionHistory : [])].slice(0, 20)
  };
  if (resource === "identity-reviews") {
    updated.reviewer = history.actor;
    updated.decisionNote = note;
  }
  if (resource === "blacklist") updated.reviewer = history.actor;
  if (resource === "hospitals") updated.launchScope = action === "enable-demo" ? "white-list-demo" : "disabled";
  return { item: updated, history };
}

function check(id, passed, detail) {
  return { id, passed: Boolean(passed), detail };
}

function clean(value) {
  return String(value ?? "").replace(/\|/g, "/");
}

function buildCitizenOperationsReadiness(options = {}) {
  const data = options.data ?? readJson("data/db.json");
  const pkg = options.pkg ?? readJson("package.json");
  const serverSource = options.serverSource ?? readRuntimeSource(ROOT);
  const platformSource = options.platformSource ?? readText("platform.js");
  const platformHtml = options.platformHtml ?? readText("platform.html");
  const citizenSource = options.citizenSource ?? readText("citizen.js");
  const citizenHtml = options.citizenHtml ?? readText("citizen.html");
  const documentation = options.documentation ?? readText(path.join("docs", "citizen-service-operations-center.md"));
  const manifestSource = options.manifestSource ?? readText(path.join("scripts", "release-artifact-manifest.js"));
  const deployCheckSource = options.deployCheckSource ?? readText(path.join("scripts", "deploy-check.js"));
  const releaseReportSource = options.releaseReportSource ?? readText(path.join("scripts", "release-report.js"));
  const center = buildCitizenOperationsCenter(data);
  const checks = [
    check("citizenOperations:data-model", center.summary.contents >= 4 && center.summary.activeAgreements >= 3 && center.identityReviews.length >= 3 && center.blacklist.length >= 3 && center.hospitalServices.length >= 3, `${center.summary.contents} contents / ${center.summary.activeAgreements} active agreements / ${center.identityReviews.length} identity reviews / ${center.blacklist.length} blacklist rows / ${center.hospitalServices.length} hospitals`),
    check("citizenOperations:order-query", center.orderSnapshot.total >= 7 && Object.values(center.orderSnapshot.byService).filter((count) => count > 0).length >= 3, `${center.orderSnapshot.total} orders across ${Object.values(center.orderSnapshot.byService).filter((count) => count > 0).length} service types`),
    check("citizenOperations:production-boundary", center.summary.productionReadyHospitals === 0 && center.onsiteBlockers.length >= 4 && center.hospitalServices.every((item) => item.productionReady === false), `${center.summary.productionReadyHospitals} production-ready hospitals / ${center.onsiteBlockers.length} onsite blockers`),
    check("citizenOperations:runtime-api", ["/api/citizen-operations/center", "/api/citizen-operations/public", "citizen-operations-action"].every((marker) => serverSource.includes(marker)), "commission operations API, public feed and audited actions are wired"),
    check("citizenOperations:platform-ui", platformHtml.includes("citizen-operations-center") && platformSource.includes("renderCitizenOperationsCenter") && platformSource.includes("data-citizen-operations-action"), "platform operations center is visible and actionable"),
    check("citizenOperations:citizen-ui", citizenHtml.includes("citizen-service-public-feed") && citizenSource.includes("renderCitizenOperationsPublicFeed") && citizenSource.includes("citizen-operations/public"), "citizen public content, agreements and hospital services are visible"),
    check("citizenOperations:documentation", ["real-name review", "blacklist", "hospital service enablement", "/api/citizen-operations/center"].every((marker) => documentation.includes(marker)), "operations model, APIs and onsite boundary are documented"),
    check("citizenOperations:release-wiring", Boolean(pkg.scripts?.["phase2:citizen-operations-readiness"]) && manifestSource.includes("citizen-operations-readiness-report.md") && deployCheckSource.includes("citizenOperationsReadiness") && releaseReportSource.includes("citizenOperations"), "package script, manifest, deploy check and release report are wired")
  ];
  return {
    ok: checks.every((item) => item.passed),
    generatedAt: new Date().toISOString(),
    ...center,
    checks
  };
}

function renderMarkdown(report) {
  return [
    "# Citizen service operations readiness report",
    "",
    `- Generated at: ${report.generatedAt}`,
    `- Result: ${report.ok ? "PASS" : "FAIL"}`,
    `- Published contents: ${report.summary.publishedContents}/${report.summary.contents}`,
    `- Active agreements: ${report.summary.activeAgreements}`,
    `- Pending identity reviews: ${report.summary.pendingIdentityReviews}`,
    `- Active blacklist entries: ${report.summary.activeBlacklistEntries}`,
    `- Enabled hospitals: ${report.summary.enabledHospitals}`,
    `- Orders: ${report.summary.orders} (${report.summary.openOrders} open)`,
    "",
    "## Checks",
    "",
    "| Result | Check | Detail |",
    "|---|---|---|",
    ...report.checks.map((item) => `| ${item.passed ? "PASS" : "FAIL"} | ${item.id} | ${clean(item.detail)} |`),
    "",
    "## Identity review queue",
    "",
    "| Case | Resident | Risk | Status |",
    "|---|---|---|---|",
    ...report.identityReviews.map((item) => `| ${item.id} | ${clean(item.residentId)} | ${clean(item.riskLevel)} | ${clean(item.status)} |`),
    "",
    "## Hospital service enablement",
    "",
    "| Hospital | Services | Status | Production ready |",
    "|---|---|---|---|",
    ...report.hospitalServices.map((item) => `| ${clean(item.institutionName)} | ${clean(item.enabledServices.join(", "))} | ${clean(item.status)} | ${item.productionReady ? "yes" : "no"} |`),
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
  const report = buildCitizenOperationsReadiness();
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
  applyCitizenOperationsAction,
  buildCitizenOperationsCenter,
  buildCitizenOperationsPublic,
  buildCitizenOperationsReadiness,
  buildCitizenServiceOrderSnapshot,
  parseArgs,
  renderMarkdown,
  seedCitizenAgreementVersions,
  seedCitizenHospitalServiceConfigs,
  seedCitizenIdentityReviewCases,
  seedCitizenOperationContents,
  seedCitizenServiceBlacklist,
  writeOutput
};
