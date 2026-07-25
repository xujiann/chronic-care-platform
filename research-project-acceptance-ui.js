"use strict";

const researchProjectState = {
  center: null,
  user: window.HealthCityAuth?.getUser?.() || null
};

const authFetch = (...args) => (window.HealthCityAuth?.authFetch || fetch)(...args);
const escapeHtml = (value) => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#039;");
const setHtml = (id, value) => {
  const element = document.getElementById(id);
  if (element) element.innerHTML = value;
};

async function jsonRequest(url, options = {}) {
  const response = await authFetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || `请求失败（${response.status}）`);
  return payload;
}

function statusBadge(status) {
  const labels = {
    planned: "待准备",
    "evidence-recorded": "已登记",
    submitted: "待复核",
    verified: "已复核",
    returned: "已退回",
    "in-progress": "进行中",
    completed: "已完成"
  };
  const className = status === "verified" || status === "completed"
    ? "info"
    : status === "submitted" || status === "returned"
      ? "warn"
      : "";
  return `<span class="badge ${className}">${escapeHtml(labels[status] || status)}</span>`;
}

function renderSummary() {
  const center = researchProjectState.center;
  const summary = center.summary;
  const metrics = [
    ["委托任务", summary.requirements, "申报书六项研究内容"],
    ["六域框架", summary.domains, "指标与标准资产域"],
    ["验收项", summary.acceptanceItems, "成果与量化指标"],
    ["追溯覆盖率", `${summary.traceabilityCoverage}%`, center.applicationAlignmentState],
    ["正式复核", `${summary.verified}/${summary.acceptanceItems}`, `完成率 ${summary.verifiedRate}%`],
    ["验收状态", center.formalAcceptanceState === "ready-for-formal-acceptance-review" ? "可申请验收" : "证据待闭环", center.formalAcceptanceState]
  ];
  setHtml("research-project-metrics", metrics.map(([label, value, hint]) => (
    `<article class="metric-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(hint)}</small></article>`
  )).join(""));
  setHtml("research-project-facts", `<table><tbody>
    <tr><th>项目编码</th><td>${escapeHtml(center.project.id)}</td><th>牵头单位</th><td>${escapeHtml(center.project.leadInstitution)}</td></tr>
    <tr><th>实施周期</th><td>${escapeHtml(center.project.period)}</td><th>申报经费</th><td>${escapeHtml(center.project.budgetWan)}万元</td></tr>
    <tr><th>深度试点</th><td>${escapeHtml(center.project.deepPilotTarget)}家三甲综合医院</td><th>扩展验证</th><td>不少于${escapeHtml(center.project.extensionPilotTarget)}家不同类型机构</td></tr>
  </tbody></table>`);
  document.getElementById("research-project-boundary").textContent = center.boundary;
}

function renderRequirements() {
  const rows = researchProjectState.center.requirements.map((item) => `<tr>
    <td><strong>${escapeHtml(item.id)}</strong><br>${escapeHtml(item.name)}</td>
    <td>${escapeHtml(item.domainNames.join("、"))}</td>
    <td>${item.platformModules.map(escapeHtml).join("<br>")}<br><small>${item.apiRefs.map(escapeHtml).join("<br>")}</small></td>
    <td>${item.linkedItems.map((entry) => `${escapeHtml(entry.name)} ${statusBadge(entry.status)}`).join("<br>")}</td>
    <td>${statusBadge(item.status)}</td>
  </tr>`).join("");
  setHtml("research-project-requirements", `<table><thead><tr><th>委托任务</th><th>六域</th><th>平台能力与接口</th><th>验收成果</th><th>状态</th></tr></thead><tbody>${rows}</tbody></table>`);
}

function renderDeliverables() {
  const rows = researchProjectState.center.deliverables.map((item) => `<tr>
    <td><strong>${escapeHtml(item.name)}</strong><br><small>${escapeHtml(item.id)}</small></td>
    <td>${escapeHtml(item.milestone)}</td>
    <td>${escapeHtml(item.platformEvidenceRef || "待形成正式成果文件")}</td>
    <td>${escapeHtml(item.evidenceRef || "未登记")}<br><small>${escapeHtml(item.sha256 ? `sha256:${item.sha256.slice(0, 16)}...` : "")}</small></td>
    <td>${statusBadge(item.status)}</td>
  </tr>`).join("");
  setHtml("research-project-deliverables", `<table><thead><tr><th>成果</th><th>里程碑</th><th>现有平台依据</th><th>正式证据</th><th>状态</th></tr></thead><tbody>${rows}</tbody></table>`);
}

function renderMetrics() {
  const rows = researchProjectState.center.metrics.map((item) => {
    const actual = item.measuredValue === null ? "待登记" : `${item.measuredValue}${item.unit}`;
    const result = item.meetsTarget === null ? "待评价" : item.meetsTarget ? "达标" : "未达标";
    return `<tr>
      <td><strong>${escapeHtml(item.name)}</strong><br><small>${escapeHtml(item.id)}</small></td>
      <td>${escapeHtml(item.comparator)}${escapeHtml(item.targetValue)}${escapeHtml(item.unit)}</td>
      <td>${escapeHtml(actual)}</td>
      <td>${escapeHtml(result)}</td>
      <td>${statusBadge(item.status)}</td>
    </tr>`;
  }).join("");
  setHtml("research-project-acceptance-metrics", `<table><thead><tr><th>指标</th><th>验收目标</th><th>实测值</th><th>目标判定</th><th>证据状态</th></tr></thead><tbody>${rows}</tbody></table>`);
}

function renderMilestones() {
  const rows = researchProjectState.center.milestones.map((item) => `<tr>
    <td><strong>${escapeHtml(item.name)}</strong></td>
    <td>${escapeHtml(item.window)}</td>
    <td>${escapeHtml(item.verified)}/${escapeHtml(item.total)}</td>
    <td>${statusBadge(item.status)}</td>
  </tr>`).join("");
  setHtml("research-project-milestones", `<table><thead><tr><th>阶段</th><th>计划窗口</th><th>已复核/应完成</th><th>状态</th></tr></thead><tbody>${rows}</tbody></table>`);
}

function selectedItem() {
  const id = document.getElementById("research-project-item-id")?.value;
  return researchProjectState.center?.items.find((item) => item.id === id) || researchProjectState.center?.items[0] || null;
}

function availableActions(item) {
  if (!item) return [];
  const commission = researchProjectState.user?.role === "commission";
  if (item.status === "planned" || item.status === "returned") return ["record-evidence"];
  if (item.status === "evidence-recorded") return ["record-evidence", "submit-review"];
  if (item.status === "submitted") return commission ? ["verify-evidence", "return-evidence"] : [];
  if (item.status === "verified") return commission ? ["revoke-verification"] : [];
  return [];
}

function renderActionForm() {
  const itemSelect = document.getElementById("research-project-item-id");
  const selectedId = itemSelect.value;
  itemSelect.innerHTML = researchProjectState.center.items.map((item) => (
    `<option value="${escapeHtml(item.id)}">${escapeHtml(item.type === "metric" ? "指标" : "成果")} / ${escapeHtml(item.name)} / ${escapeHtml(item.status)}</option>`
  )).join("");
  if (selectedId && researchProjectState.center.items.some((item) => item.id === selectedId)) itemSelect.value = selectedId;
  const item = selectedItem();
  const actions = availableActions(item);
  const labels = {
    "record-evidence": "登记或更新证据",
    "submit-review": "提交独立复核",
    "verify-evidence": "独立复核通过",
    "return-evidence": "退回补充",
    "revoke-verification": "撤销复核结论"
  };
  const actionSelect = document.getElementById("research-project-action");
  actionSelect.innerHTML = actions.map((action) => `<option value="${action}">${labels[action]}</option>`).join("");
  actionSelect.disabled = actions.length === 0;
  document.querySelector("#research-project-action-form button[type=submit]").disabled = actions.length === 0;
  const measured = document.getElementById("research-project-measured-value");
  measured.disabled = item?.type !== "metric";
  measured.value = item?.measuredValue ?? "";
  document.getElementById("research-project-action-hint").textContent = actions.length
    ? `${item.name}：当前状态 ${item.status}`
    : `${item.name}：当前角色暂无可执行动作`;
}

function renderAll() {
  renderSummary();
  renderRequirements();
  renderDeliverables();
  renderMetrics();
  renderMilestones();
  renderActionForm();
}

async function refreshCenter() {
  researchProjectState.center = await jsonRequest("/api/research-project/acceptance-center");
  renderAll();
}

window.refreshResearchProjectCenter = refreshCenter;

document.getElementById("research-project-item-id").addEventListener("change", renderActionForm);

document.getElementById("research-project-action-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const feedback = document.getElementById("research-project-feedback");
  try {
    const id = document.getElementById("research-project-item-id").value;
    const action = document.getElementById("research-project-action").value;
    const payload = {
      action,
      evidenceRef: document.getElementById("research-project-evidence-ref").value,
      measuredValue: document.getElementById("research-project-measured-value").value,
      note: document.getElementById("research-project-note").value,
      noPatientPii: document.getElementById("research-project-no-pii").checked
    };
    const result = await jsonRequest(`/api/research-project/acceptance-items/${encodeURIComponent(id)}/actions`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
    researchProjectState.center = result.center;
    renderAll();
    feedback.textContent = `已完成：${result.item.name} / ${result.item.status}`;
  } catch (error) {
    feedback.textContent = error.message;
  }
});

document.getElementById("research-project-export").addEventListener("click", async () => {
  const feedback = document.getElementById("research-project-feedback");
  try {
    const response = await authFetch("/api/research-project/acceptance-center?format=markdown");
    if (!response.ok) throw new Error(`导出失败（${response.status}）`);
    const blob = new Blob([await response.text()], { type: "text/markdown;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "数智医院科研项目验收追溯报告.md";
    link.click();
    URL.revokeObjectURL(link.href);
    feedback.textContent = "追溯报告已生成。";
  } catch (error) {
    feedback.textContent = error.message;
  }
});

refreshCenter().catch((error) => {
  setHtml("research-project-metrics", `<article class="metric-card"><span>加载失败</span><strong>无法读取验收中心</strong><small>${escapeHtml(error.message)}</small></article>`);
});
