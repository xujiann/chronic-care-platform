const DIGITAL_SELF_ASSESSMENT_ENDPOINT = "/api/digital-hospital/self-assessments";

const digitalSelfAssessmentState = {
  board: null,
  selectedId: "",
  user: window.HealthCityAuth?.getUser?.() || null
};

const DIGITAL_SELF_ASSESSMENT_STATUS_LABELS = {
  assigned: "待填报",
  draft: "填报中",
  "correction-in-progress": "补正中",
  submitted: "待初审",
  resubmitted: "补正待审",
  "preliminary-review": "省级初审中",
  "expert-review": "专家复核中",
  "expert-reviewed": "专家意见已出具",
  "correction-required": "退回补正",
  accepted: "已接受"
};

const DIGITAL_SELF_ASSESSMENT_ACTION_LABELS = {
  "save-draft": "保存指标草稿",
  "submit-assessment": "提交机构自评",
  "start-preliminary-review": "受理省级初审",
  "escalate-expert-review": "升级专家复核",
  "record-expert-opinion": "登记专家意见",
  "request-correction": "退回补正",
  "accept-assessment": "接受本轮自评"
};

function digitalSelfEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function digitalSelfSetHtml(id, html) {
  const element = document.getElementById(id);
  if (element) element.innerHTML = html;
}

function digitalSelfStatusLabel(status) {
  return DIGITAL_SELF_ASSESSMENT_STATUS_LABELS[status] || status || "待处理";
}

function digitalSelfStatusClass(item) {
  if (item.status === "accepted") return "badge info";
  if (item.summary?.overdue || item.status === "correction-required") return "badge danger";
  if (["submitted", "resubmitted", "preliminary-review", "expert-review", "expert-reviewed"].includes(item.status)) return "badge warn";
  return "badge";
}

function digitalSelfAnswerLabel(answer) {
  return ({ compliant: "符合", partial: "部分符合", "not-compliant": "不符合", "not-applicable": "不适用" })[answer] || "未填报";
}

function digitalSelfAssessments() {
  return digitalSelfAssessmentState.board?.allAssessments || [];
}

function digitalSelfIndicators() {
  return digitalSelfAssessmentState.board?.indicators || [];
}

function digitalSelfSelectedAssessment() {
  return digitalSelfAssessments().find((item) => item.id === digitalSelfAssessmentState.selectedId) || digitalSelfAssessments()[0] || null;
}

function digitalSelfFilteredAssessments() {
  const status = document.getElementById("digital-self-assessment-status-filter")?.value || "";
  const query = String(document.getElementById("digital-self-assessment-search")?.value || "").trim().toLowerCase();
  const overdueOnly = Boolean(document.getElementById("digital-self-assessment-overdue-filter")?.checked);
  const reviewOnly = Boolean(document.getElementById("digital-self-assessment-review-filter")?.checked);
  return digitalSelfAssessments().filter((item) => {
    if (status && item.status !== status) return false;
    if (overdueOnly && !item.summary?.overdue) return false;
    if (reviewOnly && !["submitted", "resubmitted", "preliminary-review", "expert-review", "expert-reviewed"].includes(item.status)) return false;
    if (query && !`${item.institutionName} ${item.cycle} ${item.targetLevel} ${item.assignedTo}`.toLowerCase().includes(query)) return false;
    return true;
  });
}

function renderDigitalSelfAssessmentMetrics() {
  const summary = digitalSelfAssessmentState.board?.summary || {};
  const metrics = [
    ["自评任务", summary.assessments || 0, "当前账号可见范围"],
    ["平均完成率", `${summary.averageCompletion || 0}%`, "十二项结构化指标"],
    ["审核队列", (summary.submitted || 0) + (summary.preliminaryReview || 0) + (summary.expertReview || 0), `${summary.expertReview || 0} 项专家复核 / ${summary.disputedIndicators || 0} 项争议`],
    ["退回补正", summary.correctionRequired || 0, "按指标和期限闭环"],
    ["已接受", summary.accepted || 0, "不替代现场正式评价"],
    ["逾期任务", summary.overdue || 0, "需升级责任人与期限"]
  ];
  digitalSelfSetHtml("digital-self-assessment-metrics", metrics.map(([label, value, hint]) => `
    <article class="metric-card">
      <span>${digitalSelfEscape(label)}</span>
      <strong>${digitalSelfEscape(value)}</strong>
      <small>${digitalSelfEscape(hint)}</small>
    </article>
  `).join(""));
}

function renderDigitalSelfAssessmentQueue() {
  const rows = digitalSelfFilteredAssessments();
  digitalSelfSetHtml("digital-self-assessment-queue", `
    <table>
      <thead><tr><th>机构与周期</th><th>申报目标</th><th>进度</th><th>状态与期限</th><th>操作</th></tr></thead>
      <tbody>${rows.map((item) => `
        <tr>
          <td><strong>${digitalSelfEscape(item.institutionName)}</strong><br /><small>${digitalSelfEscape(item.institutionId)} / ${digitalSelfEscape(item.cycle)}</small></td>
          <td>${digitalSelfEscape(item.targetLevel)}<br /><small>责任：${digitalSelfEscape(item.assignedTo)}</small></td>
          <td><strong>${digitalSelfEscape(item.summary.completionPercent)}%</strong><br /><small>${digitalSelfEscape(item.summary.answeredIndicators)}/${digitalSelfEscape(item.summary.requiredIndicators)} 指标 · ${digitalSelfEscape(item.summary.evidenceRefs)} 项引用</small></td>
          <td><span class="${digitalSelfStatusClass(item)}">${digitalSelfEscape(digitalSelfStatusLabel(item.status))}</span>${item.summary.overdue ? " <span class=\"badge danger\">已逾期</span>" : ""}<br /><small>${digitalSelfEscape(item.reviewWorkflow?.dispute?.expertGroup || item.dueAt || "未设置")}</small></td>
          <td><button class="inline-action" type="button" data-digital-self-assessment-select="${digitalSelfEscape(item.id)}">进入任务</button></td>
        </tr>
      `).join("") || "<tr><td colspan=\"5\">没有符合筛选条件的自评任务。</td></tr>"}</tbody>
    </table>
  `);
  document.querySelectorAll("[data-digital-self-assessment-select]").forEach((button) => {
    button.addEventListener("click", () => {
      digitalSelfAssessmentState.selectedId = button.dataset.digitalSelfAssessmentSelect;
      renderDigitalSelfAssessmentDetail();
      document.getElementById("digital-self-assessment-action")?.focus();
    });
  });
}

function renderDigitalSelfAssessmentTaskOptions() {
  const select = document.getElementById("digital-self-assessment-id");
  if (!select) return;
  select.innerHTML = digitalSelfAssessments().map((item) => `<option value="${digitalSelfEscape(item.id)}">${digitalSelfEscape(item.institutionName)} · ${digitalSelfEscape(item.cycle)}</option>`).join("");
  if (digitalSelfSelectedAssessment()) select.value = digitalSelfSelectedAssessment().id;
}

function digitalSelfAvailableActions(item) {
  if (!item) return [];
  const role = digitalSelfAssessmentState.user?.role;
  if (role === "institution" && ["assigned", "draft", "correction-required", "correction-in-progress"].includes(item.status)) {
    return ["save-draft", "submit-assessment"];
  }
  if (role === "commission" && ["submitted", "resubmitted"].includes(item.status)) {
    return ["start-preliminary-review", "request-correction", "accept-assessment"];
  }
  if (role === "commission" && item.status === "preliminary-review") return ["escalate-expert-review", "request-correction", "accept-assessment"];
  if (role === "commission" && item.status === "expert-review") return ["record-expert-opinion"];
  if (role === "commission" && item.status === "expert-reviewed") return ["accept-assessment"];
  return [];
}

function updateDigitalSelfAssessmentActionFields() {
  const action = document.getElementById("digital-self-assessment-action")?.value || "";
  document.querySelectorAll(".digital-self-assessment-action-field").forEach((element) => {
    const actions = String(element.dataset.selfAssessmentActions || "").split(",");
    element.hidden = !actions.includes(action);
  });
}

function renderDigitalSelfAssessmentActions(item) {
  const select = document.getElementById("digital-self-assessment-action");
  const submit = document.getElementById("digital-self-assessment-submit");
  if (!select || !submit) return;
  const actions = digitalSelfAvailableActions(item);
  select.innerHTML = actions.length
    ? actions.map((action) => `<option value="${action}">${digitalSelfEscape(DIGITAL_SELF_ASSESSMENT_ACTION_LABELS[action])}</option>`).join("")
    : "<option value=\"\">当前状态无可用动作</option>";
  submit.disabled = actions.length === 0;
  updateDigitalSelfAssessmentActionFields();
}

function renderDigitalSelfAssessmentDetail() {
  const item = digitalSelfSelectedAssessment();
  renderDigitalSelfAssessmentTaskOptions();
  renderDigitalSelfAssessmentActions(item);
  const title = document.getElementById("digital-self-assessment-selected-title");
  if (!item) {
    if (title) title.textContent = "当前账号没有可处理的自评任务";
    digitalSelfSetHtml("digital-self-assessment-detail-metrics", "");
    digitalSelfSetHtml("digital-self-assessment-indicators", "");
    return;
  }
  digitalSelfAssessmentState.selectedId = item.id;
  const taskSelect = document.getElementById("digital-self-assessment-id");
  if (taskSelect) taskSelect.value = item.id;
  if (title) title.textContent = `${item.institutionName} · ${item.cycle} · ${digitalSelfStatusLabel(item.status)}`;
  const metrics = [
    ["完成率", `${item.summary.completionPercent}%`, `${item.summary.answeredIndicators}/${item.summary.requiredIndicators} 项`],
    ["加权自评分", item.summary.weightedScore, "平台自动汇总"],
    ["证据引用", item.summary.evidenceRefs, "不保存患者明细"],
    ["补正指标", item.summary.correctionIndicators, item.correction?.dueAt || "无待补正"],
    ["争议指标", item.reviewWorkflow?.dispute?.indicatorIds?.length || 0, item.reviewWorkflow?.dispute?.expertGroup || "未升级专家复核"],
    ["完成期限", item.dueAt || "未设置", item.summary.overdue ? "已逾期" : "按期推进"]
  ];
  digitalSelfSetHtml("digital-self-assessment-detail-metrics", metrics.map(([label, value, hint]) => `
    <article class="metric-card"><span>${digitalSelfEscape(label)}</span><strong>${digitalSelfEscape(value)}</strong><small>${digitalSelfEscape(hint)}</small></article>
  `).join(""));
  const responses = new Map((item.responses || []).map((response) => [response.indicatorId, response]));
  const correctionIds = new Set(item.correction?.indicatorIds || []);
  digitalSelfSetHtml("digital-self-assessment-indicators", `
    <table>
      <thead><tr><th>标准域与指标</th><th>权重</th><th>自评结论</th><th>受控证据</th><th>说明与操作</th></tr></thead>
      <tbody>${digitalSelfIndicators().map((indicator) => {
        const response = responses.get(indicator.id);
        return `
          <tr>
            <td><strong>${digitalSelfEscape(indicator.domain)}：${digitalSelfEscape(indicator.title)}</strong>${correctionIds.has(indicator.id) ? " <span class=\"badge danger\">需补正</span>" : ""}<br /><small>${digitalSelfEscape((indicator.standardRefs || []).join("；"))}</small></td>
            <td>${digitalSelfEscape(indicator.weight)}</td>
            <td><span class="${response?.answer === "compliant" ? "badge info" : response ? "badge warn" : "badge"}">${digitalSelfEscape(digitalSelfAnswerLabel(response?.answer))}</span><br /><small>${response?.score === null || response?.score === undefined ? "不计分" : `${digitalSelfEscape(response.score)} 分`}</small></td>
            <td>${digitalSelfEscape((response?.evidenceRefs || []).join("、") || "尚未登记")}<br /><small>${response?.noPatientPii ? "已确认无患者可识别信息" : "待确认边界"}</small></td>
            <td>${digitalSelfEscape(response?.note || "尚未填报")} ${digitalSelfAssessmentState.user?.role === "institution" && digitalSelfAvailableActions(item).includes("save-draft") ? `<br /><button class="inline-action" type="button" data-digital-self-indicator-select="${digitalSelfEscape(indicator.id)}">填报指标</button>` : ""}</td>
          </tr>
        `;
      }).join("")}</tbody>
    </table>
  `);
  document.querySelectorAll("[data-digital-self-indicator-select]").forEach((button) => {
    button.addEventListener("click", () => {
      const action = document.getElementById("digital-self-assessment-action");
      const indicator = document.getElementById("digital-self-assessment-indicator-id");
      if (action) {
        action.value = "save-draft";
        updateDigitalSelfAssessmentActionFields();
      }
      if (indicator) indicator.value = button.dataset.digitalSelfIndicatorSelect;
      document.getElementById("digital-self-assessment-answer")?.focus();
    });
  });
}

function renderDigitalSelfAssessmentIndicatorOptions() {
  const options = digitalSelfIndicators().map((item) => `<option value="${digitalSelfEscape(item.id)}">${digitalSelfEscape(item.domain)}：${digitalSelfEscape(item.title)}</option>`).join("");
  const indicator = document.getElementById("digital-self-assessment-indicator-id");
  const corrections = document.getElementById("digital-self-assessment-correction-indicators");
  const disputes = document.getElementById("digital-self-assessment-dispute-indicators");
  if (indicator) indicator.innerHTML = options;
  if (corrections) corrections.innerHTML = options;
  if (disputes) disputes.innerHTML = options;
}

function renderDigitalSelfAssessmentBoard() {
  renderDigitalSelfAssessmentMetrics();
  renderDigitalSelfAssessmentQueue();
  renderDigitalSelfAssessmentIndicatorOptions();
  renderDigitalSelfAssessmentDetail();
}

async function digitalSelfAssessmentJson(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || "自评业务请求失败");
  return payload;
}

async function loadDigitalSelfAssessmentBoard() {
  const fetcher = window.HealthCityAuth?.authFetch || fetch;
  const response = await fetcher(DIGITAL_SELF_ASSESSMENT_ENDPOINT);
  const payload = await digitalSelfAssessmentJson(response);
  digitalSelfAssessmentState.board = payload;
  if (!digitalSelfAssessmentState.selectedId || !payload.allAssessments.some((item) => item.id === digitalSelfAssessmentState.selectedId)) {
    digitalSelfAssessmentState.selectedId = payload.allAssessments[0]?.id || "";
  }
  renderDigitalSelfAssessmentBoard();
}

function digitalSelfActionPayload() {
  const action = document.getElementById("digital-self-assessment-action")?.value || "";
  const payload = { action, note: document.getElementById("digital-self-assessment-note")?.value.trim() || "" };
  if (action === "save-draft") {
    payload.indicatorId = document.getElementById("digital-self-assessment-indicator-id")?.value || "";
    payload.answer = document.getElementById("digital-self-assessment-answer")?.value || "";
    payload.evidenceRefs = String(document.getElementById("digital-self-assessment-evidence-refs")?.value || "").split(/\r?\n|,|，/).map((item) => item.trim()).filter(Boolean);
    payload.noPatientPii = Boolean(document.getElementById("digital-self-assessment-no-pii")?.checked);
  }
  if (action === "submit-assessment") {
    payload.noPatientPii = Boolean(document.getElementById("digital-self-assessment-no-pii")?.checked);
    payload.declarationAccepted = Boolean(document.getElementById("digital-self-assessment-declaration")?.checked);
  }
  if (action === "request-correction") {
    payload.indicatorIds = Array.from(document.getElementById("digital-self-assessment-correction-indicators")?.selectedOptions || []).map((item) => item.value);
    payload.dueAt = document.getElementById("digital-self-assessment-correction-due-at")?.value || "";
  }
  if (["start-preliminary-review", "escalate-expert-review", "record-expert-opinion"].includes(action)) {
    payload.dueAt = document.getElementById("digital-self-assessment-review-due-at")?.value || "";
  }
  if (action === "escalate-expert-review") {
    payload.indicatorIds = Array.from(document.getElementById("digital-self-assessment-dispute-indicators")?.selectedOptions || []).map((item) => item.value);
    payload.expertGroup = document.getElementById("digital-self-assessment-expert-group")?.value.trim() || "";
  }
  if (action === "record-expert-opinion") {
    payload.decision = document.getElementById("digital-self-assessment-expert-decision")?.value || "";
    payload.opinionRef = document.getElementById("digital-self-assessment-opinion-ref")?.value.trim() || "";
  }
  return payload;
}

async function recordDigitalSelfAssessmentAction(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const feedback = document.getElementById("digital-self-assessment-feedback");
  const assessmentId = document.getElementById("digital-self-assessment-id")?.value || digitalSelfAssessmentState.selectedId;
  try {
    if (feedback) {
      feedback.className = "badge warn";
      feedback.textContent = "正在提交自评动作";
    }
    const fetcher = window.HealthCityAuth?.authFetch || fetch;
    const response = await fetcher(`${DIGITAL_SELF_ASSESSMENT_ENDPOINT}/${encodeURIComponent(assessmentId)}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(digitalSelfActionPayload())
    });
    const payload = await digitalSelfAssessmentJson(response);
    digitalSelfAssessmentState.board = payload.board;
    digitalSelfAssessmentState.selectedId = payload.assessment.id;
    form.reset();
    renderDigitalSelfAssessmentBoard();
    if (feedback) {
      feedback.className = "badge info";
      feedback.textContent = `${digitalSelfStatusLabel(payload.assessment.status)}，自评动作已写入审计链`;
    }
  } catch (error) {
    if (feedback) {
      feedback.className = "badge danger";
      feedback.textContent = error.message;
    }
  }
}

async function assignDigitalSelfAssessment(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const feedback = document.getElementById("digital-self-assessment-assignment-feedback");
  const payload = {
    action: "assign-assessment",
    institutionId: document.getElementById("digital-self-assessment-assignment-institution-id")?.value.trim() || "",
    institutionName: document.getElementById("digital-self-assessment-assignment-institution-name")?.value.trim() || "",
    cycle: document.getElementById("digital-self-assessment-assignment-cycle")?.value.trim() || "",
    targetLevel: document.getElementById("digital-self-assessment-assignment-target")?.value.trim() || "",
    assignedTo: document.getElementById("digital-self-assessment-assignment-owner")?.value.trim() || "",
    dueAt: document.getElementById("digital-self-assessment-assignment-due-at")?.value || "",
    note: document.getElementById("digital-self-assessment-assignment-note")?.value.trim() || ""
  };
  try {
    if (feedback) {
      feedback.className = "badge warn";
      feedback.textContent = "正在分派自评任务";
    }
    const fetcher = window.HealthCityAuth?.authFetch || fetch;
    const response = await fetcher(`${DIGITAL_SELF_ASSESSMENT_ENDPOINT}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const result = await digitalSelfAssessmentJson(response);
    digitalSelfAssessmentState.board = result.board;
    digitalSelfAssessmentState.selectedId = result.assessment.id;
    form.reset();
    renderDigitalSelfAssessmentBoard();
    if (feedback) {
      feedback.className = "badge info";
      feedback.textContent = "自评任务已分派并写入审计链";
    }
  } catch (error) {
    if (feedback) {
      feedback.className = "badge danger";
      feedback.textContent = error.message;
    }
  }
}

function bindDigitalSelfAssessmentWorkbench() {
  ["digital-self-assessment-status-filter", "digital-self-assessment-search", "digital-self-assessment-overdue-filter", "digital-self-assessment-review-filter"].forEach((id) => {
    document.getElementById(id)?.addEventListener("input", renderDigitalSelfAssessmentQueue);
  });
  document.getElementById("digital-self-assessment-id")?.addEventListener("change", (event) => {
    digitalSelfAssessmentState.selectedId = event.target.value;
    renderDigitalSelfAssessmentDetail();
  });
  document.getElementById("digital-self-assessment-action")?.addEventListener("change", updateDigitalSelfAssessmentActionFields);
  document.getElementById("digital-self-assessment-action-form")?.addEventListener("submit", recordDigitalSelfAssessmentAction);
  document.getElementById("digital-self-assessment-assignment-form")?.addEventListener("submit", assignDigitalSelfAssessment);
}

async function initDigitalSelfAssessmentWorkbench() {
  document.querySelectorAll("[data-commission-only]").forEach((element) => {
    element.hidden = digitalSelfAssessmentState.user?.role !== "commission";
  });
  bindDigitalSelfAssessmentWorkbench();
  try {
    await loadDigitalSelfAssessmentBoard();
  } catch (error) {
    const feedback = document.getElementById("digital-self-assessment-feedback");
    if (feedback) {
      feedback.className = "badge danger";
      feedback.textContent = error.message;
    }
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initDigitalSelfAssessmentWorkbench);
} else {
  initDigitalSelfAssessmentWorkbench();
}
