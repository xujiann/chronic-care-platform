"use strict";

(function initializeRegionalClinicalDocumentCenter() {
  const auth = window.HealthCityAuth;
  const apiEnabled = location.protocol !== "file:" && !location.hostname.endsWith("github.io");
  const user = auth?.getUser?.() || {};
  const state = { center: null, source: "loading", keyword: "", type: "all", reportingStatus: "all", institution: "all", selectedId: "" };

  const fallbackCenter = Object.freeze({
    schemaVersion: "regional-clinical-document-center-v1",
    sourceRequirement: "D-INT-DOC",
    productionReady: false,
    scope: { role: user.role || "preview", organizationCode: user.orgCode || "preview", crossInstitutionVisible: user.role === "commission", clinicalDetailVisible: false },
    actions: { queryDocuments: true, queryClinicalDetail: false, requestPdfIntent: false, retryExceptions: false },
    summary: { documents: 3, institutions: 2, collectedToday: 2, medicalRecordCards: 1, dischargeSummaries: 2, pendingReport: 1, reported: 1, exceptions: 1, pdfReady: 1 },
    documents: [
      { id: "sample-discharge-001", documentType: "discharge-summary", documentLabel: "电子出院小结", sourceRecordReference: "示例文书-001", residentReference: "居民引用末4位 1001", institutionCode: "ORG-DEMO-01", documentDate: "2026-09-04", receivedAt: "2026-09-04T08:15:00.000Z", status: "accepted", reportingStatus: "reported", clinicalSummary: "", validation: { status: "passed", passed: true, failedChecks: [] }, pdf: { available: false, attachmentId: "", filename: "", integrityStatus: "verified" }, retryCount: 0, actions: { queryDetail: false, viewPdf: false, retryException: false } },
      { id: "sample-card-001", documentType: "medical-record-card", documentLabel: "电子病历卡", sourceRecordReference: "示例文书-002", residentReference: "居民引用末4位 1002", institutionCode: "ORG-DEMO-01", documentDate: "2026-09-04", receivedAt: "2026-09-04T09:10:00.000Z", status: "accepted", reportingStatus: "pending-report", clinicalSummary: "", validation: { status: "passed", passed: true, failedChecks: [] }, pdf: { available: false, attachmentId: "", filename: "", integrityStatus: "not-provided" }, retryCount: 0, actions: { queryDetail: false, viewPdf: false, retryException: false } },
      { id: "sample-discharge-002", documentType: "discharge-summary", documentLabel: "电子出院小结", sourceRecordReference: "示例文书-003", residentReference: "居民引用末4位 1003", institutionCode: "ORG-DEMO-02", documentDate: "2026-09-03", receivedAt: "2026-09-03T16:20:00.000Z", status: "exception", reportingStatus: "exception", clinicalSummary: "", validation: { status: "exception", passed: false, failedChecks: ["transport-signature"] }, pdf: { available: false, attachmentId: "", filename: "", integrityStatus: "not-ready" }, retryCount: 1, actions: { queryDetail: false, viewPdf: false, retryException: false } }
    ],
    exceptions: [{ id: "sample-discharge-002", documentLabel: "电子出院小结", institutionCode: "ORG-DEMO-02", residentReference: "居民引用末4位 1003", issueCodes: ["transport-signature"], retryCount: 1, actions: { retryException: false }, nextAction: "核对源文书后通过既有集成事件重试入口补传" }],
    uploadLogs: [
      { id: "sample-card-001", sourceRecordReference: "示例文书-002", documentLabel: "电子病历卡", institutionCode: "ORG-DEMO-01", receivedAt: "2026-09-04T09:10:00.000Z", validationStatus: "passed", reportingStatus: "pending-report", retryCount: 0 },
      { id: "sample-discharge-001", sourceRecordReference: "示例文书-001", documentLabel: "电子出院小结", institutionCode: "ORG-DEMO-01", receivedAt: "2026-09-04T08:15:00.000Z", validationStatus: "passed", reportingStatus: "reported", retryCount: 0 }
    ],
    workstationReminders: [],
    capabilities: [
      { id: "same-day-collection", label: "当日文书采集归集", status: "repository-verified", interface: "POST /api/integration/events" },
      { id: "signed-acquisition", label: "获取认证与上传验签", status: "repository-verified", interface: "HMAC-SHA256 integration contract" },
      { id: "summary-query", label: "病历卡与出院小结摘要查询", status: "repository-verified", interface: "GET /api/integration/clinical-documents/center" },
      { id: "pdf-query", label: "PDF 安全短时调阅", status: "repository-verified", interface: "POST /api/attachments/:id/download-intent" },
      { id: "upstream-reporting", label: "上级平台正式报送", status: "external-evidence-required", interface: "现场端点、凭据、回执与签字" }
    ],
    blockers: ["静态预览未连接医疗文书业务服务", "真实机构接口、上级平台回执、生产对象存储和医生工作站嵌入仍需现场验收"]
  });

  const $ = (selector) => document.querySelector(selector);
  const el = (tag, options = {}) => {
    const node = document.createElement(tag);
    if (options.className) node.className = options.className;
    if (options.text !== undefined) node.textContent = String(options.text);
    if (options.type) node.type = options.type;
    return node;
  };

  function time(value) {
    const date = new Date(value || "");
    return Number.isNaN(date.getTime()) ? (value || "未记录") : date.toLocaleString("zh-CN", { hour12: false });
  }

  function statusLabel(value) {
    return ({ reported: "已报送", "pending-report": "待报送", exception: "异常", passed: "校验通过", accepted: "已采集", verified: "完整性已验证", "not-ready": "PDF 未就绪", "not-provided": "未提供 PDF", "repository-verified": "仓库已验证", "external-evidence-required": "待外部证据" })[value] || value || "未记录";
  }

  function toneForStatus(value) {
    if (["exception", "not-ready", "external-evidence-required"].includes(value)) return "danger";
    if (["reported", "passed", "accepted", "verified", "repository-verified"].includes(value)) return "success";
    return "warning";
  }

  function setBanner(title, detail, tone = "warning") {
    $("#document-source-title").textContent = title;
    $("#document-source-detail").textContent = detail;
    $("#document-source-banner").dataset.tone = tone;
  }

  function appendMetric(target, label, value, hint) {
    const card = el("article", { className: "work-metric" });
    card.append(el("span", { text: label }), el("strong", { text: value }), el("small", { text: hint }));
    target.append(card);
  }

  function renderMetrics() {
    const summary = state.center.summary;
    const target = $("#document-metrics");
    target.replaceChildren();
    appendMetric(target, "归集文书", summary.documents, `${summary.institutions} 个授权机构`);
    appendMetric(target, "当日采集", summary.collectedToday, "按文书业务日期统计");
    appendMetric(target, "出院小结", summary.dischargeSummaries, `${summary.medicalRecordCards} 份电子病历卡`);
    appendMetric(target, "待报送", summary.pendingReport, `${summary.reported} 份已记录报送状态`);
    appendMetric(target, "异常", summary.exceptions, `${summary.pdfReady} 份 PDF 完整性就绪`);
  }

  function filteredDocuments() {
    return state.center.documents.filter((item) => {
      const searchable = [item.id, item.sourceRecordReference, item.residentReference, item.institutionCode, item.documentLabel].join(" ").toLowerCase();
      return (!state.keyword || searchable.includes(state.keyword))
        && (state.type === "all" || item.documentType === state.type)
        && (state.reportingStatus === "all" || item.reportingStatus === state.reportingStatus)
        && (state.institution === "all" || item.institutionCode === state.institution);
    });
  }

  function appendTextCell(row, primary, secondary, className = "") {
    const cell = el("td");
    cell.append(el("span", { text: primary, className }), el("small", { text: secondary }));
    row.append(cell);
    return cell;
  }

  function actionButton(label, dataset, enabled = true) {
    const button = el("button", { className: "inline-action", text: label, type: "button" });
    Object.entries(dataset).forEach(([key, value]) => { button.dataset[key] = String(value); });
    button.disabled = !enabled;
    return button;
  }

  function renderInstitutionOptions() {
    const select = $("#document-institution-filter");
    const current = select.value;
    while (select.options.length > 1) select.remove(1);
    [...new Set(state.center.documents.map((item) => item.institutionCode).filter(Boolean))].sort().forEach((code) => {
      const option = el("option", { text: code });
      option.value = code;
      select.append(option);
    });
    if ([...select.options].some((option) => option.value === current)) select.value = current;
  }

  function renderDocuments() {
    const items = filteredDocuments();
    const target = $("#document-list");
    target.replaceChildren();
    $("#document-count").textContent = `${items.length} 份`;
    if (!items.length) {
      const row = el("tr");
      const cell = el("td");
      cell.colSpan = 5;
      cell.append(el("div", { className: "empty-state", text: "当前筛选范围没有医疗文书" }));
      row.append(cell);
      target.append(row);
      return;
    }
    items.forEach((item) => {
      const row = el("tr");
      appendTextCell(row, item.documentLabel, `${item.sourceRecordReference || item.id} · ${item.residentReference}`, "clinical-document-reference");
      appendTextCell(row, item.institutionCode || "机构待绑定", item.documentDate || "日期待回写");
      const validationCell = el("td");
      validationCell.append(el("span", { className: `status-pill ${toneForStatus(item.validation?.status)}`, text: statusLabel(item.validation?.status) }), el("small", { text: item.validation?.failedChecks?.length ? `缺项：${item.validation.failedChecks.join("、")}` : `PDF ${statusLabel(item.pdf?.integrityStatus)}` }));
      row.append(validationCell);
      const reportingCell = el("td");
      reportingCell.append(el("span", { className: `status-pill ${toneForStatus(item.reportingStatus)}`, text: statusLabel(item.reportingStatus) }), el("small", { text: `${time(item.receivedAt)} · 重试 ${item.retryCount || 0} 次` }));
      row.append(reportingCell);
      const actionsCell = el("td");
      const actions = el("div", { className: "task-actions" });
      actions.append(actionButton("查看", { documentOpen: item.id }, true));
      if (item.actions?.viewPdf) actions.append(actionButton("调阅 PDF", { documentPdf: item.id }, state.source === "api"));
      actionsCell.append(actions);
      row.append(actionsCell);
      target.append(row);
    });
  }

  function renderExceptions() {
    const target = $("#document-exceptions");
    target.replaceChildren();
    $("#document-exception-count").textContent = `${state.center.exceptions.length} 项`;
    if (!state.center.exceptions.length) {
      target.append(el("div", { className: "empty-state", text: "当前范围没有校验或报送异常" }));
      return;
    }
    state.center.exceptions.forEach((item) => {
      const card = el("article", { className: "clinical-document-card" });
      const header = el("header");
      header.append(el("h3", { text: `${item.documentLabel} · ${item.institutionCode || "机构待绑定"}` }), el("span", { className: "status-pill danger", text: "待处理" }));
      card.append(header, el("p", { text: `${item.residentReference} · 异常项：${(item.issueCodes || []).join("、") || "网关传输异常"}` }), el("p", { text: `${item.nextAction || "核对源数据后处理"} · 已重试 ${item.retryCount || 0} 次` }));
      if (item.actions?.retryException && state.center.actions.retryExceptions) {
        const actions = el("div", { className: "clinical-document-card-actions" });
        actions.append(actionButton("通过既有事件补传", { documentRetry: item.id }, state.source === "api"));
        card.append(actions);
      }
      target.append(card);
    });
  }

  function renderReminders() {
    const target = $("#workstation-reminders");
    const items = state.center.workstationReminders || [];
    target.replaceChildren();
    $("#workstation-reminder-count").textContent = `${items.length} 项`;
    if (!items.length) {
      target.append(el("div", { className: "empty-state", text: state.center.scope.clinicalDetailVisible ? "当前机构暂无可调阅提醒" : "主管部门视角不展示患者级工作站提醒" }));
      return;
    }
    items.forEach((item) => {
      const card = el("article", { className: "clinical-document-card" });
      card.append(el("h3", { text: item.residentReference }), el("p", { text: item.message }), el("p", { text: `最近文书 ${item.latestDocumentDate || "日期待回写"} · ${(item.documentTypes || []).map((type) => type === "discharge-summary" ? "出院小结" : "病历卡").join("、")}` }));
      target.append(card);
    });
  }

  function renderLogs() {
    const target = $("#upload-logs");
    const items = state.center.uploadLogs || [];
    target.replaceChildren();
    $("#upload-log-count").textContent = `${items.length} 条`;
    if (!items.length) {
      target.append(el("div", { className: "empty-state", text: "当前范围暂无采集日志" }));
      return;
    }
    items.slice(0, 30).forEach((item) => {
      const row = el("article", { className: "clinical-document-log" });
      row.append(el("strong", { text: `${item.documentLabel} · ${item.sourceRecordReference || item.id}` }), el("span", { text: `${item.institutionCode || "机构待绑定"} · ${time(item.receivedAt)}` }), el("span", { className: `status-pill ${toneForStatus(item.validationStatus)}`, text: statusLabel(item.validationStatus) }), el("span", { className: `status-pill ${toneForStatus(item.reportingStatus)}`, text: statusLabel(item.reportingStatus) }));
      target.append(row);
    });
  }

  function renderCapabilities() {
    const target = $("#document-capabilities");
    target.replaceChildren();
    state.center.capabilities.forEach((item) => {
      const card = el("article", { className: "clinical-document-capability" });
      card.append(el("strong", { text: item.label }), el("span", { className: `status-pill ${toneForStatus(item.status)}`, text: statusLabel(item.status) }), el("span", { text: item.interface }));
      target.append(card);
    });
    $("#document-blockers").replaceChildren(...state.center.blockers.map((item) => el("li", { text: item })));
  }

  function render() {
    renderMetrics();
    renderInstitutionOptions();
    renderDocuments();
    renderExceptions();
    renderReminders();
    renderLogs();
    renderCapabilities();
  }

  async function requestJson(path, options = {}) {
    const request = auth?.authFetch || fetch;
    const response = await request(path, options);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message || payload.error || `请求失败（${response.status}）`);
    return payload;
  }

  async function load() {
    $("#document-refresh").disabled = true;
    setBanner("正在读取授权医疗文书", "正在校验账号、机构与临床详情范围。", "warning");
    try {
      if (!apiEnabled) throw new Error("静态预览未连接业务服务");
      state.center = await requestJson("/api/integration/clinical-documents/center");
      state.source = "api";
      const scopeText = state.center.scope.crossInstitutionVisible ? "跨机构运行视角，不含临床内容" : `${state.center.scope.organizationCode} 机构最小授权视角`;
      setBanner("区域医疗文书业务服务已连接", `${scopeText}；最近刷新：${new Date().toLocaleString("zh-CN", { hour12: false })}。`, "normal");
    } catch (error) {
      state.center = fallbackCenter;
      state.source = "fallback";
      setBanner("当前显示只读结构示例", `${error.message || "业务服务不可用"}。补传和 PDF 短时调阅均已禁用。`, "danger");
    } finally {
      $("#document-refresh").disabled = false;
      render();
    }
  }

  function detailField(term, value) {
    const wrapper = el("div");
    wrapper.append(el("dt", { text: term }), el("dd", { text: value || "未记录" }));
    return wrapper;
  }

  function showDetail(id) {
    const item = state.center.documents.find((entry) => entry.id === id);
    if (!item) return;
    state.selectedId = id;
    $("#document-detail-type").textContent = item.documentLabel;
    $("#document-detail-title").textContent = item.sourceRecordReference || item.id;
    $("#document-detail-fields").replaceChildren(
      detailField("居民引用", item.residentReference),
      detailField("机构代码", item.institutionCode),
      detailField("文书日期", item.documentDate),
      detailField("采集时间", time(item.receivedAt)),
      detailField("校验结果", statusLabel(item.validation?.status)),
      detailField("报送状态", statusLabel(item.reportingStatus)),
      detailField("PDF 完整性", statusLabel(item.pdf?.integrityStatus)),
      detailField("重试次数", item.retryCount || 0)
    );
    $("#document-clinical-summary").textContent = item.actions?.queryDetail && item.clinicalSummary ? item.clinicalSummary : "当前账号范围不展示临床内容，或源文书未提供可用摘要。";
    $("#document-detail-pdf").disabled = state.source !== "api" || !item.actions?.viewPdf;
    $("#document-detail-dialog").showModal();
  }

  async function retryDocument(id) {
    setBanner("正在提交异常补传", "补传将复用既有集成事件重试入口。", "warning");
    try {
      await requestJson(`/api/integration/events/${encodeURIComponent(id)}/retry`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: "区域医疗文书中心人工复核后补传" }) });
      setBanner("异常补传已由服务端受理", "正在重新读取权威采集与报送状态。", "normal");
      await load();
    } catch (error) {
      setBanner("异常补传未完成", `${error.message || "服务端未返回成功回执"}。页面未修改本地业务状态。`, "danger");
    }
  }

  async function requestPdf(id) {
    const item = state.center.documents.find((entry) => entry.id === id);
    if (!item?.actions?.viewPdf || !item.pdf?.attachmentId || state.source !== "api") return;
    setBanner("正在申请 PDF 短时调阅", "服务端将再次核验账号、机构范围和附件完整性。", "warning");
    try {
      const payload = await requestJson(`/api/attachments/${encodeURIComponent(item.pdf.attachmentId)}/download-intent`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ purpose: "医疗机构授权调阅区域医疗文书" }) });
      const downloadUrl = payload.downloadIntent?.downloadUrl;
      const parsed = new URL(downloadUrl);
      window.HealthBrowserSafeUrl.navigate(downloadUrl, { capability: "object-storage", baseUrl: location, allowedOrigins: [parsed.origin], allowHttpLocalhost: parsed.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname), mode: "assign" });
    } catch (error) {
      setBanner("PDF 调阅未完成", `${error.message || "短时调阅凭据创建失败"}。未进行外部跳转。`, "danger");
    }
  }

  $("#document-refresh").addEventListener("click", load);
  $("#document-search").addEventListener("input", (event) => { state.keyword = event.target.value.trim().toLowerCase(); renderDocuments(); });
  $("#document-type-filter").addEventListener("change", (event) => { state.type = event.target.value; renderDocuments(); });
  $("#document-status-filter").addEventListener("change", (event) => { state.reportingStatus = event.target.value; renderDocuments(); });
  $("#document-institution-filter").addEventListener("change", (event) => { state.institution = event.target.value; renderDocuments(); });
  $("#document-list").addEventListener("click", (event) => {
    const open = event.target.closest("[data-document-open]");
    const pdf = event.target.closest("[data-document-pdf]");
    if (open) showDetail(open.dataset.documentOpen);
    else if (pdf) requestPdf(pdf.dataset.documentPdf);
  });
  $("#document-exceptions").addEventListener("click", (event) => {
    const retry = event.target.closest("[data-document-retry]");
    if (retry) retryDocument(retry.dataset.documentRetry);
  });
  $("#document-detail-pdf").addEventListener("click", () => requestPdf(state.selectedId));
  document.querySelectorAll("[data-close-dialog]").forEach((button) => button.addEventListener("click", () => button.closest("dialog").close()));

  load();
})();
