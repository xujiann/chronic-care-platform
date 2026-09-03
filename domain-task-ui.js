(function domainTaskUi(root) {
  "use strict";

  function element(tag, options = {}) {
    const node = root.document.createElement(tag);
    if (options.className) node.className = options.className;
    if (options.text !== undefined) node.textContent = String(options.text ?? "");
    Object.entries(options.dataset || {}).forEach(([key, value]) => { node.dataset[key] = String(value); });
    return node;
  }

  function display(value) {
    if (Array.isArray(value)) return value.filter(Boolean).join("、") || "—";
    if (value && typeof value === "object") return Object.entries(value).map(([key, item]) => `${key}：${item}`).join("；") || "—";
    return String(value ?? "").trim() || "—";
  }

  function matches(row, status, keyword) {
    const statusMatched = !status || String(row.status || "") === status;
    const haystack = [row.id, row.title, row.status, row.owner, row.nextAction, ...(row.lines || [])].join(" ").toLowerCase();
    return statusMatched && (!keyword || haystack.includes(String(keyword).trim().toLowerCase()));
  }

  function renderMetrics(target, rows) {
    const pending = rows.filter((row) => !/已完成|已闭环|结案|published|active|approved|returned|closed/i.test(row.status || "")).length;
    const blocked = rows.filter((row) => /阻断|驳回|异常|超时|blocked|rejected|failed/i.test(`${row.status} ${row.nextAction}`)).length;
    const cards = [
      ["任务总数", rows.length, "当前权限范围"],
      ["待处理", pending, "尚未进入终态"],
      ["需关注", blocked, "阻断、驳回或异常"],
      ["已闭环", Math.max(0, rows.length - pending), "已完成或已发布"]
    ].map(([label, value, note]) => {
      const card = element("article", { className: "metric-card" });
      card.append(element("span", { text: label }), element("strong", { text: value }), element("small", { text: note }));
      return card;
    });
    target.replaceChildren(...cards);
  }

  function renderDetail(target, row) {
    if (!row) {
      target.replaceChildren(element("p", { className: "domain-empty", text: "选择一项任务查看业务详情和下一步动作。" }));
      return;
    }
    const detail = element("div", { className: "domain-detail" });
    [["任务编号", row.id], ["当前状态", row.status], ["责任方", row.owner], ["下一步", row.nextAction], ...(row.details || [])].forEach(([label, value]) => {
      const line = element("div");
      line.append(element("strong", { text: label }), element("span", { text: display(value) }));
      detail.append(line);
    });
    target.replaceChildren(detail);
  }

  function start(config) {
    const client = root.HealthPlatformApi.createClient({ baseUrl: "/api" });
    const state = { rows: [], selectedId: "" };
    const nodes = {
      status: root.document.querySelector("#domain-workbench-status"),
      error: root.document.querySelector("#domain-workbench-error"),
      metrics: root.document.querySelector("#domain-workbench-metrics"),
      list: root.document.querySelector("#domain-task-list"),
      detail: root.document.querySelector("#domain-task-detail"),
      statusFilter: root.document.querySelector("#domain-status-filter"),
      keyword: root.document.querySelector("#domain-keyword-filter"),
      refresh: root.document.querySelector("#domain-refresh")
    };

    function setStatus(message, error = false) {
      nodes.status.textContent = error ? "操作未完成" : message;
      nodes.error.textContent = error ? message : "";
    }

    function role() { return String(root.HealthCityAuth?.getUser?.()?.role || ""); }

    function render() {
      const visible = state.rows.filter((row) => matches(row, nodes.statusFilter.value, nodes.keyword.value));
      const cards = visible.map((row) => {
        const card = element("article", { className: `domain-task-row${row.id === state.selectedId ? " is-selected" : ""}`, dataset: { rowId: row.id } });
        const header = element("header");
        header.append(element("strong", { text: row.title }), element("span", { className: "domain-status-badge", text: row.status }));
        card.append(header);
        (row.lines || []).forEach((line) => card.append(element("p", { text: line })));
        card.append(element("p", { text: `下一步：${display(row.nextAction)}` }));
        const controls = element("div", { className: "domain-task-actions" });
        const detailButton = element("button", { className: "secondary", text: "查看详情", dataset: { selectId: row.id } });
        detailButton.type = "button";
        controls.append(detailButton);
        (config.actions || []).filter((action) => !action.visible || action.visible(row, role())).forEach((action) => {
          const button = element("button", { text: action.label, dataset: { actionId: action.id, rowId: row.id } });
          button.type = "button";
          controls.append(button);
        });
        card.append(controls);
        return card;
      });
      nodes.list.replaceChildren(...(cards.length ? cards : [element("p", { className: "domain-empty", text: "当前筛选条件下没有任务。" })]));
      renderDetail(nodes.detail, state.rows.find((row) => row.id === state.selectedId));
    }

    function syncStatusOptions() {
      const current = nodes.statusFilter.value;
      const options = [element("option", { text: "全部状态" })];
      options[0].value = "";
      [...new Set(state.rows.map((row) => row.status).filter(Boolean))].sort().forEach((status) => {
        const option = element("option", { text: status });
        option.value = status;
        options.push(option);
      });
      nodes.statusFilter.replaceChildren(...options);
      nodes.statusFilter.value = current;
    }

    async function load() {
      setStatus("正在加载任务……");
      try {
        const payload = await config.load(client);
        state.rows = config.rows(payload).map(config.normalize);
        if (!state.rows.some((row) => row.id === state.selectedId)) state.selectedId = state.rows[0]?.id || "";
        syncStatusOptions();
        renderMetrics(nodes.metrics, state.rows);
        render();
        setStatus(`已从业务接口刷新 · ${new Date().toLocaleString("zh-CN")}`);
      } catch (error) {
        state.rows = [];
        renderMetrics(nodes.metrics, []);
        render();
        setStatus(`加载失败：${error.message || "业务接口暂不可用"}`, true);
      }
    }

    async function runAction(actionId, rowId) {
      const row = state.rows.find((item) => item.id === rowId);
      const action = (config.actions || []).find((item) => item.id === actionId);
      if (!row || !action) return;
      setStatus(`正在提交“${action.label}”……`);
      try {
        await action.run(client, row, role());
        await load();
        setStatus(`“${action.label}”已由业务接口保存并刷新`);
      } catch (error) {
        setStatus(`提交失败，未在页面伪造成功：${error.message || "请稍后重试"}`, true);
      }
    }

    root.document.addEventListener("click", (event) => {
      const select = event.target.closest?.("[data-select-id]");
      if (select) { state.selectedId = select.dataset.selectId; render(); return; }
      const action = event.target.closest?.("[data-action-id]");
      if (action) runAction(action.dataset.actionId, action.dataset.rowId);
    });
    nodes.statusFilter.addEventListener("change", render);
    nodes.keyword.addEventListener("input", render);
    nodes.refresh.addEventListener("click", load);
    load();
    return { state, load, render };
  }

  const api = Object.freeze({ element, display, matches, start });
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.DomainTaskUI = api;
})(typeof window !== "undefined" ? window : globalThis);
