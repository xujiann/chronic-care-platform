const assert = require("node:assert/strict");
const test = require("node:test");
const Governance = require("../imaging-cloud-governance");

const user = { id: "u-governance", username: "governance", role: "commission" };
const study = { id: "study-ct", institutionCode: "MR1", modality: "CT", bodyPart: "胸部", studyDate: new Date().toISOString().slice(0, 10), qcStatus: "质控通过", diagnosticLevel: true, integrityCheck: "passed" };

test("imaging recognition governance evaluates catalog, quality, integrity and negative rules", () => {
  const data = {};
  const accepted = Governance.evaluateStudy(data, study);
  assert.equal(accepted.eligible, true);
  assert.equal(accepted.decision, "eligible-for-manual-recognition");
  const rejected = Governance.evaluateStudy(data, { ...study, qcStatus: "待复核", diagnosticLevel: false }, { clinicalChange: true });
  assert.equal(rejected.eligible, false);
  assert.deepEqual(rejected.reasons.sort(), ["clinical-change", "dicom-incomplete", "quality-not-qualified"]);
});

test("catalog changes require evidence and mobile performance events stay minimized", () => {
  const data = {};
  assert.throws(() => Governance.updateCatalog(data, user, "IMG-RC-CT-CHEST", { status: "suspended" }), /policyVersion/);
  const item = Governance.updateCatalog(data, user, "IMG-RC-CT-CHEST", { status: "suspended", policyVersion: "2026.07", evidenceRef: "policy/recognition-negative-list-v2" });
  assert.equal(item.status, "suspended");
  const event = Governance.recordPerformance(data, user, study, { firstFrameMs: 1200, seriesLoadMs: 4200, viewportClass: "mobile", networkClass: "5g", patientName: "ignored" });
  assert.equal(event.withinTarget, true);
  assert.equal(Object.hasOwn(event, "patientName"), false);
  assert.equal(Governance.dashboard(data, [study]).performance.samples, 1);
});

test("quality plans prevent low-score CT results from being marked as passed", () => {
  const data = {};
  const failed = Governance.evaluateQualityReview(data, study, { scanScore: 79, reportScore: 99, result: "质控通过" });
  assert.equal(failed.passed, false);
  assert.equal(failed.result, "质控不通过");
  const passed = Governance.evaluateQualityReview(data, study, { scanScore: 90, reportScore: 90, result: "质控通过" });
  assert.equal(passed.passed, true);
  assert.equal(passed.plan.id, "IMG-QP-CT");
});

test("governance dashboard ranks institutions by quality and diagnostic-level availability", () => {
  const ranking = Governance.institutionRanking([
    { ...study, institutionCode: "MR1", institutionName: "影像中心", mutualRecognitionStatus: "已互认" },
    { ...study, id: "study-dr", institutionCode: "MR2", institutionName: "基层机构", modality: "DR", qcStatus: "待复核", diagnosticLevel: false, mutualRecognitionStatus: "待复核" }
  ]);
  assert.equal(ranking[0].institutionCode, "MR1");
  assert.equal(ranking[0].qualityPassRate, 100);
  assert.equal(ranking[1].qualityPassRate, 0);
  assert.equal(ranking[1].pendingRecognition, 1);
});
