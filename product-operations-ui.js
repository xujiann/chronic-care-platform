(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.HealthPlatformProductOperationsUi = Object.freeze(api);
})(typeof globalThis === "object" ? globalThis : this, function () {
  "use strict";

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character]);
  }

  function render(viewModel) {
    if (viewModel?.schemaVersion !== "product-operations-view-model-v1") throw new TypeError("product operations view model is invalid");
    const cards = viewModel.cards.map((card) => `<article class="metric" data-state="${escapeHtml(card.state)}"><strong>${escapeHtml(card.value)}</strong><span>${escapeHtml(card.label)}</span></article>`).join("");
    const items = viewModel.workItems.map((item) => `<article class="evidence-card" data-product-operation-item="${escapeHtml(item.id)}"><h3>${escapeHtml(item.label)}</h3><p>${escapeHtml(item.domain)} · ${escapeHtml(item.status)} · ${escapeHtml(item.priority)}</p><p class="muted">版本：${escapeHtml(item.version)}</p></article>`).join("") || "<p class=\"muted\">暂无开放事项。</p>";
    return `<section data-product-operations-status="${escapeHtml(viewModel.status)}"><div class="metrics-grid">${cards}</div><div class="evidence-grid">${items}</div><p class="muted">${escapeHtml(viewModel.boundary)}</p></section>`;
  }

  function mount(viewModel, target) {
    if (!target || typeof target !== "object" || !("innerHTML" in target)) throw new TypeError("product operations mount target is invalid");
    target.innerHTML = render(viewModel);
    return target;
  }

  return Object.freeze({ escapeHtml, mount, render });
});
