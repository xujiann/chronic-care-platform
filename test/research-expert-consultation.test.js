const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  applyExpertConsultationRoundAction,
  buildExpertConsultationCenter,
  calculateAHP,
  createExpertConsultationRound,
  judgmentMatrix,
  recordExpertConsultationResponse,
  renderExpertConsultationMarkdown,
  synchronizeAcceptanceMetrics
} = require("../research-expert-consultation");
const { metricMeetsTarget, seedResearchProjectAcceptanceItems } = require("../research-project-acceptance");

const ROOT = path.resolve(__dirname, "..");
const hospital = { id: "hospital-pmo", name: "医院项目办", role: "institution" };
const recorder = { id: "commission-secretary", name: "咨询秘书", role: "commission" };
const reviewer = { id: "commission-reviewer", name: "独立复核员", role: "commission" };

function responsePayload(expertCode, ratings = 4, judgments = {}) {
  return {
    expertCode,
    noExpertPii: true,
    relevanceRatings: {
      "governance-standard": ratings,
      "medical-service": ratings,
      "quality-safety": ratings,
      "public-health": ratings,
      "operation-efficiency": ratings,
      "data-security": ratings
    },
    ahpJudgments: {
      standardVsOutcomes: 2,
      standardVsSecurity: 4,
      outcomesVsSecurity: 2,
      ...judgments
    }
  };
}

function verifiedRound(rounds, roundNumber, startDay) {
  const at = (day) => new Date(`2026-10-${String(day).padStart(2, "0")}T08:00:00.000Z`);
  let result = createExpertConsultationRound(rounds, {
    roundNumber,
    name: `第${roundNumber}轮专家咨询`,
    invitedExperts: 2
  }, hospital, at(startDay));
  for (let index = 1; index <= 2; index += 1) {
    result = recordExpertConsultationResponse(result, `research-expert-round-${String(roundNumber).padStart(2, "0")}`, responsePayload(`ROUND-${roundNumber}-EXPERT-${index}`), recorder, at(startDay + index)).rounds;
  }
  result = applyExpertConsultationRoundAction(result, `research-expert-round-${String(roundNumber).padStart(2, "0")}`, {
    action: "finalize-round",
    note: "匿名问卷回收完成，锁定统计口径。"
  }, hospital, at(startDay + 3));
  return applyExpertConsultationRoundAction(result, `research-expert-round-${String(roundNumber).padStart(2, "0")}`, {
    action: "verify-round",
    note: "独立核对邀请名单、回收数量和计算结果后通过。"
  }, reviewer, at(startDay + 4));
}

test("AHP calculation returns normalized weights and enforces reciprocal matrices", () => {
  const result = calculateAHP(judgmentMatrix({
    standardVsOutcomes: 2,
    standardVsSecurity: 4,
    outcomesVsSecurity: 2
  }));
  assert.deepEqual(result.weights, [0.571429, 0.285714, 0.142857]);
  assert.equal(result.cr, 0);
  assert.equal(result.consistent, true);
  assert.throws(() => calculateAHP([[1, 2, 3], [0.4, 1, 2], [1 / 3, 0.5, 1]]), /reciprocal/);
});

test("expert responses are anonymized, complete and bounded by invitations", () => {
  let rounds = createExpertConsultationRound([], {
    roundNumber: 1,
    name: "第一轮指标筛选",
    invitedExperts: 1
  }, hospital, new Date("2026-10-01T08:00:00.000Z"));
  assert.throws(() => recordExpertConsultationResponse(rounds, rounds[0].id, {
    ...responsePayload("EXPERT-001"),
    noExpertPii: false
  }, recorder), /noExpertPii/);
  const recorded = recordExpertConsultationResponse(rounds, rounds[0].id, responsePayload("EXPERT-001"), recorder);
  rounds = recorded.rounds;
  assert.equal(recorded.response.expertKeyHash.length, 64);
  assert.equal(JSON.stringify(recorded.response).includes("EXPERT-001"), false);
  assert.equal(buildExpertConsultationCenter({ researchExpertConsultationRounds: rounds }).rounds[0].statistics.minimumICVI, 1);
  assert.throws(() => recordExpertConsultationResponse(rounds, rounds[0].id, responsePayload("EXPERT-001"), recorder), /cannot exceed|already exists/);
  assert.throws(() => recordExpertConsultationResponse(rounds, rounds[0].id, responsePayload("EXPERT-002"), recorder), /cannot exceed/);
});

test("round finalization requires an independent commission review", () => {
  let rounds = createExpertConsultationRound([], { roundNumber: 1, name: "第一轮咨询", invitedExperts: 2 }, hospital);
  assert.throws(() => applyExpertConsultationRoundAction(rounds, rounds[0].id, {
    action: "finalize-round",
    note: "无问卷时不得定稿"
  }, hospital), /with responses/);
  rounds = recordExpertConsultationResponse(rounds, rounds[0].id, responsePayload("EXPERT-001"), recorder).rounds;
  rounds = applyExpertConsultationRoundAction(rounds, rounds[0].id, {
    action: "finalize-round",
    note: "完成回收并定稿"
  }, hospital);
  assert.throws(() => applyExpertConsultationRoundAction(rounds, rounds[0].id, {
    action: "verify-round",
    note: "创建人不得自行复核"
  }, { ...hospital, role: "commission" }), /independent reviewer/);
  rounds = applyExpertConsultationRoundAction(rounds, rounds[0].id, {
    action: "return-round",
    note: "补充专家遴选依据"
  }, reviewer);
  assert.equal(rounds[0].status, "returned");
  rounds = applyExpertConsultationRoundAction(rounds, rounds[0].id, {
    action: "reopen-round",
    note: "补充材料后重新开放"
  }, hospital);
  assert.equal(rounds[0].status, "collecting");
});

test("institution mutation is limited to its own consultation rounds", () => {
  const owner = { ...hospital, orgCode: "ORG-HOSPITAL-A" };
  const otherInstitution = { id: "hospital-b", name: "另一试点医院", role: "institution", orgCode: "ORG-HOSPITAL-B" };
  const rounds = createExpertConsultationRound([], { roundNumber: 1, name: "机构A咨询", invitedExperts: 2 }, owner);
  assert.equal(rounds[0].ownerOrgCode, "ORG-HOSPITAL-A");
  assert.throws(() => recordExpertConsultationResponse(rounds, rounds[0].id, responsePayload("CROSS-SITE-EXPERT"), otherInstitution), /another institution/);
  const recorded = recordExpertConsultationResponse(rounds, rounds[0].id, responsePayload("OWNER-EXPERT"), owner).rounds;
  assert.throws(() => applyExpertConsultationRoundAction(recorded, recorded[0].id, {
    action: "finalize-round",
    note: "跨机构尝试定稿"
  }, otherInstitution), /another institution/);
});

test("two verified rounds populate the four application acceptance metrics", () => {
  let rounds = verifiedRound([], 1, 1);
  rounds = verifiedRound(rounds, 2, 10);
  const data = {
    researchExpertConsultationRounds: rounds,
    researchProjectAcceptanceItems: seedResearchProjectAcceptanceItems()
  };
  data.researchProjectAcceptanceItems = synchronizeAcceptanceMetrics(data, new Date("2026-11-01T08:00:00.000Z"));
  const ids = ["metric-expert-rounds", "metric-expert-response", "metric-ahp-consistency", "metric-content-validity"];
  const metrics = data.researchProjectAcceptanceItems.filter((item) => ids.includes(item.id));
  assert.deepEqual(metrics.map((item) => item.measuredValue), [2, 100, 0, 1]);
  assert.equal(metrics.every((item) => item.status === "evidence-recorded"), true);
  assert.equal(metrics.every((item) => item.recordedBy === "expert-consultation-calculation"), true);
  assert.equal(metrics.every((item) => metricMeetsTarget(item)), true);
  assert.equal(metrics.every((item) => item.sha256.length === 64), true);
  const center = buildExpertConsultationCenter(data);
  assert.equal(center.summary.verified, 2);
  assert.equal(center.aggregate.responseRate, 100);
  assert.equal(center.aggregate.minimumICVI, 1);
  assert.equal(center.aggregate.maximumAHPCR, 0);
  assert.equal(center.acceptanceMetricBridge.every((item) => item.meetsTarget), true);
});

test("automatic synchronization does not overwrite submitted or manual evidence", () => {
  const rounds = verifiedRound([], 1, 1);
  const items = seedResearchProjectAcceptanceItems();
  const submitted = items.find((item) => item.id === "metric-expert-response");
  submitted.status = "submitted";
  submitted.measuredValue = 82;
  submitted.evidenceRef = "MANUAL-RESPONSE-REPORT";
  submitted.sha256 = "a".repeat(64);
  const manual = items.find((item) => item.id === "metric-content-validity");
  manual.status = "evidence-recorded";
  manual.measuredValue = 0.8;
  manual.evidenceRef = "MANUAL-CVI-REPORT";
  manual.sha256 = "b".repeat(64);
  manual.recordedBy = "manual-recorder";
  const synced = synchronizeAcceptanceMetrics({ researchExpertConsultationRounds: rounds, researchProjectAcceptanceItems: items });
  assert.equal(synced.find((item) => item.id === submitted.id).evidenceRef, "MANUAL-RESPONSE-REPORT");
  assert.equal(synced.find((item) => item.id === manual.id).evidenceRef, "MANUAL-CVI-REPORT");
});

test("revoking the last verified round invalidates automatically bridged evidence", () => {
  let rounds = verifiedRound([], 1, 1);
  let items = synchronizeAcceptanceMetrics({
    researchExpertConsultationRounds: rounds,
    researchProjectAcceptanceItems: seedResearchProjectAcceptanceItems()
  }, new Date("2026-11-01T08:00:00.000Z"));
  const responseMetric = items.find((item) => item.id === "metric-expert-response");
  responseMetric.status = "verified";
  responseMetric.reviewedBy = "acceptance-reviewer";
  rounds = applyExpertConsultationRoundAction(rounds, rounds[0].id, {
    action: "revoke-round-verification",
    note: "发现专家遴选记录与批准范围不一致，撤销本轮复核。"
  }, reviewer, new Date("2026-11-02T08:00:00.000Z"));
  items = synchronizeAcceptanceMetrics({
    researchExpertConsultationRounds: rounds,
    researchProjectAcceptanceItems: items
  }, new Date("2026-11-02T08:01:00.000Z"));
  const bridged = items.filter((item) => ["metric-expert-rounds", "metric-expert-response", "metric-ahp-consistency", "metric-content-validity"].includes(item.id));
  assert.equal(rounds[0].status, "returned");
  assert.equal(bridged.every((item) => item.status === "returned"), true);
  assert.equal(bridged.every((item) => item.measuredValue === null && item.evidenceRef === "" && item.sha256 === ""), true);
  assert.equal(bridged.every((item) => metricMeetsTarget(item) === null), true);
});

test("expert consultation report and guarded server routes are present", () => {
  const center = buildExpertConsultationCenter({});
  assert.match(renderExpertConsultationMarkdown(center), /专家咨询统计报告/);
  assert.match(center.boundary, /不保存专家姓名/);
  const server = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "research-project-acceptance.html"), "utf8");
  const ui = fs.readFileSync(path.join(ROOT, "research-expert-consultation-ui.js"), "utf8");
  assert.match(server, /\/api\/research-project\/expert-consultation/);
  assert.match(server, /synchronizeAcceptanceMetrics/);
  assert.match(html, /id="research-expert-consultation-panel"/);
  assert.match(html, /research-expert-consultation-ui\.js/);
  assert.match(ui, /noExpertPii/);
  assert.match(ui, /expert-consultation\/rounds/);
});
