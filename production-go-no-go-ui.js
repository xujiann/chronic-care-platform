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

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      '"': "&quot;"
    })[character]);
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
      metrics.innerHTML = rows.map(([label, value, detail]) => `<article class="metric-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(detail)}</small></article>`).join("");
      metrics.insertAdjacentHTML("beforeend", `<span class="sr-only" data-go-no-go-drift>${escapeHtml(center.summary.staleApprovals || 0)} stale approvals</span>`);
    }
    if (checks) {
      checks.innerHTML = `<table><thead><tr><th>全局前置条件</th><th>结果</th><th>证据摘要</th></tr></thead><tbody>${(center.checks || []).map((item) => `<tr><td>${escapeHtml(item.id)}</td><td><span class="badge ${item.passed ? "ok" : "danger"}">${item.passed ? "通过" : "阻断"}</span></td><td>${escapeHtml(item.detail)}</td></tr>`).join("")}</tbody></table>`;
    }
    if (approvals) {
      approvals.innerHTML = `<table><thead><tr><th>责任角色</th><th>状态</th><th>签署人</th><th>证据引用</th><th>操作</th></tr></thead><tbody>${(center.approvals || []).map((item) => {
        const approved = item.status === "approved";
        const current = approved && item.evidenceFingerprint === center.evidenceFingerprint;
        const disabled = !approved && !center.summary.prerequisiteReady;
        return `<tr data-go-no-go-drift="${approved && !current ? "stale" : "current"}" data-go-no-go-approval-drift="${approved && !current ? "revoke-required" : "none"}"><td>${escapeHtml(ROLE_LABELS[item.role] || item.role)}</td><td>${escapeHtml(approved && !current ? "证据已变化，审批失效" : item.status)}</td><td>${escapeHtml(item.approvedBy || "-")}</td><td>${escapeHtml(item.evidenceRef || "-")}</td><td><button type="button" class="inline-action" data-go-no-go-approval="${approved ? "revoke" : "approve"}" data-role="${escapeHtml(item.role)}" data-id="${escapeHtml(item.id)}" ${disabled ? "disabled" : ""}>${approved ? "撤销" : "审批"}</button></td></tr>`;
      }).join("")}</tbody></table>`;
      approvals.insertAdjacentHTML("beforeend", `<p class="implementation-boundary" data-go-no-go-approval-drift>${escapeHtml(center.summary.staleApprovals || 0)} stale approval(s) against the current evidence fingerprint.</p>`);
    }
    if (decision) {
      decision.innerHTML = `<div class="action-row"><button type="button" class="inline-action primary" data-go-no-go-decision="GO" ${center.gate?.formalDecisionEligible ? "" : "disabled"}>记录GO</button><button type="button" class="inline-action" data-go-no-go-decision="NO-GO">记录NO-GO</button></div><p>${center.decision ? `${escapeHtml(center.decision.decision)} · ${escapeHtml(center.decision.changeTicket)} · ${escapeHtml(center.decision.decidedBy)}` : "尚未形成全局指挥决策。"}</p>`;
    }
    if (boundary) boundary.textContent = center.boundary || "";
  }

  function ask(label) {
    const value = window.prompt(label);
    return value === null ? null : value.trim();
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
        const note = ask(action === "approve" ? "审批意见（至少6个字符）" : "撤销原因（至少6个字符）");
        if (note === null) return;
        const evidenceRef = action === "approve" ? ask("最小化签署证据引用（不得包含患者可识别信息）") : "";
        if (action === "approve" && evidenceRef === null) return;
        await request(`/approvals/${encodeURIComponent(approval.dataset.id)}/actions`, {
          action,
          responsibility: approval.dataset.role,
          evidenceRef,
          note
        });
      } else {
        const choice = decision.dataset.goNoGoDecision;
        const changeTicket = ask("生产变更单号");
        if (changeTicket === null) return;
        let cutoverWindow = "";
        let rollbackOwner = "";
        if (choice === "GO") {
          cutoverWindow = ask("割接窗口");
          if (cutoverWindow === null) return;
          rollbackOwner = ask("回滚决策责任人");
          if (rollbackOwner === null) return;
        }
        const note = ask("指挥决策说明（至少6个字符）");
        if (note === null) return;
        const confirmation = choice === "GO" ? ask("输入 APPROVE PRODUCTION GO LIVE 确认正式GO") : "";
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
