const API_BASE = location.protocol === "file:" ? "" : "/api";
const STORAGE_KEY = "chronic-care-platform-state";

async function loadPlatformState(fallback) {
  if (API_BASE) {
    try {
      const response = await fetch(`${API_BASE}/state`);
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
  const residents = Array.isArray(state.residents) ? state.residents : [];
  residents.forEach((resident) => {
    resident.personIndex = personIndexFromParts(resident.idCard, resident.phone);
    resident.identityIndex = resident.personIndex;
  });
  const residentMap = new Map(residents.map((resident) => [resident.id, resident]));
  ["diseases", "followups", "personalRecords", "careOrders", "medicationPickups", "insuranceClaims"].forEach((key) => {
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
