const assert = require("node:assert/strict");
const test = require("node:test");
const {
  EVALUATION_PROJECTS,
  buildDigitalHospitalEvaluationCatalog,
  buildDigitalHospitalPilotBoard,
  buildDigitalHospitalPilotOperations,
  calculatePackResult,
  createDigitalHospitalPilotInstitution,
  normalizeDigitalHospitalCollectionJobAction,
  normalizeDigitalHospitalEvaluationEvidenceAction,
  normalizeDigitalHospitalPilotInstitutionAction,
  normalizeDigitalHospitalPreAssessmentAction,
  runDigitalHospitalPreAssessment,
  seedDigitalHospitalCollectionJobs,
  seedDigitalHospitalEvaluationEvidence,
  seedDigitalHospitalPilotInstitutions,
  seedPilotResponses
} = require("../digital-hospital-evaluation");

const commission = { id: "u-health", username: "health", name: "省级评价员", role: "commission", orgCode: "ORG-HEALTH-DL" };
const reviewer = { id: "u-city", username: "city", name: "独立复核员", role: "commission", orgCode: "ORG-CITY-DL" };
const hospital = { id: "u-hospital", username: "hospital", name: "医院管理员", role: "institution", orgCode: "MR1", orgName: "大连市中心医院" };

test("evaluation catalog models four official structures and 70 clause-level projects", () => {
  const catalog = buildDigitalHospitalEvaluationCatalog();
  assert.equal(catalog.ok, true);
  assert.deepEqual(catalog.summary, { packs: 4, projects: 70, clauses: 70, profiles: 1 });
  assert.equal(catalog.packs.find((item) => item.id === "emr").projects, 39);
  assert.equal(catalog.packs.find((item) => item.id === "smart-service").projects, 17);
  assert.equal(catalog.packs.find((item) => item.id === "smart-management").projects, 10);
  assert.equal(catalog.packs.find((item) => item.id === "interoperability").projects, 4);
});

test("EMR level engine applies basic, optional, coverage and data-quality thresholds", () => {
  const responses = seedPilotResponses();
  const target = calculatePackResult("emr", responses, 4);
  assert.equal(target.formalResult, false);
  assert.equal(target.resultType, "pilot-simulation");
  assert.ok(target.gapCount > 0);
  const emrResponses = EVALUATION_PROJECTS.filter((item) => item.packId === "emr").map((project) => ({ projectId: project.id, implemented: true, applicationCoverage: 100, dataQualityIndex: 1, evidenceRefs: [project.id], noPatientPii: true }));
  const complete = calculatePackResult("emr", emrResponses, 4);
  assert.equal(complete.targetMet, true);
  assert.equal(complete.gapCount, 0);
});

test("collection validation and evidence verification enforce scope, minimization and independent review", () => {
  const job = seedDigitalHospitalCollectionJobs()[0];
  assert.throws(() => normalizeDigitalHospitalCollectionJobAction(job, { action: "run-validation", sampleSize: 100, validRows: 99, receiptRef: "R1", note: "运行校验", noPatientPii: false }, hospital), /noPatientPii/);
  const updated = normalizeDigitalHospitalCollectionJobAction(job, { action: "run-validation", sampleSize: 100, validRows: 99, receiptRef: "R1", note: "运行受控校验", noPatientPii: true }, hospital, { now: "2026-07-17T08:00:00.000Z" });
  assert.equal(updated.dataQualityIndex, 0.99);

  let evidence = seedDigitalHospitalEvaluationEvidence().find((item) => item.status === "site-pending");
  evidence = normalizeDigitalHospitalEvaluationEvidenceAction(evidence, { action: "record-evidence", evidenceRef: "SITE-001", evidenceLevel: "site", noPatientPii: true, note: "登记现场联调证据" }, hospital);
  assert.equal(evidence.status, "evidence-recorded");
  assert.throws(() => normalizeDigitalHospitalEvaluationEvidenceAction(evidence, { action: "verify-evidence", note: "尝试自行复核" }, hospital), /commission reviewer/);
  evidence = normalizeDigitalHospitalEvaluationEvidenceAction(evidence, { action: "verify-evidence", note: "独立复核现场证据" }, reviewer);
  assert.equal(evidence.status, "verified");
  assert.equal(evidence.formalEvidence, true);
});

test("pre-assessment creates findings and requires closure before independent acceptance", () => {
  let assessment = runDigitalHospitalPreAssessment({ institutionId: "MR1", institutionName: "大连市中心医院" }, hospital, { id: "dhpa-test", now: "2026-07-17T08:00:00.000Z" });
  assert.equal(assessment.results.length, 4);
  assert.ok(assessment.findings.length > 0);
  const finding = assessment.findings[0];
  assessment = normalizeDigitalHospitalPreAssessmentAction(assessment, { action: "assign-finding", findingId: finding.id, assignedTo: "医院信息中心", dueAt: "2026-08-10", note: "分派首项整改任务" }, hospital);
  assessment = normalizeDigitalHospitalPreAssessmentAction(assessment, { action: "resolve-finding", findingId: finding.id, evidenceRef: "RECT-001", noPatientPii: true, note: "完成整改并登记证据" }, hospital);
  assert.equal(assessment.findings[0].status, "resolved");
  assert.throws(() => normalizeDigitalHospitalPreAssessmentAction(assessment, { action: "submit-review", note: "提交复核" }, hospital), /all findings/);
  assessment.findings = assessment.findings.map((item) => ({ ...item, status: "resolved", evidenceRefs: item.evidenceRefs.length ? item.evidenceRefs : [`RECT-${item.id}`] }));
  assessment = normalizeDigitalHospitalPreAssessmentAction(assessment, { action: "submit-review", note: "全部整改完成后提交复核" }, hospital);
  assert.throws(() => normalizeDigitalHospitalPreAssessmentAction(assessment, { action: "accept-preassessment", note: "医院尝试接受" }, hospital), /commission reviewer/);
  assessment = normalizeDigitalHospitalPreAssessmentAction(assessment, { action: "accept-preassessment", note: "独立审核后接受进入试点" }, commission);
  assert.equal(assessment.status, "accepted-for-pilot");
});

test("pilot readiness is ready for controlled pilot while formal site evidence remains blocked", () => {
  const board = buildDigitalHospitalPilotBoard({}, commission);
  assert.equal(board.ok, true);
  assert.equal(board.functionalState, "pilot-launch-ready");
  assert.equal(board.formalGoLiveState, "blocked-until-site-evidence-signed");
  assert.equal(board.summary.collectionJobs, 6);
  assert.equal(board.summary.pilotInstitutions, 2);
  assert.equal(board.summary.activePilotInstitutions, 1);
  assert.equal(board.checks.every((item) => item.passed), true);
});

test("multi-hospital pilot onboarding requires scoped submission and independent approval", () => {
  let institution = createDigitalHospitalPilotInstitution({ institutionId: "PILOT-03", institutionName: "第三试点医院", owner: "信息中心", note: "登记第三试点医院" }, commission, { id: "dhpi-test", now: "2026-07-18T08:00:00.000Z" });
  const pilotHospital = { ...hospital, id: "u-pilot-03", username: "pilot03", orgCode: "PILOT-03", orgName: "第三试点医院" };
  const readiness = Object.fromEntries(["organizationOwner", "scopedAccounts", "dataBoundary", "collectionPlan", "rollbackPlan", "supportRoster"].map((key) => [key, true]));
  assert.throws(() => normalizeDigitalHospitalPilotInstitutionAction(institution, { action: "submit-readiness", readiness, evidenceRefs: ["A", "B", "C"], noPatientPii: true, note: "越权提交准入材料" }, hospital), /another pilot institution/);
  institution = normalizeDigitalHospitalPilotInstitutionAction(institution, { action: "submit-readiness", readiness, evidenceRefs: ["A", "B", "C"], noPatientPii: true, note: "提交六项准入材料" }, pilotHospital);
  assert.equal(institution.status, "ready-for-review");
  institution = normalizeDigitalHospitalPilotInstitutionAction(institution, { action: "approve-pilot", note: "独立审核批准受控试点" }, reviewer);
  assert.equal(institution.status, "active");
  assert.equal(institution.whitelistEnabled, true);
  institution = normalizeDigitalHospitalPilotInstitutionAction(institution, { action: "pause-pilot", note: "演练暂停试点入口" }, commission);
  assert.equal(institution.whitelistEnabled, false);
  institution = normalizeDigitalHospitalPilotInstitutionAction(institution, { action: "resume-pilot", note: "复核后恢复试点入口" }, commission);
  institution = normalizeDigitalHospitalPilotInstitutionAction(institution, { action: "advance-stage", p0ClearanceRef: "P0-CLEAR-001", note: "P0清零后进入观察期" }, commission);
  assert.equal(institution.stage, "observation");
});

test("pilot operations aggregates institution scope and overdue P0 SLA", () => {
  const assessment = runDigitalHospitalPreAssessment({ institutionId: "MR1", institutionName: "大连市中心医院" }, hospital, { id: "dhpa-overdue", now: "2026-07-17T08:00:00.000Z" });
  const p0Finding = assessment.findings.find((item) => item.severity === "P0");
  p0Finding.assignedTo = "医院信息中心";
  p0Finding.dueAt = "2026-07-17";
  p0Finding.status = "in-progress";
  const data = { digitalHospitalPilotInstitutions: seedDigitalHospitalPilotInstitutions(), digitalHospitalPreAssessments: [assessment] };
  const board = buildDigitalHospitalPilotOperations(data, hospital, { today: "2026-07-18" });
  assert.equal(board.institutions.length, 1);
  assert.equal(board.institutions[0].institutionId, "MR1");
  assert.equal(board.summary.overdueP0, 1);
});
