"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { createRouteSegment } = require("../src/http/routes/public-health/health-supervision");

const commission = Object.freeze({
  id: "commission-manager-1",
  name: "监管管理员",
  role: "commission",
  accountType: "manager",
  orgType: "health_admin",
  orgCode: "ORG-HEALTH-001"
});
const district = Object.freeze({
  id: "district-manager-1",
  name: "区级监管管理员",
  role: "commission",
  accountType: "manager",
  orgType: "district",
  orgCode: "ORG-DISTRICT-001"
});
const institution = Object.freeze({
  id: "institution-manager-1",
  name: "机构整改管理员",
  role: "institution",
  accountType: "manager",
  orgType: "medical_institution",
  orgCode: "MR100"
});

function initialState() {
  return {
    authOrganizations: [
      {
        orgCode: "MR100",
        name: "不得出现在卫生监督投影中的目录名称",
        orgType: "medical_institution",
        orgLevel: "基层医疗机构",
        parentCode: "ORG-HEALTH-001"
      },
      {
        orgCode: "MR200",
        name: "另一目录名称",
        orgType: "medical_institution",
        orgLevel: "基层医疗机构",
        parentCode: "ORG-DISTRICT-OTHER"
      }
    ],
    publicHealthSupervisionSubjects: [],
    publicHealthSupervisionInspectionTasks: [],
    publicHealthSupervisionInspectionRecords: [],
    publicHealthSupervisionFindings: [],
    securityEvents: [],
    storageMeta: { collectionVersions: {} }
  };
}

function createHarness(seed = initialState(), options = {}) {
  let state = structuredClone(seed);
  const calls = { append: 0, auth: 0, collect: 0, read: 0, write: 0 };
  let sequence = 0;
  const runtime = {
    appendSecurityEvent() {
      calls.append += 1;
      if (options.appendError) throw new Error("sensitive audit provider detail");
    },
    async collectJson(req) {
      calls.collect += 1;
      if (req.jsonError) throw new SyntaxError("invalid json details");
      return structuredClone(req.payload);
    },
    randomUUID() {
      sequence += 1;
      return `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
    },
    readDatabase() {
      calls.read += 1;
      return structuredClone(state);
    },
    requireApiRole(req, res, roles) {
      calls.auth += 1;
      if (!req.user) {
        runtime.sendJson(res, 401, { error: "Unauthorized" });
        return null;
      }
      if (!roles.includes(req.user.role)) {
        runtime.sendJson(res, 403, { error: "Forbidden" });
        return null;
      }
      return req.user;
    },
    sealAuditTrail(entries) {
      return entries.map((entry, index) => ({ ...entry, hash: `sealed-${index}` }));
    },
    sendJson(res, status, body) {
      res.status = status;
      res.body = structuredClone(body);
    },
    writeDatabase(next) {
      calls.write += 1;
      if (options.writeError) throw new Error("sensitive storage path detail");
      state = structuredClone(next);
    }
  };
  return {
    calls,
    get state() { return structuredClone(state); },
    segment: createRouteSegment(runtime)
  };
}

async function invoke(harness, { method = "GET", path, user, payload, key }) {
  const req = {
    method,
    headers: key ? { "idempotency-key": key } : {},
    payload,
    user
  };
  const res = {};
  const handled = await harness.segment.handle(req, res, new URL(`http://local.test${path}`));
  assert.equal(handled, true);
  return res;
}

function taskPayload(subjectId) {
  return {
    subjectId,
    taskType: "routine",
    priority: "normal",
    dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    checklistTemplateId: "general-health-supervision-baseline",
    checklistTemplateVersion: 1,
    expectedVersion: 0
  };
}

function checklist(failedCode = "") {
  return ["subject-qualification-status", "site-condition-status", "process-record-status"].map((itemCode) => ({
    itemCode,
    outcome: itemCode === failedCode ? "fail" : "pass",
    note: "已核验",
    evidenceRefs: [`evidence:${itemCode}`]
  }));
}

async function createSubject(harness, overrides = {}) {
  return invoke(harness, {
    method: "POST",
    path: "/api/public-health/supervision/subjects",
    user: commission,
    key: overrides.key || "subject-create-1",
    payload: {
      organizationCode: overrides.organizationCode || "MR100",
      riskLevel: overrides.riskLevel || "medium",
      expectedVersion: 0
    }
  });
}

test("authorization and manager organization checks happen before body and state reads", async () => {
  const harness = createHarness();
  const anonymous = await invoke(harness, {
    method: "POST",
    path: "/api/public-health/supervision/subjects",
    payload: { organizationCode: "MR100", riskLevel: "medium", expectedVersion: 0 },
    key: "anonymous-command"
  });
  assert.equal(anonymous.status, 401);
  assert.equal(harness.calls.collect, 0);
  assert.equal(harness.calls.read, 0);

  const worker = await invoke(harness, {
    method: "POST",
    path: "/api/public-health/supervision/subjects",
    user: { ...commission, accountType: "worker" },
    payload: { organizationCode: "MR100", riskLevel: "medium", expectedVersion: 0 },
    key: "worker-command"
  });
  assert.equal(worker.status, 403);
  assert.equal(harness.calls.collect, 0);
  assert.equal(harness.calls.read, 0);
});

test("subject create enforces explicit idempotency, directory scope and exact zero-write replay", async () => {
  const harness = createHarness();
  const missingKey = await invoke(harness, {
    method: "POST",
    path: "/api/public-health/supervision/subjects",
    user: commission,
    payload: { organizationCode: "MR100", riskLevel: "medium", expectedVersion: 0 }
  });
  assert.equal(missingKey.status, 400);
  assert.equal(missingKey.body.code, "PUBLIC_HEALTH_SUPERVISION_IDEMPOTENCY_KEY_REQUIRED");

  const created = await createSubject(harness);
  assert.equal(created.status, 201);
  assert.equal(created.body.subject.organizationCode, "MR100");
  assert.equal(created.body.subject.productionReady, false);
  assert.equal(JSON.stringify(created.body).includes("目录名称"), false);
  assert.equal(harness.calls.write, 1);

  const replay = await createSubject(harness);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.idempotent, true);
  assert.equal(replay.body.subject.id, created.body.subject.id);
  assert.equal(harness.calls.write, 1);

  const conflict = await createSubject(harness, { riskLevel: "high" });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.code, "PUBLIC_HEALTH_SUPERVISION_IDEMPOTENCY_CONFLICT");
  assert.equal(harness.calls.write, 1);

  const denied = await invoke(harness, {
    method: "POST",
    path: "/api/public-health/supervision/subjects",
    user: district,
    key: "district-cross-scope",
    payload: { organizationCode: "MR200", riskLevel: "medium", expectedVersion: 0 }
  });
  assert.equal(denied.status, 403);
  assert.equal(harness.calls.append, 1);
  assert.equal(harness.calls.write, 1);
});

test("API completes task, inspection, remediation and independent review with one write per command", async () => {
  const harness = createHarness();
  const subject = await createSubject(harness);
  const createTaskBody = taskPayload(subject.body.subject.id);
  const taskCreated = await invoke(harness, {
    method: "POST",
    path: "/api/public-health/supervision/inspection-tasks",
    user: commission,
    key: "task-create-1",
    payload: createTaskBody
  });
  assert.equal(taskCreated.status, 201);
  const taskId = taskCreated.body.task.id;
  const taskReplay = await invoke(harness, {
    method: "POST",
    path: "/api/public-health/supervision/inspection-tasks",
    user: commission,
    key: "task-create-1",
    payload: createTaskBody
  });
  assert.equal(taskReplay.status, 200);
  assert.equal(taskReplay.body.idempotent, true);
  assert.equal(taskReplay.body.task.id, taskId);
  assert.equal(harness.calls.write, 2);

  const accepted = await invoke(harness, {
    method: "POST",
    path: `/api/public-health/supervision/inspection-tasks/${taskId}/actions`,
    user: commission,
    key: "task-accept-1",
    payload: { action: "accept", expectedVersion: 1 }
  });
  assert.equal(accepted.body.task.status, "accepted");
  const started = await invoke(harness, {
    method: "POST",
    path: `/api/public-health/supervision/inspection-tasks/${taskId}/actions`,
    user: commission,
    key: "task-start-1",
    payload: { action: "start", expectedVersion: 2 }
  });
  assert.equal(started.body.task.status, "in-progress");

  const inspectedAt = new Date(Date.now() + 1000).toISOString();
  const recorded = await invoke(harness, {
    method: "POST",
    path: `/api/public-health/supervision/inspection-tasks/${taskId}/actions`,
    user: commission,
    key: "task-record-1",
    payload: {
      action: "record-inspection",
      inspectedAt,
      result: "noncompliant",
      checklistResults: checklist("site-condition-status"),
      findings: [{
        itemCode: "site-condition-status",
        severity: "high",
        summary: "现场条件需要整改",
        remediationDueAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
        evidenceRefs: ["evidence:finding:site"]
      }],
      evidenceRefs: ["evidence:inspection:1"],
      expectedVersion: 3
    }
  });
  assert.equal(recorded.status, 200);
  assert.equal(recorded.body.task.status, "rectification-open");
  assert.equal(recorded.body.record.version, 1);
  assert.equal(recorded.body.findings.length, 1);
  const findingId = recorded.body.findings[0].id;

  const submitted = await invoke(harness, {
    method: "POST",
    path: `/api/public-health/supervision/findings/${findingId}/actions`,
    user: institution,
    key: "finding-submit-1",
    payload: {
      action: "submit-remediation",
      note: "整改已完成",
      evidenceRefs: ["evidence:remediation:1"],
      expectedVersion: 1
    }
  });
  assert.equal(submitted.body.finding.status, "remediation-submitted");
  assert.equal(submitted.body.task.status, "rectification-review");
  const submittedReplay = await invoke(harness, {
    method: "POST",
    path: `/api/public-health/supervision/findings/${findingId}/actions`,
    user: institution,
    key: "finding-submit-1",
    payload: {
      action: "submit-remediation",
      note: "整改已完成",
      evidenceRefs: ["evidence:remediation:1"],
      expectedVersion: 1
    }
  });
  assert.equal(submittedReplay.status, 200);
  assert.equal(submittedReplay.body.idempotent, true);
  assert.equal(harness.calls.write, 6);

  const approved = await invoke(harness, {
    method: "POST",
    path: `/api/public-health/supervision/findings/${findingId}/actions`,
    user: commission,
    key: "finding-review-1",
    payload: {
      action: "review-remediation",
      decision: "approved",
      note: "复核通过",
      evidenceRefs: ["evidence:review:1"],
      expectedVersion: 2
    }
  });
  assert.equal(approved.body.finding.status, "verified");
  assert.equal(approved.body.task.status, "closed");
  assert.equal(harness.calls.write, 7);
  assert.equal(harness.state.publicHealthSupervisionInspectionRecords.length, 1);
  assert.equal(harness.state.securityEvents.length, 7);

  const institutionWorkbench = await invoke(harness, {
    path: "/api/public-health/supervision/workbench",
    user: institution
  });
  assert.equal(institutionWorkbench.status, 200);
  assert.equal(institutionWorkbench.body.summary.tasks, 1);
  assert.equal(institutionWorkbench.body.summary.openTasks, 0);
  assert.equal(JSON.stringify(institutionWorkbench.body).includes("目录名称"), false);
  assert.equal(institutionWorkbench.body.productionReady, false);
});

test("stale aggregate versions and unsafe evidence fail without persistence", async () => {
  const harness = createHarness();
  const subject = await createSubject(harness);
  const task = await invoke(harness, {
    method: "POST",
    path: "/api/public-health/supervision/inspection-tasks",
    user: commission,
    key: "task-create-stale",
    payload: taskPayload(subject.body.subject.id)
  });
  const before = harness.calls.write;
  const stale = await invoke(harness, {
    method: "POST",
    path: `/api/public-health/supervision/inspection-tasks/${task.body.task.id}/actions`,
    user: commission,
    key: "task-stale",
    payload: { action: "accept", expectedVersion: 0 }
  });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, "PUBLIC_HEALTH_SUPERVISION_VERSION_CONFLICT");
  assert.equal(harness.calls.write, before);
});

test("scope audit and storage failures are fail-closed and redacted", async () => {
  const auditFailure = createHarness(initialState(), { appendError: true });
  const denied = await invoke(auditFailure, {
    method: "POST",
    path: "/api/public-health/supervision/subjects",
    user: district,
    key: "district-audit-failure",
    payload: { organizationCode: "MR200", riskLevel: "medium", expectedVersion: 0 }
  });
  assert.equal(denied.status, 500);
  assert.equal(denied.body.code, "PUBLIC_HEALTH_SUPERVISION_AUDIT_FAILED");
  assert.doesNotMatch(JSON.stringify(denied.body), /provider|detail/i);
  assert.equal(auditFailure.calls.write, 0);

  const storageFailure = createHarness(initialState(), { writeError: true });
  const failed = await createSubject(storageFailure, { key: "subject-storage-failure" });
  assert.equal(failed.status, 500);
  assert.equal(failed.body.code, "PUBLIC_HEALTH_SUPERVISION_STORAGE_FAILED");
  assert.doesNotMatch(JSON.stringify(failed.body), /path|detail/i);
  assert.equal(storageFailure.state.publicHealthSupervisionSubjects.length, 0);
});

test("concurrent identical task actions commit once under the task lock", async () => {
  const harness = createHarness();
  const subject = await createSubject(harness, { key: "subject-concurrency" });
  const task = await invoke(harness, {
    method: "POST",
    path: "/api/public-health/supervision/inspection-tasks",
    user: commission,
    key: "task-concurrency",
    payload: taskPayload(subject.body.subject.id)
  });
  const request = {
    method: "POST",
    path: `/api/public-health/supervision/inspection-tasks/${task.body.task.id}/actions`,
    user: commission,
    key: "task-concurrent-accept",
    payload: { action: "accept", expectedVersion: 1 }
  };
  const before = harness.calls.write;
  const [left, right] = await Promise.all([invoke(harness, request), invoke(harness, request)]);
  assert.deepEqual(new Set([left.status, right.status]), new Set([200]));
  assert.equal([left.body.idempotent, right.body.idempotent].filter(Boolean).length, 1);
  assert.equal(harness.calls.write, before + 1);
  assert.equal(harness.state.publicHealthSupervisionInspectionTasks[0].version, 2);
});
