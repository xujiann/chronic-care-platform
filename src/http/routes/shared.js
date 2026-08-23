"use strict";

const { createResidentAuthorizationDecisionAdapter } = require("../../platform/governance/resident-authorization-decision-adapter");
const { COMMAND_ID: REGIONAL_SHARING_ACCESS_COMMAND_ID, createRegionalSharingAccessCommand, projectRegionalSharingAccessResponse, projectRegionalSharingReadResponse, sha256: regionalSharingSha256, withRegionalSharingPackageWriteLock } = require("../../platform/governance/regional-sharing-access-command");
const { protectSharedRouteSegments } = require("../shared/route-policy");

function createRouteSegments(runtime, options = {}) {
  const { BloodClinicalProduction, EmergencyModuleGate, SERVICE_ORDER_SOURCE_COLLECTIONS, T10SpecialtyModuleGovernance, appendDataAccessLog, appendSecurityEvent, applyPilotInterfaceReviewAction, authorizationState, buildAuthorizationLifecycle, buildConsortiumPerformanceReport, buildDataGovernanceOverview, buildDataQualityIssues, buildDataQualityScorecard, buildDrugConsumableSupervision, buildDrugTraceabilityEvidenceSubmission, buildMasterDataDirectory, buildMobileExperience, buildMultiPracticeRegistry, buildObservabilityAlertCenter, buildPilotAcceptanceCenter, buildPriorityApplicationTemplates, buildServiceAcceptanceSummary, buildServiceOrderSummary, buildSpecialtyCutoverPack, buildT10PlatformBlockedReadiness, calculateCreditEvaluations, canAccessResident, canAccessServiceOrder, canReadT10InstitutionModules, collectJson, dispatchAlert, normalizeServiceOrders, normalizeState, prependAuditTrailEntry, randomUUID, readDatabase, redactSensitiveResponse, regionalSharingReadModel, requireApiRole, resealAuditTrail, scopeStateForUser, sealAuditTrail, seedAccessibilityChecklist, seedMobileExperienceSettings, sendJson, sendT10SpecialtyModuleError, trustedT10Institution, updateDrugConsumableSupervision, upsertAlertDeliveryIncident, validateAlert, writeDatabase } = runtime;
  const residentAuthorizationDecision = createResidentAuthorizationDecisionAdapter({
    authorizationState,
    buildAuthorizationLifecycle
  });
  const regionalSharingAccessCommand = createRegionalSharingAccessCommand({
    appendDataAccessLog,
    canAccessResident,
    createId: randomUUID,
    prependAuditTrailEntry,
    readAuthorizationDecision: residentAuthorizationDecision.decide
  }, {
    activeRegionCode: options.regionalContext?.regionCode,
    atomicRepository: options.regionalProductionGate?.atomicRepositoryReady,
    capabilityEnabled: options.regionalCapabilityEnabled,
    environment: options.environment,
    productionCutoverAuthorized: options.regionalProductionGate?.productionCutoverAuthorized,
    storageEngine: options.regionalProductionGate?.storageEngine
  });
  const segments = [
    {
      id: "shared-01",
      domain: "shared",
      async handle(req, res, url) {
    if (req.method === "GET" && (url.pathname === "/api/t10-specialty/cutover-pack" || url.pathname === "/api/t10-specialty-cutover")) {
        const user = requireApiRole(req, res, ["commission"], url.pathname);
        if (!user) return true;
        const data = readDatabase();
        const institutionId = String(url.searchParams.get("institutionId") || "").trim();
        let institutionModuleSelection = null;
        if (institutionId) {
          if (!trustedT10Institution(data, institutionId)) {
            sendJson(res, 404, { error: "Not Found", code: "T10_INSTITUTION_NOT_FOUND", message: "trusted institution was not found" });
            return true;
          }
          institutionModuleSelection = T10SpecialtyModuleGovernance.buildInstitutionModuleView(data, institutionId);
        }
        const pack = buildSpecialtyCutoverPack({
          enabledTrackIds: institutionModuleSelection?.enabledModuleIds
        });
        appendSecurityEvent({
          actor: user.name,
          role: user.role,
          action: "t10-specialty-cutover-read",
          target: url.pathname,
          result: "allowed",
          detail: `${institutionId || "all-institutions"}; ${pack.summary.codeReady}/${pack.summary.tracks} code-ready; ${pack.summary.productionReady}/${pack.summary.tracks} production-ready.`
        });
        sendJson(res, 200, {
          ...pack,
          ...(institutionModuleSelection ? { institutionModuleSelection } : {})
        });
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/t10-specialty/modules") {
        const user = requireApiRole(req, res, ["commission", "institution"], url.pathname);
        if (!user) return true;
        const institutionId = String(url.searchParams.get("institutionId") || user.orgCode || "").trim();
        const data = readDatabase();
        if (!canReadT10InstitutionModules(user, institutionId)) {
          appendSecurityEvent({
            actor: user.name,
            role: user.role,
            action: "t10-specialty-module-selection-read",
            target: institutionId,
            result: "denied",
            detail: "institution scope denied"
          });
          sendJson(res, 403, { error: "Forbidden", code: "T10_MODULE_SCOPE_DENIED", message: "institution module scope denied" });
          return true;
        }
        if (!trustedT10Institution(data, institutionId)) {
          sendJson(res, 404, { error: "Not Found", code: "T10_INSTITUTION_NOT_FOUND", message: "trusted institution was not found" });
          return true;
        }
        const view = T10SpecialtyModuleGovernance.buildInstitutionModuleView(data, institutionId);
        appendSecurityEvent({
          actor: user.name,
          role: user.role,
          action: "t10-specialty-module-selection-read",
          target: institutionId,
          result: "allowed",
          detail: `${view.enabledModuleIds.length} controlled-rehearsal modules; ${view.formalGoLiveState}`
        });
        sendJson(res, 200, view);
        return true;
      }

      const t10SpecialtyModuleActionMatch = url.pathname.match(/^\/api\/t10-specialty\/modules\/([^/]+)\/actions$/);
      if (req.method === "POST" && t10SpecialtyModuleActionMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/t10-specialty/modules/:institutionId/actions");
        if (!user) return true;
        const institutionId = decodeURIComponent(t10SpecialtyModuleActionMatch[1]);
        const payload = await collectJson(req);
        try {
          const data = readDatabase();
          const at = new Date().toISOString();
          const result = T10SpecialtyModuleGovernance.applyInstitutionModuleAction(
            data,
            institutionId,
            payload,
            {
              ...user,
              id: String(user.id || user.username || "").trim()
            },
            {
              at,
              idempotencyKey: String(req.headers["idempotency-key"] || "").trim(),
              institutionExists: (candidate) => Boolean(trustedT10Institution(data, candidate))
            }
          );
          result.state.securityEvents = resealAuditTrail([
            {
              id: randomUUID(),
              at: new Date(at).toLocaleString("zh-CN", { hour12: false }),
              actor: user.name,
              role: user.role,
              action: "t10-specialty-module-selection-change",
              target: institutionId,
              result: "allowed",
              detail: `${payload.action}:${payload.moduleId}; version=${result.record.version}; ${result.view.formalGoLiveState}`
            },
            ...(Array.isArray(result.state.securityEvents) ? result.state.securityEvents : [])
          ].slice(0, 120));
          if (result.replayed) {
            appendSecurityEvent({
              actor: user.name,
              role: user.role,
              action: "t10-specialty-module-selection-replay",
              target: institutionId,
              result: "allowed",
              detail: `${payload.action}:${payload.moduleId}; version=${result.record.version}`
            });
          } else {
            writeDatabase(result.state);
          }
          sendJson(res, 200, {
            ...result.view,
            replayed: result.replayed
          });
        } catch (error) {
          appendSecurityEvent({
            actor: user.name,
            role: user.role,
            action: "t10-specialty-module-selection-change",
            target: institutionId,
            result: "denied",
            detail: `${String(error?.code || "T10_MODULE_REQUEST_INVALID")}:${String(error?.message || "").slice(0, 240)}`
          });
          sendT10SpecialtyModuleError(res, error);
        }
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/t10-specialty/modules/clinical-blood/readiness") {
        const user = requireApiRole(req, res, ["commission"], url.pathname);
        if (!user) return true;
        const readiness = buildT10PlatformBlockedReadiness(BloodClinicalProduction.evaluateProductionReadiness({}));
        appendSecurityEvent({
          actor: user.name,
          role: user.role,
          action: "t10-clinical-blood-readiness-read",
          target: url.pathname,
          result: "allowed",
          detail: `${readiness.blockers?.length || 0} module evidence blockers; platform production gate closed`
        });
        sendJson(res, 200, readiness);
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/t10-specialty/modules/emergency-life-chain/readiness") {
        const user = requireApiRole(req, res, ["commission"], url.pathname);
        if (!user) return true;
        const readiness = buildT10PlatformBlockedReadiness(EmergencyModuleGate.buildIndependentModuleReadiness(readDatabase()));
        appendSecurityEvent({
          actor: user.name,
          role: user.role,
          action: "t10-emergency-module-readiness-read",
          target: url.pathname,
          result: "allowed",
          detail: `${readiness.rollback?.triggers?.length || 0} rollback triggers; platform production gate closed`
        });
        sendJson(res, 200, readiness);
        return true;
      }
        return false;
      }
    },
    {
      id: "shared-02",
      domain: "shared",
      async handle(req, res, url) {
    if (req.method === "GET" && url.pathname === "/api/priority-applications/templates") {
        const user = requireApiRole(req, res, ["commission"], "/api/priority-applications/templates");
        if (!user) return true;
        const data = readDatabase();
        appendSecurityEvent({
          actor: user.name,
          role: user.role,
          action: "priority-application-templates",
          target: "/api/priority-applications/templates",
          result: "allowed",
          detail: "Eight priority application development templates read."
        });
        sendJson(res, 200, buildPriorityApplicationTemplates({ data }));
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/pilot-acceptance/center") {
        const user = requireApiRole(req, res, ["commission"], "/api/pilot-acceptance/center");
        if (!user) return true;
        const center = buildPilotAcceptanceCenter({ data: readDatabase(), env: process.env });
        appendSecurityEvent({
          actor: user.name,
          role: user.role,
          action: "pilot-acceptance-center",
          target: "/api/pilot-acceptance/center",
          result: "allowed",
          detail: `${center.summary.regressionReady}/8 applications regression-ready; ${center.summary.openIssues} pilot issues visible.`
        });
        sendJson(res, 200, center);
        return true;
      }

      const pilotAcceptanceInterfaceActionMatch = url.pathname.match(/^\/api\/pilot-acceptance\/interfaces\/([^/]+)\/actions$/);
      if (req.method === "POST" && pilotAcceptanceInterfaceActionMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/pilot-acceptance/interfaces/:id/actions");
        if (!user) return true;
        const interfaceId = decodeURIComponent(pilotAcceptanceInterfaceActionMatch[1]);
        const payload = await collectJson(req);
        const data = readDatabase();
        let result;
        try {
          result = applyPilotInterfaceReviewAction(data, interfaceId, payload, user);
        } catch (error) {
          sendJson(res, /not found/.test(error.message) ? 404 : 400, { error: "Bad Request", message: error.message });
          return true;
        }
        data.pilotAcceptanceInterfaceReviews = result.reviews;
        data.securityEvents = [
          {
            id: randomUUID(),
            at: new Date().toLocaleString("zh-CN", { hour12: false }),
            actor: user.name,
            role: user.role,
            action: "pilot-interface-joint-test-action",
            target: interfaceId,
            result: "allowed",
            detail: `${payload.action} / ${result.item.workflowStatus} / ${result.item.evidenceRef || "no-evidence"}`
          },
          ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
        ].slice(0, 120);
        writeDatabase(data);
        sendJson(res, 200, {
          ok: true,
          interfaceReview: result.item,
          center: buildPilotAcceptanceCenter({ data, env: process.env })
        });
        return true;
      }
        return false;
      }
    },
    {
      id: "shared-03",
      domain: "shared",
      async handle(req, res, url) {
    if (req.method === "GET" && url.pathname === "/api/observability/alerts") {
        const user = requireApiRole(req, res, ["commission"], "/api/observability/alerts");
        if (!user) return true;
        const data = readDatabase();
        const center = buildObservabilityAlertCenter(data);
        appendSecurityEvent({
          actor: user.name,
          role: user.role,
          action: "observability-alert-center-read",
          target: "/api/observability/alerts",
          result: "allowed",
          detail: `${center.summary.activeSignals} signals / ${center.summary.failed} failed deliveries / production ready false`
        });
        sendJson(res, 200, center);
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/observability/alerts/dispatch") {
        const user = requireApiRole(req, res, ["commission"], "/api/observability/alerts/dispatch");
        if (!user) return true;
        const payload = await collectJson(req);
        let validated;
        try {
          validated = validateAlert(payload);
        } catch (error) {
          sendJson(res, 400, { error: "Bad Request", message: error.message });
          return true;
        }
        const data = readDatabase();
        const idempotencyKey = validated.idempotencyKey;
        const duplicate = (data.observabilityAlertDeliveries || []).find((item) => item.route === validated.route && item.idempotencyKey === idempotencyKey);
        if (duplicate) {
          sendJson(res, 200, { ...duplicate, idempotentReplay: true });
          return true;
        }
        const baseDelivery = {
          id: `oad-${randomUUID()}`,
          route: validated.route,
          fingerprint: validated.alert.fingerprint,
          idempotencyKey,
          alert: validated.alert,
          status: "dispatching",
          retryCount: 0,
          deadLetter: false,
          deadLetterReason: "",
          createdAt: new Date().toISOString(),
          createdBy: user.username || user.role
        };
        let delivery;
        let incident;
        try {
          const receipt = await dispatchAlert({ route: validated.route, idempotencyKey, alert: validated.alert });
          delivery = {
            ...baseDelivery,
            status: receipt.status,
            adapterReceipt: receipt,
            deliveredAt: receipt.acceptedAt,
            reconciliationStatus: "receiver-accepted"
          };
        } catch (error) {
          delivery = {
            ...baseDelivery,
            status: "failed",
            deadLetter: true,
            deadLetterReason: String(error.message || "alert delivery failed").slice(0, 240),
            failedAt: new Date().toISOString(),
            reconciliationStatus: "operations-incident-open"
          };
          incident = upsertAlertDeliveryIncident(data, delivery, false);
        }
        data.observabilityAlertDeliveries = [delivery, ...(Array.isArray(data.observabilityAlertDeliveries) ? data.observabilityAlertDeliveries : [])].slice(0, 200);
        data.securityEvents = sealAuditTrail([{
          id: randomUUID(),
          at: new Date().toLocaleString("zh-CN", { hour12: false }),
          actor: user.name,
          role: user.role,
          action: "observability-alert-dispatch",
          target: `${validated.route}:${validated.alert.fingerprint}`,
          result: delivery.deadLetter ? "failed" : "allowed",
          detail: delivery.deadLetter ? `${delivery.id} moved to operations incident` : `${delivery.adapterReceipt.receiptId} receiver accepted`
        }, ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])].slice(0, 120), { recompute: true });
        writeDatabase(normalizeState(data));
        sendJson(res, delivery.deadLetter ? 502 : 202, { ok: !delivery.deadLetter, delivery, incident, center: buildObservabilityAlertCenter(readDatabase()) });
        return true;
      }

      const observabilityAlertRetryMatch = url.pathname.match(/^\/api\/observability\/alert-deliveries\/([^/]+)\/retry$/);
      if (req.method === "POST" && observabilityAlertRetryMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/observability/alert-deliveries/:id/retry");
        if (!user) return true;
        const data = readDatabase();
        const deliveries = Array.isArray(data.observabilityAlertDeliveries) ? data.observabilityAlertDeliveries : [];
        const index = deliveries.findIndex((item) => item.id === decodeURIComponent(observabilityAlertRetryMatch[1]));
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "alert delivery not found" });
          return true;
        }
        if (Number(deliveries[index].retryCount || 0) >= 3) {
          sendJson(res, 409, { error: "Conflict", message: "alert delivery reached the manual retry limit" });
          return true;
        }
        const delivery = {
          ...deliveries[index],
          retryCount: Number(deliveries[index].retryCount || 0) + 1,
          lastRetriedAt: new Date().toISOString()
        };
        let incident;
        try {
          const receipt = await dispatchAlert({ route: delivery.route, idempotencyKey: delivery.idempotencyKey, alert: delivery.alert });
          Object.assign(delivery, {
            status: receipt.status,
            adapterReceipt: receipt,
            deliveredAt: receipt.acceptedAt,
            deadLetter: false,
            deadLetterReason: "",
            reconciliationStatus: "receiver-accepted-after-retry",
            lastRetryResult: "receiver-accepted"
          });
          incident = upsertAlertDeliveryIncident(data, delivery, true);
        } catch (error) {
          Object.assign(delivery, {
            status: "failed",
            deadLetter: true,
            deadLetterReason: String(error.message || "alert delivery retry failed").slice(0, 240),
            failedAt: new Date().toISOString(),
            reconciliationStatus: "operations-incident-open",
            lastRetryResult: "failed"
          });
          incident = upsertAlertDeliveryIncident(data, delivery, false);
        }
        deliveries[index] = delivery;
        data.observabilityAlertDeliveries = deliveries;
        data.securityEvents = sealAuditTrail([{
          id: randomUUID(),
          at: new Date().toLocaleString("zh-CN", { hour12: false }),
          actor: user.name,
          role: user.role,
          action: "observability-alert-delivery-retry",
          target: delivery.id,
          result: delivery.deadLetter ? "failed" : "allowed",
          detail: `${delivery.route}:${delivery.fingerprint} / retry=${delivery.retryCount} / ${delivery.lastRetryResult}`
        }, ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])].slice(0, 120), { recompute: true });
        writeDatabase(normalizeState(data));
        sendJson(res, 200, { ok: !delivery.deadLetter, delivery, incident, center: buildObservabilityAlertCenter(readDatabase()) });
        return true;
      }
        return false;
      }
    },
    {
      id: "shared-04",
      domain: "shared",
      async handle(req, res, url) {
    if (req.method === "GET" && url.pathname === "/api/drug-consumable-supervision") {
        const user = requireApiRole(req, res, ["commission", "insurance", "institution"], "/api/drug-consumable-supervision");
        if (!user) return true;
        sendJson(res, 200, redactSensitiveResponse(buildDrugConsumableSupervision(scopeStateForUser(readDatabase(), user)), user));
        return true;
      }

      if (req.method === "POST" && url.pathname.startsWith("/api/drug-consumable-supervision/") && url.pathname.endsWith("/review")) {
        const user = requireApiRole(req, res, ["commission", "insurance"], "/api/drug-consumable-supervision/:id/review");
        if (!user) return true;
        const id = decodeURIComponent(url.pathname.replace("/api/drug-consumable-supervision/", "").replace("/review", ""));
        const payload = await collectJson(req);
        const result = updateDrugConsumableSupervision(readDatabase(), id, {
          reviewStatus: String(payload.reviewStatus || payload.status || "reviewed"),
          insuranceStatus: String(payload.insuranceStatus || "coordinating"),
          status: String(payload.status || "in-review"),
          nextAction: String(payload.nextAction || payload.note || "Continue insurance and institution coordination.")
        }, user, "drug-consumable-review");
        sendJson(res, result.status, result.body);
        return true;
      }

      if (req.method === "POST" && url.pathname.startsWith("/api/drug-consumable-supervision/") && url.pathname.endsWith("/remediation")) {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/drug-consumable-supervision/:id/remediation");
        if (!user) return true;
        const id = decodeURIComponent(url.pathname.replace("/api/drug-consumable-supervision/", "").replace("/remediation", ""));
        const payload = await collectJson(req);
        const result = updateDrugConsumableSupervision(readDatabase(), id, {
          remediationStatus: String(payload.remediationStatus || payload.status || "submitted"),
          status: String(payload.status || "remediation-submitted"),
          evidence: String(payload.evidence || ""),
          nextAction: String(payload.nextAction || payload.note || "Regulator reviews remediation evidence.")
        }, user, "drug-consumable-remediation");
        sendJson(res, result.status, result.body);
        return true;
      }

      if (req.method === "POST" && url.pathname.startsWith("/api/drug-consumable-supervision/") && url.pathname.endsWith("/insurance-sync")) {
        const user = requireApiRole(req, res, ["commission", "insurance"], "/api/drug-consumable-supervision/:id/insurance-sync");
        if (!user) return true;
        const id = decodeURIComponent(url.pathname.replace("/api/drug-consumable-supervision/", "").replace("/insurance-sync", ""));
        const payload = await collectJson(req);
        const result = updateDrugConsumableSupervision(readDatabase(), id, {
          insuranceStatus: String(payload.insuranceStatus || "synced"),
          settlementBatch: String(payload.settlementBatch || "demo-batch"),
          status: String(payload.status || "insurance-synced"),
          nextAction: String(payload.nextAction || payload.note || "Archive settlement coordination evidence.")
        }, user, "drug-consumable-insurance-sync");
        sendJson(res, result.status, result.body);
        return true;
      }

      if (req.method === "POST" && url.pathname.startsWith("/api/drug-consumable-supervision/") && url.pathname.endsWith("/traceability-evidence")) {
        const user = requireApiRole(req, res, ["commission", "insurance", "institution"], "/api/drug-consumable-supervision/:id/traceability-evidence");
        if (!user) return true;
        const id = decodeURIComponent(url.pathname.replace("/api/drug-consumable-supervision/", "").replace("/traceability-evidence", ""));
        const data = readDatabase();
        const item = (Array.isArray(data.drugConsumableSupervisions) ? data.drugConsumableSupervisions : []).find((row) => row.id === id);
        if (!item) {
          sendJson(res, 404, { error: "Not Found", message: "drug consumable supervision not found" });
          return true;
        }
        const payload = await collectJson(req);
        const submission = buildDrugTraceabilityEvidenceSubmission(data, item, payload, user);
        const submissions = [submission, ...(Array.isArray(item.traceabilityEvidenceSubmissions) ? item.traceabilityEvidenceSubmissions : [])].slice(0, 10);
        const result = updateDrugConsumableSupervision(data, id, {
          traceabilityEvidenceSubmissions: submissions,
          traceabilityEvidenceStatus: submission.completeness,
          status: submission.completeness === "complete" ? String(payload.status || "traceability-evidence-complete") : String(payload.status || "traceability-evidence-partial"),
          remediationStatus: submission.completeness === "complete" ? String(payload.remediationStatus || "evidence-complete") : String(payload.remediationStatus || "evidence-partial"),
          nextAction: String(payload.nextAction || (submission.completeness === "complete" ? "Review submitted traceability evidence and archive field joint-test proof." : `Complete missing traceability fields: ${submission.missingFields.join(", ")}`))
        }, user, "drug-consumable-traceability-evidence");
        sendJson(res, result.status, result.body);
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/service-acceptance-summary") {
        const user = requireApiRole(req, res, ["commission"], "/api/service-acceptance-summary");
        if (!user) return true;
        const serviceAcceptance = buildServiceAcceptanceSummary(readDatabase());
        sendJson(res, 200, {
          ok: serviceAcceptance.ok,
          generatedAt: new Date().toISOString(),
          serviceAcceptance
        });
        return true;
      }
        return false;
      }
    },
    {
      id: "shared-05",
      domain: "shared",
      async handle(req, res, url) {
    if (req.method === "GET" && url.pathname === "/api/regional-data-sharing") {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/regional-data-sharing");
        if (!user) return true;
        const view = projectRegionalSharingReadResponse(regionalSharingReadModel.buildRegionalDataSharingView(readDatabase(), user));
        sendJson(res, 200, redactSensitiveResponse(view, user));
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/regional-data-sharing/handoff-report") {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/regional-data-sharing/handoff-report");
        if (!user) return true;
        const report = regionalSharingReadModel.buildRegionalHandoffReport(readDatabase(), user);
        appendSecurityEvent({
          actor: user.name,
          role: user.role,
          action: "生成区域共享交接清单",
          target: "/api/regional-data-sharing/handoff-report",
          result: "允许",
          detail: `${report.reportId}；${report.summary.packages} 个共享包，${report.summary.handoffReady} 个可交接`
        });
        sendJson(res, 200, redactSensitiveResponse(report, user));
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/regional-data-sharing/access-reviews") {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/regional-data-sharing/access-reviews");
        if (!user) return true;
        try {
          const payload = await collectJson(req);
          const result = await withRegionalSharingPackageWriteLock(payload?.packageId, async () => {
            const commandResult = regionalSharingAccessCommand.execute(readDatabase(), payload, user, {
              correlationId: req.correlationId,
              idempotencyKey: req.headers["idempotency-key"]
            });
            if (commandResult.nextData) writeDatabase(commandResult.nextData);
            return commandResult;
          });
          if (!result.nextData && !result.replayed && result.status >= 400) {
            appendSecurityEvent({
              actor: `principal:${regionalSharingSha256(user.id || user.accountId || user.username || user.role).slice(0, 16)}`,
              role: user.role,
              action: REGIONAL_SHARING_ACCESS_COMMAND_ID,
              target: "regional-sharing-access",
              result: "denied",
              detail: result.body.code
            });
          }
          if (result.body.legacyCompatibility) {
            res.setHeader("Deprecation", "true");
            res.setHeader("Warning", '299 - "regional sharing legacy compatibility is not production-ready"');
            res.setHeader("X-Regional-Sharing-Compatibility", "legacy-non-production");
          }
          sendJson(res, result.status, projectRegionalSharingAccessResponse(result.body));
        } catch {
          sendJson(res, 503, {
            ok: false,
            error: "Service Unavailable",
            code: "REGIONAL_SHARING_AUDIT_UNAVAILABLE",
            message: "regional sharing audit is unavailable",
            productionReady: false
          });
        }
        return true;
      }
        return false;
      }
    },
    {
      id: "shared-06",
      domain: "shared",
      async handle(req, res, url) {
    if (req.method === "GET" && url.pathname === "/api/service-orders") {
        const user = requireApiRole(req, res, ["commission", "institution", "county", "citizen"], "/api/service-orders");
        if (!user) return true;
        const data = readDatabase();
        const residentId = String(url.searchParams.get("residentId") || "").trim();
        const serviceType = String(url.searchParams.get("serviceType") || "").trim();
        const lifecycle = String(url.searchParams.get("lifecycle") || "").trim();
        if (residentId && !canAccessResident(user, residentId, data)) {
          appendSecurityEvent({ actor: user.name, role: user.role, action: "service-orders-query", target: residentId, result: "denied", detail: "resident scope denied" });
          sendJson(res, 403, { error: "Forbidden", message: "No access to this resident service order center" });
          return true;
        }
        const orders = (Array.isArray(data.serviceOrders) ? data.serviceOrders : normalizeServiceOrders(data))
          .filter((item) => canAccessServiceOrder(user, item, data))
          .filter((item) => !residentId || item.residentId === residentId)
          .filter((item) => !serviceType || item.serviceType === serviceType)
          .filter((item) => !lifecycle || item.lifecycle === lifecycle);
        if (residentId) {
          appendDataAccessLog(data, user, residentId, "serviceOrders", `query service order center ${serviceType || "all"}`, "allowed");
          writeDatabase(data);
        }
        sendJson(res, 200, redactSensitiveResponse({
          ok: true,
          collection: "serviceOrders",
          orders,
          summary: buildServiceOrderSummary(orders),
          schema: {
            id: "serviceOrders.v1",
            sourceCollections: SERVICE_ORDER_SOURCE_COLLECTIONS,
            filterFields: ["residentId", "serviceType", "lifecycle"]
          }
        }, user));
        return true;
      }
        return false;
      }
    },
    {
      id: "shared-07",
      domain: "shared",
      async handle(req, res, url) {
    if (req.method === "GET" && url.pathname === "/api/data-quality/issues") {
        const user = requireApiRole(req, res, ["commission"], "/api/data-quality/issues");
        if (!user) return true;
        const issues = buildDataQualityIssues(readDatabase());
        sendJson(res, 200, {
          issues,
          summary: issues.reduce((result, issue) => {
            result.total += 1;
            result.byType[issue.type] = (result.byType[issue.type] || 0) + 1;
            result.byStatus[issue.status] = (result.byStatus[issue.status] || 0) + 1;
            return result;
          }, { total: 0, byType: {}, byStatus: {} })
        });
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/data-quality/scorecard") {
        const user = requireApiRole(req, res, ["commission"], "/api/data-quality/scorecard");
        if (!user) return true;
        sendJson(res, 200, buildDataQualityScorecard(readDatabase()));
        return true;
      }
        return false;
      }
    },
    {
      id: "shared-08",
      domain: "shared",
      async handle(req, res, url) {
    if (req.method === "GET" && url.pathname === "/api/credit-evaluations/calculate") {
        const user = requireApiRole(req, res, ["commission"], "/api/credit-evaluations/calculate");
        if (!user) return true;
        const data = readDatabase();
        sendJson(res, 200, { rules: data.creditEvaluationRules, evaluations: calculateCreditEvaluations(data) });
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/performance/consortium-report") {
        const user = requireApiRole(req, res, ["commission", "county"], "/api/performance/consortium-report");
        if (!user) return true;
        sendJson(res, 200, buildConsortiumPerformanceReport(readDatabase()));
        return true;
      }
        return false;
      }
    },
    {
      id: "shared-09",
      domain: "shared",
      async handle(req, res, url) {
    if (req.method === "GET" && url.pathname === "/api/mobile/accessibility-checklist") {
        const user = requireApiRole(req, res, ["commission", "citizen"], "/api/mobile/accessibility-checklist");
        if (!user) return true;
        sendJson(res, 200, { checklist: readDatabase().accessibilityChecklist || seedAccessibilityChecklist() });
        return true;
      }

      const accessibilityActionMatch = url.pathname.match(/^\/api\/mobile\/accessibility-checklist\/([^/]+)\/actions$/);
      if (req.method === "POST" && accessibilityActionMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/mobile/accessibility-checklist/:id/actions");
        if (!user) return true;
        const data = readDatabase();
        const id = decodeURIComponent(accessibilityActionMatch[1]);
        const checklist = Array.isArray(data.accessibilityChecklist) ? data.accessibilityChecklist : seedAccessibilityChecklist();
        const index = checklist.findIndex((item) => item.id === id);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "Accessibility checklist item not found" });
          return true;
        }
        const payload = await collectJson(req);
        checklist[index] = {
          ...checklist[index],
          status: String(payload.status || checklist[index].status || "ready").trim(),
          evidence: String(payload.evidence || checklist[index].evidence || "").trim(),
          tester: String(payload.tester || user.name || user.username || "").trim(),
          action: String(payload.action || "update-accessibility-evidence").trim(),
          updatedAt: new Date().toISOString(),
          updatedBy: user.username || user.role
        };
        data.accessibilityChecklist = checklist;
        writeDatabase(data);
        sendJson(res, 200, checklist[index]);
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/mobile/experience") {
        const user = requireApiRole(req, res, ["commission", "citizen"], "/api/mobile/experience");
        if (!user) return true;
        sendJson(res, 200, buildMobileExperience(readDatabase(), user));
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/mobile/experience") {
        const user = requireApiRole(req, res, ["citizen"], "/api/mobile/experience");
        if (!user) return true;
        const data = readDatabase();
        const payload = await collectJson(req);
        const settings = data.mobileExperienceSettings && typeof data.mobileExperienceSettings === "object" ? data.mobileExperienceSettings : seedMobileExperienceSettings();
        const preferenceKey = user.residentId || user.accountId || user.username;
        const preferences = settings.userPreferences && typeof settings.userPreferences === "object" ? settings.userPreferences : {};
        preferences[preferenceKey] = {
          largeMode: payload.largeMode === undefined ? Boolean(preferences[preferenceKey]?.largeMode) : Boolean(payload.largeMode),
          weakNetworkMode: String(payload.weakNetworkMode || preferences[preferenceKey]?.weakNetworkMode || settings.weakNetworkMode || "cache-last-state").trim(),
          proxyContact: String(payload.proxyContact || preferences[preferenceKey]?.proxyContact || "").trim(),
          offlineHelpPreferred: payload.offlineHelpPreferred === undefined ? Boolean(preferences[preferenceKey]?.offlineHelpPreferred) : Boolean(payload.offlineHelpPreferred),
          messageTouchpoint: String(payload.messageTouchpoint || preferences[preferenceKey]?.messageTouchpoint || "in_app").trim(),
          updatedAt: new Date().toISOString(),
          updatedBy: user.username || user.role
        };
        data.mobileExperienceSettings = { ...settings, userPreferences: preferences };
        writeDatabase(data);
        sendJson(res, 200, { preferences: preferences[preferenceKey], experience: buildMobileExperience(data, user) });
        return true;
      }
        return false;
      }
    },
    {
      id: "shared-10",
      domain: "shared",
      async handle(req, res, url) {
    const creditActionMatch = url.pathname.match(/^\/api\/credit-evaluations\/([^/]+)\/actions$/);
      if (req.method === "POST" && creditActionMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/credit-evaluations/:id/actions");
        if (!user) return true;
        const data = readDatabase();
        const id = decodeURIComponent(creditActionMatch[1]);
        const index = (data.institutionCreditEvaluations || []).findIndex((item) => item.id === id);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "未找到机构信用评价" });
          return true;
        }
        const payload = await collectJson(req);
        data.institutionCreditEvaluations[index] = {
          ...data.institutionCreditEvaluations[index],
          appealStatus: String(payload.appealStatus || data.institutionCreditEvaluations[index].appealStatus || "not_submitted").trim(),
          publicationStatus: String(payload.publicationStatus || data.institutionCreditEvaluations[index].publicationStatus || "pending_confirmation").trim(),
          appealComment: String(payload.appealComment || data.institutionCreditEvaluations[index].appealComment || "").trim(),
          lastAction: String(payload.action || "update-credit-workflow").trim(),
          updatedAt: new Date().toISOString(),
          updatedBy: user.username || user.role
        };
        writeDatabase(data);
        sendJson(res, 200, data.institutionCreditEvaluations[index]);
        return true;
      }

      const dataQualityActionMatch = url.pathname.match(/^\/api\/data-quality\/issues\/([^/]+)\/actions$/);
      if (req.method === "POST" && dataQualityActionMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/data-quality/issues/:id/actions");
        if (!user) return true;
        const data = readDatabase();
        const issueId = decodeURIComponent(dataQualityActionMatch[1]);
        const issue = buildDataQualityIssues(data).find((item) => item.id === issueId);
        if (!issue) {
          sendJson(res, 404, { error: "Not Found", message: "未找到数据质量问题" });
          return true;
        }
        const payload = await collectJson(req);
        const updated = {
          ...issue,
          status: String(payload.status || "in_progress").trim(),
          action: String(payload.action || "rectify").trim(),
          owner: String(payload.owner || user.name || "").trim(),
          comment: String(payload.comment || "").trim(),
          updatedAt: new Date().toISOString(),
          updatedBy: user.username || user.role
        };
        data.dataQualityIssues = [updated, ...(data.dataQualityIssues || []).filter((item) => item.id !== issueId)].slice(0, 300);
        writeDatabase(data);
        sendJson(res, 200, updated);
        return true;
      }
        return false;
      }
    },
    {
      id: "shared-11",
      domain: "shared",
      async handle(req, res, url) {
    if (req.method === "GET" && url.pathname === "/api/interoperability/management-functions") {
        const user = requireApiRole(req, res, ["commission"], "/api/interoperability/management-functions");
        if (!user) return true;
        const data = readDatabase();
        const functions = Array.isArray(data.hospitalInteroperabilityFunctions) ? data.hospitalInteroperabilityFunctions : [];
        const contracts = Array.isArray(data.integrationContracts) ? data.integrationContracts : [];
        const contractIds = new Set(contracts.map((item) => item.id));
        const rows = functions.map((item) => {
          const missingEvidence = (item.evidence || [])
            .filter((evidence) => /-v\d+$/.test(evidence))
            .filter((evidence) => !contractIds.has(evidence));
          const sourceCoverage = (item.sourceSystems || []).map((source) => ({
            source,
            ready: contracts.some((contract) => contract.domain === source && contract.status === "ready")
              || ["住院管理", "人力资源", "设备物联", "药品耗材", "医保核心", "公卫系统", "慢病平台", "专病库"].includes(source)
          }));
          return {
            ...item,
            sourceCoverage,
            ready: missingEvidence.length === 0 && sourceCoverage.every((entry) => entry.ready),
            missingEvidence
          };
        });
        sendJson(res, 200, {
          ok: rows.every((item) => item.ready),
          summary: {
            total: rows.length,
            ready: rows.filter((item) => item.ready).length,
            sourceSystems: [...new Set(rows.flatMap((item) => item.sourceSystems || []))].length,
            managementActions: rows.reduce((count, item) => count + (item.managementActions || []).length, 0)
          },
          functions: rows
        });
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/data-governance") {
        const user = requireApiRole(req, res, ["commission"], "/api/data-governance");
        if (!user) return true;
        const data = readDatabase();
        sendJson(res, 200, buildDataGovernanceOverview(data));
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/data-governance/master-data") {
        const user = requireApiRole(req, res, ["commission"], "/api/data-governance/master-data");
        if (!user) return true;
        const data = readDatabase();
        sendJson(res, 200, buildMasterDataDirectory(data));
        return true;
      }
        return false;
      }
    },
    {
      id: "shared-12",
      domain: "shared",
      async handle(req, res, url) {
    if (req.method === "GET" && url.pathname === "/api/public/multi-practice-ledger") {
        const data = readDatabase();
        const registry = buildMultiPracticeRegistry(data, { role: "commission", name: "public" });
        const query = String(url.searchParams.get("q") || "").trim().toLowerCase();
        const doctorName = String(url.searchParams.get("doctorName") || "").trim().toLowerCase();
        const institution = String(url.searchParams.get("institution") || "").trim().toLowerCase();
        const status = String(url.searchParams.get("status") || "").trim().toLowerCase();
        const publicLedger = registry.publicLedger.filter((item) => {
          const haystack = [item.doctorName, item.primaryInstitution, item.targetInstitution, item.targetDepartment, item.practiceScope, item.status].join(" ").toLowerCase();
          return (!query || haystack.includes(query)) &&
            (!doctorName || String(item.doctorName || "").toLowerCase().includes(doctorName)) &&
            (!institution || [item.primaryInstitution, item.targetInstitution].some((value) => String(value || "").toLowerCase().includes(institution))) &&
            (!status || String(item.status || "").toLowerCase().includes(status));
        });
        sendJson(res, 200, {
          ok: true,
          generatedAt: registry.generatedAt,
          total: publicLedger.length,
          summary: {
            publicVisible: publicLedger.length,
            filed: publicLedger.filter((item) => String(item.status || "").includes("备案")).length
          },
          publicLedger
        });
        return true;
      }
        return false;
      }
    },
  ];
  return protectSharedRouteSegments(segments);
}

module.exports = { createRouteSegments };
