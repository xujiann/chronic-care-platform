(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CitizenRecordsV1 = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  const RESIDENT_RECORD_CATEGORIES = new Set([
    "emr",
    "labs",
    "medications",
    "imaging",
    "attachments",
    "physical-exam",
    "allergies",
    "vaccines",
    "admissions",
    "authorizations"
  ]);
  const ACTIVE_AUTHORIZATION_STATUSES = new Set(["active", "authorized", "有效", "已授权"]);
  const RESIDENT_AUTHORIZATION_SCOPES = new Set([
    "health-record-summary",
    "emr-summary",
    "labs",
    "medications",
    "imaging-report",
    "attachments"
  ]);

  const SAFE_META_FIELDS = new Set([
    "visitType",
    "exams",
    "medications",
    "attachmentType",
    "fileName",
    "accessMode",
    "reportNo",
    "externalId",
    "sourceType",
    "findings",
    "recommendations",
    "physicalExam",
    "sourceSystem",
    "sourceOrganization",
    "sourceRecordId",
    "dataQualityStatus",
    "authority",
    "sourceTrust",
    "status",
    "revokedAt",
    "granteeType",
    "granteeId",
    "granteeResidentId",
    "granteeAccountId",
    "purpose",
    "scopes",
    "expiresAt",
    "consentVersion",
    "grantedAt",
    "version",
    "originalAvailable",
    "authorizationRequired",
    "imageCloudStudyId",
    "studyInstanceUID",
    "modality",
    "bodyPart",
    "reportStatus",
    "qcStatus",
    "seriesCount",
    "imageCount",
    "recordKind",
    "dosage",
    "nextPickup",
    "pharmacy",
    "pharmacyStatus",
    "institutionReview",
    "insuranceReview",
    "coverage",
    "mutualRecognitionStatus",
    "attachmentId",
    "contentType",
    "sizeBytes",
    "scanStatus",
    "retentionPolicy",
    "immutable",
    "legalHold"
  ]);

  function cleanText(value, maximum = 500) {
    return String(value ?? "").trim().slice(0, maximum);
  }

  function safeMeta(meta = {}) {
    if (!meta || typeof meta !== "object" || Array.isArray(meta)) return {};
    return Object.fromEntries(
      Object.entries(meta)
        .filter(([key]) => SAFE_META_FIELDS.has(key))
        .map(([key, value]) => [key, sanitizeMetaValue(value)])
    );
  }

  function sanitizeMetaValue(value) {
    if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitizeMetaValue(item));
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).slice(0, 20).map(([key, item]) => [cleanText(key, 80), sanitizeMetaValue(item)]));
    }
    if (typeof value === "string") return cleanText(value, 500);
    if (["number", "boolean"].includes(typeof value) || value === null) return value;
    return cleanText(value, 200);
  }

  function projectRecord(record = {}) {
    const category = cleanText(record.category, 60);
    if (!RESIDENT_RECORD_CATEGORIES.has(category)) return null;
    return {
      id: cleanText(record.id, 160),
      residentId: cleanText(record.residentId, 120),
      category,
      date: cleanText(record.date || record.occurredAt, 40),
      name: cleanText(record.name || record.title || "未命名健康资料", 300),
      result: cleanText(record.result || record.summary, 1200),
      source: cleanText(record.source || record.sourceOrganization || "来源待核验", 300),
      status: cleanText(record.status, 80),
      revokedAt: cleanText(record.revokedAt, 60),
      revokeReason: cleanText(record.revokeReason, 300),
      createdAt: cleanText(record.createdAt, 60),
      updatedAt: cleanText(record.updatedAt || record.createdAt, 60),
      createdBy: cleanText(record.createdBy, 120),
      meta: safeMeta(record.meta)
    };
  }

  function projectResidentRecords(records, residentId) {
    return (Array.isArray(records) ? records : [])
      .filter((record) => record?.residentId === residentId)
      .map(projectRecord)
      .filter(Boolean);
  }

  function authorizationState(record = {}, today = new Date()) {
    const projected = projectRecord({ ...record, category: "authorizations" }) || record;
    const revokedAt = cleanText(projected.revokedAt || projected.meta?.revokedAt, 60);
    const statusText = `${projected.status || ""} ${projected.meta?.status || ""}`;
    if (revokedAt || /revoked|withdrawn|cancelled|撤销/i.test(statusText)) {
      return { key: "revoked", label: revokedAt ? `已撤销 · ${revokedAt.slice(0, 10)}` : "已撤销", active: false };
    }
    const statuses = [projected.status, projected.meta?.status]
      .map((value) => cleanText(value, 80).toLowerCase())
      .filter(Boolean);
    const explicitlyActive = statuses.length > 0 && statuses.every((status) => ACTIVE_AUTHORIZATION_STATUSES.has(status));
    const expiresAt = cleanText(projected.meta?.expiresAt || projected.date, 40);
    if (!expiresAt) {
      return explicitlyActive
        ? { key: "active", label: "有效 · 历史长期授权", active: true }
        : { key: "inactive", label: statuses.length ? `未激活 · ${statuses.join(" / ")}` : "待补录有效状态", active: false };
    }
    const expiry = expiresAt ? new Date(`${expiresAt.slice(0, 10)}T23:59:59`) : null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expiresAt.slice(0, 10)) || Number.isNaN(expiry.getTime())) {
      return { key: "incomplete", label: "有效期格式待核验", active: false };
    }
    if (expiry.getTime() < today.getTime()) {
      return { key: "expired", label: `已过期 · ${expiresAt.slice(0, 10)}`, active: false };
    }
    if (!explicitlyActive) {
      return { key: "inactive", label: statuses.length ? `未激活 · ${statuses.join(" / ")}` : "待补录有效状态", active: false };
    }
    return { key: "active", label: expiresAt ? `有效期至 ${expiresAt.slice(0, 10)}` : "长期有效", active: true };
  }

  function buildAuthorizationRecord(input = {}) {
    const scopes = [...new Set((Array.isArray(input.scopes) ? input.scopes : []).map((item) => cleanText(item, 80)).filter(Boolean))];
    const expiresAt = cleanText(input.expiresAt, 20);
    const granteeName = cleanText(input.granteeName, 200);
    const purpose = cleanText(input.purpose, 300);
    if (!input.residentId || !granteeName || !purpose || !scopes.length || !expiresAt) {
      throw new Error("授权对象、用途、范围和有效期均不能为空");
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expiresAt) || Number.isNaN(new Date(`${expiresAt}T23:59:59`).getTime())) {
      throw new Error("授权有效期格式不正确");
    }
    if (scopes.some((scope) => !RESIDENT_AUTHORIZATION_SCOPES.has(scope))) {
      throw new Error("授权范围不受支持");
    }
    return {
      residentId: cleanText(input.residentId, 120),
      category: "authorizations",
      date: expiresAt,
      name: granteeName,
      result: `用途：${purpose}；范围：${scopes.join("、")}`,
      source: cleanText(input.source || "居民主动授权", 200),
      meta: {
        status: "active",
        granteeType: cleanText(input.granteeType || "care-team", 80),
        purpose,
        scopes,
        expiresAt,
        consentVersion: cleanText(input.consentVersion || "resident-record-consent-v1", 100),
        grantedAt: cleanText(input.grantedAt || new Date().toISOString(), 60),
        version: 1,
        sourceTrust: "resident-consent"
      }
    };
  }

  function sourceTrust(record = {}) {
    const meta = record.meta || {};
    const sourceText = `${record.source || ""} ${meta.sourceSystem || ""} ${meta.authority || ""} ${meta.sourceTrust || ""}`;
    if (/self-reported|resident-upload|居民个人提供|个人上传/i.test(sourceText)) return "self-reported";
    if (/HIS|EMR|LIS|PACS|医院|社区|公卫|体检中心|medical|clinical/i.test(sourceText)) return "authoritative";
    return "pending-verification";
  }

  function imagingStudyToRecord(study = {}, report = {}) {
    const studyId = cleanText(study.id, 160);
    const residentId = cleanText(study.residentId, 120);
    if (!studyId || !residentId) return null;
    const modality = cleanText(study.modality || "影像", 40);
    const bodyPart = cleanText(study.bodyPart || study.examMethod || "检查", 100);
    const conclusion = cleanText(report.conclusion || report.result || study.reportConclusion || study.finding || "影像报告待回传", 1200);
    const reportStatus = cleanText(study.reportStatus || report.status || "待核验", 80);
    return projectRecord({
      id: `image-cloud-${studyId}`,
      residentId,
      category: "imaging",
      date: cleanText(study.studyDate || report.reportedAt, 40),
      name: `${bodyPart} ${modality} 影像报告`,
      result: conclusion,
      source: cleanText(study.institutionName || report.sourceInstitution || "医疗机构影像云", 300),
      status: reportStatus,
      createdAt: cleanText(study.createdAt, 60),
      updatedAt: cleanText(study.updatedAt || report.reportedAt || study.createdAt, 60),
      meta: {
        attachmentType: "影像报告",
        accessMode: "受控调阅",
        reportNo: cleanText(study.accessionNumber || report.externalId, 120),
        sourceSystem: "PACS",
        sourceOrganization: cleanText(study.institutionName || report.sourceInstitution, 300),
        sourceRecordId: cleanText(study.accessionNumber || report.id || studyId, 160),
        dataQualityStatus: cleanText(study.qcStatus || report.status || "待核验", 80),
        authority: "clinical",
        sourceTrust: "clinical",
        originalAvailable: Boolean(study.browserLevel),
        authorizationRequired: true,
        imageCloudStudyId: studyId,
        studyInstanceUID: cleanText(study.studyInstanceUID, 180),
        modality,
        bodyPart,
        reportStatus,
        qcStatus: cleanText(study.qcStatus, 80),
        seriesCount: Number.isFinite(Number(study.seriesCount)) ? Number(study.seriesCount) : 0,
        imageCount: Number.isFinite(Number(study.imageCount)) ? Number(study.imageCount) : 0
      }
    });
  }

  function mergeResidentImagingRecords(records, dashboard = {}) {
    const existing = Array.isArray(records) ? records : [];
    const studies = Array.isArray(dashboard.studies) ? dashboard.studies : [];
    const reports = Array.isArray(dashboard.emrCompatibility?.diagnosticReports)
      ? dashboard.emrCompatibility.diagnosticReports
      : [];
    const linkedStudies = new Set(
      existing.map((record) => cleanText(record?.meta?.imageCloudStudyId, 160)).filter(Boolean)
    );
    const additions = studies
      .filter((study) => !linkedStudies.has(cleanText(study?.id, 160)))
      .map((study) => imagingStudyToRecord(
        study,
        reports.find((report) => report?.imageCloudStudyId === study?.id) || {}
      ))
      .filter(Boolean);
    return [...existing, ...additions];
  }

  function diagnosticReportToRecord(report = {}) {
    const reportId = cleanText(report.id || report.externalId, 160);
    const residentId = cleanText(report.residentId, 120);
    if (!reportId || !residentId || report.imageCloudStudyId) return null;
    const sourceCategory = cleanText(report.category, 80).toLowerCase();
    const imagingCategories = new Set(["imaging", "ultrasound", "ct", "mr", "mri", "xray", "x-ray", "radiology", "影像", "超声"]);
    const diagnosticCategories = new Set(["lab", "laboratory", "electrocardiogram", "ecg", "examination", "检验", "检查", "心电"]);
    const imaging = imagingCategories.has(sourceCategory) || sourceCategory.startsWith("imaging-");
    const supported = imaging || diagnosticCategories.has(sourceCategory) || sourceCategory.startsWith("lab-");
    if (!supported) return null;
    const category = imaging ? "imaging" : "labs";
    const item = cleanText(report.item || (imaging ? "影像" : "检验检查"), 200);
    const result = cleanText(report.result, 800);
    const conclusion = cleanText(report.conclusion, 800);
    const readableResult = result && conclusion && result !== conclusion ? `${result}；${conclusion}` : conclusion || result || "报告摘要待回传";
    return projectRecord({
      id: `diagnostic-report-${reportId}`,
      residentId,
      category,
      date: cleanText(report.reportedAt, 40),
      name: `${item}${imaging ? "影像" : "检查"}报告`,
      result: readableResult,
      source: cleanText(report.sourceInstitution || "区域检查检验平台", 300),
      status: cleanText(report.status, 80),
      updatedAt: cleanText(report.updatedAt || report.reportedAt, 60),
      meta: {
        recordKind: "diagnostic-report",
        reportNo: cleanText(report.externalId || reportId, 120),
        sourceSystem: imaging ? "PACS" : "LIS/检查互认",
        sourceOrganization: cleanText(report.sourceInstitution, 300),
        sourceRecordId: reportId,
        dataQualityStatus: cleanText(report.status || "待核验", 80),
        authority: "clinical",
        sourceTrust: "clinical",
        mutualRecognitionStatus: cleanText(report.status, 80),
        attachmentType: imaging ? "影像报告" : "检查检验报告",
        originalAvailable: false,
        authorizationRequired: imaging
      }
    });
  }

  function medicationPickupToRecord(pickup = {}) {
    const pickupId = cleanText(pickup.id, 160);
    const residentId = cleanText(pickup.residentId, 120);
    const medication = cleanText(pickup.medication, 200);
    if (!pickupId || !residentId || !medication) return null;
    const dosage = cleanText(pickup.dosage, 200);
    const pharmacyStatus = cleanText(pickup.pharmacyStatus || pickup.status || "状态待确认", 100);
    const nextPickup = cleanText(pickup.nextPickup, 40);
    return projectRecord({
      id: `medication-service-${pickupId}`,
      residentId,
      category: "medications",
      date: cleanText(pickup.lastUpdated || nextPickup, 40),
      name: medication,
      result: [dosage, pharmacyStatus, nextPickup ? `下次取药 ${nextPickup}` : ""].filter(Boolean).join("；"),
      source: cleanText(pickup.pharmacy || "基层药事服务", 300),
      status: pharmacyStatus,
      updatedAt: cleanText(pickup.lastUpdated, 60),
      meta: {
        recordKind: "medication-service",
        sourceSystem: "药事服务",
        sourceOrganization: cleanText(pickup.pharmacy, 300),
        sourceRecordId: pickupId,
        dataQualityStatus: cleanText(pickup.institutionReview || "待机构确认", 80),
        authority: "pharmacy-service",
        sourceTrust: "clinical-service",
        dosage,
        nextPickup,
        pharmacy: cleanText(pickup.pharmacy, 300),
        pharmacyStatus,
        institutionReview: cleanText(pickup.institutionReview, 80),
        insuranceReview: cleanText(pickup.insuranceReview, 80),
        coverage: cleanText(pickup.coverage, 120),
        originalAvailable: false,
        authorizationRequired: false
      }
    });
  }

  function normalizeEmrRecord(record = {}) {
    if (record.category !== "emr") return record;
    const createdBy = cleanText(record.createdBy, 120);
    const institutionSource = /system|institution|hospital|医院|社区|医疗机构/i.test(`${createdBy} ${record.source || ""}`);
    return projectRecord({
      ...record,
      meta: {
        ...(record.meta || {}),
        recordKind: "emr-summary",
        sourceSystem: record.meta?.sourceSystem || "EMR",
        authority: record.meta?.authority || (institutionSource ? "clinical" : "pending-verification"),
        sourceTrust: record.meta?.sourceTrust || (institutionSource ? "clinical" : "pending-verification"),
        dataQualityStatus: record.meta?.dataQualityStatus || "已归档"
      }
    });
  }

  function secureAttachmentToRecord(attachment = {}) {
    const attachmentId = cleanText(attachment.id, 160);
    const residentId = cleanText(attachment.residentId, 120);
    const fileName = cleanText(attachment.filename, 300);
    if (!attachmentId || !residentId || !fileName) return null;
    const status = cleanText(attachment.status || "pending", 80);
    const scanStatus = cleanText(attachment.scanStatus || "pending", 80);
    const available = status === "active" && scanStatus === "clean";
    const residentProvided = /citizen|resident/i.test(cleanText(attachment.createdByRole, 80));
    const result = available
      ? "已通过完整性与恶意文件扫描，可申请短时下载。"
      : /quarantined|blocked|integrity-failed/i.test(`${status} ${scanStatus}`)
        ? "附件未通过安全校验，已隔离且不可下载。"
        : "附件正在进行完整性与恶意文件扫描，暂不可下载。";
    return projectRecord({
      id: `secure-attachment-${attachmentId}`,
      residentId,
      category: "attachments",
      date: cleanText(attachment.activatedAt || attachment.createdAt, 40),
      name: fileName,
      result,
      source: residentProvided ? "居民安全附件" : cleanText(attachment.createdByOrgCode || "医疗机构安全附件", 300),
      status,
      createdAt: cleanText(attachment.createdAt, 60),
      updatedAt: cleanText(attachment.activatedAt || attachment.scannedAt || attachment.createdAt, 60),
      createdBy: cleanText(attachment.createdBy, 120),
      meta: {
        recordKind: "secure-attachment",
        attachmentId,
        attachmentType: cleanText(attachment.classification || "安全附件", 100),
        fileName,
        contentType: cleanText(attachment.contentType, 120),
        sizeBytes: Number.isFinite(Number(attachment.sizeBytes || attachment.expectedSizeBytes)) ? Number(attachment.sizeBytes || attachment.expectedSizeBytes) : 0,
        scanStatus,
        retentionPolicy: cleanText(attachment.retentionPolicy, 120),
        immutable: Boolean(attachment.immutable),
        legalHold: Boolean(attachment.legalHold),
        accessMode: available ? "短时授权下载" : "安全校验完成后可申请下载",
        dataQualityStatus: scanStatus,
        authority: residentProvided ? "resident-upload" : "clinical-attachment",
        sourceTrust: residentProvided ? "self-reported" : "clinical",
        originalAvailable: available,
        authorizationRequired: true,
        sourceRecordId: attachmentId
      }
    });
  }

  function mergeResidentSecureAttachments(records, attachments) {
    const existing = Array.isArray(records) ? records : [];
    const sourceIds = new Set(existing.map((record) => cleanText(record?.meta?.sourceRecordId, 160)).filter(Boolean));
    const additions = (Array.isArray(attachments) ? attachments : [])
      .filter((attachment) => !sourceIds.has(cleanText(attachment?.id, 160)))
      .map(secureAttachmentToRecord)
      .filter(Boolean);
    return [...existing, ...additions];
  }

  function projectAccessLog(log = {}) {
    const residentId = cleanText(log.residentId, 120);
    if (!residentId) return null;
    return {
      id: cleanText(log.id, 160),
      residentId,
      at: cleanText(log.at, 60),
      actor: cleanText(log.actor || "系统", 200),
      role: cleanText(log.role, 100),
      scope: cleanText(log.scope, 300),
      purpose: cleanText(log.purpose || log.action || "访问健康资料", 500),
      result: cleanText(log.result || "待核验", 80)
    };
  }

  function projectAccessReviewPayload(payload = {}, residentId = "") {
    return {
      authorizations: (Array.isArray(payload.authorizations) ? payload.authorizations : [])
        .filter((record) => !residentId || record?.residentId === residentId)
        .map(projectRecord)
        .filter(Boolean),
      accessLogs: (Array.isArray(payload.accessLogs) ? payload.accessLogs : [])
        .filter((log) => !residentId || log?.residentId === residentId)
        .map(projectAccessLog)
        .filter(Boolean)
    };
  }

  function mergeResidentClinicalRecords(records, source = {}) {
    const existing = (Array.isArray(records) ? records : []).map(normalizeEmrRecord);
    const sourceIds = new Set(existing.map((record) => cleanText(record?.meta?.sourceRecordId, 160)).filter(Boolean));
    const diagnosticReports = (Array.isArray(source.diagnosticReports) ? source.diagnosticReports : [])
      .filter((report) => !sourceIds.has(cleanText(report?.id || report?.externalId, 160)))
      .map(diagnosticReportToRecord)
      .filter(Boolean);
    diagnosticReports.forEach((record) => sourceIds.add(record.meta.sourceRecordId));
    const medicationServices = (Array.isArray(source.medicationPickups) ? source.medicationPickups : [])
      .filter((pickup) => !sourceIds.has(cleanText(pickup?.id, 160)))
      .map(medicationPickupToRecord)
      .filter(Boolean);
    return [...existing, ...diagnosticReports, ...medicationServices];
  }

  function summarizeResidentRecords(records, residentId, today = new Date()) {
    const projected = projectResidentRecords(records, residentId);
    const clinical = projected.filter((item) => item.category !== "authorizations");
    const authorizations = projected.filter((item) => item.category === "authorizations");
    return {
      records: clinical.length,
      categories: new Set(clinical.map((item) => item.category)).size,
      authoritative: clinical.filter((item) => sourceTrust(item) === "authoritative").length,
      selfReported: clinical.filter((item) => sourceTrust(item) === "self-reported").length,
      activeAuthorizations: authorizations.filter((item) => authorizationState(item, today).active).length,
      restrictedOriginals: clinical.filter((item) => item.meta?.authorizationRequired || ["imaging", "attachments"].includes(item.category)).length
    };
  }

  return {
    RESIDENT_RECORD_CATEGORIES,
    ACTIVE_AUTHORIZATION_STATUSES,
    RESIDENT_AUTHORIZATION_SCOPES,
    SAFE_META_FIELDS,
    projectRecord,
    projectResidentRecords,
    authorizationState,
    buildAuthorizationRecord,
    sourceTrust,
    imagingStudyToRecord,
    mergeResidentImagingRecords,
    diagnosticReportToRecord,
    medicationPickupToRecord,
    normalizeEmrRecord,
    secureAttachmentToRecord,
    mergeResidentSecureAttachments,
    projectAccessLog,
    projectAccessReviewPayload,
    mergeResidentClinicalRecords,
    summarizeResidentRecords
  };
});
