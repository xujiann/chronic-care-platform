(function (root, factory) {
  const standards = typeof module === "object" && module.exports
    ? require("./physical-examination-standards")
    : root?.PhysicalExaminationStandards;
  const api = factory(standards);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PhysicalExaminationProduction = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (Standards) {
  if (!Standards) throw new Error("PhysicalExaminationStandards is required");

  const VERSION = "physical-examination-production-v1";
  const MODULE_ID = "physical-examination";
  const DIGEST_PATTERN = /^[a-f0-9]{64}$/i;
  const FORBIDDEN_DOMAIN_PATTERN = /(emergency|blood|imaging|急救|用血|影像)/i;
  const CLOSURE_ACTIONS = Object.freeze(["confirm", "notify", "schedule-review", "family-doctor-followup", "close", "reopen"]);
  const REQUIRED_STANDALONE_FILES = Object.freeze([
    "physical-examination-standalone.html",
    "physical-examination-standalone.js",
    "physical-examination-production.js",
    "physical-examination-standards.js"
  ]);

  const SOURCE_MAPPING_PROFILES = Object.freeze({
    "exam-center-v1": Object.freeze({
      id: "exam-center-v1",
      version: "1.0.0",
      sourceType: "exam-center",
      sourceSystems: ["physical-examination-system", "health-management-system"],
      fields: Object.freeze({
        residentId: ["residentId", "person.id", "patientId", "customerId"],
        personIndex: ["personIndex", "person.index", "mpiId", "identityIndex"],
        externalId: ["externalId", "report.externalId", "checkupId", "documentId"],
        institutionId: ["institutionId", "organization.code", "orgCode"],
        institutionName: ["institutionName", "organization.name", "orgName"],
        reportNo: ["reportNo", "report.number", "checkupNo"],
        examDate: ["examDate", "report.examDate", "checkupDate"],
        summary: ["summary", "report.summary", "conclusion"],
        findings: ["findings", "report.findings", "items"],
        recommendations: ["recommendations", "report.recommendations", "advices"],
        documentProfile: ["documentProfile", "report.documentProfile"],
        institutionQualification: ["institutionQualification", "organization.qualification"],
        sectionSignatures: ["sectionSignatures", "report.sectionSignatures"],
        processingBasis: ["processingBasis", "authorization.processingBasis"],
        signature: ["signature", "report.signature"]
      }),
      findingFields: Object.freeze({
        code: ["code", "itemCode"],
        name: ["name", "itemName"],
        value: ["value", "result"],
        unit: ["unit", "resultUnit"],
        reference: ["reference", "referenceRange"],
        abnormal: ["abnormal", "isAbnormal"],
        criticalValue: ["criticalValue", "isCritical"]
      })
    }),
    "hospital-v1": Object.freeze({
      id: "hospital-v1",
      version: "1.0.0",
      sourceType: "hospital",
      sourceSystems: ["HIS", "EMR", "LIS", "PACS", "hospital-checkup-system"],
      fields: Object.freeze({
        residentId: ["residentId", "patient.id", "PATIENT_ID"],
        personIndex: ["personIndex", "patient.mpiId", "MPI_ID"],
        externalId: ["externalId", "document.id", "DOCUMENT_ID"],
        institutionId: ["institutionId", "organization.code", "ORG_CODE"],
        institutionName: ["institutionName", "organization.name", "ORG_NAME"],
        reportNo: ["reportNo", "document.number", "REPORT_NO"],
        examDate: ["examDate", "document.serviceDate", "EXAM_DATE"],
        summary: ["summary", "document.conclusion", "CONCLUSION"],
        findings: ["findings", "document.entries", "ITEMS"],
        recommendations: ["recommendations", "document.recommendations", "ADVICES"],
        documentProfile: ["documentProfile", "document.profile"],
        institutionQualification: ["institutionQualification", "organization.qualification"],
        sectionSignatures: ["sectionSignatures", "document.sectionSignatures"],
        processingBasis: ["processingBasis", "authorization.processingBasis"],
        signature: ["signature", "document.signature"]
      }),
      findingFields: Object.freeze({
        code: ["code", "itemCode", "ITEM_CODE"],
        name: ["name", "itemName", "ITEM_NAME"],
        value: ["value", "result", "RESULT_VALUE"],
        unit: ["unit", "resultUnit", "RESULT_UNIT"],
        reference: ["reference", "referenceRange", "REFERENCE_RANGE"],
        abnormal: ["abnormal", "isAbnormal", "ABNORMAL_FLAG"],
        criticalValue: ["criticalValue", "isCritical", "CRITICAL_FLAG"]
      })
    })
  });

  const SITE_EVIDENCE_REQUIREMENTS = Object.freeze([
    { id: "source-mapping", name: "源系统字段映射", validator: "validateSourceMappingEvidence" },
    { id: "integration-receipt", name: "接入回执", validator: "validateIntegrationReceipt" },
    { id: "report-signature", name: "医学电子文档签名", validator: "validateReportSignatureContract" },
    { id: "archive-scan", name: "原件归档与恶意文件扫描", validator: "validateArchiveEvidence" },
    { id: "care-closure", name: "异常通知复查家医随访闭环", validator: "validateAbnormalClosure" },
    { id: "independent-signoff", name: "现场证据独立核验", validator: "validateIndependentSignoff" },
    { id: "standalone-smoke", name: "独立运行冒烟", validator: "validateStandaloneSmoke" },
    { id: "rollback-gate", name: "回退演练", validator: "validateRollbackGate" }
  ]);

  function mapSourceReport(payload = {}, profileId, options = {}) {
    const profile = SOURCE_MAPPING_PROFILES[String(profileId || "").trim()];
    if (!profile) return failed("source-mapping", [`unsupported-profile:${profileId || "missing"}`]);
    const canonical = { sourceType: profile.sourceType };
    const mappedFields = [];
    Object.entries(profile.fields).forEach(([target, aliases]) => {
      const match = firstPath(payload, aliases);
      if (!match.found) return;
      canonical[target] = target === "findings"
        ? normalizeMappedFindings(match.value, profile.findingFields)
        : match.value;
      mappedFields.push({ target, source: match.path });
    });
    canonical.recommendations = normalizeList(canonical.recommendations);
    const missing = [
      ...(!canonical.residentId && !canonical.personIndex ? ["residentId-or-personIndex"] : []),
      ...["externalId", "institutionId", "institutionName", "reportNo", "examDate", "summary"]
        .filter((field) => !String(canonical[field] || "").trim())
    ];
    const payloadSha256 = normalizeDigest(options.payloadSha256 || payload._evidence?.payloadSha256);
    if (!payloadSha256) missing.push("payloadSha256");
    const mappingReceipt = {
      profileId: profile.id,
      profileVersion: profile.version,
      sourceType: profile.sourceType,
      sourceSystem: String(options.sourceSystem || payload._evidence?.sourceSystem || "").trim(),
      payloadSha256,
      mappedFields,
      missingFields: missing,
      status: missing.length ? "rejected" : "mapped",
      mappedAt: String(options.now || new Date().toISOString())
    };
    return {
      id: "source-mapping",
      ok: missing.length === 0,
      canonical,
      receipt: mappingReceipt,
      issues: missing.map((field) => `missing:${field}`)
    };
  }

  function validateSourceMappingEvidence(evidence = {}) {
    const issues = [];
    const profile = SOURCE_MAPPING_PROFILES[String(evidence.profileId || "").trim()];
    if (!profile) issues.push("mapping-profile-not-supported");
    if (profile && String(evidence.profileVersion || "") !== profile.version) issues.push("mapping-profile-version-mismatch");
    if (!String(evidence.sourceSystem || "").trim()) issues.push("source-system-missing");
    if (!String(evidence.endpointId || "").trim()) issues.push("endpoint-id-missing");
    if (!String(evidence.fieldDictionaryVersion || "").trim()) issues.push("field-dictionary-version-missing");
    if (!String(evidence.sampleRequestRef || "").trim()) issues.push("sample-request-ref-missing");
    if (!String(evidence.sampleResponseRef || "").trim()) issues.push("sample-response-ref-missing");
    if (!normalizeDigest(evidence.payloadSha256)) issues.push("payload-sha256-invalid");
    if (evidence.mappingStatus !== "mapped") issues.push("mapping-not-passed");
    return result("source-mapping-evidence", issues, {
      profileId: profile?.id || "",
      sourceType: profile?.sourceType || "",
      evidenceRef: String(evidence.evidenceRef || evidence.sampleResponseRef || "").trim()
    });
  }

  function validateReportSignatureContract(report = {}) {
    const signature = Standards.normalizeSignature(report.signature || report.meta?.signature || {});
    const profile = Standards.normalizeDocumentProfile(report);
    const sectionSignatures = Standards.normalizeSectionSignatures(report.sectionSignatures || report.meta?.sectionSignatures);
    const issues = [];
    if (profile.standardCode !== Standards.ADULT_EXAM_DOCUMENT_STANDARD) issues.push("document-standard-invalid");
    if (!profile.documentId || !profile.version || !profile.authorId || !profile.custodianId) issues.push("document-identity-incomplete");
    if (!normalizeDigest(profile.sourceDocumentHash)) issues.push("source-document-sha256-invalid");
    const missingSections = Standards.REQUIRED_SECTIONS.filter((section) => !profile.sections.includes(section));
    if (missingSections.length) issues.push(`document-sections-missing:${missingSections.join(",")}`);
    if (signature.standardCode !== Standards.DIGITAL_SIGNATURE_STANDARD) issues.push("signature-standard-invalid");
    if (!["production", "external-production"].includes(signature.mode)) issues.push("signature-not-production");
    if (!/SM2/i.test(signature.asymmetricAlgorithm) || !/SM3/i.test(signature.digestAlgorithm)) issues.push("signature-algorithm-invalid");
    if (!/ES-T/i.test(signature.format) || !signature.timestamp) issues.push("signature-format-invalid");
    if (signature.status !== "verified" || !signature.certificateChainVerified || !signature.revocationStatusVerified || !signature.timestampVerified) issues.push("signature-validation-incomplete");
    if (!signature.certificateSerial || !signature.signatureNo || !signature.signatureValueRef) issues.push("signature-evidence-incomplete");
    if (!normalizeDigest(signature.signedDocumentHash) || signature.signedDocumentHash !== profile.sourceDocumentHash) issues.push("signature-document-binding-mismatch");
    const signedSections = new Set(sectionSignatures
      .filter((item) => item.status === "signed" && item.physicianId && item.physicianLicenseNo && item.signedAt && item.signatureRef)
      .map((item) => item.sectionId));
    const missingClinicalSignatures = ["physical-examination", "laboratory", "imaging"].filter((section) => !signedSections.has(section));
    if (missingClinicalSignatures.length) issues.push(`section-signatures-missing:${missingClinicalSignatures.join(",")}`);
    return result("report-signature-contract", issues, {
      documentId: profile.documentId,
      signatureNo: signature.signatureNo,
      certificateSerial: signature.certificateSerial,
      sourceDocumentHash: profile.sourceDocumentHash,
      standard: signature.standardCode
    });
  }

  function validateIntegrationReceipt(receipt = {}) {
    const issues = [];
    if (!String(receipt.eventId || "").trim()) issues.push("event-id-missing");
    if (!String(receipt.idempotencyKey || "").trim()) issues.push("idempotency-key-missing");
    if (!String(receipt.sourceSystem || "").trim()) issues.push("source-system-missing");
    if (!String(receipt.receiptRef || "").trim()) issues.push("receipt-ref-missing");
    if (!validDate(receipt.acceptedAt)) issues.push("accepted-at-invalid");
    if (!normalizeDigest(receipt.payloadSha256)) issues.push("payload-sha256-invalid");
    if (receipt.signatureVerified !== true) issues.push("transport-signature-not-verified");
    if (receipt.mappingStatus !== "mapped") issues.push("mapping-not-passed");
    if (!["landed", "duplicate"].includes(receipt.landingStatus)) issues.push("landing-not-confirmed");
    if (![200, 201, 202].includes(Number(receipt.responseCode))) issues.push("response-code-not-success");
    if (receipt.simulated === true || receipt.productionEvidence !== true) issues.push("receipt-not-production-evidence");
    return result("integration-receipt", issues, {
      eventId: String(receipt.eventId || "").trim(),
      receiptRef: String(receipt.receiptRef || "").trim(),
      landingStatus: String(receipt.landingStatus || "").trim()
    });
  }

  function validateArchiveEvidence(evidence = {}) {
    const issues = [];
    if (!String(evidence.reportId || "").trim()) issues.push("report-id-missing");
    if (!String(evidence.objectId || "").trim()) issues.push("object-id-missing");
    if (!String(evidence.objectVersionId || "").trim()) issues.push("object-version-id-missing");
    if (!normalizeDigest(evidence.sha256)) issues.push("archive-sha256-invalid");
    if (!String(evidence.mimeType || "").trim()) issues.push("mime-type-missing");
    if (!(Number(evidence.sizeBytes) > 0)) issues.push("object-size-invalid");
    if (evidence.scanStatus !== "clean") issues.push("malware-scan-not-clean");
    if (!String(evidence.scanEngine || "").trim() || !String(evidence.scanEngineVersion || "").trim()) issues.push("scan-engine-evidence-incomplete");
    if (!validDate(evidence.scanCompletedAt)) issues.push("scan-completed-at-invalid");
    if (evidence.checksumVerified !== true) issues.push("checksum-not-verified");
    if (evidence.immutable !== true) issues.push("immutable-retention-not-enabled");
    if (Number(evidence.retentionYears) < 15) issues.push("retention-less-than-15-years");
    if (evidence.encryptionAtRest !== true) issues.push("encryption-at-rest-not-confirmed");
    if (!String(evidence.evidenceRef || "").trim()) issues.push("archive-evidence-ref-missing");
    return result("archive-scan-evidence", issues, {
      reportId: String(evidence.reportId || "").trim(),
      objectId: String(evidence.objectId || "").trim(),
      objectVersionId: String(evidence.objectVersionId || "").trim(),
      sha256: normalizeDigest(evidence.sha256)
    });
  }

  function createAbnormalClosure(report = {}, context = {}) {
    const reportId = String(report.id || report.reportId || "").trim();
    const residentId = String(report.residentId || "").trim();
    const findings = Array.isArray(report.findings) ? report.findings : (report.meta?.findings || []);
    if (!reportId || !residentId) throw inputError("异常闭环必须关联 reportId 和 residentId");
    const cases = findings.filter(isAbnormalFinding).map((finding, index) => {
      const critical = finding.criticalValue === true || String(finding.riskClass || "").toUpperCase() === "A";
      return {
        id: `pe-closure-${stableHash(`${reportId}|${finding.code || index}`)}`,
        reportId,
        residentId,
        findingCode: String(finding.code || `ITEM-${index + 1}`).trim(),
        findingName: String(finding.name || finding.code || "异常项目").trim(),
        priority: critical ? "urgent" : "important",
        status: "pending-confirmation",
        dueAt: addDays(String(context.examDate || report.examDate || report.date || ""), critical ? 1 : 14),
        notificationReceipt: null,
        reviewAppointment: null,
        familyDoctorFollowup: null,
        closureEvidenceRef: "",
        residentTask: {
          status: "pending",
          action: critical ? "立即联系医师并按指引就诊" : "按期完成复查并联系家庭医生",
          sourceReportId: reportId
        },
        familyDoctorSuggestion: familyDoctorSuggestionFor(finding),
        actions: [{ action: "created", at: String(context.now || new Date().toISOString()), actor: String(context.actor || "system"), evidenceRef: String(context.evidenceRef || "") }]
      };
    });
    return { id: `pe-closure-batch-${stableHash(reportId)}`, reportId, residentId, status: cases.length ? "open" : "not-required", cases };
  }

  function applyAbnormalClosureAction(workflow, caseId, payload = {}, context = {}) {
    const cases = Array.isArray(workflow?.cases) ? workflow.cases : [];
    const row = cases.find((item) => item.id === caseId);
    if (!row) throw inputError("未找到体检异常闭环记录");
    const action = String(payload.action || "").trim();
    if (!CLOSURE_ACTIONS.includes(action)) throw inputError(`不支持的异常闭环动作：${action || "missing"}`);
    const actor = String(context.actor || "").trim();
    const at = String(context.now || new Date().toISOString());
    const evidenceRef = String(payload.evidenceRef || "").trim();
    if (!actor) throw inputError("异常闭环动作必须记录责任人");
    if (action !== "reopen" && evidenceRef.length < 3) throw inputError("异常闭环动作必须提供证据引用");

    if (action === "confirm") {
      if (row.status !== "pending-confirmation" && row.status !== "reopened") throw conflictError("异常项目当前状态不能执行确认");
      if (!String(payload.physicianId || "").trim()) throw inputError("异常确认必须记录医师标识");
      row.confirmation = { physicianId: String(payload.physicianId).trim(), evidenceRef, confirmedAt: at };
      row.status = "confirmed";
    } else if (action === "notify") {
      if (row.status !== "confirmed") throw conflictError("异常通知前必须完成医师确认");
      const receipt = payload.deliveryReceipt || {};
      if (receipt.status !== "delivered" || !String(receipt.receiptId || "").trim() || !String(receipt.channel || "").trim() || !validDate(receipt.deliveredAt)) throw inputError("异常通知必须提供真实送达回执");
      row.notificationReceipt = { receiptId: String(receipt.receiptId).trim(), channel: String(receipt.channel).trim(), status: "delivered", deliveredAt: String(receipt.deliveredAt), evidenceRef };
      row.status = "resident-notified";
      row.residentTask.status = "notified";
    } else if (action === "schedule-review") {
      if (row.status !== "resident-notified") throw conflictError("安排复查前必须确认居民已收到通知");
      if (!String(payload.appointmentRef || "").trim() || !String(payload.targetOrganization || "").trim() || !validDate(payload.dueAt)) throw inputError("复查安排必须提供预约引用、目标机构和有效日期");
      row.reviewAppointment = { appointmentRef: String(payload.appointmentRef).trim(), targetOrganization: String(payload.targetOrganization).trim(), dueAt: String(payload.dueAt), evidenceRef };
      row.status = "review-scheduled";
      row.residentTask.status = "review-scheduled";
    } else if (action === "family-doctor-followup") {
      if (row.status !== "review-scheduled") throw conflictError("家医随访前必须完成复查安排");
      if (!String(payload.followupRef || "").trim() || !String(payload.familyDoctorTeam || "").trim() || !String(payload.outcome || "").trim()) throw inputError("家医随访必须提供随访引用、团队和结果");
      row.familyDoctorFollowup = { followupRef: String(payload.followupRef).trim(), familyDoctorTeam: String(payload.familyDoctorTeam).trim(), outcome: String(payload.outcome).trim(), followedAt: at, evidenceRef };
      row.status = "followup-completed";
      row.residentTask.status = "followup-completed";
    } else if (action === "close") {
      if (row.status !== "followup-completed" || !row.notificationReceipt || !row.reviewAppointment || !row.familyDoctorFollowup) throw conflictError("关闭前必须完成通知送达、复查安排和家医随访");
      row.closureEvidenceRef = evidenceRef;
      row.status = "closed";
      row.closedAt = at;
      row.residentTask.status = "closed";
    } else {
      if (row.status !== "closed") throw conflictError("仅已关闭记录可以重开");
      row.status = "reopened";
      row.closedAt = "";
      row.closureEvidenceRef = "";
      row.residentTask.status = "pending";
    }
    row.updatedAt = at;
    row.actions = [{ action, at, actor, evidenceRef, note: String(payload.note || "").trim() }, ...(row.actions || [])].slice(0, 40);
    workflow.status = cases.length && cases.every((item) => item.status === "closed") ? "closed" : "open";
    workflow.updatedAt = at;
    return row;
  }

  function validateAbnormalClosure(workflow = {}) {
    const cases = Array.isArray(workflow.cases) ? workflow.cases : [];
    const issues = [];
    if (!String(workflow.reportId || "").trim()) issues.push("workflow-report-id-missing");
    if (!cases.length && workflow.status !== "not-required") issues.push("workflow-cases-missing");
    cases.forEach((row) => {
      const prefix = row.findingCode || row.id || "unknown";
      if (row.status !== "closed") issues.push(`${prefix}:not-closed`);
      if (!row.confirmation?.physicianId || !row.confirmation?.evidenceRef) issues.push(`${prefix}:confirmation-evidence-missing`);
      if (row.notificationReceipt?.status !== "delivered" || !row.notificationReceipt?.receiptId) issues.push(`${prefix}:delivery-receipt-missing`);
      if (!row.reviewAppointment?.appointmentRef || !validDate(row.reviewAppointment?.dueAt)) issues.push(`${prefix}:review-appointment-missing`);
      if (!row.familyDoctorFollowup?.followupRef || !row.familyDoctorFollowup?.outcome) issues.push(`${prefix}:family-doctor-followup-missing`);
      if (!row.closureEvidenceRef) issues.push(`${prefix}:closure-evidence-missing`);
      const actions = new Set((row.actions || []).map((item) => item.action));
      ["confirm", "notify", "schedule-review", "family-doctor-followup", "close"].forEach((action) => {
        if (!actions.has(action)) issues.push(`${prefix}:action-${action}-missing`);
      });
    });
    return result("abnormal-care-closure", issues, { reportId: String(workflow.reportId || "").trim(), cases: cases.length, closed: cases.filter((item) => item.status === "closed").length });
  }

  function validateIndependentSignoff(signoff = {}) {
    const issues = [];
    const submittedBy = String(signoff.submittedBy || "").trim();
    const verifiedBy = String(signoff.verifiedBy || "").trim();
    const evidenceDigest = normalizeDigest(signoff.evidenceDigest);
    const verifiedDigest = normalizeDigest(signoff.verifiedDigest);
    if (!submittedBy) issues.push("signoff-submitter-missing");
    if (!verifiedBy) issues.push("signoff-verifier-missing");
    if (submittedBy && verifiedBy && submittedBy.toLowerCase() === verifiedBy.toLowerCase()) issues.push("signoff-self-verification-forbidden");
    if (!String(signoff.externalSigner || "").trim() || !String(signoff.signerOrganization || "").trim()) issues.push("external-signer-incomplete");
    if (!String(signoff.submissionRef || "").trim() || !String(signoff.verificationRef || "").trim()) issues.push("signoff-evidence-ref-incomplete");
    if (!evidenceDigest || !verifiedDigest || evidenceDigest !== verifiedDigest) issues.push("signoff-digest-mismatch");
    if (signoff.status !== "independently-verified") issues.push("signoff-not-independently-verified");
    if (!validDate(signoff.submittedAt) || !validDate(signoff.verifiedAt)) issues.push("signoff-time-invalid");
    return result("independent-site-signoff", issues, { submittedBy, verifiedBy, evidenceDigest });
  }

  function validateStandaloneSmoke(smoke = {}) {
    const issues = [];
    const loadedModules = normalizeList(smoke.loadedModules);
    const requiredFiles = normalizeList(smoke.requiredFiles);
    if (smoke.moduleId !== MODULE_ID) issues.push("module-id-invalid");
    if (!String(smoke.entry || "").startsWith("physical-examination-")) issues.push("standalone-entry-invalid");
    if (loadedModules.some((item) => FORBIDDEN_DOMAIN_PATTERN.test(item))) issues.push("forbidden-cross-domain-dependency");
    REQUIRED_STANDALONE_FILES.forEach((file) => {
      if (!requiredFiles.includes(file)) issues.push(`standalone-file-missing:${file}`);
    });
    const probes = Array.isArray(smoke.probes) ? smoke.probes : [];
    ["static-entry", "field-mapping", "signature-contract", "archive-scan", "care-closure"].forEach((id) => {
      if (!probes.some((probe) => probe.id === id && probe.passed === true && String(probe.evidenceRef || "").trim())) issues.push(`smoke-probe-failed:${id}`);
    });
    if (!validDate(smoke.executedAt)) issues.push("smoke-executed-at-invalid");
    if (!String(smoke.evidenceRef || "").trim()) issues.push("smoke-evidence-ref-missing");
    return result("standalone-smoke", issues, { moduleId: smoke.moduleId, entry: smoke.entry, probes: probes.length });
  }

  function validateRollbackGate(rollback = {}) {
    const issues = [];
    if (!String(rollback.currentVersion || "").trim() || !String(rollback.previousVersion || "").trim()) issues.push("rollback-version-incomplete");
    if (!normalizeDigest(rollback.artifactSha256)) issues.push("rollback-artifact-sha256-invalid");
    if (!String(rollback.snapshotRef || "").trim()) issues.push("rollback-snapshot-ref-missing");
    if (!String(rollback.rehearsalRef || "").trim()) issues.push("rollback-rehearsal-ref-missing");
    if (!validDate(rollback.rehearsedAt)) issues.push("rollback-rehearsed-at-invalid");
    if (!(Number(rollback.targetRtoMinutes) > 0) || Number(rollback.restoreDurationMinutes) > Number(rollback.targetRtoMinutes)) issues.push("rollback-rto-not-met");
    if (rollback.reconciliationPassed !== true) issues.push("rollback-reconciliation-not-passed");
    if (rollback.approved !== true) issues.push("rollback-not-approved");
    const preparedBy = String(rollback.preparedBy || "").trim();
    const approvedBy = String(rollback.approvedBy || "").trim();
    if (!preparedBy || !approvedBy || preparedBy.toLowerCase() === approvedBy.toLowerCase()) issues.push("rollback-independent-approval-invalid");
    return result("rollback-gate", issues, { previousVersion: String(rollback.previousVersion || "").trim(), snapshotRef: String(rollback.snapshotRef || "").trim(), restoreDurationMinutes: Number(rollback.restoreDurationMinutes || 0) });
  }

  function buildGoLiveDecision(bundle = {}) {
    const enabledSourceTypes = normalizeList(bundle.enabledSourceTypes).length
      ? normalizeList(bundle.enabledSourceTypes)
      : ["exam-center", "hospital"];
    const mappings = Array.isArray(bundle.mappingEvidence) ? bundle.mappingEvidence.map(validateSourceMappingEvidence) : [];
    const receipts = Array.isArray(bundle.integrationReceipts) ? bundle.integrationReceipts.map(validateIntegrationReceipt) : [];
    const signatures = Array.isArray(bundle.reports) ? bundle.reports.map(validateReportSignatureContract) : [];
    const archives = Array.isArray(bundle.archiveEvidence) ? bundle.archiveEvidence.map(validateArchiveEvidence) : [];
    const workflows = Array.isArray(bundle.workflows) ? bundle.workflows.map(validateAbnormalClosure) : [];
    const signoffs = Array.isArray(bundle.siteSignoffs) ? bundle.siteSignoffs.map(validateIndependentSignoff) : [];
    const smoke = validateStandaloneSmoke(bundle.smoke || {});
    const rollback = validateRollbackGate(bundle.rollback || {});
    const checks = [
      aggregate("source-mappings", mappings, enabledSourceTypes.length, enabledSourceTypes),
      aggregate("integration-receipts", receipts, enabledSourceTypes.length),
      aggregate("report-signatures", signatures, 1),
      aggregate("archive-evidence", archives, signatures.length || 1),
      aggregate("care-closures", workflows, 1),
      aggregate("site-signoffs", signoffs, enabledSourceTypes.length),
      smoke,
      rollback
    ];
    const sourceCoverageIssues = enabledSourceTypes.filter((sourceType) => !mappings.some((item) => item.ok && item.evidence?.sourceType === sourceType));
    if (sourceCoverageIssues.length) checks.push(failed("source-coverage", sourceCoverageIssues.map((item) => `source-not-covered:${item}`)));
    const environment = String(bundle.environment || "demo").trim().toLowerCase();
    const externalEvidenceReady = checks.every((item) => item.ok);
    const productionEnvironment = environment === "production";
    const goLiveReady = productionEnvironment && externalEvidenceReady;
    const blockers = [
      ...(!productionEnvironment ? [`runtime-environment:${environment || "missing"}`] : []),
      ...checks.flatMap((item) => item.ok ? [] : item.issues.map((issue) => `${item.id}:${issue}`))
    ];
    return {
      version: VERSION,
      moduleId: MODULE_ID,
      generatedAt: new Date().toISOString(),
      decision: goLiveReady ? "GO" : "NO-GO",
      codeReady: true,
      externalEvidenceReady,
      productionEnvironment,
      goLiveReady,
      enabledSourceTypes,
      checks,
      blockers,
      boundary: goLiveReady
        ? "本次判定仅对所提交的体检模块现场证据包有效；证据或配置变化后必须重新评估。"
        : "现场回执、真实签名、原件扫描归档、异常闭环、独立签署、冒烟或回退证据任一缺失时保持 NO-GO。"
    };
  }

  function aggregate(id, rows, minimum, expectedSourceTypes = []) {
    const issues = rows.flatMap((row) => row.ok ? [] : row.issues);
    if (rows.length < minimum) issues.push(`evidence-count:${rows.length}/${minimum}`);
    if (expectedSourceTypes.length) {
      expectedSourceTypes.forEach((sourceType) => {
        if (!rows.some((row) => row.ok && row.evidence?.sourceType === sourceType)) issues.push(`missing-source:${sourceType}`);
      });
    }
    return result(id, issues, { count: rows.length, passed: rows.filter((row) => row.ok).length });
  }

  function normalizeMappedFindings(value, aliases) {
    const rows = Array.isArray(value) ? value : [];
    return rows.map((row) => {
      const normalized = {};
      Object.entries(aliases).forEach(([target, paths]) => {
        const match = firstPath(row, paths);
        if (match.found) normalized[target] = match.value;
      });
      normalized.abnormal = booleanFlag(normalized.abnormal);
      normalized.criticalValue = booleanFlag(normalized.criticalValue);
      return normalized;
    });
  }

  function familyDoctorSuggestionFor(finding = {}) {
    const code = String(finding.code || "").toUpperCase();
    const packageId = ["BP", "BMI"].includes(code) ? "hypertension-risk-review"
      : ["GLU", "HBA1C"].includes(code) ? "diabetes-risk-review"
        : "general-health-risk-review";
    return { packageId, action: "review-or-sign-contract", requiresResidentConsent: true, autoSign: false };
  }

  function firstPath(value, paths) {
    for (const path of paths) {
      const result = getPath(value, path);
      if (result.found) return { ...result, path };
    }
    return { found: false, value: undefined, path: "" };
  }

  function getPath(value, path) {
    const segments = String(path || "").split(".").filter(Boolean);
    let current = value;
    for (const segment of segments) {
      if (!current || typeof current !== "object" || !Object.prototype.hasOwnProperty.call(current, segment)) return { found: false, value: undefined };
      current = current[segment];
    }
    return current === undefined || current === null ? { found: false, value: undefined } : { found: true, value: current };
  }

  function isAbnormalFinding(finding) {
    return finding?.abnormal === true || finding?.criticalValue === true || /异常|偏高|偏低|阳性|危急/i.test(String(finding?.status || ""));
  }

  function booleanFlag(value) {
    if (value === true || value === 1) return true;
    return /^(true|1|yes|y|abnormal|positive|是|异常|阳性)$/i.test(String(value || "").trim());
  }

  function normalizeDigest(value) {
    const digest = String(value || "").trim().toLowerCase();
    return DIGEST_PATTERN.test(digest) ? digest : "";
  }

  function normalizeList(value) {
    if (Array.isArray(value)) return [...new Set(value.map((item) => String(item || "").trim()).filter(Boolean))];
    return String(value || "").split(/[;,；\n]/).map((item) => item.trim()).filter(Boolean);
  }

  function validDate(value) {
    return Boolean(value) && !Number.isNaN(new Date(value).getTime());
  }

  function addDays(value, days) {
    const date = new Date(value || "");
    if (Number.isNaN(date.getTime())) return "";
    date.setUTCDate(date.getUTCDate() + Number(days || 0));
    return date.toISOString().slice(0, 10);
  }

  function stableHash(value) {
    let hash = 2166136261;
    for (const char of String(value || "")) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  function result(id, issues, evidence = {}) {
    const normalized = [...new Set((issues || []).filter(Boolean))];
    return { id, ok: normalized.length === 0, issues: normalized, evidence };
  }

  function failed(id, issues) {
    return result(id, issues, {});
  }

  function inputError(message) {
    const error = new Error(message);
    error.statusCode = 400;
    return error;
  }

  function conflictError(message) {
    const error = new Error(message);
    error.statusCode = 409;
    return error;
  }

  return {
    CLOSURE_ACTIONS,
    DIGEST_PATTERN,
    MODULE_ID,
    REQUIRED_STANDALONE_FILES,
    SITE_EVIDENCE_REQUIREMENTS,
    SOURCE_MAPPING_PROFILES,
    VERSION,
    applyAbnormalClosureAction,
    buildGoLiveDecision,
    createAbnormalClosure,
    mapSourceReport,
    validateAbnormalClosure,
    validateArchiveEvidence,
    validateIndependentSignoff,
    validateIntegrationReceipt,
    validateReportSignatureContract,
    validateRollbackGate,
    validateSourceMappingEvidence,
    validateStandaloneSmoke
  };
});
