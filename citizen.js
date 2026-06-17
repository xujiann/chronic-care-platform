const STORAGE_KEY = "chronic-care-platform-state";
const CITIZEN_EXTRA_KEY = "chronic-care-citizen-extra";
const API_BASE = location.protocol === "file:" ? "" : "/api";

const fallbackState = {
  accounts: [
    {
      id: "a1",
      name: "演示居民A账户",
      phone: "DEMO-MOBILE-R1",
      role: "本人",
      members: [{ residentId: "r1", relation: "本人" }]
    }
  ],
  residents: [
    {
      id: "r1",
      name: "演示居民A",
      idCard: "DEMO-ID-R1",
      gender: "男",
      birthDate: "1968-02-11",
      phone: "DEMO-MOBILE-R1",
      organization: "青泥洼桥社区卫生服务中心",
      familyDoctor: "刘医生",
      address: "演示地址A",
      metrics: { systolic: 166, diastolic: 96, glucose: 6.8, bmi: 29.4 }
    }
  ],
  diseases: [
    { id: "d1", residentId: "r1", type: "高血压", diagnosedAt: "2024-10-12", source: "社区筛查", status: "管理中", note: "需加强用药依从性" }
  ],
  followups: [
    { id: "f1", residentId: "r1", diseaseType: "高血压", plannedAt: todayOffset(3), assignee: "刘医生", status: "待随访", result: "未记录", advice: "记录家庭血压" }
  ]
};

const emrRecords = [
  {
    residentId: "r1",
    date: "2026-05-21",
    institution: "大连市中心医院",
    department: "心内科",
    type: "门诊",
    diagnosis: "原发性高血压 2 级",
    summary: "复诊血压偏高，建议调整生活方式并规律服药。",
    exams: ["心电图：窦性心律", "肾功能：未见明显异常"],
    medications: ["苯磺酸氨氯地平片", "厄贝沙坦片"]
  },
  {
    residentId: "r1",
    date: "2026-04-12",
    institution: "青泥洼桥社区卫生服务中心",
    department: "全科门诊",
    type: "随访",
    diagnosis: "高血压随访",
    summary: "家庭血压记录不规律，已进行用药依从性宣教。",
    exams: ["血压：158/92 mmHg"],
    medications: ["继续原方案"]
  },
  {
    residentId: "r2",
    date: "2026-05-18",
    institution: "大连医科大学附属医院",
    department: "内分泌科",
    type: "门诊",
    diagnosis: "2 型糖尿病",
    summary: "空腹血糖控制不佳，建议复查糖化血红蛋白。",
    exams: ["空腹血糖：7.8 mmol/L", "糖化血红蛋白：待复查"],
    medications: ["二甲双胍片"]
  },
  {
    residentId: "r4",
    date: "2026-03-30",
    institution: "青泥洼桥社区卫生服务中心",
    department: "家庭医生工作室",
    type: "签约服务",
    diagnosis: "高血压稳定管理",
    summary: "血压较前稳定，继续季度随访。",
    exams: ["血压：148/88 mmHg"],
    medications: ["继续原用药"]
  }
];

const personalHealthData = {
  labs: [
    { residentId: "r1", date: "2026-05-21", name: "肾功能", result: "未见明显异常", source: "大连市中心医院" },
    { residentId: "r1", date: "2026-05-21", name: "心电图", result: "窦性心律", source: "大连市中心医院" },
    { residentId: "r2", date: "2026-05-18", name: "空腹血糖", result: "7.8 mmol/L，偏高", source: "大连医科大学附属医院" },
    { residentId: "r4", date: "2026-03-30", name: "血压复测", result: "148/88 mmHg", source: "青泥洼桥社区卫生服务中心" }
  ],
  medications: [
    { residentId: "r1", date: "2026-05-21", name: "苯磺酸氨氯地平片", usage: "每日 1 次", source: "心内科门诊" },
    { residentId: "r1", date: "2026-05-21", name: "厄贝沙坦片", usage: "每日 1 次", source: "心内科门诊" },
    { residentId: "r2", date: "2026-05-18", name: "二甲双胍片", usage: "每日 2 次", source: "内分泌科门诊" }
  ],
  allergies: [
    { residentId: "r1", date: "2025-10-02", name: "青霉素", result: "既往皮疹", source: "居民自述" },
    { residentId: "r2", date: "2025-08-14", name: "无明确药物过敏史", result: "已确认", source: "门诊问诊" }
  ],
  vaccines: [
    { residentId: "r1", date: "2025-11-01", name: "流感疫苗", result: "已接种", source: "社区卫生服务中心" },
    { residentId: "r4", date: "2025-11-05", name: "流感疫苗", result: "已接种", source: "社区卫生服务中心" }
  ],
  admissions: [
    { residentId: "r1", date: "2024-06-18", name: "日间观察", result: "血压波动观察，未住院", source: "大连市中心医院" },
    { residentId: "r3", date: "2025-12-09", name: "体检中心", result: "年度体检，无住院记录", source: "甘井子区人民医院" }
  ],
  authorizations: [
    { residentId: "r1", date: "2026-01-01", name: "家庭医生团队", result: "允许查看健康档案和随访记录", source: "居民授权" },
    { residentId: "r1", date: "2026-01-01", name: "区域医疗机构", result: "允许查看电子病历摘要", source: "居民授权" },
    { residentId: "r2", date: "2026-01-01", name: "家庭医生团队", result: "允许查看慢病管理信息", source: "居民授权" }
  ]
};

const vaultSections = [
  { key: "timeline", label: "健康时间线" },
  { key: "standard", label: "标准健康档案" },
  { key: "archive", label: "健康档案" },
  { key: "emr", label: "电子病历" },
  { key: "labs", label: "检查检验" },
  { key: "medications", label: "用药处方" },
  { key: "allergies", label: "过敏史" },
  { key: "vaccines", label: "免疫接种" },
  { key: "admissions", label: "手术住院" },
  { key: "authorizations", label: "授权共享" }
];

let activeVaultSection = "timeline";

let state = fallbackState;
let citizenExtra = loadCitizenExtra();
let currentResidentId;
let currentAccountId;

document.addEventListener("DOMContentLoaded", async () => {
  state = await loadState();
  ensureAccounts();
  populateAccounts();
  document.querySelector("#account-select").addEventListener("change", (event) => {
    currentAccountId = event.target.value;
    const account = getCurrentAccount();
    renderAccount(account);
    renderCitizen(account.members[0]?.residentId);
  });
  bindDialogs();
  currentAccountId = state.accounts[0]?.id;
  const account = getCurrentAccount();
  renderAccount(account);
  renderCitizen(account?.members[0]?.residentId || state.residents[0]?.id);
});

async function loadState() {
  if (API_BASE) {
    try {
      const request = window.HealthCityAuth?.authFetch || fetch;
      const response = await request(`${API_BASE}/state`);
      if (response.ok) return await response.json();
    } catch (error) {
      // Fall back to browser data below.
    }
  }
  try {
    const response = await fetch("./data/db.json");
    if (response.ok) return await response.json();
  } catch (error) {
    // Fall back to browser data below.
  }
  const saved = localStorage.getItem(STORAGE_KEY);
  return saved ? JSON.parse(saved) : fallbackState;
}

function ensureAccounts() {
  if (Array.isArray(state.accounts) && state.accounts.length) return;
  state.accounts = [
    {
      id: "a1",
      name: `${state.residents[0]?.name || "居民"}账户`,
      phone: state.residents[0]?.phone || "",
      role: "本人",
      members: state.residents.slice(0, 1).map((resident) => ({ residentId: resident.id, relation: "本人" }))
    }
  ];
}

function populateAccounts() {
  const select = document.querySelector("#account-select");
  select.innerHTML = state.accounts.map((item) => `<option value="${item.id}">${item.name}</option>`).join("");
}

function getCurrentAccount() {
  return state.accounts.find((item) => item.id === currentAccountId) || state.accounts[0];
}

function renderAccount(account) {
  if (!account) return;
  document.querySelector("#account-select").value = account.id;
  document.querySelector("#account-name").textContent = account.name;
  document.querySelector("#account-meta").textContent = `${account.phone} · ${account.role} · ${account.members.length} 名成员`;
  document.querySelector("#member-list").innerHTML = account.members
    .map((member) => {
      const resident = state.residents.find((item) => item.id === member.residentId);
      const active = member.residentId === currentResidentId ? "active" : "";
      return `<button class="member-card ${active}" data-member="${member.residentId}">
        <strong>${resident?.name || "未知成员"}</strong>
        <span>${member.relation}</span>
      </button>`;
    })
    .join("");
  document.querySelectorAll("[data-member]").forEach((button) => {
    button.addEventListener("click", () => renderCitizen(button.dataset.member));
  });
}

function renderCitizen(residentId) {
  const resident = state.residents.find((item) => item.id === residentId) || state.residents[0];
  if (!resident) return;
  currentResidentId = resident.id;
  renderAccount(getCurrentAccount());

  const risk = assessRisk(resident);
  const diseases = state.diseases.filter((item) => item.residentId === resident.id);
  const followups = state.followups.filter((item) => item.residentId === resident.id);
  const records = getPersonalRecords(resident.id, "emr");

  document.querySelector("#profile-name").textContent = resident.name;
  document.querySelector("#profile-meta").textContent = `${resident.gender} · ${ageOf(resident.birthDate)} 岁 · ${resident.organization} · 家庭医生：${resident.familyDoctor}`;
  const riskPill = document.querySelector("#profile-risk");
  riskPill.textContent = risk.level;
  riskPill.className = `risk-pill risk-${risk.level}`;

  renderSummary(resident, diseases, followups, records);
  renderLifeCycle(resident, diseases, followups, records);
  renderVault(resident, diseases, followups, records);
  renderEmr(records, resident, diseases, followups);
  renderDiseases(diseases, risk);
  renderFollowups(followups);
  renderReferrals(resident.id);
  renderBirthHealth(resident.id);
  renderPickups(resident.id);
  renderSeniorServices(resident.id);
  renderDigitalCredentials(resident.id);
  renderAccessLogs(resident.id);
}

function renderVault(resident, diseases, followups, records) {
  const grouped = collectVaultData(resident, diseases, followups, records);
  const completeCount = vaultSections.filter((section) => section.key === "standard" || grouped[section.key]?.length).length;
  const score = Math.round((completeCount / vaultSections.length) * 100);
  document.querySelector("#completeness-score").textContent = `${score}%`;
  document.querySelector("#completeness-bar").style.width = `${score}%`;
  document.querySelector("#vault-updated").textContent = `最近更新：${latestDate(grouped)}`;

  document.querySelector("#vault-tabs").innerHTML = vaultSections
    .map((section) => {
      const count = grouped[section.key]?.length || 0;
      const active = section.key === activeVaultSection ? "active" : "";
      return `<button class="${active}" data-vault="${section.key}">${section.label}<span>${count}</span></button>`;
    })
    .join("");

  document.querySelectorAll("[data-vault]").forEach((button) => {
    button.addEventListener("click", () => {
      activeVaultSection = button.dataset.vault;
      renderVault(resident, diseases, followups, records);
    });
  });

  if (activeVaultSection === "standard") {
    document.querySelector("#vault-content").innerHTML = renderStandardArchive(resident.id);
    return;
  }

  const activeItems = grouped[activeVaultSection] || [];
  document.querySelector("#vault-content").innerHTML = activeItems
    .map((item) => `<article class="vault-item">
      <div>
        <strong>${item.name}</strong>
        <p>${item.result}</p>
        ${item.categoryLabel ? `<p class="muted">${item.categoryLabel}${item.related ? ` · ${item.related}` : ""}</p>` : ""}
        ${activeVaultSection === "authorizations" ? renderAuthorizationState(item) : ""}
      </div>
      <span>${item.date}<br>${item.source}</span>
      ${activeVaultSection === "authorizations" && !isRevoked(item) ? `<button class="revoke-button" data-revoke-auth="${item.id}">撤销</button>` : ""}
    </article>`)
    .join("") || `<p class="muted">当前分类暂无数据，后续可通过区域平台、医院电子病历或个人上传补齐。</p>`;
  document.querySelectorAll("[data-revoke-auth]").forEach((button) => {
    button.addEventListener("click", () => revokeAuthorization(button.dataset.revokeAuth));
  });
}

function collectVaultData(resident, diseases, followups, records) {
  const labs = getPersonalRecords(resident.id, "labs");
  const medications = getPersonalRecords(resident.id, "medications");
  const allergies = getPersonalRecords(resident.id, "allergies");
  const vaccines = getPersonalRecords(resident.id, "vaccines");
  const admissions = getPersonalRecords(resident.id, "admissions");
  const authorizations = getPersonalRecords(resident.id, "authorizations");
  const archive = [
    { date: todayOffset(0), name: "基础档案", result: `${resident.gender}，${ageOf(resident.birthDate)} 岁，${resident.address}`, source: resident.organization, categoryLabel: "健康档案" },
    { date: todayOffset(0), name: "健康指标", result: `血压 ${resident.metrics.systolic}/${resident.metrics.diastolic}，血糖 ${resident.metrics.glucose}，BMI ${resident.metrics.bmi}`, source: "居民健康档案", categoryLabel: "健康档案" },
    ...diseases.map((item) => ({ date: item.diagnosedAt, name: item.type, result: item.status, source: item.source, categoryLabel: "慢病登记" })),
    ...followups.map((item) => ({ date: item.plannedAt, name: `${item.diseaseType}随访`, result: `${item.status} · ${item.advice || item.result}`, source: item.assignee, categoryLabel: "随访管理" }))
  ];
  return {
    timeline: buildHealthTimeline(archive, records, labs, medications, allergies, vaccines, admissions),
    standard: buildStandardArchiveItems(resident.id),
    archive,
    emr: records.map((item) => ({ ...item, categoryLabel: "电子病历", related: relatedArchiveSummary(diseases, followups) })),
    labs,
    medications,
    allergies,
    vaccines,
    admissions,
    authorizations
  };
}

function buildStandardArchiveItems(residentId) {
  const coverage = getStandardCoverage(residentId);
  return coverage.datasets.filter((item) => item.status === "已归集");
}

function renderStandardArchive(residentId) {
  const coverage = getStandardCoverage(residentId);
  const standard = coverage.standard;
  const groups = standard.contentGroups.map((group) => {
    const datasets = coverage.datasets.filter((item) => item.group === group.key);
    const done = datasets.filter((item) => item.status === "已归集").length;
    const applicable = datasets.filter((item) => item.applicable).length;
    return { ...group, done, applicable, datasets };
  });
  return `<div class="standard-archive">
    <section class="standard-hero">
      <div>
        <span>${standard.version}</span>
        <h3>${coverage.lifeStage} · ${coverage.risk}</h3>
        <p>以居民个人为中心，将健康档案、电子病历、慢病随访、检查检验、用药处方和固定取药统一索引到 ${coverage.resident.personIndex || "personIndex 待生成"}。</p>
      </div>
      <div class="standard-score">
        <strong>${coverage.score}%</strong>
        <span>适用数据集归集度</span>
        <small>${coverage.applicableCompleted}/${coverage.applicableTotal} 项适用数据集已归集</small>
      </div>
    </section>
    <section class="dimension-grid">
      ${standard.dimensions.map((item) => `<article>
        <strong>${item.title}</strong>
        <span>${item.key === "lifeStage" ? coverage.lifeStage : item.key === "healthProblem" ? coverage.problems.join("、") : coverage.activities.map((activity) => activity.title).join("、")}</span>
        <p>${item.detail}</p>
      </article>`).join("")}
    </section>
    <section class="activity-grid">
      ${coverage.activities.map((item) => `<article>
        <strong>${item.title}</strong>
        <span>${item.detail}</span>
      </article>`).join("")}
    </section>
    <section class="standard-groups">
      ${groups.map((group) => `<article>
        <div class="standard-group-head">
          <div>
            <strong>${group.title}</strong>
            <p>${group.detail}</p>
          </div>
          <span>${group.done}/${group.applicable || group.datasets.length}</span>
        </div>
        <div class="dataset-list">
          ${group.datasets.map((dataset) => renderDataset(dataset)).join("")}
        </div>
      </article>`).join("")}
    </section>
  </div>`;
}

function renderDataset(dataset) {
  const statusClass = dataset.status === "已归集" ? "ready" : dataset.status === "待补齐" ? "missing" : "idle";
  const evidence = dataset.evidence.length ? dataset.evidence.slice(0, 2).join("；") : dataset.status === "当前不适用" ? "按当前年龄、性别或疾病情况暂不适用。" : "后续由医疗机构、公共卫生服务或个人上传补齐。";
  return `<div class="dataset-row ${statusClass}">
    <span>${dataset.code}</span>
    <strong>${dataset.name}</strong>
    <em>${dataset.status}</em>
    <small>${evidence}</small>
  </div>`;
}

function getStandardCoverage(residentId) {
  if (window.HealthArchiveStandard) {
    return window.HealthArchiveStandard.getResidentCoverage(state, residentId);
  }
  return { standard: { dimensions: [], contentGroups: [], datasets: [] }, datasets: [], score: 0, applicableCompleted: 0, applicableTotal: 0, activities: [], problems: [] };
}

function buildHealthTimeline(archive, records, labs, medications, allergies, vaccines, admissions) {
  return [
    ...archive,
    ...records.map((item) => ({ ...item, categoryLabel: "电子病历" })),
    ...labs.map((item) => ({ ...item, categoryLabel: "检查检验" })),
    ...medications.map((item) => ({ ...item, categoryLabel: "用药处方" })),
    ...allergies.map((item) => ({ ...item, categoryLabel: "过敏史" })),
    ...vaccines.map((item) => ({ ...item, categoryLabel: "免疫接种" })),
    ...admissions.map((item) => ({ ...item, categoryLabel: "手术住院" }))
  ].sort(sortByDateDesc);
}

function relatedArchiveSummary(diseases, followups) {
  const diseaseText = diseases.map((item) => item.type).join("、") || "暂无慢病登记";
  const pending = followups.filter((item) => item.status !== "已完成").length;
  return `${diseaseText} · ${pending} 项待随访`;
}

function renderSummary(resident, diseases, followups, records) {
  const pending = followups.filter((item) => item.status !== "已完成").length;
  const cards = [
    ["血压", `${resident.metrics.systolic}/${resident.metrics.diastolic}`, "mmHg"],
    ["空腹血糖", resident.metrics.glucose, "mmol/L"],
    ["BMI", resident.metrics.bmi, "kg/m²"],
    ["电子病历", records.length, "条诊疗记录"],
    ["慢病登记", diseases.length, diseases.map((item) => item.type).join("、") || "暂无"],
    ["待随访", pending, "项待处理"],
    ["家庭医生", resident.familyDoctor, resident.organization],
    ["档案地址", resident.address, resident.phone]
  ];
  document.querySelector("#summary-grid").innerHTML = cards
    .map(([label, value, hint]) => `<article class="summary-card"><span>${label}</span><strong>${value}</strong><small>${hint}</small></article>`)
    .join("");
}

function renderLifeCycle(resident, diseases, followups, records) {
  const container = document.querySelector("#lifecycle-cards");
  if (!container) return;
  const birthCertificates = getBirthCertificatesForResident(resident.id);
  const deathCertificates = getDeathCertificatesForResident(resident.id);
  const labs = getPersonalRecords(resident.id, "labs");
  const vaccines = getPersonalRecords(resident.id, "vaccines");
  const medications = getPersonalRecords(resident.id, "medications");
  const senior = (state.seniorServices || []).filter((item) => item.residentId === resident.id);
  const age = ageOf(resident.birthDate);
  const latestRecord = [records[0], labs[0], medications[0]].filter(Boolean).sort(sortByDateDesc)[0];
  const pendingFollowups = followups.filter((item) => item.status !== "已完成");
  const stages = [
    {
      title: "出生与建档",
      status: birthCertificates.length ? "已归集" : "待归集",
      detail: birthCertificates[0]
        ? `${birthCertificates[0].newbornName || resident.name} · ${birthCertificates[0].certificateNo} · ${birthCertificates[0].healthManagementStatus || "新生儿管理"}`
        : "出生医学证明、母婴三证和新生儿访视信息待接入。",
      action: birthCertificates[0]?.nextService || "补齐出生证、出生筛查和接种起始记录"
    },
    {
      title: "儿童青少年",
      status: vaccines.length ? "有记录" : age < 18 ? "待跟进" : "历史阶段",
      detail: vaccines[0] ? `${vaccines.length} 条免疫接种记录，最近：${vaccines[0].name}` : "儿童体检、免疫规划、发育评估和学校健康记录可持续归集。",
      action: age < 18 ? "关注体检、接种、发育和视力口腔管理" : "保留历史儿童保健和接种档案"
    },
    {
      title: "成人健康",
      status: latestRecord ? "持续更新" : "待补齐",
      detail: latestRecord ? `${latestRecord.date} · ${latestRecord.name} · ${latestRecord.source}` : "体检、门诊病历、检查检验和用药处方待补齐。",
      action: "保持年度体检、授权共享和异常指标随访"
    },
    {
      title: "慢病与康复",
      status: diseases.length ? "管理中" : "未登记慢病",
      detail: diseases.length ? diseases.map((item) => `${item.type}/${item.status}`).join("、") : "暂无慢病登记，继续风险筛查和健康教育。",
      action: pendingFollowups.length ? `${pendingFollowups.length} 项随访待处理` : "按需开展慢病筛查、复诊和康复管理"
    },
    {
      title: "老年与照护",
      status: age >= 60 || senior.length ? "已纳入" : "预备阶段",
      detail: senior.length ? senior.map((item) => `${item.serviceName || item.type || "适老服务"} · ${item.status || "服务中"}`).join("、") : "适老服务、家庭代办、长期处方、失能评估和照护资源可接续。",
      action: age >= 60 ? "完善老年健康评估、用药安全和照护计划" : "提前建立家庭联系人和授权代办"
    },
    {
      title: "死亡与身后事项",
      status: deathCertificates.length ? "已归档" : "未发生",
      detail: deathCertificates[0]
        ? `${deathCertificates[0].certificateNo} · ${deathCertificates[0].deathDateTime} · ${deathCertificates[0].qualityCheck || "待质控"}`
        : "死亡医学证明、公安民政共享和家属事项尚未触发。",
      action: deathCertificates[0] ? `${deathCertificates[0].publicSecuritySync || "公安待共享"} · ${deathCertificates[0].civilAffairsSync || "民政待共享"}` : "保留预立授权、紧急联系人和身后事务指引"
    }
  ];
  document.querySelector("#lifecycle-summary").textContent = `${resident.name} · ${age} 岁 · ${stages.filter((item) => ["已归集", "有记录", "持续更新", "管理中", "已纳入", "已归档"].includes(item.status)).length}/6 个阶段已有数据`;
  container.innerHTML = stages.map((stage, index) => `<article class="lifecycle-card">
    <span>${String(index + 1).padStart(2, "0")}</span>
    <strong>${stage.title}</strong>
    <p>${stage.detail}</p>
    <small>${stage.status} · ${stage.action}</small>
  </article>`).join("");
}

function getBirthCertificatesForResident(residentId) {
  return (state.birthCertificates || [])
    .filter((item) => item.maternalResidentId === residentId || item.residentId === residentId)
    .sort((a, b) => String(b.birthDateTime || b.lastUpdated || "").localeCompare(String(a.birthDateTime || a.lastUpdated || "")));
}

function getDeathCertificatesForResident(residentId) {
  return (state.deathCertificates || [])
    .filter((item) => item.residentId === residentId)
    .sort((a, b) => String(b.deathDateTime || b.lastUpdated || "").localeCompare(String(a.deathDateTime || a.lastUpdated || "")));
}

function renderEmr(records, resident, diseases, followups) {
  document.querySelector("#emr-count").textContent = `${records.length} 条`;
  const archiveLink = `${resident.organization} · ${diseases.map((item) => item.type).join("、") || "暂无慢病登记"} · ${followups.filter((item) => item.status !== "已完成").length} 项待随访`;
  document.querySelector("#emr-timeline").innerHTML = records
    .map((record) => `<section class="visit">
      <div class="visit-date">${record.date}<br><span class="tag">${record.meta?.visitType || "病历"}</span></div>
      <div class="visit-body">
        <h3>${record.source}</h3>
        <p class="muted">${record.name}</p>
        <p>${record.result}</p>
        <p class="muted">关联健康档案：${archiveLink}</p>
        <div class="visit-tags">
          ${(record.meta?.exams || []).map((item) => `<span class="tag">${item}</span>`).join("")}
          ${(record.meta?.medications || []).map((item) => `<span class="tag">${item}</span>`).join("")}
        </div>
      </div>
    </section>`)
    .join("") || `<p class="muted">暂无电子病历记录。</p>`;
}

function renderDiseases(diseases, risk) {
  document.querySelector("#disease-cards").innerHTML = diseases
    .map((item) => `<article class="mini-card">
      <h3>${item.type}</h3>
      <p class="muted">${item.diagnosedAt} · ${item.source}</p>
      <p>${item.note || "按计划持续管理。"}</p>
      <span class="status ${risk.level === "高危" ? "danger" : risk.level === "中危" ? "warn" : ""}">${item.status} · ${risk.level}</span>
    </article>`)
    .join("") || `<p class="muted">暂无慢病登记。</p>`;
}

function renderFollowups(followups) {
  document.querySelector("#followup-cards").innerHTML = followups
    .sort((a, b) => a.plannedAt.localeCompare(b.plannedAt))
    .map((item) => `<article class="mini-card">
      <h3>${item.diseaseType}</h3>
      <p class="muted">${item.plannedAt} · ${item.assignee}</p>
      <p>${item.advice || "按计划完成随访。"}</p>
      <span class="status ${item.status === "已逾期" ? "danger" : item.status === "待随访" ? "warn" : ""}">${item.status}</span>
    </article>`)
    .join("") || `<p class="muted">暂无随访提醒。</p>`;
}

function renderReferrals(residentId) {
  const target = document.querySelector("#referral-cards");
  if (!target) return;
  const referrals = (state.referralSystem?.referrals || []).filter((item) => item.residentId === residentId);
  const services = (state.referralSystem?.familyDoctorServices || []).filter((item) => item.residentId === residentId);
  const education = state.referralSystem?.education || [];
  target.innerHTML = [
    ...referrals.map((item) => `<article class="mini-card">
      <h3>${item.type} · ${item.diseaseType}</h3>
      <p class="muted">${item.from} → ${item.to}</p>
      <p>${item.reason}</p>
      <p>${item.reservedResource}</p>
      <span class="status ${item.priority === "高" ? "danger" : item.status.includes("待") ? "warn" : ""}">${item.status}</span>
    </article>`),
    ...services.map((item) => `<article class="mini-card">
      <h3>${item.servicePackage}</h3>
      <p class="muted">${item.provider} · ${item.fulfillment}</p>
      <p>${item.items.join("、")}</p>
      <p>${item.nextAction}</p>
      <span class="status">家庭医生签约</span>
    </article>`),
    ...education.slice(0, referrals.length ? 1 : 2).map((item) => `<article class="mini-card">
      <h3>${item.title}</h3>
      <p class="muted">${item.audience} · ${item.channel}</p>
      <p>${item.message}</p>
      <span class="status">就医指引</span>
    </article>`)
  ].join("") || `<p class="muted">暂无转诊服务。常见病、慢性病稳定期建议优先基层首诊。</p>`;
}

function renderBirthHealth(residentId) {
  const container = document.querySelector("#birth-health-cards");
  if (!container) return;
  const certificates = (state.birthCertificates || []).filter((item) => item.maternalResidentId === residentId || item.residentId === residentId);
  container.innerHTML = certificates.map((item) => {
    const badge = item.healthManagementStatus?.includes("待") || item.status?.includes("待") ? "warn" : "info";
    return `<article class="card">
      <div>
        <strong>${item.newbornName || "未命名新生儿"} · ${item.certificateNo}</strong>
        <p>${item.birthDateTime || "出生时间待确认"} · ${item.newbornGender || "性别待确认"} · ${item.birthWeight || "-"}g</p>
        <p>出生证明：${item.status || "待处理"} · 电子证照 ${item.electronicLicenseStatus || "待生成"} · 公安 ${item.publicSecuritySync || "未共享"}</p>
        <p>健康管理：${item.healthManagementStatus || "待建档"} · ${item.nextService || "新生儿访视与预防接种提醒"}</p>
      </div>
      <span class="badge ${badge}">${item.issueType || "首次签发"}</span>
    </article>`;
  }).join("") || `<p class="muted">当前家庭成员暂无出生医学证明或新生儿健康管理任务。</p>`;
}

function renderPickups(residentId) {
  const pickups = (state.medicationPickups || []).filter((item) => item.residentId === residentId).sort(sortByDateDesc);
  document.querySelector("#pickup-cards").innerHTML = pickups
    .map((item) => `<article class="mini-card">
      <h3>${item.medication}</h3>
      <p class="muted">${item.dosage} · 每月 ${item.pickupDay} 日</p>
      <p>${item.pharmacy}</p>
      <p>下次取药：${item.nextPickup}</p>
      <p>闭环：${item.requestStatus || "待申请"} · ${item.institutionReview || "待机构确认"} · ${item.insuranceReview || "待医保审核"} · ${item.pharmacyStatus || item.status}</p>
      <p class="muted">${item.applyMode || "本人申请"} · ${item.deliveryMode || "社区药房自取"}</p>
      <span class="status ${item.status === "待取药" ? "warn" : ""}">${item.status} · ${item.coverage}</span>
    </article>`)
    .join("") || `<p class="muted">暂无固定取药计划。</p>`;
}

function renderSeniorServices(residentId) {
  const target = document.querySelector("#senior-service-cards");
  if (!target) return;
  const services = (state.seniorServices || []).filter((item) => item.residentId === residentId);
  target.innerHTML = services
    .map((item) => `<article class="mini-card">
      <h3>${item.service}</h3>
      <p class="muted">${item.channel} · ${item.contact}</p>
      <p>${item.nextAction}</p>
      <span class="status ${item.status === "待开通" ? "warn" : ""}">${item.status}</span>
    </article>`)
    .join("") || `<p class="muted">暂无适老服务配置。</p>`;
}

function renderDigitalCredentials(residentId) {
  const target = document.querySelector("#credential-cards");
  if (!target) return;
  const credentials = (state.digitalCredentials || []).filter((item) => item.residentId === residentId);
  target.innerHTML = credentials
    .map((item) => `<article class="mini-card">
      <h3>${item.type}</h3>
      <p class="muted">${item.provider} · ${item.lastVerified}</p>
      <p>${maskCredential(item.credentialNo)} · ${item.usage}</p>
      <span class="status ${item.status === "待核验" ? "warn" : ""}">${item.status}</span>
    </article>`)
    .join("") || `<p class="muted">暂无电子健康码或医保电子凭证。</p>`;
}

function maskCredential(value) {
  const text = String(value || "");
  return text.length > 6 ? `${text.slice(0, 3)}****${text.slice(-4)}` : text;
}

function renderAccessLogs(residentId) {
  const target = document.querySelector("#access-log-cards");
  if (!target) return;
  const logs = (state.dataAccessLogs || []).filter((item) => item.residentId === residentId).slice(0, 4);
  target.innerHTML = logs
    .map((item) => `<article class="mini-card">
      <h3>${item.actor}</h3>
      <p class="muted">${item.at} · ${item.purpose}</p>
      <p>${item.scope}</p>
      <span class="status ${item.result === "拒绝" ? "danger" : ""}">${item.result}</span>
    </article>`)
    .join("") || `<p class="muted">暂无访问记录。</p>`;
}

function assessRisk(resident) {
  const { systolic, glucose, bmi } = resident.metrics;
  if (systolic >= 160 || glucose >= 7 || bmi >= 30) return { level: "高危" };
  if (systolic >= 140 || glucose >= 6.1 || bmi >= 28) return { level: "中危" };
  return { level: "低危" };
}

function ageOf(birthDate) {
  const birth = new Date(birthDate);
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const monthDiff = now.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birth.getDate())) age -= 1;
  return age;
}

function todayOffset(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function byResident(items, residentId) {
  return items.filter((item) => item.residentId === residentId).sort((a, b) => b.date.localeCompare(a.date));
}

function latestDate(grouped) {
  const dates = Object.values(grouped).flat().map((item) => item.date).filter(Boolean).sort().reverse();
  return dates[0] || todayOffset(0);
}

function bindDialogs() {
  document.querySelector("#upload-record").addEventListener("click", () => {
    const form = document.querySelector("#upload-form");
    form.reset();
    form.elements.date.value = todayOffset(0);
    document.querySelector("#upload-dialog").showModal();
  });
  document.querySelector("#grant-auth").addEventListener("click", () => {
    const form = document.querySelector("#auth-form");
    form.reset();
    form.elements.date.value = todayOffset(365);
    form.elements.source.value = "居民主动授权";
    document.querySelector("#auth-dialog").showModal();
  });
  document.querySelectorAll("[data-close]").forEach((button) => {
    button.addEventListener("click", () => button.closest("dialog").close());
  });
  document.querySelector("#upload-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    await addPersonalRecord({
      residentId: currentResidentId,
      category: data.category,
      date: data.date,
      name: data.name,
      result: data.result,
      source: data.source
    });
    activeVaultSection = data.category;
    event.currentTarget.closest("dialog").close();
    renderCitizen(currentResidentId);
    showToast("健康资料已纳入个人健康信息库");
  });
  document.querySelector("#auth-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    await addPersonalRecord({
      residentId: currentResidentId,
      category: "authorizations",
      date: data.date,
      name: data.name,
      result: data.result,
      source: data.source
    });
    activeVaultSection = "authorizations";
    event.currentTarget.closest("dialog").close();
    renderCitizen(currentResidentId);
    showToast("授权记录已保存");
  });
}

async function addPersonalRecord(record) {
  if (API_BASE) {
    try {
      const request = window.HealthCityAuth?.authFetch || fetch;
      const response = await request(`${API_BASE}/personal-records`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(record)
      });
      if (response.ok) {
        const saved = await response.json();
        if (!Array.isArray(state.personalRecords)) state.personalRecords = [];
        state.personalRecords.push(saved);
        return;
      }
    } catch (error) {
      // Fall back to browser storage below.
    }
  }
    addExtraRecord(record.residentId, record.category, record);
}

function addExtraRecord(residentId, category, record) {
  const savedRecord = { ...record, residentId, category, id: crypto.randomUUID(), createdBy: "resident", createdAt: new Date().toISOString() };
  if (!citizenExtra[residentId]) citizenExtra[residentId] = {};
  if (!citizenExtra[residentId][category]) citizenExtra[residentId][category] = [];
  citizenExtra[residentId][category].push(savedRecord);
  localStorage.setItem(CITIZEN_EXTRA_KEY, JSON.stringify(citizenExtra));
  if (!Array.isArray(state.personalRecords)) state.personalRecords = [];
  state.personalRecords.push(savedRecord);
}

function loadCitizenExtra() {
  const saved = localStorage.getItem(CITIZEN_EXTRA_KEY);
  return saved ? JSON.parse(saved) : {};
}

function sortByDateDesc(a, b) {
  return String(b.date || "").localeCompare(String(a.date || ""));
}

function getPersonalRecords(residentId, category) {
  const fromState = Array.isArray(state.personalRecords) && state.personalRecords.length ? state.personalRecords : buildFallbackPersonalRecords();
  const stateItems = fromState.filter((item) => item.residentId === residentId && item.category === category);
  const stateIds = new Set(stateItems.map((item) => item.id).filter(Boolean));
  const extra = (citizenExtra[residentId]?.[category] || []).filter((item) => !stateIds.has(item.id));
  return [...stateItems, ...extra.map((item) => ({ ...item, residentId, category }))]
    .sort(sortByDateDesc);
}

function buildFallbackPersonalRecords() {
  return [
    ...emrRecords.map((item) => ({
      id: `fallback-emr-${item.residentId}-${item.date}-${item.diagnosis}`,
      residentId: item.residentId,
      category: "emr",
      date: item.date,
      name: item.diagnosis,
      result: item.summary,
      source: `${item.institution} · ${item.department}`,
      meta: { visitType: item.type, exams: item.exams, medications: item.medications }
    })),
    ...Object.entries(personalHealthData).flatMap(([category, items]) =>
      items.map((item) => ({
        id: `fallback-${category}-${item.residentId}-${item.date}-${item.name}`,
        residentId: item.residentId,
        category,
        date: item.date,
        name: item.name,
        result: item.result || item.usage,
        source: item.source,
        meta: {}
      }))
    )
  ];
}

function renderAuthorizationState(item) {
  const status = getAuthorizationStatus(item);
  return `<div class="auth-state ${status.className}">${status.label}</div>`;
}

function getAuthorizationStatus(item) {
  if (isRevoked(item)) return { label: `已撤销 · ${item.meta?.revokedAt || ""}`, className: "revoked" };
  if (item.date && item.date < todayOffset(0)) return { label: "已过期", className: "expired" };
  return { label: `有效期至 ${item.date || "长期"}`, className: "active" };
}

function isRevoked(item) {
  return item.meta?.status === "revoked";
}

async function revokeAuthorization(id) {
  const record = state.personalRecords?.find((item) => item.id === id);
  if (!record) return;
  const patch = { meta: { status: "revoked", revokedAt: todayOffset(0) } };
  if (API_BASE) {
    try {
      const request = window.HealthCityAuth?.authFetch || fetch;
      const response = await request(`${API_BASE}/personal-records/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch)
      });
      if (response.ok) {
        const updated = await response.json();
        Object.assign(record, updated);
        renderCitizen(currentResidentId);
        showToast("授权已撤销");
        return;
      }
    } catch (error) {
      // Fall back to local state update below.
    }
  }
  record.meta = { ...(record.meta || {}), ...patch.meta };
  localStorage.setItem(CITIZEN_EXTRA_KEY, JSON.stringify(citizenExtra));
  renderCitizen(currentResidentId);
  showToast("授权已撤销");
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
