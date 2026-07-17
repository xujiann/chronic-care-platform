const DIGITAL_HOSPITAL_SIX_DOMAINS = [
  "电子病历",
  "互联互通",
  "智慧服务",
  "智慧管理",
  "标准服务",
  "安全合规"
];

function seedDigitalHospitalPolicyRegister() {
  const reviewed = "2026-07-16";
  const nextReview = "2027-01-31";
  return [
    {
      id: "dhp-national-hospital-informatization-2018",
      title: "全国医院信息化建设标准与规范（试行）",
      documentNo: "国卫办规划发〔2018〕4号",
      issuingAuthority: "国家卫生健康委员会办公厅",
      domains: DIGITAL_HOSPITAL_SIX_DOMAINS,
      authorityLevel: "行业建设规范",
      bindingLevel: "management-required",
      lifecycleStatus: "effective",
      publishedAt: "2018-04-02",
      sourceUrl: "https://www.nhc.gov.cn/wjw/c100175/201804/19de144b8bc741c19489a8489ba6fa77.shtml",
      applicability: "全国各级各类医院信息化规划、建设、升级和评价准备",
      controlTopics: ["基础设施", "信息平台", "医疗服务", "医院管理", "数据标准", "安全运维"],
      owner: "医院信息化标准组",
      reviewStatus: "verified-current",
      lastReviewedAt: reviewed,
      nextReviewAt: nextReview
    },
    {
      id: "dhp-public-hospital-high-quality-evaluation-2022",
      title: "公立医院高质量发展评价指标（试行）",
      documentNo: "国卫办医发〔2022〕9号",
      issuingAuthority: "国家卫生健康委员会办公厅、国家中医药管理局办公室",
      domains: ["电子病历", "智慧服务", "智慧管理", "标准服务"],
      authorityLevel: "评价指标",
      bindingLevel: "evaluation-reference",
      lifecycleStatus: "current-reference",
      publishedAt: "2022-06-29",
      sourceUrl: "https://www.nhc.gov.cn/yzygj/c100068/202207/585827a94d4b4fcc9a2951e6cdb0c2b8.shtml",
      applicability: "二级及以上公立医院高质量发展年度评价",
      controlTopics: ["智慧医院建设分级", "数据质量", "绩效考核数据复用", "年度评价"],
      owner: "高质量发展评价组",
      reviewStatus: "verified-reference",
      lastReviewedAt: reviewed,
      nextReviewAt: nextReview
    },
    {
      id: "dhp-public-hospital-operations-it-2024",
      title: "公立医院运营管理信息化功能指引",
      documentNo: "公立医疗机构经济管理年配套指引",
      issuingAuthority: "国家卫生健康委员会、国家中医药管理局",
      domains: ["智慧管理", "互联互通", "标准服务", "安全合规"],
      authorityLevel: "应用功能指引",
      bindingLevel: "management-required",
      lifecycleStatus: "effective",
      publishedAt: "2024-07-19",
      sourceUrl: "https://www.nhc.gov.cn/wjw/c100377/202407/49910aa6592a49a6ba787fa8a90f4ce0.shtml",
      applicability: "公立医院运营管理信息集成平台建设",
      controlTopics: ["业财融合", "运营管理平台", "数据共享", "精细化管理"],
      owner: "医院运营管理组",
      reviewStatus: "verified-current",
      lastReviewedAt: reviewed,
      nextReviewAt: nextReview
    },
    {
      id: "dhp-emr-application-management",
      title: "电子病历应用管理规范（试行）",
      documentNo: "国卫办医发〔2017〕8号",
      issuingAuthority: "国家卫生健康主管部门、国家中医药主管部门",
      domains: ["电子病历"],
      authorityLevel: "行业管理规范",
      bindingLevel: "management-required",
      lifecycleStatus: "effective",
      publishedAt: "2017-02-22",
      effectiveAt: "2017-04-01",
      sourceUrl: "https://www.nhc.gov.cn/wjw/c100175/201702/90f3de8ae03d488cbddf509dc958f75b.shtml",
      applicability: "实施电子病历的医疗机构",
      controlTopics: ["病历建立与修改", "电子签名", "封存复制", "访问与质量控制"],
      owner: "医疗质量与病案管理组",
      reviewStatus: "verified-current",
      lastReviewedAt: reviewed,
      nextReviewAt: nextReview
    },
    {
      id: "dhp-emr-leveling-2018",
      title: "电子病历系统应用水平分级评价管理办法及评价标准（试行）",
      documentNo: "国卫办医函〔2018〕1079号",
      issuingAuthority: "国家卫生健康委办公厅",
      domains: ["电子病历"],
      authorityLevel: "评价标准",
      bindingLevel: "evaluation-reference",
      lifecycleStatus: "current-reference",
      publishedAt: "2018-12-09",
      sourceUrl: "https://www.nhc.gov.cn/wjw/c100175/201812/7d64363a20cd4ea798f8343842b28d0c.shtml",
      applicability: "按属地要求参加评价的医疗机构；具体目标以最新属地通知为准",
      controlTopics: ["临床闭环", "数据共享", "质量安全", "智能决策"],
      owner: "电子病历评价组",
      reviewStatus: "verified-reference",
      lastReviewedAt: reviewed,
      nextReviewAt: nextReview
    },
    {
      id: "dhp-interoperability-2020",
      title: "医院信息互联互通标准化成熟度测评方案（2020年版）",
      documentNo: "统计信息中心测评方案",
      issuingAuthority: "国家卫生健康委统计信息中心",
      domains: ["互联互通", "标准服务"],
      authorityLevel: "评价标准",
      bindingLevel: "evaluation-reference",
      lifecycleStatus: "current-reference",
      publishedAt: "2020-08-10",
      sourceUrl: "https://www.nhc.gov.cn/mohwsbwstjxxzx/s8553/202008/bdd0d4fcb1c747dda000e0adec3c17b9.shtml",
      applicability: "申请国家医疗健康信息互联互通标准化成熟度测评的医院",
      controlTopics: ["数据资源标准化", "平台交互服务", "标准符合性测试", "互联互通应用效果"],
      owner: "互联互通评价组",
      reviewStatus: "verified-reference",
      lastReviewedAt: reviewed,
      nextReviewAt: nextReview
    },
    {
      id: "dhp-smart-service-2019",
      title: "医院智慧服务分级评估标准体系（试行）",
      documentNo: "国卫办医函〔2019〕236号",
      issuingAuthority: "国家卫生健康委办公厅",
      domains: ["智慧服务"],
      authorityLevel: "评价标准",
      bindingLevel: "evaluation-reference",
      lifecycleStatus: "current-reference",
      publishedAt: "2019-03-18",
      sourceUrl: "https://www.nhc.gov.cn/yzygj/c100068/201903/004a87a8eb3f48c48ffb120dab883c4f.shtml",
      applicability: "开展智慧服务建设与评价的医疗机构",
      controlTopics: ["诊前服务", "诊中服务", "诊后服务", "患者体验"],
      owner: "智慧服务评价组",
      reviewStatus: "verified-reference",
      lastReviewedAt: reviewed,
      nextReviewAt: nextReview
    },
    {
      id: "dhp-smart-management-2021",
      title: "医院智慧管理分级评估标准体系（试行）",
      documentNo: "国卫办医函〔2021〕86号",
      issuingAuthority: "国家卫生健康委办公厅",
      domains: ["智慧管理"],
      authorityLevel: "评价标准",
      bindingLevel: "evaluation-reference",
      lifecycleStatus: "current-reference",
      publishedAt: "2021-03-15",
      sourceUrl: "https://www.nhc.gov.cn/yzygj/c100068/202103/a14c60de4af9423cbbf45712e27e3cc8.shtml",
      applicability: "应用信息化、智能化手段开展管理的医院；目前主要作为建设参照",
      controlTopics: ["运营管理", "资源调度", "风险预警", "决策支持"],
      owner: "智慧管理评价组",
      reviewStatus: "verified-reference",
      lastReviewedAt: reviewed,
      nextReviewAt: nextReview
    },
    {
      id: "dhp-wst-363-364-2023",
      title: "WS/T 363、WS/T 364—2023卫生健康信息数据元及值域标准",
      documentNo: "国卫通〔2023〕12号",
      issuingAuthority: "国家卫生健康委",
      domains: ["标准服务", "电子病历", "互联互通"],
      authorityLevel: "推荐性卫生行业标准",
      bindingLevel: "recommended-standard",
      lifecycleStatus: "effective",
      publishedAt: "2023-10-30",
      sourceUrl: "https://www.nhc.gov.cn/fzs/c100048/202310/16a32e2b1c0b42e99480b945ef10c0dc.shtml",
      applicability: "医院数据标准化、交换共享、监管上报和评价项目",
      controlTopics: ["数据元目录", "值域代码", "术语映射", "版本管理"],
      owner: "标准与主数据组",
      reviewStatus: "verified-current",
      lastReviewedAt: reviewed,
      nextReviewAt: nextReview
    },
    {
      id: "dhp-wst-846-847-2024",
      title: "WS/T 846.1～846.11—2024医院信息平台交互标准及WS/T 847—2024数字签名标准",
      documentNo: "国卫通告（2024年10月28日）",
      issuingAuthority: "国家卫生健康委",
      domains: ["互联互通", "标准服务", "电子病历"],
      authorityLevel: "推荐性卫生行业标准",
      bindingLevel: "recommended-standard",
      lifecycleStatus: "effective",
      publishedAt: "2024-10-28",
      effectiveAt: "2025-04-01",
      sourceUrl: "https://www.nhc.gov.cn/wjw/zcwjtg/202411/308603c60d554dd49052b5bfb3a9d391.shtml",
      applicability: "医院信息平台注册查询、文档、就诊、医嘱、申请、预约和状态交互",
      controlTopics: ["交互服务契约", "主索引", "电子文档注册", "数字签名"],
      owner: "平台与接口标准组",
      reviewStatus: "verified-current",
      lastReviewedAt: reviewed,
      nextReviewAt: nextReview
    },
    {
      id: "dhp-cybersecurity-law-2025",
      title: "中华人民共和国网络安全法（2025年修正）",
      documentNo: "主席令第六十一号相关修正",
      issuingAuthority: "全国人民代表大会常务委员会",
      domains: ["安全合规"],
      authorityLevel: "法律",
      bindingLevel: "mandatory",
      lifecycleStatus: "effective",
      publishedAt: "2025-10-28",
      effectiveAt: "2026-01-01",
      sourceUrl: "https://www.cac.gov.cn/2025-12/29/c_1768735112911946.htm",
      applicability: "在境内建设、运营、维护和使用网络的组织",
      controlTopics: ["等级保护", "安全运行", "事件处置", "人工智能风险治理"],
      owner: "网络安全组",
      reviewStatus: "verified-current",
      lastReviewedAt: reviewed,
      nextReviewAt: nextReview
    },
    {
      id: "dhp-data-security-law",
      title: "中华人民共和国数据安全法",
      documentNo: "主席令第八十四号",
      issuingAuthority: "全国人民代表大会常务委员会",
      domains: ["安全合规", "标准服务"],
      authorityLevel: "法律",
      bindingLevel: "mandatory",
      lifecycleStatus: "effective",
      publishedAt: "2021-06-10",
      effectiveAt: "2021-09-01",
      sourceUrl: "https://www.cac.gov.cn/2021-06/11/c_1624994566919140.htm",
      applicability: "境内数据处理活动及其安全监管",
      controlTopics: ["分类分级", "重要数据", "风险监测", "事件处置"],
      owner: "数据安全组",
      reviewStatus: "verified-current",
      lastReviewedAt: reviewed,
      nextReviewAt: nextReview
    },
    {
      id: "dhp-personal-information-protection-law",
      title: "中华人民共和国个人信息保护法",
      documentNo: "主席令第九十一号",
      issuingAuthority: "全国人民代表大会常务委员会",
      domains: ["安全合规", "智慧服务", "电子病历"],
      authorityLevel: "法律",
      bindingLevel: "mandatory",
      lifecycleStatus: "effective",
      publishedAt: "2021-08-20",
      effectiveAt: "2021-11-01",
      sourceUrl: "https://www.cac.gov.cn/2021-08/20/c_1631050028355286.htm",
      applicability: "处理患者、居民、医务人员个人信息的全部业务",
      controlTopics: ["敏感个人信息", "最小必要", "单独同意", "影响评估"],
      owner: "个人信息保护负责人",
      reviewStatus: "verified-current",
      lastReviewedAt: reviewed,
      nextReviewAt: nextReview
    },
    {
      id: "dhp-network-data-security-regulation",
      title: "网络数据安全管理条例",
      documentNo: "国务院令第790号",
      issuingAuthority: "国务院",
      domains: ["安全合规", "标准服务"],
      authorityLevel: "行政法规",
      bindingLevel: "mandatory",
      lifecycleStatus: "effective",
      publishedAt: "2024-09-30",
      effectiveAt: "2025-01-01",
      sourceUrl: "https://www.cac.gov.cn/2024-09/30/c_1729384452307680.htm",
      applicability: "境内网络数据处理及符合条件的境外处理活动",
      controlTopics: ["网络数据处理", "委托与共同处理", "个人信息", "重要数据"],
      owner: "数据安全组",
      reviewStatus: "verified-current",
      lastReviewedAt: reviewed,
      nextReviewAt: nextReview
    },
    {
      id: "dhp-healthcare-cybersecurity-management",
      title: "医疗卫生机构网络安全管理办法",
      documentNo: "国卫规划发〔2022〕29号",
      issuingAuthority: "国家卫生健康委、国家中医药局、国家疾控局",
      domains: ["安全合规", "智慧管理"],
      authorityLevel: "行业管理规范",
      bindingLevel: "management-required",
      lifecycleStatus: "effective",
      publishedAt: "2022-08-29",
      sourceUrl: "https://www.nhc.gov.cn/guihuaxxs/c100133/202208/8a23d01133214a779879094dd20cd383.shtml",
      applicability: "各级各类医疗卫生机构",
      controlTopics: ["年度安全自查", "数据资产盘点", "容灾备份", "事件报告"],
      owner: "网络安全组",
      reviewStatus: "verified-current",
      lastReviewedAt: reviewed,
      nextReviewAt: nextReview
    },
    {
      id: "dhp-gbt-22239-2019",
      title: "GB/T 22239—2019网络安全等级保护基本要求",
      documentNo: "GB/T 22239—2019",
      issuingAuthority: "国家市场监督管理总局、国家标准化管理委员会",
      domains: ["安全合规"],
      authorityLevel: "推荐性国家标准",
      bindingLevel: "recommended-standard",
      lifecycleStatus: "effective",
      publishedAt: "2019-05-10",
      effectiveAt: "2019-12-01",
      sourceUrl: "https://openstd.samr.gov.cn/bzgk/std/newGbInfo?hcno=BAFB47E8874764186BDB7865E8344DAF",
      applicability: "落实网络安全等级保护制度的定级系统",
      controlTopics: ["安全通用要求", "云计算扩展", "移动互联扩展", "物联网扩展"],
      owner: "等级保护工作组",
      reviewStatus: "verified-current",
      lastReviewedAt: reviewed,
      nextReviewAt: nextReview
    },
    {
      id: "dhp-ai-healthcare-opinion-2025",
      title: "关于促进和规范‘人工智能+医疗卫生’应用发展的实施意见",
      documentNo: "国卫办规划发〔2025〕30号",
      issuingAuthority: "国家卫生健康委等部门",
      domains: ["电子病历", "智慧服务", "智慧管理", "标准服务", "安全合规"],
      authorityLevel: "政策指导",
      bindingLevel: "policy-guidance",
      lifecycleStatus: "effective",
      publishedAt: "2025-11-04",
      sourceUrl: "https://www.nhc.gov.cn/guihuaxxs/c100133/202511/d1a42ae835c743b9b3e83ac0253c3e9f.shtml",
      applicability: "开展医疗卫生人工智能研发、部署、评估和运营的机构",
      controlTopics: ["高质量数据集", "模型备案", "应用审核", "评测与动态监测"],
      owner: "人工智能治理委员会",
      reviewStatus: "verified-current",
      lastReviewedAt: reviewed,
      nextReviewAt: nextReview
    },
    {
      id: "dhp-ai-scenarios-2024",
      title: "卫生健康行业人工智能应用场景参考指引",
      documentNo: "国卫办规划函〔2024〕420号",
      issuingAuthority: "国家卫生健康委、国家中医药局、国家疾控局",
      domains: ["智慧服务", "智慧管理", "标准服务"],
      authorityLevel: "应用参考指引",
      bindingLevel: "policy-guidance",
      lifecycleStatus: "current-reference",
      publishedAt: "2024-11-14",
      sourceUrl: "https://www.nhc.gov.cn/wjw/c100175/202411/5bcb3c4edd064e31ac5d279caf5830f4.shtml",
      applicability: "卫生健康行业人工智能应用场景规划和立项论证",
      controlTopics: ["场景分类", "临床辅助", "管理辅助", "公共卫生与科研"],
      owner: "人工智能治理委员会",
      reviewStatus: "verified-reference",
      lastReviewedAt: reviewed,
      nextReviewAt: nextReview
    },
    {
      id: "dhp-mutual-recognition-2024",
      title: "关于进一步推进医疗机构检查检验结果互认的指导意见",
      documentNo: "国卫医政发〔2024〕37号",
      issuingAuthority: "国家卫生健康委等七部门",
      domains: ["互联互通", "智慧服务", "标准服务"],
      authorityLevel: "政策指导",
      bindingLevel: "management-required",
      lifecycleStatus: "effective",
      publishedAt: "2024-11-27",
      sourceUrl: "https://www.nhc.gov.cn/yzygj/c100068/202411/e26dde958ae74bf5b8f4fe97d83253c7.shtml",
      applicability: "开展检查检验结果互通共享和互认的医疗机构及区域平台",
      controlTopics: ["互认清单", "负面清单", "质量控制", "跨机构调阅"],
      owner: "检查检验互认专班",
      reviewStatus: "verified-current",
      lastReviewedAt: reviewed,
      nextReviewAt: nextReview
    },
    {
      id: "dhp-internet-diagnosis-supervision-2022",
      title: "互联网诊疗监管细则（试行）",
      documentNo: "国卫办医发〔2022〕2号",
      issuingAuthority: "国家卫生健康委办公厅、国家中医药局办公室",
      domains: ["智慧服务", "电子病历", "安全合规"],
      authorityLevel: "行业管理规范",
      bindingLevel: "management-required",
      lifecycleStatus: "conditional",
      publishedAt: "2022-03-15",
      sourceUrl: "https://www.nhc.gov.cn/yzygj/c100067/202203/61bb44c669144ad1a4266fc4d63dd7a4.shtml",
      applicability: "仅在医疗机构开展互联网诊疗、互联网医院或相关在线复诊业务时适用",
      controlTopics: ["复诊边界", "医师实名认证", "处方审核", "全过程监管"],
      owner: "互联网诊疗管理组",
      reviewStatus: "local-supplement-required",
      lastReviewedAt: reviewed,
      nextReviewAt: nextReview
    },
    {
      id: "dhp-health-information-plan-14fyp",
      title: "‘十四五’全民健康信息化规划",
      documentNo: "规划期2021—2025年",
      issuingAuthority: "国家卫生健康委等部门",
      domains: DIGITAL_HOSPITAL_SIX_DOMAINS,
      authorityLevel: "阶段规划",
      bindingLevel: "historical-planning",
      lifecycleStatus: "historical-plan",
      publishedAt: "2022-11-07",
      sourceUrl: "https://www.ndcpa.gov.cn/jbkzzx/c100030/common/content/content_1658745812574605312.html",
      applicability: "仅作为历史建设依据和继承关系来源，不直接作为2026年度硬性上线任务",
      controlTopics: ["历史目标继承", "规划任务溯源", "后续政策映射"],
      owner: "标准政策组",
      reviewStatus: "historical-only",
      lastReviewedAt: reviewed,
      nextReviewAt: ""
    }
  ];
}

function seedDigitalHospitalControlMatrix() {
  return [
    {
      id: "dhc-emr-lifecycle",
      domain: "电子病历",
      title: "电子病历全生命周期与不可抵赖留痕",
      requirementIds: ["dhp-emr-application-management", "dhp-personal-information-protection-law", "dhp-wst-846-847-2024"],
      applicability: "always",
      controlOwner: "医疗质量与病案管理组",
      implementationState: "implemented",
      evidenceCollections: ["personalRecords", "securityEvents", "medicalRecordQualityReviews"],
      automatedChecks: ["api:test", "audit:retention"],
      goLiveCritical: true,
      gap: "现场仍需提供正式病历封存、复制和抽样签字材料。"
    },
    {
      id: "dhc-emr-level-evidence",
      domain: "电子病历",
      title: "电子病历分级评价指标与现场证据映射",
      requirementIds: ["dhp-emr-leveling-2018"],
      applicability: "when-evaluation-enabled",
      controlOwner: "电子病历评价组",
      implementationState: "site-evidence-required",
      evidenceCollections: ["digitalHospitalEvidencePackets", "medicalRecordQualityReviews"],
      automatedChecks: ["digital-hospital:standards-readiness"],
      goLiveCritical: false,
      gap: "真实EMR字段、功能截图及科室质控抽样待医院签字。"
    },
    {
      id: "dhc-interoperability-contract",
      domain: "互联互通",
      title: "WS/T 846交互契约、版本和交易回执",
      requirementIds: ["dhp-interoperability-2020", "dhp-wst-846-847-2024"],
      applicability: "always",
      controlOwner: "平台与接口标准组",
      implementationState: "partial",
      evidenceCollections: ["integrationContracts", "phase2GatewayTraces", "dataLineageControls"],
      automatedChecks: ["interface:mapping", "integration:readiness", "evaluation:evidence"],
      goLiveCritical: true,
      gap: "生产HIS、LIS、PACS样例和厂商签名仍需现场联合验证。"
    },
    {
      id: "dhc-mutual-recognition",
      domain: "互联互通",
      title: "检查检验互认清单、负面清单和调阅留痕",
      requirementIds: ["dhp-mutual-recognition-2024"],
      applicability: "when-mutual-recognition-enabled",
      controlOwner: "检查检验互认专班",
      implementationState: "partial",
      evidenceCollections: ["phase2MutualRecognitionRules", "imagingCloudStudies"],
      automatedChecks: ["phase2:mutual-recognition-readiness"],
      goLiveCritical: false,
      gap: "需导入属地互认项目、机构及负面清单。"
    },
    {
      id: "dhc-smart-service-loop",
      domain: "智慧服务",
      title: "实名服务订单、回执、退费和满意度闭环",
      requirementIds: ["dhp-smart-service-2019", "dhp-personal-information-protection-law"],
      applicability: "always",
      controlOwner: "医院服务组",
      implementationState: "implemented",
      evidenceCollections: ["registrationOrders", "escortServiceOrders", "internetNursingOrders"],
      automatedChecks: ["citizen:launch-foundation", "registration:journey-readiness"],
      goLiveCritical: true,
      gap: "生产支付、退费和短信回执需按医院渠道完成联调。"
    },
    {
      id: "dhc-internet-diagnosis-boundary",
      domain: "智慧服务",
      title: "互联网诊疗复诊边界与处方监管",
      requirementIds: ["dhp-internet-diagnosis-supervision-2022"],
      applicability: "when-internet-diagnosis-enabled",
      controlOwner: "互联网诊疗管理组",
      implementationState: "partial",
      evidenceCollections: ["internetNursingOrders", "personalRecords"],
      automatedChecks: ["internet-nursing:readiness"],
      goLiveCritical: true,
      gap: "若启用在线诊疗，需补互联网医院资质、复诊判定和处方审核接口。"
    },
    {
      id: "dhc-management-metric-lineage",
      domain: "智慧管理",
      title: "运营指标口径、血缘和决策留痕",
      requirementIds: ["dhp-smart-management-2021", "dhp-healthcare-cybersecurity-management"],
      applicability: "always",
      controlOwner: "医院运营管理组",
      implementationState: "implemented",
      evidenceCollections: ["hospitalOperationSnapshots", "statisticsReconciliationReviews", "dataLineageControls"],
      automatedChecks: ["operations:readiness", "hospital-operations:readiness"],
      goLiveCritical: true,
      gap: "医院正式指标口径和部门责任签字需在试点阶段固化。"
    },
    {
      id: "dhc-management-resilience",
      domain: "智慧管理",
      title: "业务连续性、备份恢复和降级演练",
      requirementIds: ["dhp-healthcare-cybersecurity-management", "dhp-cybersecurity-law-2025"],
      applicability: "always",
      controlOwner: "平台运维组",
      implementationState: "site-evidence-required",
      evidenceCollections: ["productionDeploymentPlan", "siteLaunchEvidence"],
      automatedChecks: ["launch:smoke", "production-db:readiness"],
      goLiveCritical: true,
      gap: "最终生产环境恢复演练、只读降级和回滚回执尚需现场签署。"
    },
    {
      id: "dhc-standard-lifecycle",
      domain: "标准服务",
      title: "规范效力、适用性、版本与继承关系管理",
      requirementIds: ["dhp-wst-363-364-2023", "dhp-wst-846-847-2024", "dhp-health-information-plan-14fyp"],
      applicability: "always",
      controlOwner: "标准政策组",
      implementationState: "implemented",
      evidenceCollections: ["digitalHospitalPolicyRegister", "standardDataDictionaries"],
      automatedChecks: ["digital-hospital:standards-readiness"],
      goLiveCritical: true,
      gap: "需持续接入国家、属地新发规范并记录替代关系。"
    },
    {
      id: "dhc-data-standardization",
      domain: "标准服务",
      title: "数据元、值域、术语和主数据映射",
      requirementIds: ["dhp-wst-363-364-2023", "dhp-interoperability-2020"],
      applicability: "always",
      controlOwner: "标准与主数据组",
      implementationState: "partial",
      evidenceCollections: ["standardDataDictionaries", "phase2DataCatalogs", "dataGovernanceAssets"],
      automatedChecks: ["data-governance:readiness", "data-quality:report"],
      goLiveCritical: true,
      gap: "院内诊断、手术、药品、耗材、检验项目本地码映射待现场导入。"
    },
    {
      id: "dhc-sensitive-data",
      domain: "安全合规",
      title: "敏感个人信息、分类分级和授权审计",
      requirementIds: ["dhp-personal-information-protection-law", "dhp-data-security-law", "dhp-network-data-security-regulation"],
      applicability: "always",
      controlOwner: "个人信息保护负责人",
      implementationState: "implemented",
      evidenceCollections: ["securityEvents", "dataAccessLogs", "securityAcceptanceLedger"],
      automatedChecks: ["security:test", "audit:retention", "policy:coverage"],
      goLiveCritical: true,
      gap: "生产环境个人信息影响评估和第三方委托处理清单需签署归档。"
    },
    {
      id: "dhc-security-assessment",
      domain: "安全合规",
      title: "等保、密码应用和医疗网络安全年度检查",
      requirementIds: ["dhp-cybersecurity-law-2025", "dhp-healthcare-cybersecurity-management", "dhp-gbt-22239-2019"],
      applicability: "always",
      controlOwner: "网络安全组",
      implementationState: "site-evidence-required",
      evidenceCollections: ["securityAcceptanceLedger", "siteLaunchEvidence"],
      automatedChecks: ["security:commercial-crypto-readiness", "platform:production-audit"],
      goLiveCritical: true,
      gap: "定级备案、测评计划、密码应用材料和正式日志归档位置需现场确认。"
    },
    {
      id: "dhc-ai-governance",
      domain: "安全合规",
      title: "人工智能模型台账、审核、人工复核和动态监测",
      requirementIds: ["dhp-ai-healthcare-opinion-2025", "dhp-ai-scenarios-2024", "dhp-cybersecurity-law-2025"],
      applicability: "when-ai-enabled",
      controlOwner: "人工智能治理委员会",
      implementationState: "partial",
      evidenceCollections: ["clinicalDecisionSupportRules", "researchSandboxProjects", "securityEvents"],
      automatedChecks: ["research:sandbox", "phase2:clinical-assist-readiness"],
      goLiveCritical: true,
      gap: "启用临床AI前需补模型卡、版本审批、人工复核、漂移阈值和回滚证据。"
    }
  ];
}

function normalizePolicyList(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") return value.split(",").map((item) => item.trim()).filter(Boolean);
  return [];
}

function digitalHospitalControlError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function normalizeDigitalHospitalControl(control = {}, asOf = new Date().toISOString()) {
  const evidenceRecords = Array.isArray(control.evidenceRecords) ? control.evidenceRecords.slice(0, 30) : [];
  const actionHistory = Array.isArray(control.actionHistory) ? control.actionHistory.slice(0, 50) : [];
  const controlStatus = control.controlStatus
    || (control.implementationState === "implemented" ? "verified" : "open");
  const dueAt = String(control.dueAt || "").trim();
  const terminal = ["verified", "not-applicable"].includes(controlStatus);
  const overdue = Boolean(dueAt && /^\d{4}-\d{2}-\d{2}$/.test(dueAt) && dueAt < asOf.slice(0, 10) && !terminal);
  return {
    ...control,
    controlStatus,
    assignedTo: String(control.assignedTo || control.controlOwner || "").trim(),
    dueAt,
    evidenceRecords,
    actionHistory,
    evidenceCount: evidenceRecords.length,
    verifiedEvidenceCount: evidenceRecords.filter((item) => item.verificationStatus === "accepted").length,
    latestEvidence: evidenceRecords[0] || null,
    overdue,
    blocking: Boolean(control.goLiveCritical && !terminal)
  };
}

function buildDigitalHospitalControlMatrixBoard(data = {}, filters = {}) {
  const source = Array.isArray(data.digitalHospitalControlMatrix)
    ? data.digitalHospitalControlMatrix
    : seedDigitalHospitalControlMatrix();
  const asOf = String(filters.asOf || new Date().toISOString()).trim();
  const domain = String(filters.domain || "").trim();
  const controlStatus = String(filters.controlStatus || filters.status || "").trim();
  const query = String(filters.query || filters.q || "").trim().toLowerCase();
  const blockingOnly = filters.blockingOnly === true || String(filters.blockingOnly || "").toLowerCase() === "true";
  const overdueOnly = filters.overdueOnly === true || String(filters.overdueOnly || "").toLowerCase() === "true";
  const controls = source.map((item) => normalizeDigitalHospitalControl(item, asOf));
  const filteredControls = controls.filter((item) => {
    const blob = [
      item.domain,
      item.title,
      item.controlOwner,
      item.assignedTo,
      item.gap,
      ...(item.requirementIds || []),
      ...(item.evidenceCollections || []),
      ...(item.automatedChecks || [])
    ].join(" ").toLowerCase();
    return (!domain || item.domain === domain)
      && (!controlStatus || item.controlStatus === controlStatus)
      && (!blockingOnly || item.blocking)
      && (!overdueOnly || item.overdue)
      && (!query || blob.includes(query));
  });
  const blockers = controls.filter((item) => item.blocking);
  const domainSet = new Set(controls.map((item) => item.domain));
  const checks = [
    { id: "digitalHospitalControl:domains", passed: DIGITAL_HOSPITAL_SIX_DOMAINS.every((item) => domainSet.has(item)), detail: `${domainSet.size}/6 domains covered` },
    { id: "digitalHospitalControl:ownership", passed: controls.every((item) => item.controlOwner && item.assignedTo), detail: `${controls.filter((item) => item.assignedTo).length}/${controls.length} controls assigned` },
    { id: "digitalHospitalControl:evidenceBoundary", passed: controls.every((item) => item.evidenceRecords.every((record) => record.noPatientPii === true)), detail: `${controls.reduce((count, item) => count + item.evidenceCount, 0)} minimized evidence records` },
    { id: "digitalHospitalControl:auditHistory", passed: controls.every((item) => Array.isArray(item.actionHistory)), detail: `${controls.reduce((count, item) => count + item.actionHistory.length, 0)} control actions retained` }
  ];
  return {
    ok: checks.every((item) => item.passed),
    generatedAt: new Date().toISOString(),
    filters: { domain, controlStatus, query, blockingOnly, overdueOnly },
    summary: {
      controls: controls.length,
      filteredControls: filteredControls.length,
      goLiveCriticalControls: controls.filter((item) => item.goLiveCritical).length,
      blockingControls: blockers.length,
      verifiedControls: controls.filter((item) => item.controlStatus === "verified").length,
      notApplicableControls: controls.filter((item) => item.controlStatus === "not-applicable").length,
      evidenceRecordedControls: controls.filter((item) => item.evidenceCount > 0).length,
      overdueControls: controls.filter((item) => item.overdue).length,
      unassignedControls: controls.filter((item) => !item.assignedTo).length
    },
    controls: filteredControls,
    allControls: controls,
    blockers,
    checks
  };
}

function normalizeDigitalHospitalControlAction(control, payload = {}, user = {}, options = {}) {
  if (!control?.id) throw digitalHospitalControlError("digital hospital control is required");
  const allowedActions = new Set([
    "assign-control",
    "record-evidence",
    "verify-control",
    "reopen-control",
    "mark-not-applicable"
  ]);
  const actionName = String(payload.action || "").trim();
  if (!allowedActions.has(actionName)) throw digitalHospitalControlError("unsupported digital hospital control action");
  const note = String(payload.note || payload.reviewNote || "").trim();
  if (note.length < 4) throw digitalHospitalControlError("note must contain at least 4 characters");

  const now = String(options.now || new Date().toISOString());
  const actorId = String(user.username || user.id || user.name || "digital-hospital-control-operator").trim();
  const actorName = String(user.name || user.username || "digital hospital control operator").trim();
  const normalized = normalizeDigitalHospitalControl(control, now);
  let next = { ...normalized };
  const action = {
    id: `dhca-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    action: actionName,
    note,
    at: now,
    by: actorName,
    byId: actorId,
    role: user.role || "commission"
  };

  if (actionName === "assign-control") {
    if (["verified", "not-applicable"].includes(normalized.controlStatus)) {
      throw digitalHospitalControlError("reopen the control before assigning new remediation", 409);
    }
    const assignedTo = String(payload.assignedTo || payload.assignee || "").trim();
    const dueAt = String(payload.dueAt || "").trim();
    if (assignedTo.length < 2) throw digitalHospitalControlError("assignedTo must contain at least 2 characters");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueAt)) throw digitalHospitalControlError("dueAt must use YYYY-MM-DD");
    next = { ...next, assignedTo, dueAt, controlStatus: "in-progress" };
    Object.assign(action, { assignedTo, dueAt, controlStatus: "in-progress" });
  }

  if (actionName === "record-evidence") {
    if (["verified", "not-applicable"].includes(normalized.controlStatus)) {
      throw digitalHospitalControlError("reopen the control before recording new evidence", 409);
    }
    const evidenceLevel = String(payload.evidenceLevel || "demo").trim();
    if (!new Set(["demo", "site", "production"]).has(evidenceLevel)) {
      throw digitalHospitalControlError("evidenceLevel must be demo, site or production");
    }
    const artifactName = String(payload.artifactName || "").trim();
    const evidenceRef = String(payload.evidenceRef || payload.reference || "").trim();
    if (artifactName.length < 3) throw digitalHospitalControlError("artifactName must contain at least 3 characters");
    if (evidenceRef.length < 4) throw digitalHospitalControlError("evidenceRef must contain at least 4 characters");
    if (payload.noPatientPii !== true) throw digitalHospitalControlError("control evidence must confirm noPatientPii=true");
    const checksumSha256 = String(payload.checksumSha256 || "").trim().toLowerCase();
    if (checksumSha256 && !/^[a-f0-9]{64}$/.test(checksumSha256)) {
      throw digitalHospitalControlError("checksumSha256 must be a 64-character hexadecimal digest");
    }
    const evidence = {
      id: `dhce-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      artifactName,
      evidenceRef,
      evidenceLevel,
      checksumSha256,
      noPatientPii: true,
      submittedAt: now,
      submittedBy: actorName,
      submittedById: actorId,
      note,
      verificationStatus: "pending"
    };
    next = {
      ...next,
      controlStatus: "evidence-recorded",
      evidenceRecords: [evidence, ...normalized.evidenceRecords].slice(0, 30),
      latestEvidence: evidence,
      evidenceCount: normalized.evidenceCount + 1
    };
    Object.assign(action, { evidenceId: evidence.id, artifactName, evidenceRef, evidenceLevel, controlStatus: "evidence-recorded" });
  }

  if (actionName === "verify-control") {
    const decision = String(payload.decision || "accepted").trim();
    if (!new Set(["accepted", "rejected"]).has(decision)) throw digitalHospitalControlError("decision must be accepted or rejected");
    const evidence = normalized.evidenceRecords[0];
    if (!evidence) throw digitalHospitalControlError("record evidence before control verification", 409);
    if (evidence.submittedById === actorId) throw digitalHospitalControlError("control verification requires an independent reviewer", 409);
    if (decision === "accepted" && normalized.goLiveCritical && !["site", "production"].includes(evidence.evidenceLevel)) {
      throw digitalHospitalControlError("go-live critical controls require site or production evidence", 409);
    }
    const reviewedEvidence = {
      ...evidence,
      verificationStatus: decision,
      verifiedAt: now,
      verifiedBy: actorName,
      verifiedById: actorId,
      verificationNote: note
    };
    const accepted = decision === "accepted";
    next = {
      ...next,
      baselineImplementationState: normalized.baselineImplementationState || normalized.implementationState,
      implementationState: accepted ? "implemented" : (normalized.baselineImplementationState || normalized.implementationState),
      controlStatus: accepted ? "verified" : "in-progress",
      verifiedAt: accepted ? now : "",
      verifiedBy: accepted ? actorName : "",
      verifiedById: accepted ? actorId : "",
      evidenceRecords: [reviewedEvidence, ...normalized.evidenceRecords.slice(1)]
    };
    Object.assign(action, { decision, evidenceId: evidence.id, controlStatus: next.controlStatus });
  }

  if (actionName === "reopen-control") {
    if (!["verified", "not-applicable"].includes(normalized.controlStatus)) {
      throw digitalHospitalControlError("only verified or not-applicable controls can be reopened", 409);
    }
    next = {
      ...next,
      implementationState: normalized.baselineImplementationState || (normalized.implementationState === "not-applicable" ? "partial" : normalized.implementationState),
      controlStatus: "in-progress",
      verifiedAt: "",
      verifiedBy: "",
      verifiedById: "",
      reopenedAt: now,
      reopenedBy: actorName
    };
    Object.assign(action, { controlStatus: "in-progress" });
  }

  if (actionName === "mark-not-applicable") {
    if (normalized.applicability === "always") throw digitalHospitalControlError("always-applicable controls cannot be marked not applicable", 409);
    if (payload.featureDisabled !== true) throw digitalHospitalControlError("featureDisabled=true is required for a not-applicable decision");
    const decisionRef = String(payload.decisionRef || payload.evidenceRef || "").trim();
    if (decisionRef.length < 4) throw digitalHospitalControlError("decisionRef must contain at least 4 characters");
    next = {
      ...next,
      baselineImplementationState: normalized.baselineImplementationState || normalized.implementationState,
      implementationState: "not-applicable",
      controlStatus: "not-applicable",
      applicabilityDecisionRef: decisionRef,
      applicabilityDecidedAt: now,
      applicabilityDecidedBy: actorName,
      applicabilityDecidedById: actorId
    };
    Object.assign(action, { decisionRef, controlStatus: "not-applicable" });
  }

  next = {
    ...next,
    latestAction: action,
    updatedAt: now,
    updatedBy: actorId,
    updatedByName: actorName,
    actionHistory: [action, ...normalized.actionHistory].slice(0, 50)
  };
  return { action, control: normalizeDigitalHospitalControl(next, now) };
}

function buildDigitalHospitalPolicyRegisterBoard(data = {}, filters = {}) {
  const policies = Array.isArray(data.digitalHospitalPolicyRegister)
    ? data.digitalHospitalPolicyRegister
    : seedDigitalHospitalPolicyRegister();
  const controlBoard = buildDigitalHospitalControlMatrixBoard(data);
  const controls = controlBoard.allControls;
  const domain = String(filters.domain || "").trim();
  const bindingLevel = String(filters.bindingLevel || filters.binding || "").trim();
  const lifecycleStatus = String(filters.lifecycleStatus || filters.lifecycle || "").trim();
  const query = String(filters.query || filters.q || "").trim().toLowerCase();
  const filteredPolicies = policies.filter((item) => {
    const domains = normalizePolicyList(item.domains);
    const blob = [item.title, item.documentNo, item.issuingAuthority, item.applicability, ...domains, ...normalizePolicyList(item.controlTopics)].join(" ").toLowerCase();
    return (!domain || domains.includes(domain))
      && (!bindingLevel || item.bindingLevel === bindingLevel)
      && (!lifecycleStatus || item.lifecycleStatus === lifecycleStatus)
      && (!query || blob.includes(query));
  });
  const domainSet = new Set(policies.flatMap((item) => normalizePolicyList(item.domains)));
  const activePolicies = policies.filter((item) => item.lifecycleStatus !== "historical-plan");
  const currentWithoutReview = activePolicies.filter((item) => !item.nextReviewAt || ["requires-update"].includes(item.reviewStatus));
  const blockingControls = controlBoard.blockers;
  const checks = [
    { id: "digitalHospitalPolicy:domains", passed: DIGITAL_HOSPITAL_SIX_DOMAINS.every((item) => domainSet.has(item)), detail: `${domainSet.size}/6 domains covered` },
    { id: "digitalHospitalPolicy:activeRegister", passed: activePolicies.length >= 15, detail: `${activePolicies.length} active or conditional policies` },
    { id: "digitalHospitalPolicy:officialSources", passed: policies.every((item) => /^https:\/\//.test(String(item.sourceUrl || ""))), detail: `${policies.length} official source links` },
    { id: "digitalHospitalPolicy:historicalBoundary", passed: policies.some((item) => item.lifecycleStatus === "historical-plan" && item.reviewStatus === "historical-only"), detail: `${policies.filter((item) => item.lifecycleStatus === "historical-plan").length} historical planning records` },
    { id: "digitalHospitalPolicy:reviewLifecycle", passed: currentWithoutReview.length === 0, detail: `${currentWithoutReview.length} active policies without a valid review plan` },
    { id: "digitalHospitalPolicy:controlMatrix", passed: DIGITAL_HOSPITAL_SIX_DOMAINS.every((item) => controls.some((control) => control.domain === item)), detail: `${controls.length} controls across six domains` }
  ];
  return {
    ok: checks.every((item) => item.passed),
    generatedAt: new Date().toISOString(),
    filters: { domain, bindingLevel, lifecycleStatus, query },
    summary: {
      policies: policies.length,
      filteredPolicies: filteredPolicies.length,
      activePolicies: activePolicies.length,
      mandatoryPolicies: policies.filter((item) => item.bindingLevel === "mandatory").length,
      managementRequirements: policies.filter((item) => item.bindingLevel === "management-required").length,
      evaluationReferences: policies.filter((item) => item.bindingLevel === "evaluation-reference").length,
      recommendedStandards: policies.filter((item) => item.bindingLevel === "recommended-standard").length,
      historicalPolicies: policies.filter((item) => item.lifecycleStatus === "historical-plan").length,
      localSupplementRequired: policies.filter((item) => item.reviewStatus === "local-supplement-required").length,
      domains: domainSet.size,
      controls: controls.length,
      goLiveCriticalControls: controls.filter((item) => item.goLiveCritical).length,
      blockingControls: blockingControls.length,
      verifiedControls: controlBoard.summary.verifiedControls,
      evidenceRecordedControls: controlBoard.summary.evidenceRecordedControls,
      overdueControls: controlBoard.summary.overdueControls
    },
    policies: filteredPolicies,
    controls,
    blockingControls,
    checks
  };
}

function normalizeDigitalHospitalPolicyReview(policy, payload = {}, user = {}) {
  const allowedStatuses = new Set([
    "verified-current",
    "verified-reference",
    "local-supplement-required",
    "historical-only",
    "requires-update"
  ]);
  const reviewStatus = String(payload.reviewStatus || payload.status || "verified-current").trim();
  if (!allowedStatuses.has(reviewStatus)) throw new Error("unsupported policy review status");
  const reviewNote = String(payload.reviewNote || payload.note || "").trim();
  if (reviewNote.length < 4) throw new Error("reviewNote must contain at least 4 characters");
  const nextReviewAt = String(payload.nextReviewAt || "").trim();
  if (reviewStatus !== "historical-only" && !/^\d{4}-\d{2}-\d{2}$/.test(nextReviewAt)) {
    throw new Error("nextReviewAt must use YYYY-MM-DD for active policies");
  }
  const now = new Date().toISOString();
  const action = {
    id: `dhpr-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    action: String(payload.action || "review-policy").trim(),
    reviewStatus,
    reviewNote,
    nextReviewAt: reviewStatus === "historical-only" ? "" : nextReviewAt,
    reviewedAt: now,
    reviewedBy: user.name || user.username || "digital hospital policy reviewer",
    role: user.role || "commission"
  };
  return {
    action,
    policy: {
      ...policy,
      reviewStatus,
      lastReviewedAt: now.slice(0, 10),
      nextReviewAt: action.nextReviewAt,
      latestReview: action,
      reviewHistory: [action, ...(Array.isArray(policy.reviewHistory) ? policy.reviewHistory : [])].slice(0, 30)
    }
  };
}

module.exports = {
  DIGITAL_HOSPITAL_SIX_DOMAINS,
  buildDigitalHospitalControlMatrixBoard,
  buildDigitalHospitalPolicyRegisterBoard,
  normalizeDigitalHospitalControlAction,
  normalizeDigitalHospitalPolicyReview,
  seedDigitalHospitalControlMatrix,
  seedDigitalHospitalPolicyRegister
};
