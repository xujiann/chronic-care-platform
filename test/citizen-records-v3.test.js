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
