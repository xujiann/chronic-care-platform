const API_BASE = location.protocol === "file:" ? "" : "/api";
const STORAGE_KEY = "chronic-care-platform-state";

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
  ["diseases", "followups", "personalRecords", "careOrders", "medicationPickups", "insuranceClaims", "seniorServices", "dataAccessLogs", "digitalCredentials", "deathCertificates", "birthCertificates", "multiPracticeApplications", "chronicScreeningTasks", "chronicEducationPushes", "chronicManagementPlans", "countyCollaborationOrders", "countyAiDiagnosisCases", "countyMutualRecognitionRecords", "referralTeleconsultations", "internetNursingOrders"].forEach((key) => {
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
