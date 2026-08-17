(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.HealthPlatformProductRegionalOperationsUi = Object.freeze(api);
})(typeof globalThis === "object" ? globalThis : this, function () {
  "use strict";

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character]);
  }

  function render(viewModel) {
    if (viewModel?.schemaVersion !== "product-regional-operations-view-model-v1") throw new TypeError("product regional operations view model is invalid");
    const cards = viewModel.cards.map((card) => `<article class="metric" data-state="${escapeHtml(card.state)}"><strong>${escapeHtml(card.value)}</strong><span>${escapeHtml(card.label)}</span></article>`).join("");
    const workItems = viewModel.workItems.map((item) => {
      const timeline = item.timeline.map((event) => `<li>${escapeHtml(event.at)} · ${escapeHtml(event.actorRole)} · ${escapeHtml(event.action)} · ${escapeHtml(event.resultingStatus)}</li>`).join("");
      return `<article class="evidence-card" data-product-work-item-v2="${escapeHtml(item.id)}"><h3>${escapeHtml(item.category)}</h3><p>${escapeHtml(item.domain)} · ${escapeHtml(item.priority)} · ${escapeHtml(item.status)}</p><p class="muted">SLA：${escapeHtml(item.slaState)}；分派：${escapeHtml(item.assignedRole)}；未读：${escapeHtml(item.unreadMessages)}；版本：${escapeHtml(item.version)}</p><ol>${timeline}</ol></article>`;
    }).join("") || "<p class=\"muted\">暂无统一事项。</p>";
    const regions = viewModel.regions.map((region) => `<article class="evidence-card" data-region-code="${escapeHtml(region.regionCode)}"><h3>地区 ${escapeHtml(region.regionCode)}</h3><p>${escapeHtml(region.deploymentClass)} · 能力 ${escapeHtml(region.enabledCapabilities)} 项</p><p class="muted">配置：${escapeHtml(region.configurationReady ? "ready" : "blocked")}；部署：${escapeHtml(region.deploymentStatus)}；复制：${escapeHtml(region.replicationStatus)}；验收：${escapeHtml(region.acceptanceState)}</p></article>`).join("") || "<p class=\"muted\">暂无地区运行实例。</p>";
    const diffs = viewModel.configurationDiffs.map((diff) => `<li>${escapeHtml(diff.baselineRegionCode)} → ${escapeHtml(diff.targetRegionCode)}：能力键 ${escapeHtml(diff.featureDifferenceCount)}、配置键 ${escapeHtml(diff.configDifferenceCount)}、扩展键 ${escapeHtml(diff.extensionDifferenceCount)}</li>`).join("") || "<li>无地区配置键差异。</li>";
    return `<section data-product-regional-status="${escapeHtml(viewModel.status)}"><div class="metrics-grid">${cards}</div><h3>统一事项中心 2.0</h3><div class="evidence-grid">${workItems}</div><h3>地区运行视图</h3><div class="evidence-grid">${regions}</div><h3>配置差异摘要</h3><ul>${diffs}</ul><p class="muted">${escapeHtml(viewModel.boundary)}</p></section>`;
  }

  function mount(viewModel, target) {
    if (!target || typeof target !== "object" || !("innerHTML" in target)) throw new TypeError("product regional operations mount target is invalid");
    target.innerHTML = render(viewModel);
    return target;
  }

  return Object.freeze({ escapeHtml, mount, render });
});
