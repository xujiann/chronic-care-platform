"use strict";

(function initializeUnifiedWorkCenter() {
  const core = window.HealthUnifiedWorkCenterCore;
  if (!core) return;
  const auth = window.HealthCityAuth;
  const apiEnabled = location.protocol !== "file:";
  const client = core.createClient({ base: "/api", fetchImpl: (...args) => (auth?.authFetch || fetch)(...args) });
  const state = { tasks: [], messages: [], source: "loading", selected: new Set(), filters: { keyword: "", status: "all", domain: "all", sla: "all" } };
  const sampleTasks = [
    core.normalizeTask({ id: "referrals:sample-1", collection: "referrals", title: "跨机构转诊接诊确认", role: "institution", domain: "转诊协同", status: "pending", priority: "high", assignee: "待领取", dueAt: new Date(Date.now() + 3_600_000).toISOString() }),
    core.normalizeTask({ id: "drugConsumableSupervisions:sample-2", collection: "drugConsumableSupervisions", title: "药耗异常复核", role: "commission", domain: "药耗治理", status: "processing", assignee: "药耗监管岗位", dueAt: new Date(Date.now() - 3_600_000).toISOString() }),
    core.normalizeTask({ id: "insuranceClaims:sample-3", collection: "insuranceClaims", title: "医保结算疑点审核", role: "insurance", domain: "医保审核", status: "pending", assignee: "待领取", dueAt: new Date(Date.now() + 86_400_000).toISOString() })
  ];
  const sampleMessages = [core.normalizeMessage({ id: "sample-message", taskId: "referrals:sample-1", title: "转诊任务时限提醒", body: "此为只读结构示例，连接业务服务后显示真实授权消息。", status: "sent", createdAt: new Date().toISOString() })];

  const $ = (selector) => document.querySelector(selector);
  const el = (tag, options = {}) => {
    const node = document.createElement(tag);
    if (options.className) node.className = options.className;
    if (options.text !== undefined) node.textContent = options.text;
    if (options.type) node.type = options.type;
    return node;
  };
  function setBanner(title, detail, tone = "warning") {
    $("#work-source-title").textContent = title;
    $("#work-source-detail").textContent = detail;
    $("#work-source-banner").dataset.tone = tone;
  }
  function formatTime(value) {
    if (!value) return "未设置时限";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("zh-CN", { hour12: false });
  }
  function statusClass(task) {
    if (task.overdue) return "danger";
    if (["completed", "closed", "已完成", "已关闭"].includes(task.status)) return "success";
    return ["pending", "returned", "escalated"].includes(task.status) ? "warning" : "";
  }
  function appendMetric(target, label, value, hint) {
    const card = el("article", { className: "work-metric" });
    card.append(el("span", { text: label }), el("strong", { text: String(value) }), el("small", { text: hint }));
    target.append(card);
  }
  function renderMetrics() {
    const summary = core.summarize(state.tasks, state.messages);
    const target = $("#work-metrics");
    target.replaceChildren();
    appendMetric(target, "授权任务", summary.total, "仅汇总当前账号数据范围");
    appendMetric(target, "待处理", summary.pending, "不含已完成与已关闭");
    appendMetric(target, "已经超时", summary.overdue, "按服务端时限或截止时间计算");
    appendMetric(target, "待领取", summary.unassigned, "尚未明确处理责任人");
    appendMetric(target, "未读消息", summary.unread, "站内消息与触达回执");
  }
  function renderFilterOptions() {
    const fill = (selector, values) => {
      const select = $(selector);
      const current = select.value;
      while (select.options.length > 1) select.remove(1);
      [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-CN")).forEach((value) => {
        const option = el("option", { text: value }); option.value = value; select.append(option);
      });
      if ([...select.options].some((option) => option.value === current)) select.value = current;
    };
    fill("#task-status", state.tasks.map((item) => item.status));
    fill("#task-domain", state.tasks.map((item) => item.domain));
  }
  function actionButton(task, action) {
    const definition = core.ACTIONS[action];
    const button = el("button", { className: "inline-action", text: definition.label, type: "button" });
    button.dataset.taskAction = action;
    button.dataset.taskId = task.id;
    button.disabled = state.source !== "api";
    if (button.disabled) button.title = "只读示例不能提交业务操作";
    return button;
  }
  function renderTasks() {
    const tasks = core.filterTasks(state.tasks, state.filters);
    const target = $("#task-list"); target.replaceChildren();
    $("#task-count").textContent = `${tasks.length} 项`;
    if (!tasks.length) {
      const row = el("tr"); const cell = el("td"); cell.colSpan = 5; cell.append(el("div", { className: "empty-state", text: "当前筛选条件下没有任务" })); row.append(cell); target.append(row); return;
    }
    tasks.forEach((task) => {
      const row = el("tr"); row.dataset.overdue = String(task.overdue);
      const selectCell = el("td"); const checkbox = el("input", { type: "checkbox" }); checkbox.dataset.selectTask = task.id; checkbox.checked = state.selected.has(task.id); checkbox.setAttribute("aria-label", `选择任务 ${task.title}`); selectCell.append(checkbox);
      const taskCell = el("td"); taskCell.append(el("span", { className: "task-title", text: task.title }), el("small", { text: `${task.id} · ${task.domain}` }));
      const statusCell = el("td"); statusCell.append(el("span", { className: `status-pill ${statusClass(task)}`, text: task.status }), el("small", { text: `${task.overdue ? "已超时" : "截止"}：${formatTime(task.dueAt)}` }));
      const ownerCell = el("td"); ownerCell.append(el("span", { text: task.assignee }), el("small", { text: `目标岗位：${task.role}` }));
      const actionsCell = el("td"); const actions = el("div", { className: "task-actions" });
      ["claim", "transfer", "remind", "return", "escalate", "complete"].forEach((action) => actions.append(actionButton(task, action)));
      const link = el("a", { className: "inline-action", text: "业务详情" });
      try {
        window.HealthBrowserSafeUrl.setElementUrl(link, "href", task.deepLink, { capability: "internal-navigation" });
        link.dataset.taskDeepLink = task.id;
        actions.append(link);
      } catch {
        link.remove();
      }
      actionsCell.append(actions);
      row.append(selectCell, taskCell, statusCell, ownerCell, actionsCell); target.append(row);
    });
  }
  function renderMessages() {
    const target = $("#message-list"); target.replaceChildren();
    $("#message-count").textContent = `${state.messages.length} 条`;
    if (!state.messages.length) { target.append(el("div", { className: "empty-state", text: "暂无授权范围内的消息" })); return; }
    state.messages.slice(0, 30).forEach((message) => {
      const unread = !["read", "已读"].includes(message.status);
      const card = el("article", { className: "message-card" }); card.dataset.unread = String(unread);
      card.append(el("strong", { text: message.title }), el("p", { text: message.body || "无消息正文" }), el("small", { text: `${formatTime(message.createdAt)} · ${message.channel}` }));
      if (unread) {
        const button = el("button", { className: "inline-action", text: "标记已读", type: "button" }); button.dataset.messageReceipt = message.id; button.disabled = state.source !== "api"; card.append(button);
      }
      target.append(card);
    });
  }
  function renderSelection() {
    $("#selection-count").textContent = `已选 ${state.selected.size} 项`;
    $("#batch-run").disabled = !state.selected.size || state.source !== "api";
  }
  function render() { renderMetrics(); renderFilterOptions(); renderTasks(); renderMessages(); renderSelection(); }

  async function load() {
    $("#work-refresh").disabled = true;
    setBanner("正在读取授权任务", "正在汇总任务、消息和时限状态。", "warning");
    try {
      if (!apiEnabled) throw new Error("静态预览未连接业务服务");
      const data = await client.load();
      state.tasks = data.tasks; state.messages = data.messages; state.source = "api"; state.selected.clear();
      setBanner("实时业务数据已连接", `最近刷新：${new Date().toLocaleString("zh-CN", { hour12: false })}。写操作由服务端校验权限并记录审计。`, "normal");
    } catch (error) {
      state.tasks = sampleTasks; state.messages = sampleMessages; state.source = "fallback"; state.selected.clear();
      setBanner("当前显示只读结构示例", `${error.message || "业务服务不可用"}。所有写操作已禁用，不会将示例状态当作处理结果。`, "danger");
    } finally { $("#work-refresh").disabled = false; render(); }
  }

  function showActionDialog(taskId, action, batch = false) {
    const dialog = $("#task-action-dialog"); const form = $("#task-action-form"); form.reset();
    form.elements.taskId.value = taskId; form.elements.action.value = action;
    $("#task-action-title").textContent = `${batch ? "批量" : ""}${core.ACTIONS[action].label}`;
    $("#task-action-subject").textContent = batch ? `已选择 ${state.selected.size} 项任务` : state.tasks.find((item) => item.id === taskId)?.title || taskId;
    $("#assignee-field").hidden = action !== "transfer"; $("#channel-field").hidden = action !== "remind";
    $("#task-action-errors").hidden = true; dialog.showModal();
  }
  async function execute(taskIds, action, values) {
    const submit = $("#task-action-submit"); submit.disabled = true;
    try {
      const taskVersions = Object.fromEntries(state.tasks.map((task) => [task.id, Number(task.workCenterVersion || 0)]));
      const result = await core.runBatch(taskIds, action, { ...values, taskVersions }, client);
      if (result.failed) throw new Error(`${result.succeeded} 项成功，${result.failed} 项失败：${result.results.filter((item) => !item.ok).map((item) => `${item.taskId} ${item.error}`).join("；")}`);
      $("#task-action-dialog").close();
      setBanner("任务操作已由服务端受理", `${result.succeeded} 项操作成功，正在刷新任务状态。`, "normal");
      await load();
    } catch (error) {
      const target = $("#task-action-errors"); target.textContent = error.message || "任务操作失败"; target.hidden = false;
      setBanner("任务操作未完成", "服务端未返回完整成功回执，页面没有修改本地任务状态。", "danger");
    } finally { submit.disabled = false; }
  }

  $("#work-refresh").addEventListener("click", load);
  ["#task-keyword", "#task-status", "#task-domain", "#task-sla"].forEach((selector) => $(selector).addEventListener(selector === "#task-keyword" ? "input" : "change", () => {
    state.filters = { keyword: $("#task-keyword").value, status: $("#task-status").value, domain: $("#task-domain").value, sla: $("#task-sla").value }; renderTasks();
  }));
  $("#task-list").addEventListener("change", (event) => { const id = event.target.dataset.selectTask; if (!id) return; event.target.checked ? state.selected.add(id) : state.selected.delete(id); renderSelection(); });
  $("#task-list").addEventListener("click", (event) => { const button = event.target.closest("[data-task-action]"); if (button) showActionDialog(button.dataset.taskId, button.dataset.taskAction); });
  $("#select-all-tasks").addEventListener("change", (event) => { core.filterTasks(state.tasks, state.filters).forEach((task) => event.target.checked ? state.selected.add(task.id) : state.selected.delete(task.id)); renderTasks(); renderSelection(); });
  $("#batch-run").addEventListener("click", () => showActionDialog("__batch__", $("#batch-action").value, true));
  $("#task-action-form").addEventListener("submit", (event) => { event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget)); const ids = values.taskId === "__batch__" ? [...state.selected] : [values.taskId]; execute(ids, values.action, values); });
  $("#message-list").addEventListener("click", async (event) => { const button = event.target.closest("[data-message-receipt]"); if (!button || state.source !== "api") return; button.disabled = true; try { const message = state.messages.find((item) => item.id === button.dataset.messageReceipt); await client.receipt(button.dataset.messageReceipt, Number(message?.workCenterVersion || 0)); await load(); } catch (error) { setBanner("消息回执失败", error.message || "服务端未受理消息回执。", "danger"); button.disabled = false; } });
  document.querySelectorAll("[data-close-dialog]").forEach((button) => button.addEventListener("click", () => button.closest("dialog").close()));
  load();
})();
