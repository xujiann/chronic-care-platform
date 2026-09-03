(function () {
  "use strict";

  const API = "/api/production-go-no-go";
  const ROLE_LABELS = {
    business: "业务负责人",
    information: "信息化负责人",
    operations: "运维负责人",
    security: "安全负责人"
  };
  let center = null;

  function appendTextElement(parent, tagName, text, className = "") {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    element.textContent = String(text ?? "");
    parent.appendChild(element);
    return element;
  }

  function appendHeaderRow(table, headings) {
    const head = table.createTHead();
    const row = head.insertRow();
    headings.forEach((heading) => appendTextElement(row, "th", heading));
  }

  function render() {
    if (!center) return;
    const status = document.querySelector("#production-go-no-go-status");
    const metrics = document.querySelector("#production-go-no-go-metrics");
    const checks = document.querySelector("#production-go-no-go-checks");
    const approvals = document.querySelector("#production-go-no-go-approvals");
    const decision = document.querySelector("#production-go-no-go-decision");
    const boundary = document.querySelector("#production-go-no-go-boundary");
    if (status) {
      status.textContent = center.status || "待核验";
      status.className = `badge ${center.gate?.productionGoRecorded ? "ok" : "danger"}`;
    }
    if (metrics) {
      const rows = [
        ["前置条件", `${center.summary.prerequisitesPassed}/${center.summary.prerequisites}`, center.summary.prerequisiteReady ? "全部通过" : "仍有阻断"],
        ["P0现场验收", `${center.summary.siteAcceptances}/10`, "必须覆盖P0-01至P0-10"],
        ["全局审批", `${center.summary.approvalsRecorded}/${center.summary.approvals}`, `${center.summary.uniqueSigners}名独立签署人`],
        ["指挥决策", center.decision?.decision || "未记录", center.gate?.formalDecisionEligible ? "可提交GO决策" : "不可提交GO决策"]
      ];
      metrics.replaceChildren();
      rows.forEach(([label, value, detail]) => {
        const card = document.createElement("article");
        card.className = "metric-card";
        appendTextElement(card, "span", label);
        appendTextElement(card, "strong", value);
        appendTextElement(card, "small", detail);
        metrics.appendChild(card);
      });
      const drift = appendTextElement(metrics, "span", `${center.summary.staleApprovals || 0} stale approvals`, "sr-only");
      drift.dataset.goNoGoDrift = "";
    }
    if (checks) {
      const table = document.createElement("table");
      appendHeaderRow(table, ["全局前置条件", "结果", "证据摘要"]);
      const body = table.createTBody();
      (center.checks || []).forEach((item) => {
        const row = body.insertRow();
        appendTextElement(row, "td", item.id);
        const resultCell = row.insertCell();
        appendTextElement(resultCell, "span", item.passed ? "通过" : "阻断", `badge ${item.passed ? "ok" : "danger"}`);
        appendTextElement(row, "td", item.detail);
      });
      checks.replaceChildren(table);
    }
    if (approvals) {
      const table = document.createElement("table");
      appendHeaderRow(table, ["责任角色", "状态", "签署人", "证据引用", "操作"]);
      const body = table.createTBody();
      (center.approvals || []).forEach((item) => {
        const approved = item.status === "approved";
        const current = approved && item.evidenceFingerprint === center.evidenceFingerprint;
        const disabled = !approved && !center.summary.prerequisiteReady;
        const row = body.insertRow();
        row.dataset.goNoGoDrift = approved && !current ? "stale" : "current";
        row.dataset.goNoGoApprovalDrift = approved && !current ? "revoke-required" : "none";
        appendTextElement(row, "td", ROLE_LABELS[item.role] || item.role);
        appendTextElement(row, "td", approved && !current ? "证据已变化，审批失效" : item.status);
        appendTextElement(row, "td", item.approvedBy || "-");
        appendTextElement(row, "td", item.evidenceRef || "-");
        const actionCell = row.insertCell();
        const button = appendTextElement(actionCell, "button", approved ? "撤销" : "审批", "inline-action");
        button.type = "button";
        button.dataset.goNoGoApproval = approved ? "revoke" : "approve";
        button.dataset.approvalRole = String(item.role ?? "");
        button.dataset.id = String(item.id ?? "");
        button.disabled = disabled;
      });
      const drift = document.createElement("p");
      drift.className = "implementation-boundary";
      drift.textContent = `${center.summary.staleApprovals || 0} stale approval(s) against the current evidence fingerprint.`;
      drift.dataset.goNoGoApprovalDrift = "";
      approvals.replaceChildren(table, drift);
    }
    if (decision) {
      const actions = document.createElement("div");
      actions.className = "action-row";
      const goButton = appendTextElement(actions, "button", "记录GO", "inline-action primary");
      goButton.type = "button";
      goButton.dataset.goNoGoDecision = "GO";
      goButton.disabled = !center.gate?.formalDecisionEligible;
      const noGoButton = appendTextElement(actions, "button", "记录NO-GO", "inline-action");
      noGoButton.type = "button";
      noGoButton.dataset.goNoGoDecision = "NO-GO";
      const decisionText = center.decision
        ? `${center.decision.decision} · ${center.decision.changeTicket} · ${center.decision.decidedBy}`
        : "尚未形成全局指挥决策。";
      const detail = document.createElement("p");
      detail.textContent = decisionText;
      decision.replaceChildren(actions, detail);
    }
    if (boundary) boundary.textContent = center.boundary || "";
  }

  function ask(label, options = {}) {
    return window.HealthStructuredDialog.prompt({ title: label, minLength: 1, ...options });
  }

  async function request(path, body) {
    const authFetch = window.HealthCityAuth?.authFetch || fetch;
    const response = await authFetch(`${API}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message || `HTTP ${response.status}`);
    center = payload.center;
    render();
  }

  async function load() {
    const authFetch = window.HealthCityAuth?.authFetch || fetch;
    try {
      const response = await authFetch(`${API}/center`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      center = await response.json();
      render();
    } catch (error) {
      const status = document.querySelector("#production-go-no-go-status");
      if (status) {
        status.textContent = `加载失败：${error.message}`;
        status.className = "badge danger";
      }
    }
  }

  document.addEventListener("click", async (event) => {
    const approval = event.target.closest("[data-go-no-go-approval]");
    const decision = event.target.closest("[data-go-no-go-decision]");
    if (!approval && !decision) return;
    const button = approval || decision;
    button.disabled = true;
    try {
      if (approval) {
        const action = approval.dataset.goNoGoApproval;
        const note = await ask(action === "approve" ? "审批意见" : "撤销原因", { minLength: 6 });
        if (note === null) return;
        const evidenceRef = action === "approve" ? await ask("最小化签署证据引用（不得包含患者可识别信息）") : "";
        if (action === "approve" && evidenceRef === null) return;
        await request(`/approvals/${encodeURIComponent(approval.dataset.id)}/actions`, {
          action,
          responsibility: approval.dataset.approvalRole,
          evidenceRef,
          note
        });
      } else {
        const choice = decision.dataset.goNoGoDecision;
        const changeTicket = await ask("生产变更单号");
        if (changeTicket === null) return;
        let cutoverWindow = "";
        let rollbackOwner = "";
        if (choice === "GO") {
          cutoverWindow = await ask("割接窗口");
          if (cutoverWindow === null) return;
          rollbackOwner = await ask("回滚决策责任人");
          if (rollbackOwner === null) return;
        }
        const note = await ask("指挥决策说明", { minLength: 6 });
        if (note === null) return;
        const confirmation = choice === "GO" ? await ask("输入 APPROVE PRODUCTION GO LIVE 确认正式GO", { multiline: false, pattern: "^APPROVE PRODUCTION GO LIVE$", patternMessage: "请输入完整确认语句。" }) : "";
        if (choice === "GO" && confirmation === null) return;
        await request("/decision", { decision: choice, changeTicket, cutoverWindow, rollbackOwner, note, confirmation });
      }
    } catch (error) {
      window.alert(error.message || "全局go/no-go操作失败");
    } finally {
      button.disabled = false;
    }
  });

  document.addEventListener("DOMContentLoaded", load);
})();
