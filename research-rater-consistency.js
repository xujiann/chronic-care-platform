"use strict";

const { createHash } = require("node:crypto");
const {
  metricMeetsTarget,
  normalizeResearchProjectAcceptanceItems
} = require("./research-project-acceptance");

const METHODS = Object.freeze([
  { id: "fleiss-kappa", name: "Fleiss Kappa", dataType: "categorical", target: 0.75 },
  { id: "icc-a1", name: "ICC(A,1)", dataType: "continuous", target: 0.75 }
]);
const STATUSES = new Set(["collecting", "finalized", "verified", "returned"]);

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function roundNumber(value, digits = 6) {
  const factor = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

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

function methodDefinition(method) {
  const definition = METHODS.find((item) => item.id === method);
  if (!definition) throw new Error("unsupported rater consistency method");
  return definition;
}

function calculateFleissKappa(matrix) {
  if (!Array.isArray(matrix) || matrix.length < 2 || !Array.isArray(matrix[0]) || matrix[0].length < 2) {
    throw new Error("Fleiss Kappa requires at least two cases and two raters");
  }
  const raterCount = matrix[0].length;
  if (matrix.some((row) => !Array.isArray(row) || row.length !== raterCount || row.some((value) => String(value).trim() === ""))) {
    throw new Error("Fleiss Kappa matrix must be complete and rectangular");
  }
  const categories = [...new Set(matrix.flat().map(String))].sort();
  if (categories.length < 2) {
    throw new Error("Fleiss Kappa is undefined when only one category is observed");
  }
  const counts = matrix.map((row) => Object.fromEntries(categories.map((category) => [category, row.filter((value) => String(value) === category).length])));
  const observedAgreement = counts.reduce((sum, row) => (
    sum + ((categories.reduce((total, category) => total + (row[category] ** 2), 0) - raterCount) / (raterCount * (raterCount - 1)))
  ), 0) / matrix.length;
  const categoryShares = Object.fromEntries(categories.map((category) => [
    category,
    counts.reduce((sum, row) => sum + row[category], 0) / (matrix.length * raterCount)
  ]));
  const expectedAgreement = Object.values(categoryShares).reduce((sum, value) => sum + (value ** 2), 0);
  const coefficient = expectedAgreement === 1 ? 1 : (observedAgreement - expectedAgreement) / (1 - expectedAgreement);
  return {
    coefficient: roundNumber(coefficient),
    observedAgreement: roundNumber(observedAgreement),
    expectedAgreement: roundNumber(expectedAgreement),
    categories,
    categoryShares: Object.fromEntries(Object.entries(categoryShares).map(([key, value]) => [key, roundNumber(value)])),
    cases: matrix.length,
    raters: raterCount
  };
}

function calculateICCA1(matrix) {
  if (!Array.isArray(matrix) || matrix.length < 2 || !Array.isArray(matrix[0]) || matrix[0].length < 2) {
    throw new Error("ICC(A,1) requires at least two cases and two raters");
  }
  const caseCount = matrix.length;
  const raterCount = matrix[0].length;
  const values = matrix.map((row) => row.map(Number));
  if (values.some((row) => row.length !== raterCount || row.some((value) => !Number.isFinite(value)))) {
    throw new Error("ICC(A,1) matrix must be numeric, complete and rectangular");
  }
  const grandMean = values.flat().reduce((sum, value) => sum + value, 0) / (caseCount * raterCount);
  const caseMeans = values.map((row) => row.reduce((sum, value) => sum + value, 0) / raterCount);
  const raterMeans = Array.from({ length: raterCount }, (_, column) => values.reduce((sum, row) => sum + row[column], 0) / caseCount);
  const msCases = raterCount * caseMeans.reduce((sum, mean) => sum + ((mean - grandMean) ** 2), 0) / (caseCount - 1);
  const msRaters = caseCount * raterMeans.reduce((sum, mean) => sum + ((mean - grandMean) ** 2), 0) / (raterCount - 1);
  const residualSum = values.reduce((sum, row, rowIndex) => sum + row.reduce((inner, value, columnIndex) => (
    inner + ((value - caseMeans[rowIndex] - raterMeans[columnIndex] + grandMean) ** 2)
  ), 0), 0);
  const msError = residualSum / ((caseCount - 1) * (raterCount - 1));
  const denominator = msCases + ((raterCount - 1) * msError) + (raterCount * (msRaters - msError) / caseCount);
  if (Math.abs(denominator) < 1e-12) {
    throw new Error("ICC(A,1) is undefined when score variance is zero");
  }
  const coefficient = (msCases - msError) / denominator;
  return {
    coefficient: roundNumber(coefficient),
    msCases: roundNumber(msCases),
    msRaters: roundNumber(msRaters),
    msError: roundNumber(msError),
    grandMean: roundNumber(grandMean),
    cases: caseCount,
    raters: raterCount
  };
}

function matrixFromSubmissions(batch) {
  return batch.cases.map((_, caseIndex) => batch.submissions.map((submission) => submission.ratings[caseIndex]));
}

function calculateBatchStatistics(batch) {
  const complete = batch.submissions.length === batch.expectedRaters;
  if (batch.submissions.length < 2) {
    return { coefficient: null, meetsTarget: null, complete, cases: batch.cases.length, raters: batch.submissions.length, expectedRaters: batch.expectedRaters, method: batch.method };
  }
  const result = batch.method === "fleiss-kappa"
    ? calculateFleissKappa(matrixFromSubmissions(batch))
    : calculateICCA1(matrixFromSubmissions(batch));
  return { ...result, complete, expectedRaters: batch.expectedRaters, method: batch.method, meetsTarget: result.coefficient >= 0.75 };
}

function normalizeSubmission(submission, batch) {
  const raterKeyHash = String(submission?.raterKeyHash || "");
  if (!/^[a-f0-9]{64}$/i.test(raterKeyHash) || submission?.noRaterPii !== true) return null;
  const ratings = Array.isArray(submission.ratings) ? submission.ratings : [];
  if (ratings.length !== batch.cases.length) return null;
  try {
    const normalizedRatings = validateRatings(batch, ratings);
    return {
      id: String(submission.id || `rating-${raterKeyHash.slice(0, 12)}`),
      raterKeyHash,
      ratings: normalizedRatings,
      noRaterPii: true,
      recordedBy: String(submission.recordedBy || ""),
      recordedAt: String(submission.recordedAt || "")
    };
  } catch {
    return null;
  }
}

function normalizeRaterConsistencyBatches(source) {
  const batches = Array.isArray(source) ? source : [];
  return batches.map((batch, index) => {
    const method = METHODS.some((item) => item.id === batch.method) ? batch.method : "fleiss-kappa";
    const categories = method === "fleiss-kappa"
      ? [...new Set((Array.isArray(batch.categories) ? batch.categories : ["通过", "不通过"]).map((item) => String(item).trim()).filter(Boolean))].slice(0, 10)
      : [];
    const normalized = {
      id: String(batch.id || `research-rater-batch-${String(index + 1).padStart(2, "0")}`),
      batchNumber: Number.isInteger(Number(batch.batchNumber)) && Number(batch.batchNumber) > 0 ? Number(batch.batchNumber) : index + 1,
      name: String(batch.name || `第${index + 1}批评价一致性研究`),
      method,
      categories: categories.length >= 2 ? categories : ["通过", "不通过"],
      scoreMin: Number.isFinite(Number(batch.scoreMin)) ? Number(batch.scoreMin) : 0,
      scoreMax: Number.isFinite(Number(batch.scoreMax)) ? Number(batch.scoreMax) : 100,
      expectedRaters: Math.floor(Math.max(2, Math.min(50, Number(batch.expectedRaters) || 2))),
      cases: (Array.isArray(batch.cases) ? batch.cases : []).filter((item) => /^[a-f0-9]{64}$/i.test(String(item?.caseKeyHash || ""))).map((item, caseIndex) => ({ id: `case-${String(caseIndex + 1).padStart(2, "0")}`, caseKeyHash: String(item.caseKeyHash) })).slice(0, 200),
      status: STATUSES.has(batch.status) ? batch.status : "collecting",
      ownerOrgCode: String(batch.ownerOrgCode || ""),
      createdBy: String(batch.createdBy || ""),
      createdAt: String(batch.createdAt || ""),
      finalizedBy: String(batch.finalizedBy || ""),
      finalizedAt: String(batch.finalizedAt || ""),
      reviewedBy: String(batch.reviewedBy || ""),
      reviewedAt: String(batch.reviewedAt || ""),
      reviewNote: String(batch.reviewNote || ""),
      submissions: [],
      history: Array.isArray(batch.history) ? batch.history.slice(0, 100) : []
    };
    normalized.submissions = (Array.isArray(batch.submissions) ? batch.submissions : []).map((item) => normalizeSubmission(item, normalized)).filter(Boolean).slice(0, 50);
    return normalized;
  }).filter((batch) => batch.cases.length >= 2).sort((left, right) => left.batchNumber - right.batchNumber);
}

function validateRatings(batch, source) {
  if (!Array.isArray(source) || source.length !== batch.cases.length) throw new Error("ratings must cover every batch case");
  if (batch.method === "fleiss-kappa") {
    return source.map((value) => {
      const rating = String(value).trim();
      if (!batch.categories.includes(rating)) throw new Error("categorical rating is outside the batch categories");
      return rating;
    });
  }
  return source.map((value) => {
    const rating = Number(value);
    if (!Number.isFinite(rating) || rating < batch.scoreMin || rating > batch.scoreMax) throw new Error("continuous rating is outside the batch score range");
    return rating;
  });
}

function assertInstitutionScope(batch, user) {
  if (user?.role !== "institution") return;
  const sameOrganization = batch.ownerOrgCode && user.orgCode && batch.ownerOrgCode === user.orgCode;
  const sameCreatorWithoutOrganization = !batch.ownerOrgCode && batch.createdBy === actorKey(user);
  if (!sameOrganization && !sameCreatorWithoutOrganization) {
    throw Object.assign(new Error("institution cannot modify another institution's consistency batch"), { status: 403 });
  }
}

function createRaterConsistencyBatch(batches, payload = {}, user = {}, now = new Date()) {
  requireRole(user, ["commission", "institution"], "current role cannot create a consistency batch");
  const normalized = normalizeRaterConsistencyBatches(batches);
  const batchNumber = Number(payload.batchNumber);
  if (!Number.isInteger(batchNumber) || batchNumber < 1 || batchNumber > 99) throw new Error("batchNumber must be an integer from 1 to 99");
  if (normalized.some((item) => item.batchNumber === batchNumber)) throw new Error("consistency batchNumber already exists");
  const method = methodDefinition(payload.method).id;
  const expectedRaters = Number(payload.expectedRaters);
  if (!Number.isInteger(expectedRaters) || expectedRaters < 2 || expectedRaters > 50) throw new Error("expectedRaters must be an integer from 2 to 50");
  const rawCases = Array.isArray(payload.caseCodes) ? payload.caseCodes.map((item) => requireText(item, "caseCode", 100)) : [];
  if (rawCases.length < 2 || rawCases.length > 200) throw new Error("caseCodes must contain 2 to 200 cases");
  const caseHashes = rawCases.map(sha256);
  if (new Set(caseHashes).size !== caseHashes.length) throw new Error("caseCodes must be unique");
  const categories = method === "fleiss-kappa"
    ? [...new Set((Array.isArray(payload.categories) ? payload.categories : []).map((item) => requireText(item, "category", 50)))].slice(0, 10)
    : [];
  if (method === "fleiss-kappa" && categories.length < 2) throw new Error("categorical batch requires at least two categories");
  const scoreMin = method === "icc-a1" ? Number(payload.scoreMin) : 0;
  const scoreMax = method === "icc-a1" ? Number(payload.scoreMax) : 100;
  if (method === "icc-a1" && (!Number.isFinite(scoreMin) || !Number.isFinite(scoreMax) || scoreMax <= scoreMin)) throw new Error("continuous batch requires a valid score range");
  const actor = requireText(actorKey(user), "actor");
  const at = now instanceof Date ? now.toISOString() : String(now);
  const created = {
    id: `research-rater-batch-${String(batchNumber).padStart(2, "0")}`,
    batchNumber,
    name: requireText(payload.name, "name"),
    method,
    categories,
    scoreMin,
    scoreMax,
    expectedRaters,
    cases: caseHashes.map((caseKeyHash, index) => ({ id: `case-${String(index + 1).padStart(2, "0")}`, caseKeyHash })),
    status: "collecting",
    ownerOrgCode: String(user.orgCode || ""),
    createdBy: actor,
    createdAt: at,
    finalizedBy: "",
    finalizedAt: "",
    reviewedBy: "",
    reviewedAt: "",
    reviewNote: "",
    submissions: [],
    history: [{ action: "create-batch", actor, role: user.role, at, fromStatus: "", toStatus: "collecting", note: `${method}/${caseHashes.length}/${expectedRaters}` }]
  };
  return [...normalized, created].sort((left, right) => left.batchNumber - right.batchNumber);
}

function recordRaterSubmission(batches, batchId, payload = {}, user = {}, now = new Date()) {
  requireRole(user, ["commission", "institution"], "current role cannot record consistency ratings");
  const normalized = normalizeRaterConsistencyBatches(batches);
  const index = normalized.findIndex((batch) => batch.id === batchId);
  if (index < 0) throw Object.assign(new Error("consistency batch not found"), { status: 404 });
  const batch = normalized[index];
  assertInstitutionScope(batch, user);
  if (batch.status !== "collecting") throw new Error("ratings can only be recorded while the batch is collecting");
  if (payload.noRaterPii !== true) throw new Error("noRaterPii must be confirmed");
  if (batch.submissions.length >= batch.expectedRaters) throw new Error("recorded raters cannot exceed expectedRaters");
  const raterKeyHash = sha256(requireText(payload.raterCode, "raterCode", 80));
  if (batch.submissions.some((item) => item.raterKeyHash === raterKeyHash)) throw new Error("rater submission already exists in this batch");
  const actor = requireText(actorKey(user), "actor");
  const at = now instanceof Date ? now.toISOString() : String(now);
  const submission = {
    id: `rating-${raterKeyHash.slice(0, 12)}`,
    raterKeyHash,
    ratings: validateRatings(batch, payload.ratings),
    noRaterPii: true,
    recordedBy: actor,
    recordedAt: at
  };
  normalized[index] = {
    ...batch,
    submissions: [...batch.submissions, submission],
    history: [{ action: "record-ratings", actor, role: user.role, at, fromStatus: batch.status, toStatus: batch.status, note: submission.id }, ...batch.history].slice(0, 100)
  };
  return { batches: normalized, submission };
}

function applyRaterConsistencyBatchAction(batches, batchId, payload = {}, user = {}, now = new Date()) {
  const normalized = normalizeRaterConsistencyBatches(batches);
  const index = normalized.findIndex((batch) => batch.id === batchId);
  if (index < 0) throw Object.assign(new Error("consistency batch not found"), { status: 404 });
  const batch = normalized[index];
  assertInstitutionScope(batch, user);
  const action = requireText(payload.action, "action");
  const actor = requireText(actorKey(user), "actor");
  const note = requireText(payload.note, "note", 1000);
  const at = now instanceof Date ? now.toISOString() : String(now);
  const next = { ...batch };
  if (action === "finalize-batch") {
    requireRole(user, ["commission", "institution"], "current role cannot finalize a consistency batch");
    if (batch.status !== "collecting" || batch.submissions.length !== batch.expectedRaters) throw new Error("all expected rater submissions are required before finalization");
    const statistics = calculateBatchStatistics(batch);
    if (!Number.isFinite(statistics.coefficient)) throw new Error("consistency coefficient could not be calculated");
    next.status = "finalized";
    next.finalizedBy = actor;
    next.finalizedAt = at;
  } else if (action === "verify-batch") {
    requireRole(user, ["commission"], "only commission reviewer can verify a consistency batch");
    if (batch.status !== "finalized") throw new Error("only a finalized consistency batch can be verified");
    if ([batch.createdBy, batch.finalizedBy].filter(Boolean).includes(actor)) throw new Error("independent reviewer is required");
    next.status = "verified";
    next.reviewedBy = actor;
    next.reviewedAt = at;
    next.reviewNote = note;
  } else if (action === "return-batch") {
    requireRole(user, ["commission"], "only commission reviewer can return a consistency batch");
    if (batch.status !== "finalized") throw new Error("only a finalized consistency batch can be returned");
    if ([batch.createdBy, batch.finalizedBy].filter(Boolean).includes(actor)) throw new Error("independent reviewer is required");
    next.status = "returned";
    next.reviewedBy = actor;
    next.reviewedAt = at;
    next.reviewNote = note;
  } else if (action === "reopen-batch") {
    requireRole(user, ["commission", "institution"], "current role cannot reopen a consistency batch");
    if (batch.status !== "returned") throw new Error("only a returned consistency batch can be reopened");
    next.status = "collecting";
    next.finalizedBy = "";
    next.finalizedAt = "";
    next.reviewedBy = "";
    next.reviewedAt = "";
    next.reviewNote = "";
  } else if (action === "revoke-batch-verification") {
    requireRole(user, ["commission"], "only commission reviewer can revoke consistency verification");
    if (batch.status !== "verified") throw new Error("only a verified consistency batch can be revoked");
    next.status = "returned";
    next.reviewedBy = actor;
    next.reviewedAt = at;
    next.reviewNote = note;
  } else {
    throw new Error("unsupported consistency batch action");
  }
  next.history = [{ action, actor, role: user.role, at, fromStatus: batch.status, toStatus: next.status, note }, ...batch.history].slice(0, 100);
  normalized[index] = next;
  return normalized;
}

function aggregateVerifiedConsistency(batches) {
  const verified = batches.filter((batch) => batch.status === "verified");
  const results = verified.map((batch) => ({ batchId: batch.id, name: batch.name, method: batch.method, ...calculateBatchStatistics(batch) }));
  return {
    verifiedBatches: verified.length,
    categoricalBatches: results.filter((item) => item.method === "fleiss-kappa").length,
    continuousBatches: results.filter((item) => item.method === "icc-a1").length,
    minimumCoefficient: results.length ? Math.min(...results.map((item) => item.coefficient)) : null,
    results
  };
}

function synchronizeRaterConsistencyAcceptance(data = {}, now = new Date()) {
  const batches = normalizeRaterConsistencyBatches(data.researchRaterConsistencyBatches);
  const aggregate = aggregateVerifiedConsistency(batches);
  const items = normalizeResearchProjectAcceptanceItems(data.researchProjectAcceptanceItems);
  const item = items.find((entry) => entry.id === "metric-rater-consistency");
  if (!item) return items;
  const automaticallyManaged = item.recordedBy === "rater-consistency-calculation" || String(item.evidenceRef || "").startsWith("research-rater-consistency:");
  const at = now instanceof Date ? now.toISOString() : String(now);
  if (!aggregate.verifiedBatches) {
    if (!automaticallyManaged) return items;
    return items.map((entry) => entry.id !== item.id ? entry : {
      ...entry,
      status: "returned",
      measuredValue: null,
      evidenceRef: "",
      sha256: "",
      note: "评价一致性复核来源已撤销，自动计算证据失效。",
      submittedBy: "",
      submittedAt: "",
      reviewedBy: "",
      reviewedAt: "",
      reviewNote: "",
      history: [{ action: "invalidate-rater-consistency", actor: "rater-consistency-calculation", role: "system", at, fromStatus: entry.status, toStatus: "returned", note: "no verified consistency batch remains" }, ...(entry.history || [])].slice(0, 50)
    });
  }
  const evidenceRef = `research-rater-consistency:${sha256(JSON.stringify({ batches: batches.filter((batch) => batch.status === "verified"), aggregate }))}`;
  if (automaticallyManaged && item.evidenceRef === evidenceRef && item.measuredValue === aggregate.minimumCoefficient) return items;
  if (!automaticallyManaged && ["submitted", "verified"].includes(item.status)) return items;
  if (!automaticallyManaged && item.status === "evidence-recorded" && item.recordedBy) return items;
  return items.map((entry) => entry.id !== item.id ? entry : {
    ...entry,
    status: "evidence-recorded",
    measuredValue: aggregate.minimumCoefficient,
    evidenceRef,
    sha256: sha256(evidenceRef),
    note: `由${aggregate.verifiedBatches}个已复核评价批次自动计算，按最低 Kappa/ICC 系数验收。`,
    recordedBy: "rater-consistency-calculation",
    recordedAt: at,
    submittedBy: "",
    submittedAt: "",
    reviewedBy: "",
    reviewedAt: "",
    reviewNote: "",
    noPatientPii: true,
    history: [{ action: "sync-rater-consistency", actor: "rater-consistency-calculation", role: "system", at, fromStatus: entry.status, toStatus: "evidence-recorded", note: `minimum=${aggregate.minimumCoefficient}` }, ...(entry.history || [])].slice(0, 50)
  });
}

function buildRaterConsistencyCenter(data = {}) {
  const batches = normalizeRaterConsistencyBatches(data.researchRaterConsistencyBatches);
  const acceptanceItem = normalizeResearchProjectAcceptanceItems(data.researchProjectAcceptanceItems).find((item) => item.id === "metric-rater-consistency");
  const aggregate = aggregateVerifiedConsistency(batches);
  return {
    ok: true,
    methods: METHODS,
    batches: batches.map((batch) => ({ ...batch, statistics: calculateBatchStatistics(batch) })),
    aggregate,
    acceptanceMetricBridge: acceptanceItem ? { id: acceptanceItem.id, name: acceptanceItem.name, measuredValue: acceptanceItem.measuredValue, status: acceptanceItem.status, meetsTarget: metricMeetsTarget(acceptanceItem) } : null,
    summary: {
      batches: batches.length,
      collecting: batches.filter((batch) => batch.status === "collecting").length,
      finalized: batches.filter((batch) => batch.status === "finalized").length,
      verified: batches.filter((batch) => batch.status === "verified").length,
      submissions: batches.reduce((sum, batch) => sum + batch.submissions.length, 0)
    },
    boundary: "仅保存案例编号和评价者代号的 SHA-256 摘要及最小必要评分，不保存患者信息、评价者姓名或联系方式。Kappa/ICC 结果仅形成待提交复核的科研验收证据。"
  };
}

function renderRaterConsistencyMarkdown(center) {
  return [
    "# 数智医院评价者间一致性统计报告",
    "",
    `- 研究批次：${center.summary.batches}`,
    `- 已复核批次：${center.summary.verified}`,
    `- 匿名评价提交：${center.summary.submissions}`,
    `- 已复核最低 Kappa/ICC：${center.aggregate.minimumCoefficient ?? "待计算"}`,
    "",
    "| 批次 | 方法 | 案例 | 评价者 | 系数 | 状态 |",
    "| --- | --- | --- | --- | --- | --- |",
    ...center.batches.map((batch) => `| ${batch.name} | ${methodDefinition(batch.method).name} | ${batch.cases.length} | ${batch.submissions.length}/${batch.expectedRaters} | ${batch.statistics.coefficient ?? "待计算"} | ${batch.status} |`),
    "",
    "## 数据边界",
    "",
    center.boundary,
    ""
  ].join("\n");
}

module.exports = {
  METHODS,
  aggregateVerifiedConsistency,
  applyRaterConsistencyBatchAction,
  buildRaterConsistencyCenter,
  calculateBatchStatistics,
  calculateFleissKappa,
  calculateICCA1,
  createRaterConsistencyBatch,
  normalizeRaterConsistencyBatches,
  recordRaterSubmission,
  renderRaterConsistencyMarkdown,
  synchronizeRaterConsistencyAcceptance
};
