const PUBLIC_HEALTH_API_BASE = location.protocol === "file:" ? "" : "/api";
const PUBLIC_HEALTH_ROUTE = "/api/public-health/system";
const PUBLIC_HEALTH_PATH = PUBLIC_HEALTH_ROUTE.replace(/^\/api/, "");
let currentPublicHealthSystem = null;

const FALLBACK_STANDARD_DOMAINS = [
  ["ph-infectious", 1, "传染病防控", "management", 6, 49, "疾控中心", ["病例报告", "流行病学调查", "实验室检测"], ["publicHealthEvents", "emergencySignals"]],
  ["ph-parasitic", 2, "寄生虫病防控", "management", 7, 55, "疾控中心", ["流行区调查", "病例管理", "媒介监测"], ["publicHealthEvents", "healthStatistics"]],
  ["ph-immunization", 3, "免疫规划", "management", 2, 7, "疾控中心/基层机构", ["预防接种", "疫苗管理", "冷链管理"], ["birthCertificates", "publicHealthEvents"]],
  ["ph-chronic", 4, "慢性病防控", "management", 14, 21, "基层卫生/疾控中心", ["高血压", "糖尿病", "死因监测"], ["chronicScreeningTasks", "chronicManagementPlans", "followups"]],
  ["ph-endemic", 5, "地方病防控", "management", 12, 55, "疾控中心/基层机构", ["碘缺乏", "氟中毒", "克山病"], ["publicHealthEvents", "healthStatistics"]],
  ["ph-mental", 6, "精神卫生防治", "management", 6, 9, "精卫中心/基层机构", ["严重精神障碍", "心理健康", "动态监测"], ["publicHealthEvents", "followups"]],
  ["ph-epilepsy", 7, "癫痫防治", "management", 2, 4, "基层机构/专科机构", ["病例报告", "患者服务", "个案管理"], ["publicHealthEvents", "followups"]],
  ["ph-senior", 8, "老年人健康服务管理", "management", 8, 15, "基层机构/民政协同", ["健康教育", "失能评估", "医养结合"], ["seniorServices", "personalRecords"]],
  ["ph-maternal-child", 9, "妇幼健康服务管理", "management", 7, 28, "妇幼保健机构/医疗机构", ["孕产保健", "儿童保健", "出生缺陷"], ["birthCertificates", "birthStatistics"]],
  ["ph-health-education", 10, "健康教育", "management", 1, 3, "疾控中心/基层机构", ["计划", "活动", "评价"], ["chronicEducationPushes", "publicHealthEvents"]],
  ["ph-nutrition", 11, "营养健康服务管理", "management", 3, 5, "疾控中心/基层机构", ["营养监测", "营养干预", "宣教"], ["publicHealthEvents", "personalRecords"]],
  ["ph-archive", 12, "健康档案管理服务", "management", 1, 1, "基层机构", ["居民健康档案"], ["residents", "personalRecords"]],
  ["ph-injury", 13, "伤害防控", "management", 2, 3, "疾控中心/医疗机构", ["伤害监测", "伤害干预"], ["publicHealthEvents", "diagnosticReports"]],
  ["ph-emergency", 14, "突发公共卫生事件管理", "management", 3, 12, "卫健管理部门/疾控中心", ["事件报告", "应急处置", "资源调配"], ["publicHealthEvents", "emergencySignals"]],
  ["ph-environment", 15, "环境卫生管理", "management", 6, 21, "疾控中心/监督机构", ["饮用水", "学校卫生", "病媒生物"], ["publicHealthEvents", "healthStatistics"]],
  ["ph-supervision", 16, "监督执法服务管理", "management", 14, 34, "卫生监督机构", ["监督检查", "行政处罚", "信用管理"], ["institutionSupervisions", "institutionCreditEvaluations"]],
  ["ph-food", 17, "食品安全风险监测", "management", 4, 21, "疾控中心/食品安全部门", ["污染物监测", "食源性疾病", "暴发事件"], ["publicHealthEvents", "diagnosticReports"]],
  ["ph-occupational", 18, "职业病防控", "management", 7, 22, "职业健康机构/监督机构", ["职业健康检查", "危害因素监测", "风险预警"], ["publicHealthEvents", "institutionSupervisions"]],
  ["ph-portal", 19, "信息平台管理", "technology", 7, 12, "平台技术组", ["统一门户", "用户注册", "日志管理"], ["platformInterfaces", "integrationContracts"]],
  ["ph-security", 20, "网络安全管理", "technology", 10, 34, "安全管理岗", ["身份认证", "通信安全", "安全运维"], ["securityEvents", "securityAcceptanceLedger"]],
  ["ph-emerging-tech", 21, "新兴技术应用", "technology", 3, 10, "平台技术组/科研治理", ["大数据", "云计算", "人工智能"], ["researchDatasets", "diseaseRegistryModels"]]
].map(([id, order, name, category, secondaryCount, tertiaryCount, owner, capabilities, dataCollections]) => ({
  id,
  order,
  name,
  category,
  secondaryCount,
  tertiaryCount,
  owner,
  capabilities,
  dataCollections,
  status: "已建模"
}));

const PUBLIC_HEALTH_SITE_EVIDENCE_LINKS = [
  { id: "ph-sle-direct-report", templateId: "interface-statistics-report-v1", packetId: "phcep-direct-report-endpoint", itemIds: ["phcb-direct-report-endpoint-e1", "phcb-direct-report-endpoint-e2", "phcb-direct-report-endpoint-e3"], acceptanceId: "phoa-interface-joint-test", requirement: "Direct report endpoint, field version and receipt sample" },
  { id: "ph-sle-his-account", templateId: "interface-his-patient-v1", packetId: "phcep-lis-emr-credentials", itemIds: ["phcb-lis-emr-credentials-e1"], acceptanceId: "phoa-interface-joint-test", requirement: "Hospital account authorization" },
  { id: "ph-sle-emr-signature", templateId: "interface-emr-summary-v1", packetId: "phcep-lis-emr-credentials", itemIds: ["phcb-lis-emr-credentials-e2"], acceptanceId: "phoa-interface-joint-test", requirement: "Signature key handoff" },
  { id: "ph-sle-lis-positive-receipt", templateId: "interface-lis-report-v1", packetId: "phcep-lis-emr-credentials", itemIds: ["phcb-lis-emr-credentials-e3"], acceptanceId: "phoa-interface-joint-test", requirement: "Positive result callback receipt" },
  { id: "ph-sle-immunization-registry", templateId: "interface-certificate-sync-v1", packetId: "phcep-immunization-registry", itemIds: ["phcb-immunization-registry-e1", "phcb-immunization-registry-e2", "phcb-immunization-registry-e3"], acceptanceId: "phoa-emergency-drill", requirement: "Immunization registry, cold-chain and AEFI receipts" },
  { id: "ph-sle-security-assessment", templateId: "signoff-cutover-audit-retention", packetId: "phcep-security-assessment", itemIds: ["phcb-security-assessment-e1", "phcb-security-assessment-e2", "phcb-security-assessment-e4"], acceptanceId: "phoa-security-level-protection", requirement: "Security assessment and audit retention evidence" },
  { id: "ph-sle-gm-config", templateId: "signoff-cutover-secrets", packetId: "phcep-security-assessment", itemIds: ["phcb-security-assessment-e3"], acceptanceId: "phoa-security-level-protection", requirement: "Secret and national crypto configuration handoff" },
  { id: "ph-sle-backup-drill", templateId: "signoff-cutover-dr-rehearsal", packetId: "phcep-backup-drill", itemIds: ["phcb-backup-drill-e1", "phcb-backup-drill-e2", "phcb-backup-drill-e3", "phcb-backup-drill-e4"], acceptanceId: "phoa-backup-restore", requirement: "Backup media, restore screenshots, RPO/RTO and rehearsal signoff" },
  { id: "ph-sle-institution-accounts", templateId: "signoff-cutover-identity", packetId: "phcep-site-contacts", itemIds: ["phcb-site-contacts-e1", "phcb-site-contacts-e2", "phcb-site-contacts-e3"], acceptanceId: "phoa-institution-accounts", requirement: "Institution contacts, authorization scope and account list" }
];

document.addEventListener("DOMContentLoaded", async () => {
  void loadPublicHealthConnectivitySummaries();
  const system = await loadPublicHealthSystem();
  renderPublicHealthSystem(system);
});

document.addEventListener("click", (event) => {
  if (event.target.closest("#public-health-connectivity-refresh")) {
    void loadPublicHealthConnectivitySummaries();
    return;
  }
  const actionButton = event.target.closest("[data-public-health-connectivity-action]");
  if (actionButton) {
    void handlePublicHealthConnectivityAction(actionButton);
  }
});
document.addEventListener("click", handlePublicHealthEventAction);
document.addEventListener("click", handlePublicHealthCoordinationAction);
document.addEventListener("click", handlePublicHealthExchangeRun);
document.addEventListener("click", handlePublicHealthExchangeException);
document.addEventListener("click", handlePublicHealthInstitutionTaskAction);
document.addEventListener("click", handlePublicHealthOnsiteAcceptanceAction);
document.addEventListener("click", handlePublicHealthCutoverBlockerAction);
document.addEventListener("click", handlePublicHealthCutoverEvidencePacketAction);
document.addEventListener("click", handlePublicHealthCutoverDrillAction);
document.addEventListener("click", handlePublicHealthProductionHandoffAction);
document.addEventListener("click", handlePublicHealthGoLiveObservationAction);
document.addEventListener("click", handlePublicHealthLaunchIncidentAction);
document.addEventListener("click", handlePublicHealthLaunchDutyShiftAction);
document.addEventListener("click", handlePublicHealthLaunchCommandBriefAction);
document.addEventListener("click", handlePublicHealthSiteEvidenceBridgeAction);
document.addEventListener("click", handlePublicHealthSiteEvidenceVerificationTaskAction);
document.addEventListener("click", handlePublicHealthStandardImplementationAction);
document.addEventListener("click", handlePublicHealthLaunchGateAction);

async function loadPublicHealthSystem() {
  if (PUBLIC_HEALTH_API_BASE) {
    try {
      const request = window.HealthCityAuth?.authFetch || fetch;
      const response = await request(`${PUBLIC_HEALTH_API_BASE}${PUBLIC_HEALTH_PATH}`);
      if (response.ok) return response.json();
    } catch (error) {
      // Static preview falls back to data/db.json.
    }
  }
  const state = await loadPlatformState({});
  return buildStaticPublicHealthSystem(state);
}

const PUBLIC_HEALTH_CONNECTIVITY_ENDPOINTS = Object.freeze({
  endpoint: "/api/public-health/external/endpoints/summary",
  campaign: "/api/public-health/external/endpoints/campaigns/summary"
});

const PUBLIC_HEALTH_CONTINUITY_BREAK_LABELS = Object.freeze({
  "campaign-verification-failed": "活动签名或完整性验证失败",
  "campaign-window-overlap": "活动窗口重叠",
  "campaign-gap-exceeded": "活动间隔超过门限",
  "campaign-chain-link-missing": "签名前序链缺失",
  "campaign-chain-link-mismatch": "签名前序链不匹配",
  ENDPOINT_PROBE_CAMPAIGN_VERIFICATION_FAILED: "活动签名或完整性验证失败",
  ENDPOINT_PROBE_CAMPAIGN_WINDOW_OVERLAP: "活动窗口重叠",
  ENDPOINT_PROBE_CAMPAIGN_GAP_EXCEEDED: "活动间隔超过门限",
  ENDPOINT_PROBE_CAMPAIGN_CHAIN_LINK_MISSING: "签名前序链缺失",
  ENDPOINT_PROBE_CAMPAIGN_CHAIN_LINK_MISMATCH: "签名前序链不匹配"
});

const PUBLIC_HEALTH_CONNECTIVITY_LANES = new Set([
  "infectious-reporting",
  "immunization",
  "maternal-child",
  "senior-health",
  "chronic-management",
  "public-health-followup",
  "health-education",
  "family-doctor"
]);

const PUBLIC_HEALTH_CONNECTIVITY_ACTION_ERRORS = Object.freeze({
  ENDPOINT_PROBE_CONCURRENCY_LIMIT: "当前已有探测任务运行，请稍后重试。",
  ENDPOINT_PROBE_FREQUENCY_LIMIT: "该通道刚完成探测，请等待服务端频率窗口后重试。",
  ENDPOINT_PROBE_FAILED: "服务端探测配置不完整或可信探测失败。",
  ENDPOINT_PROBE_COMMAND_OVERRIDE_FORBIDDEN: "探测命令包含不允许的覆盖字段。",
  ENDPOINT_PROBE_CAMPAIGN_CONCURRENCY_LIMIT: "当前已有八通道活动运行，请稍后重试。",
  ENDPOINT_PROBE_CAMPAIGN_FREQUENCY_LIMIT: "八通道活动仍在服务端频率窗口内。",
  ENDPOINT_PROBE_CAMPAIGN_CHAIN_CAS_CONFLICT: "可信活动链头已变化或不完整，请刷新摘要并完成安全复核后重试。",
  ENDPOINT_PROBE_CAMPAIGN_FAILED: "八通道活动配置不完整或可信探测失败。",
  ENDPOINT_PROBE_CAMPAIGN_COMMAND_OVERRIDE_FORBIDDEN: "活动命令包含不允许的覆盖字段。"
});

async function loadPublicHealthConnectivitySummaries() {
  renderPublicHealthConnectivityLoading();
  const request = window.HealthCityAuth?.authFetch || fetch;
  const results = await Promise.allSettled([
    request(PUBLIC_HEALTH_CONNECTIVITY_ENDPOINTS.endpoint).then(readPublicHealthConnectivityResponse),
    request(PUBLIC_HEALTH_CONNECTIVITY_ENDPOINTS.campaign).then(readPublicHealthConnectivityResponse)
  ]);
  const endpointResult = results[0];
  const campaignResult = results[1];
  renderPublicHealthConnectivitySummaries({
    endpoint: endpointResult.status === "fulfilled" ? endpointResult.value : null,
    campaign: campaignResult.status === "fulfilled" ? campaignResult.value : null,
    endpointError: endpointResult.status === "rejected" ? endpointResult.reason : null,
    campaignError: campaignResult.status === "rejected" ? campaignResult.reason : null
  });
}

async function handlePublicHealthConnectivityAction(button) {
  const status = document.querySelector("#public-health-connectivity-action-status");
  const action = String(button?.dataset?.publicHealthConnectivityAction || "");
  const request = window.HealthCityAuth?.authFetch;
  if (!status || !button || !request) {
    if (status) status.textContent = "当前预览未建立 commission 服务端会话，未执行探测。";
    return;
  }
  const laneSelect = document.querySelector("#public-health-connectivity-lane");
  const laneId = String(laneSelect?.value || "").trim();
  if (action === "probe-lane" && !PUBLIC_HEALTH_CONNECTIVITY_LANES.has(laneId)) {
    status.className = "connectivity-action-status danger";
    status.textContent = "请选择八个受控通道之一；未执行探测。";
    return;
  }
  if (action !== "probe-lane" && action !== "probe-campaign") return;

  const isCampaign = action === "probe-campaign";
  const route = isCampaign
    ? "/api/public-health/external/endpoints/campaigns"
    : "/api/public-health/external/endpoints/probes";
  const headers = {
    "Content-Type": "application/json",
    "Idempotency-Key": publicHealthConnectivityActionKey(isCampaign ? "campaign" : laneId)
  };
  const body = isCampaign ? "{}" : JSON.stringify({ laneId });
  const previousLabel = button.textContent;
  button.disabled = true;
  button.textContent = "运行中";
  status.className = "connectivity-action-status warn";
  status.textContent = isCampaign
    ? "正在执行服务端八通道活动；端点、策略、TLS、时间和密钥不可由页面覆盖。"
    : `正在执行 ${connectivityLaneLabel(laneId)} 服务端探测；安全配置不可由页面覆盖。`;
  try {
    const response = await request(route, { method: "POST", headers, body });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error("public-health-connectivity-action-rejected");
      error.status = Number(response.status || 0);
      error.publicCode = String(result.code || "");
      throw error;
    }
    status.className = "connectivity-action-status ok";
    status.textContent = isCampaign
      ? "八通道活动已由服务端完成并写入审计；正在刷新脱敏摘要。"
      : `${connectivityLaneLabel(laneId)} 探测已由服务端完成并写入审计；正在刷新脱敏摘要。`;
    await loadPublicHealthConnectivitySummaries();
  } catch (error) {
    status.className = "connectivity-action-status danger";
    status.textContent = publicHealthConnectivityActionFailure(error);
  } finally {
    button.disabled = false;
    button.textContent = previousLabel;
  }
}

function publicHealthConnectivityActionKey(scope) {
  const randomPart = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `public-health-connectivity:${scope}:${randomPart}`.slice(0, 160);
}

function connectivityLaneLabel(laneId) {
  const option = document.querySelector(`#public-health-connectivity-lane option[value="${laneId}"]`);
  return option?.textContent?.trim() || "所选通道";
}

function publicHealthConnectivityActionFailure(error) {
  const code = String(error?.publicCode || "");
  if (PUBLIC_HEALTH_CONNECTIVITY_ACTION_ERRORS[code]) return PUBLIC_HEALTH_CONNECTIVITY_ACTION_ERRORS[code];
  if (Number(error?.status || 0) === 403) return "当前账号无权执行 commission 探测操作。";
  if (Number(error?.status || 0) === 401) return "commission 会话已失效，请重新登录后再试。";
  if (Number(error?.status || 0) >= 500) return "服务端可信配置或探测运行时暂不可用；本次操作失败关闭。";
  return "探测请求未完成；本次操作失败关闭，现有页面不受影响。";
}

async function readPublicHealthConnectivityResponse(response) {
  if (!response?.ok) {
    const error = new Error(`connectivity-summary-http-${Number(response?.status || 0)}`);
    error.status = Number(response?.status || 0);
    throw error;
  }
  return response.json();
}

function renderPublicHealthConnectivityLoading() {
  const status = document.querySelector("#public-health-connectivity-status");
  if (status) {
    status.className = "connectivity-status warn";
    status.textContent = "正在从服务端加载可信摘要；加载完成前按未就绪处理。";
  }
}

function renderPublicHealthConnectivitySummaries({ endpoint, campaign, endpointError, campaignError }) {
  const metrics = document.querySelector("#public-health-connectivity-metrics");
  const status = document.querySelector("#public-health-connectivity-status");
  if (!metrics || !status) return;

  const endpointAvailable = Boolean(endpoint);
  const campaignAvailable = Boolean(campaign);
  const endpointSummary = endpoint?.summary || {};
  const campaignSummary = campaign?.summary || {};
  const endpointReady = endpointAvailable && endpoint.endpointConnectivityReady === true;
  const continuousReady = campaignAvailable && campaign.continuousConnectivityReady === true;
  const productionDenied = endpoint?.productionReady === false && campaign?.productionReady === false;
  const lanes = boundedConnectivityCount(endpointSummary.lanes, 8);
  const configured = boundedConnectivityCount(endpointSummary.endpointsConfigured, 8);
  const verified = boundedConnectivityCount(endpointSummary.endpointProbesVerified, 8);
  const campaignsVerified = boundedConnectivityCount(campaignSummary.campaignsVerified);
  const consecutive = boundedConnectivityCount(campaignSummary.consecutiveCampaigns);
  const required = Math.max(1, boundedConnectivityCount(campaignSummary.requiredConsecutiveCampaigns) || 3);
  const chainLinksVerified = boundedConnectivityCount(campaignSummary.campaignChainLinksVerified);
  const requiredChainLinks = Math.max(0, required - 1);
  const chainBreakCode = String(campaign?.continuityBreak?.code || "");
  const chainBlocked = [
    "campaign-chain-link-missing",
    "campaign-chain-link-mismatch",
    "ENDPOINT_PROBE_CAMPAIGN_CHAIN_LINK_MISSING",
    "ENDPOINT_PROBE_CAMPAIGN_CHAIN_LINK_MISMATCH"
  ].includes(chainBreakCode);

  metrics.innerHTML = [
    connectivityMetric("通道配置", endpointAvailable ? `${configured}/${lanes || 8}` : "未确认", endpointReady ? "ok" : "warn", "服务端配置的八领域通道"),
    connectivityMetric("可信端点", endpointAvailable ? `${verified}/${lanes || 8}` : "未确认", endpointReady ? "ok" : "warn", "已通过当前策略复核的通道"),
    connectivityMetric("端点门禁", endpointReady ? "已就绪" : "未就绪", endpointReady ? "ok" : "danger", "endpointConnectivityReady"),
    connectivityMetric("活动验签", campaignAvailable ? String(campaignsVerified) : "未确认", continuousReady ? "ok" : "warn", "服务端验签通过的探测活动"),
    connectivityMetric("连续活动", campaignAvailable ? `${consecutive}/${required}` : "未确认", continuousReady ? "ok" : "warn", "新鲜、不重叠且满足间隔要求"),
    connectivityMetric(
      "签名前序链",
      campaignAvailable ? (chainBlocked ? "阻断" : `${chainLinksVerified}/${requiredChainLinks}`) : "未确认",
      chainBlocked ? "danger" : (chainLinksVerified >= requiredChainLinks ? "ok" : "warn"),
      chainBlocked
        ? `${PUBLIC_HEALTH_CONTINUITY_BREAK_LABELS[chainBreakCode]} (${chainBreakCode})`
        : "相邻活动签名前序链"
    ),
    connectivityMetric("连续门禁", continuousReady ? "已就绪" : "未就绪", continuousReady ? "ok" : "danger", "continuousConnectivityReady"),
    connectivityMetric("生产上线", productionDenied ? "未授权" : "状态不可确认", "danger", "productionReady 仅由服务端和现场门禁决定")
  ].join("");

  const errors = [endpointError, campaignError].filter(Boolean);
  if (errors.length) {
    status.className = "connectivity-status danger";
    status.textContent = connectivityFailureMessage(errors);
  } else if (!endpointAvailable || !campaignAvailable) {
    status.className = "connectivity-status danger";
    status.textContent = "可信摘要不完整，当前按端点、连续性和生产上线均未就绪处理；现有页面其余功能不受影响。";
  } else {
    status.className = `connectivity-status ${endpointReady && continuousReady ? "ok" : "warn"}`;
    status.textContent = endpointReady && continuousReady
      ? "端点与连续性摘要均已通过；生产上线仍须独立完成现场证据和审批。"
      : "服务端摘要已加载；未通过的连通性门禁继续失败关闭，生产上线保持未授权。";
  }

  renderPublicHealthContinuityBreak(campaignAvailable ? campaign.continuityBreak : null);
  renderPublicHealthConnectivityWorker(endpoint?.worker, campaign?.worker);
  renderPublicHealthConnectivityBlockers({
    endpointAvailable,
    campaignAvailable,
    endpointReady,
    continuousReady,
    endpointBlockers: endpoint?.blockers,
    campaignBlockers: campaign?.blockers
  });
}

function connectivityMetric(label, value, state, detail) {
  return `<article class="connectivity-metric ${state}">
    <span>${escapeHtml(label)}</span>
    <strong>${escapeHtml(value)}</strong>
    <small>${escapeHtml(detail)}</small>
  </article>`;
}

function boundedConnectivityCount(value, maximum = Number.MAX_SAFE_INTEGER) {
  const count = Number(value);
  if (!Number.isFinite(count) || count < 0) return 0;
  return Math.min(Math.floor(count), maximum);
}

function connectivityFailureMessage(errors) {
  const statuses = errors.map((error) => Number(error?.status || 0));
  if (statuses.includes(403)) return "当前账号无权查看 commission 摘要；面板按未就绪处理，且不会阻断现有页面。";
  if (statuses.some((status) => status === 503 || status === 500)) {
    return "服务端可信配置或摘要暂不可用；面板按未就绪处理，且不会采用客户端替代值。";
  }
  return "无法连接外部端点摘要服务；面板按未就绪处理，现有页面其余功能不受影响。";
}

function renderPublicHealthContinuityBreak(continuityBreak) {
  const target = document.querySelector("#public-health-connectivity-break");
  if (!target) return;
  if (!continuityBreak) {
    target.innerHTML = "<p>当前摘要未报告连续性断点。</p>";
    return;
  }
  const campaignId = safeConnectivityCampaignId(continuityBreak.campaignId);
  const code = String(continuityBreak.code || "");
  const label = PUBLIC_HEALTH_CONTINUITY_BREAK_LABELS[code] || "连续性验证失败";
  const safeCode = PUBLIC_HEALTH_CONTINUITY_BREAK_LABELS[code] ? code : "continuity-verification-failed";
  target.innerHTML = `<p><strong>${escapeHtml(campaignId)}</strong></p><p>${escapeHtml(label)} <code>${escapeHtml(safeCode)}</code></p>`;
}

function safeConnectivityCampaignId(value) {
  const campaignId = String(value || "").trim();
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/.test(campaignId) ? campaignId : "未提供安全活动标识";
}

function renderPublicHealthConnectivityWorker(endpointWorker, campaignWorker) {
  const target = document.querySelector("#public-health-connectivity-worker");
  if (!target) return;
  const endpointSucceeded = boundedConnectivityCount(endpointWorker?.succeeded);
  const endpointRejected = boundedConnectivityCount(endpointWorker?.rejected);
  const campaignSucceeded = boundedConnectivityCount(campaignWorker?.succeeded);
  const campaignRejected = boundedConnectivityCount(campaignWorker?.rejected);
  target.innerHTML = `<p>单通道探测：成功 <strong>${endpointSucceeded}</strong>，拒绝 <strong>${endpointRejected}</strong></p>
    <p>八通道活动：成功 <strong>${campaignSucceeded}</strong>，拒绝 <strong>${campaignRejected}</strong></p>`;
}

function renderPublicHealthConnectivityBlockers({
  endpointAvailable,
  campaignAvailable,
  endpointReady,
  continuousReady,
  endpointBlockers,
  campaignBlockers
}) {
  const target = document.querySelector("#public-health-connectivity-blockers");
  if (!target) return;
  const blockerCount = (Array.isArray(endpointBlockers) ? endpointBlockers.length : 0)
    + (Array.isArray(campaignBlockers) ? campaignBlockers.length : 0);
  const blockers = [];
  if (!endpointAvailable || !endpointReady) blockers.push("八通道端点配置或可信探测回执尚未全部通过。");
  if (!campaignAvailable || !continuousReady) blockers.push("连续探测活动尚未满足新鲜度、完整性和连续窗口要求。");
  blockers.push("现场证据、P0/P1 闭环、生产移交、值班与灾备证据及上线审批仍需独立完成。");
  if (blockerCount) blockers.push(`服务端另报告 ${blockerCount} 项受控阻断；详细诊断仅在受限运维边界处理。`);
  target.innerHTML = blockers.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
}

function buildStaticPublicHealthSystem(state) {
  const standards = Array.isArray(state.publicHealthStandards) && state.publicHealthStandards.length
    ? state.publicHealthStandards
    : FALLBACK_STANDARD_DOMAINS;
  const standardImplementationLedger = Array.isArray(state.publicHealthStandardImplementationLedger) && state.publicHealthStandardImplementationLedger.length
    ? state.publicHealthStandardImplementationLedger
    : buildStaticStandardImplementationLedger(standards);
  const standardImplementationEvidenceCandidates = buildStaticStandardImplementationEvidenceCandidates(state.siteLaunchEvidence);
  const institutionScopes = Array.isArray(state.publicHealthInstitutionScopes) ? state.publicHealthInstitutionScopes : [];
  const events = Array.isArray(state.publicHealthEvents) ? state.publicHealthEvents : [];
  const exchangeTasks = Array.isArray(state.publicHealthExchangeTasks) ? state.publicHealthExchangeTasks : [];
  const exchangeRuns = Array.isArray(state.publicHealthExchangeRuns) ? state.publicHealthExchangeRuns : [];
  const institutionTasks = Array.isArray(state.publicHealthInstitutionTasks) ? state.publicHealthInstitutionTasks : [];
  const onsiteAcceptances = Array.isArray(state.publicHealthOnsiteAcceptances) ? state.publicHealthOnsiteAcceptances : [];
  const cutoverBlockers = Array.isArray(state.publicHealthCutoverBlockers) ? state.publicHealthCutoverBlockers : [];
  const cutoverEvidencePackets = Array.isArray(state.publicHealthCutoverEvidencePackets) && state.publicHealthCutoverEvidencePackets.length
    ? state.publicHealthCutoverEvidencePackets
    : buildStaticCutoverEvidencePackets(cutoverBlockers);
  const cutoverEvidenceBoard = summarizeCutoverEvidencePackets(cutoverEvidencePackets);
  const siteEvidenceBridge = buildStaticSiteEvidenceBridge(state.siteLaunchEvidence);
  const siteEvidenceVerificationTasks = Array.isArray(state.publicHealthSiteEvidenceVerificationTasks) && state.publicHealthSiteEvidenceVerificationTasks.length
    ? state.publicHealthSiteEvidenceVerificationTasks
    : buildStaticSiteEvidenceVerificationTasks();
  const launchApprovals = Array.isArray(state.publicHealthLaunchApprovals) && state.publicHealthLaunchApprovals.length
    ? state.publicHealthLaunchApprovals
    : buildStaticLaunchApprovals();
  const cutoverDrills = Array.isArray(state.publicHealthCutoverDrills) && state.publicHealthCutoverDrills.length
    ? state.publicHealthCutoverDrills
    : buildStaticCutoverDrills();
  const productionHandoffs = Array.isArray(state.publicHealthProductionHandoffs) && state.publicHealthProductionHandoffs.length
    ? state.publicHealthProductionHandoffs
    : buildStaticProductionHandoffs();
  const goLiveObservations = Array.isArray(state.publicHealthGoLiveObservations) && state.publicHealthGoLiveObservations.length
    ? state.publicHealthGoLiveObservations
    : buildStaticGoLiveObservations();
  const launchIncidents = Array.isArray(state.publicHealthLaunchIncidents) && state.publicHealthLaunchIncidents.length
    ? state.publicHealthLaunchIncidents
    : buildStaticLaunchIncidents();
  const launchDutyShifts = Array.isArray(state.publicHealthLaunchDutyShifts) && state.publicHealthLaunchDutyShifts.length
    ? state.publicHealthLaunchDutyShifts
    : buildStaticLaunchDutyShifts();
  const launchCommandBriefs = Array.isArray(state.publicHealthLaunchCommandBriefs) && state.publicHealthLaunchCommandBriefs.length
    ? state.publicHealthLaunchCommandBriefs
    : buildStaticLaunchCommandBriefs();
  const readinessEvidence = Array.isArray(state.publicHealthReadinessEvidence) ? state.publicHealthReadinessEvidence : [];
  const standardImplementationBoard = buildStaticStandardImplementationBoard(standardImplementationLedger, standards);
  const exchangeExceptionBoard = buildStaticExchangeExceptionBoard(exchangeRuns);
  const domainCoverage = standards.map((item) => ({
    ...item,
    linkedRecords: (item.dataCollections || []).reduce((sum, collection) => sum + countCollection(state, collection), 0),
    linkedCollections: (item.dataCollections || []).filter((collection) => countCollection(state, collection) > 0)
  }));
  const management = standards.filter((item) => item.category === "management");
  const technology = standards.filter((item) => item.category === "technology");
  const riskQueue = events.filter((item) => /high|高|危急|待|处置|已派发/.test(`${item.priority || ""} ${item.status || ""}`));
  const openCutoverBlockers = cutoverBlockers.filter((item) => !isCutoverClosed(item));
  const cutoverReadiness = buildStaticCutoverReadiness(cutoverBlockers, cutoverEvidencePackets);
  const productionHandoffBoard = buildStaticProductionHandoffBoard(productionHandoffs, {
    cutoverBlockers,
    cutoverEvidenceBoard,
    launchApprovals
  });
  const goLiveObservationBoard = buildStaticGoLiveObservationBoard(goLiveObservations);
  const launchIncidentBoard = buildStaticLaunchIncidentBoard(launchIncidents);
  const launchDutyBoard = buildStaticLaunchDutyBoard(launchDutyShifts);
  const launchCommandBriefBoard = buildStaticLaunchCommandBriefBoard(launchCommandBriefs);
  const siteEvidenceVerificationBoard = buildStaticSiteEvidenceVerificationBoard(siteEvidenceVerificationTasks, { siteEvidenceBridge });
  const launchGate = buildStaticLaunchGate({
    standardCoverage: {
      total: {
        domains: standards.length,
        secondary: sumField(standards, "secondaryCount"),
        tertiary: sumField(standards, "tertiaryCount")
      }
    },
    events,
    exchangeTasks,
    exchangeRuns,
    exchangeExceptionBoard,
    institutionTasks,
    onsiteAcceptances,
    cutoverReadiness,
    cutoverEvidenceBoard,
    productionHandoffBoard,
    goLiveObservationBoard,
    launchIncidentBoard,
    launchDutyBoard,
    launchCommandBriefBoard,
    siteEvidenceVerificationTasks,
    siteEvidenceVerificationBoard,
    siteEvidenceBridge,
    launchApprovals
  });
  goLiveObservationBoard.summary.launchGateStatus = launchGate.status;
  goLiveObservationBoard.summary.launchReleaseGate = launchGate.releaseGate;
  launchIncidentBoard.summary.launchGateStatus = launchGate.status;
  launchIncidentBoard.summary.launchReleaseGate = launchGate.releaseGate;
  launchDutyBoard.summary.launchGateStatus = launchGate.status;
  launchDutyBoard.summary.launchReleaseGate = launchGate.releaseGate;
  launchCommandBriefBoard.summary.launchGateStatus = launchGate.status;
  launchCommandBriefBoard.summary.launchReleaseGate = launchGate.releaseGate;
  const cutoverDrillBoard = buildStaticCutoverDrillBoard(cutoverDrills, {
    cutoverReadiness,
    cutoverEvidenceBoard,
    launchGate
  });
  const coordinationCenter = buildStaticCoordinationCenter(state);
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    sourceDocuments: [
      { name: "全国公共卫生信息化建设标准与规范（试行）", type: "PDF", extractedFacts: ["21 个一级指标", "125 个二级指标", "421 个三级指标"] },
      { name: "全国公共卫生信息化建设标准与规范示意图", type: "JPG", extractedFacts: ["七类机构责任覆盖", "平战结合", "医防融合"] }
    ],
    summary: {
      domains: standards.length,
      secondaryIndicators: sumField(standards, "secondaryCount"),
      tertiaryIndicators: sumField(standards, "tertiaryCount"),
      managementDomains: management.length,
      technologyDomains: technology.length,
      standardImplementationDomains: standardImplementationBoard.summary.domains,
      standardImplementationMappingComplete: standardImplementationBoard.summary.mappingComplete,
      standardImplementationReviewed: standardImplementationBoard.summary.reviewed,
      standardImplementationGaps: standardImplementationBoard.summary.gaps,
      standardImplementationAssignedGaps: standardImplementationBoard.summary.assignedRemediations,
      standardImplementationVerifiedGaps: standardImplementationBoard.summary.verifiedRemediations,
      standardImplementationUnassignedGaps: standardImplementationBoard.summary.unassignedRemediations,
      standardImplementationDueSoonGaps: standardImplementationBoard.summary.dueSoonRemediations,
      standardImplementationOverdueGaps: standardImplementationBoard.summary.overdueRemediations,
      standardImplementationStatus: standardImplementationBoard.status,
      standardImplementationEvidenceCandidates: standardImplementationEvidenceCandidates.length,
      institutionScopes: institutionScopes.length,
      events: events.length,
      highPriorityEvents: events.filter((item) => /high|高/.test(`${item.priority || ""}`)).length,
      eventActions: countEventActions(events),
      exchangeTasks: exchangeTasks.length,
      exchangeRuns: exchangeRuns.length,
      exchangeExceptions: exchangeExceptionBoard.summary.exceptions,
      openExchangeExceptions: exchangeExceptionBoard.summary.openExceptions,
      resolvedExchangeExceptions: exchangeExceptionBoard.summary.resolvedExceptions,
      unassignedExchangeExceptions: exchangeExceptionBoard.summary.unassignedExceptions,
      dueSoonExchangeExceptions: exchangeExceptionBoard.summary.dueSoonExceptions,
      overdueExchangeExceptions: exchangeExceptionBoard.summary.overdueExceptions,
      institutionTasks: institutionTasks.length,
      onsiteAcceptances: onsiteAcceptances.length,
      onsiteReady: onsiteAcceptances.filter((item) => /ready|signed|passed|complete|就绪|签署|通过/i.test(`${item.status || ""} ${item.signoffStatus || ""}`)).length,
      cutoverBlockers: cutoverBlockers.length,
      openCutoverBlockers: openCutoverBlockers.length,
      p0OpenCutoverBlockers: openCutoverBlockers.filter((item) => String(item.severity || "").includes("P0")).length,
      cutoverEvidenceRecorded: cutoverReadiness.summary.evidenceRecorded,
      cutoverEvidencePackets: cutoverEvidenceBoard.summary.packets,
      cutoverEvidenceItems: cutoverEvidenceBoard.summary.requiredItems,
      cutoverEvidenceVerifiedItems: cutoverEvidenceBoard.summary.verifiedItems,
      cutoverEvidenceMissingItems: cutoverEvidenceBoard.summary.missingItems,
      cutoverEvidenceCompletePackets: cutoverEvidenceBoard.summary.completePackets,
      siteEvidenceBridgeLinks: siteEvidenceBridge.summary.links,
      siteEvidenceBridgeVerifiedLinks: siteEvidenceBridge.summary.verifiedLinks,
      siteEvidenceBridgeMissingLinks: siteEvidenceBridge.summary.missingLinks,
      siteEvidenceVerificationTasks: siteEvidenceVerificationBoard.summary.tasks,
      siteEvidenceVerificationReadyTasks: siteEvidenceVerificationBoard.summary.structurallyReadyTasks,
      siteEvidenceVerificationEvidenceAvailable: siteEvidenceVerificationBoard.summary.evidenceAvailableTasks,
      siteEvidenceVerificationVerifiedTasks: siteEvidenceVerificationBoard.summary.verifiedTasks,
      siteEvidenceVerificationPendingTasks: siteEvidenceVerificationBoard.summary.pendingTasks,
      siteEvidenceVerificationBlockedTasks: siteEvidenceVerificationBoard.summary.blockedTasks,
      siteEvidenceVerificationStatus: siteEvidenceVerificationBoard.status,
      launchApprovals: launchGate.summary.approvals,
      launchSignedApprovals: launchGate.summary.signedApprovals,
      launchBlockedRequirements: launchGate.summary.blockedRequirements,
      launchGateStatus: launchGate.status,
      cutoverDrills: cutoverDrillBoard.summary.drills,
      cutoverDrillBlocked: cutoverDrillBoard.summary.blockedDrills,
      cutoverDrillOpenFindings: cutoverDrillBoard.summary.openFindings,
      cutoverDrillStatus: cutoverDrillBoard.status,
      productionHandoffs: productionHandoffBoard.summary.handoffs,
      productionHandoffAccepted: productionHandoffBoard.summary.acceptedHandoffs,
      productionHandoffPending: productionHandoffBoard.summary.pendingHandoffs,
      productionHandoffMissingSignoffs: productionHandoffBoard.summary.missingSignoffs,
      productionHandoffStatus: productionHandoffBoard.status,
      goLiveObservations: goLiveObservationBoard.summary.observations,
      goLiveObservationPlanReady: goLiveObservationBoard.summary.planReady,
      goLiveObservationPassed: goLiveObservationBoard.summary.passedObservations,
      goLiveObservationPending: goLiveObservationBoard.summary.pendingObservations,
      goLiveOpenCriticalSignals: goLiveObservationBoard.summary.openCriticalSignals,
      goLiveRollbackPlans: goLiveObservationBoard.summary.rollbackPlans,
      goLiveObservationStatus: goLiveObservationBoard.status,
      launchIncidentLanes: launchIncidentBoard.summary.lanes,
      launchIncidentDeskReady: launchIncidentBoard.summary.deskReady,
      launchIncidentOpenTickets: launchIncidentBoard.summary.openTickets,
      launchIncidentCriticalOpen: launchIncidentBoard.summary.criticalOpenTickets,
      launchIncidentRollbackOwners: launchIncidentBoard.summary.rollbackDecisionOwners,
      launchIncidentStatus: launchIncidentBoard.status,
      launchDutyShifts: launchDutyBoard.summary.shifts,
      launchDutyReadyShifts: launchDutyBoard.summary.readyShifts,
      launchDutyPendingShifts: launchDutyBoard.summary.pendingShifts,
      launchDutyMissedHandoffs: launchDutyBoard.summary.missedHandoffs,
      launchDutyEscalatedShifts: launchDutyBoard.summary.escalatedShifts,
      launchDutyStatus: launchDutyBoard.status,
      launchCommandBriefs: launchCommandBriefBoard.summary.briefs,
      launchCommandReadyBriefs: launchCommandBriefBoard.summary.readyBriefs,
      launchCommandPendingBriefs: launchCommandBriefBoard.summary.pendingBriefs,
      launchCommandPublishedBriefs: launchCommandBriefBoard.summary.publishedBriefs,
      launchCommandBlockedBriefs: launchCommandBriefBoard.summary.blockedBriefs,
      launchCommandExpectedAcknowledgements: launchCommandBriefBoard.summary.expectedAcknowledgements,
      launchCommandAcknowledgedRecipients: launchCommandBriefBoard.summary.acknowledgedRecipients,
      launchCommandPendingAcknowledgements: launchCommandBriefBoard.summary.pendingAcknowledgements,
      launchCommandEscalatedAcknowledgements: launchCommandBriefBoard.summary.escalatedAcknowledgements,
      launchCommandStatus: launchCommandBriefBoard.status,
      dueSoonCutoverBlockers: cutoverReadiness.summary.dueSoon,
      overdueCutoverBlockers: cutoverReadiness.summary.overdue,
      redCutoverBlockers: cutoverReadiness.summary.red,
      amberCutoverBlockers: cutoverReadiness.summary.amber,
      cutoverReadinessLevel: cutoverReadiness.readinessLevel,
      readinessEvidence: readinessEvidence.length,
      coordinationLanes: coordinationCenter.summary.lanes,
      coordinationHandoffs: coordinationCenter.summary.handoffs,
      coordinationOpenHandoffs: coordinationCenter.summary.openHandoffs,
      coordinationStructurallyReady: coordinationCenter.summary.structurallyReady
    },
    standardCoverage: {
      management: {
        domains: management.length,
        secondary: sumField(management, "secondaryCount"),
        tertiary: sumField(management, "tertiaryCount")
      },
      technology: {
        domains: technology.length,
        secondary: sumField(technology, "secondaryCount"),
        tertiary: sumField(technology, "tertiaryCount")
      },
      total: {
        domains: standards.length,
        secondary: sumField(standards, "secondaryCount"),
        tertiary: sumField(standards, "tertiaryCount")
      }
    },
    standardDomains: domainCoverage,
    standardImplementationLedger,
    standardImplementationBoard,
    standardImplementationEvidenceCandidates,
    institutionScopes,
    events,
    riskQueue,
    exchangeTasks,
    exchangeRuns,
    exchangeExceptionBoard,
    institutionTasks,
    onsiteAcceptances,
    cutoverBlockers,
    cutoverEvidencePackets,
    cutoverEvidenceBoard,
    siteEvidenceBridge,
    siteEvidenceVerificationTasks,
    siteEvidenceVerificationBoard,
    launchApprovals,
    launchGate,
    cutoverDrills,
    cutoverDrillBoard,
    productionHandoffs,
    productionHandoffBoard,
    goLiveObservations,
    goLiveObservationBoard,
    launchIncidents,
    launchIncidentBoard,
    launchDutyShifts,
    launchDutyBoard,
    launchCommandBriefs,
    launchCommandBriefBoard,
    openCutoverBlockers,
    cutoverReadiness,
    readinessEvidence,
    coordinationCenter
  };
}

function buildStaticCoordinationCenter(state = {}) {
  const definitions = [
    { id: "infectious-reporting", name: "传染病发现与直报", owner: "疾控中心传染病监测部门", domains: ["ph-infectious"], collections: ["publicHealthEvents", "phase2DiseaseReportQueue", "phase2DiseaseReportReceipts"], dependencies: ["疾控直报回执", "VPN/专线"], evidence: ["direct-report-receipt", "cdc-review", "followup-conclusion"] },
    { id: "immunization", name: "免疫规划", owner: "疾控免疫规划部门", domains: ["ph-immunization"], collections: ["birthCertificates", "publicHealthEvents"], dependencies: ["儿童接种档案", "冷链与 AEFI 回执"], evidence: ["registry-receipt", "cold-chain-receipt", "aefi-handoff"] },
    { id: "maternal-child", name: "妇幼健康", owner: "妇幼保健机构/妇幼健康处", domains: ["ph-maternal-child"], collections: ["birthCertificates", "birthStatistics", "personalRecords"], dependencies: ["妇幼入册", "公安共享回执"], evidence: ["maternal-enrollment-receipt", "screening-handoff", "public-security-receipt"] },
    { id: "senior-health", name: "老年健康", owner: "基层医疗卫生机构", domains: ["ph-senior"], collections: ["seniorServices", "personalRecords", "followups"], dependencies: ["老年健康评估", "民政协同授权"], evidence: ["outreach-receipt", "health-assessment", "family-doctor-handoff"] },
    { id: "chronic-management", name: "慢性病防控", owner: "基层卫生部门/疾控慢病部门", domains: ["ph-chronic"], collections: ["chronicScreeningTasks", "chronicManagementPlans", "followups"], dependencies: ["慢病平台", "药房回调"], evidence: ["risk-assessment", "followup-result", "medication-adherence"] },
    { id: "public-health-followup", name: "基本公卫随访", owner: "基层公卫专班", domains: ["ph-chronic", "ph-archive"], collections: ["followups", "taskMessages", "personalRecords"], dependencies: ["基层公卫绩效口径", "随访回写"], evidence: ["dispatch-receipt", "service-result", "resident-feedback"] },
    { id: "health-education", name: "健康教育", owner: "疾控健康教育部门/基层机构", domains: ["ph-health-education"], collections: ["chronicEducationPushes", "publicHealthEvents"], dependencies: ["居民端投递回执", "效果评价"], evidence: ["delivery-receipt", "audience-coverage", "effect-evaluation"] },
    { id: "family-doctor", name: "家庭医生协同", owner: "基层卫生部门/家庭医生团队", domains: ["ph-chronic", "ph-archive"], collections: ["phase2FamilyDoctorApplications", "phase2FamilyDoctorContracts", "phase2FamilyDoctorFulfillments", "followups"], dependencies: ["正式签约服务", "履约回写"], evidence: ["application-review", "contract-or-renewal", "fulfillment-receipt"] }
  ];
  const lanes = definitions.map((item) => {
    const missingCollections = item.collections.filter((collection) => countCollection(state, collection) === 0);
    return {
      id: item.id,
      name: item.name,
      owner: item.owner,
      standardDomainIds: item.domains,
      sourceCollections: item.collections,
      externalDependencies: item.dependencies,
      requiredEvidence: item.evidence,
      missingCollections,
      structurallyReady: !missingCollections.length,
      metrics: {
        total: item.collections.reduce((sum, collection) => sum + countCollection(state, collection), 0),
        open: item.collections.reduce((sum, collection) => sum + countCollection(state, collection), 0)
      }
    };
  });
  const handoffs = lanes.map((lane) => {
    const sourceRefs = lane.sourceCollections.flatMap((collection) => {
      const value = state?.[collection];
      if (Array.isArray(value)) return value.slice(0, 1).map((item) => item?.id || collection);
      return value && typeof value === "object" ? [value.id || collection] : [];
    }).filter(Boolean);
    return {
      id: `phc-${lane.id}-static`,
      laneId: lane.id,
      version: 1,
      state: "detected",
      sourceRefs,
      standardDomainIds: lane.standardDomainIds,
      requiredEvidence: lane.requiredEvidence,
      businessKey: sourceRefs[0] || lane.id,
      productionReady: false
    };
  });
  const structurallyReady = lanes.filter((item) => item.structurallyReady).length;
  return {
    ok: lanes.length === 8 && structurallyReady === 8,
    functionalState: "eight-lane-static-coordination-runnable",
    formalGoLiveState: "blocked-until-external-receipts-and-site-evidence-verified",
    summary: {
      lanes: lanes.length,
      structurallyReady,
      handoffs: handoffs.length,
      openHandoffs: handoffs.length,
      closedHandoffs: 0,
      externalDependencies: new Set(lanes.flatMap((item) => item.externalDependencies)).size
    },
    lanes,
    handoffs,
    productionReady: false
  };
}

function renderPublicHealthSystem(system) {
  currentPublicHealthSystem = system;
  setPublicHealthMessage("");
  renderMetrics(system);
  renderPublicHealthHighlights(system.highlights || {});
  renderPublicHealthCoordinationCenter(system.coordinationCenter || {});
  renderSourceDocuments(system.sourceDocuments || []);
  renderStandardDomains(system);
  renderStandardImplementationLedger(system.standardImplementationBoard || buildStaticStandardImplementationBoard(system.standardImplementationLedger || [], system.standardDomains || []), system.standardImplementationEvidenceCandidates || []);
  renderInstitutionScopes(system.institutionScopes || []);
  renderRiskQueue(system.riskQueue || []);
  renderExchangeTasks(system.exchangeTasks || []);
  renderExchangeRuns(system.exchangeRuns || [], system.exchangeExceptionBoard || buildStaticExchangeExceptionBoard(system.exchangeRuns || []));
  renderInstitutionTasks(system.institutionTasks || []);
  renderOnsiteAcceptances(system.onsiteAcceptances || []);
  renderCutoverReadiness(system.cutoverReadiness || buildStaticCutoverReadiness(system.cutoverBlockers || [], system.cutoverEvidencePackets || []));
  renderCutoverEvidencePackets(system.cutoverEvidenceBoard?.packets || system.cutoverEvidencePackets || []);
  renderCutoverDrills(system.cutoverDrillBoard || buildStaticCutoverDrillBoard(system.cutoverDrills || []));
  renderProductionHandoffs(system.productionHandoffBoard || buildStaticProductionHandoffBoard(system.productionHandoffs || []));
  renderGoLiveObservations(system.goLiveObservationBoard || buildStaticGoLiveObservationBoard(system.goLiveObservations || []));
  renderLaunchIncidents(system.launchIncidentBoard || buildStaticLaunchIncidentBoard(system.launchIncidents || []));
  renderLaunchDutyShifts(system.launchDutyBoard || buildStaticLaunchDutyBoard(system.launchDutyShifts || []));
  renderLaunchCommandBriefs(system.launchCommandBriefBoard || buildStaticLaunchCommandBriefBoard(system.launchCommandBriefs || []));
  renderSiteEvidenceBridge(system.siteEvidenceBridge || { status: "missing-site-evidence", summary: {}, links: [] });
  renderSiteEvidenceVerificationTasks(system.siteEvidenceVerificationBoard || buildStaticSiteEvidenceVerificationBoard(system.siteEvidenceVerificationTasks || [], { siteEvidenceBridge: system.siteEvidenceBridge || {} }));
  renderLaunchGate(system.launchGate || buildStaticLaunchGate({
    standardCoverage: system.standardCoverage,
    events: system.events || [],
    exchangeTasks: system.exchangeTasks || [],
    exchangeRuns: system.exchangeRuns || [],
    institutionTasks: system.institutionTasks || [],
    onsiteAcceptances: system.onsiteAcceptances || [],
    cutoverReadiness: system.cutoverReadiness,
    cutoverEvidenceBoard: system.cutoverEvidenceBoard,
    goLiveObservationBoard: system.goLiveObservationBoard,
    launchIncidentBoard: system.launchIncidentBoard,
    launchDutyBoard: system.launchDutyBoard,
    launchCommandBriefBoard: system.launchCommandBriefBoard,
    siteEvidenceVerificationBoard: system.siteEvidenceVerificationBoard,
    siteEvidenceBridge: system.siteEvidenceBridge,
    launchApprovals: system.launchApprovals || []
  }));
  renderCutoverBlockers(system.cutoverBlockers || []);
  renderEvidence(system.readinessEvidence || []);
}

function renderPublicHealthCoordinationCenter(center) {
  const target = document.querySelector("#public-health-coordination-center");
  if (!target) return;
  const lanes = Array.isArray(center.lanes) ? center.lanes : [];
  const handoffs = Array.isArray(center.handoffs) ? center.handoffs : [];
  const summary = center.summary || {};
  const canAct = Boolean(PUBLIC_HEALTH_API_BASE && window.HealthCityAuth?.authFetch);
  if (!lanes.length) {
    target.innerHTML = `<article class="priority-row"><div class="priority-rank warn">8</div><div><strong>八领域协同数据待同步</strong><p>等待 /api/public-health/system 返回 coordinationCenter，静态预览将从本地业务集合生成。</p></div></article>`;
    return;
  }
  const handoffByLane = new Map(handoffs.map((item) => [item.laneId, item]));
  const header = `<article class="priority-row">
    <div class="priority-rank ${center.productionReady ? "ok" : "warn"}">${escapeHtml(summary.structurallyReady || 0)}/${escapeHtml(summary.lanes || lanes.length)}</div>
    <div>
      <strong>八领域统一协同</strong>
      <p>交接 ${escapeHtml(summary.handoffs || handoffs.length)} 项；开放 ${escapeHtml(summary.openHandoffs || 0)} 项；外部依赖 ${escapeHtml(summary.externalDependencies || 0)} 项。</p>
      <small>功能态：${escapeHtml(center.functionalState || "coordination-runnable")}；上线态：${escapeHtml(center.formalGoLiveState || "site-evidence-required")}</small>
    </div>
  </article>`;
  const cards = lanes.map((lane, index) => {
    const handoff = handoffByLane.get(lane.id) || {};
    const metric = lane.metrics || {};
    const state = handoff.state || "detected";
    const stateClass = state === "closed" ? "ok" : state === "exception-open" ? "danger" : "warn";
    const actionControls = buildPublicHealthCoordinationActionControls(handoff, lane, canAct);
    return `<article class="priority-row" data-public-health-coordination-lane="${escapeHtml(lane.id)}">
      <div class="priority-rank ${stateClass}">${escapeHtml(index + 1)}</div>
      <div>
        <strong>${escapeHtml(lane.name || lane.id)}</strong>
        <p>${escapeHtml(lane.owner || "待确认责任部门")}；业务记录 ${escapeHtml(metric.total || 0)} 项，开放 ${escapeHtml(metric.open || 0)} 项。</p>
        <small>交接 ${escapeHtml(handoff.id || "待生成")} / ${escapeHtml(state)}；标准域 ${escapeHtml((lane.standardDomainIds || []).join("、"))}；来源 ${escapeHtml((handoff.sourceRefs || []).join(" / ") || "待同步")}</small>
        <small>外部依赖：${escapeHtml((lane.externalDependencies || []).join("；"))}</small>
        ${handoff.lastAction ? `<small>最近动作：${escapeHtml(handoff.lastAction.action || "")} / ${escapeHtml(handoff.lastAction.actor || "")} / v${escapeHtml(handoff.version || "")}</small>` : ""}
        ${actionControls}
      </div>
    </article>`;
  }).join("");
  target.innerHTML = header + cards;
}

function buildPublicHealthCoordinationActionControls(handoff, lane, canAct) {
  if (!canAct || !handoff.id) return "";
  const states = {
    detected: [["assign-coordination", "分派"]],
    reopened: [["assign-coordination", "重新分派"]],
    assigned: [["start-coordination", "接单"]],
    "in-progress": [["record-coordination-receipt", "记录成功回执"], ["record-coordination-receipt", "记录拒收", "rejected"]],
    "exception-open": [["retry-coordination", "修复重试"]],
    "receipt-confirmed": [["close-coordination", "证据关闭"]],
    closed: [["reopen-coordination", "重新打开"]]
  };
  const actions = states[handoff.state || "detected"] || [];
  if (!actions.length) return "";
  return `<div class="action-row">${actions.map(([action, label, receiptStatus]) => `<button type="button" class="inline-action" data-public-health-coordination-handoff="${escapeHtml(handoff.id)}" data-public-health-coordination-lane-id="${escapeHtml(lane.id || handoff.laneId || "")}" data-public-health-coordination-action="${escapeHtml(action)}" data-public-health-coordination-receipt-status="${escapeHtml(receiptStatus || "accepted")}">${escapeHtml(label)}</button>`).join("")}</div>`;
}

async function handlePublicHealthCoordinationAction(event) {
  const button = event.target.closest("[data-public-health-coordination-action]");
  if (!button || !PUBLIC_HEALTH_API_BASE || !window.HealthCityAuth?.authFetch) return;
  const handoffId = button.dataset.publicHealthCoordinationHandoff;
  const laneId = button.dataset.publicHealthCoordinationLaneId;
  const action = button.dataset.publicHealthCoordinationAction;
  const receiptStatus = button.dataset.publicHealthCoordinationReceiptStatus || "accepted";
  const center = currentPublicHealthSystem?.coordinationCenter || {};
  const handoff = (center.handoffs || []).find((item) => item.id === handoffId);
  const lane = (center.lanes || []).find((item) => item.id === laneId);
  if (!handoff || !lane || !action) return;
  const version = Number(handoff.version || 1);
  const dueAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const payload = {
    action,
    expectedVersion: version,
    idempotencyKey: `${handoff.id}:${action}:v${version}`,
    note: `${lane.name || lane.id}工作台执行${button.textContent.trim()}`
  };
  if (action === "assign-coordination") Object.assign(payload, { assignedTo: lane.owner, dueAt });
  if (action === "record-coordination-receipt") Object.assign(payload, {
    receiptStatus,
    receiptCode: `PHC-${lane.id}-${version}`,
    evidenceRefs: [`${lane.id}-${receiptStatus}-receipt`],
    ...(receiptStatus === "rejected" ? { reason: "接口拒收，转责任部门修复后重试。", exceptionOwner: lane.owner, dueAt } : {})
  });
  if (action === "close-coordination") Object.assign(payload, {
    conclusion: `${lane.name || lane.id}协同回执及业务证据已核对。`,
    evidenceRefs: handoff.requiredEvidence || lane.requiredEvidence || []
  });
  const previousLabel = button.textContent;
  button.disabled = true;
  button.textContent = "处理中";
  setPublicHealthMessage("");
  try {
    const response = await window.HealthCityAuth.authFetch(`/api/public-health/coordination/${encodeURIComponent(handoff.id)}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "公共卫生协同动作失败");
    renderPublicHealthSystem(result.system || await loadPublicHealthSystem());
    setPublicHealthMessage(`${lane.name || lane.id}：${previousLabel}已记录`);
  } catch (error) {
    setPublicHealthMessage(error.message || "公共卫生协同动作失败");
  } finally {
    button.disabled = false;
    button.textContent = previousLabel;
  }
}

function renderPublicHealthHighlights(highlights) {
  const target = document.querySelector("#public-health-highlight-center");
  if (!target) return;
  const capabilities = Array.isArray(highlights.capabilities) ? highlights.capabilities : [];
  const summary = highlights.summary || {};
  if (!capabilities.length) {
    target.innerHTML = `<article class="priority-row">
      <div class="priority-rank warn">PH</div>
      <div>
        <strong>亮点能力待同步</strong>
        <p>请通过 /api/public-health/highlights 读取公共卫生监测预警、指挥调度和证据驾驶舱数据。</p>
      </div>
    </article>`;
    return;
  }
  const header = `<article class="priority-row">
    <div class="priority-rank ok">${escapeHtml(summary.capabilities || capabilities.length)}</div>
    <div>
      <strong>五套亮点能力已接入</strong>
      <p>活跃预警 ${escapeHtml(summary.activeAlerts || 0)} 个，开放任务 ${escapeHtml(summary.openTasks || 0)} 个，可用资源 ${escapeHtml(summary.readyResources || 0)}/${escapeHtml(summary.resources || 0)}，证据得分 ${escapeHtml(summary.evidenceScore || 0)}%。</p>
      <small>功能态：${escapeHtml(highlights.functionalState || "runnable")}；上线态：${escapeHtml(highlights.formalGoLiveState || "site-evidence-required")}</small>
    </div>
  </article>`;
  target.innerHTML = header + capabilities.map((item, index) => `<article class="priority-row">
    <div class="priority-rank ${index < 2 ? "danger" : "warn"}">${escapeHtml(index + 1)}</div>
    <div>
      <strong>${escapeHtml(item.name || item.id)}</strong>
      <p>${escapeHtml(item.description || "")}</p>
      <small>${escapeHtml(item.owner || "")} / ${escapeHtml((item.sources || []).join("、"))}</small>
    </div>
  </article>`).join("");
}

function renderMetrics(system) {
  const summary = system.summary || {};
  document.querySelector("#public-health-metrics").innerHTML = [
    ["一级指标", summary.domains || 0, `${summary.managementDomains || 0} 管理服务 + ${summary.technologyDomains || 0} 信息技术`],
    ["二级指标", summary.secondaryIndicators || 0, "标准目录覆盖"],
    ["三级指标", summary.tertiaryIndicators || 0, "建设要求口径"],
    ["机构责任", summary.institutionScopes || 0, "示意图机构覆盖"],
    ["风险事件", summary.events || 0, `${summary.highPriorityEvents || 0} 个高优先级`],
    ["处置动作", summary.eventActions || 0, "复核/派发/闭环留痕"],
    ["交换任务", summary.exchangeTasks || 0, "直报/实验室/免疫/妇幼/应急/安全"],
    ["交换运行", summary.exchangeRuns || 0, "回执/失败补偿/重放"],
    ["机构协同", summary.institutionTasks || 0, "七类机构任务清单"],
    ["现场验收", summary.onsiteAcceptances || 0, `${summary.onsiteReady || 0} 项就绪`],
    ["上线阻塞", summary.openCutoverBlockers ?? summary.cutoverBlockers ?? 0, `${summary.p0OpenCutoverBlockers || 0} 个 P0 未关闭`],
    ["上线准备", summary.cutoverReadinessLevel || system.cutoverReadiness?.readinessLevel || "blocked", `${summary.cutoverEvidenceRecorded || 0} 项证据已记录`],
    ["证据包", summary.cutoverEvidencePackets || 0, `${summary.cutoverEvidenceVerifiedItems || 0}/${summary.cutoverEvidenceItems || 0} 项已核验`],
    ["上线演练", summary.cutoverDrills || 0, `${summary.cutoverDrillBlocked || 0} blocked / ${summary.cutoverDrillOpenFindings || 0} findings`],
    ["生产移交", summary.productionHandoffs || 0, `${summary.productionHandoffAccepted || 0} accepted / ${summary.productionHandoffPending || 0} pending`],
    ["上线观察", summary.goLiveObservations || 0, `${summary.goLiveObservationPlanReady || 0} ready / ${summary.goLiveObservationPending || 0} pending`],
    ["问题分诊", summary.launchIncidentLanes || 0, `${summary.launchIncidentDeskReady || 0} ready / ${summary.launchIncidentCriticalOpen || 0} critical`],
    ["值守交接", summary.launchDutyShifts || 0, `${summary.launchDutyReadyShifts || 0} ready / ${summary.launchDutyMissedHandoffs || 0} missed`],
    ["现场桥接", summary.siteEvidenceBridgeVerifiedLinks || 0, `${summary.siteEvidenceBridgeLinks || 0} links / ${summary.siteEvidenceBridgeMissingLinks || 0} missing`],
    ["现场核验", summary.siteEvidenceVerificationVerifiedTasks || 0, `${summary.siteEvidenceVerificationTasks || 0} tasks / ${summary.siteEvidenceVerificationPendingTasks || 0} pending`],
    ["上线 Gate", summary.launchGateStatus || system.launchGate?.status || "blocked", `${summary.launchSignedApprovals || 0}/${summary.launchApprovals || 0} 方已审批`],
    ["验收证据", summary.readinessEvidence || 0, "纳入发布证据链"],
    ["Command briefs", summary.launchCommandBriefs || 0, `${summary.launchCommandReadyBriefs || 0} ready / ${summary.launchCommandPendingBriefs || 0} pending`],
    ["Readiness", system.ok ? "OK" : "Check", system.generatedAt || ""]
  ].map(([label, value, hint]) => `<article class="metric-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(hint)}</small></article>`).join("");
}

function renderSourceDocuments(documents) {
  document.querySelector("#public-health-source-documents").innerHTML = documents.map((item) => `<div>
    <strong>${escapeHtml(item.name)}</strong>
    <span>${escapeHtml(item.type || "")}</span>
    <small>${escapeHtml((item.extractedFacts || []).join(" / "))}</small>
  </div>`).join("");
}

function renderStandardDomains(system) {
  const coverage = system.standardCoverage || {};
  document.querySelector("#public-health-standard-summary").textContent =
    `管理服务 ${coverage.management?.domains || 0}/${coverage.management?.secondary || 0}/${coverage.management?.tertiary || 0}，信息技术 ${coverage.technology?.domains || 0}/${coverage.technology?.secondary || 0}/${coverage.technology?.tertiary || 0}`;
  document.querySelector("#public-health-standard-domains").innerHTML = `<table>
    <thead><tr><th>序号</th><th>一级指标</th><th>类型</th><th>二级</th><th>三级</th><th>牵头</th><th>复用数据</th><th>状态</th></tr></thead>
    <tbody>${(system.standardDomains || []).map((item) => `<tr>
      <td>${escapeHtml(item.order)}</td>
      <td>${escapeHtml(item.name)}</td>
      <td><span class="badge ${item.category === "technology" ? "info" : "warn"}">${escapeHtml(item.category === "technology" ? "信息技术" : "管理服务")}</span></td>
      <td>${escapeHtml(item.secondaryCount)}</td>
      <td>${escapeHtml(item.tertiaryCount)}</td>
      <td>${escapeHtml(item.owner || "")}</td>
      <td>${escapeHtml((item.linkedCollections || item.dataCollections || []).join(", "))}<small>${escapeHtml(item.linkedRecords || 0)} 条</small></td>
      <td>${escapeHtml(item.status || "已建模")}</td>
    </tr>`).join("")}</tbody>
  </table>`;
}

function renderStandardImplementationLedger(board, evidenceCandidates = []) {
  const canAct = Boolean(PUBLIC_HEALTH_API_BASE && window.HealthCityAuth?.authFetch);
  const target = document.querySelector("#public-health-standard-implementation");
  if (!target) return;
  const summary = board?.summary || {};
  const rows = Array.isArray(board?.entries) ? board.entries : [];
  const candidates = Array.isArray(evidenceCandidates) ? evidenceCandidates : [];
  const evidenceOptions = candidates.map((item) => `<option value="${escapeHtml(item.id || "")}">${escapeHtml(`${item.artifactName || item.id} / ${item.templateId || "现场材料"}`)}</option>`).join("");
  const header = `<div class="panel-title"><span data-public-health-standard-implementation-summary>映射 ${escapeHtml(summary.mappingComplete || 0)}/${escapeHtml(summary.domains || 0)}；已复核 ${escapeHtml(summary.reviewed || 0)}；差距 ${escapeHtml(summary.gaps || 0)}；待分派 ${escapeHtml(summary.unassignedRemediations || 0)}；临期 ${escapeHtml(summary.dueSoonRemediations || 0)}；逾期 ${escapeHtml(summary.overdueRemediations || 0)}；已分派 ${escapeHtml(summary.assignedRemediations || 0)}；整改已核验 ${escapeHtml(summary.verifiedRemediations || 0)}；已核验证据 ${escapeHtml(candidates.length)}；${escapeHtml(formatStandardImplementationLabel(board?.status || "mapping-review-pending"))}</span></div>`;
  target.innerHTML = header + (rows.map((item) => `<article class="priority-row" data-public-health-standard-row="${escapeHtml(item.id || "")}">
    <div class="priority-rank ${item.remediationOverdue ? "danger" : item.remediationDueSoon ? "warn" : item.gapRecorded ? "danger" : item.reviewed ? "ok" : "warn"}">${escapeHtml(item.order || "-")}</div>
    <div>
      <h3>${escapeHtml(item.name || "")}</h3>
      <p>${escapeHtml(item.owner || "")} / ${escapeHtml(formatStandardImplementationLabel(item.status || "modeled"))} / ${escapeHtml(item.tertiaryRange || "")}</p>
      <small>${escapeHtml((item.dataCollections || []).join(" / "))}</small>
      <small>${escapeHtml((item.interfaces || []).join(" / "))}</small>
      <small>${escapeHtml(item.nextAction || "")}</small>
      ${canAct ? `<div class="action-row">
        <button type="button" class="inline-action" data-public-health-standard-implementation="${escapeHtml(item.id || "")}" data-public-health-standard-action="review-standard-mapping" data-public-health-standard-status="reviewed" ${item.reviewed ? "disabled" : ""}>记录复核</button>
        <input class="inline-action-input" type="text" maxlength="240" data-public-health-standard-note placeholder="差距或升级说明">
        <button type="button" class="inline-action" data-public-health-standard-implementation="${escapeHtml(item.id || "")}" data-public-health-standard-action="record-standard-gap" data-public-health-standard-status="gap-recorded">记录差距</button>
        <button type="button" class="inline-action" data-public-health-standard-implementation="${escapeHtml(item.id || "")}" data-public-health-standard-action="escalate-standard-gap" data-public-health-standard-status="escalated">升级</button>
        ${item.gapRecorded ? `<input class="inline-action-input" type="text" maxlength="80" value="${escapeHtml(item.remediationOwner || "")}" data-public-health-standard-remediation-owner placeholder="整改责任人"><input class="inline-action-input" type="date" value="${escapeHtml(item.remediationDueAt || "")}" data-public-health-standard-remediation-due-at><button type="button" class="inline-action" data-public-health-standard-implementation="${escapeHtml(item.id || "")}" data-public-health-standard-action="assign-standard-gap-remediation">分派整改</button>` : ""}
        ${candidates.length ? `<select class="inline-action-select" data-public-health-standard-evidence-id><option value="">选择已核验证据</option>${evidenceOptions}</select><button type="button" class="inline-action" data-public-health-standard-implementation="${escapeHtml(item.id || "")}" data-public-health-standard-action="link-standard-site-evidence" data-public-health-standard-status="evidence-linked">关联证据</button>${item.gapRecorded ? `<button type="button" class="inline-action" data-public-health-standard-implementation="${escapeHtml(item.id || "")}" data-public-health-standard-action="verify-standard-gap-remediation">核验整改</button>` : ""}` : `<small>暂无已核验现场证据可关联</small>`}
      </div>` : ""}
    </div>
    <div class="capability-side">
      <span class="badge ${item.gapRecorded ? "danger" : item.mappingComplete ? "ok" : "warn"}">${escapeHtml(item.mappingComplete ? "映射完整" : "映射缺失")}</span>
      <small>${escapeHtml(formatStandardImplementationLabel(item.gapStatus || "not-assessed"))}</small>
      <small>${escapeHtml(item.remediationOwner ? `整改：${item.remediationOwner}${item.remediationDueAt ? ` / ${item.remediationDueAt}` : ""}` : "整改责任人待分派")}</small>
      <small>${escapeHtml(formatStandardImplementationLabel(item.remediationStatus || "not-planned"))}</small>
      ${item.gapRecorded ? `<span class="badge ${item.remediationOverdue ? "danger" : item.remediationDueSoon || item.remediationUnassigned ? "warn" : "info"}">${escapeHtml(formatStandardRemediationWatch(item))}</span>` : ""}
      <small>${escapeHtml(item.siteEvidenceId ? "已关联现场证据" : "未关联现场证据")}</small>
    </div>
  </article>`).join("") || `<article class="priority-row"><div class="priority-rank info">0</div><div><h3>标准实施台账待同步</h3><p>缺少 publicHealthStandardImplementationLedger 数据。</p></div></article>`);
}

function formatStandardImplementationLabel(value) {
  const labels = {
    modeled: "已建模",
    reviewed: "已复核",
    "gap-recorded": "已记录差距",
    escalated: "已升级",
    "evidence-linked": "已关联证据",
    "mapping-review-pending": "待映射复核",
    "gap-review-required": "需复核差距",
    "not-assessed": "尚未评估",
    open: "待整改",
    assigned: "已分派整改",
    "not-planned": "整改计划待分派",
    verified: "整改已核验",
    "remediation-overdue": "存在逾期整改"
  };
  return labels[String(value || "")] || String(value || "");
}

function formatStandardRemediationWatch(item = {}) {
  if (item.remediationOverdue) return `整改逾期 ${Math.abs(Number(item.remediationDueInDays || 0))} 天`;
  if (item.remediationDueSoon) return `整改 ${Number(item.remediationDueInDays || 0)} 天内到期`;
  if (item.remediationUnassigned) return "整改待分派";
  return "整改跟踪中";
}

function renderInstitutionScopes(items) {
  document.querySelector("#public-health-institution-scopes").innerHTML = items.map((item) => `<article class="evidence-card">
    <span>${escapeHtml(item.institutionType || "")}</span>
    <h3>${escapeHtml(item.name)}</h3>
    <p>${escapeHtml((item.responsibilities || []).join("、"))}</p>
    <small>${escapeHtml((item.coveredDomains || []).join(" / "))}</small>
    <strong>${escapeHtml(item.status || "")}</strong>
  </article>`).join("") || `<article class="evidence-card"><h3>机构责任待同步</h3><p>静态数据未包含机构覆盖清单。</p></article>`;
}

function renderRiskQueue(items) {
  const canAct = Boolean(PUBLIC_HEALTH_API_BASE && window.HealthCityAuth?.authFetch);
  document.querySelector("#public-health-risk-queue").innerHTML = items.map((item, index) => {
    const latestAction = item.lastAction || (Array.isArray(item.actionHistory) ? item.actionHistory[0] : null);
    const closed = /已闭环|已完成|closed|resolved/i.test(String(item.status || ""));
    return `<article class="priority-row">
    <div class="priority-rank ${/high|高/.test(`${item.priority || ""}`) ? "danger" : "warn"}">${index + 1}</div>
    <div>
      <h3>${escapeHtml(item.signal || item.domain)}</h3>
      <p>${escapeHtml(item.domain || "")} / ${escapeHtml(item.institution || "")} / ${escapeHtml(item.status || "")}</p>
      <small>${escapeHtml(item.commandAction || "")}</small>
      ${latestAction ? `<small data-public-health-latest-action="${escapeHtml(latestAction.action || latestAction.label || "latest")}">最近动作：${escapeHtml(latestAction.label || latestAction.action)} / ${escapeHtml(latestAction.actor || "")} / ${escapeHtml(latestAction.status || "")}</small>` : ""}
      ${canAct ? `<div class="action-row">
        <button type="button" class="inline-action" data-public-health-action="review" data-public-health-event="${escapeHtml(item.id)}" ${closed ? "disabled" : ""}>复核</button>
        <button type="button" class="inline-action" data-public-health-action="dispatch" data-public-health-event="${escapeHtml(item.id)}" ${closed ? "disabled" : ""}>派发</button>
        <button type="button" class="inline-action" data-public-health-action="close" data-public-health-event="${escapeHtml(item.id)}">闭环</button>
      </div>` : ""}
    </div>
    <div class="capability-side">
      <span class="badge ${/high|高/.test(`${item.priority || ""}`) ? "danger" : "warn"}">${escapeHtml(item.priority || "normal")}</span>
      <small>${escapeHtml(item.region || "")}</small>
      <small>${escapeHtml(item.assignedTo || "")}</small>
    </div>
  </article>`;
  }).join("") || `<article class="priority-row"><div class="priority-rank info">0</div><div><h3>暂无风险队列</h3><p>等待事件监测或静态数据同步。</p></div></article>`;
}

async function handlePublicHealthEventAction(event) {
  const button = event.target.closest("[data-public-health-action]");
  if (!button) return;
  const eventId = button.dataset.publicHealthEvent;
  const action = button.dataset.publicHealthAction;
  if (!eventId || !action || !PUBLIC_HEALTH_API_BASE || !window.HealthCityAuth?.authFetch) return;
  const previousLabel = button.textContent;
  button.disabled = true;
  button.textContent = "处理中";
  setPublicHealthMessage("");
  try {
    const response = await window.HealthCityAuth.authFetch(`/api/public-health/events/${encodeURIComponent(eventId)}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        note: `公共卫生工作台执行 ${previousLabel}`,
        dueAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "公共卫生事件处置失败");
    renderPublicHealthSystem(result.system || await loadPublicHealthSystem());
    setPublicHealthMessage(`${previousLabel}已记录：${result.event?.signal || eventId}`);
  } catch (error) {
    setPublicHealthMessage(error.message || "公共卫生事件处置失败");
  } finally {
    button.disabled = false;
    button.textContent = previousLabel;
  }
}

function setPublicHealthMessage(message) {
  const node = document.querySelector("#public-health-api-error");
  if (node) node.textContent = message || "";
}

function renderExchangeTasks(items) {
  const canAct = Boolean(PUBLIC_HEALTH_API_BASE && window.HealthCityAuth?.authFetch);
  document.querySelector("#public-health-exchange-tasks").innerHTML = `<table>
    <thead><tr><th>类别</th><th>任务</th><th>来源系统</th><th>平台集合</th><th>状态</th><th>下一步</th><th>操作</th></tr></thead>
    <tbody>${items.map((item) => `<tr>
      <td>${escapeHtml(item.category)}</td>
      <td>${escapeHtml(item.name)}</td>
      <td>${escapeHtml((item.sourceSystems || []).join("、"))}</td>
      <td>${escapeHtml((item.targetCollections || []).join(", "))}</td>
      <td>${escapeHtml(item.status || "")}</td>
      <td>${escapeHtml(item.nextAction || "")}</td>
      <td>${canAct ? `<button type="button" class="inline-action" data-public-health-exchange-run="${escapeHtml(item.id)}">记录回执</button>` : ""}</td>
    </tr>`).join("")}</tbody>
  </table>`;
}

function renderExchangeRuns(items, exceptionBoard = {}) {
  const canAct = Boolean(PUBLIC_HEALTH_API_BASE && window.HealthCityAuth?.authFetch);
  const exceptionByRunId = new Map((exceptionBoard.entries || []).map((item) => [item.id, item]));
  const summary = exceptionBoard.summary || {};
  const exceptionLabel = exceptionBoard.status === "exchange-exception-overdue"
    ? "存在逾期异常"
    : exceptionBoard.status === "exchange-exception-open"
      ? "异常待闭环"
      : exceptionBoard.status === "exchange-exceptions-resolved"
        ? "异常已补偿"
        : "无待处理异常";
  document.querySelector("#public-health-exchange-runs").innerHTML = `<div class="panel-title"><span data-public-health-exchange-exception-summary>异常 ${escapeHtml(summary.exceptions || 0)}；待处理 ${escapeHtml(summary.openExceptions || 0)}；待分派 ${escapeHtml(summary.unassignedExceptions || 0)}；临期 ${escapeHtml(summary.dueSoonExceptions || 0)}；逾期 ${escapeHtml(summary.overdueExceptions || 0)}；${escapeHtml(exceptionLabel)}</span></div><table>
    <thead><tr><th>类别</th><th>来源</th><th>状态</th><th>回执</th><th>补偿</th><th>记录</th><th>异常补偿</th><th>下一步</th></tr></thead>
    <tbody>${items.map((item) => {
      const exception = exceptionByRunId.get(item.id);
      const exceptionState = exception
        ? `${formatExchangeExceptionLabel(exception.exceptionStatus)}${exception.exceptionOwner ? ` / ${exception.exceptionOwner}` : ""}${exception.exceptionDueAt ? ` / ${exception.exceptionDueAt}` : ""}`
        : "无异常";
      const actionControls = canAct && exception?.exceptionOpen ? `<div class="action-row" data-public-health-exchange-exception-row="${escapeHtml(item.id || "")}">
        <input class="inline-action-input" type="text" maxlength="80" value="${escapeHtml(exception.exceptionOwner || "")}" data-public-health-exchange-exception-owner placeholder="异常责任人">
        <input class="inline-action-input" type="date" value="${escapeHtml(exception.exceptionDueAt || "")}" data-public-health-exchange-exception-due-at>
        <input class="inline-action-input" type="text" maxlength="240" data-public-health-exchange-exception-note placeholder="异常说明或处置结论">
        <button type="button" class="inline-action" data-public-health-exchange-exception="${escapeHtml(item.id || "")}" data-public-health-exchange-exception-action="assign-exchange-exception">分派异常</button>
        <button type="button" class="inline-action" data-public-health-exchange-exception="${escapeHtml(item.id || "")}" data-public-health-exchange-exception-action="escalate-exchange-exception">升级</button>
        <input class="inline-action-input" type="text" maxlength="120" value="${escapeHtml(item.compensationReceiptId || "")}" data-public-health-exchange-exception-receipt placeholder="补偿回执号">
        <button type="button" class="inline-action" data-public-health-exchange-exception="${escapeHtml(item.id || "")}" data-public-health-exchange-exception-action="resolve-exchange-exception">核验补偿</button>
      </div>` : "";
      return `<tr>
        <td>${escapeHtml(item.category || "")}</td>
        <td>${escapeHtml(item.sourceSystem || "")}</td>
        <td>${escapeHtml(item.status || "")}</td>
        <td>${escapeHtml(item.receiptStatus || "")}<small>${escapeHtml(item.receiptId || "")}</small></td>
        <td>${escapeHtml(item.compensationStatus || "")}</td>
        <td>${escapeHtml(item.payloadRecords || 0)} / ${escapeHtml(item.failedRecords || 0)}</td>
        <td><span class="badge ${exception?.exceptionOverdue ? "danger" : exception?.exceptionOpen ? "warn" : exception ? "ok" : "info"}">${escapeHtml(exceptionState)}</span>${exception?.exceptionSummary ? `<small>${escapeHtml(exception.exceptionSummary)}</small>` : ""}${actionControls}</td>
        <td>${escapeHtml(item.nextAction || "")}</td>
      </tr>`;
    }).join("")}</tbody>
  </table>`;
}

function formatExchangeExceptionLabel(value) {
  const labels = {
    open: "待分派",
    assigned: "已分派",
    escalated: "已升级",
    resolved: "已补偿",
    closed: "已关闭"
  };
  return labels[String(value || "").toLowerCase()] || String(value || "待处理");
}

function renderInstitutionTasks(items) {
  const canAct = Boolean(PUBLIC_HEALTH_API_BASE && window.HealthCityAuth?.authFetch);
  document.querySelector("#public-health-institution-tasks").innerHTML = items.map((item) => `<article class="evidence-card">
    <span>${escapeHtml(item.institutionType || "")}</span>
    <h3>${escapeHtml(item.roleView || item.taskType || "")}</h3>
    <p>${escapeHtml(item.owner || "")} / ${escapeHtml(item.status || "")}</p>
    <small>${escapeHtml(item.handoffStatus || "")} / ${escapeHtml(item.accountStatus || "")} / open ${escapeHtml(item.openItems || 0)}</small>
    <strong>${escapeHtml(item.nextAction || "")}</strong>
    ${canAct ? `<button type="button" class="inline-action" data-public-health-institution-task="${escapeHtml(item.id)}">完成协同</button>` : ""}
  </article>`).join("") || `<article class="evidence-card"><h3>机构协同任务待同步</h3><p>缺少 publicHealthInstitutionTasks 数据。</p></article>`;
}

function renderOnsiteAcceptances(items) {
  const canAct = Boolean(PUBLIC_HEALTH_API_BASE && window.HealthCityAuth?.authFetch);
  document.querySelector("#public-health-onsite-acceptances").innerHTML = items.map((item) => `<article class="priority-row">
    <div class="priority-rank ${String(item.severity || "").includes("P0") ? "danger" : "warn"}">${escapeHtml(item.severity || "P1")}</div>
    <div>
      <h3>${escapeHtml(item.name || "")}</h3>
      <p>${escapeHtml(item.category || "")} / ${escapeHtml(item.owner || "")} / ${escapeHtml(item.status || "")}</p>
      <small>${escapeHtml(item.blocker || "")}</small>
      <small>${escapeHtml(item.onsiteAction || "")}</small>
      ${item.lastAction ? `<small data-public-health-onsite-latest-action="${escapeHtml(item.lastAction.action || "latest")}">最近动作：${escapeHtml(item.lastAction.status || "")} / ${escapeHtml(item.lastAction.actor || "")}</small>` : ""}
      ${canAct ? `<div class="action-row"><button type="button" class="inline-action" data-public-health-onsite-acceptance="${escapeHtml(item.id)}">记录签署</button></div>` : ""}
    </div>
    <div class="capability-side">
      <span class="badge ${String(item.severity || "").includes("P0") ? "danger" : "warn"}">${escapeHtml(item.signoffStatus || "")}</span>
      <small>${escapeHtml((item.evidence || []).join(" / "))}</small>
    </div>
  </article>`).join("") || `<article class="priority-row"><div class="priority-rank info">0</div><div><h3>现场验收项待同步</h3><p>缺少 publicHealthOnsiteAcceptances 数据。</p></div></article>`;
}

function renderCutoverReadiness(readiness) {
  const target = document.querySelector("#public-health-cutover-readiness");
  if (!target) return;
  const summary = readiness?.summary || {};
  const actions = Array.isArray(readiness?.nextActions) ? readiness.nextActions : [];
  const cards = [
    ["准备级别", readiness?.readinessLevel || "blocked", readiness?.releaseGate || "site-evidence-required"],
    ["开放阻塞", summary.open ?? 0, `${summary.p0Open || 0} 个 P0 / ${summary.p1Open || 0} 个 P1`],
    ["证据记录", summary.evidenceRecorded ?? 0, `${summary.dueSoon || 0} 项 7 天内到期 / ${summary.overdue || 0} 项逾期`],
    ["升级提醒", `${summary.red || 0}/${summary.amber || 0}`, "red / amber"]
  ].map(([label, value, hint]) => `<div data-public-health-cutover-readiness-card="${escapeHtml(label)}">
      <strong>${escapeHtml(value)}</strong>
      <span>${escapeHtml(label)}</span>
      <small>${escapeHtml(hint)}</small>
    </div>`).join("");
  const actionRows = actions.slice(0, 6).map((item) => `<div data-public-health-cutover-readiness-action="${escapeHtml(item.id || "")}">
      <strong>${escapeHtml(item.name || "")}</strong>
      <span>${escapeHtml(item.severity || "")} / ${escapeHtml(item.escalationLevel || "")} / ${escapeHtml(item.assignee || item.owner || "")}</span>
      <small>${escapeHtml(item.remediationStatus || "")} · ${escapeHtml(item.siteWindow || "")} · ${escapeHtml(item.reminderChannel || "")}</small>
      <small>${escapeHtml(item.resolutionAction || "")}</small>
    </div>`).join("");
  target.innerHTML = `${cards}${actionRows}` || `<div><strong>上线准备度待同步</strong><span>缺少 cutoverReadiness 数据。</span></div>`;
}

function renderCutoverEvidencePackets(items) {
  const canAct = Boolean(PUBLIC_HEALTH_API_BASE && window.HealthCityAuth?.authFetch);
  const target = document.querySelector("#public-health-cutover-evidence-packets");
  if (!target) return;
  target.innerHTML = (Array.isArray(items) ? items : []).map((item) => {
    const requiredItems = Array.isArray(item.requiredItems) ? item.requiredItems : [];
    const verified = item.verifiedCount ?? requiredItems.filter(isEvidenceItemVerified).length;
    const total = item.requiredCount ?? requiredItems.length;
    const nextItem = requiredItems.find((entry) => !isEvidenceItemVerified(entry)) || requiredItems[0] || {};
    const complete = total > 0 && verified >= total;
    return `<article class="priority-row">
    <div class="priority-rank ${String(item.severity || "").includes("P0") ? "danger" : "warn"}">${escapeHtml(item.severity || "P1")}</div>
    <div>
      <h3>${escapeHtml(item.name || "")}</h3>
      <p>${escapeHtml(item.category || "")} / ${escapeHtml(item.assignee || item.owner || "")} / ${escapeHtml(item.status || "")}</p>
      <small>核验进度：${escapeHtml(verified)}/${escapeHtml(total)}；缺项：${escapeHtml(Math.max(total - verified, 0))}</small>
      <small>材料：${escapeHtml(requiredItems.map((entry) => `${entry.name}:${entry.status || "pending"}`).join(" / "))}</small>
      ${item.lastAction ? `<small data-public-health-cutover-evidence-latest-action="${escapeHtml(item.lastAction.itemId || "latest")}">最近材料：${escapeHtml(item.lastAction.itemName || "")} / ${escapeHtml(item.lastAction.status || "")}</small>` : ""}
      ${canAct ? `<div class="action-row"><button type="button" class="inline-action" data-public-health-cutover-evidence-packet="${escapeHtml(item.id)}" data-public-health-cutover-evidence-item="${escapeHtml(nextItem.id || "")}" ${complete ? "disabled" : ""}>登记材料</button></div>` : ""}
    </div>
    <div class="capability-side">
      <span class="badge ${complete ? "ok" : String(item.severity || "").includes("P0") ? "danger" : "warn"}">${escapeHtml(item.signoffStatus || "")}</span>
      <small>${escapeHtml(item.dueAt || "")}</small>
      <small>${escapeHtml(item.siteWindow || "")}</small>
      <small>${escapeHtml(item.reminderChannel || "")}</small>
    </div>
  </article>`;
  }).join("") || `<article class="priority-row"><div class="priority-rank info">0</div><div><h3>上线证据包待同步</h3><p>缺少 publicHealthCutoverEvidencePackets 数据。</p></div></article>`;
}

function renderCutoverDrills(boardOrItems) {
  const canAct = Boolean(PUBLIC_HEALTH_API_BASE && window.HealthCityAuth?.authFetch);
  const target = document.querySelector("#public-health-cutover-drills");
  if (!target) return;
  const board = Array.isArray(boardOrItems) ? buildStaticCutoverDrillBoard(boardOrItems) : (boardOrItems || {});
  const summary = board.summary || {};
  const drills = Array.isArray(board.drills) ? board.drills : [];
  const header = `<article class="priority-row">
    <div class="priority-rank ${board.status === "passed" ? "ok" : "danger"}">${escapeHtml(summary.blockedDrills || 0)}/${escapeHtml(summary.drills || 0)}</div>
    <div>
      <h3>公共卫生上线演练</h3>
      <p>${escapeHtml(board.status || "blocked")} / ${escapeHtml(summary.launchReleaseGate || "site-evidence-required")}</p>
      <small>开放发现 ${escapeHtml(summary.openFindings || 0)}；关联阻塞项 ${escapeHtml(summary.linkedBlockers || 0)}；go/no-go ${escapeHtml(summary.goNoGoNo || 0)} no-go / ${escapeHtml(summary.goNoGoConditional || 0)} conditional</small>
    </div>
    <div class="capability-side">
      <span class="badge ${board.status === "passed" ? "ok" : "danger"}">${escapeHtml(board.status || "blocked")}</span>
      <small>evidence missing ${escapeHtml(summary.evidencePacketsMissingItems || 0)}</small>
    </div>
  </article>`;
  const rows = drills.map((item) => {
    const resultClass = item.passed ? "ok" : item.blocked ? "danger" : "warn";
    const openFindings = item.openFindingCount ?? (Array.isArray(item.openFindings) ? item.openFindings.length : 0);
    const findingText = (Array.isArray(item.openFindings) ? item.openFindings : []).map((entry) => entry.finding || entry.note || entry.status || "").filter(Boolean).join(" / ");
    return `<article class="priority-row" data-public-health-cutover-drill-row="${escapeHtml(item.id || "")}">
    <div class="priority-rank ${resultClass}">${escapeHtml(item.phase || "T")}</div>
    <div>
      <h3>${escapeHtml(item.name || item.scenario || item.id || "")}</h3>
      <p>${escapeHtml(item.scenario || "")} / ${escapeHtml(item.owner || "")} / ${escapeHtml(item.status || "")}</p>
      <small>go/no-go：${escapeHtml(item.goNoGo || "")}；复测：${escapeHtml(item.retestStatus || "")}；开放发现：${escapeHtml(openFindings)}</small>
      <small>关联阻塞项：${escapeHtml((item.linkedBlockerIds || []).join(" / "))}</small>
      ${findingText ? `<small>${escapeHtml(findingText)}</small>` : ""}
      ${item.lastAction ? `<small data-public-health-cutover-drill-latest-action="${escapeHtml(item.lastAction.action || "latest")}">最近演练：${escapeHtml(item.lastAction.status || "")} / ${escapeHtml(item.lastAction.goNoGo || "")}</small>` : ""}
      ${canAct ? `<div class="action-row"><button type="button" class="inline-action" data-public-health-cutover-drill="${escapeHtml(item.id || "")}" ${item.passed ? "disabled" : ""}>记录复测</button></div>` : ""}
    </div>
    <div class="capability-side">
      <span class="badge ${resultClass}">${escapeHtml(item.goNoGo || item.status || "")}</span>
      <small>${escapeHtml((item.evidence || []).join(" / "))}</small>
      <small>${escapeHtml(item.nextAction || "")}</small>
    </div>
  </article>`;
  }).join("");
  target.innerHTML = header + (rows || `<article class="priority-row"><div class="priority-rank info">0</div><div><h3>上线演练待同步</h3><p>缺少 publicHealthCutoverDrills 数据。</p></div></article>`);
}

function renderProductionHandoffs(boardOrItems) {
  const canAct = Boolean(PUBLIC_HEALTH_API_BASE && window.HealthCityAuth?.authFetch);
  const target = document.querySelector("#public-health-production-handoffs");
  if (!target) return;
  const board = Array.isArray(boardOrItems) ? buildStaticProductionHandoffBoard(boardOrItems) : (boardOrItems || {});
  const summary = board.summary || {};
  const handoffs = Array.isArray(board.handoffs) ? board.handoffs : [];
  const header = `<article class="priority-row">
    <div class="priority-rank ${board.status === "accepted" ? "ok" : "danger"}">${escapeHtml(summary.acceptedHandoffs || 0)}/${escapeHtml(summary.handoffs || 0)}</div>
    <div>
      <h3>公共卫生生产移交包</h3>
      <p>${escapeHtml(board.status || "blocked")} / release artifacts ${escapeHtml(summary.releaseArtifacts || 0)}</p>
      <small>missing signoffs ${escapeHtml(summary.missingSignoffs || 0)} / open linked blockers ${escapeHtml(summary.openLinkedBlockers || 0)} / pending approvals ${escapeHtml(summary.pendingLinkedApprovals || 0)}</small>
    </div>
    <div class="capability-side">
      <span class="badge ${board.status === "accepted" ? "ok" : "danger"}">${escapeHtml(board.status || "blocked")}</span>
      <small>packets ${escapeHtml(summary.linkedEvidencePackets || 0)}</small>
    </div>
  </article>`;
  const rows = handoffs.map((item) => {
    const accepted = Boolean(item.accepted);
    return `<article class="priority-row" data-public-health-production-handoff-row="${escapeHtml(item.id || "")}">
    <div class="priority-rank ${accepted ? "ok" : "warn"}">${escapeHtml(item.packageType || "pack")}</div>
    <div>
      <h3>${escapeHtml(item.name || item.id || "")}</h3>
      <p>${escapeHtml(item.owner || "")} -> ${escapeHtml(item.receiver || "")} / ${escapeHtml(item.status || "")}</p>
      <small>required signoffs: ${escapeHtml((item.requiredSignoffs || []).join(" / "))}</small>
      <small>release artifacts: ${escapeHtml((item.releaseArtifacts || []).join(" / "))}</small>
      ${item.lastAction ? `<small data-public-health-production-handoff-latest-action="${escapeHtml(item.lastAction.action || "latest")}">latest: ${escapeHtml(item.lastAction.status || "")} / ${escapeHtml(item.lastAction.actor || "")}</small>` : ""}
      ${canAct ? `<div class="action-row"><button type="button" class="inline-action" data-public-health-production-handoff="${escapeHtml(item.id || "")}" ${accepted ? "disabled" : ""}>记录移交</button></div>` : ""}
    </div>
    <div class="capability-side">
      <span class="badge ${accepted ? "ok" : "warn"}">${escapeHtml(item.signoffStatus || item.handoffStatus || item.status || "")}</span>
      <small>${escapeHtml(item.dueAt || "")}</small>
      <small>missing ${escapeHtml(item.missingSignoffCount || 0)}</small>
      <small>${escapeHtml(item.nextAction || "")}</small>
    </div>
  </article>`;
  }).join("");
  target.innerHTML = header + (rows || `<article class="priority-row"><div class="priority-rank info">0</div><div><h3>生产移交包待同步</h3><p>缺少 publicHealthProductionHandoffs 数据。</p></div></article>`);
}

function renderGoLiveObservations(boardOrItems) {
  const canAct = Boolean(PUBLIC_HEALTH_API_BASE && window.HealthCityAuth?.authFetch);
  const target = document.querySelector("#public-health-go-live-observations");
  if (!target) return;
  const board = Array.isArray(boardOrItems) ? buildStaticGoLiveObservationBoard(boardOrItems) : (boardOrItems || {});
  const summary = board.summary || {};
  const observations = Array.isArray(board.observations) ? board.observations : [];
  const header = `<article class="priority-row">
    <div class="priority-rank ${board.status === "watch-ready" ? "ok" : board.status === "rollback-watch" ? "danger" : "warn"}">${escapeHtml(summary.planReady || 0)}/${escapeHtml(summary.observations || 0)}</div>
    <div>
      <h3>上线观察与回退台账</h3>
      <p>${escapeHtml(board.status || "blocked")} / rollback plans ${escapeHtml(summary.rollbackPlans || 0)}</p>
      <small>passed ${escapeHtml(summary.passedObservations || 0)} / pending ${escapeHtml(summary.pendingObservations || 0)} / critical signals ${escapeHtml(summary.openCriticalSignals || 0)}</small>
      <small>launch gate ${escapeHtml(summary.launchGateStatus || "unknown")} / ${escapeHtml(summary.launchReleaseGate || "unknown")}</small>
    </div>
    <div class="capability-side">
      <span class="badge ${board.status === "watch-ready" ? "ok" : "warn"}">${escapeHtml(board.status || "blocked")}</span>
      <small>artifacts ${escapeHtml(summary.requiredArtifacts || 0)}</small>
    </div>
  </article>`;
  const rows = observations.map((item) => {
    const passed = Boolean(item.passed);
    const critical = Boolean(item.criticalOpen);
    const rankClass = passed ? "ok" : critical ? "danger" : "warn";
    return `<article class="priority-row" data-public-health-go-live-observation-row="${escapeHtml(item.id || "")}">
    <div class="priority-rank ${rankClass}">${escapeHtml(item.window || item.phase || "watch")}</div>
    <div>
      <h3>${escapeHtml(item.name || item.id || "")}</h3>
      <p>${escapeHtml(item.phase || "")} / ${escapeHtml(item.owner || "")} / ${escapeHtml(item.status || "")}</p>
      <small>metric: ${escapeHtml(item.metric || "")} / threshold: ${escapeHtml(item.threshold || "")}</small>
      <small>rollback: ${escapeHtml(item.rollbackTrigger || "")} / owner: ${escapeHtml(item.rollbackOwner || "")}</small>
      <small>handoffs: ${escapeHtml((item.linkedHandoffIds || []).join(" / "))} / approvals: ${escapeHtml((item.linkedApprovalIds || []).join(" / "))}</small>
      ${item.lastAction ? `<small data-public-health-go-live-observation-latest-action="${escapeHtml(item.lastAction.action || "latest")}">latest: ${escapeHtml(item.lastAction.status || "")} / ${escapeHtml(item.lastAction.signalStatus || "")}</small>` : ""}
      ${canAct ? `<div class="action-row">
        <button type="button" class="inline-action" data-public-health-go-live-observation="${escapeHtml(item.id || "")}" data-status="monitoring">记录观察</button>
        <button type="button" class="inline-action" data-public-health-go-live-observation="${escapeHtml(item.id || "")}" data-status="passed" ${passed ? "disabled" : ""}>通过</button>
        <button type="button" class="inline-action" data-public-health-go-live-observation="${escapeHtml(item.id || "")}" data-status="rollback">回退关注</button>
      </div>` : ""}
    </div>
    <div class="capability-side">
      <span class="badge ${rankClass}">${escapeHtml(item.signalStatus || item.status || "")}</span>
      <small>${escapeHtml((item.requiredArtifacts || []).join(" / "))}</small>
      <small>${escapeHtml(item.nextAction || "")}</small>
    </div>
  </article>`;
  }).join("");
  target.innerHTML = header + (rows || `<article class="priority-row"><div class="priority-rank info">0</div><div><h3>上线观察窗口待同步</h3><p>缺少 publicHealthGoLiveObservations 数据。</p></div></article>`);
}

function renderLaunchIncidents(boardOrItems) {
  const canAct = Boolean(PUBLIC_HEALTH_API_BASE && window.HealthCityAuth?.authFetch);
  const target = document.querySelector("#public-health-launch-incidents");
  if (!target) return;
  const board = Array.isArray(boardOrItems) ? buildStaticLaunchIncidentBoard(boardOrItems) : (boardOrItems || {});
  const summary = board.summary || {};
  const incidents = Array.isArray(board.incidents) ? board.incidents : [];
  const header = `<article class="priority-row">
    <div class="priority-rank ${board.status === "desk-ready" ? "ok" : board.status === "incident-watch" ? "danger" : "warn"}">${escapeHtml(summary.deskReady || 0)}/${escapeHtml(summary.lanes || 0)}</div>
    <div>
      <h3>上线首日问题分诊与回退决策</h3>
      <p>${escapeHtml(board.status || "blocked")} / rollback owners ${escapeHtml(summary.rollbackDecisionOwners || 0)}</p>
      <small>open ${escapeHtml(summary.openTickets || 0)} / critical ${escapeHtml(summary.criticalOpenTickets || 0)} / resolved ${escapeHtml(summary.resolvedTickets || 0)}</small>
      <small>launch gate ${escapeHtml(summary.launchGateStatus || "unknown")} / ${escapeHtml(summary.launchReleaseGate || "unknown")}</small>
    </div>
    <div class="capability-side">
      <span class="badge ${board.status === "desk-ready" ? "ok" : "warn"}">${escapeHtml(board.status || "blocked")}</span>
      <small>artifacts ${escapeHtml(summary.requiredArtifacts || 0)}</small>
      <small>paths ${escapeHtml(summary.escalationPaths || 0)}</small>
    </div>
  </article>`;
  const rows = incidents.map((item) => {
    const resolved = Boolean(item.resolved);
    const critical = Boolean(item.criticalOpen);
    const open = Boolean(item.open);
    const rankClass = resolved ? "ok" : critical ? "danger" : open ? "warn" : "info";
    return `<article class="priority-row" data-public-health-launch-incident-row="${escapeHtml(item.id || "")}">
    <div class="priority-rank ${rankClass}">${escapeHtml(item.lane || "lane")}</div>
    <div>
      <h3>${escapeHtml(item.name || item.id || "")}</h3>
      <p>${escapeHtml(item.owner || "")} / ${escapeHtml(item.status || "")} / ${escapeHtml(item.severity || "")}</p>
      <small>SLA: ${escapeHtml(item.sla || "")} / rollback decision: ${escapeHtml(item.rollbackDecisionOwner || "")}</small>
      <small>escalation: ${escapeHtml((item.escalationPath || []).join(" / "))}</small>
      <small>observations: ${escapeHtml((item.linkedObservationIds || []).join(" / "))} / handoffs: ${escapeHtml((item.linkedHandoffIds || []).join(" / "))}</small>
      ${item.lastAction ? `<small data-public-health-launch-incident-latest-action="${escapeHtml(item.lastAction.action || "latest")}">latest: ${escapeHtml(item.lastAction.status || "")} / ${escapeHtml(item.lastAction.signalStatus || "")}</small>` : ""}
      ${canAct ? `<div class="action-row">
        <button type="button" class="inline-action" data-public-health-launch-incident="${escapeHtml(item.id || "")}" data-status="triaged">记录分诊</button>
        <button type="button" class="inline-action" data-public-health-launch-incident="${escapeHtml(item.id || "")}" data-status="resolved" ${resolved ? "disabled" : ""}>关闭</button>
        <button type="button" class="inline-action" data-public-health-launch-incident="${escapeHtml(item.id || "")}" data-status="rollback-recommended">回退建议</button>
      </div>` : ""}
    </div>
    <div class="capability-side">
      <span class="badge ${rankClass}">${escapeHtml(item.signalStatus || item.status || "")}</span>
      <small>${escapeHtml((item.requiredArtifacts || []).join(" / "))}</small>
      <small>${escapeHtml(item.nextAction || "")}</small>
    </div>
  </article>`;
  }).join("");
  target.innerHTML = header + (rows || `<article class="priority-row"><div class="priority-rank info">0</div><div><h3>问题分诊通道待同步</h3><p>缺少 publicHealthLaunchIncidents 数据。</p></div></article>`);
}

function renderLaunchDutyShifts(boardOrItems) {
  const canAct = Boolean(PUBLIC_HEALTH_API_BASE && window.HealthCityAuth?.authFetch);
  const target = document.querySelector("#public-health-launch-duty-shifts");
  if (!target) return;
  const board = Array.isArray(boardOrItems) ? buildStaticLaunchDutyBoard(boardOrItems) : (boardOrItems || {});
  const summary = board.summary || {};
  const shifts = Array.isArray(board.shifts) ? board.shifts : [];
  const header = `<article class="priority-row">
    <div class="priority-rank ${board.status === "roster-ready" ? "ok" : board.status === "handoff-watch" ? "danger" : "warn"}">${escapeHtml(summary.readyShifts || 0)}/${escapeHtml(summary.shifts || 0)}</div>
    <div>
      <h3>Launch duty roster and command handoff</h3>
      <p>${escapeHtml(board.status || "blocked")} / backup contacts ${escapeHtml(summary.backupContacts || 0)} / escalation owners ${escapeHtml(summary.escalationOwners || 0)}</p>
      <small>pending ${escapeHtml(summary.pendingShifts || 0)} / escalated ${escapeHtml(summary.escalatedShifts || 0)} / missed ${escapeHtml(summary.missedHandoffs || 0)}</small>
      <small>launch gate ${escapeHtml(summary.launchGateStatus || "unknown")} / ${escapeHtml(summary.launchReleaseGate || "unknown")}</small>
    </div>
    <div class="capability-side">
      <span class="badge ${board.status === "roster-ready" ? "ok" : "warn"}">${escapeHtml(board.status || "blocked")}</span>
      <small>checklist ${escapeHtml(summary.checklistItems || 0)}</small>
      <small>artifacts ${escapeHtml(summary.requiredArtifacts || 0)}</small>
    </div>
  </article>`;
  const rows = shifts.map((item) => {
    const missed = Boolean(item.missed);
    const escalated = Boolean(item.escalated);
    const ready = Boolean(item.shiftReady);
    const rankClass = missed ? "danger" : escalated ? "warn" : ready ? "ok" : "info";
    return `<article class="priority-row" data-public-health-launch-duty-shift-row="${escapeHtml(item.id || "")}">
    <div class="priority-rank ${rankClass}">${escapeHtml(item.lane || "duty")}</div>
    <div>
      <h3>${escapeHtml(item.name || item.id || "")}</h3>
      <p>${escapeHtml(item.shiftWindow || "")} / ${escapeHtml(item.owner || "")} / backup ${escapeHtml(item.backupOwner || "")}</p>
      <small>channel: ${escapeHtml(item.contactChannel || "")} / escalation: ${escapeHtml(item.escalationOwner || "")}</small>
      <small>checklist: ${escapeHtml((item.handoffChecklist || []).join(" / "))}</small>
      <small>observations: ${escapeHtml((item.linkedObservationIds || []).join(" / "))} / incidents: ${escapeHtml((item.linkedIncidentIds || []).join(" / "))}</small>
      ${item.lastAction ? `<small data-public-health-launch-duty-shift-latest-action="${escapeHtml(item.lastAction.action || "latest")}">latest: ${escapeHtml(item.lastAction.status || "")} / ${escapeHtml(item.lastAction.signalStatus || "")}</small>` : ""}
      ${canAct ? `<div class="action-row">
        <button type="button" class="inline-action" data-public-health-launch-duty-shift="${escapeHtml(item.id || "")}" data-status="confirmed">确认值守</button>
        <button type="button" class="inline-action" data-public-health-launch-duty-shift="${escapeHtml(item.id || "")}" data-status="relieved">完成交接</button>
        <button type="button" class="inline-action" data-public-health-launch-duty-shift="${escapeHtml(item.id || "")}" data-status="escalated">升级关注</button>
      </div>` : ""}
    </div>
    <div class="capability-side">
      <span class="badge ${rankClass}">${escapeHtml(item.signalStatus || item.handoffStatus || item.status || "")}</span>
      <small>${escapeHtml((item.requiredArtifacts || []).join(" / "))}</small>
      <small>${escapeHtml(item.nextAction || "")}</small>
    </div>
  </article>`;
  }).join("");
  target.innerHTML = header + (rows || `<article class="priority-row"><div class="priority-rank info">0</div><div><h3>Launch duty shifts pending sync</h3><p>Missing publicHealthLaunchDutyShifts data.</p></div></article>`);
}

function renderLaunchCommandBriefs(boardOrItems) {
  const canAct = Boolean(PUBLIC_HEALTH_API_BASE && window.HealthCityAuth?.authFetch);
  const target = document.querySelector("#public-health-launch-command-briefs");
  if (!target) return;
  const board = Array.isArray(boardOrItems) ? buildStaticLaunchCommandBriefBoard(boardOrItems) : (boardOrItems || {});
  const summary = board.summary || {};
  const briefs = Array.isArray(board.briefs) ? board.briefs : [];
  const header = `<article class="priority-row">
    <div class="priority-rank ${board.status === "briefing-ready" ? "ok" : board.status === "briefing-watch" ? "danger" : "warn"}">${escapeHtml(summary.readyBriefs || 0)}/${escapeHtml(summary.briefs || 0)}</div>
    <div>
      <h3>Launch command briefs and status broadcast</h3>
      <p>${escapeHtml(board.status || "blocked")} / source boards ${escapeHtml(summary.sourceBoards || 0)} / audiences ${escapeHtml(summary.audiences || 0)}</p>
      <small>pending ${escapeHtml(summary.pendingBriefs || 0)} / published ${escapeHtml(summary.publishedBriefs || 0)} / blocked ${escapeHtml(summary.blockedBriefs || 0)}</small>
      <small>delivery receipts ${escapeHtml(summary.acknowledgedRecipients || 0)}/${escapeHtml(summary.expectedAcknowledgements || 0)} / pending ${escapeHtml(summary.pendingAcknowledgements || 0)} / escalated ${escapeHtml(summary.escalatedAcknowledgements || 0)}</small>
      <small>launch gate ${escapeHtml(summary.launchGateStatus || "unknown")} / ${escapeHtml(summary.launchReleaseGate || "unknown")}</small>
    </div>
    <div class="capability-side">
      <span class="badge ${board.status === "briefing-ready" ? "ok" : "warn"}">${escapeHtml(board.status || "blocked")}</span>
      <small>sections ${escapeHtml(summary.requiredSections || 0)}</small>
      <small>incidents ${escapeHtml(summary.linkedIncidents || 0)}</small>
    </div>
  </article>`;
  const rows = briefs.map((item) => {
    const blocked = Boolean(item.blocked);
    const ready = Boolean(item.briefReady);
    const published = Boolean(item.published);
    const rankClass = blocked ? "danger" : ready ? "ok" : "info";
    const pendingReceiptTargets = Array.isArray(item.pendingAcknowledgementTargets) ? item.pendingAcknowledgementTargets : [];
    const acknowledgementControls = canAct && published && pendingReceiptTargets.length ? `<div class="action-row" data-public-health-launch-command-brief-receipt-row="${escapeHtml(item.id || "")}">
      <select class="inline-action-select" data-public-health-launch-command-brief-receipt-target><option value="">选择待确认受众</option>${pendingReceiptTargets.map((target) => `<option value="${escapeHtml(target)}">${escapeHtml(target)}</option>`).join("")}</select>
      <input class="inline-action-input" type="text" maxlength="240" data-public-health-launch-command-brief-receipt-note placeholder="回执人或升级说明">
      <button type="button" class="inline-action" data-public-health-launch-command-brief="${escapeHtml(item.id || "")}" data-public-health-launch-command-brief-action="acknowledge-launch-command-brief">确认送达</button>
      <button type="button" class="inline-action" data-public-health-launch-command-brief="${escapeHtml(item.id || "")}" data-public-health-launch-command-brief-action="escalate-launch-command-brief-receipt">升级回执</button>
    </div>` : canAct && published ? "<small>全部既定受众已登记回执</small>" : "";
    return `<article class="priority-row" data-public-health-launch-command-brief-row="${escapeHtml(item.id || "")}">
    <div class="priority-rank ${rankClass}">${escapeHtml(item.briefWindow || item.phase || "brief")}</div>
    <div>
      <h3>${escapeHtml(item.name || item.id || "")}</h3>
      <p>${escapeHtml(item.phase || "")} / ${escapeHtml(item.owner || "")} / recorder ${escapeHtml(item.recorder || "")}</p>
      <small>audience: ${escapeHtml((item.audience || []).join(" / "))}</small>
      <small>sources: ${escapeHtml((item.sourceBoards || []).join(" / "))}</small>
      <small>sections: ${escapeHtml((item.requiredSections || []).join(" / "))}</small>
      <small>publish: ${escapeHtml(item.publishChannel || "")} -> ${escapeHtml(item.publishTarget || "")}</small>
      ${published ? `<small>delivery receipts: ${escapeHtml(item.acknowledgedRecipientCount || 0)}/${escapeHtml(item.expectedAcknowledgementCount || 0)}; pending ${escapeHtml(pendingReceiptTargets.join(" / ") || "none")}</small>` : ""}
      ${item.lastAction ? `<small data-public-health-launch-command-brief-latest-action="${escapeHtml(item.lastAction.action || "latest")}">latest: ${escapeHtml(item.lastAction.status || "")} / ${escapeHtml(item.lastAction.decision || "")}</small>` : ""}
      ${canAct ? `<div class="action-row">
        <button type="button" class="inline-action" data-public-health-launch-command-brief="${escapeHtml(item.id || "")}" data-status="published">发布简报</button>
        <button type="button" class="inline-action" data-public-health-launch-command-brief="${escapeHtml(item.id || "")}" data-status="held">暂缓播报</button>
        <button type="button" class="inline-action" data-public-health-launch-command-brief="${escapeHtml(item.id || "")}" data-status="escalated">升级指挥</button>
      </div>` : ""}
      ${acknowledgementControls}
    </div>
    <div class="capability-side">
      <span class="badge ${published ? "ok" : rankClass}">${escapeHtml(item.publishStatus || item.status || "")}</span>
      <small>decision: ${escapeHtml(item.decisionOwner || "")}</small>
      <small>${escapeHtml(item.nextAction || "")}</small>
    </div>
  </article>`;
  }).join("");
  target.innerHTML = header + (rows || `<article class="priority-row"><div class="priority-rank info">0</div><div><h3>Launch command briefs pending sync</h3><p>Missing publicHealthLaunchCommandBriefs data.</p></div></article>`);
}

function renderSiteEvidenceBridge(bridge) {
  const canAct = Boolean(PUBLIC_HEALTH_API_BASE && window.HealthCityAuth?.authFetch);
  const target = document.querySelector("#public-health-site-evidence-bridge");
  if (!target) return;
  const summary = bridge?.summary || {};
  const links = Array.isArray(bridge?.links) ? bridge.links : [];
  const header = `<article class="priority-row">
    <div class="priority-rank ${bridge?.status === "verified" ? "ok" : "warn"}">${escapeHtml(summary.verifiedLinks || 0)}/${escapeHtml(summary.links || 0)}</div>
    <div>
      <h3>现场上线材料桥接</h3>
      <p>把通用 site launch 材料映射到公共卫生上线证据包、阻塞项和现场验收行。</p>
      <small>已映射证据项：${escapeHtml(summary.verifiedItems || 0)}/${escapeHtml(summary.linkedItems || 0)}；缺口：${escapeHtml(summary.missingLinks || 0)}</small>
    </div>
    <div class="capability-side"><span class="badge ${bridge?.status === "verified" ? "ok" : "warn"}">${escapeHtml(bridge?.status || "missing-site-evidence")}</span></div>
  </article>`;
  const rows = links.map((item) => `<article class="priority-row" data-public-health-site-evidence-row="${escapeHtml(item.id || "")}">
    <div class="priority-rank ${item.verified ? "ok" : "warn"}">${item.verified ? "OK" : "M"}</div>
    <div>
      <h3>${escapeHtml(item.requirement || item.templateId || item.id || "")}</h3>
      <p>模板：${escapeHtml(item.templateId || "")} / 证据包：${escapeHtml(item.packetId || "")}</p>
      <small>条目：${escapeHtml((item.itemIds || []).join("、"))}</small>
      <small>${item.verified ? `材料：${escapeHtml(item.artifactName || "")} / ${escapeHtml(item.verifiedBy || "")}` : "待现场材料核验"}</small>
      ${canAct && !item.verified ? `<div class="action-row"><button type="button" class="inline-action" data-public-health-site-evidence-link="${escapeHtml(item.id || "")}" data-public-health-site-evidence-template="${escapeHtml(item.templateId || "")}">登记桥接材料</button></div>` : ""}
    </div>
    <div class="capability-side"><span class="badge ${item.verified ? "ok" : "warn"}">${escapeHtml(item.status || "")}</span></div>
  </article>`).join("");
  target.innerHTML = header + (rows || `<article class="priority-row"><div class="priority-rank info">0</div><div><h3>现场材料桥接待同步</h3><p>缺少 publicHealthSiteEvidenceBridge 数据。</p></div></article>`);
}

function renderSiteEvidenceVerificationTasks(board) {
  const canAct = Boolean(PUBLIC_HEALTH_API_BASE && window.HealthCityAuth?.authFetch);
  const target = document.querySelector("#public-health-site-evidence-verification");
  if (!target) return;
  const summary = board?.summary || {};
  const tasks = Array.isArray(board?.tasks) ? board.tasks : [];
  const header = `<article class="priority-row">
    <div class="priority-rank ${board?.status === "verified" ? "ok" : board?.status === "blocked" ? "danger" : "warn"}">${escapeHtml(summary.verifiedTasks || 0)}/${escapeHtml(summary.tasks || 0)}</div>
    <div>
      <h3>上线现场证据核验任务台</h3>
      <p>每项核验必须关联已核验的现场材料 ID，任务动作本身不会自动关闭上线阻塞项。</p>
      <small>材料可核验：${escapeHtml(summary.evidenceAvailableTasks || 0)}；待核验：${escapeHtml(summary.pendingTasks || 0)}；阻断：${escapeHtml(summary.blockedTasks || 0)}</small>
    </div>
    <div class="capability-side"><span class="badge ${board?.status === "verified" ? "ok" : board?.status === "blocked" ? "danger" : "warn"}">${escapeHtml(board?.status || "evidence-pending")}</span></div>
  </article>`;
  const rows = tasks.map((item) => {
    const rankClass = item.verified ? "ok" : item.blocked || item.priority === "P0" ? "danger" : "warn";
    const action = item.evidenceAvailable ? "verify-site-evidence" : "start-site-evidence-verification";
    const label = item.evidenceAvailable ? "核验材料" : "标记待核验";
    return `<article class="priority-row" data-public-health-site-evidence-verification-row="${escapeHtml(item.id || "")}">
      <div class="priority-rank ${rankClass}">${escapeHtml(item.priority || "P1")}</div>
      <div>
        <h3>${escapeHtml(item.name || item.id || "")}</h3>
        <p>${escapeHtml(item.owner || "")} / ${escapeHtml(item.reviewerRole || "")} / ${escapeHtml(item.status || "")}</p>
        <small>窗口：${escapeHtml(item.verificationWindow || "")}；桥接项：${escapeHtml(item.linkId || "")}</small>
        <small>${item.evidenceAvailable ? `待核验材料：${escapeHtml(item.bridgeEvidenceId || "")}` : "尚未发现匹配的已核验现场材料"}</small>
        <small>升级：${escapeHtml((item.escalationPath || []).join(" / "))}</small>
        ${item.lastAction ? `<small data-public-health-site-evidence-verification-latest-action="${escapeHtml(item.lastAction.action || "latest")}">最近动作：${escapeHtml(item.lastAction.status || "")} / ${escapeHtml(item.lastAction.actor || "")}</small>` : ""}
        ${canAct ? `<div class="action-row"><button type="button" class="inline-action" data-public-health-site-evidence-verification-task="${escapeHtml(item.id || "")}" data-public-health-site-evidence-verification-status="${escapeHtml(action)}" data-public-health-site-evidence-id="${escapeHtml(item.bridgeEvidenceId || "")}" ${item.verified ? "disabled" : ""}>${label}</button></div>` : ""}
      </div>
      <div class="capability-side">
        <span class="badge ${item.verified ? "ok" : item.blocked ? "danger" : "warn"}">${escapeHtml(item.verified ? "verified" : item.evidenceAvailable ? "evidence-ready" : "evidence-pending")}</span>
        <small>${escapeHtml(item.nextAction || "")}</small>
      </div>
    </article>`;
  }).join("");
  target.innerHTML = header + (rows || `<article class="priority-row"><div class="priority-rank info">0</div><div><h3>现场证据核验任务待同步</h3><p>缺少 publicHealthSiteEvidenceVerificationTasks 数据。</p></div></article>`);
}

function renderLaunchGate(gate) {
  const canAct = Boolean(PUBLIC_HEALTH_API_BASE && window.HealthCityAuth?.authFetch);
  const target = document.querySelector("#public-health-launch-gate");
  if (!target) return;
  const summary = gate?.summary || {};
  const requirements = Array.isArray(gate?.requirements) ? gate.requirements : [];
  const approvals = Array.isArray(gate?.approvals) ? gate.approvals : [];
  const approvalPreflight = gate?.approvalPreflight || {};
  const nextApproval = approvals.find((item) => !isLaunchApprovalSigned(item)) || approvals[0] || {};
  const approvalStatus = approvalPreflight.eligible ? "approved" : "submitted";
  const approvalLabel = approvalPreflight.eligible ? "批准审批" : "提交审批";
  const requirementRows = requirements.slice(0, 8).map((item) => `<div data-public-health-launch-requirement="${escapeHtml(item.id || "")}">
      <strong>${escapeHtml(item.name || "")}</strong>
      <span>${escapeHtml(item.status || "")}</span>
      <small>${escapeHtml(item.nextAction || "")}</small>
    </div>`).join("");
  const approvalRows = approvals.map((item) => `<small>${escapeHtml(item.role || "")}:${escapeHtml(item.status || "")}</small>`).join("");
  target.innerHTML = `<article class="priority-row">
    <div class="priority-rank ${gate?.productionReady ? "ok" : "danger"}">${escapeHtml(gate?.productionReady ? "OK" : "Gate")}</div>
    <div>
      <h3>公共卫生生产上线 gate</h3>
      <p>${escapeHtml(gate?.status || "blocked")} / ${escapeHtml(gate?.releaseGate || "site-evidence-required")}</p>
      <small>上线要求：${escapeHtml(summary.passedRequirements || 0)}/${escapeHtml(summary.requirements || 0)}；阻断：${escapeHtml(summary.blockedRequirements || 0)}；审批：${escapeHtml(summary.signedApprovals || 0)}/${escapeHtml(summary.approvals || 0)}</small>
      <small data-public-health-launch-approval-preflight>审批前置：${escapeHtml(approvalPreflight.passedPrerequisites || 0)}/${escapeHtml(approvalPreflight.prerequisiteRequirements || 0)}；阻断：${escapeHtml(approvalPreflight.blockedPrerequisites || 0)}；${escapeHtml(approvalPreflight.status || "blocked")}</small>
      <div class="evidence-grid">${requirementRows}</div>
      <div class="action-row">${approvalRows}</div>
      ${canAct ? `<div class="action-row"><button type="button" class="inline-action" data-public-health-launch-approval="${escapeHtml(nextApproval.id || "")}" data-public-health-launch-approval-status="${approvalStatus}" ${gate?.productionReady ? "disabled" : ""}>${approvalLabel}</button></div>` : ""}
    </div>
    <div class="capability-side">
      <span class="badge ${gate?.productionReady ? "ok" : "danger"}">${escapeHtml(gate?.releaseGate || "")}</span>
      <small>缺材料 ${escapeHtml(summary.cutoverMissingItems || 0)}</small>
      <small>开放阻塞 ${escapeHtml(summary.openBlockers || 0)}</small>
      <small>P0 ${escapeHtml(summary.p0Open || 0)}</small>
    </div>
  </article>`;
}

function renderCutoverBlockers(items) {
  const canAct = Boolean(PUBLIC_HEALTH_API_BASE && window.HealthCityAuth?.authFetch);
  document.querySelector("#public-health-cutover-blockers").innerHTML = items.map((item) => {
    const closed = isCutoverClosed(item);
    return `<article class="priority-row">
    <div class="priority-rank ${String(item.severity || "").includes("P0") ? "danger" : "warn"}">${escapeHtml(item.severity || "P1")}</div>
    <div>
      <h3>${escapeHtml(item.name || "")}</h3>
      <p>${escapeHtml(item.category || "")} / ${escapeHtml(item.owner || "")} / ${escapeHtml(item.assignee || "")} / ${escapeHtml(item.status || "")}</p>
      <small>${escapeHtml(item.blocker || "")}</small>
      <small>证据：${escapeHtml((item.requiredEvidence || []).join(" / "))}</small>
      <small>整改：${escapeHtml(item.remediationStatus || "")} / 提醒：${escapeHtml(item.reminderChannel || "")}</small>
      ${item.lastAction ? `<small data-public-health-cutover-latest-action="${escapeHtml(item.lastAction.action || "latest")}">最近动作：${escapeHtml(item.lastAction.status || "")} / ${escapeHtml(item.lastAction.actor || "")}</small>` : ""}
      ${canAct ? `<div class="action-row"><button type="button" class="inline-action" data-public-health-cutover-blocker="${escapeHtml(item.id)}" ${closed ? "disabled" : ""}>记录整改</button></div>` : ""}
    </div>
    <div class="capability-side">
      <span class="badge ${closed ? "ok" : String(item.severity || "").includes("P0") ? "danger" : "warn"}">${escapeHtml(item.dependency || "")}</span>
      <small>${escapeHtml(item.dueAt || "")}</small>
      <small>${escapeHtml(item.siteWindow || "")}</small>
      <small>${escapeHtml(item.resolutionAction || "")}</small>
    </div>
  </article>`;
  }).join("") || `<article class="priority-row"><div class="priority-rank info">0</div><div><h3>上线阻塞项待同步</h3><p>缺少 publicHealthCutoverBlockers 数据。</p></div></article>`;
}

async function handlePublicHealthExchangeRun(event) {
  const button = event.target.closest("[data-public-health-exchange-run]");
  if (!button || !PUBLIC_HEALTH_API_BASE || !window.HealthCityAuth?.authFetch) return;
  const taskId = button.dataset.publicHealthExchangeRun;
  const previousLabel = button.textContent;
  button.disabled = true;
  button.textContent = "记录中";
  setPublicHealthMessage("");
  try {
    const response = await window.HealthCityAuth.authFetch(`/api/public-health/exchange-tasks/${encodeURIComponent(taskId)}/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "receipt-confirmed",
        receiptStatus: "accepted",
        compensationStatus: "not-required",
        payloadRecords: 1,
        failedRecords: 0,
        nextAction: "归档现场回执和交换日志。"
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "公共卫生交换回执记录失败");
    renderPublicHealthSystem(result.system || await loadPublicHealthSystem());
    setPublicHealthMessage(`交换回执已记录：${result.run?.receiptId || taskId}`);
  } catch (error) {
    setPublicHealthMessage(error.message || "公共卫生交换回执记录失败");
  } finally {
    button.disabled = false;
    button.textContent = previousLabel;
  }
}

async function handlePublicHealthExchangeException(event) {
  const button = event.target.closest("[data-public-health-exchange-exception]");
  if (!button || !PUBLIC_HEALTH_API_BASE || !window.HealthCityAuth?.authFetch) return;
  const runId = button.dataset.publicHealthExchangeException;
  const action = button.dataset.publicHealthExchangeExceptionAction;
  const row = button.closest("[data-public-health-exchange-exception-row]");
  if (!runId || !action || !row) return;
  const exceptionOwner = row.querySelector("[data-public-health-exchange-exception-owner]")?.value.trim() || "";
  const exceptionDueAt = row.querySelector("[data-public-health-exchange-exception-due-at]")?.value || "";
  const note = row.querySelector("[data-public-health-exchange-exception-note]")?.value.trim() || "";
  const compensationReceiptId = row.querySelector("[data-public-health-exchange-exception-receipt]")?.value.trim() || "";
  const previousLabel = button.textContent;
  button.disabled = true;
  button.textContent = "记录中";
  setPublicHealthMessage("");
  try {
    const response = await window.HealthCityAuth.authFetch(`/api/public-health/exchange-runs/${encodeURIComponent(runId)}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        exceptionOwner,
        exceptionDueAt,
        exceptionSummary: note,
        compensationReceiptId,
        note
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "公共卫生交换异常记录失败");
    renderPublicHealthSystem(result.system || await loadPublicHealthSystem());
    setPublicHealthMessage(`交换异常已更新：${formatExchangeExceptionLabel(result.run?.exceptionStatus || "")}`);
  } catch (error) {
    setPublicHealthMessage(error.message || "公共卫生交换异常记录失败");
  } finally {
    button.disabled = false;
    button.textContent = previousLabel;
  }
}

async function handlePublicHealthInstitutionTaskAction(event) {
  const button = event.target.closest("[data-public-health-institution-task]");
  if (!button || !PUBLIC_HEALTH_API_BASE || !window.HealthCityAuth?.authFetch) return;
  const taskId = button.dataset.publicHealthInstitutionTask;
  const previousLabel = button.textContent;
  button.disabled = true;
  button.textContent = "同步中";
  setPublicHealthMessage("");
  try {
    const response = await window.HealthCityAuth.authFetch(`/api/public-health/institution-tasks/${encodeURIComponent(taskId)}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "site-handoff",
        status: "site-handoff-ready",
        handoffStatus: "handoff-confirmed",
        accountStatus: "account-confirmed",
        openItems: 0,
        note: "公共卫生工作台完成机构协同确认。"
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "机构协同任务更新失败");
    renderPublicHealthSystem(result.system || await loadPublicHealthSystem());
    setPublicHealthMessage(`机构协同已更新：${result.task?.roleView || taskId}`);
  } catch (error) {
    setPublicHealthMessage(error.message || "机构协同任务更新失败");
  } finally {
    button.disabled = false;
    button.textContent = previousLabel;
  }
}

async function handlePublicHealthOnsiteAcceptanceAction(event) {
  const button = event.target.closest("[data-public-health-onsite-acceptance]");
  if (!button || !PUBLIC_HEALTH_API_BASE || !window.HealthCityAuth?.authFetch) return;
  const acceptanceId = button.dataset.publicHealthOnsiteAcceptance;
  const previousLabel = button.textContent;
  button.disabled = true;
  button.textContent = "归档中";
  setPublicHealthMessage("");
  try {
    const response = await window.HealthCityAuth.authFetch(`/api/public-health/onsite-acceptances/${encodeURIComponent(acceptanceId)}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "record-signoff",
        status: "signed",
        signoffStatus: "signed",
        note: "公共卫生发布前现场验收动作已归档。"
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "现场验收记录失败");
    renderPublicHealthSystem(result.system || await loadPublicHealthSystem());
    setPublicHealthMessage(`现场验收已记录：${result.acceptance?.name || acceptanceId}`);
  } catch (error) {
    setPublicHealthMessage(error.message || "现场验收记录失败");
  } finally {
    button.disabled = false;
    button.textContent = previousLabel;
  }
}

async function handlePublicHealthCutoverBlockerAction(event) {
  const button = event.target.closest("[data-public-health-cutover-blocker]");
  if (!button || !PUBLIC_HEALTH_API_BASE || !window.HealthCityAuth?.authFetch) return;
  const blockerId = button.dataset.publicHealthCutoverBlocker;
  const previousLabel = button.textContent;
  button.disabled = true;
  button.textContent = "记录中";
  setPublicHealthMessage("");
  try {
    const response = await window.HealthCityAuth.authFetch(`/api/public-health/cutover-blockers/${encodeURIComponent(blockerId)}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "record-evidence",
        status: "evidence-recorded",
        evidenceStatus: "recorded",
        evidence: ["现场整改记录", "责任人确认"],
        note: "公共卫生上线阻塞项整改证据已记录。"
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "上线阻塞项更新失败");
    renderPublicHealthSystem(result.system || await loadPublicHealthSystem());
    setPublicHealthMessage(`上线阻塞项已更新：${result.blocker?.name || blockerId}`);
  } catch (error) {
    setPublicHealthMessage(error.message || "上线阻塞项更新失败");
  } finally {
    button.disabled = false;
    button.textContent = previousLabel;
  }
}

async function handlePublicHealthCutoverEvidencePacketAction(event) {
  const button = event.target.closest("[data-public-health-cutover-evidence-packet]");
  if (!button || !PUBLIC_HEALTH_API_BASE || !window.HealthCityAuth?.authFetch) return;
  const packetId = button.dataset.publicHealthCutoverEvidencePacket;
  const itemId = button.dataset.publicHealthCutoverEvidenceItem;
  const previousLabel = button.textContent;
  button.disabled = true;
  button.textContent = "登记中";
  setPublicHealthMessage("");
  try {
    const response = await window.HealthCityAuth.authFetch(`/api/public-health/cutover-evidence-packets/${encodeURIComponent(packetId)}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "record-evidence-packet",
        itemId,
        status: "verified",
        artifactName: "现场证据签收记录",
        attachmentNames: ["现场签收页"],
        note: "公共卫生上线证据包材料已登记并核验。"
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "上线证据包登记失败");
    renderPublicHealthSystem(result.system || await loadPublicHealthSystem());
    setPublicHealthMessage(`上线证据包已登记：${result.action?.itemName || packetId}`);
  } catch (error) {
    setPublicHealthMessage(error.message || "上线证据包登记失败");
  } finally {
    button.disabled = false;
    button.textContent = previousLabel;
  }
}

async function handlePublicHealthCutoverDrillAction(event) {
  const button = event.target.closest("[data-public-health-cutover-drill]");
  if (!button || !PUBLIC_HEALTH_API_BASE || !window.HealthCityAuth?.authFetch) return;
  const drillId = button.dataset.publicHealthCutoverDrill;
  const previousLabel = button.textContent;
  button.disabled = true;
  button.textContent = "记录中";
  setPublicHealthMessage("");
  try {
    const response = await window.HealthCityAuth.authFetch(`/api/public-health/cutover-drills/${encodeURIComponent(drillId)}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "record-drill-finding",
        status: "retest-required",
        severity: "P1",
        goNoGo: "no-go",
        retestStatus: "pending",
        finding: "公共卫生上线演练复测发现已记录，仍需现场签字材料闭环。",
        attachmentNames: ["公共卫生上线演练复测记录"],
        nextAction: "完成现场复测、回退演练和多方 go/no-go 签字后再提交 launch gate。"
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "上线演练记录失败");
    renderPublicHealthSystem(result.system || await loadPublicHealthSystem());
    setPublicHealthMessage(`上线演练已记录：${result.drill?.name || drillId}`);
  } catch (error) {
    setPublicHealthMessage(error.message || "上线演练记录失败");
  } finally {
    button.disabled = false;
    button.textContent = previousLabel;
  }
}

async function handlePublicHealthProductionHandoffAction(event) {
  const button = event.target.closest("[data-public-health-production-handoff]");
  if (!button || !PUBLIC_HEALTH_API_BASE || !window.HealthCityAuth?.authFetch) return;
  const handoffId = button.dataset.publicHealthProductionHandoff;
  const previousLabel = button.textContent;
  button.disabled = true;
  button.textContent = "移交中";
  setPublicHealthMessage("");
  try {
    const response = await window.HealthCityAuth.authFetch(`/api/public-health/production-handoffs/${encodeURIComponent(handoffId)}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "record-production-handoff",
        status: "accepted",
        artifactName: "Public health production handoff receipt",
        attachmentNames: ["production-handoff-signoff.pdf"],
        note: "Public health production handoff pack accepted from the workbench."
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "生产移交包记录失败");
    renderPublicHealthSystem(result.system || await loadPublicHealthSystem());
    setPublicHealthMessage(`生产移交包已记录：${result.handoff?.name || handoffId}`);
  } catch (error) {
    setPublicHealthMessage(error.message || "生产移交包记录失败");
  } finally {
    button.disabled = false;
    button.textContent = previousLabel;
  }
}

async function handlePublicHealthGoLiveObservationAction(event) {
  const button = event.target.closest("[data-public-health-go-live-observation]");
  if (!button || !PUBLIC_HEALTH_API_BASE || !window.HealthCityAuth?.authFetch) return;
  const observationId = button.dataset.publicHealthGoLiveObservation;
  const status = button.dataset.status || "monitoring";
  const previousLabel = button.textContent;
  button.disabled = true;
  button.textContent = "记录中";
  setPublicHealthMessage("");
  try {
    const response = await window.HealthCityAuth.authFetch(`/api/public-health/go-live-observations/${encodeURIComponent(observationId)}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "record-go-live-observation",
        status,
        signalStatus: status === "passed" ? "green" : status === "rollback" ? "rollback-watch" : "monitoring",
        decision: status === "passed" ? "continue" : status === "rollback" ? "prepare rollback review" : "observe",
        artifactName: `${observationId}-go-live-observation`,
        attachmentNames: [`${observationId}-watch.png`],
        note: "Public health go-live observation recorded from the workbench."
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "上线观察记录失败");
    renderPublicHealthSystem(result.system || await loadPublicHealthSystem());
    setPublicHealthMessage(`上线观察已记录：${result.observation?.name || observationId}`);
  } catch (error) {
    setPublicHealthMessage(error.message || "上线观察记录失败");
  } finally {
    button.disabled = false;
    button.textContent = previousLabel;
  }
}

async function handlePublicHealthLaunchIncidentAction(event) {
  const button = event.target.closest("[data-public-health-launch-incident]");
  if (!button || !PUBLIC_HEALTH_API_BASE || !window.HealthCityAuth?.authFetch) return;
  const incidentId = button.dataset.publicHealthLaunchIncident;
  const status = button.dataset.status || "triaged";
  const previousLabel = button.textContent;
  button.disabled = true;
  button.textContent = "记录中";
  setPublicHealthMessage("");
  try {
    const response = await window.HealthCityAuth.authFetch(`/api/public-health/launch-incidents/${encodeURIComponent(incidentId)}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "record-launch-incident",
        status,
        signalStatus: status === "rollback-recommended" ? "red" : status === "resolved" ? "green" : "triaged",
        decision: status === "rollback-recommended" ? "prepare rollback review" : status === "resolved" ? "closed" : "observe",
        artifactName: `${incidentId}-launch-incident`,
        attachmentNames: [`${incidentId}-triage.png`],
        note: "Public health launch incident action recorded from the workbench."
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "上线问题分诊记录失败");
    renderPublicHealthSystem(result.system || await loadPublicHealthSystem());
    setPublicHealthMessage(`上线问题分诊已记录：${result.incident?.name || incidentId}`);
  } catch (error) {
    setPublicHealthMessage(error.message || "上线问题分诊记录失败");
  } finally {
    button.disabled = false;
    button.textContent = previousLabel;
  }
}

async function handlePublicHealthLaunchDutyShiftAction(event) {
  const button = event.target.closest("[data-public-health-launch-duty-shift]");
  if (!button || !PUBLIC_HEALTH_API_BASE || !window.HealthCityAuth?.authFetch) return;
  const shiftId = button.dataset.publicHealthLaunchDutyShift;
  const status = button.dataset.status || "confirmed";
  const previousLabel = button.textContent;
  button.disabled = true;
  button.textContent = "记录中";
  setPublicHealthMessage("");
  try {
    const response = await window.HealthCityAuth.authFetch(`/api/public-health/launch-duty-shifts/${encodeURIComponent(shiftId)}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "record-launch-duty-handoff",
        status,
        signalStatus: status === "escalated" ? "amber" : status === "relieved" ? "green" : "confirmed",
        handoffStatus: status === "relieved" ? "relieved" : status,
        artifactName: `${shiftId}-launch-duty-handoff`,
        attachmentNames: [`${shiftId}-handoff-note.png`],
        note: "Public health launch duty handoff recorded from the workbench."
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "Launch duty handoff action failed");
    renderPublicHealthSystem(result.system || await loadPublicHealthSystem());
    setPublicHealthMessage(`Launch duty handoff recorded: ${result.shift?.name || shiftId}`);
  } catch (error) {
    setPublicHealthMessage(error.message || "Launch duty handoff action failed");
  } finally {
    button.disabled = false;
    button.textContent = previousLabel;
  }
}

async function handlePublicHealthLaunchCommandBriefAction(event) {
  const button = event.target.closest("[data-public-health-launch-command-brief]");
  if (!button || !PUBLIC_HEALTH_API_BASE || !window.HealthCityAuth?.authFetch) return;
  const briefId = button.dataset.publicHealthLaunchCommandBrief;
  const status = button.dataset.status || "published";
  const action = button.dataset.publicHealthLaunchCommandBriefAction || "record-launch-command-brief";
  const receiptAction = ["acknowledge-launch-command-brief", "escalate-launch-command-brief-receipt"].includes(action);
  const row = button.closest("[data-public-health-launch-command-brief-row]");
  const acknowledgementTarget = row?.querySelector("[data-public-health-launch-command-brief-receipt-target]")?.value || "";
  const receiptNote = row?.querySelector("[data-public-health-launch-command-brief-receipt-note]")?.value?.trim() || "";
  const previousLabel = button.textContent;
  button.disabled = true;
  button.textContent = "记录中";
  setPublicHealthMessage("");
  try {
    if (receiptAction && (!acknowledgementTarget || !receiptNote)) {
      throw new Error("请选择待确认受众并填写回执或升级说明");
    }
    const response = await window.HealthCityAuth.authFetch(`/api/public-health/launch-command-briefs/${encodeURIComponent(briefId)}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        status,
        publishStatus: status === "published" ? "published" : status,
        decision: receiptAction ? (action === "acknowledge-launch-command-brief" ? "delivery receipt confirmed" : "delivery receipt escalated") : status === "escalated" ? "escalate to launch board" : status === "held" ? "hold until gate review" : "broadcast",
        acknowledgementTarget,
        artifactName: `${briefId}-launch-command-brief`,
        attachmentNames: [`${briefId}-brief-note.pdf`],
        note: receiptAction ? receiptNote : "Public health launch command brief action recorded from the workbench."
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "Launch command brief action failed");
    renderPublicHealthSystem(result.system || await loadPublicHealthSystem());
    setPublicHealthMessage(receiptAction ? `Launch command delivery receipt recorded: ${result.brief?.name || briefId}` : `Launch command brief recorded: ${result.brief?.name || briefId}`);
  } catch (error) {
    setPublicHealthMessage(error.message || "Launch command brief action failed");
  } finally {
    button.disabled = false;
    button.textContent = previousLabel;
  }
}

async function handlePublicHealthSiteEvidenceBridgeAction(event) {
  const button = event.target.closest("[data-public-health-site-evidence-link]");
  if (!button || !PUBLIC_HEALTH_API_BASE || !window.HealthCityAuth?.authFetch) return;
  const linkId = button.dataset.publicHealthSiteEvidenceLink;
  const templateId = button.dataset.publicHealthSiteEvidenceTemplate;
  const previousLabel = button.textContent;
  button.disabled = true;
  button.textContent = "桥接中";
  setPublicHealthMessage("");
  try {
    const response = await window.HealthCityAuth.authFetch("/api/public-health/site-evidence-bridge/actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        linkId,
        templateId,
        status: "verified",
        artifactName: "公共卫生现场材料桥接记录",
        attachmentNames: ["公共卫生现场材料签收页"],
        note: "通用上线材料已映射到公共卫生证据包。"
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "现场材料桥接失败");
    renderPublicHealthSystem(result.system || await loadPublicHealthSystem());
    setPublicHealthMessage(`现场材料已桥接：${result.link?.requirement || linkId}`);
  } catch (error) {
    setPublicHealthMessage(error.message || "现场材料桥接失败");
  } finally {
    button.disabled = false;
    button.textContent = previousLabel;
  }
}

async function handlePublicHealthSiteEvidenceVerificationTaskAction(event) {
  const button = event.target.closest("[data-public-health-site-evidence-verification-task]");
  if (!button || !PUBLIC_HEALTH_API_BASE || !window.HealthCityAuth?.authFetch) return;
  const taskId = button.dataset.publicHealthSiteEvidenceVerificationTask;
  const action = button.dataset.publicHealthSiteEvidenceVerificationStatus || "start-site-evidence-verification";
  const evidenceId = button.dataset.publicHealthSiteEvidenceId || "";
  const status = action === "verify-site-evidence" ? "verified" : "verification-pending";
  const previousLabel = button.textContent;
  button.disabled = true;
  button.textContent = status === "verified" ? "核验中" : "记录中";
  setPublicHealthMessage("");
  try {
    const response = await window.HealthCityAuth.authFetch(`/api/public-health/site-evidence-verification-tasks/${encodeURIComponent(taskId)}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        status,
        evidenceId,
        artifactName: "公共卫生现场证据核验记录",
        note: status === "verified" ? "已按匹配的现场证据 ID 完成核验。" : "等待匹配的已核验现场材料。"
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "现场证据核验任务操作失败");
    renderPublicHealthSystem(result.system || await loadPublicHealthSystem());
    setPublicHealthMessage(`现场证据核验已记录：${result.task?.name || taskId}`);
  } catch (error) {
    setPublicHealthMessage(error.message || "现场证据核验任务操作失败");
  } finally {
    button.disabled = false;
    button.textContent = previousLabel;
  }
}

async function handlePublicHealthStandardImplementationAction(event) {
  const button = event.target.closest("[data-public-health-standard-implementation]");
  if (!button || !PUBLIC_HEALTH_API_BASE || !window.HealthCityAuth?.authFetch) return;
  const entryId = button.dataset.publicHealthStandardImplementation;
  const action = button.dataset.publicHealthStandardAction || "review-standard-mapping";
  const status = button.dataset.publicHealthStandardStatus || "reviewed";
  const row = button.closest("[data-public-health-standard-row]");
  const note = row?.querySelector("[data-public-health-standard-note]")?.value.trim() || "";
  const siteEvidenceId = row?.querySelector("[data-public-health-standard-evidence-id]")?.value || "";
  const remediationOwner = row?.querySelector("[data-public-health-standard-remediation-owner]")?.value.trim() || "";
  const remediationDueAt = row?.querySelector("[data-public-health-standard-remediation-due-at]")?.value || "";
  if (["record-standard-gap", "escalate-standard-gap", "assign-standard-gap-remediation", "verify-standard-gap-remediation"].includes(action) && !note) {
    setPublicHealthMessage("请填写差距或升级说明后再记录。");
    return;
  }
  if (action === "assign-standard-gap-remediation" && (!remediationOwner || !remediationDueAt)) {
    setPublicHealthMessage("请填写整改责任人和完成日期后再分派。");
    return;
  }
  if (["link-standard-site-evidence", "verify-standard-gap-remediation"].includes(action) && !siteEvidenceId) {
    setPublicHealthMessage("请选择一项已核验现场证据后再关联。");
    return;
  }
  const previousLabel = button.textContent;
  button.disabled = true;
  button.textContent = action === "verify-standard-gap-remediation" ? "核验中" : action === "assign-standard-gap-remediation" ? "分派中" : action === "link-standard-site-evidence" ? "关联中" : action === "record-standard-gap" ? "记录中" : action === "escalate-standard-gap" ? "升级中" : "复核中";
  setPublicHealthMessage("");
  try {
    const response = await window.HealthCityAuth.authFetch(`/api/public-health/standard-implementation-ledger/${encodeURIComponent(entryId)}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        status,
        gapStatus: action === "verify-standard-gap-remediation" ? "verified" : action === "assign-standard-gap-remediation" ? "assigned" : status === "gap-recorded" ? "open" : status === "escalated" ? "escalated" : undefined,
        siteEvidenceId,
        remediationOwner,
        remediationDueAt,
        artifactName: action === "verify-standard-gap-remediation" ? "公共卫生标准实施差距整改核验证据" : action === "assign-standard-gap-remediation" ? "公共卫生标准实施差距整改分派" : action === "link-standard-site-evidence" ? "公共卫生标准实施现场证据关联" : action === "escalate-standard-gap" ? "公共卫生标准实施差距升级记录" : action === "record-standard-gap" ? "公共卫生标准实施差距记录" : "公共卫生标准实施映射复核记录",
        note: note || "已复核责任方、数据集合和接口映射；现场签署证据仍须按独立流程归档。"
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "标准实施映射复核失败");
    renderPublicHealthSystem(result.system || await loadPublicHealthSystem());
    setPublicHealthMessage(`${action === "verify-standard-gap-remediation" ? "标准整改已核验" : action === "assign-standard-gap-remediation" ? "标准整改已分派" : action === "link-standard-site-evidence" ? "现场证据已关联" : action === "record-standard-gap" ? "标准差距已记录" : action === "escalate-standard-gap" ? "标准差距已升级" : "标准映射已复核"}：${result.entry?.name || entryId}`);
  } catch (error) {
    setPublicHealthMessage(error.message || "标准实施映射复核失败");
  } finally {
    button.disabled = false;
    button.textContent = previousLabel;
  }
}

async function handlePublicHealthLaunchGateAction(event) {
  const button = event.target.closest("[data-public-health-launch-approval]");
  if (!button || !PUBLIC_HEALTH_API_BASE || !window.HealthCityAuth?.authFetch) return;
  const approvalId = button.dataset.publicHealthLaunchApproval;
  const status = button.dataset.publicHealthLaunchApprovalStatus || "submitted";
  const previousLabel = button.textContent;
  button.disabled = true;
  button.textContent = "审批中";
  setPublicHealthMessage("");
  try {
    const response = await window.HealthCityAuth.authFetch("/api/public-health/launch-gate/actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        approvalId,
        action: status === "approved" ? "approve-launch-approval" : "submit-launch-approval",
        status,
        confirmation: status === "approved" ? "APPROVE PUBLIC HEALTH LAUNCH" : "",
        artifactName: "公共卫生上线审批记录",
        attachmentNames: ["上线审批签字页"],
        note: status === "approved" ? "公共卫生生产上线审批已批准。" : "公共卫生生产上线审批申请已提交。"
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "上线审批记录失败");
    renderPublicHealthSystem(result.system || await loadPublicHealthSystem());
    setPublicHealthMessage(`${status === "approved" ? "上线审批已批准" : "上线审批已提交"}：${result.approval?.role || approvalId}`);
  } catch (error) {
    setPublicHealthMessage(error.message || "上线审批记录失败");
  } finally {
    button.disabled = false;
    button.textContent = previousLabel;
  }
}

function renderEvidence(items) {
  document.querySelector("#public-health-readiness-evidence").innerHTML = items.map((item) => `<div>
    <strong>${escapeHtml(item.name)}</strong>
    <span>${escapeHtml(item.category || "")} / ${escapeHtml(item.status || "")}</span>
    <small>${escapeHtml((item.evidence || []).join(" / "))}</small>
  </div>`).join("") || `<div><strong>证据待生成</strong><span>运行 public-health:readiness 后写入发布目录。</span></div>`;
}

function countCollection(state, collection) {
  const value = state?.[collection];
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === "object") return Object.values(value).flatMap((item) => Array.isArray(item) ? item : [item]).length;
  return 0;
}

function sumField(items, key) {
  return (Array.isArray(items) ? items : []).reduce((sum, item) => sum + Number(item[key] || 0), 0);
}

function countEventActions(events) {
  return (Array.isArray(events) ? events : []).reduce((sum, item) => (
    sum + (Array.isArray(item.actionHistory) ? item.actionHistory.length : 0)
  ), 0);
}

function isCutoverClosed(item) {
  return /closed|resolved|signed|passed|complete|已关闭|已完成|已签署|通过/i.test(`${item?.status || ""} ${item?.resolutionStatus || ""} ${item?.signoffStatus || ""}`);
}

function isCutoverEvidenceRecorded(item) {
  const latest = item?.lastAction || {};
  const text = [
    item?.status,
    item?.resolutionStatus,
    item?.evidenceStatus,
    latest.action,
    latest.status,
    latest.note
  ].filter(Boolean).join(" ");
  return (Array.isArray(item?.evidence) && item.evidence.length > 0) ||
    /evidence-recorded|recorded|verified|resolved|closed|signed|passed|complete|已记录|已收集|已整改|已关闭|已完成|已签署|通过/i.test(text);
}

function daysUntil(dateValue, now = new Date()) {
  const time = Date.parse(dateValue || "");
  if (!Number.isFinite(time)) return null;
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return Math.ceil((time - today.getTime()) / 86_400_000);
}

function isEvidenceItemVerified(item) {
  return /verified|signed|accepted|complete|已核验|已签收|已完成|通过/i.test(`${item?.status || ""} ${item?.signoffStatus || ""}`);
}

function isEvidenceItemRecorded(item) {
  return isEvidenceItemVerified(item) ||
    /submitted|recorded|received|已提交|已记录|已收集/i.test(`${item?.status || ""}`) ||
    Boolean(item?.artifactName) ||
    (Array.isArray(item?.attachmentNames) && item.attachmentNames.length > 0);
}

function isLaunchApprovalSigned(item) {
  return /approved|signed|accepted|complete|已批准|已签署|已签收|已完成|通过/i.test(`${item?.status || ""} ${item?.decision || ""} ${item?.signoffStatus || ""}`);
}

function buildStaticCutoverDrills() {
  return [
    { id: "phdr-interface-dry-run", scenario: "interface-cutover", name: "Public health interface cutover dry run", phase: "T-3", owner: "interface joint-test team", status: "blocked", goNoGo: "no-go", retestStatus: "pending", linkedBlockerIds: ["phcb-direct-report-endpoint", "phcb-lis-emr-credentials"], linkedAcceptanceIds: ["phoa-interface-joint-test"], evidence: ["publicHealthExchangeRuns", "publicHealthSiteEvidenceBridge"], blockers: ["formal direct-report receipt missing", "hospital signature key handoff pending"], findings: [{ id: "phdr-interface-dry-run-f1", severity: "P0", status: "open", finding: "Direct-report endpoint receipt and hospital signature key must be signed before production.", retestStatus: "pending" }], nextAction: "Complete direct-report endpoint receipt, hospital account authorization and signature key handoff retest." },
    { id: "phdr-emergency-command", scenario: "emergency-command", name: "Emergency command tabletop and dispatch drill", phase: "T-2", owner: "health emergency and CDC team", status: "retest-required", goNoGo: "conditional", retestStatus: "pending", linkedBlockerIds: ["phcb-immunization-registry"], linkedAcceptanceIds: ["phoa-emergency-drill"], evidence: ["publicHealthEvents", "resourceDispatchRequests"], blockers: ["duty roster signoff pending"], findings: [{ id: "phdr-emergency-command-f1", severity: "P1", status: "open", finding: "Duty roster, video conference record and dispatch receipt need one signed retest.", retestStatus: "pending" }], nextAction: "Replay one high-priority event from signal to dispatch receipt and signed review." },
    { id: "phdr-security-compliance", scenario: "security-compliance", name: "Security assessment and audit retention drill", phase: "T-1", owner: "security compliance team", status: "blocked", goNoGo: "no-go", retestStatus: "pending", linkedBlockerIds: ["phcb-security-assessment"], linkedAcceptanceIds: ["phoa-security-level-protection"], evidence: ["securityAcceptanceLedger", "audit:retention"], blockers: ["assessment report pending", "GM device screenshots pending"], findings: [{ id: "phdr-security-compliance-f1", severity: "P0", status: "open", finding: "Security assessment report, remediation commitment and GM screenshots are not signed.", retestStatus: "pending" }], nextAction: "Record assessment report, remediation list, GM configuration and audit-retention screenshots." },
    { id: "phdr-backup-rollback", scenario: "backup-rollback", name: "Backup restore and rollback rehearsal", phase: "T-1", owner: "operations support team", status: "blocked", goNoGo: "no-go", retestStatus: "pending", linkedBlockerIds: ["phcb-backup-drill"], linkedAcceptanceIds: ["phoa-backup-restore"], evidence: ["launch:smoke", "rollback:snapshot"], blockers: ["RPO/RTO screenshot pending"], findings: [{ id: "phdr-backup-rollback-f1", severity: "P0", status: "open", finding: "Backup media, restore screenshot and RPO/RTO record are not signed.", retestStatus: "pending" }], nextAction: "Run one restore rehearsal for public-health event and exchange ledgers, then archive RPO/RTO evidence." },
    { id: "phdr-launch-tabletop", scenario: "launch-tabletop", name: "Launch command tabletop and go/no-go meeting", phase: "T-0", owner: "project office and release manager", status: "pending", goNoGo: "no-go", retestStatus: "pending", linkedBlockerIds: ["phcb-site-contacts"], linkedAcceptanceIds: ["phoa-institution-accounts", "phoa-release-package"], evidence: ["publicHealthLaunchApprovals", "publicHealthReadinessEvidence"], blockers: ["multi-party final signatures pending"], findings: [{ id: "phdr-launch-tabletop-f1", severity: "P1", status: "open", finding: "Final launch approvals are pending.", retestStatus: "pending" }], nextAction: "Hold launch tabletop after all P0/P1 blockers and evidence packets are closed." }
  ];
}

function buildStaticProductionHandoffs() {
  return [
    { id: "phhandoff-interface", packageType: "interface", name: "Direct-report and hospital interface handoff pack", owner: "interface joint-test team", receiver: "CDC and hospital interface owners", status: "pending-site-handoff", dueAt: "2026-07-24", requiredSignoffs: ["CDC direct-report receipt", "HIS/EMR/LIS/PACS account sheet", "signature key handoff"], evidencePacketIds: ["phcep-direct-report-endpoint", "phcep-lis-emr-credentials"], blockerIds: ["phcb-direct-report-endpoint", "phcb-lis-emr-credentials"], acceptanceIds: ["phoa-interface-joint-test"], drillIds: ["phdr-interface-dry-run"], approvalIds: ["phla-cdc", "phla-hospital"], releaseArtifacts: ["release/public-health-readiness-report.md", "release/integration-readiness-report.md"], nextAction: "Collect signed direct-report receipt, hospital account sheet and signature-key custody page." },
    { id: "phhandoff-command", packageType: "command", name: "Emergency command and duty-roster handoff pack", owner: "health emergency and CDC team", receiver: "health emergency duty office", status: "pending-site-handoff", dueAt: "2026-07-24", requiredSignoffs: ["duty roster", "video meeting record", "dispatch receipt"], evidencePacketIds: ["phcep-immunization-registry"], blockerIds: ["phcb-immunization-registry"], acceptanceIds: ["phoa-emergency-drill"], drillIds: ["phdr-emergency-command"], approvalIds: ["phla-cdc", "phla-health-admin"], releaseArtifacts: ["release/public-health-readiness-report.md"], nextAction: "Archive emergency tabletop minutes, dispatch receipt and duty roster before go/no-go." },
    { id: "phhandoff-security", packageType: "security", name: "Security assessment and national-crypto handoff pack", owner: "security compliance team", receiver: "security compliance owner", status: "pending-site-handoff", dueAt: "2026-07-24", requiredSignoffs: ["classified protection report", "cryptography assessment", "GM configuration screenshot", "audit retention screenshot"], evidencePacketIds: ["phcep-security-assessment"], blockerIds: ["phcb-security-assessment"], acceptanceIds: ["phoa-security-level-protection"], drillIds: ["phdr-security-compliance"], approvalIds: ["phla-security"], releaseArtifacts: ["release/audit-retention-report.md", "release/site-readiness-pack.md"], nextAction: "Attach assessment report, remediation commitment, GM configuration and audit-retention screenshots." },
    { id: "phhandoff-operations", packageType: "operations", name: "Backup restore and rollback handoff pack", owner: "operations support team", receiver: "operations duty lead", status: "pending-site-handoff", dueAt: "2026-07-24", requiredSignoffs: ["backup media record", "restore screenshot", "RPO/RTO record", "rollback window"], evidencePacketIds: ["phcep-backup-drill"], blockerIds: ["phcb-backup-drill"], acceptanceIds: ["phoa-backup-restore"], drillIds: ["phdr-backup-rollback"], approvalIds: ["phla-operations"], releaseArtifacts: ["release/launch-smoke-report.md", "release/production-cutover-checklist.md"], nextAction: "Complete one restore rehearsal and attach RPO/RTO plus rollback owner evidence." },
    { id: "phhandoff-institution", packageType: "institution", name: "Seven-institution account and contact handoff pack", owner: "project office", receiver: "institution liaison group", status: "pending-site-handoff", dueAt: "2026-07-24", requiredSignoffs: ["contact list", "authorization scope", "account list"], evidencePacketIds: ["phcep-site-contacts"], blockerIds: ["phcb-site-contacts"], acceptanceIds: ["phoa-institution-accounts"], drillIds: ["phdr-launch-tabletop"], approvalIds: ["phla-health-admin", "phla-project-office"], releaseArtifacts: ["release/site-readiness-pack.md"], nextAction: "Confirm seven institution contacts, account scopes and escalation owners." },
    { id: "phhandoff-release", packageType: "release", name: "Release archive and final go/no-go handoff pack", owner: "release manager", receiver: "health commission launch board", status: "pending-site-handoff", dueAt: "2026-07-24", requiredSignoffs: ["release report", "deploy check", "launch smoke", "final go/no-go minutes"], evidencePacketIds: ["phcep-site-contacts"], blockerIds: ["phcb-site-contacts"], acceptanceIds: ["phoa-release-package"], drillIds: ["phdr-launch-tabletop"], approvalIds: ["phla-health-admin", "phla-project-office"], releaseArtifacts: ["release/release-report.md", "release/release-artifact-manifest.md", "release/launch-smoke-report.md"], nextAction: "Archive release manifest, deploy check, launch smoke and final go/no-go minutes." }
  ];
}

function isProductionHandoffAccepted(item) {
  return /accepted|signed|complete|verified|handed-off|approved/i.test(`${item?.status || ""} ${item?.signoffStatus || ""} ${item?.handoffStatus || ""}`);
}

function buildStaticProductionHandoffBoard(handoffs = [], options = {}) {
  const evidenceBoard = options.cutoverEvidenceBoard || {};
  const verifiedPacketIds = new Set((evidenceBoard.packets || []).filter((item) => item.complete).map((item) => item.id));
  const openBlockerIds = new Set((Array.isArray(options.cutoverBlockers) ? options.cutoverBlockers : []).filter((item) => !isCutoverClosed(item)).map((item) => item.id));
  const signedApprovalIds = new Set((Array.isArray(options.launchApprovals) ? options.launchApprovals : []).filter(isLaunchApprovalSigned).map((item) => item.id));
  const rows = (Array.isArray(handoffs) ? handoffs : []).map((item) => {
    const accepted = isProductionHandoffAccepted(item);
    const requiredSignoffs = Array.isArray(item.requiredSignoffs) ? item.requiredSignoffs : [];
    const packetIds = Array.isArray(item.evidencePacketIds) ? item.evidencePacketIds : [];
    const blockerIds = Array.isArray(item.blockerIds) ? item.blockerIds : [];
    const approvalIds = Array.isArray(item.approvalIds) ? item.approvalIds : [];
    const missingPacketIds = packetIds.filter((id) => !verifiedPacketIds.has(id));
    const openLinkedBlockers = blockerIds.filter((id) => openBlockerIds.has(id));
    const pendingApprovalIds = approvalIds.filter((id) => !signedApprovalIds.has(id));
    return {
      ...item,
      accepted,
      requiredSignoffs,
      missingSignoffCount: accepted ? 0 : requiredSignoffs.length,
      missingPacketIds,
      openLinkedBlockers,
      pendingApprovalIds,
      releaseArtifactCount: Array.isArray(item.releaseArtifacts) ? item.releaseArtifacts.length : 0,
      blocked: !accepted || missingPacketIds.length > 0 || openLinkedBlockers.length > 0 || pendingApprovalIds.length > 0
    };
  });
  const acceptedHandoffs = rows.filter((item) => item.accepted).length;
  const missingSignoffs = rows.reduce((sum, item) => sum + item.missingSignoffCount, 0);
  const pendingHandoffs = Math.max(rows.length - acceptedHandoffs, 0);
  const blockedHandoffs = rows.filter((item) => item.blocked).length;
  return {
    id: "public-health-production-handoff-board",
    status: rows.length > 0 && pendingHandoffs === 0 && missingSignoffs === 0 && blockedHandoffs === 0 ? "accepted" : "blocked",
    summary: {
      handoffs: rows.length,
      acceptedHandoffs,
      pendingHandoffs,
      blockedHandoffs,
      missingSignoffs,
      linkedEvidencePackets: new Set(rows.flatMap((item) => item.evidencePacketIds || [])).size,
      linkedBlockers: new Set(rows.flatMap((item) => item.blockerIds || [])).size,
      linkedAcceptances: new Set(rows.flatMap((item) => item.acceptanceIds || [])).size,
      linkedApprovals: new Set(rows.flatMap((item) => item.approvalIds || [])).size,
      releaseArtifacts: rows.reduce((sum, item) => sum + item.releaseArtifactCount, 0),
      cutoverMissingItems: evidenceBoard.summary?.missingItems || 0,
      openLinkedBlockers: rows.reduce((sum, item) => sum + item.openLinkedBlockers.length, 0),
      pendingLinkedApprovals: rows.reduce((sum, item) => sum + item.pendingApprovalIds.length, 0)
    },
    handoffs: rows,
    nextActions: rows.filter((item) => item.blocked).map((item) => ({ id: item.id, packageType: item.packageType, owner: item.owner, receiver: item.receiver, dueAt: item.dueAt || "", nextAction: item.nextAction || "" }))
  };
}

function buildStaticGoLiveObservations() {
  return [
    { id: "phgl-live-smoke", window: "T+0-15m", phase: "launch-open", name: "Live health and public-health API smoke watch", owner: "release manager", status: "scheduled", severity: "P0", metric: "/api/health and /api/public-health/system", threshold: "HTTP 200 within 5 seconds for three consecutive probes", rollbackTrigger: "Health or public-health system API unavailable for 5 minutes", rollbackOwner: "operations duty lead", evidence: ["/api/health", "/api/public-health/system", "launch:smoke"], linkedHandoffIds: ["phhandoff-release", "phhandoff-operations"], linkedApprovalIds: ["phla-operations", "phla-project-office"], requiredArtifacts: ["live-smoke-report", "launch-room-screenshot"], nextAction: "Run authenticated live smoke from the launch room and archive the report." },
    { id: "phgl-direct-report-receipt", window: "T+15-60m", phase: "first-exchange", name: "Direct-report and hospital receipt watch", owner: "interface joint-test team", status: "scheduled", severity: "P0", metric: "direct-report, LIS and hospital callback receipts", threshold: "First production exchange batch has accepted receipt and zero untriaged failures", rollbackTrigger: "Receipt missing or untriaged P0 callback failure after 30 minutes", rollbackOwner: "CDC direct-report owner", evidence: ["publicHealthExchangeRuns", "publicHealthCutoverEvidencePackets"], linkedHandoffIds: ["phhandoff-interface"], linkedApprovalIds: ["phla-cdc", "phla-hospital"], requiredArtifacts: ["direct-report-receipt", "hospital-callback-screenshot"], nextAction: "Capture the first accepted production receipt and any compensation decision." },
    { id: "phgl-command-duty", window: "T+1h-4h", phase: "command-duty", name: "Emergency command duty and event dispatch watch", owner: "health emergency duty office", status: "scheduled", severity: "P1", metric: "event dispatch, duty roster and command receipt", threshold: "Duty owner confirms event queue, dispatch channel and command receipt", rollbackTrigger: "Duty roster unavailable or command channel cannot receive event dispatch", rollbackOwner: "health emergency duty lead", evidence: ["publicHealthEvents", "resourceDispatchRequests"], linkedHandoffIds: ["phhandoff-command"], linkedApprovalIds: ["phla-health-admin", "phla-cdc"], requiredArtifacts: ["duty-roster-confirmation", "event-dispatch-screenshot"], nextAction: "Record the duty roster confirmation and one command-channel probe." },
    { id: "phgl-security-audit", window: "T+0-4h", phase: "security-watch", name: "Security audit, authentication and GM-device watch", owner: "security compliance team", status: "scheduled", severity: "P0", metric: "login audit, high-risk event audit and GM-device evidence", threshold: "Audit chain verifies and no critical denied security event is open", rollbackTrigger: "Audit chain verification fails or GM/signature device is unavailable", rollbackOwner: "security compliance owner", evidence: ["securityEvents", "dataAccessLogs", "audit:retention"], linkedHandoffIds: ["phhandoff-security"], linkedApprovalIds: ["phla-security"], requiredArtifacts: ["audit-verify-report", "gm-device-screenshot"], nextAction: "Run audit verification and archive security watch screenshots." },
    { id: "phgl-rollback-window", window: "T+0-24h", phase: "rollback-standby", name: "Backup restore and rollback standby watch", owner: "operations support team", status: "scheduled", severity: "P0", metric: "backup snapshot, restore rehearsal and rollback owner availability", threshold: "Rollback owner, latest backup and rollback checklist are available during the watch window", rollbackTrigger: "Latest backup unavailable, RPO/RTO breach, or rollback owner unreachable", rollbackOwner: "operations duty lead", evidence: ["rollback:snapshot", "release/production-cutover-checklist.md"], linkedHandoffIds: ["phhandoff-operations", "phhandoff-release"], linkedApprovalIds: ["phla-operations"], requiredArtifacts: ["backup-snapshot-id", "rollback-owner-confirmation"], nextAction: "Confirm backup snapshot id, rollback owner and RPO/RTO watch interval." },
    { id: "phgl-institution-helpdesk", window: "T+0-24h", phase: "institution-support", name: "Seven-institution account and helpdesk watch", owner: "project office", status: "scheduled", severity: "P1", metric: "institution login, helpdesk queue and account authorization", threshold: "Seven institution contact paths and account support queue are staffed", rollbackTrigger: "More than one institution cannot access launch-critical role scope", rollbackOwner: "project office launch coordinator", evidence: ["publicHealthInstitutionTasks", "authUsers", "siteLaunchEvidence"], linkedHandoffIds: ["phhandoff-institution"], linkedApprovalIds: ["phla-health-admin", "phla-project-office"], requiredArtifacts: ["institution-contact-roster", "account-support-log"], nextAction: "Confirm institution contact roster and launch-day account support queue." }
  ];
}

function isGoLiveObservationPassed(item) {
  const text = `${item?.status || ""} ${item?.signalStatus || ""} ${item?.decision || ""}`;
  return /passed|stable|green|closed|complete|accepted|verified/i.test(text) && !/rollback|blocked|failed|red|critical|open/i.test(text);
}

function isGoLiveObservationCritical(item) {
  const signal = `${item?.status || ""} ${item?.signalStatus || ""} ${item?.decision || ""}`;
  return /critical|red|rollback|blocked|failed/i.test(signal);
}

function buildStaticGoLiveObservationBoard(observations = [], options = {}) {
  const rows = (Array.isArray(observations) ? observations : []).map((item) => {
    const evidence = Array.isArray(item.evidence) ? item.evidence : [];
    const linkedHandoffIds = Array.isArray(item.linkedHandoffIds) ? item.linkedHandoffIds : [];
    const linkedApprovalIds = Array.isArray(item.linkedApprovalIds) ? item.linkedApprovalIds : [];
    const requiredArtifacts = Array.isArray(item.requiredArtifacts) ? item.requiredArtifacts : [];
    const planReady = Boolean(item.window && item.owner && item.metric && item.threshold && item.rollbackTrigger && item.rollbackOwner && evidence.length && requiredArtifacts.length);
    const passed = isGoLiveObservationPassed(item);
    const criticalOpen = isGoLiveObservationCritical(item) && !passed;
    return {
      ...item,
      evidence,
      linkedHandoffIds,
      linkedApprovalIds,
      requiredArtifacts,
      planReady,
      passed,
      criticalOpen,
      rollbackPlanned: Boolean(item.rollbackTrigger && item.rollbackOwner),
      pending: !passed
    };
  });
  const planReadyRows = rows.filter((item) => item.planReady).length;
  const passedObservations = rows.filter((item) => item.passed).length;
  const openCriticalSignals = rows.filter((item) => item.criticalOpen).length;
  const rollbackPlans = rows.filter((item) => item.rollbackPlanned).length;
  const status = rows.length > 0 && planReadyRows === rows.length && rollbackPlans === rows.length && openCriticalSignals === 0
    ? "watch-ready"
    : openCriticalSignals > 0
      ? "rollback-watch"
      : "blocked";
  return {
    id: "public-health-go-live-observation-board",
    status,
    planReady: status === "watch-ready",
    summary: {
      observations: rows.length,
      planReady: planReadyRows,
      passedObservations,
      pendingObservations: Math.max(rows.length - passedObservations, 0),
      openCriticalSignals,
      rollbackPlans,
      linkedHandoffs: new Set(rows.flatMap((item) => item.linkedHandoffIds || [])).size,
      linkedApprovals: new Set(rows.flatMap((item) => item.linkedApprovalIds || [])).size,
      requiredArtifacts: rows.reduce((sum, item) => sum + item.requiredArtifacts.length, 0),
      launchGateStatus: options.launchGate?.status || "unknown",
      launchReleaseGate: options.launchGate?.releaseGate || "unknown"
    },
    observations: rows,
    nextActions: rows.filter((item) => !item.passed).map((item) => ({ id: item.id, window: item.window || "", phase: item.phase || "", owner: item.owner || "", rollbackOwner: item.rollbackOwner || "", nextAction: item.nextAction || "" }))
  };
}

function buildStaticLaunchIncidents() {
  return [
    { id: "phli-api-smoke", lane: "api", name: "Live API smoke incident lane", owner: "release manager", status: "standby", severity: "P0", sla: "triage within 5 minutes", escalationPath: ["release manager", "operations duty lead", "project commander"], rollbackDecisionOwner: "operations duty lead", linkedObservationIds: ["phgl-live-smoke"], linkedHandoffIds: ["phhandoff-release", "phhandoff-operations"], evidence: ["/api/health", "/api/public-health/system", "launch:smoke"], requiredArtifacts: ["incident-ticket", "live-smoke-log"], nextAction: "Keep launch smoke owner ready to open or close an incident ticket." },
    { id: "phli-direct-report", lane: "exchange", name: "Direct-report and hospital callback incident lane", owner: "interface joint-test team", status: "standby", severity: "P0", sla: "triage within 10 minutes", escalationPath: ["interface owner", "CDC direct-report owner", "hospital callback owner"], rollbackDecisionOwner: "CDC direct-report owner", linkedObservationIds: ["phgl-direct-report-receipt"], linkedHandoffIds: ["phhandoff-interface"], evidence: ["publicHealthExchangeRuns", "publicHealthCutoverEvidencePackets"], requiredArtifacts: ["receipt-screenshot", "compensation-decision"], nextAction: "Stand by for first production receipt failures and compensation decisions." },
    { id: "phli-command-duty", lane: "command", name: "Emergency command duty incident lane", owner: "health emergency duty office", status: "standby", severity: "P1", sla: "triage within 15 minutes", escalationPath: ["duty officer", "health emergency lead", "health admin commander"], rollbackDecisionOwner: "health emergency duty lead", linkedObservationIds: ["phgl-command-duty"], linkedHandoffIds: ["phhandoff-command"], evidence: ["publicHealthEvents", "resourceDispatchRequests"], requiredArtifacts: ["dispatch-screenshot", "duty-roster-note"], nextAction: "Keep event dispatch and command-room escalation owners reachable." },
    { id: "phli-security-audit", lane: "security", name: "Security audit and authentication incident lane", owner: "security compliance team", status: "standby", severity: "P0", sla: "triage within 5 minutes", escalationPath: ["security operator", "security compliance owner", "release commander"], rollbackDecisionOwner: "security compliance owner", linkedObservationIds: ["phgl-security-audit"], linkedHandoffIds: ["phhandoff-security"], evidence: ["securityEvents", "audit:retention"], requiredArtifacts: ["audit-event-id", "security-review-note"], nextAction: "Watch authentication, audit chain and crypto device incidents." },
    { id: "phli-backup-rollback", lane: "rollback", name: "Backup restore and rollback decision lane", owner: "operations support team", status: "standby", severity: "P0", sla: "decision within 10 minutes", escalationPath: ["operations duty lead", "release manager", "health admin commander"], rollbackDecisionOwner: "operations duty lead", linkedObservationIds: ["phgl-rollback-window"], linkedHandoffIds: ["phhandoff-operations"], evidence: ["rollback:snapshot", "release/production-cutover-checklist.md"], requiredArtifacts: ["rollback-decision-record", "snapshot-id"], nextAction: "Keep rollback decision record, snapshot id and duty contact ready." },
    { id: "phli-institution-helpdesk", lane: "support", name: "Seven-institution helpdesk incident lane", owner: "project office", status: "standby", severity: "P1", sla: "triage within 15 minutes", escalationPath: ["helpdesk owner", "institution liaison", "project office"], rollbackDecisionOwner: "project office launch coordinator", linkedObservationIds: ["phgl-institution-helpdesk"], linkedHandoffIds: ["phhandoff-institution"], evidence: ["publicHealthInstitutionTasks", "authUsers"], requiredArtifacts: ["helpdesk-ticket", "account-scope-note"], nextAction: "Keep account, role and institution contact issues triaged during launch day." }
  ];
}

function isLaunchIncidentResolved(item) {
  return /resolved|closed|false-positive|green/i.test(`${item?.status || ""} ${item?.signalStatus || ""} ${item?.decision || ""}`);
}

function isLaunchIncidentOpen(item) {
  const text = `${item?.status || ""} ${item?.signalStatus || ""} ${item?.decision || ""}`;
  return /opened|open|triaged|monitoring|escalated|rollback-recommended|red|amber/i.test(text) && !isLaunchIncidentResolved(item);
}

function isLaunchIncidentCritical(item) {
  const text = `${item?.status || ""} ${item?.signalStatus || ""} ${item?.decision || ""}`;
  return isLaunchIncidentOpen(item) && /critical|red|rollback-recommended|blocked|failed|escalated/i.test(text);
}

function buildStaticLaunchIncidentBoard(incidents = [], options = {}) {
  const rows = (Array.isArray(incidents) ? incidents : []).map((item) => {
    const escalationPath = Array.isArray(item.escalationPath) ? item.escalationPath : [];
    const linkedObservationIds = Array.isArray(item.linkedObservationIds) ? item.linkedObservationIds : [];
    const linkedHandoffIds = Array.isArray(item.linkedHandoffIds) ? item.linkedHandoffIds : [];
    const evidence = Array.isArray(item.evidence) ? item.evidence : [];
    const requiredArtifacts = Array.isArray(item.requiredArtifacts) ? item.requiredArtifacts : [];
    const resolved = isLaunchIncidentResolved(item);
    const open = isLaunchIncidentOpen(item);
    const criticalOpen = isLaunchIncidentCritical(item);
    const deskReady = Boolean(item.lane && item.owner && item.sla && escalationPath.length && item.rollbackDecisionOwner && evidence.length && requiredArtifacts.length);
    return {
      ...item,
      escalationPath,
      linkedObservationIds,
      linkedHandoffIds,
      evidence,
      requiredArtifacts,
      deskReady,
      resolved,
      open,
      criticalOpen
    };
  });
  const deskReadyRows = rows.filter((item) => item.deskReady).length;
  const criticalOpenTickets = rows.filter((item) => item.criticalOpen).length;
  const openTickets = rows.filter((item) => item.open).length;
  const status = rows.length > 0 && deskReadyRows === rows.length && criticalOpenTickets === 0
    ? "desk-ready"
    : criticalOpenTickets > 0
      ? "incident-watch"
      : "blocked";
  return {
    id: "public-health-launch-incident-board",
    status,
    deskReady: status === "desk-ready",
    summary: {
      lanes: rows.length,
      deskReady: deskReadyRows,
      openTickets,
      criticalOpenTickets,
      resolvedTickets: rows.filter((item) => item.resolved).length,
      rollbackDecisionOwners: new Set(rows.map((item) => item.rollbackDecisionOwner).filter(Boolean)).size,
      escalationPaths: rows.filter((item) => item.escalationPath.length).length,
      linkedObservations: new Set(rows.flatMap((item) => item.linkedObservationIds || [])).size,
      linkedHandoffs: new Set(rows.flatMap((item) => item.linkedHandoffIds || [])).size,
      requiredArtifacts: rows.reduce((sum, item) => sum + item.requiredArtifacts.length, 0),
      launchGateStatus: options.launchGate?.status || "unknown",
      launchReleaseGate: options.launchGate?.releaseGate || "unknown"
    },
    incidents: rows,
    nextActions: rows.filter((item) => item.open || !item.deskReady).map((item) => ({ id: item.id, lane: item.lane || "", owner: item.owner || "", severity: item.severity || "", nextAction: item.nextAction || "" }))
  };
}

function buildStaticLaunchDutyShifts() {
  return [
    { id: "phlds-release-room", shiftWindow: "T-2h to T+4h", lane: "release-room", name: "Release command room duty handoff", owner: "release manager", backupOwner: "project office launch coordinator", status: "scheduled", contactChannel: "launch-room bridge", escalationOwner: "health commission launch board", linkedObservationIds: ["phgl-live-smoke"], linkedIncidentIds: ["phli-api-smoke", "phli-backup-rollback"], linkedHandoffIds: ["phhandoff-release"], handoffChecklist: ["go/no-go minutes", "launch smoke owner", "rollback decision path"], requiredArtifacts: ["duty-roster", "bridge-room-screenshot"], nextAction: "Confirm command room bridge and release duty owner." },
    { id: "phlds-cdc-direct-report", shiftWindow: "T+0 to T+8h", lane: "direct-report", name: "CDC direct-report duty handoff", owner: "CDC direct-report owner", backupOwner: "CDC surveillance duty backup", status: "scheduled", contactChannel: "CDC duty phone", escalationOwner: "CDC business lead", linkedObservationIds: ["phgl-direct-report-receipt"], linkedIncidentIds: ["phli-direct-report"], linkedHandoffIds: ["phhandoff-interface"], handoffChecklist: ["first batch receipt", "failed payload triage", "manual compensation owner"], requiredArtifacts: ["cdc-duty-roster", "receipt-watch-note"], nextAction: "Keep CDC receipt reviewer reachable for first exchange batch." },
    { id: "phlds-hospital-interface", shiftWindow: "T+0 to T+8h", lane: "hospital-callback", name: "Hospital callback and LIS/EMR duty handoff", owner: "hospital interface owner", backupOwner: "hospital information duty engineer", status: "scheduled", contactChannel: "hospital IT group", escalationOwner: "hospital launch approver", linkedObservationIds: ["phgl-direct-report-receipt"], linkedIncidentIds: ["phli-direct-report"], linkedHandoffIds: ["phhandoff-interface"], handoffChecklist: ["callback receipt owner", "signature key owner", "sample id query owner"], requiredArtifacts: ["hospital-duty-roster", "callback-receipt-note"], nextAction: "Confirm callback receipt and signature-key owners." },
    { id: "phlds-security-audit", shiftWindow: "T-1h to T+8h", lane: "security-audit", name: "Security audit and authentication duty handoff", owner: "security compliance owner", backupOwner: "security operations backup", status: "scheduled", contactChannel: "security duty phone", escalationOwner: "security launch approver", linkedObservationIds: ["phgl-security-audit"], linkedIncidentIds: ["phli-security-audit"], linkedHandoffIds: ["phhandoff-security"], handoffChecklist: ["login audit monitor", "denied event triage", "GM device fallback"], requiredArtifacts: ["security-duty-roster", "audit-monitor-screenshot"], nextAction: "Confirm audit monitor and GM-device fallback owner." },
    { id: "phlds-operations-rollback", shiftWindow: "T-2h to T+24h", lane: "operations-rollback", name: "Operations rollback and backup duty handoff", owner: "operations duty lead", backupOwner: "backup restore engineer", status: "scheduled", contactChannel: "operations bridge", escalationOwner: "operations launch approver", linkedObservationIds: ["phgl-rollback-window"], linkedIncidentIds: ["phli-backup-rollback"], linkedHandoffIds: ["phhandoff-operations", "phhandoff-release"], handoffChecklist: ["backup snapshot id", "restore command owner", "RPO/RTO watch"], requiredArtifacts: ["backup-snapshot-note", "rollback-owner-roster"], nextAction: "Confirm backup snapshot id and restore command owner." },
    { id: "phlds-institution-helpdesk", shiftWindow: "T+0 to T+24h", lane: "institution-helpdesk", name: "Seven-institution helpdesk duty handoff", owner: "project office launch coordinator", backupOwner: "institution liaison backup", status: "scheduled", contactChannel: "institution helpdesk queue", escalationOwner: "project office approver", linkedObservationIds: ["phgl-institution-helpdesk"], linkedIncidentIds: ["phli-institution-helpdesk"], linkedHandoffIds: ["phhandoff-institution"], handoffChecklist: ["contact roster", "account scope support", "first-line FAQ owner"], requiredArtifacts: ["institution-contact-roster", "account-helpdesk-log"], nextAction: "Confirm contact roster and helpdesk queue." }
  ];
}

function isLaunchDutyShiftMissed(item) {
  return /missed|unreachable|blocked|failed|red|critical/i.test(`${item?.status || ""} ${item?.signalStatus || ""} ${item?.handoffStatus || ""} ${item?.decision || ""}`);
}

function isLaunchDutyShiftEscalated(item) {
  return /escalated|amber|watch|delayed/i.test(`${item?.status || ""} ${item?.signalStatus || ""} ${item?.handoffStatus || ""} ${item?.decision || ""}`) && !isLaunchDutyShiftMissed(item);
}

function buildStaticLaunchDutyBoard(shifts = [], options = {}) {
  const rows = (Array.isArray(shifts) ? shifts : []).map((item) => {
    const linkedObservationIds = Array.isArray(item.linkedObservationIds) ? item.linkedObservationIds : [];
    const linkedIncidentIds = Array.isArray(item.linkedIncidentIds) ? item.linkedIncidentIds : [];
    const linkedHandoffIds = Array.isArray(item.linkedHandoffIds) ? item.linkedHandoffIds : [];
    const handoffChecklist = Array.isArray(item.handoffChecklist) ? item.handoffChecklist : [];
    const requiredArtifacts = Array.isArray(item.requiredArtifacts) ? item.requiredArtifacts : [];
    const missed = isLaunchDutyShiftMissed(item);
    const escalated = isLaunchDutyShiftEscalated(item);
    const shiftReady = Boolean(item.shiftWindow && item.owner && item.backupOwner && item.contactChannel && item.escalationOwner && linkedObservationIds.length && linkedIncidentIds.length && handoffChecklist.length && requiredArtifacts.length && !missed);
    return { ...item, linkedObservationIds, linkedIncidentIds, linkedHandoffIds, handoffChecklist, requiredArtifacts, missed, escalated, shiftReady, pending: !/confirmed|relieved|closed|complete|accepted/i.test(`${item.status || ""} ${item.handoffStatus || ""}`) };
  });
  const readyShifts = rows.filter((item) => item.shiftReady).length;
  const missedHandoffs = rows.filter((item) => item.missed).length;
  const escalatedShifts = rows.filter((item) => item.escalated).length;
  const status = rows.length > 0 && readyShifts === rows.length && missedHandoffs === 0 ? "roster-ready" : missedHandoffs > 0 || escalatedShifts > 0 ? "handoff-watch" : "blocked";
  return {
    id: "public-health-launch-duty-board",
    status,
    rosterReady: status === "roster-ready",
    summary: {
      shifts: rows.length,
      readyShifts,
      pendingShifts: rows.filter((item) => item.pending).length,
      missedHandoffs,
      escalatedShifts,
      backupContacts: rows.filter((item) => item.backupOwner).length,
      contactChannels: rows.filter((item) => item.contactChannel).length,
      escalationOwners: new Set(rows.map((item) => item.escalationOwner).filter(Boolean)).size,
      linkedObservations: new Set(rows.flatMap((item) => item.linkedObservationIds || [])).size,
      linkedIncidents: new Set(rows.flatMap((item) => item.linkedIncidentIds || [])).size,
      linkedHandoffs: new Set(rows.flatMap((item) => item.linkedHandoffIds || [])).size,
      checklistItems: rows.reduce((sum, item) => sum + item.handoffChecklist.length, 0),
      requiredArtifacts: rows.reduce((sum, item) => sum + item.requiredArtifacts.length, 0),
      launchGateStatus: options.launchGate?.status || "unknown",
      launchReleaseGate: options.launchGate?.releaseGate || "unknown"
    },
    shifts: rows,
    nextActions: rows.filter((item) => !item.shiftReady || item.missed || item.escalated).map((item) => ({ id: item.id, lane: item.lane || "", owner: item.owner || "", backupOwner: item.backupOwner || "", nextAction: item.nextAction || "" }))
  };
}

function buildStaticLaunchCommandBriefs() {
  return [
    { id: "phlcb-prelaunch-go-no-go", briefWindow: "T-1h", phase: "prelaunch", name: "Prelaunch go/no-go command brief", owner: "release manager", recorder: "command room recorder", status: "draft-ready", audience: ["health commission launch board", "CDC command owner", "operations duty lead"], sourceBoards: ["launchGate", "cutoverReadiness", "productionHandoffBoard", "launchDutyBoard"], linkedDutyShiftIds: ["phlds-release-room", "phlds-operations-rollback", "phlds-security-audit"], linkedObservationIds: ["phgl-live-smoke", "phgl-security-audit", "phgl-rollback-window"], linkedIncidentIds: ["phli-api-smoke", "phli-security-audit", "phli-backup-rollback"], requiredSections: ["gate status", "open P0/P1 blockers", "rollback decision path", "duty roster confirmation"], publishChannel: "launch-room bridge", publishTarget: "go/no-go meeting minutes", decisionOwner: "health commission launch board", nextAction: "Publish only after gate, blockers, handoffs and rollback owners are reviewed." },
    { id: "phlcb-t0-launch-start", briefWindow: "T+0", phase: "launch-start", name: "Launch start command status brief", owner: "release manager", recorder: "project office launch coordinator", status: "draft-ready", audience: ["release room", "CDC direct-report owner", "hospital interface owner"], sourceBoards: ["goLiveObservationBoard", "launchIncidentBoard", "launchDutyBoard"], linkedDutyShiftIds: ["phlds-release-room", "phlds-cdc-direct-report", "phlds-hospital-interface"], linkedObservationIds: ["phgl-live-smoke", "phgl-direct-report-receipt"], linkedIncidentIds: ["phli-api-smoke", "phli-direct-report"], requiredSections: ["API smoke", "first exchange window", "security audit watch"], publishChannel: "launch-room bridge", publishTarget: "launch start status broadcast", decisionOwner: "release manager", nextAction: "Broadcast launch start state after health check and incident desk standby are confirmed." },
    { id: "phlcb-t2-first-receipts", briefWindow: "T+2h", phase: "first-receipts", name: "First receipt and callback command brief", owner: "CDC direct-report owner", recorder: "interface joint-test recorder", status: "draft-ready", audience: ["CDC command owner", "hospital interface owner", "interface vendor bridge"], sourceBoards: ["goLiveObservationBoard", "launchIncidentBoard", "siteEvidenceBridge"], linkedDutyShiftIds: ["phlds-cdc-direct-report", "phlds-hospital-interface"], linkedObservationIds: ["phgl-direct-report-receipt"], linkedIncidentIds: ["phli-direct-report"], requiredSections: ["direct-report receipt", "hospital callback receipt", "failed payload triage"], publishChannel: "CDC duty group", publishTarget: "first receipt status note", decisionOwner: "CDC business lead", nextAction: "Record first receipt outcome without closing external evidence blockers automatically." },
    { id: "phlcb-t8-stability-watch", briefWindow: "T+8h", phase: "stability-watch", name: "Stability watch and risk command brief", owner: "operations duty lead", recorder: "operations duty recorder", status: "draft-ready", audience: ["operations bridge", "security compliance owner", "institution helpdesk"], sourceBoards: ["goLiveObservationBoard", "launchIncidentBoard", "productionHandoffBoard"], linkedDutyShiftIds: ["phlds-security-audit", "phlds-operations-rollback", "phlds-institution-helpdesk"], linkedObservationIds: ["phgl-security-audit", "phgl-rollback-window", "phgl-institution-helpdesk"], linkedIncidentIds: ["phli-security-audit", "phli-backup-rollback", "phli-institution-helpdesk"], requiredSections: ["critical signals", "security audit result", "rollback standby"], publishChannel: "operations bridge", publishTarget: "T+8 stability watch note", decisionOwner: "operations launch approver", nextAction: "Publish stability summary while rollback and incident owners remain reachable." },
    { id: "phlcb-t24-closure-handoff", briefWindow: "T+24h", phase: "closure-handoff", name: "First-day closure and handoff command brief", owner: "project office launch coordinator", recorder: "release archive owner", status: "draft-ready", audience: ["health commission launch board", "project office", "operations duty lead"], sourceBoards: ["launchGate", "goLiveObservationBoard", "launchIncidentBoard", "launchDutyBoard", "productionHandoffBoard"], linkedDutyShiftIds: ["phlds-release-room", "phlds-operations-rollback", "phlds-institution-helpdesk"], linkedObservationIds: ["phgl-live-smoke", "phgl-rollback-window", "phgl-institution-helpdesk"], linkedIncidentIds: ["phli-api-smoke", "phli-backup-rollback", "phli-institution-helpdesk"], requiredSections: ["first-day observations", "open incidents", "handoff gaps", "next 72h watch plan"], publishChannel: "project office archive", publishTarget: "first-day closure handoff brief", decisionOwner: "project office approver", nextAction: "Archive first-day closure brief and carry open evidence and approval gaps into next watch cycle." }
  ];
}

function isLaunchCommandBriefPublished(item) {
  return /published|sent|approved|archived|complete|closed/i.test(`${item?.status || ""} ${item?.decision || ""} ${item?.publishStatus || ""}`);
}

function isLaunchCommandBriefBlocked(item) {
  return /blocked|failed|red|critical|rollback/i.test(`${item?.status || ""} ${item?.decision || ""} ${item?.signalStatus || ""}`) && !isLaunchCommandBriefPublished(item);
}

function buildStaticLaunchCommandBriefBoard(briefs = [], options = {}) {
  const rows = (Array.isArray(briefs) ? briefs : []).map((item) => {
    const audience = Array.isArray(item.audience) ? item.audience : [];
    const sourceBoards = Array.isArray(item.sourceBoards) ? item.sourceBoards : [];
    const linkedDutyShiftIds = Array.isArray(item.linkedDutyShiftIds) ? item.linkedDutyShiftIds : [];
    const linkedObservationIds = Array.isArray(item.linkedObservationIds) ? item.linkedObservationIds : [];
    const linkedIncidentIds = Array.isArray(item.linkedIncidentIds) ? item.linkedIncidentIds : [];
    const requiredSections = Array.isArray(item.requiredSections) ? item.requiredSections : [];
    const published = isLaunchCommandBriefPublished(item);
    const blocked = isLaunchCommandBriefBlocked(item);
    const acknowledgementByTarget = new Map(
      (Array.isArray(item.acknowledgements) ? item.acknowledgements : [])
        .filter((entry) => entry && typeof entry === "object" && audience.includes(String(entry.target || "")))
        .map((entry) => [String(entry.target || ""), { ...entry, status: String(entry.status || "").toLowerCase() }])
    );
    const acknowledgements = Array.from(acknowledgementByTarget.values());
    const acknowledgedTargets = published ? audience.filter((target) => acknowledgementByTarget.get(target)?.status === "acknowledged") : [];
    const escalatedTargets = published ? audience.filter((target) => acknowledgementByTarget.get(target)?.status === "escalated") : [];
    const pendingAcknowledgementTargets = published ? audience.filter((target) => !acknowledgementByTarget.has(target) || acknowledgementByTarget.get(target)?.status !== "acknowledged") : [];
    const briefReady = Boolean(item.briefWindow && item.phase && item.owner && item.recorder && item.publishChannel && item.publishTarget && item.decisionOwner && audience.length && sourceBoards.length >= 2 && linkedDutyShiftIds.length && linkedObservationIds.length && linkedIncidentIds.length && requiredSections.length >= 3 && !blocked);
    return {
      ...item,
      audience,
      sourceBoards,
      linkedDutyShiftIds,
      linkedObservationIds,
      linkedIncidentIds,
      requiredSections,
      acknowledgements,
      acknowledgedTargets,
      escalatedTargets,
      pendingAcknowledgementTargets,
      expectedAcknowledgementCount: published ? audience.length : 0,
      acknowledgedRecipientCount: acknowledgedTargets.length,
      escalatedRecipientCount: escalatedTargets.length,
      pendingAcknowledgementCount: pendingAcknowledgementTargets.length,
      published,
      blocked,
      briefReady,
      pending: !published
    };
  });
  const readyBriefs = rows.filter((item) => item.briefReady).length;
  const blockedBriefs = rows.filter((item) => item.blocked).length;
  const publishedBriefs = rows.filter((item) => item.published).length;
  const status = rows.length > 0 && readyBriefs === rows.length && blockedBriefs === 0 ? "briefing-ready" : blockedBriefs > 0 ? "briefing-watch" : "blocked";
  return {
    id: "public-health-launch-command-brief-board",
    status,
    briefingReady: status === "briefing-ready",
    summary: {
      briefs: rows.length,
      readyBriefs,
      pendingBriefs: Math.max(rows.length - publishedBriefs, 0),
      publishedBriefs,
      blockedBriefs,
      expectedAcknowledgements: rows.reduce((sum, item) => sum + item.expectedAcknowledgementCount, 0),
      acknowledgedRecipients: rows.reduce((sum, item) => sum + item.acknowledgedRecipientCount, 0),
      pendingAcknowledgements: rows.reduce((sum, item) => sum + item.pendingAcknowledgementCount, 0),
      escalatedAcknowledgements: rows.reduce((sum, item) => sum + item.escalatedRecipientCount, 0),
      deliveryCompleteBriefs: rows.filter((item) => item.published && item.pendingAcknowledgementCount === 0).length,
      audiences: new Set(rows.flatMap((item) => item.audience || [])).size,
      sourceBoards: new Set(rows.flatMap((item) => item.sourceBoards || [])).size,
      linkedDutyShifts: new Set(rows.flatMap((item) => item.linkedDutyShiftIds || [])).size,
      linkedObservations: new Set(rows.flatMap((item) => item.linkedObservationIds || [])).size,
      linkedIncidents: new Set(rows.flatMap((item) => item.linkedIncidentIds || [])).size,
      requiredSections: rows.reduce((sum, item) => sum + item.requiredSections.length, 0),
      launchGateStatus: options.launchGate?.status || "unknown",
      launchReleaseGate: options.launchGate?.releaseGate || "unknown"
    },
    briefs: rows,
    nextActions: rows.filter((item) => !item.briefReady || item.blocked || item.pendingAcknowledgementCount > 0).map((item) => ({
      id: item.id,
      phase: item.phase || "",
      briefWindow: item.briefWindow || "",
      owner: item.owner || "",
      pendingAcknowledgementTargets: item.pendingAcknowledgementTargets || [],
      nextAction: item.published && item.pendingAcknowledgementCount > 0
        ? "Record delivery receipts for every configured audience or escalate the missing receipt."
        : item.nextAction || ""
    }))
  };
}

function isCutoverDrillFindingClosed(item) {
  return /closed|resolved|passed|complete|signed|verified/i.test(`${item?.status || ""} ${item?.retestStatus || ""}`);
}

function isCutoverDrillPassed(item) {
  const text = `${item?.status || ""} ${item?.goNoGo || ""} ${item?.retestStatus || ""}`;
  return /passed|go|approved|signed|complete/i.test(text) && !/no-go|blocked|failed|retest-required|pending/i.test(text);
}

function buildStaticCutoverDrillBoard(drills = [], options = {}) {
  const rows = (Array.isArray(drills) ? drills : []).map((item) => {
    const findings = Array.isArray(item.findings) ? item.findings : [];
    const blockers = Array.isArray(item.blockers) ? item.blockers : [];
    const linkedBlockerIds = Array.isArray(item.linkedBlockerIds) ? item.linkedBlockerIds : [];
    const linkedAcceptanceIds = Array.isArray(item.linkedAcceptanceIds) ? item.linkedAcceptanceIds : [];
    const openFindings = findings.filter((finding) => !isCutoverDrillFindingClosed(finding));
    const noGo = /no-go|blocked|failed/i.test(`${item.status || ""} ${item.goNoGo || ""}`);
    const retestRequired = /retest|pending/i.test(`${item.status || ""} ${item.retestStatus || ""}`);
    const passed = isCutoverDrillPassed(item) && openFindings.length === 0 && blockers.length === 0;
    const blocked = !passed && (noGo || blockers.length > 0 || openFindings.some((finding) => /P0|critical/i.test(String(finding.severity || ""))));
    return { ...item, findings, blockers, linkedBlockerIds, linkedAcceptanceIds, openFindings, openFindingCount: openFindings.length, passed, blocked, retestRequired };
  });
  const linkedBlockers = new Set(rows.flatMap((item) => item.linkedBlockerIds || []));
  const linkedAcceptances = new Set(rows.flatMap((item) => item.linkedAcceptanceIds || []));
  const summary = {
    drills: rows.length,
    passedDrills: rows.filter((item) => item.passed).length,
    blockedDrills: rows.filter((item) => item.blocked).length,
    retestRequired: rows.filter((item) => item.retestRequired).length,
    openFindings: rows.reduce((sum, item) => sum + item.openFindingCount, 0),
    goNoGoNo: rows.filter((item) => /no-go/i.test(String(item.goNoGo || ""))).length,
    goNoGoConditional: rows.filter((item) => /conditional/i.test(String(item.goNoGo || ""))).length,
    linkedBlockers: linkedBlockers.size,
    linkedAcceptances: linkedAcceptances.size,
    launchReleaseGate: options.launchGate?.releaseGate || "site-evidence-required",
    evidencePacketsMissingItems: options.cutoverEvidenceBoard?.summary?.missingItems || 0
  };
  return {
    id: "public-health-cutover-drill-board",
    status: summary.blockedDrills > 0 || options.launchGate?.productionReady === false ? "blocked" : summary.retestRequired > 0 ? "retest-required" : "passed",
    summary,
    drills: rows
  };
}

function buildStaticCutoverEvidencePackets(blockers) {
  return (Array.isArray(blockers) ? blockers : []).map((item) => ({
    id: `phcep-${String(item.id || "").replace(/^phcb-/, "")}`,
    blockerId: item.id,
    category: item.category,
    name: `${item.name || ""}证据包`,
    severity: item.severity,
    owner: item.owner,
    assignee: item.assignee || item.owner,
    status: "pending-site-evidence",
    signoffStatus: "pending",
    dueAt: item.dueAt || "",
    siteWindow: item.siteWindow || "",
    reminderChannel: item.reminderChannel || "",
    requiredItems: (item.requiredEvidence || []).map((name, index) => ({
      id: `${item.id}-e${index + 1}`,
      name,
      required: true,
      status: "pending",
      artifactName: "",
      attachmentNames: []
    })),
    evidenceRecords: []
  }));
}

function buildStaticSiteEvidenceBridge(siteLaunchEvidence = []) {
  const evidenceRows = Array.isArray(siteLaunchEvidence) ? siteLaunchEvidence : [];
  const verifiedByTemplate = new Map();
  evidenceRows
    .filter((item) => String(item.status || "").toLowerCase() === "verified")
    .sort((a, b) => String(b.verifiedAt || b.submittedAt || "").localeCompare(String(a.verifiedAt || a.submittedAt || "")))
    .forEach((item) => {
      if (!verifiedByTemplate.has(item.templateId)) verifiedByTemplate.set(item.templateId, item);
    });
  const links = PUBLIC_HEALTH_SITE_EVIDENCE_LINKS.map((link) => {
    const evidence = verifiedByTemplate.get(link.templateId) || null;
    return {
      ...link,
      status: evidence ? "verified" : "missing-site-evidence",
      verified: Boolean(evidence),
      evidenceId: evidence?.id || "",
      artifactName: evidence?.artifactName || "",
      jointTestNo: evidence?.jointTestNo || "",
      verifiedAt: evidence?.verifiedAt || "",
      verifiedBy: evidence?.verifiedBy || "",
      attachmentNames: Array.isArray(evidence?.attachmentNames) ? evidence.attachmentNames : []
    };
  });
  const verifiedLinks = links.filter((item) => item.verified);
  return {
    status: verifiedLinks.length === links.length && links.length > 0 ? "verified" : verifiedLinks.length > 0 ? "partial" : "missing-site-evidence",
    summary: {
      links: links.length,
      verifiedLinks: verifiedLinks.length,
      missingLinks: Math.max(links.length - verifiedLinks.length, 0),
      linkedPackets: new Set(links.map((item) => item.packetId).filter(Boolean)).size,
      linkedItems: links.reduce((sum, item) => sum + (Array.isArray(item.itemIds) ? item.itemIds.length : 0), 0),
      verifiedItems: verifiedLinks.reduce((sum, item) => sum + (Array.isArray(item.itemIds) ? item.itemIds.length : 0), 0),
      siteEvidenceRows: evidenceRows.length,
      verifiedSiteEvidenceRows: evidenceRows.filter((item) => String(item.status || "").toLowerCase() === "verified").length
    },
    links,
    missingLinks: links.filter((item) => !item.verified),
    verifiedLinks
  };
}

function buildStaticSiteEvidenceVerificationTasks() {
  return PUBLIC_HEALTH_SITE_EVIDENCE_LINKS.map((link, index) => ({
    id: `phsevt-${link.id.replace(/^ph-sle-/, "")}`,
    sequence: index + 1,
    linkId: link.id,
    templateId: link.templateId,
    packetId: link.packetId,
    name: `Site evidence verification: ${link.requirement}`,
    owner: /security|backup/.test(link.id) ? "security and operations team" : /his|emr|lis/.test(link.id) ? "hospital interface team" : "site implementation owner",
    reviewerRole: "commission",
    status: "scheduled",
    priority: /security|backup|direct-report|immunization/.test(link.id) ? "P0" : "P1",
    verificationWindow: "T-3d to T-1h",
    requiredChecks: ["site evidence recorded", "joint-test receipt or signed artifact", "commission verification"],
    escalationPath: ["site implementation owner", "release manager", "health commission launch board"],
    nextAction: "Record the site evidence first, then verify this task against the matching evidence ID."
  }));
}

function buildStaticSiteEvidenceVerificationBoard(tasks = [], options = {}) {
  const bridgeLinks = Array.isArray(options.siteEvidenceBridge?.links) ? options.siteEvidenceBridge.links : [];
  const bridgeById = new Map(bridgeLinks.map((item) => [item.id, item]));
  const rows = (Array.isArray(tasks) ? tasks : []).map((task) => {
    const bridgeLink = bridgeById.get(task.linkId) || null;
    const bridgeEvidenceId = bridgeLink?.evidenceId || "";
    const evidenceAvailable = Boolean(bridgeLink?.verified && bridgeEvidenceId);
    const blocked = /rejected|escalated|blocked/i.test(String(task.status || ""));
    const verified = String(task.status || "").toLowerCase() === "verified"
      && evidenceAvailable
      && String(task.evidenceId || "") === bridgeEvidenceId;
    const requiredChecks = Array.isArray(task.requiredChecks) ? task.requiredChecks : [];
    const escalationPath = Array.isArray(task.escalationPath) ? task.escalationPath : [];
    const structurallyReady = Boolean(task.linkId && task.templateId && task.packetId && task.owner && task.reviewerRole && task.verificationWindow && requiredChecks.length >= 3 && escalationPath.length >= 2 && bridgeLink);
    return { ...task, bridgeLink, bridgeEvidenceId, evidenceAvailable, blocked, verified, requiredChecks, escalationPath, structurallyReady, pending: !verified && !blocked };
  });
  const verifiedTasks = rows.filter((item) => item.verified);
  const blockedTasks = rows.filter((item) => item.blocked);
  const evidenceAvailableTasks = rows.filter((item) => item.evidenceAvailable);
  const structurallyReadyTasks = rows.filter((item) => item.structurallyReady);
  const status = rows.length > 0 && verifiedTasks.length === rows.length && blockedTasks.length === 0
    ? "verified"
    : blockedTasks.length > 0
      ? "blocked"
      : evidenceAvailableTasks.length === 0
        ? "evidence-pending"
        : "verification-pending";
  return {
    id: "public-health-site-evidence-verification-board",
    status,
    summary: {
      tasks: rows.length,
      structurallyReadyTasks: structurallyReadyTasks.length,
      evidenceAvailableTasks: evidenceAvailableTasks.length,
      verifiedTasks: verifiedTasks.length,
      pendingTasks: rows.filter((item) => item.pending).length,
      blockedTasks: blockedTasks.length,
      p0Tasks: rows.filter((item) => item.priority === "P0").length,
      missingEvidenceTasks: Math.max(rows.length - evidenceAvailableTasks.length, 0),
      escalationPaths: new Set(rows.flatMap((item) => item.escalationPath || [])).size
    },
    tasks: rows
  };
}

function buildStaticStandardImplementationLedger(standards = []) {
  return (Array.isArray(standards) ? standards : []).map((domain) => ({
    id: `phsil-${String(domain.id || "").replace(/^ph-/, "")}`,
    standardDomainId: domain.id,
    order: domain.order,
    name: domain.name,
    category: domain.category,
    owner: domain.owner,
    secondaryCount: domain.secondaryCount,
    tertiaryCount: domain.tertiaryCount,
    tertiaryRange: domain.tertiaryRange || "",
    dataCollections: domain.dataCollections || [],
    interfaces: domain.interfaces || [],
    requiredChecks: ["责任方确认", "数据集合映射", "接口映射", "现场验收证据"],
    status: "modeled",
    gapStatus: "not-assessed",
    siteEvidenceId: "",
    nextAction: "与责任机构复核标准映射；现场验收仍须按独立流程签署。"
  }));
}

function buildStaticStandardImplementationEvidenceCandidates(siteLaunchEvidence = []) {
  return (Array.isArray(siteLaunchEvidence) ? siteLaunchEvidence : [])
    .filter((item) => String(item.status || "").toLowerCase() === "verified")
    .map((item) => ({
      id: item.id,
      templateId: item.templateId || "",
      artifactName: item.artifactName || item.id,
      verifiedAt: item.verifiedAt || item.updatedAt || ""
    }));
}

function buildStaticStandardImplementationBoard(ledger = [], standards = [], options = {}) {
  const standardById = new Map((Array.isArray(standards) ? standards : []).map((item) => [item.id, item]));
  const reference = new Date(options.now || Date.now());
  const referenceDay = Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), reference.getUTCDate());
  const entries = (Array.isArray(ledger) ? ledger : []).map((item) => {
    const dataCollections = Array.isArray(item.dataCollections) ? item.dataCollections : [];
    const interfaces = Array.isArray(item.interfaces) ? item.interfaces : [];
    const requiredChecks = Array.isArray(item.requiredChecks) ? item.requiredChecks : [];
    const status = String(item.status || "modeled").toLowerCase();
    const gapStatus = String(item.gapStatus || "").toLowerCase();
    const remediationStatus = String(item.remediationStatus || "not-planned").toLowerCase();
    const gapRecorded = !["verified", "resolved"].includes(gapStatus) && (status === "gap-recorded" || /open|gap|blocked|escalated|assigned|in-progress|evidence-submitted/i.test(gapStatus));
    const dueAt = String(item.remediationDueAt || "");
    const dueDay = /^\d{4}-\d{2}-\d{2}$/.test(dueAt) ? Date.parse(`${dueAt}T00:00:00Z`) : Number.NaN;
    const remediationDueInDays = gapRecorded && Number.isFinite(dueDay) ? Math.round((dueDay - referenceDay) / 86400000) : null;
    const remediationOverdue = Number.isFinite(remediationDueInDays) && remediationDueInDays < 0;
    const remediationDueSoon = Number.isFinite(remediationDueInDays) && remediationDueInDays >= 0 && remediationDueInDays <= 7;
    const remediationUnassigned = gapRecorded && !["assigned", "verified"].includes(remediationStatus);
    return {
      ...item,
      dataCollections,
      interfaces,
      requiredChecks,
      mappingComplete: Boolean(standardById.get(item.standardDomainId) && item.owner && item.tertiaryRange && dataCollections.length && interfaces.length && requiredChecks.length >= 4),
      reviewed: status === "reviewed",
      gapRecorded,
      remediationStatus,
      remediationAssigned: remediationStatus === "assigned",
      remediationVerified: remediationStatus === "verified",
      remediationDueInDays,
      remediationOverdue,
      remediationDueSoon,
      remediationUnassigned,
      evidenceLinked: Boolean(item.siteEvidenceId),
      pendingReview: status !== "reviewed" && !gapRecorded
    };
  });
  const mappingComplete = entries.filter((item) => item.mappingComplete);
  const reviewed = entries.filter((item) => item.reviewed);
  const gaps = entries.filter((item) => item.gapRecorded);
  const evidenceLinked = entries.filter((item) => item.evidenceLinked);
  return {
    id: "public-health-standard-implementation-board",
    status: entries.some((item) => item.remediationOverdue) ? "remediation-overdue" : gaps.length ? "gap-review-required" : reviewed.length === entries.length && entries.length ? "reviewed" : "mapping-review-pending",
    traceabilityReady: entries.length > 0 && mappingComplete.length === entries.length,
    summary: {
      domains: entries.length,
      mappingComplete: mappingComplete.length,
      reviewed: reviewed.length,
      gaps: gaps.length,
      assignedRemediations: entries.filter((item) => item.remediationAssigned).length,
      verifiedRemediations: entries.filter((item) => item.remediationVerified).length,
      unassignedRemediations: entries.filter((item) => item.remediationUnassigned).length,
      dueSoonRemediations: entries.filter((item) => item.remediationDueSoon).length,
      overdueRemediations: entries.filter((item) => item.remediationOverdue).length,
      pendingReviews: entries.filter((item) => item.pendingReview).length,
      evidenceLinked: evidenceLinked.length,
      requiredChecks: entries.reduce((sum, item) => sum + item.requiredChecks.length, 0)
    },
    entries
  };
}

function buildStaticLaunchApprovals() {
  return [
    { id: "phla-health-admin", role: "health-admin", owner: "市卫健委规划信息处", approver: "卫健委上线审批人", status: "pending", decision: "pending", dueAt: "2026-07-24" },
    { id: "phla-cdc", role: "cdc", owner: "市疾控中心应急办", approver: "疾控业务负责人", status: "pending", decision: "pending", dueAt: "2026-07-24" },
    { id: "phla-hospital", role: "hospital", owner: "医院信息/院感/检验联络员", approver: "医院接口负责人", status: "pending", decision: "pending", dueAt: "2026-07-24" },
    { id: "phla-security", role: "security", owner: "安全管理岗", approver: "安全合规负责人", status: "pending", decision: "pending", dueAt: "2026-07-24" },
    { id: "phla-operations", role: "operations", owner: "运维保障组", approver: "运维值班长", status: "pending", decision: "pending", dueAt: "2026-07-24" },
    { id: "phla-project-office", role: "project-office", owner: "项目办/发布经理", approver: "项目发布经理", status: "pending", decision: "pending", dueAt: "2026-07-24" }
  ];
}

function staticLaunchRequirement(id, name, passed, nextAction) {
  return { id, name, passed: Boolean(passed), status: passed ? "passed" : "blocked", nextAction };
}

function buildStaticExchangeExceptionBoard(exchangeRuns = [], options = {}) {
  const reference = options.now ? new Date(options.now) : new Date();
  const referenceDay = Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), reference.getUTCDate());
  const entries = (Array.isArray(exchangeRuns) ? exchangeRuns : [])
    .filter((item) => Number(item.failedRecords || 0) > 0)
    .map((item) => {
      const compensationText = `${item.exceptionStatus || ""} ${item.compensationStatus || ""} ${item.receiptStatus || ""} ${item.status || ""}`.toLowerCase();
      const exceptionStatus = String(item.exceptionStatus || (
        /resolved|replayed|accepted-after-retry/.test(compensationText)
          ? "resolved"
          : /escalated|rollback/.test(compensationText)
            ? "escalated"
            : /assigned/.test(compensationText)
              ? "assigned"
              : "open"
      )).trim();
      const exceptionOpen = !["resolved", "closed"].includes(exceptionStatus.toLowerCase());
      const exceptionDueAt = String(item.exceptionDueAt || "").trim();
      const dueTime = /^\d{4}-\d{2}-\d{2}$/.test(exceptionDueAt) ? Date.parse(`${exceptionDueAt}T00:00:00Z`) : Number.NaN;
      const exceptionDueInDays = Number.isFinite(dueTime) ? Math.round((dueTime - referenceDay) / 86400000) : null;
      return {
        ...item,
        exceptionStatus,
        exceptionOwner: String(item.exceptionOwner || "").trim(),
        exceptionDueAt,
        exceptionDueInDays,
        exceptionOpen,
        exceptionUnassigned: exceptionOpen && !String(item.exceptionOwner || "").trim(),
        exceptionDueSoon: exceptionOpen && Number.isFinite(exceptionDueInDays) && exceptionDueInDays >= 0 && exceptionDueInDays <= 7,
        exceptionOverdue: exceptionOpen && Number.isFinite(exceptionDueInDays) && exceptionDueInDays < 0
      };
    })
    .sort((a, b) => Number(b.exceptionOverdue) - Number(a.exceptionOverdue) || Number(b.exceptionOpen) - Number(a.exceptionOpen) || String(a.category || "").localeCompare(String(b.category || "")));
  const openEntries = entries.filter((item) => item.exceptionOpen);
  return {
    status: entries.some((item) => item.exceptionOverdue) ? "exchange-exception-overdue" : openEntries.length ? "exchange-exception-open" : entries.length ? "exchange-exceptions-resolved" : "exchange-exception-clear",
    entries,
    summary: {
      exceptions: entries.length,
      openExceptions: openEntries.length,
      resolvedExceptions: entries.filter((item) => !item.exceptionOpen).length,
      unassignedExceptions: entries.filter((item) => item.exceptionUnassigned).length,
      dueSoonExceptions: entries.filter((item) => item.exceptionDueSoon).length,
      overdueExceptions: entries.filter((item) => item.exceptionOverdue).length
    }
  };
}

function buildStaticLaunchGate(options = {}) {
  const standard = options.standardCoverage || {};
  const events = Array.isArray(options.events) ? options.events : [];
  const exchangeTasks = Array.isArray(options.exchangeTasks) ? options.exchangeTasks : [];
  const exchangeRuns = Array.isArray(options.exchangeRuns) ? options.exchangeRuns : [];
  const exchangeExceptionBoard = options.exchangeExceptionBoard || buildStaticExchangeExceptionBoard(exchangeRuns);
  const institutionTasks = Array.isArray(options.institutionTasks) ? options.institutionTasks : [];
  const onsiteAcceptances = Array.isArray(options.onsiteAcceptances) ? options.onsiteAcceptances : [];
  const cutoverReadiness = options.cutoverReadiness || {};
  const cutoverEvidenceBoard = options.cutoverEvidenceBoard || {};
  const productionHandoffBoard = options.productionHandoffBoard || buildStaticProductionHandoffBoard(options.productionHandoffs || []);
  const goLiveObservationBoard = options.goLiveObservationBoard || buildStaticGoLiveObservationBoard(options.goLiveObservations || []);
  const launchIncidentBoard = options.launchIncidentBoard || buildStaticLaunchIncidentBoard(options.launchIncidents || []);
  const launchDutyBoard = options.launchDutyBoard || buildStaticLaunchDutyBoard(options.launchDutyShifts || []);
  const launchCommandBriefBoard = options.launchCommandBriefBoard || buildStaticLaunchCommandBriefBoard(options.launchCommandBriefs || []);
  const siteEvidenceVerificationBoard = options.siteEvidenceVerificationBoard || buildStaticSiteEvidenceVerificationBoard(options.siteEvidenceVerificationTasks || [], { siteEvidenceBridge: options.siteEvidenceBridge || {} });
  const launchApprovals = Array.isArray(options.launchApprovals) ? options.launchApprovals : buildStaticLaunchApprovals();
  const exchangeRunTaskIds = new Set(exchangeRuns.map((item) => item.taskId));
  const requirements = [
    staticLaunchRequirement("launch-standard-matrix", "21/125/421 standard matrix", standard.total?.domains === 21 && standard.total?.secondary === 125 && standard.total?.tertiary === 421, "Maintain source-derived standard coverage."),
    staticLaunchRequirement("launch-event-loop", "Public health event command loop", events.length >= 6 && events.every((item) => item.commandAction && item.followupAction), "Close or assign high-priority events."),
    staticLaunchRequirement("launch-exchange-receipts", "Six exchange categories with receipts", exchangeTasks.length >= 6 && exchangeTasks.every((item) => exchangeRunTaskIds.has(item.id)) && exchangeExceptionBoard.summary.openExceptions === 0, "Archive exchange receipts and close every exchange exception."),
    staticLaunchRequirement("launch-institution-handoff", "Seven institution handoff confirmations", institutionTasks.length >= 7 && institutionTasks.every((item) => Number(item.openItems || 0) === 0), "Confirm all institution handoffs."),
    staticLaunchRequirement("launch-onsite-signoff", "On-site acceptance signatures", onsiteAcceptances.length >= 6 && onsiteAcceptances.every((item) => /signed|passed|complete|已签署|已通过|已完成/i.test(`${item.status || ""} ${item.signoffStatus || ""}`)), "Collect signed site acceptance pages."),
    staticLaunchRequirement("launch-cutover-evidence", "Cutover evidence packet completion", cutoverEvidenceBoard.summary?.requiredItems >= 20 && cutoverEvidenceBoard.summary?.missingItems === 0, "Verify all cutover evidence packet items."),
    staticLaunchRequirement("launch-cutover-blockers", "No open production blockers", cutoverReadiness.releaseGate === "production-ready" && cutoverReadiness.summary?.open === 0, "Resolve all P0/P1 production blockers."),
    staticLaunchRequirement("launch-production-handoffs", "Production handoff packs accepted", productionHandoffBoard.summary?.handoffs >= 6 && productionHandoffBoard.summary?.pendingHandoffs === 0 && productionHandoffBoard.summary?.missingSignoffs === 0 && productionHandoffBoard.summary?.blockedHandoffs === 0, "Accept every production handoff pack."),
    staticLaunchRequirement("launch-go-live-observation", "Launch-day observation and rollback watch plan", goLiveObservationBoard.summary?.observations >= 6 && goLiveObservationBoard.summary?.planReady === goLiveObservationBoard.summary?.observations && goLiveObservationBoard.summary?.rollbackPlans === goLiveObservationBoard.summary?.observations && goLiveObservationBoard.summary?.openCriticalSignals === 0, "Keep launch-day observation windows, thresholds and rollback owners ready."),
    staticLaunchRequirement("launch-incident-desk", "Launch-day incident triage and rollback decision desk", launchIncidentBoard.summary?.lanes >= 6 && launchIncidentBoard.summary?.deskReady === launchIncidentBoard.summary?.lanes && launchIncidentBoard.summary?.rollbackDecisionOwners >= 4 && launchIncidentBoard.summary?.criticalOpenTickets === 0, "Keep incident lanes, SLA, escalation paths and rollback decision owners ready."),
    staticLaunchRequirement("launch-duty-handoffs", "Launch-day duty roster and command handoff desk", launchDutyBoard.summary?.shifts >= 6 && launchDutyBoard.summary?.readyShifts === launchDutyBoard.summary?.shifts && launchDutyBoard.summary?.backupContacts === launchDutyBoard.summary?.shifts && launchDutyBoard.summary?.missedHandoffs === 0, "Keep launch-day duty windows, primary and backup contacts, contact channels and escalation owners ready."),
    staticLaunchRequirement("launch-command-briefs", "Launch command briefs and status broadcast desk", launchCommandBriefBoard.summary?.briefs >= 5 && launchCommandBriefBoard.summary?.readyBriefs === launchCommandBriefBoard.summary?.briefs && launchCommandBriefBoard.summary?.sourceBoards >= 4 && launchCommandBriefBoard.summary?.blockedBriefs === 0, "Keep launch command briefs ready without bypassing site evidence gates."),
    staticLaunchRequirement("launch-site-evidence-verification", "Site evidence verification task desk", siteEvidenceVerificationBoard.summary?.tasks >= 9 && siteEvidenceVerificationBoard.summary?.verifiedTasks === siteEvidenceVerificationBoard.summary?.tasks && siteEvidenceVerificationBoard.summary?.blockedTasks === 0, "Verify every site-evidence task against the matching signed evidence ID."),
    staticLaunchRequirement("launch-multi-party-approval", "Multi-party launch approvals", launchApprovals.length >= 6 && launchApprovals.every(isLaunchApprovalSigned), "Collect all launch approvals.")
  ];
  const approvalPrerequisites = requirements.filter((item) => item.id !== "launch-multi-party-approval");
  const blockedApprovalPrerequisites = approvalPrerequisites.filter((item) => !item.passed);
  const approvalPreflight = {
    id: "public-health-launch-approval-preflight",
    status: blockedApprovalPrerequisites.length === 0 ? "eligible" : "blocked",
    eligible: blockedApprovalPrerequisites.length === 0,
    prerequisiteRequirements: approvalPrerequisites.length,
    passedPrerequisites: approvalPrerequisites.length - blockedApprovalPrerequisites.length,
    blockedPrerequisites: blockedApprovalPrerequisites.length,
    blockedRequirementIds: blockedApprovalPrerequisites.map((item) => item.id),
    blockedRequirements: blockedApprovalPrerequisites.map((item) => ({ id: item.id, name: item.name, nextAction: item.nextAction })),
    nextAction: blockedApprovalPrerequisites.length === 0
      ? "Collect the six independent final launch approvals with signed artifacts."
      : "Resolve every non-approval launch requirement before recording a final approval."
  };
  const approvalRows = launchApprovals.map((item) => ({
    ...item,
    approvalEligible: approvalPreflight.eligible,
    blockedRequirementIds: approvalPreflight.blockedRequirementIds,
    blockedPrerequisites: approvalPreflight.blockedRequirements
  }));
  const blocked = requirements.filter((item) => !item.passed);
  const signedApprovals = approvalRows.filter(isLaunchApprovalSigned).length;
  return {
    id: "public-health-production-launch",
    status: blocked.length ? "blocked" : "production-ready",
    releaseGate: blocked.length ? "site-evidence-required" : "production-ready",
    productionReady: blocked.length === 0,
    summary: {
      requirements: requirements.length,
      passedRequirements: requirements.length - blocked.length,
      blockedRequirements: blocked.length,
      approvals: approvalRows.length,
      signedApprovals,
      pendingApprovals: Math.max(approvalRows.length - signedApprovals, 0),
      approvalPreflightStatus: approvalPreflight.status,
      approvalPrerequisiteRequirements: approvalPreflight.prerequisiteRequirements,
      approvalPassedPrerequisites: approvalPreflight.passedPrerequisites,
      approvalBlockedPrerequisites: approvalPreflight.blockedPrerequisites,
      cutoverMissingItems: cutoverEvidenceBoard.summary?.missingItems || 0,
      openBlockers: cutoverReadiness.summary?.open || 0,
      p0Open: cutoverReadiness.summary?.p0Open || 0,
      handoffs: productionHandoffBoard.summary?.handoffs || 0,
      pendingHandoffs: productionHandoffBoard.summary?.pendingHandoffs || 0,
      missingHandoffSignoffs: productionHandoffBoard.summary?.missingSignoffs || 0,
      goLiveObservations: goLiveObservationBoard.summary?.observations || 0,
      goLiveObservationPlanReady: goLiveObservationBoard.summary?.planReady || 0,
      goLiveOpenCriticalSignals: goLiveObservationBoard.summary?.openCriticalSignals || 0,
      launchIncidentLanes: launchIncidentBoard.summary?.lanes || 0,
      launchIncidentDeskReady: launchIncidentBoard.summary?.deskReady || 0,
      launchIncidentCriticalOpen: launchIncidentBoard.summary?.criticalOpenTickets || 0,
      launchDutyShifts: launchDutyBoard.summary?.shifts || 0,
      launchDutyReadyShifts: launchDutyBoard.summary?.readyShifts || 0,
      launchDutyMissedHandoffs: launchDutyBoard.summary?.missedHandoffs || 0,
      launchCommandBriefs: launchCommandBriefBoard.summary?.briefs || 0,
      launchCommandReadyBriefs: launchCommandBriefBoard.summary?.readyBriefs || 0,
      launchCommandPendingBriefs: launchCommandBriefBoard.summary?.pendingBriefs || 0,
      launchCommandBlockedBriefs: launchCommandBriefBoard.summary?.blockedBriefs || 0
    },
    requirements,
    approvals: approvalRows,
    approvalPreflight,
    nextActions: blocked.map((item) => ({ id: item.id, name: item.name, status: item.status, nextAction: item.nextAction }))
  };
}

function summarizeCutoverEvidencePackets(packets) {
  const rows = (Array.isArray(packets) ? packets : []).map((packet) => {
    const requiredItems = Array.isArray(packet.requiredItems) ? packet.requiredItems : [];
    const recordedCount = requiredItems.filter(isEvidenceItemRecorded).length;
    const verifiedCount = requiredItems.filter(isEvidenceItemVerified).length;
    return {
      ...packet,
      requiredCount: requiredItems.length,
      recordedCount,
      verifiedCount,
      missingCount: Math.max(requiredItems.length - verifiedCount, 0),
      complete: requiredItems.length > 0 && verifiedCount === requiredItems.length
    };
  });
  const requiredItems = rows.reduce((sum, item) => sum + item.requiredCount, 0);
  const recordedItems = rows.reduce((sum, item) => sum + item.recordedCount, 0);
  const verifiedItems = rows.reduce((sum, item) => sum + item.verifiedCount, 0);
  const completePackets = rows.filter((item) => item.complete).length;
  return {
    status: completePackets === rows.length && rows.length > 0 ? "verified" : recordedItems > 0 ? "in-progress" : "pending-site-evidence",
    summary: {
      packets: rows.length,
      requiredItems,
      recordedItems,
      verifiedItems,
      missingItems: Math.max(requiredItems - verifiedItems, 0),
      completePackets,
      p0Packets: rows.filter((item) => String(item.severity || "").includes("P0")).length,
      p0CompletePackets: rows.filter((item) => String(item.severity || "").includes("P0") && item.complete).length
    },
    packets: rows,
    missingItems: rows.flatMap((packet) => (packet.requiredItems || []).filter((item) => !isEvidenceItemVerified(item)))
  };
}

function buildStaticCutoverReadiness(blockers, evidencePackets = []) {
  const evidenceBoard = summarizeCutoverEvidencePackets(evidencePackets);
  const rows = (Array.isArray(blockers) ? blockers : []).map((item) => {
    const closed = isCutoverClosed(item);
    const daysRemaining = daysUntil(item.dueAt);
    return {
      ...item,
      closed,
      evidenceRecorded: isCutoverEvidenceRecorded(item),
      daysRemaining,
      dueSoon: !closed && daysRemaining !== null && daysRemaining >= 0 && daysRemaining <= 7,
      overdue: !closed && daysRemaining !== null && daysRemaining < 0
    };
  });
  const open = rows.filter((item) => !item.closed);
  const p0Open = open.filter((item) => String(item.severity || "").includes("P0")).length;
  const readinessLevel = p0Open > 0 ? "blocked" : open.length > 0 ? "conditional" : "ready";
  const nextActions = open
    .slice()
    .sort((a, b) => (
      (String(a.severity || "").includes("P0") ? 0 : 1) - (String(b.severity || "").includes("P0") ? 0 : 1) ||
      Number(a.daysRemaining ?? 9999) - Number(b.daysRemaining ?? 9999) ||
      String(a.id || "").localeCompare(String(b.id || ""))
    ))
    .map((item) => ({
      id: item.id,
      category: item.category,
      name: item.name,
      severity: item.severity,
      owner: item.owner,
      assignee: item.assignee || item.owner,
      dueAt: item.dueAt || "",
      daysRemaining: item.daysRemaining,
      siteWindow: item.siteWindow || "",
      reminderChannel: item.reminderChannel || "",
      remediationStatus: item.remediationStatus || item.status || "",
      escalationLevel: item.escalationLevel || "",
      resolutionAction: item.resolutionAction || item.nextAction || ""
    }));
  return {
    readinessLevel,
    releaseGate: readinessLevel === "ready" ? "production-ready" : "site-evidence-required",
    summary: {
      total: rows.length,
      open: open.length,
      closed: rows.filter((item) => item.closed).length,
      evidenceRecorded: rows.filter((item) => item.evidenceRecorded).length,
      p0Open,
      p1Open: open.filter((item) => String(item.severity || "").includes("P1")).length,
      dueSoon: rows.filter((item) => item.dueSoon).length,
      overdue: rows.filter((item) => item.overdue).length,
      red: open.filter((item) => /red/i.test(String(item.escalationLevel || ""))).length,
      amber: open.filter((item) => /amber/i.test(String(item.escalationLevel || ""))).length
    },
    evidence: evidenceBoard.summary,
    categories: [],
    nextActions
  };
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}
