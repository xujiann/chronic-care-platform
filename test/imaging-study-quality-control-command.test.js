"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  commitImagingStudyQualityControl,
  createImagingStudyQualityControlCommand
} = require("../src/clinical-specialties/imaging/study-quality-control-command");

test("imaging quality control builds the legacy review and persists the FHIR projection after publish", () => {
  const study = {
    id: "study-001",
    residentId: "resident-001",
    qcStatus: "待质控",
    emrSyncStatus: "待报告审核后写入"
  };
  const existingReviews = Array.from({ length: 300 }, (_, index) => ({ id: `existing-${index}` }));
  const data = { imageCloudStudies: [study], imageCloudQualityReviews: existingReviews };
  const user = { name: "影像质控员", role: "institution" };
  const command = createImagingStudyQualityControlCommand(user, study, {}, {
    randomUUID: () => "review-001"
  });
  assert.equal(data.imageCloudStudies[0], study, "local state is unchanged before the provider returns");
  assert.equal(data.imageCloudQualityReviews, existingReviews);
  const fhirReportSync = { diagnosticReport: { id: "diagnostic-report-001" }, status: "published" };
  const result = commitImagingStudyQualityControl(data, 0, command, fhirReportSync);

  assert.equal(result.review.id, "icq-review-001");
  assert.equal(result.review.studyId, "study-001");
  assert.equal(result.review.group, "影像云抽样质控");
  assert.equal(result.review.scanScore, 90);
  assert.equal(result.review.reportScore, 90);
  assert.equal(result.review.reviewer, "影像质控员");
  assert.equal(result.review.result, "质控通过");
  assert.equal(result.review.comment, "质控记录已回写影像云。");
  assert.match(result.review.sampledAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(result.study.qcStatus, "质控通过");
  assert.equal(result.study.emrSyncStatus, "已写入电子病历索引");
  assert.equal(result.study.fhirDiagnosticReportId, "diagnostic-report-001");
  assert.equal(result.study.fhirReportSyncStatus, "synced");
  assert.match(result.study.fhirReportSyncedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(data.imageCloudStudies[0], result.study);
  assert.equal(data.imageCloudQualityReviews.length, 300);
  assert.equal(data.imageCloudQualityReviews[0], result.review);
  assert.equal(data.imageCloudQualityReviews.at(-1).id, "existing-298");
});

test("imaging quality control preserves the prior EMR state for a non-passing result", () => {
  const study = { id: "study-002", emrSyncStatus: "保持原状态" };
  const data = { imageCloudStudies: [study] };

  const command = createImagingStudyQualityControlCommand({ name: "复核员" }, study, {
    group: " 专项复核 ",
    scanScore: "82",
    reportScore: "79",
    result: " 退回整改 ",
    comment: " 需要重采 "
  }, {
    randomUUID: () => "review-002"
  });
  const result = commitImagingStudyQualityControl(
    data,
    0,
    command,
    { diagnosticReport: { id: "diagnostic-report-002" } }
  );

  assert.equal(result.review.group, "专项复核");
  assert.equal(result.review.scanScore, 82);
  assert.equal(result.review.reportScore, 79);
  assert.equal(result.review.result, "退回整改");
  assert.equal(result.review.comment, "需要重采");
  assert.equal(result.study.emrSyncStatus, "保持原状态");
});

test("imaging quality control preparation leaves local state untouched until a receipt is committed", () => {
  const study = { id: "study-003", qcStatus: "待质控", emrSyncStatus: "待写入" };
  const existingReviews = [{ id: "existing-review" }];
  const data = { imageCloudStudies: [study], imageCloudQualityReviews: existingReviews };

  createImagingStudyQualityControlCommand(
    { name: "复核员" },
    study,
    {},
    { randomUUID: () => "review-003" }
  );

  assert.equal(data.imageCloudStudies[0], study);
  assert.equal(data.imageCloudQualityReviews, existingReviews);
  assert.equal(data.imageCloudQualityReviews.length, 1);
});
