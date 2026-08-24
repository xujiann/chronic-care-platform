"use strict";

function createImagingStudyQualityControlCommand(user, study, payload, ports) {
  const { randomUUID } = ports;
  const review = {
    id: `icq-${randomUUID()}`,
    studyId: study.id,
    group: String(payload.group || "影像云抽样质控").trim(),
    scanScore: Number(payload.scanScore || 90),
    reportScore: Number(payload.reportScore || 90),
    reviewer: user.name,
    result: String(payload.result || "质控通过").trim(),
    sampledAt: new Date().toISOString(),
    comment: String(payload.comment || "质控记录已回写影像云。").trim()
  };
  const updatedStudy = {
    ...study,
    qcStatus: review.result,
    updatedAt: new Date().toISOString(),
    emrSyncStatus: /通过|合格|passed/i.test(review.result)
      ? "已写入电子病历索引"
      : study.emrSyncStatus
  };
  return { review, updatedStudy };
}

function commitImagingStudyQualityControl(data, studyIndex, command, fhirReportSync) {
  const { review, updatedStudy } = command;
  updatedStudy.fhirDiagnosticReportId = fhirReportSync.diagnosticReport.id;
  updatedStudy.fhirReportSyncStatus = "synced";
  updatedStudy.fhirReportSyncedAt = new Date().toISOString();
  data.imageCloudStudies[studyIndex] = updatedStudy;
  data.imageCloudQualityReviews = [
    review,
    ...(Array.isArray(data.imageCloudQualityReviews) ? data.imageCloudQualityReviews : [])
  ].slice(0, 300);
  return { study: data.imageCloudStudies[studyIndex], review, fhirReportSync };
}

module.exports = {
  commitImagingStudyQualityControl,
  createImagingStudyQualityControlCommand
};
