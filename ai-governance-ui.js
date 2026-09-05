"use strict";

(function initializeAiGovernanceWorkbench() {
  const auth = window.HealthCityAuth;
  const state = { rules: [], ready: false, busy: false, selected: null, pending: null };
  const $ = (selector) => document.querySelector(selector);
  const labels = { unregistered: "未登记", draft: "草稿", submitted: "待独立审批", approved: "治理已批准", rejected: "已拒绝", suspended: "已停用" };
  const actions = { register: "登记元数据", submit: "送交独立审批", approve: "独立批准", reject: "独立拒绝", suspend: "停用", rollback: "回滚至草稿" };
  const allowedActions = { unregistered: ["register"], draft: ["register", "submit"], submitted: ["approve", "reject"], approved: ["suspend"], rejected: ["register", "rollback"], suspended: ["register", "rollback"] };
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
    Object.entries({ total: "规则总数", submitted: "待审批", approved: "治理已批准", suspended: "已停用" }).forEach(([key, label]) => {
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
