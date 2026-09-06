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

"use strict";

(function initializeAiGovernanceWorkbench() {
  const auth = window.HealthCityAuth;
  const state = { rules: [], ready: false, busy: false, selected: null, pending: null };
  const $ = (selector) => document.querySelector(selector);
  const labels = { unregistered: "未登记", stale: "来源漂移，待重新登记", draft: "草稿", submitted: "待独立审批", approved: "治理已批准", rejected: "已拒绝", suspended: "已停用" };
  const actions = { register: "登记元数据", submit: "送交独立审批", approve: "独立批准", reject: "独立拒绝", suspend: "停用", rollback: "回滚至草稿" };
  const allowedActions = { unregistered: ["register"], stale: ["register"], draft: ["register", "submit"], submitted: ["approve", "reject"], approved: ["suspend"], rejected: ["register", "rollback"], suspended: ["register", "rollback"] };
  const cardFields = { sourceRef: "#ai-source-ref", sourceDigest: "#ai-source-digest", ruleVersion: "#ai-rule-version", evidenceRef: "#ai-evidence-ref", evidenceDigest: "#ai-evidence-digest", riskLevel: "#ai-risk-level" };
  const el = (tag, text) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = String(text);
    return node;
  };

  function banner(title, detail, tone = "warning") {
    $("#ai-source-title").textContent = title;
    $("#ai-source-detail").textContent = detail;
    $("#ai-source-banner").dataset.tone = tone;
  }

  async function request(path, options = {}) {
    const response = await (auth?.authFetch || fetch)(path, { credentials: "same-origin", ...options });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(response.status === 403 ? "当前账号无权执行此治理操作。" : (payload.message || payload.error || `请求失败（${response.status}）`));
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  function setBusy(value) {
    state.busy = value;
    $("#ai-refresh").disabled = value;
    $("#ai-submit").disabled = value || !state.ready;
    $("#ai-action").disabled = value;
    $("#ai-card-fields").disabled = value || $("#ai-action").value !== "register";
    document.querySelectorAll("[data-ai-select]").forEach((button) => {
      const rule = state.rules.find((item) => item.id === button.dataset.aiSelect);
      button.disabled = value || !state.ready || !allowedActions[rule?.governance?.status]?.length;
    });
  }

  function render(summary = {}) {
    const metrics = $("#ai-summary");
    metrics.replaceChildren();
    Object.entries({ total: "规则总数", submitted: "待审批", approved: "治理已批准", suspended: "已停用", stale: "来源漂移待登记" }).forEach(([key, label]) => {
      const card = el("article");
      card.className = "work-metric";
      card.append(el("span", label), el("strong", Number.isSafeInteger(summary[key]) ? summary[key] : 0));
      metrics.append(card);
    });
    const list = $("#ai-rules");
    list.replaceChildren();
    if (!state.rules.length) list.append(el("p", state.ready ? "当前没有可治理的临床辅助规则。" : "尚未取得授权治理数据，请查看状态提示后重试。"));
    state.rules.forEach((rule) => {
      const governance = rule.governance || {};
      const card = governance.card || {};
      const article = el("article");
      article.className = "ai-rule-card";
      article.append(el("h3", rule.id), el("p", `${labels[governance.status] || "未知状态（操作禁用）"} · 治理版本 ${governance.version ?? 0}`));
      if (governance.status === "stale") article.append(el("p", `当前规则来源已变化。历史状态：${labels[governance.storedStatus] || "未记录"}；历史批准不适用于当前来源，必须重新登记并独立复核。`));
      article.append(el("p", `来源引用：${card.sourceRef || "未登记"} · 规则版本：${card.ruleVersion || "未登记"} · 风险：${card.riskLevel || "待评估"}`));
      article.append(el("p", `来源摘要：${card.sourceDigest || "未登记"}`), el("p", `证据引用：${card.evidenceRef || "未登记"} · 摘要：${card.evidenceDigest || "未登记"}`));
      article.append(el("p", `送审人：${governance.submittedBy || "未送审"} · 复核人：${governance.reviewedBy || "未复核"} · 生产未就绪`));
      const button = el("button", "管理此规则");
      button.type = "button";
      button.className = "secondary-work-button";
      button.dataset.aiSelect = rule.id;
      button.disabled = !state.ready || !allowedActions[governance.status]?.length;
      article.append(button);
      list.append(article);
    });
  }

  function selectRule(id) {
    if (!state.ready || state.busy) return;
    state.selected = state.rules.find((rule) => rule.id === id) || null;
    if (!state.selected) return;
    const governance = state.selected.governance;
    $("#ai-selected-rule").textContent = `${id} · 预期治理版本 ${governance.version}`;
    $("#ai-action").replaceChildren(...(allowedActions[governance.status] || []).map((action) => {
      const option = el("option", actions[action]);
      option.value = action;
      return option;
    }));
    Object.entries(cardFields).forEach(([key, selector]) => { $(selector).value = governance.card?.[key] || (key === "riskLevel" ? "medium" : ""); });
    $("#ai-source-digest").value = governance.sourceDigest || "";
    $("#ai-command-panel").hidden = false;
    updateAction();
  }

  function updateAction() {
    const needsCard = $("#ai-action").value === "register";
    $("#ai-card-fields").hidden = !needsCard;
    $("#ai-card-fields").disabled = !needsCard || state.busy;
    $("#ai-submit").disabled = state.busy || !state.ready || !$("#ai-action").value;
  }

  async function load() {
    state.ready = false;
    state.rules = [];
    state.selected = null;
    $("#ai-command-panel").hidden = true;
    setBusy(true);
    render();
    banner("正在读取治理状态", "校验治理账号权限。");
    try {
      if (location.protocol === "file:" || location.hostname.endsWith("github.io")) throw new Error("静态预览未连接治理服务，无法执行治理操作。");
      const center = await request("/api/ai-governance/center");
      if (center.contractVersion !== "ai-governance.v1" || center.productionReady !== false || !Array.isArray(center.rules)
        || center.rules.some((rule) => typeof rule?.id !== "string" || !Number.isSafeInteger(rule.governance?.version) || rule.governance.version < 0)) throw new Error("治理响应契约不兼容，操作已禁用。");
      state.rules = center.rules;
      state.ready = true;
      render(center.summary);
      banner("治理数据已连接", "治理批准不等于生产准入。生产保持 NO-GO，等待真实验证和现场证据。", "normal");
    } catch (error) {
      render();
      banner(error.status === 403 ? "无权访问治理中心" : "治理数据读取失败", error.message, "danger");
    } finally {
      setBusy(false);
    }
  }

  async function submit(event) {
    event.preventDefault();
    if (!state.ready || state.busy || !state.selected) return;
    const action = $("#ai-action").value;
    const selected = state.selected;
    if (!allowedActions[selected.governance.status]?.includes(action)) return;
    const body = { action, expectedVersion: selected.governance.version };
    if (action === "register") body.card = Object.fromEntries(Object.entries(cardFields).map(([key, selector]) => [key, $(selector).value.trim()]));
    const fingerprint = JSON.stringify({ id: selected.id, ...body });
    setBusy(true);
    try {
      if (state.pending?.fingerprint !== fingerprint) state.pending = { fingerprint, key: `ai-governance-${crypto.randomUUID()}` };
      body.idempotencyKey = state.pending.key;
      await request(`/api/ai-governance/rules/${encodeURIComponent(selected.id)}/actions`, {
        method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": body.idempotencyKey }, body: JSON.stringify(body)
      });
      state.pending = null;
      await load();
    } catch (error) {
      banner("治理操作未确认", `${error.message} 请核对后重试；相同操作重试复用幂等键。版本冲突请先刷新。`, "danger");
    } finally {
      setBusy(false);
    }
  }

  $("#ai-refresh").addEventListener("click", load);
  $("#ai-action").addEventListener("change", updateAction);
  $("#ai-command-form").addEventListener("submit", submit);
  $("#ai-rules").addEventListener("click", (event) => {
    const button = event.target.closest("[data-ai-select]");
    if (button) selectRule(button.dataset.aiSelect);
  });
  load();
})();
