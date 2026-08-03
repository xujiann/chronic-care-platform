const test = require("node:test");
const assert = require("node:assert/strict");

const Core = require("../resident-mini-program-core");
const Adapter = require("../resident-mini-program-adapter");

const NOW = new Date("2026-07-31T08:00:00.000Z");

function session(overrides = {}) {
  return {
    id: "u4",
    username: "citizen",
    role: "citizen",
    accountId: "a1",
    residentId: "r1",
    token: "server-session-token",
    authMode: "server-phone",
    expiresAt: "2026-07-31T10:00:00.000Z",
    ...overrides
  };
}

function scopedData() {
  return {
    accounts: [{
      id: "a1",
      members: [
        { residentId: "r1", relation: "本人" },
        {
          residentId: "r2",
          relation: "母亲",
          relationshipStatus: "verified",
          verifiedAt: "2026-07-20T09:00:00.000Z",
          evidenceSource: "公安亲属关系核验回执",
          expiresAt: "2027-07-20T09:00:00.000Z"
        },
        { residentId: "r3", relation: "父亲" }
      ]
    }],
    residents: [
      { id: "r1", name: "居民甲", gender: "女", birthDate: "1980-01-01", metrics: { systolic: 128, diastolic: 78 } },
      { id: "r2", name: "居民乙", gender: "女", birthDate: "1950-01-01", metrics: { glucose: 6.1 } },
      { id: "r3", name: "居民丙", gender: "男", birthDate: "1948-01-01" }
    ],
    personalRecords: [
      {
        id: "auth-r2",
        residentId: "r2",
        category: "authorizations",
        date: "2026-12-31",
        name: "家庭健康管理授权",
        status: "active",
        meta: {
          status: "active",
          granteeAccountId: "a1",
          scopes: ["health-record-summary"],
          expiresAt: "2026-12-31"
        }
      },
      { id: "record-r1", residentId: "r1", category: "labs", date: "2026-07-01", name: "血常规", result: "未见明显异常", source: "社区卫生服务中心" },
      { id: "record-r2", residentId: "r2", category: "emr", date: "2026-07-02", name: "门诊记录", result: "复诊", source: "中心医院" },
      { id: "record-r3", residentId: "r3", category: "labs", date: "2026-07-03", name: "越权资料", result: "不得展示", source: "未知" }
    ],
    taskMessages: [
      { id: "m1", residentId: "r1", targetRole: "citizen", collection: "followups", title: "Chronic follow-up feedback requires review", body: "Resident feedback and self-monitoring have been delivered to the family doctor team.", status: "sent", createdAt: "2026-07-31T07:00:00.000Z" },
      { id: "m2", residentId: "r3", targetRole: "citizen", collection: "followups", title: "越权消息", body: "不得展示", status: "sent", createdAt: "2026-07-31T07:01:00.000Z" },
      { id: "m3", residentId: "r1", targetRole: "institution", collection: "followups", title: "机构消息", body: "居民端不展示", status: "sent", createdAt: "2026-07-31T07:02:00.000Z" }
    ],
    followups: [
      { id: "f1", residentId: "r1", diseaseType: "高血压", status: "待随访", advice: "记录家庭血压", plannedAt: "2026-08-01" },
      { id: "f3", residentId: "r3", diseaseType: "越权任务", status: "待随访", advice: "不得展示", plannedAt: "2026-08-01" }
    ]
  };
}

test("production session requires a live server-issued resident identity", () => {
  assert.equal(Core.isProductionSession(session(), NOW).ok, true);
  assert.equal(Core.isProductionSession(session({ token: "" }), NOW).reason, "server-session-required");
  assert.equal(Core.isProductionSession(session({ authMode: "local" }), NOW).reason, "server-session-required");
  assert.equal(Core.isProductionSession(session({ expiresAt: "2026-07-31T07:59:59.000Z" }), NOW).reason, "session-expired");
  assert.equal(Core.isProductionSession(session({ role: "institution" }), NOW).reason, "citizen-required");
});

test("server identity mismatch and expiry fail closed", () => {
  const valid = Core.validateServerIdentity(session(), {
    ok: true,
    user: { id: "u4", role: "citizen", accountId: "a1", residentId: "r1", name: "居民甲" },
    expiresAt: "2026-07-31T09:00:00.000Z"
  }, NOW);
  assert.equal(valid.ok, true);
  assert.equal(Core.validateServerIdentity(session(), {
    ok: true,
    user: { id: "u4", role: "citizen", accountId: "a1", residentId: "r9" },
    expiresAt: "2026-07-31T09:00:00.000Z"
  }, NOW).reason, "subject-mismatch");
  assert.equal(Core.validateServerIdentity(session(), {
    ok: true,
    user: { id: "u4", role: "citizen", accountId: "a1", residentId: "r1" },
    expiresAt: "2026-07-31T07:00:00.000Z"
  }, NOW).reason, "server-session-expired");
});

test("family scope reuses verified relationship and active scoped authorization", () => {
  const data = scopedData();
  const scope = Core.deriveResidentScope(data, session(), NOW);
  assert.deepEqual([...scope.allowedIds], ["r1", "r2"]);
  assert.equal(scope.blocked.length, 1);
  assert.equal(scope.blocked[0].residentId, "r3");
  assert.equal(scope.blocked[0].reason, "verified-relationship-required");

  data.personalRecords[0].meta.scopes = ["labs"];
  const denied = Core.deriveResidentScope(data, session(), NOW);
  assert.deepEqual([...denied.allowedIds], ["r1"]);
  assert.equal(denied.blocked.find((item) => item.residentId === "r2").reason, "active-scoped-authorization-required");
});

test("projected app data removes denied residents, unsafe message targets and English copy", () => {
  const data = scopedData();
  const scope = Core.deriveResidentScope(data, session(), NOW);
  const projected = Core.projectDataForAllowedResidents(data, scope);
  assert.deepEqual(projected.residents.map((item) => item.id), ["r1", "r2"]);
  assert.deepEqual(projected.personalRecords.map((item) => item.id).sort(), ["auth-r2", "record-r1", "record-r2"]);
  assert.deepEqual(projected.followups.map((item) => item.id), ["f1"]);
  assert.deepEqual(projected.taskMessages.map((item) => item.id), ["m1"]);
  assert.equal(/[A-Za-z]{2,}/.test(projected.taskMessages[0].title), false);
  assert.equal(projected.taskMessages[0].route, "tasks");
});

test("member switching clears prior filters, details, drafts and pending actions", () => {
  const dirty = {
    residentId: "r1",
    route: "health-record",
    filters: { keyword: "血压" },
    selectedRecordId: "record-r1",
    selectedMessageId: "m1",
    formDraft: { note: "敏感草稿" },
    pendingAction: { id: "write-1" },
    transientNotice: "临时提示"
  };
  const switched = Core.switchResident(dirty, "r2", new Set(["r1", "r2"]));
  assert.equal(switched.ok, true);
  assert.deepEqual(switched.state, Core.createSensitiveState("r2"));
  const denied = Core.switchResident(dirty, "r3", new Set(["r1", "r2"]));
  assert.equal(denied.ok, false);
  assert.deepEqual(denied.state, Core.createSensitiveState(""));
});

test("message read state changes only after a matching server receipt", () => {
  assert.equal(Core.confirmMessageReceipt({ id: "m2", status: "read", receipts: [{ status: "read", at: NOW.toISOString() }] }, "m1").ok, false);
  assert.equal(Core.confirmMessageReceipt({ id: "m1", residentId: "r1", status: "read", receipts: [] }, "m1").ok, false);
  const receipt = Core.confirmMessageReceipt({
    id: "m1",
    residentId: "r1",
    targetRole: "citizen",
    collection: "registrationOrders",
    title: "挂号通知",
    body: "医院已返回处理状态",
    status: "read",
    receipts: [{ status: "read", at: NOW.toISOString() }]
  }, "m1");
  assert.equal(receipt.ok, true);
  assert.equal(receipt.message.isRead, true);
  assert.equal(receipt.message.route, "registration");
});

test("platform adapter stores only accessibility preferences and uses allowlisted routes", () => {
  const storage = new Map();
  const history = [];
  const environment = {
    localStorage: {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value)
    },
    location: { pathname: "/resident-mini-program.html" },
    history: { pushState: (_state, _title, url) => history.push(url) },
    CustomEvent: class CustomEvent { constructor(name, detail) { this.name = name; this.detail = detail; } },
    dispatchEvent: () => {}
  };
  const adapter = Adapter.createAdapter(environment);
  assert.equal(adapter.runtime, "web");
  assert.equal(adapter.setPreference("largeText", true), true);
  assert.equal(adapter.setPreference("residentId", "r1"), false);
  assert.deepEqual(adapter.getPreferences(), { largeText: true, highContrast: false });
  void adapter.navigate("home");
  assert.equal(history[0], "/resident-mini-program.html?page=home");
});
