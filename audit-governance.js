(function () {
  "use strict";

  const API_AVAILABLE = location.protocol !== "file:" && !location.hostname.endsWith("github.io");
  const CENTER_ENDPOINT = "/api/security/audit-governance/center";
  const $ = (selector) => document.querySelector(selector);
  const state = { center: null };

  const fallback = {
    schemaVersion: "platform-audit-governance-center-v1",
    capabilityId: "L-GOV-AUDIT",
    productionReady: false,
    decision: "NO-GO",
    scope: { role: "static-preview", actorDetailVisible: false, subjectDetailVisible: false, targetDetailVisible: false, purposeDetailVisible: false, rawExportAvailable: false },
    actions: { queryGovernance: false, viewRawEvents: false, exportRawEvents: false, repairAuditChain: false, activateDeliveryWorker: false, approveRetention: false, productionActivation: false },
    summary: { sources: 2, totalRecords: 0, dataAccessRecords: 0, deniedEvents: 0, highRiskEvents: 0, controls: 8, blockedControls: 3, openRisks: 4, productionEligible: false },
    sources: [
      { collection: "securityEvents", title: "安全事件链", owner: "identity-security", classification: "restricted", recordCount: 0, chainVersion: "audit-chain-v2", integrityPassed: true, headDigest: "", detailVisible: false },
      { collection: "dataAccessLogs", title: "数据访问链", owner: "identity-security", classification: "restricted", recordCount: 0, chainVersion: "audit-chain-v2", integrityPassed: true, headDigest: "", detailVisible: false }
    ],
    distributions: {
      results: [{ id: "allowed", count: 0 }, { id: "denied", count: 0 }, { id: "other", count: 0 }],
      categories: [{ id: "authentication", count: 0 }, { id: "authorization", count: 0 }, { id: "data-access", count: 0 }, { id: "sensitive-change", count: 0 }, { id: "audit-delivery", count: 0 }, { id: "operational-security", count: 0 }],
      roles: [{ id: "commission", count: 0 }, { id: "institution", count: 0 }, { id: "insurance", count: 0 }, { id: "primary-care", count: 0 }, { id: "clinical-staff", count: 0 }, { id: "resident", count: 0 }, { id: "system-or-adapter", count: 0 }, { id: "other", count: 0 }],
      activityByDay: []
    },
    delivery: { appendOnlySourceContract: "append-only-audit-source-v2", sourceContractConfigured: false, siemTargetConfigured: false, wormTargetConfigured: false, exactlyOneDeliveryTargetConfigured: false, retentionTargetConfigured: false, trustedExternalReceiptObserved: false, externalMonotonicAnchorObserved: false, workerActivationAuthorized: false, productionReady: false },
    controls: [
      { id: "chain-integrity", name: "严格哈希链完整性", status: "blocked", evidence: "静态预览不读取审计记录", blocker: "连接受控服务后才能核验运行链" },
      { id: "metadata-minimization", name: "治理投影最小化", status: "repository-controlled", evidence: "只输出固定分类、计数、状态和摘要", blocker: "独立隐私与安全评估待完成" },
      { id: "continuous-delivery", name: "连续投递与检查点", status: "blocked", evidence: "静态预览未连接投递状态", blocker: "可信回执、外部锚和故障演练待完成" },
      { id: "release-approval", name: "上线审批与持续复核", status: "blocked", evidence: "生产激活固定禁用", blocker: "现场签字未完成" }
    ],
    risks: [{ id: "external-trust-evidence", title: "可信接收回执和外部单调锚缺失", severity: "critical", status: "open", owner: "T00/T01", nextAction: "取得独立接收、锚定、告警、恢复和现场验收证据" }],
    safetyBoundaries: ["中心只输出固定分类、计数、状态和摘要，不展示人员、患者、机构、访问目标、用途或事件正文", "中心不得修复、重封、删除或导出原始审计记录", "不得启动投递 Worker 或解除生产阻断"],
    blockers: ["真实 SIEM/WORM、可信回执、外部锚定和现场验收尚未完成", "生产身份、数据库、密钥、网络和责任方签字尚未闭合"]
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
      allowed: "允许", denied: "拒绝", other: "其他", authentication: "身份认证", authorization: "权限校验",
      "data-access": "数据访问", "sensitive-change": "敏感变更", "audit-delivery": "审计投递", "operational-security": "运行安全",
      commission: "主管部门", institution: "医疗机构", insurance: "医保", "primary-care": "基层协同", "clinical-staff": "医护人员",
      resident: "居民", "system-or-adapter": "系统或适配器", controlled: "已控制", "repository-controlled": "仓库已控制",
      partial: "部分闭合", blocked: "阻断", critical: "重大风险", high: "高风险", restricted: "受限"
    };
    return labels[String(value || "")] || String(value || "未记录");
  }

  function badge(value) {
    const text = String(value || "unknown");
    const className = /critical|high|blocked|denied|open/i.test(text) ? "badge danger" : /partial|restricted/i.test(text) ? "badge warn" : "badge info";
    return element("span", { className, text: label(text) });
  }

  function setBanner(title, detail, tone = "normal") {
    $("#audit-governance-source-title").textContent = title;
    $("#audit-governance-source-detail").textContent = detail;
    $("#audit-governance-source-banner").dataset.tone = tone;
  }

  async function requestCenter() {
    if (!API_AVAILABLE) throw new Error("静态发布未连接审计治理服务");
    const request = window.HealthCityAuth?.authFetch || fetch;
    const response = await request(CENTER_ENDPOINT);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message || `服务返回 ${response.status}`);
    return payload;
  }

  async function load() {
    $("#audit-governance-refresh").disabled = true;
    try {
      state.center = await requestCenter();
      setBanner("平台审计治理服务已连接", "两条审计来源已通过结构与严格哈希链校验；页面仅展示固定聚合和摘要。", "normal");
    } catch (error) {
      state.center = fallback;
      setBanner("当前为只读治理结构预览", `${error.message || "审计治理服务不可用"}。页面不会导出、修复审计链或激活投递 Worker。`, "warning");
    } finally {
      $("#audit-governance-refresh").disabled = false;
      render();
    }
  }

  function metric(name, value, detail) {
    return element("article", { className: "work-metric-card" }, [element("span", { text: name }), element("strong", { text: value }), element("small", { text: detail })]);
  }

  function renderMetrics() {
    const summary = state.center.summary || {};
    $("#audit-governance-decision").textContent = state.center.decision || "NO-GO";
    replace($("#audit-governance-metrics"), [
      metric("审计来源", summary.sources || 0, "安全事件链与数据访问链"),
      metric("受控记录", summary.totalRecords || 0, `${summary.dataAccessRecords || 0} 条数据访问记录`),
      metric("拒绝事件", summary.deniedEvents || 0, `${summary.highRiskEvents || 0} 条高风险分类`),
      metric("控制矩阵", summary.controls || 0, `${summary.blockedControls || 0} 项仍阻断`),
      metric("开放风险", summary.openRisks || 0, "需责任方与现场共同闭合")
    ], "暂无审计治理指标。");
  }

  function renderSources() {
    const items = state.center.sources || [];
    $("#audit-governance-source-count").textContent = `${items.length} 条链`;
    replace($("#audit-governance-sources"), items.map((item) => element("article", { className: "audit-governance-source-card" }, [
      element("header", {}, [element("div", {}, [element("h3", { text: item.title }), element("p", { text: `${item.collection} · ${item.owner}` })]), badge(item.integrityPassed ? "controlled" : "blocked")]),
      element("div", { className: "audit-governance-source-facts" }, [
        element("div", {}, [element("span", { text: "记录数" }), element("strong", { text: item.recordCount || 0 })]),
        element("div", {}, [element("span", { text: "链版本" }), element("strong", { text: item.chainVersion || "未记录" })]),
        element("div", {}, [element("span", { text: "数据分类" }), element("strong", { text: label(item.classification) })]),
        element("div", {}, [element("span", { text: "链头摘要" }), element("strong", { text: item.headDigest ? `${String(item.headDigest).slice(0, 16)}…` : "暂无" })])
      ]),
      element("p", { text: "原始事件、主体和访问目标均不可见。" })
    ])), "暂无审计来源。");
  }

  function renderDistribution(selector, items) {
    replace($(selector), (items || []).map((item) => element("div", { className: "audit-governance-distribution-row" }, [element("span", { text: label(item.id) }), element("strong", { text: item.count || 0 })])), "暂无分类数据。");
  }

  function renderActivity() {
    replace($("#audit-governance-activity"), (state.center.distributions?.activityByDay || []).map((item) => element("div", { className: "audit-governance-activity-item" }, [element("span", { text: item.day }), element("strong", { text: `${item.count || 0} 条` })])), "当前没有可展示的日期聚合。");
  }

  function renderControls() {
    const items = state.center.controls || [];
    $("#audit-governance-control-count").textContent = `${items.length} 项`;
    replace($("#audit-governance-controls"), items.map((item) => element("tr", {}, [
      element("td", {}, [element("strong", { text: item.name }), element("small", { text: item.id })]),
      element("td", {}, [badge(item.status)]),
      element("td", { text: item.evidence }),
      element("td", { text: item.blocker || "当前仓库边界已闭合" })
    ])), "暂无审计控制。");
  }

  function renderRisks() {
    const items = state.center.risks || [];
    $("#audit-governance-risk-count").textContent = `${items.length} 项`;
    replace($("#audit-governance-risks"), items.map((item) => element("article", { className: "audit-governance-risk" }, [
      element("header", {}, [element("div", {}, [element("h3", { text: item.title }), element("p", { text: `${item.id} · 责任 ${item.owner}` })]), badge(item.severity)]),
      element("p", { text: `下一步：${item.nextAction}` })
    ])), "暂无开放风险。");
  }

  function renderBoundaries() {
    replace($("#audit-governance-boundaries"), (state.center.safetyBoundaries || []).map((item) => element("li", { text: item })), "暂无安全边界说明。");
    replace($("#audit-governance-blockers"), (state.center.blockers || []).map((item) => element("li", { text: item })), "暂无上线阻断项。");
  }

  function render() {
    renderMetrics();
    renderSources();
    renderDistribution("#audit-governance-results", state.center.distributions?.results);
    renderDistribution("#audit-governance-categories", state.center.distributions?.categories);
    renderDistribution("#audit-governance-roles", state.center.distributions?.roles);
    renderActivity();
    renderControls();
    renderRisks();
    renderBoundaries();
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("#audit-governance-refresh").addEventListener("click", load);
    load();
  });
})();
