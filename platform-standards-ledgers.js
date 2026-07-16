const { seedDigitalHospitalPolicyRegister } = require("./digital-hospital-governance");

function arrayOf(data, key) {
  return Array.isArray(data?.[key]) ? data[key] : [];
}

function compactText(value) {
  if (Array.isArray(value)) return value.filter(Boolean).join(" / ");
  return String(value || "").trim();
}

function normalizeLedgerRow(collection, item = {}, index = 0) {
  const status = item.status || item.controlStatus || item.reviewStatus || item.lifecycleStatus || item.implementationState || "registered";
  return {
    id: item.id || item.code || `${collection}-${index + 1}`,
    collection,
    title: item.title || item.name || item.standardName || item.systemName || item.artifactName || item.id || collection,
    owner: item.owner || item.controlOwner || item.assignedTo || item.responsibleParty || item.department || "",
    status,
    evidence: compactText(item.evidenceRefs || item.evidence || item.evidenceRef || item.requiredEvidence || item.officialSource),
    productionReady: item.productionReady === true || /verified|approved|signed|production-ready/i.test(String(status))
  };
}

const LEDGER_DEFINITIONS = [
  {
    id: "project-document-register",
    title: "项目文件台账",
    owner: "项目管理办公室",
    purpose: "统一登记申报立项、建设方案、设计、测试、培训、验收和移交文件。",
    standardRefs: ["项目申报材料", "建设方案与初步设计", "招采合同与需求规格", "测试验收与运维移交"],
    sourceCollections: ["platformRoadmap", "platformDeliveryBatches", "platformEvidence", "applicationCatalog"],
    acceptanceCriteria: ["文件具备版本、责任人和审批状态", "需求可追溯到建设域和发布工件", "测试、培训、移交和验收证据可定位", "缺失文件形成责任明确的阻断项"],
    automatedChecks: ["release:manifest", "release:report", "platform:capability-map"],
    evidenceRefs: ["docs/卫生健康信息平台研发报告.md", "docs/全系统图谱集.md", "release/release-artifact-manifest.json"],
    onsiteBlockers: ["项目批复、合同、终验意见和盖章材料需现场归档"]
  },
  {
    id: "policy-standard-register",
    title: "政策法规与标准台账",
    owner: "标准管理组/法规部门",
    purpose: "管理法律法规、行业规范、数据标准、评价方案及属地补充文件的效力和版本。",
    standardRefs: ["WS/T 363-2023", "WS/T 364-2023", "WS 365", "WS/T 846", "WS/T 847", "互联互通测评方案"],
    sourceCollections: ["digitalHospitalPolicyRegister", "digitalHospitalStandards", "publicHealthStandards", "policyAlignment"],
    acceptanceCriteria: ["每条规范记录官方来源和效力层级", "记录发布日期、实施日期、复核日期和替代关系", "标准要求映射到平台控制与自动检查", "历史规划不作为当前上线硬门禁"],
    automatedChecks: ["digital-hospital:standards-readiness", "policy:coverage", "public-health:readiness"],
    evidenceRefs: ["digital-hospital-standards.html", "docs/数智医院六域规范控制矩阵-2026.md", "release/policy-coverage-report.json"],
    onsiteBlockers: ["大连属地卫健、医保、网信和数据管理补充文件需责任部门复核"]
  },
  {
    id: "data-standard-master-register",
    title: "数据标准与主数据台账",
    owner: "数据资源中心",
    purpose: "管理数据资产、数据元和值域、主索引、机构科室人员及业务主数据版本。",
    standardRefs: ["WS/T 363-2023", "WS/T 364-2023", "WS 365", "居民电子健康档案数据规范"],
    sourceCollections: ["dataGovernanceAssets", "standardDataDictionaries", "dataLineageControls", "authOrganizations"],
    acceptanceCriteria: ["覆盖 personIndex、机构、科室、人员和核心业务字典", "资产具备来源、责任人、更新频率和质量评分", "本地码到国家标准码映射可追溯和回滚", "敏感数据仅输出最小化结构摘要"],
    automatedChecks: ["data-governance:readiness", "data-quality:report", "phase2:catalog-readiness"],
    evidenceRefs: ["/api/data-governance", "/api/data-governance/master-data", "release/data-governance-readiness-report.json"],
    onsiteBlockers: ["医院诊断、手术、药品、耗材、检验本地码和真实 personIndex 规则待导入签字"]
  },
  {
    id: "interface-exchange-register",
    title: "接口与交换服务台账",
    owner: "平台集成组",
    purpose: "统一登记来源系统、接口契约、字段映射、签名幂等、回执补偿和联调证据。",
    standardRefs: ["区域卫生信息平台交互标准", "WS/T 846", "检查检验结果互认要求"],
    sourceCollections: ["integrationContracts", "platformInterfaces", "interfaceRequirements", "phase2GatewayTraces"],
    acceptanceCriteria: ["HIS、EMR、LIS、PACS、医保、公卫等来源均有接口责任人", "请求响应字段、版本、签名和幂等规则完整", "成功、失败、重试、死信和对账链路可验证", "真实联调样例和厂商签字单独标记现场状态"],
    automatedChecks: ["integration:readiness", "interface:mapping", "phase2:joint-test-readiness"],
    evidenceRefs: ["/api/integration-contracts", "release/interface-mapping-report.json", "release/integration-readiness-report.json"],
    onsiteBlockers: ["生产地址、网络白名单、真实样例报文、密钥和厂商联合签字待现场完成"]
  },
  {
    id: "security-compliance-register",
    title: "安全合规与授权审计台账",
    owner: "网络安全与数据安全组",
    purpose: "管理等级保护、密码应用、分类分级、授权、审计、隐私影响和第三方安全事项。",
    standardRefs: ["GB/T 22239-2019", "GB/T 39786-2021", "个人信息保护法", "数据安全法", "网络数据安全管理条例"],
    sourceCollections: ["securityAcceptanceLedger", "commercialCryptoEvidencePackets", "securityEvents", "dataAccessLogs"],
    acceptanceCriteria: ["角色和机构范围遵循最小权限", "敏感数据访问和导出全程留痕", "审计链可校验且证据不包含患者可识别信息", "等保、密评、隐私影响和第三方整改有正式结论"],
    automatedChecks: ["audit:retention", "security:commercial-crypto-readiness", "deploy:check"],
    evidenceRefs: ["/api/audit/verify", "release/audit-retention-report.json", "release/commercial-crypto-readiness-report.json"],
    onsiteBlockers: ["正式等保、密评、渗透测试、隐私影响评估和生产密钥管理材料待签署"]
  },
  {
    id: "acceptance-operations-register",
    title: "验收、上线与运维台账",
    owner: "项目验收组/平台运维中心",
    purpose: "管理测试验收、现场证据、割接审批、监控值守、备份恢复、问题整改和运维移交。",
    standardRefs: ["项目验收方案", "网络安全与业务连续性要求", "互联互通现场测评要求"],
    sourceCollections: ["siteLaunchEvidence", "productionDeploymentPlan", "operationsEvidencePackets", "platformProductionBlockerReviews"],
    acceptanceCriteria: ["每个上线项具有责任人、时间窗、证据和回退方案", "功能测试、接口联调、安全测试和性能验证可复核", "P0/P1 阻断项关闭需独立审批", "正式上线与演示就绪状态严格分离"],
    automatedChecks: ["launch:smoke", "onsite:launch-requirements", "operations:readiness", "release:report"],
    evidenceRefs: ["/api/platform/blocker-register", "release/production-cutover-checklist.json", "release/onsite-launch-requirements.json"],
    onsiteBlockers: ["生产环境联调、灾备演练、值守确认和多方割接签字尚需现场证据"]
  }
];

function buildLedger(definition, data = {}, context = {}) {
  const rows = definition.sourceCollections.flatMap((collection) =>
    arrayOf(data, collection).slice(0, 30).map((item, index) => normalizeLedgerRow(collection, item, index))
  );
  const availableCollections = definition.sourceCollections.filter((collection) => Array.isArray(data?.[collection]));
  const missingCollections = definition.sourceCollections.filter((collection) => !Array.isArray(data?.[collection]));
  const relatedArtifacts = (context.manifest?.artifacts || []).filter((artifact) =>
    definition.automatedChecks.includes(artifact.command) || definition.evidenceRefs.includes(artifact.evidence)
  );
  const functionalState = missingCollections.length === 0 && definition.acceptanceCriteria.length >= 4
    ? "implemented"
    : "partial";
  return {
    ...definition,
    functionalState,
    formalGoLiveState: definition.onsiteBlockers.length ? "blocked-until-onsite-evidence" : "ready",
    summary: {
      records: rows.length,
      sourceCollections: definition.sourceCollections.length,
      availableCollections: availableCollections.length,
      missingCollections: missingCollections.length,
      automatedChecks: definition.automatedChecks.length,
      evidenceRefs: definition.evidenceRefs.length,
      releaseArtifacts: relatedArtifacts.length,
      productionReadyRecords: rows.filter((item) => item.productionReady).length
    },
    availableCollections,
    missingCollections,
    rows,
    relatedArtifacts: relatedArtifacts.map((item) => ({ id: item.id, title: item.title, command: item.command, evidence: item.evidence }))
  };
}

function buildPlatformStandardsLedgers(data = {}, context = {}) {
  const normalizedData = {
    ...data,
    digitalHospitalPolicyRegister: Array.isArray(data.digitalHospitalPolicyRegister)
      ? data.digitalHospitalPolicyRegister
      : seedDigitalHospitalPolicyRegister()
  };
  const ledgers = LEDGER_DEFINITIONS.map((definition) => buildLedger(definition, normalizedData, context));
  const checks = [
    { id: "standardsLedgers:six-registers", passed: ledgers.length === 6, detail: `${ledgers.length}/6 ledgers` },
    { id: "standardsLedgers:ownership", passed: ledgers.every((item) => item.owner), detail: `${ledgers.filter((item) => item.owner).length}/6 owners` },
    { id: "standardsLedgers:acceptance-criteria", passed: ledgers.every((item) => item.acceptanceCriteria.length >= 4), detail: `${ledgers.reduce((sum, item) => sum + item.acceptanceCriteria.length, 0)} acceptance criteria` },
    { id: "standardsLedgers:source-traceability", passed: ledgers.every((item) => item.sourceCollections.length >= 4 && item.evidenceRefs.length >= 3), detail: "all ledgers map collections and evidence" },
    { id: "standardsLedgers:automation", passed: ledgers.every((item) => item.automatedChecks.length >= 3), detail: `${ledgers.reduce((sum, item) => sum + item.automatedChecks.length, 0)} automated checks` },
    { id: "standardsLedgers:production-boundary", passed: ledgers.every((item) => item.functionalState && item.formalGoLiveState && item.onsiteBlockers.length), detail: "functional and formal go-live states remain separate" }
  ];
  return {
    ok: checks.every((item) => item.passed),
    generatedAt: new Date().toISOString(),
    summary: {
      ledgers: ledgers.length,
      implemented: ledgers.filter((item) => item.functionalState === "implemented").length,
      formalGoLiveReady: ledgers.filter((item) => item.formalGoLiveState === "ready").length,
      records: ledgers.reduce((sum, item) => sum + item.summary.records, 0),
      acceptanceCriteria: ledgers.reduce((sum, item) => sum + item.acceptanceCriteria.length, 0),
      automatedChecks: ledgers.reduce((sum, item) => sum + item.automatedChecks.length, 0),
      onsiteBlockers: ledgers.reduce((sum, item) => sum + item.onsiteBlockers.length, 0)
    },
    ledgers,
    checks,
    boundary: "台账结构和自动检查通过仅代表平台功能可验收；正式生产上线仍需真实接口、测评报告、现场演练和多方签字。"
  };
}

function groupBy(items, key) {
  return items.reduce((acc, item) => {
    const value = item[key] || "unknown";
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function buildPlatformStandardsLedgerDetail(data = {}, ledgerId = "", options = {}) {
  const report = buildPlatformStandardsLedgers(data, options.context || {});
  const ledger = report.ledgers.find((item) => item.id === String(ledgerId || "").trim());
  if (!ledger) return null;
  const query = String(options.query || options.q || "").trim().toLowerCase();
  const status = String(options.status || "").trim();
  const collection = String(options.collection || "").trim();
  const rows = ledger.rows.filter((item) => {
    const blob = [item.id, item.title, item.owner, item.status, item.collection, item.evidence].join(" ").toLowerCase();
    return (!query || blob.includes(query))
      && (!status || item.status === status)
      && (!collection || item.collection === collection);
  });
  const acceptanceItems = ledger.acceptanceCriteria.map((criterion, index) => ({
    id: `${ledger.id}-acceptance-${index + 1}`,
    criterion,
    verificationMode: index < ledger.automatedChecks.length ? "automated-and-review" : "manual-review",
    automatedCheck: ledger.automatedChecks[index] || "",
    evidenceRef: ledger.evidenceRefs[index] || "",
    status: ledger.functionalState === "implemented" ? "platform-verifiable" : "gap-open",
    formalGoLiveState: ledger.formalGoLiveState
  }));
  return {
    ok: report.ok && ledger.functionalState === "implemented",
    generatedAt: new Date().toISOString(),
    ledger: {
      id: ledger.id,
      title: ledger.title,
      owner: ledger.owner,
      purpose: ledger.purpose,
      functionalState: ledger.functionalState,
      formalGoLiveState: ledger.formalGoLiveState,
      standardRefs: ledger.standardRefs,
      sourceCollections: ledger.sourceCollections,
      evidenceRefs: ledger.evidenceRefs,
      automatedChecks: ledger.automatedChecks,
      onsiteBlockers: ledger.onsiteBlockers
    },
    filters: { query, status, collection },
    summary: {
      totalRows: ledger.rows.length,
      filteredRows: rows.length,
      sourceCollections: ledger.sourceCollections.length,
      acceptanceItems: acceptanceItems.length,
      onsiteBlockers: ledger.onsiteBlockers.length,
      productionReadyRows: rows.filter((item) => item.productionReady).length
    },
    byCollection: groupBy(rows, "collection"),
    byStatus: groupBy(rows, "status"),
    facets: {
      collections: Object.keys(groupBy(ledger.rows, "collection")).sort(),
      statuses: Object.keys(groupBy(ledger.rows, "status")).sort()
    },
    acceptanceItems,
    rows: rows.slice(0, 100),
    boundary: report.boundary
  };
}

function cleanCell(value) {
  return String(value ?? "").replace(/\|/g, "/").replace(/\r?\n/g, " ");
}

function renderPlatformStandardsLedgersMarkdown(report) {
  const ledgerRows = report.ledgers.map((item) => `| ${cleanCell(item.title)} | ${cleanCell(item.owner)} | ${item.summary.records} | ${cleanCell(item.functionalState)} | ${cleanCell(item.formalGoLiveState)} | ${item.acceptanceCriteria.length} | ${item.automatedChecks.length} |`);
  const sections = report.ledgers.flatMap((item) => [
    `## ${item.title}`,
    "",
    `- 责任方：${item.owner}`,
    `- 功能状态：${item.functionalState}`,
    `- 正式上线状态：${item.formalGoLiveState}`,
    `- 来源集合：${item.sourceCollections.join("、")}`,
    `- 标准依据：${item.standardRefs.join("、")}`,
    "",
    "### 验收口径",
    "",
    ...item.acceptanceCriteria.map((value) => `- ${value}`),
    "",
    "### 现场阻断",
    "",
    ...item.onsiteBlockers.map((value) => `- ${value}`),
    ""
  ]);
  return [
    "# 卫生健康信息平台六类可验收台账",
    "",
    `- 生成时间：${report.generatedAt}`,
    `- 自动检查：${report.ok ? "PASS" : "ATTENTION"}`,
    `- 边界：${report.boundary}`,
    "",
    "| 台账 | 责任方 | 记录数 | 功能状态 | 正式上线状态 | 验收口径 | 自动检查 |",
    "|---|---|---:|---|---|---:|---:|",
    ...ledgerRows,
    "",
    ...sections
  ].join("\n");
}

function renderPlatformStandardsLedgerDetailMarkdown(detail) {
  if (!detail) return "# 平台台账未找到\n";
  const acceptanceRows = detail.acceptanceItems.map((item) => `| ${cleanCell(item.criterion)} | ${cleanCell(item.verificationMode)} | ${cleanCell(item.automatedCheck)} | ${cleanCell(item.evidenceRef)} | ${cleanCell(item.formalGoLiveState)} |`);
  const dataRows = detail.rows.map((item) => `| ${cleanCell(item.collection)} | ${cleanCell(item.title)} | ${cleanCell(item.owner)} | ${cleanCell(item.status)} | ${cleanCell(item.evidence)} |`);
  return [
    `# ${detail.ledger.title}`,
    "",
    `- 责任方：${detail.ledger.owner}`,
    `- 功能状态：${detail.ledger.functionalState}`,
    `- 正式上线状态：${detail.ledger.formalGoLiveState}`,
    `- 筛选结果：${detail.summary.filteredRows}/${detail.summary.totalRows}`,
    `- 边界：${detail.boundary}`,
    "",
    "## 验收口径",
    "",
    "| 验收口径 | 验证方式 | 自动检查 | 证据引用 | 正式上线状态 |",
    "|---|---|---|---|---|",
    ...acceptanceRows,
    "",
    "## 台账记录",
    "",
    "| 来源集合 | 事项 | 责任方 | 状态 | 证据摘要 |",
    "|---|---|---|---|---|",
    ...dataRows,
    ""
  ].join("\n");
}

module.exports = {
  LEDGER_DEFINITIONS,
  buildPlatformStandardsLedgerDetail,
  buildPlatformStandardsLedgers,
  renderPlatformStandardsLedgerDetailMarkdown,
  renderPlatformStandardsLedgersMarkdown
};
