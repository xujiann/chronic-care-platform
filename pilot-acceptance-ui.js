(function () {
  "use strict";

  const API = "/api/pilot-acceptance/center";

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
    const status = document.querySelector("#pilot-acceptance-status");
    if (status) {
      status.textContent = `${center.functionalState} · ${center.formalGoLiveState}`;
      status.className = `badge ${center.ok ? "ok" : "danger"}`;
    }
    const metrics = document.querySelector("#pilot-acceptance-metrics");
    if (metrics) {
      const rows = [
        ["应用回归", `${center.summary.regressionReady}/${center.summary.applications}`, "统一入口/API/测试/证据"],
        ["告警通道", `${center.summary.alertRoutesConfigured}/${center.summary.alertRoutes}`, "SIEM或Webhook"],
        ["现场验收", `${center.summary.onsiteAccepted}/${center.summary.onsiteTasks}`, "P0-01至P0-10"],
        ["试运行", `${center.summary.trialPassed}/${center.summary.trialScenarios}`, `${center.summary.openIssues}项开放问题`]
      ];
      metrics.innerHTML = rows.map(([label, value, detail]) => `<article class="metric-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(detail)}</small></article>`).join("");
    }
    table("#pilot-acceptance-applications", ["应用", "入口", "API", "状态"], center.applications.map((item) => [escapeHtml(item.name), escapeHtml(item.entry), escapeHtml(item.apiRoutes.length), badge(item.status)]));
    table("#pilot-acceptance-alerting", ["通道", "环境变量", "签名密钥", "状态"], center.alerting.routes.map((item) => [escapeHtml(item.route), escapeHtml(item.endpointEnv), escapeHtml(item.secretEnv), badge(item.status)]));
    table("#pilot-acceptance-onsite", ["编号", "验收事项", "责任方", "目标", "状态"], center.onsiteTasks.map((item) => [escapeHtml(item.id), escapeHtml(item.name), escapeHtml(item.owner), escapeHtml(item.targetWindow), badge(item.acceptanceStatus)]));
    table("#pilot-acceptance-interfaces", ["接口", "责任方", "幂等字段", "重试策略", "状态"], center.interfaceSamples.map((item) => [escapeHtml(item.name), escapeHtml(item.owner), escapeHtml(item.idempotencyKey), escapeHtml(item.retryPolicy), badge(item.status)]));
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

  document.addEventListener("click", (event) => {
    if (event.target.closest("[data-pilot-acceptance-refresh]")) load();
  });
  document.addEventListener("DOMContentLoaded", load);
})();
