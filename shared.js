const API_BASE = location.protocol === "file:" ? "" : "/api";
const STORAGE_KEY = "chronic-care-platform-state";

const HEALTH_CITY_ZH_TERMS = {
  "hospital-operation-monitoring": "医院运行监测",
  "bed-staff-equipment-outpatient-inpatient-dispatch": "床位/人员/设备/门急诊/住院运行调度",
  "statistics-direct-report-reconciliation": "统计直报对账",
  "alert-rule-review": "预警规则复核",
  "resource-dispatch": "资源调度",
  "statistics-reconciliation": "统计对账",
  "healthStatistics": "卫生健康统计数据",
  "healthStatisticsIngestion": "统计直报采集数据",
  "medicalResources": "医疗资源台账",
  "platformProcessAudit": "平台流程审计",
  "/api/metrics": "运行指标接口",
  "operations-readiness": "运维就绪证据",
  "Qingniwaqiao Community Health Service Center": "青泥洼桥社区卫生服务中心",
  "Dalian Central Hospital": "大连市中心医院",
  "Dalian Women and Children Medical Center": "大连市妇女儿童医疗中心",
  "critical": "严重预警",
  "warning": "一般预警",
  "normal": "正常",
  "high": "高",
  "medium": "中",
  "low": "低",
  "pending": "待处理",
  "assigned": "已分派",
  "in-progress": "处理中",
  "pending-review": "待复核",
  "blocked": "阻断",
  "closed": "已关闭",
  "approved": "已通过",
  "returned": "已退回",
  "correcting": "补正中",
  "cancelled": "已取消",
  "created": "已创建",
  "system": "系统自动",
  "operations": "运行调度岗",
  "beds": "床位",
  "staff": "人员",
  "outpatient": "门急诊",
  "statistics": "统计直报",
  "bed": "床位",
  "nurse-support": "护理支援",
  "step-down-bed": "过渡病床",
  "ct-slot": "影像检查时段",
  "statistics-office": "统计管理科",
  "healthStatisticsIngestion, operationAlertRules": "统计直报采集数据、运行预警规则",
  "healthStatistics, healthStatisticsIngestion, hospitalOperationSnapshots": "卫生健康统计数据、统计直报采集数据、医院运行快照",
  "outpatient.visitsToday": "门诊今日人次",
  "outpatient.feverClinicVisits": "发热门诊人次",
  "inpatient.admissionsToday": "住院今日入院",
  "beds.occupied": "占用床位",
  "staff.shortage": "人员缺口",
  "occupied/open >= 0.90": "开放床位占用率不低于90%",
  "occupied/open >= 0.95": "开放床位占用率不低于95%",
  "shortage > 0": "人员缺口大于0",
  "waitingOver30Min >= 50": "候诊超过30分钟人数不低于50",
  "varianceRate >= 0.05": "直报差异率不低于5%",
  "Open hospital reserve bed or start cross-institution transfer.": "启用院内备用床位或启动跨机构转运。",
  "City operations desk must approve bed dispatch within 4 hours.": "市级运行调度岗须在4小时内完成床位调度审批。",
  "District reserve staff can be assigned after institution confirmation.": "机构确认后可分派区级储备人员。",
  "Adjust outpatient queue, emergency triage, and CT priority slots.": "调整门诊排队、急诊分诊和影像检查优先时段。",
  "Block direct-report submission until reconciliation review closes.": "对账复核关闭前暂停直报提交。",
  "Shift chronic follow-up visits to telehealth and request district nurse support before 14:00.": "将慢病随访调整为线上服务，并在14:00前申请区级护理支援。",
  "Open 30 step-down beds and transfer two CT time slots to emergency priority.": "开放30张过渡病床，并将2个影像检查时段转为急诊优先。",
  "Keep pediatric emergency surge reserve and confirm afternoon obstetric bed turnover.": "保留儿科急诊高峰储备，并确认下午产科床位周转。",
  "Community bed occupancy above 95% with emergency observation growth.": "基层机构床位占用率超过95%，急诊留观持续增长。",
  "Primary-care nurse shortage during fever-clinic peak.": "发热门诊高峰期基层护理人员不足。",
  "Outpatient daily feed is higher than direct-report staging table.": "门诊日采集数据高于直报暂存表。",
  "Fever-clinic and staffing variance must be confirmed before report submission.": "提交直报前须确认发热门诊和人员缺口差异。",
  "Generated from operation snapshot alert.": "由运行快照预警自动生成。",
  "District reserve team assigned.": "已分派区级储备队伍。",
  "Approved from operations dispatch console.": "已由运行调度控制台通过。",
  "API regression dispatch": "接口回归调度"
};

function healthCityZhText(value) {
  if (value == null) return "";
  const text = String(value);
  return HEALTH_CITY_ZH_TERMS[text] || text;
}

function healthCityZhList(values, separator = "、") {
  return (Array.isArray(values) ? values : []).map(healthCityZhText).join(separator);
}

window.HealthCityLocale = {
  terms: HEALTH_CITY_ZH_TERMS,
  text: healthCityZhText,
  list: healthCityZhList,
  rule: "所有前端可见的接口枚举、机构名、状态、资源类型、字段路径和流程说明，必须先经过 HealthCityLocale.text/list 中文化后再渲染。"
};

async function loadPlatformState(fallback) {
  if (API_BASE) {
    try {
      const request = window.HealthCityAuth?.authFetch || fetch;
      const response = await request(`${API_BASE}/state`);
      if (response.ok) return normalizePlatformState(await response.json());
    } catch (error) {
      // Static fallback below.
    }
  }
  try {
    const response = await fetch("./data/db.json");
    if (response.ok) return normalizePlatformState(await response.json());
  } catch (error) {
    // Browser storage fallback below.
  }
  const saved = localStorage.getItem(STORAGE_KEY);
  return normalizePlatformState(saved ? JSON.parse(saved) : fallback);
}

function normalizePlatformState(data) {
  const state = data || {};
  if (!state.creditEvaluationRules) state.creditEvaluationRules = defaultCreditEvaluationRules();
  if (!Array.isArray(state.researchDatasets)) state.researchDatasets = defaultResearchDatasets();
  if (!Array.isArray(state.diseaseRegistryModels)) state.diseaseRegistryModels = defaultDiseaseRegistryModels();
  if (!state.mobileExperienceSettings || typeof state.mobileExperienceSettings !== "object") state.mobileExperienceSettings = defaultMobileExperienceSettings();
  if (!Array.isArray(state.accessibilityChecklist)) state.accessibilityChecklist = defaultAccessibilityChecklist();
  const residents = Array.isArray(state.residents) ? state.residents : [];
  residents.forEach((resident) => {
    resident.personIndex = personIndexFromParts(resident.idCard, resident.phone);
    resident.identityIndex = resident.personIndex;
  });
  const residentMap = new Map(residents.map((resident) => [resident.id, resident]));
  ["diseases", "followups", "personalRecords", "careOrders", "medicationPickups", "insuranceClaims", "seniorServices", "dataAccessLogs", "digitalCredentials", "deathCertificates", "birthCertificates", "multiPracticeApplications", "chronicScreeningTasks", "chronicEducationPushes", "chronicManagementPlans", "countyCollaborationOrders", "countyAiDiagnosisCases", "countyMutualRecognitionRecords"].forEach((key) => {
    (Array.isArray(state[key]) ? state[key] : []).forEach((item) => {
      item.personIndex = item.personIndex || personIndexForResident(residentMap, item.residentId);
    });
  });
  (Array.isArray(state.accounts) ? state.accounts : []).forEach((account) => {
    (Array.isArray(account.members) ? account.members : []).forEach((member) => {
      member.personIndex = member.personIndex || personIndexForResident(residentMap, member.residentId);
    });
  });
  return state;
}

function defaultCreditEvaluationRules() {
  return {
    version: "credit-rules-2026.1",
    dimensions: [
      { key: "legalPractice", name: "依法执业", weight: 25, source: "执业监管台账", maxDeduction: 8 },
      { key: "qualitySafety", name: "质量安全", weight: 30, source: "质控复核与危急值处置", maxDeduction: 12 },
      { key: "dataReporting", name: "数据报送", weight: 25, source: "数据质量问题与接口死信", maxDeduction: 15 },
      { key: "serviceCredit", name: "服务信用", weight: 20, source: "任务超时、居民消息回执和整改闭环", maxDeduction: 10 }
    ],
    gradeBands: [
      { grade: "A", minScore: 90 },
      { grade: "B+", minScore: 85 },
      { grade: "B", minScore: 80 },
      { grade: "C", minScore: 70 },
      { grade: "D", minScore: 0 }
    ]
  };
}

function defaultResearchDatasets() {
  return [
    { id: "rd-hypertension-001", diseaseType: "hypertension", name: "Hypertension chronic management cohort", version: "1.0.0", ethicsApproval: "IRB-DEMO-HTN-2026", anonymization: "k-anonymity-demo", authorizationStatus: "approved", records: 2, status: "published", usageAudit: [], outcomes: [] },
    { id: "rd-diabetes-001", diseaseType: "diabetes", name: "Diabetes follow-up and HbA1c cohort", version: "1.0.0", ethicsApproval: "IRB-DEMO-DM-2026", anonymization: "k-anonymity-demo", authorizationStatus: "approved", records: 1, status: "published", usageAudit: [], outcomes: [] }
  ];
}

function defaultDiseaseRegistryModels() {
  return [
    { id: "dm-hypertension-risk-v1", diseaseType: "hypertension", version: "1.0.0", population: "registered hypertension or high-risk residents", threshold: "systolic>=140 or riskLevel=high", reviewStatus: "active", reviewer: "chronic-center", outputs: ["follow-up plan", "specialist review"] },
    { id: "dm-diabetes-risk-v1", diseaseType: "diabetes", version: "1.0.0", population: "diabetes or impaired glucose residents", threshold: "glucose>=7.0 or HbA1c>=6.5", reviewStatus: "active", reviewer: "chronic-center", outputs: ["diet intervention", "HbA1c review"] }
  ];
}

function defaultAccessibilityChecklist() {
  return [
    { id: "a11y-large-font", category: "large_font", item: "Large font mode", status: "passed", evidence: "citizen large mode toggle" },
    { id: "a11y-screen-reader", category: "screen_reader", item: "Screen reader semantics", status: "ready", evidence: "aria labels and landmark roles" },
    { id: "a11y-family-proxy", category: "family_proxy", item: "Family proxy handling", status: "passed", evidence: "family members and delegated pickup records" },
    { id: "a11y-offline-help", category: "offline_help", item: "Offline assisted service", status: "ready", evidence: "senior service offline help records" },
    { id: "a11y-weak-network", category: "weak_network", item: "Weak network fallback", status: "ready", evidence: "local state fallback and mobile preview" }
  ];
}

function defaultMobileExperienceSettings() {
  return {
    largeModeDefault: false,
    weakNetworkMode: "cache-last-state",
    screenReaderLandmarks: ["banner", "navigation", "main", "status"],
    offlineHelpChannels: ["community-service-station", "family-proxy", "hotline"],
    messageTouchpoints: ["in_app", "family_proxy"],
    seniorTaskCompletionCriteria: ["font-readable", "one-hand-navigation", "proxy-authorized", "offline-help-available"],
    userPreferences: {}
  };
}

function personIndexFromParts(idCard, phone) {
  return `${String(idCard || "").trim()}#${String(phone || "").trim()}`;
}

function personIndexForResident(residentMap, residentId) {
  const resident = residentMap.get(residentId);
  return resident ? personIndexFromParts(resident.idCard, resident.phone) : "";
}

function ageOf(birthDate) {
  const birth = new Date(birthDate);
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const monthDiff = now.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birth.getDate())) age -= 1;
  return age;
}

function assessRisk(resident) {
  const { systolic, glucose, bmi } = resident.metrics;
  if (systolic >= 160 || glucose >= 7 || bmi >= 30) return "高危";
  if (systolic >= 140 || glucose >= 6.1 || bmi >= 28) return "中危";
  return "低危";
}

function money(value) {
  return Number(value || 0).toLocaleString("zh-CN", { style: "currency", currency: "CNY" });
}

function workflowRows(state, collection) {
  if (collection === "referrals") return state.referralSystem?.referrals || [];
  if (collection === "multiPracticeApplications") return state.multiPracticeApplications || [];
  return Array.isArray(state[collection]) ? state[collection] : [];
}

async function updateWorkflowAction(state, collection, id, updates, note) {
  const payload = {
    collection,
    id,
    status: updates.status,
    updates,
    note
  };
  if (API_BASE) {
    try {
      const request = window.HealthCityAuth?.authFetch || fetch;
      const response = await request(`${API_BASE}/workflow-actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (response.ok) {
        const saved = await response.json();
        const rows = workflowRows(state, collection);
        const index = rows.findIndex((item) => item.id === id);
        if (index >= 0) rows[index] = saved;
        return { ok: true, item: saved };
      }
    } catch (error) {
      // Static preview falls back to local mutation below.
    }
  }
  const rows = workflowRows(state, collection);
  const item = rows.find((row) => row.id === id);
  if (!item) return { ok: false, message: "未找到业务记录" };
  Object.assign(item, updates, { lastUpdated: new Date().toISOString() });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  return { ok: true, item };
}
