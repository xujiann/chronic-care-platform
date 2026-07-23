const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DIGITAL_HOSPITAL_SIX_DOMAINS,
  buildDigitalHospitalControlMatrixBoard,
  buildDigitalHospitalPolicyRegisterBoard,
  normalizeDigitalHospitalControlAction,
  normalizeDigitalHospitalPolicyChangeAction,
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

test("digital hospital policy change reopens affected controls and requires fresh evidence before activation", () => {
  const policy = {
    ...seedDigitalHospitalPolicyRegister().find((item) => item.id === "dhp-wst-846-847-2024"),
    reviewStatus: "requires-update"
  };
  const originalControls = seedDigitalHospitalControlMatrix();
  const controls = originalControls.map((item) => item.id === "dhc-interoperability-contract" ? {
    ...item,
    implementationState: "implemented",
    controlStatus: "verified",
    verifiedAt: "2026-07-01T08:00:00.000Z",
    evidenceRecords: [{
      id: "dhce-old-interface",
      artifactName: "旧版接口联调报告",
      evidenceRef: "DH-INT-OLD-001",
      evidenceLevel: "site",
      noPatientPii: true,
      submittedAt: "2026-07-01T07:00:00.000Z",
      submittedBy: "旧版实施人员",
      submittedById: "old-operator",
      verificationStatus: "accepted",
      verifiedAt: "2026-07-01T08:00:00.000Z",
      verifiedBy: "旧版复核人员",
      verifiedById: "old-reviewer"
    }]
  } : item);
  const assessor = { username: "health", name: "标准变更评估员", role: "commission" };
  const operator = { username: "hospital", name: "接口整改人员", role: "institution" };
  const reviewer = { username: "city", name: "市级独立复核员", role: "commission" };

  const assessed = normalizeDigitalHospitalPolicyChangeAction(policy, controls, {
    action: "assess-change",
    successorTitle: "医院信息平台交互标准（2026年版）",
    successorDocumentNo: "WS/T 846—2026",
    successorSourceUrl: "https://www.nhc.gov.cn/wjw/s9497/202608/interoperability-2026.shtml",
    successorPublishedAt: "2026-08-01",
    successorEffectiveAt: "2027-01-01",
    migrationDueAt: "2026-12-15",
    impactLevel: "high",
    affectedControlIds: ["dhc-interoperability-contract"],
    changeSummary: "接口契约、签名算法和验收证据要求发生变化",
    note: "完成新旧版本条款差异与控制影响评估"
  }, assessor, { now: "2026-08-02T08:00:00.000Z" });
  const impacted = assessed.controls.find((item) => item.id === "dhc-interoperability-contract");
  assert.equal(assessed.policy.pendingChange.status, "impact-assessed");
  assert.equal(impacted.controlStatus, "in-progress");
  assert.equal(impacted.blocking, true);
  assert.equal(impacted.evidenceRecords[0].verificationStatus, "superseded");
  assert.equal(impacted.changeImpact.status, "revalidation-required");
  assert.equal(buildDigitalHospitalPolicyRegisterBoard({
    digitalHospitalPolicyRegister: [assessed.policy],
    digitalHospitalControlMatrix: assessed.controls
  }).summary.pendingPolicyChanges, 1);

  assert.throws(() => normalizeDigitalHospitalPolicyChangeAction(assessed.policy, assessed.controls, {
    action: "activate-successor",
    nextReviewAt: "2027-07-31",
    note: "尝试在控制重验前启用后继版本"
  }, reviewer, { now: "2026-08-02T09:00:00.000Z" }), /fresh accepted evidence/);

  const recorded = normalizeDigitalHospitalControlAction(impacted, {
    action: "record-evidence",
    artifactName: "新版接口生产联调报告",
    evidenceRef: "DH-INT-NEW-001",
    evidenceLevel: "site",
    noPatientPii: true,
    note: "登记新版接口现场重验证据"
  }, operator, { now: "2026-08-03T08:00:00.000Z" });
  const verified = normalizeDigitalHospitalControlAction(recorded.control, {
    action: "verify-control",
    decision: "accepted",
    note: "新版接口现场证据独立复核通过"
  }, reviewer, { now: "2026-08-03T09:00:00.000Z" });
  const revalidatedControls = assessed.controls.map((item) => item.id === verified.control.id ? verified.control : item);

  assert.throws(() => normalizeDigitalHospitalPolicyChangeAction(assessed.policy, revalidatedControls, {
    action: "activate-successor",
    nextReviewAt: "2027-07-31",
    note: "评估人员不得自行启用后继版本"
  }, assessor, { now: "2026-08-03T10:00:00.000Z" }), /independent reviewer/);

  const activated = normalizeDigitalHospitalPolicyChangeAction(assessed.policy, revalidatedControls, {
    action: "activate-successor",
    nextReviewAt: "2027-07-31",
    note: "控制重验完成，同意启用后继版本"
  }, reviewer, { now: "2026-08-03T10:00:00.000Z" });
  const activatedControl = activated.controls.find((item) => item.id === "dhc-interoperability-contract");
  assert.equal(activated.policy.documentNo, "WS/T 846—2026");
  assert.equal(activated.policy.pendingChange.status, "activated");
  assert.equal(activated.policy.versionHistory[0].documentNo, policy.documentNo);
  assert.equal(activated.policy.nextReviewAt, "2027-07-31");
  assert.equal(activatedControl.controlStatus, "verified");
  assert.equal(activatedControl.changeImpact.status, "revalidated");
});
