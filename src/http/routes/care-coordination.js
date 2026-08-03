"use strict";

const {
  ReferralCommandError,
  createReferralCommandService
} = require("../../care-coordination/referral-command-service");

function createRouteSegments(runtime) {
  const { APPOINTMENT_CONTRACT_ID, CareServiceRuntime, RegistrationReferralService, WORKFLOW_COLLECTIONS, WORKFLOW_ROLE_COLLECTIONS, acknowledgeReferralTeleconsultationEscalation, appendDataAccessLog, appendDrugConsumableAuditTrail, appendReferralTeleconsultationNotifications, appendSecurityEvent, applyAppointmentIntegrationReconciliationAction, applyCitizenTaskAction, applyInternetNursingOrderAction, applyReferralTeleconsultationAction, applyRegistrationCancel, applyRegistrationDisruptionAction, applyRegistrationJourneyAction, applyRegistrationWaitlistAction, assertReferralCallbackResident, buildCareServiceProductionReadiness, buildCitizenTaskActionMessage, buildCountyAcceptanceLedger, buildEscortServiceDashboard, buildInternetNursingActionMessage, buildInternetNursingDashboard, buildLifecycleActionClosureMessage, buildMultiPracticeRegistry, buildMultiPracticeTaskMessage, buildPrimaryPracticeConfirmation, buildReferralConsortiumClosedLoopMetrics, buildReferralInsurancePerformancePolicy, buildReferralTeleconsultationEscalations, buildReferralTeleconsultationJointTestLedger, buildReferralTeleconsultationJointTestPack, buildReferralTeleconsultationPersonalRecord, buildReferralTeleconsultationSignoffSummary, buildRegistrationDashboard, buildRegistrationIntegrationCenter, buildRegistrationJourneyTaskMessage, buildRegistrationNotificationDeliveries, buildRegistrationTaskMessage, buildRegistrationWaitlistCenter, buildRegistrationWaitlistDeliveries, buildRegistrationWaitlistTaskMessage, buildUnifiedTasks, canAccessEscortOrder, canAccessInternetNursingOrder, canAccessMultiPracticeApplication, canAccessReferralTeleconsultation, canAccessRegistrationOrder, canAccessRegistrationSchedule, canAccessRegistrationWaitlistEntry, canAccessResident, canAccessTaskMessage, canManageAppointmentIntegrationEvent, careServiceActor, careServiceCommandId, careServiceCreatePayload, careServicePlatformAdapter, careServiceReadinessPublicSummary, careServiceTransitionInput, cleanMultiPracticePatch, cleanWorkflowUpdates, collectJson, completeReferralTeleconsultationJointTestTask, createReferralTeleconsultationEscalationMessage, createReferralTeleconsultationJointTestTasks, createTaskMessage, findWorkflowCollection, isClosedTaskStatus, landAppointmentIntegrationEvent, normalizeInternetNursingOrder, normalizeMultiPracticeApplication, normalizeReferralTeleconsultation, normalizeReferralTeleconsultationCallback, normalizeReferralTeleconsultationFeedbackCallback, normalizeReferralTeleconsultationScheduleCallback, normalizeReferralTeleconsultationStatus, normalizeRegistrationOrder, normalizeRegistrationWaitlistEntry, normalizeState, patchBusinessCollectionItem, prependAuditTrailEntry, promoteNextRegistrationWaitlist, randomUUID, readDatabase, redactSensitiveResponse, refreshBirthStatistics, refreshMultiPracticeReviewState, requireApiRole, resealAuditTrail, resolveMultiPracticeLifecyclePatch, sealAuditTrail, seedRegistrationSchedules, sendCareServiceError, sendJson, updateIntegrationEvent, upsertReferralTeleconsultationSignoff, verifyDoctorElectronicRegistration, verifyIntegrationSignature, workflowStateCollectionKey, writeDatabase } = runtime;
  return [
    {
      id: "care-coordination-01",
      domain: "care-coordination",
      async handle(req, res, url) {
    if (req.method === "GET" && url.pathname === "/api/referral-teleconsultations") {
        const user = requireApiRole(req, res, ["commission", "institution", "county"], "/api/referral-teleconsultations");
        if (!user) return true;
        const data = readDatabase();
        const rows = (Array.isArray(data.referralTeleconsultations) ? data.referralTeleconsultations : [])
          .filter((item) => canAccessReferralTeleconsultation(user, item, data));
        const escalations = buildReferralTeleconsultationEscalations(rows);
        const performancePolicy = buildReferralInsurancePerformancePolicy({ ...data, referralTeleconsultations: rows });
        sendJson(res, 200, {
          teleconsultations: rows,
          escalations,
          performancePolicy,
          summary: {
            total: rows.length,
            pending: rows.filter((item) => !isClosedTaskStatus(item.status) && item.reportStatus !== "returned").length,
            reportReturned: rows.filter((item) => item.reportStatus === "returned" || item.status === "report-returned").length,
            escalations: escalations.length,
            highRisk: escalations.filter((item) => item.severity === "high").length,
            acknowledgedEscalations: rows.filter((item) => item.slaDisposition?.status && item.slaDisposition.status !== "pending-ack").length,
            reportReturnRate: performancePolicy.summary.reportReturnRate,
            followupClosureRate: performancePolicy.summary.followupClosureRate,
            repeatExamControlRate: performancePolicy.summary.repeatExamControlRate
          }
        });
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/referral-teleconsultations/joint-test-pack") {
        const user = requireApiRole(req, res, ["commission", "institution", "insurance", "county"], "/api/referral-teleconsultations/joint-test-pack");
        if (!user) return true;
        sendJson(res, 200, buildReferralTeleconsultationJointTestPack(readDatabase()));
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/referral-teleconsultations/joint-test-ledger") {
        const user = requireApiRole(req, res, ["commission", "institution", "insurance", "county"], "/api/referral-teleconsultations/joint-test-ledger");
        if (!user) return true;
        sendJson(res, 200, buildReferralTeleconsultationJointTestLedger(readDatabase()));
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/referral-teleconsultations/joint-test-ledger/tasks") {
        const user = requireApiRole(req, res, ["commission", "county"], "/api/referral-teleconsultations/joint-test-ledger/tasks");
        if (!user) return true;
        sendJson(res, 201, createReferralTeleconsultationJointTestTasks(readDatabase(), user));
        return true;
      }

      const jointTestTaskCompleteMatch = url.pathname.match(/^\/api\/referral-teleconsultations\/joint-test-ledger\/tasks\/([^/]+)\/complete$/);
      if (req.method === "POST" && jointTestTaskCompleteMatch) {
        const user = requireApiRole(req, res, ["commission", "institution", "insurance", "county"], "/api/referral-teleconsultations/joint-test-ledger/tasks/:role/complete");
        if (!user) return true;
        const result = completeReferralTeleconsultationJointTestTask(readDatabase(), user, decodeURIComponent(jointTestTaskCompleteMatch[1]), await collectJson(req));
        sendJson(res, result.status, result.body);
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/referral-teleconsultations/signoff-summary") {
        const user = requireApiRole(req, res, ["commission", "institution", "insurance", "county"], "/api/referral-teleconsultations/signoff-summary");
        if (!user) return true;
        sendJson(res, 200, buildReferralTeleconsultationSignoffSummary(readDatabase()));
        return true;
      }

      const referralSignoffEvidenceMatch = url.pathname.match(/^\/api\/referral-teleconsultations\/signoff-summary\/([^/]+)\/evidence$/);
      if (req.method === "POST" && referralSignoffEvidenceMatch) {
        const user = requireApiRole(req, res, ["commission", "institution", "insurance", "county"], "/api/referral-teleconsultations/signoff-summary/:role/evidence");
        if (!user) return true;
        const data = readDatabase();
        const result = upsertReferralTeleconsultationSignoff(data, decodeURIComponent(referralSignoffEvidenceMatch[1]), await collectJson(req), user);
        sendJson(res, result.status, result.body);
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/referral-teleconsultations/performance-policy") {
        const user = requireApiRole(req, res, ["commission", "insurance", "county"], "/api/referral-teleconsultations/performance-policy");
        if (!user) return true;
        sendJson(res, 200, buildReferralInsurancePerformancePolicy(readDatabase()));
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/referral-teleconsultations/consortium-metrics") {
        const user = requireApiRole(req, res, ["commission", "county"], "/api/referral-teleconsultations/consortium-metrics");
        if (!user) return true;
        sendJson(res, 200, buildReferralConsortiumClosedLoopMetrics(readDatabase()));
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/referral-teleconsultations/escalations/run") {
        const user = requireApiRole(req, res, ["county", "commission"], "/api/referral-teleconsultations/escalations/run");
        if (!user) return true;
        const data = readDatabase();
        const payload = await collectJson(req);
        const rows = (Array.isArray(data.referralTeleconsultations) ? data.referralTeleconsultations : [])
          .filter((item) => canAccessReferralTeleconsultation(user, item, data))
          .filter((item) => !payload.teleconsultationId || item.id === String(payload.teleconsultationId));
        const rowMap = new Map(rows.map((item) => [item.id, item]));
        const escalations = buildReferralTeleconsultationEscalations(rows);
        const existingKeys = new Set((Array.isArray(data.taskMessages) ? data.taskMessages : [])
          .map((message) => message.escalationKey || message.notificationKey)
          .filter(Boolean));
        const messages = escalations
          .map((escalation) => createReferralTeleconsultationEscalationMessage(rowMap.get(escalation.teleconsultationId), escalation, user))
          .filter((message) => !existingKeys.has(message.escalationKey));
        data.taskMessages = [...messages, ...(Array.isArray(data.taskMessages) ? data.taskMessages : [])].slice(0, 300);
        if (messages.length) {
          data.securityEvents = resealAuditTrail([
            {
              id: randomUUID(),
              at: new Date().toLocaleString("zh-CN", { hour12: false }),
              actor: user.name,
              role: user.role,
              action: "run referral teleconsultation SLA escalation",
              target: payload.teleconsultationId || "all",
              result: "allowed",
              detail: `${messages.length}/${escalations.length} reminders created`
            },
            ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
          ].slice(0, 120));
        }
        writeDatabase(data);
        sendJson(res, 201, { messages, escalations, summary: { created: messages.length, escalations: escalations.length } });
        return true;
      }

      const teleconsultationEscalationAckMatch = url.pathname.match(/^\/api\/referral-teleconsultations\/([^/]+)\/escalations\/ack$/);
      if (req.method === "POST" && teleconsultationEscalationAckMatch) {
        const user = requireApiRole(req, res, ["institution", "county", "commission"], "/api/referral-teleconsultations/:id/escalations/ack");
        if (!user) return true;
        const data = readDatabase();
        const rows = Array.isArray(data.referralTeleconsultations) ? data.referralTeleconsultations : [];
        const index = rows.findIndex((item) => item.id === decodeURIComponent(teleconsultationEscalationAckMatch[1]));
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "referral teleconsultation not found" });
          return true;
        }
        if (!canAccessReferralTeleconsultation(user, rows[index], data)) {
          appendSecurityEvent({ actor: user.name, role: user.role, action: "acknowledge referral teleconsultation SLA", target: rows[index].id, result: "denied", detail: "scope denied" });
          sendJson(res, 403, { error: "Forbidden", message: "scope denied" });
          return true;
        }
        const payload = await collectJson(req);
        rows[index] = acknowledgeReferralTeleconsultationEscalation(data, rows[index], payload, user);
        data.referralTeleconsultations = rows;
        data.securityEvents = resealAuditTrail([
          {
            id: randomUUID(),
            at: new Date().toLocaleString("zh-CN", { hour12: false }),
            actor: user.name,
            role: user.role,
            action: "acknowledge referral teleconsultation SLA",
            target: rows[index].id,
            result: "allowed",
            detail: rows[index].slaDisposition?.action || "SLA acknowledged"
          },
          ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
        ].slice(0, 120));
        appendDataAccessLog(data, user, rows[index].residentId, "referral teleconsultation", "SLA reminder acknowledgement", "allowed");
        writeDatabase(data);
        sendJson(res, 200, { teleconsultation: rows[index], messages: data.taskMessages.filter((message) => message.collection === "referralTeleconsultations" && message.sourceId === rows[index].id) });
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/referral-teleconsultations") {
        const user = requireApiRole(req, res, ["institution", "county", "commission"], "/api/referral-teleconsultations");
        if (!user) return true;
        const data = readDatabase();
        const payload = await collectJson(req);
        try {
          const consultation = normalizeReferralTeleconsultation(payload, user, data);
          if (!canAccessReferralTeleconsultation(user, consultation, data)) {
            appendSecurityEvent({ actor: user.name, role: user.role, action: "create referral teleconsultation", target: consultation.residentId, result: "denied", detail: "organization scope denied" });
            sendJson(res, 403, { error: "Forbidden", message: "organization scope denied" });
            return true;
          }
          data.referralTeleconsultations = [consultation, ...(Array.isArray(data.referralTeleconsultations) ? data.referralTeleconsultations : [])].slice(0, 300);
          data.securityEvents = resealAuditTrail([
            {
              id: randomUUID(),
              at: new Date().toLocaleString("zh-CN", { hour12: false }),
              actor: user.name,
              role: user.role,
              action: "create referral teleconsultation",
              target: consultation.id,
              result: "allowed",
              detail: `${consultation.sourceInstitution} -> ${consultation.targetInstitution}`
            },
            ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
          ].slice(0, 120));
          appendDataAccessLog(data, user, consultation.residentId, "referral teleconsultation", "create teleconsultation with resident authorization", "allowed");
          writeDatabase(data);
          sendJson(res, 201, consultation);
        } catch (error) {
          if (/resident authorization/i.test(error.message || "")) {
            appendSecurityEvent({
              actor: user.name,
              role: user.role,
              action: "create referral teleconsultation",
              target: String(payload.residentId || payload.residentAuthorizationId || ""),
              result: "denied",
              detail: error.message
            });
          }
          sendJson(res, 400, { error: "Bad Request", message: error.message });
        }
        return true;
      }

      const teleconsultationActionMatch = url.pathname.match(/^\/api\/referral-teleconsultations\/([^/]+)\/actions$/);
      if (req.method === "POST" && teleconsultationActionMatch) {
        const user = requireApiRole(req, res, ["institution", "county", "commission"], "/api/referral-teleconsultations/:id/actions");
        if (!user) return true;
        const data = readDatabase();
        const rows = Array.isArray(data.referralTeleconsultations) ? data.referralTeleconsultations : [];
        const index = rows.findIndex((item) => item.id === decodeURIComponent(teleconsultationActionMatch[1]));
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "referral teleconsultation not found" });
          return true;
        }
        if (!canAccessReferralTeleconsultation(user, rows[index], data)) {
          appendSecurityEvent({ actor: user.name, role: user.role, action: "update referral teleconsultation", target: rows[index].id, result: "denied", detail: "scope denied" });
          sendJson(res, 403, { error: "Forbidden", message: "scope denied" });
          return true;
        }
        const payload = await collectJson(req);
        rows[index] = applyReferralTeleconsultationAction(rows[index], payload, user);
        data.referralTeleconsultations = rows;
        data.securityEvents = resealAuditTrail([
          {
            id: randomUUID(),
            at: new Date().toLocaleString("zh-CN", { hour12: false }),
            actor: user.name,
            role: user.role,
            action: "update referral teleconsultation",
            target: rows[index].id,
            result: "allowed",
            detail: rows[index].status
          },
          ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
        ].slice(0, 120));
        appendDataAccessLog(data, user, rows[index].residentId, "referral teleconsultation", payload.note || rows[index].status, "allowed");
        writeDatabase(data);
        sendJson(res, 200, rows[index]);
        return true;
      }

      const referralCallbackMatch = url.pathname.match(/^\/api\/referral-teleconsultations\/([^/]+)\/(feedback|schedule|report)-callback$/);
      if (req.method === "POST" && referralCallbackMatch) {
        const callbackType = referralCallbackMatch[2];
        const route = `/api/referral-teleconsultations/:id/${callbackType}-callback`;
        const user = requireApiRole(req, res, ["institution", "county", "commission"], route);
        if (!user) return true;
        const payload = await collectJson(req);
        const teleconsultationId = decodeURIComponent(referralCallbackMatch[1]);
        if (!verifyIntegrationSignature(payload, req.headers["x-integration-signature"])) {
          appendSecurityEvent({ actor: user.name, role: user.role, action: `referral teleconsultation ${callbackType} callback`, target: teleconsultationId, result: "denied", detail: "signature mismatch" });
          sendJson(res, 401, { error: "Unauthorized", message: "integration signature verification failed" });
          return true;
        }
        const data = readDatabase();
        const rows = Array.isArray(data.referralTeleconsultations) ? data.referralTeleconsultations : [];
        const index = rows.findIndex((item) => item.id === teleconsultationId);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "referral teleconsultation not found" });
          return true;
        }
        if (!canAccessReferralTeleconsultation(user, rows[index], data)) {
          appendSecurityEvent({ actor: user.name, role: user.role, action: `referral teleconsultation ${callbackType} callback`, target: teleconsultationId, result: "denied", detail: "scope denied" });
          sendJson(res, 403, { error: "Forbidden", message: "scope denied" });
          return true;
        }
        try {
          const normalizers = {
            feedback: normalizeReferralTeleconsultationFeedbackCallback,
            schedule: normalizeReferralTeleconsultationScheduleCallback,
            report: normalizeReferralTeleconsultationCallback
          };
          const callback = normalizers[callbackType](payload, rows[index]);
          assertReferralCallbackResident(callback, rows[index]);
          const duplicate = (Array.isArray(data.integrationGatewayEvents) ? data.integrationGatewayEvents : [])
            .find((item) => item.contractId === callback.contractId && item.idempotencyKey === callback.idempotencyKey);
          if (duplicate) {
            sendJson(res, 200, { teleconsultation: rows[index], integrationEvent: { ...duplicate, idempotentReplay: true } });
            return true;
          }

          if (callbackType === "feedback") {
            rows[index] = applyReferralTeleconsultationAction(rows[index], {
              status: callback.feedbackStatus,
              feedback: callback.receivingFeedback,
              note: `${callback.sourceSystem} feedback callback`
            }, user);
            rows[index].feedbackAt = callback.feedbackAt;
          } else if (callbackType === "schedule") {
            const now = new Date().toISOString();
            rows[index] = {
              ...rows[index],
              status: rows[index].reportStatus === "returned" ? rows[index].status : normalizeReferralTeleconsultationStatus(callback.scheduleStatus),
              meetingWindow: callback.meetingWindow,
              targetInstitution: callback.targetInstitution,
              targetInstitutionCode: callback.targetInstitutionCode,
              department: callback.department,
              receivingDoctor: callback.receivingDoctor,
              lastUpdated: now,
              updatedBy: user.username || user.role,
              updatedByName: user.name,
              auditTrail: [
                { at: now, actor: user.username || user.role, action: "schedule-callback", note: `${callback.sourceSystem} schedule callback` },
                ...(Array.isArray(rows[index].auditTrail) ? rows[index].auditTrail : [])
              ].slice(0, 40)
            };
          } else {
            rows[index] = applyReferralTeleconsultationAction(rows[index], {
              status: "report-returned",
              feedback: callback.receivingFeedback,
              reportSummary: callback.reportSummary,
              note: `${callback.sourceSystem} report callback`
            }, user);
            rows[index].reportReturnedAt = callback.reportReturnedAt;
          }
          if (callback.performance && typeof callback.performance === "object") {
            rows[index].performance = { ...(rows[index].performance || {}), ...callback.performance };
          }
          data.referralTeleconsultations = rows;
          const event = {
            id: `igw-${randomUUID()}`,
            idempotencyKey: callback.idempotencyKey,
            externalId: callback.externalId,
            contractId: callback.contractId,
            domain: "referral-teleconsultation",
            resource: `${callbackType}-callback`,
            residentId: callback.residentId,
            status: "matched",
            receivedAt: new Date().toISOString(),
            receivedBy: user.username || user.role,
            payload: callback.payload,
            retryCount: 0,
            deadLetter: false,
            reconciliationStatus: "matched",
            targetCollection: "referralTeleconsultations",
            targetId: rows[index].id
          };
          data.integrationGatewayEvents = [event, ...(Array.isArray(data.integrationGatewayEvents) ? data.integrationGatewayEvents : [])].slice(0, 200);
          let personalRecord = null;
          if (callbackType === "report") {
            personalRecord = (Array.isArray(data.personalRecords) ? data.personalRecords : [])
              .find((record) => record.category === "teleconsultation-report" && record.teleconsultationId === rows[index].id && record.idempotencyKey === callback.idempotencyKey) || null;
            if (!personalRecord) {
              personalRecord = buildReferralTeleconsultationPersonalRecord(data, rows[index], callback, user);
              data.personalRecords = [personalRecord, ...(Array.isArray(data.personalRecords) ? data.personalRecords : [])].slice(0, 500);
            }
          }
          const messages = appendReferralTeleconsultationNotifications(data, rows[index], callbackType, callback, user);
          data.securityEvents = resealAuditTrail([
            {
              id: randomUUID(),
              at: new Date().toLocaleString("zh-CN", { hour12: false }),
              actor: user.name,
              role: user.role,
              action: `referral teleconsultation ${callbackType} callback`,
              target: rows[index].id,
              result: "allowed",
              detail: `${callback.sourceSystem} / ${callback.idempotencyKey}`
            },
            ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
          ].slice(0, 120));
          appendDataAccessLog(data, user, rows[index].residentId, "referral teleconsultation", `external ${callbackType} callback`, "allowed");
          writeDatabase(data);
          sendJson(res, 200, { teleconsultation: rows[index], integrationEvent: event, personalRecord, messages });
        } catch (error) {
          sendJson(res, 400, { error: "Bad Request", message: error.message });
        }
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/escort-services/dashboard") {
        const user = requireApiRole(req, res, ["commission", "institution", "county", "citizen"], "/api/escort-services/dashboard");
        if (!user) return true;
        sendJson(res, 200, redactSensitiveResponse(buildEscortServiceDashboard(readDatabase(), user), user));
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/escort-services/orders") {
        const user = requireApiRole(req, res, ["commission", "institution", "county", "citizen"], "/api/escort-services/orders");
        if (!user) return true;
        try {
          const payload = await collectJson(req);
          const result = await careServicePlatformAdapter().createOrder(
            "escort",
            careServiceCreatePayload(payload, "escort"),
            careServiceActor(user),
            { commandId: careServiceCommandId(req, payload) }
          );
          sendJson(res, result.replayed ? 200 : 201, result.order);
        } catch (error) {
          sendCareServiceError(res, error);
        }
        return true;
      }

      const escortHospitalHandoffMatch = url.pathname.match(/^\/api\/escort-services\/orders\/([^/]+)\/hospital-handoff$/);
      if (req.method === "POST" && escortHospitalHandoffMatch) {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/escort-services/orders/:id/hospital-handoff");
        if (!user) return true;
        try {
          const payload = await collectJson(req);
          const decision = String(payload.decision || "").trim().toLowerCase();
          const result = await careServicePlatformAdapter().transitionOrder(
            "escort",
            decodeURIComponent(escortHospitalHandoffMatch[1]),
            decision === "return" ? "hospital-returned" : "hospital-confirmed",
            careServiceActor(user),
            {
              ...careServiceTransitionInput(payload).input,
              commandId: careServiceCommandId(req, payload)
            }
          );
          sendJson(res, 200, result.order);
        } catch (error) {
          sendCareServiceError(res, error);
        }
        return true;
      }

      const escortOrderActionMatch = url.pathname.match(/^\/api\/escort-services\/orders\/([^/]+)\/actions$/);
      if (req.method === "POST" && escortOrderActionMatch) {
        const user = requireApiRole(req, res, ["commission", "institution", "county"], "/api/escort-services/orders/:id/actions");
        if (!user) return true;
        try {
          const payload = await collectJson(req);
          const transition = careServiceTransitionInput(payload);
          const result = await careServicePlatformAdapter().transitionOrder(
            "escort",
            decodeURIComponent(escortOrderActionMatch[1]),
            transition.nextStatus,
            careServiceActor(user),
            {
              ...transition.input,
              commandId: careServiceCommandId(req, payload)
            }
          );
          sendJson(res, 200, result.order);
        } catch (error) {
          sendCareServiceError(res, error);
        }
        return true;
      }

      const careNotificationReceiptMatch = url.pathname.match(/^\/api\/care-services\/(nursing|escort)\/orders\/([^/]+)\/notification-receipts\/([^/]+)$/);
      if (req.method === "POST" && careNotificationReceiptMatch) {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/care-services/:domain/orders/:id/notification-receipts/:messageId");
        if (!user) return true;
        const payload = await collectJson(req);
        if (!verifyIntegrationSignature(payload, req.headers["x-integration-signature"])) {
          appendSecurityEvent({
            actor: user.name,
            role: user.role,
            action: "care service notification receipt",
            target: decodeURIComponent(careNotificationReceiptMatch[2]),
            result: "denied",
            detail: "signature mismatch"
          });
          sendJson(res, 401, { error: "Unauthorized", message: "integration signature verification failed" });
          return true;
        }
        try {
          const result = await careServicePlatformAdapter().recordNotificationReceipt(
            careNotificationReceiptMatch[1],
            decodeURIComponent(careNotificationReceiptMatch[2]),
            decodeURIComponent(careNotificationReceiptMatch[3]),
            {
              status: payload.status,
              providerMessageId: payload.providerMessageId,
              failureCode: payload.failureCode
            },
            careServiceActor(user),
            { commandId: careServiceCommandId(req, payload) }
          );
          sendJson(res, 200, { ok: true, order: result.order, receipt: result.receipt, replayed: Boolean(result.replayed) });
        } catch (error) {
          sendCareServiceError(res, error);
        }
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/care-services/outbox/health") {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/care-services/outbox/health");
        if (!user) return true;
        try {
          const health = await careServicePlatformAdapter().readOutboxHealth({
            maxPendingAgeSeconds: Number(process.env.CARE_OUTBOX_MAX_PENDING_AGE_SECONDS || 300)
          });
          sendJson(res, health.ok ? 200 : 503, {
            ...health,
            runtimePolicyVersion: CareServiceRuntime.RUNTIME_POLICY_VERSION,
            productionReady: false
          });
        } catch (error) {
          sendCareServiceError(res, error);
        }
        return true;
      }

      if (url.pathname === "/api/care-services/readiness") {
        const user = requireApiRole(req, res, ["commission"], "/api/care-services/readiness");
        if (!user) return true;
        if (req.method !== "GET") {
          sendJson(res, 405, { error: "Method Not Allowed", message: "care-service readiness is read-only" });
          return true;
        }
        const report = buildCareServiceProductionReadiness({
          data: readDatabase(),
          env: process.env
        });
        const summary = careServiceReadinessPublicSummary(report);
        appendSecurityEvent({
          actor: user.name,
          role: user.role,
          action: "care-service-production-readiness",
          target: "/api/care-services/readiness",
          result: "allowed",
          detail: `${summary.formalGoLiveState}; ${summary.blockerCounts.total} blockers`
        });
        sendJson(res, 200, summary);
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/care-services/outbox/dead-letters") {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/care-services/outbox/dead-letters");
        if (!user) return true;
        const data = readDatabase();
        const rows = (Array.isArray(data.careServiceOutboxDeadLetters) ? data.careServiceOutboxDeadLetters : [])
          .filter((item) => {
            if (user.role === "commission") return true;
            const orders = item.domain === "nursing" ? data.internetNursingOrders : data.escortServiceOrders;
            const order = (orders || []).find((row) => row.id === item.aggregateId);
            return Boolean(order && (item.domain === "nursing"
              ? canAccessInternetNursingOrder(user, order, data)
              : canAccessEscortOrder(user, order, data)));
          })
          .map((item) => ({
            id: item.id,
            domain: item.domain,
            eventId: item.eventId,
            aggregateId: item.aggregateId,
            eventType: item.eventType,
            status: item.status,
            attempts: item.attempts,
            errorCode: item.errorCode,
            openedAt: item.openedAt,
            resolvedAt: item.resolvedAt,
            resolutionEvidenceRef: item.resolutionEvidenceRef
          }));
        sendJson(res, 200, { ok: true, deadLetters: rows, productionReady: false });
        return true;
      }

      const careDeadLetterRequeueMatch = url.pathname.match(/^\/api\/care-services\/outbox\/(nursing|escort)\/([^/]+)\/requeue$/);
      if (req.method === "POST" && careDeadLetterRequeueMatch) {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/care-services/outbox/:domain/:eventId/requeue");
        if (!user) return true;
        try {
          if (user.role === "institution") {
            const data = readDatabase();
            const domain = careDeadLetterRequeueMatch[1];
            const eventId = decodeURIComponent(careDeadLetterRequeueMatch[2]);
            const event = (domain === "nursing" ? data.internetNursingOutbox : data.escortServiceOutbox)
              ?.find((item) => item.id === eventId);
            const order = (domain === "nursing" ? data.internetNursingOrders : data.escortServiceOrders)
              ?.find((item) => item.id === event?.aggregateId);
            const allowed = Boolean(order && (domain === "nursing"
              ? canAccessInternetNursingOrder(user, order, data)
              : canAccessEscortOrder(user, order, data)));
            if (!allowed) {
              sendJson(res, 403, { error: "Forbidden", message: "care-service dead-letter scope denied" });
              return true;
            }
          }
          const payload = await collectJson(req);
          const result = await careServicePlatformAdapter().requeueDeadLetter(
            careDeadLetterRequeueMatch[1],
            decodeURIComponent(careDeadLetterRequeueMatch[2]),
            careServiceActor(user),
            {
              commandId: careServiceCommandId(req, payload),
              confirmation: payload.confirmation,
              evidenceRef: payload.evidenceRef
            }
          );
          sendJson(res, 200, { ok: true, eventId: result.event?.id, resolvedDeadLetters: result.resolvedDeadLetters });
        } catch (error) {
          sendCareServiceError(res, error);
        }
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/care-services/outbox/worker/run") {
        const user = requireApiRole(req, res, ["commission"], "/api/care-services/outbox/worker/run");
        if (!user) return true;
        try {
          const result = await careServicePlatformAdapter().runOutboxWorker({
            workerId: process.env.CARE_OUTBOX_WORKER_ID,
            runId: randomUUID(),
            batchSize: Number(process.env.CARE_OUTBOX_BATCH_SIZE || 20),
            leaseSeconds: Number(process.env.CARE_OUTBOX_LEASE_SECONDS || 60),
            maxAttempts: Number(process.env.CARE_OUTBOX_MAX_ATTEMPTS || 5),
            retryBaseSeconds: Number(process.env.CARE_OUTBOX_RETRY_BASE_SECONDS || 30),
            maxRetrySeconds: Number(process.env.CARE_OUTBOX_MAX_RETRY_SECONDS || 1800)
          });
          sendJson(res, result.deadLetters ? 503 : 200, {
            ok: result.deadLetters === 0,
            runId: result.runId,
            workerId: result.workerId,
            claimed: result.claimed,
            delivered: result.delivered,
            retried: result.retried,
            deadLetters: result.deadLetters
          });
        } catch (error) {
          sendCareServiceError(res, error);
        }
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/registrations/integration-center") {
        const user = requireApiRole(req, res, ["commission", "institution", "insurance", "county"], "/api/registrations/integration-center");
        if (!user) return true;
        sendJson(res, 200, buildRegistrationIntegrationCenter(readDatabase(), user));
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/registrations/dashboard") {
        const user = requireApiRole(req, res, ["commission", "institution", "insurance", "county", "citizen"], "/api/registrations/dashboard");
        if (!user) return true;
        sendJson(res, 200, redactSensitiveResponse(buildRegistrationDashboard(readDatabase(), user), user));
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/registrations/waitlist") {
        const user = requireApiRole(req, res, ["commission", "institution", "citizen"], "/api/registrations/waitlist");
        if (!user) return true;
        const data = readDatabase();
        try {
          const payload = await collectJson(req);
          const residentId = String(payload.residentId || user.residentId || "").trim();
          const scheduleId = String(payload.scheduleId || "").trim();
          const note = String(payload.note || "").trim();
          if (!residentId) throw new Error("residentId is required");
          if (!scheduleId) throw new Error("scheduleId is required");
          if (note.length < 2) throw new Error("note is required");
          if (!canAccessResident(user, residentId, data)) throw new Error("resident scope denied");
          const schedules = Array.isArray(data.registrationSchedules) ? data.registrationSchedules : seedRegistrationSchedules();
          const schedule = schedules.find((item) => item.id === scheduleId);
          if (!schedule) throw new Error("schedule not found");
          if (!canAccessRegistrationSchedule(user, schedule)) throw new Error("schedule scope denied");
          if (schedule.status === "closed") throw new Error("schedule is unavailable");
          if (Number(schedule.remaining || 0) > 0) throw new Error("schedule still has available slots");
          const activeOrder = (data.registrationOrders || []).find((item) => item.residentId === residentId && item.scheduleId === scheduleId && !["cancelled", "completed", "closed"].includes(item.status));
          if (activeOrder) throw new Error("resident already has an active appointment for this schedule");
          const entries = Array.isArray(data.registrationWaitlistEntries) ? data.registrationWaitlistEntries : [];
          const duplicate = entries.find((item) => item.residentId === residentId && item.scheduleId === scheduleId && ["waiting", "offer-pending"].includes(item.status));
          if (duplicate) throw new Error("resident already has an active waitlist entry for this schedule");
          const now = new Date().toISOString();
          const resident = (data.residents || []).find((item) => item.id === residentId) || {};
          const entry = normalizeRegistrationWaitlistEntry({
            id: `regwait-${randomUUID()}`,
            residentId,
            residentName: resident.name || "",
            scheduleId,
            hospitalCode: schedule.hospitalCode || "",
            hospital: schedule.hospital || "",
            departmentCode: schedule.departmentCode || "",
            department: schedule.department || "",
            doctorCode: schedule.doctorCode || "",
            doctor: schedule.doctor || "",
            appointmentDate: schedule.date || "",
            period: schedule.period || "",
            visitType: String(payload.visitType || "onsite").trim(),
            preferredChannel: ["sms", "in_app", "phone"].includes(payload.preferredChannel) ? payload.preferredChannel : "sms",
            status: "waiting",
            joinedAt: now,
            joinedBy: user.name || user.username || user.role,
            note,
            notificationStatus: "queued",
            notificationDeliveries: buildRegistrationWaitlistDeliveries({ id: "pending", residentId }, "registration-waitlist-joined", user, now),
            productionReady: false,
            auditTrail: [{ at: now, action: "registration-waitlist-join", by: user.name || user.username || user.role, role: user.role, note, productionEvidence: false }]
          });
          entry.notificationDeliveries = buildRegistrationWaitlistDeliveries(entry, "registration-waitlist-joined", user, now);
          data.registrationWaitlistEntries = [entry, ...entries].slice(0, 500);
          data.taskMessages = [buildRegistrationWaitlistTaskMessage(entry, "registration-waitlist-joined", user, schedule), ...(Array.isArray(data.taskMessages) ? data.taskMessages : [])].slice(0, 300);
          appendDataAccessLog(data, user, residentId, "registrationWaitlistEntries", "join appointment waitlist", "allowed");
          data.securityEvents = sealAuditTrail([
            { id: randomUUID(), at: new Date().toLocaleString("zh-CN", { hour12: false }), actor: user.name, role: user.role, action: "registration-waitlist-join", target: entry.id, result: "allowed", detail: scheduleId },
            ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
          ].slice(0, 120), { recompute: true });
          writeDatabase(data);
          const dashboard = buildRegistrationDashboard(data, user);
          sendJson(res, 201, { ok: true, entry: dashboard.waitlist.entries.find((item) => item.id === entry.id), dashboard });
        } catch (error) {
          const forbidden = /scope denied/i.test(error.message || "");
          const conflict = /already has|available slots/i.test(error.message || "");
          sendJson(res, forbidden ? 403 : conflict ? 409 : 400, { error: forbidden ? "Forbidden" : conflict ? "Conflict" : "Bad Request", message: error.message });
        }
        return true;
      }

      const registrationWaitlistActionMatch = url.pathname.match(/^\/api\/registrations\/waitlist\/([^/]+)\/actions$/);
      if (req.method === "POST" && registrationWaitlistActionMatch) {
        const user = requireApiRole(req, res, ["commission", "institution", "citizen"], "/api/registrations/waitlist/:id/actions");
        if (!user) return true;
        const data = readDatabase();
        const entries = Array.isArray(data.registrationWaitlistEntries) ? data.registrationWaitlistEntries : [];
        const index = entries.findIndex((item) => item.id === decodeURIComponent(registrationWaitlistActionMatch[1]));
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "registration waitlist entry not found" });
          return true;
        }
        if (!canAccessRegistrationWaitlistEntry(user, entries[index], data)) {
          appendSecurityEvent({ actor: user.name, role: user.role, action: "registration-waitlist-action", target: entries[index].id, result: "denied", detail: "scope denied" });
          sendJson(res, 403, { error: "Forbidden", message: "scope denied" });
          return true;
        }
        try {
          const payload = await collectJson(req);
          const action = String(payload.action || "").trim();
          const schedules = Array.isArray(data.registrationSchedules) ? data.registrationSchedules : seedRegistrationSchedules();
          const schedule = schedules.find((item) => item.id === entries[index].scheduleId);
          if (!schedule) throw new Error("schedule not found");
          const center = buildRegistrationWaitlistCenter(entries.filter((item) => item.scheduleId === entries[index].scheduleId), [schedule]);
          const context = center.entries.find((item) => item.id === entries[index].id) || {};
          let next = applyRegistrationWaitlistAction(entries[index], payload, user, context);
          let createdOrder = null;

          if (action === "promote") {
            data.registrationSchedules = schedules.map((item) => item.id === schedule.id
              ? { ...item, remaining: Math.max(0, Number(item.remaining || 0) - 1), waitlistHeld: Number(item.waitlistHeld || 0) + 1 }
              : item);
          }
          if (action === "accept") {
            const syntheticData = {
              ...data,
              registrationSchedules: schedules.map((item) => item.id === schedule.id ? { ...item, remaining: Math.max(1, Number(item.remaining || 0)) } : item)
            };
            createdOrder = normalizeRegistrationOrder({
              residentId: next.residentId,
              scheduleId: next.scheduleId,
              visitType: next.visitType || "onsite",
              reason: next.note || "accepted appointment waitlist offer",
              sourceChannel: "registration-waitlist"
            }, user, syntheticData);
            createdOrder.waitlistEntryId = next.id;
            createdOrder.journeyStage = "waitlist-slot-reserved-demo";
            createdOrder.auditTrail = [{ at: next.updatedAt, action: "registration-waitlist-accepted", by: user.name || user.username || user.role, note: payload.note, productionEvidence: false }, ...(createdOrder.auditTrail || [])].slice(0, 30);
            next.registrationOrderId = createdOrder.id;
            data.registrationOrders = [createdOrder, ...(Array.isArray(data.registrationOrders) ? data.registrationOrders : [])].slice(0, 500);
            data.registrationSchedules = schedules.map((item) => item.id === schedule.id
              ? { ...item, waitlistHeld: Math.max(0, Number(item.waitlistHeld || 0) - 1) }
              : item);
          }
          if (["decline", "expire"].includes(action)) {
            data.registrationSchedules = schedules.map((item) => item.id === schedule.id
              ? { ...item, remaining: Number(item.remaining || 0) + 1, waitlistHeld: Math.max(0, Number(item.waitlistHeld || 0) - 1) }
              : item);
          }

          const event = `registration-waitlist-${action === "promote" ? "offer" : action === "expire" ? "expired" : action === "accept" ? "accepted" : action === "decline" ? "declined" : "withdrawn"}`;
          next.notificationStatus = "queued";
          next.notificationDeliveries = [...buildRegistrationWaitlistDeliveries(next, event, user, next.updatedAt), ...(Array.isArray(next.notificationDeliveries) ? next.notificationDeliveries : [])].slice(0, 30);
          entries[index] = next;
          data.registrationWaitlistEntries = entries;
          data.taskMessages = [
            buildRegistrationWaitlistTaskMessage(next, event, user, schedule),
            ...(createdOrder ? [buildRegistrationTaskMessage(createdOrder, "registration-submitted", user)] : []),
            ...(Array.isArray(data.taskMessages) ? data.taskMessages : [])
          ].slice(0, 300);
          appendDataAccessLog(data, user, next.residentId, "registrationWaitlistEntries", `registration waitlist ${action}`, "allowed");
          data.securityEvents = sealAuditTrail([
            { id: randomUUID(), at: new Date().toLocaleString("zh-CN", { hour12: false }), actor: user.name, role: user.role, action: "registration-waitlist-action", target: next.id, result: "allowed", detail: `${action}:${next.status}` },
            ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
          ].slice(0, 120), { recompute: true });
          if (["decline", "expire"].includes(action)) promoteNextRegistrationWaitlist(data, schedule.id, user);
          writeDatabase(data);
          sendJson(res, 200, { ok: true, action, entry: next, order: createdOrder, dashboard: buildRegistrationDashboard(data, user) });
        } catch (error) {
          const conflict = /not allowed|unavailable/i.test(error.message || "");
          sendJson(res, conflict ? 409 : 400, { error: conflict ? "Conflict" : "Bad Request", message: error.message });
        }
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/registrations/orders") {
        const user = requireApiRole(req, res, ["commission", "institution", "citizen"], "/api/registrations/orders");
        if (!user) return true;
        const data = readDatabase();
        try {
          const order = normalizeRegistrationOrder(await collectJson(req), user, data);
          if (!canAccessRegistrationOrder(user, order, data)) {
            appendSecurityEvent({ actor: user.name, role: user.role, action: "create registration order", target: order.residentId, result: "denied", detail: "scope denied" });
            sendJson(res, 403, { error: "Forbidden", message: "scope denied" });
            return true;
          }
          data.registrationOrders = [order, ...(Array.isArray(data.registrationOrders) ? data.registrationOrders : [])].slice(0, 500);
          data.registrationSchedules = (Array.isArray(data.registrationSchedules) ? data.registrationSchedules : seedRegistrationSchedules()).map((schedule) =>
            schedule.id === order.scheduleId ? { ...schedule, remaining: Math.max(0, Number(schedule.remaining || 0) - 1) } : schedule
          );
          data.taskMessages = [buildRegistrationTaskMessage(order, "registration-submitted", user), ...(Array.isArray(data.taskMessages) ? data.taskMessages : [])].slice(0, 300);
          appendDataAccessLog(data, user, order.residentId, "registrationOrders", "create HIS registration appointment", "allowed");
          data.securityEvents = [
            {
              id: randomUUID(),
              at: new Date().toLocaleString("zh-CN", { hour12: false }),
              actor: user.name,
              role: user.role,
              action: "create registration order",
              target: order.id,
              result: "allowed",
              detail: order.status
            },
            ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
          ].slice(0, 120);
          writeDatabase(data);
          sendJson(res, 201, order);
        } catch (error) {
          const denied = /scope denied|unavailable/i.test(error.message || "");
          sendJson(res, denied ? 403 : 400, { error: denied ? "Forbidden" : "Bad Request", message: error.message });
        }
        return true;
      }

      const registrationJourneyActionMatch = url.pathname.match(/^\/api\/registrations\/orders\/([^/]+)\/actions$/);
      if (req.method === "POST" && registrationJourneyActionMatch) {
        const user = requireApiRole(req, res, ["commission", "institution", "insurance", "citizen"], "/api/registrations/orders/:id/actions");
        if (!user) return true;
        const data = readDatabase();
        const rows = Array.isArray(data.registrationOrders) ? data.registrationOrders : [];
        const index = rows.findIndex((item) => item.id === decodeURIComponent(registrationJourneyActionMatch[1]));
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "registration order not found" });
          return true;
        }
        if (!canAccessRegistrationOrder(user, rows[index], data)) {
          appendSecurityEvent({ actor: user.name, role: user.role, action: "registration-journey-action", target: rows[index].id, result: "denied", detail: "scope denied" });
          sendJson(res, 403, { error: "Forbidden", message: "scope denied" });
          return true;
        }
        try {
          const payload = await collectJson(req);
          rows[index] = applyRegistrationJourneyAction(rows[index], payload, user);
          rows[index].notificationStatus = "queued";
          rows[index].notificationDeliveries = [
            ...buildRegistrationNotificationDeliveries(rows[index].id, rows[index].residentId, `registration-${payload.action}`, user, rows[index].updatedAt),
            ...(Array.isArray(rows[index].notificationDeliveries) ? rows[index].notificationDeliveries : [])
          ].slice(0, 40);
          data.registrationOrders = rows;
          data.taskMessages = [
            buildRegistrationJourneyTaskMessage(rows[index], payload.action, user),
            ...(Array.isArray(data.taskMessages) ? data.taskMessages : [])
          ].slice(0, 300);
          appendDataAccessLog(data, user, rows[index].residentId, "registrationOrders", `registration journey ${payload.action}`, "allowed");
          data.securityEvents = sealAuditTrail([
            {
              id: randomUUID(),
              at: new Date().toLocaleString("zh-CN", { hour12: false }),
              actor: user.name,
              role: user.role,
              action: "registration-journey-action",
              target: rows[index].id,
              result: "allowed",
              detail: `${payload.action}:${rows[index].journeyStage}`
            },
            ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
          ].slice(0, 120), { recompute: true });
          writeDatabase(data);
          sendJson(res, 200, {
            ok: true,
            order: rows[index],
            dashboard: buildRegistrationDashboard(data, user)
          });
        } catch (error) {
          const conflict = /not allowed/i.test(error.message || "");
          sendJson(res, conflict ? 409 : 400, { error: conflict ? "Conflict" : "Bad Request", message: error.message });
        }
        return true;
      }

      const registrationCancelMatch = url.pathname.match(/^\/api\/registrations\/orders\/([^/]+)\/cancel$/);
      const registrationDisruptionMatch = url.pathname.match(/^\/api\/registrations\/orders\/([^/]+)\/disruption$/);
      if (req.method === "POST" && registrationDisruptionMatch) {
        const user = requireApiRole(req, res, ["commission", "institution", "citizen"], "/api/registrations/orders/:id/disruption");
        if (!user) return true;
        const data = readDatabase();
        const rows = Array.isArray(data.registrationOrders) ? data.registrationOrders : [];
        const index = rows.findIndex((item) => item.id === decodeURIComponent(registrationDisruptionMatch[1]));
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "registration order not found" });
          return true;
        }
        if (!canAccessRegistrationOrder(user, rows[index], data)) {
          appendSecurityEvent({ actor: user.name, role: user.role, action: "registration-disruption-action", target: rows[index].id, result: "denied", detail: "scope denied" });
          sendJson(res, 403, { error: "Forbidden", message: "scope denied" });
          return true;
        }
        try {
          const payload = await collectJson(req);
          const action = String(payload.action || "").trim();
          const schedules = Array.isArray(data.registrationSchedules) ? data.registrationSchedules : seedRegistrationSchedules();
          const replacementScheduleId = String(payload.replacementScheduleId || rows[index].disruption?.proposedSchedule?.scheduleId || "").trim();
          const replacementSchedule = schedules.find((item) => item.id === replacementScheduleId) || {};
          const originalScheduleId = rows[index].scheduleId;
          let next = applyRegistrationDisruptionAction(rows[index], payload, user, replacementSchedule);

          if (action === "accept") {
            data.registrationSchedules = schedules.map((schedule) => {
              if (schedule.id === originalScheduleId) return { ...schedule, remaining: Number(schedule.remaining || 0) + 1 };
              if (schedule.id === replacementScheduleId) return { ...schedule, remaining: Math.max(0, Number(schedule.remaining || 0) - 1) };
              return schedule;
            });
          }
          if (action === "cancel") {
            next = applyRegistrationCancel(next, { reason: payload.note || "resident declined replacement schedule" }, user);
            data.registrationSchedules = schedules.map((schedule) =>
              schedule.id === originalScheduleId ? { ...schedule, remaining: Number(schedule.remaining || 0) + 1 } : schedule
            );
          }

          next.notificationStatus = "queued";
          next.notificationDeliveries = [
            ...buildRegistrationNotificationDeliveries(next.id, next.residentId, `registration-disruption-${action}`, user, next.updatedAt),
            ...(Array.isArray(next.notificationDeliveries) ? next.notificationDeliveries : [])
          ].slice(0, 40);
          rows[index] = next;
          data.registrationOrders = rows;
          data.taskMessages = [
            buildRegistrationJourneyTaskMessage(next, `disruption-${action}`, user),
            ...(Array.isArray(data.taskMessages) ? data.taskMessages : [])
          ].slice(0, 300);
          appendDataAccessLog(data, user, next.residentId, "registrationOrders", `registration disruption ${action}`, "allowed");
          data.securityEvents = sealAuditTrail([
            {
              id: randomUUID(),
              at: new Date().toLocaleString("zh-CN", { hour12: false }),
              actor: user.name,
              role: user.role,
              action: "registration-disruption-action",
              target: next.id,
              result: "allowed",
              detail: `${action}:${next.disruption?.status || "unknown"}`
            },
            ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
          ].slice(0, 120), { recompute: true });
          if (["accept", "cancel"].includes(action)) promoteNextRegistrationWaitlist(data, originalScheduleId, user);
          writeDatabase(data);
          sendJson(res, 200, {
            ok: true,
            action,
            order: next,
            dashboard: buildRegistrationDashboard(data, user)
          });
        } catch (error) {
          const conflict = /not allowed|unavailable/i.test(error.message || "");
          sendJson(res, conflict ? 409 : 400, { error: conflict ? "Conflict" : "Bad Request", message: error.message });
        }
        return true;
      }

      if (req.method === "POST" && registrationCancelMatch) {
        const user = requireApiRole(req, res, ["commission", "institution", "citizen"], "/api/registrations/orders/:id/cancel");
        if (!user) return true;
        const data = readDatabase();
        const rows = Array.isArray(data.registrationOrders) ? data.registrationOrders : [];
        const index = rows.findIndex((item) => item.id === decodeURIComponent(registrationCancelMatch[1]));
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "registration order not found" });
          return true;
        }
        if (!canAccessRegistrationOrder(user, rows[index], data)) {
          appendSecurityEvent({ actor: user.name, role: user.role, action: "cancel registration order", target: rows[index].id, result: "denied", detail: "scope denied" });
          sendJson(res, 403, { error: "Forbidden", message: "scope denied" });
          return true;
        }
        if (["completed", "closed"].includes(rows[index].status)) {
          sendJson(res, 409, { error: "Conflict", message: "completed registration order cannot be cancelled" });
          return true;
        }
        if (rows[index].status === "cancelled") {
          sendJson(res, 409, { error: "Conflict", message: "registration order is already cancelled" });
          return true;
        }
        const payload = await collectJson(req);
        const wasOpen = rows[index].status !== "cancelled";
        rows[index] = applyRegistrationCancel(rows[index], payload, user);
        data.registrationOrders = rows;
        if (wasOpen) {
          data.registrationSchedules = (Array.isArray(data.registrationSchedules) ? data.registrationSchedules : seedRegistrationSchedules()).map((schedule) =>
            schedule.id === rows[index].scheduleId ? { ...schedule, remaining: Number(schedule.remaining || 0) + 1 } : schedule
          );
        }
        data.taskMessages = [buildRegistrationTaskMessage(rows[index], "registration-cancelled", user), ...(Array.isArray(data.taskMessages) ? data.taskMessages : [])].slice(0, 300);
        appendDataAccessLog(data, user, rows[index].residentId, "registrationOrders", payload.reason || "cancel registration appointment", "allowed");
        data.securityEvents = [
          {
            id: randomUUID(),
            at: new Date().toLocaleString("zh-CN", { hour12: false }),
            actor: user.name,
            role: user.role,
            action: "cancel registration order",
            target: rows[index].id,
            result: "allowed",
            detail: rows[index].status
          },
          ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
        ].slice(0, 120);
        promoteNextRegistrationWaitlist(data, rows[index].scheduleId, user);
        writeDatabase(data);
        sendJson(res, 200, rows[index]);
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/internet-nursing/dashboard") {
        const user = requireApiRole(req, res, ["commission", "institution", "county", "citizen"], "/api/internet-nursing/dashboard");
        if (!user) return true;
        sendJson(res, 200, redactSensitiveResponse(buildInternetNursingDashboard(readDatabase(), user), user));
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/internet-nursing/orders") {
        const user = requireApiRole(req, res, ["commission", "institution", "citizen"], "/api/internet-nursing/orders");
        if (!user) return true;
        try {
          const payload = await collectJson(req);
          const result = await careServicePlatformAdapter().createOrder(
            "nursing",
            careServiceCreatePayload(payload, "nursing"),
            careServiceActor(user),
            { commandId: careServiceCommandId(req, payload) }
          );
          sendJson(res, result.replayed ? 200 : 201, result.order);
        } catch (error) {
          sendCareServiceError(res, error);
        }
        return true;
      }

      if (false && req.method === "POST" && url.pathname === "/api/internet-nursing/orders") {
        const user = requireApiRole(req, res, ["commission", "institution", "citizen"], "/api/internet-nursing/orders");
        if (!user) return true;
        const data = readDatabase();
        try {
          const order = normalizeInternetNursingOrder(await collectJson(req), user, data);
          if (!canAccessInternetNursingOrder(user, order, data)) {
            appendSecurityEvent({ actor: user.name, role: user.role, action: "create internet nursing order", target: order.residentId, result: "denied", detail: "scope denied" });
            sendJson(res, 403, { error: "Forbidden", message: "scope denied" });
            return true;
          }
          data.internetNursingOrders = [order, ...(Array.isArray(data.internetNursingOrders) ? data.internetNursingOrders : [])].slice(0, 500);
          data.taskMessages = [
            {
              id: `msg-${randomUUID()}`,
              taskId: `internetNursingOrders:${order.id}`,
              collection: "internetNursingOrders",
              sourceId: order.id,
              residentId: order.residentId,
              targetRole: "institution",
              channel: "in_app",
              notificationEvent: "appointment-submitted",
              deliveryChannels: ["in_app", "sms", "hospital_message"],
              title: "互联网护理新预约",
              body: `${order.institutionName || order.institutionId} 需完成首诊评估、知情同意和护士派单：${order.serviceItem}。`,
              status: "sent",
              receipts: [],
              createdAt: new Date().toISOString(),
              createdBy: user.username || user.role,
              createdByName: user.name
            },
            ...(Array.isArray(data.taskMessages) ? data.taskMessages : [])
          ].slice(0, 300);
          appendDataAccessLog(data, user, order.residentId, "internetNursingOrders", "create internet nursing appointment", "allowed");
          data.securityEvents = [
            {
              id: randomUUID(),
              at: new Date().toLocaleString("zh-CN", { hour12: false }),
              actor: user.name,
              role: user.role,
              action: "create internet nursing order",
              target: order.id,
              result: "allowed",
              detail: order.status
            },
            ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
          ].slice(0, 120);
          writeDatabase(data);
          sendJson(res, 201, order);
        } catch (error) {
          const denied = /scope denied|not published/i.test(error.message || "");
          sendJson(res, denied ? 403 : 400, { error: denied ? "Forbidden" : "Bad Request", message: error.message });
        }
        return true;
      }

      const internetNursingActionMatch = url.pathname.match(/^\/api\/internet-nursing\/orders\/([^/]+)\/actions$/);
      if (req.method === "POST" && internetNursingActionMatch) {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/internet-nursing/orders/:id/actions");
        if (!user) return true;
        try {
          const payload = await collectJson(req);
          const transition = careServiceTransitionInput(payload);
          const result = await careServicePlatformAdapter().transitionOrder(
            "nursing",
            decodeURIComponent(internetNursingActionMatch[1]),
            transition.nextStatus,
            careServiceActor(user),
            {
              ...transition.input,
              commandId: careServiceCommandId(req, payload)
            }
          );
          sendJson(res, 200, result.order);
        } catch (error) {
          sendCareServiceError(res, error);
        }
        return true;
      }

      if (false && req.method === "POST" && internetNursingActionMatch) {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/internet-nursing/orders/:id/actions");
        if (!user) return true;
        const data = readDatabase();
        const rows = Array.isArray(data.internetNursingOrders) ? data.internetNursingOrders : [];
        const index = rows.findIndex((item) => item.id === decodeURIComponent(internetNursingActionMatch[1]));
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "internet nursing order not found" });
          return true;
        }
        if (!canAccessInternetNursingOrder(user, rows[index], data)) {
          appendSecurityEvent({ actor: user.name, role: user.role, action: "update internet nursing order", target: rows[index].id, result: "denied", detail: "scope denied" });
          sendJson(res, 403, { error: "Forbidden", message: "scope denied" });
          return true;
        }
        try {
          const payload = await collectJson(req);
          rows[index] = applyInternetNursingOrderAction(rows[index], payload, user, data);
          data.internetNursingOrders = rows;
          const taskMessage = buildInternetNursingActionMessage(rows[index], payload, user);
          if (taskMessage) {
            data.taskMessages = [taskMessage, ...(Array.isArray(data.taskMessages) ? data.taskMessages : [])].slice(0, 300);
          }
          appendDataAccessLog(data, user, rows[index].residentId, "internetNursingOrders", payload.note || rows[index].status, "allowed");
          data.securityEvents = [
            {
              id: randomUUID(),
              at: new Date().toLocaleString("zh-CN", { hour12: false }),
              actor: user.name,
              role: user.role,
              action: "update internet nursing order",
              target: rows[index].id,
              result: "allowed",
              detail: rows[index].status
            },
            ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
          ].slice(0, 120);
          writeDatabase(data);
          sendJson(res, 200, rows[index]);
        } catch (error) {
          sendJson(res, 400, { error: "Bad Request", message: error.message });
        }
        return true;
      }
        return false;
      }
    },
    {
      id: "care-coordination-02",
      domain: "care-coordination",
      async handle(req, res, url) {
    if (req.method === "GET" && url.pathname === "/api/tasks") {
        const user = requireApiRole(req, res, ["commission", "institution", "insurance", "county"], "/api/tasks");
        if (!user) return true;
        const data = readDatabase();
        const status = url.searchParams.get("status");
        const role = url.searchParams.get("role");
        const tasks = buildUnifiedTasks(data, user).filter((task) =>
          (!status || task.status === status) &&
          (!role || task.role === role)
        );
        sendJson(res, 200, {
          tasks,
          summary: tasks.reduce((result, task) => {
            result.total += 1;
            result.byRole[task.role] = (result.byRole[task.role] || 0) + 1;
            result.byStatus[task.status] = (result.byStatus[task.status] || 0) + 1;
            return result;
          }, { total: 0, byRole: {}, byStatus: {} })
        });
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/tasks/escalations") {
        const user = requireApiRole(req, res, ["commission", "institution", "insurance", "county"], "/api/tasks/escalations");
        if (!user) return true;
        const overdue = buildUnifiedTasks(readDatabase(), user).filter((task) => task.overdue);
        sendJson(res, 200, { overdue, summary: { total: overdue.length } });
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/tasks/escalations/run") {
        const user = requireApiRole(req, res, ["commission"], "/api/tasks/escalations/run");
        if (!user) return true;
        const data = readDatabase();
        const overdue = buildUnifiedTasks(data, user).filter((task) => task.overdue);
        const now = new Date().toISOString();
        const existingKeys = new Set((data.taskMessages || []).map((message) => message.escalationKey).filter(Boolean));
        const messages = overdue.filter((task) => !existingKeys.has(`${task.id}:${task.escalationLevel}`)).map((task) => ({
          id: `msg-${randomUUID()}`,
          taskId: task.id,
          collection: task.collection,
          sourceId: task.sourceId,
          residentId: task.residentId || "",
          targetRole: task.role,
          channel: "in_app",
          title: `Overdue task escalation: ${task.title}`,
          body: `Task ${task.id} is overdue and requires ${task.role} follow-up.`,
          status: "sent",
          escalationKey: `${task.id}:${task.escalationLevel}`,
          receipts: [],
          createdAt: now,
          createdBy: user.username || user.role,
          createdByName: user.name
        }));
        data.taskMessages = [...messages, ...(Array.isArray(data.taskMessages) ? data.taskMessages : [])].slice(0, 300);
        writeDatabase(data);
        sendJson(res, 201, { messages, summary: { created: messages.length, overdue: overdue.length } });
        return true;
      }
        return false;
      }
    },
    {
      id: "care-coordination-03",
      domain: "care-coordination",
      async handle(req, res, url) {
    if (req.method === "GET" && url.pathname === "/api/county/acceptance-ledger") {
        const user = requireApiRole(req, res, ["commission", "county"], "/api/county/acceptance-ledger");
        if (!user) return true;
        sendJson(res, 200, buildCountyAcceptanceLedger(readDatabase()));
        return true;
      }
        return false;
      }
    },
    {
      id: "care-coordination-04",
      domain: "care-coordination",
      async handle(req, res, url) {
    if (req.method === "GET" && url.pathname === "/api/messages") {
        const user = requireApiRole(req, res, ["commission", "institution", "insurance", "county", "citizen"], "/api/messages");
        if (!user) return true;
        const data = readDatabase();
        const messages = (Array.isArray(data.taskMessages) ? data.taskMessages : []).filter((message) => canAccessTaskMessage(user, message, data));
        sendJson(res, 200, { messages });
        return true;
      }

      const taskMessageMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/messages$/);
      if (req.method === "POST" && taskMessageMatch) {
        const user = requireApiRole(req, res, ["commission", "institution", "insurance", "county"], "/api/tasks/:id/messages");
        if (!user) return true;
        const data = readDatabase();
        const taskId = decodeURIComponent(taskMessageMatch[1]);
        const task = buildUnifiedTasks(data, user).find((item) => item.id === taskId);
        if (!task) {
          sendJson(res, 404, { error: "Not Found", message: "未找到可发送消息的任务" });
          return true;
        }
        const message = createTaskMessage({ task, payload: await collectJson(req), user });
        data.taskMessages = [message, ...(Array.isArray(data.taskMessages) ? data.taskMessages : [])].slice(0, 300);
        data.securityEvents = prependAuditTrailEntry(data.securityEvents, {
          id: randomUUID(),
          at: new Date().toLocaleString("zh-CN", { hour12: false }),
          actor: user.name,
          role: user.role,
          action: "send task message",
          target: taskId,
          result: "allowed",
          detail: `${message.targetRole} · ${message.channel}`
        });
        writeDatabase(data);
        sendJson(res, 201, message);
        return true;
      }

      const messageReceiptMatch = url.pathname.match(/^\/api\/messages\/([^/]+)\/receipt$/);
      if (req.method === "POST" && messageReceiptMatch) {
        const user = requireApiRole(req, res, ["commission", "institution", "insurance", "county", "citizen"], "/api/messages/:id/receipt");
        if (!user) return true;
        const data = readDatabase();
        const messages = Array.isArray(data.taskMessages) ? data.taskMessages : [];
        const index = messages.findIndex((message) => message.id === decodeURIComponent(messageReceiptMatch[1]));
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "未找到消息" });
          return true;
        }
        if (!canAccessTaskMessage(user, messages[index], data)) {
          sendJson(res, 403, { error: "Forbidden", message: "无权回执该消息" });
          return true;
        }
        const payload = await collectJson(req);
        const receipt = {
          at: new Date().toISOString(),
          by: user.username || user.role,
          byName: user.name,
          status: String(payload.status || "read").trim()
        };
        messages[index] = {
          ...messages[index],
          status: receipt.status,
          receipts: [receipt, ...(Array.isArray(messages[index].receipts) ? messages[index].receipts : [])].slice(0, 20)
        };
        data.taskMessages = messages;
        writeDatabase(data);
        sendJson(res, 200, messages[index]);
        return true;
      }

      const taskActionMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/actions$/);
      if (req.method === "POST" && taskActionMatch) {
        const user = requireApiRole(req, res, ["commission", "institution", "insurance", "county", "citizen"], "/api/tasks/:id/actions");
        if (!user) return true;
        const taskId = decodeURIComponent(taskActionMatch[1]);
        const [collection, id] = taskId.split(":");
        if (!WORKFLOW_COLLECTIONS.has(collection)) {
          sendJson(res, 400, { error: "Bad Request", message: "不支持的任务来源" });
          return true;
        }
        if (!WORKFLOW_ROLE_COLLECTIONS[user.role]?.has(collection)) {
          sendJson(res, 403, { error: "Forbidden", message: "当前角色无权处理该任务" });
          return true;
        }
        const data = readDatabase();
        if (collection === "citizenLifecycleActions") {
          const task = buildUnifiedTasks(data, user).find((item) => item.id === taskId);
          if (!task) {
            sendJson(res, 404, { error: "Not Found", message: "未找到生命周期健康管理任务" });
            return true;
          }
          if (!canAccessResident(user, task.residentId, data)) {
            sendJson(res, 403, { error: "Forbidden", message: "无权处理该居民生命周期任务" });
            return true;
          }
          const payload = await collectJson(req);
          const message = buildLifecycleActionClosureMessage(task, payload, user);
          data.taskMessages = [message, ...(Array.isArray(data.taskMessages) ? data.taskMessages : [])].slice(0, 300);
          data.securityEvents = [
            {
              id: randomUUID(),
              at: new Date().toLocaleString("zh-CN", { hour12: false }),
              actor: user.name,
              role: user.role,
              action: "handle citizen lifecycle task",
              target: taskId,
              result: "allowed",
              detail: `${payload.status || "handled"} · ${task.sourceCollection || "derived"}`
            },
            ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
          ].slice(0, 120);
          writeDatabase(data);
          sendJson(res, 200, {
            ...task,
            status: String(payload.status || "handled").trim(),
            taskAction: String(payload.action || "lifecycle-action-handle").trim(),
            taskComment: String(payload.comment || payload.note || "").trim(),
            handledAt: message.createdAt,
            handledBy: user.username || user.role,
            handledByName: user.name,
            message
          });
          return true;
        }
        const rows = findWorkflowCollection(data, collection);
        if (!rows) {
          sendJson(res, 400, { error: "Bad Request", message: "不支持的任务集合" });
          return true;
        }
        const index = rows.findIndex((item) => item.id === id);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "未找到任务" });
          return true;
        }
        if (collection === "escortServiceOrders" && !canAccessEscortOrder(user, rows[index], data)) {
          sendJson(res, 403, { error: "Forbidden", message: "No access to this escort service task" });
          return true;
        }
        if (collection === "internetNursingOrders" && !canAccessInternetNursingOrder(user, rows[index], data)) {
          sendJson(res, 403, { error: "Forbidden", message: "No access to this internet nursing task" });
          return true;
        }
        if (!["escortServiceOrders", "internetNursingOrders"].includes(collection) && !canAccessResident(user, rows[index].residentId || rows[index].maternalResidentId, data)) {
          sendJson(res, 403, { error: "Forbidden", message: "无权处理该居民任务" });
          return true;
        }
        const payload = await collectJson(req);
        try {
          rows[index] = user.role === "citizen"
            ? applyCitizenTaskAction(rows[index], payload, collection, user)
            : {
                ...rows[index],
                status: String(payload.status || rows[index].status || "processing").trim(),
                taskAction: String(payload.action || "update").trim(),
                taskComment: String(payload.comment || "").trim(),
                handledAt: new Date().toISOString(),
                handledBy: user.username || user.role,
                handledByName: user.name
              };
        } catch (error) {
          sendJson(res, 400, { error: "Bad Request", message: error.message });
          return true;
        }
        if (user.role === "citizen") {
          data.taskMessages = [buildCitizenTaskActionMessage(rows[index], collection, payload, user), ...(Array.isArray(data.taskMessages) ? data.taskMessages : [])].slice(0, 300);
        }
        if (collection === "drugConsumableSupervisions") {
          appendDrugConsumableAuditTrail(rows[index], user, "unified-task-action", payload.comment || payload.action);
        }
        data.securityEvents = [
          {
            id: randomUUID(),
            at: new Date().toLocaleString("zh-CN", { hour12: false }),
            actor: user.name,
            role: user.role,
            action: "handle unified task",
            target: taskId,
            result: "allowed",
            detail: rows[index].status
          },
          ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
        ].slice(0, 120);
        writeDatabase(data);
        sendJson(res, 200, rows[index]);
        return true;
      }
        return false;
      }
    },
    {
      id: "care-coordination-05",
      domain: "care-coordination",
      async handle(req, res, url) {
    const registrationIntegrationRetryMatch = url.pathname.match(/^\/api\/registrations\/integration-events\/([^/]+)\/retry$/);
      if (req.method === "POST" && registrationIntegrationRetryMatch) {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/registrations/integration-events/:id/retry");
        if (!user) return true;
        const payload = await collectJson(req);
        const note = String(payload.note || "").trim();
        if (note.length < 2) {
          sendJson(res, 400, { error: "Validation Error", message: "预约回调重试必须填写至少 2 个字符的处理备注" });
          return true;
        }
        const data = readDatabase();
        const sourceEvent = (Array.isArray(data.integrationGatewayEvents) ? data.integrationGatewayEvents : [])
          .find((event) => event.id === registrationIntegrationRetryMatch[1] && event.contractId === APPOINTMENT_CONTRACT_ID);
        if (!sourceEvent) {
          sendJson(res, 404, { error: "Not Found", message: "未找到预约回调事件" });
          return true;
        }
        if (!canManageAppointmentIntegrationEvent(data, user, sourceEvent)) {
          sendJson(res, 403, { error: "Forbidden", message: "无权重试其他机构的预约回调事件" });
          return true;
        }
        if (!sourceEvent.deadLetter && sourceEvent.status !== "failed") {
          sendJson(res, 409, { error: "Conflict", message: "仅死信或失败的预约回调可以重试" });
          return true;
        }
        if (!sourceEvent.requestPayload || typeof sourceEvent.requestPayload !== "object") {
          sendJson(res, 409, { error: "Conflict", message: "预约回调缺少原始请求载荷，需转人工对账" });
          return true;
        }
        if (Number(sourceEvent.retryCount || 0) >= 3) {
          sendJson(res, 409, { error: "Conflict", message: "预约回调已达到 3 次重试上限，需转人工对账" });
          return true;
        }
        const retriedAt = new Date().toISOString();
        const event = updateIntegrationEvent(data, sourceEvent.id, (current) => ({
          status: "retrying",
          retryCount: Number(current.retryCount || 0) + 1,
          deadLetter: false,
          deadLetterReason: "",
          lastRetriedAt: retriedAt,
          lastRetryNote: note.slice(0, 200),
          lastRetryBy: user.username || user.name || user.role,
          reconciliationStatus: "retrying"
        }));
        landAppointmentIntegrationEvent(data, event.requestPayload, event, user);
        Object.assign(event, {
          lastRetryResult: event.deadLetter ? "failed" : "matched",
          updatedAt: new Date().toISOString()
        });
        data.securityEvents = [
          {
            id: randomUUID(),
            at: new Date().toLocaleString("zh-CN", { hour12: false }),
            actor: user.name,
            role: user.role,
            action: "重试预约回调死信",
            target: event.id,
            result: event.deadLetter ? "失败" : "允许",
            detail: `${event.contractId} · ${event.idempotencyKey} · retry=${event.retryCount} · ${event.lastRetryNote}`
          },
          ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
        ].slice(0, 120);
        writeDatabase(data);
        sendJson(res, 200, {
          ok: !event.deadLetter,
          result: event.deadLetter ? "retry-failed" : "matched",
          event,
          dashboard: buildRegistrationDashboard(data, user)
        });
        return true;
      }

      const registrationReconciliationMatch = url.pathname.match(/^\/api\/registrations\/integration-events\/([^/]+)\/reconciliation$/);
      if (req.method === "POST" && registrationReconciliationMatch) {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/registrations/integration-events/:id/reconciliation");
        if (!user) return true;
        const payload = await collectJson(req);
        const data = readDatabase();
        const sourceEvent = (Array.isArray(data.integrationGatewayEvents) ? data.integrationGatewayEvents : [])
          .find((event) => event.id === registrationReconciliationMatch[1] && event.contractId === APPOINTMENT_CONTRACT_ID);
        if (!sourceEvent) {
          sendJson(res, 404, { error: "Not Found", message: "未找到预约回调事件" });
          return true;
        }
        if (!canManageAppointmentIntegrationEvent(data, user, sourceEvent)) {
          sendJson(res, 403, { error: "Forbidden", message: "无权处理其他机构的预约人工对账工单" });
          return true;
        }
        let nextEvent;
        try {
          nextEvent = applyAppointmentIntegrationReconciliationAction(sourceEvent, payload, user);
        } catch (error) {
          sendJson(res, Number(error.statusCode || 400), { error: Number(error.statusCode || 400) === 409 ? "Conflict" : "Validation Error", message: error.message });
          return true;
        }
        const event = updateIntegrationEvent(data, sourceEvent.id, () => nextEvent);
        data.securityEvents = [
          {
            id: randomUUID(),
            at: new Date().toLocaleString("zh-CN", { hour12: false }),
            actor: user.name,
            role: user.role,
            action: `预约回调人工对账-${String(payload.action || "").trim()}`,
            target: event.id,
            result: "允许",
            detail: `${event.manualReconciliation?.id || "case-pending"} · ${event.reconciliationStatus} · ${event.manualReconciliation?.latestNote || event.manualReconciliation?.resolutionNote || ""}`
          },
          ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
        ].slice(0, 120);
        writeDatabase(data);
        sendJson(res, 200, {
          ok: true,
          action: String(payload.action || "").trim(),
          event,
          dashboard: buildRegistrationDashboard(data, user)
        });
        return true;
      }
        return false;
      }
    },
    {
      id: "care-coordination-06",
      domain: "care-coordination",
      async handle(req, res, url) {
    if (req.method === "GET" && url.pathname === "/api/doctors/me") {
        const user = requireApiRole(req, res, ["institution"], "/api/doctors/me");
        if (!user) return true;
        const data = readDatabase();
        const doctor = (data.doctorProfiles || []).find((item) => item.id === user.doctorId || item.username === user.username);
        if (!doctor) {
          sendJson(res, 404, { error: "Not Found", message: "当前账户未绑定医生档案" });
          return true;
        }
        const reviewedDoctor = {
          ...doctor,
          electronicRegistrationVerification: verifyDoctorElectronicRegistration(doctor)
        };
        const doctorApplications = (data.multiPracticeApplications || [])
          .filter((item) => item.doctorId === doctor.id)
          .map((item) => refreshMultiPracticeReviewState(
            item,
            doctor,
            (data.multiPracticeApplications || []).filter((application) => application.id !== item.id),
            "doctor-view",
            user
          ));
        const doctorRegistry = buildMultiPracticeRegistry(data, user);
        const multiPracticeMessages = (Array.isArray(data.taskMessages) ? data.taskMessages : [])
          .filter((message) => message.collection === "multiPracticeApplications" && canAccessTaskMessage(user, message, data));
        sendJson(res, 200, {
          doctor: reviewedDoctor,
          multiPracticeApplications: doctorApplications,
          multiPracticeSummary: doctorRegistry.summary,
          multiPracticeMessages,
          policy: data.multiPracticePolicy
        });
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/multi-practice-applications") {
        const user = requireApiRole(req, res, ["institution", "commission"], "/api/multi-practice-applications");
        if (!user) return true;
        const data = readDatabase();
        const applications = (data.multiPracticeApplications || [])
          .filter((item) => canAccessMultiPracticeApplication(user, item))
          .map((item) => refreshMultiPracticeReviewState(
            item,
            (data.doctorProfiles || []).find((doctor) => doctor.id === item.doctorId),
            (data.multiPracticeApplications || []).filter((application) => application.id !== item.id),
            "application-list",
            user
          ));
        sendJson(res, 200, { applications, policy: data.multiPracticePolicy });
        return true;
      }
        return false;
      }
    },
    {
      id: "care-coordination-07",
      domain: "care-coordination",
      async handle(req, res, url) {
    if (req.method === "GET" && url.pathname === "/api/multi-practice-registry") {
        const user = requireApiRole(req, res, ["institution", "commission"], "/api/multi-practice-registry");
        if (!user) return true;
        sendJson(res, 200, redactSensitiveResponse(buildMultiPracticeRegistry(readDatabase(), user), user));
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/multi-practice-applications") {
        const user = requireApiRole(req, res, ["institution", "commission"], "/api/multi-practice-applications");
        if (!user) return true;
        const data = readDatabase();
        let application;
        try {
          application = normalizeMultiPracticeApplication(await collectJson(req), user, data);
        } catch (error) {
          sendJson(res, 400, { error: "Bad Request", message: error.message });
          return true;
        }
        data.multiPracticeApplications = [application, ...(Array.isArray(data.multiPracticeApplications) ? data.multiPracticeApplications : [])].slice(0, 200);
        data.taskMessages = [
          buildMultiPracticeTaskMessage(application, { target: "hospital" }, user),
          ...(Array.isArray(data.taskMessages) ? data.taskMessages : [])
        ].slice(0, 300);
        data.securityEvents = [
          {
            id: randomUUID(),
            at: new Date().toLocaleString("zh-CN", { hour12: false }),
            actor: user.name,
            role: user.role,
            action: "登记多点执业申请",
            target: application.id,
            result: "允许",
            detail: `${application.doctorName} · ${application.primaryInstitution} -> ${application.targetInstitution} · ${application.status}`
          },
          ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
        ].slice(0, 120);
        writeDatabase(data);
        sendJson(res, 201, application);
        return true;
      }

      if (req.method === "PATCH" && url.pathname.startsWith("/api/multi-practice-applications/")) {
        const user = requireApiRole(req, res, ["institution", "commission"], "/api/multi-practice-applications/:id");
        if (!user) return true;
        const id = decodeURIComponent(url.pathname.replace("/api/multi-practice-applications/", ""));
        const patch = await collectJson(req);
        const data = readDatabase();
        const index = data.multiPracticeApplications.findIndex((item) => item.id === id);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "未找到多点执业申请" });
          return true;
        }
        if (!canAccessMultiPracticeApplication(user, data.multiPracticeApplications[index])) {
          appendSecurityEvent({ actor: user.name, role: user.role, action: "更新多点执业申请", target: id, result: "拒绝", detail: "超出医生或机构授权范围" });
          sendJson(res, 403, { error: "Forbidden", message: "无权更新该多点执业申请" });
          return true;
        }
        const safePatch = cleanMultiPracticePatch(patch);
        const previousApplication = data.multiPracticeApplications[index];
        const profile = (data.doctorProfiles || []).find((doctor) => doctor.id === previousApplication.doctorId);
        const lifecyclePatch = resolveMultiPracticeLifecyclePatch(patch);
        if (lifecyclePatch.status) safePatch.status = lifecyclePatch.status;
        if (lifecyclePatch.publicVisible !== undefined) safePatch.publicVisible = lifecyclePatch.publicVisible;
        if (lifecyclePatch.correctionRequired) safePatch.correctionRequired = lifecyclePatch.correctionRequired;
        if (safePatch.primaryConsent) safePatch.primaryPracticeConfirmation = buildPrimaryPracticeConfirmation({ ...safePatch, note: patch.note }, user, profile || {}, previousApplication);
        const nextLifecycle = [
          {
            at: new Date().toLocaleString("zh-CN", { hour12: false }),
            actor: user.name,
            action: lifecyclePatch.action || (safePatch.status ? `状态更新为 ${safePatch.status}` : "更新申请材料"),
            note: String(patch.note || safePatch.reviewOpinion || safePatch.correctionRequired || "").trim()
          },
          ...(Array.isArray(previousApplication.lifecycle) ? previousApplication.lifecycle : [])
        ].slice(0, 20);
        const nextApplication = {
          ...previousApplication,
          ...safePatch,
          lifecycle: nextLifecycle,
          updatedBy: user.username || user.role,
          updatedByName: user.name,
          lastUpdated: new Date().toISOString()
        };
        const peerApplications = data.multiPracticeApplications.filter((item) => item.id !== id);
        data.multiPracticeApplications[index] = refreshMultiPracticeReviewState(nextApplication, profile, peerApplications, lifecyclePatch.action || "patch", user);
        data.taskMessages = [
          buildMultiPracticeTaskMessage(data.multiPracticeApplications[index], { target: "doctor", note: patch.note || safePatch.reviewOpinion || safePatch.correctionRequired || "" }, user),
          ...(Array.isArray(data.taskMessages) ? data.taskMessages : [])
        ].slice(0, 300);
        if (Object.hasOwn(patch, "expectedVersion")) {
          data.storageMeta = {
            ...(data.storageMeta || {}),
            collectionVersions: { multiPracticeApplications: Number(patch.expectedVersion) }
          };
        }
        data.securityEvents = prependAuditTrailEntry(data.securityEvents, {
          id: randomUUID(),
          at: new Date().toLocaleString("zh-CN", { hour12: false }),
          actor: user.name,
          role: user.role,
          action: "更新多点执业申请",
          target: id,
          result: "允许",
          detail: `状态更新为 ${data.multiPracticeApplications[index].status || "已更新"}`
        });
        writeDatabase(data);
        sendJson(res, 200, data.multiPracticeApplications[index]);
        return true;
      }
        return false;
      }
    },
    {
      id: "care-coordination-08",
      domain: "care-coordination",
      async handle(req, res, url) {
    if (req.method === "PATCH" && url.pathname.startsWith("/api/care-orders/")) {
        const user = requireApiRole(req, res, ["institution", "commission"], "/api/care-orders/:id");
        if (!user) return true;
        const result = patchBusinessCollectionItem({
          data: readDatabase(),
          collection: "careOrders",
          id: decodeURIComponent(url.pathname.replace("/api/care-orders/", "")),
          patch: await collectJson(req),
          user,
          action: "更新诊疗工单"
        });
        sendJson(res, result.status, result.body);
        return true;
      }
        return false;
      }
    },
    {
      id: "care-coordination-09",
      domain: "care-coordination",
      async handle(req, res, url) {
    if (req.method === "PATCH" && url.pathname.startsWith("/api/county-collaboration-orders/")) {
        const user = requireApiRole(req, res, ["county", "commission"], "/api/county-collaboration-orders/:id");
        if (!user) return true;
        const result = patchBusinessCollectionItem({
          data: readDatabase(),
          collection: "countyCollaborationOrders",
          id: decodeURIComponent(url.pathname.replace("/api/county-collaboration-orders/", "")),
          patch: await collectJson(req),
          user,
          action: "更新县域协同工单"
        });
        sendJson(res, result.status, result.body);
        return true;
      }

      if (req.method === "PATCH" && url.pathname.startsWith("/api/county-ai-diagnosis-cases/")) {
        const user = requireApiRole(req, res, ["county", "commission"], "/api/county-ai-diagnosis-cases/:id");
        if (!user) return true;
        const result = patchBusinessCollectionItem({
          data: readDatabase(),
          collection: "countyAiDiagnosisCases",
          id: decodeURIComponent(url.pathname.replace("/api/county-ai-diagnosis-cases/", "")),
          patch: await collectJson(req),
          user,
          action: "更新县域 AI 诊断"
        });
        sendJson(res, result.status, result.body);
        return true;
      }

      if (req.method === "PATCH" && url.pathname.startsWith("/api/county-mutual-recognition-records/")) {
        const user = requireApiRole(req, res, ["county", "commission"], "/api/county-mutual-recognition-records/:id");
        if (!user) return true;
        const result = patchBusinessCollectionItem({
          data: readDatabase(),
          collection: "countyMutualRecognitionRecords",
          id: decodeURIComponent(url.pathname.replace("/api/county-mutual-recognition-records/", "")),
          patch: await collectJson(req),
          user,
          action: "更新县域检查互认"
        });
        sendJson(res, result.status, result.body);
        return true;
      }
        return false;
      }
    },
    {
      id: "care-coordination-10",
      domain: "care-coordination",
      async handle(req, res, url) {
    const referralActionMatch = url.pathname.match(/^\/api\/referrals\/([^/]+)\/actions$/);
      if (req.method === "POST" && referralActionMatch) {
        const user = requireApiRole(req, res, ["institution", "county", "commission"], "/api/referrals/:id/actions");
        if (!user) return true;
        const payload = await collectJson(req);
        const headerCommandId = String(req.headers["idempotency-key"] || "").trim();
        const bodyCommandId = String(payload.commandId || payload.idempotencyKey || "").trim();
        if (bodyCommandId && bodyCommandId !== headerCommandId) {
          sendJson(res, 400, {
            ok: false,
            code: "REFERRAL_COMMAND_ID_CONFLICT",
            message: "body command id must match Idempotency-Key"
          });
          return true;
        }
        const referralId = decodeURIComponent(referralActionMatch[1]);
        const currentData = readDatabase();
        const current = (currentData.referralSystem?.referrals || []).find((item) => item.id === referralId);
        if (!current) {
          sendJson(res, 404, { ok: false, code: "REFERRAL_NOT_FOUND", message: "referral was not found" });
          return true;
        }
        if (!canAccessResident(user, current.residentId, currentData)) {
          appendSecurityEvent({
            actor: user.name,
            role: user.role,
            action: "versioned-referral-command",
            target: referralId,
            result: "denied",
            detail: "resident scope denied"
          });
          sendJson(res, 403, { ok: false, code: "REFERRAL_SCOPE_DENIED", message: "resident scope denied" });
          return true;
        }
        try {
          const result = await createReferralCommandService({
            readState: readDatabase,
            writeState: writeDatabase
          }).update({
            referralId,
            commandId: headerCommandId,
            expectedVersion: payload.expectedVersion,
            correlationId: req.correlationId,
            actor: user,
            input: payload
          });
          appendSecurityEvent({
            actor: user.name,
            role: user.role,
            action: "versioned-referral-command",
            target: referralId,
            result: result.replayed ? "idempotent" : "allowed",
            detail: `${result.contract.contractId}@${result.contract.contractVersion} aggregate version ${result.referral.version}`
          });
          sendJson(res, 200, {
            ok: true,
            idempotentReplay: result.replayed,
            correlationId: req.correlationId,
            referral: result.referral,
            contract: result.contract,
            event: {
              id: result.event.id,
              type: result.event.type,
              aggregateVersion: result.event.aggregateVersion,
              status: result.event.status || "pending"
            }
          });
        } catch (error) {
          const known = error instanceof ReferralCommandError;
          sendJson(res, known ? error.statusCode : 500, {
            ok: false,
            code: known ? error.code : "REFERRAL_COMMAND_FAILED",
            message: known ? error.message : "referral command failed"
          });
        }
        return true;
      }

    if (req.method === "POST" && url.pathname === "/api/workflow-actions") {
        const user = requireApiRole(req, res, ["institution", "insurance", "county", "commission"], "/api/workflow-actions");
        if (!user) return true;
        const payload = await collectJson(req);
        const collection = String(payload.collection || "").trim();
        if (!WORKFLOW_COLLECTIONS.has(collection)) {
          sendJson(res, 400, { error: "Bad Request", message: "不支持的业务集合" });
          return true;
        }
        if (!WORKFLOW_ROLE_COLLECTIONS[user.role]?.has(collection)) {
          appendSecurityEvent({ actor: user.name, role: user.role, action: "更新业务闭环", target: collection, result: "拒绝", detail: "角色无权更新该业务集合" });
          sendJson(res, 403, { error: "Forbidden", message: "当前角色无权更新该业务集合" });
          return true;
        }
        const data = readDatabase();
        const rows = findWorkflowCollection(data, collection);
        const item = rows?.find((row) => row.id === payload.id);
        if (!item) {
          sendJson(res, 404, { error: "Not Found", message: "未找到业务记录" });
          return true;
        }
        if (collection === "multiPracticeApplications" && !canAccessMultiPracticeApplication(user, item)) {
          appendSecurityEvent({ actor: user.name, role: user.role, action: "更新多点执业", target: `${collection}/${payload.id}`, result: "拒绝", detail: "超出医生或机构授权范围" });
          sendJson(res, 403, { error: "Forbidden", message: "无权更新该多点执业记录" });
          return true;
        }
        if (collection === "referralTeleconsultations" && !canAccessReferralTeleconsultation(user, item, data)) {
          appendSecurityEvent({ actor: user.name, role: user.role, action: "update referral teleconsultation", target: `${collection}/${payload.id}`, result: "denied", detail: "scope denied" });
          sendJson(res, 403, { error: "Forbidden", message: "scope denied" });
          return true;
        }
        if (!canAccessResident(user, item.residentId, data)) {
          appendSecurityEvent({ actor: user.name, role: user.role, action: "更新业务闭环", target: `${collection}/${payload.id}`, result: "拒绝", detail: "超出居民授权范围" });
          sendJson(res, 403, { error: "Forbidden", message: "无权更新该居民业务记录" });
          return true;
        }
        if (collection === "referralTeleconsultations") {
          Object.assign(item, applyReferralTeleconsultationAction(item, payload, user));
        } else {
          Object.assign(item, cleanWorkflowUpdates(payload.updates));
        }
        if (collection === "multiPracticeApplications") {
          const profile = (data.doctorProfiles || []).find((doctor) => doctor.id === item.doctorId);
          const lifecyclePatch = resolveMultiPracticeLifecyclePatch(payload);
          if (lifecyclePatch.status) item.status = String(lifecyclePatch.status);
          if (lifecyclePatch.publicVisible !== undefined) item.publicVisible = lifecyclePatch.publicVisible;
          if (lifecyclePatch.correctionRequired) item.correctionRequired = lifecyclePatch.correctionRequired;
          if (payload.updates?.primaryConsent) {
            item.primaryPracticeConfirmation = buildPrimaryPracticeConfirmation({ ...(payload.updates || {}), note: payload.note }, user, profile || {}, item);
          }
          item.lifecycle = [
            {
              at: new Date().toLocaleString("zh-CN", { hour12: false }),
              actor: user.name,
              action: lifecyclePatch.action || (lifecyclePatch.status ? `状态更新为 ${lifecyclePatch.status}` : String(payload.note || "更新多点执业申请")),
              note: String(payload.note || "").trim()
            },
            ...(Array.isArray(item.lifecycle) ? item.lifecycle : [])
          ].slice(0, 20);
          const peerApplications = (data.multiPracticeApplications || []).filter((application) => application.id !== item.id);
          Object.assign(item, refreshMultiPracticeReviewState(item, profile, peerApplications, lifecyclePatch.action || "workflow-action", user));
          data.taskMessages = [
            buildMultiPracticeTaskMessage(item, { target: "doctor", note: payload.note || "" }, user),
            ...(Array.isArray(data.taskMessages) ? data.taskMessages : [])
          ].slice(0, 300);
        }
        if (payload.status && collection !== "multiPracticeApplications") item.status = String(payload.status);
        item.lastUpdated = new Date().toISOString();
        data.securityEvents = prependAuditTrailEntry(data.securityEvents, {
          id: randomUUID(),
          at: new Date().toLocaleString("zh-CN", { hour12: false }),
          actor: user.name,
          role: user.role,
          action: "更新业务闭环",
          target: `${collection}/${item.id}`,
          result: "允许",
          detail: payload.note || `状态更新为 ${item.status || "已更新"}`
        });
        if (Object.hasOwn(payload, "expectedVersion")) {
          data.storageMeta = {
            ...(data.storageMeta || {}),
            collectionVersions: { [workflowStateCollectionKey(collection)]: Number(payload.expectedVersion) }
          };
        }
        if (collection === "birthCertificates") {
          refreshBirthStatistics(data);
        }
        writeDatabase(data);
        sendJson(res, 200, item);
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/registration-referral/operations") {
        const user = requireApiRole(req, res, ["citizen", "institution", "county", "commission"], "/api/registration-referral/operations");
        if (!user) return true;
        const data = readDatabase();
        const actor = {
          id: user.id,
          username: user.username,
          name: user.name,
          role: user.role,
          orgCode: user.orgCode,
          residentId: user.residentId,
          residentIds: user.residentId ? [user.residentId] : []
        };
        const asOf = new Date().toISOString();
        const queue = RegistrationReferralService.buildClosureWorkQueue(data, { asOf, actor });
        appendDataAccessLog(data, user, user.residentId || "", "挂号转诊闭环", "查询责任事项、质量指标和通知可靠性");
        writeDatabase(normalizeState(data));
        sendJson(res, 200, redactSensitiveResponse({
          asOf,
          queue,
          quality: RegistrationReferralService.buildClosureQualityMetrics(data, { asOf }),
          notificationReliability: RegistrationReferralService.buildNotificationReliability(data),
          productionReady: false
        }, user));
        return true;
      }

      const registrationReferralCommandMatch = url.pathname.match(/^\/api\/registration-referral\/commands(?:\/([^/]+))?$/);
      if (req.method === "POST" && registrationReferralCommandMatch) {
        const user = requireApiRole(req, res, ["citizen", "institution", "county", "insurance", "commission"], "/api/registration-referral/commands");
        if (!user) return true;
        const payload = await collectJson(req);
        const routeAction = registrationReferralCommandMatch[1] ? decodeURIComponent(registrationReferralCommandMatch[1]) : "";
        const headerKey = String(req.headers["idempotency-key"] || "").trim().slice(0, 240);
        const bodyKey = String(payload.commandId || payload.idempotencyKey || "").trim();
        try {
          if (!headerKey) throw new Error("Idempotency-Key is required");
          if (bodyKey && bodyKey !== headerKey) throw new Error("idempotency key conflict");
          if (routeAction && payload.action && routeAction !== payload.action) throw new Error("route action does not match request action");
          const action = routeAction || String(payload.action || "").trim();
          if (!action) throw new Error("action is required");
          const data = readDatabase();
          const actor = {
            id: user.id,
            username: user.username,
            name: user.name,
            role: user.role,
            orgCode: user.orgCode,
            residentId: user.residentId,
            residentIds: user.residentId ? [user.residentId] : []
          };
          const command = {
            commandId: headerKey,
            action,
            caseType: payload.caseType,
            caseId: payload.caseId,
            residentId: payload.residentId,
            expectedVersion: payload.expectedVersion,
            payload: payload.payload
          };
          const applied = RegistrationReferralService.applyClosureCommand(data, command, actor, {
            requireExpectedVersion: true
          });
          if ((applied.consistency?.summary?.P0 || 0) > 0) {
            throw new Error(`registration/referral consistency rejected with ${applied.consistency.summary.P0} P0 issue(s)`);
          }
          applied.data.securityEvents = prependAuditTrailEntry(applied.data.securityEvents, {
            id: randomUUID(),
            at: new Date().toLocaleString("zh-CN", { hour12: false }),
            actor: user.name,
            role: user.role,
            action: "执行挂号转诊闭环命令",
            target: `${action}:${applied.event.caseId || headerKey}`,
            result: "允许",
            detail: `${applied.event.id}; idempotent=${applied.idempotent}; productionEvidence=false`
          });
          writeDatabase(normalizeState(applied.data));
          sendJson(res, applied.idempotent ? 200 : 201, redactSensitiveResponse({
            ok: true,
            idempotent: applied.idempotent,
            event: applied.event,
            result: applied.result,
            consistency: applied.consistency,
            productionReady: false
          }, user));
        } catch (error) {
          appendSecurityEvent({ actor: user.name, role: user.role, action: "执行挂号转诊闭环命令", target: routeAction || String(payload.action || bodyKey || ""), result: "拒绝", detail: error.message });
          const status = /role |scope denied|只能|无权/i.test(error.message)
            ? 403
            : /not found/i.test(error.message)
              ? 404
              : /conflict|version/i.test(error.message)
                ? 409
                : 400;
          sendJson(res, status, { error: status === 403 ? "Forbidden" : status === 404 ? "Not Found" : status === 409 ? "Conflict" : "Bad Request", message: error.message });
        }
        return true;
      }
        return false;
      }
    },
  ];
}

module.exports = { createRouteSegments };
