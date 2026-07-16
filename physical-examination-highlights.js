(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PhysicalExaminationHighlights = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const VERSION = "physical-exam-highlights-v1";
  const KNOWLEDGE = Object.freeze({
    BP: { title: "血压", meaning: "反映心脏泵血时血管承受的压力。一次偏高不能单独代替高血压诊断。", department: "全科/心内科", review: "按医嘱复测血压并保留家庭测量记录", plan: ["血压复测", "心血管风险评估"] },
    GLU: { title: "空腹血糖", meaning: "反映空腹状态下的血糖水平，受饮食、应激和用药等因素影响。", department: "全科/内分泌科", review: "核对空腹条件并按医嘱复查", plan: ["空腹血糖", "糖代谢风险评估"] },
    HBA1C: { title: "糖化血红蛋白", meaning: "用于观察近一段时间的平均血糖情况，应结合血糖和临床诊疗判断。", department: "内分泌科", review: "结合用药和血糖记录进行专科复核", plan: ["糖化血红蛋白", "糖尿病并发症筛查"] },
    BMI: { title: "体质指数", meaning: "由身高和体重计算，用于体重相关风险初筛，不能单独评价体脂分布。", department: "全科/健康管理", review: "复核身高体重并评估腰围和生活方式", plan: ["身高体重腰围", "营养和运动评估"] },
    CRE: { title: "肌酐", meaning: "常用于辅助评价肾功能，需要结合年龄、性别及其他肾功能指标判断。", department: "全科/肾内科", review: "按医嘱复查肾功能并核对参考区间", plan: ["肾功能", "尿常规"] },
    ECG: { title: "心电图", meaning: "记录心脏电活动，机器或单次结论不能替代医师综合诊断。", department: "心内科", review: "由医师结合症状和既往心电图复核", plan: ["心电图复核", "心血管评估"] }
  });

  const BASE_PLAN = Object.freeze(["健康体检自测问卷", "身高体重腰围和血压", "内外科及专科体格检查", "血尿常规和基础生化", "心电图", "医师总检和健康建议"]);
  const SCENARIOS = Object.freeze([
    { id: "exercise", name: "规律运动", effect: 5, detail: "用于健康教育的方向性区间，不预测个人疗效。" },
    { id: "weight", name: "体重管理", effect: 7, detail: "仅模拟体重相关风险方向，实际效果需复测确认。" },
    { id: "smoking", name: "戒烟支持", effect: 8, detail: "适用于吸烟人群的教育情景，不能替代临床评估。" },
    { id: "followup", name: "按时复查随访", effect: 4, detail: "体现更早发现和处置风险的管理收益，不等于指标必然下降。" }
  ]);

  function build(state = {}, reports = [], cases = [], options = {}) {
    const residentMap = new Map((state.residents || []).map((item) => [item.id, item]));
    const residentIds = [...new Set(reports.map((item) => item.residentId).filter(Boolean))];
    const trajectories = residentIds.flatMap((residentId) => buildTrajectories(residentId, reports));
    const translations = reports.flatMap((report) => translateReport(report, residentMap.get(report.residentId)));
    const actionCards = buildActionCards(reports, cases, state);
    const examPlans = residentIds.map((residentId) => buildExamPlan(residentMap.get(residentId) || { id: residentId }, reports.filter((item) => item.residentId === residentId)));
    const repeatAvoidance = buildRepeatAvoidance(reports);
    const radiationLedger = buildRadiationLedger(reports);
    const criticalPaths = buildCriticalPaths(cases, reports);
    const familyRiskMaps = buildFamilyRiskMaps(state, residentIds);
    const achievements = residentIds.flatMap((residentId) => buildAchievements(residentId, reports, cases));
    const healthPassports = (state.physicalExamHealthPassports || []).filter((item) => residentIds.includes(item.residentId)).map(maskPassport);
    const simulations = residentIds.map((residentId) => buildSimulation(residentId, reports));
    const qualityReviews = reports.map(reviewReportQuality);
    const institutionBenchmarks = buildInstitutionBenchmarks(reports, cases);
    const cityRadar = buildCityRadar(reports, options.minimumAggregate || 3);
    const standardsImpact = buildStandardsImpact(qualityReviews);
    return {
      version: VERSION,
      summary: {
        trajectories: trajectories.length,
        translatedFindings: translations.length,
        openActions: actionCards.filter((item) => item.status !== "closed").length,
        repeatCandidates: repeatAvoidance.length,
        radiationRecords: radiationLedger.length,
        qualityIssues: qualityReviews.reduce((sum, item) => sum + item.issues.length, 0),
        activePassports: healthPassports.filter((item) => item.status === "active").length
      },
      trajectories,
      translations,
      actionCards,
      examPlans,
      repeatAvoidance,
      radiationLedger,
      criticalPaths,
      familyRiskMaps,
      achievements,
      healthPassports,
      simulations,
      qualityReviews,
      institutionBenchmarks,
      cityRadar,
      standardsImpact,
      safetyBoundary: "趋势、解释、套餐建议和情景模拟仅用于健康管理辅助；诊断、危急值和具体检查项目由执业医师确认。"
    };
  }

  function buildTrajectories(residentId, reports) {
    const series = new Map();
    reports.filter((item) => item.residentId === residentId).forEach((report) => {
      (report.meta?.findings || []).forEach((finding) => {
        extractMeasurements(finding).forEach((measurement) => {
          const key = measurement.code;
          if (!series.has(key)) series.set(key, []);
          series.get(key).push({ date: report.date, value: measurement.value, unit: measurement.unit, abnormal: finding.abnormal === true, reportId: report.id, institution: report.source });
        });
      });
    });
    return [...series.entries()].map(([code, points]) => {
      const sorted = points.sort((a, b) => String(a.date).localeCompare(String(b.date)));
      const latest = sorted.at(-1);
      const previous = sorted.at(-2);
      const delta = previous ? round(latest.value - previous.value, 1) : null;
      return {
        id: `trajectory-${residentId}-${code}`,
        residentId,
        code,
        name: indicatorName(code),
        points: sorted,
        latest,
        delta,
        direction: delta === null ? "baseline" : delta > 0 ? "up" : delta < 0 ? "down" : "stable",
        firstAbnormalAt: sorted.find((item) => item.abnormal)?.date || "",
        evidenceLevel: sorted.length >= 2 ? "longitudinal" : "single-point"
      };
    });
  }

  function translateReport(report, resident = {}) {
    return (report.meta?.findings || []).map((finding) => {
      const knowledge = KNOWLEDGE[String(finding.code || "").toUpperCase()] || { title: finding.name || finding.code, meaning: "该项目尚未配置统一居民解释，需要由出具机构或医师说明。", department: "出具机构", review: "联系出具机构复核项目含义和参考范围", plan: ["医师复核"] };
      return {
        id: `translation-${report.id}-${finding.code}`,
        reportId: report.id,
        residentId: report.residentId,
        date: report.date,
        code: finding.code,
        title: knowledge.title,
        value: `${finding.value}${finding.unit || ""}`,
        status: finding.criticalValue ? "high-risk" : finding.abnormal ? "abnormal" : "within-report-range",
        plainMeaning: knowledge.meaning,
        nextStep: finding.abnormal ? knowledge.review : "继续结合历年趋势观察",
        department: knowledge.department,
        evidence: `${report.source || "来源机构"} · ${finding.reference || "参考范围以原报告为准"}`,
        boundary: "辅助解释，不生成诊断，不替代执业医师意见。",
        residentAge: resident.birthDate ? ageAt(resident.birthDate, report.date) : null
      };
    });
  }

  function buildActionCards(reports, cases, state) {
    const caseMap = new Map(cases.map((item) => [item.reportId, item]));
    const reviewRequests = state.physicalExamReviewRequests || [];
    const cards = [];
    reports.forEach((report) => {
      const abnormal = (report.meta?.findings || []).filter((item) => item.abnormal);
      if (!abnormal.length) return;
      const abnormalCase = caseMap.get(report.id);
      const existing = reviewRequests.find((item) => item.reportId === report.id && !["closed", "cancelled"].includes(item.status));
      cards.push({
        id: `action-${report.id}`,
        residentId: report.residentId,
        reportId: report.id,
        title: `${abnormal.map((item) => item.name || item.code).join("、")}需要处理`,
        evidence: abnormal.map((item) => `${item.name || item.code} ${item.value}${item.unit || ""}`),
        priority: abnormalCase?.classification === "high-risk" || abnormal.some((item) => item.criticalValue) ? "urgent" : "review",
        status: abnormalCase?.status || "pending-review",
        dueAt: abnormalCase?.dueAt || report.meta?.careLinkage?.dueAt || addDays(report.date, 14),
        nextStep: report.meta?.careLinkage?.familyDoctorSuggestion?.suggestion || KNOWLEDGE[String(abnormal[0].code || "").toUpperCase()]?.review || "联系家庭医生复核",
        appointmentDepartment: KNOWLEDGE[String(abnormal[0].code || "").toUpperCase()]?.department || "全科",
        appointmentHref: `citizen.html?client=app&page=registration&residentId=${encodeURIComponent(report.residentId)}&reason=${encodeURIComponent(abnormal[0].name || abnormal[0].code)}`,
        familyDoctorHref: "citizen.html?client=app&page=family-doctor",
        reviewRequest: existing || null,
        steps: criticalSteps(abnormalCase)
      });
    });
    return cards;
  }

  function buildExamPlan(resident, reports) {
    const latest = [...reports].sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
    const abnormalCodes = new Set(reports.flatMap((item) => (item.meta?.findings || []).filter((finding) => finding.abnormal).map((finding) => String(finding.code || "").toUpperCase())));
    const additions = [...abnormalCodes].flatMap((code) => KNOWLEDGE[code]?.plan || []).filter(unique);
    const age = resident.birthDate ? ageAt(resident.birthDate, latest?.date || new Date().toISOString().slice(0, 10)) : null;
    if (age >= 40) additions.push("肺功能和骨密度风险评估");
    const radiation = reports.flatMap((item) => item.meta?.radiationExaminations || []);
    const reductions = radiation.length ? ["近期已有放射检查时，先由医师判断能否复用结果，避免无指征重复照射"] : [];
    return {
      id: `exam-plan-${resident.id}`,
      residentId: resident.id,
      generatedFromReportId: latest?.id || "",
      nextExamDate: latest?.date ? addDays(latest.date, 365) : "",
      baseItems: [...BASE_PLAN],
      personalizedItems: [...new Set(additions)],
      reduceOrReview: reductions,
      ruleVersion: "成人健康体检项目推荐指引-2025 / local-medical-committee-review-required",
      approvalStatus: "physician-review-required",
      reason: abnormalCodes.size ? `根据 ${[...abnormalCodes].join("、")} 等历史异常生成` : "根据年龄和历年体检记录生成"
    };
  }

  function buildRepeatAvoidance(reports) {
    const grouped = new Map();
    reports.forEach((report) => (report.meta?.findings || []).forEach((finding) => {
      const key = `${report.residentId}|${String(finding.code || "").toUpperCase()}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push({ reportId: report.id, residentId: report.residentId, code: finding.code, name: finding.name, date: report.date, institution: report.source, abnormal: finding.abnormal });
    }));
    return [...grouped.values()].flatMap((items) => {
      const sorted = items.sort((a, b) => String(a.date).localeCompare(String(b.date)));
      const result = [];
      for (let index = 1; index < sorted.length; index += 1) {
        const days = daysBetween(sorted[index - 1].date, sorted[index].date);
        if (days <= 30) result.push({ id: `repeat-${sorted[index - 1].reportId}-${sorted[index].reportId}-${sorted[index].code}`, ...sorted[index], previousReportId: sorted[index - 1].reportId, previousDate: sorted[index - 1].date, intervalDays: days, recommendation: "先调阅近期结果，由接诊医师判断能否互认或确需复查。", decision: "physician-review-required" });
      }
      return result;
    });
  }

  function buildRadiationLedger(reports) {
    return reports.flatMap((report) => (report.meta?.radiationExaminations || []).map((item, index) => ({
      id: `radiation-${report.id}-${index + 1}`,
      residentId: report.residentId,
      reportId: report.id,
      date: report.date,
      institution: report.source,
      modality: item.modality,
      purpose: item.purpose,
      justification: item.justification,
      riskDisclosureRecorded: Boolean(item.riskDisclosureRef),
      protectionOptimized: item.protectionOptimized === true,
      dose: item.dose,
      doseUnit: item.doseUnit,
      governanceStatus: item.justification && item.riskDisclosureRef && item.protectionOptimized && item.dose !== null ? "complete" : "review"
    })));
  }

  function buildCriticalPaths(cases, reports) {
    const reportMap = new Map(reports.map((item) => [item.id, item]));
    return cases.map((item) => ({
      id: `critical-path-${item.id}`,
      caseId: item.id,
      residentId: item.residentId,
      reportId: item.reportId,
      reportDate: reportMap.get(item.reportId)?.date || "",
      classification: item.classification || "important",
      status: item.status,
      dueAt: item.dueAt,
      overdue: Boolean(item.dueAt && !["closed", "resolved"].includes(item.status) && item.dueAt < new Date().toISOString().slice(0, 10)),
      steps: criticalSteps(item),
      escalation: item.classification === "high-risk" && item.notificationStatus !== "delivered" ? "escalate-to-medical-owner" : "standard-followup"
    }));
  }

  function buildFamilyRiskMaps(state, residentIds) {
    const consents = state.physicalExamFamilyRiskConsents || [];
    const residents = new Map((state.residents || []).map((item) => [item.id, item]));
    const diseases = state.diseases || [];
    return (state.accounts || []).filter((account) => (account.members || []).some((item) => residentIds.includes(item.residentId))).map((account) => ({
      id: `family-risk-${account.id}`,
      accountId: account.id,
      title: `${account.name || "家庭账户"}健康地图`,
      members: (account.members || []).map((member) => {
        const resident = residents.get(member.residentId) || {};
        const consent = consents.find((item) => item.accountId === account.id && item.residentId === member.residentId && item.status === "active");
        const self = member.relation === "本人";
        const authorized = self || Boolean(consent);
        const memberDiseases = diseases.filter((item) => item.residentId === member.residentId).map((item) => item.type);
        return {
          residentId: member.residentId,
          relation: member.relation,
          name: authorized ? resident.name || member.residentId : "待成员授权",
          authorized,
          riskSignals: authorized ? [...new Set([...memberDiseases, ...(Number(resident.metrics?.systolic || 0) >= 140 ? ["血压风险"] : []), ...(Number(resident.metrics?.glucose || 0) >= 7 ? ["血糖风险"] : []), ...(Number(resident.metrics?.bmi || 0) >= 28 ? ["体重风险"] : [])])] : [],
          consentRequired: !self && !authorized
        };
      }),
      boundary: "每位家庭成员分别授权；未授权成员不展示姓名、疾病或指标。"
    }));
  }

  function buildAchievements(residentId, reports, cases) {
    const residentReports = reports.filter((item) => item.residentId === residentId).sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const years = new Set(residentReports.map((item) => String(item.date || "").slice(0, 4)));
    const rows = [];
    if (residentReports.length) rows.push({ id: `achievement-archive-${residentId}`, residentId, title: "健康档案点亮", detail: `已归集 ${residentReports.length} 份体检报告`, achieved: true });
    if (years.size >= 2) rows.push({ id: `achievement-history-${residentId}`, residentId, title: "连续健康观察", detail: `已形成 ${years.size} 个年度的健康时间轴`, achieved: true });
    const closed = cases.filter((item) => item.residentId === residentId && ["closed", "resolved", "followup-completed"].includes(item.status)).length;
    rows.push({ id: `achievement-followup-${residentId}`, residentId, title: "异常闭环行动", detail: closed ? `已完成 ${closed} 项异常随访` : "完成一次异常随访后点亮", achieved: closed > 0 });
    return rows;
  }

  function buildSimulation(residentId, reports) {
    const latest = reports.filter((item) => item.residentId === residentId).sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
    const abnormal = (latest?.meta?.findings || []).filter((item) => item.abnormal).length;
    const baseline = Math.min(100, 20 + abnormal * 15 + Number(latest?.meta?.careLinkage?.riskScoreContribution || 0));
    return {
      residentId,
      baselineScore: baseline,
      scenarios: SCENARIOS.map((item) => ({ ...item, simulatedScore: Math.max(0, baseline - item.effect), changeRange: `约 -${Math.max(1, item.effect - 2)} 至 -${item.effect + 2} 分` })),
      boundary: "健康教育情景模拟，不预测疾病结局，不用于调整用药或替代复诊。"
    };
  }

  function reviewReportQuality(report) {
    const meta = report.meta || {};
    const issues = [];
    if ((meta.standardCompliance?.gaps || []).length) issues.push(...meta.standardCompliance.gaps.map((gap) => ({ code: gap, level: /signature|qualification|radiation/.test(gap) ? "blocking" : "review", message: qualityMessage(gap) })));
    (meta.findings || []).forEach((finding) => {
      if (!finding.unit && !["ECG"].includes(String(finding.code || "").toUpperCase())) issues.push({ code: "missing-unit", level: "review", message: `${finding.name || finding.code}缺少单位` });
      if (!finding.reference) issues.push({ code: "missing-reference", level: "review", message: `${finding.name || finding.code}缺少参考范围` });
      if (finding.mappingStatus !== "mapped") issues.push({ code: "unmapped-item", level: "blocking", message: `${finding.name || finding.code}未映射项目字典` });
    });
    return { reportId: report.id, residentId: report.residentId, institution: report.source, date: report.date, score: Math.max(0, 100 - issues.filter((item) => item.level === "blocking").length * 15 - issues.filter((item) => item.level !== "blocking").length * 5), issues, status: issues.some((item) => item.level === "blocking") ? "blocked" : issues.length ? "review" : "passed" };
  }

  function buildInstitutionBenchmarks(reports, cases) {
    const groups = new Map();
    reports.forEach((report) => {
      const key = report.meta?.institutionId || report.source || "unknown";
      if (!groups.has(key)) groups.set(key, { institutionId: key, institutionName: report.source || key, reports: [], cases: [] });
      groups.get(key).reports.push(report);
    });
    cases.forEach((item) => {
      const report = reports.find((row) => row.id === item.reportId);
      const key = report?.meta?.institutionId || report?.source;
      if (key && groups.has(key)) groups.get(key).cases.push(item);
    });
    return [...groups.values()].map((group) => {
      const notified = group.cases.filter((item) => item.notificationStatus === "delivered").length;
      const followed = group.cases.filter((item) => ["followup-completed", "closed", "resolved"].includes(item.status) || (item.actions || []).some((action) => action.action === "followup")).length;
      return {
        institutionId: group.institutionId,
        institutionName: group.institutionName,
        reports: group.reports.length,
        abnormalCases: group.cases.length,
        notificationRate: ratio(notified, group.cases.length),
        followupRate: ratio(followed, group.cases.length),
        standardComplianceRate: ratio(group.reports.filter((item) => item.meta?.standardCompliance?.compliant).length, group.reports.length),
        comparisonStatus: group.reports.length >= 5 ? "risk-adjustment-required" : "sample-too-small",
        boundary: "小样本不排名；正式比较前需按人群风险、年龄和项目结构校正。"
      };
    });
  }

  function buildCityRadar(reports, minimumAggregate) {
    const groups = new Map();
    reports.forEach((report) => (report.meta?.findings || []).filter((item) => item.abnormal).forEach((finding) => {
      const code = String(finding.code || "UNKNOWN").toUpperCase();
      if (!groups.has(code)) groups.set(code, { code, name: finding.name || code, reports: new Set(), residents: new Set(), institutions: new Set() });
      const group = groups.get(code);
      group.reports.add(report.id);
      group.residents.add(report.residentId);
      group.institutions.add(report.meta?.institutionId || report.source);
    }));
    return [...groups.values()].map((group) => ({
      code: group.code,
      name: group.name,
      abnormalReports: group.reports.size,
      residentCount: group.residents.size >= minimumAggregate ? group.residents.size : null,
      institutionCount: group.institutions.size,
      privacyStatus: group.residents.size >= minimumAggregate ? "aggregate-visible" : "suppressed-small-cell",
      message: group.residents.size >= minimumAggregate ? "达到最小聚合阈值，可用于区域趋势观察。" : `样本少于 ${minimumAggregate} 人，已抑制人数和明细。`
    }));
  }

  function buildStandardsImpact(reviews) {
    const counts = new Map();
    reviews.flatMap((item) => item.issues).forEach((issue) => counts.set(issue.code, (counts.get(issue.code) || 0) + 1));
    const mapping = {
      "section-physician-signatures": ["接入契约", "医师主数据", "报告详情", "生产门禁"],
      "final-reviewer-qualification": ["人员资质", "主检流程", "医疗质控"],
      "original-signature-binding": ["原文存储", "签名服务", "归档验签"],
      "radiation-governance": ["PACS/设备剂量接口", "风险告知", "放射质控"],
      "missing-unit": ["项目字典", "接入映射", "报告啄木鸟"],
      "missing-reference": ["检验字典", "来源报告", "居民解释"]
    };
    return [...counts.entries()].map(([code, affectedReports]) => ({ code, affectedReports, affectedLayers: mapping[code] || ["接入校验", "报告质量", "上线门禁"], status: "impact-identified", nextAction: "由医务、病案、信息和接入机构共同确认整改证据" }));
  }

  function applyAction(state, payload = {}, context = {}) {
    const action = String(payload.action || "").trim();
    const residentId = String(payload.residentId || "").trim();
    if (!residentId) throw inputError("residentId不能为空");
    if (typeof context.canAccessResident === "function" && !context.canAccessResident(residentId)) throw forbiddenError("无权操作该居民体检亮点功能");
    const now = context.now || new Date().toISOString();
    if (action === "create-passport") {
      if (!Array.isArray(state.physicalExamHealthPassports)) state.physicalExamHealthPassports = [];
      const scopes = normalizeScopes(payload.scopes);
      if (!scopes.length) throw inputError("至少选择一项健康护照授权范围");
      const expiresInDays = Math.min(30, Math.max(1, Number(payload.expiresInDays || 7)));
      const item = { id: context.id || `pe-passport-${stableHash(`${residentId}|${now}`)}`, residentId, scopes, purpose: String(payload.purpose || "转诊/复诊资料调阅").trim(), status: "active", createdAt: now, expiresAt: addDays(now, expiresInDays), createdBy: context.actor || "resident", auditRequired: true };
      state.physicalExamHealthPassports.unshift(item);
      return { type: "passport", item: maskPassport(item) };
    }
    if (action === "revoke-passport") {
      const item = (state.physicalExamHealthPassports || []).find((row) => row.id === String(payload.passportId || "") && row.residentId === residentId);
      if (!item) throw inputError("未找到可撤销的健康护照授权");
      item.status = "revoked";
      item.revokedAt = now;
      item.revokedBy = context.actor || "resident";
      return { type: "passport", item: maskPassport(item) };
    }
    if (action === "request-review") {
      if (!Array.isArray(state.physicalExamReviewRequests)) state.physicalExamReviewRequests = [];
      const reportId = String(payload.reportId || "").trim();
      const report = (state.personalRecords || []).find((item) => item.id === reportId && item.residentId === residentId);
      if (!report) throw inputError("未找到居民体检报告");
      const existing = state.physicalExamReviewRequests.find((item) => item.reportId === reportId && !["closed", "cancelled"].includes(item.status));
      if (existing) return { type: "review-request", item: existing, duplicate: true };
      const item = { id: context.id || `pe-review-${stableHash(`${reportId}|${now}`)}`, residentId, reportId, department: String(payload.department || "全科").trim(), preferredDate: String(payload.preferredDate || addDays(now, 7)).slice(0, 10), reason: String(payload.reason || "体检异常复核").trim(), status: "pending-slot", createdAt: now, createdBy: context.actor || "resident", sourceType: "physical-exam" };
      state.physicalExamReviewRequests.unshift(item);
      return { type: "review-request", item };
    }
    if (action === "authorize-family-map") {
      if (!Array.isArray(state.physicalExamFamilyRiskConsents)) state.physicalExamFamilyRiskConsents = [];
      const accountId = String(payload.accountId || "").trim();
      const exists = state.physicalExamFamilyRiskConsents.find((item) => item.accountId === accountId && item.residentId === residentId);
      const item = exists || { id: `pe-family-consent-${stableHash(`${accountId}|${residentId}`)}`, accountId, residentId };
      Object.assign(item, { status: "active", consentVersion: "family-risk-map-v1", authorizedAt: now, authorizedBy: context.actor || "resident", scope: ["risk-signals-only"], expiresAt: addDays(now, 365) });
      if (!exists) state.physicalExamFamilyRiskConsents.unshift(item);
      return { type: "family-consent", item };
    }
    if (action === "acknowledge-action") {
      if (!Array.isArray(state.physicalExamHighlightActions)) state.physicalExamHighlightActions = [];
      const item = { id: `pe-highlight-action-${stableHash(`${payload.actionCardId}|${residentId}`)}`, residentId, actionCardId: String(payload.actionCardId || "").trim(), status: "resident-acknowledged", acknowledgedAt: now, acknowledgedBy: context.actor || "resident" };
      const index = state.physicalExamHighlightActions.findIndex((row) => row.id === item.id);
      if (index >= 0) state.physicalExamHighlightActions[index] = { ...state.physicalExamHighlightActions[index], ...item };
      else state.physicalExamHighlightActions.unshift(item);
      return { type: "highlight-action", item };
    }
    throw inputError("不支持的体检亮点动作");
  }

  function criticalSteps(item = {}) {
    const actions = item.actions || [];
    return [
      { id: "confirm", name: "医师确认", completed: item.confirmationStatus === "confirmed" || actions.some((action) => action.action === "confirm") },
      { id: "notify", name: "通知居民", completed: item.notificationStatus === "delivered" || actions.some((action) => action.action === "notify") },
      { id: "arrange", name: "复查/专科", completed: actions.some((action) => ["schedule", "assign"].includes(action.action)) },
      { id: "followup", name: "回收诊疗结果", completed: ["followup-completed", "closed", "resolved"].includes(item.status) || actions.some((action) => action.action === "followup") },
      { id: "close", name: "闭环关闭", completed: ["closed", "resolved"].includes(item.status) }
    ];
  }

  function extractMeasurements(finding) {
    const code = String(finding.code || "").toUpperCase();
    if (code === "BP") {
      const [systolic, diastolic] = String(finding.value || "").split("/").map(Number);
      return [{ code: "SBP", value: systolic, unit: finding.unit || "mmHg" }, { code: "DBP", value: diastolic, unit: finding.unit || "mmHg" }].filter((item) => Number.isFinite(item.value));
    }
    const value = Number.parseFloat(String(finding.value || "").replace(/[^0-9.-]/g, ""));
    return Number.isFinite(value) ? [{ code, value, unit: finding.unit || "" }] : [];
  }

  function indicatorName(code) {
    return { SBP: "收缩压", DBP: "舒张压", GLU: "空腹血糖", HBA1C: "糖化血红蛋白", BMI: "体质指数", CRE: "肌酐" }[code] || KNOWLEDGE[code]?.title || code;
  }

  function qualityMessage(code) {
    return {
      "section-physician-signatures": "分项检查结果缺少可验证医师签名",
      "final-reviewer-qualification": "主检医师资格或培训证据不完整",
      "original-signature-binding": "原始报告摘要未与签名覆盖文档绑定",
      "radiation-governance": "放射检查正当化、告知、防护或剂量记录不完整",
      "signature-production": "仍为演示签名，不能计入生产合规",
      "processing-basis": "告知、授权或最小必要证据不完整"
    }[code] || `规范检查未通过：${code}`;
  }

  function maskPassport(item) {
    return { ...item, accessRef: `AUTH-${String(item.id || "").slice(-8).toUpperCase()}`, scopes: [...(item.scopes || [])] };
  }

  function normalizeScopes(value) {
    const allowed = new Set(["reports", "trends", "abnormal-findings", "recommendations", "radiation-ledger", "care-plan"]);
    return [...new Set((Array.isArray(value) ? value : String(value || "").split(",")).map((item) => String(item).trim()).filter((item) => allowed.has(item)))];
  }

  function ageAt(birthDate, atDate) {
    const birth = new Date(`${String(birthDate).slice(0, 10)}T00:00:00Z`);
    const at = new Date(`${String(atDate).slice(0, 10)}T00:00:00Z`);
    if (Number.isNaN(birth.getTime()) || Number.isNaN(at.getTime())) return null;
    return Math.max(0, Math.floor((at - birth) / 31557600000));
  }

  function daysBetween(a, b) {
    const start = new Date(`${String(a).slice(0, 10)}T00:00:00Z`);
    const end = new Date(`${String(b).slice(0, 10)}T00:00:00Z`);
    return Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) ? Infinity : Math.max(0, Math.round((end - start) / 86400000));
  }

  function addDays(value, days) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    date.setUTCDate(date.getUTCDate() + Number(days || 0));
    return date.toISOString().slice(0, 10);
  }

  function ratio(numerator, denominator) {
    return denominator ? Math.round((numerator / denominator) * 1000) / 10 : null;
  }

  function round(value, digits) {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
  }

  function unique(value, index, list) {
    return list.indexOf(value) === index;
  }

  function stableHash(value) {
    let hash = 2166136261;
    for (const char of String(value || "")) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  function inputError(message) {
    const error = new Error(message);
    error.statusCode = 400;
    return error;
  }

  function forbiddenError(message) {
    const error = new Error(message);
    error.statusCode = 403;
    return error;
  }

  return { VERSION, KNOWLEDGE, SCENARIOS, applyAction, build, buildSimulation, reviewReportQuality };
});
