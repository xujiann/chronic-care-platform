(function () {
  "use strict";

  const API = "/api/pilot-acceptance/center";
  let pilotAcceptanceCenter = null;

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
    })[character]);
  }

  function badge(status) {
    const ok = /ready|passed|configured|accepted/.test(String(status || "")) && !/pending|blocked/.test(String(status || ""));
    return `<span class="badge ${ok ? "ok" : "warn"}">${escapeHtml(status)}</span>`;
  }

  function table(target, headers, rows) {
    const node = document.querySelector(target);
    if (!node) return;
    node.innerHTML = `<table><thead><tr>${headers.map((item) => `<th>${escapeHtml(item)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  }

  function render(center) {
    pilotAcceptanceCenter = center;
    const status = document.querySelector("#pilot-acceptance-status");
    if (status) {
      status.textContent = `${center.functionalState} · ${center.formalGoLiveState}`;
      status.className = `badge ${center.ok ? "ok" : "danger"}`;
    }
    const metrics = document.querySelector("#pilot-acceptance-metrics");
    if (metrics) {
      const rows = [
        ["应用回归", `${center.summary.regressionReady}/${center.summary.applications}`, "统一入口/API/测试/证据"],
        ["告警通道", `${center.summary.alertRoutesConfigured}/${center.summary.alertRoutes}`, `生产回执${center.summary.alertDrillReceipts || 0}份`],
        ["现场验收", `${center.summary.onsiteAccepted}/${center.summary.onsiteTasks}`, "P0-01至P0-10"],
        ["试运行", `${center.summary.trialPassed}/${center.summary.trialScenarios}`, `${center.summary.openIssues}项开放问题`]
      ];
      metrics.innerHTML = rows.map(([label, value, detail]) => `<article class="metric-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(detail)}</small></article>`).join("");
    }
    table("#pilot-acceptance-applications", ["应用", "入口", "API", "状态"], center.applications.map((item) => [escapeHtml(item.name), escapeHtml(item.entry), escapeHtml(item.apiRoutes.length), badge(item.status)]));
    table("#pilot-acceptance-alerting", ["通道", "环境变量", "签名密钥", "状态"], center.alerting.routes.map((item) => [escapeHtml(item.route), escapeHtml(item.endpointEnv), escapeHtml(item.secretEnv), badge(item.status)]));
    table("#pilot-acceptance-onsite", ["编号", "验收事项", "责任方", "目标", "状态"], center.onsiteTasks.map((item) => [escapeHtml(item.id), escapeHtml(item.name), escapeHtml(item.owner), escapeHtml(item.targetWindow), badge(item.acceptanceStatus)]));
    table("#pilot-acceptance-interfaces", ["接口", "责任方", "联调证据", "登记/复核", "状态", "操作"], center.interfaceSamples.map((item) => {
      const review = item.review || {};
      const actions = [
        review.workflowStatus !== "site-reviewed" ? `<button type="button" class="inline-action" data-pilot-interface-action="record-joint-test" data-interface-id="${escapeHtml(item.id)}">登记联调</button>` : "",
        review.workflowStatus === "evidence-recorded" ? `<button type="button" class="inline-action" data-pilot-interface-action="review-joint-test" data-interface-id="${escapeHtml(item.id)}">独立复核</button>` : "",
        review.workflowStatus === "site-reviewed" ? `<button type="button" class="inline-action" data-pilot-interface-action="revoke-joint-test" data-interface-id="${escapeHtml(item.id)}">撤销复核</button>` : ""
      ].filter(Boolean).join(" ");
      const people = [review.recordedBy ? `登记：${escapeHtml(review.recordedBy)}` : "", review.reviewedBy ? `复核：${escapeHtml(review.reviewedBy)}` : ""].filter(Boolean).join("<br>") || "待登记";
      return [escapeHtml(item.name), escapeHtml(item.owner), escapeHtml(review.evidenceRef || "待归档"), people, badge(review.workflowStatus || item.status), actions];
    }));
    table("#pilot-acceptance-trials", ["场景", "预期", "证据", "结果"], center.trialRun.scenarios.map((item) => [escapeHtml(item.name), escapeHtml(item.expected), escapeHtml(item.evidence), badge(item.status)]));
    table("#pilot-acceptance-issues", ["优先级", "问题", "责任方", "下一步"], center.issues.map((item) => [escapeHtml(item.priority), escapeHtml(item.title), escapeHtml(item.owner), escapeHtml(item.nextAction)]));
    const boundary = document.querySelector("#pilot-acceptance-boundary");
    if (boundary) boundary.textContent = center.boundary;
  }

  async function load() {
    const status = document.querySelector("#pilot-acceptance-status");
    try {
      const authFetch = window.HealthCityAuth?.authFetch || fetch;
      const response = await authFetch(API);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      render(await response.json());
    } catch (error) {
      if (status) {
        status.textContent = `加载失败：${error.message}`;
        status.className = "badge danger";
      }
    }
  }

  async function runInterfaceAction(button) {
    const interfaceId = button.dataset.interfaceId;
    const action = button.dataset.pilotInterfaceAction;
    const sample = pilotAcceptanceCenter?.interfaceSamples?.find((item) => item.id === interfaceId);
    if (!sample) return;
    const payload = { action };
    if (action === "record-joint-test") {
      payload.executionId = window.prompt("现场联调执行单号", sample.review?.executionId || "") || "";
      if (!payload.executionId.trim()) return;
      payload.evidenceRef = window.prompt("接收端回执或证据编号", sample.review?.evidenceRef || "") || "";
      if (!payload.evidenceRef.trim()) return;
      payload.results = {
        success: window.confirm("成功场景是否通过？"),
        failure: window.confirm("失败场景是否按预期拒绝并留痕？"),
        retry: window.confirm("重试与幂等场景是否通过？"),
        reconciliation: window.confirm("回执对账场景是否通过？")
      };
      payload.note = window.prompt("联调结论", "已按合成样例执行成功、失败、重试和对账验证。") || "";
      if (!payload.note.trim()) return;
    } else if (action === "review-joint-test") {
      payload.note = window.prompt("独立复核意见", "已核对执行单、接收端回执和四类场景结果，同意通过。") || "";
      if (!payload.note.trim()) return;
    } else if (action === "revoke-joint-test") {
      payload.note = window.prompt("撤销原因", "接收端配置或证据发生变化，需要重新联调。") || "";
      if (!payload.note.trim()) return;
    } else {
      return;
    }
    const status = document.querySelector("#pilot-acceptance-status");
    button.disabled = true;
    try {
      const authFetch = window.HealthCityAuth?.authFetch || fetch;
      const response = await authFetch(`/api/pilot-acceptance/interfaces/${encodeURIComponent(interfaceId)}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message || `HTTP ${response.status}`);
      render(body.center);
    } catch (error) {
      if (status) {
        status.textContent = `操作失败：${error.message}`;
        status.className = "badge danger";
      }
    } finally {
      button.disabled = false;
    }
  }

  document.addEventListener("click", (event) => {
    if (event.target.closest("[data-pilot-acceptance-refresh]")) load();
    const actionButton = event.target.closest("[data-pilot-interface-action]");
    if (actionButton) runInterfaceAction(actionButton);
  });
  document.addEventListener("DOMContentLoaded", load);
})();
