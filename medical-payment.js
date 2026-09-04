"use strict";

(function initializeMedicalPaymentCenter() {
  const auth = window.HealthCityAuth;
  const apiEnabled = location.protocol !== "file:" && !location.hostname.endsWith("github.io");
  const user = auth?.getUser?.() || {};
  const state = { center: null, source: "loading", keyword: "", gateway: "all", status: "all" };

  const fallbackCenter = Object.freeze({
    schemaVersion: "medical-payment-one-stop-view-v1",
    productionReady: false,
    scope: { role: user.role || "preview", organizationCode: user.orgCode || "preview", gatewayTypes: ["PAYMENT", "INSURANCE"] },
    actions: { dispatchPayment: false, requestRefund: false, reviewRefund: false, runReconciliation: false },
    summary: { orders: 2, transactions: 2, pending: 1, succeeded: 1, exceptions: 0, grossAmountFen: 22_500, personalAmountFen: 8_600, insuranceAmountFen: 13_900, refundRequests: 1, refundPendingReview: 1, refundExceptions: 0, reconciliationRuns: 0, reconciliationDifferences: 0 },
    queue: [
      { id: "sample-payment-1", gatewayType: "PAYMENT", operation: "create-payment", orderReference: "示例订单-001", institutionCode: "ORG-DEMO-01", receiptId: "示例回执-001", status: "succeeded", reconciliationStatus: "provider-final", businessDate: "2026-09-04", amountFen: 12_600, insuranceAmountFen: 8_000, personalAmountFen: 4_600, reservedRefundFen: 2_000, availableRefundFen: 10_600, actions: { requestRefund: false } },
      { id: "sample-insurance-1", gatewayType: "INSURANCE", operation: "settlement", orderReference: "示例结算-001", institutionCode: "ORG-DEMO-01", receiptId: "示例医保回执-001", status: "accepted", reconciliationStatus: "provider-processing", businessDate: "2026-09-04", amountFen: 9_900, insuranceAmountFen: 5_900, personalAmountFen: 4_000, reservedRefundFen: 0, availableRefundFen: 0, actions: { requestRefund: false } }
    ],
    refunds: [{ id: "sample-refund-1", orderReference: "示例订单-001", refundAmountFen: 2_000, reasonCode: "SERVICE_CANCELLED", state: "REQUESTED", status: "待业务与财务复核", reviewRevision: 1, reviewCount: 0, attemptCount: 0, sla: { status: "within-sla", dueAt: "2026-09-04T12:00:00.000Z" }, ledgerValid: true, stateProjectionValid: true }],
    refundExceptions: [],
    reconciliationRuns: [],
    gateways: [{ type: "PAYMENT", configured: false, callbackConfigured: false, productionHttps: true, operations: ["create-payment", "refund", "reconcile"] }, { type: "INSURANCE", configured: false, callbackConfigured: false, productionHttps: true, operations: ["settlement", "reconcile"] }],
    blockers: ["静态预览未连接支付与医保业务服务", "真实通道、回调、账单、对账验收和现场签字仍未完成"]
  });

  const $ = (selector) => document.querySelector(selector);
  const el = (tag, options = {}) => {
    const node = document.createElement(tag);
    if (options.className) node.className = options.className;
    if (options.text !== undefined) node.textContent = String(options.text);
    if (options.type) node.type = options.type;
    return node;
  };

  function idempotencyKey(prefix) {
    const token = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return `${prefix}-${token}`;
  }

  function money(fen) {
    return `¥${(Number(fen || 0) / 100).toFixed(2)}`;
  }

  function time(value) {
    const date = new Date(value || "");
    return Number.isNaN(date.getTime()) ? (value || "未记录") : date.toLocaleString("zh-CN", { hour12: false });
  }

  function statusLabel(value) {
    const labels = {
      accepted: "已受理",
      processing: "处理中",
      succeeded: "已成功",
      failed: "失败",
      cancelled: "已取消",
      reversed: "已冲正",
      REQUESTED: "待复核",
      UNDER_REVIEW: "复核中",
      APPROVED: "已通过复核",
      DISPATCHED: "已发起退费",
      PROCESSING: "退费处理中",
      FAILED: "退费异常",
      SUCCEEDED: "退费成功",
      RECONCILED: "已对账",
      CLOSED: "已结案"
    };
    return labels[value] || value || "未知";
  }

  function toneForStatus(value) {
    if (["failed", "cancelled", "reversed", "FAILED"].includes(value)) return "danger";
    if (["succeeded", "SUCCEEDED", "RECONCILED", "CLOSED"].includes(value)) return "success";
    return "warning";
  }

  function setBanner(title, detail, tone = "warning") {
    $("#payment-source-title").textContent = title;
    $("#payment-source-detail").textContent = detail;
    $("#payment-source-banner").dataset.tone = tone;
  }

  function appendMetric(target, label, value, hint) {
    const card = el("article", { className: "work-metric" });
    card.append(el("span", { text: label }), el("strong", { text: value }), el("small", { text: hint }));
    target.append(card);
  }

  function renderMetrics() {
    const summary = state.center.summary;
    const target = $("#payment-metrics");
    target.replaceChildren();
    appendMetric(target, "医疗订单", summary.orders, "按授权交易引用去重");
    appendMetric(target, "交易总额", money(summary.grossAmountFen), `${summary.transactions} 笔支付或医保交易`);
    appendMetric(target, "个人支付", money(summary.personalAmountFen), "仅显示账本已提供的金额构成");
    appendMetric(target, "待处理", summary.pending + summary.refundPendingReview, "支付回调与退费复核");
    appendMetric(target, "异常", summary.exceptions + summary.refundExceptions + summary.reconciliationDifferences, "通道、退费与对账差异");
  }

  function filteredQueue() {
    return state.center.queue.filter((item) => {
      const searchable = [item.orderReference, item.receiptId, item.institutionCode, item.id].join(" ").toLowerCase();
      return (!state.keyword || searchable.includes(state.keyword))
        && (state.gateway === "all" || item.gatewayType === state.gateway)
        && (state.status === "all" || item.status === state.status);
    });
  }

  function appendTextCell(row, primary, secondary, className = "") {
    const cell = el("td");
    const first = el("span", { text: primary, className });
    const second = el("small", { text: secondary });
    cell.append(first, second);
    row.append(cell);
    return cell;
  }

  function actionButton(label, dataset) {
    const button = el("button", { className: "inline-action", text: label, type: "button" });
    Object.entries(dataset).forEach(([key, value]) => { button.dataset[key] = String(value); });
    button.disabled = state.source !== "api";
    return button;
  }

  function renderQueue() {
    const items = filteredQueue();
    const target = $("#payment-queue");
    target.replaceChildren();
    $("#payment-queue-count").textContent = `${items.length} 项`;
    if (!items.length) {
      const row = el("tr");
      const cell = el("td");
      cell.colSpan = 5;
      cell.append(el("div", { className: "empty-state", text: "当前筛选范围没有支付或医保交易" }));
      row.append(cell);
      target.append(row);
      return;
    }
    items.forEach((item) => {
      const row = el("tr");
      appendTextCell(row, item.orderReference, `${item.id} · ${item.institutionCode || "机构范围待绑定"}`);
      appendTextCell(row, money(item.amountFen), `医保 ${money(item.insuranceAmountFen)} · 个人 ${money(item.personalAmountFen)}`, "payment-amount");
      const statusCell = el("td");
      statusCell.append(el("span", { className: `status-pill ${toneForStatus(item.status)}`, text: statusLabel(item.status) }), el("small", { text: `${item.gatewayType} / ${item.operation} · ${item.receiptId || "待回执"}` }));
      row.append(statusCell);
      appendTextCell(row, item.reconciliationStatus || "待对账", item.businessDate || "业务日期待回写");
      const actionsCell = el("td");
      const actions = el("div", { className: "task-actions" });
      if (item.actions?.requestRefund && state.center.actions.requestRefund) {
        actions.append(actionButton("申请退费", { refundOpen: item.id }));
      } else {
        actions.append(el("small", { text: item.availableRefundFen > 0 ? `可退 ${money(item.availableRefundFen)}` : "暂无可用操作" }));
      }
      actionsCell.append(actions);
      row.append(actionsCell);
      target.append(row);
    });
  }

  function renderStatusOptions() {
    const select = $("#payment-status-filter");
    const current = select.value;
    while (select.options.length > 1) select.remove(1);
    [...new Set(state.center.queue.map((item) => item.status).filter(Boolean))].sort().forEach((status) => {
      const option = el("option", { text: statusLabel(status) });
      option.value = status;
      select.append(option);
    });
    if ([...select.options].some((option) => option.value === current)) select.value = current;
  }

  function renderRefunds() {
    const target = $("#refund-list");
    target.replaceChildren();
    $("#refund-count").textContent = `${state.center.refunds.length} 项`;
    if (!state.center.refunds.length) {
      target.append(el("div", { className: "empty-state", text: "当前范围没有退费申请" }));
      return;
    }
    state.center.refunds.forEach((item) => {
      const card = el("article", { className: "payment-card" });
      const header = el("header");
      header.append(el("h3", { text: `${item.orderReference || "医疗订单"} · ${money(item.refundAmountFen)}` }), el("span", { className: `status-pill ${toneForStatus(item.state)}`, text: statusLabel(item.state) }));
      card.append(header, el("p", { text: `${item.reasonCode || "OTHER"} · 已复核 ${item.reviewCount || 0} 次 · 已尝试 ${item.attemptCount || 0} 次` }), el("p", { text: `时限 ${item.sla?.status || "未计算"} · ${time(item.sla?.dueAt)} · 账本 ${item.ledgerValid && item.stateProjectionValid ? "一致" : "待复核"}` }));
      if (state.center.actions.reviewRefund && ["REQUESTED", "UNDER_REVIEW"].includes(item.state)) {
        const actions = el("div", { className: "payment-card-actions" });
        actions.append(actionButton("独立复核", { reviewOpen: item.id }));
        card.append(actions);
      }
      target.append(card);
    });
  }

  function renderReconciliation() {
    const target = $("#reconciliation-list");
    target.replaceChildren();
    $("#reconciliation-count").textContent = `${state.center.reconciliationRuns.length} 批`;
    if (!state.center.reconciliationRuns.length) {
      target.append(el("div", { className: "empty-state", text: "尚无授权范围内的日终对账批次" }));
      return;
    }
    state.center.reconciliationRuns.forEach((item) => {
      const card = el("article", { className: "payment-card" });
      const header = el("header");
      header.append(el("h3", { text: `${item.gatewayType} · ${item.businessDate}` }), el("span", { className: `status-pill ${item.status === "matched" ? "success" : "danger"}`, text: item.status === "matched" ? "账实相符" : "存在差异" }));
      card.append(header, el("p", { text: `平台 ${item.platformSummary?.total || 0} 笔 · 通道 ${item.providerSummary?.total || 0} 笔 · 金额差 ${money(item.differences?.grossAmountFen || 0)}` }), el("p", { text: `${item.id} · ${time(item.createdAt)}` }));
      target.append(card);
    });
  }

  function renderGateways() {
    const target = $("#gateway-list");
    target.replaceChildren();
    state.center.gateways.forEach((item) => {
      const card = el("article", { className: "payment-gateway-card" });
      card.append(el("strong", { text: item.type === "PAYMENT" ? "支付通道" : "医保通道" }), el("span", { text: `请求适配 ${item.configured ? "已配置" : "未配置"} · 回调验签 ${item.callbackConfigured ? "已配置" : "未配置"} · HTTPS ${item.productionHttps ? "符合" : "不符合"}` }), el("span", { text: `已登记操作：${(item.operations || []).join("、") || "无"}` }));
      target.append(card);
    });
    const blockers = $("#payment-blockers");
    blockers.replaceChildren(...state.center.blockers.map((item) => el("li", { text: item })));
  }

  function renderActions() {
    $("#payment-create-open").disabled = state.source !== "api" || !state.center.actions.dispatchPayment;
    $("#reconciliation-open").disabled = state.source !== "api" || !state.center.actions.runReconciliation;
    const gatewaySelect = $("#reconciliation-form").elements.gatewayType;
    if (state.center.scope.role === "insurance") {
      gatewaySelect.value = "INSURANCE";
      gatewaySelect.disabled = true;
    } else {
      gatewaySelect.disabled = false;
    }
  }

  function render() {
    renderMetrics();
    renderStatusOptions();
    renderQueue();
    renderRefunds();
    renderReconciliation();
    renderGateways();
    renderActions();
  }

  async function requestJson(path, options = {}) {
    const request = auth?.authFetch || fetch;
    const response = await request(path, options);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message || payload.error || `请求失败（${response.status}）`);
    return payload;
  }

  async function load() {
    $("#payment-refresh").disabled = true;
    setBanner("正在读取授权支付数据", "正在校验账号、机构和网关范围。", "warning");
    try {
      if (!apiEnabled) throw new Error("静态预览未连接业务服务");
      state.center = await requestJson("/api/medical-payments/center");
      state.source = "api";
      setBanner("医疗付费业务服务已连接", `当前范围：${state.center.scope.organizationCode}；最近刷新：${new Date().toLocaleString("zh-CN", { hour12: false })}。`, "normal");
    } catch (error) {
      state.center = fallbackCenter;
      state.source = "fallback";
      setBanner("当前显示只读结构示例", `${error.message || "业务服务不可用"}。支付、退费、复核和对账写操作均已禁用。`, "danger");
    } finally {
      $("#payment-refresh").disabled = false;
      render();
    }
  }

  function showDialog(selector) {
    const dialog = $(selector);
    dialog.querySelectorAll("[data-form-error]").forEach((target) => { target.hidden = true; target.textContent = ""; });
    dialog.showModal();
  }

  function showRefundDialog(eventId) {
    const item = state.center.queue.find((entry) => entry.id === eventId);
    if (!item || !item.actions?.requestRefund) return;
    const form = $("#refund-form");
    form.reset();
    form.elements.paymentEventId.value = item.id;
    form.elements.paymentTradeNo.value = item.receiptId;
    form.elements.orderReference.value = item.orderReference;
    form.elements.refundAmountFen.max = String(item.availableRefundFen);
    $("#refund-order-reference").textContent = item.orderReference;
    $("#refund-available").textContent = `${money(item.availableRefundFen)}（${item.availableRefundFen} 分）`;
    showDialog("#refund-dialog");
  }

  function showReviewDialog(refundId) {
    const form = $("#review-form");
    form.reset();
    form.elements.refundId.value = refundId;
    showDialog("#review-dialog");
  }

  async function submitForm(form, operation) {
    const submit = form.querySelector("button[value='submit']");
    const errorTarget = form.querySelector("[data-form-error]");
    submit.disabled = true;
    errorTarget.hidden = true;
    try {
      await operation(Object.fromEntries(new FormData(form)));
      form.closest("dialog").close();
      setBanner("操作已由服务端受理", "页面正在重新读取权威支付与退款状态。", "normal");
      await load();
    } catch (error) {
      errorTarget.textContent = error.message || "操作未完成";
      errorTarget.hidden = false;
      setBanner("操作未完成", "服务端没有返回成功回执，页面未修改本地业务状态。", "danger");
    } finally {
      submit.disabled = false;
    }
  }

  $("#payment-refresh").addEventListener("click", load);
  $("#payment-create-open").addEventListener("click", () => {
    const form = $("#payment-form");
    form.reset();
    form.elements.currency.value = "CNY";
    form.elements.institutionCode.value = user.orgCode || "";
    showDialog("#payment-dialog");
  });
  $("#reconciliation-open").addEventListener("click", () => {
    const form = $("#reconciliation-form");
    form.reset();
    form.elements.businessDate.value = new Date().toISOString().slice(0, 10);
    if (state.center.scope.role === "insurance") form.elements.gatewayType.value = "INSURANCE";
    showDialog("#reconciliation-dialog");
  });
  $("#payment-search").addEventListener("input", (event) => { state.keyword = event.target.value.trim().toLowerCase(); renderQueue(); });
  $("#payment-gateway-filter").addEventListener("change", (event) => { state.gateway = event.target.value; renderQueue(); });
  $("#payment-status-filter").addEventListener("change", (event) => { state.status = event.target.value; renderQueue(); });
  $("#payment-queue").addEventListener("click", (event) => {
    const button = event.target.closest("[data-refund-open]");
    if (button) showRefundDialog(button.dataset.refundOpen);
  });
  $("#refund-list").addEventListener("click", (event) => {
    const button = event.target.closest("[data-review-open]");
    if (button) showReviewDialog(button.dataset.reviewOpen);
  });
  document.querySelectorAll("[data-close-dialog]").forEach((button) => button.addEventListener("click", () => button.closest("dialog").close()));

  $("#payment-form").addEventListener("submit", (event) => {
    event.preventDefault();
    submitForm(event.currentTarget, (values) => requestJson("/api/financial-gateways/dispatch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "PAYMENT",
        operation: "create-payment",
        idempotencyKey: idempotencyKey("medical-payment"),
        payload: { externalId: values.orderNo, orderNo: values.orderNo, amountFen: Number(values.amountFen), currency: values.currency, institutionCode: values.institutionCode }
      })
    }));
  });

  $("#refund-form").addEventListener("submit", (event) => {
    event.preventDefault();
    submitForm(event.currentTarget, (values) => {
      const key = idempotencyKey("medical-refund");
      return requestJson("/api/online-payments/refunds", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": key },
        body: JSON.stringify({ ...values, refundAmountFen: Number(values.refundAmountFen), idempotencyKey: key })
      });
    });
  });

  $("#review-form").addEventListener("submit", (event) => {
    event.preventDefault();
    submitForm(event.currentTarget, (values) => requestJson(`/api/online-payments/refunds/${encodeURIComponent(values.refundId)}/reviews`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey("refund-review") },
      body: JSON.stringify({ approved: values.approved === "true", reviewDomain: values.reviewDomain, opinion: values.opinion })
    }));
  });

  $("#reconciliation-form").addEventListener("submit", (event) => {
    event.preventDefault();
    submitForm(event.currentTarget, (values) => requestJson("/api/financial-gateways/reconciliation-runs", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey("financial-reconciliation") },
      body: JSON.stringify({
        gatewayType: state.center.scope.role === "insurance" ? "INSURANCE" : values.gatewayType,
        businessDate: values.businessDate,
        providerSummary: {
          total: Number(values.total),
          succeeded: Number(values.succeeded),
          exceptions: Number(values.exceptions),
          grossAmountFen: Number(values.grossAmountFen),
          statementDigest: values.statementDigest.toLowerCase()
        }
      })
    }));
  });

  load();
})();
