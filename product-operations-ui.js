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

  function assertViewModel(viewModel) {
    if (viewModel?.schemaVersion !== "product-operations-view-model-v1") throw new TypeError("product operations view model is invalid");
  }

  function appendTextElement(document, parent, tagName, text, className = "") {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    element.textContent = String(text ?? "");
    parent.append(element);
    return element;
  }

  function render(viewModel) {
    assertViewModel(viewModel);
    const cards = viewModel.cards.map((card) => `<article class="metric" data-state="${escapeHtml(card.state)}"><strong>${escapeHtml(card.value)}</strong><span>${escapeHtml(card.label)}</span></article>`).join("");
    const items = viewModel.workItems.map((item) => `<article class="evidence-card" data-product-operation-item="${escapeHtml(item.id)}"><h3>${escapeHtml(item.label)}</h3><p>${escapeHtml(item.domain)} · ${escapeHtml(item.status)} · ${escapeHtml(item.priority)}</p><p class="muted">版本：${escapeHtml(item.version)}</p></article>`).join("") || "<p class=\"muted\">暂无开放事项。</p>";
    return `<section data-product-operations-status="${escapeHtml(viewModel.status)}"><div class="metrics-grid">${cards}</div><div class="evidence-grid">${items}</div><p class="muted">${escapeHtml(viewModel.boundary)}</p></section>`;
  }

  function mount(viewModel, target) {
    const document = target?.ownerDocument;
    if (!target || typeof target.replaceChildren !== "function" || typeof document?.createElement !== "function") {
      throw new TypeError("product operations mount target is invalid");
    }
    assertViewModel(viewModel);

    const section = document.createElement("section");
    section.dataset.productOperationsStatus = String(viewModel.status ?? "");

    const metrics = document.createElement("div");
    metrics.className = "metrics-grid";
    viewModel.cards.forEach((card) => {
      const article = document.createElement("article");
      article.className = "metric";
      article.dataset.state = String(card.state ?? "");
      appendTextElement(document, article, "strong", card.value);
      appendTextElement(document, article, "span", card.label);
      metrics.append(article);
    });
    section.append(metrics);

    const items = document.createElement("div");
    items.className = "evidence-grid";
    if (viewModel.workItems.length === 0) {
      appendTextElement(document, items, "p", "暂无开放事项。", "muted");
    } else {
      viewModel.workItems.forEach((item) => {
        const article = document.createElement("article");
        article.className = "evidence-card";
        article.dataset.productOperationItem = String(item.id ?? "");
        appendTextElement(document, article, "h3", item.label);
        appendTextElement(document, article, "p", `${item.domain ?? ""} · ${item.status ?? ""} · ${item.priority ?? ""}`);
        appendTextElement(document, article, "p", `版本：${item.version ?? ""}`, "muted");
        items.append(article);
      });
    }
    section.append(items);
    appendTextElement(document, section, "p", viewModel.boundary, "muted");
    target.replaceChildren(section);
    return target;
  }

  return Object.freeze({ escapeHtml, mount, render });
});
