(function () {
  "use strict";

  const API = "/api/production-security";
  let center = null;

  function element(tagName, options = {}) {
    const node = document.createElement(tagName);
    if (options.className) node.className = options.className;
    if (options.text !== undefined) node.textContent = String(options.text ?? "");
    if (options.dataset) {
      Object.entries(options.dataset).forEach(([key, value]) => {
        node.dataset[key] = String(value ?? "");
      });
    }
    return node;
  }

  function metric(label, value, detail) {
    const card = element("article", { className: "metric-card" });
    card.append(
      element("span", { text: label }),
      element("strong", { text: value }),
      element("small", { text: detail })
    );
    return card;
  }

  function findingActions(item) {
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
    return buttons;
  }

  function actionButtons(item) {
    const fragment = document.createDocumentFragment();
    const buttons = findingActions(item);
    buttons.forEach(([action, label], index) => {
      if (index) fragment.append(document.createTextNode(" "));
      const button = element("button", {
        className: "inline-action",
        text: label,
        dataset: { productionSecurityAction: action, id: item.id }
      });
      button.type = "button";
      fragment.append(button);
    });
    return fragment;
  }

  function appendTextWithBreak(cell, primary, secondary) {
    cell.append(document.createTextNode(String(primary ?? "")), element("br"), element("small", { text: secondary }));
  }

  function table(headers) {
    const tableNode = element("table");
    const headerRow = element("tr");
    headers.forEach((header) => headerRow.append(element("th", { text: header })));
    const head = element("thead");
    head.append(headerRow);
    const body = element("tbody");
    tableNode.append(head, body);
    return { tableNode, body };
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
    if (metrics) metrics.replaceChildren(
      metric("安全发现", summary.findings || 0, `${summary.openFindings || 0} 项未关闭`),
      metric("高危阻断", (summary.criticalOpen || 0) + (summary.highOpen || 0), `${summary.criticalOpen || 0} 严重 / ${summary.highOpen || 0} 高危`),
      metric("有效豁免", summary.activeWaivers || 0, "到期自动恢复阻断"),
      metric("独立放行意见", `${summary.approvedReleaseOpinions || 0}/${summary.releaseApprovals || 0}`, summary.releaseEligible ? "可提交" : "整改未完成")
    );
    if (findings) {
      const findingsTable = table(["等级/来源", "发现与资产", "状态/责任", "证据", "操作"]);
      (center.findings || []).forEach((item) => {
        const row = element("tr");
        const severity = element("td");
        severity.append(
          element("span", { className: `badge ${item.severity === "critical" || item.severity === "high" ? "danger" : "warn"}`, text: item.severity }),
          element("br"),
          element("small", { text: item.source })
        );
        const description = element("td");
        description.append(element("strong", { text: item.title }), element("br"), element("small", { text: item.asset }));
        const ownership = element("td");
        appendTextWithBreak(ownership, item.status, `${item.owner || "未分派"} · ${item.dueAt || "无期限"}${item.overdue ? " · 已逾期" : ""}`);
        const evidence = element("td", { text: [...(item.evidenceRefs || []), ...(item.remediationEvidenceRefs || [])].join("；") || "待登记" });
        const actions = element("td");
        actions.append(actionButtons(item));
        row.append(severity, description, ownership, evidence, actions);
        findingsTable.body.append(row);
      });
      findings.replaceChildren(findingsTable.tableNode);
    }
    if (approvals) {
      const approvalsTable = table(["放行角色", "状态", "签署人", "操作"]);
      (center.approvals || []).forEach((item) => {
        const row = element("tr");
        const role = element("td");
        role.append(element("strong", { text: item.title }), element("br"), element("small", { text: item.role }));
        const state = element("td");
        state.append(element("span", { className: `badge ${item.status === "approved" ? "ok" : "warn"}`, text: item.status }));
        const signer = element("td");
        appendTextWithBreak(signer, item.approvedBy || "-", item.approvedAt || "");
        const actionCell = element("td");
        const button = element("button", {
          className: "inline-action",
          text: item.status === "approved" ? "撤销意见" : "记录意见",
          dataset: {
            productionSecurityApproval: item.status === "approved" ? "revoke-release" : "approve-release",
            id: item.id
          }
        });
        button.type = "button";
        actionCell.append(button);
        row.append(role, state, signer, actionCell);
        approvalsTable.body.append(row);
      });
      approvals.replaceChildren(approvalsTable.tableNode);
    }
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
    const findingButton = event.target.closest("#production-security-findings [data-production-security-action]");
    const approvalButton = event.target.closest("#production-security-approvals [data-production-security-approval]");
    if (!findingButton && !approvalButton) return;
    const finding = findingButton && (center?.findings || []).find((item) => String(item.id) === findingButton.dataset.id);
    const approval = approvalButton && (center?.approvals || []).find((item) => String(item.id) === approvalButton.dataset.id);
    if (findingButton && (!finding || !findingActions(finding).some(([action]) => action === findingButton.dataset.productionSecurityAction))) return;
    const expectedApprovalAction = approval?.status === "approved" ? "revoke-release" : "approve-release";
    if (approvalButton && (!approval || approvalButton.dataset.productionSecurityApproval !== expectedApprovalAction)) return;
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
