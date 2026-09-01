"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const templates = require("../config/public-health-supervision-templates.json").templates;
const {
  COLLECTIONS,
  LIMITS,
  projectFinding,
  validateFindingAction,
  validateSubjectCommand,
  validateTaskAction
} = require("../src/public-health/health-supervision/contracts");
const {
  applyInspectionTaskActionToState,
  applySupervisionFindingActionToState,
  buildHealthSupervisionWorkbench,
  createInspectionTaskToState,
  createSupervisionSubjectToState
} = require("../src/public-health/health-supervision/service");

const commission = Object.freeze({
  id: "commission-user-1",
  role: "commission",
  orgType: "health_admin",
  orgCode: "ORG-HEALTH-001"
});
const district = Object.freeze({
  id: "district-user-1",
  role: "commission",
  orgType: "district",
  orgCode: "ORG-DISTRICT-001"
});
const institution = Object.freeze({
  id: "institution-user-1",
  role: "institution",
  orgType: "medical_institution",
  orgCode: "MR100"
});
const directoryEntry = Object.freeze({
  orgCode: "MR100",
  name: "不得进入新领域记录的历史机构名称",
  orgType: "medical_institution",
  orgLevel: "基层医疗机构",
  parentCode: "ORG-HEALTH-001"
});

function emptyState() {
  return {
    authOrganizations: [directoryEntry],
    [COLLECTIONS.subjects]: [],
    [COLLECTIONS.tasks]: [],
    [COLLECTIONS.records]: [],
    [COLLECTIONS.findings]: []
  };
}

function subjectPayload(overrides = {}) {
  return {
    organizationCode: "MR100",
    riskLevel: "medium",
    expectedVersion: 0,
    ...overrides
  };
}

function taskPayload(subjectId, overrides = {}) {
  return {
    subjectId,
    taskType: "routine",
    priority: "normal",
    dueAt: "2026-09-03T09:00:00.000Z",
    checklistTemplateId: "general-health-supervision-baseline",
    checklistTemplateVersion: 1,
    expectedVersion: 0,
    ...overrides
  };
}

function checklistResults(failed = []) {
  return templates[0].items.map((item) => ({
    itemCode: item.code,
    outcome: failed.includes(item.code) ? "fail" : "pass",
    note: "已完成检查",
    evidenceRefs: [`evidence:${item.code}`]
  }));
}

function finding(itemCode, overrides = {}) {
  return {
    itemCode,
    severity: "high",
    summary: "发现需要整改的问题",
    remediationDueAt: "2026-09-02T09:00:00.000Z",
    evidenceRefs: [`evidence:finding:${itemCode}`],
    ...overrides
  };
}

function createSubject(state = emptyState(), actor = commission, id = "phss-subject-1") {
  return createSupervisionSubjectToState(state, {
    payload: subjectPayload(),
    user: actor,
    directoryEntry,
    id,
    now: "2026-09-01T08:00:00.000Z"
  });
}

function createTask(state, subjectId, id = "phst-task-1") {
  return createInspectionTaskToState(state, {
    payload: taskPayload(subjectId),
    user: commission,
    id,
    now: "2026-09-01T08:05:00.000Z",
    templates
  });
}

function progressToInProgress(state, taskId) {
  const accepted = applyInspectionTaskActionToState(state, {
    taskId,
    user: commission,
    now: "2026-09-01T08:10:00.000Z",
    payload: { action: "accept", expectedVersion: 1 }
  });
  return applyInspectionTaskActionToState(accepted.nextData, {
    taskId,
    user: commission,
    now: "2026-09-01T08:20:00.000Z",
    payload: { action: "start", expectedVersion: 2 }
  });
}

function assertCode(code) {
  return (error) => error?.code === `PUBLIC_HEALTH_SUPERVISION_${code}`;
}

test("contracts reject unknown fields, unsafe evidence references and invalid create versions", () => {
  assert.throws(
    () => validateSubjectCommand(subjectPayload({ actor: "client-controlled" })),
    assertCode("INPUT_INVALID")
  );
  assert.throws(
    () => validateSubjectCommand(subjectPayload({ expectedVersion: 2 })),
    assertCode("INPUT_INVALID")
  );
  assert.throws(
    () => validateFindingAction({
      action: "submit-remediation",
      note: "整改完成",
      evidenceRefs: ["https://untrusted.example/evidence"],
      expectedVersion: 1
    }),
    assertCode("INPUT_INVALID")
  );
  assert.throws(
    () => validateTaskAction({
      action: "record-inspection",
      inspectedAt: "2026-09-01T08:30:00.000Z",
      result: "noncompliant",
      checklistResults: checklistResults(["site-condition-status"]),
      findings: [],
      expectedVersion: 3,
      productionReady: true
    }),
    assertCode("INPUT_INVALID")
  );
});

test("subject creation stores only a minimal directory reference and does not mutate caller state", () => {
  const state = emptyState();
  const before = structuredClone(state);
  const result = createSubject(state);

  assert.deepEqual(state, before);
  assert.equal(result.nextData, result.state);
  assert.equal(result.idempotent, false);
  assert.equal(result.subject.directoryRef, "identity-organization:v1:MR100");
  assert.equal(result.subject.organizationCode, "MR100");
  assert.equal(result.subject.jurisdictionCode, "ORG-HEALTH-001");
  assert.equal(result.subject.productionReady, false);
  assert.equal(Object.hasOwn(result.subject, "name"), false);
  assert.doesNotMatch(JSON.stringify(result.subject), /历史机构名称/);
  assert.equal(state[COLLECTIONS.subjects].length, 0);
  assert.equal(result.nextData[COLLECTIONS.subjects].length, 1);
});

test("district subject intake is restricted to its directory jurisdiction", () => {
  assert.throws(
    () => createSubject(emptyState(), district),
    assertCode("SCOPE_FORBIDDEN")
  );
  const matchingDirectory = { ...directoryEntry, parentCode: district.orgCode };
  const state = { ...emptyState(), authOrganizations: [matchingDirectory] };
  const result = createSupervisionSubjectToState(state, {
    payload: subjectPayload(),
    user: district,
    directoryEntry: matchingDirectory,
    id: "phss-district-subject",
    now: "2026-09-01T08:00:00.000Z"
  });
  assert.equal(result.subject.jurisdictionCode, district.orgCode);
});

test("task state machine closes a compliant inspection with one immutable record", () => {
  const subjectResult = createSubject();
  const taskResult = createTask(subjectResult.nextData, subjectResult.subject.id);
  const started = progressToInProgress(taskResult.nextData, taskResult.task.id);
  const beforeRecord = structuredClone(started.nextData);
  const recorded = applyInspectionTaskActionToState(started.nextData, {
    taskId: taskResult.task.id,
    user: commission,
    now: "2026-09-01T08:40:00.000Z",
    recordId: "phsr-record-compliant",
    findingIds: [],
    templates,
    payload: {
      action: "record-inspection",
      inspectedAt: "2026-09-01T08:30:00.000Z",
      result: "compliant",
      checklistResults: checklistResults(),
      findings: [],
      evidenceRefs: ["evidence:inspection:compliant"],
      expectedVersion: 3
    }
  });

  assert.deepEqual(started.nextData, beforeRecord);
  assert.equal(recorded.task.status, "closed");
  assert.equal(recorded.task.version, 4);
  assert.equal(recorded.record.version, 1);
  assert.equal(recorded.findings.length, 0);
  assert.equal(recorded.nextData[COLLECTIONS.records].length, 1);
  assert.throws(
    () => applyInspectionTaskActionToState(recorded.nextData, {
      taskId: recorded.task.id,
      user: commission,
      now: "2026-09-01T08:50:00.000Z",
      recordId: "phsr-record-duplicate",
      findingIds: [],
      templates,
      payload: {
        action: "record-inspection",
        inspectedAt: "2026-09-01T08:45:00.000Z",
        result: "compliant",
        checklistResults: checklistResults(),
        findings: [],
        expectedVersion: 4
      }
    }),
    assertCode("STATE_CONFLICT")
  );
});

test("two findings complete submit, reject, reopen, resubmit and all-verified task closure", () => {
  const subjectResult = createSubject();
  const taskResult = createTask(subjectResult.nextData, subjectResult.subject.id);
  const started = progressToInProgress(taskResult.nextData, taskResult.task.id);
  const failedItems = ["site-condition-status", "process-record-status"];
  const recorded = applyInspectionTaskActionToState(started.nextData, {
    taskId: taskResult.task.id,
    user: commission,
    now: "2026-09-01T08:40:00.000Z",
    recordId: "phsr-record-findings",
    findingIds: ["phsf-finding-1", "phsf-finding-2"],
    templates,
    payload: {
      action: "record-inspection",
      inspectedAt: "2026-09-01T08:30:00.000Z",
      result: "noncompliant",
      checklistResults: checklistResults(failedItems),
      findings: failedItems.map((itemCode) => finding(itemCode)),
      evidenceRefs: ["evidence:inspection:noncompliant"],
      expectedVersion: 3
    }
  });
  const immutableRecord = structuredClone(recorded.record);
  assert.equal(recorded.task.status, "rectification-open");

  const firstSubmitted = applySupervisionFindingActionToState(recorded.nextData, {
    findingId: "phsf-finding-1",
    user: institution,
    now: "2026-09-01T09:00:00.000Z",
    payload: {
      action: "submit-remediation",
      note: "第一项已整改",
      evidenceRefs: ["evidence:remediation:1"],
      expectedVersion: 1
    }
  });
  assert.equal(firstSubmitted.task.status, "rectification-open");

  const secondSubmitted = applySupervisionFindingActionToState(firstSubmitted.nextData, {
    findingId: "phsf-finding-2",
    user: institution,
    now: "2026-09-01T09:05:00.000Z",
    payload: {
      action: "submit-remediation",
      note: "第二项已整改",
      evidenceRefs: ["evidence:remediation:2"],
      expectedVersion: 1
    }
  });
  assert.equal(secondSubmitted.task.status, "rectification-review");

  const firstApproved = applySupervisionFindingActionToState(secondSubmitted.nextData, {
    findingId: "phsf-finding-1",
    user: commission,
    now: "2026-09-01T09:10:00.000Z",
    payload: {
      action: "review-remediation",
      decision: "approved",
      note: "第一项复核通过",
      evidenceRefs: ["evidence:review:1"],
      expectedVersion: 2
    }
  });
  assert.equal(firstApproved.task.status, "rectification-review");

  const secondRejected = applySupervisionFindingActionToState(firstApproved.nextData, {
    findingId: "phsf-finding-2",
    user: commission,
    now: "2026-09-01T09:15:00.000Z",
    payload: {
      action: "review-remediation",
      decision: "rejected",
      note: "第二项证据不足",
      evidenceRefs: ["evidence:review:2-reject"],
      expectedVersion: 2
    }
  });
  assert.equal(secondRejected.finding.status, "reopened");
  assert.equal(secondRejected.task.status, "rectification-open");

  const resubmitted = applySupervisionFindingActionToState(secondRejected.nextData, {
    findingId: "phsf-finding-2",
    user: institution,
    now: "2026-09-01T09:20:00.000Z",
    payload: {
      action: "submit-remediation",
      note: "第二项补充整改证据",
      evidenceRefs: ["evidence:remediation:2-round-2"],
      expectedVersion: 3
    }
  });
  assert.equal(resubmitted.finding.remediationRounds.length, 2);
  assert.equal(resubmitted.task.status, "rectification-review");

  const closed = applySupervisionFindingActionToState(resubmitted.nextData, {
    findingId: "phsf-finding-2",
    user: commission,
    now: "2026-09-01T09:25:00.000Z",
    payload: {
      action: "review-remediation",
      decision: "approved",
      note: "第二项复核通过",
      evidenceRefs: ["evidence:review:2-approved"],
      expectedVersion: 4
    }
  });
  assert.equal(closed.finding.status, "verified");
  assert.equal(closed.task.status, "closed");
  assert.deepEqual(closed.nextData[COLLECTIONS.records][0], immutableRecord);
});

test("finding actions enforce institution ownership, assignment scope and stale versions", () => {
  const subjectResult = createSubject();
  const taskResult = createTask(subjectResult.nextData, subjectResult.subject.id);
  const started = progressToInProgress(taskResult.nextData, taskResult.task.id);
  const recorded = applyInspectionTaskActionToState(started.nextData, {
    taskId: taskResult.task.id,
    user: commission,
    now: "2026-09-01T08:40:00.000Z",
    recordId: "phsr-record-scope",
    findingIds: ["phsf-finding-scope"],
    templates,
    payload: {
      action: "record-inspection",
      inspectedAt: "2026-09-01T08:30:00.000Z",
      result: "noncompliant",
      checklistResults: checklistResults(["site-condition-status"]),
      findings: [finding("site-condition-status")],
      expectedVersion: 3
    }
  });
  assert.throws(
    () => applySupervisionFindingActionToState(recorded.nextData, {
      findingId: "phsf-finding-scope",
      user: { ...institution, orgCode: "MR999" },
      now: "2026-09-01T09:00:00.000Z",
      payload: {
        action: "submit-remediation",
        note: "越权提交",
        evidenceRefs: ["evidence:scope:denied"],
        expectedVersion: 1
      }
    }),
    assertCode("SCOPE_FORBIDDEN")
  );
  assert.throws(
    () => applySupervisionFindingActionToState(recorded.nextData, {
      findingId: "phsf-finding-scope",
      user: institution,
      now: "2026-09-01T09:00:00.000Z",
      payload: {
        action: "submit-remediation",
        note: "陈旧版本",
        evidenceRefs: ["evidence:stale:version"],
        expectedVersion: 9
      }
    }),
    assertCode("VERSION_CONFLICT")
  );
});

test("capacity guards fail closed without evicting existing legal or business records", () => {
  const state = emptyState();
  state[COLLECTIONS.subjects] = Array.from({ length: LIMITS.subjects }, (_, index) => ({
    id: `phss-existing-${index}`,
    organizationCode: `MR${index}`
  }));
  const before = structuredClone(state);
  assert.throws(() => createSubject(state), assertCode("CAPACITY_REACHED"));
  assert.deepEqual(state, before);
  assert.equal(state[COLLECTIONS.subjects].length, LIMITS.subjects);
});

test("safe projections and scoped workbench omit receipts, principal ids and directory names", () => {
  const subjectResult = createSubject();
  const taskResult = createTask(subjectResult.nextData, subjectResult.subject.id);
  const data = structuredClone(taskResult.nextData);
  data[COLLECTIONS.subjects][0]._apiCommandReceipts = [{ requestDigest: "secret-digest" }];
  data[COLLECTIONS.tasks][0]._apiCommandReceipts = [{ commandKeyHash: "secret-hash" }];
  data[COLLECTIONS.findings] = [{
    id: "phsf-projection",
    version: 2,
    taskId: taskResult.task.id,
    subjectId: subjectResult.subject.id,
    inspectionRecordId: "phsr-projection",
    itemCode: "site-condition-status",
    severity: "high",
    summary: "<img src=x onerror=alert(1)>",
    remediationDueAt: "2026-09-02T09:00:00.000Z",
    evidenceRefs: ["evidence:projection"],
    status: "remediation-submitted",
    remediationRounds: [{
      round: 1,
      submission: {
        at: "2026-09-01T09:00:00.000Z",
        orgCode: "MR100",
        principalId: "private-principal",
        note: "整改说明",
        evidenceRefs: ["evidence:round"]
      },
      review: null
    }],
    createdAt: "2026-09-01T08:40:00.000Z",
    updatedAt: "2026-09-01T09:00:00.000Z",
    _apiCommandReceipts: [{ requestDigest: "private" }]
  }];

  const view = buildHealthSupervisionWorkbench(data, {
    user: institution,
    templates,
    now: "2026-09-01T10:00:00.000Z"
  });
  const serialized = JSON.stringify(view);
  assert.equal(view.productionReady, false);
  assert.equal(view.subjects.length, 1);
  assert.equal(view.tasks.length, 1);
  assert.equal(view.findings.length, 1);
  assert.equal(view.findings[0].summary, "<img src=x onerror=alert(1)>");
  assert.doesNotMatch(serialized, /secret|private-principal|历史机构名称|_apiCommandReceipts/);

  const projected = projectFinding(data[COLLECTIONS.findings][0]);
  assert.equal(projected.remediationRounds[0].submission.orgCode, "MR100");
  assert.equal(Object.hasOwn(projected.remediationRounds[0].submission, "principalId"), false);
});
