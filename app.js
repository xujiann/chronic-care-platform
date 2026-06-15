const STORAGE_KEY = "chronic-care-platform-state";
const API_BASE = location.protocol === "file:" ? "" : "/api";
let apiEnabled = false;

const organizations = ["青泥洼桥社区卫生服务中心", "星海湾社区卫生服务中心", "甘井子区人民医院", "金普新区疾控中心"];

const seedState = {
  residents: [
    {
      id: "r1",
      name: "王建国",
      idCard: "210204196802113219",
      gender: "男",
      birthDate: "1968-02-11",
      phone: "13800010001",
      organization: "青泥洼桥社区卫生服务中心",
      familyDoctor: "刘医生",
      address: "中山区人民路 18 号",
      metrics: { systolic: 166, diastolic: 96, glucose: 6.8, bmi: 29.4 }
    },
    {
      id: "r2",
      name: "李秀兰",
      idCard: "210203197505203427",
      gender: "女",
      birthDate: "1975-05-20",
      phone: "13800010002",
      organization: "星海湾社区卫生服务中心",
      familyDoctor: "赵医生",
      address: "沙河口区西南路 60 号",
      metrics: { systolic: 138, diastolic: 84, glucose: 7.8, bmi: 25.1 }
    },
    {
      id: "r3",
      name: "陈海涛",
      idCard: "210211198811093014",
      gender: "男",
      birthDate: "1988-11-09",
      phone: "13800010003",
      organization: "甘井子区人民医院",
      familyDoctor: "孙医生",
      address: "甘井子区山东路 88 号",
      metrics: { systolic: 126, diastolic: 78, glucose: 5.5, bmi: 24.2 }
    },
    {
      id: "r4",
      name: "赵敏",
      idCard: "210213196410013521",
      gender: "女",
      birthDate: "1964-10-01",
      phone: "13800010004",
      organization: "青泥洼桥社区卫生服务中心",
      familyDoctor: "刘医生",
      address: "中山区解放街 7 号",
      metrics: { systolic: 148, diastolic: 88, glucose: 6.3, bmi: 28.6 }
    }
  ],
  diseases: [
    { id: "d1", residentId: "r1", type: "高血压", diagnosedAt: "2024-10-12", source: "社区筛查", status: "管理中", note: "需加强用药依从性" },
    { id: "d2", residentId: "r2", type: "糖尿病", diagnosedAt: "2024-11-03", source: "医院门诊", status: "需转诊", note: "血糖控制不佳" },
    { id: "d3", residentId: "r4", type: "高血压", diagnosedAt: "2025-01-18", source: "家庭医生随访", status: "稳定管理", note: "按季度复查" }
  ],
  followups: [
    { id: "f1", residentId: "r1", diseaseType: "高血压", plannedAt: todayOffset(-2), assignee: "刘医生", status: "已逾期", result: "未记录", advice: "补充电话随访" },
    { id: "f2", residentId: "r2", diseaseType: "糖尿病", plannedAt: todayOffset(0), assignee: "赵医生", status: "待随访", result: "未记录", advice: "复测空腹血糖" },
    { id: "f3", residentId: "r4", diseaseType: "高血压", plannedAt: todayOffset(5), assignee: "刘医生", status: "待随访", result: "未记录", advice: "记录家庭血压" },
    { id: "f4", residentId: "r3", diseaseType: "健康管理", plannedAt: todayOffset(-5), assignee: "孙医生", status: "已完成", result: "控制良好", advice: "保持运动" }
  ]
};

let state = structuredClone(seedState);

const titles = {
  dashboard: ["工作台", "筛查、登记、评估、随访、评价的一体化闭环。"],
  residents: ["居民档案", "管理居民基础信息、家庭医生和关键健康指标。"],
  diseases: ["慢病登记", "登记重点病种并基于指标生成风险分层。"],
  followups: ["随访管理", "跟踪计划、逾期提醒、干预建议和随访结果。"],
  analytics: ["统计分析", "按病种、机构、风险等级观察管理成效。"]
};

document.addEventListener("DOMContentLoaded", async () => {
  state = await loadState();
  bindNavigation();
  bindDialogs();
  bindForms();
  populateSelects();
  renderDataSource();
  render();
});

function todayOffset(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

async function loadState() {
  if (API_BASE) {
    try {
      const response = await fetch(`${API_BASE}/state`);
      if (response.ok) {
        apiEnabled = true;
        showToast("已连接本地服务，数据保存到 data/db.json");
        return await response.json();
      }
    } catch (error) {
      apiEnabled = false;
    }
  }
  const saved = localStorage.getItem(STORAGE_KEY);
  showToast("未连接本地服务，已切换为浏览器本地模式");
  return saved ? JSON.parse(saved) : structuredClone(seedState);
}

async function saveState() {
  if (apiEnabled) {
    try {
      const response = await fetch(`${API_BASE}/state`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(state)
      });
      if (response.ok) return;
    } catch (error) {
      apiEnabled = false;
    }
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function bindNavigation() {
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.addEventListener("click", () => showView(button.dataset.view));
  });
  document.querySelector("#seed-data").addEventListener("click", async () => {
    if (apiEnabled) {
      const response = await fetch(`${API_BASE}/reset`, { method: "POST" });
      state = await response.json();
    } else {
      state = structuredClone(seedState);
    }
    await saveState();
    populateSelects();
    renderDataSource();
    render();
    showToast("演示数据已重置");
  });
  document.querySelector("#quick-add").addEventListener("click", () => openResidentDialog());
  document.querySelector("#export-data").addEventListener("click", exportCsv);
  document.querySelector("#resident-search").addEventListener("input", renderResidents);
  document.querySelector("#resident-org-filter").addEventListener("change", renderResidents);
}

function bindDialogs() {
  document.querySelectorAll("[data-close]").forEach((button) => {
    button.addEventListener("click", () => button.closest("dialog").close());
  });
  document.querySelector("#add-disease").addEventListener("click", () => document.querySelector("#disease-dialog").showModal());
  document.querySelector("#add-followup").addEventListener("click", () => openFollowupDialog());
}

function bindForms() {
  document.querySelector("#resident-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    const resident = {
      id: data.id || crypto.randomUUID(),
      name: data.name,
      idCard: data.idCard,
      gender: data.gender,
      birthDate: data.birthDate,
      phone: data.phone,
      organization: data.organization,
      familyDoctor: data.familyDoctor,
      address: data.address,
      metrics: {
        systolic: Number(data.systolic),
        diastolic: Number(data.diastolic),
        glucose: Number(data.glucose),
        bmi: Number(data.bmi)
      }
    };
    upsert(state.residents, resident);
    saveState();
    event.currentTarget.closest("dialog").close();
    populateSelects();
    render();
    showToast("居民档案已保存");
  });

  document.querySelector("#disease-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const disease = { id: crypto.randomUUID(), ...Object.fromEntries(new FormData(event.currentTarget)) };
    state.diseases.push(disease);
    saveState();
    event.currentTarget.reset();
    event.currentTarget.closest("dialog").close();
    render();
    showToast("慢病登记已保存");
  });

  document.querySelector("#followup-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const followup = Object.fromEntries(new FormData(event.currentTarget));
    followup.id = followup.id || crypto.randomUUID();
    upsert(state.followups, followup);
    saveState();
    event.currentTarget.closest("dialog").close();
    render();
    showToast("随访记录已保存");
  });
}

function populateSelects() {
  const residentOptions = state.residents.map((item) => `<option value="${item.id}">${item.name}</option>`).join("");
  document.querySelectorAll('select[name="residentId"]').forEach((select) => {
    select.innerHTML = residentOptions;
  });
  document.querySelector('select[name="organization"]').innerHTML = organizations.map((org) => `<option>${org}</option>`).join("");
  document.querySelector("#resident-org-filter").innerHTML = `<option value="">全部机构</option>${organizations.map((org) => `<option>${org}</option>`).join("")}`;
}

function showView(view) {
  document.querySelectorAll(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === view));
  document.querySelectorAll(".view").forEach((item) => item.classList.toggle("active", item.id === view));
  document.querySelector("#view-title").textContent = titles[view][0];
  document.querySelector("#view-subtitle").textContent = titles[view][1];
  render();
}

function render() {
  refreshFollowupStatus();
  renderDataSource();
  renderDashboard();
  renderResidents();
  renderDiseases();
  renderFollowups();
  renderAnalytics();
}

function refreshFollowupStatus() {
  const today = todayOffset(0);
  state.followups.forEach((item) => {
    if (item.status !== "已完成" && item.plannedAt < today) {
      item.status = "已逾期";
    }
  });
  saveState();
}

function renderDashboard() {
  const stats = getStats();
  const cards = [
    ["建档人数", stats.residents, "居民健康档案"],
    ["慢病人数", stats.chronicResidents, "已登记重点慢病"],
    ["高危人数", stats.highRisk, "需重点干预"],
    ["待随访", stats.pending, "含今日计划"],
    ["逾期随访", stats.overdue, "需尽快处理"],
    ["控制率", `${stats.controlRate}%`, "已完成随访中控制良好"]
  ];
  document.querySelector("#metric-cards").innerHTML = cards
    .map(([label, value, hint]) => `<article class="metric-card"><span>${label}</span><strong>${value}</strong><em>${hint}</em></article>`)
    .join("");

  const todos = state.followups
    .filter((item) => item.status !== "已完成")
    .sort((a, b) => a.plannedAt.localeCompare(b.plannedAt));
  document.querySelector("#todo-count").textContent = `${todos.length} 项`;
  document.querySelector("#todo-list").innerHTML = todos
    .map((item) => {
      const resident = findResident(item.residentId);
      return `<div class="list-item"><div><strong>${resident?.name || "未知居民"} · ${item.diseaseType}</strong><br><small>${item.plannedAt} · ${item.assignee} · ${item.advice || "暂无建议"}</small></div><span class="badge status-${item.status}">${item.status}</span></div>`;
    })
    .join("") || `<div class="subtle">暂无待办随访。</div>`;

  renderBars("#risk-bars", countBy(state.residents.map((item) => assessRisk(item).level)), ["低危", "中危", "高危"]);
}

function renderResidents() {
  const keyword = document.querySelector("#resident-search")?.value?.trim() || "";
  const org = document.querySelector("#resident-org-filter")?.value || "";
  const rows = state.residents.filter((item) => {
    const matchesKeyword = [item.name, item.idCard, item.phone].some((value) => value.includes(keyword));
    const matchesOrg = !org || item.organization === org;
    return matchesKeyword && matchesOrg;
  });
  document.querySelector("#resident-table").innerHTML = rows
    .map((item) => {
      const risk = assessRisk(item);
      return `<tr>
        <td><strong>${item.name}</strong><br><span class="subtle">${item.phone}</span></td>
        <td>${item.gender}</td>
        <td>${ageOf(item.birthDate)}</td>
        <td>${item.organization}</td>
        <td>${item.familyDoctor}</td>
        <td><span class="badge risk-${risk.level}">${risk.level}</span></td>
        <td>
          <button class="action-link" data-view-resident="${item.id}">详情</button>
          <button class="action-link" data-edit-resident="${item.id}">编辑</button>
        </td>
      </tr>`;
    })
    .join("");
  document.querySelectorAll("[data-view-resident]").forEach((button) => {
    button.addEventListener("click", () => openResidentDetail(button.dataset.viewResident));
  });
  document.querySelectorAll("[data-edit-resident]").forEach((button) => {
    button.addEventListener("click", () => openResidentDialog(button.dataset.editResident));
  });
}

function renderDiseases() {
  document.querySelector("#disease-list").innerHTML = state.diseases
    .map((item) => {
      const resident = findResident(item.residentId);
      const risk = resident ? assessRisk(resident) : { level: "低危", reason: "" };
      return `<div class="list-item">
        <div>
          <strong>${resident?.name || "未知居民"} · ${item.type}</strong>
          <br><small>${item.diagnosedAt} · ${item.source} · ${item.note || "无备注"}</small>
          <br><small>评估依据：${risk.reason}</small>
        </div>
        <div><span class="badge risk-${risk.level}">${risk.level}</span> <span class="badge status-${item.status}">${item.status}</span></div>
      </div>`;
    })
    .join("") || `<div class="subtle">暂无慢病登记。</div>`;
}

function renderFollowups() {
  document.querySelector("#followup-table").innerHTML = state.followups
    .sort((a, b) => a.plannedAt.localeCompare(b.plannedAt))
    .map((item) => {
      const resident = findResident(item.residentId);
      return `<tr>
        <td>${resident?.name || "未知居民"}</td>
        <td>${item.diseaseType}</td>
        <td>${item.plannedAt}</td>
        <td>${item.assignee}</td>
        <td><span class="badge status-${item.status}">${item.status}</span></td>
        <td>${item.result}</td>
        <td>
          <button class="action-link" data-edit-followup="${item.id}">记录</button>
          ${item.status === "已完成" ? "" : `<button class="action-link" data-complete-followup="${item.id}">完成</button>`}
        </td>
      </tr>`;
    })
    .join("");
  document.querySelectorAll("[data-edit-followup]").forEach((button) => {
    button.addEventListener("click", () => openFollowupDialog(button.dataset.editFollowup));
  });
  document.querySelectorAll("[data-complete-followup]").forEach((button) => {
    button.addEventListener("click", () => completeFollowup(button.dataset.completeFollowup));
  });
}

function renderAnalytics() {
  renderBars("#disease-bars", countBy(state.diseases.map((item) => item.type)), ["高血压", "糖尿病", "冠心病", "脑卒中"]);
  renderBars("#org-bars", countBy(state.residents.map((item) => item.organization)), organizations);
}

function renderBars(selector, counts, order) {
  const max = Math.max(1, ...Object.values(counts));
  document.querySelector(selector).innerHTML = order
    .filter((label) => counts[label] !== undefined || selector !== "#org-bars")
    .map((label) => {
      const value = counts[label] || 0;
      return `<div class="bar-row"><span>${label}</span><div class="bar-track"><div class="bar-fill" style="width:${(value / max) * 100}%"></div></div><strong>${value}</strong></div>`;
    })
    .join("");
}

function openResidentDialog(id) {
  const dialog = document.querySelector("#resident-dialog");
  const form = document.querySelector("#resident-form");
  form.reset();
  const resident = id ? findResident(id) : null;
  if (resident) {
    Object.entries({ ...resident, ...resident.metrics }).forEach(([key, value]) => {
      if (form.elements[key]) form.elements[key].value = value;
    });
  }
  dialog.showModal();
}

function openResidentDetail(id) {
  const resident = findResident(id);
  if (!resident) return;
  const risk = assessRisk(resident);
  const diseases = state.diseases.filter((item) => item.residentId === id);
  const followups = state.followups.filter((item) => item.residentId === id).sort((a, b) => a.plannedAt.localeCompare(b.plannedAt));
  document.querySelector("#detail-name").textContent = resident.name;
  document.querySelector("#detail-meta").textContent = `${resident.gender} · ${ageOf(resident.birthDate)} 岁 · ${resident.organization} · ${resident.familyDoctor}`;
  document.querySelector("#detail-content").innerHTML = `
    <div class="detail-grid">
      <article>
        <span>联系电话</span>
        <strong>${resident.phone}</strong>
      </article>
      <article>
        <span>身份证号</span>
        <strong>${resident.idCard}</strong>
      </article>
      <article>
        <span>风险等级</span>
        <strong><span class="badge risk-${risk.level}">${risk.level}</span></strong>
      </article>
      <article>
        <span>住址</span>
        <strong>${resident.address}</strong>
      </article>
    </div>
    <section class="detail-section">
      <h3>最近健康指标</h3>
      <div class="vitals">
        <div><span>收缩压</span><strong>${resident.metrics.systolic}</strong><small>mmHg</small></div>
        <div><span>舒张压</span><strong>${resident.metrics.diastolic}</strong><small>mmHg</small></div>
        <div><span>空腹血糖</span><strong>${resident.metrics.glucose}</strong><small>mmol/L</small></div>
        <div><span>BMI</span><strong>${resident.metrics.bmi}</strong><small>kg/m²</small></div>
      </div>
      <p class="subtle">评估依据：${risk.reason}</p>
    </section>
    <section class="detail-section">
      <h3>慢病登记</h3>
      ${diseases.map((item) => `<div class="detail-row"><strong>${item.type}</strong><span>${item.diagnosedAt} · ${item.source}</span><span class="badge status-${item.status}">${item.status}</span></div>`).join("") || `<p class="subtle">暂无慢病登记。</p>`}
    </section>
    <section class="detail-section">
      <h3>随访计划</h3>
      ${followups.map((item) => `<div class="detail-row"><strong>${item.diseaseType}</strong><span>${item.plannedAt} · ${item.assignee} · ${item.result}</span><span class="badge status-${item.status}">${item.status}</span></div>`).join("") || `<p class="subtle">暂无随访计划。</p>`}
    </section>
  `;
  document.querySelector("#resident-detail-dialog").showModal();
}

function openFollowupDialog(id) {
  const dialog = document.querySelector("#followup-dialog");
  const form = document.querySelector("#followup-form");
  form.reset();
  form.elements.plannedAt.value = todayOffset(7);
  const followup = id ? state.followups.find((item) => item.id === id) : null;
  if (followup) {
    Object.entries(followup).forEach(([key, value]) => {
      if (form.elements[key]) form.elements[key].value = value;
    });
  }
  dialog.showModal();
}

function completeFollowup(id) {
  const followup = state.followups.find((item) => item.id === id);
  if (!followup) return;
  followup.status = "已完成";
  followup.result = followup.result === "未记录" ? "控制良好" : followup.result;
  saveState();
  render();
  showToast("随访已标记完成");
}

function assessRisk(resident) {
  const { systolic, glucose, bmi } = resident.metrics;
  if (systolic >= 160 || glucose >= 7 || bmi >= 30) {
    return { level: "高危", reason: `收缩压 ${systolic}，血糖 ${glucose}，BMI ${bmi}` };
  }
  if (systolic >= 140 || glucose >= 6.1 || bmi >= 28) {
    return { level: "中危", reason: `收缩压 ${systolic}，血糖 ${glucose}，BMI ${bmi}` };
  }
  return { level: "低危", reason: `收缩压 ${systolic}，血糖 ${glucose}，BMI ${bmi}` };
}

function getStats() {
  const chronicResidents = new Set(state.diseases.map((item) => item.residentId)).size;
  const highRisk = state.residents.filter((item) => assessRisk(item).level === "高危").length;
  const pending = state.followups.filter((item) => item.status === "待随访").length;
  const overdue = state.followups.filter((item) => item.status === "已逾期").length;
  const completed = state.followups.filter((item) => item.status === "已完成");
  const controlled = completed.filter((item) => item.result === "控制良好").length;
  return {
    residents: state.residents.length,
    chronicResidents,
    highRisk,
    pending,
    overdue,
    controlRate: completed.length ? Math.round((controlled / completed.length) * 100) : 0
  };
}

function countBy(values) {
  return values.reduce((acc, value) => {
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function upsert(collection, item) {
  const index = collection.findIndex((entry) => entry.id === item.id);
  if (index >= 0) collection[index] = item;
  else collection.push(item);
}

function findResident(id) {
  return state.residents.find((item) => item.id === id);
}

function ageOf(birthDate) {
  const birth = new Date(birthDate);
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const monthDiff = now.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birth.getDate())) age -= 1;
  return age;
}

function exportCsv() {
  const rows = [
    ["姓名", "身份证号", "性别", "年龄", "联系电话", "管理机构", "家庭医生", "风险等级", "收缩压", "舒张压", "空腹血糖", "BMI", "慢病登记", "待随访数", "逾期随访数"],
    ...state.residents.map((resident) => {
      const risk = assessRisk(resident);
      const diseases = state.diseases.filter((item) => item.residentId === resident.id).map((item) => item.type).join("、") || "无";
      const followups = state.followups.filter((item) => item.residentId === resident.id);
      return [
        resident.name,
        resident.idCard,
        resident.gender,
        ageOf(resident.birthDate),
        resident.phone,
        resident.organization,
        resident.familyDoctor,
        risk.level,
        resident.metrics.systolic,
        resident.metrics.diastolic,
        resident.metrics.glucose,
        resident.metrics.bmi,
        diseases,
        followups.filter((item) => item.status === "待随访").length,
        followups.filter((item) => item.status === "已逾期").length
      ];
    })
  ];
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `慢病管理台账-${todayOffset(0)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  showToast("CSV 台账已导出");
}

function csvCell(value) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function renderDataSource() {
  const badge = document.querySelector("#data-source");
  if (!badge) return;
  badge.textContent = apiEnabled ? "本地服务" : "浏览器本地";
  badge.classList.toggle("online", apiEnabled);
}

let toastTimer;
function showToast(message) {
  const toast = document.querySelector("#toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2600);
}
