const assert = require("node:assert/strict");
const test = require("node:test");
const {
  DIGITAL_HOSPITAL_SELF_ASSESSMENT_INDICATORS,
  buildDigitalHospitalSelfAssessmentBoard,
  createDigitalHospitalSelfAssessment,
  normalizeDigitalHospitalSelfAssessmentAction,
  seedDigitalHospitalSelfAssessments
} = require("../digital-hospital-self-assessment");

const commission = { id: "u-health", username: "health", name: "省级审核员", role: "commission", orgCode: "ORG-HEALTH-DL" };
const secondCommission = { id: "u-city", username: "city", name: "独立复核员", role: "commission", orgCode: "ORG-CITY-DL" };
const hospital = { id: "u-hospital", username: "hospital", name: "医院管理员", role: "institution", orgCode: "MR1" };
const community = { id: "u-community", username: "community", name: "基层管理员", role: "institution", orgCode: "MR3" };
const options = { now: "2026-07-17T08:00:00.000Z", id: "dhsa-test" };

test("self-assessment board covers six domains and scopes institution tasks", () => {
  const data = { digitalHospitalSelfAssessments: seedDigitalHospitalSelfAssessments(options) };
  const commissionBoard = buildDigitalHospitalSelfAssessmentBoard(data, commission, {}, options);
  const hospitalBoard = buildDigitalHospitalSelfAssessmentBoard(data, hospital, {}, options);
  assert.equal(commissionBoard.ok, true);
  assert.equal(commissionBoard.indicators.length, 12);
  assert.equal(new Set(commissionBoard.indicators.map((item) => item.domain)).size, 6);
  assert.equal(commissionBoard.summary.assessments, 2);
  assert.equal(hospitalBoard.summary.assessments, 1);
  assert.equal(hospitalBoard.assessments[0].institutionId, "MR1");
  assert.equal(buildDigitalHospitalSelfAssessmentBoard(data, community, {}, options).assessments[0].institutionId, "MR3");
});

test("commission assigns an assessment and institution cannot assign one", () => {
  const created = createDigitalHospitalSelfAssessment({
    institutionId: "MR5",
    institutionName: "试点医院",
    cycle: "2026-pilot",
    targetLevel: "二级医院试点",
    assignedTo: "信息科",
    dueAt: "2026-08-10",
    note: "纳入首批自评。"
  }, commission, options);
  assert.equal(created.id, "dhsa-test");
  assert.equal(created.status, "assigned");
  assert.throws(() => createDigitalHospitalSelfAssessment({ institutionId: "MR5" }, hospital, options), /仅卫健管理端/);
});

test("institution completes controlled-reference responses and submits a declaration", () => {
  let assessment = createDigitalHospitalSelfAssessment({
    institutionId: "MR1",
    institutionName: "大连市中心医院",
    cycle: "2026-pilot",
    targetLevel: "三级综合医院试点",
    assignedTo: "医院信息中心",
    dueAt: "2026-08-10",
    note: "测试自评任务。"
  }, commission, options);
  assert.throws(() => normalizeDigitalHospitalSelfAssessmentAction(assessment, {
    action: "save-draft",
    indicatorId: DIGITAL_HOSPITAL_SELF_ASSESSMENT_INDICATORS[0].id,
    answer: "compliant",
    evidenceRefs: ["SITE-E1"],
    noPatientPii: false
  }, hospital, options), /不含患者可识别信息/);

  DIGITAL_HOSPITAL_SELF_ASSESSMENT_INDICATORS.forEach((indicator, index) => {
    assessment = normalizeDigitalHospitalSelfAssessmentAction(assessment, {
      action: "save-draft",
      indicatorId: indicator.id,
      answer: index === 3 ? "partial" : "compliant",
      evidenceRefs: [`SITE-${index + 1}`],
      note: index === 3 ? "现场签字材料待补。" : "受控引用。",
      noPatientPii: true
    }, hospital, options).assessment;
  });
  const submitted = normalizeDigitalHospitalSelfAssessmentAction(assessment, {
    action: "submit-assessment",
    declarationAccepted: true,
    noPatientPii: true,
    note: "确认提交十二项最小化自评证据。"
  }, hospital, options).assessment;
  assert.equal(submitted.status, "submitted");
  assert.equal(submitted.declaration.submittedByKey, "u-hospital");
  assert.equal(buildDigitalHospitalSelfAssessmentBoard({ digitalHospitalSelfAssessments: [submitted] }, commission, {}, options).assessments[0].summary.completionPercent, 100);
});

test("commission requests correction and a different reviewer accepts resubmission", () => {
  let assessment = seedDigitalHospitalSelfAssessments(options)[1];
  assessment = normalizeDigitalHospitalSelfAssessmentAction(assessment, {
    action: "save-draft",
    indicatorId: "dhsi-resilience",
    answer: "compliant",
    evidenceRefs: ["DR-REHEARSAL-2026-01"],
    note: "补充恢复演练回执。",
    noPatientPii: true
  }, community, options).assessment;
  assessment = normalizeDigitalHospitalSelfAssessmentAction(assessment, {
    action: "submit-assessment",
    declarationAccepted: true,
    noPatientPii: true,
    note: "完成补正并重新提交。"
  }, community, options).assessment;
  assert.equal(assessment.status, "resubmitted");
  const accepted = normalizeDigitalHospitalSelfAssessmentAction(assessment, {
    action: "accept-assessment",
    note: "补正证据完整，接受本轮自评。"
  }, secondCommission, options).assessment;
  assert.equal(accepted.status, "accepted");
  assert.equal(accepted.review.reviewedByKey, "u-city");

  const submittedByCommission = {
    ...assessment,
    declaration: { ...assessment.declaration, submittedByKey: "u-health" }
  };
  assert.throws(() => normalizeDigitalHospitalSelfAssessmentAction(submittedByCommission, {
    action: "accept-assessment",
    note: "不能自审。"
  }, commission, options), /必须独立/);
});
