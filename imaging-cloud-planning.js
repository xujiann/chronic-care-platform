(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ImagingCloudPlanning = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const VIEWER_ACCEPTANCE_THRESHOLDS = Object.freeze({
    mobileFirstPixelMs: 3000,
    diagnosticSeriesLoadMs: 10000,
    interactionP95Ms: 200,
    failedObjectRate: 0.001,
    requiredTools: ["window-level", "zoom-pan", "series-switch", "measurement", "mpr-3d"],
    requiredProtocols: ["DICOMweb", "WADO-RS"],
    requiredAuditEvents: ["viewer-opened", "series-requested", "viewer-closed"]
  });

  function evaluateViewerPerformance(run = {}) {
    const thresholds = VIEWER_ACCEPTANCE_THRESHOLDS;
    const checks = [
      check("synthetic-or-deidentified-data", ["synthetic", "deidentified"].includes(run.dataClass), "performance evidence must not contain identifiable patient data"),
      check("dicomweb-protocol", thresholds.requiredProtocols.every((item) => (run.protocols || []).includes(item)), thresholds.requiredProtocols.join(" + ")),
      check("diagnostic-rendering", run.diagnosticRendering === true && run.losslessSource === true, "diagnostic rendering uses an authorized lossless source"),
      check("mobile-first-pixel", finiteAtMost(run.mobileFirstPixelMs, thresholds.mobileFirstPixelMs), `<= ${thresholds.mobileFirstPixelMs} ms`),
      check("diagnostic-series-load", finiteAtMost(run.diagnosticSeriesLoadMs, thresholds.diagnosticSeriesLoadMs), `<= ${thresholds.diagnosticSeriesLoadMs} ms`),
      check("interaction-p95", finiteAtMost(run.interactionP95Ms, thresholds.interactionP95Ms), `<= ${thresholds.interactionP95Ms} ms`),
      check("failed-object-rate", finiteAtMost(run.failedObjectRate, thresholds.failedObjectRate), `<= ${thresholds.failedObjectRate}`),
      check("viewer-tools", thresholds.requiredTools.every((item) => (run.tools || []).includes(item)), thresholds.requiredTools.join(", ")),
      check("access-audit", thresholds.requiredAuditEvents.every((item) => (run.auditEvents || []).includes(item)), thresholds.requiredAuditEvents.join(", ")),
      check("terminal-storage-boundary", run.originalDicomStoredOnTerminal === false, "original DICOM must not persist on the terminal"),
      check("evidence-reference", Boolean(run.evidenceRef) && /^sha256:[a-f0-9]{64}$/.test(String(run.evidenceDigest || "")), "evidence reference and SHA-256 digest are required")
    ];
    const failed = checks.filter((item) => !item.passed);
    return {
      status: failed.length === 0 ? "viewer-performance-accepted" : "viewer-performance-not-accepted",
      ok: failed.length === 0,
      productionEvidence: run.productionEvidence === true && failed.length === 0,
      checks,
      hardStops: failed.map((item) => item.id),
      summary: {
        total: checks.length,
        passed: checks.length - failed.length,
        failed: failed.length
      },
      boundary: "A code-side or synthetic pass does not replace PACS, DICOMweb, network and clinical site acceptance."
    };
  }

  function buildRegulatoryStatistics(payload = {}, options = {}) {
    const granularity = ["day", "month", "year"].includes(options.granularity) ? options.granularity : "month";
    const studies = payload.studies || [];
    const shares = payload.shares || [];
    const qualityReviews = payload.qualityReviews || payload.qcReviews || [];
    const consultations = payload.consultations || payload.mutualRecognition || [];
    const accessEvents = payload.accessEvents || payload.accessLogs || [];
    const buckets = new Map();

    for (const study of studies) {
      const key = bucketKey(study.studyDate || study.createdAt, granularity);
      const institutionCode = String(study.institutionCode || "unknown");
      const cityCode = String(study.cityCode || "unknown");
      const bucket = ensureBucket(buckets, key, institutionCode, cityCode);
      bucket.uploads += 1;
      bucket.images += safeNumber(study.imageCount);
      if (study.reportConclusion || study.reportStatus === "signed") bucket.diagnoses += 1;
      if (study.integrityStatus && study.integrityStatus !== "verified") bucket.dataQualityIssues += 1;
    }
    for (const item of shares) incrementRelated(buckets, item, studies, granularity, "shares");
    for (const item of qualityReviews) incrementRelated(buckets, item, studies, granularity, "qualityReviews");
    for (const item of consultations) incrementRelated(buckets, item, studies, granularity, "consultations");
    for (const item of accessEvents) incrementRelated(buckets, item, studies, granularity, "views");

    const rows = [...buckets.values()]
      .map((row) => ({
        ...row,
        uploadSuccessRate: row.uploads > 0 ? round((row.uploads - row.dataQualityIssues) / row.uploads, 4) : 0
      }))
      .sort((a, b) => b.period.localeCompare(a.period) || b.uploads - a.uploads || a.institutionCode.localeCompare(b.institutionCode));
    const totals = rows.reduce((sum, row) => {
      ["uploads", "images", "diagnoses", "views", "shares", "qualityReviews", "consultations", "dataQualityIssues"].forEach((key) => {
        sum[key] += row[key];
      });
      return sum;
    }, { uploads: 0, images: 0, diagnoses: 0, views: 0, shares: 0, qualityReviews: 0, consultations: 0, dataQualityIssues: 0 });
    const institutionRanking = aggregateRanking(rows, "institutionCode");
    const cityRanking = aggregateRanking(rows, "cityCode");
    return {
      status: "regulatory-statistics-code-ready",
      granularity,
      rows,
      totals,
      institutionRanking,
      cityRanking,
      anomalyInstitutions: institutionRanking.filter((item) => item.dataQualityIssues > 0 || item.uploadSuccessRate < 0.99),
      privacyBoundary: "Only institution-level aggregates are returned; patient, accession and StudyInstanceUID identifiers are excluded."
    };
  }

  function buildImagingDevelopmentPlanReview(payload = {}) {
    const statistics = buildRegulatoryStatistics(payload);
    return {
      status: "imaging-planned-code-capabilities-complete",
      capabilities: [
        {
          id: "diagnostic-viewer-performance-acceptance",
          status: "implemented-awaiting-site-run",
          evidence: "evaluateViewerPerformance",
          acceptance: `${VIEWER_ACCEPTANCE_THRESHOLDS.requiredProtocols.join("+")}; first pixel <= ${VIEWER_ACCEPTANCE_THRESHOLDS.mobileFirstPixelMs}ms; series <= ${VIEWER_ACCEPTANCE_THRESHOLDS.diagnosticSeriesLoadMs}ms`
        },
        {
          id: "regulatory-statistics-and-ranking",
          status: "implemented-awaiting-production-data",
          evidence: "buildRegulatoryStatistics",
          acceptance: "day/month/year institution and city aggregates, rankings, quality anomalies and privacy boundary"
        }
      ],
      summary: {
        plannedCodeCapabilities: 2,
        implementedCodeCapabilities: 2,
        siteRunsAccepted: 0,
        aggregateRows: statistics.rows.length
      },
      siteDependencies: [
        "authorized diagnostic-grade DICOMweb/WADO-RS endpoint",
        "real network performance run with digest-addressed evidence",
        "production access, quality, consultation and sharing event feeds"
      ]
    };
  }

  function check(id, passed, detail) {
    return { id, passed: Boolean(passed), detail };
  }

  function finiteAtMost(value, maximum) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric >= 0 && numeric <= maximum;
  }

  function safeNumber(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
  }

  function bucketKey(value, granularity) {
    const text = String(value || "unknown");
    if (granularity === "day") return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : "unknown";
    if (granularity === "year") return /^\d{4}/.test(text) ? text.slice(0, 4) : "unknown";
    return /^\d{4}-\d{2}/.test(text) ? text.slice(0, 7) : "unknown";
  }

  function ensureBucket(buckets, period, institutionCode, cityCode) {
    const id = `${period}|${institutionCode}|${cityCode}`;
    if (!buckets.has(id)) {
      buckets.set(id, {
        period,
        institutionCode,
        cityCode,
        uploads: 0,
        images: 0,
        diagnoses: 0,
        views: 0,
        shares: 0,
        qualityReviews: 0,
        consultations: 0,
        dataQualityIssues: 0
      });
    }
    return buckets.get(id);
  }

  function incrementRelated(buckets, item, studies, granularity, metric) {
    const study = studies.find((row) => row.id === item.studyId || row.studyInstanceUID === item.studyInstanceUID);
    if (!study) return;
    const period = bucketKey(item.createdAt || item.reviewedAt || study.studyDate, granularity);
    const bucket = ensureBucket(buckets, period, String(study.institutionCode || "unknown"), String(study.cityCode || "unknown"));
    bucket[metric] += 1;
  }

  function aggregateRanking(rows, key) {
    const grouped = new Map();
    for (const row of rows) {
      const id = row[key];
      if (!grouped.has(id)) grouped.set(id, { [key]: id, uploads: 0, views: 0, shares: 0, qualityReviews: 0, consultations: 0, dataQualityIssues: 0 });
      const target = grouped.get(id);
      ["uploads", "views", "shares", "qualityReviews", "consultations", "dataQualityIssues"].forEach((metric) => {
        target[metric] += row[metric];
      });
    }
    return [...grouped.values()]
      .map((row) => ({ ...row, uploadSuccessRate: row.uploads > 0 ? round((row.uploads - row.dataQualityIssues) / row.uploads, 4) : 0 }))
      .sort((a, b) => b.uploads - a.uploads || String(a[key]).localeCompare(String(b[key])));
  }

  function round(value, precision) {
    const scale = 10 ** precision;
    return Math.round(value * scale) / scale;
  }

  return {
    VIEWER_ACCEPTANCE_THRESHOLDS,
    evaluateViewerPerformance,
    buildRegulatoryStatistics,
    buildImagingDevelopmentPlanReview
  };
});
