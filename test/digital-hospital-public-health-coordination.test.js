"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  advancePublicHealthIncident,
  buildPublicHealthIncidentClosureGate,
  buildPublicHealthCoordinationBoard,
  createPublicHealthIncident,
  escalatePublicHealthIncident,
  normalizePublicHealthCoordination,
  reviewPublicHealthIncidentEvidence,
  renderPublicHealthIncidentCsv,
  seedPublicHealthCoordination,
  submitPublicHealthIncidentEvidence
} = require("../digital-hospital-public-health-coordination");

const creator = {
  id: "u-city",
  username: "city",
  name: "市级管理员",
  role: "commission"
};

const reviewer = {
  id: "u-health",
  username: "health",
  name: "卫健委复核员",
  role: "commission"
};

function validIncident(overrides = {}) {
  return {
    id: "PHE-TEST-001",
    laneId: "infectious-reporting",
    title: "测试直报回执超时",
    level: "P0",
    source: "自动监测",
    hospitalCode: "H000001",
    owner: "疾控与医政联络组",
    dueAt: "2026-07-30T12:00:00.000Z",
    note: "已登记并等待责任组核查",
    ...overrides
  };
}

function acceptRequiredEvidence(state, incidentId, level = "P0") {
  const requirements = {
    P0: ["business-receipt", "site-joint-test", "production-approval", "dr-rehearsal"],
    P1: ["business-receipt", "site-joint-test", "production-approval"],
    P2: ["business-receipt", "site-joint-test"]
  }[level];
  let nextState = state;
  let incident = nextState.incidents.find((item) => item.id === incidentId);
  for (const [index, evidenceType] of requirements.entries()) {
    let result = submitPublicHealthIncidentEvidence(nextState, incidentId, {
      expectedRevision: incident.revision,
      evidenceType,
      referenceNo: `REF-${evidenceType}-${index + 1}`,
      summary: `${evidenceType} closure evidence summary`,
      digest: `sha256:${String(index + 1).repeat(64)}`
    }, creator, { now: `2026-07-30T08:${String(31 + index * 2).padStart(2, "0")}:00.000Z` });
    nextState = result.state;
    incident = result.incident;
    result = reviewPublicHealthIncidentEvidence(nextState, result.evidence.id, {
      action: "accept-evidence",
      expectedEvidenceRevision: 1,
      expectedIncidentRevision: incident.revision,
      note: "independent evidence review accepted"
    }, reviewer, { now: `2026-07-30T08:${String(32 + index * 2).padStart(2, "0")}:00.000Z` });
    nextState = result.state;
    incident = result.incident;
  }
  return { state: nextState, incident };
}

test("migrated public health coordination keeps eight lanes and a closed production gate", () => {
  const state = seedPublicHealthCoordination();
  const normalized = normalizePublicHealthCoordination({
    ...state,
    productionReady: true,
    lanes: [{ id: "infectious-reporting", probe: "失败" }]
  });
  const board = buildPublicHealthCoordinationBoard(normalized);

  assert.equal(normalized.lanes.length, 8);
  assert.equal(normalized.lanes.find((item) => item.id === "infectious-reporting").probe, "失败");
  assert.equal(normalized.productionReady, false);
  assert.equal(normalized.migrationSource.sourceCommit, "4142402e0c79fd8457c00c370b5d163e88cca0e7");
  assert.equal(board.productionBoundary.releaseGate, "site-evidence-and-approval-required");
  assert.equal(board.summary.totalLanes, 8);
});

test("incident creation validates governed lanes and rejects sensitive material", () => {
  assert.throws(
    () => createPublicHealthIncident(seedPublicHealthCoordination(), validIncident({
      id: "PHE-SECRET",
      credential: "must-not-be-persisted"
    }), creator),
    (error) => error.code === "PUBLIC_HEALTH_SENSITIVE_FIELD_REJECTED"
  );
  assert.throws(
    () => createPublicHealthIncident(seedPublicHealthCoordination(), validIncident({
      id: "PHE-LANE",
      laneId: "unknown-lane"
    }), creator),
    (error) => error.code === "PUBLIC_HEALTH_LANE_NOT_FOUND" && error.status === 404
  );

  const result = createPublicHealthIncident(
    seedPublicHealthCoordination(),
    validIncident(),
    creator,
    { now: "2026-07-30T08:00:00.000Z" }
  );

  assert.equal(result.incident.status, "待核查");
  assert.equal(result.incident.revision, 1);
  assert.equal(result.action.actorId, "u-city");
  assert.equal(result.state.incidents[0].id, "PHE-TEST-001");
  assert.equal(result.state.productionReady, false);
});

test("incident lifecycle enforces optimistic revisions and independent close review", () => {
  let state = createPublicHealthIncident(
    seedPublicHealthCoordination(),
    validIncident(),
    creator,
    { now: "2026-07-30T08:00:00.000Z" }
  ).state;

  assert.throws(
    () => advancePublicHealthIncident(state, "PHE-TEST-001", {
      action: "start-handling",
      expectedRevision: 99,
      note: "错误版本不得覆盖"
    }, creator),
    (error) => error.code === "PUBLIC_HEALTH_INCIDENT_REVISION_CONFLICT" && error.status === 409
  );

  let result = advancePublicHealthIncident(state, "PHE-TEST-001", {
    action: "start-handling",
    expectedRevision: 1,
    note: "核查确认异常并开始处置"
  }, creator, { now: "2026-07-30T08:10:00.000Z" });
  state = result.state;
  assert.equal(result.incident.status, "处置中");

  result = advancePublicHealthIncident(state, "PHE-TEST-001", {
    action: "submit-review",
    expectedRevision: 2,
    note: "补传完成并提交独立复核"
  }, creator, { now: "2026-07-30T08:20:00.000Z" });
  state = result.state;
  assert.equal(result.incident.status, "待复核");
  assert.equal(result.incident.submittedForReviewBy, "u-city");

  assert.throws(
    () => advancePublicHealthIncident(state, "PHE-TEST-001", {
      action: "verify-close",
      expectedRevision: 3,
      note: "提交人不得复核自己"
    }, creator),
    (error) => error.code === "PUBLIC_HEALTH_INDEPENDENT_REVIEW_REQUIRED"
  );

  assert.throws(
    () => advancePublicHealthIncident(state, "PHE-TEST-001", {
      action: "verify-close",
      expectedRevision: 3,
      note: "缺少证据不得关闭"
    }, reviewer),
    (error) => error.code === "PUBLIC_HEALTH_CLOSURE_EVIDENCE_REQUIRED"
  );

  const accepted = acceptRequiredEvidence(state, "PHE-TEST-001");
  state = accepted.state;
  result = advancePublicHealthIncident(state, "PHE-TEST-001", {
    action: "verify-close",
    expectedRevision: accepted.incident.revision,
    note: "卫健委独立复核通过并关闭"
  }, reviewer, { now: "2026-07-30T08:45:00.000Z" });

  assert.equal(result.incident.status, "已关闭");
  assert.equal(result.incident.revision, 12);
  assert.equal(result.incident.closedBy, "u-health");
  assert.equal(result.state.productionReady, false);
});

test("evidence submission is minimized, revision checked and independently reviewed", () => {
  const created = createPublicHealthIncident(
    seedPublicHealthCoordination(),
    validIncident({ id: "PHE-EVIDENCE-001", level: "P2" }),
    creator,
    { now: "2026-07-30T08:00:00.000Z" }
  );
  const submitted = submitPublicHealthIncidentEvidence(created.state, created.incident.id, {
    expectedRevision: 1,
    evidenceType: "business-receipt",
    referenceNo: "RECEIPT-20260730-01",
    summary: "接收端返回成功状态的最小化业务回执摘要。",
    digest: `sha256:${"a".repeat(64)}`
  }, creator, { now: "2026-07-30T08:05:00.000Z" });

  assert.equal(submitted.evidence.status, "submitted");
  assert.equal(submitted.incident.revision, 2);
  assert.equal(submitted.incident.evidenceIds.includes(submitted.evidence.id), true);
  assert.equal(submitted.closureGate.accepted, 0);
  assert.deepEqual(submitted.closureGate.missingTypes, ["business-receipt", "site-joint-test"]);

  assert.throws(
    () => reviewPublicHealthIncidentEvidence(submitted.state, submitted.evidence.id, {
      action: "accept-evidence",
      expectedEvidenceRevision: 1,
      expectedIncidentRevision: 2,
      note: "提交人不能签收自己的证据",
      attachmentUrl: "https://unapproved.example/evidence"
    }, reviewer),
    (error) => error.code === "PUBLIC_HEALTH_EVIDENCE_FIELD_INVALID"
  );

  assert.throws(
    () => reviewPublicHealthIncidentEvidence(submitted.state, submitted.evidence.id, {
      action: "accept-evidence",
      expectedEvidenceRevision: 1,
      expectedIncidentRevision: 2,
      note: "提交人不能签收自己的证据"
    }, creator),
    (error) => error.code === "PUBLIC_HEALTH_INDEPENDENT_EVIDENCE_REVIEW_REQUIRED"
  );

  const reviewed = reviewPublicHealthIncidentEvidence(submitted.state, submitted.evidence.id, {
    action: "accept-evidence",
    expectedEvidenceRevision: 1,
    expectedIncidentRevision: 2,
    note: "业务回执编号与当前事件一致"
  }, reviewer, { now: "2026-07-30T08:08:00.000Z" });
  assert.equal(reviewed.evidence.status, "accepted");
  assert.equal(reviewed.evidence.reviewedBy, "u-health");
  assert.equal(reviewed.incident.revision, 3);
  assert.equal(reviewed.closureGate.accepted, 1);
  assert.equal(reviewed.state.productionReady, false);

  assert.throws(
    () => submitPublicHealthIncidentEvidence(reviewed.state, created.incident.id, {
      expectedRevision: 3,
      evidenceType: "business-receipt",
      referenceNo: "RECEIPT-DUPLICATE",
      summary: "不得重复登记仍有效的同类证据。",
      digest: `sha256:${"b".repeat(64)}`
    }, creator),
    (error) => error.code === "PUBLIC_HEALTH_EVIDENCE_DUPLICATE"
  );
});

test("hospital authorization scopes board rows and all incident writes", () => {
  const state = seedPublicHealthCoordination();
  const board = buildPublicHealthCoordinationBoard(state, {
    authorizedHospitalCodes: ["H000003"]
  });
  assert.deepEqual(board.filters.availableHospitals, ["H000003"]);
  assert.equal(board.coordination.incidents.length, 1);
  assert.equal(board.coordination.incidents[0].hospitalCode, "H000003");
  assert.equal(board.accessScope.mode, "organization-hospital-scope");

  assert.throws(
    () => createPublicHealthIncident(state, validIncident({
      id: "PHE-OUT-OF-SCOPE",
      hospitalCode: "H000001"
    }), creator, { authorizedHospitalCodes: ["H000003"] }),
    (error) => error.code === "PUBLIC_HEALTH_HOSPITAL_SCOPE_FORBIDDEN" && error.status === 403
  );
  assert.throws(
    () => advancePublicHealthIncident(state, "PHE-20260728-003", {
      action: "start-handling",
      expectedRevision: 1,
      note: "越权事件不得推进"
    }, creator, { authorizedHospitalCodes: ["H000003"] }),
    (error) => error.code === "PUBLIC_HEALTH_INCIDENT_NOT_FOUND" && error.status === 404
  );

  const closed = state.incidents.find((item) => item.id === "PHE-20260727-004");
  assert.equal(buildPublicHealthIncidentClosureGate(closed, state.incidentEvidence).ready, true);
});

test("terminal incidents and invalid transition actions fail closed", () => {
  const state = seedPublicHealthCoordination();
  const pending = state.incidents.find((item) => item.status === "待核查");
  const closed = state.incidents.find((item) => item.status === "已关闭");

  assert.throws(
    () => advancePublicHealthIncident(state, pending.id, {
      action: "verify-close",
      expectedRevision: pending.revision,
      note: "不得跳过处置阶段"
    }, reviewer),
    (error) => error.code === "PUBLIC_HEALTH_INCIDENT_ACTION_INVALID"
  );
  assert.throws(
    () => advancePublicHealthIncident(state, closed.id, {
      action: "verify-close",
      expectedRevision: closed.revision,
      note: "终态不得重复关闭"
    }, reviewer),
    (error) => error.code === "PUBLIC_HEALTH_INCIDENT_TERMINAL"
  );
});

test("operations board filters hospitals and resolves safe professional summaries", () => {
  const state = seedPublicHealthCoordination();
  const board = buildPublicHealthCoordinationBoard(state, {
    now: "2026-07-29T08:00:00.000Z",
    filters: { hospitalCode: "H000001", overdueOnly: "true" },
    professionalContext: {
      events: [{ id: "phe-infectious-001", domain: "传染病防控", status: "待疾控复核", level: "P0" }],
      exchangeTasks: [{ id: "phx-national-direct-report", name: "国家直报交换", status: "演示契约就绪" }],
      exchangeRuns: [{
        id: "phxr-direct-report-001",
        taskId: "phx-national-direct-report",
        status: "receipt-confirmed",
        receiptStatus: "accepted"
      }],
      evidencePackets: [{
        id: "phcep-direct-report-endpoint",
        status: "evidence-recorded",
        requiredItems: [{ id: "e1", status: "verified" }, { id: "e2", status: "pending" }]
      }],
      evidenceBridgeLinks: [{ id: "bridge-1", packetId: "phcep-direct-report-endpoint", status: "verified" }],
      endpointProbeEntries: [{
        laneId: "infectious-reporting",
        connectivityVerified: true,
        issuedAt: "2026-07-29T07:55:00.000Z",
        latencyMs: 85,
        mutualTlsVerified: true
      }]
    }
  });

  assert.equal(board.summary.filteredIncidents, 1);
  assert.equal(board.summary.overdueIncidents, 1);
  assert.equal(board.statistics.byHospital.H000001, 1);
  assert.equal(board.coordination.incidents[0].id, "PHE-20260728-003");
  assert.equal(board.coordination.incidents[0].sla.status, "overdue");
  assert.equal(board.coordination.incidents[0].professionalAssociation.event.id, "phe-infectious-001");
  assert.equal(board.coordination.incidents[0].professionalAssociation.exchange.receiptStatus, "accepted");
  assert.equal(board.coordination.incidents[0].professionalAssociation.endpointProbe.connectivityVerified, true);
  assert.equal(board.coordination.incidents[0].professionalAssociation.evidence.verifiedItems, 1);
  assert.equal(board.coordination.incidents[0].professionalAssociation.integrity.status, "resolved");
  assert.doesNotMatch(JSON.stringify(board), /secret|password|token|signature|nonce|credential|privateKey/i);

  const csv = renderPublicHealthIncidentCsv(board);
  assert.match(csv, /事件编号/);
  assert.match(csv, /PHE-20260728-003/);
  assert.match(csv, /phe-infectious-001/);
});

test("overdue escalation is revision-checked, audited and separate from lifecycle status", () => {
  const state = seedPublicHealthCoordination();
  const result = escalatePublicHealthIncident(state, "PHE-20260728-003", {
    action: "escalate-overdue",
    expectedRevision: 1,
    note: "P0事件已超时，升级至总指挥协调"
  }, creator, { now: "2026-07-29T08:00:00.000Z" });

  assert.equal(result.incident.status, "待核查");
  assert.equal(result.incident.revision, 2);
  assert.equal(result.incident.escalation.status, "已升级");
  assert.equal(result.incident.escalation.level, "red");
  assert.equal(result.action.action, "escalate-overdue");
  assert.equal(result.state.productionReady, false);

  assert.throws(
    () => escalatePublicHealthIncident(result.state, result.incident.id, {
      action: "escalate-overdue",
      expectedRevision: 2,
      note: "不得重复升级"
    }, reviewer, { now: "2026-07-29T08:10:00.000Z" }),
    (error) => error.code === "PUBLIC_HEALTH_INCIDENT_ALREADY_ESCALATED"
  );

  const future = createPublicHealthIncident(state, validIncident({
    id: "PHE-FUTURE",
    dueAt: "2026-07-30T12:00:00.000Z"
  }), creator, { now: "2026-07-29T08:00:00.000Z" }).state;
  assert.throws(
    () => escalatePublicHealthIncident(future, "PHE-FUTURE", {
      action: "escalate-overdue",
      expectedRevision: 1,
      note: "未超时不得升级"
    }, creator, { now: "2026-07-29T09:00:00.000Z" }),
    (error) => error.code === "PUBLIC_HEALTH_INCIDENT_NOT_OVERDUE"
  );
});
