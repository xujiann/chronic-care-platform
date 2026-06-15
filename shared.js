const API_BASE = location.protocol === "file:" ? "" : "/api";
const STORAGE_KEY = "chronic-care-platform-state";

async function loadPlatformState(fallback) {
  if (API_BASE) {
    try {
      const response = await fetch(`${API_BASE}/state`);
      if (response.ok) return await response.json();
    } catch (error) {
      // Static fallback below.
    }
  }
  try {
    const response = await fetch("./data/db.json");
    if (response.ok) return await response.json();
  } catch (error) {
    // Browser storage fallback below.
  }
  const saved = localStorage.getItem(STORAGE_KEY);
  return saved ? JSON.parse(saved) : fallback;
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
