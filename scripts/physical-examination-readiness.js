const fs = require("fs");
const path = require("path");
const PhysicalExaminationService = require("../physical-examination-service");
const PhysicalExaminationStandards = require("../physical-examination-standards");

const ROOT = path.join(__dirname, "..");

function buildReport(options = {}) {
  const root = options.root || ROOT;
  const dataPath = options.dataPath || path.join(root, "data", "db.json");
  const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
  data.personalRecords = PhysicalExaminationService.mergeSeedRecords(data.personalRecords);
  data.physicalExamAbnormalCases = Array.isArray(data.physicalExamAbnormalCases) ? data.physicalExamAbnormalCases : PhysicalExaminationService.seedAbnormalCases();
  data.physicalExamJointTests = Array.isArray(data.physicalExamJointTests) ? data.physicalExamJointTests : PhysicalExaminationService.seedJointTests();
  data.physicalExamSpecializedIntakes = Array.isArray(data.physicalExamSpecializedIntakes) ? data.physicalExamSpecializedIntakes : [];
  data.chronicScreeningTasks = Array.isArray(data.chronicScreeningTasks) ? data.chronicScreeningTasks : [];
  data.taskMessages = Array.isArray(data.taskMessages) ? data.taskMessages : [];
  PhysicalExaminationService.synchronizeCareLinks(data, { notify: false, actor: "readiness" });
  const overview = PhysicalExaminationService.buildOverview(data);
  const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
  const server = read("server.js");
  const page = read("physical-examination.html");
  const client = read("physical-examination.js");
  const service = read("physical-examination-service.js");
  const highlights = read("physical-examination-highlights.js");
  const standards = read("physical-examination-standards.js");
  const production = read("physical-examination-production.js");
  const standalonePage = read("physical-examination-standalone.html");
  const standaloneClient = read("physical-examination-standalone.js");
  const standaloneReadiness = read("scripts/physical-examination-standalone-readiness.js");
  const standardsBaseline = read("docs/体检系统信息化规范基线-2026-07-15.md");
  const traceability = read("docs/体检系统规范需求追溯矩阵-2026-07-15.md");
  const citizen = read("citizen.js");
  const citizenPage = read("citizen.html");
  const checks = [
    check("contracts:exam-center", overview.sourceContracts.some((item) => item.sourceType === "exam-center"), "体检中心标准接入契约"),
    check("contracts:hospital", overview.sourceContracts.some((item) => item.sourceType === "hospital"), "医院体检结果接入契约"),
    check("archive:history", overview.reports.length >= 4 && overview.years.length >= 2, `${overview.reports.length} 份报告 / ${overview.years.length} 个年度`),
    check("archive:main-index", overview.reports.every((item) => item.residentId && item.personIndex), "报告已关联 residentId/personIndex"),
    check("archive:provenance", overview.reports.every((item) => item.meta?.institutionId && item.meta?.externalId && item.meta?.reportNo), "来源机构和外部报告标识完整"),
    check("archive:findings", overview.reports.every((item) => Array.isArray(item.meta?.findings) && Array.isArray(item.meta?.recommendations)), "结构化异常项与健康建议"),
    check("api:query", server.includes('url.pathname === "/api/physical-exams"'), "GET /api/physical-exams"),
    check("api:import", server.includes('url.pathname === "/api/physical-exams/import"'), "POST /api/physical-exams/import"),
    check("api:role-guard", server.includes('["institution", "commission"], "/api/physical-exams/import"'), "接入写入仅机构和卫健委角色"),
    check("api:signed-gateway", server.includes("landPhysicalExamIntegrationEvent(data, payload, event, user)") && server.includes("verifyIntegrationSignature"), "签名网关验签后落库"),
    check("api:dead-letter-retry", server.includes("event.contractId === PHYSICAL_EXAM_CONTRACT_ID") && server.includes("/api/integration/events/:id/retry"), "失败事件进入死信并支持人工补偿"),
    check("api:abnormal-loop", server.includes("/api/physical-exams/abnormal-cases/:id/actions") && service.includes("pending-contact") && service.includes('followup: "followup-completed"'), "异常报告自动建单并执行确认/通知/复查/随访/闭环"),
    check("api:secure-attachment", server.includes("/api/physical-exams/:id/link-attachment") && service.includes("scanStatus !== \"clean\""), "原报告仅在校验与扫描通过后关联"),
    check("quality:dictionary", overview.summary.mappingRate === 100 && overview.itemDictionary.length >= 6, `${overview.itemDictionary.length} 项标准字典 / 映射率 ${overview.summary.mappingRate}%`),
    check("quality:national-data-elements", overview.itemDictionary.some((item) => item.nationalCodes?.includes("DE04.10.174.00")) && overview.itemDictionary.some((item) => item.nationalCodes?.includes("DE04.50.038.00")), `国标映射率 ${overview.summary.nationalMappingRate}%；未核验指标保持阻断`),
    check("quality:signature", overview.summary.signedReports === overview.summary.reports && overview.summary.standardCompliantReports === 0, `${overview.summary.signedReports}/${overview.summary.reports} 份演示验签；0 份误计生产合规`),
    check("standards:catalog", PhysicalExaminationStandards.STANDARD_CATALOG.length >= 29 && standards.includes("WS/T 847-2024") && standards.includes("国卫办医政函〔2026〕63号"), `${PhysicalExaminationStandards.STANDARD_CATALOG.length} 份法律、规范和标准目录`),
    check("standards:production-gate", service.includes("requireStandards") && standards.includes("signature-production") && standards.includes("section-physician-signatures") && standards.includes("radiation-governance") && server.includes("standardsReady"), "生产接入强制分项签名、主检资质、原文绑定、放射治理、授权、留存和数字签名门禁"),
    check("quality:national-indicators", overview.qualityIndicators.length === 7 && overview.qualityIndicators.some((item) => item.code === "HCHM-OU-02") && client.includes("renderQualityIndicators"), "2023版七项医疗质控指标可计算，缺分母时明确待采集"),
    check("quality:2026-followup-loop", service.includes("重要异常结果必须完成通知和随访记录后才能关闭") && traceability.includes("PE-QC-003"), "2026年度重要异常确认、通知、随访闭环已设硬门禁"),
    check("quality:ordered-abnormal-state", service.includes("allowedActions") && service.includes("不允许从 ${currentStatus} 执行 ${action}"), "异常确认、通知、复查、专科复核、随访、关闭和重开均按状态机推进"),
    check("standards:documents", standardsBaseline.includes("WS/T 483.16—2016") && traceability.includes("PE-SIG-003"), "规范基线与需求追溯矩阵已入库"),
    check("care:risk-stratification", overview.summary.careLinkedReports === overview.summary.abnormalReports && overview.careTasks.every((item) => item.sourceReportId && item.triggerEvidence?.length && item.riskScoreContribution > 0), `${overview.summary.careLinkedReports}/${overview.summary.abnormalReports} 份异常报告已纳入慢病风险分层`),
    check("care:family-doctor-suggestion", overview.summary.familyDoctorSuggestions === overview.summary.careLinkedReports && server.includes("familyDoctorSuggestion") && client.includes("慢病与家医联动"), `${overview.summary.familyDoctorSuggestions} 条可追溯家医签约/服务包建议`),
    check("care:resident-task", overview.summary.residentRiskTasks === overview.summary.careLinkedReports && citizen.includes('item.sourceType === "physical-exam" ? "体检异常"'), `${overview.summary.residentRiskTasks} 条居民待办复用 chronicScreeningTasks`),
    check("care:idempotency", service.includes("sourceReportId === report.id") && service.includes("physicalExamCareLink"), "报告、风险任务和居民消息按来源报告幂等"),
    check("scope:specialized-routing", PhysicalExaminationService.EXAM_PROGRAMS.length >= 7 && service.includes("awaiting-specialized-profile") && server.includes("/api/physical-exams/specialized-intakes/:id/actions") && page.includes("专项体检隔离与分流"), "职业健康、学生、征兵、驾驶、公卫专项及从业人员体检进入受限分流队列，不混入一般成人体检档案"),
    check("highlights:engine", highlights.includes("buildTrajectories") && highlights.includes("translateReport") && highlights.includes("buildExamPlan") && highlights.includes("buildRepeatAvoidance"), "健康时光机、报告翻译、个性计划和重复检查共享引擎"),
    check("highlights:care-actions", highlights.includes("appointmentHref") && highlights.includes("request-review") && highlights.includes("acknowledge-action") && server.includes("/api/physical-exams/highlights/actions"), "异常行动卡接入复查申请、居民确认、家医和待办"),
    check("highlights:radiation", highlights.includes("buildRadiationLedger") && highlights.includes("governanceStatus"), "放射正当化、告知、防护和剂量台账"),
    check("highlights:quality-governance", highlights.includes("reviewReportQuality") && highlights.includes("buildInstitutionBenchmarks") && highlights.includes("buildStandardsImpact"), "报告啄木鸟、机构质量画像和规范影响分析"),
    check("highlights:privacy", highlights.includes("suppressed-small-cell") && highlights.includes("consentRequired") && highlights.includes("risk-signals-only"), "城市雷达小单元抑制及家庭成员逐人授权"),
    check("highlights:resident-wallet", highlights.includes("create-passport") && highlights.includes("revoke-passport") && highlights.includes("buildSimulation"), "居民健康护照可创建/撤销，趋势模拟保持健康教育边界"),
    check("site:evidence-required", service.includes("现场验收通过必须提供证据编号或附件引用") && service.includes("上线签署必须提供验收单编号或签字附件引用"), "现场联调和上线签署强制证据引用"),
    check("production:demo-isolation", service.includes("excludeDemoData") && service.includes("isDemoPhysicalExamRecord") && server.includes("excludeDemoData: isProductionRuntime()"), "生产 API 自动排除演示签名报告、关联异常和模拟网关事件"),
    check("production:gateway-freshness", server.includes("10 * 60 * 1000") && server.includes("productionEvidence: production") && server.includes("productionIntegrationSecretReady"), "生产体检事件强制 10 分钟时钟窗口、非占位长密钥和真实落库证据"),
    check("production:original-storage", server.includes("allOriginalsStored") && service.includes("productionStoredReports") && server.includes("仍有体检报告未关联校验通过的生产原件"), "全部生产报告必须关联状态有效且恶意文件扫描通过的原件"),
    check("site:four-eyes", service.includes("submit-signoff") && service.includes("verify-signoff") && service.includes("提交人不得核验本人提交的上线证据") && server.includes("siteSignoffVerified") && client.includes("data-joint-digest"), "机构提交人与卫生行政复核人按同一 SHA-256 摘要完成四眼签署"),
    check("ui:management", page.includes("历史体检报告") && page.includes("physical-exam-import-form"), "体检管理与报告接入界面"),
    check("ui:launch-workbench", page.includes("上线门禁") && page.includes("异常结果闭环") && page.includes("机构联调验收") && client.includes("renderGatewayEvents"), "上线门禁、异常闭环、联调与死信工作台"),
    check("ui:resident-history", citizen.includes('{ key: "physical-exam", label: "体检报告" }') && citizen.includes("renderPhysicalExamMeta"), "居民健康档案体检分类与详情"),
    check("ui:highlight-experience", page.includes("健康时光机") && page.includes("报告质量啄木鸟") && citizenPage.includes("我的体检健康时光机") && citizen.includes("renderCitizenPhysicalExamHighlights"), "管理端和居民端完整亮点体验"),
    check("ui:idempotency", client.includes("result.routedDuplicates") && client.includes("未重复归档"), "前端反馈一般体检和专项分流幂等去重结果"),
    check("standalone:entry", page.includes("physical-examination-standalone.html") && standalonePage.includes("健康体检独立生产控制面"), "平台体检页可进入独立生产控制面"),
    check("standalone:domain-boundary", !/(emergency|blood|imaging)-(service|ui|innovation)/i.test(standalonePage) && standalonePage.includes("physical-examination-production.js"), "独立入口只加载体检域脚本，不依赖急救、用血或影像模块"),
    check("standalone:production-control", production.includes("mapSourceReport") && production.includes("validateIntegrationReceipt") && production.includes("validateReportSignatureContract") && production.includes("validateArchiveEvidence"), "字段映射、接入回执、医学签名和原件扫描归档门禁"),
    check("standalone:care-closure", production.includes("schedule-review") && production.includes("family-doctor-followup") && production.includes("真实送达回执"), "异常确认、送达、复查、家医随访和关闭顺序门禁"),
    check("standalone:operations-gates", production.includes("validateStandaloneSmoke") && production.includes("validateRollbackGate") && standaloneClient.includes("NO-GO") && standaloneReadiness.includes("goLiveReady: false"), "独立冒烟、回退演练及现场证据未齐时NO-GO"),
    check("standalone:evidence-manifest", production.includes("validateEvidenceManifest") && production.includes("manifest-signature-digest-mismatch") && production.includes("manifest-canonical-payload-not-verified") && production.includes("manifest-expired"), "现场证据包规范化摘要、生产签名、七日有效期和防重放门禁"),
    check("standalone:evidence-linkage", production.includes("validateEvidenceLinkage") && production.includes("bundle-id-mismatch") && production.includes("source-receipt-digest-mismatch") && production.includes("source-signoff-evidence-set-mismatch"), "源回执、报告、原件、闭环和现场签署按批次及两层摘要绑定")
  ];
  const passed = checks.filter((item) => item.passed).length;
  return {
    generatedAt: new Date().toISOString(),
    ok: passed === checks.length,
    codeReady: passed === checks.length,
    goLiveReady: false,
    summary: {
      checks: checks.length,
      passed,
      failed: checks.length - passed,
      reports: overview.summary.reports,
      residents: overview.summary.residents,
      institutions: overview.summary.institutions,
      years: overview.summary.years,
      sourceContracts: overview.sourceContracts.length
    },
    checks,
    siteBlockers: [
      "在生产环境配置 INTEGRATION_GATEWAY_SECRET，并由接入机构完成密钥交换。",
      "接入符合 WS/T 847—2024 的真实SM2/SM3、ES-T时间戳签名服务及可信电子认证证书，演示签名不得上线。",
      "接入分项医师和主检医师执业资质主数据，并验证原文摘要与签名覆盖文档一致。",
      "接入健康问卷、超声工作量、大便标本、报告完成时长及重要异常随访数据，形成七项真实质控指标。",
      "放射项目接入风险告知、正当化依据、防护最优化和设备剂量数据。",
      "完成 WS/T 363—2023 国家数据元逐项映射，当前本地BMI计算指标需经数据标准委员会确认。",
      "配置生产对象存储、服务端恶意文件扫描和 15 年不可变留存策略。",
      "体检中心与医院逐项完成网络、映射、验签、幂等、存储和重试现场联调并上传证据。",
      "由各机构与平台上线负责人完成验收单签署后，生产门禁才可转为可上线。"
    ],
    boundaries: [
      "代码侧已实现生产/演示数据隔离、标准化签名接入、10分钟时钟窗口、幂等归档、死信补偿、授权查询、异常闭环、原报告安全关联、四眼验收签署、居民历史报告以及体检创新亮点工作台。",
      "真实密钥、生产对象存储与机构现场签字属于外部上线证据，未完成前系统会保持上线阻断。"
    ],
    evidence: {
      page: "physical-examination.html",
      residentEntry: "citizen.html?client=app&page=health-record#service-health-record",
      queryApi: "GET /api/physical-exams",
      importApi: "POST /api/physical-exams/import",
      signedGatewayApi: "POST /api/integration/events",
      abnormalApi: "POST /api/physical-exams/abnormal-cases/:id/actions",
      jointTestApi: "POST /api/physical-exams/joint-tests/:id/actions",
      attachmentApi: "POST /api/physical-exams/:id/link-attachment",
      specializedRoutingApi: "POST /api/physical-exams/specialized-intakes/:id/actions",
      collection: "personalRecords[category=physical-exam]",
      standardsBaseline: "docs/体检系统信息化规范基线-2026-07-15.md",
      traceability: "docs/体检系统规范需求追溯矩阵-2026-07-15.md"
    }
  };
}

function check(id, passed, detail) {
  return { id, passed: Boolean(passed), detail };
}

function renderMarkdown(report) {
  return `# 体检系统就绪报告

- 生成时间：${report.generatedAt}
- 结论：${report.ok ? "通过" : "未通过"}
- 代码就绪：${report.codeReady ? "是" : "否"}
- 生产可上线：${report.goLiveReady ? "是" : "否（等待真实环境与现场证据）"}
- 检查：${report.summary.passed}/${report.summary.checks}
- 演示报告：${report.summary.reports} 份，${report.summary.residents} 名居民，${report.summary.institutions} 家机构，${report.summary.years} 个年度

## 检查结果

${report.checks.map((item) => `- [${item.passed ? "x" : " "}] ${item.id}：${item.detail}`).join("\n")}

## 可验收入口

- 管理端：\`${report.evidence.page}\`
- 居民端：\`${report.evidence.residentEntry}\`
- 查询接口：\`${report.evidence.queryApi}\`
- 接入接口：\`${report.evidence.importApi}\`
- 签名网关：\`${report.evidence.signedGatewayApi}\`
- 异常闭环：\`${report.evidence.abnormalApi}\`
- 机构联调：\`${report.evidence.jointTestApi}\`
- 原件归档：\`${report.evidence.attachmentApi}\`
- 健康档案落点：\`${report.evidence.collection}\`

## 生产边界

${report.boundaries.map((item) => `- ${item}`).join("\n")}

## 现场上线阻断项

${report.siteBlockers.map((item) => `- [ ] ${item}`).join("\n")}
`;
}

function writeReport(report, options = {}) {
  const outputDir = options.outputDir || path.join(ROOT, "release");
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, "physical-examination-readiness-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(path.join(outputDir, "physical-examination-readiness-report.md"), renderMarkdown(report), "utf8");
}

if (require.main === module) {
  const report = buildReport();
  writeReport(report);
  console.log(JSON.stringify(report.summary));
  if (!report.ok) process.exitCode = 1;
}

module.exports = { buildReport, renderMarkdown, writeReport };
