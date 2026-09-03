(function healthSupervisionPage(root) {
  "use strict";

  const API_BASE = "/public-health/supervision";
  let board = null;
  let client = null;

  function element(tag, { className = "", text = "", dataset = {} } = {}) {
    const node = root.document.createElement(tag);
    if (className) node.className = className;
    node.textContent = String(text ?? "");
    Object.entries(dataset).forEach(([key, value]) => { node.dataset[key] = String(value); });
    return node;
  }

  function replace(target, nodes) {
    target.replaceChildren(...nodes);
  }

  function metric(label, value, detail) {
    const card = element("article", { className: "metric-card" });
    card.append(element("strong", { text: value }), element("span", { text: label }), element("small", { text: detail }));
    return card;
  }

  function empty(text) {
    return element("p", { className: "supervision-empty", text });
  }

  function actionButton(label, resourceType, resourceId, action, version) {
    const button = element("button", {
      className: "supervision-action",
      text: label,
      dataset: { resourceType, resourceId, action, version }
    });
    button.type = "button";
    return button;
  }

  function row(title, badge, lines, actions = []) {
    const card = element("article", { className: "supervision-row" });
    const header = element("header");
    header.append(element("strong", { text: title }), element("span", { className: "supervision-badge", text: badge }));
    card.append(header);
    lines.forEach((line) => card.append(element("p", { text: line })));
    if (actions.length) {
      const controls = element("div", { className: "supervision-row-actions" });
      controls.append(...actions);
      card.append(controls);
    }
    return card;
  }

  function currentRole() {
    return String(root.HealthCityAuth?.getUser?.()?.role || "");
  }

  function renderWorkbench(payload) {
    board = payload;
    const summary = payload.summary || {};
    replace(root.document.querySelector("#supervision-metrics"), [
      metric("监督主体", summary.subjects || 0, "身份目录最小引用"),
      metric("检查任务", summary.tasks || 0, `${summary.openTasks || 0} 项开放`),
      metric("检查记录", summary.inspectionRecords || 0, "写入后不可修改"),
      metric("监督问题", summary.findings || 0, `${summary.pendingRemediation || 0} 项待闭环`)
    ]);
    root.document.querySelector("#supervision-boundary").textContent = payload.productionReady === false
      ? "检查工作台支持任务—检查—问题—整改复核，案件进入独立协同工作台；GIS、视频、附件上传和外部交换仍保持 NO-GO。"
      : "生产边界状态异常，禁止继续操作。";

    const role = currentRole();
    const taskRows = (payload.tasks || []).map((task) => {
      const actions = [];
      if (role === "commission" && task.status === "assigned") actions.push(actionButton("接单", "task", task.id, "accept", task.version));
      if (role === "commission" && task.status === "accepted") actions.push(actionButton("开始", "task", task.id, "start", task.version));
      return row(`任务 ${task.id}`, task.status, [
        `主体：医疗机构（${task.subjectId}）`,
        `类型：${task.taskType} · 优先级：${task.priority} · 版本：${task.version}`,
        `截止：${task.dueAt}`
      ], actions);
    });
    replace(root.document.querySelector("#supervision-tasks"), taskRows.length ? taskRows : [empty("暂无检查任务")]);

    const subjectRows = (payload.subjects || []).map((subject) => row(
      `医疗机构（${subject.organizationCode}）`,
      subject.riskLevel,
      [`主体编号：${subject.id}`, `辖区代码：${subject.jurisdictionCode}`, `版本：${subject.version}`]
    ));
    replace(root.document.querySelector("#supervision-subjects"), subjectRows.length ? subjectRows : [empty("暂无监督主体")]);

    const findingRows = (payload.findings || []).map((finding) => {
      const actions = [];
      if (role === "institution" && ["open", "reopened"].includes(finding.status)) {
        actions.push(actionButton("填写整改", "finding", finding.id, "submit-remediation", finding.version));
      }
      if (role === "commission" && finding.status === "remediation-submitted") {
        actions.push(actionButton("复核整改", "finding", finding.id, "review-remediation", finding.version));
      }
      return row(`问题 ${finding.id}`, finding.status, [
        `检查项：${finding.itemCode} · 严重度：${finding.severity}`,
        finding.summary,
        `整改轮次：${(finding.remediationRounds || []).length} · 版本：${finding.version}`
      ], actions);
    });
    replace(root.document.querySelector("#supervision-findings"), findingRows.length ? findingRows : [empty("暂无监督问题")]);

    const recordRows = (payload.inspectionRecords || []).map((record) => row(
      `检查记录 ${record.id}`,
      record.result,
      [`任务：${record.taskId}`, `检查时间：${record.inspectedAt}`, `清单项：${(record.checklistResults || []).length} · 问题：${(record.findingIds || []).length}`]
    ));
    replace(root.document.querySelector("#supervision-records"), recordRows.length ? recordRows : [empty("暂无检查记录")]);
  }

  function setStatus(message, isError = false) {
    root.document.querySelector("#supervision-status").textContent = isError ? "操作未完成" : message;
    root.document.querySelector("#supervision-error").textContent = isError ? message : "";
  }

  async function loadWorkbench() {
    try {
      const response = await client.get(`${API_BASE}/workbench`);
      renderWorkbench(response.data);
      setStatus(`工作台已刷新 · ${new Date(response.data.generatedAt).toLocaleString("zh-CN")}`);
    } catch (error) {
      board = null;
      setStatus(`工作台加载失败：${error.message || "请稍后重试"}`, true);
      ["#supervision-tasks", "#supervision-subjects", "#supervision-findings", "#supervision-records"]
        .forEach((selector) => replace(root.document.querySelector(selector), [empty("数据暂不可用") ]));
    }
  }

  function isoFromLocal(value) {
    const timestamp = new Date(value);
    if (!Number.isFinite(timestamp.getTime())) throw new Error("时间格式无效");
    return timestamp.toISOString();
  }

  async function submitSubject(form) {
    const data = new root.FormData(form);
    await client.post(`${API_BASE}/subjects`, {
      organizationCode: String(data.get("organizationCode") || "").trim(),
      riskLevel: String(data.get("riskLevel") || "medium"),
      expectedVersion: 0
    });
  }

  async function submitTask(form) {
    const data = new root.FormData(form);
    await client.post(`${API_BASE}/inspection-tasks`, {
      subjectId: String(data.get("subjectId") || "").trim(),
      taskType: String(data.get("taskType") || "routine"),
      priority: String(data.get("priority") || "normal"),
      dueAt: isoFromLocal(data.get("dueAt")),
      checklistTemplateId: "general-health-supervision-baseline",
      checklistTemplateVersion: 1,
      expectedVersion: 0
    });
  }

  async function submitAction(form) {
    const data = new root.FormData(form);
    const resourceType = String(data.get("resourceType") || "");
    const resourceId = String(data.get("resourceId") || "").trim();
    const action = String(data.get("action") || "");
    const body = { action, expectedVersion: Number(data.get("expectedVersion")) };
    if (action === "cancel") body.reason = String(data.get("note") || "").trim();
    if (["submit-remediation", "review-remediation"].includes(action)) {
      body.note = String(data.get("note") || "").trim();
      body.evidenceRefs = [String(data.get("evidenceRef") || "").trim()];
    }
    if (action === "review-remediation") body.decision = String(data.get("decision") || "approved");
    const path = resourceType === "finding" ? `${API_BASE}/findings/${encodeURIComponent(resourceId)}/actions` : `${API_BASE}/inspection-tasks/${encodeURIComponent(resourceId)}/actions`;
    await client.post(path, body);
  }

  function checklistRow(itemCode, outcome, evidenceRef) {
    return { itemCode, outcome, note: "工作台现场检查", evidenceRefs: [evidenceRef] };
  }

  async function submitInspection(form) {
    const data = new root.FormData(form);
    const evidenceRef = String(data.get("evidenceRef") || "").trim();
    const outcomes = [
      ["subject-qualification-status", String(data.get("subjectQualification"))],
      ["site-condition-status", String(data.get("siteCondition"))],
      ["process-record-status", String(data.get("processRecord"))]
    ];
    const failed = outcomes.filter(([, outcome]) => outcome === "fail");
    const result = String(data.get("result") || "compliant");
    if (result === "compliant" && failed.length) throw new Error("合格检查不能包含不通过项");
    if (result === "noncompliant" && !failed.length) throw new Error("不合格检查至少需要一个不通过项");
    const findings = result === "noncompliant" ? failed.map(([itemCode]) => ({
      itemCode,
      severity: "high",
      summary: String(data.get("findingSummary") || "").trim(),
      remediationDueAt: isoFromLocal(data.get("remediationDueAt")),
      evidenceRefs: [evidenceRef]
    })) : [];
    await client.post(`${API_BASE}/inspection-tasks/${encodeURIComponent(String(data.get("taskId") || "").trim())}/actions`, {
      action: "record-inspection",
      inspectedAt: isoFromLocal(data.get("inspectedAt")),
      result,
      checklistResults: outcomes.map(([itemCode, outcome]) => checklistRow(itemCode, outcome, evidenceRef)),
      findings,
      evidenceRefs: [evidenceRef],
      expectedVersion: Number(data.get("expectedVersion"))
    });
  }

  async function handleSubmit(event) {
    const handlers = {
      "supervision-subject-form": submitSubject,
      "supervision-task-form": submitTask,
      "supervision-action-form": submitAction,
      "supervision-inspection-form": submitInspection
    };
    const handler = handlers[event.target?.id];
    if (!handler) return;
    event.preventDefault();
    try {
      await handler(event.target);
      setStatus("命令已提交并保存");
      await loadWorkbench();
    } catch (error) {
      setStatus(`提交失败：${error.message || "请检查输入"}`, true);
    }
  }

  function handleClick(event) {
    const button = event.target.closest?.("[data-resource-type]");
    if (!button) return;
    const form = root.document.querySelector("#supervision-action-form");
    form.elements.resourceType.value = button.dataset.resourceType;
    form.elements.resourceId.value = button.dataset.resourceId;
    form.elements.action.value = button.dataset.action;
    form.elements.expectedVersion.value = button.dataset.version;
    form.elements.note.focus();
  }

  function start() {
    client = root.HealthPlatformApi.createClient({ baseUrl: "/api" });
    root.document.addEventListener("submit", handleSubmit);
    root.document.addEventListener("click", handleClick);
    loadWorkbench();
  }

  if (typeof module === "object" && module.exports) {
    module.exports = { element, renderWorkbench };
  } else if (root.document?.readyState === "loading") {
    root.document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})(typeof window !== "undefined" ? window : globalThis);
