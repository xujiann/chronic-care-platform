(function initProcurementPortfolioUi(root) {
  "use strict";

  const PAGE_SIZE = 20;
  const SAFE_ID = /^[A-Za-z0-9]+(?:[._:-][A-Za-z0-9]+)*$/;
  const SAFE_CAPABILITY_ID = /^[A-Z]-[A-Z0-9]+(?:-[A-Z0-9]+)*$/;
  const SAFE_REQUIREMENT_ID = /^REQ-[A-F0-9]{12}$/;
  const SAFE_SOURCE_ID = /^SRC-[A-F0-9]{12}$/;
  const DELIVERY_STATUSES = new Set(["not-planned", "awaiting-plan", "planned", "in-delivery", "evidence-review", "repository-verified", "acceptance-review", "acceptance-returned", "delivery-accepted", "source-stale"]);
  const DEVIATION_CODES = new Set(["REVIEW_NOT_ACCEPTED", "REPOSITORY_COVERAGE_GAP", "CROSS_SOURCE_CONFLICT", "TRACE_OR_EVIDENCE_INCOMPLETE"]);
  const DECISION_CODES = new Set(["REUSE", "ENHANCE", "BUILD", "CONFIGURE", "DEPLOY"]);
  const state = { report: null, page: 1, target: null };

  function count(value) { return Number.isInteger(value) && value >= 0 ? value : 0; }
  function safeId(value, fallback = "redacted") { const text = String(value || ""); return SAFE_ID.test(text) && text.length <= 96 ? text : fallback; }
  function safeIds(values) { return [...new Set((Array.isArray(values) ? values : []).map((value) => safeId(value)).filter((value) => value !== "redacted"))].sort(); }
  function safeCapabilities(values) { return [...new Set((Array.isArray(values) ? values : []).filter((value) => SAFE_CAPABILITY_ID.test(String(value))))].sort(); }
  function element(documentRef, tag, className, text) { const node = documentRef.createElement(tag); node.className = className || ""; if (text !== undefined) node.textContent = String(text); return node; }
  function metric(documentRef, label, value) { const card = element(documentRef, "article", "procurement-portfolio-metric"); card.append(element(documentRef, "strong", "", count(value)), element(documentRef, "span", "", label)); return card; }
  function field(documentRef, label, value) { const row = element(documentRef, "p", "procurement-portfolio-field"); row.append(element(documentRef, "strong", "", `${label}：`), element(documentRef, "span", "", value)); return row; }

  function normalizedExport(portfolio) {
    const sourceColumns = (Array.isArray(portfolio?.differenceMatrix?.sourceColumns) ? portfolio.differenceMatrix.sourceColumns : []).filter((item) => SAFE_SOURCE_ID.test(String(item.sourceKey || ""))).map((item, index) => ({ sourceKey: item.sourceKey, label: `配置单元 ${String(index + 1).padStart(3, "0")}` }));
    const sourceIds = new Set(sourceColumns.map((item) => item.sourceKey));
    const responseStatuses = new Set(["pending-human-review", "human-accepted", "revision-required", "rejected"]);
    return {
      schemaVersion: "procurement-requirement-portfolio-export-v1",
      generatedAt: Number.isFinite(Date.parse(portfolio?.generatedAt)) ? portfolio.generatedAt : new Date(0).toISOString(),
      productionReady: false,
      differenceMatrix: {
        sourceColumns,
        rows: (Array.isArray(portfolio?.differenceMatrix?.rows) ? portfolio.differenceMatrix.rows : []).map((row) => ({ capabilityId: SAFE_CAPABILITY_ID.test(String(row.capabilityId || "")) ? row.capabilityId : "UNMAPPED", ownerProcess: /^T0\d$/.test(String(row.ownerProcess || "")) ? row.ownerProcess : "T00", cells: (Array.isArray(row.cells) ? row.cells : []).filter((cell) => sourceIds.has(cell.sourceKey)).map((cell) => ({ sourceKey: cell.sourceKey, required: cell.required === true, decisions: [...new Set((Array.isArray(cell.decisions) ? cell.decisions : []).filter((value) => DECISION_CODES.has(value)))].sort(), priorities: (Array.isArray(cell.priorities) ? cell.priorities : []).filter((value) => ["P0", "P1", "P2"].includes(value)) })) }))
      },
      configurationPackage: {
        packageId: portfolio?.configurationPackage?.packageId === "PKG-GENERIC-HEALTH-PLATFORM" ? portfolio.configurationPackage.packageId : "PKG-GENERIC-HEALTH-PLATFORM",
        commonCapabilityIds: safeCapabilities(portfolio?.configurationPackage?.commonCapabilityIds),
        deploymentUnits: (Array.isArray(portfolio?.configurationPackage?.deploymentUnits) ? portfolio.configurationPackage.deploymentUnits : []).filter((item) => sourceIds.has(item.sourceKey)).map((item) => ({ sourceKey: item.sourceKey, enabledCapabilityIds: safeCapabilities(item.enabledCapabilityIds), manualReviewRequired: item.manualReviewRequired === true })),
        activationAuthorized: false
      },
      responseTable: (Array.isArray(portfolio?.responseTable) ? portfolio.responseTable : []).filter((item) => SAFE_REQUIREMENT_ID.test(String(item.logicalRequirementId || ""))).map((item) => ({ logicalRequirementId: item.logicalRequirementId, responseStatus: responseStatuses.has(item.responseStatus) ? item.responseStatus : "pending-human-review", deliveryStatus: DELIVERY_STATUSES.has(item.deliveryStatus) ? item.deliveryStatus : "not-planned", targetCapabilityIds: safeCapabilities(item.targetCapabilityIds) })),
      deviationTable: (Array.isArray(portfolio?.deviationTable) ? portfolio.deviationTable : []).filter((item) => SAFE_REQUIREMENT_ID.test(String(item.logicalRequirementId || ""))).map((item) => ({ logicalRequirementId: item.logicalRequirementId, deviationCodes: [...new Set((Array.isArray(item.deviationCodes) ? item.deviationCodes : []).filter((code) => DEVIATION_CODES.has(code)))].sort(), disposition: "manual-review-required" })),
      acceptanceChecklist: (Array.isArray(portfolio?.acceptanceChecklist) ? portfolio.acceptanceChecklist : []).filter((item) => SAFE_REQUIREMENT_ID.test(String(item.logicalRequirementId || ""))).map((item) => ({ logicalRequirementId: item.logicalRequirementId, repositoryTraceComplete: item.repositoryTraceComplete === true, evidenceVerified: item.evidenceVerified === true, siteAcceptanceStatus: "not-evaluated", productionAuthorized: false })),
      boundary: "导出仅包含中性标识、配置差异、人工治理状态和仓库证据状态；不包含原文、地域机构名称、文件路径或现场结论，不构成自动接受或生产授权。"
    };
  }

  function download(portfolio, kind = "portfolio") {
    const bundle = normalizedExport(portfolio);
    const selections = {
      matrix: { schemaVersion: bundle.schemaVersion, generatedAt: bundle.generatedAt, productionReady: false, differenceMatrix: bundle.differenceMatrix, boundary: bundle.boundary },
      configuration: { schemaVersion: bundle.schemaVersion, generatedAt: bundle.generatedAt, productionReady: false, configurationPackage: bundle.configurationPackage, boundary: bundle.boundary },
      response: { schemaVersion: bundle.schemaVersion, generatedAt: bundle.generatedAt, productionReady: false, responseTable: bundle.responseTable, boundary: bundle.boundary },
      deviation: { schemaVersion: bundle.schemaVersion, generatedAt: bundle.generatedAt, productionReady: false, deviationTable: bundle.deviationTable, boundary: bundle.boundary },
      acceptance: { schemaVersion: bundle.schemaVersion, generatedAt: bundle.generatedAt, productionReady: false, acceptanceChecklist: bundle.acceptanceChecklist, boundary: bundle.boundary }
    };
    const payload = selections[kind] || bundle;
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
    const url = root.URL.createObjectURL(blob);
    const link = document.createElement("a");
    if (root.HealthBrowserSafeUrl?.setElementUrl) root.HealthBrowserSafeUrl.setElementUrl(link, "href", url, { allowedProtocols: ["blob:"] });
    else link.href = url;
    link.download = `招标需求治理-${kind}-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}.json`;
    link.click();
    root.URL.revokeObjectURL?.(url);
  }

  function renderSummary(documentRef, portfolio) {
    const wrapper = element(documentRef, "div", "procurement-portfolio-metrics");
    const summary = portfolio.summary || {};
    wrapper.append(
      metric(documentRef, "登记批次", summary.batches),
      metric(documentRef, "中性来源", summary.sourceSeries),
      metric(documentRef, "归并候选", summary.duplicateGroups),
      metric(documentRef, "冲突待复核", summary.conflicts),
      metric(documentRef, "影响项", Array.isArray(portfolio.impactAnalysis) ? portfolio.impactAnalysis.length : 0),
      metric(documentRef, "完整追踪链", summary.completeTraceChains)
    );
    return wrapper;
  }

  function renderGovernance(documentRef, portfolio) {
    const section = element(documentRef, "section", "procurement-portfolio-block");
    section.append(element(documentRef, "h3", "", "跨来源归并与版本治理"));
    const body = element(documentRef, "div", "procurement-portfolio-list");
    const duplicates = Array.isArray(portfolio.duplicateGroups) ? portfolio.duplicateGroups : [];
    const conflicts = Array.isArray(portfolio.conflicts?.items) ? portfolio.conflicts.items : [];
    const inheritance = Array.isArray(portfolio.versionInheritance) ? portfolio.versionInheritance : [];
    if (!duplicates.length && !conflicts.length && !inheritance.length) body.append(element(documentRef, "p", "muted", "当前未发现跨来源归并、冲突或版本继承事项。"));
    duplicates.slice(0, PAGE_SIZE).forEach((item) => { const card = element(documentRef, "article", "procurement-portfolio-card"); card.append(element(documentRef, "strong", "", `归并候选 ${safeId(item.groupId)}`), field(documentRef, "规范需求", safeId(item.canonicalLogicalRequirementId)), field(documentRef, "成员数", count(item.memberLogicalRequirementIds?.length)), field(documentRef, "处置", "必须人工确认，不自动合并")); body.append(card); });
    conflicts.slice(0, PAGE_SIZE).forEach((item) => { const card = element(documentRef, "article", "procurement-portfolio-card is-warning"); card.append(element(documentRef, "strong", "", `冲突 ${safeId(item.conflictId)}`), field(documentRef, "能力", safeId(item.capabilityId)), field(documentRef, "差异字段", safeIds(item.conflictingFields).join("、") || "待复核"), field(documentRef, "处置", "人工消歧后才可进入配置")); body.append(card); });
    inheritance.slice(0, PAGE_SIZE).forEach((item) => { const card = element(documentRef, "article", "procurement-portfolio-card"); card.append(element(documentRef, "strong", "", `版本继承 ${safeId(item.logicalRequirementId)}`), field(documentRef, "修订", `${count(item.fromRevision)} → ${count(item.toRevision)}`), field(documentRef, "结论", safeId(item.eligibility)), field(documentRef, "自动继承", "关闭")); body.append(card); });
    section.append(body);
    return section;
  }

  function renderTrace(documentRef, portfolio) {
    const section = element(documentRef, "section", "procurement-portfolio-block");
    section.append(element(documentRef, "h3", "", "需求全链路追踪"));
    const chains = Array.isArray(portfolio.traceChains) ? portfolio.traceChains : [];
    const pageCount = Math.max(1, Math.ceil(chains.length / PAGE_SIZE));
    state.page = Math.min(Math.max(1, state.page), pageCount);
    const controls = element(documentRef, "div", "procurement-portfolio-toolbar");
    const previous = element(documentRef, "button", "secondary-button", "上一页"); previous.type = "button"; previous.disabled = state.page <= 1;
    const next = element(documentRef, "button", "secondary-button", "下一页"); next.type = "button"; next.disabled = state.page >= pageCount;
    controls.append(element(documentRef, "span", "muted", `第 ${state.page} / ${pageCount} 页`), previous, next);
    previous.addEventListener("click", () => { state.page -= 1; render(portfolio); });
    next.addEventListener("click", () => { state.page += 1; render(portfolio); });
    section.append(controls);
    const body = element(documentRef, "div", "procurement-portfolio-list");
    chains.slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE).forEach((item) => {
      const capabilities = Array.isArray(item.capabilities) ? item.capabilities : [];
      const card = element(documentRef, "article", `procurement-portfolio-card${item.traceComplete ? " is-complete" : ""}`);
      card.append(element(documentRef, "strong", "", safeId(item.logicalRequirementId)), field(documentRef, "能力", safeIds(capabilities.map((entry) => entry.capabilityId)).join("、") || "未映射"), field(documentRef, "页面", count(capabilities.reduce((sum, entry) => sum + count(entry.pages?.length), 0))), field(documentRef, "接口", count(capabilities.reduce((sum, entry) => sum + count(entry.interfaces?.length), 0))), field(documentRef, "测试", count(capabilities.reduce((sum, entry) => sum + count(entry.tests?.length), 0))), field(documentRef, "验收证据", (item.acceptanceEvidence || []).map((entry) => `${safeId(entry.type)}:${safeId(entry.status, "missing")}`).join(" · ")), field(documentRef, "链路状态", item.traceComplete ? "仓库链路完整" : "仍需补充或核验"));
      body.append(card);
    });
    if (!chains.length) body.append(element(documentRef, "p", "muted", "暂无需求追踪记录。"));
    section.append(body);
    return section;
  }

  function renderMatrix(documentRef, portfolio) {
    const section = element(documentRef, "section", "procurement-portfolio-block");
    section.append(element(documentRef, "h3", "", "配置差异矩阵"));
    const columns = Array.isArray(portfolio.differenceMatrix?.sourceColumns) ? portfolio.differenceMatrix.sourceColumns : [];
    const rows = Array.isArray(portfolio.differenceMatrix?.rows) ? portfolio.differenceMatrix.rows : [];
    const tableWrap = element(documentRef, "div", "procurement-portfolio-table-wrap");
    const table = element(documentRef, "table", "procurement-portfolio-table");
    const head = element(documentRef, "thead"); const headRow = element(documentRef, "tr"); headRow.append(element(documentRef, "th", "", "能力"), ...columns.map((_, index) => element(documentRef, "th", "", `配置单元 ${String(index + 1).padStart(3, "0")}`))); head.append(headRow); table.append(head);
    const body = element(documentRef, "tbody");
    rows.slice(0, PAGE_SIZE).forEach((row) => { const tr = element(documentRef, "tr"); tr.append(element(documentRef, "th", "", safeId(row.capabilityId))); columns.forEach((column) => { const cell = (row.cells || []).find((item) => item.sourceKey === column.sourceKey); tr.append(element(documentRef, "td", cell?.required ? "is-required" : "", cell?.required ? "需要" : "不需要")); }); body.append(tr); });
    table.append(body); tableWrap.append(table); section.append(tableWrap);
    return section;
  }

  function renderExports(documentRef, portfolio) {
    const section = element(documentRef, "section", "procurement-portfolio-block");
    section.append(element(documentRef, "h3", "", "通用配置与安全导出"), element(documentRef, "p", "muted", "仅导出中性标识与治理状态，不导出招标原文、地域机构名称、文件路径或生产结论。"));
    const controls = element(documentRef, "div", "procurement-portfolio-toolbar");
    [["portfolio", "导出完整治理包"], ["matrix", "导出差异矩阵"], ["configuration", "导出通用配置包"], ["response", "导出功能响应表"], ["deviation", "导出偏离表"], ["acceptance", "导出验收清单"]].forEach(([kind, label]) => { const button = element(documentRef, "button", kind === "portfolio" ? "primary-button" : "secondary-button", label); button.type = "button"; button.addEventListener("click", () => download(portfolio, kind)); controls.append(button); });
    section.append(controls, field(documentRef, "公共能力", safeIds(portfolio.configurationPackage?.commonCapabilityIds).join("、") || "待形成"), field(documentRef, "激活授权", "关闭"));
    return section;
  }

  function render(portfolio, target) {
    const container = target || state.target || document.querySelector("#platform-procurement-portfolio-v4");
    if (!container || !portfolio) return false;
    state.report = portfolio; state.target = container;
    const documentRef = container.ownerDocument || document;
    container.replaceChildren(renderSummary(documentRef, portfolio), renderGovernance(documentRef, portfolio), renderTrace(documentRef, portfolio), renderMatrix(documentRef, portfolio), renderExports(documentRef, portfolio));
    container.dataset.productionReady = "false";
    return true;
  }

  root.HealthPlatformProcurementPortfolioUi = Object.freeze({ download, normalizedExport, render });
})(typeof globalThis === "object" ? globalThis : this);
