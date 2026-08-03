const test = require("node:test");
const assert = require("node:assert/strict");

const {
  VIEWER_ACCEPTANCE_THRESHOLDS,
  evaluateViewerPerformance,
  buildRegulatoryStatistics,
  buildImagingDevelopmentPlanReview
} = require("../imaging-cloud-planning");

const DIGEST = `sha256:${"a".repeat(64)}`;

function acceptedViewerRun() {
  return {
    dataClass: "deidentified",
    protocols: ["DICOMweb", "WADO-RS"],
    diagnosticRendering: true,
    losslessSource: true,
    mobileFirstPixelMs: 1800,
    diagnosticSeriesLoadMs: 7200,
    interactionP95Ms: 120,
    failedObjectRate: 0,
    tools: [...VIEWER_ACCEPTANCE_THRESHOLDS.requiredTools],
    auditEvents: [...VIEWER_ACCEPTANCE_THRESHOLDS.requiredAuditEvents],
    originalDicomStoredOnTerminal: false,
    evidenceRef: "viewer-performance-run-001",
    evidenceDigest: DIGEST,
    productionEvidence: true
  };
}

function payload() {
  return {
    studies: [
      { id: "study-1", studyDate: "2026-07-10", institutionCode: "H01", cityCode: "C01", imageCount: 120, reportStatus: "signed", integrityStatus: "verified" },
      { id: "study-2", studyDate: "2026-07-11", institutionCode: "H01", cityCode: "C01", imageCount: 80, reportConclusion: "normal", integrityStatus: "failed" },
      { id: "study-3", studyDate: "2026-07-12", institutionCode: "H02", cityCode: "C02", imageCount: 60, reportStatus: "signed", integrityStatus: "verified" }
    ],
    shares: [{ studyId: "study-1", createdAt: "2026-07-10T09:00:00Z" }],
    qualityReviews: [{ studyId: "study-1", reviewedAt: "2026-07-10T10:00:00Z" }],
    consultations: [{ studyId: "study-3", createdAt: "2026-07-12T11:00:00Z" }],
    accessEvents: [
      { studyId: "study-1", createdAt: "2026-07-10T12:00:00Z" },
      { studyId: "study-3", createdAt: "2026-07-12T12:00:00Z" }
    ]
  };
}

test("diagnostic viewer acceptance enforces performance, audit and terminal-storage hard stops", () => {
  const accepted = evaluateViewerPerformance(acceptedViewerRun());
  assert.equal(accepted.ok, true);
  assert.equal(accepted.productionEvidence, true);
  assert.equal(accepted.summary.passed, accepted.summary.total);

  const rejected = evaluateViewerPerformance({
    ...acceptedViewerRun(),
    mobileFirstPixelMs: 5000,
    auditEvents: ["viewer-opened"],
    originalDicomStoredOnTerminal: true
  });
  assert.equal(rejected.ok, false);
  assert.ok(rejected.hardStops.includes("mobile-first-pixel"));
  assert.ok(rejected.hardStops.includes("access-audit"));
  assert.ok(rejected.hardStops.includes("terminal-storage-boundary"));
});

test("viewer performance cannot become production evidence from an otherwise valid synthetic run", () => {
  const result = evaluateViewerPerformance({
    ...acceptedViewerRun(),
    dataClass: "synthetic",
    productionEvidence: false
  });
  assert.equal(result.ok, true);
  assert.equal(result.productionEvidence, false);
  assert.match(result.boundary, /does not replace/);
});

test("regulatory statistics aggregate institution and city activity without patient identifiers", () => {
  const report = buildRegulatoryStatistics(payload(), { granularity: "month" });
  assert.equal(report.status, "regulatory-statistics-code-ready");
  assert.equal(report.totals.uploads, 3);
  assert.equal(report.totals.images, 260);
  assert.equal(report.totals.views, 2);
  assert.equal(report.totals.shares, 1);
  assert.equal(report.totals.qualityReviews, 1);
  assert.equal(report.totals.consultations, 1);
  assert.equal(report.institutionRanking[0].institutionCode, "H01");
  assert.equal(report.anomalyInstitutions.some((item) => item.institutionCode === "H01"), true);
  assert.equal(JSON.stringify(report).includes("patientId"), false);
  assert.equal(JSON.stringify(report).includes("studyInstanceUID"), false);
});

test("regulatory statistics support day and year time buckets", () => {
  assert.equal(buildRegulatoryStatistics(payload(), { granularity: "day" }).rows.some((item) => item.period === "2026-07-10"), true);
  assert.equal(buildRegulatoryStatistics(payload(), { granularity: "year" }).rows.every((item) => item.period === "2026"), true);
});

test("imaging development review closes both code-side P1 plan gaps while preserving site dependencies", () => {
  const review = buildImagingDevelopmentPlanReview(payload());
  assert.equal(review.status, "imaging-planned-code-capabilities-complete");
  assert.equal(review.summary.implementedCodeCapabilities, 2);
  assert.equal(review.summary.plannedCodeCapabilities, 2);
  assert.equal(review.siteDependencies.length, 3);
});
