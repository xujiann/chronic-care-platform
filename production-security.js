(function () {
  "use strict";

  const API = "/api/production-security";
  let center = null;

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
    })[character]);
  }

  function metric(label, value, detail) {
    return `<article class="metric-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(detail)}</small></article>`;
  }

  function actionButtons(item) {
    const buttons = [];
    if (["closed", "waived"].includes(item.status)) buttons.push(["reopen", "重新打开"]);
    else {
      buttons.push(["assign", "分派"]);
      if (item.status !== "pending-retest" && item.status !== "pending-waiver") buttons.push(["record-remediation", "登记整改"]);
      if (item.status === "remediation-recorded") buttons.push(["submit-retest", "提交复测"]);
      if (item.status === "pending-retest") {
        buttons.push(["verify-retest-passed", "复测通过"], ["verify-retest-failed", "复测退回"]);
      }
      if (item.status === "pending-waiver") buttons.push(["approve-waiver", "批准豁免"], ["reject-waiver", "拒绝豁免"]);
      else if (item.severity !== "critical") buttons.push(["request-waiver", "申请豁免"]);
    }
    return buttons.map(([action, label]) => `<button class="inline-action" type="button" data-production-security-action="${action}" data-id="${escapeHtml(item.id)}">${label}</button>`).join(" ");
  }

  function render() {
    if (!center) return;
    const summary = center.summary || {};
    const metrics = document.querySelector("#production-security-metrics");
    const status = document.querySelector("#production-security-status");
    const findings = document.querySelector("#production-security-findings");
    const approvals = document.querySelector("#production-security-approvals");
    const boundary = document.querySelector("#production-security-boundary");
    if (status) {
      status.textContent = center.status || "待核验";
      status.className = `badge ${summary.releaseEligible ? "ok" : "danger"}`;
    }
    if (metrics) metrics.innerHTML = [
      metric("安全发现", summary.findings || 0, `${summary.openFindings || 0} 项未关闭`),
      metric("高危阻断", (summary.criticalOpen || 0) + (summary.highOpen || 0), `${summary.criticalOpen || 0} 严重 / ${summary.highOpen || 0} 高危`),
      metric("有效豁免", summary.activeWaivers || 0, "到期自动恢复阻断"),
      metric("独立放行意见", `${summary.approvedReleaseOpinions || 0}/${summary.releaseApprovals || 0}`, summary.releaseEligible ? "可提交" : "整改未完成")
    ].join("");
    if (findings) findings.innerHTML = `<table><thead><tr><th>等级/来源</th><th>发现与资产</th><th>状态/责任</th><th>证据</th><th>操作</th></tr></thead><tbody>${(center.findings || []).map((item) => `<tr>
      <td><span class="badge ${item.severity === "critical" || item.severity === "high" ? "danger" : "warn"}">${escapeHtml(item.severity)}</span><br><small>${escapeHtml(item.source)}</small></td>
      <td><strong>${escapeHtml(item.title)}</strong><br><small>${escapeHtml(item.asset)}</small></td>
      <td>${escapeHtml(item.status)}<br><small>${escapeHtml(item.owner || "未分派")} · ${escapeHtml(item.dueAt || "无期限")}${item.overdue ? " · 已逾期" : ""}</small></td>
      <td>${escapeHtml([...(item.evidenceRefs || []), ...(item.remediationEvidenceRefs || [])].join("；") || "待登记")}</td>
      <td>${actionButtons(item)}</td>
    </tr>`).join("")}</tbody></table>`;
    if (approvals) approvals.innerHTML = `<table><thead><tr><th>放行角色</th><th>状态</th><th>签署人</th><th>操作</th></tr></thead><tbody>${(center.approvals || []).map((item) => `<tr>
      <td><strong>${escapeHtml(item.title)}</strong><br><small>${escapeHtml(item.role)}</small></td>
      <td><span class="badge ${item.status === "approved" ? "ok" : "warn"}">${escapeHtml(item.status)}</span></td>
      <td>${escapeHtml(item.approvedBy || "-")}<br><small>${escapeHtml(item.approvedAt || "")}</small></td>
      <td><button class="inline-action" type="button" data-production-security-approval="${item.status === "approved" ? "revoke-release" : "approve-release"}" data-id="${escapeHtml(item.id)}">${item.status === "approved" ? "撤销意见" : "记录意见"}</button></td>
    </tr>`).join("")}</tbody></table>`;
    if (boundary) boundary.textContent = center.boundary || "";
  }

  function ask(message, current = "") {
    return window.HealthStructuredDialog.prompt({ title: message, defaultValue: current, minLength: 1 });
  }

  async function buildFindingPayload(action) {
    const payload = { action: action.replace(/-(passed|failed)$/, "") };
    if (action.startsWith("verify-retest-")) payload.result = action.endsWith("passed") ? "passed" : "failed";
    if (action === "assign") {
      payload.owner = await ask("整改责任人");
      if (payload.owner === null) return null;
      payload.dueAt = await ask("整改期限（YYYY-MM-DD）");
      if (payload.dueAt === null) return null;
    }
    if (["record-remediation", "verify-retest-passed", "verify-retest-failed"].includes(action)) {
      payload.evidenceRef = await ask("脱敏证据引用（文件编号、摘要或受控路径）");
      if (payload.evidenceRef === null) return null;
    }
    if (action === "request-waiver") {
      payload.expiresAt = await ask("豁免到期日（高危不超过 30 天，其他不超过 90 天）");
      if (payload.expiresAt === null) return null;
      payload.reason = await ask("豁免原因");
      if (payload.reason === null) return null;
      payload.compensatingControl = await ask("补偿控制");
      if (payload.compensatingControl === null) return null;
    }
    payload.note = await window.HealthStructuredDialog.prompt({ title: "处置说明", label: "处置说明（至少 6 个字符）", minLength: 6 });
    return payload.note === null ? null : payload;
  }

  async function post(path, payload) {
    const request = window.HealthCityAuth?.authFetch || fetch;
    const response = await request(`${API}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.message || `HTTP ${response.status}`);
    center = body.center;
    render();
  }

  async function load() {
    const request = window.HealthCityAuth?.authFetch || fetch;
    const status = document.querySelector("#production-security-status");
    try {
      const response = await request(`${API}/center`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      center = await response.json();
      render();
    } catch (error) {
      if (status) {
        status.textContent = `加载失败：${error.message}`;
        status.className = "badge danger";
      }
    }
  }

  document.addEventListener("click", async (event) => {
    const findingButton = event.target.closest("[data-production-security-action]");
    const approvalButton = event.target.closest("[data-production-security-approval]");
    if (!findingButton && !approvalButton) return;
    const button = findingButton || approvalButton;
    button.disabled = true;
    try {
      if (findingButton) {
        const action = findingButton.dataset.productionSecurityAction;
        const payload = await buildFindingPayload(action);
        if (payload) await post(`/findings/${encodeURIComponent(findingButton.dataset.id)}/actions`, payload);
      } else {
        const action = approvalButton.dataset.productionSecurityApproval;
        const note = await window.HealthStructuredDialog.prompt({ title: "独立安全放行意见", minLength: 6 });
        if (note !== null) await post(`/release-approvals/${encodeURIComponent(approvalButton.dataset.id)}/actions`, { action, note });
      }
    } catch (error) {
      window.alert(error.message || "安全验收操作失败");
    } finally {
      button.disabled = false;
    }
  });

  document.addEventListener("DOMContentLoaded", load);
})();
