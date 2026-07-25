"use strict";

const { createHash } = require("node:crypto");
const {
  metricMeetsTarget,
  normalizeResearchProjectAcceptanceItems
} = require("./research-project-acceptance");

const CORE_INDICATORS = Object.freeze([
  { id: "governance-standard", name: "治理与标准体系完整性" },
  { id: "medical-service", name: "医疗服务与患者体验" },
  { id: "quality-safety", name: "临床质量与安全" },
  { id: "public-health", name: "公共卫生与区域协同" },
  { id: "operation-efficiency", name: "运营与资源效率" },
  { id: "data-security", name: "数据治理与安全" }
]);

const AHP_CRITERIA = Object.freeze([
  { id: "standard-governance", name: "标准治理" },
  { id: "application-outcomes", name: "应用成效" },
  { id: "data-security", name: "数据安全" }
]);

const RI = Object.freeze({ 1: 0, 2: 0, 3: 0.58, 4: 0.9, 5: 1.12, 6: 1.24, 7: 1.32, 8: 1.41, 9: 1.45, 10: 1.49 });
const ROUND_STATUSES = new Set(["collecting", "finalized", "verified", "returned"]);

function actorKey(user = {}) {
  return String(user.id || user.username || user.name || user.role || "").trim();
}

function requireText(value, field, maxLength = 200) {
  const result = String(value || "").trim();
  if (!result) throw new Error(`${field} is required`);
  if (result.length > maxLength) throw new Error(`${field} is too long`);
  return result;
}

function requireRole(user, roles, message) {
  if (!roles.includes(user?.role)) throw Object.assign(new Error(message), { status: 403 });
}

function assertInstitutionRoundScope(round, user) {
  if (user?.role !== "institution") return;
  const actor = actorKey(user);
  const sameOrganization = round.ownerOrgCode && user.orgCode && round.ownerOrgCode === user.orgCode;
  const sameCreatorWithoutOrganization = !round.ownerOrgCode && round.createdBy === actor;
  if (!sameOrganization && !sameCreatorWithoutOrganization) {
    throw Object.assign(new Error("institution cannot modify another institution's expert consultation round"), { status: 403 });
  }
}

function roundNumber(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function normalizeRatings(source) {
  const ratings = source && typeof source === "object" && !Array.isArray(source) ? source : {};
  return Object.fromEntries(CORE_INDICATORS.map((indicator) => {
    const value = Number(ratings[indicator.id]);
    if (!Number.isInteger(value) || value < 1 || value > 4) throw new Error(`rating for ${indicator.id} must be an integer from 1 to 4`);
    return [indicator.id, value];
  }));
}

function normalizeJudgments(source) {
  const judgments = source && typeof source === "object" && !Array.isArray(source) ? source : {};
  const keys = ["standardVsOutcomes", "standardVsSecurity", "outcomesVsSecurity"];
  return Object.fromEntries(keys.map((key) => {
    const value = Number(judgments[key]);
    if (!Number.isFinite(value) || value < (1 / 9) || value > 9) throw new Error(`${key} must be between 1/9 and 9`);
    return [key, value];
  }));
}

function judgmentMatrix(judgments) {
  const standardVsOutcomes = Number(judgments.standardVsOutcomes);
  const standardVsSecurity = Number(judgments.standardVsSecurity);
  const outcomesVsSecurity = Number(judgments.outcomesVsSecurity);
  return [
    [1, standardVsOutcomes, standardVsSecurity],
    [1 / standardVsOutcomes, 1, outcomesVsSecurity],
    [1 / standardVsSecurity, 1 / outcomesVsSecurity, 1]
  ];
}

function calculateAHP(matrix) {
  const n = Array.isArray(matrix) ? matrix.length : 0;
  if (n < 1 || matrix.some((row) => !Array.isArray(row) || row.length !== n || row.some((value) => !Number.isFinite(value) || value <= 0))) {
    throw new Error("AHP matrix must be a positive square matrix");
  }
  for (let row = 0; row < n; row += 1) {
    if (Math.abs(matrix[row][row] - 1) > 1e-8) throw new Error("AHP matrix diagonal must equal 1");
    for (let column = row + 1; column < n; column += 1) {
      if (Math.abs((matrix[row][column] * matrix[column][row]) - 1) > 1e-6) throw new Error("AHP matrix must be reciprocal");
    }
  }
  const geometricMeans = matrix.map((row) => row.reduce((product, value) => product * value, 1) ** (1 / n));
  const total = geometricMeans.reduce((sum, value) => sum + value, 0);
  const weights = geometricMeans.map((value) => value / total);
  const weighted = matrix.map((row) => row.reduce((sum, value, index) => sum + (value * weights[index]), 0));
  const lambdaMax = weighted.reduce((sum, value, index) => sum + (value / weights[index]), 0) / n;
  const ci = n <= 2 ? 0 : Math.max(0, (lambdaMax - n) / (n - 1));
  const cr = RI[n] ? ci / RI[n] : 0;
  return {
    weights: weights.map((value) => roundNumber(value, 6)),
    lambdaMax: roundNumber(lambdaMax, 6),
    ci: roundNumber(ci, 6),
    cr: roundNumber(cr, 6),
    consistent: cr < 0.1
  };
}

function aggregateJudgments(responses) {
  if (!responses.length) return null;
  const keys = ["standardVsOutcomes", "standardVsSecurity", "outcomesVsSecurity"];
  const judgments = Object.fromEntries(keys.map((key) => [
    key,
    responses.reduce((product, response) => product * response.ahpJudgments[key], 1) ** (1 / responses.length)
  ]));
  return { judgments, ...calculateAHP(judgmentMatrix(judgments)) };
}

function calculateRoundStatistics(round) {
  const responses = Array.isArray(round.responses) ? round.responses : [];
  const invitedExperts = Number(round.invitedExperts) || 0;
  const responseRate = invitedExperts > 0 ? roundNumber(100 * responses.length / invitedExperts, 2) : 0;
  const contentValidity = CORE_INDICATORS.map((indicator) => {
    const relevant = responses.filter((response) => Number(response.relevanceRatings?.[indicator.id]) >= 3).length;
    const icvi = responses.length ? roundNumber(relevant / responses.length, 4) : null;
    return { ...indicator, relevant, responses: responses.length, icvi, meetsTarget: icvi === null ? null : icvi >= 0.78 };
  });
  const aggregateAHP = aggregateJudgments(responses);
  return {
    invitedExperts,
    responses: responses.length,
    responseRate,
    responseTargetMet: responseRate >= 80,
    contentValidity,
    minimumICVI: responses.length ? Math.min(...contentValidity.map((item) => item.icvi)) : null,
    aggregateAHP,
    individualAHPConsistencyRate: responses.length
      ? roundNumber(100 * responses.filter((response) => calculateAHP(judgmentMatrix(response.ahpJudgments)).consistent).length / responses.length, 2)
      : null
  };
}

function normalizeResponse(response) {
  try {
    const relevanceRatings = normalizeRatings(response?.relevanceRatings);
    const ahpJudgments = normalizeJudgments(response?.ahpJudgments);
    const expertKeyHash = String(response?.expertKeyHash || "");
    if (!/^[a-f0-9]{64}$/i.test(expertKeyHash)) return null;
    return {
      id: String(response.id || `response-${expertKeyHash.slice(0, 12)}`),
      expertKeyHash,
      relevanceRatings,
      ahpJudgments,
      noExpertPii: response.noExpertPii === true,
      recordedBy: String(response.recordedBy || ""),
      recordedAt: String(response.recordedAt || "")
    };
  } catch {
    return null;
  }
}

function normalizeExpertConsultationRounds(source) {
  const rounds = Array.isArray(source) ? source : [];
  return rounds.map((round, index) => ({
    id: String(round.id || `research-expert-round-${index + 1}`),
    roundNumber: Number.isInteger(Number(round.roundNumber)) && Number(round.roundNumber) > 0 ? Number(round.roundNumber) : index + 1,
    name: String(round.name || `第${index + 1}轮专家咨询`),
    invitedExperts: Math.floor(Math.max(1, Math.min(500, Number(round.invitedExperts) || 1))),
    status: ROUND_STATUSES.has(round.status) ? round.status : "collecting",
    ownerOrgCode: String(round.ownerOrgCode || ""),
    createdBy: String(round.createdBy || ""),
    createdAt: String(round.createdAt || ""),
    finalizedBy: String(round.finalizedBy || ""),
    finalizedAt: String(round.finalizedAt || ""),
    reviewedBy: String(round.reviewedBy || ""),
    reviewedAt: String(round.reviewedAt || ""),
    reviewNote: String(round.reviewNote || ""),
    responses: (Array.isArray(round.responses) ? round.responses : []).map(normalizeResponse).filter(Boolean).slice(0, 500),
    history: Array.isArray(round.history) ? round.history.slice(0, 100) : []
  })).sort((left, right) => left.roundNumber - right.roundNumber);
}

function createExpertConsultationRound(rounds, payload = {}, user = {}, now = new Date()) {
  requireRole(user, ["commission", "institution"], "current role cannot create an expert consultation round");
  const normalized = normalizeExpertConsultationRounds(rounds);
  const round = Number(payload.roundNumber);
  if (!Number.isInteger(round) || round < 1 || round > 99) throw new Error("roundNumber must be an integer from 1 to 99");
  if (normalized.some((item) => item.roundNumber === round)) throw new Error("expert consultation roundNumber already exists");
  const invitedExperts = Number(payload.invitedExperts);
  if (!Number.isInteger(invitedExperts) || invitedExperts < 1 || invitedExperts > 500) throw new Error("invitedExperts must be an integer from 1 to 500");
  const actor = requireText(actorKey(user), "actor");
  const at = now instanceof Date ? now.toISOString() : String(now);
  const created = {
    id: `research-expert-round-${String(round).padStart(2, "0")}`,
    roundNumber: round,
    name: requireText(payload.name, "name"),
    invitedExperts,
    status: "collecting",
    ownerOrgCode: String(user.orgCode || ""),
    createdBy: actor,
    createdAt: at,
    finalizedBy: "",
    finalizedAt: "",
    reviewedBy: "",
    reviewedAt: "",
    reviewNote: "",
    responses: [],
    history: [{ action: "create-round", actor, role: user.role, at, fromStatus: "", toStatus: "collecting", note: "" }]
  };
  return [...normalized, created].sort((left, right) => left.roundNumber - right.roundNumber);
}

function recordExpertConsultationResponse(rounds, roundId, payload = {}, user = {}, now = new Date()) {
  requireRole(user, ["commission", "institution"], "current role cannot record an expert consultation response");
  const normalized = normalizeExpertConsultationRounds(rounds);
  const index = normalized.findIndex((round) => round.id === roundId);
  if (index < 0) throw Object.assign(new Error("expert consultation round not found"), { status: 404 });
  const round = normalized[index];
  assertInstitutionRoundScope(round, user);
  if (round.status !== "collecting") throw new Error("responses can only be recorded while the round is collecting");
  if (payload.noExpertPii !== true) throw new Error("noExpertPii must be confirmed");
  if (round.responses.length >= round.invitedExperts) throw new Error("recorded responses cannot exceed invited experts");
  const expertKeyHash = sha256(requireText(payload.expertCode, "expertCode", 80));
  if (round.responses.some((response) => response.expertKeyHash === expertKeyHash)) throw new Error("expert response already exists in this round");
  const actor = requireText(actorKey(user), "actor");
  const at = now instanceof Date ? now.toISOString() : String(now);
  const response = {
    id: `response-${expertKeyHash.slice(0, 12)}`,
    expertKeyHash,
    relevanceRatings: normalizeRatings(payload.relevanceRatings),
    ahpJudgments: normalizeJudgments(payload.ahpJudgments),
    noExpertPii: true,
    recordedBy: actor,
    recordedAt: at
  };
  normalized[index] = {
    ...round,
    responses: [...round.responses, response],
    history: [{ action: "record-response", actor, role: user.role, at, fromStatus: round.status, toStatus: round.status, note: response.id }, ...round.history].slice(0, 100)
  };
  return { rounds: normalized, response };
}

function applyExpertConsultationRoundAction(rounds, roundId, payload = {}, user = {}, now = new Date()) {
  const normalized = normalizeExpertConsultationRounds(rounds);
  const index = normalized.findIndex((round) => round.id === roundId);
  if (index < 0) throw Object.assign(new Error("expert consultation round not found"), { status: 404 });
  const round = normalized[index];
  assertInstitutionRoundScope(round, user);
  const action = requireText(payload.action, "action");
  const actor = requireText(actorKey(user), "actor");
  const note = requireText(payload.note, "note", 1000);
  const at = now instanceof Date ? now.toISOString() : String(now);
  const next = { ...round };

  if (action === "finalize-round") {
    requireRole(user, ["commission", "institution"], "current role cannot finalize an expert consultation round");
    if (round.status !== "collecting" || round.responses.length < 1) throw new Error("a collecting round with responses is required before finalization");
    next.status = "finalized";
    next.finalizedBy = actor;
    next.finalizedAt = at;
  } else if (action === "verify-round") {
    requireRole(user, ["commission"], "only commission reviewer can verify an expert consultation round");
    if (round.status !== "finalized") throw new Error("only a finalized round can be verified");
    if ([round.createdBy, round.finalizedBy].filter(Boolean).includes(actor)) throw new Error("independent reviewer is required");
    next.status = "verified";
    next.reviewedBy = actor;
    next.reviewedAt = at;
    next.reviewNote = note;
  } else if (action === "return-round") {
    requireRole(user, ["commission"], "only commission reviewer can return an expert consultation round");
    if (round.status !== "finalized") throw new Error("only a finalized round can be returned");
    if ([round.createdBy, round.finalizedBy].filter(Boolean).includes(actor)) throw new Error("independent reviewer is required");
    next.status = "returned";
    next.reviewedBy = actor;
    next.reviewedAt = at;
    next.reviewNote = note;
  } else if (action === "reopen-round") {
    requireRole(user, ["commission", "institution"], "current role cannot reopen an expert consultation round");
    if (round.status !== "returned") throw new Error("only a returned round can be reopened");
    next.status = "collecting";
    next.finalizedBy = "";
    next.finalizedAt = "";
    next.reviewedBy = "";
    next.reviewedAt = "";
    next.reviewNote = "";
  } else if (action === "revoke-round-verification") {
    requireRole(user, ["commission"], "only commission reviewer can revoke an expert consultation verification");
    if (round.status !== "verified") throw new Error("only a verified round can have its verification revoked");
    next.status = "returned";
    next.reviewedBy = actor;
    next.reviewedAt = at;
    next.reviewNote = note;
  } else {
    throw new Error("unsupported expert consultation action");
  }
  next.history = [{ action, actor, role: user.role, at, fromStatus: round.status, toStatus: next.status, note }, ...round.history].slice(0, 100);
  normalized[index] = next;
  return normalized;
}

function aggregateVerifiedStatistics(rounds) {
  const verified = rounds.filter((round) => round.status === "verified");
  const responses = verified.flatMap((round) => round.responses);
  const invited = verified.reduce((sum, round) => sum + round.invitedExperts, 0);
  const contentValidity = CORE_INDICATORS.map((indicator) => {
    const relevant = responses.filter((response) => response.relevanceRatings[indicator.id] >= 3).length;
    return { ...indicator, icvi: responses.length ? roundNumber(relevant / responses.length, 4) : null };
  });
  const ahpResults = verified.map((round) => calculateRoundStatistics(round).aggregateAHP).filter(Boolean);
  return {
    verifiedRounds: verified.length,
    invitedExperts: invited,
    responses: responses.length,
    responseRate: invited ? roundNumber(100 * responses.length / invited, 2) : null,
    minimumICVI: responses.length ? Math.min(...contentValidity.map((item) => item.icvi)) : null,
    contentValidity,
    maximumAHPCR: ahpResults.length ? Math.max(...ahpResults.map((item) => item.cr)) : null
  };
}

function synchronizeAcceptanceMetrics(data = {}, now = new Date()) {
  const rounds = normalizeExpertConsultationRounds(data.researchExpertConsultationRounds);
  const aggregate = aggregateVerifiedStatistics(rounds);
  const items = normalizeResearchProjectAcceptanceItems(data.researchProjectAcceptanceItems);
  const at = now instanceof Date ? now.toISOString() : String(now);
  const hasVerifiedSource = aggregate.verifiedRounds > 0;
  const values = new Map([
    ["metric-expert-rounds", hasVerifiedSource ? aggregate.verifiedRounds : null],
    ["metric-expert-response", hasVerifiedSource ? aggregate.responseRate : null],
    ["metric-ahp-consistency", hasVerifiedSource ? aggregate.maximumAHPCR : null],
    ["metric-content-validity", hasVerifiedSource ? aggregate.minimumICVI : null]
  ]);
  const digest = sha256(JSON.stringify({ rounds: rounds.filter((round) => round.status === "verified"), aggregate }));
  return items.map((item) => {
    if (!values.has(item.id)) return item;
    const automaticallyManaged = item.recordedBy === "expert-consultation-calculation"
      || String(item.evidenceRef || "").startsWith("research-expert-consultation:");
    const measuredValue = values.get(item.id);
    if (measuredValue === null) {
      if (!automaticallyManaged) return item;
      return {
        ...item,
        status: "returned",
        measuredValue: null,
        evidenceRef: "",
        sha256: "",
        note: "专家咨询复核来源已撤销，自动计算证据失效。",
        submittedBy: "",
        submittedAt: "",
        reviewedBy: "",
        reviewedAt: "",
        reviewNote: "",
        history: [{
          action: "invalidate-expert-metric",
          actor: "expert-consultation-calculation",
          role: "system",
          at,
          fromStatus: item.status,
          toStatus: "returned",
          note: "no verified expert consultation source remains"
        }, ...(item.history || [])].slice(0, 50)
      };
    }
    const evidenceRef = `research-expert-consultation:${digest}`;
    if (automaticallyManaged && item.evidenceRef === evidenceRef && item.measuredValue === measuredValue) return item;
    if (!automaticallyManaged && ["submitted", "verified"].includes(item.status)) return item;
    if (!automaticallyManaged && item.status === "evidence-recorded" && item.recordedBy) return item;
    const updated = {
      ...item,
      status: "evidence-recorded",
      measuredValue,
      evidenceRef,
      sha256: sha256(evidenceRef),
      note: `由${aggregate.verifiedRounds}轮已复核专家咨询自动计算；响应${aggregate.responses}/${aggregate.invitedExperts}。`,
      recordedBy: "expert-consultation-calculation",
      recordedAt: at,
      submittedBy: "",
      submittedAt: "",
      reviewedBy: "",
      reviewedAt: "",
      reviewNote: "",
      noPatientPii: true
    };
    updated.history = [{
      action: "sync-expert-metric",
      actor: "expert-consultation-calculation",
      role: "system",
      at,
      fromStatus: item.status,
      toStatus: updated.status,
      note: `${item.id}=${measuredValue}`
    }, ...(item.history || [])].slice(0, 50);
    return updated;
  });
}

function buildExpertConsultationCenter(data = {}) {
  const rounds = normalizeExpertConsultationRounds(data.researchExpertConsultationRounds);
  const aggregate = aggregateVerifiedStatistics(rounds);
  const acceptanceItems = normalizeResearchProjectAcceptanceItems(data.researchProjectAcceptanceItems);
  const bridgeIds = ["metric-expert-rounds", "metric-expert-response", "metric-ahp-consistency", "metric-content-validity"];
  return {
    ok: true,
    indicators: CORE_INDICATORS,
    ahpCriteria: AHP_CRITERIA,
    rounds: rounds.map((round) => ({ ...round, statistics: calculateRoundStatistics(round) })),
    aggregate,
    acceptanceMetricBridge: bridgeIds.map((id) => {
      const item = acceptanceItems.find((entry) => entry.id === id);
      return { id, name: item?.name || id, measuredValue: item?.measuredValue ?? null, status: item?.status || "planned", meetsTarget: item ? metricMeetsTarget(item) : null };
    }),
    summary: {
      rounds: rounds.length,
      collecting: rounds.filter((round) => round.status === "collecting").length,
      finalized: rounds.filter((round) => round.status === "finalized").length,
      verified: rounds.filter((round) => round.status === "verified").length,
      responses: rounds.reduce((sum, round) => sum + round.responses.length, 0)
    },
    boundary: "仅保存匿名专家代号摘要、1至4级相关性评分和AHP判断值，不保存专家姓名、联系方式或患者信息。统计结果仅形成待提交复核的项目验收证据。"
  };
}

function renderExpertConsultationMarkdown(center) {
  return [
    "# 数智医院标准平台专家咨询统计报告",
    "",
    `- 咨询轮次：${center.summary.rounds}`,
    `- 已独立复核轮次：${center.summary.verified}`,
    `- 已回收匿名问卷：${center.summary.responses}`,
    `- 已复核轮次综合积极系数：${center.aggregate.responseRate ?? "待计算"}%`,
    `- 核心指标最低 I-CVI：${center.aggregate.minimumICVI ?? "待计算"}`,
    `- 已复核轮次最大 AHP CR：${center.aggregate.maximumAHPCR ?? "待计算"}`,
    "",
    "## 轮次统计",
    "",
    "| 轮次 | 状态 | 回收/邀请 | 积极系数 | 最低 I-CVI | AHP CR |",
    "| --- | --- | --- | --- | --- | --- |",
    ...center.rounds.map((round) => `| ${round.name} | ${round.status} | ${round.statistics.responses}/${round.statistics.invitedExperts} | ${round.statistics.responseRate}% | ${round.statistics.minimumICVI ?? "待计算"} | ${round.statistics.aggregateAHP?.cr ?? "待计算"} |`),
    "",
    "## 内容效度",
    "",
    ...center.aggregate.contentValidity.map((item) => `- ${item.name}：I-CVI ${item.icvi ?? "待计算"}`),
    "",
    "## 数据边界",
    "",
    center.boundary,
    ""
  ].join("\n");
}

module.exports = {
  AHP_CRITERIA,
  CORE_INDICATORS,
  aggregateVerifiedStatistics,
  applyExpertConsultationRoundAction,
  buildExpertConsultationCenter,
  calculateAHP,
  calculateRoundStatistics,
  createExpertConsultationRound,
  judgmentMatrix,
  normalizeExpertConsultationRounds,
  recordExpertConsultationResponse,
  renderExpertConsultationMarkdown,
  synchronizeAcceptanceMetrics
};
