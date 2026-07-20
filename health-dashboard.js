const DASHBOARD_API_BASE = location.protocol === "file:" ? "" : "/api";
const DASHBOARD_SUMMARY_ROUTE = "/api/health-dashboard/summary";
const DASHBOARD_SUMMARY_PATH = DASHBOARD_SUMMARY_ROUTE.replace(/^\/api/, "");
let currentDashboardSummary = null;
const industryIndicatorFilters = { category: "all", status: "all", period: "month" };

document.addEventListener("DOMContentLoaded", async () => {
  const summary = await loadDashboardSummary();
  currentDashboardSummary = summary;
  renderDashboard(summary);
});

async function loadDashboardSummary() {
  let fallbackReason = "静态预览";
  if (DASHBOARD_API_BASE) {
    try {
      const request = window.HealthCityAuth?.authFetch || fetch;
      const response = await request(`${DASHBOARD_API_BASE}${DASHBOARD_SUMMARY_PATH}`);
      if (response.ok) {
        const summary = await response.json();
        summary.sourceMode = "api";
        summary.sourceLabel = "管理端动态汇总";
        return summary;
      }
      fallbackReason = `接口返回 ${response.status}`;
    } catch (error) {
      fallbackReason = "接口不可用";
      // Static preview falls back to local data.
    }
  }
  const state = await loadPlatformState({});
  const summary = buildStaticDashboardSummary(state);
  summary.sourceMode = "static";
  summary.sourceLabel = "静态快照兜底";
  summary.sourceReason = fallbackReason;
  return summary;
}

function buildStaticDashboardSummary(state) {
  const applications = [
    {
      id: "regional-data-sharing",
      name: "Regional diagnosis data sharing",
      entry: "regional-data-sharing.html",
      collections: ["residents", "personalRecords", "diagnosticReports", "integrationContracts", "dataAccessLogs", "platformInterfaces"],
      functionalBoundary: "Share regional diagnosis and treatment data, authorization evidence, report lookup, and access review without becoming the clinical source system.",
      reusePoints: ["resident master index", "personal health records", "diagnostic reports", "integration contracts", "audit logs"],
      apiRoutes: ["GET /api/regional-data-sharing", "POST /api/regional-data-sharing/access-reviews"],
      testEvidence: ["test/static.test.js regional-data-sharing checks", "regional-data-sharing:report"],
      acceptanceEvidence: ["regional-data-sharing-report.json", "regional-data-sharing-report.md"]
    },
    {
      id: "referral-teleconsultation",
      name: "Referral and teleconsultation",
      entry: "county.html",
      collections: ["referralSystem", "referrals", "referralTeleconsultations", "careOrders", "countyCollaborationOrders", "countyAcceptanceLedger"],
      functionalBoundary: "Coordinate referral, remote consultation, receiving feedback, report return, resident authorization, and consortium performance evidence.",
      reusePoints: ["county consortium workflows", "care orders", "collaboration orders", "resident authorization", "acceptance ledger"],
      apiRoutes: ["GET /api/referral-teleconsultations", "POST /api/referral-teleconsultations", "POST /api/referral-teleconsultations/:id/actions"],
      testEvidence: ["test/referral-teleconsultation-readiness.test.js", "referral:readiness"],
      acceptanceEvidence: ["referral-teleconsultation-readiness-report.json", "referral-teleconsultation-readiness-report.md"]
    },
    {
      id: "quality-safety",
      name: "Medical quality and safety supervision",
      entry: "quality-safety.html",
      collections: ["diagnosticReports", "countyMutualRecognitionRecords", "dataQualityIssues", "institutionCreditEvaluations", "securityEvents", "hospitalInteroperabilityFunctions"],
      functionalBoundary: "Supervise quality events, critical values, clinical pathway evidence, mutual-recognition quality control, dispatch, feedback, and review.",
      reusePoints: ["diagnostic reports", "mutual-recognition records", "data-quality issues", "institution credit evaluation", "security audit events"],
      apiRoutes: ["GET /api/quality-safety/dashboard", "POST /api/quality-safety/issues/:id/dispatch", "POST /api/quality-safety/rectifications/:id/feedback", "POST /api/quality-safety/rectifications/:id/review"],
      testEvidence: ["test/quality-safety-report.test.js", "quality-safety:report"],
      acceptanceEvidence: ["quality-safety-report.json", "quality-safety-report.md"]
    },
    {
      id: "operations-dispatch",
      name: "Hospital operations and resource dispatch",
      entry: "operations.html",
      collections: ["healthStatistics", "healthStatisticsIngestion", "medicalResources", "platformProcessAudit", "operationsReadiness"],
      functionalBoundary: "Monitor hospital operation indicators and coordinate resource dispatch, alert handling, and statistics reconciliation.",
      reusePoints: ["health statistics", "statistics ingestion", "medical resources", "platform process audit", "runtime metrics"],
      apiRoutes: ["GET /api/operations/dashboard", "POST /api/operations/dispatch", "POST /api/operations/reconciliation/:id/review"],
      testEvidence: ["test/hospital-operations-readiness.test.js", "operations:readiness"],
      acceptanceEvidence: ["hospital-operations-readiness-report.json", "hospital-operations-readiness-report.md"]
    },
    {
      id: "drug-consumable-supervision",
      name: "Drug, consumable, and rational medication supervision",
      entry: "insurance.html",
      collections: ["drugConsumableSupervisions", "medicationPickups", "insuranceClaims", "institutionSupervisions", "integrationContracts"],
      functionalBoundary: "Regulate rational medication, prescription review, fixed pickup, high-value consumable clues, insurance settlement, and remediation loops.",
      reusePoints: ["drug and consumable supervision records", "medication pickup records", "insurance claims", "institution supervision", "integration contracts"],
      apiRoutes: ["GET /api/drug-consumable-supervision", "POST /api/drug-consumable-supervision/:id/review", "POST /api/drug-consumable-supervision/:id/remediation", "POST /api/drug-consumable-supervision/:id/insurance-sync"],
      testEvidence: ["test/drug-consumable-readiness.test.js", "drug-consumable:readiness"],
      acceptanceEvidence: ["drug-consumable-readiness-report.json", "drug-consumable-readiness-report.md"]
    },
    {
      id: "chronic-followup",
      name: "Chronic disease management and post-discharge follow-up",
      entry: "index.html",
      collections: ["chronicScreeningTasks", "chronicManagementPlans", "followups", "personalRecords", "medicationPickups", "chronicAcceptanceLedger"],
      functionalBoundary: "Manage screening, tiered intervention, post-discharge follow-up, medication adherence, family doctor collaboration, and resident feedback.",
      reusePoints: ["chronic screening tasks", "management plans", "followups", "personal records", "medication pickup evidence", "chronic acceptance ledger"],
      apiRoutes: ["GET /api/service-acceptance-summary", "POST /api/chronic/followup-feedback", "PATCH /api/chronic-management-plans/:id"],
      testEvidence: ["test/chronic-followup-readiness.test.js", "chronic:followup-readiness"],
      acceptanceEvidence: ["chronic-followup-readiness-report.json", "chronic-followup-readiness-report.md"]
    },
    {
      id: "research-sandbox",
      name: "Research datasets and data sandbox",
      entry: "platform.html",
      collections: ["researchDatasets", "diseaseRegistryModels", "compliantDataExports", "dataAccessLogs", "securityAcceptanceLedger", "personalRecords", "diagnosticReports"],
      functionalBoundary: "Govern research dataset application, ethics approval, de-identification release, sandbox access, compliant data export, usage audit, and outcome return without AI diagnosis.",
      reusePoints: ["research datasets", "disease registry models", "compliant data exports", "data access logs", "security acceptance ledger", "clinical source records"],
      apiRoutes: ["GET /api/research/sandbox", "GET /api/research/datasets", "GET /api/research/compliant-exports", "POST /api/research/datasets/:id/evidence", "POST /api/research/datasets/:id/approval", "POST /api/research/datasets/:id/sandbox-access", "POST /api/research/datasets/:id/compliant-exports", "POST /api/research/datasets/:id/outcomes"],
      testEvidence: ["test/research-sandbox-readiness.test.js", "research:sandbox"],
      acceptanceEvidence: ["research-sandbox-readiness-report.json", "research-sandbox-readiness-report.md"]
    },
    {
      id: "health-dashboard",
      name: "Health commission aggregate dashboard",
      entry: "health-dashboard.html",
      collections: ["healthDashboardSnapshots", "platformEvidence", "platformInterfaces", "productionDeploymentPlan", "platformRoadmap"],
      aggregate: true,
      functionalBoundary: "Aggregate indicators, risks, open actions, interfaces, acceptance evidence, and site dependencies from the first seven source applications.",
      reusePoints: ["health dashboard snapshots", "platform evidence", "platform interfaces", "production deployment plan", "platform roadmap"],
      apiRoutes: ["GET /api/health-dashboard/summary"],
      testEvidence: ["test/health-dashboard-summary.test.js", "test/api.test.js health-dashboard summary assertions", "health-dashboard:summary"],
      acceptanceEvidence: ["health-dashboard-summary.json", "health-dashboard-summary.md"]
    }
  ].map((app) => {
    const dataCollections = app.collections;
    const records = dataCollections.reduce((sum, collection) => sum + countRows(state[collection]), 0);
    return {
      ...app,
      collections: dataCollections.map((collection) => ({ collection, records: countRows(state[collection]) })),
      dataCollections,
      frontendEntry: app.entry,
      records,
      openActions: 0,
      highRisks: 0,
      evidenceRecords: 0,
      status: records ? "modeled" : "empty-ready",
      boundary: app.aggregate
        ? "Aggregate dashboard only; the first seven source applications remain the system of record."
        : "Aggregated in the dashboard; detailed workflow remains in the source application."
    };
  });
  const evidence = Array.isArray(state.platformEvidence) ? state.platformEvidence : [];
  const interfaces = Array.isArray(state.platformInterfaces) ? state.platformInterfaces : [];
  const dependencies = Array.isArray(state.productionDeploymentPlan) ? state.productionDeploymentPlan : [];
  const indicatorCenter = buildStaticIndustryGovernanceIndicatorCenter(state);
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    scope: {
      role: "priority-eight-application-portfolio",
      rule: "Static preview tracks the eight priority applications; source workflows stay in their owning applications."
    },
    totals: {
      applications: applications.length,
      sourceApplications: applications.filter((item) => item.id !== "health-dashboard").length,
      sourceRecords: applications.reduce((sum, item) => sum + item.records, 0),
      openActions: 0,
      highRisks: 0,
      interfaceTracks: interfaces.length,
      evidenceRecords: evidence.reduce((sum, item) => sum + (Array.isArray(item.records) ? item.records.length : 0), 0),
      siteDependencies: dependencies.length,
      productionReady: productionReadinessGate.overallStatus === "ready"
    },
    indicatorCenter,
    applications,
    risks: [],
    openActions: [],
    interfaces: interfaces.map((item) => ({ id: item.id, domain: item.domain || item.name, priority: item.priority, owner: item.owner, status: item.status, nextAction: item.next })),
    evidence: evidence.map((item) => ({ id: item.id, name: item.name || item.category, owner: item.owner, status: item.status, records: Array.isArray(item.records) ? item.records.length : 0, nextAction: item.next })),
    siteDependencies: dependencies.map((item) => ({ id: item.id, track: item.track || item.name, owner: item.owner, status: item.status, nextAction: item.nextAction || item.next }))
  };
}

function buildStaticIndustryGovernanceIndicatorCenter(state) {
  const month = new Date().toISOString().slice(0, 7);
  const year = new Date().toISOString().slice(0, 4);
  const definitions = [
    ["industry-physical-exam", "健康体检覆盖", "专项监管", "医政医管处/基层卫生处", ["physicalExaminationRecords", "healthExamRecords"], "./citizen.html"],
    ["industry-fever-clinic", "发热门诊报告闭环", "专项监管", "医政医管处/疾控处", ["feverClinicVisits", "publicHealthEvents"], "./public-health.html"],
    ["industry-disease-reporting", "疾病报卡回执率", "公卫监管", "疾控处/区县信息中心", ["phase2DiseaseReportQueue", "phase2DiseaseReportReceipts"], "./platform.html#phase2-disease-reporting"],
    ["industry-clinical-assist", "临床辅助消息回执率", "医政质量", "医政医管处/质控中心", ["phase2ClinicalAssistAlerts", "phase2ClinicalAssistReceipts"], "./platform.html#phase2-clinical-assist"],
    ["industry-archive-access", "健康档案调阅合规率", "便民服务", "规划信息处/数据安全岗", ["dataAccessLogs", "personalRecords"], "./regional-data-sharing.html"],
    ["industry-appointment-reconciliation", "预约订单对账完成率", "便民服务", "医政医管处/便民服务运营", ["registrationOrders", "careOrders"], "./citizen.html"],
    ["industry-family-doctor", "家庭医生履约覆盖率", "基层卫生", "基层卫生处/区县卫健局", ["phase2FamilyDoctorContracts", "phase2FamilyDoctorFulfillments"], "./platform.html#phase2-family-doctor-contracts"],
    ["industry-regional-performance", "区域绩效证据就绪率", "区域绩效", "规划信息处/医政医管处", ["institutionCreditEvaluations", "countyAcceptanceLedger", "healthDashboardSnapshots"], "./county.html"]
  ];
  const indicators = definitions.map(([id, topic, category, owner, sourceCollections, href]) => {
    const records = sourceCollections.reduce((sum, collection) => sum + countRows(state[collection]), 0);
    const status = records > 0 ? "watch" : "blocked";
    const currentValue = `${records} records`;
    return {
      id,
      topic,
      category,
      definition: `${topic}的静态预览口径，正式统计需由源系统按周期回传。`,
      currentValue,
      status,
      exceptionCount: records > 0 ? 0 : 1,
      owner,
      sourceCollections,
      sourceSystems: sourceCollections,
      dataQuality: records > 0 ? "medium" : "source-required",
      reports: [
        { id: "month", label: "月报", period: month, value: currentValue, status, basis: "static snapshot" },
        { id: "year", label: "年报", period: year, value: currentValue, status, basis: "static snapshot" }
      ],
      drilldown: { label: "查看源业务", href },
      nextAction: records > 0 ? "核对源数据版本和正式统计口径。" : "接入并核验正式源数据。"
    };
  });
  const categories = [...new Set(indicators.map((item) => item.category))];
  const periodViews = [
    { id: "month", label: "月报", period: month, indicators: indicators.length },
    { id: "year", label: "年报", period: year, indicators: indicators.length }
  ];
  return {
    title: "二期行业治理指标中心",
    summary: { indicators: indicators.length, categories: categories.length, ready: 0, watch: indicators.filter((item) => item.status === "watch").length, blocked: indicators.filter((item) => item.status === "blocked").length, exceptions: indicators.reduce((sum, item) => sum + item.exceptionCount, 0), reportViews: 2 },
    categories,
    periodViews,
    indicators,
    exportFields: ["topic", "category", "definition", "currentValue", "status", "exceptionCount", "owner", "sourceCollections", "sourceSystems", "nextAction"],
    boundary: "指标中心仅用于监管口径、报告和下钻，不能替代源系统法定上报或现场签字统计。"
  };
}

function renderDashboard(summary) {
  renderMetrics(summary);
  renderIndustryGovernanceIndicatorCenter(summary.indicatorCenter || {});
  document.querySelector("#dashboard-scope").textContent = summary.scope?.rule || "";
  renderFilterOptions(summary);
  renderApplications(summary.applications || []);
  renderTemplates(summary.applications || []);
  renderRisks(summary.risks || []);
  renderActions(filteredDashboardActions(summary));
  renderDependencies(summary.siteDependencies || []);
  renderInterfaces(summary.interfaces || []);
  renderEvidence(summary.evidence || []);
  renderBloodCoordination(summary.bloodCoordination || {});
}

function renderBloodCoordination(coordination) {
  const target = document.querySelector("#dashboard-blood-coordination");
  if (!target) return;
  const rows = coordination.projections || [];
  target.innerHTML = rows.length ? `<table><thead><tr><th>级别</th><th>治理事件</th><th>订阅模块</th><th>对象</th><th>发生时间</th></tr></thead><tbody>${rows.map((item) => `<tr><td>${escapeHtml(item.severity)}</td><td>${escapeHtml(item.eventType)}</td><td>${escapeHtml(item.consumer)}</td><td>${escapeHtml(item.subjectId)}</td><td>${escapeHtml(item.occurredAt)}</td></tr>`).join("")}</tbody></table>` : "<p>尚无区域血液事件投影。</p>";
}

function renderIndustryGovernanceIndicatorCenter(center) {
  const indicators = Array.isArray(center.indicators) ? center.indicators : [];
  const categories = Array.isArray(center.categories) ? center.categories : [];
  const periodViews = Array.isArray(center.periodViews) ? center.periodViews : [];
  const categorySelect = document.querySelector("#industry-indicator-category");
  const statusSelect = document.querySelector("#industry-indicator-status");
  const periodSelect = document.querySelector("#industry-indicator-period");
  if (!categorySelect || !statusSelect || !periodSelect) return;
  categorySelect.innerHTML = `<option value="all">全部分类</option>${categories.map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join("")}`;
  periodSelect.innerHTML = periodViews.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.label)} · ${escapeHtml(item.period)}</option>`).join("") || `<option value="month">月报</option><option value="year">年报</option>`;
  categorySelect.value = industryIndicatorFilters.category;
  statusSelect.value = industryIndicatorFilters.status;
  periodSelect.value = industryIndicatorFilters.period;
  const visible = indicators.filter((item) =>
    (industryIndicatorFilters.category === "all" || item.category === industryIndicatorFilters.category) &&
    (industryIndicatorFilters.status === "all" || item.status === industryIndicatorFilters.status)
  );
  const selectedPeriod = periodViews.find((item) => item.id === industryIndicatorFilters.period) || periodViews[0] || {};
  const selectedReports = visible.map((item) => ({ item, report: (item.reports || []).find((report) => report.id === industryIndicatorFilters.period) || item.reports?.[0] || {} }));
  document.querySelector("#industry-indicator-summary").textContent = `${selectedPeriod.label || "报告"} ${selectedPeriod.period || ""} / ${visible.length}/${indicators.length} 项 / ${visible.filter((item) => item.status === "blocked").length} 项数据源阻断`;
  document.querySelector("#industry-indicator-metrics").innerHTML = [
    ["监管指标", indicators.length, `${categories.length} 个分类`],
    ["当前显示", visible.length, `${selectedPeriod.label || "报告"} ${selectedPeriod.period || ""}`],
    ["数据源阻断", visible.filter((item) => item.status === "blocked").length, "不得纳入正式报表"],
    ["异常记录", visible.reduce((sum, item) => sum + Number(item.exceptionCount || 0), 0), "回到源业务闭环"]
  ].map(([label, value, hint]) => `<article class="metric-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(hint)}</small></article>`).join("");
  document.querySelector("#industry-indicator-list").innerHTML = selectedReports.map(({ item, report }) => `
    <article class="governance-indicator-card ${escapeHtml(item.status)}" data-industry-indicator="${escapeHtml(item.id)}" data-industry-category="${escapeHtml(item.category)}" data-industry-status="${escapeHtml(item.status)}">
      <div class="governance-indicator-heading">
        <span>${escapeHtml(item.category)}</span>
        <span class="badge ${item.status === "ready" ? "info" : item.status === "watch" ? "warn" : "danger"}">${escapeHtml(item.status)}</span>
      </div>
      <strong>${escapeHtml(item.topic)}</strong>
      <div class="governance-indicator-value">${escapeHtml(report.value || item.currentValue)}</div>
      <p>${escapeHtml(item.definition)}</p>
      <small>${escapeHtml(report.label || "报告")} ${escapeHtml(report.period || "")} / 异常 ${escapeHtml(item.exceptionCount || 0)}</small>
      <small>${escapeHtml(item.owner)} / ${escapeHtml((item.sourceCollections || []).join(", "))}</small>
      <p>${escapeHtml(item.nextAction)}</p>
      <a class="inline-action" href="${escapeHtml(item.drilldown?.href || "#")}">${escapeHtml(item.drilldown?.label || "查看源业务")}</a>
    </article>
  `).join("") || `<article class="governance-indicator-card empty"><strong>暂无匹配指标</strong><p>调整分类或状态筛选后查看。</p></article>`;
  document.querySelector("#industry-indicator-boundary").textContent = center.boundary || "指标中心不替代源系统法定上报。";
  bindIndustryGovernanceIndicatorControls(center);
}

function bindIndustryGovernanceIndicatorControls(center) {
  ["industry-indicator-category", "industry-indicator-status", "industry-indicator-period"].forEach((id) => {
    const control = document.getElementById(id);
    if (!control || control.dataset.industryIndicatorBound === "1") return;
    control.dataset.industryIndicatorBound = "1";
    control.addEventListener("change", () => {
      industryIndicatorFilters.category = document.querySelector("#industry-indicator-category")?.value || "all";
      industryIndicatorFilters.status = document.querySelector("#industry-indicator-status")?.value || "all";
      industryIndicatorFilters.period = document.querySelector("#industry-indicator-period")?.value || "month";
      renderIndustryGovernanceIndicatorCenter(center);
    });
  });
  const exportButton = document.querySelector("#industry-indicator-export");
  if (!exportButton || exportButton.dataset.industryIndicatorBound === "1") return;
  exportButton.dataset.industryIndicatorBound = "1";
  exportButton.addEventListener("click", () => {
    const indicators = (center.indicators || []).filter((item) =>
      (industryIndicatorFilters.category === "all" || item.category === industryIndicatorFilters.category) &&
      (industryIndicatorFilters.status === "all" || item.status === industryIndicatorFilters.status)
    );
    const payload = {
      generatedAt: currentDashboardSummary?.generatedAt || new Date().toISOString(),
      period: industryIndicatorFilters.period,
      category: industryIndicatorFilters.category,
      status: industryIndicatorFilters.status,
      boundary: center.boundary,
      indicators
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `industry-governance-indicators-${industryIndicatorFilters.period}.json`;
    link.click();
    URL.revokeObjectURL(url);
  });
}

function renderTemplates(applications) {
  document.querySelector("#dashboard-templates").innerHTML = applications.map((item) => `<article class="item">
    <div>
      <h3>${escapeHtml(item.name)}</h3>
      <p>${escapeHtml(item.functionalBoundary || item.boundary || "")}</p>
      <div class="template-meta">
        <span><strong>Reuse</strong>${escapeHtml((item.reusePoints || []).join(", "))}</span>
        <span><strong>Data</strong>${escapeHtml((item.dataCollections || []).join(", "))}</span>
        <span><strong>API</strong>${escapeHtml((item.apiRoutes || []).join(", "))}</span>
        <span><strong>Tests</strong>${escapeHtml((item.testEvidence || []).join(", "))}</span>
        <span><strong>Acceptance</strong>${escapeHtml((item.acceptanceEvidence || []).join(", "))}</span>
      </div>
    </div>
    <a class="inline-action" href="./${escapeHtml(item.frontendEntry || item.entry)}">Open</a>
  </article>`).join("");
}

function renderMetrics(summary) {
  const totals = summary.totals || {};
  document.querySelector("#dashboard-metrics").innerHTML = [
    ["Applications", totals.applications || 0, `${totals.sourceApplications || 0} source workflows plus dashboard`],
    ["Source records", totals.sourceRecords || 0, "From data/db.json and business APIs"],
    ["Open actions", totals.openActions || 0, "Cross-application items"],
    ["High risks", totals.highRisks || 0, "Normalized risk signals"],
    ["Interfaces", totals.interfaceTracks || 0, "platformInterfaces"],
    ["Evidence", totals.evidenceRecords || 0, "platformEvidence records"],
    ["Site dependencies", totals.siteDependencies || 0, "Cutover signoff items"],
    ["Readiness", summary.ok ? "OK" : "Check", summary.generatedAt || ""]
  ].map(([label, value, hint]) => `<article class="metric-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(hint)}</small></article>`).join("");
}

function renderFunctionReport(report) {
  const summary = document.querySelector("#dashboard-function-summary");
  const list = document.querySelector("#dashboard-function-list");
  const evidence = document.querySelector("#dashboard-function-evidence");
  const rows = Array.isArray(report.functions) ? report.functions : [];
  const evidenceRows = Array.isArray(report.releaseEvidence) ? report.releaseEvidence : [];
  if (summary) {
    summary.textContent = `${report.summary?.functions || rows.length} 项功能 / ${report.summary?.ready || 0} 已就绪 / ${report.summary?.watch || 0} 需关注`;
  }
  if (list) {
    list.innerHTML = rows.map((item) => `<article class="function-report-card ${item.status || "normal"}" data-function-report="${item.id}">
      <span>${dashboardStatusLabel(item.status || "ready")}</span>
      <strong>${item.name || item.id}</strong>
      <small>${dashboardTechnicalLabel(item.evidence || "")}</small>
      <p>${item.boundary || ""}</p>
    </article>`).join("") || `<article class="function-report-card empty"><strong>等待功能报告</strong><p>摘要接口返回后生成本模块主要功能报告。</p></article>`;
  }
  if (evidence) {
    evidence.innerHTML = evidenceRows.map((item) => `<span data-function-evidence="${item.id}">${item.name || item.id}：${dashboardTechnicalLabel(item.evidence || "")}</span>`).join("");
  }
}

function bindJurisdictionLevel() {
  const controls = document.querySelector("#jurisdiction-level-controls");
  if (!controls || controls.dataset.bound === "true") return;
  controls.dataset.bound = "true";
  controls.addEventListener("click", (event) => {
    const button = event.target.closest("[data-jurisdiction-level]");
    if (!button) return;
    currentJurisdictionLevel = button.dataset.jurisdictionLevel || "all";
    if (currentDashboardSummary) renderJurisdictionWorkbench(currentDashboardSummary.functionalReport || {});
  });
}

function bindJurisdictionScopeFilters() {
  ["#jurisdiction-district-filter", "#jurisdiction-type-filter"].forEach((selector) => {
    const control = document.querySelector(selector);
    if (!control || control.dataset.bound === "true") return;
    control.dataset.bound = "true";
    control.addEventListener("change", () => {
      currentJurisdictionDistrict = document.querySelector("#jurisdiction-district-filter")?.value || "";
      currentJurisdictionType = document.querySelector("#jurisdiction-type-filter")?.value || "";
      currentJurisdictionDetail = "";
      if (currentDashboardSummary) renderJurisdictionScope(currentDashboardSummary.jurisdictionScope || {});
    });
  });
  const grid = document.querySelector("#jurisdiction-scope-grid");
  if (grid && grid.dataset.bound !== "true") {
    grid.dataset.bound = "true";
    grid.addEventListener("click", (event) => {
      const card = event.target.closest("[data-jurisdiction-scope]");
      if (!card) return;
      currentJurisdictionDetail = card.dataset.jurisdictionScope || "";
      if (currentDashboardSummary) renderJurisdictionScope(currentDashboardSummary.jurisdictionScope || {});
    });
    grid.addEventListener("keydown", (event) => {
      if (!["Enter", " "].includes(event.key)) return;
      const card = event.target.closest("[data-jurisdiction-scope]");
      if (!card) return;
      event.preventDefault();
      currentJurisdictionDetail = card.dataset.jurisdictionScope || "";
      if (currentDashboardSummary) renderJurisdictionScope(currentDashboardSummary.jurisdictionScope || {});
    });
  }
}

function renderJurisdictionWorkbench(report) {
  const board = document.querySelector("#dashboard-jurisdiction-board");
  const controls = document.querySelector("#jurisdiction-level-controls");
  const summary = document.querySelector("#jurisdiction-board-summary");
  const matrix = document.querySelector("#jurisdiction-matrix");
  const boundary = document.querySelector("#jurisdiction-boundary");
  if (!board || !controls || !matrix) return;
  const rows = Array.isArray(report.cityCountyFunctionMatrix) ? report.cityCountyFunctionMatrix : [];
  const levels = ["all", ...Array.from(new Set(rows.map((item) => item.level).filter(Boolean)))];
  if (!levels.includes(currentJurisdictionLevel)) currentJurisdictionLevel = "all";
  const filteredRows = currentJurisdictionLevel === "all" ? rows : rows.filter((item) => item.level === currentJurisdictionLevel);
  board.dataset.activeLevel = currentJurisdictionLevel;
  controls.innerHTML = levels.map((level) => `<button type="button" data-jurisdiction-level="${level}" class="${level === currentJurisdictionLevel ? "active" : ""}">${level === "all" ? "全部" : level}</button>`).join("");
  if (summary) {
    const cityRows = rows.filter((item) => item.level === "市级").length;
    const countyRows = rows.filter((item) => item.level === "县级").length;
    summary.textContent = `${currentJurisdictionLevel === "all" ? "全部层级" : currentJurisdictionLevel} / 市级 ${cityRows} 项 / 县级 ${countyRows} 项 / 当前 ${filteredRows.length} 项`;
  }
  matrix.innerHTML = filteredRows.map((item) => `<article class="jurisdiction-card ${item.status || "watch"}" data-jurisdiction-row="${item.id}" data-jurisdiction-level="${item.level || ""}">
    <span>${item.level || "未标注"} / ${dashboardStatusLabel(item.status || "watch")}</span>
    <strong>${item.agency || item.id}</strong>
    <ul>${(item.implemented || []).map((text) => `<li>${dashboardTechnicalLabel(text)}</li>`).join("")}</ul>
    <p>${item.nextPlan || ""}</p>
    <small>${dashboardTechnicalLabel(item.evidence || "")}</small>
  </article>`).join("") || `<article class="jurisdiction-card empty"><strong>等待行政层级矩阵</strong><p>摘要接口返回市、县两级卫生健康行政部门职责后显示。</p></article>`;
  if (boundary) {
    boundary.textContent = "本工作台仅呈现卫生健康行政部门监管、督办、审计和联调视角；医疗机构、专业中心、平台中心和基层服务机构不在本系统承接非本机关办理职责。";
  }
}

function renderJurisdictionScope(scope) {
  const districtFilter = document.querySelector("#jurisdiction-district-filter");
  const typeFilter = document.querySelector("#jurisdiction-type-filter");
  const summary = document.querySelector("#jurisdiction-scope-summary");
  const grid = document.querySelector("#jurisdiction-scope-grid");
  const detail = document.querySelector("#jurisdiction-detail-panel");
  if (!districtFilter || !typeFilter || !grid) return;
  const districts = Array.isArray(scope.districts) ? scope.districts : [];
  const districtOptions = Array.isArray(scope.districtOptions) ? scope.districtOptions : [];
  const typeOptions = Array.isArray(scope.institutionTypeOptions) ? scope.institutionTypeOptions : [];
  if (!districtFilter.dataset.ready) {
    districtFilter.innerHTML = [`<option value="">全部辖区</option>`, ...districtOptions.map((item) => `<option value="${item}">${item}</option>`)].join("");
    districtFilter.dataset.ready = "1";
  }
  if (!typeFilter.dataset.ready) {
    typeFilter.innerHTML = [`<option value="">全部机构类型</option>`, ...typeOptions.map((item) => `<option value="${item}">${item}</option>`)].join("");
    typeFilter.dataset.ready = "1";
  }
  const selectedDistrict = currentJurisdictionDistrict || districtFilter.value || "";
  const selectedType = currentJurisdictionType || typeFilter.value || "";
  const selectedRows = districts.filter((item) =>
    (!selectedDistrict ? item.id === "all" || item.district !== "全市" : item.district === selectedDistrict) &&
    (!selectedType || (item.institutionTypes || []).some((type) => type.type === selectedType))
  );
  const rows = selectedDistrict ? selectedRows : selectedRows.filter((item) => item.id !== "all");
  const visibleRows = rows.length ? rows : districts.filter((item) => item.id === "all");
  const totals = visibleRows.reduce((sum, item) => ({
    districts: sum.districts + (item.id === "all" ? 0 : 1),
    institutions: sum.institutions + Number(item.institutions || 0),
    openActions: sum.openActions + Number(item.openActions || 0),
    highRisks: sum.highRisks + Number(item.highRisks || 0)
  }), { districts: 0, institutions: 0, openActions: 0, highRisks: 0 });
  if (summary) {
    summary.textContent = `${selectedDistrict || "全部辖区"} / ${selectedType || "全部机构类型"} / ${totals.institutions} 个机构 / ${totals.openActions} 条待办 / ${totals.highRisks} 条高风险`;
  }
  if (!currentJurisdictionDetail || !visibleRows.some((item) => item.id === currentJurisdictionDetail)) {
    currentJurisdictionDetail = visibleRows.find((item) => item.id !== "all")?.id || visibleRows[0]?.id || "";
  }
  grid.innerHTML = visibleRows.map((item) => `<article class="jurisdiction-scope-card ${item.status || "watch"} ${item.id === currentJurisdictionDetail ? "active" : ""}" data-jurisdiction-scope="${item.id}" role="button" tabindex="0" aria-pressed="${item.id === currentJurisdictionDetail ? "true" : "false"}">
    <span>${dashboardStatusLabel(item.status || "watch")} / ${item.district}</span>
    <strong>${item.institutions || 0} 个机构 · ${item.openActions || 0} 条待办</strong>
    <small>${(item.institutionTypes || []).map((type) => `${type.type}${type.count}`).join(" / ") || "等待机构目录"}</small>
    <p>床位 ${formatDashboardNumber(item.beds || 0)} / 医师 ${formatDashboardNumber(item.doctors || 0)} / 日报 ${formatDashboardNumber(item.serviceReports || 0)} 条</p>
    <p>就诊 ${formatDashboardNumber(item.visits || 0)} 人次 / 入院 ${formatDashboardNumber(item.admissions || 0)} 人次 / 高风险 ${formatDashboardNumber(item.highRisks || 0)} 条</p>
    <small>${item.nextAction || ""}</small>
  </article>`).join("") || `<article class="jurisdiction-scope-card empty"><strong>等待辖区数据</strong><p>接入机构目录、日报和源应用待办后显示。</p></article>`;
  if (detail) renderJurisdictionDetail(detail, visibleRows.find((item) => item.id === currentJurisdictionDetail), selectedType);
}

function renderJurisdictionDetail(container, row, selectedType) {
  if (!row) {
    container.innerHTML = `<article class="jurisdiction-detail-card empty"><strong>等待区县详情</strong><p>选择辖区卡片后显示监管明细。</p></article>`;
    return;
  }
  const institutions = selectedType ? (row.institutionsList || []).filter((item) => item.type === selectedType) : (row.institutionsList || []);
  const serviceReports = row.serviceReportList || [];
  const actions = row.actionList || [];
  const institutionRows = institutions.slice(0, 5).map((item) => `<li><strong>${item.name}</strong><span>${item.type} / 床位 ${formatDashboardNumber(item.beds)} / 医师 ${formatDashboardNumber(item.doctors)}</span></li>`).join("");
  const serviceRows = serviceReports.slice(0, 4).map((item) => `<li><strong>${item.reportDate || "未标注日期"}</strong><span>${item.institution} / 就诊 ${formatDashboardNumber(item.visits)} / 入院 ${formatDashboardNumber(item.admissions)} / ${dashboardStatusLabel(item.status)}</span></li>`).join("");
  const actionRows = actions.slice(0, 5).map((item) => `<li><strong>${item.title}</strong><span>${item.application} / ${dashboardStatusLabel(item.priority)} / ${item.owner} / ${item.status}</span></li>`).join("");
  container.innerHTML = `<article class="jurisdiction-detail-card ${row.status || "watch"}">
    <div>
      <span>${row.district}监管详情</span>
      <strong>${selectedType || "全部机构类型"} / ${formatDashboardNumber(institutions.length)} 个机构 / ${formatDashboardNumber(row.openActions || 0)} 条待办</strong>
      <p>仅展示卫生健康行政监管、接口联调和验收证据视角；具体业务办理继续回到对应源应用或属地系统。</p>
    </div>
    <div class="jurisdiction-detail-metrics">
      <span>床位 <strong>${formatDashboardNumber(row.beds || 0)}</strong></span>
      <span>医师 <strong>${formatDashboardNumber(row.doctors || 0)}</strong></span>
      <span>就诊 <strong>${formatDashboardNumber(row.visits || 0)}</strong></span>
      <span>入院 <strong>${formatDashboardNumber(row.admissions || 0)}</strong></span>
      <span>高风险 <strong>${formatDashboardNumber(row.highRisks || 0)}</strong></span>
    </div>
    <div class="jurisdiction-detail-columns">
      <section><h4>机构目录</h4><ul>${institutionRows || "<li><span>等待机构目录接入</span></li>"}</ul></section>
      <section><h4>日报服务量</h4><ul>${serviceRows || "<li><span>等待日报接口接入</span></li>"}</ul></section>
      <section><h4>源应用待办</h4><ul>${actionRows || "<li><span>暂无源应用待办</span></li>"}</ul></section>
    </div>
    <small>${row.nextAction || ""}</small>
  </article>`;
}

function renderActionClosureTrend(trend) {
  const section = document.querySelector("#action-closure-trend-board");
  const summary = document.querySelector("#action-trend-summary");
  const cards = document.querySelector("#action-trend-cards");
  const periods = document.querySelector("#action-trend-periods");
  const apps = document.querySelector("#action-trend-apps");
  const boundary = document.querySelector("#action-trend-boundary");
  if (!section || !cards || !periods || !apps) return;
  const totals = trend.summary || {};
  const periodRows = Array.isArray(trend.periods) ? trend.periods : [];
  const appRows = Array.isArray(trend.applications) ? trend.applications : [];
  section.dataset.trendStatus = trend.status || "empty";
  if (summary) {
    summary.textContent = `${totals.total || 0} 条任务 / 闭环率 ${totals.closureRate || 0}% / 超期率 ${totals.overdueRate || 0}% / ${totals.overdue || 0} 条超期`;
  }
  cards.innerHTML = [
    ["任务总量", totals.total || 0, "源应用任务全集"],
    ["已闭环", totals.closed || 0, `${totals.closureRate || 0}% 闭环率`],
    ["待闭环", totals.open || 0, `${totals.previewOpenActions || 0} 条进入驾驶舱预览`],
    ["超期任务", totals.overdue || 0, `${totals.overdueRate || 0}% 超期率`]
  ].map(([label, value, detail]) => `<article class="action-trend-card">
    <span>${label}</span>
    <strong>${formatDashboardNumber(value)}</strong>
    <small>${detail}</small>
  </article>`).join("");
  periods.innerHTML = periodRows.map((item) => `<article class="action-trend-period" data-action-period="${item.id}">
    <div>
      <strong>${item.label}</strong>
      <span>${item.rangeLabel || ""}</span>
    </div>
    <div class="trend-bar-row">
      <span>闭环 ${item.closureRate || 0}%</span>
      <div class="trend-bar"><i style="width:${Math.min(100, item.closureRate || 0)}%"></i></div>
    </div>
    <div class="trend-bar-row overdue">
      <span>超期 ${item.overdueRate || 0}%</span>
      <div class="trend-bar"><i style="width:${Math.min(100, item.overdueRate || 0)}%"></i></div>
    </div>
    <small>${item.total || 0} 条 / 已闭环 ${item.closed || 0} / 超期 ${item.overdue || 0}</small>
  </article>`).join("") || `<article class="action-trend-period empty"><strong>等待周期数据</strong><span>源应用补齐任务日期后显示趋势。</span></article>`;
  apps.innerHTML = appRows.slice(0, 6).map((item) => `<article class="action-trend-app" data-action-app="${item.id}">
    <span>${item.application || item.id}</span>
    <strong>${item.open || 0} 待闭环 / ${item.overdue || 0} 超期</strong>
    <small>闭环率 ${item.closureRate || 0}% / 超期率 ${item.overdueRate || 0}% / 高风险 ${item.highRisks || 0}</small>
  </article>`).join("") || `<article class="action-trend-app empty"><strong>等待源应用任务</strong><small>接入随访、转诊、慢病筛查、医共体协同等任务后显示。</small></article>`;
  if (boundary) boundary.textContent = trend.boundary || "本趋势仅用于卫生健康行政部门监管、督办和调度分析，具体办理仍回到源应用。";
}

function bindDepartmentStatus() {
  const controls = document.querySelector("#department-status-controls");
  if (!controls || controls.dataset.bound === "true") return;
  controls.dataset.bound = "true";
  controls.addEventListener("click", (event) => {
    const button = event.target.closest("[data-department-status]");
    if (!button) return;
    currentDepartmentStatus = button.dataset.departmentStatus || "all";
    if (currentDashboardSummary) renderDepartmentWorkbench(currentDashboardSummary.functionalReport || {});
  });
}

function bindSiteIssueStatus() {
  const controls = document.querySelector("#site-issue-ledger-status-controls");
  if (!controls || controls.dataset.bound === "true") return;
  controls.dataset.bound = "true";
  controls.addEventListener("click", (event) => {
    const button = event.target.closest("[data-site-issue-status]");
    if (!button) return;
    currentSiteIssueStatus = button.dataset.siteIssueStatus || "all";
    if (currentDashboardSummary) renderSiteIssueLedger(currentDashboardSummary.siteIssueLedger || {});
  });
}

function bindSiteIssueOwner() {
  const control = document.querySelector("#site-issue-owner-filter");
  if (!control || control.dataset.bound === "true") return;
  control.dataset.bound = "true";
  control.addEventListener("change", () => {
    currentSiteIssueOwner = control.value || "";
    if (currentDashboardSummary) renderSiteIssueLedger(currentDashboardSummary.siteIssueLedger || {});
  });
}

function bindSiteIssueReset() {
  const button = document.querySelector("#site-issue-reset-filters");
  if (!button || button.dataset.bound === "true") return;
  button.dataset.bound = "true";
  button.addEventListener("click", () => {
    currentSiteIssueStatus = "all";
    currentSiteIssueOwner = "";
    if (currentDashboardSummary) renderSiteIssueLedger(currentDashboardSummary.siteIssueLedger || {});
  });
}

function bindBackendGoLiveStatus() {
  const controls = document.querySelector("#production-backend-go-live-status-controls");
  if (!controls || controls.dataset.bound === "true") return;
  controls.dataset.bound = "true";
  controls.addEventListener("click", (event) => {
    const button = event.target.closest("[data-production-backend-status-filter]");
    if (!button) return;
    currentBackendGoLiveStatus = button.dataset.productionBackendStatusFilter || "all";
    if (currentDashboardSummary) renderProductionReadinessGate(currentDashboardSummary.productionReadinessGate || {});
  });
}

function bindBackendGoLiveReset() {
  const button = document.querySelector("#production-backend-go-live-reset");
  if (!button || button.dataset.bound === "true") return;
  button.dataset.bound = "true";
  button.addEventListener("click", () => {
    currentBackendGoLiveStatus = "all";
    if (currentDashboardSummary) renderProductionReadinessGate(currentDashboardSummary.productionReadinessGate || {});
  });
}

function bindIndicatorCenterFilters() {
  ["#indicator-dimension-filter", "#indicator-status-filter"].forEach((selector) => {
    const control = document.querySelector(selector);
    if (!control || control.dataset.bound === "true") return;
    control.dataset.bound = "true";
    control.addEventListener("change", () => {
      currentIndicatorDimension = document.querySelector("#indicator-dimension-filter")?.value || "all";
      currentIndicatorStatus = document.querySelector("#indicator-status-filter")?.value || "all";
      if (currentDashboardSummary) renderIndicatorCenter(currentDashboardSummary.indicatorCenter || {});
    });
  });
}

function bindIndicatorCenterReset() {
  const button = document.querySelector("#indicator-center-reset");
  if (!button || button.dataset.bound === "true") return;
  button.dataset.bound = "true";
  button.addEventListener("click", () => {
    currentIndicatorDimension = "all";
    currentIndicatorStatus = "all";
    if (currentDashboardSummary) renderIndicatorCenter(currentDashboardSummary.indicatorCenter || {});
  });
}

function renderDepartmentWorkbench(report) {
  const board = document.querySelector("#dashboard-department-board");
  const controls = document.querySelector("#department-status-controls");
  const summary = document.querySelector("#department-board-summary");
  const matrix = document.querySelector("#department-function-matrix");
  const boundary = document.querySelector("#department-boundary");
  if (!board || !controls || !matrix) return;
  const rows = Array.isArray(report.departmentFunctionMatrix) ? report.departmentFunctionMatrix : [];
  const statuses = ["all", ...Array.from(new Set(rows.map((item) => item.status).filter(Boolean)))];
  if (!statuses.includes(currentDepartmentStatus)) currentDepartmentStatus = "all";
  const filteredRows = currentDepartmentStatus === "all" ? rows : rows.filter((item) => item.status === currentDepartmentStatus);
  board.dataset.activeStatus = currentDepartmentStatus;
  controls.innerHTML = statuses.map((status) => `<button type="button" data-department-status="${status}" class="${status === currentDepartmentStatus ? "active" : ""}">${status === "all" ? "全部" : dashboardStatusLabel(status)}</button>`).join("");
  if (summary) {
    const readyRows = rows.filter((item) => item.status === "ready").length;
    const watchRows = rows.filter((item) => item.status === "watch").length;
    summary.textContent = `${currentDepartmentStatus === "all" ? "全部状态" : dashboardStatusLabel(currentDepartmentStatus)} / 已就绪 ${readyRows} 项 / 需关注 ${watchRows} 项 / 当前 ${filteredRows.length} 项`;
  }
  matrix.innerHTML = filteredRows.map((item) => `<article class="department-card ${item.status || "watch"}" data-department-row="${item.id}" data-department-status="${item.status || ""}">
    <span>${item.name || item.id} / ${dashboardStatusLabel(item.status || "watch")}</span>
    <strong>${item.level || "内部机构"}</strong>
    <ul>${(item.implemented || []).map((text) => `<li>${dashboardTechnicalLabel(text)}</li>`).join("")}</ul>
    <p>${item.nextPlan || ""}</p>
    <small>${dashboardTechnicalLabel(item.evidence || "")}</small>
  </article>`).join("") || `<article class="department-card empty"><strong>等待内设机构职能台账</strong><p>摘要接口返回委机关内设机构职责后显示。</p></article>`;
  if (boundary) {
    boundary.textContent = "本台账只呈现卫生健康行政部门内部处室的监管、督办、审计和联调事项；源业务办理仍由对应业务系统或责任单位完成。";
  }
}

function bindPopulationBoardPeriod() {
  const controls = document.querySelector("#population-period-controls");
  if (!controls || controls.dataset.bound === "true") return;
  controls.dataset.bound = "true";
  controls.addEventListener("click", (event) => {
    const button = event.target.closest("[data-population-period]");
    if (!button) return;
    currentPopulationPeriod = button.dataset.populationPeriod || "day";
    if (currentDashboardSummary) renderPopulationServiceBoard(currentDashboardSummary);
  });
}

function renderPopulationServiceBoard(summary) {
  const board = summary.populationServiceBoard || {};
  const section = document.querySelector("#population-service-board");
  const controls = document.querySelector("#population-period-controls");
  const cards = document.querySelector("#population-metric-cards");
  const chart = document.querySelector("#population-chart");
  const sourceDetails = document.querySelector("#population-source-details");
  const insights = document.querySelector("#population-insights");
  const range = document.querySelector("#population-board-range");
  const source = document.querySelector("#population-board-source");
  if (!section || !controls || !cards || !chart) return;
  const periods = Array.isArray(board.periods) ? board.periods : [];
  const selected = periods.find((period) => period.id === currentPopulationPeriod) || periods.find((period) => period.id === board.defaultPeriod) || periods[0];
  if (!selected) {
    section.dataset.activePeriod = "empty";
    controls.innerHTML = "";
    cards.innerHTML = `<article class="population-empty">暂无出生、死亡、就诊、入院数据</article>`;
    chart.innerHTML = "";
    if (sourceDetails) sourceDetails.innerHTML = "";
    if (insights) insights.innerHTML = "";
    if (range) range.textContent = "等待数据";
    if (source) source.textContent = "等待前 7 个应用或现场接口写入统计快照。";
    return;
  }
  currentPopulationPeriod = selected.id;
  section.dataset.activePeriod = selected.id;
  controls.innerHTML = periods.map((period) => `<button type="button" data-population-period="${period.id}" class="${period.id === selected.id ? "active" : ""}">${period.label}</button>`).join("");
  if (range) range.textContent = `${selected.label} / ${selected.rangeLabel || board.eventAnchor || ""}`;
  if (source) source.textContent = board.sourceNote || "";
  const metrics = Array.isArray(selected.metrics) ? selected.metrics : [];
  cards.innerHTML = metrics.map((metric) => `<article class="population-metric-card ${metric.tone || metric.id}" data-population-metric="${metric.id}">
    <span>${metric.label}</span>
    <strong>${formatDashboardNumber(metric.value)}</strong>
    <small>${metric.unit || ""} / ${metric.sourceLabel || metric.source || ""}</small>
  </article>`).join("");
  const maxValue = Math.max(1, ...metrics.map((metric) => Number(metric.value) || 0));
  chart.innerHTML = metrics.map((metric) => {
    const value = Number(metric.value) || 0;
    const width = Math.max(value === 0 ? 0 : 4, Math.round((value / maxValue) * 100));
    return `<div class="population-bar-row" data-population-metric="${metric.id}">
      <span>${metric.label}</span>
      <div class="population-bar-track"><i class="population-bar-fill ${metric.tone || metric.id}" style="--bar-width:${width}%"></i></div>
      <strong>${formatDashboardNumber(value)}${metric.unit || ""}</strong>
    </div>`;
  }).join("");
  if (sourceDetails) {
    const details = Array.isArray(board.sourceDetails) ? board.sourceDetails : metrics.map((metric) => ({
      id: metric.id,
      label: metric.label,
      field: metric.source || "",
      source: metric.sourceLabel || "",
      mode: "接口字段",
      status: "watch",
      records: 0
    }));
    sourceDetails.innerHTML = details.map((item) => `<article class="population-source-card ${item.status || "watch"}" data-population-source="${item.id}">
      <span>${dashboardStatusLabel(item.status || "watch")} / ${item.mode || ""}</span>
      <strong>${item.label || item.id}</strong>
      <small>${dashboardTechnicalLabel(item.field || "")}</small>
      <p>${item.source || ""} / ${formatDashboardNumber(item.records || 0)} 条记录</p>
    </article>`).join("");
  }
  if (insights) {
    const insightRows = Array.isArray(board.insights) ? board.insights : [];
    insights.innerHTML = insightRows.map((item) => `<article class="population-insight ${item.status || "normal"}" data-population-insight="${item.id}">
      <span>${item.title || item.id}</span>
      <strong>${item.value || ""}</strong>
      <small>${item.detail || ""}</small>
    </article>`).join("");
  }
}

function formatDashboardNumber(value) {
  return Number(value || 0).toLocaleString("zh-CN");
}

function renderApplications(applications) {
  document.querySelector("#dashboard-applications").innerHTML = `<table>
    <thead><tr><th>Application</th><th>Entry</th><th>Records</th><th>Open actions</th><th>High risks</th><th>Status</th></tr></thead>
    <tbody>${applications.map((item) => `<tr>
      <td>${escapeHtml(item.name)}</td>
      <td><a href="./${escapeHtml(item.entry)}">${escapeHtml(item.entry)}</a></td>
      <td>${escapeHtml(item.records)}</td>
      <td>${escapeHtml(item.openActions)}</td>
      <td>${escapeHtml(item.highRisks)}</td>
      <td><span class="badge ${item.status === "modeled" ? "info" : "warn"}">${escapeHtml(item.status)}</span></td>
    </tr>`).join("")}</tbody>
  </table>`;
}

function renderRisks(risks) {
  document.querySelector("#dashboard-risks").innerHTML = risks.map((item) => `<div>
    <strong>${escapeHtml(item.application)}</strong>
    <span>${escapeHtml(item.highRisks)} high / ${escapeHtml(item.openActions)} open</span>
    <small>${escapeHtml(item.nextAction)}</small>
  </div>`).join("") || `<div><strong>No high-risk summary</strong><span>Waiting for source applications or site joint-test data.</span></div>`;
}

function renderActions(actions) {
  document.querySelector("#dashboard-actions").innerHTML = actions.map((item, index) => `<article class="priority-row">
    <div class="priority-rank ${item.priority === "high" ? "danger" : item.priority === "medium" ? "warn" : "info"}">${index + 1}</div>
    <div>
      <h3>${escapeHtml(item.title)}</h3>
      <p>${escapeHtml(item.collection)} / ${escapeHtml(item.status)}</p>
    </div>
    <div class="capability-side">
      <span class="badge ${item.priority === "high" ? "danger" : item.priority === "medium" ? "warn" : "info"}">${escapeHtml(item.priority)}</span>
      <small>${escapeHtml(item.owner || "owner-pending")}</small>
    </div>
  </article>`).join("") || `<article class="priority-row"><div class="priority-rank info">0</div><div><h3>No cross-application action</h3><p>Open actions stay owned by their source applications.</p></div></article>`;
}

function renderDependencies(items) {
  document.querySelector("#dashboard-dependencies").innerHTML = items.map((item) => `<div>
    <strong>${escapeHtml(item.track || item.id)}</strong>
    <span>${escapeHtml(item.status || "pending")} / ${escapeHtml(item.owner || "owner-pending")}</span>
    <small>${escapeHtml(item.nextAction || "")}</small>
  </div>`).join("") || `<div><strong>No site dependency</strong><span>Cutover signoff items are not in the snapshot.</span></div>`;
}

function renderInterfaces(items) {
  document.querySelector("#dashboard-interfaces").innerHTML = items.slice(0, 8).map((item) => `<div>
    <strong>${escapeHtml(item.domain || item.id)}</strong>
    <span>${escapeHtml(item.priority || "P2")} / ${escapeHtml(item.status || "pending")}</span>
    <small>${escapeHtml(item.nextAction || "")}</small>
  </div>`).join("") || `<div><strong>No interface track</strong><span>Waiting for platformInterfaces data.</span></div>`;
}

function renderEvidence(items) {
  document.querySelector("#dashboard-evidence").innerHTML = items.slice(0, 8).map((item) => `<div>
    <strong>${escapeHtml(item.name || item.id)}</strong>
    <span>${escapeHtml(item.status || "pending")} / ${escapeHtml(item.records || 0)} records</span>
    <small>${escapeHtml(item.owner || "")}</small>
  </div>`).join("") || `<div><strong>No evidence</strong><span>Waiting for platform evidence records.</span></div>`;
}

function collectStaticOpenActions(state, applications) {
  return collectStaticTaskActions(state, applications).filter((item) => !item.closed).slice(0, 12);
}

function collectStaticTaskActions(state, applications) {
  const appByCollection = Object.fromEntries(applications.flatMap((app) =>
    app.collections.map((item) => [item.collection, app])
  ));
  return DASHBOARD_TASK_COLLECTIONS
    .flatMap((collection) => {
      const app = appByCollection[collection] || applications[0];
      return (Array.isArray(state[collection]) ? state[collection] : []).map((item) => {
        const status = item.status || item.reviewStatus || item.authorizationStatus || item.state || "";
        const dueAt = item.dueAt || item.due || item.nextReview || item.plannedAt || item.requestedAt || item.lastUpdated || item.createdAt || "";
        const closed = isClosedDashboardStatus(status);
        return {
        id: item.id || `${collection}-task`,
        collection,
        applicationId: app.id,
        application: app.name,
        entry: app.entry,
        title: item.title || item.taskName || item.topic || item.orderType || item.item || item.claimType || item.medication || item.name || collection,
        owner: item.owner || item.assignee || item.institution || item.center || item.sourceInstitution || item.targetInstitution || "owner-pending",
        status: status || "open",
        region: item.region || item.district || item.area || "",
        priority: dashboardPriority(item),
        dueAt,
        updatedAt: item.updatedAt || item.lastUpdated || item.createdAt || item.reportDate || dueAt,
        closed,
        overdue: !closed && isDashboardOverdue(dueAt, item)
      };
      });
    });
}

function isClosedDashboardStatus(status) {
  return /closed|resolved|approved|recognized|completed|passed|ready|signed|done|已完成|已通过|已闭环/.test(String(status || ""));
}

function isDashboardOverdue(dueAt, item = {}) {
  const text = [item.status, item.priority, item.level, item.risk, item.riskLevel].filter(Boolean).join(" ");
  if (/overdue|逾期|超期|已逾期/i.test(text)) return true;
  const dueDate = parseDashboardDate(dueAt);
  if (!dueDate) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return dueDate < today;
}

function dashboardPriority(item) {
  const text = [item.priority, item.level, item.risk, item.riskLevel, item.status].filter(Boolean).join(" ");
  if (/high|urgent|critical|overdue|高|逾期|危急/i.test(text)) return "high";
  if (/medium|warning|中|待/i.test(text)) return "medium";
  return "normal";
}

function countRows(value) {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === "object") return Object.values(value).reduce((sum, item) => sum + (Array.isArray(item) ? item.length : 0), 0);
  return 0;
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
