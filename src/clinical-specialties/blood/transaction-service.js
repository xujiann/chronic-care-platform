const { createHash, randomUUID } = require("node:crypto");

function seedBloodTestReports() {
  return [{ id: "btr-00182", bloodUnitId: "bu-00182", conclusion: "qualified", status: "signed", signedBy: "lab-reviewer-01", signedAt: "2026-07-11T13:42:00.000Z", dataDigest: "demo-digest-00182" }];
}

function seedBloodReleaseReviews() { return []; }
function seedBloodShipments() { return []; }
function seedCompatibilityTests() { return []; }
function seedTransfusionEpisodes() { return []; }
function seedBloodSafetyIncidents() { return []; }

function normalizeTransactionState(data) {
  data.bloodTestReports = Array.isArray(data.bloodTestReports) ? data.bloodTestReports : seedBloodTestReports();
  data.bloodReleaseReviews = Array.isArray(data.bloodReleaseReviews) ? data.bloodReleaseReviews : seedBloodReleaseReviews();
  data.bloodShipments = Array.isArray(data.bloodShipments) ? data.bloodShipments : seedBloodShipments();
  data.compatibilityTests = Array.isArray(data.compatibilityTests) ? data.compatibilityTests : seedCompatibilityTests();
  data.transfusionEpisodes = Array.isArray(data.transfusionEpisodes) ? data.transfusionEpisodes : seedTransfusionEpisodes();
  data.bloodSafetyIncidents = Array.isArray(data.bloodSafetyIncidents) ? data.bloodSafetyIncidents : seedBloodSafetyIncidents();
  data.bloodIdempotencyRecords = Array.isArray(data.bloodIdempotencyRecords) ? data.bloodIdempotencyRecords : [];
  return data;
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function actorId(user = {}) {
  return String(user.id || user.username || "").trim();
}

function isActiveUser(user = {}) {
  return !["disabled", "inactive", "suspended", "停用", "离岗"].includes(String(user.status || "").trim().toLowerCase());
}

function hasBloodPermission(user = {}, permission) {
  return isActiveUser(user) && Array.isArray(user.bloodPermissions) && user.bloodPermissions.includes(permission);
}

function audit(data, user, type, id, action, detail, snapshot) {
  const event = {
    id: `ba-${randomUUID()}`,
    entityType: type,
    entityId: id,
    action,
    actor: user.name || user.username,
    actorId: actorId(user),
    role: user.role,
    orgCode: user.orgCode || "",
    at: new Date().toISOString(),
    detail,
    dataDigest: digest(snapshot || {})
  };
  data.bloodAuditEvents = [event, ...(data.bloodAuditEvents || [])].slice(0, 1000);
  return event;
}

function idempotent(data, user, key, action, work) {
  normalizeTransactionState(data);
  if (!key) return { status: 400, body: { error: "Idempotency Key Required", message: "关键业务操作必须提供幂等键" } };
  const currentActorId = actorId(user);
  const old = data.bloodIdempotencyRecords.find((item) => item.key === key && item.action === action && item.actorId === currentActorId);
  if (old) return { status: old.status, body: { ...old.body, idempotentReplay: true } };
  const result = work();
  if (result.status < 500) {
    data.bloodIdempotencyRecords = [{
      key,
      action,
      actorId: currentActorId,
      status: result.status,
      body: result.body,
      createdAt: new Date().toISOString()
    }, ...data.bloodIdempotencyRecords].slice(0, 2000);
  }
  return result;
}

function signTestReport(data, user, payload, key) {
  return idempotent(data, user, key, "sign_test_report", () => {
    if (user.role !== "commission") return { status: 403, body: { error: "Forbidden", message: "仅血液中心检验审核岗位可以签发" } };
    const unit = (data.bloodUnits || []).find((item) => item.id === payload.bloodUnitId);
    if (!unit) return { status: 404, body: { error: "Not Found", message: "未找到血液单元" } };
    if (!["testing", "qualified"].includes(unit.status)) return { status: 409, body: { error: "Invalid State", message: "当前状态不能签发检测报告" } };
    const report = {
      id: `btr-${randomUUID()}`,
      bloodUnitId: unit.id,
      conclusion: String(payload.conclusion || ""),
      status: "signed",
      signedBy: actorId(user),
      signedAt: new Date().toISOString(),
      results: payload.results || {},
      dataDigest: digest(payload.results || {})
    };
    if (report.conclusion !== "qualified") unit.status = "quarantined";
    else {
      unit.status = "qualified";
      unit.testReportSigned = true;
    }
    data.bloodTestReports = [report, ...data.bloodTestReports];
    const evidence = audit(data, user, "blood_test_report", report.id, "test_report_signed", report.conclusion, report);
    return { status: 201, body: { report, bloodUnit: unit, evidence } };
  });
}

function reviewRelease(data, user, payload, key) {
  return idempotent(data, user, key, "review_release", () => {
    if (user.role !== "commission") return { status: 403, body: { error: "Forbidden", message: "仅血液中心放行岗位可以复核" } };
    const unit = (data.bloodUnits || []).find((item) => item.id === payload.bloodUnitId);
    if (!unit) return { status: 404, body: { error: "Not Found", message: "未找到血液单元" } };
    if (unit.status !== "qualified" || !unit.testReportSigned) return { status: 409, body: { error: "Release Gate", message: "检测报告未签发或血液未判定合格" } };
    const reviewerId = actorId(user);
    if (data.bloodReleaseReviews.some((item) => item.bloodUnitId === unit.id && item.reviewerId === reviewerId)) {
      return { status: 409, body: { error: "Dual Review Gate", message: "同一人员不能重复完成双人放行复核" } };
    }
    const review = {
      id: `brr-${randomUUID()}`,
      bloodUnitId: unit.id,
      reviewerId,
      reviewerName: user.name,
      decision: String(payload.decision || "approved"),
      signedAt: new Date().toISOString(),
      signatureDigest: digest({ bloodUnitId: unit.id, reviewerId, decision: payload.decision || "approved" })
    };
    data.bloodReleaseReviews = [review, ...data.bloodReleaseReviews];
    const approved = data.bloodReleaseReviews.filter((item) => item.bloodUnitId === unit.id && item.decision === "approved");
    if (approved.length >= 2) {
      unit.status = "released";
      unit.dualReview = true;
      unit.releasedAt = new Date().toISOString();
      unit.inventoryLock = { status: "available", version: Number(unit.inventoryLock?.version || 0) + 1 };
    }
    const evidence = audit(data, user, "blood_unit", unit.id, "release_review_signed", `${approved.length}/2`, review);
    return { status: 200, body: { review, reviewCount: approved.length, released: unit.status === "released", bloodUnit: unit, evidence } };
  });
}

function createShipment(data, user, payload, key) {
  return idempotent(data, user, key, "create_shipment", () => {
    if (user.role !== "commission") return { status: 403, body: { error: "Forbidden", message: "仅血液中心可以创建配送单" } };
    const ids = Array.isArray(payload.bloodUnitIds) ? payload.bloodUnitIds : [];
    const units = (data.bloodUnits || []).filter((item) => ids.includes(item.id));
    if (!ids.length || units.length !== ids.length) return { status: 400, body: { error: "Bad Request", message: "配送血液单元不完整" } };
    if (units.some((item) => item.status !== "released" || item.inventoryLock?.status !== "available")) {
      return { status: 409, body: { error: "Inventory Lock Gate", message: "存在未放行或已锁定血液" } };
    }
    const shipment = {
      id: `bs-${randomUUID()}`,
      bloodUnitIds: ids,
      sourceInstitution: user.orgCode,
      destinationInstitution: String(payload.destinationInstitution),
      status: "in_transit",
      temperatureRange: payload.temperatureRange || "2-6C",
      temperatureReadings: [],
      createdAt: new Date().toISOString(),
      createdBy: actorId(user)
    };
    for (const unit of units) {
      unit.status = "in_transit";
      unit.hospitalCode = shipment.destinationInstitution;
      unit.inventoryLock = { status: "shipment_locked", shipmentId: shipment.id, version: Number(unit.inventoryLock?.version || 0) + 1 };
    }
    data.bloodShipments = [shipment, ...data.bloodShipments];
    const evidence = audit(data, user, "blood_shipment", shipment.id, "shipment_created", `${ids.length} units`, shipment);
    return { status: 201, body: { shipment, evidence } };
  });
}

function buildTemperatureReading(payload = {}) {
  const temperatureCelsius = Number(payload.temperatureCelsius);
  if (!Number.isFinite(temperatureCelsius)) return null;
  return {
    temperatureCelsius,
    deviceId: String(payload.temperatureDeviceId || "").trim(),
    measuredAt: String(payload.measuredAt || new Date().toISOString()),
    source: String(payload.temperatureSource || "handover_scan").trim(),
    recordedAt: new Date().toISOString()
  };
}

function receiveShipment(data, user, payload, key) {
  return idempotent(data, user, key, "receive_shipment", () => {
    if (user.role !== "institution") return { status: 403, body: { error: "Forbidden", message: "仅用血机构可以接收配送" } };
    const shipment = data.bloodShipments.find((item) => item.id === payload.shipmentId);
    if (!shipment) return { status: 404, body: { error: "Not Found", message: "未找到配送单" } };
    if (shipment.destinationInstitution !== user.orgCode) return { status: 403, body: { error: "Forbidden", message: "该配送单不属于本机构" } };
    if (shipment.status !== "in_transit") return { status: 409, body: { error: "Shipment State Gate", message: "配送单已处置，不能再次接收", shipment } };
    const reading = buildTemperatureReading(payload);
    if (!reading) return { status: 400, body: { error: "Temperature Reading Required", message: "交接必须记录可解析的温度读数" } };
    shipment.temperatureReadings = [...(shipment.temperatureReadings || []), reading];
    const units = data.bloodUnits.filter((item) => shipment.bloodUnitIds.includes(item.id));
    if (payload.temperatureOk !== true) {
      const incident = {
        id: `bsi-${randomUUID()}`,
        type: "cold_chain_excursion",
        status: "awaiting_quality_review",
        shipmentId: shipment.id,
        bloodUnitIds: shipment.bloodUnitIds,
        destinationInstitution: shipment.destinationInstitution,
        detectedAt: new Date().toISOString(),
        detectedBy: actorId(user),
        temperatureReading: reading,
        requiredDecision: "discard_or_return_to_center"
      };
      shipment.status = "quarantined";
      shipment.quarantinedAt = incident.detectedAt;
      shipment.quarantinedBy = incident.detectedBy;
      shipment.coldChainIncidentId = incident.id;
      shipment.coldChainException = { status: incident.status, reading, incidentId: incident.id };
      for (const unit of units) {
        unit.status = "quarantined";
        unit.temperatureOk = false;
        unit.inventoryLock = {
          status: "quarantined",
          reason: "cold_chain_excursion",
          incidentId: incident.id,
          version: Number(unit.inventoryLock?.version || 0) + 1
        };
        audit(data, user, "blood_unit", unit.id, "cold_chain_quarantined", incident.id, { unit, incident });
      }
      data.bloodSafetyIncidents = [incident, ...data.bloodSafetyIncidents].slice(0, 1000);
      const evidence = audit(data, user, "blood_shipment", shipment.id, "cold_chain_breach", "temperature excursion; shipment quarantined", { shipment, incident });
      return { status: 409, body: { error: "Cold Chain Gate", message: "冷链温度越限，配送单与血液已隔离，等待质控处置", shipment, bloodUnits: units, incident, evidence } };
    }
    shipment.status = "received";
    shipment.receivedAt = new Date().toISOString();
    shipment.receivedBy = actorId(user);
    for (const unit of units) {
      unit.status = "hospital_received";
      unit.temperatureOk = true;
      unit.inventoryLock = { status: "hospital_available", institutionCode: user.orgCode, version: Number(unit.inventoryLock?.version || 0) + 1 };
    }
    const evidence = audit(data, user, "blood_shipment", shipment.id, "shipment_received", "扫码交付且冷链合格", shipment);
    return { status: 200, body: { shipment, evidence } };
  });
}

function reviewColdChainIncident(data, user, payload, key) {
  return idempotent(data, user, key, "review_cold_chain_incident", () => {
    if (user.role !== "commission" || !hasBloodPermission(user, "cold_chain_quality_review")) {
      return { status: 403, body: { error: "Forbidden", message: "仅具备冷链质控资质的血液中心人员可以处置异常" } };
    }
    const incident = data.bloodSafetyIncidents.find((item) => item.id === payload.incidentId);
    if (!incident) return { status: 404, body: { error: "Not Found", message: "未找到冷链异常事件" } };
    if (incident.status !== "awaiting_quality_review") return { status: 409, body: { error: "Incident State Gate", message: "该冷链异常已处置", incident } };
    const decision = String(payload.decision || "").trim();
    if (!["discard", "return_to_center"].includes(decision)) {
      return { status: 400, body: { error: "Quality Decision Required", message: "冷链异常只能判定为报废或退回血液中心，不可直接恢复库存" } };
    }
    const shipment = data.bloodShipments.find((item) => item.id === incident.shipmentId);
    const units = data.bloodUnits.filter((item) => incident.bloodUnitIds.includes(item.id));
    const reviewedAt = new Date().toISOString();
    incident.status = "resolved";
    incident.decision = decision;
    incident.reviewedAt = reviewedAt;
    incident.reviewedBy = actorId(user);
    incident.qualityNote = String(payload.qualityNote || "").trim();
    if (shipment) {
      shipment.status = decision === "discard" ? "discarded" : "return_authorized";
      shipment.qualityDecision = { decision, reviewedAt, reviewedBy: incident.reviewedBy, incidentId: incident.id };
    }
    for (const unit of units) {
      unit.status = decision === "discard" ? "discarded" : "quarantined";
      unit.inventoryLock = {
        status: decision === "discard" ? "disposed" : "return_locked",
        reason: "cold_chain_excursion",
        incidentId: incident.id,
        version: Number(unit.inventoryLock?.version || 0) + 1
      };
      audit(data, user, "blood_unit", unit.id, "cold_chain_quality_decision", decision, { unit, incident });
    }
    const evidence = audit(data, user, "blood_safety_incident", incident.id, "cold_chain_quality_reviewed", decision, incident);
    return { status: 200, body: { incident, shipment, bloodUnits: units, evidence } };
  });
}

function compatibilityReviewer(user = {}) {
  return user.role === "institution" && hasBloodPermission(user, "compatibility_review") ? {
    id: actorId(user),
    name: user.name || user.username,
    orgCode: user.orgCode
  } : null;
}

function recordCompatibility(data, user, payload, key) {
  return idempotent(data, user, key, "compatibility_test", () => {
    const reviewer = compatibilityReviewer(user);
    if (!reviewer) return { status: 403, body: { error: "Forbidden", message: "需要本机构在岗且具备交叉配血复核资质的登录人员" } };
    if (Array.isArray(payload.reviewerIds) || Array.isArray(payload.reviewers)) {
      return { status: 400, body: { error: "Reviewer Identity Source", message: "复核人身份必须由各自登录会话签名，不能由请求体声明" } };
    }
    if (typeof payload.aboRhMatched !== "boolean" || typeof payload.crossmatchCompatible !== "boolean") {
      return { status: 400, body: { error: "Compatibility Result Required", message: "必须明确记录 ABO/Rh 与交叉配血结果" } };
    }
    const request = data.transfusionRequests.find((item) => item.id === payload.requestId && item.institutionCode === user.orgCode);
    const unit = data.bloodUnits.find((item) => item.id === payload.bloodUnitId && item.hospitalCode === user.orgCode);
    if (!request || !unit) return { status: 404, body: { error: "Not Found", message: "未找到本机构申请或血液" } };
    if (unit.status !== "hospital_received") return { status: 409, body: { error: "Invalid State", message: "血液尚未完成医院接收或已被安全处置" } };
    let test = data.compatibilityTests.find((item) => item.requestId === request.id && item.bloodUnitId === unit.id);
    if (test && (test.aboRhMatched !== payload.aboRhMatched || test.crossmatchCompatible !== payload.crossmatchCompatible)) {
      return { status: 409, body: { error: "Compatibility Result Conflict", message: "第二复核人与首位复核人的检验结果不一致，必须启动异常调查", test } };
    }
    if (!test) {
      test = {
        id: `bct-${randomUUID()}`,
        requestId: request.id,
        bloodUnitId: unit.id,
        aboRhMatched: payload.aboRhMatched,
        crossmatchCompatible: payload.crossmatchCompatible,
        status: "pending_second_review",
        reviewers: [],
        createdAt: new Date().toISOString()
      };
      data.compatibilityTests = [test, ...data.compatibilityTests];
    }
    if (test.reviewers.some((item) => item.id === reviewer.id)) {
      return { status: 409, body: { error: "Dual Review Gate", message: "同一登录人员不能重复签署交叉配血复核" } };
    }
    const signedAt = new Date().toISOString();
    const signedReview = {
      ...reviewer,
      signedAt,
      signatureDigest: digest({ testId: test.id, reviewerId: reviewer.id, aboRhMatched: test.aboRhMatched, crossmatchCompatible: test.crossmatchCompatible, signedAt })
    };
    test.reviewers = [...test.reviewers, signedReview];
    test.reviewerIds = test.reviewers.map((item) => item.id);
    test.lastReviewedAt = signedAt;
    const reviewEvidence = audit(data, user, "compatibility_test", test.id, "compatibility_review_signed", `${test.reviewers.length}/2`, signedReview);
    if (test.reviewers.length < 2) {
      return { status: 202, body: { test, reviewCount: test.reviewers.length, issued: false, evidence: reviewEvidence } };
    }
    test.reviewedAt = new Date().toISOString();
    if (!test.aboRhMatched || !test.crossmatchCompatible) {
      test.status = "incompatible";
      unit.status = "quarantined";
      unit.inventoryLock = { status: "compatibility_hold", testId: test.id, version: Number(unit.inventoryLock?.version || 0) + 1 };
      request.status = "compatibility_hold";
      const evidence = audit(data, user, "compatibility_test", test.id, "compatibility_rejected", "two authenticated reviewers confirmed incompatible result", test);
      return { status: 409, body: { error: "Compatibility Gate", message: "血型或交叉配血不相合，血液已隔离，申请已冻结", test, bloodUnit: unit, request, evidence } };
    }
    test.status = "approved";
    unit.status = "issued";
    unit.inventoryLock = { status: "issued", requestId: request.id, testId: test.id, version: Number(unit.inventoryLock?.version || 0) + 1 };
    request.status = "issued";
    const evidence = audit(data, user, "compatibility_test", test.id, "compatibility_approved", "two authenticated reviewers approved", test);
    return { status: 201, body: { test, reviewCount: test.reviewers.length, issued: true, bloodUnit: unit, request, evidence } };
  });
}

function startTransfusion(data, user, payload, key) {
  return idempotent(data, user, key, "start_transfusion", () => {
    if (user.role !== "institution") return { status: 403, body: { error: "Forbidden", message: "仅用血机构可以开始输注" } };
    const request = data.transfusionRequests.find((item) => item.id === payload.requestId && item.institutionCode === user.orgCode);
    const unit = data.bloodUnits.find((item) => item.id === payload.bloodUnitId && item.hospitalCode === user.orgCode);
    if (!request || !unit || unit.status !== "issued") return { status: 409, body: { error: "Transfusion Gate", message: "申请或血液不满足输注条件" } };
    if (!payload.patientMatched || !payload.orderMatched || !payload.bloodUnitMatched) return { status: 409, body: { error: "Bedside Identity Gate", message: "患者、医嘱和血袋床旁核对不一致" } };
    const episode = {
      id: `bte-${randomUUID()}`,
      requestId: request.id,
      bloodUnitId: unit.id,
      institutionCode: user.orgCode,
      patientId: request.patientId,
      status: "transfusing",
      startedAt: new Date().toISOString(),
      operatorId: actorId(user),
      bedsideEvidence: { patientMatched: true, orderMatched: true, bloodUnitMatched: true, scannerId: String(payload.scannerId || "") },
      vitalSigns: Array.isArray(payload.vitalSigns) ? payload.vitalSigns : []
    };
    data.transfusionEpisodes = [episode, ...data.transfusionEpisodes];
    unit.status = "transfusing";
    request.status = "transfusing";
    const evidence = audit(data, user, "transfusion_episode", episode.id, "transfusion_started", "bedside identity verification passed", episode);
    return { status: 201, body: { episode, evidence } };
  });
}

function completeTransfusion(data, user, payload, key) {
  return idempotent(data, user, key, "complete_transfusion", () => {
    if (user.role !== "institution") return { status: 403, body: { error: "Forbidden", message: "仅用血机构可以完成输注评价" } };
    const episode = data.transfusionEpisodes.find((item) => item.id === payload.episodeId && item.institutionCode === user.orgCode);
    if (!episode || episode.status !== "transfusing") return { status: 409, body: { error: "Invalid State", message: "未找到进行中的输注记录" } };
    if (!payload.outcome || !payload.evaluation) return { status: 400, body: { error: "Bad Request", message: "必须记录输注结局和疗效评价" } };
    episode.status = "evaluated";
    episode.completedAt = new Date().toISOString();
    episode.outcome = String(payload.outcome);
    episode.evaluation = String(payload.evaluation);
    episode.vitalSigns = [...episode.vitalSigns, ...(Array.isArray(payload.vitalSigns) ? payload.vitalSigns : [])];
    const unit = data.bloodUnits.find((item) => item.id === episode.bloodUnitId);
    const request = data.transfusionRequests.find((item) => item.id === episode.requestId);
    if (unit) unit.status = "evaluated";
    if (request) request.status = "evaluated";
    const evidence = audit(data, user, "transfusion_episode", episode.id, "transfusion_evaluated", episode.evaluation, episode);
    return { status: 200, body: { episode, evidence } };
  });
}

module.exports = {
  seedBloodTestReports,
  seedBloodReleaseReviews,
  seedBloodShipments,
  seedCompatibilityTests,
  seedTransfusionEpisodes,
  seedBloodSafetyIncidents,
  normalizeTransactionState,
  signTestReport,
  reviewRelease,
  createShipment,
  receiveShipment,
  reviewColdChainIncident,
  recordCompatibility,
  startTransfusion,
  completeTransfusion
};
