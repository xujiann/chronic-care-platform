"use strict";

function qualityControlInputError(message) {
  const error = new Error(message);
  error.code = "IMAGING_QC_INPUT_INVALID";
  error.statusCode = 400;
  return error;
}

function normalizeScore(value, fallback, label) {
  if (value !== undefined && value !== null && typeof value !== "string" && typeof value !== "number") {
    throw qualityControlInputError(`${label}必须是 0 至 100 之间的数字`);
  }
  const score = value === undefined || value === null || String(value).trim() === ""
    ? fallback
    : Number(value);
  if (!Number.isFinite(score) || score < 0 || score > 100) {
    throw qualityControlInputError(`${label}必须是 0 至 100 之间的数字`);
  }
  return score;
}

function createImagingStudyQualityControlCommand(user, study, payload, ports) {
  const input = payload && typeof payload === "object" ? payload : {};
  const { randomUUID } = ports;
  const scanScore = normalizeScore(input.scanScore, 90, "扫描评分");
  const reportScore = normalizeScore(input.reportScore, 90, "报告评分");
  const review = {
    id: `icq-${randomUUID()}`,
    studyId: study.id,
    group: String(input.group || "影像云抽样质控").trim(),
    scanScore,
    reportScore,
    reviewer: user.name,
    result: String(input.result || "质控通过").trim(),
    sampledAt: new Date().toISOString(),
    comment: String(input.comment || "质控记录已回写影像云。").trim()
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

function validateImagingStudyQualityControlReceipt(receipt) {
  const diagnosticReport = receipt?.diagnosticReport;
  if (!diagnosticReport || typeof diagnosticReport !== "object" || !String(diagnosticReport.id || "").trim()) {
    const error = new Error("FHIR DiagnosticReport 回执缺少已确认的资源标识");
    error.code = "IMAGING_QC_FHIR_RECEIPT_INVALID";
    error.providerOutcome = "unknown";
    throw error;
  }
  return receipt;
}

function commitImagingStudyQualityControl(data, studyIndex, command, fhirReportSync) {
  const { review, updatedStudy } = command;
  const verifiedReceipt = validateImagingStudyQualityControlReceipt(fhirReportSync);
  updatedStudy.fhirDiagnosticReportId = verifiedReceipt.diagnosticReport.id;
  updatedStudy.fhirReportSyncStatus = "synced";
  updatedStudy.fhirReportSyncedAt = new Date().toISOString();
  data.imageCloudStudies[studyIndex] = updatedStudy;
  data.imageCloudQualityReviews = [
    review,
    ...(Array.isArray(data.imageCloudQualityReviews) ? data.imageCloudQualityReviews : [])
  ].slice(0, 300);
  return { study: data.imageCloudStudies[studyIndex], review, fhirReportSync: verifiedReceipt };
}

module.exports = {
  commitImagingStudyQualityControl,
  createImagingStudyQualityControlCommand,
  validateImagingStudyQualityControlReceipt
};
