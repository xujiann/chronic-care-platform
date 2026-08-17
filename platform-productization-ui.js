(function (root) {
  "use strict";

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character]);
  }

  function metric(label, value) {
    return `<article class="metric"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></article>`;
  }

  function render(report) {
    const status = document.querySelector("#platform-productization-status");
    const metrics = document.querySelector("#platform-productization-metrics");
    const workItems = document.querySelector("#platform-productization-work-items");
    const integrations = document.querySelector("#platform-productization-integrations");
    const boundary = document.querySelector("#platform-productization-boundary");
    if (!status || !metrics || !workItems || !integrations || !boundary) return;
    status.textContent = report.ok ? "本地能力就绪" : "本地门禁阻断";
    status.className = `badge ${report.ok ? "success" : "danger"}`;
    metrics.innerHTML = [
      metric("P0集合转正", report.dataPromotion.summary.promotedP0),
      metric("权威集合", report.dataPromotion.summary.authoritative),
      metric("存量待治理", report.dataPromotion.summary.legacyBlocked),
      metric("统一待办", report.workItems.summary.total),
      metric("开放待办", report.workItems.summary.open),
      metric("机构接入档案", report.institutionIntegration.summary.profiles)
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
    boundary.textContent = report.boundary;
  }

  async function load() {
    if (!root.HealthPlatformApi) return;
    const status = document.querySelector("#platform-productization-status");
    try {
      const response = await root.HealthPlatformApi.createClient().get("/platform/productization/center");
      render(response.data);
    } catch {
      if (status) {
        status.textContent = "产品化控制面不可用";
        status.className = "badge danger";
      }
    }
  }

  if (typeof document !== "undefined") document.addEventListener("DOMContentLoaded", load);
  root.HealthPlatformProductization = Object.freeze({ load, render });
})(typeof globalThis === "object" ? globalThis : this);
