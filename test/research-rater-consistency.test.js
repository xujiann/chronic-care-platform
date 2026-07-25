const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  applyRaterConsistencyBatchAction,
  buildRaterConsistencyCenter,
  calculateFleissKappa,
  calculateICCA1,
  createRaterConsistencyBatch,
  recordRaterSubmission,
  renderRaterConsistencyMarkdown,
  synchronizeRaterConsistencyAcceptance
} = require("../research-rater-consistency");
const { metricMeetsTarget, seedResearchProjectAcceptanceItems } = require("../research-project-acceptance");

const ROOT = path.resolve(__dirname, "..");
const hospital = { id: "hospital-pmo", name: "医院项目办", role: "institution", orgCode: "ORG-HOSPITAL-A" };
const reviewer = { id: "commission-reviewer", name: "独立复核员", role: "commission", orgCode: "ORG-HEALTH" };

function categoricalBatch() {
  return createRaterConsistencyBatch([], {
    batchNumber: 1,
    name: "试点评价分类一致性",
    method: "fleiss-kappa",
    expectedRaters: 2,
    caseCodes: ["CASE-001", "CASE-002", "CASE-003"],
    categories: ["通过", "不通过"]
  }, hospital, new Date("2027-04-01T08:00:00.000Z"));
}

function verifiedCategoricalBatch(secondRatings = ["通过", "不通过", "通过"]) {
  let batches = categoricalBatch();
  batches = recordRaterSubmission(batches, batches[0].id, {
    raterCode: "RATER-001",
    ratings: ["通过", "不通过", "通过"],
    noRaterPii: true
  }, hospital, new Date("2027-04-02T08:00:00.000Z")).batches;
  batches = recordRaterSubmission(batches, batches[0].id, {
    raterCode: "RATER-002",
    ratings: secondRatings,
    noRaterPii: true
  }, hospital, new Date("2027-04-03T08:00:00.000Z")).batches;
  batches = applyRaterConsistencyBatchAction(batches, batches[0].id, {
    action: "finalize-batch",
    note: "两名评价者均完成独立判定。"
  }, hospital, new Date("2027-04-04T08:00:00.000Z"));
  return applyRaterConsistencyBatchAction(batches, batches[0].id, {
    action: "verify-batch",
    note: "核对案例范围、评价者独立性和统计输出后通过。"
  }, reviewer, new Date("2027-04-05T08:00:00.000Z"));
}

test("Fleiss Kappa handles perfect and systematic disagreement", () => {
  const perfect = calculateFleissKappa([
    ["通过", "通过"],
    ["不通过", "不通过"],
    ["通过", "通过"]
  ]);
  assert.equal(perfect.coefficient, 1);
  assert.equal(perfect.observedAgreement, 1);
  const disagreement = calculateFleissKappa([
    ["通过", "不通过"],
    ["通过", "不通过"],
    ["通过", "不通过"]
  ]);
  assert.equal(disagreement.coefficient, -1);
  assert.equal(disagreement.observedAgreement, 0);
  assert.throws(
    () => calculateFleissKappa([["通过", "通过"], ["通过", "通过"]]),
    /undefined when only one category/
  );
});

test("ICC(A,1) returns perfect agreement for identical continuous ratings", () => {
  const result = calculateICCA1([
    [10, 10, 10],
    [20, 20, 20],
    [30, 30, 30]
  ]);
  assert.equal(result.coefficient, 1);
  assert.equal(result.cases, 3);
  assert.equal(result.raters, 3);
  assert.throws(() => calculateICCA1([[1], [2]]), /two raters/);
  assert.throws(
    () => calculateICCA1([[10, 10], [10, 10]]),
    /undefined when score variance is zero/
  );
});

test("case and rater identifiers are hashed and rating collection is complete", () => {
  let batches = categoricalBatch();
  assert.equal(JSON.stringify(batches).includes("CASE-001"), false);
  assert.equal(batches[0].cases.every((item) => item.caseKeyHash.length === 64), true);
  assert.throws(() => recordRaterSubmission(batches, batches[0].id, {
    raterCode: "RATER-001",
    ratings: ["通过", "不通过", "通过"],
    noRaterPii: false
  }, hospital), /noRaterPii/);
  const recorded = recordRaterSubmission(batches, batches[0].id, {
    raterCode: "RATER-001",
    ratings: ["通过", "不通过", "通过"],
    noRaterPii: true
  }, hospital);
  batches = recorded.batches;
  assert.equal(recorded.submission.raterKeyHash.length, 64);
  assert.equal(JSON.stringify(recorded.submission).includes("RATER-001"), false);
  assert.throws(() => applyRaterConsistencyBatchAction(batches, batches[0].id, {
    action: "finalize-batch",
    note: "评价者尚未全部提交"
  }, hospital), /all expected/);
});

test("institution cannot mutate another institution consistency batch", () => {
  const batches = categoricalBatch();
  const other = { id: "hospital-b", name: "另一医院", role: "institution", orgCode: "ORG-HOSPITAL-B" };
  assert.throws(() => recordRaterSubmission(batches, batches[0].id, {
    raterCode: "RATER-CROSS",
    ratings: ["通过", "通过", "通过"],
    noRaterPii: true
  }, other), /another institution/);
});

test("verified batch populates the Kappa or ICC acceptance metric", () => {
  const batches = verifiedCategoricalBatch();
  const data = {
    researchRaterConsistencyBatches: batches,
    researchProjectAcceptanceItems: seedResearchProjectAcceptanceItems()
  };
  data.researchProjectAcceptanceItems = synchronizeRaterConsistencyAcceptance(data, new Date("2027-04-06T08:00:00.000Z"));
  const item = data.researchProjectAcceptanceItems.find((entry) => entry.id === "metric-rater-consistency");
  assert.equal(item.measuredValue, 1);
  assert.equal(item.status, "evidence-recorded");
  assert.equal(item.recordedBy, "rater-consistency-calculation");
  assert.equal(metricMeetsTarget(item), true);
  assert.equal(item.sha256.length, 64);
  const center = buildRaterConsistencyCenter(data);
  assert.equal(center.aggregate.minimumCoefficient, 1);
  assert.equal(center.acceptanceMetricBridge.meetsTarget, true);
});

test("below-target agreement remains recorded without claiming acceptance", () => {
  const batches = verifiedCategoricalBatch(["不通过", "通过", "不通过"]);
  const data = { researchRaterConsistencyBatches: batches, researchProjectAcceptanceItems: seedResearchProjectAcceptanceItems() };
  data.researchProjectAcceptanceItems = synchronizeRaterConsistencyAcceptance(data);
  const item = data.researchProjectAcceptanceItems.find((entry) => entry.id === "metric-rater-consistency");
  assert.equal(item.measuredValue, -1);
  assert.equal(item.status, "evidence-recorded");
  assert.equal(metricMeetsTarget(item), false);
});

test("independent review and revocation invalidate automatic acceptance evidence", () => {
  let batches = categoricalBatch();
  for (const [raterCode, ratings] of [["R1", ["通过", "不通过", "通过"]], ["R2", ["通过", "不通过", "通过"]]]) {
    batches = recordRaterSubmission(batches, batches[0].id, { raterCode, ratings, noRaterPii: true }, hospital).batches;
  }
  batches = applyRaterConsistencyBatchAction(batches, batches[0].id, { action: "finalize-batch", note: "锁定评分" }, hospital);
  assert.throws(() => applyRaterConsistencyBatchAction(batches, batches[0].id, { action: "verify-batch", note: "创建人不得自审" }, { ...hospital, role: "commission" }), /independent reviewer/);
  batches = applyRaterConsistencyBatchAction(batches, batches[0].id, { action: "verify-batch", note: "独立复核" }, reviewer);
  let items = synchronizeRaterConsistencyAcceptance({ researchRaterConsistencyBatches: batches, researchProjectAcceptanceItems: seedResearchProjectAcceptanceItems() });
  const accepted = items.find((item) => item.id === "metric-rater-consistency");
  accepted.status = "verified";
  batches = applyRaterConsistencyBatchAction(batches, batches[0].id, { action: "revoke-batch-verification", note: "案例范围变化，撤销复核" }, reviewer);
  items = synchronizeRaterConsistencyAcceptance({ researchRaterConsistencyBatches: batches, researchProjectAcceptanceItems: items });
  const invalidated = items.find((item) => item.id === "metric-rater-consistency");
  assert.equal(invalidated.status, "returned");
  assert.equal(invalidated.measuredValue, null);
  assert.equal(invalidated.evidenceRef, "");
});

test("continuous batch calculates ICC and report preserves the data boundary", () => {
  let batches = createRaterConsistencyBatch([], {
    batchNumber: 2,
    name: "连续评分一致性",
    method: "icc-a1",
    expectedRaters: 2,
    caseCodes: ["SCORE-01", "SCORE-02", "SCORE-03"],
    scoreMin: 0,
    scoreMax: 100
  }, hospital);
  batches = recordRaterSubmission(batches, batches[0].id, { raterCode: "ICC-R1", ratings: [20, 50, 80], noRaterPii: true }, hospital).batches;
  batches = recordRaterSubmission(batches, batches[0].id, { raterCode: "ICC-R2", ratings: [20, 50, 80], noRaterPii: true }, hospital).batches;
  const center = buildRaterConsistencyCenter({ researchRaterConsistencyBatches: batches });
  assert.equal(center.batches[0].statistics.coefficient, 1);
  assert.match(center.boundary, /不保存患者信息/);
  assert.match(renderRaterConsistencyMarkdown(center), /ICC\(A,1\)/);
  const server = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "research-project-acceptance.html"), "utf8");
  const ui = fs.readFileSync(path.join(ROOT, "research-rater-consistency-ui.js"), "utf8");
  assert.match(server, /research-project\/rater-consistency|researchRaterConsistencyBatches/);
  assert.match(html, /id="research-rater-consistency-panel"/);
  assert.match(html, /research-rater-consistency-ui\.js/);
  assert.match(ui, /noRaterPii/);
  assert.match(ui, /rater-consistency\/batches/);
});
