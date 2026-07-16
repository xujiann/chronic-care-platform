const DIGITAL_HOSPITAL_SOURCE_URLS = {
  emr: "https://www.nhc.gov.cn/wjw/c100175/201812/7d64363a20cd4ea798f8343842b28d0c.shtml",
  interoperability: "https://www.nhc.gov.cn/mohwsbwstjxxzx/s8553/202008/bdd0d4fcb1c747dda000e0adec3c17b9/files/1740035892298_26600.pdf",
  smartService: "https://www.nhc.gov.cn/yzygj/c100068/202005/43b2d23ff48448ffae96700bc6eaccd7.shtml",
  smartManagement: "https://www.nhc.gov.cn/yzygj/c100068/202103/a14c60de4af9423cbbf45712e27e3cc8.shtml",
  healthInfoPlan: "https://www.ndcpa.gov.cn/jbkzzx/c100030/common/content/content_1658745812574605312.html",
  emrManagement: "https://www.nhc.gov.cn/wjw/c100175/201702/90f3de8ae03d488cbddf509dc958f75b.shtml",
  smartServiceAssessment: "https://www.nhc.gov.cn/yzygj/c100068/201903/004a87a8eb3f48c48ffb120dab883c4f.shtml",
  dataStandards: "https://www.nhc.gov.cn/fzs/c100048/202310/16a32e2b1c0b42e99480b945ef10c0dc.shtml",
  platformInteraction: "https://www.nhc.gov.cn/wjw/zcwjtg/202411/308603c60d554dd49052b5bfb3a9d391.shtml",
  cybersecurityLaw: "https://www.cac.gov.cn/2025-12/29/c_1768735112911946.htm",
  dataSecurityLaw: "https://www.cac.gov.cn/2021-06/11/c_1624994566919140.htm",
  pipLaw: "https://www.cac.gov.cn/2021-08/20/c_1631050028355286.htm",
  networkDataSecurity: "https://www.cac.gov.cn/2024-09/30/c_1729384452307680.htm",
  healthcareCybersecurity: "https://www.nhc.gov.cn/guihuaxxs/c100133/202208/8a23d01133214a779879094dd20cd383.shtml",
  aiOpinion: "https://www.nhc.gov.cn/guihuaxxs/c100133/202511/d1a42ae835c743b9b3e83ac0253c3e9f.shtml",
  aiScenarios: "https://www.nhc.gov.cn/wjw/c100175/202411/5bcb3c4edd064e31ac5d279caf5830f4.shtml",
  mutualRecognition: "https://www.nhc.gov.cn/yzygj/c100068/202411/e26dde958ae74bf5b8f4fe97d83253c7.shtml",
  internetDiagnosis: "https://www.nhc.gov.cn/yzygj/c100067/202203/61bb44c669144ad1a4266fc4d63dd7a4.shtml",
  classifiedProtection: "https://openstd.samr.gov.cn/bzgk/std/newGbInfo?hcno=BAFB47E8874764186BDB7865E8344DAF"
};

const DIGITAL_HOSPITAL_POLICY_REGISTER = [
  { id: "dhp-emr-application-management", title: "电子病历应用管理规范（试行）", documentNo: "国卫办医发〔2017〕8号", domains: ["电子病历"], authorityLevel: "行业管理规范", bindingLevel: "management-required", lifecycleStatus: "effective", effectiveAt: "2017-04-01", sourceUrl: DIGITAL_HOSPITAL_SOURCE_URLS.emrManagement, applicability: "实施电子病历的医疗机构", controlTopics: ["病历修改留痕", "电子签名", "封存复制"], owner: "医疗质量与病案管理组", reviewStatus: "verified-current", lastReviewedAt: "2026-07-16", nextReviewAt: "2027-01-31" },
  { id: "dhp-emr-leveling-2018", title: "电子病历系统应用水平分级评价标准（试行）", documentNo: "国卫办医函〔2018〕1079号", domains: ["电子病历"], authorityLevel: "评价标准", bindingLevel: "evaluation-reference", lifecycleStatus: "current-reference", sourceUrl: DIGITAL_HOSPITAL_SOURCE_URLS.emr, applicability: "按属地要求参加评价的医疗机构", controlTopics: ["临床闭环", "数据共享", "智能决策"], owner: "电子病历评价组", reviewStatus: "verified-reference", lastReviewedAt: "2026-07-16", nextReviewAt: "2027-01-31" },
  { id: "dhp-interoperability-2020", title: "医院信息互联互通标准化成熟度测评方案（2020年版）", documentNo: "统计信息中心测评方案", domains: ["互联互通", "标准服务"], authorityLevel: "评价标准", bindingLevel: "evaluation-reference", lifecycleStatus: "current-reference", sourceUrl: DIGITAL_HOSPITAL_SOURCE_URLS.interoperability, applicability: "申请互联互通成熟度测评的医院", controlTopics: ["数据标准化", "交互服务", "符合性测试"], owner: "互联互通评价组", reviewStatus: "verified-reference", lastReviewedAt: "2026-07-16", nextReviewAt: "2027-01-31" },
  { id: "dhp-smart-service-2019", title: "医院智慧服务分级评估标准体系（试行）", documentNo: "国卫办医函〔2019〕236号", domains: ["智慧服务"], authorityLevel: "评价标准", bindingLevel: "evaluation-reference", lifecycleStatus: "current-reference", sourceUrl: DIGITAL_HOSPITAL_SOURCE_URLS.smartServiceAssessment, applicability: "开展智慧服务建设与评价的医院", controlTopics: ["诊前服务", "诊中服务", "诊后服务"], owner: "智慧服务评价组", reviewStatus: "verified-reference", lastReviewedAt: "2026-07-16", nextReviewAt: "2027-01-31" },
  { id: "dhp-smart-management-2021", title: "医院智慧管理分级评估标准体系（试行）", documentNo: "国卫办医函〔2021〕86号", domains: ["智慧管理"], authorityLevel: "评价标准", bindingLevel: "evaluation-reference", lifecycleStatus: "current-reference", sourceUrl: DIGITAL_HOSPITAL_SOURCE_URLS.smartManagement, applicability: "应用信息化手段开展管理的医院", controlTopics: ["运营管理", "资源调度", "风险预警"], owner: "智慧管理评价组", reviewStatus: "verified-reference", lastReviewedAt: "2026-07-16", nextReviewAt: "2027-01-31" },
  { id: "dhp-wst-363-364-2023", title: "WS/T 363、WS/T 364—2023数据元及值域标准", documentNo: "国卫通〔2023〕12号", domains: ["标准服务", "电子病历", "互联互通"], authorityLevel: "推荐性卫生行业标准", bindingLevel: "recommended-standard", lifecycleStatus: "effective", sourceUrl: DIGITAL_HOSPITAL_SOURCE_URLS.dataStandards, applicability: "数据标准化、交换共享和监管上报", controlTopics: ["数据元", "值域", "术语映射"], owner: "标准与主数据组", reviewStatus: "verified-current", lastReviewedAt: "2026-07-16", nextReviewAt: "2027-01-31" },
  { id: "dhp-wst-846-847-2024", title: "WS/T 846—2024医院信息平台交互及WS/T 847—2024数字签名标准", documentNo: "2024年10月28日发布", domains: ["互联互通", "标准服务", "电子病历"], authorityLevel: "推荐性卫生行业标准", bindingLevel: "recommended-standard", lifecycleStatus: "effective", effectiveAt: "2025-04-01", sourceUrl: DIGITAL_HOSPITAL_SOURCE_URLS.platformInteraction, applicability: "医院信息平台交互与医学电子文档签名", controlTopics: ["交互契约", "文档注册", "数字签名"], owner: "平台与接口标准组", reviewStatus: "verified-current", lastReviewedAt: "2026-07-16", nextReviewAt: "2027-01-31" },
  { id: "dhp-cybersecurity-law-2025", title: "中华人民共和国网络安全法（2025年修正）", documentNo: "2026年1月1日起施行", domains: ["安全合规"], authorityLevel: "法律", bindingLevel: "mandatory", lifecycleStatus: "effective", effectiveAt: "2026-01-01", sourceUrl: DIGITAL_HOSPITAL_SOURCE_URLS.cybersecurityLaw, applicability: "在境内建设、运营、维护和使用网络的组织", controlTopics: ["等级保护", "事件处置", "人工智能风险"], owner: "网络安全组", reviewStatus: "verified-current", lastReviewedAt: "2026-07-16", nextReviewAt: "2027-01-31" },
  { id: "dhp-data-security-law", title: "中华人民共和国数据安全法", documentNo: "主席令第八十四号", domains: ["安全合规", "标准服务"], authorityLevel: "法律", bindingLevel: "mandatory", lifecycleStatus: "effective", sourceUrl: DIGITAL_HOSPITAL_SOURCE_URLS.dataSecurityLaw, applicability: "境内数据处理活动", controlTopics: ["分类分级", "重要数据", "风险监测"], owner: "数据安全组", reviewStatus: "verified-current", lastReviewedAt: "2026-07-16", nextReviewAt: "2027-01-31" },
  { id: "dhp-personal-information-protection-law", title: "中华人民共和国个人信息保护法", documentNo: "主席令第九十一号", domains: ["安全合规", "智慧服务", "电子病历"], authorityLevel: "法律", bindingLevel: "mandatory", lifecycleStatus: "effective", sourceUrl: DIGITAL_HOSPITAL_SOURCE_URLS.pipLaw, applicability: "处理患者、居民、医务人员个人信息的业务", controlTopics: ["敏感个人信息", "单独同意", "影响评估"], owner: "个人信息保护负责人", reviewStatus: "verified-current", lastReviewedAt: "2026-07-16", nextReviewAt: "2027-01-31" },
  { id: "dhp-network-data-security-regulation", title: "网络数据安全管理条例", documentNo: "国务院令第790号", domains: ["安全合规", "标准服务"], authorityLevel: "行政法规", bindingLevel: "mandatory", lifecycleStatus: "effective", effectiveAt: "2025-01-01", sourceUrl: DIGITAL_HOSPITAL_SOURCE_URLS.networkDataSecurity, applicability: "境内网络数据处理活动", controlTopics: ["委托处理", "个人信息", "重要数据"], owner: "数据安全组", reviewStatus: "verified-current", lastReviewedAt: "2026-07-16", nextReviewAt: "2027-01-31" },
  { id: "dhp-healthcare-cybersecurity-management", title: "医疗卫生机构网络安全管理办法", documentNo: "国卫规划发〔2022〕29号", domains: ["安全合规", "智慧管理"], authorityLevel: "行业管理规范", bindingLevel: "management-required", lifecycleStatus: "effective", sourceUrl: DIGITAL_HOSPITAL_SOURCE_URLS.healthcareCybersecurity, applicability: "各级各类医疗卫生机构", controlTopics: ["年度自查", "数据资产盘点", "容灾备份"], owner: "网络安全组", reviewStatus: "verified-current", lastReviewedAt: "2026-07-16", nextReviewAt: "2027-01-31" },
  { id: "dhp-gbt-22239-2019", title: "GB/T 22239—2019网络安全等级保护基本要求", documentNo: "GB/T 22239—2019", domains: ["安全合规"], authorityLevel: "推荐性国家标准", bindingLevel: "recommended-standard", lifecycleStatus: "effective", sourceUrl: DIGITAL_HOSPITAL_SOURCE_URLS.classifiedProtection, applicability: "落实等级保护制度的定级系统", controlTopics: ["安全通用要求", "扩展要求"], owner: "等级保护工作组", reviewStatus: "verified-current", lastReviewedAt: "2026-07-16", nextReviewAt: "2027-01-31" },
  { id: "dhp-ai-healthcare-opinion-2025", title: "关于促进和规范‘人工智能+医疗卫生’应用发展的实施意见", documentNo: "国卫办规划发〔2025〕30号", domains: ["电子病历", "智慧服务", "智慧管理", "标准服务", "安全合规"], authorityLevel: "政策指导", bindingLevel: "policy-guidance", lifecycleStatus: "effective", sourceUrl: DIGITAL_HOSPITAL_SOURCE_URLS.aiOpinion, applicability: "医疗卫生人工智能研发、部署和运营", controlTopics: ["模型备案", "应用审核", "动态监测"], owner: "人工智能治理委员会", reviewStatus: "verified-current", lastReviewedAt: "2026-07-16", nextReviewAt: "2027-01-31" },
  { id: "dhp-ai-scenarios-2024", title: "卫生健康行业人工智能应用场景参考指引", documentNo: "国卫办规划函〔2024〕420号", domains: ["智慧服务", "智慧管理", "标准服务"], authorityLevel: "应用参考指引", bindingLevel: "policy-guidance", lifecycleStatus: "current-reference", sourceUrl: DIGITAL_HOSPITAL_SOURCE_URLS.aiScenarios, applicability: "人工智能应用场景规划和立项", controlTopics: ["场景分类", "临床辅助", "管理辅助"], owner: "人工智能治理委员会", reviewStatus: "verified-reference", lastReviewedAt: "2026-07-16", nextReviewAt: "2027-01-31" },
  { id: "dhp-mutual-recognition-2024", title: "关于进一步推进医疗机构检查检验结果互认的指导意见", documentNo: "国卫医政发〔2024〕37号", domains: ["互联互通", "智慧服务", "标准服务"], authorityLevel: "政策指导", bindingLevel: "management-required", lifecycleStatus: "effective", sourceUrl: DIGITAL_HOSPITAL_SOURCE_URLS.mutualRecognition, applicability: "检查检验结果互通共享与互认", controlTopics: ["互认清单", "负面清单", "质量控制"], owner: "检查检验互认专班", reviewStatus: "verified-current", lastReviewedAt: "2026-07-16", nextReviewAt: "2027-01-31" },
  { id: "dhp-internet-diagnosis-supervision-2022", title: "互联网诊疗监管细则（试行）", documentNo: "国卫办医发〔2022〕2号", domains: ["智慧服务", "电子病历", "安全合规"], authorityLevel: "行业管理规范", bindingLevel: "management-required", lifecycleStatus: "conditional", sourceUrl: DIGITAL_HOSPITAL_SOURCE_URLS.internetDiagnosis, applicability: "启用互联网诊疗或在线复诊时适用", controlTopics: ["复诊边界", "处方审核", "全过程监管"], owner: "互联网诊疗管理组", reviewStatus: "local-supplement-required", lastReviewedAt: "2026-07-16", nextReviewAt: "2027-01-31" },
  { id: "dhp-health-information-plan-14fyp", title: "‘十四五’全民健康信息化规划", documentNo: "规划期2021—2025年", domains: ["电子病历", "互联互通", "智慧服务", "智慧管理", "标准服务", "安全合规"], authorityLevel: "阶段规划", bindingLevel: "historical-planning", lifecycleStatus: "historical-plan", sourceUrl: DIGITAL_HOSPITAL_SOURCE_URLS.healthInfoPlan, applicability: "仅作为历史建设依据，不直接作为2026年度硬性上线任务", controlTopics: ["历史目标继承", "后续政策映射"], owner: "标准政策组", reviewStatus: "historical-only", lastReviewedAt: "2026-07-16", nextReviewAt: "" }
];

const DIGITAL_HOSPITAL_CONTROL_MATRIX = [
  { id: "dhc-emr-lifecycle", domain: "电子病历", title: "电子病历全生命周期与不可抵赖留痕", implementationState: "implemented", controlOwner: "医疗质量与病案管理组", requirementIds: ["dhp-emr-application-management", "dhp-wst-846-847-2024"], evidenceCollections: ["personalRecords", "securityEvents"], automatedChecks: ["api:test", "audit:retention"], goLiveCritical: true, gap: "现场封存复制和抽样签字材料待归档。" },
  { id: "dhc-emr-level-evidence", domain: "电子病历", title: "电子病历评价指标与现场证据映射", implementationState: "site-evidence-required", controlOwner: "电子病历评价组", requirementIds: ["dhp-emr-leveling-2018"], evidenceCollections: ["digitalHospitalEvidencePackets"], automatedChecks: ["digital-hospital:standards-readiness"], goLiveCritical: false, gap: "真实EMR截图和科室签字待医院提供。" },
  { id: "dhc-interoperability-contract", domain: "互联互通", title: "WS/T 846交互契约、版本和交易回执", implementationState: "partial", controlOwner: "平台与接口标准组", requirementIds: ["dhp-interoperability-2020", "dhp-wst-846-847-2024"], evidenceCollections: ["integrationContracts", "phase2GatewayTraces"], automatedChecks: ["interface:mapping", "integration:readiness"], goLiveCritical: true, gap: "生产接口样例和厂商签名待联调。" },
  { id: "dhc-mutual-recognition", domain: "互联互通", title: "检查检验互认清单与负面清单", implementationState: "partial", controlOwner: "检查检验互认专班", requirementIds: ["dhp-mutual-recognition-2024"], evidenceCollections: ["phase2MutualRecognitionRules"], automatedChecks: ["phase2:mutual-recognition-readiness"], goLiveCritical: false, gap: "需导入属地清单。" },
  { id: "dhc-smart-service-loop", domain: "智慧服务", title: "实名服务订单、回执、退费和满意度闭环", implementationState: "implemented", controlOwner: "医院服务组", requirementIds: ["dhp-smart-service-2019", "dhp-personal-information-protection-law"], evidenceCollections: ["registrationOrders", "escortServiceOrders"], automatedChecks: ["citizen:launch-foundation"], goLiveCritical: true, gap: "生产支付退费渠道待联调。" },
  { id: "dhc-internet-diagnosis-boundary", domain: "智慧服务", title: "互联网诊疗复诊边界与处方监管", implementationState: "partial", controlOwner: "互联网诊疗管理组", requirementIds: ["dhp-internet-diagnosis-supervision-2022"], evidenceCollections: ["personalRecords"], automatedChecks: ["internet-nursing:readiness"], goLiveCritical: true, gap: "启用在线诊疗前需补资质和处方审核接口。" },
  { id: "dhc-management-metric-lineage", domain: "智慧管理", title: "运营指标口径、血缘和决策留痕", implementationState: "implemented", controlOwner: "医院运营管理组", requirementIds: ["dhp-smart-management-2021"], evidenceCollections: ["hospitalOperationSnapshots", "dataLineageControls"], automatedChecks: ["operations:readiness"], goLiveCritical: true, gap: "正式指标口径需现场签字。" },
  { id: "dhc-management-resilience", domain: "智慧管理", title: "业务连续性、备份恢复和降级演练", implementationState: "site-evidence-required", controlOwner: "平台运维组", requirementIds: ["dhp-healthcare-cybersecurity-management"], evidenceCollections: ["siteLaunchEvidence"], automatedChecks: ["launch:smoke", "production-db:readiness"], goLiveCritical: true, gap: "生产恢复演练和回滚回执待签署。" },
  { id: "dhc-standard-lifecycle", domain: "标准服务", title: "规范效力、适用性、版本与继承关系", implementationState: "implemented", controlOwner: "标准政策组", requirementIds: ["dhp-wst-363-364-2023", "dhp-health-information-plan-14fyp"], evidenceCollections: ["digitalHospitalPolicyRegister"], automatedChecks: ["digital-hospital:standards-readiness"], goLiveCritical: true, gap: "持续接入国家和属地新发规范。" },
  { id: "dhc-data-standardization", domain: "标准服务", title: "数据元、值域、术语和主数据映射", implementationState: "partial", controlOwner: "标准与主数据组", requirementIds: ["dhp-wst-363-364-2023"], evidenceCollections: ["standardDataDictionaries", "dataGovernanceAssets"], automatedChecks: ["data-governance:readiness"], goLiveCritical: true, gap: "院内本地码映射待现场导入。" },
  { id: "dhc-sensitive-data", domain: "安全合规", title: "敏感个人信息、分类分级和授权审计", implementationState: "implemented", controlOwner: "个人信息保护负责人", requirementIds: ["dhp-personal-information-protection-law", "dhp-data-security-law"], evidenceCollections: ["securityEvents", "dataAccessLogs"], automatedChecks: ["security:test", "audit:retention"], goLiveCritical: true, gap: "生产影响评估和委托处理清单需归档。" },
  { id: "dhc-security-assessment", domain: "安全合规", title: "等保、密码应用和年度安全检查", implementationState: "site-evidence-required", controlOwner: "网络安全组", requirementIds: ["dhp-cybersecurity-law-2025", "dhp-gbt-22239-2019"], evidenceCollections: ["securityAcceptanceLedger"], automatedChecks: ["security:commercial-crypto-readiness"], goLiveCritical: true, gap: "定级备案、密评和日志归档待现场确认。" },
  { id: "dhc-ai-governance", domain: "安全合规", title: "AI模型台账、审核、人工复核和动态监测", implementationState: "partial", controlOwner: "人工智能治理委员会", requirementIds: ["dhp-ai-healthcare-opinion-2025"], evidenceCollections: ["clinicalDecisionSupportRules", "securityEvents"], automatedChecks: ["phase2:clinical-assist-readiness"], goLiveCritical: true, gap: "临床AI上线前需补模型卡、漂移阈值和回滚证据。" }
];

const DIGITAL_HOSPITAL_STANDARD_DOMAINS = [
  {
    id: "emr-leveling",
    domain: "电子病历",
    level: "P0",
    title: "电子病历系统应用水平分级评价映射",
    source: "国家卫生健康委 国卫办医函〔2018〕1079号",
    sourceUrl: DIGITAL_HOSPITAL_SOURCE_URLS.emr,
    indicators: ["病历闭环", "医嘱用药", "质量效率监测", "临床决策支持"],
    evidence: ["EMR 功能清单", "日常医疗质量指标", "系统日志", "抽样病历质控记录"],
    dataPath: "HIS/EMR -> 统计指标 -> 脱敏证据 -> 规则校验",
    nextAction: "建立电子病历指标到新标准指标的继承映射表",
    owner: "标准专家组",
    blocker: "需要医院提供真实 EMR 功能截图、接口字段和质控抽样签字"
  },
  {
    id: "hospital-interoperability",
    domain: "互联互通",
    level: "P0",
    title: "医院信息互联互通标准化成熟度测评映射",
    source: "国家卫生健康委统计信息中心 医院信息互联互通成熟度测评方案",
    sourceUrl: DIGITAL_HOSPITAL_SOURCE_URLS.interoperability,
    indicators: ["标准符合性测试", "互联互通应用效果", "数据资源标准化", "基础设施"],
    evidence: ["测试用例", "交易样例", "接口对账", "整改复测记录"],
    dataPath: "HIS/LIS/PACS/平台网关 -> 标准符合性测试 -> 应用效果评价",
    nextAction: "把既有 evaluation:evidence 输出接入数智医院标准证据链",
    owner: "技术专家组",
    blocker: "需要真实生产环境接口样例、测评报告和厂商联调确认"
  },
  {
    id: "smart-service",
    domain: "智慧服务",
    level: "P1",
    title: "预约诊疗、互联网医院与患者服务体验",
    source: "国家卫生健康委 国卫办医函〔2020〕405号",
    sourceUrl: DIGITAL_HOSPITAL_SOURCE_URLS.smartService,
    indicators: ["预约诊疗", "线上复诊", "移动支付", "诊间消息", "适老服务"],
    evidence: ["居民端入口", "预约订单", "消息回执", "服务满意度", "无障碍验收"],
    dataPath: "居民端/医院端 -> 服务订单 -> 回执与满意度 -> 整改闭环",
    nextAction: "复用居民端、互联网护理、陪诊、家庭医生签约的服务证据",
    owner: "医院服务组",
    blocker: "统一入口、实名关系、支付退费和线上线下服务边界需现场确认"
  },
  {
    id: "smart-management",
    domain: "智慧管理",
    level: "P1",
    title: "智慧管理分级评估与医院运营决策",
    source: "国家卫生健康委 国卫办医函〔2021〕86号",
    sourceUrl: DIGITAL_HOSPITAL_SOURCE_URLS.smartManagement,
    indicators: ["管理业务联动", "指标自动生成", "资源调度", "决策支持", "流程提示"],
    evidence: ["运营看板", "资源调度台账", "管理指标口径", "部门协同记录"],
    dataPath: "运营系统/统计直报 -> 指标口径 -> 决策看板 -> 审核留痕",
    nextAction: "将 operations:readiness 与 hospital-operations:readiness 纳入管理评价域",
    owner: "省级组织实施组",
    blocker: "医院运营管理数据口径和部门签字需现场固化"
  },
  {
    id: "health-info-standard-service",
    domain: "标准服务",
    level: "P0",
    title: "全民健康信息化标准服务与一体化评价",
    source: "“十四五”全民健康信息化规划",
    sourceUrl: DIGITAL_HOSPITAL_SOURCE_URLS.healthInfoPlan,
    indicators: ["六类基础标准", "四统一", "元数据管理", "一体化评价", "结果应用"],
    evidence: ["标准元数据", "指标版本", "数据元映射", "评价结果", "典型案例"],
    dataPath: "标准中心 -> 指标库/规则库/证据库 -> 任务版本 -> 结果应用",
    nextAction: "先落标准中枢版本、指标解释、证据材料清单和规则库",
    owner: "项目办公室",
    blocker: "需要确定试行版指标口径和国家/省级结果发布权限"
  },
  {
    id: "data-security-compliance",
    domain: "安全合规",
    level: "P0",
    title: "网络安全、数据安全、个人信息保护与等保基线",
    source: "网安法、数据安全法、个保法、GB/T 22239-2019",
    sourceUrl: DIGITAL_HOSPITAL_SOURCE_URLS.classifiedProtection,
    indicators: ["最小必要采集", "分类分级", "脱敏汇总", "权限隔离", "审计留痕"],
    evidence: ["等保定级", "数据分类分级表", "脱敏规则", "访问审计", "导出审批"],
    dataPath: "采集适配器 -> 脱敏汇总 -> 权限校验 -> 审计链",
    nextAction: "默认不采集患者姓名、身份证号、病历全文和影像原片",
    owner: "安全合规组",
    blocker: "等保、密评、真实日志归档和第三方保密承诺需现场材料"
  }
];

const DIGITAL_HOSPITAL_WORKFLOW = [
  ["标准发布", "国家级平台", "标准版本、指标解释、数据元、规则、证据清单发布", "版本号、发布时间、适用范围"],
  ["任务下发", "国家级/省级平台", "年度评价、专项评价、试点评价任务配置", "评价周期、对象范围、申报等级"],
  ["医院自评", "医疗机构端", "系统画像、指标填报、证据提交、既有测评结果继承", "自评分、材料完整率、继承映射"],
  ["自动校验", "规则引擎", "完整性、格式、逻辑、阈值、证据一致性校验", "问题清单、风险分层、补正建议"],
  ["分级审核", "省级/专家/国家", "省级初审、专家复核、国家抽查、申诉复议", "审核意见、复核结论、抽查记录"],
  ["整改闭环", "医院与省级平台", "问题整改、证据补充、复测、结果确认", "整改计划、复测通过率、最终等级"]
];

const DIGITAL_HOSPITAL_EVIDENCE_PACKS = [
  { id: "interface", title: "接口采集", owner: "技术专家组", status: "原型就绪", detail: "统计指标、标准符合性测试结果、接口交易样例、对账结果" },
  { id: "template", title: "模板填报", owner: "医疗机构", status: "需试点验证", detail: "医院系统画像、管理流程、指标口径、历史评价结果" },
  { id: "material", title: "材料证据", owner: "医疗机构", status: "需现场材料", detail: "制度文件、截图、报告、测评证书、科室签字表" },
  { id: "sample", title: "抽样核验", owner: "省级审核组", status: "需授权抽样", detail: "脱敏样本、现场核验记录、复核问题、复测报告" },
  { id: "audit", title: "审计链", owner: "安全合规组", status: "基线建档", detail: "上传、查看、评分、修改、导出、发布全过程留痕" }
];

const DIGITAL_HOSPITAL_REVIEW_QUEUE = [
  { id: "review-provincial", label: "省级初审", count: 18, status: "待材料补正", next: "按医院类型分派审核人" },
  { id: "review-expert", label: "专家复核", count: 9, status: "待争议指标复核", next: "锁定高等级申报样本" },
  { id: "review-national", label: "国家抽查", count: 4, status: "待抽查方案", next: "按风险等级抽样" },
  { id: "review-appeal", label: "申诉复议", count: 2, status: "待补充依据", next: "归档原始判定和复议材料" }
];

const DIGITAL_HOSPITAL_SECURITY_BOUNDARY = [
  "原则上不集中采集患者可识别明细数据",
  "优先采集统计指标、符合性结果和脱敏证据",
  "材料导出、专家查看、结果发布均进入审计链",
  "AI 只能做预审提示，最终结论由授权审核主体确认"
];

const DIGITAL_HOSPITAL_PILOT_PACKAGES = [
  { type: "三级综合医院", target: "2-3 家/省", ready: "标准映射、EMR/互联互通继承、接口样例", blocker: "真实接口字段、院内签字、抽样授权" },
  { type: "三级专科医院", target: "1-2 家/省", ready: "专科指标差异、材料模板、专家复核口径", blocker: "专科适配规则和争议指标案例库" },
  { type: "二级公立医院", target: "3-5 家/省", ready: "轻量填报、模板采集、整改闭环", blocker: "薄弱信息化医院的离线材料接入" },
  { type: "省级平台", target: "2-3 个试点省", ready: "任务下发、初审、专家复核、区域分析", blocker: "组织实施方案和结果上报权限" },
  { type: "国家级平台", target: "1 套中枢", ready: "标准版本、规则库、抽查、统计分析", blocker: "试行版指标发布和结果确认机制" }
];

const DIGITAL_HOSPITAL_API_ENDPOINT = "/api/digital-hospital/standards";
const DIGITAL_HOSPITAL_POLICY_REGISTER_ENDPOINT = "/api/digital-hospital/policy-register";
const DIGITAL_HOSPITAL_LAUNCH_ENDPOINT = "/api/digital-hospital/launch-readiness";
const DIGITAL_HOSPITAL_PRODUCTION_EVIDENCE_ENDPOINT = "/api/digital-hospital/production-evidence-packets";
const DIGITAL_HOSPITAL_COMMAND_BRIEF_ENDPOINT = "/api/digital-hospital/launch-command-briefs";
const DIGITAL_HOSPITAL_FORMAL_CUTOVER_APPROVAL_ENDPOINT = "/api/digital-hospital/formal-cutover-approvals";
const DIGITAL_HOSPITAL_FALLBACK_STATE = {
  standardDomains: DIGITAL_HOSPITAL_STANDARD_DOMAINS,
  policyRegister: DIGITAL_HOSPITAL_POLICY_REGISTER,
  policySummary: null,
  controlMatrix: DIGITAL_HOSPITAL_CONTROL_MATRIX,
  workflow: DIGITAL_HOSPITAL_WORKFLOW,
  evidencePacks: DIGITAL_HOSPITAL_EVIDENCE_PACKS,
  reviewQueue: DIGITAL_HOSPITAL_REVIEW_QUEUE,
  securityBoundary: DIGITAL_HOSPITAL_SECURITY_BOUNDARY,
  pilotPackages: DIGITAL_HOSPITAL_PILOT_PACKAGES,
  summary: null,
  riskItems: [],
  checks: [],
  launchReadiness: null,
  productionEvidenceBoard: null,
  launchCommandBriefBoard: null,
  formalCutoverApprovalBoard: null,
  source: "static"
};
let digitalHospitalRuntime = { ...DIGITAL_HOSPITAL_FALLBACK_STATE };

function setDigitalHospitalRuntime(payload = {}) {
  digitalHospitalRuntime = {
    ...DIGITAL_HOSPITAL_FALLBACK_STATE,
    standardDomains: Array.isArray(payload.standards) && payload.standards.length ? payload.standards : DIGITAL_HOSPITAL_STANDARD_DOMAINS,
    policyRegister: Array.isArray(payload.policyRegister) && payload.policyRegister.length ? payload.policyRegister : DIGITAL_HOSPITAL_POLICY_REGISTER,
    policySummary: payload.policySummary || null,
    controlMatrix: Array.isArray(payload.controlMatrix) && payload.controlMatrix.length ? payload.controlMatrix : DIGITAL_HOSPITAL_CONTROL_MATRIX,
    evidencePacks: Array.isArray(payload.evidencePackets) && payload.evidencePackets.length ? payload.evidencePackets : DIGITAL_HOSPITAL_EVIDENCE_PACKS,
    reviewQueue: Array.isArray(payload.reviewQueue) && payload.reviewQueue.length ? payload.reviewQueue : DIGITAL_HOSPITAL_REVIEW_QUEUE,
    securityBoundary: Array.isArray(payload.securityBoundary) && payload.securityBoundary.length ? payload.securityBoundary : DIGITAL_HOSPITAL_SECURITY_BOUNDARY,
    summary: payload.summary || null,
    riskItems: Array.isArray(payload.riskItems) ? payload.riskItems : [],
    checks: Array.isArray(payload.checks) ? payload.checks : [],
    launchReadiness: payload.launchReadiness || null,
    productionEvidenceBoard: payload.productionEvidenceBoard || payload.launchReadiness?.productionEvidenceBoard || null,
    launchCommandBriefBoard: payload.launchCommandBriefBoard || payload.launchReadiness?.launchCommandBriefBoard || null,
    formalCutoverApprovalBoard: payload.formalCutoverApprovalBoard || payload.launchReadiness?.formalCutoverApprovalBoard || null,
    source: payload.ok ? "api" : "static"
  };
}

function digitalHospitalStandardDomains() {
  return digitalHospitalRuntime.standardDomains || DIGITAL_HOSPITAL_STANDARD_DOMAINS;
}

function digitalHospitalPolicyRegister() {
  return digitalHospitalRuntime.policyRegister || DIGITAL_HOSPITAL_POLICY_REGISTER;
}

function digitalHospitalControlMatrix() {
  return digitalHospitalRuntime.controlMatrix || DIGITAL_HOSPITAL_CONTROL_MATRIX;
}

function digitalHospitalWorkflow() {
  return digitalHospitalRuntime.workflow || DIGITAL_HOSPITAL_WORKFLOW;
}

function digitalHospitalEvidencePacks() {
  return digitalHospitalRuntime.evidencePacks || DIGITAL_HOSPITAL_EVIDENCE_PACKS;
}

function digitalHospitalReviewQueue() {
  return digitalHospitalRuntime.reviewQueue || DIGITAL_HOSPITAL_REVIEW_QUEUE;
}

function digitalHospitalSecurityBoundary() {
  return digitalHospitalRuntime.securityBoundary || DIGITAL_HOSPITAL_SECURITY_BOUNDARY;
}

function digitalHospitalPilotPackages() {
  return digitalHospitalRuntime.pilotPackages || DIGITAL_HOSPITAL_PILOT_PACKAGES;
}

function digitalHospitalLaunchReadiness() {
  return digitalHospitalRuntime.launchReadiness || null;
}

function digitalHospitalProductionEvidenceBoard() {
  return digitalHospitalRuntime.productionEvidenceBoard || digitalHospitalRuntime.launchReadiness?.productionEvidenceBoard || null;
}

function digitalHospitalLaunchCommandBriefBoard() {
  return digitalHospitalRuntime.launchCommandBriefBoard || digitalHospitalRuntime.launchReadiness?.launchCommandBriefBoard || null;
}

function digitalHospitalFormalCutoverApprovalBoard() {
  return digitalHospitalRuntime.formalCutoverApprovalBoard || digitalHospitalRuntime.launchReadiness?.formalCutoverApprovalBoard || null;
}

function digitalText(value) {
  return value === undefined || value === null || value === "" ? "-" : String(value);
}

function digitalEscape(value) {
  return digitalText(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function digitalSetHtml(id, html) {
  const element = document.getElementById(id);
  if (element) element.innerHTML = html;
}

function digitalBadgeClass(level) {
  if (level === "P0") return "badge danger";
  if (level === "P1") return "badge warn";
  return "badge info";
}

function digitalPolicyBindingLabel(value) {
  return ({
    mandatory: "法定强制",
    "management-required": "行业管理要求",
    "evaluation-reference": "评价参考",
    "recommended-standard": "推荐性标准",
    "policy-guidance": "政策指导",
    "historical-planning": "历史规划"
  })[value] || value || "-";
}

function digitalPolicyLifecycleLabel(value) {
  return ({
    effective: "现行",
    "current-reference": "现行参考",
    conditional: "条件适用",
    "historical-plan": "历史规划"
  })[value] || value || "-";
}

function digitalPolicyStatusClass(item = {}) {
  if (item.reviewStatus === "requires-update") return "badge danger";
  if (item.lifecycleStatus === "historical-plan" || item.reviewStatus === "local-supplement-required") return "badge warn";
  return "badge info";
}

function renderPolicyFilters() {
  const domainSelect = document.getElementById("policy-domain-filter");
  if (domainSelect && domainSelect.options.length <= 1) {
    const domains = [...new Set(digitalHospitalPolicyRegister().flatMap((item) => item.domains || []))];
    domainSelect.innerHTML = `<option value="">全部六域</option>${domains.map((domain) => `<option value="${digitalEscape(domain)}">${digitalEscape(domain)}</option>`).join("")}`;
  }
  const reviewSelect = document.getElementById("digital-hospital-policy-review-id");
  if (reviewSelect) {
    const current = reviewSelect.value;
    reviewSelect.innerHTML = digitalHospitalPolicyRegister().map((item) => `<option value="${digitalEscape(item.id)}">${digitalEscape(item.title)}</option>`).join("");
    if ([...reviewSelect.options].some((option) => option.value === current)) reviewSelect.value = current;
  }
}

function filteredPolicyRows() {
  const domain = document.getElementById("policy-domain-filter")?.value || "";
  const binding = document.getElementById("policy-binding-filter")?.value || "";
  const lifecycle = document.getElementById("policy-lifecycle-filter")?.value || "";
  const query = (document.getElementById("policy-search")?.value || "").trim().toLowerCase();
  return digitalHospitalPolicyRegister().filter((item) => {
    const blob = [item.title, item.documentNo, item.authorityLevel, item.applicability, ...(item.domains || []), ...(item.controlTopics || [])].join(" ").toLowerCase();
    return (!domain || (item.domains || []).includes(domain))
      && (!binding || item.bindingLevel === binding)
      && (!lifecycle || item.lifecycleStatus === lifecycle)
      && (!query || blob.includes(query));
  });
}

function renderPolicyRegister() {
  renderPolicyFilters();
  const allPolicies = digitalHospitalPolicyRegister();
  const rows = filteredPolicyRows();
  const summary = digitalHospitalRuntime.policySummary || {};
  const metrics = [
    ["规范文件", summary.policies || allPolicies.length, `${rows.length} 项符合当前筛选`],
    ["法定强制", summary.mandatoryPolicies ?? allPolicies.filter((item) => item.bindingLevel === "mandatory").length, "法律与行政法规"],
    ["评价参考", summary.evaluationReferences ?? allPolicies.filter((item) => item.bindingLevel === "evaluation-reference").length, "不等同法定强制"],
    ["历史规划", summary.historicalPolicies ?? allPolicies.filter((item) => item.lifecycleStatus === "historical-plan").length, "不得直接作为2026硬任务"],
    ["控制阻断", summary.blockingControls ?? digitalHospitalControlMatrix().filter((item) => item.goLiveCritical && item.implementationState !== "implemented").length, "仍需实施或现场证据"]
  ];
  digitalSetHtml("digital-hospital-policy-metrics", metrics.map(([label, value, hint]) => `
    <article class="metric-card">
      <span>${digitalEscape(label)}</span>
      <strong>${digitalEscape(value)}</strong>
      <small>${digitalEscape(hint)}</small>
    </article>
  `).join(""));
  digitalSetHtml("digital-hospital-policy-register", `
    <table>
      <thead><tr><th>规范文件</th><th>效力与状态</th><th>适用范围</th><th>六域与控制主题</th><th>复核</th></tr></thead>
      <tbody>
        ${rows.map((item) => `
          <tr>
            <td><strong>${digitalEscape(item.title)}</strong><br /><small>${digitalEscape(item.documentNo)} / ${digitalEscape(item.authorityLevel)}</small><br /><a href="${digitalEscape(item.sourceUrl)}" target="_blank" rel="noreferrer">官方来源</a></td>
            <td><span class="${digitalPolicyStatusClass(item)}">${digitalEscape(digitalPolicyBindingLabel(item.bindingLevel))}</span><br /><small>${digitalEscape(digitalPolicyLifecycleLabel(item.lifecycleStatus))} / ${digitalEscape(item.reviewStatus)}</small></td>
            <td>${digitalEscape(item.applicability)}</td>
            <td>${digitalEscape((item.domains || []).join("、"))}<br /><small>${digitalEscape((item.controlTopics || []).join("、"))}</small></td>
            <td>${digitalEscape(item.lastReviewedAt || "未复核")}<br /><small>下次：${digitalEscape(item.nextReviewAt || "历史归档")}</small></td>
          </tr>
        `).join("") || `<tr><td colspan="5">没有符合筛选条件的规范。</td></tr>`}
      </tbody>
    </table>
  `);
}

function renderControlMatrix() {
  const policies = new Map(digitalHospitalPolicyRegister().map((item) => [item.id, item]));
  digitalSetHtml("digital-hospital-control-matrix", `
    <table>
      <thead><tr><th>标准域与控制</th><th>依据</th><th>实现状态</th><th>证据与自动检查</th><th>缺口</th></tr></thead>
      <tbody>
        ${digitalHospitalControlMatrix().map((item) => {
          const requirements = (item.requirementIds || []).map((id) => policies.get(id)?.title || id);
          const statusClass = item.implementationState === "implemented" ? "badge info" : item.goLiveCritical ? "badge danger" : "badge warn";
          return `
            <tr>
              <td><strong>${digitalEscape(item.domain)}：${digitalEscape(item.title)}</strong><br /><small>${digitalEscape(item.controlOwner)}</small></td>
              <td>${digitalEscape(requirements.join("；"))}</td>
              <td><span class="${statusClass}">${digitalEscape(item.implementationState)}</span><br /><small>${item.goLiveCritical ? "上线关键控制" : "评价改进控制"}</small></td>
              <td>${digitalEscape((item.evidenceCollections || []).join("、"))}<br /><small>${digitalEscape((item.automatedChecks || []).join("、"))}</small></td>
              <td>${digitalEscape(item.gap)}</td>
            </tr>
          `;
        }).join("")}
      </tbody>
    </table>
  `);
}

async function recordDigitalHospitalPolicyReview(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  const feedback = document.getElementById("digital-hospital-policy-review-feedback");
  const policyId = document.getElementById("digital-hospital-policy-review-id")?.value || "";
  const fetcher = window.HealthCityAuth?.authFetch || fetch;
  if (button) {
    button.disabled = true;
    button.textContent = "记录中...";
  }
  try {
    const response = await fetcher(`${DIGITAL_HOSPITAL_POLICY_REGISTER_ENDPOINT}/${encodeURIComponent(policyId)}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "review-policy",
        reviewStatus: document.getElementById("digital-hospital-policy-review-status")?.value || "verified-current",
        nextReviewAt: document.getElementById("digital-hospital-policy-next-review")?.value || "",
        reviewNote: document.getElementById("digital-hospital-policy-review-note")?.value || ""
      })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.message || `HTTP ${response.status}`);
    if (payload?.standards?.ok) setDigitalHospitalRuntime(payload.standards);
    renderDigitalHospitalStandards();
    if (feedback) {
      feedback.className = "badge info";
      feedback.textContent = "复核已记录并写入审计链";
    }
    form.reset();
  } catch (error) {
    if (feedback) {
      feedback.className = "badge danger";
      feedback.textContent = error.message || "复核记录失败";
    }
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "记录复核";
    }
  }
}

function bindDigitalHospitalPolicyActions() {
  ["policy-domain-filter", "policy-binding-filter", "policy-lifecycle-filter", "policy-search"].forEach((id) => {
    const element = document.getElementById(id);
    if (element && element.dataset.digitalHospitalPolicyBound !== "1") {
      element.dataset.digitalHospitalPolicyBound = "1";
      element.addEventListener("input", renderPolicyRegister);
    }
  });
  const form = document.getElementById("digital-hospital-policy-review-form");
  if (form && form.dataset.digitalHospitalPolicyBound !== "1") {
    form.dataset.digitalHospitalPolicyBound = "1";
    form.addEventListener("submit", recordDigitalHospitalPolicyReview);
  }
}

function renderDigitalHospitalMetrics(rows = DIGITAL_HOSPITAL_STANDARD_DOMAINS) {
  const blockers = rows.filter((item) => item.blocker).length;
  const p0 = rows.filter((item) => item.level === "P0").length;
  const summary = digitalHospitalRuntime.summary;
  const metrics = [
    ["标准域", summary?.domains || rows.length, "电子病历、互联互通、智慧服务、智慧管理等"],
    ["P0 中枢能力", summary?.p0Standards || p0, "标准、互联互通、安全合规优先"],
    ["采集方式", summary?.evidencePackets || digitalHospitalEvidencePacks().length, "接口、模板、材料、抽样、审计"],
    ["审核环节", summary?.evaluationTasks || digitalHospitalWorkflow().length, "从标准发布到整改闭环"],
    ["现场阻断项", summary?.blockers || blockers, digitalHospitalRuntime.source === "api" ? "来自平台 API 汇总" : "只标阻断，不假装已上线"]
  ];
  digitalSetHtml("digital-hospital-metrics", metrics.map(([label, value, hint]) => `
    <article class="metric-card">
      <span>${digitalEscape(label)}</span>
      <strong>${digitalEscape(value)}</strong>
      <small>${digitalEscape(hint)}</small>
    </article>
  `).join(""));
}

function renderStandardFilters() {
  const select = document.getElementById("standard-domain-filter");
  if (!select) return;
  const domains = [...new Set(digitalHospitalStandardDomains().map((item) => item.domain))];
  select.innerHTML = `<option value="">全部标准域</option>${domains.map((domain) => `<option value="${digitalEscape(domain)}">${digitalEscape(domain)}</option>`).join("")}`;
}

function filteredStandardRows() {
  const domain = document.getElementById("standard-domain-filter")?.value || "";
  const query = (document.getElementById("standard-search")?.value || "").trim().toLowerCase();
  const blockerOnly = Boolean(document.getElementById("standard-blocker-filter")?.checked);
  return digitalHospitalStandardDomains().filter((item) => {
    const blob = [item.domain, item.title, item.source, item.indicators.join(" "), item.evidence.join(" "), item.dataPath, item.nextAction, item.owner, item.blocker].join(" ").toLowerCase();
    return (!domain || item.domain === domain) && (!query || blob.includes(query)) && (!blockerOnly || item.blocker);
  });
}

function renderStandardMap() {
  const rows = filteredStandardRows();
  renderDigitalHospitalMetrics(rows);
  digitalSetHtml("digital-hospital-standard-map", rows.map((item) => `
    <article class="priority-row standard-item" data-standard-domain="${digitalEscape(item.domain)}">
      <div>
        <span class="${digitalBadgeClass(item.level)}">${digitalEscape(item.level)}</span>
        <h3>${digitalEscape(item.title)}</h3>
        <p>${digitalEscape(item.source)}</p>
        <div class="standard-tags">
          ${item.indicators.map((tag) => `<span class="badge info">${digitalEscape(tag)}</span>`).join("")}
        </div>
        <p><strong>证据：</strong>${digitalEscape(item.evidence.join("、"))}</p>
        <p><strong>采集路径：</strong>${digitalEscape(item.dataPath)}</p>
        <p><strong>下一步：</strong>${digitalEscape(item.nextAction)}</p>
        <p><strong>阻断项：</strong>${digitalEscape(item.blocker)}</p>
      </div>
      <div class="score-badge">
        <strong>${digitalEscape(item.domain.slice(0, 2))}</strong>
        <span>${digitalEscape(item.owner)}</span>
      </div>
    </article>
  `).join("") || `<p class="muted">没有匹配的标准域。</p>`);
}

function renderWorkflow() {
  digitalSetHtml("digital-hospital-workflow", `
    <table>
      <thead><tr><th>环节</th><th>主体</th><th>动作</th><th>留痕证据</th></tr></thead>
      <tbody>
        ${digitalHospitalWorkflow().map(([stage, actor, action, evidence]) => `
          <tr>
            <td><strong>${digitalEscape(stage)}</strong></td>
            <td>${digitalEscape(actor)}</td>
            <td>${digitalEscape(action)}</td>
            <td>${digitalEscape(evidence)}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `);
}

function renderSecurityBoundary() {
  digitalSetHtml("digital-hospital-security", digitalHospitalSecurityBoundary().map((item) => `
    <div class="rule-card">
      <strong>${digitalEscape(item)}</strong>
      <span>安全合规基线</span>
    </div>
  `).join(""));
}

function renderEvidencePacks() {
  digitalSetHtml("digital-hospital-evidence", digitalHospitalEvidencePacks().map((item) => `
    <article>
      <div>
        <span class="badge info">${digitalEscape(item.id)}</span>
        <span class="badge">${digitalEscape(item.status)}</span>
      </div>
      <h3>${digitalEscape(item.title)}</h3>
      <p>${digitalEscape(item.detail)}</p>
      <footer>
        <small>责任方</small>
        <strong>${digitalEscape(item.owner)}</strong>
      </footer>
    </article>
  `).join(""));
}

function renderReviewQueue() {
  digitalSetHtml("digital-hospital-review-queue", digitalHospitalReviewQueue().map((item) => `
    <div class="rule-card">
      <strong>${digitalEscape(item.label)}</strong>
      <span>${digitalEscape(item.count)} 项 ${digitalEscape(item.status)}</span>
      <p>${digitalEscape(item.next)}</p>
    </div>
  `).join(""));
}

function renderPilotReadiness() {
  digitalSetHtml("digital-hospital-pilot-readiness", `
    <table>
      <thead><tr><th>试点对象</th><th>建议规模</th><th>已具备能力</th><th>现场阻断项</th></tr></thead>
      <tbody>
        ${digitalHospitalPilotPackages().map((item) => `
          <tr>
            <td><strong>${digitalEscape(item.type)}</strong></td>
            <td>${digitalEscape(item.target)}</td>
            <td>${digitalEscape(item.ready)}</td>
            <td>${digitalEscape(item.blocker)}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `);
}

function renderLaunchReadiness() {
  const readiness = digitalHospitalLaunchReadiness();
  if (!readiness) {
    digitalSetHtml("digital-hospital-launch-readiness", `
      <table>
        <tbody>
          <tr><td><strong>Launch readiness</strong></td><td>Waiting for platform API summary.</td></tr>
        </tbody>
      </table>
    `);
    return;
  }
  const summary = readiness.summary || {};
  const gate = readiness.launchGate || {};
  const rows = Array.isArray(readiness.requirements) ? readiness.requirements : [];
  const formalBlockers = Array.isArray(readiness.formalBlockers) ? readiness.formalBlockers : [];
  digitalSetHtml("digital-hospital-launch-readiness", `
    <table>
      <thead><tr><th>Gate</th><th>State</th><th>Evidence</th><th>Next action</th></tr></thead>
      <tbody>
        <tr>
          <td><strong>Pilot launch</strong></td>
          <td><span class="${gate.pilotLaunchReady ? "badge info" : "badge danger"}">${gate.pilotLaunchReady ? "ready" : "blocked"}</span></td>
          <td>${digitalEscape(summary.p0Requirements || 0)} P0 requirements / ${digitalEscape(summary.p0Blocking || 0)} blockers</td>
          <td>${digitalEscape(gate.releaseGate)}</td>
        </tr>
        <tr>
          <td><strong>Formal production</strong></td>
          <td><span class="${gate.formalProductionReady ? "badge info" : "badge warn"}">${digitalEscape(gate.formalGoLiveState)}</span></td>
          <td>${digitalEscape(summary.siteSigned || 0)}/${digitalEscape(summary.siteRequired || 0)} site signoffs</td>
          <td>${digitalEscape(gate.nextAction)}</td>
        </tr>
      </tbody>
    </table>
    <table>
      <thead><tr><th>Requirement</th><th>Owner</th><th>Status</th><th>Evidence</th><th>Action</th></tr></thead>
      <tbody>
        ${rows.map((item) => `
          <tr>
            <td><strong>${digitalEscape(item.title)}</strong><br /><small>${digitalEscape(item.priority)} / ${digitalEscape(item.domain)}</small></td>
            <td>${digitalEscape(item.owner)}</td>
            <td><span class="${item.siteRequired && !item.siteSigned ? "badge warn" : "badge info"}">${digitalEscape(item.status)}${item.siteRequired && !item.siteSigned ? " / site signoff pending" : ""}</span></td>
            <td>${digitalEscape((item.evidence || []).join(", "))}</td>
            <td>${item.siteRequired ? `<button class="inline-action" data-digital-hospital-launch-id="${digitalEscape(item.id)}" type="button">${item.siteSigned ? "Refresh evidence" : "Record signoff"}</button>` : "<span class=\"badge info\">ready</span>"}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
    ${formalBlockers.length ? `
      <table>
        <thead><tr><th>Formal blocker</th><th>Required evidence</th><th>Next action</th></tr></thead>
        <tbody>
          ${formalBlockers.map((item) => `
            <tr>
              <td><strong>${digitalEscape(item.title)}</strong></td>
              <td>${digitalEscape((item.requiredEvidence || []).join(", "))}</td>
              <td>${digitalEscape(item.nextAction)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    ` : ""}
  `);
  bindDigitalHospitalLaunchActions();
}

function renderProductionEvidencePackets() {
  const board = digitalHospitalProductionEvidenceBoard();
  if (!board) {
    digitalSetHtml("digital-hospital-production-evidence", `
      <table>
        <tbody>
          <tr><td><strong>Production evidence packets</strong></td><td>Waiting for platform API summary.</td></tr>
        </tbody>
      </table>
    `);
    return;
  }
  const summary = board.summary || {};
  const packets = Array.isArray(board.packets) ? board.packets : [];
  digitalSetHtml("digital-hospital-production-evidence", `
    <table>
      <thead><tr><th>Evidence gate</th><th>State</th><th>Completion</th><th>Next action</th></tr></thead>
      <tbody>
        <tr>
          <td><strong>Formal cutover packets</strong></td>
          <td><span class="${summary.missingItems === 0 ? "badge info" : "badge warn"}">${digitalEscape(board.status || "pending-site-evidence")}</span></td>
          <td>${digitalEscape(summary.verifiedItems || 0)}/${digitalEscape(summary.requiredItems || 0)} items verified / ${digitalEscape(summary.completePackets || 0)}/${digitalEscape(summary.packets || 0)} packets complete</td>
          <td>${summary.missingItems === 0 ? "Ready to archive final production cutover package." : "Verify remaining site evidence before formal production cutover."}</td>
        </tr>
      </tbody>
    </table>
    <table>
      <thead><tr><th>Packet</th><th>Owner</th><th>Status</th><th>Required items</th><th>Action</th></tr></thead>
      <tbody>
        ${packets.map((packet) => {
          const requiredItems = Array.isArray(packet.requiredItems) ? packet.requiredItems : [];
          const nextItem = requiredItems.find((item) => !/verified|signed|accepted|complete|ready/i.test(String(item.status || ""))) || requiredItems[0] || {};
          return `
            <tr>
              <td><strong>${digitalEscape(packet.title)}</strong><br /><small>${digitalEscape(packet.severity)} / ${digitalEscape(packet.category)} / ${digitalEscape(packet.linkedRequirementTitle || packet.linkedRequirementId)}</small></td>
              <td>${digitalEscape(packet.assignee || packet.owner)}</td>
              <td><span class="${packet.signoffStatus === "signed" ? "badge info" : "badge warn"}">${digitalEscape(packet.status || packet.signoffStatus || "pending")}</span></td>
              <td>${digitalEscape((requiredItems || []).map((item) => `${item.name}: ${item.status || "pending"}`).join("; "))}</td>
              <td><button class="inline-action" data-digital-hospital-production-packet="${digitalEscape(packet.id)}" data-digital-hospital-production-item="${digitalEscape(nextItem.id || "")}" type="button">${packet.signoffStatus === "signed" ? "Refresh packet" : "Verify next item"}</button></td>
            </tr>
          `;
        }).join("")}
      </tbody>
    </table>
  `);
  bindDigitalHospitalProductionEvidenceActions();
}

function renderLaunchCommandBriefs() {
  const board = digitalHospitalLaunchCommandBriefBoard();
  if (!board) {
    digitalSetHtml("digital-hospital-launch-command-briefs", `
      <table>
        <tbody>
          <tr><td><strong>Launch command briefs</strong></td><td>Waiting for platform API summary.</td></tr>
        </tbody>
      </table>
    `);
    return;
  }
  const summary = board.summary || {};
  const briefs = Array.isArray(board.briefs) ? board.briefs : [];
  digitalSetHtml("digital-hospital-launch-command-briefs", `
    <table>
      <thead><tr><th>Command desk</th><th>State</th><th>Coverage</th><th>Next action</th></tr></thead>
      <tbody>
        <tr>
          <td><strong>Launch command briefs</strong></td>
          <td><span class="${summary.blockedBriefs ? "badge warn" : "badge info"}">${digitalEscape(board.status || "briefing-ready")}</span></td>
          <td>${digitalEscape(summary.readyBriefs || 0)}/${digitalEscape(summary.briefs || 0)} ready / ${digitalEscape(summary.publishedBriefs || 0)} published</td>
          <td>${summary.blockedBriefs ? "Publish or restore blocked launch command briefs." : "Keep command briefs aligned with evidence packets and first-day watch."}</td>
        </tr>
      </tbody>
    </table>
    <table>
      <thead><tr><th>Brief</th><th>Owner</th><th>Status</th><th>Artifacts</th><th>Action</th></tr></thead>
      <tbody>
        ${briefs.map((brief) => `
          <tr>
            <td><strong>${digitalEscape(brief.title)}</strong><br /><small>${digitalEscape(brief.phase)} / ${digitalEscape(brief.publishChannel)}</small></td>
            <td>${digitalEscape(brief.decisionOwner || brief.owner)}</td>
            <td><span class="${brief.ready ? "badge info" : "badge warn"}">${digitalEscape(brief.status || "ready")}</span></td>
            <td>${digitalEscape((brief.requiredArtifacts || []).join(", "))}</td>
            <td><button class="inline-action" data-digital-hospital-command-brief="${digitalEscape(brief.id)}" type="button">${/published|sent|archived|closed/i.test(String(brief.status || "")) ? "Refresh brief" : "Publish brief"}</button></td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `);
  bindDigitalHospitalLaunchCommandBriefActions();
}

function renderFormalCutoverApprovals() {
  const board = digitalHospitalFormalCutoverApprovalBoard();
  if (!board) {
    digitalSetHtml("digital-hospital-formal-cutover-approvals", `
      <table><tbody><tr><td><strong>Formal cutover approvals</strong></td><td>Waiting for platform API summary.</td></tr></tbody></table>
    `);
    return;
  }
  const summary = board.summary || {};
  const prerequisites = board.prerequisites || {};
  const approvals = Array.isArray(board.approvals) ? board.approvals : [];
  const disabled = board.eligible ? "" : " disabled";
  digitalSetHtml("digital-hospital-formal-cutover-approvals", `
    <table>
      <thead><tr><th>Authorization gate</th><th>State</th><th>Independent signers</th><th>Prerequisites</th></tr></thead>
      <tbody>
        <tr>
          <td><strong>Formal production cutover</strong></td>
          <td><span class="${board.allApproved ? "badge info" : "badge warn"}">${digitalEscape(board.status || "blocked-by-site-evidence")}</span></td>
          <td>${digitalEscape(summary.approvedApprovals || 0)}/${digitalEscape(summary.approvals || 0)} approved / ${digitalEscape(summary.distinctSigners || 0)} distinct</td>
          <td>${digitalEscape(prerequisites.siteUnsigned || 0)} site signoffs open / ${digitalEscape(prerequisites.productionEvidenceMissing || 0)} evidence items open</td>
        </tr>
      </tbody>
    </table>
    <table>
      <thead><tr><th>Approval</th><th>Owner</th><th>Status</th><th>Ticket and window</th></tr></thead>
      <tbody>
        ${approvals.map((approval) => `
          <tr>
            <td><strong>${digitalEscape(approval.title)}</strong><br /><small>${digitalEscape(approval.sequence)} / ${digitalEscape(approval.role)}</small></td>
            <td>${digitalEscape(approval.signedBy || approval.owner)}</td>
            <td><span class="${approval.approved ? "badge info" : "badge warn"}">${digitalEscape(approval.status || "awaiting-site-evidence")}</span></td>
            <td>${digitalEscape(approval.changeTicket || "-")}<br /><small>${digitalEscape(approval.cutoverWindow || approval.nextAction)}</small></td>
          </tr>
        `).join("")}
      </tbody>
    </table>
    <form id="digital-hospital-formal-cutover-form" class="filter-grid" autocomplete="off">
      <label>审批角色
        <select id="digital-hospital-formal-approval-id"${disabled}>
          ${approvals.map((approval) => `<option value="${digitalEscape(approval.id)}">${digitalEscape(approval.title)}</option>`).join("")}
        </select>
      </label>
      <label>签署人
        <input id="digital-hospital-formal-signer" type="text" required${disabled} />
      </label>
      <label>变更单
        <input id="digital-hospital-formal-ticket" type="text" required${disabled} />
      </label>
      <label>割接窗口
        <input id="digital-hospital-formal-window" type="datetime-local" required${disabled} />
      </label>
      <label>确认口令
        <input id="digital-hospital-formal-confirmation" type="text" placeholder="APPROVE FORMAL CUTOVER" required${disabled} />
      </label>
      <button class="inline-action" type="submit"${disabled}>正式批准</button>
      <span id="digital-hospital-formal-cutover-feedback" class="badge ${board.eligible ? "info" : "warn"}">${board.eligible ? "eligible for independent approval" : "site evidence gate is still blocking approval"}</span>
    </form>
  `);
  bindDigitalHospitalFormalCutoverApprovalActions();
}

function renderSourceMap() {
  digitalSetHtml("digital-hospital-source-map", `
    <table>
      <thead><tr><th>依据</th><th>平台能力</th><th>链接</th></tr></thead>
      <tbody>
        ${digitalHospitalStandardDomains().map((item) => `
          <tr>
            <td><strong>${digitalEscape(item.source)}</strong></td>
            <td>${digitalEscape(item.title)}<br /><small>${digitalEscape(item.indicators.join("、"))}</small></td>
            <td><a href="${digitalEscape(item.sourceUrl)}" target="_blank" rel="noreferrer">官方来源</a></td>
          </tr>
        `).join("")}
        <tr>
          <td><strong>网络安全法、数据安全法、个人信息保护法</strong></td>
          <td>最小必要、分类分级、权限隔离、敏感材料导出审批和全程审计</td>
          <td><a href="${DIGITAL_HOSPITAL_SOURCE_URLS.cybersecurityLaw}" target="_blank" rel="noreferrer">网安法</a> / <a href="${DIGITAL_HOSPITAL_SOURCE_URLS.dataSecurityLaw}" target="_blank" rel="noreferrer">数据安全法</a> / <a href="${DIGITAL_HOSPITAL_SOURCE_URLS.pipLaw}" target="_blank" rel="noreferrer">个保法</a></td>
        </tr>
      </tbody>
    </table>
  `);
}

async function recordDigitalHospitalLaunchEvidence(requirementId, button) {
  const fetcher = window.HealthCityAuth?.authFetch || fetch;
  if (button) {
    button.disabled = true;
    button.textContent = "Recording...";
  }
  try {
    const response = await fetcher(`${DIGITAL_HOSPITAL_LAUNCH_ENDPOINT}/${encodeURIComponent(requirementId)}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "record-site-signoff",
        status: "signed",
        siteSigned: true,
        evidence: ["browser-launch-readiness-signoff"],
        note: "Recorded from digital hospital launch readiness board."
      })
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    if (payload?.standards?.ok) {
      setDigitalHospitalRuntime(payload.standards);
    } else if (payload?.launchReadiness) {
      digitalHospitalRuntime = { ...digitalHospitalRuntime, launchReadiness: payload.launchReadiness };
    }
    renderDigitalHospitalStandards();
  } catch {
    if (button) {
      button.disabled = false;
      button.textContent = "Retry";
    }
  }
}

async function recordDigitalHospitalProductionEvidence(packetId, itemId, button) {
  const fetcher = window.HealthCityAuth?.authFetch || fetch;
  if (button) {
    button.disabled = true;
    button.textContent = "Verifying...";
  }
  try {
    const response = await fetcher(`${DIGITAL_HOSPITAL_PRODUCTION_EVIDENCE_ENDPOINT}/${encodeURIComponent(packetId)}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "verify-production-evidence",
        status: "verified",
        itemId,
        artifactName: "browser-production-evidence-verification",
        attachmentNames: ["digital-hospital-production-evidence"],
        note: "Recorded from digital hospital production evidence packet board."
      })
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    if (payload?.standards?.ok) {
      setDigitalHospitalRuntime(payload.standards);
    } else {
      digitalHospitalRuntime = {
        ...digitalHospitalRuntime,
        launchReadiness: payload.launchReadiness || digitalHospitalRuntime.launchReadiness,
        productionEvidenceBoard: payload.board || payload.launchReadiness?.productionEvidenceBoard || digitalHospitalRuntime.productionEvidenceBoard
      };
    }
    renderDigitalHospitalStandards();
  } catch {
    if (button) {
      button.disabled = false;
      button.textContent = "Retry";
    }
  }
}

async function recordDigitalHospitalLaunchCommandBrief(briefId, button) {
  const fetcher = window.HealthCityAuth?.authFetch || fetch;
  if (button) {
    button.disabled = true;
    button.textContent = "Publishing...";
  }
  try {
    const response = await fetcher(`${DIGITAL_HOSPITAL_COMMAND_BRIEF_ENDPOINT}/${encodeURIComponent(briefId)}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "record-launch-command-brief",
        status: "published",
        artifactName: "browser-launch-command-brief",
        attachmentNames: ["digital-hospital-launch-command-brief"],
        note: "Published from digital hospital launch command brief board."
      })
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    if (payload?.standards?.ok) {
      setDigitalHospitalRuntime(payload.standards);
    } else {
      digitalHospitalRuntime = {
        ...digitalHospitalRuntime,
        launchReadiness: payload.launchReadiness || digitalHospitalRuntime.launchReadiness,
        launchCommandBriefBoard: payload.board || payload.launchReadiness?.launchCommandBriefBoard || digitalHospitalRuntime.launchCommandBriefBoard
      };
    }
    renderDigitalHospitalStandards();
  } catch {
    if (button) {
      button.disabled = false;
      button.textContent = "Retry";
    }
  }
}

async function recordDigitalHospitalFormalCutoverApproval(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  const feedback = document.getElementById("digital-hospital-formal-cutover-feedback");
  const approvalId = document.getElementById("digital-hospital-formal-approval-id")?.value || "";
  const fetcher = window.HealthCityAuth?.authFetch || fetch;
  if (button) {
    button.disabled = true;
    button.textContent = "审批中...";
  }
  try {
    const response = await fetcher(`${DIGITAL_HOSPITAL_FORMAL_CUTOVER_APPROVAL_ENDPOINT}/${encodeURIComponent(approvalId)}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "record-formal-cutover-approval",
        status: "approved",
        signedBy: document.getElementById("digital-hospital-formal-signer")?.value || "",
        changeTicket: document.getElementById("digital-hospital-formal-ticket")?.value || "",
        cutoverWindow: document.getElementById("digital-hospital-formal-window")?.value || "",
        confirmation: document.getElementById("digital-hospital-formal-confirmation")?.value || "",
        note: "Approved from digital hospital formal cutover desk."
      })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.message || `HTTP ${response.status}`);
    if (payload?.standards?.ok) {
      setDigitalHospitalRuntime(payload.standards);
    } else {
      digitalHospitalRuntime = {
        ...digitalHospitalRuntime,
        launchReadiness: payload.launchReadiness || digitalHospitalRuntime.launchReadiness,
        formalCutoverApprovalBoard: payload.board || payload.launchReadiness?.formalCutoverApprovalBoard || digitalHospitalRuntime.formalCutoverApprovalBoard
      };
    }
    renderDigitalHospitalStandards();
  } catch (error) {
    if (button) {
      button.disabled = false;
      button.textContent = "重新审批";
    }
    if (feedback) {
      feedback.className = "badge danger";
      feedback.textContent = error.message || "approval failed";
    }
  }
}

function bindDigitalHospitalLaunchActions() {
  document.querySelectorAll("[data-digital-hospital-launch-id]").forEach((button) => {
    if (button.dataset.digitalHospitalBound === "1") return;
    button.dataset.digitalHospitalBound = "1";
    button.addEventListener("click", () => recordDigitalHospitalLaunchEvidence(button.dataset.digitalHospitalLaunchId, button));
  });
}

function bindDigitalHospitalProductionEvidenceActions() {
  document.querySelectorAll("[data-digital-hospital-production-packet]").forEach((button) => {
    if (button.dataset.digitalHospitalProductionBound === "1") return;
    button.dataset.digitalHospitalProductionBound = "1";
    button.addEventListener("click", () => recordDigitalHospitalProductionEvidence(
      button.dataset.digitalHospitalProductionPacket,
      button.dataset.digitalHospitalProductionItem,
      button
    ));
  });
}

function bindDigitalHospitalLaunchCommandBriefActions() {
  document.querySelectorAll("[data-digital-hospital-command-brief]").forEach((button) => {
    if (button.dataset.digitalHospitalCommandBriefBound === "1") return;
    button.dataset.digitalHospitalCommandBriefBound = "1";
    button.addEventListener("click", () => recordDigitalHospitalLaunchCommandBrief(button.dataset.digitalHospitalCommandBrief, button));
  });
}

function bindDigitalHospitalFormalCutoverApprovalActions() {
  const form = document.getElementById("digital-hospital-formal-cutover-form");
  if (!form || form.dataset.digitalHospitalFormalCutoverBound === "1") return;
  form.dataset.digitalHospitalFormalCutoverBound = "1";
  form.addEventListener("submit", recordDigitalHospitalFormalCutoverApproval);
}

function bindDigitalHospitalFilters() {
  ["standard-domain-filter", "standard-search", "standard-blocker-filter"].forEach((id) => {
    const element = document.getElementById(id);
    if (element && element.dataset.digitalHospitalBound !== "1") {
      element.dataset.digitalHospitalBound = "1";
      element.addEventListener("input", renderStandardMap);
    }
  });
}

function renderDigitalHospitalStandards() {
  renderPolicyRegister();
  renderControlMatrix();
  renderStandardFilters();
  renderStandardMap();
  renderWorkflow();
  renderSecurityBoundary();
  renderEvidencePacks();
  renderReviewQueue();
  renderPilotReadiness();
  renderLaunchReadiness();
  renderProductionEvidencePackets();
  renderLaunchCommandBriefs();
  renderFormalCutoverApprovals();
  renderSourceMap();
  bindDigitalHospitalPolicyActions();
  bindDigitalHospitalFilters();
}

async function loadDigitalHospitalStandardsApi() {
  const fetcher = window.HealthCityAuth?.authFetch || fetch;
  try {
    const response = await fetcher(DIGITAL_HOSPITAL_API_ENDPOINT);
    if (!response.ok) return;
    const payload = await response.json();
    if (!payload?.ok) return;
    setDigitalHospitalRuntime(payload);
    renderDigitalHospitalStandards();
  } catch {
    // Static fallback keeps the standards center usable in file preview or offline demos.
  }
}

function initDigitalHospitalStandards() {
  renderDigitalHospitalStandards();
  loadDigitalHospitalStandardsApi();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initDigitalHospitalStandards);
} else {
  initDigitalHospitalStandards();
}
