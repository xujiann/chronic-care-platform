"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const SPECIALTY_PLAN_CATALOG = Object.freeze({
  "emergency-life-chain": {
    name: "120急救生命链",
    owner: "市急救中心/卫健应急办",
    capabilities: [
      capability("assisted-call-and-triage", "P0", "120辅助呼救、受理和分级", ["emergency-service.js"], ["test/emergency-service.test.js"]),
      capability("dispatch-clinical-state-machine", "P0", "调度、出车、到场、转运和任务闭环状态机", ["emergency-service.js"], ["test/emergency-service.test.js"]),
      capability("prehospital-hospital-handover", "P0", "院前院内电子交接和WS/T 621验收", ["emergency-module-gate.js"], ["test/emergency-module-gate.test.js"]),
      capability("sos-aed-responder-chain", "P0", "SOS、AED与黄金四分钟响应协同", ["emergency-lifechain.js"], ["test/emergency-lifechain.test.js"]),
      capability("trusted-device-gateway", "P0", "设备证明、签名信号、防重放和凭据轮换", ["emergency-device-gateway.js"], ["test/emergency-device-gateway.test.js"]),
      capability("green-channel-family-fallback", "P1", "绿色通道、家庭协作、弱网降级和撤回复核", ["emergency-lifechain.js"], ["test/emergency-lifechain.test.js"]),
      capability("evidence-export-and-quality", "P0", "事件证据包、角色隔离和质量复盘", ["emergency-service.js", "docs/emergency-evidence-export.md"], ["test/emergency-service.test.js"]),
      capability("production-control-and-rollback", "P0", "端点探测、可靠消息、演练、观察和回退门禁", ["emergency-production.js", "emergency-module-gate.js"], ["test/emergency-production.test.js", "test/emergency-module-gate.test.js"])
    ],
    remainingActions: [
      action("EMG-NEXT-01", "P0", "site", "完成CTI、定位、车载设备、医院和区域平台真实接口联调及四眼签收"),
      action("EMG-NEXT-02", "P0", "t00", "由T00绑定急救领域路由并完成鉴权、事务持久化和HTTP验收"),
      action("EMG-NEXT-03", "P1", "site", "按99.99%可用性、3秒调度确认和15分钟RTO执行现场容量与灾备验收")
    ]
  },
  "clinical-blood": {
    name: "临床用血",
    owner: "血液中心/医院输血科/医务部",
    capabilities: [
      capability("bis-btis-business-domains", "P0", "BIS/BTIS十二业务域与岗位范围", ["blood-business-service.js"], ["test/blood-business-service.test.js"]),
      capability("bag-master-data-and-trace", "P0", "血袋唯一标识、版本化主数据和全链追溯", ["blood-clinical-production.js", "blood-master-data.js"], ["test/blood-clinical-production.test.js", "test/blood-domain.test.js"]),
      capability("one-bag-transaction-chain", "P0", "检测签发、双人放行、交付、配血、床旁输注和评价", ["blood-transaction-service.js"], ["test/blood-transaction-service.test.js"]),
      capability("clinical-safety-hard-stops", "P0", "冷链、交叉配血、身份核对和重复操作硬阻断", ["blood-transaction-service.js", "blood-domain.js"], ["test/blood-transaction-service.test.js", "test/blood-domain.test.js"]),
      capability("recall-reaction-emergency", "P0", "召回签收关闭、反应调查和应急调配", ["blood-service.js"], ["test/blood-recall-workflow.test.js", "test/blood-service.test.js"]),
      capability("integration-idempotency-dlq", "P0", "BIS/BTIS消息契约、幂等、重试和死信", ["blood-integration-gateway.js"], ["test/blood-integration-gateway.test.js"]),
      capability("event-hub-and-projections", "P1", "事件发布、订阅投影、补偿和交付证据", ["blood-event-hub.js"], ["test/blood-event-hub.test.js"]),
      capability("production-evidence-and-isolation", "P0", "主数据、冷链、场景、冒烟、回退和独立部署门禁", ["blood-clinical-production.js", "blood-go-live-service.js"], ["test/blood-clinical-production.test.js", "test/blood-go-live-service.test.js"])
    ],
    remainingActions: [
      action("BLOOD-NEXT-01", "P0", "site", "接入真实BIS、BTIS、HIS、LIS、护理、PDA和冷链IoT并完成设备与账号证据签收"),
      action("BLOOD-NEXT-02", "P0", "t00", "将当前领域事务接入生产关系数据库、唯一约束、并发库存锁、备份恢复和灾备"),
      action("BLOOD-NEXT-03", "P1", "site", "用真实区域库存和临床结局数据校准预测、预警和质量指标")
    ]
  },
  "regional-imaging-cloud": {
    name: "区域影像云",
    owner: "放射科/医院信息科/区域平台互联互通组",
    capabilities: [
      capability("dicom-ris-pacs-ingest", "P0", "DICOM/RIS/PACS接入和云端对象索引", ["imaging-cloud.js", "docs/医学影像云功能说明.md"], ["test/api.test.js"]),
      capability("mobile-view-and-share", "P0", "居民授权调阅、限时分享和终端不落原始DICOM", ["imaging-cloud.js"], ["test/static.test.js"]),
      capability("emr-main-index-writeback", "P0", "FHIR/EMR报告回写和区域主索引引用", ["imaging-cloud.js"], ["test/api.test.js"]),
      capability("recognition-appeal-review", "P1", "跨机构互认、申诉和独立复核", ["imaging-cloud.js"], ["test/api.test.js"]),
      capability("synthetic-and-site-gates", "P0", "十步合成验收、生产端点、结构化回执和双人审批", ["imaging-cloud-production.js"], ["test/imaging-cloud-production.test.js"]),
      capability("diagnostic-viewer-performance", "P1", "诊断级DICOMweb浏览性能、工具和访问审计验收", ["imaging-cloud-planning.js"], ["test/imaging-cloud-planning.test.js"]),
      capability("regulatory-statistics", "P1", "按日月年机构/地市统计、排名和数据质量异常定位", ["imaging-cloud-planning.js"], ["test/imaging-cloud-planning.test.js"]),
      capability("independent-smoke-and-rollback", "P0", "独立冒烟、降级演练和影像回退硬阻断", ["imaging-cloud-production.js"], ["test/imaging-cloud-production.test.js"])
    ],
    remainingActions: [
      action("IMG-NEXT-01", "P0", "site", "完成真实PACS/RIS/DICOM TLS、FHIR回写、主索引、对象存储和访问审计联调"),
      action("IMG-NEXT-02", "P0", "t00", "由T00接入九条生产路由并把新增规划脚本纳入公共缓存与发布清单"),
      action("IMG-NEXT-03", "P1", "site", "使用授权诊断级DICOMweb端点执行性能验收，并接入生产事件流生成监管排名")
    ]
  },
  "physical-examination": {
    name: "健康体检",
    owner: "体检中心/基层公卫/慢病管理团队",
    capabilities: [
      capability("source-ingest-mpi-idempotency", "P0", "体检中心/医院接入、主索引匹配和来源幂等", ["physical-examination-service.js"], ["test/physical-examination.test.js"]),
      capability("standards-and-signature", "P0", "文档规范、数据元、医师资质和WS/T 847生产签名", ["physical-examination-standards.js", "physical-examination-production.js"], ["test/physical-examination-standards.test.js", "test/physical-examination-production.test.js"]),
      capability("source-mapping-and-receipt", "P0", "字段映射、接入回执和独立现场核验", ["physical-examination-production.js"], ["test/physical-examination-production.test.js"]),
      capability("secure-original-archive", "P0", "原件校验、恶意文件扫描和十五年不可变留存", ["physical-examination-production.js"], ["test/physical-examination-production.test.js"]),
      capability("abnormal-closure-and-care", "P0", "异常通知、复查、家医随访和慢病协同闭环", ["physical-examination-service.js", "physical-examination-production.js"], ["test/physical-examination.test.js", "test/physical-examination-production.test.js"]),
      capability("specialized-program-isolation", "P0", "职业、学生等专项体检受限分流且不污染一般健康档案", ["physical-examination-service.js"], ["test/physical-examination.test.js"]),
      capability("resident-health-highlights", "P1", "趋势、解释、行动卡、重复检查、辐射和家庭风险能力", ["physical-examination-highlights.js"], ["test/physical-examination-highlights.test.js"]),
      capability("standalone-gate-and-rollback", "P0", "独立部署、联合测试、现场证据和独立回退门禁", ["physical-examination-standalone.js", "physical-examination-production.js"], ["test/physical-examination-production.test.js"])
    ],
    remainingActions: [
      action("EXAM-NEXT-01", "P0", "site", "完成真实HMAC密钥交换、WS/T 847签名服务、医师资质和字段映射联调"),
      action("EXAM-NEXT-02", "P0", "site", "接入生产对象存储、服务端恶意文件扫描和十五年不可变留存策略"),
      action("EXAM-NEXT-03", "P1", "site", "用真实通知、复查和家医回执完成异常闭环与七项质控指标验收")
    ]
  }
});

function capability(id, priority, name, evidenceRefs, acceptanceTests) {
  return { id, priority, name, evidenceRefs, acceptanceTests, status: "implemented" };
}

function action(id, priority, dependencyType, actionText) {
  return { id, priority, dependencyType, action: actionText, status: "open-external-action" };
}

function buildSpecialtyPlanReview(options = {}) {
  const rootDir = path.resolve(options.rootDir || __dirname);
  const catalog = options.catalog || SPECIALTY_PLAN_CATALOG;
  const selectedTrackIds = options.selectedTrackIds || Object.keys(catalog);
  const tracks = options.tracks || [];
  const trackMap = new Map(tracks.map((item) => [item.id, item]));
  const unknown = selectedTrackIds.filter((id) => !catalog[id]);
  if (unknown.length) throw new Error(`unknown specialty plan track: ${unknown.join(", ")}`);

  const allIds = [];
  const trackReviews = selectedTrackIds.map((trackId) => {
    const plan = catalog[trackId];
    const runtime = trackMap.get(trackId);
    const capabilities = plan.capabilities.map((item) => {
      allIds.push(`${trackId}:${item.id}`);
      const sourceEvidence = item.evidenceRefs.map((file) => evidenceState(rootDir, file));
      const testEvidence = item.acceptanceTests.map((file) => evidenceState(rootDir, file));
      const missingEvidence = [...sourceEvidence, ...testEvidence].filter((row) => !row.exists).map((row) => row.file);
      return {
        ...item,
        status: missingEvidence.length === 0 ? "implemented" : "implementation-evidence-missing",
        sourceEvidence,
        testEvidence,
        missingEvidence
      };
    });
    const missingCapabilities = capabilities.filter((item) => item.status !== "implemented");
    return {
      trackId,
      trackName: plan.name,
      owner: plan.owner,
      codeReady: runtime ? runtime.codeReady === true : missingCapabilities.length === 0,
      productionReady: runtime ? runtime.productionReady === true : false,
      formalState: runtime?.formalGoLiveState || runtime?.formalState || "blocked-until-site-evidence-signed",
      siteBlockers: runtime?.blockers?.length || 0,
      capabilities,
      remainingActions: plan.remainingActions,
      summary: {
        planned: capabilities.length,
        implemented: capabilities.length - missingCapabilities.length,
        missing: missingCapabilities.length,
        externalActions: plan.remainingActions.length
      }
    };
  });

  const duplicates = allIds.filter((id, index) => allIds.indexOf(id) !== index);
  const missing = trackReviews.flatMap((track) => track.capabilities.filter((item) => item.status !== "implemented").map((item) => `${track.trackId}:${item.id}`));
  const externalActions = trackReviews.flatMap((track) => track.remainingActions.map((item) => ({ ...item, trackId: track.trackId, trackName: track.trackName, owner: track.owner })));
  const planned = trackReviews.reduce((sum, item) => sum + item.summary.planned, 0);
  const implemented = trackReviews.reduce((sum, item) => sum + item.summary.implemented, 0);
  const checks = [
    reviewCheck("all-selected-tracks-reviewed", trackReviews.length === selectedTrackIds.length, `${trackReviews.length}/${selectedTrackIds.length} tracks`),
    reviewCheck("capability-identifiers-unique", duplicates.length === 0, duplicates.length ? duplicates.join(", ") : `${allIds.length} unique capability ids`),
    reviewCheck("implementation-evidence-complete", missing.length === 0, missing.length ? missing.join(", ") : `${implemented}/${planned} capabilities have source and test evidence`),
    reviewCheck("owners-and-acceptance-defined", trackReviews.every((track) => track.owner && track.capabilities.every((item) => item.priority && item.name && item.acceptanceTests.length)), "every capability has priority, owner and acceptance tests"),
    reviewCheck("production-boundary-preserved", trackReviews.every((track) => track.productionReady === false || track.formalState === "ready-for-production"), "code completion never implies production approval"),
    reviewCheck("next-actions-classified", externalActions.every((item) => ["site", "t00"].includes(item.dependencyType) && ["P0", "P1", "P2"].includes(item.priority)), `${externalActions.length} external actions classified`)
  ];
  const failedChecks = checks.filter((item) => !item.passed);
  const digestPayload = trackReviews.map((track) => ({
    trackId: track.trackId,
    capabilities: track.capabilities.map((item) => ({ id: item.id, status: item.status, evidenceRefs: item.evidenceRefs, acceptanceTests: item.acceptanceTests })),
    remainingActions: track.remainingActions
  }));
  return {
    status: failedChecks.length === 0 ? "all-planned-code-capabilities-reviewed" : "specialty-plan-gaps-found",
    ok: failedChecks.length === 0,
    generatedAt: options.generatedAt || new Date().toISOString(),
    productionBoundary: "All code-side planned capabilities can be complete while formal production remains blocked by T00 integration and signed site evidence.",
    trackReviews,
    externalActions,
    checks,
    summary: {
      tracks: trackReviews.length,
      plannedCapabilities: planned,
      implementedCapabilities: implemented,
      missingCapabilities: missing.length,
      externalActions: externalActions.length,
      p0ExternalActions: externalActions.filter((item) => item.priority === "P0").length,
      coveragePercent: planned ? Math.round((implemented / planned) * 100) : 0,
      checks: checks.length,
      checksPassed: checks.length - failedChecks.length
    },
    integrity: {
      algorithm: "sha256",
      digest: sha256(digestPayload)
    }
  };
}

function renderSpecialtyPlanReviewMarkdown(review) {
  const capabilityRows = review.trackReviews.flatMap((track) => track.capabilities.map((item) =>
    `| ${track.trackName} | ${item.priority} | ${item.id} | ${item.name} | ${item.status} | ${item.evidenceRefs.join("<br>")} | ${item.acceptanceTests.join("<br>")} |`
  ));
  const actionRows = review.externalActions.map((item) =>
    `| ${item.priority} | ${item.trackName} | ${item.dependencyType} | ${item.owner} | ${item.action.replace(/\|/g, "/")} |`
  );
  return [
    "# T10 四专项规划功能审阅",
    "",
    `- Status: ${review.status}`,
    `- Coverage: ${review.summary.implementedCapabilities}/${review.summary.plannedCapabilities} (${review.summary.coveragePercent}%)`,
    `- External actions: ${review.summary.externalActions}; P0: ${review.summary.p0ExternalActions}`,
    `- Integrity: ${review.integrity.digest}`,
    "",
    review.productionBoundary,
    "",
    "## Planned capability coverage",
    "",
    "| Specialty | Priority | Capability ID | Capability | Status | Source evidence | Acceptance tests |",
    "|---|---|---|---|---|---|---|",
    ...capabilityRows,
    "",
    "## Remaining external actions",
    "",
    "| Priority | Specialty | Dependency | Owner | Action |",
    "|---|---|---|---|---|",
    ...actionRows,
    ""
  ].join("\n");
}

function evidenceState(rootDir, file) {
  const target = path.resolve(rootDir, file);
  return { file, exists: fs.existsSync(target) && fs.statSync(target).isFile() };
}

function reviewCheck(id, passed, detail) {
  return { id, passed: Boolean(passed), detail };
}

function sha256(value) {
  return `sha256:${crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

module.exports = {
  SPECIALTY_PLAN_CATALOG,
  buildSpecialtyPlanReview,
  renderSpecialtyPlanReviewMarkdown
};
