const test = require("node:test");
const assert = require("node:assert/strict");
const Highlights = require("../physical-examination-highlights");
const Service = require("../physical-examination-service");

function demoState() {
  const reports = Service.seedRecords();
  return {
    accounts: [{ id: "a1", name: "家庭账户", members: [{ residentId: "r1", relation: "本人" }, { residentId: "r4", relation: "母亲" }] }],
    residents: [
      { id: "r1", name: "居民A", birthDate: "1968-02-11", metrics: { systolic: 156, glucose: 6.8, bmi: 29.4 } },
      { id: "r2", name: "居民B", birthDate: "1975-05-20", metrics: { systolic: 138, glucose: 7.8, bmi: 25.1 } },
      { id: "r3", name: "居民C", birthDate: "1988-11-09", metrics: { systolic: 126, glucose: 5.5, bmi: 24.2 } },
      { id: "r4", name: "居民D", birthDate: "1964-10-01", metrics: { systolic: 148, glucose: 6.3, bmi: 28.6 } }
    ],
    diseases: [{ id: "d1", residentId: "r1", type: "高血压" }, { id: "d4", residentId: "r4", type: "高血压" }],
    personalRecords: reports,
    physicalExamAbnormalCases: Service.seedAbnormalCases(),
    physicalExamHealthPassports: [],
    physicalExamReviewRequests: [],
    physicalExamFamilyRiskConsents: [],
    physicalExamHighlightActions: []
  };
}

test("体检亮点引擎一次生成居民、机构和管理端全部产品能力", () => {
  const state = demoState();
  const reports = state.personalRecords;
  const highlights = Highlights.build(state, reports, state.physicalExamAbnormalCases, { minimumAggregate: 3 });
  assert.equal(highlights.version, "physical-exam-highlights-v1");
  assert.equal(highlights.trajectories.some((item) => item.residentId === "r1" && item.code === "SBP" && item.points.length === 2), true);
  assert.equal(highlights.translations.some((item) => item.code === "BP" && /不能单独代替/.test(item.plainMeaning)), true);
  assert.equal(highlights.actionCards.some((item) => item.residentId === "r1" && item.appointmentHref.includes("registration")), true);
  assert.equal(highlights.examPlans.some((item) => item.residentId === "r1" && item.personalizedItems.includes("血压复测")), true);
  assert.equal(highlights.radiationLedger.some((item) => item.modality === "DR" && item.governanceStatus === "complete"), true);
  assert.equal(highlights.criticalPaths.every((item) => item.steps.length === 5), true);
  assert.equal(highlights.familyRiskMaps[0].members.some((item) => item.residentId === "r4" && item.authorized === false), true);
  assert.equal(highlights.achievements.some((item) => item.residentId === "r1" && item.title === "连续健康观察" && item.achieved), true);
  assert.equal(highlights.simulations.some((item) => item.scenarios.length === 4 && /不预测/.test(item.boundary)), true);
  assert.equal(highlights.qualityReviews.length, reports.length);
  assert.equal(highlights.institutionBenchmarks.every((item) => item.boundary.includes("小样本不排名")), true);
  assert.equal(highlights.cityRadar.every((item) => ["aggregate-visible", "suppressed-small-cell"].includes(item.privacyStatus)), true);
  assert.equal(highlights.standardsImpact.length > 0, true);
});

test("重复检查管家识别30天内同项目并坚持医师复核", () => {
  const state = demoState();
  const original = state.personalRecords.find((item) => item.id === "physical-exam-r1-2026-center");
  const duplicate = JSON.parse(JSON.stringify(original));
  duplicate.id = "physical-exam-r1-2026-repeat";
  duplicate.date = "2026-05-28";
  duplicate.meta.externalId = "REPEAT-R1-2026";
  state.personalRecords.push(duplicate);
  const highlights = Highlights.build(state, state.personalRecords, state.physicalExamAbnormalCases);
  assert.equal(highlights.repeatAvoidance.some((item) => item.code === "BP" && item.intervalDays === 10 && item.decision === "physician-review-required"), true);
});

test("健康护照、复查申请、家庭授权和行动确认均可审计且幂等", () => {
  const state = demoState();
  const context = { actor: "citizen", now: "2026-07-17T08:00:00.000Z", canAccessResident: (id) => id === "r1" };
  const passport = Highlights.applyAction(state, { action: "create-passport", residentId: "r1", scopes: ["reports", "trends", "invalid"], expiresInDays: 7 }, context);
  assert.deepEqual(passport.item.scopes, ["reports", "trends"]);
  assert.equal(passport.item.expiresAt, "2026-07-24");
  const reportId = "physical-exam-r1-2026-center";
  const review = Highlights.applyAction(state, { action: "request-review", residentId: "r1", reportId, department: "心内科" }, context);
  const replay = Highlights.applyAction(state, { action: "request-review", residentId: "r1", reportId, department: "心内科" }, context);
  assert.equal(review.item.id, replay.item.id);
  assert.equal(replay.duplicate, true);
  const consent = Highlights.applyAction(state, { action: "authorize-family-map", residentId: "r1", accountId: "a1" }, context);
  assert.equal(consent.item.scope.includes("risk-signals-only"), true);
  const acknowledged = Highlights.applyAction(state, { action: "acknowledge-action", residentId: "r1", actionCardId: `action-${reportId}` }, context);
  assert.equal(acknowledged.item.status, "resident-acknowledged");
  const revoked = Highlights.applyAction(state, { action: "revoke-passport", residentId: "r1", passportId: passport.item.id }, context);
  assert.equal(revoked.item.status, "revoked");
  assert.throws(() => Highlights.applyAction(state, { action: "create-passport", residentId: "r2", scopes: ["reports"] }, context), /无权/);
});
