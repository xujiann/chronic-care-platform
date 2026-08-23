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

  function assertViewModel(viewModel) {
    if (viewModel?.schemaVersion !== "product-regional-operations-view-model-v1") throw new TypeError("product regional operations view model is invalid");
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
    const workItems = viewModel.workItems.map((item) => {
      const timeline = item.timeline.map((event) => `<li>${escapeHtml(event.at)} · ${escapeHtml(event.actorRole)} · ${escapeHtml(event.action)} · ${escapeHtml(event.resultingStatus)}</li>`).join("");
      return `<article class="evidence-card" data-product-work-item-v2="${escapeHtml(item.id)}"><h3>${escapeHtml(item.category)}</h3><p>${escapeHtml(item.domain)} · ${escapeHtml(item.priority)} · ${escapeHtml(item.status)}</p><p class="muted">SLA：${escapeHtml(item.slaState)}；分派：${escapeHtml(item.assignedRole)}；未读：${escapeHtml(item.unreadMessages)}；版本：${escapeHtml(item.version)}</p><ol>${timeline}</ol></article>`;
    }).join("") || "<p class=\"muted\">暂无统一事项。</p>";
    const regions = viewModel.regions.map((region) => `<article class="evidence-card" data-region-code="${escapeHtml(region.regionCode)}"><h3>地区 ${escapeHtml(region.regionCode)}</h3><p>${escapeHtml(region.deploymentClass)} · 能力 ${escapeHtml(region.enabledCapabilities)} 项</p><p class="muted">配置：${escapeHtml(region.configurationReady ? "ready" : "blocked")}；部署：${escapeHtml(region.deploymentStatus)}；复制：${escapeHtml(region.replicationStatus)}；验收：${escapeHtml(region.acceptanceState)}</p></article>`).join("") || "<p class=\"muted\">暂无地区运行实例。</p>";
    const diffs = viewModel.configurationDiffs.map((diff) => `<li>${escapeHtml(diff.baselineRegionCode)} → ${escapeHtml(diff.targetRegionCode)}：能力键 ${escapeHtml(diff.featureDifferenceCount)}、配置键 ${escapeHtml(diff.configDifferenceCount)}、扩展键 ${escapeHtml(diff.extensionDifferenceCount)}</li>`).join("") || "<li>无地区配置键差异。</li>";
    return `<section data-product-regional-status="${escapeHtml(viewModel.status)}"><div class="metrics-grid">${cards}</div><h3>统一事项中心 2.0</h3><div class="evidence-grid">${workItems}</div><h3>地区运行视图</h3><div class="evidence-grid">${regions}</div><h3>配置差异摘要</h3><ul>${diffs}</ul><p class="muted">${escapeHtml(viewModel.boundary)}</p></section>`;
  }

  function mount(viewModel, target) {
    const document = target?.ownerDocument;
    if (!target || typeof target.replaceChildren !== "function" || typeof document?.createElement !== "function") {
      throw new TypeError("product regional operations mount target is invalid");
    }
    assertViewModel(viewModel);

    const section = document.createElement("section");
    section.dataset.productRegionalStatus = String(viewModel.status ?? "");

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

    appendTextElement(document, section, "h3", "统一事项中心 2.0");
    const workItems = document.createElement("div");
    workItems.className = "evidence-grid";
    if (viewModel.workItems.length === 0) {
      appendTextElement(document, workItems, "p", "暂无统一事项。", "muted");
    } else {
      viewModel.workItems.forEach((item) => {
        const article = document.createElement("article");
        article.className = "evidence-card";
        article.dataset.productWorkItemV2 = String(item.id ?? "");
        appendTextElement(document, article, "h3", item.category);
        appendTextElement(document, article, "p", `${item.domain ?? ""} · ${item.priority ?? ""} · ${item.status ?? ""}`);
        appendTextElement(document, article, "p", `SLA：${item.slaState ?? ""}；分派：${item.assignedRole ?? ""}；未读：${item.unreadMessages ?? ""}；版本：${item.version ?? ""}`, "muted");
        const timeline = document.createElement("ol");
        item.timeline.forEach((event) => {
          appendTextElement(document, timeline, "li", `${event.at ?? ""} · ${event.actorRole ?? ""} · ${event.action ?? ""} · ${event.resultingStatus ?? ""}`);
        });
        article.append(timeline);
        workItems.append(article);
      });
    }
    section.append(workItems);

    appendTextElement(document, section, "h3", "地区运行视图");
    const regions = document.createElement("div");
    regions.className = "evidence-grid";
    if (viewModel.regions.length === 0) {
      appendTextElement(document, regions, "p", "暂无地区运行实例。", "muted");
    } else {
      viewModel.regions.forEach((region) => {
        const article = document.createElement("article");
        article.className = "evidence-card";
        article.dataset.regionCode = String(region.regionCode ?? "");
        appendTextElement(document, article, "h3", `地区 ${region.regionCode ?? ""}`);
        appendTextElement(document, article, "p", `${region.deploymentClass ?? ""} · 能力 ${region.enabledCapabilities ?? ""} 项`);
        appendTextElement(document, article, "p", `配置：${region.configurationReady ? "ready" : "blocked"}；部署：${region.deploymentStatus ?? ""}；复制：${region.replicationStatus ?? ""}；验收：${region.acceptanceState ?? ""}`, "muted");
        regions.append(article);
      });
    }
    section.append(regions);

    appendTextElement(document, section, "h3", "配置差异摘要");
    const diffs = document.createElement("ul");
    if (viewModel.configurationDiffs.length === 0) {
      appendTextElement(document, diffs, "li", "无地区配置键差异。");
    } else {
      viewModel.configurationDiffs.forEach((diff) => {
        appendTextElement(document, diffs, "li", `${diff.baselineRegionCode ?? ""} → ${diff.targetRegionCode ?? ""}：能力键 ${diff.featureDifferenceCount ?? ""}、配置键 ${diff.configDifferenceCount ?? ""}、扩展键 ${diff.extensionDifferenceCount ?? ""}`);
      });
    }
    section.append(diffs);
    appendTextElement(document, section, "p", viewModel.boundary, "muted");
    target.replaceChildren(section);
    return target;
  }

  return Object.freeze({ escapeHtml, mount, render });
});
