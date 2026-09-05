(function () {
  "use strict";

  const API_AVAILABLE = location.protocol !== "file:" && !location.hostname.endsWith("github.io");
  const CENTER_ENDPOINT = "/api/runtime/ai-governance/center";
  const $ = (selector) => document.querySelector(selector);
  const state = { center: null, keyword: "", risk: "all", status: "all" };

  const fallback = {
    schemaVersion: "platform-ai-governance-center-v1",
    capabilityId: "L-GOV-AI",
    productionReady: false,
    decision: "NO-GO",
    scope: { role: "static-preview", dataScope: "governance-metadata-only", personalDataVisible: false, clinicalContentVisible: false, sourceRecordDetailVisible: false },
    actions: { queryGovernance: false, viewSourceRecordDetail: false, approveModel: false, activateModel: false, automaticDiagnosis: false, automaticOrder: false, automaticPrescription: false, automaticPublicHealthDecision: false, productionActivation: false },
    summary: { useCases: 4, criticalRiskUseCases: 2, highOrCriticalRiskUseCases: 4, authorizedSourceBindings: 4, pendingOwnerBindings: 3, observedRecords: 0, controls: 8, blockedControls: 4, openRisks: 5, productionEligibleUseCases: 0 },
    useCases: [
      { id: "clinical-decision-support", title: "临床决策支持", capabilityId: "J-CLIN-CDSS", ownerProcess: "T06", ownerDomain: "临床专科", riskLevel: "critical", lifecycleStatus: "restricted-pilot", intendedUse: "向临床人员提示需要人工核对的诊疗风险", decisionImpact: "影响诊疗判断，必须由具备资质的临床人员独立复核", observedRecords: 0, humanOversightRequired: true, automaticDecisionAllowed: false, productionEligible: false, sourceBindings: [{ collection: "phase2ClinicalAssistRules", dataOwner: "clinical-specialties", access: "approved-read", recordCount: 0, status: "source-empty" }], governanceFindings: ["缺少独立验证、效果基线和生产现场签字"] },
      { id: "research-risk-models", title: "科研专病风险模型", capabilityId: "research-disease-models", ownerProcess: "T09", ownerDomain: "科研共享", riskLevel: "high", lifecycleStatus: "registry-only", intendedUse: "在伦理、授权和脱敏边界内管理专病研究模型", decisionImpact: "仅用于科研队列和人工研究复核，不得直接进入临床诊疗", observedRecords: 0, humanOversightRequired: true, automaticDecisionAllowed: false, productionEligible: false, sourceBindings: [{ collection: "diseaseRegistryModels", dataOwner: "research", access: "approved-read", recordCount: 0, status: "source-empty" }], governanceFindings: ["缺少独立验证、效果基线和生产现场签字"] },
      { id: "public-health-investigation-assist", title: "公共卫生研判辅助", capabilityId: "public-health-ai-review", ownerProcess: "T03", ownerDomain: "公共卫生", riskLevel: "high", lifecycleStatus: "source-binding-pending", intendedUse: "辅助工作人员识别需要人工核查的公共卫生线索", decisionImpact: "不得自动发布信息、替代流调结论或自动升级重大事件", observedRecords: 0, humanOversightRequired: true, automaticDecisionAllowed: false, productionEligible: false, sourceBindings: [{ collection: "publicHealthAiReviews", dataOwner: "unresolved", access: "owner-handoff-required", recordCount: null, status: "owner-handoff-required" }], governanceFindings: ["来源尚未完成数据 Owner 授权接线"] },
      { id: "primary-care-decision-assist", title: "基层诊疗辅助", capabilityId: "primary-care-ai-assist", ownerProcess: "T05", ownerDomain: "服务协同", riskLevel: "critical", lifecycleStatus: "source-binding-pending", intendedUse: "为基层临床人员提供风险线索的人工复核入口", decisionImpact: "不得自动形成诊断、处方、医嘱或转诊结论", observedRecords: 0, humanOversightRequired: true, automaticDecisionAllowed: false, productionEligible: false, sourceBindings: [{ collection: "countyAiDiagnosisCases", dataOwner: "unresolved", access: "owner-handoff-required", recordCount: null, status: "owner-handoff-required" }], governanceFindings: ["来源尚未完成数据 Owner 授权接线"] }
    ],
    controls: [
      { id: "inventory-accountability", name: "场景清单与责任归属", status: "partial", evidence: "4 个场景已登记", blocker: "部分来源责任与跨域只读授权待闭合" },
      { id: "intended-use", name: "预期用途与禁用边界", status: "repository-controlled", evidence: "所有场景声明用途、人工监督和禁止自动决策", blocker: "外部责任方签字待完成" },
      { id: "validation", name: "独立验证与效果评估", status: "blocked", evidence: "仓库只验证结构和安全边界", blocker: "缺少基线样本、分层阈值和独立评估" },
      { id: "incident-response", name: "事件响应、暂停与回滚", status: "blocked", evidence: "生产激活固定禁用", blocker: "缺少不良事件、暂停、回滚和复盘流程" }
    ],
    risks: [{ id: "platform-ai-incident-workflow", useCaseId: "cross-domain", title: "平台级 AI 事件处置流程未现场验证", severity: "critical", status: "open", responsibleProcess: "T01", nextAction: "建立报告、分级、暂停、回滚、通知和复盘闭环" }],
    safetyBoundaries: ["中心仅展示跨域治理元数据，不展示居民、机构或临床明细", "所有高风险输出必须由具备职责和资质的人员独立复核", "不得自动形成诊断、医嘱、处方、疫情发布、转诊或生产放行决定"],
    blockers: ["跨域来源 Owner 与最小投影合同尚未全部闭合", "独立验证、漂移、公平性和不良事件生产证据缺失", "真实身份、电子签名、暂停、回滚和现场签字尚未完成"]
  };

  function element(tag, options = {}, children = []) {
    const node = document.createElement(tag);
    if (options.className) node.className = options.className;
    if (options.text !== undefined) node.textContent = String(options.text);
    if (options.attrs) Object.entries(options.attrs).forEach(([key, value]) => node.setAttribute(key, String(value)));
    node.append(...children.filter(Boolean));
    return node;
  }

  function replace(target, children, emptyText) {
    target.replaceChildren(...(children.length ? children : [element("p", { className: "muted", text: emptyText })]));
  }

  function label(value) {
    const labels = {
      critical: "重大风险", high: "高风险", open: "待处置", partial: "部分闭合", blocked: "阻断",
      controlled: "已控制", "repository-controlled": "仓库已控制", "restricted-pilot": "受限试点",
      "registry-only": "仅登记", "source-binding-pending": "来源待接线", "approved-read": "已授权只读",
      "owner-handoff-required": "待 Owner 接线", "repository-observed": "仓库已观测", "source-empty": "来源为空"
    };
    return labels[String(value || "")] || String(value || "未记录");
  }

  function badge(value) {
    const text = String(value || "unknown");
    const className = /critical|high|blocked|open|pending/i.test(text) ? "badge danger" : /partial|restricted|registry|empty/i.test(text) ? "badge warn" : "badge info";
    return element("span", { className, text: label(text) });
  }

  function setBanner(title, detail, tone = "normal") {
    $("#ai-governance-source-title").textContent = title;
    $("#ai-governance-source-detail").textContent = detail;
    $("#ai-governance-source-banner").dataset.tone = tone;
  }

  async function requestCenter() {
    if (!API_AVAILABLE) throw new Error("静态发布未连接治理服务");
    const request = window.HealthCityAuth?.authFetch || fetch;
    const response = await request(CENTER_ENDPOINT);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message || `服务返回 ${response.status}`);
    return payload;
  }

  async function load() {
    $("#ai-governance-refresh").disabled = true;
    try {
      state.center = await requestCenter();
      setBanner("平台人工智能治理服务已连接", "当前仅展示跨域治理元数据；个人、机构、临床正文和未授权源记录均不可见。", "normal");
    } catch (error) {
      state.center = fallback;
      setBanner("当前为只读治理结构预览", `${error.message || "治理服务不可用"}。页面不会审批、激活模型或生成生产证据。`, "warning");
    } finally {
      $("#ai-governance-refresh").disabled = false;
      render();
    }
  }

  function metric(name, value, detail) {
    return element("article", { className: "work-metric-card" }, [element("span", { text: name }), element("strong", { text: value }), element("small", { text: detail })]);
  }

  function renderMetrics() {
    const summary = state.center.summary || {};
    $("#ai-governance-decision").textContent = state.center.decision || "NO-GO";
    replace($("#ai-governance-metrics"), [
      metric("AI 场景", summary.useCases || 0, `${summary.highOrCriticalRiskUseCases || 0} 项为高风险或重大风险`),
      metric("已授权来源", summary.authorizedSourceBindings || 0, `${summary.pendingOwnerBindings || 0} 项待 Owner 接线`),
      metric("控制矩阵", summary.controls || 0, `${summary.blockedControls || 0} 项仍阻断`),
      metric("开放风险", summary.openRisks || 0, "需责任域与现场共同闭合"),
      metric("生产可用场景", summary.productionEligibleUseCases || 0, "生产激活固定禁用")
    ], "暂无治理指标。");
  }

  function filteredUseCases() {
    const keyword = state.keyword;
    return (state.center.useCases || []).filter((item) => {
      const text = [item.id, item.title, item.capabilityId, item.ownerProcess, item.ownerDomain, item.intendedUse].join(" ").toLowerCase();
      return (!keyword || text.includes(keyword)) && (state.risk === "all" || item.riskLevel === state.risk) && (state.status === "all" || item.lifecycleStatus === state.status);
    });
  }

  function renderUseCases() {
    const items = filteredUseCases();
    $("#ai-governance-use-case-count").textContent = `${items.length} 项`;
    replace($("#ai-governance-use-cases"), items.map((item) => element("article", { className: "ai-governance-card" }, [
      element("header", {}, [element("div", {}, [element("h3", { text: item.title }), element("p", { className: "ai-governance-meta", text: `${item.capabilityId} · ${item.ownerProcess}/${item.ownerDomain}` })]), badge(item.riskLevel)]),
      element("p", { text: `预期用途：${item.intendedUse}` }),
      element("p", { text: `决策边界：${item.decisionImpact}` }),
      element("div", { className: "ai-governance-source-list" }, (item.sourceBindings || []).map((source) => element("div", { className: "ai-governance-source" }, [
        element("span", { text: `${source.collection} · ${source.dataOwner}` }),
        element("strong", { text: source.recordCount === null ? label(source.access) : `${source.recordCount || 0} 条 · ${label(source.status)}` })
      ]))),
      element("div", {}, [badge(item.lifecycleStatus), element("p", { className: "ai-governance-meta", text: `人工监督：强制 · 自动决策：禁止 · 已观测元数据：${item.observedRecords || 0} 条` })]),
      element("ul", { className: "ai-governance-findings" }, (item.governanceFindings || []).map((finding) => element("li", { text: finding })))
    ])), "当前筛选条件下暂无人工智能场景。");
  }

  function renderControls() {
    const items = state.center.controls || [];
    $("#ai-governance-control-count").textContent = `${items.length} 项`;
    replace($("#ai-governance-controls"), items.map((item) => element("tr", {}, [
      element("td", {}, [element("strong", { text: item.name }), element("small", { text: item.id })]),
      element("td", {}, [badge(item.status)]),
      element("td", { text: item.evidence }),
      element("td", { text: item.blocker || "当前仓库边界已闭合" })
    ])), "暂无控制矩阵。");
  }

  function renderRisks() {
    const items = state.center.risks || [];
    $("#ai-governance-risk-count").textContent = `${items.length} 项`;
    replace($("#ai-governance-risks"), items.map((item) => element("article", { className: "ai-governance-risk" }, [
      element("header", {}, [element("div", {}, [element("h3", { text: item.title }), element("p", { text: `${item.useCaseId} · 责任 ${item.responsibleProcess}` })]), badge(item.severity)]),
      element("p", { text: `下一步：${item.nextAction}` })
    ])), "暂无开放风险。");
  }

  function renderBoundaries() {
    replace($("#ai-governance-boundaries"), (state.center.safetyBoundaries || []).map((item) => element("li", { text: item })), "暂无安全边界说明。");
    replace($("#ai-governance-blockers"), (state.center.blockers || []).map((item) => element("li", { text: item })), "暂无上线阻断项。");
  }

  function render() {
    renderMetrics();
    renderUseCases();
    renderControls();
    renderRisks();
    renderBoundaries();
  }

  function bind() {
    $("#ai-governance-refresh").addEventListener("click", load);
    $("#ai-governance-search").addEventListener("input", (event) => { state.keyword = event.target.value.trim().toLowerCase(); renderUseCases(); });
    $("#ai-governance-risk-filter").addEventListener("change", (event) => { state.risk = event.target.value; renderUseCases(); });
    $("#ai-governance-status-filter").addEventListener("change", (event) => { state.status = event.target.value; renderUseCases(); });
  }

  document.addEventListener("DOMContentLoaded", () => { bind(); load(); });
})();
