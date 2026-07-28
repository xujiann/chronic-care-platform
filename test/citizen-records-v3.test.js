const test = require("node:test");
const assert = require("node:assert/strict");

const api = require("../citizen-records-v3");

const now = new Date("2026-07-27T08:00:00.000Z");

function activeAuthorization(overrides = {}) {
  return {
    id: "auth-v3-1",
    residentId: "r1",
    category: "authorizations",
    name: "家庭健康代办授权",
    status: "active",
    meta: {
      status: "active",
      granteeAccountId: "account-family-1",
      granteeId: "account-family-1",
      purpose: "家庭协助复诊",
      scopes: ["health-record-summary", "medications"],
      grantedAt: "2026-07-20T08:00:00.000Z",
      expiresAt: "2026-08-20T23:59:59.999Z",
      ...overrides.meta
    },
    ...overrides
  };
}

test("生产接入状态只接受新鲜且非占位的正式证据", () => {
  const integrations = Object.fromEntries(api.REQUIRED_INTEGRATIONS.map((item) => [item.key, {
    status: "connected",
    lastSuccessAt: "2026-07-27T07:30:00.000Z",
    evidenceRef: `receipt-${item.key}-20260727`
  }]));
  const ready = api.buildProductionIntegrationStatus(integrations, now);
  assert.equal(ready.productionReady, true);
  assert.equal(ready.readyCount, 6);

  integrations.audit.evidenceRef = "demo-placeholder";
  const blocked = api.buildProductionIntegrationStatus(integrations, now);
  assert.equal(blocked.productionReady, false);
  assert.equal(blocked.items.find((item) => item.key === "audit").status, "缺少正式证据");
});

test("生产接入证据拒绝异常未来时间无效时间和刚过精确有效期", () => {
  const integrations = Object.fromEntries(api.REQUIRED_INTEGRATIONS.map((item) => [item.key, {
    status: "connected",
    lastSuccessAt: "2026-07-20T08:00:00.000Z",
    maximumAgeDays: 7,
    evidenceRef: `receipt-${item.key}-boundary`
  }]));
  assert.equal(api.buildProductionIntegrationStatus(integrations, now).productionReady, true);

  integrations.identity.lastSuccessAt = "2026-07-20T07:59:59.999Z";
  let blocked = api.buildProductionIntegrationStatus(integrations, now);
  assert.equal(blocked.items.find((item) => item.key === "identity").status, "连接证据已过期");

  integrations.identity.lastSuccessAt = "2026-07-27T08:05:00.001Z";
  blocked = api.buildProductionIntegrationStatus(integrations, now);
  assert.equal(blocked.items.find((item) => item.key === "identity").status, "成功时间异常");

  integrations.identity.lastSuccessAt = "not-a-time";
  blocked = api.buildProductionIntegrationStatus(integrations, now);
  assert.equal(blocked.items.find((item) => item.key === "identity").status, "缺少有效成功时间");
  assert.equal(blocked.productionReady, false);
});

test("跨院档案治理识别重复来源与互相冲突的结果并保留原始版本", () => {
  const result = api.governCrossInstitutionRecords([
    {
      id: "a",
      category: "labs",
      name: "空腹血糖",
      date: "2026-07-20",
      result: "6.8",
      provenance: { sourceRecordId: "lab-100", sourceOrganization: "甲医院", trust: "clinical" }
    },
    {
      id: "b",
      category: "labs",
      name: "空腹血糖",
      date: "2026-07-20",
      result: "6.8",
      provenance: { sourceRecordId: "lab-100", sourceOrganization: "甲医院", trust: "clinical" }
    },
    {
      id: "c",
      category: "labs",
      name: "空腹血糖",
      date: "2026-07-20",
      result: "7.4",
      provenance: { sourceRecordId: "lab-200", sourceOrganization: "乙医院", trust: "clinical" }
    }
  ]);
  assert.equal(result.duplicates.length, 1);
  assert.equal(result.conflicts.length, 1);
  assert.match(result.conflicts[0].action, /原始版本均保留/);
});

test("EMR 样例必须满足居民、来源、版本和结构化诊疗最小契约", () => {
  const sample = {
    sourceSystem: "EMR",
    residentId: "r1",
    sourceOrganization: "甲医院",
    sourceRecordId: "visit-100",
    version: "3",
    visitAt: "2026-07-27T07:00:00.000Z",
    visitType: "门诊",
    diagnoses: ["高血压"],
    summary: "复诊，继续观察血压",
    department: "全科"
  };
  const valid = api.validateClinicalSourceSample(sample, "r1");
  assert.equal(valid.valid, true);
  assert.equal(valid.system, "EMR");

  const crossResident = api.validateClinicalSourceSample({ ...sample, residentId: "r2" }, "r1");
  assert.equal(crossResident.valid, false);
  assert.match(crossResident.errors.join("；"), /居民与当前居民不一致/);

  const incomplete = api.validateClinicalSourceSample({ ...sample, version: "", diagnoses: [] }, "r1");
  assert.equal(incomplete.valid, false);
  assert.match(incomplete.errors.join("；"), /版本/);
  assert.match(incomplete.errors.join("；"), /诊断摘要/);
});

test("LIS 与 PACS 样例缺少结构化结果或报告结论时默认拒绝", () => {
  const common = {
    residentId: "r1",
    sourceOrganization: "甲医院",
    sourceRecordId: "report-1",
    version: "1",
    reportedAt: "2026-07-27T07:00:00.000Z",
    reportNo: "R-1"
  };
  assert.equal(api.validateClinicalSourceSample({ ...common, sourceSystem: "LIS", results: [] }, "r1").valid, false);
  assert.equal(api.validateClinicalSourceSample({ ...common, sourceSystem: "PACS", modality: "CT" }, "r1").valid, false);
  assert.match(
    api.validateClinicalSourceSample({ ...common, sourceSystem: "HIS" }, "r1").errors.join("；"),
    /EMR、LIS 或 PACS/
  );
});

test("临床样例居民投影按系统白名单保留摘要并清除内部敏感字段", () => {
  const sample = {
    sourceSystem: "LIS",
    residentId: "r1",
    sourceOrganization: "甲医院",
    sourceRecordId: "lab-100",
    version: "2",
    reportedAt: "2026-07-27T07:00:00.000Z",
    reportNo: "LAB-100",
    name: "肾功能",
    results: [{ name: "肌酐", value: "80", unit: "μmol/L", status: "正常", auditHash: "nested-secret" }],
    objectPath: "private/lab-100.pdf",
    signedUrl: "https://storage.example/private",
    accessToken: "must-not-leak",
    meta: { personIndex: "mpi-secret" }
  };
  const validation = api.validateClinicalSourceSample(sample, "r1");
  assert.equal(validation.valid, true);
  assert.ok(validation.ignoredSensitiveFields.includes("objectPath"));
  assert.ok(validation.ignoredSensitiveFields.includes("results.0.auditHash"));

  const projected = api.projectClinicalSourceSample(sample, "r1");
  assert.equal(projected.category, "labs");
  assert.equal(projected.meta.sourceSystem, "LIS");
  assert.match(projected.result, /肌酐 80 μmol\/L 正常/);
  assert.doesNotMatch(JSON.stringify(projected), /private\/lab|storage\.example|must-not-leak|nested-secret|mpi-secret/);
});

test("批量临床样例验收汇总通过拒绝去重和敏感字段剔除且不回显拒绝原文", () => {
  const lis = {
    sourceSystem: "LIS",
    residentId: "r1",
    sourceOrganization: "甲医院",
    sourceRecordId: "lab-batch-1",
    version: "1",
    reportedAt: "2026-07-27T07:00:00.000Z",
    reportNo: "BATCH-1",
    results: [{ name: "血糖", value: "6.1", unit: "mmol/L" }],
    accessToken: "accepted-secret"
  };
  const report = api.buildClinicalSourceAcceptanceReport([
    lis,
    { ...lis, version: "2", reportedAt: "2026-07-27T08:00:00.000Z" },
    {
      sourceSystem: "EMR",
      residentId: "r1",
      sourceOrganization: "甲医院",
      sourceRecordId: "visit-batch-1",
      version: "1",
      visitAt: "2026-07-27T07:00:00.000Z",
      visitType: "门诊",
      diagnoses: ["高血压"],
      summary: "复诊"
    },
    {
      sourceSystem: "PACS",
      residentId: "r2",
      sourceOrganization: "乙医院",
      sourceRecordId: "pacs-rejected",
      version: "1",
      reportedAt: "2026-07-27T07:00:00.000Z",
      reportNo: "P-1",
      modality: "CT",
      conclusion: "拒绝样例中的敏感结论",
      signedUrl: "https://private.example/rejected"
    }
  ], "r1");
  assert.equal(report.total, 4);
  assert.equal(report.acceptedCount, 3);
  assert.equal(report.rejectedCount, 1);
  assert.equal(report.acceptedRecordCount, 2);
  assert.equal(report.contractReady, false);
  assert.equal(report.productionReady, false);
  assert.equal(report.systems.find((item) => item.system === "LIS").accepted, 2);
  assert.doesNotMatch(JSON.stringify(report.entries), /敏感结论|private\.example|accepted-secret|lab-batch-1|visit-batch-1/);
  assert.doesNotMatch(JSON.stringify(report.acceptedRecords), /accepted-secret/);
  assert.match(report.boundary, /不代表正式连接/);
});

test("全部批量样例通过只开启字段契约状态而不打开生产状态", () => {
  const report = api.buildClinicalSourceAcceptanceReport([{
    sourceSystem: "PACS",
    residentId: "r1",
    sourceOrganization: "甲医院",
    sourceRecordId: "pacs-ready",
    version: "1",
    reportedAt: "2026-07-27T07:00:00.000Z",
    reportNo: "P-READY",
    modality: "MR",
    conclusion: "未见明显异常"
  }], "r1");
  assert.equal(report.contractReady, true);
  assert.equal(report.productionReady, false);
});

test("档案质量评估识别来源缺失、超期、个人补充和跨居民记录", () => {
  const quality = api.assessResidentRecordQuality([
    {
      id: "complete",
      residentId: "r1",
      category: "emr",
      name: "已核验",
      updatedAt: "2026-07-20",
      meta: { sourceSystem: "EMR", sourceOrganization: "甲医院", sourceRecordId: "v1", sourceTrust: "clinical" }
    },
    {
      id: "stale",
      residentId: "r1",
      category: "labs",
      name: "历史检验",
      updatedAt: "2024-01-01",
      meta: { sourceSystem: "LIS", sourceOrganization: "甲医院", sourceRecordId: "l1", sourceTrust: "clinical" }
    },
    {
      id: "self",
      residentId: "r1",
      category: "medications",
      name: "个人补充用药",
      updatedAt: "2026-07-20",
      source: "个人上传",
      meta: { sourceTrust: "self-reported" }
    },
    {
      id: "missing",
      residentId: "r1",
      category: "labs",
      name: "待补溯源检验",
      updatedAt: "2026-07-20",
      source: "甲医院",
      meta: { sourceTrust: "clinical" }
    },
    {
      id: "other",
      residentId: "r2",
      category: "imaging",
      name: "跨居民影像",
      updatedAt: "2026-07-20",
      meta: { sourceSystem: "PACS", sourceOrganization: "乙医院", sourceRecordId: "p1", sourceTrust: "clinical" }
    }
  ], now, "r1");
  assert.equal(quality.completeCount, 1);
  assert.equal(quality.reviewCount, 4);
  assert.equal(quality.staleCount, 1);
  assert.equal(quality.crossResidentCount, 1);
  assert.equal(quality.blockedCount, 1);
  assert.equal(quality.highPriorityCount, 1);
  assert.equal(quality.items[0].id, "other");
  assert.equal(quality.items[0].priority, "阻断");
  assert.match(quality.items[0].action, /隔离记录/);
  assert.equal(quality.items.find((item) => item.id === "self").priority, "常规复核");
  assert.match(quality.items.find((item) => item.id === "self").action, /保留个人补充标识/);
  assert.equal(quality.items.find((item) => item.id === "missing").priority, "优先复核");
  assert.equal(quality.items.find((item) => item.id === "complete").name, "电子病历");
  assert.match(quality.items.find((item) => item.id === "self").issues.join("；"), /个人补充待机构核验/);
  assert.match(quality.boundary, /不改变医疗机构原始内容/);
});

test("家庭代办必须同时具备权威关系和有效最小范围授权", () => {
  const verifiedMember = {
    residentId: "r1",
    accountId: "account-family-1",
    relation: "女儿",
    relationshipStatus: "verified",
    verifiedAt: "2026-07-20T00:00:00.000Z",
    evidenceSource: "公安亲属关系核验",
    expiresAt: "2027-07-20T23:59:59.999Z"
  };
  const allowed = api.buildFamilyDelegationCenter({
    members: [verifiedMember],
    authorizations: [activeAuthorization()],
    now
  });
  assert.equal(allowed.items[0].canAct, true);
  assert.deepEqual(allowed.items[0].scopes, ["health-record-summary", "medications"]);

  const denied = api.buildFamilyDelegationCenter({
    members: [verifiedMember],
    authorizations: [activeAuthorization({ status: "pending", meta: { status: "pending" } })],
    now
  });
  assert.equal(denied.items[0].canAct, false);
});

test("主动健康计划汇总随访取药复诊与授权到期并按紧迫度排序", () => {
  const plan = api.buildProactiveCarePlan({
    followups: [{ id: "f1", diseaseType: "高血压", plannedAt: "2026-07-26", status: "待随访" }],
    pickups: [{ id: "p1", medication: "氨氯地平", nextPickup: "2026-07-29", status: "待取药" }],
    records: [{ id: "e1", meta: { followupPlan: "心内科复诊", followupAt: "2026-08-05" } }],
    authorizations: [activeAuthorization()],
    now
  });
  assert.equal(plan.tasks.length, 4);
  assert.equal(plan.tasks[0].priority, "逾期");
  assert.ok(plan.tasks.some((item) => item.type === "授权"));
});

test("报告通俗解读解释术语并保留非诊断边界", () => {
  const result = api.explainResidentReports([
    {
      id: "report-1",
      category: "imaging",
      name: "胸部影像报告",
      date: "2026-07-22",
      result: "双肺纹理增多",
      meta: { abnormalLevel: "abnormal" }
    }
  ]);
  assert.equal(result.reports.length, 1);
  assert.match(result.reports[0].explanations.join(""), /结合症状和医生判断/);
  assert.match(result.boundary, /不替代医生解释/);
});

test("用药安全同时识别重复药品、过敏文字匹配和已配置严重相互作用", () => {
  const result = api.assessMedicationSafety({
    medications: [
      { id: "m1", name: "华法林片", source: "甲医院" },
      { id: "m2", name: "华法林", source: "乙医院" },
      { id: "m3", name: "阿司匹林片", source: "甲医院" },
      { id: "m4", name: "青霉素片", source: "甲医院" },
      { id: "status-row", name: "verified", source: "状态回执" }
    ],
    allergies: [{ name: "青霉素" }]
  });
  assert.equal(result.duplicateGroups.length, 1);
  assert.equal(result.allergyWarnings.length, 1);
  assert.equal(result.interactionWarnings.length, 1);
  assert.equal(result.medications.some((item) => item.id === "status-row"), false);
  assert.match(result.boundary, /不得据此自行停药/);
});

test("紧急资料包只生成最小摘要并要求有效授权和联系人", () => {
  const pack = api.buildEmergencyHealthPack({
    resident: { id: "r1", name: "张某", gender: "女", age: 68, bloodType: "A" },
    records: [
      { id: "allergy-secret", category: "allergies", name: "青霉素", objectPath: "must-not-export" },
      { id: "med-secret", category: "medications", name: "氨氯地平", auditHash: "must-not-export" }
    ],
    diseases: [{ type: "高血压" }],
    contacts: [{ name: "李某", relation: "女儿", phone: "13812345678" }],
    consent: activeAuthorization({ meta: { purpose: "紧急救治", scopes: ["health-record-summary"] } }),
    now
  });
  assert.equal(pack.ready, true);
  assert.equal(pack.contacts[0].phone, "138****78");
  assert.equal(JSON.stringify(pack).includes("must-not-export"), false);
  assert.equal(JSON.stringify(pack).includes("allergy-secret"), false);
});

test("居民运营快照只汇总接入、授权拦截、纠错和投诉数量", () => {
  const snapshot = api.buildOperationsSnapshot({
    accessLogs: [{ status: "denied", accessedAt: "2026-07-27T06:00:00.000Z", actorToken: "secret" }],
    corrections: [{ status: "processing", createdAt: "2026-07-27T05:00:00.000Z" }],
    complaints: [{ status: "submitted", createdAt: "2026-07-27T04:00:00.000Z" }],
    now
  });
  assert.equal(snapshot.metrics.find((item) => item.label === "授权拦截").value, 1);
  assert.equal(snapshot.metrics.find((item) => item.label === "纠错处理中").value, 1);
  assert.equal(snapshot.metrics.find((item) => item.label === "投诉处理中").value, 1);
  assert.equal(JSON.stringify(snapshot).includes("secret"), false);
});

test("八项增强工作台一次生成全部居民可验收视图", () => {
  const workspace = api.buildNextStageWorkspace({
    resident: { id: "r1", name: "张某" },
    records: [],
    members: [{ residentId: "r1", relation: "本人" }],
    now
  });
  assert.deepEqual(
    Object.keys(workspace),
    ["integration", "governance", "family", "carePlan", "explanations", "medicationSafety", "emergencyPack", "operations"]
  );
});

test("八项安全操作只导航或预填且未知操作默认拒绝", () => {
  const expectedActions = [
    "review-integration-boundary",
    "review-provenance",
    "correct-conflict",
    "manage-family-authorization",
    "manage-care-plan",
    "schedule-report-revisit",
    "review-medications",
    "prepare-emergency-authorization",
    "review-operations"
  ];
  for (const action of expectedActions) {
    const intent = api.buildSafeActionIntent(action);
    assert.equal(intent.action, action);
    assert.equal(intent.writes, false);
    assert.ok(intent.targetSelector || intent.page || intent.authorizationDraft);
  }
  assert.throws(() => api.buildSafeActionIntent("download-all-records"), /不支持/);
});

test("紧急和家庭授权草稿保持最小范围且不预先确认居民同意", () => {
  const emergency = api.buildSafeActionIntent("prepare-emergency-authorization");
  assert.deepEqual(emergency.authorizationDraft.scopes, ["health-record-summary"]);
  assert.equal(emergency.authorizationDraft.granteeType, "institution");
  assert.equal(Object.hasOwn(emergency.authorizationDraft, "consentConfirmed"), false);

  const family = api.buildSafeActionIntent("manage-family-authorization");
  assert.deepEqual(family.authorizationDraft.scopes, ["health-record-summary"]);
  assert.equal(family.authorizationDraft.granteeType, "guardian");
});

test("主动健康任务按随访复诊取药和授权进入精确既有流程", () => {
  const cases = [
    [{ id: "followup:f1", type: "随访" }, { page: "registration", buttonLabel: "安排随访" }],
    [{ id: "revisit:r1", type: "复诊" }, { page: "registration", buttonLabel: "预约复诊" }],
    [{ id: "pickup:p1", type: "取药" }, { targetSelector: "#citizen-medication-review", buttonLabel: "核对用药" }],
    [{ id: "authorization:a1", type: "授权" }, { authorizationId: "a1", buttonLabel: "重新授权" }]
  ];
  for (const [task, expected] of cases) {
    const intent = api.buildCareTaskActionIntent(task);
    assert.equal(intent.writes, false);
    for (const [key, value] of Object.entries(expected)) assert.equal(intent[key], value);
  }
});

test("主动健康任务标识与类型不匹配或未知时默认拒绝", () => {
  assert.throws(() => api.buildCareTaskActionIntent({ id: "pickup:p1", type: "授权" }), /无效/);
  assert.throws(() => api.buildCareTaskActionIntent({ id: "authorization:", type: "授权" }), /无效/);
  assert.throws(() => api.buildCareTaskActionIntent({ id: "report:r1", type: "报告" }), /无效/);
});

test("主动任务按东八区自然日判断今日到期而不受小时差影响", () => {
  const afterMidnightInChina = new Date("2026-07-27T16:30:00.000Z");
  assert.deepEqual(api.taskDueState("2026-07-28", afterMidnightInChina), {
    dueAt: "2026-07-28",
    daysRemaining: 0,
    priority: "今日",
    dueLabel: "今日到期"
  });
  assert.equal(api.taskDueState("2026-07-27", afterMidnightInChina).dueLabel, "已逾期 1 天");
  assert.equal(api.taskDueState("2026-07-29", afterMidnightInChina).dueLabel, "1 天后到期");
});

test("主动健康计划汇总逾期今日和未来七天且授权提醒严格按自然日窗口", () => {
  const plan = api.buildProactiveCarePlan({
    followups: [
      { id: "overdue", diseaseType: "高血压", plannedAt: "2026-07-27", status: "待随访" },
      { id: "today", diseaseType: "糖尿病", plannedAt: "2026-07-28", status: "待随访" },
      { id: "soon", diseaseType: "冠心病", plannedAt: "2026-08-04", status: "待随访" }
    ],
    authorizations: [
      activeAuthorization({ id: "day-30", meta: { expiresAt: "2026-08-27T23:59:59.999Z" } }),
      activeAuthorization({ id: "day-31", meta: { expiresAt: "2026-08-28T23:59:59.999Z" } })
    ],
    now: new Date("2026-07-27T16:30:00.000Z")
  });
  assert.equal(plan.overdueCount, 1);
  assert.equal(plan.todayCount, 1);
  assert.equal(plan.nextSevenDaysCount, 1);
  assert.ok(plan.tasks.some((item) => item.id === "authorization:day-30"));
  assert.equal(plan.tasks.some((item) => item.id === "authorization:day-31"), false);
});
