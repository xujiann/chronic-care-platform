const { createHash, randomUUID } = require("node:crypto");

const SYNTHETIC_CONFIRMATION = "CONFIRM SYNTHETIC IMAGING CHECK";
const SUBMIT_CONFIRMATION = "SUBMIT IMAGING SITE EVIDENCE";
const VERIFY_CONFIRMATION = "VERIFY IMAGING SITE EVIDENCE";
const CUTOVER_CONFIRMATION = "CONFIRM IMAGING PRODUCTION CUTOVER";
const EVIDENCE_DIGEST = /^sha256:[a-f0-9]{64}$/;

const ROUTE_CONTRACTS = Object.freeze([
  { method: "GET", path: "/api/imaging-cloud/production-center", roles: ["commission", "institution"], handler: "ImagingCloudProduction.center" },
  { method: "POST", path: "/api/imaging-cloud/production/endpoints/:id/probe", roles: ["commission", "institution"], handler: "ImagingCloudProduction.probeEndpoint" },
  { method: "POST", path: "/api/imaging-cloud/production/synthetic-checks/:id/actions", roles: ["commission", "institution"], handler: "ImagingCloudProduction.recordSyntheticCheck" },
  { method: "POST", path: "/api/imaging-cloud/production/requirements/:id/actions", roles: ["commission", "institution"], handler: "ImagingCloudProduction.signRequirement" },
  { method: "POST", path: "/api/imaging-cloud/production/drills/:id/complete", roles: ["commission", "institution"], handler: "ImagingCloudProduction.completeDrill" },
  { method: "POST", path: "/api/imaging-cloud/production/approvals/:id/sign", roles: ["commission"], handler: "ImagingCloudProduction.signApproval" }
]);

function now() {
  return new Date().toISOString();
}

function seed() {
  return {
    imagingProductionEndpoints: [
      ["imaging-fhir", "HAPI FHIR临床资源服务", "平台互联互通组", "FHIR R4 Patient/ImagingStudy/DiagnosticReport"],
      ["imaging-orthanc", "Orthanc DICOM/DICOMweb归档", "影像平台运维", "DICOM TLS + DICOMweb"],
      ["imaging-ohif", "OHIF授权调阅服务", "影像产品与安全组", "HTTPS viewer + access audit"],
      ["imaging-pacs-ris", "试点医院PACS/RIS网关", "试点医院信息科", "C-STORE/C-MOVE + report callback"],
      ["imaging-mpi-audit", "区域主索引与审计服务", "市卫生健康信息中心", "MPI/org/provider/access-audit"]
    ].map(([id, name, owner, contract]) => ({
      id,
      name,
      owner,
      contract,
      status: "configuration-required",
      probePassed: false,
      evidenceRef: "",
      lastProbeAt: "",
      environment: ""
    })),
    imagingSyntheticChecks: [
      ["imaging-syn-services", "HAPI FHIR、Orthanc、OHIF三项服务健康"],
      ["imaging-syn-fhir-patient", "合成FHIR Patient写入与回读"],
      ["imaging-syn-dicom-ingest", "合成DICOM进入Orthanc"],
      ["imaging-syn-dicom-render", "DICOMweb rendered端点返回可渲染像素"],
      ["imaging-syn-dicomweb-query", "按StudyInstanceUID查询DICOMweb检查"],
      ["imaging-syn-mpi-link", "主索引关联具备人工复核证据"],
      ["imaging-syn-fhir-chain", "Patient、ImagingStudy、DiagnosticReport引用闭环"],
      ["imaging-syn-ohif-viewer", "OHIF授权调阅链接可加载"],
      ["imaging-syn-access-audit", "调阅行为写入访问审计"],
      ["imaging-syn-scope-denial", "无权限居民调阅被拒绝并留痕"]
    ].map(([id, title]) => ({
      id,
      title,
      status: "pending",
      dataClass: "synthetic-test-data",
      evidenceRef: "",
      checkedAt: "",
      checkedBy: ""
    })),
    imagingProductionRequirements: [
      ["IMG-SITE-01", "试点医院PACS/RIS/DICOM TLS全链路联调", "试点医院信息科/放射科", ["imaging-pacs-ris", "imaging-orthanc"]],
      ["IMG-SITE-02", "FHIR资源引用与EMR报告回写验收", "平台互联互通组/医院病案部门", ["imaging-fhir"]],
      ["IMG-SITE-03", "居民主索引、机构人员和授权范围核验", "市卫生健康信息中心", ["imaging-mpi-audit"]],
      ["IMG-SITE-04", "OHIF实名授权调阅、越权拒绝和访问留痕", "影像产品与安全组", ["imaging-ohif", "imaging-mpi-audit"]],
      ["IMG-SITE-05", "省内本地存储、等保三级、密码和隐私评估", "网信与安全责任部门", []],
      ["IMG-SITE-06", "性能容量、备份恢复和灾备切换验收", "平台运维组", ["imaging-fhir", "imaging-orthanc", "imaging-ohif"]],
      ["IMG-SITE-07", "业务、技术和管理多方现场验收", "项目办", []]
    ].map(([id, title, owner, endpointIds]) => ({
      id,
      title,
      owner,
      endpointIds,
      status: "site-pending",
      cutoverBlocker: true,
      evidenceRef: "",
      evidenceDigest: "",
      externalSigner: "",
      externalOrganization: "",
      submittedBy: "",
      submittedAt: "",
      verifiedBy: "",
      verifiedAt: "",
      verificationRef: ""
    })),
    imagingProductionDrills: [
      ["imaging-drill-pacs", "PACS/RIS接口中断、补传与对账", "试点医院信息科"],
      ["imaging-drill-viewer", "OHIF不可用时报告优先与降级调阅", "影像平台运维"],
      ["imaging-drill-identity", "主索引错配、越权访问与隐私事件处置", "安全责任部门"],
      ["imaging-drill-storage", "影像归档、FHIR数据库备份恢复和灾备切换", "平台运维组"]
    ].map(([id, title, owner]) => ({
      id,
      title,
      owner,
      status: "planned",
      productionEvidence: false,
      evidenceRef: ""
    })),
    imagingCutoverApprovals: [
      { id: "imaging-approval-business", title: "影像业务上线批准", status: "pending", signedBy: "" },
      { id: "imaging-approval-technical", title: "影像技术上线批准", status: "pending", signedBy: "" }
    ],
    imagingProductionAudit: []
  };
}

function ensure(data) {
  const defaults = seed();
  for (const [key, value] of Object.entries(defaults)) {
    if (!Array.isArray(data[key])) data[key] = value;
  }
  return data;
}

function actorId(user = {}) {
  return String(user.id || user.username || user.name || "").trim();
}

function requireRole(user, allowed) {
  if (!allowed.includes(user?.role)) throw Object.assign(new Error("current role cannot operate imaging production controls"), { status: 403 });
  if (!actorId(user)) throw Object.assign(new Error("an accountable operator identity is required"), { status: 400 });
}

function audit(data, user, action, target, detail) {
  const at = now();
  const previousDigest = data.imagingProductionAudit[0]?.digest || "GENESIS";
  const row = {
    id: randomUUID(),
    at,
    actor: actorId(user),
    actorName: user.name || user.username || actorId(user),
    role: user.role,
    action,
    target,
    detail: String(detail || "").slice(0, 500),
    previousDigest
  };
  row.digest = `sha256:${createHash("sha256").update(JSON.stringify(row)).digest("hex")}`;
  data.imagingProductionAudit.unshift(row);
  data.imagingProductionAudit = data.imagingProductionAudit.slice(0, 2000);
}

function endpointViews(data) {
  return data.imagingProductionEndpoints.map((endpoint) => {
    const related = data.imagingProductionRequirements.filter((item) => item.endpointIds.includes(endpoint.id));
    const siteSigned = related.length > 0 && related.every((item) => item.status === "signed");
    const productionReady = endpoint.probePassed && siteSigned;
    return {
      ...endpoint,
      siteSigned,
      productionReady,
      status: productionReady ? "ready" : endpoint.status
    };
  });
}

function center(data) {
  ensure(data);
  const endpoints = endpointViews(data);
  const syntheticChecks = data.imagingSyntheticChecks;
  const requirements = data.imagingProductionRequirements;
  const drills = data.imagingProductionDrills;
  const approvals = data.imagingCutoverApprovals;
  const preflight = {
    syntheticAcceptancePassed: syntheticChecks.every((item) => item.status === "passed" && item.dataClass === "synthetic-test-data"),
    endpointsReady: endpoints.every((item) => item.productionReady),
    requirementsSigned: requirements.every((item) => item.status === "signed"),
    drillsPassed: drills.every((item) => item.productionEvidence),
    dualApproval: approvals.length >= 2 && approvals.every((item) => item.status === "signed")
  };
  preflight.ready = Object.values(preflight).every(Boolean);
  return {
    generatedAt: now(),
    module: "imaging-cloud",
    functionalState: preflight.syntheticAcceptancePassed ? "ready-for-site-integration" : "ready-for-synthetic-acceptance",
    formalGoLiveState: preflight.ready ? "ready-for-production" : "blocked-until-site-evidence-signed",
    productionReady: preflight.ready,
    preflight,
    summary: {
      syntheticChecksPassed: syntheticChecks.filter((item) => item.status === "passed").length,
      syntheticChecks: syntheticChecks.length,
      endpointsReady: endpoints.filter((item) => item.productionReady).length,
      endpoints: endpoints.length,
      requirementsSigned: requirements.filter((item) => item.status === "signed").length,
      requirements: requirements.length,
      drillsPassed: drills.filter((item) => item.productionEvidence).length,
      drills: drills.length,
      approvalsSigned: approvals.filter((item) => item.status === "signed").length,
      approvals: approvals.length,
      blockers: Object.entries(preflight).filter(([key, value]) => key !== "ready" && value === false).length
    },
    endpoints,
    syntheticChecks,
    requirements,
    drills,
    approvals,
    audit: data.imagingProductionAudit.slice(0, 100),
    routeContracts: ROUTE_CONTRACTS,
    rollback: {
      owner: "影像云上线总指挥",
      rpoMinutes: 5,
      rtoMinutes: 30,
      triggers: ["患者主索引错误关联", "越权调阅或敏感数据泄露", "影像对象不可恢复", "PACS回传持续失败", "FHIR引用链完整性失败"],
      steps: ["停止新影像关联与分享", "保留原院PACS诊疗路径", "冻结消息与审计证据", "回退应用和配置", "核对未完成检查并人工补偿"]
    }
  };
}

function probeEndpoint(data, user, id, payload = {}) {
  ensure(data);
  requireRole(user, ["commission", "institution"]);
  const row = data.imagingProductionEndpoints.find((item) => item.id === id);
  if (!row) throw Object.assign(new Error("imaging production endpoint not found"), { status: 404 });
  let endpoint;
  try {
    endpoint = new URL(String(payload.endpoint || ""));
  } catch {
    throw Object.assign(new Error("a valid production endpoint is required"), { status: 400 });
  }
  if (!new Set(["https:", "dicom-tls:"]).has(endpoint.protocol)) throw Object.assign(new Error("production endpoint must use HTTPS or DICOM TLS"), { status: 400 });
  if (payload.environment !== "production" || payload.result !== "passed") throw Object.assign(new Error("a passed production probe is required"), { status: 400 });
  if (!String(payload.credentialRef || "").trim() || !EVIDENCE_DIGEST.test(String(payload.certificateFingerprint || ""))) {
    throw Object.assign(new Error("credentialRef and SHA-256 certificate fingerprint are required"), { status: 400 });
  }
  Object.assign(row, {
    status: "probe-passed-site-signoff-pending",
    probePassed: true,
    endpoint: endpoint.toString(),
    environment: "production",
    credentialRef: String(payload.credentialRef),
    certificateFingerprint: String(payload.certificateFingerprint),
    latencyMs: Number.isFinite(Number(payload.latencyMs)) ? Number(payload.latencyMs) : null,
    lastProbeAt: now(),
    probedBy: actorId(user)
  });
  audit(data, user, "probe-production-endpoint", id, `${row.endpoint}; ${row.certificateFingerprint}`);
  return row;
}

function recordSyntheticCheck(data, user, id, payload = {}) {
  ensure(data);
  requireRole(user, ["commission", "institution"]);
  const row = data.imagingSyntheticChecks.find((item) => item.id === id);
  if (!row) throw Object.assign(new Error("synthetic imaging check not found"), { status: 404 });
  const result = String(payload.result || "");
  if (!new Set(["passed", "failed"]).has(result)) throw Object.assign(new Error("synthetic check result must be passed or failed"), { status: 400 });
  if (payload.confirmation !== SYNTHETIC_CONFIRMATION || payload.dataClass !== "synthetic-test-data" || !String(payload.evidenceRef || "").trim()) {
    throw Object.assign(new Error("synthetic-test-data confirmation and evidenceRef are required"), { status: 400 });
  }
  Object.assign(row, {
    status: result,
    dataClass: "synthetic-test-data",
    evidenceRef: String(payload.evidenceRef),
    detail: String(payload.detail || "").slice(0, 500),
    checkedAt: now(),
    checkedBy: actorId(user)
  });
  audit(data, user, "record-synthetic-imaging-check", id, `${result}; ${row.evidenceRef}`);
  return row;
}

function signRequirement(data, user, id, payload = {}) {
  ensure(data);
  const row = data.imagingProductionRequirements.find((item) => item.id === id);
  if (!row) throw Object.assign(new Error("imaging production requirement not found"), { status: 404 });
  const actor = actorId(user);
  if (payload.action === "submit-evidence") {
    requireRole(user, ["commission", "institution"]);
    if (!new Set(["site-pending", "rejected"]).has(row.status)) throw Object.assign(new Error("site evidence has already been submitted"), { status: 409 });
    if (payload.confirmation !== SUBMIT_CONFIRMATION || !String(payload.evidenceRef || "").trim() || !EVIDENCE_DIGEST.test(String(payload.evidenceDigest || ""))) {
      throw Object.assign(new Error("exact confirmation, evidenceRef and SHA-256 digest are required"), { status: 400 });
    }
    if (String(payload.externalSigner || "").trim().length < 2 || String(payload.externalOrganization || "").trim().length < 2) {
      throw Object.assign(new Error("external signer and organization provenance are required"), { status: 400 });
    }
    Object.assign(row, {
      status: "evidence-submitted",
      evidenceRef: String(payload.evidenceRef),
      evidenceDigest: String(payload.evidenceDigest),
      externalSigner: String(payload.externalSigner),
      externalOrganization: String(payload.externalOrganization),
      submittedBy: actor,
      submittedAt: now(),
      verifiedBy: "",
      verifiedAt: "",
      verificationRef: ""
    });
  } else if (payload.action === "verify-evidence") {
    requireRole(user, ["commission"]);
    if (row.status !== "evidence-submitted" || payload.confirmation !== VERIFY_CONFIRMATION || payload.evidenceDigest !== row.evidenceDigest || actor === row.submittedBy) {
      throw Object.assign(new Error("independent verification with matching digest is required"), { status: 400 });
    }
    const missingProbe = row.endpointIds.map((endpointId) => data.imagingProductionEndpoints.find((item) => item.id === endpointId)).find((item) => !item?.probePassed);
    if (missingProbe) throw Object.assign(new Error(`related endpoint probe must pass before verification: ${missingProbe.id}`), { status: 409 });
    if (!String(payload.verificationRef || "").trim()) throw Object.assign(new Error("verificationRef is required"), { status: 400 });
    Object.assign(row, {
      status: "signed",
      verifiedBy: actor,
      verifiedAt: now(),
      verificationRef: String(payload.verificationRef)
    });
  } else if (payload.action === "reject-evidence") {
    requireRole(user, ["commission"]);
    if (row.status !== "evidence-submitted" || actor === row.submittedBy || !String(payload.verificationRef || "").trim()) {
      throw Object.assign(new Error("independent rejection and verificationRef are required"), { status: 400 });
    }
    Object.assign(row, { status: "rejected", verifiedBy: actor, verifiedAt: now(), verificationRef: String(payload.verificationRef) });
  } else {
    throw Object.assign(new Error("unsupported imaging requirement action"), { status: 400 });
  }
  audit(data, user, `requirement-${payload.action}`, id, row.evidenceRef || row.verificationRef);
  return row;
}

function completeDrill(data, user, id, payload = {}) {
  ensure(data);
  requireRole(user, ["commission", "institution"]);
  const row = data.imagingProductionDrills.find((item) => item.id === id);
  if (!row) throw Object.assign(new Error("imaging production drill not found"), { status: 404 });
  if (payload.result !== "passed" || !String(payload.evidenceRef || "").trim()) throw Object.assign(new Error("passed result and evidenceRef are required"), { status: 400 });
  Object.assign(row, {
    status: "passed",
    productionEvidence: true,
    evidenceRef: String(payload.evidenceRef),
    executedAt: now(),
    executedBy: actorId(user)
  });
  audit(data, user, "complete-production-drill", id, row.evidenceRef);
  return row;
}

function signApproval(data, user, id, payload = {}) {
  ensure(data);
  requireRole(user, ["commission"]);
  const before = center(data);
  if (!before.preflight.syntheticAcceptancePassed || !before.preflight.endpointsReady || !before.preflight.requirementsSigned || !before.preflight.drillsPassed) {
    throw Object.assign(new Error("all imaging preflight evidence must pass before cutover approval"), { status: 409 });
  }
  const row = data.imagingCutoverApprovals.find((item) => item.id === id);
  if (!row) throw Object.assign(new Error("imaging cutover approval not found"), { status: 404 });
  if (row.status === "signed") throw Object.assign(new Error("approval has already been signed"), { status: 409 });
  if (payload.confirmation !== CUTOVER_CONFIRMATION || !String(payload.evidenceRef || "").trim()) {
    throw Object.assign(new Error("exact confirmation and evidenceRef are required"), { status: 400 });
  }
  const signer = actorId(user);
  const existingApproval = data.imagingCutoverApprovals.find((item) => item.status === "signed");
  if (existingApproval?.signedBy === signer) throw Object.assign(new Error("business and technical approvals require different signers"), { status: 409 });
  Object.assign(row, { status: "signed", signedBy: signer, signedAt: now(), evidenceRef: String(payload.evidenceRef) });
  audit(data, user, "sign-imaging-cutover-approval", id, row.evidenceRef);
  return row;
}

module.exports = {
  CUTOVER_CONFIRMATION,
  ROUTE_CONTRACTS,
  SUBMIT_CONFIRMATION,
  SYNTHETIC_CONFIRMATION,
  VERIFY_CONFIRMATION,
  center,
  completeDrill,
  ensure,
  probeEndpoint,
  recordSyntheticCheck,
  seed,
  signApproval,
  signRequirement
};
