(function (root) {
  "use strict";

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character]);
  }

  function metric(label, value) {
    return `<article class="metric"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></article>`;
  }

  function textList(value, fallback = "未登记") {
    return Array.isArray(value) && value.length > 0
      ? value.map((item) => String(item ?? "")).join("、")
      : String(fallback ?? "");
  }

  function renderRegionalRequirements(catalog, target) {
    if (!target) return;
    const documentRef = target.ownerDocument || document;
    const items = Array.isArray(catalog?.items) ? catalog.items : [];
    if (items.length === 0) {
      const empty = documentRef.createElement("p");
      empty.className = "muted";
      empty.textContent = "暂无地区需求。";
      target.replaceChildren(empty);
      return;
    }
    const cards = items.slice(0, 12).map((item) => {
      const card = documentRef.createElement("article");
      card.className = "evidence-card";
      card.dataset.regionalRequirement = String(item.id || "redacted");
      const title = documentRef.createElement("h3");
      title.textContent = String(item.title || "未命名需求");
      const classification = documentRef.createElement("p");
      classification.textContent = `${item.productClass || "未分类"} · ${item.decision || "待决策"} · ${item.priority || "未分级"} · ${item.ownerProcess || "待分派"}`;
      const trace = documentRef.createElement("p");
      trace.className = "muted";
      trace.textContent = `目标能力：${textList(item.targetCapabilityIds)}；历史来源与证据定位已受控登记`;
      const state = documentRef.createElement("p");
      state.className = "muted";
      state.textContent = `状态：${item.status || "normalized"}；证据：${item.evidenceStatus || "pending"}`;
      card.append(title, classification, trace, state);
      return card;
    });
    target.replaceChildren(...cards);
  }

  function actionButton(documentRef, label, action, item) {
    const button = documentRef.createElement("button");
    button.type = "button";
    button.className = action === "accept" ? "primary-button" : "secondary-button";
    button.textContent = label;
    button.addEventListener("click", async () => {
      if (!root.HealthPlatformApi || button.disabled) return;
      button.disabled = true;
      button.textContent = "正在提交…";
      try {
        await root.HealthPlatformApi.createClient().post(`/platform/productization/requirements/${encodeURIComponent(item.id)}/actions`, {
          action,
          expectedVersion: item.version || 0,
          note: action === "accept" ? "经治理工作台人工复核，采用当前能力映射建议" : action === "reject" ? "经治理工作台人工复核，本期不纳入平台范围" : "经治理工作台人工复核，需要补充来源证据或映射"
        });
        await loadCenter();
      } catch {
        button.textContent = "操作未完成，请刷新后重试";
        button.disabled = false;
      }
    });
    return button;
  }

  function renderRequirementGovernance(governance, target) {
    if (!target) return;
    const documentRef = target.ownerDocument || document;
    const items = Array.isArray(governance?.items) ? governance.items : [];
    if (items.length === 0) {
      const empty = documentRef.createElement("p");
      empty.className = "muted";
      empty.textContent = "暂无待治理的招标需求。";
      target.replaceChildren(empty);
      return;
    }
    const cards = items.slice(0, 20).map((item) => {
      const card = documentRef.createElement("article");
      card.className = "evidence-card";
      card.dataset.procurementRequirement = String(item.id || "redacted");
      const title = documentRef.createElement("h3");
      title.textContent = String(item.title || "未命名需求");
      const source = documentRef.createElement("p");
      source.textContent = `${item.sourceAlias || "中性来源"} · 第${item.sourceAnchor?.pageStart || "?"}-${item.sourceAnchor?.pageEnd || "?"}页 · ${item.sourceAnchor?.section || "待定位"}`;
      const mapping = documentRef.createElement("p");
      mapping.className = "muted";
      mapping.textContent = `建议：${item.productClass || "待分类"} / ${item.decision || "待决策"} / ${item.priority || "待分级"}；目标能力：${textList(item.targetCapabilityIds)}`;
      const state = documentRef.createElement("p");
      state.className = "muted";
      state.textContent = `复核：${item.reviewStatus || "pending-review"}；能力差距：${item.gap?.overall || "unverified"}；生产状态：未授权`;
      card.append(title, source, mapping, state);
      const actionDefinitions = item.reviewStatus === "pending-review"
        ? [["确认采用建议", "accept"], ["退回补充", "request-revision"], ["本期不纳入", "reject"]]
        : item.reviewStatus === "revision-required"
          ? [["确认采用建议", "accept"], ["本期不纳入", "reject"]]
          : ["accepted", "rejected"].includes(item.reviewStatus)
            ? [["重新打开复核", "request-revision"]]
            : [];
      if (actionDefinitions.length > 0) {
        const actions = documentRef.createElement("div");
        actions.className = "action-row";
        actions.append(...actionDefinitions.map(([label, action]) => actionButton(documentRef, label, action, item)));
        card.append(actions);
      }
      return card;
    });
    target.replaceChildren(...cards);
  }

  function render(report) {
    const status = document.querySelector("#platform-productization-status");
    const metrics = document.querySelector("#platform-productization-metrics");
    const workItems = document.querySelector("#platform-productization-work-items");
    const integrations = document.querySelector("#platform-productization-integrations");
    const regionalRequirementsTarget = document.querySelector("#platform-productization-regional-requirements");
    const requirementGovernanceTarget = document.querySelector("#platform-procurement-requirement-workbench");
    const boundary = document.querySelector("#platform-productization-boundary");
    if (!status || !metrics || !workItems || !integrations || !boundary) return;
    const regionalRequirements = report.regionalRequirements || { summary: {}, items: [] };
    const regionalSummary = regionalRequirements.summary || {};
    const requirementGovernance = report.requirementGovernance || { summary: {}, items: [] };
    const requirementSummary = requirementGovernance.summary || {};
    status.textContent = report.ok ? "本地能力就绪" : "本地门禁阻断";
    status.className = `badge ${report.ok ? "success" : "danger"}`;
    metrics.innerHTML = [
      metric("P0集合转正", report.dataPromotion.summary.promotedP0),
      metric("权威集合", report.dataPromotion.summary.authoritative),
      metric("存量待治理", report.dataPromotion.summary.legacyBlocked),
      metric("统一待办", report.workItems.summary.total),
      metric("开放待办", report.workItems.summary.open),
      metric("机构接入档案", report.institutionIntegration.summary.profiles),
      metric("地区需求", regionalSummary.requirements || 0),
      metric("P0需求", regionalSummary.p0 || 0),
      metric("历史待Owner复核", regionalSummary.ownerReview || 0),
      metric("招标候选", requirementSummary.candidates || 0),
      metric("待人工复核", requirementSummary.pendingReview || 0),
      metric("能力差距", requirementSummary.gaps || 0)
    ].join("");
    workItems.innerHTML = report.workItems.items.slice(0, 12).map((item) => `<article class="evidence-card" data-platform-work-item="${escapeHtml(item.id)}">
      <h3>${escapeHtml(item.label)}</h3>
      <p>${escapeHtml(item.domain)} · ${escapeHtml(item.status)} · ${escapeHtml(item.priority)}</p>
      <p class="muted">来源：${escapeHtml(item.sourceCollection)}；版本：${escapeHtml(item.version)}</p>
    </article>`).join("") || "<p class=\"muted\">暂无统一待办。</p>";
    integrations.innerHTML = report.institutionIntegration.adapters.map((item) => `<article class="evidence-card">
      <h3>${escapeHtml(item.id)}</h3>
      <p>${escapeHtml(item.domain)} · ${escapeHtml(item.scenarios)} 个合成场景</p>
    </article>`).join("");
    renderRegionalRequirements(regionalRequirements, regionalRequirementsTarget);
    renderRequirementGovernance(requirementGovernance, requirementGovernanceTarget);
    boundary.textContent = report.boundary;
  }

  function renderOperations(report) {
    const target = document.querySelector("#platform-product-operations");
    if (!target || !root.HealthPlatformProductOperationsUi) return;
    root.HealthPlatformProductOperationsUi.mount(report.cockpit, target);
    target.dataset.localControlReady = report.localControlReady ? "true" : "false";
    target.dataset.productionReady = "false";
  }

  function renderEnhancements(report) {
    const target = document.querySelector("#platform-enhancement-operations");
    if (!target || !root.HealthPlatformProductRegionalOperationsUi) return;
    root.HealthPlatformProductRegionalOperationsUi.mount(report.cockpit, target);
    target.dataset.localControlReady = report.localControlReady ? "true" : "false";
    target.dataset.productionReady = "false";
  }

  async function loadCenter() {
    const center = await root.HealthPlatformApi.createClient().get("/platform/productization/center");
    render(center.data);
  }

  async function load() {
    if (!root.HealthPlatformApi) return;
    const status = document.querySelector("#platform-productization-status");
    try {
      const client = root.HealthPlatformApi.createClient();
      const [center, operations, enhancements] = await Promise.all([
        client.get("/platform/productization/center"),
        client.get("/platform/productization/operations/cockpit"),
        client.get("/platform/productization/enhancements/cockpit")
      ]);
      render(center.data);
      renderOperations(operations.data);
      renderEnhancements(enhancements.data);
    } catch {
      if (status) {
        status.textContent = "产品化控制面不可用";
        status.className = "badge danger";
      }
    }
  }

  if (typeof document !== "undefined") document.addEventListener("DOMContentLoaded", load);
  root.HealthPlatformProductization = Object.freeze({ load, loadCenter, render, renderEnhancements, renderOperations, renderRegionalRequirements, renderRequirementGovernance });
})(typeof globalThis === "object" ? globalThis : this);
