const DIGITAL_HOSPITAL_SELF_ASSESSMENT_ACTIONS = [
  "assign-assessment",
  "save-draft",
  "submit-assessment",
  "start-preliminary-review",
  "escalate-expert-review",
  "record-expert-opinion",
  "request-correction",
  "accept-assessment"
];

const DIGITAL_HOSPITAL_SELF_ASSESSMENT_INDICATORS = [
  { id: "dhsi-emr-closure", domain: "电子病历", title: "病历、医嘱与质控问题形成闭环", required: true, weight: 10, standardRefs: ["电子病历系统应用水平分级评价"] },
  { id: "dhsi-emr-audit", domain: "电子病历", title: "病历操作、封存、复制和修改全程留痕", required: true, weight: 8, standardRefs: ["电子病历应用管理规范（试行）"] },
  { id: "dhsi-interface-contract", domain: "互联互通", title: "接口契约、版本、签名、幂等和回执可追溯", required: true, weight: 10, standardRefs: ["WS/T 846.1～846.11—2024", "WS/T 847—2024"] },
  { id: "dhsi-mutual-recognition", domain: "互联互通", title: "检查检验互认目录、引用和例外处置闭环", required: true, weight: 7, standardRefs: ["检查检验结果互认管理要求"] },
  { id: "dhsi-smart-service", domain: "智慧服务", title: "预约、支付、退费、消息和满意度回执闭环", required: true, weight: 8, standardRefs: ["智慧医院建设相关通知"] },
  { id: "dhsi-internet-care", domain: "智慧服务", title: "互联网诊疗复诊边界和处方审核受控", required: true, weight: 7, standardRefs: ["互联网诊疗监管细则"] },
  { id: "dhsi-management-lineage", domain: "智慧管理", title: "运营指标口径、来源血缘和审批记录完整", required: true, weight: 8, standardRefs: ["医院智慧管理分级评估标准体系（试行）"] },
  { id: "dhsi-resilience", domain: "智慧管理", title: "备份恢复、只读降级和回滚演练可复核", required: true, weight: 8, standardRefs: ["业务连续性与网络安全管理要求"] },
  { id: "dhsi-standard-version", domain: "标准服务", title: "规范、数据元和值域版本及替代关系受控", required: true, weight: 8, standardRefs: ["WS/T 363-2023", "WS/T 364-2023"] },
  { id: "dhsi-master-data", domain: "标准服务", title: "居民、机构、科室、人员和业务主数据可追溯", required: true, weight: 8, standardRefs: ["WS 365"] },
  { id: "dhsi-privacy-audit", domain: "安全合规", title: "敏感个人信息最小必要、授权和访问审计有效", required: true, weight: 9, standardRefs: ["个人信息保护法", "数据安全法"] },
  { id: "dhsi-security-assessment", domain: "安全合规", title: "等保、密码应用和日志保全要求落实", required: true, weight: 9, standardRefs: ["GB/T 22239-2019", "GB/T 39786-2021"] }
];

function selfAssessmentError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function nowIso(options = {}) {
  return options.now || new Date().toISOString();
}

function dateOffset(days, options = {}) {
  const date = new Date(nowIso(options));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function actorKey(user = {}) {
  return String(user.id || user.username || `${user.role || "unknown"}:${user.name || "unknown"}`).trim();
}

function compact(value, maxLength = 500) {
  return String(value || "").trim().slice(0, maxLength);
}

function normalizeEvidenceRefs(value) {
  const refs = Array.isArray(value) ? value : String(value || "").split(/[\n,，]/);
  return [...new Set(refs.map((item) => compact(item, 180)).filter(Boolean))].slice(0, 12);
}

function seededResponses(count, prefix) {
  return DIGITAL_HOSPITAL_SELF_ASSESSMENT_INDICATORS.slice(0, count).map((indicator, index) => ({
    indicatorId: indicator.id,
    answer: index % 4 === 3 ? "partial" : "compliant",
    score: index % 4 === 3 ? 60 : 100,
    evidenceRefs: [`${prefix}-${String(index + 1).padStart(2, "0")}`],
    note: index % 4 === 3 ? "已登记差距，等待补充现场签字材料。" : "受控证据引用已登记。",
    noPatientPii: true,
    updatedBy: "seed",
    updatedByName: "平台初始化",
    updatedAt: "2026-07-17T00:00:00.000Z"
  }));
}

function seedDigitalHospitalSelfAssessments(options = {}) {
  const allResponses = seededResponses(DIGITAL_HOSPITAL_SELF_ASSESSMENT_INDICATORS.length, "SITE-MR3-2026");
  return [
    {
      id: "dhsa-mr1-2026-pilot",
      cycle: "2026-pilot",
      targetLevel: "三级综合医院试点",
      institutionId: "MR1",
      institutionName: "大连市中心医院",
      assignedTo: "医院信息中心/医务部",
      dueAt: dateOffset(10, options),
      status: "draft",
      responses: seededResponses(10, "SITE-MR1-2026"),
      correction: null,
      declaration: null,
      history: [{ action: "assign-assessment", actor: "省级组织实施组", actorKey: "seed", at: "2026-07-17T00:00:00.000Z", note: "首批三级综合医院试点自评任务。" }]
    },
    {
      id: "dhsa-mr3-2026-pilot",
      cycle: "2026-pilot",
      targetLevel: "基层医疗机构轻量试点",
      institutionId: "MR3",
      institutionName: "青泥洼桥社区卫生服务中心",
      assignedTo: "基层机构管理员",
      dueAt: dateOffset(5, options),
      status: "correction-required",
      responses: allResponses,
      correction: {
        note: "补充备份恢复演练回执，并更新接口版本引用。",
        indicatorIds: ["dhsi-interface-contract", "dhsi-resilience"],
        requestedBy: "省级初审组",
        requestedAt: "2026-07-17T00:00:00.000Z",
        dueAt: dateOffset(5, options)
      },
      declaration: { noPatientPii: true, accepted: true, submittedBy: "基层机构管理员", submittedByKey: "seed-institution", submittedAt: "2026-07-17T00:00:00.000Z" },
      history: [
        { action: "submit-assessment", actor: "基层机构管理员", actorKey: "seed-institution", at: "2026-07-17T00:00:00.000Z", note: "完成首轮自评申报。" },
        { action: "request-correction", actor: "省级初审组", actorKey: "seed-reviewer", at: "2026-07-17T00:00:00.000Z", note: "补充备份恢复演练回执，并更新接口版本引用。" }
      ]
    }
  ];
}

function indicatorMap() {
  return new Map(DIGITAL_HOSPITAL_SELF_ASSESSMENT_INDICATORS.map((item) => [item.id, item]));
}

function summarizeAssessment(assessment = {}, options = {}) {
  const indicators = DIGITAL_HOSPITAL_SELF_ASSESSMENT_INDICATORS;
  const responses = Array.isArray(assessment.responses) ? assessment.responses : [];
  const responseMap = new Map(responses.map((item) => [item.indicatorId, item]));
  const required = indicators.filter((item) => item.required);
  const answered = required.filter((item) => responseMap.has(item.id));
  const scored = indicators.filter((item) => responseMap.get(item.id)?.score !== null && Number.isFinite(Number(responseMap.get(item.id)?.score)));
  const weightTotal = scored.reduce((sum, item) => sum + item.weight, 0);
  const weightedScore = weightTotal
    ? Math.round(scored.reduce((sum, item) => sum + Number(responseMap.get(item.id).score) * item.weight, 0) / weightTotal)
    : 0;
  const evidenceRefs = responses.reduce((sum, item) => sum + normalizeEvidenceRefs(item.evidenceRefs).length, 0);
  const terminal = assessment.status === "accepted";
  const today = nowIso(options).slice(0, 10);
  return {
    requiredIndicators: required.length,
    answeredIndicators: answered.length,
    completionPercent: required.length ? Math.round(answered.length * 100 / required.length) : 100,
    weightedScore,
    evidenceRefs,
    overdue: Boolean(assessment.dueAt && assessment.dueAt < today && !terminal),
    blocking: !terminal,
    correctionIndicators: assessment.correction?.indicatorIds?.length || 0
  };
}

function assessmentView(assessment, options = {}) {
  return { ...assessment, summary: summarizeAssessment(assessment, options), latestAction: assessment.history?.[assessment.history.length - 1] || null };
}

function buildDigitalHospitalSelfAssessmentBoard(data = {}, user = {}, filters = {}, options = {}) {
  const source = Array.isArray(data.digitalHospitalSelfAssessments)
    ? data.digitalHospitalSelfAssessments
    : seedDigitalHospitalSelfAssessments(options);
  const scoped = user.role === "institution"
    ? source.filter((item) => item.institutionId === user.orgCode)
    : source;
  const allAssessments = scoped.map((item) => assessmentView(item, options));
  const query = compact(filters.query || filters.q, 120).toLowerCase();
  const assessments = allAssessments.filter((item) => {
    if (filters.status && item.status !== filters.status) return false;
    if (filters.institutionId && item.institutionId !== filters.institutionId) return false;
    if (filters.overdueOnly && !item.summary.overdue) return false;
    if (filters.reviewOnly && !["submitted", "resubmitted", "preliminary-review", "expert-review", "expert-reviewed"].includes(item.status)) return false;
    if (query && !`${item.institutionName} ${item.targetLevel} ${item.assignedTo} ${item.status}`.toLowerCase().includes(query)) return false;
    return true;
  });
  const summary = {
    assessments: allAssessments.length,
    filteredAssessments: assessments.length,
    draft: allAssessments.filter((item) => ["assigned", "draft", "correction-in-progress"].includes(item.status)).length,
    submitted: allAssessments.filter((item) => ["submitted", "resubmitted"].includes(item.status)).length,
    preliminaryReview: allAssessments.filter((item) => item.status === "preliminary-review").length,
    expertReview: allAssessments.filter((item) => item.status === "expert-review").length,
    expertReviewed: allAssessments.filter((item) => item.status === "expert-reviewed").length,
    disputedIndicators: allAssessments.reduce((sum, item) => sum + (item.reviewWorkflow?.dispute?.indicatorIds?.length || 0), 0),
    correctionRequired: allAssessments.filter((item) => item.status === "correction-required").length,
    accepted: allAssessments.filter((item) => item.status === "accepted").length,
    overdue: allAssessments.filter((item) => item.summary.overdue).length,
    averageCompletion: allAssessments.length ? Math.round(allAssessments.reduce((sum, item) => sum + item.summary.completionPercent, 0) / allAssessments.length) : 0
  };
  const checks = [
    { id: "digitalHospitalSelfAssessment:indicators", passed: DIGITAL_HOSPITAL_SELF_ASSESSMENT_INDICATORS.length >= 12, detail: `${DIGITAL_HOSPITAL_SELF_ASSESSMENT_INDICATORS.length} structured indicators` },
    { id: "digitalHospitalSelfAssessment:sixDomains", passed: new Set(DIGITAL_HOSPITAL_SELF_ASSESSMENT_INDICATORS.map((item) => item.domain)).size === 6, detail: "six domains covered" },
    { id: "digitalHospitalSelfAssessment:scope", passed: user.role !== "institution" || allAssessments.every((item) => item.institutionId === user.orgCode), detail: `${allAssessments.length} role-scoped assessments` },
    { id: "digitalHospitalSelfAssessment:evidenceBoundary", passed: allAssessments.every((item) => (item.responses || []).every((response) => response.noPatientPii === true)), detail: "responses keep controlled references and no-PII declaration" },
    { id: "digitalHospitalSelfAssessment:tieredReview", passed: ["start-preliminary-review", "escalate-expert-review", "record-expert-opinion"].every((action) => DIGITAL_HOSPITAL_SELF_ASSESSMENT_ACTIONS.includes(action)), detail: "preliminary review, disputed-indicator escalation and independent expert opinion are supported" }
  ];
  return {
    ok: checks.every((item) => item.passed),
    generatedAt: nowIso(options),
    indicators: DIGITAL_HOSPITAL_SELF_ASSESSMENT_INDICATORS,
    actions: DIGITAL_HOSPITAL_SELF_ASSESSMENT_ACTIONS,
    summary,
    allAssessments,
    assessments,
    checks,
    boundary: "自评工作台只登记指标结论、受控证据引用和最小化摘要，不保存患者身份、完整病历或影像原片；初审和专家意见属于试点评价过程证据，接受自评不替代现场评价和正式割接审批。"
  };
}

function assertInstitutionOwner(assessment, user) {
  if (user.role !== "institution" || !user.orgCode || assessment.institutionId !== user.orgCode) {
    throw selfAssessmentError("仅任务所属医疗机构可填报或提交自评", 403);
  }
}

function assertCommission(user) {
  if (user.role !== "commission") throw selfAssessmentError("仅卫健管理端可执行该自评动作", 403);
}

function historyEvent(action, user, note, at) {
  return { action, actor: user.name || user.username || user.role, actorKey: actorKey(user), at, note: compact(note, 600) };
}

function createDigitalHospitalSelfAssessment(payload = {}, user = {}, options = {}) {
  assertCommission(user);
  const institutionId = compact(payload.institutionId, 80);
  const institutionName = compact(payload.institutionName, 160);
  const cycle = compact(payload.cycle, 80);
  const targetLevel = compact(payload.targetLevel, 160);
  const assignedTo = compact(payload.assignedTo, 160);
  const dueAt = compact(payload.dueAt, 10);
  const note = compact(payload.note, 600);
  if (!institutionId || !institutionName || !cycle || !targetLevel || !assignedTo || !dueAt || !note) {
    throw selfAssessmentError("分派自评必须填写机构、周期、目标、责任人、期限和说明");
  }
  const at = nowIso(options);
  return {
    id: options.id || `dhsa-${Date.now()}`,
    cycle,
    targetLevel,
    institutionId,
    institutionName,
    assignedTo,
    dueAt,
    status: "assigned",
    responses: [],
    correction: null,
    declaration: null,
    history: [historyEvent("assign-assessment", user, note, at)]
  };
}

function normalizeResponse(payload, user, at) {
  const indicators = indicatorMap();
  const indicatorId = compact(payload.indicatorId, 100);
  const indicator = indicators.get(indicatorId);
  if (!indicator) throw selfAssessmentError("未找到自评指标");
  const answer = compact(payload.answer, 30);
  if (!['compliant', 'partial', 'not-compliant', 'not-applicable'].includes(answer)) throw selfAssessmentError("自评结论不合法");
  if (payload.noPatientPii !== true) throw selfAssessmentError("必须确认自评证据不含患者可识别信息");
  const evidenceRefs = normalizeEvidenceRefs(payload.evidenceRefs);
  const note = compact(payload.note, 800);
  if (["compliant", "partial"].includes(answer) && evidenceRefs.length === 0) throw selfAssessmentError("符合或部分符合必须登记受控证据引用");
  if (["partial", "not-compliant", "not-applicable"].includes(answer) && !note) throw selfAssessmentError("该自评结论必须填写说明");
  const score = answer === "compliant" ? 100 : answer === "partial" ? 60 : answer === "not-compliant" ? 0 : null;
  return { indicatorId, answer, score, evidenceRefs, note, noPatientPii: true, updatedBy: actorKey(user), updatedByName: user.name || user.username, updatedAt: at };
}

function normalizeDigitalHospitalSelfAssessmentAction(assessment = {}, payload = {}, user = {}, options = {}) {
  const action = compact(payload.action, 50);
  if (!DIGITAL_HOSPITAL_SELF_ASSESSMENT_ACTIONS.includes(action) || action === "assign-assessment") throw selfAssessmentError("不支持的自评动作");
  const at = nowIso(options);
  const next = { ...assessment, responses: [...(assessment.responses || [])], history: [...(assessment.history || [])] };

  if (action === "save-draft") {
    assertInstitutionOwner(next, user);
    if (!["assigned", "draft", "correction-required", "correction-in-progress"].includes(next.status)) throw selfAssessmentError("当前状态不能修改自评草稿", 409);
    const response = normalizeResponse(payload, user, at);
    const index = next.responses.findIndex((item) => item.indicatorId === response.indicatorId);
    if (index >= 0) next.responses[index] = response;
    else next.responses.push(response);
    next.status = next.correction ? "correction-in-progress" : "draft";
    next.history.push(historyEvent(action, user, payload.note || `更新指标 ${response.indicatorId}`, at));
    return { assessment: next, event: next.history[next.history.length - 1] };
  }

  if (action === "submit-assessment") {
    assertInstitutionOwner(next, user);
    if (!["assigned", "draft", "correction-required", "correction-in-progress"].includes(next.status)) throw selfAssessmentError("当前状态不能提交自评", 409);
    const summary = summarizeAssessment(next, options);
    if (summary.answeredIndicators < summary.requiredIndicators) throw selfAssessmentError(`仍有 ${summary.requiredIndicators - summary.answeredIndicators} 项必填指标未完成`, 409);
    if (payload.noPatientPii !== true || payload.declarationAccepted !== true) throw selfAssessmentError("提交前必须确认最小化证据和机构申报承诺");
    const note = compact(payload.note, 600);
    if (!note) throw selfAssessmentError("提交自评必须填写申报说明");
    const hadCorrection = Boolean(next.correction || next.history.some((item) => item.action === "request-correction"));
    next.status = hadCorrection ? "resubmitted" : "submitted";
    next.declaration = { noPatientPii: true, accepted: true, submittedBy: user.name || user.username, submittedByKey: actorKey(user), submittedAt: at };
    next.submittedAt = at;
    next.correction = null;
    next.history.push(historyEvent(action, user, note, at));
    return { assessment: next, event: next.history[next.history.length - 1] };
  }

  if (action === "start-preliminary-review") {
    assertCommission(user);
    if (!["submitted", "resubmitted"].includes(next.status)) throw selfAssessmentError("仅已提交自评可进入省级初审", 409);
    if (next.declaration?.submittedByKey === actorKey(user)) throw selfAssessmentError("自评提交人与初审人必须独立", 409);
    const note = compact(payload.note, 800);
    const dueAt = compact(payload.dueAt, 10);
    if (!note || !dueAt) throw selfAssessmentError("省级初审必须填写期限和受理说明");
    next.status = "preliminary-review";
    next.dueAt = dueAt;
    next.reviewWorkflow = {
      ...(next.reviewWorkflow || {}),
      preliminary: { reviewer: user.name || user.username, reviewerKey: actorKey(user), startedAt: at, dueAt, note }
    };
    next.history.push(historyEvent(action, user, note, at));
    return { assessment: next, event: next.history[next.history.length - 1] };
  }

  if (action === "escalate-expert-review") {
    assertCommission(user);
    if (next.status !== "preliminary-review") throw selfAssessmentError("仅省级初审中的任务可升级专家复核", 409);
    const note = compact(payload.note, 800);
    const expertGroup = compact(payload.expertGroup, 160);
    const dueAt = compact(payload.dueAt, 10);
    const indicatorIds = [...new Set((Array.isArray(payload.indicatorIds) ? payload.indicatorIds : String(payload.indicatorIds || "").split(/[\s,，]+/)).map((item) => compact(item, 100)).filter(Boolean))];
    const validIds = indicatorMap();
    if (!note || !expertGroup || !dueAt || indicatorIds.length === 0 || indicatorIds.some((id) => !validIds.has(id))) {
      throw selfAssessmentError("专家复核升级必须填写专家组、期限、有效争议指标和升级理由");
    }
    next.status = "expert-review";
    next.dueAt = dueAt;
    next.reviewWorkflow = {
      ...(next.reviewWorkflow || {}),
      dispute: { indicatorIds, reason: note, expertGroup, assignedBy: user.name || user.username, assignedByKey: actorKey(user), assignedAt: at, dueAt }
    };
    next.history.push(historyEvent(action, user, note, at));
    return { assessment: next, event: next.history[next.history.length - 1] };
  }

  if (action === "record-expert-opinion") {
    assertCommission(user);
    if (next.status !== "expert-review") throw selfAssessmentError("仅专家复核中的任务可登记专家意见", 409);
    const actor = actorKey(user);
    if ([next.declaration?.submittedByKey, next.reviewWorkflow?.preliminary?.reviewerKey].filter(Boolean).includes(actor)) {
      throw selfAssessmentError("专家复核人与申报人、初审人必须独立", 409);
    }
    const decision = compact(payload.decision, 30);
    const opinionRef = compact(payload.opinionRef, 180);
    const note = compact(payload.note, 800);
    const dueAt = compact(payload.dueAt, 10);
    if (!['confirm', 'revise', 'return'].includes(decision) || !opinionRef || !note) throw selfAssessmentError("专家意见必须包含有效结论、意见引用和说明");
    if (decision === "return" && !dueAt) throw selfAssessmentError("退回补正的专家意见必须填写补正期限");
    next.reviewWorkflow = {
      ...(next.reviewWorkflow || {}),
      expert: { decision, opinionRef, note, reviewer: user.name || user.username, reviewerKey: actor, reviewedAt: at }
    };
    if (decision === "return") {
      const indicatorIds = next.reviewWorkflow.dispute?.indicatorIds || [];
      next.status = "correction-required";
      next.dueAt = dueAt;
      next.correction = { note, indicatorIds, requestedBy: user.name || user.username, requestedByKey: actor, requestedAt: at, dueAt, source: "expert-review" };
    } else {
      next.status = "expert-reviewed";
    }
    next.history.push(historyEvent(action, user, note, at));
    return { assessment: next, event: next.history[next.history.length - 1] };
  }

  if (action === "request-correction") {
    assertCommission(user);
    if (!["submitted", "resubmitted", "preliminary-review"].includes(next.status)) throw selfAssessmentError("仅已提交或初审中的自评可退回补正", 409);
    const note = compact(payload.note, 800);
    const dueAt = compact(payload.dueAt, 10);
    const indicatorIds = [...new Set((Array.isArray(payload.indicatorIds) ? payload.indicatorIds : String(payload.indicatorIds || "").split(/[\s,，]+/)).map((item) => compact(item, 100)).filter(Boolean))];
    const validIds = indicatorMap();
    if (!note || !dueAt || indicatorIds.length === 0 || indicatorIds.some((id) => !validIds.has(id))) throw selfAssessmentError("退回补正必须填写期限、有效指标和补正意见");
    next.status = "correction-required";
    next.dueAt = dueAt;
    next.correction = { note, indicatorIds, requestedBy: user.name || user.username, requestedByKey: actorKey(user), requestedAt: at, dueAt };
    next.history.push(historyEvent(action, user, note, at));
    return { assessment: next, event: next.history[next.history.length - 1] };
  }

  assertCommission(user);
  if (!["submitted", "resubmitted", "preliminary-review", "expert-reviewed"].includes(next.status)) throw selfAssessmentError("仅已提交、初审中或专家复核完成的自评可审核接受", 409);
  if (next.declaration?.submittedByKey && next.declaration.submittedByKey === actorKey(user)) throw selfAssessmentError("自评提交人与审核人必须独立", 409);
  if (next.reviewWorkflow?.preliminary?.reviewerKey === actorKey(user)) throw selfAssessmentError("省级初审人与最终接受审核人必须独立", 409);
  if (next.reviewWorkflow?.expert?.reviewerKey === actorKey(user)) throw selfAssessmentError("专家复核人与最终接受审核人必须独立", 409);
  const reviewNote = compact(payload.note, 800);
  if (!reviewNote) throw selfAssessmentError("接受自评必须填写审核结论");
  next.status = "accepted";
  next.review = { decision: "accepted", reviewedBy: user.name || user.username, reviewedByKey: actorKey(user), reviewedAt: at, note: reviewNote };
  next.history.push(historyEvent(action, user, reviewNote, at));
  return { assessment: next, event: next.history[next.history.length - 1] };
}

module.exports = {
  DIGITAL_HOSPITAL_SELF_ASSESSMENT_ACTIONS,
  DIGITAL_HOSPITAL_SELF_ASSESSMENT_INDICATORS,
  buildDigitalHospitalSelfAssessmentBoard,
  createDigitalHospitalSelfAssessment,
  normalizeDigitalHospitalSelfAssessmentAction,
  seedDigitalHospitalSelfAssessments,
  summarizeAssessment
};
