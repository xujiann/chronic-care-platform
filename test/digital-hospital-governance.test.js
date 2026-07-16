const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DIGITAL_HOSPITAL_SIX_DOMAINS,
  buildDigitalHospitalPolicyRegisterBoard,
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
