"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");
const { createRouteSegment } = require("../src/http/routes/public-health/health-supervision");

const html = fs.readFileSync("public-health-supervision.html", "utf8");
const source = fs.readFileSync("public-health-supervision.js", "utf8");

test("health supervision page is manager-scoped and exposes the approved workflow controls", () => {
  assert.match(html, /data-roles="commission,institution"/);
  assert.match(html, /data-account-types="manager"/);
  for (const id of [
    "supervision-subject-form",
    "supervision-task-form",
    "supervision-action-form",
    "supervision-inspection-form",
    "supervision-tasks",
    "supervision-findings"
  ]) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, /GIS、视频、附件上传或外部交换仍保持 NO-GO/);
});

test("health supervision UI uses the shared API client and trusted text DOM only", () => {
  assert.match(source, /HealthPlatformApi\.createClient/);
  assert.match(source, /replaceChildren/);
  assert.match(source, /textContent/);
  assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  assert.doesNotMatch(source, /data\/db\.json|medicalResources|localStorage/);
  assert.match(source, /医疗机构（\$\{subject\.organizationCode\}）/);
  assert.doesNotMatch(source, /subject\.name|institutionName|patient|resident/i);
});

test("page declares empty, error and production boundary states", () => {
  assert.match(source, /暂无检查任务/);
  assert.match(source, /工作台加载失败/);
  assert.match(source, /案件进入独立协同工作台；GIS、视频、附件上传和外部交换仍保持 NO-GO/);
  assert.match(source, /productionReady === false/);
});

const clientSource = fs.readFileSync("platform-api-client.js", "utf8");
const manager = { id: "supervision-manager", role: "commission", accountType: "manager", orgType: "health_admin", orgCode: "ORG-HEALTH-001" };

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function response(body, status = 201) {
  return { ok: status >= 200 && status < 300, status, headers: { get: () => null }, json: async () => body };
}

function createdTask(body) {
  return response({ ok: true, idempotent: false, productionReady: false, task: { ...body, id: "phst-created", version: 1, status: "assigned" } });
}

function pageHarness({ post = async (_path, options) => createdTask(JSON.parse(options.body)), get } = {}) {
  const listeners = new Map();
  const nodes = new Map();
  const calls = [];
  let sequence = 0;
  let actor = { ...manager };
  function node() {
    return { textContent: "", dataset: {}, children: [], append(...children) { this.children.push(...children); }, replaceChildren(...children) { this.children = children; } };
  }
  const values = { subjectId: "phss-subject", taskType: "routine", priority: "normal", dueAt: "2099-01-01T12:00" };
  const button = { disabled: false };
  const form = { id: "supervision-task-form", values, querySelectorAll: () => [button] };
  const document = {
    readyState: "complete",
    createElement: node,
    querySelector(selector) { if (!nodes.has(selector)) nodes.set(selector, node()); return nodes.get(selector); },
    addEventListener(name, handler) { listeners.set(name, handler); }
  };
  const context = {
    document,
    HealthCityAuth: { getUser: () => actor },
    crypto: { randomUUID: () => `test-key-${++sequence}` },
    FormData: class { constructor(target) { this.values = { ...target.values }; } get(key) { return this.values[key] ?? null; } },
    fetch: async (path, options) => {
      calls.push({ path, ...options });
      if (options.method === "POST") return post(path, options);
      return get ? get(path, options) : response({ generatedAt: "2026-09-09T00:00:00.000Z", productionReady: false }, 200);
    }
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(clientSource, context, { filename: "platform-api-client.js" });
  vm.runInContext(source, context, { filename: "public-health-supervision.js" });
  return {
    form, button, values, calls, nodes,
    posts: () => calls.filter((call) => call.method === "POST"),
    submit: (target = form) => listeners.get("submit")({ target, preventDefault() {} }),
    setUser: (user) => { actor = user; },
    error: () => document.querySelector("#supervision-error").textContent
  };
}

test("inspection creation isolates pending submits and restores the submit control", async () => {
  const pending = deferred();
  const page = pageHarness({ post: () => pending.promise });
  const first = page.submit();
  assert.equal(page.button.disabled, true);
  await page.submit();
  assert.equal(page.posts().length, 1);
  pending.resolve(createdTask(JSON.parse(page.posts()[0].body)));
  await first;
  assert.equal(page.button.disabled, false);
  assert.equal(page.error(), "");
});

test("failed inspection drafts keep their command key including an A/B/A edit", async () => {
  const page = pageHarness({ post: async () => { throw new Error("connection lost"); } });
  await page.submit();
  await page.submit();
  page.values.priority = "high";
  await page.submit();
  page.values.priority = "normal";
  await page.submit();
  const keys = page.posts().map((call) => call.headers["Idempotency-Key"]);
  assert.equal(keys[0], keys[1]);
  assert.notEqual(keys[0], keys[2]);
  assert.equal(keys[0], keys[3]);
  assert.equal(page.values.subjectId, "phss-subject");
  assert.equal(page.button.disabled, false);
  assert.ok(page.error());
});

test("creation stays locked through authoritative refresh and preserves edits made while pending", async () => {
  const pending = deferred();
  let reads = 0;
  const page = pageHarness({ get: () => ++reads === 1 ? response({ productionReady: false }, 200) : pending.promise });
  await new Promise(setImmediate);
  const first = page.submit();
  await new Promise(setImmediate);
  page.values.priority = "urgent";
  await page.submit();
  assert.equal(page.posts().length, 1);
  assert.equal(page.button.disabled, true);
  pending.resolve(response({ productionReady: false }, 200));
  await first;
  assert.equal(page.values.priority, "urgent");
  assert.equal(page.button.disabled, false);
});

test("a mismatched creation projection cannot retire the original command identity", async () => {
  const page = pageHarness({ post: async (_path, options) => {
    const body = JSON.parse(options.body);
    return createdTask({ ...body, priority: "urgent" });
  } });
  await page.submit();
  await page.submit();
  assert.ok(page.error());
  assert.equal(page.posts()[0].headers["Idempotency-Key"], page.posts()[1].headers["Idempotency-Key"]);
});

test("saved task with failed refresh retries only the read before allowing a new command", async () => {
  let reads = 0;
  let available = false;
  const page = pageHarness({ get: async () => {
    if (++reads > 1 && !available) throw new Error("read unavailable");
    return response({ productionReady: false }, 200);
  } });
  await new Promise(setImmediate);
  await page.submit();
  assert.match(page.nodes.get("#supervision-status").textContent, /任务已保存.*刷新失败/);
  assert.doesNotMatch(page.nodes.get("#supervision-status").textContent, /操作未完成/);
  await page.submit();
  assert.equal(page.posts().length, 1);
  available = true;
  await page.submit();
  assert.equal(page.posts().length, 1);
  assert.equal(page.error(), "");
  await page.submit();
  assert.equal(page.posts().length, 2);
  assert.notEqual(page.posts()[0].headers["Idempotency-Key"], page.posts()[1].headers["Idempotency-Key"]);
});

test("only actual create or replay status and idempotency receipts confirm a task", async () => {
  for (const [status, idempotent, taskStatus, version] of [
    [202, false, "assigned", 1], [200, false, "assigned", 1],
    [201, true, "assigned", 1], [201, undefined, "assigned", 1],
    [201, false, "unknown", 1], [201, false, "assigned", 2]
  ]) {
    const page = pageHarness({ post: async (_path, options) => response({
      ok: true, idempotent, productionReady: false,
      task: { ...JSON.parse(options.body), id: "task-a", version, status: taskStatus }
    }, status) });
    await page.submit();
    await page.submit();
    assert.ok(page.error(), `${status}/${idempotent}/${taskStatus}/${version}`);
    assert.equal(page.posts()[0].headers["Idempotency-Key"], page.posts()[1].headers["Idempotency-Key"]);
  }
});

test("confirmed creation starts a new command and a changed actor cannot inherit a draft key", async () => {
  const page = pageHarness();
  await page.submit();
  await page.submit();
  assert.notEqual(page.posts()[0].headers["Idempotency-Key"], page.posts()[1].headers["Idempotency-Key"]);
  const failed = pageHarness({ post: async () => { throw new Error("offline"); } });
  await failed.submit();
  failed.setUser({ ...manager, id: "second-manager" });
  await failed.submit();
  assert.notEqual(failed.posts()[0].headers["Idempotency-Key"], failed.posts()[1].headers["Idempotency-Key"]);
});

test("malformed inspection success keeps the draft key and never refreshes as saved", async () => {
  for (const invalid of [null, {}, { ok: true }, { ok: false, task: { id: "fake" } }, { ok: true, task: { id: "wrong", subjectId: "other", version: 1 } }]) {
    const page = pageHarness({ post: async () => response(invalid, 200) });
    await new Promise(setImmediate);
    const initialGets = page.calls.length;
    await page.submit();
    assert.ok(page.error(), JSON.stringify(invalid));
    await page.submit();
    assert.equal(page.posts()[0].headers["Idempotency-Key"], page.posts()[1].headers["Idempotency-Key"]);
    assert.equal(page.calls.filter((call) => call.method === "GET").length, initialGets);
  }
});

test("non-JSON and rejected responses retain a retry key without clearing the draft", async () => {
  for (const result of [
    { ...response({}, 200), json: async () => { throw new SyntaxError("not JSON"); } },
    response({ error: "Forbidden" }, 403),
    response({ error: "Conflict" }, 409),
    response({ error: "Unavailable" }, 503)
  ]) {
    const page = pageHarness({ post: async () => result });
    await page.submit();
    await page.submit();
    assert.equal(page.posts()[0].headers["Idempotency-Key"], page.posts()[1].headers["Idempotency-Key"]);
    assert.equal(page.values.priority, "normal");
    assert.equal(page.button.disabled, false);
    assert.ok(page.error());
  }
});

test("invalid local time issues no request and the original disabled state is preserved", async () => {
  const page = pageHarness();
  page.values.dueAt = "not-a-date";
  page.button.disabled = true;
  await page.submit();
  assert.equal(page.posts().length, 0);
  assert.equal(page.button.disabled, true);
  page.values.dueAt = "2099-01-01T12:00";
  await page.submit();
  assert.equal(page.posts().length, 1);
  assert.equal(page.button.disabled, true);
});

test("other supervision forms retain their original command payloads", async () => {
  const page = pageHarness({ post: async () => response({ ok: true }) });
  await page.submit({ id: "supervision-subject-form", values: { organizationCode: " ORG-A ", riskLevel: "low" } });
  await page.submit({ id: "supervision-action-form", values: { resourceType: "task", resourceId: "task-a", action: "accept", expectedVersion: "2" } });
  await page.submit({ id: "supervision-inspection-form", values: {
    taskId: "task-a", expectedVersion: "3", inspectedAt: "2026-09-09T12:00", result: "compliant",
    subjectQualification: "pass", siteCondition: "pass", processRecord: "pass", evidenceRef: "evidence:check"
  } });
  assert.deepEqual(JSON.parse(page.posts()[0].body), { organizationCode: "ORG-A", riskLevel: "low", expectedVersion: 0 });
  assert.deepEqual(JSON.parse(page.posts()[1].body), { action: "accept", expectedVersion: 2 });
  const inspection = JSON.parse(page.posts()[2].body);
  assert.equal(inspection.action, "record-inspection");
  assert.equal(inspection.expectedVersion, 3);
  assert.equal(inspection.checklistResults.length, 3);
  assert.equal(inspection.result, "compliant");
});

test("a lost creation response replays the same real route command with one task and one task audit", async () => {
  let state = {
    authOrganizations: [{ orgCode: "ORG-A", orgType: "medical_institution", orgLevel: "基层医疗机构", parentCode: manager.orgCode }],
    publicHealthSupervisionSubjects: [], publicHealthSupervisionInspectionTasks: [],
    publicHealthSupervisionInspectionRecords: [], publicHealthSupervisionFindings: [],
    securityEvents: [], storageMeta: { collectionVersions: {} }
  };
  let sequence = 0;
  let writes = 0;
  const segment = createRouteSegment({
    appendSecurityEvent() {},
    collectJson: async (req) => req.payload,
    randomUUID: () => `route-${++sequence}`,
    readDatabase: () => structuredClone(state),
    requireApiRole: (req) => req.user,
    sealAuditTrail: (rows) => rows,
    sendJson: (res, status, body) => Object.assign(res, { status, body }),
    writeDatabase: (next) => { state = structuredClone(next); writes += 1; }
  });
  async function invoke(path, body, key) {
    const res = {};
    await segment.handle({ method: "POST", user: manager, headers: { "idempotency-key": key }, payload: body }, res, new URL(`http://local.test${path}`));
    return res;
  }
  const subject = await invoke("/api/public-health/supervision/subjects", { organizationCode: "ORG-A", riskLevel: "low", expectedVersion: 0 }, "create-subject");
  assert.equal(subject.status, 201);
  let loseReply = true;
  const page = pageHarness({ post: async (path, options) => {
    const result = await invoke(path, JSON.parse(options.body), options.headers["Idempotency-Key"]);
    assert.ok([200, 201].includes(result.status), JSON.stringify(result.body));
    if (loseReply) { loseReply = false; throw new Error("reply lost after commit"); }
    return response(result.body, result.status);
  } });
  page.values.subjectId = subject.body.subject.id;
  await page.submit();
  assert.equal(state.publicHealthSupervisionInspectionTasks.length, 1);
  assert.ok(page.error());
  await page.submit();
  assert.equal(state.publicHealthSupervisionInspectionTasks.length, 1);
  assert.equal(writes, 2);
  assert.equal(state.securityEvents.filter((row) => row.action === "public-health-supervision-task-create").length, 1);
  assert.equal(page.error(), "");
});
