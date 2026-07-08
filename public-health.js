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

document.addEventListener("DOMContentLoaded", async () => {
  const system = await loadPublicHealthSystem();
  renderPublicHealthSystem(system);
});

document.addEventListener("click", handlePublicHealthEventAction);
document.addEventListener("click", handlePublicHealthExchangeRun);
document.addEventListener("click", handlePublicHealthInstitutionTaskAction);
document.addEventListener("click", handlePublicHealthOnsiteAcceptanceAction);

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

function buildStaticPublicHealthSystem(state) {
  const standards = Array.isArray(state.publicHealthStandards) && state.publicHealthStandards.length
    ? state.publicHealthStandards
    : FALLBACK_STANDARD_DOMAINS;
  const institutionScopes = Array.isArray(state.publicHealthInstitutionScopes) ? state.publicHealthInstitutionScopes : [];
  const events = Array.isArray(state.publicHealthEvents) ? state.publicHealthEvents : [];
  const exchangeTasks = Array.isArray(state.publicHealthExchangeTasks) ? state.publicHealthExchangeTasks : [];
  const exchangeRuns = Array.isArray(state.publicHealthExchangeRuns) ? state.publicHealthExchangeRuns : [];
  const institutionTasks = Array.isArray(state.publicHealthInstitutionTasks) ? state.publicHealthInstitutionTasks : [];
  const onsiteAcceptances = Array.isArray(state.publicHealthOnsiteAcceptances) ? state.publicHealthOnsiteAcceptances : [];
  const readinessEvidence = Array.isArray(state.publicHealthReadinessEvidence) ? state.publicHealthReadinessEvidence : [];
  const domainCoverage = standards.map((item) => ({
    ...item,
    linkedRecords: (item.dataCollections || []).reduce((sum, collection) => sum + countCollection(state, collection), 0),
    linkedCollections: (item.dataCollections || []).filter((collection) => countCollection(state, collection) > 0)
  }));
  const management = standards.filter((item) => item.category === "management");
  const technology = standards.filter((item) => item.category === "technology");
  const riskQueue = events.filter((item) => /high|高|危急|待|处置|已派发/.test(`${item.priority || ""} ${item.status || ""}`));
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
      institutionScopes: institutionScopes.length,
      events: events.length,
      highPriorityEvents: events.filter((item) => /high|高/.test(`${item.priority || ""}`)).length,
      eventActions: countEventActions(events),
      exchangeTasks: exchangeTasks.length,
      exchangeRuns: exchangeRuns.length,
      institutionTasks: institutionTasks.length,
      onsiteAcceptances: onsiteAcceptances.length,
      onsiteReady: onsiteAcceptances.filter((item) => /ready|signed|passed|complete|就绪|签署|通过/i.test(`${item.status || ""} ${item.signoffStatus || ""}`)).length,
      readinessEvidence: readinessEvidence.length
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
    institutionScopes,
    events,
    riskQueue,
    exchangeTasks,
    exchangeRuns,
    institutionTasks,
    onsiteAcceptances,
    readinessEvidence
  };
}

function renderPublicHealthSystem(system) {
  currentPublicHealthSystem = system;
  setPublicHealthMessage("");
  renderMetrics(system);
  renderSourceDocuments(system.sourceDocuments || []);
  renderStandardDomains(system);
  renderInstitutionScopes(system.institutionScopes || []);
  renderRiskQueue(system.riskQueue || []);
  renderExchangeTasks(system.exchangeTasks || []);
  renderExchangeRuns(system.exchangeRuns || []);
  renderInstitutionTasks(system.institutionTasks || []);
  renderOnsiteAcceptances(system.onsiteAcceptances || []);
  renderEvidence(system.readinessEvidence || []);
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
    ["验收证据", summary.readinessEvidence || 0, "纳入发布证据链"],
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

function renderExchangeRuns(items) {
  document.querySelector("#public-health-exchange-runs").innerHTML = `<table>
    <thead><tr><th>类别</th><th>来源</th><th>状态</th><th>回执</th><th>补偿</th><th>记录</th><th>下一步</th></tr></thead>
    <tbody>${items.map((item) => `<tr>
      <td>${escapeHtml(item.category || "")}</td>
      <td>${escapeHtml(item.sourceSystem || "")}</td>
      <td>${escapeHtml(item.status || "")}</td>
      <td>${escapeHtml(item.receiptStatus || "")}<small>${escapeHtml(item.receiptId || "")}</small></td>
      <td>${escapeHtml(item.compensationStatus || "")}</td>
      <td>${escapeHtml(item.payloadRecords || 0)} / ${escapeHtml(item.failedRecords || 0)}</td>
      <td>${escapeHtml(item.nextAction || "")}</td>
    </tr>`).join("")}</tbody>
  </table>`;
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

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}
