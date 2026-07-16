const { createHash, randomUUID } = require("node:crypto");

const STATE_FLOW = [
  "accepted", "dispatched", "departed", "arrived-scene", "patient-contact",
  "transporting", "hospital-confirmed", "arrived-hospital", "handover-completed", "closed"
];

const ROLE_ACTIONS = {
  citizen: new Set(["create-call"]),
  commission: new Set(["dispatch", "close"]),
  institution: new Set(["vehicle-update", "clinical-update", "hospital-confirm", "handover"])
};

const SOS_SIGNALS = new Set(["collapse", "chest-pain", "breathing-difficulty", "stroke-suspected", "manual-sos"]);

function now() {
  return new Date().toISOString();
}

function seed() {
  const createdAt = "2026-07-15T07:20:00.000Z";
  return {
    emergencyResources: [
      { id: "amb-120-01", callSign: "急救01", station: "中山急救站", status: "transporting", crew: ["急救医师 张医生", "护士 李护士", "驾驶员 王师傅"], latitude: 38.918, longitude: 121.642, deviceStatus: "online" },
      { id: "amb-120-02", callSign: "急救02", station: "西岗急救站", status: "available", crew: ["急救医师 赵医生", "护士 周护士", "驾驶员 刘师傅"], latitude: 38.914, longitude: 121.601, deviceStatus: "online" }
    ],
    emergencyHospitals: [
      { id: "hosp-central", name: "大连市中心医院", orgCode: "MR1", emergencyStatus: "available", traumaCenter: true, strokeCenter: true, chestPainCenter: true, etaMinutes: 8 },
      { id: "hosp-friendship", name: "大连市友谊医院", orgCode: "MR2", emergencyStatus: "available", traumaCenter: true, strokeCenter: false, chestPainCenter: true, etaMinutes: 12 }
    ],
    emergencyAedSites: [
      { id:"aed-zs-001", name:"People's Square AED", address:"Dalian Zhongshan District People's Road demonstration point", latitude:38.9202, longitude:121.6496, status:"available", access:"24x7", custodian:"Emergency public facility" },
      { id:"aed-zs-002", name:"Metro interchange AED", address:"Dalian Zhongshan District metro interchange", latitude:38.9186, longitude:121.6468, status:"available", access:"station operating hours", custodian:"Metro operations" },
      { id:"aed-zs-003", name:"Hospital entrance AED", address:"Dalian Central Hospital emergency entrance", latitude:38.9169, longitude:121.6424, status:"maintenance", access:"emergency entrance", custodian:"Hospital security" },
      { id:"aed-zs-004", name:"Waterfront mall AED", address:"Dalian Zhongshan District waterfront mall service desk", latitude:38.9228, longitude:121.6531, status:"available", access:"mall operating hours", custodian:"Mall service desk" }
    ],
    emergencyEvents: [{
      id: "emg-demo-001", eventNo: "120-20260715-0001", source: "120-phone", callerName: "居民家属", callerPhoneMasked: "138****8000",
      location: { address: "大连市中山区人民路示范点", latitude: 38.92, longitude: 121.65, confidence: 0.96 },
      chiefComplaint: "突发胸痛伴大汗约20分钟", triageLevel: "P1", patientCount: 1, status: "hospital-confirmed", createdAt, updatedAt: createdAt,
      mission: { id: "mission-demo-001", ambulanceId: "amb-120-01", dispatchedAt: "2026-07-15T07:22:00.000Z", departedAt: "2026-07-15T07:23:00.000Z", arrivedSceneAt: "2026-07-15T07:30:00.000Z", patientContactAt: "2026-07-15T07:31:00.000Z", transportStartedAt: "2026-07-15T07:42:00.000Z", hospitalConfirmedAt: "2026-07-15T07:45:00.000Z", hospitalId: "hosp-central", etaMinutes: 8 },
      patient: { temporaryId: "tmp-120-0001", residentId: "", name: "待核实患者", gender: "男", age: 58, identityStatus: "temporary" },
      clinical: { preliminaryDiagnosis: "急性冠脉综合征待查", gcs: 15, vitals: [{ measuredAt: "2026-07-15T07:40:00.000Z", systolic: 168, diastolic: 102, heartRate: 108, respiratoryRate: 24, spo2: 94, source: "monitor" }], treatments: ["吸氧", "建立静脉通路", "十二导联心电图"] },
      hospitalResponse: { hospitalId: "hosp-central", status: "accepted", channel: "emergency-platform", greenChannel: "chest-pain", respondedAt: "2026-07-15T07:45:00.000Z", note: "导管室预警，急诊抢救室准备" },
      timeline: [
        { status: "accepted", at: createdAt, actor: "120坐席", note: "完成电话受理" },
        { status: "dispatched", at: "2026-07-15T07:22:00.000Z", actor: "120调度", note: "派出急救01" },
        { status: "departed", at: "2026-07-15T07:23:00.000Z", actor: "急救01", note: "车辆出发" },
        { status: "arrived-scene", at: "2026-07-15T07:30:00.000Z", actor: "急救01", note: "到达现场" },
        { status: "patient-contact", at: "2026-07-15T07:31:00.000Z", actor: "张医生", note: "接触患者" },
        { status: "transporting", at: "2026-07-15T07:42:00.000Z", actor: "急救01", note: "开始转运" },
        { status: "hospital-confirmed", at: "2026-07-15T07:45:00.000Z", actor: "大连市中心医院", note: "接收并启动胸痛绿色通道" }
      ]
    }],
    emergencyAuditEvents: []
  };
}

function ensureState(data) {
  const defaults = seed();
  for (const [key, value] of Object.entries(defaults)) {
    if (!Array.isArray(data[key])) data[key] = value;
  }
  return data;
}

function safeText(value, max = 300) {
  return String(value || "").trim().slice(0, max);
}

function appendAudit(data, user, action, target, detail) {
  data.emergencyAuditEvents.unshift({ id: randomUUID(), at: now(), actor: user.name || user.username || user.id, role: user.role, action, target, detail: safeText(detail, 500) });
  data.emergencyAuditEvents = data.emergencyAuditEvents.slice(0, 1000);
}

function buildDashboard(input, user = {}) {
  const data = ensureState(input);
  const events = data.emergencyEvents.filter((item) => user.role !== "citizen" || item.residentId === user.residentId);
  return {
    ok: true,
    generatedAt: now(),
    standards: ["WS/T 451-2014", "WS 542-2017", "WS/T 621-2018", "WS/T 815-2023", "WS/T 790.1-2021"],
    summary: {
      total: events.length,
      active: events.filter((item) => !["closed", "handover-completed"].includes(item.status)).length,
      p1: events.filter((item) => item.triageLevel === "P1").length,
      availableAmbulances: data.emergencyResources.filter((item) => item.status === "available").length,
      hospitalsAvailable: data.emergencyHospitals.filter((item) => item.emergencyStatus === "available").length,
      pendingHandover: events.filter((item) => ["hospital-confirmed", "arrived-hospital"].includes(item.status)).length
    },
    events,
    resources: data.emergencyResources,
    hospitals: data.emergencyHospitals,
    audit: user.role === "commission" ? data.emergencyAuditEvents.slice(0, 50) : []
  };
}

function distanceMeters(latitudeA, longitudeA, latitudeB, longitudeB) {
  const toRadians = (value) => Number(value) * Math.PI / 180;
  const earthRadius = 6371000;
  const dLat = toRadians(latitudeB - latitudeA);
  const dLon = toRadians(longitudeB - longitudeA);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(latitudeA)) * Math.cos(toRadians(latitudeB)) * Math.sin(dLon / 2) ** 2;
  return Math.round(earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function buildAedMap(input, user = {}, options = {}) {
  const data = ensureState(input);
  if (!["commission", "institution", "citizen"].includes(user.role)) throw Object.assign(new Error("Current role cannot access AED map"), { status: 403 });
  const latitude = Number(options.latitude);
  const longitude = Number(options.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) throw Object.assign(new Error("AED map requires a valid latitude and longitude"), { status: 400 });
  const limit = Math.max(1, Math.min(10, Number(options.limit) || 5));
  const sites = data.emergencyAedSites.map((site) => ({
    ...site,
    distanceMeters: distanceMeters(latitude, longitude, site.latitude, site.longitude),
    availableForUse: site.status === "available",
    guidance: site.status === "available" ? "Send a bystander to retrieve the AED while continuing CPR and following dispatcher instructions." : "Do not rely on this device; choose the next available AED."
  })).sort((left, right) => left.distanceMeters - right.distanceMeters).slice(0, limit);
  return { ok:true, generatedAt:now(), origin:{ latitude, longitude }, sites, nearestAvailable:sites.find((site) => site.availableForUse) || null, safetyNote:"AED locations are operational references. Confirm device availability on site and follow 120 dispatcher instructions." };
}

function makeEvidenceSection(id, title, present, records = [], required = true) {
  return {
    id,
    title,
    required,
    present: Boolean(present),
    status: present ? "complete" : (required ? "missing" : "pending"),
    records: records.filter((item) => item.value !== undefined && item.value !== null && item.value !== "")
  };
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function evidenceExportMarkdown(document) {
  const evidence = document.evidencePackage;
  const sections = evidence.sections.map((section) => `| ${section.id} | ${section.status} | ${section.records.length} |`).join("\n");
  const timeline = evidence.timeline.map((item) => `| ${item.at || ""} | ${item.status || ""} | ${item.actor || ""} | ${item.note || ""} |`).join("\n");
  return [
    "# Prehospital emergency evidence package",
    "",
    `- Package: ${evidence.packageId}`,
    `- Event: ${evidence.eventNo} (${evidence.eventId})`,
    `- Exported at: ${document.exportedAt}`,
    `- Completeness: ${evidence.completeness.complete}/${evidence.completeness.total}; ready=${evidence.completeness.ready}`,
    `- Missing: ${evidence.completeness.missing.join(", ") || "none"}`,
    `- Integrity: ${document.integrity.algorithm} ${document.integrity.digest}`,
    `- Canonicalization: ${document.integrity.canonicalization}`,
    `- Redaction profile: ${document.integrity.redactionProfile}`,
    "",
    "## Evidence sections",
    "",
    "| Section | Status | Records |",
    "|---|---|---:|",
    sections || "| none | pending | 0 |",
    "",
    "## Timeline",
    "",
    "| At | Status | Actor | Note |",
    "|---|---|---|---|",
    timeline || "| none | | | |",
    "",
    "## Release boundary",
    "",
    evidence.releaseBoundary
  ].join("\n");
}

function buildEvidenceExport(evidencePackage, format = "json") {
  const normalizedFormat = String(format || "json").toLowerCase();
  if (!evidencePackage?.ok) throw Object.assign(new Error("A valid emergency evidence package is required"), { status: 400 });
  if (!new Set(["json", "markdown", "md"]).has(normalizedFormat)) {
    throw Object.assign(new Error("Evidence export format must be json or markdown"), { status: 400 });
  }
  const exportedAt = now();
  const canonicalPayload = {
    formatVersion: "emergency-evidence-export-v1",
    exportedAt,
    evidencePackage
  };
  const integrity = {
    algorithm: "SHA-256",
    digest: `sha256:${createHash("sha256").update(stableJson(canonicalPayload)).digest("hex")}`,
    canonicalization: "stable-json-v1",
    redactionProfile: "response-role-scope-v1",
    verification: "Recalculate SHA-256 over the stable-json-v1 canonical payload without the integrity object."
  };
  const document = { ...canonicalPayload, integrity };
  const safeEventNo = String(evidencePackage.eventNo || evidencePackage.eventId || "emergency-event").replace(/[^a-zA-Z0-9_-]+/g, "-");
  const markdown = normalizedFormat === "markdown" || normalizedFormat === "md";
  return {
    format: markdown ? "markdown" : "json",
    contentType: markdown ? "text/markdown; charset=utf-8" : "application/json; charset=utf-8",
    filename: `${safeEventNo}-evidence-package.${markdown ? "md" : "json"}`,
    body: markdown ? evidenceExportMarkdown(document) : `${JSON.stringify(document, null, 2)}\n`,
    integrity
  };
}

function buildEvidencePackage(input, user = {}, eventId) {
  const data = ensureState(input);
  const event = data.emergencyEvents.find((item) => item.id === eventId);
  if (!event) throw Object.assign(new Error("Emergency event not found"), { status: 404 });
  if (user.role === "citizen" && (!event.residentId || event.residentId !== user.residentId)) {
    throw Object.assign(new Error("Current citizen cannot access this emergency evidence package"), { status: 403 });
  }
  if (!["commission", "institution", "citizen"].includes(user.role)) {
    throw Object.assign(new Error("Current role cannot access emergency evidence packages"), { status: 403 });
  }
  const timeline = Array.isArray(event.timeline) ? event.timeline : [];
  const audit = data.emergencyAuditEvents.filter((item) => item.target === event.id).slice(0, 100);
  const trackStatuses = new Set(timeline.map((item) => item.status));
  const hasVehicleTrack = Boolean(event.mission) && ["dispatched", "departed", "arrived-scene", "patient-contact", "transporting", "arrived-hospital"].some((status) => trackStatuses.has(status) || event.mission?.[{
    dispatched: "dispatchedAt",
    departed: "departedAt",
    "arrived-scene": "arrivedSceneAt",
    "patient-contact": "patientContactAt",
    transporting: "transportStartedAt",
    "arrived-hospital": "arrivedHospitalAt"
  }[status]]);
  const sections = [
    makeEvidenceSection("call", "Call acceptance", event.source && event.location?.address && event.chiefComplaint, [
      { label:"eventNo", value:event.eventNo },
      { label:"source", value:event.source },
      { label:"caller", value:event.callerName },
      { label:"location", value:event.location?.address },
      { label:"chiefComplaint", value:event.chiefComplaint },
      { label:"createdAt", value:event.createdAt }
    ]),
    makeEvidenceSection("dispatch", "Dispatch mission", event.mission?.id && event.mission?.ambulanceId && event.mission?.dispatchedAt, [
      { label:"missionId", value:event.mission?.id },
      { label:"ambulanceId", value:event.mission?.ambulanceId },
      { label:"dispatchedAt", value:event.mission?.dispatchedAt },
      { label:"etaMinutes", value:event.mission?.etaMinutes }
    ]),
    makeEvidenceSection("vehicle-track", "Vehicle track", hasVehicleTrack, [
      { label:"departedAt", value:event.mission?.departedAt },
      { label:"arrivedSceneAt", value:event.mission?.arrivedSceneAt },
      { label:"patientContactAt", value:event.mission?.patientContactAt },
      { label:"transportStartedAt", value:event.mission?.transportStartedAt },
      { label:"arrivedHospitalAt", value:event.mission?.arrivedHospitalAt }
    ]),
    makeEvidenceSection("clinical-record", "Prehospital clinical record", event.clinical?.preliminaryDiagnosis || event.clinical?.vitals?.length || event.clinical?.treatments?.length, [
      { label:"preliminaryDiagnosis", value:event.clinical?.preliminaryDiagnosis },
      { label:"vitalCount", value:event.clinical?.vitals?.length },
      { label:"treatments", value:event.clinical?.treatments?.join(", ") }
    ]),
    makeEvidenceSection("hospital-receiving", "Hospital receiving", event.hospitalResponse?.status === "accepted" && event.hospitalResponse?.hospitalId, [
      { label:"hospitalId", value:event.hospitalResponse?.hospitalId },
      { label:"greenChannel", value:event.hospitalResponse?.greenChannel },
      { label:"respondedAt", value:event.hospitalResponse?.respondedAt },
      { label:"note", value:event.hospitalResponse?.note }
    ]),
    makeEvidenceSection("handover", "Electronic handover", event.handover?.hospitalVisitId && event.handover?.hospitalSigner, [
      { label:"standard", value:event.handover?.standard },
      { label:"hospitalVisitId", value:event.handover?.hospitalVisitId },
      { label:"prehospitalSigner", value:event.handover?.prehospitalSigner },
      { label:"hospitalSigner", value:event.handover?.hospitalSigner },
      { label:"at", value:event.handover?.at }
    ]),
    makeEvidenceSection("audit", "Operation audit", timeline.length > 0 && audit.length > 0, [
      { label:"timelineSteps", value:timeline.length },
      { label:"auditEvents", value:audit.length },
      { label:"latestAudit", value:audit[0]?.action }
    ])
  ];
  const required = sections.filter((item) => item.required);
  const missing = required.filter((item) => !item.present).map((item) => item.id);
  return {
    ok: true,
    packageId: `emg-evidence-${event.id}`,
    eventId: event.id,
    eventNo: event.eventNo,
    generatedAt: now(),
    generatedBy: user.name || user.username || user.id || "anonymous",
    standards: ["WS/T 451-2014", "WS 542-2017", "WS/T 621-2018", "WS/T 815-2023", "WS/T 790.1-2021"],
    completeness: {
      total: required.length,
      complete: required.length - missing.length,
      missing,
      ready: missing.length === 0
    },
    sections,
    timeline,
    audit,
    releaseBoundary: "operational-evidence-package; formal production go-live still requires signed site evidence"
  };
}

function createCall(data, user, payload = {}) {
  ensureState(data);
  const address = safeText(payload.address, 200);
  const chiefComplaint = safeText(payload.chiefComplaint, 500);
  if (!address || !chiefComplaint) throw new Error("呼救地址和主要症状不能为空");
  const createdAt = now();
  const event = {
    id: randomUUID(), eventNo: `120-${createdAt.slice(0, 10).replaceAll("-", "")}-${String(data.emergencyEvents.length + 1).padStart(4, "0")}`,
    source: ["silent-text", "device-sos"].includes(payload.source) ? payload.source : "citizen-assist", callerName: safeText(payload.callerName || user.name, 80),
    callerPhoneMasked: safeText(payload.callerPhoneMasked || "已认证居民", 40), location: { address, latitude: Number(payload.latitude) || null, longitude: Number(payload.longitude) || null, confidence: Number(payload.confidence) || 0 },
    chiefComplaint, triageLevel: ["P1", "P2", "P3", "P4"].includes(payload.triageLevel) ? payload.triageLevel : "pending-dispatch-triage", patientCount: Math.max(1, Math.min(99, Number(payload.patientCount) || 1)),
    status: "accepted", residentId: user.residentId || "", createdAt, updatedAt: createdAt, mission: null,
    patient: { temporaryId: `tmp-${randomUUID()}`, residentId: user.residentId || "", name: safeText(payload.patientName || "待核实患者", 80), identityStatus: user.residentId ? "resident-linked" : "temporary" },
    clinical: { preliminaryDiagnosis: "", gcs: null, vitals: [], treatments: [] }, hospitalResponse: null,
    timeline: [{ status: "accepted", at: createdAt, actor: user.name || "居民辅助呼救", note: "互联网辅助信息已进入120受理队列，须由120人工确认调度" }]
  };
  data.emergencyEvents.unshift(event);
  appendAudit(data, user, "create-assisted-call", event.id, `${address}; ${chiefComplaint}`);
  return event;
}

function createSosCall(data, user, payload = {}) {
  if (user.role !== "citizen") throw Object.assign(new Error("Only citizens can trigger a personal SOS call"), { status: 403 });
  if (![true, "true", "confirmed", "CONFIRM"].includes(payload.confirmed)) throw Object.assign(new Error("SOS submission requires explicit confirmation"), { status: 400 });
  const signal = SOS_SIGNALS.has(String(payload.detectedSignal || "")) ? String(payload.detectedSignal) : "manual-sos";
  const event = createCall(data, user, {
    ...payload,
    source:"device-sos",
    triageLevel:"P1",
    chiefComplaint:safeText(payload.chiefComplaint || `SOS signal: ${signal}`, 500)
  });
  event.sos = { status:"submitted-to-120-queue", detectedSignal:signal, detectedAt:safeText(payload.detectedAt || event.createdAt, 40), confirmationAt:now(), autoDialUri:"tel:120", deviceRef:safeText(payload.deviceRef, 120) };
  event.timeline[0].note = "Confirmed SOS signal submitted to the 120 acceptance queue; mobile device should open tel:120 for the official call.";
  appendAudit(data, user, "create-confirmed-sos", event.id, `${signal}; ${event.location.address}`);
  return event;
}

function nextStatus(current, requested) {
  const currentIndex = STATE_FLOW.indexOf(current);
  const requestedIndex = STATE_FLOW.indexOf(requested);
  if (requestedIndex < 0 || requestedIndex !== currentIndex + 1) throw new Error(`状态必须按顺序推进：${current} -> ${STATE_FLOW[currentIndex + 1] || "结束"}`);
  return requested;
}

function applyAction(data, user, eventId, payload = {}) {
  ensureState(data);
  const event = data.emergencyEvents.find((item) => item.id === eventId);
  if (!event) throw Object.assign(new Error("未找到急救事件"), { status: 404 });
  const action = safeText(payload.action, 40);
  if (!ROLE_ACTIONS[user.role]?.has(action)) throw Object.assign(new Error("当前角色不能执行该操作"), { status: 403 });
  const at = now();
  let status = event.status;
  if (action === "dispatch") {
    if (event.status !== "accepted") throw new Error("仅已受理事件可以派车");
    const ambulance = data.emergencyResources.find((item) => item.id === payload.ambulanceId && item.status === "available");
    if (!ambulance) throw new Error("请选择可用救护车");
    event.mission = { id: randomUUID(), ambulanceId: ambulance.id, dispatchedAt: at, etaMinutes: Number(payload.etaMinutes) || 10 };
    ambulance.status = "dispatched";
    status = "dispatched";
  } else if (action === "vehicle-update") {
    status = nextStatus(event.status, safeText(payload.status, 40));
    const fieldByStatus = { departed: "departedAt", "arrived-scene": "arrivedSceneAt", "patient-contact": "patientContactAt", transporting: "transportStartedAt", "arrived-hospital": "arrivedHospitalAt" };
    if (fieldByStatus[status]) event.mission[fieldByStatus[status]] = at;
  } else if (action === "clinical-update") {
    if (!event.mission) throw new Error("事件尚未派车");
    const vital = { measuredAt: at, systolic: Number(payload.systolic) || null, diastolic: Number(payload.diastolic) || null, heartRate: Number(payload.heartRate) || null, respiratoryRate: Number(payload.respiratoryRate) || null, spo2: Number(payload.spo2) || null, source: safeText(payload.source || "manual", 30) };
    event.clinical.vitals.push(vital);
    event.clinical.preliminaryDiagnosis = safeText(payload.preliminaryDiagnosis || event.clinical.preliminaryDiagnosis, 200);
    if (payload.treatment) event.clinical.treatments.push(safeText(payload.treatment, 200));
    event.timeline.push({ status: event.status, at, actor: user.name, note: "更新院前病历和生命体征" });
    appendAudit(data, user, action, event.id, "clinical record updated");
    event.updatedAt = at;
    return event;
  } else if (action === "hospital-confirm") {
    if (event.status !== "transporting") throw new Error("仅转运中事件可以确认接收医院");
    const hospital = data.emergencyHospitals.find((item) => item.id === payload.hospitalId);
    if (!hospital) throw new Error("未找到接诊医院");
    event.hospitalResponse = { hospitalId: hospital.id, status: "accepted", channel: "emergency-platform", greenChannel: safeText(payload.greenChannel || "general-emergency", 60), respondedAt: at, note: safeText(payload.note, 300) };
    event.mission.hospitalId = hospital.id;
    event.mission.hospitalConfirmedAt = at;
    status = "hospital-confirmed";
  } else if (action === "handover") {
    if (event.status !== "arrived-hospital") throw new Error("仅已到院事件可以完成交接");
    event.handover = { id: randomUUID(), at, hospitalVisitId: safeText(payload.hospitalVisitId, 80), prehospitalSigner: safeText(payload.prehospitalSigner || user.name, 80), hospitalSigner: safeText(payload.hospitalSigner, 80), note: safeText(payload.note, 300), standard: "WS/T 621-2018" };
    if (!event.handover.hospitalVisitId || !event.handover.hospitalSigner) throw new Error("院内就诊号和院方交接人不能为空");
    status = "handover-completed";
    const ambulance = data.emergencyResources.find((item) => item.id === event.mission?.ambulanceId);
    if (ambulance) ambulance.status = "available";
  } else if (action === "close") {
    if (event.status !== "handover-completed") throw new Error("完成交接后方可关闭质控");
    status = "closed";
  }
  event.status = status;
  event.updatedAt = at;
  event.timeline.push({ status, at, actor: user.name || user.username, note: safeText(payload.note || action, 300) });
  appendAudit(data, user, action, event.id, `${action} -> ${status}`);
  return event;
}

module.exports = { STATE_FLOW, applyAction, buildAedMap, buildDashboard, buildEvidencePackage, buildEvidenceExport, createCall, createSosCall, ensureState, seed, stableJson };
