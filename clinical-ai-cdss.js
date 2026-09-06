(function () {
  "use strict";

  const API_AVAILABLE = location.protocol !== "file:" && !location.hostname.endsWith("github.io");
  const CENTER_ENDPOINT = "/api/quality-safety/ai-cdss/center";
  const $ = (selector) => document.querySelector(selector);
  const state = { center: null, source: "static", keyword: "", risk: "all", review: "all" };

  const fallback = {
    schemaVersion: "clinical-ai-cdss-governance-center-v1",
    sourceRequirement: "J-CLIN-CDSS",
    upstreamGovernanceRequirement: { id: "L-GOV-AI", status: "declared-only", ownerProcess: "T01", note: "平台级人工智能治理能力仍由责任域后续建设。" },
    productionReady: false,
    decision: "NO-GO",
    scope: { role: "static-preview", organizationCode: "未连接授权机构", crossInstitutionVisible: false, clinicalDetailVisible: false, doctorBound: false },
    actions: { queryGovernance: false, viewClinicalRecommendation: false, submitHumanReview: false, configureRules: false, automaticDiagnosis: false, automaticOrder: false, automaticPrescription: false, productionActivation: false },
    summary: { rules: 1, governedRules: 0, restrictedRules: 1, suggestions: 1, pendingHumanReview: 1, reviewed: 0, evidenceBound: 1, reviewReceipts: 0, openGovernanceSignals: 2, integrationContracts: 1 },
    ruleCards: [{ id: "rule-demo", name: "重复检验提醒", categoryLabel: "重复检验提醒", algorithmClass: "deterministic-rules-engine", sourceSystem: "临床业务系统", version: "待建立版本基线", lifecycleStatus: "restricted-pilot", configurationStatus: "active", riskLevel: "high", intendedUse: "发现可能重复的检验申请并提示临床人员核对", recommendedReview: "核对既有报告后由医生独立决定是否保留申请", requiredEvidenceFields: ["residentId", "doctorId", "labItem"], accountableRole: "临床业务与医疗质量联合责任人", humanReviewRequired: true, autoExecutionAllowed: false, prohibitedUses: ["不得自动形成诊断结论", "不得自动开立或取消医嘱与处方"], governanceFindings: ["缺少可追溯规则版本", "缺少独立审批证据"] }],
    suggestions: [{ id: "suggestion-demo", ruleId: "rule-demo", categoryLabel: "重复检验提醒", title: "重复检验提醒", riskLevel: "high", institutionReference: "授权范围待连接", residentReference: "", practitionerReference: "", evidenceBound: true, evidenceReference: "", recommendation: "", pluginSurface: "doctor-workstation-banner", dueAt: "", reviewStatus: "pending-human-review", doctorActionLabel: "待人工复核", humanReviewRequired: true, autoExecutionAllowed: false, actions: { submitReview: false, reviewEndpoint: "" } }],
    reviewLedger: [],
    monitoring: { telemetryAvailable: false, outcomeDriftEvaluated: false, incidentWorkflowAvailable: false, humanReviewCoverage: 0, signals: [{ id: "rule-governance-rule-demo", type: "model-governance-gap", severity: "high", subjectReference: "rule-demo", status: "open", detail: "缺少可追溯规则版本；缺少独立审批证据" }, { id: "pending-human-review-backlog", type: "human-review-backlog", severity: "medium", subjectReference: "authorized-scope", status: "monitoring", detail: "1 条建议等待临床人员复核" }], blockers: ["缺少经审批的基线样本、效果指标和分层阈值"] },
    integrationContracts: [{ id: "p2ca-plugin-workstation", name: "医生工作站提醒协议", endpoint: "GET /api/phase2/clinical-assist", surface: "doctor-workstation-banner", payloadFields: ["alertId", "residentId", "doctorId", "ruleId"], repositoryStatus: "mvp-ready", productionStatus: "external-evidence-required", blocker: "真实临床系统接入、身份映射、签名回执与现场联合验收待完成" }],
    safetyBoundaries: ["所有输出均为临床人员复核建议，不构成诊断或治疗决定", "建议必须展示规则来源、证据绑定和人工处理状态", "仓库验证不能替代临床验证、伦理审查、厂商联调和现场签字"],
    blockers: ["真实临床工作站嵌入与单点登录仍需现场联调", "规则审批、灰度、回滚和效果监测证据尚未闭环", "平台级人工智能治理能力仍待建设"]
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

  function badge(value) {
    const text = String(value || "unknown");
    const tone = /high|open|blocked|restricted|NO-GO/i.test(text) ? "danger" : /medium|pending|monitoring|external/i.test(text) ? "warning" : "normal";
    return element("span", { className: `badge ${tone === "warning" ? "warn" : tone === "danger" ? "danger" : "info"}`, text: label(text) });
  }

  function label(value) {
    const labels = {
      high: "高风险", medium: "中风险", low: "低风险", open: "待处置", monitoring: "监测中",
      "restricted-pilot": "受限试点", "governed-active": "受控启用", active: "已启用", paused: "已暂停",
      "pending-human-review": "待人工复核", reviewed: "已人工复核", "external-evidence-required": "待外部证据",
      "mvp-ready": "仓库已实现", "model-governance-gap": "规则治理缺口", "human-review-backlog": "人工复核积压",
      "evidence-lineage-gap": "证据血缘缺口", "review-lineage-gap": "回执血缘缺口"
    };
    return labels[String(value || "")] || String(value || "未记录");
  }

  function setBanner(title, detail, tone = "normal") {
    $("#clinical-ai-source-title").textContent = title;
    $("#clinical-ai-source-detail").textContent = detail;
    $("#clinical-ai-source-banner").dataset.tone = tone;
  }

  async function requestCenter() {
    if (!API_AVAILABLE) throw new Error("静态发布未连接业务服务");
    const request = window.HealthCityAuth?.authFetch || fetch;
    const response = await request(CENTER_ENDPOINT);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message || `服务返回 ${response.status}`);
    return payload;
  }

  async function load() {
    $("#clinical-ai-refresh").disabled = true;
    try {
      state.center = await requestCenter();
      state.source = "api";
      setBanner("临床决策支持治理服务已连接", `当前按 ${state.center.scope?.organizationCode || "授权范围"} 展示；敏感临床内容遵循最小必要原则。`, "normal");
    } catch (error) {
      state.center = fallback;
      state.source = "static";
      setBanner("当前为只读结构预览", `${error.message || "业务服务不可用"}。页面不会提交回执、修改规则或伪造生产证据。`, "warning");
    } finally {
      $("#clinical-ai-refresh").disabled = false;
      render();
    }
  }

  function metric(labelText, value, detail) {
    return element("article", { className: "work-metric-card" }, [
      element("span", { text: labelText }),
      element("strong", { text: value }),
      element("small", { text: detail })
    ]);
  }

  function renderMetrics() {
    const summary = state.center.summary || {};
    $("#clinical-ai-decision").textContent = state.center.decision || "NO-GO";
    replace($("#clinical-ai-metrics"), [
      metric("规则/模型卡", summary.rules || 0, `${summary.restrictedRules || 0} 项仍受限`),
      metric("授权范围建议", summary.suggestions || 0, `${summary.evidenceBound || 0} 条已绑定证据`),
      metric("待人工复核", summary.pendingHumanReview || 0, `${summary.reviewed || 0} 条已复核`),
      metric("安全治理信号", summary.openGovernanceSignals || 0, "漂移与事件监测仍需外部证据"),
      metric("集成合同", summary.integrationContracts || 0, "生产接入必须完成现场联调")
    ], "暂无治理指标。");
  }

  function definition(term, value) {
    return element("div", {}, [element("dt", { text: term }), element("dd", { text: value || "未记录" })]);
  }

  function renderRules() {
    const rules = state.center.ruleCards || [];
    $("#clinical-ai-rule-count").textContent = `${rules.length} 项`;
    replace($("#clinical-ai-rules"), rules.map((rule) => element("article", { className: "clinical-ai-rule-card" }, [
      element("header", {}, [
        element("div", {}, [element("h3", { text: rule.name }), element("p", { className: "clinical-ai-rule-meta", text: `${rule.id} · ${rule.categoryLabel}` })]),
        badge(rule.lifecycleStatus)
      ]),
      element("p", { className: "clinical-ai-rule-use", text: rule.intendedUse }),
      element("dl", {}, [
        definition("算法类别", rule.algorithmClass), definition("风险等级", label(rule.riskLevel)),
        definition("规则版本", rule.version), definition("配置状态", label(rule.configurationStatus)),
        definition("来源系统", rule.sourceSystem), definition("人工复核", rule.humanReviewRequired ? "强制" : "未要求")
      ]),
      element("p", { className: "clinical-ai-rule-use", text: rule.decisionAvailable === false ? "治理未批准或来源漂移：建议不可采纳" : `建议复核：${rule.recommendedReview}` }),
      element("ul", {}, (rule.governanceFindings || []).map((item) => element("li", { text: item })))
    ])), "暂无授权规则/模型卡。");
  }

  function filteredSuggestions() {
    const keyword = state.keyword;
    return (state.center.suggestions || []).filter((item) => {
      const matchesKeyword = !keyword || [item.id, item.ruleId, item.title, item.categoryLabel, item.residentReference, item.practitionerReference].join(" ").toLowerCase().includes(keyword);
      return matchesKeyword && (state.risk === "all" || item.riskLevel === state.risk) && (state.review === "all" || item.reviewStatus === state.review);
    });
  }

  function renderSuggestions() {
    const suggestions = filteredSuggestions();
    $("#clinical-ai-suggestion-count").textContent = `${suggestions.length} 条`;
    replace($("#clinical-ai-suggestions"), suggestions.map((item) => element("tr", {}, [
      element("td", {}, [element("strong", { text: item.title }), element("small", { text: `${item.ruleId} · ${item.categoryLabel}` })]),
      element("td", {}, [element("strong", { text: item.institutionReference }), element("small", { text: [item.residentReference, item.practitionerReference].filter(Boolean).join(" · ") || "治理汇总不展示个人引用" })]),
      element("td", {}, [element("strong", { text: item.evidenceBound ? "已绑定规则证据" : "证据待补" }), element("small", { text: item.evidenceReference || "当前范围不展示证据引用" })]),
      element("td", {}, [badge(item.reviewStatus), element("small", { text: item.doctorActionLabel })]),
      element("td", {}, [badge(item.riskLevel), element("small", { text: item.decisionAvailable === false ? "建议不可采纳；可登记保留理由" : "禁止自动执行" })])
    ])), "当前筛选条件下暂无临床建议。");
  }

  function renderReviews() {
    const reviews = state.center.reviewLedger || [];
    $("#clinical-ai-review-count").textContent = `${reviews.length} 条`;
    replace($("#clinical-ai-reviews"), reviews.map((item) => element("article", { className: "clinical-ai-card" }, [
      element("header", {}, [element("div", {}, [element("h3", { text: item.doctorActionLabel }), element("p", { text: `${item.suggestionId} · ${item.categoryLabel}` })]), badge(item.receiptStatus)]),
      element("p", { text: `${item.practitionerReference || "当前范围不展示执业人员引用"} · ${item.reviewedAt || "时间未记录"} · ${item.channel || "渠道未记录"}` }),
      element("p", { text: item.actionDetail || "当前账号范围不展示复核说明。" })
    ])), "暂无授权范围内人工复核回执。");
  }

  function renderSignals() {
    const monitoring = state.center.monitoring || {};
    const signals = monitoring.signals || [];
    $("#clinical-ai-signal-count").textContent = `${signals.length} 项`;
    $("#clinical-ai-review-coverage").textContent = `${Number(monitoring.humanReviewCoverage || 0).toFixed(1)}%`;
    replace($("#clinical-ai-signals"), signals.map((item) => element("article", { className: "clinical-ai-card" }, [
      element("header", {}, [element("div", {}, [element("h3", { text: label(item.type) }), element("p", { text: item.subjectReference })]), badge(item.severity)]),
      element("p", { text: item.detail })
    ])), "当前授权范围暂无安全信号。");
  }

  function renderContracts() {
    const contracts = state.center.integrationContracts || [];
    $("#clinical-ai-contract-count").textContent = `${contracts.length} 项`;
    replace($("#clinical-ai-contracts"), contracts.map((item) => element("article", { className: "clinical-ai-contract" }, [
      element("strong", { text: item.name }),
      element("span", { text: item.endpoint }),
      element("span", { text: `嵌入面：${item.surface || "待定义"}` }),
      element("span", { text: `仓库：${label(item.repositoryStatus)} · 生产：${label(item.productionStatus)}` }),
      element("span", { text: item.blocker })
    ])), "暂无临床系统集成合同。");
  }

  function renderBoundaries() {
    replace($("#clinical-ai-boundaries"), (state.center.safetyBoundaries || []).map((item) => element("li", { text: item })), "暂无安全边界说明。");
    replace($("#clinical-ai-blockers"), (state.center.blockers || []).map((item) => element("li", { text: item })), "暂无上线阻断项。");
    const upstream = state.center.upstreamGovernanceRequirement || {};
    $("#clinical-ai-upstream").textContent = `${upstream.id || "L-GOV-AI"} · ${label(upstream.status)}：${upstream.note || "平台级人工智能治理能力仍待建设。"}`;
  }

  function render() {
    renderMetrics();
    renderRules();
    renderSuggestions();
    renderReviews();
    renderSignals();
    renderContracts();
    renderBoundaries();
  }

  $("#clinical-ai-refresh").addEventListener("click", load);
  $("#clinical-ai-search").addEventListener("input", (event) => { state.keyword = event.target.value.trim().toLowerCase(); renderSuggestions(); });
  $("#clinical-ai-risk-filter").addEventListener("change", (event) => { state.risk = event.target.value; renderSuggestions(); });
  $("#clinical-ai-review-filter").addEventListener("change", (event) => { state.review = event.target.value; renderSuggestions(); });

  load();
})();
