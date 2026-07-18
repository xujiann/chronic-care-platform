const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DIGITAL_HOSPITAL_SIX_DOMAINS,
  buildDigitalHospitalControlMatrixBoard,
  buildDigitalHospitalPolicyRegisterBoard,
  normalizeDigitalHospitalControlAction,
  normalizeDigitalHospitalPolicyReview,
  seedDigitalHospitalControlMatrix,
  seedDigitalHospitalPolicyRegister
} = require("../digital-hospital-governance");

test("digital hospital policy register covers six domains and separates historical planning", () => {
  const policies = seedDigitalHospitalPolicyRegister();
  const controls = seedDigitalHospitalControlMatrix();
  const board = buildDigitalHospitalPolicyRegisterBoard({
    digitalHospitalPolicyRegister: policies,
    digitalHospitalControlMatrix: controls
  });

  assert.equal(board.ok, true);
  assert.equal(board.summary.domains, 6);
  assert.ok(board.summary.policies >= 18);
  assert.ok(board.summary.mandatoryPolicies >= 4);
  assert.ok(board.summary.controls >= 12);
  assert.ok(board.summary.blockingControls >= 4);
  DIGITAL_HOSPITAL_SIX_DOMAINS.forEach((domain) => {
    assert.equal(policies.some((item) => item.domains.includes(domain)), true, domain);
    assert.equal(controls.some((item) => item.domain === domain), true, domain);
  });

  const historical = policies.find((item) => item.id === "dhp-health-information-plan-14fyp");
  assert.equal(historical.lifecycleStatus, "historical-plan");
  assert.equal(historical.reviewStatus, "historical-only");
  assert.match(historical.applicability, /不直接作为2026年度硬性上线任务/);

  const currentCybersecurityLaw = policies.find((item) => item.id === "dhp-cybersecurity-law-2025");
  assert.equal(currentCybersecurityLaw.effectiveAt, "2026-01-01");
  assert.equal(currentCybersecurityLaw.bindingLevel, "mandatory");
});

test("digital hospital policy register applies domain, lifecycle and query filters", () => {
  const data = {
    digitalHospitalPolicyRegister: seedDigitalHospitalPolicyRegister(),
    digitalHospitalControlMatrix: seedDigitalHospitalControlMatrix()
  };
  const securityBoard = buildDigitalHospitalPolicyRegisterBoard(data, {
    domain: "安全合规",
    bindingLevel: "mandatory"
  });
  assert.ok(securityBoard.policies.length >= 4);
  assert.equal(securityBoard.policies.every((item) => item.domains.includes("安全合规") && item.bindingLevel === "mandatory"), true);

  const historicalBoard = buildDigitalHospitalPolicyRegisterBoard(data, {
    lifecycleStatus: "historical-plan"
  });
  assert.equal(historicalBoard.policies.length, 1);
  assert.equal(historicalBoard.policies[0].id, "dhp-health-information-plan-14fyp");

  const aiBoard = buildDigitalHospitalPolicyRegisterBoard(data, { query: "模型备案" });
  assert.equal(aiBoard.policies.some((item) => item.id === "dhp-ai-healthcare-opinion-2025"), true);
});

test("digital hospital policy review requires evidence note and next review date", () => {
  const policy = seedDigitalHospitalPolicyRegister().find((item) => item.id === "dhp-wst-846-847-2024");
  assert.throws(() => normalizeDigitalHospitalPolicyReview(policy, {
    reviewStatus: "verified-current",
    reviewNote: "ok",
    nextReviewAt: "2027-01-31"
  }), /at least 4 characters/);
  assert.throws(() => normalizeDigitalHospitalPolicyReview(policy, {
    reviewStatus: "verified-current",
    reviewNote: "官方来源已核验",
    nextReviewAt: ""
  }), /YYYY-MM-DD/);

  const result = normalizeDigitalHospitalPolicyReview(policy, {
    action: "review-policy",
    reviewStatus: "local-supplement-required",
    reviewNote: "国家标准已核验，等待属地接口要求",
    nextReviewAt: "2026-10-31"
  }, {
    name: "省级标准管理员",
    role: "commission"
  });
  assert.equal(result.policy.reviewStatus, "local-supplement-required");
  assert.equal(result.policy.nextReviewAt, "2026-10-31");
  assert.equal(result.policy.reviewHistory.length, 1);
  assert.equal(result.action.reviewedBy, "省级标准管理员");
});

test("digital hospital control board exposes blockers, evidence and overdue remediation filters", () => {
  const controls = seedDigitalHospitalControlMatrix();
  const interoperability = controls.find((item) => item.id === "dhc-interoperability-contract");
  interoperability.controlStatus = "in-progress";
  interoperability.assignedTo = "接口联调负责人";
  interoperability.dueAt = "2026-07-01";
  const board = buildDigitalHospitalControlMatrixBoard({ digitalHospitalControlMatrix: controls }, {
    asOf: "2026-07-16T08:00:00.000Z"
  });

  assert.equal(board.ok, true);
  assert.equal(board.summary.controls, 13);
  assert.equal(board.summary.goLiveCriticalControls >= 8, true);
  assert.equal(board.summary.blockingControls >= 4, true);
  assert.equal(board.summary.overdueControls, 1);
  assert.equal(board.checks.every((item) => item.passed), true);

  const filtered = buildDigitalHospitalControlMatrixBoard({ digitalHospitalControlMatrix: controls }, {
    domain: "互联互通",
    blockingOnly: true,
    overdueOnly: true,
    asOf: "2026-07-16T08:00:00.000Z"
  });
  assert.equal(filtered.controls.length, 1);
  assert.equal(filtered.controls[0].id, "dhc-interoperability-contract");
});

test("digital hospital control remediation requires minimized evidence and independent verification", () => {
  const original = seedDigitalHospitalControlMatrix().find((item) => item.id === "dhc-interoperability-contract");
  const operator = { username: "health", name: "标准整改管理员", role: "commission" };
  const reviewer = { username: "city", name: "市级独立复核员", role: "commission" };

  const assigned = normalizeDigitalHospitalControlAction(original, {
    action: "assign-control",
    assignedTo: "接口联调专班",
    dueAt: "2026-08-15",
    note: "分派生产接口联合验证"
  }, operator, { now: "2026-07-16T08:00:00.000Z" });
  assert.equal(assigned.control.controlStatus, "in-progress");
  assert.equal(assigned.control.assignedTo, "接口联调专班");

  assert.throws(() => normalizeDigitalHospitalControlAction(assigned.control, {
    action: "record-evidence",
    artifactName: "生产接口联调报告",
    evidenceRef: "DH-INT-2026-001",
    evidenceLevel: "site",
    noPatientPii: false,
    note: "登记接口联调证据"
  }, operator), /noPatientPii=true/);

  const recorded = normalizeDigitalHospitalControlAction(assigned.control, {
    action: "record-evidence",
    artifactName: "生产接口联调报告",
    evidenceRef: "DH-INT-2026-001",
    evidenceLevel: "site",
    noPatientPii: true,
    note: "登记接口联调最小化证据"
  }, operator, { now: "2026-07-16T09:00:00.000Z" });
  assert.equal(recorded.control.controlStatus, "evidence-recorded");
  assert.equal(recorded.control.evidenceCount, 1);
  assert.equal(recorded.control.latestEvidence.noPatientPii, true);

  assert.throws(() => normalizeDigitalHospitalControlAction(recorded.control, {
    action: "verify-control",
    decision: "accepted",
    note: "同一提交人尝试复核证据"
  }, operator), /independent reviewer/);

  const verified = normalizeDigitalHospitalControlAction(recorded.control, {
    action: "verify-control",
    decision: "accepted",
    note: "现场接口证据复核通过"
  }, reviewer, { now: "2026-07-16T10:00:00.000Z" });
  assert.equal(verified.control.controlStatus, "verified");
  assert.equal(verified.control.blocking, false);
  assert.equal(verified.control.verifiedEvidenceCount, 1);
  assert.equal(verified.control.evidenceRecords[0].verifiedById, "city");

  const reopened = normalizeDigitalHospitalControlAction(verified.control, {
    action: "reopen-control",
    note: "接口版本变更后重新开展验证"
  }, operator, { now: "2026-08-01T08:00:00.000Z" });
  assert.equal(reopened.control.controlStatus, "in-progress");
  assert.equal(reopened.control.blocking, true);
});

test("digital hospital conditional controls can be marked not applicable only when the feature is disabled", () => {
  const controls = seedDigitalHospitalControlMatrix();
  const aiControl = controls.find((item) => item.id === "dhc-ai-governance");
  const alwaysControl = controls.find((item) => item.id === "dhc-sensitive-data");
  const user = { username: "health", name: "标准管理员", role: "commission" };

  assert.throws(() => normalizeDigitalHospitalControlAction(alwaysControl, {
    action: "mark-not-applicable",
    featureDisabled: true,
    decisionRef: "DH-NA-001",
    note: "尝试跳过强制适用控制"
  }, user), /always-applicable/);
  assert.throws(() => normalizeDigitalHospitalControlAction(aiControl, {
    action: "mark-not-applicable",
    featureDisabled: false,
    decisionRef: "DH-NA-002",
    note: "功能启用状态未确认"
  }, user), /featureDisabled=true/);

  const result = normalizeDigitalHospitalControlAction(aiControl, {
    action: "mark-not-applicable",
    featureDisabled: true,
    decisionRef: "DH-NA-003",
    note: "试点范围未启用临床人工智能"
  }, user, { now: "2026-07-16T08:00:00.000Z" });
  assert.equal(result.control.controlStatus, "not-applicable");
  assert.equal(result.control.blocking, false);
  assert.equal(result.control.applicabilityDecisionRef, "DH-NA-003");
});
