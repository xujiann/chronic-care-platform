(function (root) {
  "use strict";

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character]);
  }

  function metric(label, value) {
    return `<article class="metric"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></article>`;
  }

  function render(report) {
    const status = document.querySelector("#regional-cutover-workbench-status");
    const metrics = document.querySelector("#regional-cutover-workbench-metrics");
    const regions = document.querySelector("#regional-cutover-workbench-regions");
    const boundary = document.querySelector("#regional-cutover-workbench-boundary");
    if (!status || !metrics || !regions || !boundary) return;
    status.textContent = report.candidateReady ? "存在候选地区" : "投产门禁关闭";
    status.className = `badge ${report.candidateReady ? "warn" : "danger"}`;
    metrics.innerHTML = [
      metric("地区", report.summary.regions),
      metric("配置就绪", report.summary.technicalReady),
      metric("运维就绪", report.summary.operationsReady),
      metric("证据就绪", report.summary.evidenceReady),
      metric("候选就绪", report.summary.candidateReady),
      metric("阻断", report.summary.blocked)
    ].join("");
    regions.innerHTML = report.regions.map((item) => `<article class="evidence-card" data-regional-cutover-region="${escapeHtml(item.regionCode)}">
      <h3>${escapeHtml(item.regionName)} · ${escapeHtml(item.regionCode)}</h3>
      <p>发布：${escapeHtml(item.release.state)}；运维：${escapeHtml(item.operations.status)}；存储：${escapeHtml(item.storage.mode)}</p>
      <p>证据：${escapeHtml(item.evidence.lifecycleState)}，${item.evidence.readyScopes}/${item.evidence.requiredScopes} 范围就绪</p>
      <p class="muted">${escapeHtml(item.blockers.join("；") || "无本地阻断项")}</p>
    </article>`).join("");
    boundary.textContent = report.boundary;
  }

  async function load() {
    if (!root.HealthPlatformApi) return;
    try {
      const response = await root.HealthPlatformApi.createClient().get("/regional/cutover-workbench");
      render(response.data);
    } catch (error) {
      const status = document.querySelector("#regional-cutover-workbench-status");
      if (status) {
        status.textContent = "控制面不可用";
        status.className = "badge danger";
      }
    }
  }

  if (typeof document !== "undefined") document.addEventListener("DOMContentLoaded", load);
  root.HealthRegionalCutoverWorkbench = Object.freeze({ load, render });
})(typeof globalThis === "object" ? globalThis : this);
