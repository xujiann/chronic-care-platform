"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { buildInstitutionOperationsCapabilityPlan } = require("./t10-institution-operations");
const { buildSpecialtyPlanReview } = require("./t10-specialty-plan-review");
const { buildExternalActionWorkflowPlan } = require("./t10-external-action-workflow");

const DEFAULT_TRACKS = [
  {
    id: "emergency-life-chain",
    name: "120急救生命链",
    department: "市急救中心/卫健应急办",
    readinessBuilder: () => require("./scripts/emergency-readiness").buildEmergencyReadinessReport(),
    page: "emergency.html",
    api: "/api/emergency/production-center",
    acceptanceIncrement: "选择一家120分站、一家胸痛/卒中接诊医院和一台受控网关设备，完成签名设备信号 -> 人工确认派车 -> 院前院内电子交接 -> 事件证据包导出。",
    requiredExternalEvidence: [
      "120调度系统联调回执",
      "车载设备/穿戴设备证书指纹与密钥托管记录",
      "接诊医院绿色通道值班与电子交接签收",
      "急救质控和调度复盘签字"
    ]
  },
  {
    id: "clinical-blood",
    name: "临床用血",
    department: "血液中心/医院输血科/医务部",
    readinessBuilder: () => require("./scripts/blood-system-readiness").buildBloodSystemReadinessReport(),
    page: "blood.html",
    api: "/api/blood-system/go-live",
    acceptanceIncrement: "选择一个血液中心批次和一家医院输血科，完成冷链事件、交叉配血双人复核、发血签收、床旁输血记录和召回应答闭环。",
    requiredExternalEvidence: [
      "BIS/BTIS主数据与血袋唯一标识核对单",
      "冷链IoT网关签名样例和温度曲线",
      "输血科双人复核账号授权记录",
      "临床用血质控/召回演练签字"
    ]
  },
  {
    id: "regional-imaging-cloud",
    name: "区域影像云",
    department: "放射科/医院信息科/区域平台互联互通组",
    readinessBuilder: () => require("./scripts/imaging-cloud-readiness").buildImagingCloudReadinessReport(),
    page: "imaging-cloud.html",
    api: "/api/imaging-cloud/production-center",
    acceptanceIncrement: "选择CT单一模态与两家试点机构，完成DICOM TLS传输、FHIR报告回写、居民授权查看、互认链关闭和PACS故障演练。",
    requiredExternalEvidence: [
      "PACS/RIS/DICOM TLS联通回执",
      "FHIR/EMR报告回写样例",
      "影像对象存储与脱敏访问审计",
      "互认规则、申诉和质控复核签字"
    ]
  },
  {
    id: "physical-examination",
    name: "健康体检",
    department: "体检中心/基层公卫/慢病管理团队",
    readinessBuilder: () => require("./scripts/physical-examination-readiness").buildReport(),
    page: "physical-examination.html",
    api: "/api/physical-exams",
    acceptanceIncrement: "选择一家体检中心与一个基层团队，完成签名体检报告接入、异常自动建单、居民通知、复查/随访闭环和原件归档校验。",
    requiredExternalEvidence: [
      "体检中心源系统字段映射和签名报文",
      "主检医师/分项医师资质和签名样例",
      "异常通知、复查和家医随访记录",
      "报告原件存储、恶意文件扫描和留存策略"
    ]
  }
];

const CUTOVER_STAGES = [
  "code-readiness",
  "synthetic-acceptance",
  "joint-test",
  "site-evidence",
  "go-no-go",
  "grey-release"
];

const SPECIALTY_MODULE_BOUNDARIES = {
  "emergency-life-chain": {
    deploymentUnit: "t10-emergency-life-chain",
    dataBoundary: "emergency event, dispatch, pre-arrival handover and device-signal evidence",
    externalSystems: ["120 dispatch", "ambulance or wearable gateway", "receiving hospital EMR"],
    sharedPlatformCapabilities: ["institution-directory", "identity-and-role-scope", "signed-interface", "audit-evidence"],
    requiredPeerModules: []
  },
  "clinical-blood": {
    deploymentUnit: "shared-platform-node-runtime",
    independentDeploymentAuthorized: false,
    dataBoundary: "blood order, bag identity, compatibility, cold-chain, issue, transfusion and recall evidence",
    externalSystems: ["BIS or BTIS", "hospital transfusion service", "cold-chain IoT gateway"],
    sharedPlatformCapabilities: ["institution-directory", "identity-and-role-scope", "signed-interface", "audit-evidence"],
    requiredPeerModules: []
  },
  "regional-imaging-cloud": {
    deploymentUnit: "t10-regional-imaging-cloud",
    dataBoundary: "study index, image-object reference, report, authorization, mutual recognition and appeal evidence",
    externalSystems: ["PACS or RIS", "DICOM TLS gateway", "FHIR or EMR report endpoint"],
    sharedPlatformCapabilities: ["institution-directory", "identity-and-role-scope", "signed-interface", "audit-evidence"],
    requiredPeerModules: []
  },
  "physical-examination": {
    deploymentUnit: "t10-physical-examination",
    dataBoundary: "exam order, signed report, abnormal finding, notification, recheck and follow-up evidence",
    externalSystems: ["physical-exam source system", "report signature service", "primary-care follow-up service"],
    sharedPlatformCapabilities: ["institution-directory", "identity-and-role-scope", "signed-interface", "audit-evidence"],
    requiredPeerModules: []
  }
};

const TRACK_SCENARIO_PROFILES = {
  "emergency-life-chain": {
    normalName: "Normal end-to-end emergency life-chain",
    normalSteps: [
      "receive signed device or controlled gateway signal",
      "dispatcher confirms ambulance dispatch manually",
      "receiving hospital accepts electronic pre-arrival handover",
      "export event evidence packet and audit digest"
    ],
    normalEvidence: ["signed signal receipt", "dispatch confirmation record", "hospital handover acknowledgement", "audit digest and evidence packet"],
    normalPass: "all timestamps, operator identities, receipts and handover records replay in order",
    duplicateMutation: "dispatch, handover or patient timeline item",
    manualPath: "manual phone or paper handover path"
  },
  "clinical-blood": {
    normalName: "Normal end-to-end clinical blood workflow",
    normalSteps: [
      "receive a signed blood order and resolve the patient and bag identities",
      "complete compatibility and dual-person verification",
      "record issue, bedside transfusion and cold-chain checkpoints",
      "export transfusion evidence packet and audit digest"
    ],
    normalEvidence: ["signed blood order", "bag identity and compatibility record", "dual-person bedside verification", "cold-chain and transfusion audit digest"],
    normalPass: "the order, bag, patient, reviewers, cold-chain and transfusion timestamps replay in order",
    duplicateMutation: "blood issue, compatibility result or transfusion record",
    manualPath: "approved downtime blood issue and paper verification path"
  },
  "regional-imaging-cloud": {
    normalName: "Normal end-to-end regional imaging workflow",
    normalSteps: [
      "receive a DICOM TLS study from the pilot institution",
      "index the study and write back the signed report",
      "verify authorized cross-institution viewing and mutual-recognition status",
      "export imaging evidence packet and audit digest"
    ],
    normalEvidence: ["DICOM transfer receipt", "study index and report write-back", "authorization and mutual-recognition decision", "access audit digest"],
    normalPass: "the study, report, authorization and access-audit records replay without exposing image objects outside policy",
    duplicateMutation: "study index, report version or mutual-recognition record",
    manualPath: "approved local PACS reading and delayed report synchronization path"
  },
  "physical-examination": {
    normalName: "Normal end-to-end physical examination workflow",
    normalSteps: [
      "receive a signed examination report from the pilot center",
      "validate physician signatures and archive the original report",
      "create an abnormal-finding task and record resident notification",
      "complete recheck or primary-care follow-up and export the audit digest"
    ],
    normalEvidence: ["signed source report", "physician signature validation", "abnormal notification receipt", "recheck or follow-up closure digest"],
    normalPass: "the original report, signatures, abnormal finding, notification and follow-up records replay in order",
    duplicateMutation: "exam report, abnormal-finding task or follow-up record",
    manualPath: "approved manual notification and recheck registration path"
  }
};

function resolveEnabledTracks(tracks, enabledTrackIds) {
  if (enabledTrackIds == null) return tracks.slice();
  if (!Array.isArray(enabledTrackIds) || enabledTrackIds.length === 0) {
    throw new Error("enabledTrackIds must contain at least one specialty module id");
  }
  const requested = [...new Set(enabledTrackIds)];
  const availableIds = new Set(tracks.map((track) => track.id));
  const unknown = requested.filter((id) => !availableIds.has(id));
  if (unknown.length > 0) throw new Error(`unknown specialty module id: ${unknown.join(", ")}`);
  return tracks.filter((track) => requested.includes(track.id));
}

function buildModuleCatalog(allTracks, enabledTracks) {
  const enabledIds = new Set(enabledTracks.map((track) => track.id));
  const modules = allTracks.map((track) => {
    const boundary = SPECIALTY_MODULE_BOUNDARIES[track.id] || {
      deploymentUnit: `t10-${track.id}`,
      dataBoundary: `${track.id} business and evidence records`,
      externalSystems: [],
      sharedPlatformCapabilities: ["institution-directory", "identity-and-role-scope", "audit-evidence"],
      requiredPeerModules: []
    };
    return {
      id: track.id,
      name: track.name,
      deploymentUnit: boundary.deploymentUnit,
      independentlySelectable: true,
      independentDeploymentAuthorized: boundary.independentDeploymentAuthorized !== false,
      selected: enabledIds.has(track.id),
      page: track.page,
      api: track.api,
      department: track.department,
      dataBoundary: boundary.dataBoundary,
      externalSystems: boundary.externalSystems,
      sharedPlatformCapabilities: boundary.sharedPlatformCapabilities,
      requiredPeerModules: boundary.requiredPeerModules
    };
  });
  const enabled = modules.filter((item) => item.selected);
  const singleModuleMode = enabled.length === 1
    ? (enabled[0].independentDeploymentAuthorized ? "standalone-module" : "shared-runtime-module-selection")
    : "composable-module-suite";
  return {
    contractVersion: "1.0.0",
    selectionMode: singleModuleMode,
    enabledModuleIds: enabled.map((item) => item.id),
    disabledModuleIds: modules.filter((item) => !item.selected).map((item) => item.id),
    peerModuleDependencyCount: enabled.reduce((sum, item) => sum + item.requiredPeerModules.length, 0),
    sharedPlatformPolicy: "shared capabilities are platform contracts, not dependencies on another specialty module",
    modules
  };
}

function buildInstitutionDeploymentManifest(moduleCatalog, options = {}) {
  const institutionId = options.institutionId || "institution-template";
  const enabledModules = moduleCatalog.modules.filter((item) => item.selected).map((item) => ({
    id: item.id,
    name: item.name,
    deploymentUnit: item.deploymentUnit,
    page: item.page,
    api: item.api,
    dataNamespace: `t10.${item.id.replace(/-/g, "_")}`,
    dataBoundary: item.dataBoundary,
    externalSystems: item.externalSystems,
    sharedPlatformCapabilities: item.sharedPlatformCapabilities,
    independentDeploymentAuthorized: item.independentDeploymentAuthorized,
    rollbackMode: item.independentDeploymentAuthorized ? "deployment-unit" : "logical-module-disable",
    rollbackUnit: item.independentDeploymentAuthorized ? item.deploymentUnit : item.id,
    productionTrafficState: "blocked-until-site-evidence-signed"
  }));
  return {
    contractVersion: "1.0.0",
    institutionId,
    activationPolicy: "deny-by-default",
    productionTrafficState: "blocked-until-site-evidence-signed",
    enabledModuleIds: enabledModules.map((item) => item.id),
    disabledModuleIds: moduleCatalog.disabledModuleIds.slice(),
    routeAllowlist: enabledModules.map((item) => item.page),
    apiAllowlist: enabledModules.map((item) => item.api),
    dataNamespaces: enabledModules.map((item) => item.dataNamespace),
    rollbackUnits: enabledModules.map((item) => item.rollbackUnit),
    enabledModules,
    validationRules: [
      "only selected specialty pages and APIs may be exposed for the institution",
      "each enabled module must use its own data namespace and an authorized rollback control; shared runtime modules use logical disable rather than process rollback",
      "disabled specialty modules must remain unreachable and receive no production traffic",
      "shared platform capabilities do not activate a peer specialty module",
      "site evidence and formal Go/No-Go approval remain mandatory after module activation"
    ]
  };
}

function validateInstitutionDeploymentManifest(manifest, moduleCatalog) {
  const manifestModules = Array.isArray(manifest.enabledModules) ? manifest.enabledModules : [];
  const enabledCatalogModules = moduleCatalog.modules.filter((item) => item.selected);
  const disabledCatalogModules = moduleCatalog.modules.filter((item) => !item.selected);
  const expectedEnabledIds = enabledCatalogModules.map((item) => item.id);
  const expectedDisabledIds = disabledCatalogModules.map((item) => item.id);
  const expectedPages = enabledCatalogModules.map((item) => item.page);
  const expectedApis = enabledCatalogModules.map((item) => item.api);
  const disabledPages = new Set(disabledCatalogModules.map((item) => item.page));
  const disabledApis = new Set(disabledCatalogModules.map((item) => item.api));
  const sameMembers = (actual, expected) => Array.isArray(actual)
    && actual.length === expected.length
    && expected.every((item) => actual.includes(item));
  const unique = (items) => Array.isArray(items) && new Set(items).size === items.length;
  const checks = [
    {
      id: "activation-policy",
      passed: manifest.activationPolicy === "deny-by-default",
      detail: `activation policy is ${manifest.activationPolicy || "missing"}`
    },
    {
      id: "enabled-module-set",
      passed: sameMembers(manifest.enabledModuleIds, expectedEnabledIds),
      detail: `${manifest.enabledModuleIds?.length || 0}/${expectedEnabledIds.length} enabled module IDs match the catalog`
    },
    {
      id: "disabled-module-set",
      passed: sameMembers(manifest.disabledModuleIds, expectedDisabledIds),
      detail: `${manifest.disabledModuleIds?.length || 0}/${expectedDisabledIds.length} disabled module IDs match the catalog`
    },
    {
      id: "page-allowlist",
      passed: sameMembers(manifest.routeAllowlist, expectedPages)
        && manifest.routeAllowlist.every((item) => !disabledPages.has(item)),
      detail: `${manifest.routeAllowlist?.length || 0}/${expectedPages.length} selected pages exposed`
    },
    {
      id: "api-allowlist",
      passed: sameMembers(manifest.apiAllowlist, expectedApis)
        && manifest.apiAllowlist.every((item) => !disabledApis.has(item)),
      detail: `${manifest.apiAllowlist?.length || 0}/${expectedApis.length} selected APIs exposed`
    },
    {
      id: "data-namespace-isolation",
      passed: manifest.dataNamespaces?.length === expectedEnabledIds.length
        && unique(manifest.dataNamespaces)
        && manifest.dataNamespaces.every((item) => /^t10\.[a-z0-9_]+$/.test(item)),
      detail: `${new Set(manifest.dataNamespaces || []).size}/${expectedEnabledIds.length} unique data namespaces`
    },
    {
      id: "rollback-unit-isolation",
      passed: manifest.rollbackUnits?.length === expectedEnabledIds.length
        && unique(manifest.rollbackUnits)
        && manifestModules.length === expectedEnabledIds.length
        && manifestModules.every((item) => item.independentDeploymentAuthorized
          ? item.rollbackMode === "deployment-unit" && item.rollbackUnit === item.deploymentUnit
          : item.rollbackMode === "logical-module-disable" && item.rollbackUnit === item.id),
      detail: `${new Set(manifest.rollbackUnits || []).size}/${expectedEnabledIds.length} authorized rollback controls`
    },
    {
      id: "peer-module-independence",
      passed: moduleCatalog.peerModuleDependencyCount === 0
        && enabledCatalogModules.every((item) => item.requiredPeerModules.length === 0),
      detail: `${moduleCatalog.peerModuleDependencyCount} peer specialty dependencies`
    },
    {
      id: "production-traffic-boundary",
      passed: manifest.productionTrafficState === "blocked-until-site-evidence-signed"
        && manifestModules.length === expectedEnabledIds.length
        && manifestModules.every((item) => item.productionTrafficState === "blocked-until-site-evidence-signed"),
      detail: manifest.productionTrafficState || "missing production traffic state"
    }
  ];
  const failed = checks.filter((item) => !item.passed);
  return {
    status: failed.length === 0 ? "deployment-contract-valid" : "deployment-contract-blocked",
    ok: failed.length === 0,
    institutionId: manifest.institutionId,
    checks,
    hardStops: failed.map((item) => item.id),
    summary: {
      total: checks.length,
      passed: checks.length - failed.length,
      failed: failed.length
    }
  };
}

function enumerateSpecialtySelections(tracks) {
  const selections = [];
  const count = tracks.length;
  for (let mask = 1; mask < 2 ** count; mask += 1) {
    selections.push(tracks.filter((_, index) => (mask & (1 << index)) !== 0));
  }
  return selections;
}

function buildSpecialtyCompatibilityMatrix(allTracks = DEFAULT_TRACKS) {
  const combinations = enumerateSpecialtySelections(allTracks).map((selectedTracks) => {
    const catalog = buildModuleCatalog(allTracks, selectedTracks);
    const manifest = buildInstitutionDeploymentManifest(catalog, {
      institutionId: `compatibility-${selectedTracks.map((item) => item.id).join("--")}`
    });
    const gate = validateInstitutionDeploymentManifest(manifest, catalog);
    return {
      id: selectedTracks.map((item) => item.id).join("+"),
      moduleIds: selectedTracks.map((item) => item.id),
      selectionMode: catalog.selectionMode,
      peerModuleDependencyCount: catalog.peerModuleDependencyCount,
      routeCount: manifest.routeAllowlist.length,
      apiCount: manifest.apiAllowlist.length,
      dataNamespaceCount: manifest.dataNamespaces.length,
      rollbackUnitCount: manifest.rollbackUnits.length,
      gateStatus: gate.status,
      passed: gate.ok
    };
  });
  return {
    status: combinations.every((item) => item.passed) ? "all-combinations-compatible" : "combination-conflict-detected",
    totalCombinations: combinations.length,
    passedCombinations: combinations.filter((item) => item.passed).length,
    failedCombinations: combinations.filter((item) => !item.passed).length,
    combinations
  };
}

function buildInstitutionPackagePlan(manifest, gate, compatibilityMatrix) {
  const artifacts = [
    { id: "deployment-package", file: "deployment-package.json", purpose: "machine-readable module, route, API, data and gate contract" },
    { id: "deployment-summary", file: "deployment-package.md", purpose: "human-readable institution implementation and acceptance summary" },
    { id: "environment-example", file: "activation.env.example", purpose: "fail-closed institution and selected-module environment example" },
    { id: "rollback-plan", file: "rollback-plan.md", purpose: "per-module independent disable and rollback procedure" },
    { id: "artifact-index", file: "artifact-index.json", purpose: "SHA-256 index for every generated payload artifact" }
  ];
  const ready = gate.ok && compatibilityMatrix.failedCombinations === 0;
  return {
    status: ready ? "ready-to-build-institution-package" : "institution-package-blocked",
    institutionId: manifest.institutionId,
    enabledModuleIds: manifest.enabledModuleIds,
    buildCommand: `node scripts/t10-institution-package.js --institution-id=${manifest.institutionId} --tracks=${manifest.enabledModuleIds.join(",")}`,
    artifacts,
    installOrder: [
      "verify institution identity, selected modules and deny-by-default policy",
      "provision shared platform capabilities without enabling peer specialty modules",
      "apply page and API allowlists for selected modules only",
      "provision isolated data namespaces and external-system credentials",
      "run deployment gate, module readiness and controlled rehearsal",
      "retain production traffic block until site evidence and formal Go/No-Go approval"
    ],
    rollbackPolicy: "disable one deployment unit, route allowlist and API allowlist without changing peer modules or deleting evidence",
    compatibility: {
      status: compatibilityMatrix.status,
      totalCombinations: compatibilityMatrix.totalCombinations,
      passedCombinations: compatibilityMatrix.passedCombinations
    },
    hardStops: [
      ...gate.hardStops,
      ...(compatibilityMatrix.failedCombinations > 0 ? ["specialty-combination-conflict"] : [])
    ]
  };
}

function sha256(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function countBlockers(report) {
  const direct = [
    ...asArray(report.siteBlockers),
    ...asArray(report.onsiteBlockers),
    ...asArray(report.productionBlockers)
  ];
  if (direct.length > 0) return direct.length;
  const summary = report.summary || {};
  return Number(summary.sitePending || summary.production?.blockers || summary.cutoverBlockers || 0);
}

function blockerDetails(report, fallbackEvidence = []) {
  const items = [
    ...asArray(report.siteBlockers),
    ...asArray(report.onsiteBlockers),
    ...asArray(report.productionBlockers)
  ];
  if (items.length > 0) {
    return items.map((item, index) => ({
      id: item.id || `site-blocker-${index + 1}`,
      title: item.title || item.name || item.detail || String(item),
      owner: item.owner || item.department || "现场责任部门",
      status: item.status || "site-pending"
    }));
  }
  return fallbackEvidence.map((title, index) => ({
    id: `external-evidence-${index + 1}`,
    title,
    owner: "现场责任部门",
    status: "site-pending"
  }));
}

function normalizeTrack(track, report) {
  const checks = Number(report.summary?.checks || report.total || report.checks?.length || 0);
  const passed = Number(report.summary?.passed || report.passed || 0);
  const blockers = countBlockers(report);
  const codeReady = Boolean(report.ok && (report.codeReady !== false));
  const productionReady = Boolean(report.productionReady || report.goLiveReady);
  const formalGoLiveState = report.formalGoLiveState || (productionReady ? "ready-for-production" : "blocked-until-site-evidence-signed");
  const currentStage = !codeReady
    ? "code-readiness"
    : blockers > 0 || !productionReady
      ? "site-evidence"
      : "go-no-go";

  return {
    id: track.id,
    name: track.name,
    department: track.department,
    page: track.page,
    api: track.api,
    codeReady,
    productionReady,
    formalGoLiveState,
    currentStage,
    readiness: {
      checks,
      passed,
      failed: Math.max(0, checks - passed),
      digest: `sha256:${sha256({ id: track.id, checks: report.checks, summary: report.summary, state: formalGoLiveState })}`
    },
    blockers: blockerDetails(report, track.requiredExternalEvidence),
    requiredExternalEvidence: track.requiredExternalEvidence,
    acceptanceIncrement: track.acceptanceIncrement
  };
}

function buildSpecialtyCutoverPack(options = {}) {
  const generatedAt = options.generatedAt || new Date().toISOString();
  const allTracks = options.tracks || DEFAULT_TRACKS;
  const enabledTracks = resolveEnabledTracks(allTracks, options.enabledTrackIds);
  const tracks = enabledTracks.map((track) => {
    const report = options.reports?.[track.id] || track.readinessBuilder();
    return normalizeTrack(track, report);
  });
  const moduleCatalog = buildModuleCatalog(allTracks, enabledTracks);
  const institutionDeploymentManifest = buildInstitutionDeploymentManifest(moduleCatalog, {
    institutionId: options.institutionId
  });
  const institutionDeploymentGate = validateInstitutionDeploymentManifest(institutionDeploymentManifest, moduleCatalog);
  const specialtyCompatibilityMatrix = buildSpecialtyCompatibilityMatrix(allTracks);
  const institutionPackagePlan = buildInstitutionPackagePlan(
    institutionDeploymentManifest,
    institutionDeploymentGate,
    specialtyCompatibilityMatrix
  );
  const firstIncrement = selectFirstIncrement(tracks);
  const evidenceDossier = buildEvidenceDossier(tracks, firstIncrement);
  const pilotBatchPlan = buildPilotBatchPlan(tracks, firstIncrement);
  const siteEvidenceWorkflow = buildSiteEvidenceWorkflow(evidenceDossier, pilotBatchPlan);
  const acceptanceScenarioSuite = buildAcceptanceScenarioSuite(tracks, firstIncrement, evidenceDossier, siteEvidenceWorkflow);
  const scenarioEvidenceMatrix = buildScenarioEvidenceMatrix(acceptanceScenarioSuite, evidenceDossier, siteEvidenceWorkflow);
  const cutoverCommandCenter = buildCutoverCommandCenter(tracks, firstIncrement, pilotBatchPlan, siteEvidenceWorkflow, scenarioEvidenceMatrix);
  const observationSignalBoard = buildObservationSignalBoard(tracks, firstIncrement, cutoverCommandCenter, scenarioEvidenceMatrix);
  const institutionOperationsCapabilityPlan = buildInstitutionOperationsCapabilityPlan({
    institutionDeploymentManifest,
    institutionDeploymentGate,
    evidenceDossier,
    acceptanceScenarioSuite,
    observationSignalBoard
  });
  const runtimeSmokePlan = buildRuntimeSmokePlan(tracks, firstIncrement, observationSignalBoard);
  const specialtyPlanReview = buildSpecialtyPlanReview({
    selectedTrackIds: tracks.map((item) => item.id),
    tracks,
    generatedAt
  });
  const externalActionWorkflowPlan = buildExternalActionWorkflowPlan(specialtyPlanReview);
  const summary = {
    tracks: tracks.length,
    codeReady: tracks.filter((item) => item.codeReady).length,
    productionReady: tracks.filter((item) => item.productionReady).length,
    siteBlockers: tracks.reduce((sum, item) => sum + item.blockers.length, 0),
    totalChecks: tracks.reduce((sum, item) => sum + item.readiness.checks, 0),
    passedChecks: tracks.reduce((sum, item) => sum + item.readiness.passed, 0),
    formalGoLiveState: tracks.every((item) => item.productionReady) ? "ready-for-production-go-no-go" : "blocked-until-site-evidence-signed",
    plannedCapabilities: specialtyPlanReview.summary.plannedCapabilities,
    implementedPlannedCapabilities: specialtyPlanReview.summary.implementedCapabilities,
    openExternalActions: specialtyPlanReview.summary.externalActions
  };
  const pack = {
    module: "t10-emergency-blood-imaging-physical-exam-cutover",
    generatedAt,
    summary,
    stages: CUTOVER_STAGES,
    moduleCatalog,
    institutionDeploymentManifest,
    institutionDeploymentGate,
    specialtyCompatibilityMatrix,
    institutionPackagePlan,
    tracks,
    firstIncrement,
    crossTrackControls: buildCrossTrackControls(tracks),
    acceptanceChecklist: buildAcceptanceChecklist(tracks),
    rehearsalPlan: buildRehearsalPlan(tracks, firstIncrement),
    goNoGoDecision: buildGoNoGoDecision(tracks, firstIncrement),
    evidenceDossier,
    pilotBatchPlan,
    siteEvidenceWorkflow,
    acceptanceScenarioSuite,
    scenarioEvidenceMatrix,
    cutoverCommandCenter,
    observationSignalBoard,
    institutionOperationsCapabilityPlan,
    specialtyPlanReview,
    externalActionWorkflowPlan,
    runtimeSmokePlan
  };
  pack.integrity = {
    algorithm: "sha256",
    digest: `sha256:${sha256({ summary, moduleCatalog, institutionDeploymentManifest, institutionDeploymentGate, specialtyCompatibilityMatrix, institutionPackagePlan, tracks, firstIncrement, crossTrackControls: pack.crossTrackControls, acceptanceChecklist: pack.acceptanceChecklist, rehearsalPlan: pack.rehearsalPlan, goNoGoDecision: pack.goNoGoDecision, evidenceDossier, pilotBatchPlan, siteEvidenceWorkflow, acceptanceScenarioSuite, scenarioEvidenceMatrix, cutoverCommandCenter, observationSignalBoard, institutionOperationsCapabilityPlan, specialtyPlanReview, externalActionWorkflowPlan, runtimeSmokePlan })}`
  };
  return pack;
}

function selectFirstIncrement(tracks) {
  const order = ["emergency-life-chain", "clinical-blood", "regional-imaging-cloud", "physical-examination"];
  const readyTracks = tracks.filter((item) => item.codeReady && !item.productionReady);
  const chosen = readyTracks.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))[0] || tracks[0];
  return {
    trackId: chosen.id,
    trackName: chosen.name,
    recommendation: chosen.acceptanceIncrement,
    why: "代码门禁已通过，但仍有现场证据和外部接口签收阻断；适合用受控单机构/单链路灰度来收集生产验收证据。",
    requiredBeforeStart: chosen.blockers.slice(0, 4).map((item) => `${item.id}: ${item.title}`)
  };
}

function buildCrossTrackControls(tracks) {
  return [
    {
      id: "identity-and-role-scope",
      name: "统一身份与最小权限",
      owner: "平台账号管理员/机构管理员",
      appliesTo: tracks.map((item) => item.id),
      acceptance: "每个专项均使用现场实名账号、机构编码和角色授权；演示账号不得进入生产灰度。"
    },
    {
      id: "signed-interface-and-idempotency",
      name: "签名接口、时钟窗口和幂等",
      owner: "平台互联互通组/外部系统厂商",
      appliesTo: tracks.map((item) => item.id),
      acceptance: "外部报文必须具备签名、时间窗、nonce或幂等键、回执和死信补偿证据。"
    },
    {
      id: "four-eyes-site-evidence",
      name: "四眼现场证据签收",
      owner: "业务责任部门/卫生行政复核人",
      appliesTo: tracks.map((item) => item.id),
      acceptance: "提交人与复核人不得相同；证据编号、摘要、附件引用和签收时间必须可追溯。"
    },
    {
      id: "patient-safety-and-downgrade",
      name: "患者安全与降级预案",
      owner: "医务部/急救中心/运维值班",
      appliesTo: tracks.map((item) => item.id),
      acceptance: "急救电话、人工调度、纸质/院内流程、冷链和报告原件均有停机或弱网降级路径。"
    }
  ];
}

function buildAcceptanceChecklist(tracks) {
  return tracks.flatMap((track) => [
    {
      trackId: track.id,
      item: `${track.name} readiness 全量通过`,
      status: track.codeReady ? "passed" : "blocked",
      evidence: track.readiness.digest
    },
    {
      trackId: track.id,
      item: `${track.name} 现场接口与证据签收`,
      status: track.productionReady ? "passed" : "site-pending",
      evidence: track.blockers.map((blocker) => blocker.id)
    },
    {
      trackId: track.id,
      item: `${track.name} 首个灰度增量验收`,
      status: "ready-to-rehearse",
      evidence: track.acceptanceIncrement
    }
  ]);
}

function buildRehearsalPlan(tracks, firstIncrement) {
  const primaryTrack = tracks.find((track) => track.id === firstIncrement.trackId) || tracks[0];
  const allTrackIds = tracks.map((track) => track.id);
  return {
    scope: {
      primaryTrackId: primaryTrack.id,
      primaryTrackName: primaryTrack.name,
      pilotSize: "单机构/单链路/合成或脱敏样例优先，禁止直接扩大到全量居民或真实生产调度。",
      includedTracks: [primaryTrack.id],
      watchOnlyTracks: allTrackIds.filter((id) => id !== primaryTrack.id)
    },
    timeline: [
      {
        stage: "T-1 preflight",
        owner: "项目办/平台运维/业务责任部门",
        actions: [
          "冻结灰度范围、账号白名单、外部接口地址和回退联系人。",
          "复核 readiness 摘要、现场阻断项和四眼签收材料是否与本次灰度范围一致。",
          "准备停机/弱网/人工流程演练记录模板。"
        ],
        exitCriteria: "所有本次范围内阻断项具备证据编号、责任人和可复核摘要。"
      },
      {
        stage: "T0 rehearsal",
        owner: primaryTrack.department,
        actions: [
          primaryTrack.acceptanceIncrement,
          "记录每个外部接口请求、回执、失败重试、死信补偿和人工复核动作。",
          "验证审计链、证据导出、角色范围和患者安全降级提示。"
        ],
        exitCriteria: "端到端链路闭环成功，且未出现未解释的 P0/P1 安全、隐私或临床风险。"
      },
      {
        stage: "T+1 observation",
        owner: "运维值守/质控复盘/业务负责人",
        actions: [
          "复核告警、审计、接口回执、数据质量和人工处置记录。",
          "完成问题清零、风险豁免或退回整改结论。",
          "归档灰度验收记录，决定是否进入下一专项或下一机构。"
        ],
        exitCriteria: "观察窗口无未关闭 P0/P1 问题，业务和技术双负责人签字。"
      }
    ],
    rollbackTriggers: [
      "外部接口签名、时钟窗口或幂等校验连续失败且无法在灰度窗口内解释。",
      "出现跨居民、跨机构或越权可见的数据范围问题。",
      "急救、输血、影像诊断或体检异常通知出现可能影响患者安全的漏派、误派、漏告或误告。",
      "审计证据、原始记录或回执摘要缺失，导致无法复盘。"
    ],
    dutyRoster: [
      { role: "业务指挥", owner: primaryTrack.department, responsibility: "确认灰度范围、患者安全和业务回退。"},
      { role: "平台运维", owner: "平台运维团队", responsibility: "监控服务、接口、日志、告警和回滚窗口。"},
      { role: "安全审计", owner: "安全管理岗", responsibility: "复核账号、签名、审计链、证据摘要和隐私范围。"},
      { role: "现场联络", owner: "试点机构信息科/科室负责人", responsibility: "协调外部系统、设备、临床科室和纸质降级流程。"}
    ],
    evidenceToArchive: [
      "灰度范围确认单",
      "接口请求/回执样例和签名校验日志",
      "四眼签收记录和 SHA-256 摘要",
      "告警、死信、补偿和人工复核台账",
      "T+1 观察窗口结论和下一步 go/no-go 决策"
    ]
  };
}

function buildGoNoGoDecision(tracks, firstIncrement) {
  const primaryTrack = tracks.find((track) => track.id === firstIncrement.trackId) || tracks[0];
  const hardStops = [
    {
      id: "patient-safety",
      name: "患者安全",
      go: "急救、用血、影像诊断、体检异常通知均无漏派、误派、漏告、误告。",
      noGo: "任一链路出现可能影响患者安全的未解释 P0/P1 事件。"
    },
    {
      id: "scope-and-privacy",
      name: "数据范围与隐私",
      go: "居民、机构、角色和授权范围与灰度名单一致，审计可追溯。",
      noGo: "出现越权可见、跨居民串档、跨机构数据外溢或无法解释的敏感字段暴露。"
    },
    {
      id: "interface-receipt",
      name: "外部接口回执",
      go: "签名、时间窗、幂等、回执、死信补偿均可复核。",
      noGo: "接口连续失败、回执缺失或签名/幂等异常无法在观察窗口内解释。"
    },
    {
      id: "evidence-replay",
      name: "证据复盘",
      go: "事件证据、操作审计、SHA-256 摘要和四眼签收可完整复盘。",
      noGo: "关键证据、原始记录或摘要缺失，导致无法重放业务链路。"
    }
  ];
  const scorecard = [
    { id: "readiness", name: "代码门禁", weight: 20, required: true, current: primaryTrack.codeReady ? "pass" : "fail" },
    { id: "site-evidence", name: "现场证据", weight: 25, required: true, current: primaryTrack.blockers.length === 0 ? "pass" : "pending" },
    { id: "dual-approval", name: "业务/技术双签", weight: 20, required: true, current: primaryTrack.productionReady ? "pass" : "pending" },
    { id: "rollback-ready", name: "回退路径", weight: 15, required: true, current: "ready-to-rehearse" },
    { id: "observation-window", name: "T+1观察", weight: 20, required: true, current: "pending" }
  ];
  const score = scorecard.reduce((sum, item) => sum + (item.current === "pass" ? item.weight : 0), 0);
  return {
    currentDecision: primaryTrack.productionReady ? "go-ready-for-formal-approval" : "no-go-site-evidence-pending",
    primaryTrackId: primaryTrack.id,
    primaryTrackName: primaryTrack.name,
    score,
    threshold: 100,
    scorecard,
    hardStops,
    decisionRules: [
      "任何 hard stop 命中均直接 No-Go，不允许用分数抵消。",
      "所有 required scorecard 项必须通过且总分达到 100，才允许进入正式 go/no-go 会。",
      "ready-to-rehearse 只允许开展受控演练，不代表可扩大灰度或真实上线。",
      "site-pending 状态只能由现场证据和独立复核关闭，不能由本地演示数据关闭。"
    ],
    nextActions: primaryTrack.productionReady
      ? ["准备正式 go/no-go 会签材料。", "安排 T+1 观察窗口和扩大范围审批。"]
      : primaryTrack.blockers.slice(0, 5).map((item) => `补齐 ${item.id}：${item.title}`)
  };
}

function evidenceSeverity(blocker, index) {
  const raw = `${blocker.id || ""} ${blocker.title || ""}`.toLowerCase();
  if (/safety|patient|privacy|scope|signature|receipt|tls|cold|dose|越权|患者|安全|隐私|签名|回执|冷链/.test(raw)) return "P0";
  if (index < 2) return "P0";
  if (index < 5) return "P1";
  return "P2";
}

function evidenceVerificationChecks(track, blocker) {
  const checks = [
    "evidence-id-present",
    "business-and-technical-dual-signoff",
    "sha256-digest-recorded",
    "original-record-replayable",
    "audit-chain-linked"
  ];
  const raw = `${track.id} ${blocker.id || ""} ${blocker.title || ""}`.toLowerCase();
  if (/interface|receipt|pacs|ris|dicom|fhir|bis|btis|gateway|api|接口|回执|网关/.test(raw)) {
    checks.push("external-interface-receipt-matched");
    checks.push("idempotency-key-or-nonce-verified");
  }
  if (/signature|tls|certificate|secret|key|sm2|sm3|签名|证书|密钥|密码/.test(raw)) {
    checks.push("certificate-fingerprint-or-key-custody-verified");
  }
  if (/patient|dispatch|handover|transfusion|report|abnormal|dose|患者|派车|交接|输血|报告|异常|剂量/.test(raw)) {
    checks.push("patient-safety-downgrade-path-verified");
  }
  return [...new Set(checks)];
}

function buildEvidenceDossier(tracks, firstIncrement) {
  const primaryTrackId = firstIncrement.trackId;
  const entries = tracks.flatMap((track) => (track.blockers || []).map((blocker, index) => {
    const severity = evidenceSeverity(blocker, index);
    const evidenceId = `${track.id}:${blocker.id}`;
    return {
      evidenceId,
      trackId: track.id,
      trackName: track.name,
      blockerId: blocker.id,
      title: blocker.title,
      owner: blocker.owner,
      status: blocker.status || "site-pending",
      severity,
      requiredForFirstIncrement: track.id === primaryTrackId && index < 4,
      hardStopIfMissing: severity === "P0",
      requiredArtifacts: [
        "site-signoff-form",
        "external-system-receipt-or-original-record",
        "operator-and-reviewer-identities",
        "sha256-digest-and-timestamp",
        "rollback-or-downgrade-evidence"
      ],
      verificationChecks: evidenceVerificationChecks(track, blocker)
    };
  }));
  const firstIncrementRequired = entries.filter((item) => item.requiredForFirstIncrement);
  return {
    status: entries.every((item) => item.status === "accepted") ? "accepted" : "site-evidence-pending",
    totalEntries: entries.length,
    hardStopOpen: entries.filter((item) => item.hardStopIfMissing && item.status !== "accepted").length,
    firstIncrementRequired: firstIncrementRequired.map((item) => item.evidenceId),
    reviewPolicy: {
      submitterMustDifferFromReviewer: true,
      digestAlgorithm: "sha256",
      retention: "archive with cutover packet and keep original evidence replayable",
      closeRule: "only accepted evidence can close site-pending blockers; demo data cannot close site evidence"
    },
    entries
  };
}

function buildPilotBatchPlan(tracks, firstIncrement) {
  const primaryTrack = tracks.find((track) => track.id === firstIncrement.trackId) || tracks[0];
  const watchOnlyTracks = tracks.filter((track) => track.id !== primaryTrack.id);
  return {
    status: "ready-to-plan-controlled-rehearsal",
    batches: [
      {
        id: "batch-0-preflight",
        name: "Evidence preflight",
        scope: "no live traffic; validate accounts, endpoints, evidence templates and rollback contacts",
        entryCriteria: [
          "all first-increment evidence IDs assigned",
          "commission reviewer and site submitter are different people",
          "rollback contact and manual process are reachable"
        ],
        exitCriteria: [
          "no P0 evidence gap remains unexplained",
          "all required artifacts have a storage location and digest owner"
        ],
        promotionDecision: "allow batch-1 rehearsal only"
      },
      {
        id: "batch-1-single-chain",
        name: primaryTrack.name,
        scope: primaryTrack.acceptanceIncrement,
        entryCriteria: firstIncrement.requiredBeforeStart || [],
        exitCriteria: [
          "end-to-end chain replay succeeds",
          "audit, receipt, retry and manual-review evidence are exported",
          "no patient-safety or privacy hard stop is triggered"
        ],
        promotionDecision: "T+1 observation before any expansion"
      },
      {
        id: "batch-2-watch-only",
        name: "Watch-only specialty expansion",
        scope: watchOnlyTracks.map((track) => track.name).join(" / "),
        entryCriteria: [
          "batch-1 T+1 observation has no open P0/P1 issue",
          "next specialty evidence dossier has no unassigned owner"
        ],
        exitCriteria: [
          "read-only or synthetic flow is observed without production write impact",
          "next go/no-go scorecard is updated"
        ],
        promotionDecision: "select next specialty by risk and evidence completeness"
      }
    ]
  };
}

function buildSiteEvidenceWorkflow(evidenceDossier, pilotBatchPlan) {
  const states = [
    { id: "draft", name: "Evidence drafted", owner: "site submitter", terminal: false },
    { id: "submitted", name: "Submitted for four-eyes review", owner: "site submitter", terminal: false },
    { id: "under-review", name: "Business and technical review", owner: "commission reviewer", terminal: false },
    { id: "returned", name: "Returned for correction", owner: "site submitter", terminal: false },
    { id: "accepted", name: "Accepted and digest-locked", owner: "commission reviewer", terminal: true },
    { id: "expired", name: "Expired after scope or interface change", owner: "release manager", terminal: true }
  ];
  const transitions = [
    {
      from: "draft",
      to: "submitted",
      action: "submit-evidence",
      requiredChecks: ["required-artifacts-present", "sha256-digest-recorded", "operator-and-reviewer-identities-present"]
    },
    {
      from: "submitted",
      to: "under-review",
      action: "start-four-eyes-review",
      requiredChecks: ["submitter-reviewer-separation", "role-scope-verified"]
    },
    {
      from: "under-review",
      to: "accepted",
      action: "accept-evidence",
      requiredChecks: ["verification-checks-pass", "audit-chain-linked", "original-record-replayable"]
    },
    {
      from: "under-review",
      to: "returned",
      action: "return-for-correction",
      requiredChecks: ["rejection-reason-recorded", "next-owner-assigned"]
    },
    {
      from: "returned",
      to: "submitted",
      action: "resubmit-evidence",
      requiredChecks: ["correction-summary-present", "digest-refreshed"]
    },
    {
      from: "accepted",
      to: "expired",
      action: "invalidate-after-scope-change",
      requiredChecks: ["scope-change-or-interface-version-recorded", "new-evidence-required"]
    }
  ];
  const auditEvents = transitions.map((transition) => ({
    eventType: `site-evidence.${transition.action}`,
    requiredFields: ["evidenceId", "trackId", "actor", "role", "from", "to", "occurredAt", "digest", "reason"],
    appendOnly: true
  }));
  const firstBatch = (pilotBatchPlan.batches || []).find((batch) => batch.id === "batch-1-single-chain");
  return {
    currentGate: "submitted-or-accepted-site-evidence-required-before-batch-1",
    states,
    transitions,
    sla: [
      { state: "submitted", targetHours: 24, escalation: "commission release manager" },
      { state: "under-review", targetHours: 48, escalation: "business owner + security audit" },
      { state: "returned", targetHours: 72, escalation: "site liaison" }
    ],
    gateRules: [
      "batch-1-single-chain cannot start until every first-increment evidence entry is submitted or accepted",
      "accepted evidence expires when pilot scope, external endpoint, certificate, device, institution or interface version changes",
      "P0 evidence cannot be bypassed by a waiver; it must be accepted or the decision remains No-Go",
      "returned evidence reopens the linked blocker and resets the Go/No-Go scorecard item to pending"
    ],
    batchOneEntryRequires: {
      batchId: firstBatch?.id || "batch-1-single-chain",
      evidenceIds: evidenceDossier.firstIncrementRequired || [],
      minimumStatus: "submitted",
      preferredStatus: "accepted"
    },
    auditEvents
  };
}

function buildAcceptanceScenarioSuite(tracks, firstIncrement, evidenceDossier, siteEvidenceWorkflow) {
  const primaryTrack = tracks.find((track) => track.id === firstIncrement.trackId) || tracks[0];
  const scenarioProfile = TRACK_SCENARIO_PROFILES[primaryTrack.id] || {
    normalName: `Normal end-to-end ${primaryTrack.name} workflow`,
    normalSteps: ["receive signed source event", "complete controlled business workflow", "export evidence packet and audit digest"],
    normalEvidence: ["signed source receipt", "business workflow record", "audit digest and evidence packet"],
    normalPass: "all source, operator and business records replay in order",
    duplicateMutation: "business workflow record",
    manualPath: "approved specialty downtime path"
  };
  const firstEvidenceIds = evidenceDossier.firstIncrementRequired || [];
  const commonPreconditions = [
    "pilot scope frozen and signed",
    "site evidence workflow gate is at least submitted",
    "operator, reviewer and rollback contacts are assigned",
    "audit export and SHA-256 digest capture are enabled"
  ];
  const scenarios = [
    {
      id: "scenario-1-normal-chain",
      name: scenarioProfile.normalName,
      trackId: primaryTrack.id,
      type: "happy-path",
      batchId: "batch-1-single-chain",
      preconditions: commonPreconditions,
      steps: scenarioProfile.normalSteps,
      expectedEvidence: scenarioProfile.normalEvidence,
      passCriteria: scenarioProfile.normalPass,
      hardStopOnFail: true
    },
    {
      id: "scenario-2-idempotency-replay",
      name: "Duplicate signal and idempotency replay",
      trackId: primaryTrack.id,
      type: "resilience",
      batchId: "batch-1-single-chain",
      preconditions: commonPreconditions,
      steps: [
        "send the same event twice with the same idempotency key",
        "verify the second event is deduplicated",
        "export retry and duplicate-handling evidence"
      ],
      expectedEvidence: [
        "idempotency key ledger",
        "duplicate rejection or merge record",
        "operator-visible retry explanation"
      ],
      passCriteria: `duplicate input cannot create a second ${scenarioProfile.duplicateMutation}`,
      hardStopOnFail: true
    },
    {
      id: "scenario-3-signature-rejection",
      name: "Invalid signature and certificate rejection",
      trackId: primaryTrack.id,
      type: "security-negative",
      batchId: "batch-1-single-chain",
      preconditions: commonPreconditions,
      steps: [
        "submit an event with invalid signature or stale timestamp",
        "verify it is rejected before clinical workflow mutation",
        "record security audit and site liaison notification"
      ],
      expectedEvidence: [
        "signature verification failure",
        "no clinical state mutation proof",
        "security audit event"
      ],
      passCriteria: "invalid messages are rejected, visible to operations and cannot enter patient-facing workflow",
      hardStopOnFail: true
    },
    {
      id: "scenario-4-manual-downgrade",
      name: "Network outage and manual downgrade",
      trackId: primaryTrack.id,
      type: "downgrade",
      batchId: "batch-1-single-chain",
      preconditions: commonPreconditions,
      steps: [
        "simulate external gateway timeout",
        `switch to documented ${scenarioProfile.manualPath}`,
        "backfill evidence after recovery with reviewer signoff"
      ],
      expectedEvidence: [
        "timeout alert",
        "manual downgrade record",
        "backfill review and digest"
      ],
      passCriteria: "patient-safety path remains available and backfilled evidence is distinguishable from real-time events",
      hardStopOnFail: true
    },
    {
      id: "scenario-5-evidence-replay",
      name: "Evidence packet replay and go/no-go update",
      trackId: primaryTrack.id,
      type: "audit-replay",
      batchId: "batch-1-single-chain",
      preconditions: commonPreconditions,
      steps: [
        "load the exported evidence packet",
        "replay audit events and receipts against the scenario timeline",
        "mark accepted evidence or return evidence with reason"
      ],
      expectedEvidence: [
        "evidence packet checksum",
        "append-only audit event sequence",
        "accepted or returned workflow transition"
      ],
      passCriteria: "reviewer can reproduce the chain and update evidence workflow without editing original records",
      hardStopOnFail: false
    }
  ];
  return {
    status: "ready-for-controlled-rehearsal-only",
    primaryTrackId: primaryTrack.id,
    primaryTrackName: primaryTrack.name,
    requiredEvidenceIds: firstEvidenceIds,
    workflowGate: siteEvidenceWorkflow.currentGate,
    summary: {
      scenarios: scenarios.length,
      hardStopScenarios: scenarios.filter((item) => item.hardStopOnFail).length,
      patientSafetyScenarios: scenarios.filter((item) => ["happy-path", "downgrade"].includes(item.type)).length,
      auditReplayScenarios: scenarios.filter((item) => item.type === "audit-replay").length
    },
    executionRules: [
      "run scenarios in batch-1 only after required evidence reaches submitted state",
      "any hard-stop scenario failure immediately keeps the decision at No-Go",
      "scenario evidence must be replayable without mutating original source records",
      "watch-only specialties must not receive production write traffic during this suite"
    ],
    scenarios
  };
}

function buildScenarioEvidenceMatrix(acceptanceScenarioSuite, evidenceDossier, siteEvidenceWorkflow) {
  const evidenceIds = evidenceDossier.firstIncrementRequired || [];
  const workflowEvents = new Set((siteEvidenceWorkflow.auditEvents || []).map((item) => item.eventType));
  const rows = (acceptanceScenarioSuite.scenarios || []).map((scenario) => {
    const scenarioEvidence = evidenceIds.map((evidenceId) => ({
      evidenceId,
      minimumState: scenario.type === "audit-replay" ? "accepted" : "submitted",
      closesBlocker: scenario.type === "audit-replay",
      requiredArtifacts: scenario.expectedEvidence || []
    }));
    const workflowAssertions = [
      "site-evidence.submit-evidence",
      scenario.type === "audit-replay" ? "site-evidence.accept-evidence" : "site-evidence.start-four-eyes-review"
    ].filter((eventType) => workflowEvents.has(eventType) || eventType.startsWith("site-evidence."));
    return {
      scenarioId: scenario.id,
      type: scenario.type,
      batchId: scenario.batchId,
      hardStopOnFail: scenario.hardStopOnFail,
      evidence: scenarioEvidence,
      requiredWorkflowEvents: workflowAssertions,
      goNoGoImpact: scenario.hardStopOnFail ? "keep-no-go-on-failure" : "review-scorecard-after-replay",
      replayRequirement: "must reproduce steps, receipts, identities, timestamps and digest without editing original records",
      acceptanceResult: "not-run"
    };
  });
  return {
    status: "not-run",
    rows,
    summary: {
      scenarios: rows.length,
      evidenceLinks: rows.reduce((sum, row) => sum + row.evidence.length, 0),
      hardStopRows: rows.filter((row) => row.hardStopOnFail).length,
      replayRows: rows.filter((row) => row.type === "audit-replay").length
    },
    decisionRules: [
      "all hard-stop rows must pass before any Go/No-Go score can increase",
      "audit-replay row must prove evidence closure without source-record mutation",
      "missing required workflow event keeps the linked evidence item at submitted or returned",
      "matrix status remains not-run until every row has accepted, returned or failed result"
    ]
  };
}

function buildCutoverCommandCenter(tracks, firstIncrement, pilotBatchPlan, siteEvidenceWorkflow, scenarioEvidenceMatrix) {
  const primaryTrack = tracks.find((track) => track.id === firstIncrement.trackId) || tracks[0];
  const firstBatch = (pilotBatchPlan.batches || []).find((batch) => batch.id === "batch-1-single-chain") || {};
  const evidenceIds = siteEvidenceWorkflow.batchOneEntryRequires?.evidenceIds || [];
  const hardStopRows = (scenarioEvidenceMatrix.rows || []).filter((row) => row.hardStopOnFail);
  const watchOnlyTracks = tracks.filter((track) => track.id !== primaryTrack.id);
  const windows = [
    {
      id: "window-t-1-freeze",
      name: "T-1 scope freeze and evidence preflight",
      stage: "T-1",
      ownerRole: "release commander",
      ownerDepartment: "commission release office + platform operations",
      entryGate: "all pilot scope, endpoint, account, evidence and rollback owners are assigned",
      exitGate: "first-increment evidence reaches submitted state and batch-1 scope is frozen",
      requiredInputs: evidenceIds,
      produces: ["frozen pilot roster", "signed evidence preflight checklist", "rollback contact sheet"],
      noGoIfMissing: ["required evidence owner", "external endpoint receipt", "rollback contact"]
    },
    {
      id: "window-t0-controlled-rehearsal",
      name: "T0 controlled batch-1 rehearsal",
      stage: "T0",
      ownerRole: "business commander",
      ownerDepartment: primaryTrack.department,
      entryGate: firstBatch.promotionDecision || "allow batch-1 rehearsal only",
      exitGate: "all hard-stop scenarios pass or remain No-Go with recorded reason",
      requiredInputs: hardStopRows.map((row) => row.scenarioId),
      produces: ["scenario run sheet", "interface receipt ledger", "manual downgrade proof", "audit export digest"],
      noGoIfMissing: ["patient safety proof", "signature/idempotency proof", "append-only audit digest"]
    },
    {
      id: "window-t-plus-1-observation",
      name: "T+1 observation and promotion decision",
      stage: "T+1",
      ownerRole: "quality reviewer",
      ownerDepartment: "operations duty + quality control + business owner",
      entryGate: "batch-1 rehearsal has no unexplained P0/P1 issue",
      exitGate: "decide stay No-Go, repeat batch-1, or open watch-only batch-2",
      requiredInputs: ["alert review", "audit replay", "data-quality sample", "manual-handling review"],
      produces: ["T+1 observation memo", "go/no-go scorecard update", "next specialty watch-only recommendation"],
      noGoIfMissing: ["unexplained P0/P1 event", "missing audit replay", "unreviewed manual handling"]
    }
  ];
  return {
    status: "command-center-ready-for-rehearsal",
    primaryTrackId: primaryTrack.id,
    primaryTrackName: primaryTrack.name,
    watchOnlyTrackIds: watchOnlyTracks.map((track) => track.id),
    windows,
    roster: [
      { seat: "release-commander", owner: "commission release office", decisionRight: "freeze scope, pause rehearsal, call No-Go" },
      { seat: "business-commander", owner: primaryTrack.department, decisionRight: "confirm patient-safety continuity and manual downgrade" },
      { seat: "operations-duty", owner: "platform operations", decisionRight: "observe service, logs, alerts, rollback window and deployment health" },
      { seat: "security-audit", owner: "security office", decisionRight: "reject unsigned, over-scoped or unreplayable evidence" },
      { seat: "site-liaison", owner: "pilot institution information office", decisionRight: "coordinate external system, device and clinical department availability" }
    ],
    escalationRules: [
      "any P0 patient-safety, privacy or security event pages release-commander and business-commander immediately",
      "two consecutive unexplained interface failures pause batch-1 and switch to manual downgrade",
      "missing append-only audit evidence keeps the decision No-Go even when the business flow appears successful",
      "watch-only specialty expansion can start only after the T+1 observation memo is accepted"
    ],
    decisionArtifacts: [
      "frozen-scope-sheet",
      "command-roster-and-contact-sheet",
      "scenario-run-sheet",
      "interface-and-idempotency-ledger",
      "manual-downgrade-or-rollback-proof",
      "t-plus-1-observation-memo"
    ],
    summary: {
      windows: windows.length,
      rosterSeats: 5,
      watchOnlyTracks: watchOnlyTracks.length,
      noGoRules: windows.reduce((sum, window) => sum + window.noGoIfMissing.length, 0)
    }
  };
}

function buildObservationSignalBoard(tracks, firstIncrement, cutoverCommandCenter, scenarioEvidenceMatrix) {
  const primaryTrack = tracks.find((track) => track.id === firstIncrement.trackId) || tracks[0];
  const hardStopScenarioIds = (scenarioEvidenceMatrix.rows || [])
    .filter((row) => row.hardStopOnFail)
    .map((row) => row.scenarioId);
  const commandSeats = new Set((cutoverCommandCenter.roster || []).map((item) => item.seat));
  const lanes = [
    {
      id: "lane-patient-safety",
      name: "Patient safety continuity",
      ownerSeat: "business-commander",
      source: "manual downgrade log + scenario run sheet + clinical handover acknowledgement",
      signals: [
        { id: "missed-dispatch-or-handover", metric: "missed dispatch / handover / notification", threshold: 0, severity: "P0" },
        { id: "manual-downgrade-reachable", metric: "manual downgrade path reachable", threshold: "100%", severity: "P0" }
      ],
      noGoRule: "any missed dispatch, handover, notification or unreachable manual downgrade path keeps the decision No-Go",
      evidenceArtifact: "patient-safety-continuity-review"
    },
    {
      id: "lane-interface-reliability",
      name: "Signed interface and idempotency",
      ownerSeat: "operations-duty",
      source: "interface receipt ledger + idempotency ledger + retry/dead-letter queue",
      signals: [
        { id: "unexplained-interface-failure", metric: "consecutive unexplained failures", threshold: 2, severity: "P1" },
        { id: "duplicate-mutation", metric: "duplicate input causing second mutation", threshold: 0, severity: "P0" }
      ],
      noGoRule: "duplicate mutation is a hard No-Go; two unexplained failures pause batch-1 and require manual downgrade review",
      evidenceArtifact: "interface-and-idempotency-observation"
    },
    {
      id: "lane-data-quality-scope",
      name: "Data quality, scope and privacy",
      ownerSeat: "security-audit",
      source: "resident scope sample + role audit + cross-institution visibility review",
      signals: [
        { id: "over-scoped-data-visible", metric: "over-scoped resident or institution data visibility", threshold: 0, severity: "P0" },
        { id: "unmatched-handover-fields", metric: "unmatched required handover fields", threshold: 0, severity: "P1" }
      ],
      noGoRule: "any over-scoped data visibility keeps the decision No-Go until root cause and evidence are accepted",
      evidenceArtifact: "scope-and-data-quality-sample"
    },
    {
      id: "lane-evidence-audit",
      name: "Evidence replay and audit completeness",
      ownerSeat: "release-commander",
      source: "append-only audit export + evidence packet digest + four-eyes review events",
      signals: [
        { id: "missing-audit-event", metric: "missing append-only audit event", threshold: 0, severity: "P0" },
        { id: "digest-mismatch", metric: "evidence packet digest mismatch", threshold: 0, severity: "P0" }
      ],
      noGoRule: "missing audit events or digest mismatch keep the decision No-Go even if the business flow appears successful",
      evidenceArtifact: "audit-replay-and-digest-review"
    }
  ].map((lane) => ({
    ...lane,
    commandSeatReady: commandSeats.has(lane.ownerSeat),
    linkedScenarios: lane.id === "lane-evidence-audit" ? ["scenario-5-evidence-replay"] : hardStopScenarioIds
  }));
  return {
    status: "observation-ready",
    observationWindow: "T+1",
    primaryTrackId: primaryTrack.id,
    primaryTrackName: primaryTrack.name,
    lanes,
    decisionOutcomes: [
      { id: "stay-no-go", when: "any P0 signal is open or audit evidence is unreplayable", nextStep: "pause expansion and return evidence for correction" },
      { id: "repeat-batch-1", when: "P1 signal is explained but needs another controlled run", nextStep: "rerun the affected scenario before scorecard update" },
      { id: "open-watch-only-batch-2", when: "all lanes are green and T+1 observation memo is accepted", nextStep: "start read-only or synthetic watch-only flow for the next specialty" }
    ],
    requiredArtifacts: [
      "t-plus-1-observation-memo",
      "patient-safety-continuity-review",
      "interface-and-idempotency-observation",
      "scope-and-data-quality-sample",
      "audit-replay-and-digest-review"
    ],
    summary: {
      lanes: lanes.length,
      p0Signals: lanes.flatMap((lane) => lane.signals).filter((signal) => signal.severity === "P0").length,
      commandSeatsReady: lanes.filter((lane) => lane.commandSeatReady).length,
      hardStopScenarioLinks: lanes.reduce((sum, lane) => sum + lane.linkedScenarios.length, 0)
    }
  };
}

function buildRuntimeSmokePlan(tracks, firstIncrement, observationSignalBoard) {
  const primaryTrack = tracks.find((track) => track.id === firstIncrement.trackId) || tracks[0];
  const trackRoutes = tracks.map((track) => ({
    trackId: track.id,
    page: track.page,
    api: track.api,
    expectedState: track.id === primaryTrack.id ? "controlled-rehearsal-only" : "watch-only"
  }));
  const suites = [
    {
      id: "smoke-artifact-generation",
      name: "Cutover artifact generation",
      automation: "automated",
      command: "node emergency-specialty-cutover.js",
      checks: [
        "release/t10-specialty-cutover-pack.json exists",
        "release/t10-specialty-cutover-pack.md exists",
        "integrity digest is sha256-addressed",
        "formalGoLiveState remains blocked until site evidence is accepted",
        "institution package plan and all 15 non-empty specialty combinations are valid",
        "institution operations lifecycle implements configuration, signing, evidence, rehearsal, observation and rollback",
        "specialty plan review has complete source and acceptance-test evidence for every selected capability",
        "external site and T00 actions use assignment, digest evidence, independent review, escalation and reopen controls",
        "portable external action executor enforces optimistic concurrency, exclusive locking and atomic persistence"
      ],
      failureAction: "stop release packaging and keep batch-1 closed"
    },
    {
      id: "smoke-static-preview",
      name: "Static preview and route rendering",
      automation: "automated-or-browser",
      command: "open t10-specialty-cutover.html and specialty pages",
      checks: [
        "t10-specialty-cutover.html renders release artifact or fallback pack",
        ...trackRoutes.map((route) => `${route.page} loads for ${route.trackId}`),
        "runtime smoke, observation and command-center sections are visible"
      ],
      failureAction: "fix frontend projection before any production rehearsal"
    },
    {
      id: "smoke-server-api",
      name: "Server API and authorization contract",
      automation: "automated",
      command: "GET /api/t10-specialty/cutover-pack with commission role",
      checks: [
        "/api/t10-specialty/cutover-pack returns the same module id",
        "/api/t10-specialty-cutover remains available as compatibility route",
        ...trackRoutes.map((route) => `${route.api} remains protected and reachable for ${route.trackId}`)
      ],
      failureAction: "do not start batch-1 until API auth and route contracts pass"
    },
    {
      id: "smoke-release-gates",
      name: "Release report and deployment gates",
      automation: "automated",
      command: "node --test test/emergency-specialty-cutover.test.js test/t10-runtime-smoke.test.js && node scripts/t10-runtime-smoke.js && npm run release:report && npm run deploy:check",
      checks: [
        "focused T10 tests pass",
        "release report has zero error failures",
        "deploy check has zero failed gates",
        "runtime smoke plan is included in the public integration checks"
      ],
      failureAction: "block deploy and return to code readiness"
    },
    {
      id: "smoke-observation-artifacts",
      name: "T+1 observation artifact readiness",
      automation: "manual-with-audit",
      command: "review observation lanes and attach required artifacts",
      checks: observationSignalBoard.requiredArtifacts || [],
      failureAction: "stay No-Go or repeat batch-1; do not open watch-only batch-2"
    }
  ];
  return {
    status: "ready-for-runtime-smoke",
    launchMode: "controlled-rehearsal-only",
    primaryTrackId: primaryTrack.id,
    primaryTrackName: primaryTrack.name,
    trackRoutes,
    suites,
    hardStops: [
      "any failed automated smoke suite blocks runtime launch",
      "any missing T+1 observation artifact keeps the release at No-Go",
      "server API smoke cannot be waived by static preview success",
      "watch-only expansion cannot start until release report and deploy check are both green"
    ],
    summary: {
      suites: suites.length,
      automatedSuites: suites.filter((suite) => suite.automation !== "manual-with-audit").length,
      manualSuites: suites.filter((suite) => suite.automation === "manual-with-audit").length,
      routeChecks: trackRoutes.length,
      hardStops: 4
    }
  };
}

function renderMarkdown(pack) {
  const rows = pack.tracks.map((item) => `| ${item.name} | ${item.department} | ${item.codeReady ? "是" : "否"} | ${item.productionReady ? "是" : "否"} | ${item.blockers.length} | ${item.page} |`);
  const moduleRows = (pack.moduleCatalog?.modules || []).map((item) => `| ${item.name} | ${item.deploymentUnit} | ${item.selected ? "yes" : "no"} | ${item.requiredPeerModules.length} | ${item.page} | ${item.api} |`);
  const deploymentRows = (pack.institutionDeploymentManifest?.enabledModules || []).map((item) => `| ${item.name} | ${item.deploymentUnit} | ${item.page} | ${item.api} | ${item.dataNamespace} | ${item.rollbackUnit} |`);
  const blockers = pack.tracks.flatMap((track) => track.blockers.map((item) => `| ${track.name} | ${item.id} | ${item.title} | ${item.owner} | ${item.status} |`));
  const evidenceRows = (pack.evidenceDossier?.entries || []).map((item) => `| ${item.trackName} | ${item.evidenceId} | ${item.severity} | ${item.requiredForFirstIncrement ? "yes" : "no"} | ${item.hardStopIfMissing ? "yes" : "no"} | ${item.status} |`);
  const batchRows = (pack.pilotBatchPlan?.batches || []).map((item) => `| ${item.id} | ${item.name} | ${item.scope} | ${item.promotionDecision} |`);
  const workflowRows = (pack.siteEvidenceWorkflow?.transitions || []).map((item) => `| ${item.from} | ${item.action} | ${item.to} | ${item.requiredChecks.join(", ")} |`);
  const scenarioRows = (pack.acceptanceScenarioSuite?.scenarios || []).map((item) => `| ${item.id} | ${item.type} | ${item.batchId} | ${item.hardStopOnFail ? "yes" : "no"} | ${item.passCriteria} |`);
  const scenarioEvidenceRows = (pack.scenarioEvidenceMatrix?.rows || []).map((item) => `| ${item.scenarioId} | ${item.evidence.length} | ${item.requiredWorkflowEvents.join(", ")} | ${item.goNoGoImpact} | ${item.acceptanceResult} |`);
  const commandWindowRows = (pack.cutoverCommandCenter?.windows || []).map((item) => `| ${item.stage} | ${item.id} | ${item.name} | ${item.ownerRole} | ${item.entryGate} | ${item.exitGate} |`);
  const commandRosterRows = (pack.cutoverCommandCenter?.roster || []).map((item) => `| ${item.seat} | ${item.owner} | ${item.decisionRight} |`);
  const observationLaneRows = (pack.observationSignalBoard?.lanes || []).map((item) => `| ${item.id} | ${item.ownerSeat} | ${item.signals.length} | ${item.noGoRule} | ${item.evidenceArtifact} |`);
  const runtimeSmokeRows = (pack.runtimeSmokePlan?.suites || []).map((item) => `| ${item.id} | ${item.automation} | ${item.command} | ${item.checks.length} | ${item.failureAction} |`);
  const operationsRows = (pack.institutionOperationsCapabilityPlan?.capabilities || []).map((item) => `| ${item.id} | ${item.status} | ${item.acceptance} |`);
  const planCoverageRows = (pack.specialtyPlanReview?.trackReviews || []).map((item) => `| ${item.trackName} | ${item.summary.implemented}/${item.summary.planned} | ${item.summary.missing} | ${item.summary.externalActions} | ${item.formalState} |`);
  const externalActionRows = (pack.specialtyPlanReview?.externalActions || []).map((item) => `| ${item.priority} | ${item.trackName} | ${item.dependencyType} | ${item.owner} | ${item.action} |`);
  const workflowGateRows = (pack.externalActionWorkflowPlan?.trackGates || []).map((item) => `| ${item.trackId} | ${item.status} | ${item.summary.accepted}/${item.summary.total} | ${item.summary.openP0} | ${item.nextDecision} |`);
  return [
    "# T10 急救、用血、影像与体检专项上线割接包",
    "",
    `- Generated at: ${pack.generatedAt}`,
    `- Formal go-live state: ${pack.summary.formalGoLiveState}`,
    `- Code readiness: ${pack.summary.codeReady}/${pack.summary.tracks}`,
    `- Production readiness: ${pack.summary.productionReady}/${pack.summary.tracks}`,
    `- Site blockers: ${pack.summary.siteBlockers}`,
    `- Integrity: ${pack.integrity.digest}`,
    "",
    "## Institution module selection",
    "",
    `- Selection mode: ${pack.moduleCatalog?.selectionMode || "composable-module-suite"}`,
    `- Enabled modules: ${(pack.moduleCatalog?.enabledModuleIds || pack.tracks.map((item) => item.id)).join(", ")}`,
    `- Peer specialty dependencies: ${pack.moduleCatalog?.peerModuleDependencyCount || 0}`,
    "",
    "| Module | Deployment unit | Enabled | Peer dependencies | Page | API |",
    "|---|---|---:|---:|---|---|",
    ...moduleRows,
    "",
    "## Institution deployment manifest",
    "",
    `- Institution: ${pack.institutionDeploymentManifest?.institutionId || "institution-template"}`,
    `- Activation policy: ${pack.institutionDeploymentManifest?.activationPolicy || "deny-by-default"}`,
    `- Production traffic: ${pack.institutionDeploymentManifest?.productionTrafficState || "blocked-until-site-evidence-signed"}`,
    `- Deployment gate: ${pack.institutionDeploymentGate?.status || "deployment-contract-blocked"} (${pack.institutionDeploymentGate?.summary?.passed || 0}/${pack.institutionDeploymentGate?.summary?.total || 0})`,
    `- Compatibility matrix: ${pack.specialtyCompatibilityMatrix?.passedCombinations || 0}/${pack.specialtyCompatibilityMatrix?.totalCombinations || 0}`,
    `- Institution package: ${pack.institutionPackagePlan?.status || "institution-package-blocked"}`,
    `- Disabled modules: ${(pack.institutionDeploymentManifest?.disabledModuleIds || []).join(", ") || "none"}`,
    "",
    "| Module | Deployment unit | Page allowlist | API allowlist | Data namespace | Rollback unit |",
    "|---|---|---|---|---|---|",
    ...deploymentRows,
    "",
    "### Deployment validation rules",
    "",
    ...(pack.institutionDeploymentManifest?.validationRules || []).map((item) => `- ${item}`),
    "",
    "### Institution package artifacts",
    "",
    ...(pack.institutionPackagePlan?.artifacts || []).map((item) => `- ${item.file}: ${item.purpose}`),
    "",
    "## Institution operations capability",
    "",
    `- Status: ${pack.institutionOperationsCapabilityPlan?.status || "institution-operations-blocked"}`,
    `- Code readiness: ${pack.institutionOperationsCapabilityPlan?.summary?.implemented || 0}/${pack.institutionOperationsCapabilityPlan?.summary?.capabilities || 0}`,
    `- Formal boundary: ${pack.institutionOperationsCapabilityPlan?.formalGoLiveBoundary || "site evidence and formal approval remain required"}`,
    "",
    "| Capability | Status | Acceptance |",
    "|---|---|---|",
    ...operationsRows,
    "",
    "## Specialty plan coverage review",
    "",
    `- Status: ${pack.specialtyPlanReview?.status || "specialty-plan-review-missing"}`,
    `- Code coverage: ${pack.specialtyPlanReview?.summary?.implementedCapabilities || 0}/${pack.specialtyPlanReview?.summary?.plannedCapabilities || 0}`,
    `- Open external actions: ${pack.specialtyPlanReview?.summary?.externalActions || 0}`,
    `- Boundary: ${pack.specialtyPlanReview?.productionBoundary || "formal production still requires site evidence"}`,
    "",
    "| Specialty | Implemented/planned | Missing | External actions | Formal state |",
    "|---|---:|---:|---:|---|",
    ...planCoverageRows,
    "",
    "### Remaining external actions",
    "",
    "| Priority | Specialty | Dependency | Owner | Action |",
    "|---|---|---|---|---|",
    ...externalActionRows,
    "",
    "### External action execution workflow",
    "",
    `- Status: ${pack.externalActionWorkflowPlan?.status || "external-action-workflow-missing"}`,
    `- States: ${(pack.externalActionWorkflowPlan?.states || []).join(" -> ")}`,
    `- Formal boundary: ${pack.externalActionWorkflowPlan?.formalBoundary || "formal Go/No-Go remains required"}`,
    "",
    "| Track | Gate | Accepted | Open P0 | Next decision |",
    "|---|---|---:|---:|---|",
    ...workflowGateRows,
    "",
    "## 专项状态",
    "",
    "| 专项 | 责任部门 | 代码就绪 | 生产就绪 | 现场阻断 | 页面 |",
    "|---|---|---:|---:|---:|---|",
    ...rows,
    "",
    "## 首个可验收灰度增量",
    "",
    `- Track: ${pack.firstIncrement.trackName}`,
    `- Recommendation: ${pack.firstIncrement.recommendation}`,
    `- Why: ${pack.firstIncrement.why}`,
    "",
    "## 现场阻断项",
    "",
    "| 专项 | 编号 | 阻断项 | 责任方 | 状态 |",
    "|---|---|---|---|---|",
    ...blockers,
    "",
    "## 跨专项控制",
    "",
    ...pack.crossTrackControls.map((item) => `- ${item.name}（${item.owner}）：${item.acceptance}`),
    "",
    "## 灰度演练计划",
    "",
    `- Primary track: ${pack.rehearsalPlan.scope.primaryTrackName}`,
    `- Pilot size: ${pack.rehearsalPlan.scope.pilotSize}`,
    "",
    ...pack.rehearsalPlan.timeline.map((item) => `### ${item.stage}\n\n- Owner: ${item.owner}\n- Exit criteria: ${item.exitCriteria}\n${item.actions.map((action) => `- ${action}`).join("\n")}`),
    "",
    "## 回退触发",
    "",
    ...pack.rehearsalPlan.rollbackTriggers.map((item) => `- ${item}`),
    "",
    "## Go/No-Go 决策矩阵",
    "",
    `- Current decision: ${pack.goNoGoDecision.currentDecision}`,
    `- Score: ${pack.goNoGoDecision.score}/${pack.goNoGoDecision.threshold}`,
    "",
    "| 项 | 权重 | 必须 | 当前 |",
    "|---|---:|---:|---|",
    ...pack.goNoGoDecision.scorecard.map((item) => `| ${item.name} | ${item.weight} | ${item.required ? "yes" : "no"} | ${item.current} |`),
    "",
    "### Hard stops",
    "",
    ...pack.goNoGoDecision.hardStops.map((item) => `- ${item.name}: ${item.noGo}`),
    "",
    "## Site evidence dossier",
    "",
    `- Status: ${pack.evidenceDossier?.status || "site-evidence-pending"}`,
    `- Entries: ${pack.evidenceDossier?.totalEntries || 0}`,
    `- Open hard stops: ${pack.evidenceDossier?.hardStopOpen || 0}`,
    "",
    "| Track | Evidence ID | Severity | First increment | Hard stop | Status |",
    "|---|---|---:|---:|---:|---|",
    ...evidenceRows,
    "",
    "## Controlled pilot batch plan",
    "",
    "| Batch | Name | Scope | Promotion decision |",
    "|---|---|---|---|",
    ...batchRows,
    "",
    "## Site evidence workflow",
    "",
    `- Current gate: ${pack.siteEvidenceWorkflow?.currentGate || "submitted-or-accepted-site-evidence-required-before-batch-1"}`,
    `- Batch-1 minimum status: ${pack.siteEvidenceWorkflow?.batchOneEntryRequires?.minimumStatus || "submitted"}`,
    "",
    "| From | Action | To | Required checks |",
    "|---|---|---|---|",
    ...workflowRows,
    "",
    "### Workflow gate rules",
    "",
    ...(pack.siteEvidenceWorkflow?.gateRules || []).map((item) => `- ${item}`),
    "",
    "## Acceptance scenario suite",
    "",
    `- Status: ${pack.acceptanceScenarioSuite?.status || "ready-for-controlled-rehearsal-only"}`,
    `- Primary track: ${pack.acceptanceScenarioSuite?.primaryTrackName || pack.firstIncrement.trackName}`,
    `- Workflow gate: ${pack.acceptanceScenarioSuite?.workflowGate || "submitted-or-accepted-site-evidence-required-before-batch-1"}`,
    "",
    "| Scenario | Type | Batch | Hard stop | Pass criteria |",
    "|---|---|---|---:|---|",
    ...scenarioRows,
    "",
    "### Scenario execution rules",
    "",
    ...(pack.acceptanceScenarioSuite?.executionRules || []).map((item) => `- ${item}`),
    "",
    "## Scenario evidence matrix",
    "",
    `- Status: ${pack.scenarioEvidenceMatrix?.status || "not-run"}`,
    `- Evidence links: ${pack.scenarioEvidenceMatrix?.summary?.evidenceLinks || 0}`,
    "",
    "| Scenario | Evidence links | Workflow events | Go/No-Go impact | Result |",
    "|---|---:|---|---|---|",
    ...scenarioEvidenceRows,
    "",
    "### Matrix decision rules",
    "",
    ...(pack.scenarioEvidenceMatrix?.decisionRules || []).map((item) => `- ${item}`),
    "",
    "## Cutover command center",
    "",
    `- Status: ${pack.cutoverCommandCenter?.status || "command-center-ready-for-rehearsal"}`,
    `- Primary track: ${pack.cutoverCommandCenter?.primaryTrackName || pack.firstIncrement.trackName}`,
    `- Watch-only tracks: ${(pack.cutoverCommandCenter?.watchOnlyTrackIds || []).join(", ")}`,
    "",
    "| Stage | Window ID | Window | Owner role | Entry gate | Exit gate |",
    "|---|---|---|---|---|---|",
    ...commandWindowRows,
    "",
    "| Seat | Owner | Decision right |",
    "|---|---|---|",
    ...commandRosterRows,
    "",
    "### Command escalation rules",
    "",
    ...(pack.cutoverCommandCenter?.escalationRules || []).map((item) => `- ${item}`),
    "",
    "## Observation signal board",
    "",
    `- Status: ${pack.observationSignalBoard?.status || "observation-ready"}`,
    `- Window: ${pack.observationSignalBoard?.observationWindow || "T+1"}`,
    `- P0 signals: ${pack.observationSignalBoard?.summary?.p0Signals || 0}`,
    "",
    "| Lane | Owner seat | Signals | No-Go rule | Evidence artifact |",
    "|---|---|---:|---|---|",
    ...observationLaneRows,
    "",
    "### Observation outcomes",
    "",
    ...(pack.observationSignalBoard?.decisionOutcomes || []).map((item) => `- ${item.id}: ${item.when} -> ${item.nextStep}`),
    "",
    "## Runtime smoke plan",
    "",
    `- Status: ${pack.runtimeSmokePlan?.status || "ready-for-runtime-smoke"}`,
    `- Launch mode: ${pack.runtimeSmokePlan?.launchMode || "controlled-rehearsal-only"}`,
    `- Primary track: ${pack.runtimeSmokePlan?.primaryTrackName || pack.firstIncrement.trackName}`,
    "",
    "| Suite | Automation | Command | Checks | Failure action |",
    "|---|---|---|---:|---|",
    ...runtimeSmokeRows,
    "",
    "### Runtime smoke hard stops",
    "",
    ...(pack.runtimeSmokePlan?.hardStops || []).map((item) => `- ${item}`),
    ""
  ].join("\n");
}

function writeCutoverPack(pack, options = {}) {
  const outputDir = options.outputDir || path.join(__dirname, "release");
  fs.mkdirSync(outputDir, { recursive: true });
  const jsonPath = path.join(outputDir, options.jsonName || "t10-specialty-cutover-pack.json");
  const markdownPath = path.join(outputDir, options.markdownName || "t10-specialty-cutover-pack.md");
  fs.writeFileSync(jsonPath, `${JSON.stringify(pack, null, 2)}\n`, "utf8");
  fs.writeFileSync(markdownPath, renderMarkdown(pack), "utf8");
  return { jsonPath, markdownPath };
}

function parseCliOptions(argv = process.argv.slice(2), env = process.env) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--tracks") {
      options.enabledTrackIds = String(argv[index + 1] || "").split(",").map((item) => item.trim()).filter(Boolean);
      index += 1;
    } else if (argument === "--output-prefix") {
      options.outputPrefix = String(argv[index + 1] || "").trim();
      index += 1;
    } else if (argument === "--institution-id") {
      options.institutionId = String(argv[index + 1] || "").trim();
      index += 1;
    } else {
      throw new Error(`unknown argument: ${argument}`);
    }
  }
  if (!options.enabledTrackIds && env.T10_ENABLED_TRACKS) {
    options.enabledTrackIds = env.T10_ENABLED_TRACKS.split(",").map((item) => item.trim()).filter(Boolean);
  }
  if (options.outputPrefix && !/^[a-z0-9][a-z0-9-]*$/i.test(options.outputPrefix)) {
    throw new Error("output prefix may contain only letters, numbers and hyphens");
  }
  if (options.institutionId && !/^[a-z0-9][a-z0-9._-]*$/i.test(options.institutionId)) {
    throw new Error("institution id may contain only letters, numbers, dots, underscores and hyphens");
  }
  return options;
}

function runCli() {
  const cli = parseCliOptions();
  const pack = buildSpecialtyCutoverPack({
    enabledTrackIds: cli.enabledTrackIds,
    institutionId: cli.institutionId
  });
  const output = writeCutoverPack(pack, cli.outputPrefix ? {
    jsonName: `${cli.outputPrefix}.json`,
    markdownName: `${cli.outputPrefix}.md`
  } : {});
  console.log(JSON.stringify({ summary: pack.summary, firstIncrement: pack.firstIncrement, integrity: pack.integrity, output }, null, 2));
  if (pack.summary.codeReady !== pack.summary.tracks) process.exitCode = 1;
}

if (require.main === module) runCli();

module.exports = {
  DEFAULT_TRACKS,
  CUTOVER_STAGES,
  SPECIALTY_MODULE_BOUNDARIES,
  TRACK_SCENARIO_PROFILES,
  buildSpecialtyCutoverPack,
  buildModuleCatalog,
  buildInstitutionDeploymentManifest,
  validateInstitutionDeploymentManifest,
  enumerateSpecialtySelections,
  buildSpecialtyCompatibilityMatrix,
  buildInstitutionPackagePlan,
  resolveEnabledTracks,
  parseCliOptions,
  renderMarkdown,
  writeCutoverPack,
  normalizeTrack,
  selectFirstIncrement,
  buildRehearsalPlan,
  buildGoNoGoDecision,
  buildEvidenceDossier,
  buildPilotBatchPlan,
  buildSiteEvidenceWorkflow,
  buildAcceptanceScenarioSuite,
  buildScenarioEvidenceMatrix,
  buildCutoverCommandCenter,
  buildObservationSignalBoard,
  buildRuntimeSmokePlan
};
