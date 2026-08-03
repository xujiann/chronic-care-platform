"use strict";

function createRouteSegments(runtime) {
  const { BloodBusinessService, BloodEventHub, BloodGoLiveService, BloodInnovationService, BloodIntegrationGateway, BloodMasterData, BloodService, BloodTransactionService, EmergencyLifeChain, EmergencyProduction, EmergencyService, ImagingCloudProduction, PhysicalExaminationService, allowedResidentIdsForUser, appendDataAccessLog, appendOperationsIntegrationAudit, appendQualitySafetyAudit, appendSecurityEvent, applyDispatchStatusUpdate, assertSignedOperationsPayload, buildHospitalOperationsDashboard, buildImageCloudDashboard, buildImageCloudDerivedRecords, buildImagingCloudProductionResponse, buildObservabilityAlertCenter, buildOhifStudyUrl, buildOperationsInterfaceMappingEvidence, buildOperationsMobileDuty, buildOperationsSiteJointPatrol, buildPerformanceMonitoringEvidence, buildPhysicalExamProductionReadiness, buildProductionOperationsCenter, buildQualitySafetyCoreSystemMatrix, buildQualitySafetyDashboard, buildQualitySafetyInterfaceJointTestPack, buildQualitySafetyInterfaceStandard, buildQualitySafetyIssues, buildRuntimeMetrics, canAccessResident, canAccessSecureAttachment, collectJson, createHash, createImageCloudMutualRecognitionChain, createOperationsMobileDutyReminder, integrationGatewaySecret, integrationPayloadAllowedForInstitution, isProductionRuntime, listOrthancStudySummaries, mergeByKey, normalizeDiagnosticReport, normalizeDispatchAction, normalizeHandoverSignoff, normalizeImageCloudStudy, normalizeOperationSnapshot, normalizeQualitySafetyStatus, normalizeReconciliationBatchItem, normalizeState, patchCollectionItem, personIndexForResident, prependAuditTrailEntry, publishDiagnosticReportToFhir, publishImagingStudyToFhir, qualitySafetySlaState, randomUUID, readDatabase, redactSensitiveResponse, requireApiRole, reviewImageCloudRecognitionAppeal, reviewMutualRecognitionRecord, rowMatchesOrganizationScope, sendDownload, sendJson, sendT10ProductionControlError, solutionAHealth, submitImageCloudRecognitionAppeal, upsertPhase2MutualRecognitionCitation, validateQualitySafetyInterfaceMessage, writeDatabase } = runtime;
  return [
    {
      id: "clinical-specialties-01",
      domain: "clinical-specialties",
      async handle(req, res, url) {
    if (req.method === "GET" && url.pathname === "/api/imaging-cloud/production-center") {
        const user = requireApiRole(req, res, ["commission", "institution"], url.pathname);
        if (!user) return true;
        const center = buildImagingCloudProductionResponse(readDatabase());
        appendSecurityEvent({
          actor: user.name,
          role: user.role,
          action: "imaging-production-center-read",
          target: url.pathname,
          result: "allowed",
          detail: `${center.summary?.blockers || 0} module blockers; platform production gate closed`
        });
        sendJson(res, 200, center);
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/imaging-cloud/production/smoke") {
        const user = requireApiRole(req, res, ["commission", "institution"], url.pathname);
        if (!user) return true;
        const smoke = ImagingCloudProduction.runStandaloneSmoke(readDatabase());
        sendJson(res, 200, {
          ...smoke,
          moduleEvidenceReady: smoke.releaseDecision === "go",
          releaseDecision: "no-go-platform-approval-pending",
          productionReady: false,
          formalGoLiveState: "blocked-until-trusted-site-evidence-and-platform-launch-approval"
        });
        return true;
      }

      const imagingProductionEndpointMatch = url.pathname.match(/^\/api\/imaging-cloud\/production\/endpoints\/([^/]+)\/probe$/);
      const imagingProductionSyntheticMatch = url.pathname.match(/^\/api\/imaging-cloud\/production\/synthetic-checks\/([^/]+)\/actions$/);
      const imagingProductionRequirementMatch = url.pathname.match(/^\/api\/imaging-cloud\/production\/requirements\/([^/]+)\/actions$/);
      const imagingProductionReceiptMatch = url.pathname.match(/^\/api\/imaging-cloud\/production\/receipts\/([^/]+)\/(submit|verify)$/);
      const imagingProductionDrillMatch = url.pathname.match(/^\/api\/imaging-cloud\/production\/drills\/([^/]+)\/complete$/);
      const imagingProductionApprovalMatch = url.pathname.match(/^\/api\/imaging-cloud\/production\/approvals\/([^/]+)\/sign$/);
      if (req.method === "POST" && (
        imagingProductionEndpointMatch
        || imagingProductionSyntheticMatch
        || imagingProductionRequirementMatch
        || imagingProductionReceiptMatch
        || imagingProductionDrillMatch
        || imagingProductionApprovalMatch
      )) {
        const commissionOnly = Boolean(
          (imagingProductionReceiptMatch && imagingProductionReceiptMatch[2] === "verify")
          || imagingProductionApprovalMatch
        );
        const user = requireApiRole(req, res, commissionOnly ? ["commission"] : ["commission", "institution"], url.pathname);
        if (!user) return true;
        const data = readDatabase();
        const payload = await collectJson(req);
        try {
          let item;
          let action;
          if (imagingProductionEndpointMatch) {
            action = "probe-production-endpoint";
            item = ImagingCloudProduction.probeEndpoint(data, user, decodeURIComponent(imagingProductionEndpointMatch[1]), payload);
          } else if (imagingProductionSyntheticMatch) {
            action = "record-synthetic-check";
            item = ImagingCloudProduction.recordSyntheticCheck(data, user, decodeURIComponent(imagingProductionSyntheticMatch[1]), payload);
          } else if (imagingProductionRequirementMatch) {
            action = "govern-site-requirement";
            item = ImagingCloudProduction.signRequirement(data, user, decodeURIComponent(imagingProductionRequirementMatch[1]), payload);
          } else if (imagingProductionReceiptMatch) {
            const type = decodeURIComponent(imagingProductionReceiptMatch[1]);
            action = imagingProductionReceiptMatch[2] === "verify" ? "verify-site-receipt" : "submit-site-receipt";
            item = imagingProductionReceiptMatch[2] === "verify"
              ? ImagingCloudProduction.verifySiteReceipt(data, user, type, payload)
              : ImagingCloudProduction.submitSiteReceipt(data, user, type, payload);
          } else if (imagingProductionDrillMatch) {
            action = "complete-production-drill";
            item = ImagingCloudProduction.completeDrill(data, user, decodeURIComponent(imagingProductionDrillMatch[1]), payload);
          } else {
            action = "sign-module-cutover-approval";
            item = ImagingCloudProduction.signApproval(data, user, decodeURIComponent(imagingProductionApprovalMatch[1]), payload);
          }
          writeDatabase(data);
          appendSecurityEvent({
            actor: user.name,
            role: user.role,
            action: `imaging-production-${action}`,
            target: String(item?.id || item?.type || url.pathname),
            result: "allowed",
            detail: "module evidence updated; platform production gate remains closed"
          });
          sendJson(res, 200, {
            item,
            center: buildImagingCloudProductionResponse(data),
            productionReady: false
          });
        } catch (error) {
          appendSecurityEvent({
            actor: user.name,
            role: user.role,
            action: "imaging-production-control",
            target: url.pathname,
            result: "denied",
            detail: String(error?.message || "control rejected").slice(0, 240)
          });
          sendT10ProductionControlError(res, error);
        }
        return true;
      }
        return false;
      }
    },
    {
      id: "clinical-specialties-02",
      domain: "clinical-specialties",
      async handle(req, res, url) {
    if (req.method === "GET" && url.pathname === "/api/operations/dashboard") {
        const user = requireApiRole(req, res, ["commission"], "/api/operations/dashboard");
        if (!user) return true;
        const data = readDatabase();
        const dashboard = buildHospitalOperationsDashboard(data);
        dashboard.runCenter = buildProductionOperationsCenter(data, { runtimeMetrics: buildRuntimeMetrics(data) });
        dashboard.observability = buildObservabilityAlertCenter(data);
        dashboard.bloodCoordination = { ...BloodEventHub.dashboard(data, user), projections: BloodEventHub.dashboard(data, user).projections.filter((item) => item.consumer === "operations") };
        sendJson(res, 200, dashboard);
        return true;
      }
        return false;
      }
    },
    {
      id: "clinical-specialties-03",
      domain: "clinical-specialties",
      async handle(req, res, url) {
    if (req.method === "GET" && url.pathname === "/api/operations/performance-monitoring") {
        const user = requireApiRole(req, res, ["commission"], "/api/operations/performance-monitoring");
        if (!user) return true;
        const data = readDatabase();
        sendJson(res, 200, buildPerformanceMonitoringEvidence(data, buildHospitalOperationsDashboard(data)));
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/operations/command-chains") {
        const user = requireApiRole(req, res, ["commission"], "/api/operations/command-chains");
        if (!user) return true;
        const dashboard = buildHospitalOperationsDashboard(readDatabase());
        sendJson(res, 200, {
          ok: true,
          generatedAt: dashboard.generatedAt,
          summary: {
            institutions: dashboard.summary.institutions,
            critical: dashboard.commandChains.filter((item) => item.severity === "critical").length,
            warning: dashboard.commandChains.filter((item) => item.severity === "warning").length,
            normal: dashboard.commandChains.filter((item) => item.severity === "normal").length
          },
          commandChains: dashboard.commandChains
        });
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/operations/playbooks") {
        const user = requireApiRole(req, res, ["commission"], "/api/operations/playbooks");
        if (!user) return true;
        const dashboard = buildHospitalOperationsDashboard(readDatabase());
        sendJson(res, 200, {
          ok: true,
          generatedAt: dashboard.generatedAt,
          summary: {
            playbooks: dashboard.playbooks.length,
            active: dashboard.playbooks.filter((item) => item.activeInstitutions > 0).length,
            critical: dashboard.playbooks.filter((item) => item.severity === "critical").length
          },
          playbooks: dashboard.playbooks
        });
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/operations/handover") {
        const user = requireApiRole(req, res, ["commission"], "/api/operations/handover");
        if (!user) return true;
        const dashboard = buildHospitalOperationsDashboard(readDatabase());
        sendJson(res, 200, dashboard.handover);
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/operations/handover/owners") {
        const user = requireApiRole(req, res, ["commission"], "/api/operations/handover/owners");
        if (!user) return true;
        const dashboard = buildHospitalOperationsDashboard(readDatabase());
        sendJson(res, 200, dashboard.handoverOwnerMatrix);
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/operations/handover/signoff") {
        const user = requireApiRole(req, res, ["commission"], "/api/operations/handover/signoff");
        if (!user) return true;
        const payload = await collectJson(req);
        const data = readDatabase();
        const dashboard = buildHospitalOperationsDashboard(data);
        const signoff = normalizeHandoverSignoff(payload, user, dashboard.handover);
        data.operationHandoverSignoffs = [signoff, ...(Array.isArray(data.operationHandoverSignoffs) ? data.operationHandoverSignoffs : [])].slice(0, 120);
        data.platformProcessAudit = [
          {
            process: "医院运行交接签收",
            owner: signoff.signer,
            status: "已签收",
            risk: signoff.criticalCount ? "存在严重或超时交接事项" : "常规交接",
            auditPoint: "核查交接事项、责任组、SLA、下一班关注点和签收人是否留痕。",
            evidence: `operationHandoverSignoffs/${signoff.id}`,
            nextAction: signoff.nextShiftFocus
          },
          ...(Array.isArray(data.platformProcessAudit) ? data.platformProcessAudit : [])
        ].slice(0, 80);
        data.securityEvents = [
          {
            id: randomUUID(),
            at: new Date().toLocaleString("zh-CN", { hour12: false }),
            actor: user.name,
            role: user.role,
            action: "operations-handover-signoff",
            target: signoff.id,
            result: "allowed",
            detail: `${signoff.shift}:${signoff.itemCount}:${signoff.criticalCount}`
          },
          ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
        ].slice(0, 120);
        writeDatabase(data);
        sendJson(res, 201, signoff);
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/operations/interface-mapping") {
        const user = requireApiRole(req, res, ["commission"], "/api/operations/interface-mapping");
        if (!user) return true;
        sendJson(res, 200, buildOperationsInterfaceMappingEvidence(readDatabase()));
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/operations/site-joint-tests") {
        const user = requireApiRole(req, res, ["commission"], "/api/operations/site-joint-tests");
        if (!user) return true;
        const dashboard = buildHospitalOperationsDashboard(readDatabase());
        sendJson(res, 200, dashboard.siteJointTests);
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/operations/site-joint-patrol") {
        const user = requireApiRole(req, res, ["commission"], "/api/operations/site-joint-patrol");
        if (!user) return true;
        const dashboard = buildHospitalOperationsDashboard(readDatabase());
        sendJson(res, 200, dashboard.siteJointPatrol);
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/operations/site-joint-patrol/actions") {
        const user = requireApiRole(req, res, ["commission"], "/api/operations/site-joint-patrol/actions");
        if (!user) return true;
        const payload = await collectJson(req);
        const data = readDatabase();
        const dashboard = buildHospitalOperationsDashboard(data);
        const rows = Array.isArray(dashboard.siteJointPatrol?.rows) ? dashboard.siteJointPatrol.rows : [];
        const patrol = rows.find((item) => item.id === payload.patrolId) || rows[0];
        if (!patrol) {
          sendJson(res, 400, { error: "Bad Request", message: "现场联调巡检项不存在" });
          return true;
        }
        const now = new Date().toISOString();
        const audit = {
          process: "医院运行现场联调巡检",
          owner: patrol.owner || user.name,
          status: String(payload.status || "已巡检").trim(),
          risk: patrol.priority === "高" ? "高优先级联调风险" : "常规联调巡检",
          auditPoint: "核查样例报文、验签日志、回放记录、失败重试和接收端确认。",
          evidence: `${patrol.id}/${now}`,
          nextAction: String(payload.note || patrol.nextAction || "").trim()
        };
        data.platformProcessAudit = [audit, ...(Array.isArray(data.platformProcessAudit) ? data.platformProcessAudit : [])].slice(0, 80);
        data.securityEvents = [
          {
            id: randomUUID(),
            at: new Date().toLocaleString("zh-CN", { hour12: false }),
            actor: user.name,
            role: user.role,
            action: "operations-site-joint-patrol",
            target: patrol.id,
            result: "allowed",
            detail: `${patrol.sourceSystem}:${audit.status}:${patrol.priority}`
          },
          ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
        ].slice(0, 120);
        writeDatabase(data);
        sendJson(res, 201, { audit, siteJointPatrol: buildOperationsSiteJointPatrol({ siteJointTests: dashboard.siteJointTests, snapshots: dashboard.snapshots, dispatchRequests: dashboard.dispatchRequests, reconciliationReviews: dashboard.reconciliationReviews, processAudit: data.platformProcessAudit }) });
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/operations/production-hardening") {
        const user = requireApiRole(req, res, ["commission"], "/api/operations/production-hardening");
        if (!user) return true;
        const dashboard = buildHospitalOperationsDashboard(readDatabase());
        sendJson(res, 200, dashboard.productionHardening);
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/operations/cutover-command") {
        const user = requireApiRole(req, res, ["commission"], "/api/operations/cutover-command");
        if (!user) return true;
        const dashboard = buildHospitalOperationsDashboard(readDatabase());
        sendJson(res, 200, dashboard.cutoverCommand);
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/operations/cutover-command/actions") {
        const user = requireApiRole(req, res, ["commission"], "/api/operations/cutover-command/actions");
        if (!user) return true;
        const payload = await collectJson(req);
        const data = readDatabase();
        const dashboard = buildHospitalOperationsDashboard(data);
        const items = Array.isArray(dashboard.cutoverCommand?.items) ? dashboard.cutoverCommand.items : [];
        const item = items.find((row) => row.id === payload.itemId) || items[0];
        if (!item) {
          sendJson(res, 400, { error: "Bad Request", message: "生产割接签收项不存在" });
          return true;
        }
        const now = new Date().toISOString();
        const audit = {
          process: "医院运行生产割接签收",
          owner: item.owner || user.name,
          status: String(payload.status || "已签收").trim(),
          risk: item.priority === "高" ? "高优先级割接阻断项" : "常规割接复核",
          auditPoint: `${item.name}：${item.detail || ""}`,
          evidence: `${item.checkId}/${now}`,
          nextAction: String(payload.note || item.nextAction || "保持证据归档，并进入上线后观察。").trim()
        };
        data.platformProcessAudit = [audit, ...(Array.isArray(data.platformProcessAudit) ? data.platformProcessAudit : [])].slice(0, 80);
        data.securityEvents = [
          {
            id: randomUUID(),
            at: new Date().toLocaleString("zh-CN", { hour12: false }),
            actor: user.name,
            role: user.role,
            action: "operations-cutover-signoff",
            target: item.id,
            result: "allowed",
            detail: `${item.checkId}:${audit.status}:${item.priority}`
          },
          ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
        ].slice(0, 120);
        writeDatabase(data);
        const refreshed = buildHospitalOperationsDashboard(data);
        sendJson(res, 201, { audit, cutoverCommand: refreshed.cutoverCommand });
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/operations/post-cutover-observation") {
        const user = requireApiRole(req, res, ["commission"], "/api/operations/post-cutover-observation");
        if (!user) return true;
        const dashboard = buildHospitalOperationsDashboard(readDatabase());
        sendJson(res, 200, dashboard.postCutoverObservation);
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/operations/go-live-gates") {
        const user = requireApiRole(req, res, ["commission"], "/api/operations/go-live-gates");
        if (!user) return true;
        const dashboard = buildHospitalOperationsDashboard(readDatabase());
        sendJson(res, 200, dashboard.goLiveGates);
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/operations/go-live-gates/actions") {
        const user = requireApiRole(req, res, ["commission"], "/api/operations/go-live-gates/actions");
        if (!user) return true;
        const payload = await collectJson(req);
        const data = readDatabase();
        const dashboard = buildHospitalOperationsDashboard(data);
        const rows = Array.isArray(dashboard.goLiveGates?.rows) ? dashboard.goLiveGates.rows : [];
        const gate = rows.find((item) => item.id === payload.gateId) || rows[0];
        if (!gate) {
          sendJson(res, 400, { error: "Bad Request", message: "上线前门禁项不存在" });
          return true;
        }
        const now = new Date().toISOString();
        const status = String(payload.status || "已复核").trim();
        const audit = {
          process: "医院运行上线前门禁复核",
          owner: gate.owner || user.name,
          status,
          risk: gate.ready ? "已签收门禁复核" : gate.severity === "高" ? "高优先级门禁待补证" : "常规门禁复核",
          auditPoint: `${gate.name}：${gate.status}`,
          evidence: `goLiveGates/${gate.id}/${now}`,
          nextAction: String(payload.note || gate.nextAction || "继续补齐上线前门禁证据。").trim()
        };
        data.platformProcessAudit = [audit, ...(Array.isArray(data.platformProcessAudit) ? data.platformProcessAudit : [])].slice(0, 80);
        data.securityEvents = [
          {
            id: randomUUID(),
            at: new Date().toLocaleString("zh-CN", { hour12: false }),
            actor: user.name,
            role: user.role,
            action: "operations-go-live-gate-review",
            target: gate.id,
            result: "allowed",
            detail: `${gate.name}:${status}:${gate.severity}`
          },
          ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
        ].slice(0, 120);
        writeDatabase(data);
        const refreshed = buildHospitalOperationsDashboard(data);
        sendJson(res, 201, { audit, goLiveGates: refreshed.goLiveGates });
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/operations/post-cutover-observation/actions") {
        const user = requireApiRole(req, res, ["commission"], "/api/operations/post-cutover-observation/actions");
        if (!user) return true;
        const payload = await collectJson(req);
        const data = readDatabase();
        const dashboard = buildHospitalOperationsDashboard(data);
        const items = Array.isArray(dashboard.postCutoverObservation?.items) ? dashboard.postCutoverObservation.items : [];
        const item = items.find((row) => row.id === payload.itemId) || items[0];
        if (!item) {
          sendJson(res, 400, { error: "Bad Request", message: "上线后观察项不存在" });
          return true;
        }
        const now = new Date().toISOString();
        const audit = {
          process: "医院运行上线后观察",
          owner: item.owner || user.name,
          status: String(payload.status || "已观察").trim(),
          risk: item.priority === "高" ? "上线后异常待处置" : "上线后常规观察",
          auditPoint: `${item.title}：${item.metric || ""}`,
          evidence: `${item.id}/${now}`,
          nextAction: String(payload.note || item.nextAction || "保持观察记录归档，并进入下一观察窗口。").trim()
        };
        data.platformProcessAudit = [audit, ...(Array.isArray(data.platformProcessAudit) ? data.platformProcessAudit : [])].slice(0, 80);
        data.securityEvents = [
          {
            id: randomUUID(),
            at: new Date().toLocaleString("zh-CN", { hour12: false }),
            actor: user.name,
            role: user.role,
            action: "operations-post-cutover-observation",
            target: item.id,
            result: "allowed",
            detail: `${item.title}:${audit.status}:${item.priority}`
          },
          ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
        ].slice(0, 120);
        writeDatabase(data);
        const refreshed = buildHospitalOperationsDashboard(data);
        sendJson(res, 201, { audit, postCutoverObservation: refreshed.postCutoverObservation });
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/operations/intelligence") {
        const user = requireApiRole(req, res, ["commission"], "/api/operations/intelligence");
        if (!user) return true;
        const dashboard = buildHospitalOperationsDashboard(readDatabase());
        sendJson(res, 200, dashboard.intelligence);
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/operations/resource-pool") {
        const user = requireApiRole(req, res, ["commission"], "/api/operations/resource-pool");
        if (!user) return true;
        const dashboard = buildHospitalOperationsDashboard(readDatabase());
        sendJson(res, 200, dashboard.resourcePool);
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/operations/emergency-dispatch-loop") {
        const user = requireApiRole(req, res, ["commission"], "/api/operations/emergency-dispatch-loop");
        if (!user) return true;
        const dashboard = buildHospitalOperationsDashboard(readDatabase());
        sendJson(res, 200, dashboard.emergencyDispatchLoop);
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/operations/emergency-dispatch-loop/actions") {
        const user = requireApiRole(req, res, ["commission"], "/api/operations/emergency-dispatch-loop/actions");
        if (!user) return true;
        const payload = await collectJson(req);
        const data = readDatabase();
        const dashboard = buildHospitalOperationsDashboard(data);
        const rows = Array.isArray(dashboard.emergencyDispatchLoop?.rows) ? dashboard.emergencyDispatchLoop.rows : [];
        const loop = rows.find((item) => item.id === payload.loopId || item.snapshotId === payload.snapshotId) || rows[0];
        if (!loop) {
          sendJson(res, 400, { error: "Bad Request", message: "急诊拥堵调度闭环不存在" });
          return true;
        }
        const now = new Date().toISOString();
        const status = String(payload.status || "triage-confirmed").trim();
        const note = String(payload.note || loop.reviewNote || loop.nextAction || "").trim();
        const current = Array.isArray(data.emergencyDispatchLoops) ? data.emergencyDispatchLoops : [];
        const saved = {
          ...loop,
          status,
          reviewNote: note,
          reviewedAt: now,
          reviewedBy: user.username || user.role,
          auditTrail: [
            ...(Array.isArray(loop.auditTrail) ? loop.auditTrail : []),
            { at: now, actor: user.username || user.role, action: status, note }
          ]
        };
        data.emergencyDispatchLoops = [saved, ...current.filter((item) => item.id !== saved.id && item.snapshotId !== saved.snapshotId)].slice(0, 120);
        data.platformProcessAudit = [
          {
            process: "医院运行急诊拥堵调度闭环",
            owner: loop.owner || user.name,
            status,
            risk: loop.priority === "high" ? "急诊高压待调度" : "急诊拥堵待复核",
            auditPoint: `急诊候诊${loop.pressure?.waitingOver30Min || 0}人，急诊人次${loop.pressure?.emergencyVisits || 0}，关联调度${loop.dispatchIds?.length || 0}单。`,
            evidence: `emergencyDispatchLoops/${saved.id}`,
            nextAction: note
          },
          ...(Array.isArray(data.platformProcessAudit) ? data.platformProcessAudit : [])
        ].slice(0, 80);
        data.securityEvents = [
          {
            id: randomUUID(),
            at: new Date().toLocaleString("zh-CN", { hour12: false }),
            actor: user.name,
            role: user.role,
            action: "operations-emergency-dispatch-loop",
            target: saved.id,
            result: "allowed",
            detail: `${saved.institution}:${status}:${saved.priority}`
          },
          ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
        ].slice(0, 120);
        writeDatabase(data);
        const refreshed = buildHospitalOperationsDashboard(data);
        sendJson(res, 201, { loop: saved, emergencyDispatchLoop: refreshed.emergencyDispatchLoop });
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/operations/mobile-duty") {
        const user = requireApiRole(req, res, ["commission"], "/api/operations/mobile-duty");
        if (!user) return true;
        const dashboard = buildHospitalOperationsDashboard(readDatabase());
        sendJson(res, 200, dashboard.mobileDuty);
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/operations/mobile-duty/actions") {
        const user = requireApiRole(req, res, ["commission"], "/api/operations/mobile-duty/actions");
        if (!user) return true;
        const payload = await collectJson(req);
        const data = readDatabase();
        const dashboard = buildHospitalOperationsDashboard(data);
        const cards = Array.isArray(dashboard.mobileDuty?.cards) ? dashboard.mobileDuty.cards : [];
        const card = cards.find((item) => item.id === payload.cardId) || cards[0];
        if (!card) {
          sendJson(res, 400, { error: "Bad Request", message: "移动值守卡片不存在" });
          return true;
        }
        const message = createOperationsMobileDutyReminder(card, payload, user);
        data.taskMessages = [message, ...(Array.isArray(data.taskMessages) ? data.taskMessages : [])].slice(0, 300);
        data.platformProcessAudit = [
          {
            process: "医院运行移动值守",
            owner: card.owner || user.name,
            status: "已提醒",
            risk: card.priority === "高" ? "高优先级值守事项" : "常规值守事项",
            auditPoint: "核查移动端预警确认、交接签收、调度备注、直报复核提醒和弱网补传。",
            evidence: `taskMessages/${message.id}`,
            nextAction: message.body
          },
          ...(Array.isArray(data.platformProcessAudit) ? data.platformProcessAudit : [])
        ].slice(0, 80);
        data.securityEvents = [
          {
            id: randomUUID(),
            at: new Date().toLocaleString("zh-CN", { hour12: false }),
            actor: user.name,
            role: user.role,
            action: "operations-mobile-duty-reminder",
            target: card.id,
            result: "allowed",
            detail: `${message.targetRole}:${message.channel}:${card.priority}`
          },
          ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
        ].slice(0, 120);
        writeDatabase(data);
        sendJson(res, 201, { message, mobileDuty: buildOperationsMobileDuty({ snapshots: dashboard.snapshots, dispatchRequests: dashboard.dispatchRequests, reconciliationReviews: dashboard.reconciliationReviews, handover: dashboard.handover, taskMessages: data.taskMessages }) });
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/operations/governance-report") {
        const user = requireApiRole(req, res, ["commission"], "/api/operations/governance-report");
        if (!user) return true;
        const dashboard = buildHospitalOperationsDashboard(readDatabase());
        sendJson(res, 200, dashboard.governanceReport);
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/operations/governance-export-package") {
        const user = requireApiRole(req, res, ["commission"], "/api/operations/governance-export-package");
        if (!user) return true;
        const dashboard = buildHospitalOperationsDashboard(readDatabase());
        sendJson(res, 200, dashboard.governanceExportPackage);
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/operations/next-development-research") {
        const user = requireApiRole(req, res, ["commission"], "/api/operations/next-development-research");
        if (!user) return true;
        const dashboard = buildHospitalOperationsDashboard(readDatabase());
        sendJson(res, 200, dashboard.nextDevelopmentResearch);
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/operations/integration/snapshots") {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/operations/integration/snapshots");
        if (!user) return true;
        const payload = await collectJson(req);
        if (!assertSignedOperationsPayload(req, res, payload, user, "operations-snapshots")) return true;
        const rows = Array.isArray(payload.snapshots) ? payload.snapshots : [payload.snapshot || payload];
        if (!rows.length || rows.some((item) => !item || typeof item !== "object" || !item.institutionId || !item.snapshotAt)) {
          sendJson(res, 400, { error: "Bad Request", message: "运行快照必须包含 institutionId 和 snapshotAt" });
          return true;
        }
        if (!rows.every((item) => integrationPayloadAllowedForInstitution(item, user))) {
          sendJson(res, 403, { error: "Forbidden", message: "医疗机构只能上报本机构运行快照" });
          return true;
        }
        const data = readDatabase();
        const rules = Array.isArray(data.operationAlertRules) ? data.operationAlertRules : [];
        const snapshots = rows.map((item) => normalizeOperationSnapshot(item, user, rules));
        const current = Array.isArray(data.hospitalOperationSnapshots) ? data.hospitalOperationSnapshots : [];
        const byId = new Map(current.map((item) => [item.id, item]));
        snapshots.forEach((item) => byId.set(item.id, { ...(byId.get(item.id) || {}), ...item }));
        data.hospitalOperationSnapshots = [...snapshots.map((item) => byId.get(item.id)), ...current.filter((item) => !snapshots.some((snapshot) => snapshot.id === item.id))].slice(0, 300);
        appendOperationsIntegrationAudit(data, user, "operations-snapshot-ingest", `${snapshots.length} snapshots`, `critical=${snapshots.filter((item) => item.normalizedStatus === "critical").length}`);
        writeDatabase(data);
        sendJson(res, 202, {
          ok: true,
          accepted: snapshots.length,
          ids: snapshots.map((item) => item.id),
          critical: snapshots.filter((item) => item.normalizedStatus === "critical").length,
          warning: snapshots.filter((item) => item.normalizedStatus === "warning").length
        });
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/operations/integration/dispatch-feedback") {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/operations/integration/dispatch-feedback");
        if (!user) return true;
        const payload = await collectJson(req);
        if (!assertSignedOperationsPayload(req, res, payload, user, "operations-dispatch-feedback")) return true;
        const dispatchId = String(payload.dispatchId || payload.id || "").trim();
        if (!dispatchId) {
          sendJson(res, 400, { error: "Bad Request", message: "调度回执必须包含 dispatchId" });
          return true;
        }
        const data = readDatabase();
        const index = (data.resourceDispatchRequests || []).findIndex((item) => item.id === dispatchId);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "dispatch request not found" });
          return true;
        }
        const dispatch = data.resourceDispatchRequests[index];
        if (user.role === "institution" && ![dispatch.sourceInstitutionId, dispatch.targetInstitutionId].filter(Boolean).includes(user.orgCode)) {
          sendJson(res, 403, { error: "Forbidden", message: "医疗机构只能反馈本机构相关调度单" });
          return true;
        }
        data.resourceDispatchRequests[index] = {
          ...applyDispatchStatusUpdate(dispatch, payload, user),
          externalReceipt: {
            sourceSystem: String(payload.sourceSystem || "hospital-dispatch-feedback").trim(),
            receiptNo: String(payload.receiptNo || payload.idempotencyKey || "").trim(),
            handledBy: String(payload.handledBy || user.name || user.username).trim(),
            handledAt: String(payload.handledAt || new Date().toISOString()).trim()
          }
        };
        appendOperationsIntegrationAudit(data, user, "operations-dispatch-feedback", dispatchId, data.resourceDispatchRequests[index].status);
        writeDatabase(data);
        sendJson(res, 200, data.resourceDispatchRequests[index]);
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/operations/integration/reconciliation") {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/operations/integration/reconciliation");
        if (!user) return true;
        const payload = await collectJson(req);
        if (!assertSignedOperationsPayload(req, res, payload, user, "operations-reconciliation")) return true;
        const rows = Array.isArray(payload.reconciliations) ? payload.reconciliations : [payload.reconciliation || payload];
        if (!rows.length || rows.some((item) => !item || typeof item !== "object" || !item.institutionId || !item.sourceBatch)) {
          sendJson(res, 400, { error: "Bad Request", message: "统计对账批次必须包含 institutionId 和 sourceBatch" });
          return true;
        }
        if (!rows.every((item) => integrationPayloadAllowedForInstitution(item, user))) {
          sendJson(res, 403, { error: "Forbidden", message: "医疗机构只能上报本机构统计对账数据" });
          return true;
        }
        const data = readDatabase();
        const reviews = rows.map((item) => normalizeReconciliationBatchItem(item, user));
        const current = Array.isArray(data.statisticsReconciliationReviews) ? data.statisticsReconciliationReviews : [];
        const byId = new Map(current.map((item) => [item.id, item]));
        reviews.forEach((item) => byId.set(item.id, { ...(byId.get(item.id) || {}), ...item }));
        data.statisticsReconciliationReviews = [...reviews.map((item) => byId.get(item.id)), ...current.filter((item) => !reviews.some((review) => review.id === item.id))].slice(0, 200);
        appendOperationsIntegrationAudit(data, user, "operations-reconciliation-ingest", `${reviews.length} reviews`, `blocked=${reviews.filter((item) => item.status === "blocked").length}`);
        writeDatabase(data);
        sendJson(res, 202, {
          ok: true,
          accepted: reviews.length,
          ids: reviews.map((item) => item.id),
          blocked: reviews.filter((item) => item.status === "blocked").length
        });
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/operations/dispatch") {
        const user = requireApiRole(req, res, ["commission"], "/api/operations/dispatch");
        if (!user) return true;
        const payload = await collectJson(req);
        const data = readDatabase();
        const request = normalizeDispatchAction(payload, user);
        const existingIndex = (data.resourceDispatchRequests || []).findIndex((item) => item.id === request.id);
        if (existingIndex >= 0) {
          data.resourceDispatchRequests[existingIndex] = { ...data.resourceDispatchRequests[existingIndex], ...request };
        } else {
          data.resourceDispatchRequests = [request, ...(data.resourceDispatchRequests || [])].slice(0, 100);
        }
        data.securityEvents = [
          {
            id: randomUUID(),
            at: new Date().toLocaleString("zh-CN", { hour12: false }),
            actor: user.name,
            role: user.role,
            action: "operations-dispatch",
            target: request.id,
            result: "allowed",
            detail: `${request.resourceType}:${request.quantity}:${request.status}`
          },
          ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
        ].slice(0, 120);
        writeDatabase(data);
        sendJson(res, existingIndex >= 0 ? 200 : 201, request);
        return true;
      }

      const dispatchStatusMatch = url.pathname.match(/^\/api\/operations\/dispatch\/([^/]+)\/status$/);
      if (req.method === "POST" && dispatchStatusMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/operations/dispatch/:id/status");
        if (!user) return true;
        const id = decodeURIComponent(dispatchStatusMatch[1]);
        const payload = await collectJson(req);
        const data = readDatabase();
        const index = (data.resourceDispatchRequests || []).findIndex((item) => item.id === id);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "dispatch request not found" });
          return true;
        }
        data.resourceDispatchRequests[index] = applyDispatchStatusUpdate(data.resourceDispatchRequests[index], payload, user);
        data.securityEvents = [
          {
            id: randomUUID(),
            at: new Date().toLocaleString("zh-CN", { hour12: false }),
            actor: user.name,
            role: user.role,
            action: "operations-dispatch-status",
            target: id,
            result: "allowed",
            detail: data.resourceDispatchRequests[index].status
          },
          ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
        ].slice(0, 120);
        writeDatabase(data);
        sendJson(res, 200, data.resourceDispatchRequests[index]);
        return true;
      }

      const reconciliationReviewMatch = url.pathname.match(/^\/api\/operations\/reconciliation\/([^/]+)\/review$/);
      if (req.method === "POST" && reconciliationReviewMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/operations/reconciliation/:id/review");
        if (!user) return true;
        const id = decodeURIComponent(reconciliationReviewMatch[1]);
        const payload = await collectJson(req);
        const data = readDatabase();
        const index = (data.statisticsReconciliationReviews || []).findIndex((item) => item.id === id);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "reconciliation review not found" });
          return true;
        }
        data.statisticsReconciliationReviews[index] = {
          ...data.statisticsReconciliationReviews[index],
          status: String(payload.status || "approved").trim(),
          reviewedBy: user.username || user.role,
          reviewedAt: new Date().toISOString(),
          reviewNote: String(payload.reviewNote || payload.note || data.statisticsReconciliationReviews[index].reviewNote || "").trim(),
          auditTrail: [
            ...(Array.isArray(data.statisticsReconciliationReviews[index].auditTrail) ? data.statisticsReconciliationReviews[index].auditTrail : []),
            {
              at: new Date().toISOString(),
              actor: user.username || user.role,
              action: "review-status-change",
              note: String(payload.reviewNote || payload.note || payload.status || "reviewed").trim()
            }
          ]
        };
        data.securityEvents = [
          {
            id: randomUUID(),
            at: new Date().toLocaleString("zh-CN", { hour12: false }),
            actor: user.name,
            role: user.role,
            action: "statistics-reconciliation-review",
            target: id,
            result: "allowed",
            detail: data.statisticsReconciliationReviews[index].status
          },
          ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
        ].slice(0, 120);
        writeDatabase(data);
        sendJson(res, 200, data.statisticsReconciliationReviews[index]);
        return true;
      }
        return false;
      }
    },
    {
      id: "clinical-specialties-04",
      domain: "clinical-specialties",
      async handle(req, res, url) {
    if (req.method === "GET" && url.pathname === "/api/emergency/dashboard") {
        const user = requireApiRole(req, res, ["commission", "institution", "citizen"], "/api/emergency/dashboard");
        if (!user) return true;
        const data = readDatabase();
        const bloodCoordination = BloodEventHub.dashboard(data, user);
        sendJson(res, 200, redactSensitiveResponse({ ...EmergencyService.buildDashboard(data, user), bloodCoordination: { ...bloodCoordination, projections: bloodCoordination.projections.filter((item) => item.consumer === "emergency") } }, user));
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/emergency/life-chain/overview") {
        const user = requireApiRole(req, res, ["commission", "institution", "citizen"], "/api/emergency/life-chain/overview");
        if (!user) return true;
        try { sendJson(res, 200, redactSensitiveResponse(EmergencyLifeChain.buildOverview(readDatabase(), user, url.searchParams.get("eventId") || ""), user)); }
        catch (error) { sendJson(res, error.status || 400, { error:error.status === 403 ? "Forbidden" : "Bad Request", message:error.message }); }
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/emergency/life-chain/command-center") {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/emergency/life-chain/command-center");
        if (!user) return true;
        try { sendJson(res, 200, EmergencyLifeChain.buildCommandCenter(readDatabase(), user)); }
        catch (error) { sendJson(res, error.status || 400, { error:error.status === 403 ? "Forbidden" : "Bad Request", message:error.message }); }
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/emergency/life-chain/quality") {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/emergency/life-chain/quality");
        if (!user) return true;
        try { sendJson(res, 200, EmergencyLifeChain.buildQualityDashboard(readDatabase(), user)); }
        catch (error) { sendJson(res, error.status || 400, { error:error.status === 403 ? "Forbidden" : "Bad Request", message:error.message }); }
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/emergency/life-chain/authorizations") {
        const user = requireApiRole(req, res, ["citizen"], "/api/emergency/life-chain/authorizations");
        if (!user) return true;
        try { const data=readDatabase(); const item=EmergencyLifeChain.createAuthorization(data, user, await collectJson(req)); writeDatabase(data); sendJson(res, 201, { ok:true, item }); }
        catch (error) { sendJson(res, error.status || 400, { error:error.status === 403 ? "Forbidden" : "Bad Request", message:error.message }); }
        return true;
      }

      const lifeChainAuthorizationRevokeMatch = url.pathname.match(/^\/api\/emergency\/life-chain\/authorizations\/([^/]+)\/revoke$/);
      if (req.method === "POST" && lifeChainAuthorizationRevokeMatch) {
        const user = requireApiRole(req, res, ["citizen"], "/api/emergency/life-chain/authorizations/:id/revoke");
        if (!user) return true;
        try { const data=readDatabase(); const item=EmergencyLifeChain.revokeAuthorization(data, user, decodeURIComponent(lifeChainAuthorizationRevokeMatch[1]), await collectJson(req)); writeDatabase(data); sendJson(res, 200, { ok:true, item }); }
        catch (error) { sendJson(res, error.status || 400, { error:error.status === 404 ? "Not Found" : error.status === 403 ? "Forbidden" : "Bad Request", message:error.message }); }
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/emergency/life-chain/family-contacts") {
        const user = requireApiRole(req, res, ["citizen"], "/api/emergency/life-chain/family-contacts");
        if (!user) return true;
        try { const data=readDatabase(); const item=EmergencyLifeChain.addFamilyContact(data, user, await collectJson(req)); writeDatabase(data); sendJson(res, 201, { ok:true, item }); }
        catch (error) { sendJson(res, error.status || 400, { error:error.status === 403 ? "Forbidden" : "Bad Request", message:error.message }); }
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/emergency/life-chain/device-sos") {
        const user = requireApiRole(req, res, ["citizen"], "/api/emergency/life-chain/device-sos");
        if (!user) return true;
        try { const data=readDatabase(); const event=EmergencyLifeChain.createAutomaticSos(data, user, await collectJson(req), EmergencyService); const submission=event.automaticSosSubmission || { deduplicated:false, eventId:event.id }; writeDatabase(data); sendJson(res, submission.deduplicated ? 200 : 201, { ok:true, event, submission, callInstruction:submission.deduplicated ? null : { telUri:"tel:120", requiresDeviceConfirmation:true, message:"A pre-authorized device SOS was submitted to the 120 information queue. The device must still obtain native call confirmation for 120." } }); }
        catch (error) { sendJson(res, error.status || 400, { error:error.status === 403 ? "Forbidden" : "Bad Request", message:error.message }); }
        return true;
      }

      const automaticSosCancellationRequestMatch = url.pathname.match(/^\/api\/emergency\/events\/([^/]+)\/automatic-sos-cancellation-request$/);
      if (req.method === "POST" && automaticSosCancellationRequestMatch) {
        const user = requireApiRole(req, res, ["citizen"], "/api/emergency/events/:id/automatic-sos-cancellation-request");
        if (!user) return true;
        try { const data=readDatabase(); const sos=EmergencyLifeChain.requestAutomaticSosCancellation(data, user, decodeURIComponent(automaticSosCancellationRequestMatch[1]), await collectJson(req)); writeDatabase(data); sendJson(res, 200, { ok:true, sos }); }
        catch (error) { sendJson(res, error.status || 400, { error:error.status === 404 ? "Not Found" : error.status === 403 ? "Forbidden" : error.status === 409 ? "Conflict" : "Bad Request", message:error.message }); }
        return true;
      }

      const automaticSosCancellationResolveMatch = url.pathname.match(/^\/api\/emergency\/events\/([^/]+)\/automatic-sos-cancellation-resolve$/);
      if (req.method === "POST" && automaticSosCancellationResolveMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/emergency/events/:id/automatic-sos-cancellation-resolve");
        if (!user) return true;
        try { const data=readDatabase(); const sos=EmergencyLifeChain.resolveAutomaticSosCancellation(data, user, decodeURIComponent(automaticSosCancellationResolveMatch[1]), await collectJson(req)); writeDatabase(data); sendJson(res, 200, { ok:true, sos }); }
        catch (error) { sendJson(res, error.status || 400, { error:error.status === 404 ? "Not Found" : error.status === 403 ? "Forbidden" : error.status === 409 ? "Conflict" : "Bad Request", message:error.message }); }
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/emergency/aed-map") {
        const user = requireApiRole(req, res, ["commission", "institution", "citizen"], "/api/emergency/aed-map");
        if (!user) return true;
        try {
          const item = EmergencyService.buildAedMap(readDatabase(), user, { latitude:url.searchParams.get("latitude"), longitude:url.searchParams.get("longitude"), limit:url.searchParams.get("limit") });
          sendJson(res, 200, redactSensitiveResponse(item, user));
        } catch (error) {
          sendJson(res, error.status || 400, { error:error.status === 403 ? "Forbidden" : "Bad Request", message:error.message });
        }
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/emergency/calls") {
        const user = requireApiRole(req, res, ["citizen"], "/api/emergency/calls");
        if (!user) return true;
        try {
          const data = readDatabase();
          const payload = await collectJson(req);
          const event = EmergencyService.createCall(data, user, payload);
          writeDatabase(data);
          sendJson(res, 201, { ok: true, event, warning: "辅助呼救信息已提交，正式派车必须由120坐席人工确认；危急情况请立即拨打120。" });
        } catch (error) {
          sendJson(res, error.status || 400, { error: error.status === 403 ? "Forbidden" : "Bad Request", message: error.message });
        }
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/emergency/sos") {
        const user = requireApiRole(req, res, ["citizen"], "/api/emergency/sos");
        if (!user) return true;
        try {
          const data = readDatabase();
          const event = EmergencyService.createSosCall(data, user, await collectJson(req));
          EmergencyLifeChain.coordinateEvent(data, user, event, event.sos || {});
          writeDatabase(data);
          sendJson(res, 201, { ok:true, event, callInstruction:{ telUri:"tel:120", requiresDeviceConfirmation:true, message:"SOS information was submitted to the 120 acceptance queue. Confirm the mobile system call to reach 120." } });
        } catch (error) {
          sendJson(res, error.status || 400, { error:error.status === 403 ? "Forbidden" : "Bad Request", message:error.message });
        }
        return true;
      }

      const lifeChainCoordinateMatch = url.pathname.match(/^\/api\/emergency\/events\/([^/]+)\/life-chain\/coordinate$/);
      if (req.method === "POST" && lifeChainCoordinateMatch) {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/emergency/events/:id/life-chain/coordinate");
        if (!user) return true;
        try { const data=readDatabase(); const event=data.emergencyEvents.find((item) => item.id === decodeURIComponent(lifeChainCoordinateMatch[1])); const lifeChain=EmergencyLifeChain.coordinateEvent(data, user, event, await collectJson(req)); writeDatabase(data); sendJson(res, 200, { ok:true, lifeChain }); }
        catch (error) { sendJson(res, error.status || 400, { error:error.status === 404 ? "Not Found" : error.status === 403 ? "Forbidden" : "Bad Request", message:error.message }); }
        return true;
      }

      const greenChannelConfirmMatch = url.pathname.match(/^\/api\/emergency\/events\/([^/]+)\/green-channel\/confirm$/);
      if (req.method === "POST" && greenChannelConfirmMatch) {
        const user = requireApiRole(req, res, ["institution"], "/api/emergency/events/:id/green-channel/confirm");
        if (!user) return true;
        try { const data=readDatabase(); const item=EmergencyLifeChain.confirmGreenChannel(data, user, decodeURIComponent(greenChannelConfirmMatch[1]), await collectJson(req)); writeDatabase(data); sendJson(res, 200, { ok:true, item }); }
        catch (error) { sendJson(res, error.status || 400, { error:error.status === 404 ? "Not Found" : error.status === 403 ? "Forbidden" : "Bad Request", message:error.message }); }
        return true;
      }

      const emergencyEvidencePackageMatch = url.pathname.match(/^\/api\/emergency\/events\/([^/]+)\/evidence-package$/);
      if (req.method === "GET" && emergencyEvidencePackageMatch) {
        const user = requireApiRole(req, res, ["commission", "institution", "citizen"], "/api/emergency/events/:id/evidence-package");
        if (!user) return true;
        try {
          const item = EmergencyService.buildEvidencePackage(readDatabase(), user, decodeURIComponent(emergencyEvidencePackageMatch[1]));
          sendJson(res, 200, redactSensitiveResponse(item, user));
        } catch (error) {
          sendJson(res, error.status || 400, { error: error.status === 404 ? "Not Found" : error.status === 403 ? "Forbidden" : "Bad Request", message: error.message });
        }
        return true;
      }

      const emergencyEvidenceExportMatch = url.pathname.match(/^\/api\/emergency\/events\/([^/]+)\/evidence-package\/export$/);
      if (req.method === "GET" && emergencyEvidenceExportMatch) {
        const user = requireApiRole(req, res, ["commission", "institution", "citizen"], "/api/emergency/events/:id/evidence-package/export");
        if (!user) return true;
        try {
          const evidencePackage = redactSensitiveResponse(EmergencyService.buildEvidencePackage(readDatabase(), user, decodeURIComponent(emergencyEvidenceExportMatch[1])), user);
          const output = EmergencyService.buildEvidenceExport(evidencePackage, url.searchParams.get("format") || "json");
          sendDownload(res, 200, output.body, output.contentType, output.filename);
        } catch (error) {
          sendJson(res, error.status || 400, { error: error.status === 404 ? "Not Found" : error.status === 403 ? "Forbidden" : "Bad Request", message: error.message });
        }
        return true;
      }

      const emergencyCareActionMatch = url.pathname.match(/^\/api\/emergency\/events\/([^/]+)\/actions$/);
      if (req.method === "POST" && emergencyCareActionMatch) {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/emergency/events/:id/actions");
        if (!user) return true;
        try {
          const data = readDatabase();
          const payload = await collectJson(req);
          const event = EmergencyService.applyAction(data, user, decodeURIComponent(emergencyCareActionMatch[1]), payload);
          writeDatabase(data);
          sendJson(res, 200, { ok: true, event, dashboard: EmergencyService.buildDashboard(data, user) });
        } catch (error) {
          sendJson(res, error.status || 400, { error: error.status === 404 ? "Not Found" : error.status === 403 ? "Forbidden" : "Bad Request", message: error.message });
        }
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/emergency/production-center") {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/emergency/production-center");
        if (!user) return true;
        sendJson(res, 200, EmergencyProduction.buildCenter(readDatabase()));
        return true;
      }

      const emergencyEndpointProbeMatch = url.pathname.match(/^\/api\/emergency\/production\/endpoints\/([^/]+)\/probe$/);
      if (req.method === "POST" && emergencyEndpointProbeMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/emergency/production/endpoints/:id/probe");
        if (!user) return true;
        try { const data=readDatabase(); const item=EmergencyProduction.probeEndpoint(data,user,decodeURIComponent(emergencyEndpointProbeMatch[1]),await collectJson(req)); writeDatabase(data); sendJson(res,200,{ok:true,item,center:EmergencyProduction.buildCenter(data)}); }
        catch(error){ sendJson(res,error.status||400,{error:error.status===404?"Not Found":"Bad Request",message:error.message}); }
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/emergency/production/deliveries") {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/emergency/production/deliveries");
        if (!user) return true;
        try { const data=readDatabase(); const result=EmergencyProduction.enqueue(data,user,await collectJson(req)); writeDatabase(data); sendJson(res,result.idempotentReplay?200:201,{ok:true,...result}); }
        catch(error){ sendJson(res,400,{error:"Bad Request",message:error.message}); }
        return true;
      }

      const emergencyDeliveryRetryMatch = url.pathname.match(/^\/api\/emergency\/production\/deliveries\/([^/]+)\/retry$/);
      if (req.method === "POST" && emergencyDeliveryRetryMatch) {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/emergency/production/deliveries/:id/retry");
        if (!user) return true;
        try { const data=readDatabase(); const item=EmergencyProduction.retryDelivery(data,user,decodeURIComponent(emergencyDeliveryRetryMatch[1]),await collectJson(req)); writeDatabase(data); sendJson(res,200,{ok:true,item}); }
        catch(error){ sendJson(res,error.status||400,{error:error.status===404?"Not Found":"Bad Request",message:error.message}); }
        return true;
      }

      const emergencyDrillMatch = url.pathname.match(/^\/api\/emergency\/production\/drills\/([^/]+)\/complete$/);
      if (req.method === "POST" && emergencyDrillMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/emergency/production/drills/:id/complete");
        if (!user) return true;
        try { const data=readDatabase(); const item=EmergencyProduction.completeDrill(data,user,decodeURIComponent(emergencyDrillMatch[1]),await collectJson(req)); writeDatabase(data); sendJson(res,200,{ok:true,item,center:EmergencyProduction.buildCenter(data)}); }
        catch(error){ sendJson(res,error.status||400,{error:error.status===404?"Not Found":"Bad Request",message:error.message}); }
        return true;
      }

      const emergencyRequirementMatch = url.pathname.match(/^\/api\/emergency\/production\/requirements\/([^/]+)\/sign$/);
      if (req.method === "POST" && emergencyRequirementMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/emergency/production/requirements/:id/sign");
        if (!user) return true;
        try { const data=readDatabase(); const item=EmergencyProduction.signRequirement(data,user,decodeURIComponent(emergencyRequirementMatch[1]),await collectJson(req)); writeDatabase(data); sendJson(res,200,{ok:true,item,center:EmergencyProduction.buildCenter(data)}); }
        catch(error){ sendJson(res,error.status||400,{error:error.status===404?"Not Found":"Bad Request",message:error.message}); }
        return true;
      }

      const emergencyQualityMatch = url.pathname.match(/^\/api\/emergency\/production\/quality\/events\/([^/]+)\/validate$/);
      if (req.method === "POST" && emergencyQualityMatch) {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/emergency/production/quality/events/:id/validate"); if (!user) return true;
        try { const data=readDatabase(); const result=EmergencyProduction.validateEvent(data,user,decodeURIComponent(emergencyQualityMatch[1])); writeDatabase(data); sendJson(res,200,{ok:true,result,center:EmergencyProduction.buildCenter(data)}); }
        catch(error){ sendJson(res,error.status||400,{error:error.status===404?"Not Found":"Bad Request",message:error.message}); } return true;
      }

      const emergencyQualityIssueMatch = url.pathname.match(/^\/api\/emergency\/production\/quality\/issues\/([^/]+)\/resolve$/);
      if (req.method === "POST" && emergencyQualityIssueMatch) {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/emergency/production/quality/issues/:id/resolve"); if (!user) return true;
        try { const data=readDatabase(); const item=EmergencyProduction.resolveDataQualityIssue(data,user,decodeURIComponent(emergencyQualityIssueMatch[1]),await collectJson(req)); writeDatabase(data); sendJson(res,200,{ok:true,item,center:EmergencyProduction.buildCenter(data)}); }
        catch(error){ sendJson(res,error.status||400,{error:error.status===404?"Not Found":"Bad Request",message:error.message}); } return true;
      }

      const emergencyAlertMatch = url.pathname.match(/^\/api\/emergency\/production\/alerts\/([^/]+)\/actions$/);
      if (req.method === "POST" && emergencyAlertMatch) {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/emergency/production/alerts/:id/actions"); if (!user) return true;
        try { const data=readDatabase(); const item=EmergencyProduction.applyAlertAction(data,user,decodeURIComponent(emergencyAlertMatch[1]),await collectJson(req)); writeDatabase(data); sendJson(res,200,{ok:true,item,center:EmergencyProduction.buildCenter(data)}); }
        catch(error){ sendJson(res,error.status||400,{error:error.status===404?"Not Found":"Bad Request",message:error.message}); } return true;
      }

      const emergencyApprovalMatch = url.pathname.match(/^\/api\/emergency\/production\/approvals\/([^/]+)\/sign$/);
      if (req.method === "POST" && emergencyApprovalMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/emergency/production/approvals/:id/sign"); if (!user) return true;
        try { const data=readDatabase(); const item=EmergencyProduction.signCutoverApproval(data,user,decodeURIComponent(emergencyApprovalMatch[1]),await collectJson(req)); writeDatabase(data); sendJson(res,200,{ok:true,item,center:EmergencyProduction.buildCenter(data)}); }
        catch(error){ sendJson(res,error.status||400,{error:error.status===404?"Not Found":"Bad Request",message:error.message}); } return true;
      }

      const emergencyHandoffMatch = url.pathname.match(/^\/api\/emergency\/production\/handoffs\/([^/]+)\/accept$/);
      if (req.method === "POST" && emergencyHandoffMatch) { const user=requireApiRole(req,res,["commission","institution"],"/api/emergency/production/handoffs/:id/accept");if(!user)return true;try{const data=readDatabase();const item=EmergencyProduction.acceptProductionHandoff(data,user,decodeURIComponent(emergencyHandoffMatch[1]),await collectJson(req));writeDatabase(data);sendJson(res,200,{ok:true,item,center:EmergencyProduction.buildCenter(data)});}catch(error){sendJson(res,error.status||400,{error:error.status===404?"Not Found":"Bad Request",message:error.message});}return true; }

      const emergencyBriefMatch = url.pathname.match(/^\/api\/emergency\/production\/command-briefs\/([^/]+)\/actions$/);
      if (req.method === "POST" && emergencyBriefMatch) { const user=requireApiRole(req,res,["commission","institution"],"/api/emergency/production/command-briefs/:id/actions");if(!user)return true;try{const data=readDatabase();const item=EmergencyProduction.applyCommandBriefAction(data,user,decodeURIComponent(emergencyBriefMatch[1]),await collectJson(req));writeDatabase(data);sendJson(res,200,{ok:true,item,center:EmergencyProduction.buildCenter(data)});}catch(error){sendJson(res,error.status||400,{error:error.status===404?"Not Found":"Bad Request",message:error.message});}return true; }

      const emergencyObservationMatch = url.pathname.match(/^\/api\/emergency\/production\/observations\/([^/]+)\/record$/);
      if (req.method === "POST" && emergencyObservationMatch) { const user=requireApiRole(req,res,["commission","institution"],"/api/emergency/production/observations/:id/record");if(!user)return true;try{const data=readDatabase();const item=EmergencyProduction.recordObservation(data,user,decodeURIComponent(emergencyObservationMatch[1]),await collectJson(req));writeDatabase(data);sendJson(res,200,{ok:true,item,center:EmergencyProduction.buildCenter(data)});}catch(error){sendJson(res,error.status||400,{error:error.status===404?"Not Found":"Bad Request",message:error.message});}return true; }

      if (req.method === "POST" && url.pathname === "/api/emergency/production/incidents") { const user=requireApiRole(req,res,["commission","institution"],"/api/emergency/production/incidents");if(!user)return true;try{const data=readDatabase();const item=EmergencyProduction.createLaunchIncident(data,user,await collectJson(req));writeDatabase(data);sendJson(res,201,{ok:true,item,center:EmergencyProduction.buildCenter(data)});}catch(error){sendJson(res,400,{error:"Bad Request",message:error.message});}return true; }

      const emergencyIncidentResolveMatch = url.pathname.match(/^\/api\/emergency\/production\/incidents\/([^/]+)\/resolve$/);
      if (req.method === "POST" && emergencyIncidentResolveMatch) { const user=requireApiRole(req,res,["commission","institution"],"/api/emergency/production/incidents/:id/resolve");if(!user)return true;try{const data=readDatabase();const item=EmergencyProduction.resolveLaunchIncident(data,user,decodeURIComponent(emergencyIncidentResolveMatch[1]),await collectJson(req));writeDatabase(data);sendJson(res,200,{ok:true,item,center:EmergencyProduction.buildCenter(data)});}catch(error){sendJson(res,error.status||400,{error:error.status===404?"Not Found":"Bad Request",message:error.message});}return true; }
        return false;
      }
    },
    {
      id: "clinical-specialties-05",
      domain: "clinical-specialties",
      async handle(req, res, url) {
    if (req.method === "GET" && url.pathname === "/api/quality-safety/dashboard") {
        const user = requireApiRole(req, res, ["commission", "institution", "county"], "/api/quality-safety/dashboard");
        if (!user) return true;
        const data = readDatabase();
        const bloodCoordination = BloodEventHub.dashboard(data, user);
        sendJson(res, 200, { ...buildQualitySafetyDashboard(data, user), bloodCoordination: { ...bloodCoordination, projections: bloodCoordination.projections.filter((item) => item.consumer === "quality-safety") } });
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/quality-safety/interface-standard") {
        const user = requireApiRole(req, res, ["commission", "institution", "county"], "/api/quality-safety/interface-standard");
        if (!user) return true;
        sendJson(res, 200, buildQualitySafetyInterfaceStandard({ data: readDatabase() }));
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/quality-safety/interface-joint-test-pack") {
        const user = requireApiRole(req, res, ["commission", "institution", "county"], "/api/quality-safety/interface-joint-test-pack");
        if (!user) return true;
        sendJson(res, 200, buildQualitySafetyInterfaceJointTestPack({ data: readDatabase(), secret: integrationGatewaySecret() }));
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/quality-safety/interface-messages/validate") {
        const user = requireApiRole(req, res, ["commission", "institution", "county"], "/api/quality-safety/interface-messages/validate");
        if (!user) return true;
        const data = readDatabase();
        const payload = await collectJson(req);
        const standard = buildQualitySafetyInterfaceStandard({ data }).standard;
        const result = validateQualitySafetyInterfaceMessage({
          standard,
          interfaceId: payload.interfaceId,
          method: payload.method || "POST",
          path: payload.path,
          headers: payload.headers || {},
          message: payload.message || payload.payload || {},
          previousIdempotencyKeys: Array.isArray(payload.previousIdempotencyKeys) ? payload.previousIdempotencyKeys : [],
          secret: integrationGatewaySecret()
        });
        appendQualitySafetyAudit(data, user, "quality-safety interface message validation", result.interfaceId || String(payload.interfaceId || ""), `${result.status}: ${result.errors.map((item) => item.code).join(",") || "accepted"}`);
        writeDatabase(data);
        sendJson(res, 200, result);
        return true;
      }

      const qualityDispatchMatch = url.pathname.match(/^\/api\/quality-safety\/issues\/([^/]+)\/dispatch$/);
      if (req.method === "POST" && qualityDispatchMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/quality-safety/issues/:id/dispatch");
        if (!user) return true;
        const data = readDatabase();
        const issueId = decodeURIComponent(qualityDispatchMatch[1]);
        const issue = buildQualitySafetyIssues(data).find((item) => item.id === issueId || item.sourceId === issueId);
        if (!issue) {
          sendJson(res, 404, { error: "Not Found", message: "Quality safety issue not found" });
          return true;
        }
        const payload = await collectJson(req);
        const now = new Date().toISOString();
        const order = {
          id: `qro-${randomUUID()}`,
          issueId: issue.id,
          sourceType: issue.type || issue.sourceType || "quality_safety_issue",
          institutionName: String(payload.institutionName || issue.institutionName || issue.owner || "site-pending").trim(),
          ownerRole: String(payload.ownerRole || issue.ownerRole || "institution").trim(),
          owner: String(payload.owner || issue.owner || user.name || "").trim(),
          requirement: String(payload.requirement || issue.description || issue.title || "Complete quality-safety rectification.").trim(),
          status: "dispatched",
          dispatchedAt: now,
          dueAt: String(payload.dueAt || issue.dueAt || "").trim(),
          feedback: [],
          review: [],
          auditTrail: [{ at: now, by: user.username || user.role, action: "dispatch", note: String(payload.comment || "").trim() }]
        };
        data.qualityRectificationOrders = [order, ...(Array.isArray(data.qualityRectificationOrders) ? data.qualityRectificationOrders : [])].slice(0, 300);
        data.qualitySafetyEvents = (Array.isArray(data.qualitySafetyEvents) ? data.qualitySafetyEvents : []).map((item) => item.id === issue.sourceId || item.id === issue.id ? {
          ...item,
          status: "dispatched",
          rectificationOrderId: order.id,
          auditTrail: [{ at: now, by: user.username || user.role, action: "dispatch", note: order.requirement }, ...(item.auditTrail || [])].slice(0, 50)
        } : item);
        appendQualitySafetyAudit(data, user, "quality-safety dispatch", issue.id, order.requirement);
        writeDatabase(data);
        sendJson(res, 201, order);
        return true;
      }

      const qualityFeedbackMatch = url.pathname.match(/^\/api\/quality-safety\/rectifications\/([^/]+)\/feedback$/);
      if (req.method === "POST" && qualityFeedbackMatch) {
        const user = requireApiRole(req, res, ["institution", "county", "commission"], "/api/quality-safety/rectifications/:id/feedback");
        if (!user) return true;
        const data = readDatabase();
        const id = decodeURIComponent(qualityFeedbackMatch[1]);
        const orders = Array.isArray(data.qualityRectificationOrders) ? data.qualityRectificationOrders : [];
        const index = orders.findIndex((item) => item.id === id);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "Quality rectification order not found" });
          return true;
        }
        if (user.role !== "commission" && ![user.role, ""].includes(String(orders[index].ownerRole || ""))) {
          sendJson(res, 403, { error: "Forbidden", message: "Current role cannot submit this rectification feedback" });
          return true;
        }
        const payload = await collectJson(req);
        const now = new Date().toISOString();
        const feedback = {
          at: now,
          by: user.username || user.role,
          byName: user.name,
          content: String(payload.content || payload.feedback || "").trim(),
          attachments: Array.isArray(payload.attachments) ? payload.attachments.map((item) => String(item).trim()).filter(Boolean) : []
        };
        orders[index] = {
          ...orders[index],
          status: "feedback_submitted",
          feedback: [feedback, ...(orders[index].feedback || [])].slice(0, 50),
          auditTrail: [{ at: now, by: user.username || user.role, action: "feedback", note: feedback.content }, ...(orders[index].auditTrail || [])].slice(0, 50)
        };
        data.qualityRectificationOrders = orders;
        appendQualitySafetyAudit(data, user, "quality-safety feedback", id, feedback.content);
        writeDatabase(data);
        sendJson(res, 200, orders[index]);
        return true;
      }

      const qualityReviewMatch = url.pathname.match(/^\/api\/quality-safety\/rectifications\/([^/]+)\/review$/);
      if (req.method === "POST" && qualityReviewMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/quality-safety/rectifications/:id/review");
        if (!user) return true;
        const data = readDatabase();
        const id = decodeURIComponent(qualityReviewMatch[1]);
        const orders = Array.isArray(data.qualityRectificationOrders) ? data.qualityRectificationOrders : [];
        const index = orders.findIndex((item) => item.id === id);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "Quality rectification order not found" });
          return true;
        }
        const payload = await collectJson(req);
        const decision = String(payload.decision || "approved").trim();
        if (!["approved", "returned", "closed"].includes(decision)) {
          sendJson(res, 400, { error: "Bad Request", message: "decision must be approved, returned or closed" });
          return true;
        }
        const now = new Date().toISOString();
        const review = {
          at: now,
          by: user.username || user.role,
          byName: user.name,
          decision,
          comment: String(payload.comment || "").trim()
        };
        const status = decision === "returned" ? "returned" : "closed";
        orders[index] = {
          ...orders[index],
          status,
          review: [review, ...(orders[index].review || [])].slice(0, 50),
          auditTrail: [{ at: now, by: user.username || user.role, action: "review", note: `${decision}: ${review.comment}` }, ...(orders[index].auditTrail || [])].slice(0, 50)
        };
        data.qualityRectificationOrders = orders;
        data.qualitySafetyEvents = (Array.isArray(data.qualitySafetyEvents) ? data.qualitySafetyEvents : []).map((item) => item.id === orders[index].issueId ? {
          ...item,
          status,
          reviewedAt: now,
          reviewedBy: user.username || user.role
        } : item);
        appendQualitySafetyAudit(data, user, "quality-safety review", id, `${decision}: ${review.comment}`);
        writeDatabase(data);
        sendJson(res, 200, orders[index]);
        return true;
      }

      const qualityEscalationMatch = url.pathname.match(/^\/api\/quality-safety\/rectifications\/([^/]+)\/escalate$/);
      if (req.method === "POST" && qualityEscalationMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/quality-safety/rectifications/:id/escalate");
        if (!user) return true;
        const data = readDatabase();
        const id = decodeURIComponent(qualityEscalationMatch[1]);
        const orders = Array.isArray(data.qualityRectificationOrders) ? data.qualityRectificationOrders : [];
        const index = orders.findIndex((item) => item.id === id);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "Quality rectification order not found" });
          return true;
        }
        if (normalizeQualitySafetyStatus(orders[index].status) === "closed") {
          sendJson(res, 400, { error: "Bad Request", message: "Closed rectification orders cannot be escalated" });
          return true;
        }
        const payload = await collectJson(req);
        const now = new Date().toISOString();
        const sla = qualitySafetySlaState(orders[index], new Date(now));
        const escalation = {
          at: now,
          by: user.username || user.role,
          byName: user.name,
          level: String(payload.level || (sla.slaStatus === "overdue" ? "overdue" : "watch")).trim(),
          reason: String(payload.reason || payload.comment || "Manual quality-safety escalation.").trim(),
          slaStatus: sla.slaStatus,
          daysRemaining: sla.daysRemaining
        };
        orders[index] = {
          ...orders[index],
          status: "escalated",
          escalationLevel: escalation.level,
          escalations: [escalation, ...(orders[index].escalations || [])].slice(0, 50),
          auditTrail: [{ at: now, by: user.username || user.role, action: "escalate", note: escalation.reason }, ...(orders[index].auditTrail || [])].slice(0, 50)
        };
        data.qualityRectificationOrders = orders;
        appendQualitySafetyAudit(data, user, "quality-safety escalation", id, `${escalation.level}: ${escalation.reason}`);
        writeDatabase(data);
        sendJson(res, 200, { ...orders[index], ...qualitySafetySlaState(orders[index], new Date(now)) });
        return true;
      }

      const qualityCriticalAckMatch = url.pathname.match(/^\/api\/quality-safety\/critical-values\/([^/]+)\/acknowledge$/);
      if (req.method === "POST" && qualityCriticalAckMatch) {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/quality-safety/critical-values/:id/acknowledge");
        if (!user) return true;
        const data = readDatabase();
        const id = decodeURIComponent(qualityCriticalAckMatch[1]);
        const alerts = Array.isArray(data.criticalValueAlerts) ? data.criticalValueAlerts : [];
        const index = alerts.findIndex((item) => item.id === id);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "Critical value alert not found" });
          return true;
        }
        const payload = await collectJson(req);
        const now = new Date().toISOString();
        const acknowledgement = {
          at: now,
          by: user.username || user.role,
          byName: user.name,
          note: String(payload.note || payload.comment || "Critical value acknowledged.").trim()
        };
        alerts[index] = {
          ...alerts[index],
          status: normalizeQualitySafetyStatus(alerts[index].status) === "closed" ? alerts[index].status : "acknowledged",
          acknowledgedAt: alerts[index].acknowledgedAt || now,
          acknowledgement,
          auditTrail: [{ at: now, by: user.username || user.role, action: "acknowledge", note: acknowledgement.note }, ...(alerts[index].auditTrail || [])].slice(0, 50)
        };
        data.criticalValueAlerts = alerts;
        appendQualitySafetyAudit(data, user, "quality-safety critical value acknowledgement", id, acknowledgement.note);
        writeDatabase(data);
        sendJson(res, 200, { ...alerts[index], normalizedStatus: normalizeQualitySafetyStatus(alerts[index].status), acknowledgementComplete: true, dispositionComplete: Boolean(alerts[index].disposedAt) });
        return true;
      }

      const qualityCriticalDisposeMatch = url.pathname.match(/^\/api\/quality-safety\/critical-values\/([^/]+)\/dispose$/);
      if (req.method === "POST" && qualityCriticalDisposeMatch) {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/quality-safety/critical-values/:id/dispose");
        if (!user) return true;
        const data = readDatabase();
        const id = decodeURIComponent(qualityCriticalDisposeMatch[1]);
        const alerts = Array.isArray(data.criticalValueAlerts) ? data.criticalValueAlerts : [];
        const index = alerts.findIndex((item) => item.id === id);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "Critical value alert not found" });
          return true;
        }
        const payload = await collectJson(req);
        const now = new Date().toISOString();
        const disposition = {
          at: now,
          by: user.username || user.role,
          byName: user.name,
          action: String(payload.action || payload.disposition || "Responsible physician notified and disposition note completed.").trim(),
          outcome: String(payload.outcome || "disposed").trim()
        };
        alerts[index] = {
          ...alerts[index],
          status: "disposed",
          acknowledgedAt: alerts[index].acknowledgedAt || now,
          disposedAt: now,
          disposition,
          action: disposition.action,
          auditTrail: [{ at: now, by: user.username || user.role, action: "dispose", note: disposition.action }, ...(alerts[index].auditTrail || [])].slice(0, 50)
        };
        data.criticalValueAlerts = alerts;
        data.qualitySafetyEvents = (Array.isArray(data.qualitySafetyEvents) ? data.qualitySafetyEvents : []).map((item) => item.id === alerts[index].eventId ? {
          ...item,
          status: "closed",
          auditTrail: [{ at: now, by: user.username || user.role, action: "critical-value-disposition", note: disposition.action }, ...(item.auditTrail || [])].slice(0, 50)
        } : item);
        appendQualitySafetyAudit(data, user, "quality-safety critical value disposition", id, disposition.action);
        writeDatabase(data);
        sendJson(res, 200, { ...alerts[index], normalizedStatus: normalizeQualitySafetyStatus(alerts[index].status), acknowledgementComplete: true, dispositionComplete: true });
        return true;
      }

      const qualityPathwayReviewMatch = url.pathname.match(/^\/api\/quality-safety\/clinical-pathways\/([^/]+)\/review$/);
      if (req.method === "POST" && qualityPathwayReviewMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/quality-safety/clinical-pathways/:id/review");
        if (!user) return true;
        const data = readDatabase();
        const id = decodeURIComponent(qualityPathwayReviewMatch[1]);
        const cases = Array.isArray(data.clinicalPathwayCases) ? data.clinicalPathwayCases : [];
        const index = cases.findIndex((item) => item.id === id);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "Clinical pathway case not found" });
          return true;
        }
        const payload = await collectJson(req);
        const decision = String(payload.decision || "approved").trim();
        if (!["approved", "returned"].includes(decision)) {
          sendJson(res, 400, { error: "Bad Request", message: "decision must be approved or returned" });
          return true;
        }
        const now = new Date().toISOString();
        const review = {
          at: now,
          by: user.username || user.role,
          byName: user.name,
          decision,
          comment: String(payload.comment || "").trim(),
          evidence: Array.isArray(payload.evidence) ? payload.evidence.map((item) => String(item).trim()).filter(Boolean) : []
        };
        const status = decision === "approved" ? "review_passed" : "returned";
        cases[index] = {
          ...cases[index],
          status,
          reviewedAt: now,
          reviewedBy: user.username || user.role,
          reviewTrail: [review, ...(cases[index].reviewTrail || [])].slice(0, 50),
          auditTrail: [{ at: now, by: user.username || user.role, action: "clinical-pathway-review", note: `${decision}: ${review.comment}` }, ...(cases[index].auditTrail || [])].slice(0, 50)
        };
        data.clinicalPathwayCases = cases;
        data.qualitySafetyEvents = (Array.isArray(data.qualitySafetyEvents) ? data.qualitySafetyEvents : []).map((item) => item.id === cases[index].eventId ? {
          ...item,
          status: decision === "approved" ? "closed" : "returned",
          reviewedAt: now,
          reviewedBy: user.username || user.role,
          auditTrail: [{ at: now, by: user.username || user.role, action: "clinical-pathway-review", note: `${decision}: ${review.comment}` }, ...(item.auditTrail || [])].slice(0, 50)
        } : item);
        appendQualitySafetyAudit(data, user, "quality-safety clinical pathway review", id, `${decision}: ${review.comment}`);
        writeDatabase(data);
        sendJson(res, 200, { ...cases[index], normalizedStatus: normalizeQualitySafetyStatus(cases[index].status), reviewComplete: normalizeQualitySafetyStatus(cases[index].status) === "closed" });
        return true;
      }

      const qualitySiteSignoffEvidenceMatch = url.pathname.match(/^\/api\/quality-safety\/site-signoffs\/([^/]+)\/evidence$/);
      if (req.method === "POST" && qualitySiteSignoffEvidenceMatch) {
        const user = requireApiRole(req, res, ["commission", "institution", "county"], "/api/quality-safety/site-signoffs/:id/evidence");
        if (!user) return true;
        const data = readDatabase();
        const id = decodeURIComponent(qualitySiteSignoffEvidenceMatch[1]);
        const signoffs = Array.isArray(data.qualitySafetySiteSignoffs) ? data.qualitySafetySiteSignoffs : [];
        const index = signoffs.findIndex((item) => item.id === id);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "Quality-safety site sign-off item not found" });
          return true;
        }
        const ownerRole = String(signoffs[index].ownerRole || "commission");
        if (user.role !== "commission" && ownerRole !== user.role) {
          appendSecurityEvent({ actor: user.name, role: user.role, action: "访问接口", target: "/api/quality-safety/site-signoffs/:id/evidence", result: "拒绝", detail: `site sign-off ${id} belongs to ${ownerRole}` });
          sendJson(res, 403, { error: "Forbidden", message: "Site sign-off evidence can only be submitted by the owner role or commission" });
          return true;
        }
        const payload = await collectJson(req);
        const evidence = Array.isArray(payload.evidence) ? payload.evidence.map((item) => String(item).trim()).filter(Boolean) : [];
        const note = String(payload.note || payload.comment || "").trim();
        if (evidence.length === 0 && !note) {
          sendJson(res, 400, { error: "Bad Request", message: "evidence or note is required" });
          return true;
        }
        const now = new Date().toISOString();
        const submission = {
          at: now,
          by: user.username || user.role,
          byName: user.name,
          ownerRole,
          note,
          evidence
        };
        signoffs[index] = {
          ...signoffs[index],
          status: "evidence_submitted",
          latestNote: note || signoffs[index].latestNote,
          submittedAt: now,
          submittedBy: user.username || user.role,
          evidence: [...evidence, ...(signoffs[index].evidence || [])].slice(0, 50),
          submissionTrail: [submission, ...(signoffs[index].submissionTrail || [])].slice(0, 50),
          auditTrail: [{ at: now, by: user.username || user.role, action: "site-signoff-evidence", note: note || evidence.join(", ") }, ...(signoffs[index].auditTrail || [])].slice(0, 50)
        };
        data.qualitySafetySiteSignoffs = signoffs;
        appendQualitySafetyAudit(data, user, "quality-safety site signoff evidence", id, note || evidence.join(", "));
        writeDatabase(data);
        sendJson(res, 200, { ...signoffs[index], normalizedStatus: normalizeQualitySafetyStatus(signoffs[index].status), evidenceCount: (signoffs[index].evidence || []).length });
        return true;
      }

      const qualityCoreSystemEvidenceMatch = url.pathname.match(/^\/api\/quality-safety\/core-systems\/([^/]+)\/evidence$/);
      if (req.method === "POST" && qualityCoreSystemEvidenceMatch) {
        const user = requireApiRole(req, res, ["commission", "institution", "county"], "/api/quality-safety/core-systems/:id/evidence");
        if (!user) return true;
        const data = readDatabase();
        const coreSystemId = decodeURIComponent(qualityCoreSystemEvidenceMatch[1]);
        const matrix = buildQualitySafetyCoreSystemMatrix(data);
        const row = matrix.find((item) => item.id === coreSystemId);
        if (!row) {
          sendJson(res, 404, { error: "Not Found", message: "Core safety system item not found" });
          return true;
        }
        const payload = await collectJson(req);
        const evidence = Array.isArray(payload.evidence) ? payload.evidence.map((item) => String(item).trim()).filter(Boolean) : [];
        const note = String(payload.note || payload.comment || "").trim();
        if (!note && evidence.length === 0) {
          sendJson(res, 400, { error: "Bad Request", message: "evidence or note is required" });
          return true;
        }
        const now = new Date().toISOString();
        const submission = {
          id: randomUUID(),
          coreSystemId,
          coreSystemName: row.name,
          at: now,
          by: user.username || user.role,
          byName: user.name,
          role: user.role,
          orgCode: user.orgCode || "",
          orgName: user.orgName || "",
          note,
          evidence
        };
        data.qualitySafetyCoreSystemEvidence = [submission, ...(Array.isArray(data.qualitySafetyCoreSystemEvidence) ? data.qualitySafetyCoreSystemEvidence : [])].slice(0, 300);
        appendQualitySafetyAudit(data, user, "quality-safety core system evidence", coreSystemId, note || evidence.join(", "));
        writeDatabase(data);
        const updated = buildQualitySafetyCoreSystemMatrix(data).find((item) => item.id === coreSystemId);
        sendJson(res, 200, updated);
        return true;
      }

      const qualitySiteSignoffMatch = url.pathname.match(/^\/api\/quality-safety\/site-signoffs\/([^/]+)\/review$/);
      if (req.method === "POST" && qualitySiteSignoffMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/quality-safety/site-signoffs/:id/review");
        if (!user) return true;
        const data = readDatabase();
        const id = decodeURIComponent(qualitySiteSignoffMatch[1]);
        const signoffs = Array.isArray(data.qualitySafetySiteSignoffs) ? data.qualitySafetySiteSignoffs : [];
        const index = signoffs.findIndex((item) => item.id === id);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "Quality-safety site sign-off item not found" });
          return true;
        }
        const payload = await collectJson(req);
        const decision = String(payload.decision || payload.status || "ready_for_joint_test").trim();
        if (!["ready_for_joint_test", "accepted", "returned", "pending_site_confirmation"].includes(decision)) {
          sendJson(res, 400, { error: "Bad Request", message: "decision must be ready_for_joint_test, accepted, returned, or pending_site_confirmation" });
          return true;
        }
        const now = new Date().toISOString();
        const review = {
          at: now,
          by: user.username || user.role,
          byName: user.name,
          decision,
          note: String(payload.note || payload.comment || "").trim(),
          evidence: Array.isArray(payload.evidence) ? payload.evidence.map((item) => String(item).trim()).filter(Boolean) : []
        };
        signoffs[index] = {
          ...signoffs[index],
          status: decision,
          latestNote: review.note || signoffs[index].latestNote,
          reviewedAt: now,
          reviewedBy: user.username || user.role,
          evidence: [...review.evidence, ...(signoffs[index].evidence || [])].slice(0, 50),
          reviewTrail: [review, ...(signoffs[index].reviewTrail || [])].slice(0, 50),
          auditTrail: [{ at: now, by: user.username || user.role, action: "site-signoff-review", note: `${decision}: ${review.note}` }, ...(signoffs[index].auditTrail || [])].slice(0, 50)
        };
        data.qualitySafetySiteSignoffs = signoffs;
        appendQualitySafetyAudit(data, user, "quality-safety site signoff review", id, `${decision}: ${review.note}`);
        writeDatabase(data);
        sendJson(res, 200, { ...signoffs[index], normalizedStatus: normalizeQualitySafetyStatus(signoffs[index].status), evidenceCount: (signoffs[index].evidence || []).length });
        return true;
      }
        return false;
      }
    },
    {
      id: "clinical-specialties-06",
      domain: "clinical-specialties",
      async handle(req, res, url) {
    if (req.method === "GET" && url.pathname === "/api/blood-system") {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/blood-system");
        if (!user) return true;
        const data = readDatabase();
        BloodTransactionService.normalizeTransactionState(data);
        const dashboard = BloodService.buildDashboard(data, user);
        const scoped = (item) => user.role === "commission" || item.institutionCode === user.orgCode || item.destinationInstitution === user.orgCode;
        sendJson(res, 200, {
          ...dashboard,
          testReports: user.role === "commission" ? data.bloodTestReports : [],
          releaseReviews: user.role === "commission" ? data.bloodReleaseReviews : [],
          shipments: data.bloodShipments.filter(scoped),
          safetyIncidents: data.bloodSafetyIncidents.filter(scoped),
          compatibilityTests: user.role === "institution" ? data.compatibilityTests.filter((item) => dashboard.transfusionRequests.some((request) => request.id === item.requestId)) : data.compatibilityTests,
          transfusionEpisodes: data.transfusionEpisodes.filter(scoped)
        });
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/blood-system/master-data") {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/blood-system/master-data");
        if (!user) return true;
        sendJson(res, 200, BloodMasterData.snapshot());
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/blood-system/integration") {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/blood-system/integration");
        if (!user) return true;
        sendJson(res, 200, BloodIntegrationGateway.dashboard(readDatabase()));
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/blood-system/business") {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/blood-system/business");
        if (!user) return true;
        sendJson(res, 200, BloodBusinessService.dashboard(readDatabase(), user));
        return true;
      }

      const bloodBusinessCreateMatch = url.pathname.match(/^\/api\/blood-system\/business\/resources\/([^/]+)$/);
      const bloodBusinessActionMatch = url.pathname.match(/^\/api\/blood-system\/business\/records\/([^/]+)\/actions$/);
      if (req.method === "POST" && (bloodBusinessCreateMatch || bloodBusinessActionMatch)) {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/blood-system/business/actions");
        if (!user) return true;
        const data = readDatabase();
        const payload = await collectJson(req);
        const result = bloodBusinessCreateMatch
          ? BloodBusinessService.create(data, user, decodeURIComponent(bloodBusinessCreateMatch[1]), payload)
          : BloodBusinessService.action(data, user, decodeURIComponent(bloodBusinessActionMatch[1]), payload);
        if (result.status < 500) writeDatabase(data);
        sendJson(res, result.status, result.body);
        return true;
      }

      const bloodIntegrationReceiveMatch = url.pathname.match(/^\/api\/blood-system\/integration\/contracts\/([^/]+)\/receive$/);
      const bloodIntegrationEnqueueMatch = url.pathname.match(/^\/api\/blood-system\/integration\/contracts\/([^/]+)\/enqueue$/);
      const bloodIntegrationRetryMatch = url.pathname.match(/^\/api\/blood-system\/integration\/dead-letters\/([^/]+)\/retry$/);
      if (req.method === "POST" && (bloodIntegrationReceiveMatch || bloodIntegrationEnqueueMatch || bloodIntegrationRetryMatch)) {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/blood-system/integration/actions");
        if (!user) return true;
        const data = readDatabase();
        const payload = await collectJson(req);
        const result = bloodIntegrationReceiveMatch
          ? BloodIntegrationGateway.receive(data, user, decodeURIComponent(bloodIntegrationReceiveMatch[1]), payload)
          : bloodIntegrationEnqueueMatch
            ? BloodIntegrationGateway.enqueue(data, user, decodeURIComponent(bloodIntegrationEnqueueMatch[1]), payload)
            : BloodIntegrationGateway.retry(data, user, decodeURIComponent(bloodIntegrationRetryMatch[1]));
        writeDatabase(data);
        sendJson(res, result.status, result.body);
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/blood-system/transfusion-requests") {
        const user = requireApiRole(req, res, ["institution"], "/api/blood-system/transfusion-requests");
        if (!user) return true;
        const data = readDatabase();
        const result = BloodService.createRequest(data, user, await collectJson(req));
        if (result.status < 400) writeDatabase(data);
        sendJson(res, result.status, result.body);
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/blood-system/specimens/assess") {
        const user = requireApiRole(req, res, ["institution"], "/api/blood-system/specimens/assess");
        if (!user) return true;
        const data = readDatabase();
        const result = BloodService.assessSpecimen(data, user, await collectJson(req));
        writeDatabase(data);
        sendJson(res, result.status, result.body);
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/blood-system/recalls") {
        const user = requireApiRole(req, res, ["commission"], "/api/blood-system/recalls");
        if (!user) return true;
        const data = readDatabase();
        const result = BloodService.createRecall(data, user, await collectJson(req));
        if (result.status < 400) writeDatabase(data);
        sendJson(res, result.status, result.body);
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/blood-system/transfusion-reactions") {
        const user = requireApiRole(req, res, ["institution"], "/api/blood-system/transfusion-reactions");
        if (!user) return true;
        const data = readDatabase();
        const result = BloodService.reportReaction(data, user, await collectJson(req));
        if (result.status < 400) writeDatabase(data);
        sendJson(res, result.status, result.body);
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/blood-system/emergency-allocations") {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/blood-system/emergency-allocations");
        if (!user) return true;
        const data = readDatabase();
        const result = BloodService.createEmergencyAllocation(data, user, await collectJson(req));
        if (result.status < 400) writeDatabase(data);
        sendJson(res, result.status, result.body);
        return true;
      }

      const recallAcknowledgeMatch = url.pathname.match(/^\/api\/blood-system\/recalls\/([^/]+)\/acknowledge$/);
      const recallCloseMatch = url.pathname.match(/^\/api\/blood-system\/recalls\/([^/]+)\/close$/);
      const reactionInvestigateMatch = url.pathname.match(/^\/api\/blood-system\/transfusion-reactions\/([^/]+)\/investigate$/);
      const emergencyActionMatch = url.pathname.match(/^\/api\/blood-system\/emergency-allocations\/([^/]+)\/actions$/);
      const bloodWorkflowMatch = recallAcknowledgeMatch || recallCloseMatch || reactionInvestigateMatch || emergencyActionMatch;
      if (req.method === "POST" && bloodWorkflowMatch) {
        const roles = recallAcknowledgeMatch ? ["institution"] : reactionInvestigateMatch ? ["commission", "institution"] : emergencyActionMatch ? ["commission", "institution"] : ["commission"];
        const user = requireApiRole(req, res, roles, url.pathname);
        if (!user) return true;
        const data = readDatabase();
        const payload = await collectJson(req);
        const id = decodeURIComponent(bloodWorkflowMatch[1]);
        const idempotencyKey = String(req.headers["idempotency-key"] || payload.idempotencyKey || "").trim();
        const result = recallAcknowledgeMatch ? BloodService.acknowledgeRecall(data, user, id, payload, idempotencyKey)
          : recallCloseMatch ? BloodService.closeRecall(data, user, id, payload, idempotencyKey)
            : reactionInvestigateMatch ? BloodService.investigateReaction(data, user, id, payload)
              : BloodService.actEmergencyAllocation(data, user, id, payload);
        if (result.status < 500) writeDatabase(data);
        sendJson(res, result.status, result.body);
        return true;
      }

      const bloodTransactionRoutes = {
        "/api/blood-system/test-reports/sign": { roles: ["commission"], action: BloodTransactionService.signTestReport },
        "/api/blood-system/release-reviews": { roles: ["commission"], action: BloodTransactionService.reviewRelease },
        "/api/blood-system/shipments": { roles: ["commission"], action: BloodTransactionService.createShipment },
        "/api/blood-system/shipments/receive": { roles: ["institution"], action: BloodTransactionService.receiveShipment },
        "/api/blood-system/safety-incidents/cold-chain/review": { roles: ["commission"], action: BloodTransactionService.reviewColdChainIncident },
        "/api/blood-system/compatibility-tests": { roles: ["institution"], action: BloodTransactionService.recordCompatibility },
        "/api/blood-system/transfusions/start": { roles: ["institution"], action: BloodTransactionService.startTransfusion },
        "/api/blood-system/transfusions/complete": { roles: ["institution"], action: BloodTransactionService.completeTransfusion }
      };
      if (req.method === "POST" && bloodTransactionRoutes[url.pathname]) {
        const route = bloodTransactionRoutes[url.pathname];
        const user = requireApiRole(req, res, route.roles, url.pathname);
        if (!user) return true;
        const data = readDatabase();
        const payload = await collectJson(req);
        const idempotencyKey = String(req.headers["idempotency-key"] || payload.idempotencyKey || "").trim();
        const result = route.action(data, user, payload, idempotencyKey);
        writeDatabase(data);
        sendJson(res, result.status, result.body);
        return true;
      }

      const bloodTransitionMatch = url.pathname.match(/^\/api\/blood-system\/blood-units\/([^/]+)\/transition$/);
      if (req.method === "POST" && bloodTransitionMatch) {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/blood-system/blood-units/:id/transition");
        if (!user) return true;
        const data = readDatabase();
        const payload = await collectJson(req);
        const result = BloodService.transitionBloodUnit(data, user, decodeURIComponent(bloodTransitionMatch[1]), String(payload.to || ""), payload.context || {});
        writeDatabase(data);
        sendJson(res, result.status, result.body);
        return true;
      }

      const bloodTraceMatch = url.pathname.match(/^\/api\/blood-system\/trace\/([^/]+)$/);
      if (req.method === "GET" && bloodTraceMatch) {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/blood-system/trace/:code");
        if (!user) return true;
        const result = BloodService.trace(readDatabase(), user, decodeURIComponent(bloodTraceMatch[1]));
        sendJson(res, result.status, result.body);
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/imaging-cloud") {
        const user = requireApiRole(req, res, ["commission", "institution", "county", "citizen"], "/api/imaging-cloud");
        if (!user) return true;
        const data = readDatabase();
        const residentId = url.searchParams.get("residentId") || "";
        if (residentId && !canAccessResident(user, residentId, data)) {
          appendSecurityEvent({ actor: user.name, role: user.role, action: "access imaging cloud", target: residentId, result: "denied", detail: "resident scope denied" });
          sendJson(res, 403, { error: "Forbidden", message: "无权调阅该居民影像云资料" });
          return true;
        }
        if (residentId) {
          appendDataAccessLog(data, user, residentId, "医学影像云", "查询影像检查、报告和电子病历索引");
          writeDatabase(data);
        }
        const dashboard = buildImageCloudDashboard(data, user, {
          residentId,
          institutionCode: url.searchParams.get("institutionCode") || ""
        });
        sendJson(res, 200, redactSensitiveResponse(dashboard, user));
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/imaging-cloud/solution-a/health") {
        const user = requireApiRole(req, res, ["commission", "institution", "county"], "/api/imaging-cloud/solution-a/health");
        if (!user) return true;
        const health = await solutionAHealth();
        appendSecurityEvent({ actor: user.name, role: user.role, action: "probe solution A", target: url.pathname, result: health.ok ? "allowed" : "degraded", detail: `${health.services.filter((item) => item.ok).length}/${health.services.length} services ready` });
        sendJson(res, health.ok ? 200 : 503, health);
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/imaging-cloud/solution-a/studies") {
        const user = requireApiRole(req, res, ["commission", "institution", "county"], "/api/imaging-cloud/solution-a/studies");
        if (!user) return true;
        const studies = await listOrthancStudySummaries();
        appendSecurityEvent({ actor: user.name, role: user.role, action: "list solution A studies", target: url.pathname, result: "allowed", detail: `${studies.length} normalized DICOMweb studies` });
        sendJson(res, 200, { generatedAt: new Date().toISOString(), summary: { studies: studies.length, synthetic: studies.filter((item) => item.synthetic).length }, studies, boundary: "Non-synthetic patient identity is masked; resident linkage requires an explicit governed mapping workflow." });
        return true;
      }

      const solutionAStudyLinkMatch = url.pathname.match(/^\/api\/imaging-cloud\/solution-a\/studies\/([^/]+)\/link$/);
      if (req.method === "POST" && solutionAStudyLinkMatch) {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/imaging-cloud/solution-a/studies/:uid/link");
        if (!user) return true;
        const payload = await collectJson(req);
        const residentId = String(payload.residentId || "").trim();
        const approvalEvidence = String(payload.approvalEvidence || "").trim();
        const data = readDatabase();
        if (!residentId || !canAccessResident(user, residentId, data)) {
          sendJson(res, residentId ? 403 : 400, { error: residentId ? "Forbidden" : "Bad Request", message: residentId ? "无权关联该居民" : "residentId不能为空" });
          return true;
        }
        const studyInstanceUID = decodeURIComponent(solutionAStudyLinkMatch[1]);
        const externalStudy = (await listOrthancStudySummaries()).find((item) => item.studyInstanceUID === studyInstanceUID);
        if (!externalStudy) { sendJson(res, 404, { error: "Not Found", message: "Orthanc中未找到该检查" }); return true; }
        if (!externalStudy.synthetic && approvalEvidence.length < 12) {
          sendJson(res, 409, { error: "Governance Evidence Required", message: "非合成检查必须提供经复核的主索引匹配证据" });
          return true;
        }
        const resident = (data.residents || []).find((item) => item.id === residentId);
        if (!resident) { sendJson(res, 404, { error: "Not Found", message: "未找到居民" }); return true; }
        const existingIndex = (data.imageCloudStudies || []).findIndex((item) => item.studyInstanceUID === studyInstanceUID);
        const now = new Date().toISOString();
        const study = {
          ...(existingIndex >= 0 ? data.imageCloudStudies[existingIndex] : {}),
          id: existingIndex >= 0 ? data.imageCloudStudies[existingIndex].id : `ics-orthanc-${createHash("sha256").update(studyInstanceUID).digest("hex").slice(0, 16)}`,
          residentId, personIndex: personIndexForResident(new Map(data.residents.map((item) => [item.id, item])), residentId),
          institutionCode: String(payload.institutionCode || user.orgCode || "SOLUTION-A"), institutionName: String(payload.institutionName || user.orgName || "方案A试点机构"),
          accessionNumber: externalStudy.accessionNumber || `ORTHANC-${studyInstanceUID.split(".").pop()}`,
          studyInstanceUID, mainIndex: `${String(payload.institutionCode || user.orgCode || "SOLUTION-A")}#${resident.idCard || residentId}#${externalStudy.accessionNumber || studyInstanceUID}`,
          patientName: resident.name, modality: externalStudy.modalities || "OT", bodyPart: externalStudy.studyDescription || "合成影像预览",
          studyDate: externalStudy.studyDate || new Date().toISOString().slice(0, 10), reportConclusion: "方案A外部影像已完成受控索引关联，诊断报告待正式系统回传。",
          seriesCount: 1, imageCount: 1, diagnosticLevel: false, browserLevel: true, uploadMode: "Orthanc DICOMweb",
          uploadStatus: "已入云", integrityCheck: "DICOMweb可检索", qcStatus: "待质控", emrSyncStatus: "待报告审核后写入",
          externalSource: "solution-a-orthanc", synthetic: externalStudy.synthetic, approvalEvidence: externalStudy.synthetic ? "synthetic-test-data" : approvalEvidence,
          viewerUrl: externalStudy.viewerUrl, linkedBy: user.username || user.name, linkedAt: now, updatedAt: now
        };
        let fhirSync;
        try { fhirSync = await publishImagingStudyToFhir(study, resident); }
        catch (error) {
          appendSecurityEvent({ actor: user.name, role: user.role, action: "sync ImagingStudy to FHIR", target: studyInstanceUID, result: "failed", detail: error.message });
          sendJson(res, 502, { error: "FHIR Sync Failed", message: error.message });
          return true;
        }
        study.fhirPatientId = fhirSync.patient.id;
        study.fhirImagingStudyId = fhirSync.imagingStudy.id;
        study.fhirSyncStatus = "synced";
        study.fhirSyncedAt = now;
        if (existingIndex >= 0) data.imageCloudStudies[existingIndex] = study;
        else data.imageCloudStudies = [study, ...(data.imageCloudStudies || [])].slice(0, 500);
        appendDataAccessLog(data, user, residentId, "医学影像云", `关联Orthanc检查 ${study.accessionNumber}`);
        writeDatabase(data);
        sendJson(res, existingIndex >= 0 ? 200 : 201, { study, created: existingIndex < 0, governance: { synthetic: externalStudy.synthetic, evidence: study.approvalEvidence }, fhirSync });
        return true;
      }

      const imagingViewerMatch = url.pathname.match(/^\/api\/imaging-cloud\/studies\/([^/]+)\/viewer$/);
      if (req.method === "GET" && imagingViewerMatch) {
        const user = requireApiRole(req, res, ["commission", "institution", "county", "citizen"], "/api/imaging-cloud/studies/:id/viewer");
        if (!user) return true;
        const data = readDatabase();
        const studyId = decodeURIComponent(imagingViewerMatch[1]);
        const study = (data.imageCloudStudies || []).find((item) => item.id === studyId);
        if (!study) { sendJson(res, 404, { error: "Not Found", message: "未找到影像检查" }); return true; }
        if (!canAccessResident(user, study.residentId, data)) {
          appendSecurityEvent({ actor: user.name, role: user.role, action: "open OHIF viewer", target: studyId, result: "denied", detail: "resident scope denied" });
          sendJson(res, 403, { error: "Forbidden", message: "无权调阅该居民影像" });
          return true;
        }
        const viewerUrl = buildOhifStudyUrl(study.studyInstanceUID);
        appendDataAccessLog(data, user, study.residentId, "医学影像云", `通过OHIF调阅 ${study.accessionNumber}`);
        writeDatabase(data);
        sendJson(res, 200, { studyId, studyInstanceUID: study.studyInstanceUID, viewerUrl, viewer: "OHIF", archive: "Orthanc DICOMweb", expiresAt: null });
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/imaging-cloud/ingest") {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/imaging-cloud/ingest");
        if (!user) return true;
        const data = readDatabase();
        const payload = await collectJson(req);
        let study;
        try {
          study = normalizeImageCloudStudy(payload, user, data);
        } catch (error) {
          if (error.message === "forbidden resident scope") {
            appendSecurityEvent({ actor: user.name, role: user.role, action: "ingest imaging study", target: payload.residentId || "", result: "denied", detail: "resident scope denied" });
            sendJson(res, 403, { error: "Forbidden", message: "无权为该居民接入影像数据" });
            return true;
          }
          sendJson(res, 400, { error: "Bad Request", message: error.message });
          return true;
        }
        const derived = buildImageCloudDerivedRecords(study, user);
        const existingStudyIndex = (data.imageCloudStudies || []).findIndex((item) => item.studyInstanceUID === study.studyInstanceUID || item.id === study.id);
        if (existingStudyIndex >= 0) data.imageCloudStudies[existingStudyIndex] = { ...data.imageCloudStudies[existingStudyIndex], ...study };
        else data.imageCloudStudies = [study, ...(Array.isArray(data.imageCloudStudies) ? data.imageCloudStudies : [])].slice(0, 500);
        data.diagnosticReports = mergeByKey([derived.report], data.diagnosticReports, "id").slice(0, 300);
        data.personalRecords = mergeByKey([derived.personalRecord], data.personalRecords, "id").slice(0, 500);
        appendDataAccessLog(data, user, study.residentId, "医学影像云", `接入 ${study.modality} ${study.accessionNumber}`);
        data.securityEvents = [
          {
            id: randomUUID(),
            at: new Date().toLocaleString("zh-CN", { hour12: false }),
            actor: user.name,
            role: user.role,
            action: "ingest imaging study",
            target: `${study.institutionCode}/${study.accessionNumber}`,
            result: "allowed",
            detail: `${study.uploadMode} / ${study.integrityCheck} / ${study.emrSyncStatus}`
          },
          ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
        ].slice(0, 120);
        writeDatabase(data);
        sendJson(res, existingStudyIndex >= 0 ? 200 : 201, { study, ...derived });
        return true;
      }

      const imagingShareMatch = url.pathname.match(/^\/api\/imaging-cloud\/studies\/([^/]+)\/share$/);
      if (req.method === "POST" && imagingShareMatch) {
        const user = requireApiRole(req, res, ["citizen", "institution", "commission"], "/api/imaging-cloud/studies/:id/share");
        if (!user) return true;
        const data = readDatabase();
        const studyId = decodeURIComponent(imagingShareMatch[1]);
        const study = (data.imageCloudStudies || []).find((item) => item.id === studyId);
        if (!study) {
          sendJson(res, 404, { error: "Not Found", message: "未找到影像云检查" });
          return true;
        }
        if (!canAccessResident(user, study.residentId, data)) {
          appendSecurityEvent({ actor: user.name, role: user.role, action: "share imaging study", target: studyId, result: "denied", detail: "resident scope denied" });
          sendJson(res, 403, { error: "Forbidden", message: "无权分享该居民影像资料" });
          return true;
        }
        const payload = await collectJson(req);
        const days = Math.min(Math.max(Number(payload.validDays || 7), 1), 90);
        const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
        const share = {
          id: `ics-share-${randomUUID()}`,
          studyId,
          residentId: study.residentId,
          token: `IMG-${randomUUID().slice(0, 8).toUpperCase()}`,
          channel: String(payload.channel || "二维码/短信链接").trim(),
          expiresAt,
          scope: String(payload.scope || "影像报告 + 浏览级序列").trim(),
          createdBy: user.username || user.role,
          createdAt: new Date().toISOString(),
          status: "active"
        };
        data.imageCloudShares = [share, ...(Array.isArray(data.imageCloudShares) ? data.imageCloudShares : [])].slice(0, 300);
        appendDataAccessLog(data, user, study.residentId, "医学影像云", `分享影像 ${study.accessionNumber} 至 ${share.channel}`);
        writeDatabase(data);
        sendJson(res, 201, share);
        return true;
      }

      const imagingQcMatch = url.pathname.match(/^\/api\/imaging-cloud\/studies\/([^/]+)\/qc$/);
      if (req.method === "POST" && imagingQcMatch) {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/imaging-cloud/studies/:id/qc");
        if (!user) return true;
        const data = readDatabase();
        const studyId = decodeURIComponent(imagingQcMatch[1]);
        const index = (data.imageCloudStudies || []).findIndex((item) => item.id === studyId);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "未找到影像云检查" });
          return true;
        }
        const payload = await collectJson(req);
        const review = {
          id: `icq-${randomUUID()}`,
          studyId,
          group: String(payload.group || "影像云抽样质控").trim(),
          scanScore: Number(payload.scanScore || 90),
          reportScore: Number(payload.reportScore || 90),
          reviewer: user.name,
          result: String(payload.result || "质控通过").trim(),
          sampledAt: new Date().toISOString(),
          comment: String(payload.comment || "质控记录已回写影像云。").trim()
        };
        const updatedStudy = {
          ...data.imageCloudStudies[index],
          qcStatus: review.result,
          updatedAt: new Date().toISOString(),
          emrSyncStatus: /通过|合格|passed/i.test(review.result) ? "已写入电子病历索引" : data.imageCloudStudies[index].emrSyncStatus
        };
        let fhirReportSync;
        try { fhirReportSync = await publishDiagnosticReportToFhir(updatedStudy, review); }
        catch (error) {
          appendSecurityEvent({ actor: user.name, role: user.role, action: "sync DiagnosticReport to FHIR", target: studyId, result: "failed", detail: error.message });
          sendJson(res, 502, { error: "FHIR DiagnosticReport Sync Failed", message: error.message });
          return true;
        }
        updatedStudy.fhirDiagnosticReportId = fhirReportSync.diagnosticReport.id;
        updatedStudy.fhirReportSyncStatus = "synced";
        updatedStudy.fhirReportSyncedAt = new Date().toISOString();
        data.imageCloudStudies[index] = updatedStudy;
        data.imageCloudQualityReviews = [review, ...(Array.isArray(data.imageCloudQualityReviews) ? data.imageCloudQualityReviews : [])].slice(0, 300);
        writeDatabase(data);
        sendJson(res, 200, { study: data.imageCloudStudies[index], review, fhirReportSync });
        return true;
      }

      const imagingRecognitionMatch = url.pathname.match(/^\/api\/imaging-cloud\/studies\/([^/]+)\/mutual-recognition$/);
      if (req.method === "POST" && imagingRecognitionMatch) {
        const user = requireApiRole(req, res, ["commission", "institution", "county"], "/api/imaging-cloud/studies/:id/mutual-recognition");
        if (!user) return true;
        const data = readDatabase();
        const studyId = decodeURIComponent(imagingRecognitionMatch[1]);
        const studyIndex = (data.imageCloudStudies || []).findIndex((item) => item.id === studyId);
        if (studyIndex < 0) {
          sendJson(res, 404, { error: "Not Found", message: "未找到影像云检查" });
          return true;
        }
        const study = data.imageCloudStudies[studyIndex];
        if (!canAccessResident(user, study.residentId, data)) {
          appendSecurityEvent({ actor: user.name, role: user.role, action: "start imaging mutual recognition", target: studyId, result: "denied", detail: "resident scope denied" });
          sendJson(res, 403, { error: "Forbidden", message: "无权将该居民影像纳入跨机构互认" });
          return true;
        }
        const payload = await collectJson(req);
        const chain = createImageCloudMutualRecognitionChain(data, study, payload, user);
        data.imageCloudStudies[studyIndex] = {
          ...study,
          mutualRecognitionStatus: chain.recognition.status,
          mutualRecognitionRecordId: chain.recognition.id,
          countyCollaborationOrderId: chain.order.id,
          updatedAt: new Date().toISOString()
        };
        appendDataAccessLog(data, user, study.residentId, "医学影像云", `纳入跨机构互认 ${study.accessionNumber} · ${study.mainIndex}`);
        data.securityEvents = [{
          id: randomUUID(),
          at: new Date().toLocaleString("zh-CN", { hour12: false }),
          actor: user.name,
          role: user.role,
          action: "start imaging mutual recognition",
          target: studyId,
          result: "allowed",
          detail: `${chain.order.id} · ${chain.recognition.id} · ${study.mainIndex}`
        }, ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])].slice(0, 120);
        writeDatabase(data);
        sendJson(res, chain.created ? 201 : 200, { ...chain, study: data.imageCloudStudies[studyIndex] });
        return true;
      }

      const imagingRecognitionDecisionMatch = url.pathname.match(/^\/api\/imaging-cloud\/studies\/([^/]+)\/mutual-recognition\/decision$/);
      if (req.method === "POST" && imagingRecognitionDecisionMatch) {
        const user = requireApiRole(req, res, ["commission", "county"], "/api/imaging-cloud/studies/:id/mutual-recognition/decision");
        if (!user) return true;
        const data = readDatabase();
        const studyId = decodeURIComponent(imagingRecognitionDecisionMatch[1]);
        const studyIndex = (data.imageCloudStudies || []).findIndex((item) => item.id === studyId);
        if (studyIndex < 0) {
          sendJson(res, 404, { error: "Not Found", message: "未找到影像云检查" });
          return true;
        }
        const study = data.imageCloudStudies[studyIndex];
        if (!canAccessResident(user, study.residentId, data)) {
          appendSecurityEvent({ actor: user.name, role: user.role, action: "decide imaging mutual recognition", target: studyId, result: "denied", detail: "resident scope denied" });
          sendJson(res, 403, { error: "Forbidden", message: "无权确认该居民影像互认结果" });
          return true;
        }
        const record = (data.countyMutualRecognitionRecords || []).find((item) => item.imageCloudStudyId === studyId);
        if (!record) {
          sendJson(res, 409, { error: "Conflict", message: "请先将影像检查纳入跨机构互认" });
          return true;
        }
        const payload = await collectJson(req);
        let reviewed;
        try {
          reviewed = reviewMutualRecognitionRecord(data, record.id, payload, user);
        } catch (error) {
          sendJson(res, 400, { error: "Bad Request", message: error.message });
          return true;
        }
        const recognized = reviewed.status === "recognized";
        const citation = upsertPhase2MutualRecognitionCitation(data, reviewed, payload, user);
        data.imageCloudStudies[studyIndex] = {
          ...study,
          mutualRecognitionStatus: recognized ? "已互认" : "不予互认",
          mutualRecognitionRecordId: reviewed.id,
          mutualRecognitionReason: reviewed.reviewReasonCode,
          mutualRecognitionReviewedAt: reviewed.reviewedAt,
          updatedAt: new Date().toISOString()
        };
        data.countyCollaborationOrders = (data.countyCollaborationOrders || []).map((item) => item.recognitionRecordId === reviewed.id ? {
          ...item,
          status: recognized ? "已完成互认" : "退回复核",
          result: recognized ? "影像报告已互认，可按授权主索引调阅" : `不予互认：${reviewed.reviewReasonCode}`,
          updatedAt: reviewed.reviewedAt
        } : item);
        appendDataAccessLog(data, user, study.residentId, "医学影像云", `${recognized ? "确认互认" : "拒绝互认"} ${study.accessionNumber} · ${study.mainIndex}`);
        data.securityEvents = [{
          id: randomUUID(),
          at: new Date().toLocaleString("zh-CN", { hour12: false }),
          actor: user.name,
          role: user.role,
          action: "decide imaging mutual recognition",
          target: studyId,
          result: "allowed",
          detail: `${reviewed.status} · ${reviewed.reviewReasonCode} · ${citation?.evidenceHash || "no-citation"}`
        }, ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])].slice(0, 120);
        writeDatabase(data);
        sendJson(res, 200, { study: data.imageCloudStudies[studyIndex], record: reviewed, citation });
        return true;
      }

      const imagingRecognitionAppealMatch = url.pathname.match(/^\/api\/imaging-cloud\/studies\/([^/]+)\/mutual-recognition\/appeal$/);
      if (req.method === "POST" && imagingRecognitionAppealMatch) {
        const user = requireApiRole(req, res, ["institution"], "/api/imaging-cloud/studies/:id/mutual-recognition/appeal");
        if (!user) return true;
        const data = readDatabase();
        const studyId = decodeURIComponent(imagingRecognitionAppealMatch[1]);
        const studyIndex = (data.imageCloudStudies || []).findIndex((item) => item.id === studyId);
        const record = (data.countyMutualRecognitionRecords || []).find((item) => item.imageCloudStudyId === studyId);
        if (studyIndex < 0 || !record) {
          sendJson(res, 404, { error: "Not Found", message: "影像检查或互认记录不存在" });
          return true;
        }
        let result;
        try {
          result = submitImageCloudRecognitionAppeal(data, data.imageCloudStudies[studyIndex], record, await collectJson(req), user);
        } catch (error) {
          sendJson(res, 400, { error: "Bad Request", message: error.message });
          return true;
        }
        data.imageCloudStudies[studyIndex] = {
          ...data.imageCloudStudies[studyIndex],
          mutualRecognitionStatus: "appeal-pending",
          mutualRecognitionReason: result.appeal.reason,
          updatedAt: result.appeal.submittedAt
        };
        data.countyCollaborationOrders = (data.countyCollaborationOrders || []).map((item) => item.recognitionRecordId === record.id ? {
          ...item,
          status: "appeal-pending",
          result: `Appeal evidence pending independent review: ${result.appeal.evidenceRefs.join(", ")}`,
          updatedAt: result.appeal.submittedAt
        } : item);
        data.securityEvents = [{
          id: randomUUID(), at: new Date().toLocaleString("zh-CN", { hour12: false }), actor: user.name, role: user.role,
          action: "submit imaging mutual recognition appeal", target: studyId, result: "allowed",
          detail: `${result.appeal.id} / ${result.appeal.evidenceRefs.join(",")}`
        }, ...(data.securityEvents || [])].slice(0, 120);
        writeDatabase(data);
        sendJson(res, 201, { study: data.imageCloudStudies[studyIndex], ...result });
        return true;
      }

      const imagingRecognitionAppealReviewMatch = url.pathname.match(/^\/api\/imaging-cloud\/studies\/([^/]+)\/mutual-recognition\/appeal\/review$/);
      if (req.method === "POST" && imagingRecognitionAppealReviewMatch) {
        const user = requireApiRole(req, res, ["commission", "county"], "/api/imaging-cloud/studies/:id/mutual-recognition/appeal/review");
        if (!user) return true;
        const data = readDatabase();
        const studyId = decodeURIComponent(imagingRecognitionAppealReviewMatch[1]);
        const studyIndex = (data.imageCloudStudies || []).findIndex((item) => item.id === studyId);
        const record = (data.countyMutualRecognitionRecords || []).find((item) => item.imageCloudStudyId === studyId);
        if (studyIndex < 0 || !record) {
          sendJson(res, 404, { error: "Not Found", message: "影像检查或互认记录不存在" });
          return true;
        }
        let result;
        try {
          result = reviewImageCloudRecognitionAppeal(data, record, await collectJson(req), user);
        } catch (error) {
          sendJson(res, 400, { error: "Bad Request", message: error.message });
          return true;
        }
        const citation = upsertPhase2MutualRecognitionCitation(data, result.record, { reasonCode: result.record.reviewReasonCode }, user);
        data.imageCloudStudies[studyIndex] = {
          ...data.imageCloudStudies[studyIndex],
          mutualRecognitionStatus: result.approved ? "recognized-after-appeal" : "rejected-after-appeal",
          mutualRecognitionReason: result.record.reviewReasonCode || result.appeal.reviewComment,
          mutualRecognitionReviewedAt: result.appeal.reviewedAt,
          updatedAt: result.appeal.reviewedAt
        };
        data.countyCollaborationOrders = (data.countyCollaborationOrders || []).map((item) => item.recognitionRecordId === record.id ? {
          ...item,
          status: result.approved ? "recognized-after-appeal" : "appeal-rejected",
          result: result.approved ? "Mutual recognition approved after independent appeal review" : "Appeal rejected after independent review",
          updatedAt: result.appeal.reviewedAt
        } : item);
        data.securityEvents = [{
          id: randomUUID(), at: new Date().toLocaleString("zh-CN", { hour12: false }), actor: user.name, role: user.role,
          action: "review imaging mutual recognition appeal", target: studyId, result: "allowed",
          detail: `${result.appeal.status} / ${result.appeal.id} / ${citation?.evidenceHash || "no-citation"}`
        }, ...(data.securityEvents || [])].slice(0, 120);
        writeDatabase(data);
        sendJson(res, 200, { study: data.imageCloudStudies[studyIndex], ...result, citation });
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/mutual-recognition/rules") {
        const user = requireApiRole(req, res, ["commission", "institution", "county"], "/api/mutual-recognition/rules");
        if (!user) return true;
        const data = readDatabase();
        sendJson(res, 200, { rules: data.mutualRecognitionRules || [] });
        return true;
      }
        return false;
      }
    },
    {
      id: "clinical-specialties-07",
      domain: "clinical-specialties",
      async handle(req, res, url) {
    if (req.method === "POST" && url.pathname === "/api/mutual-recognition/reports") {
        const user = requireApiRole(req, res, ["commission", "institution", "county"], "/api/mutual-recognition/reports");
        if (!user) return true;
        const data = readDatabase();
        const payload = await collectJson(req);
        let normalized;
        try {
          normalized = normalizeDiagnosticReport(payload, user, data);
        } catch (error) {
          if (error.message === "forbidden resident scope") {
            appendSecurityEvent({ actor: user.name, role: user.role, action: "submit diagnostic report", target: payload.residentId || "", result: "denied", detail: "resident scope denied" });
            sendJson(res, 403, { error: "Forbidden", message: "无权回传该居民报告" });
            return true;
          }
          sendJson(res, 400, { error: "Bad Request", message: error.message });
          return true;
        }
        data.diagnosticReports = [normalized.report, ...(Array.isArray(data.diagnosticReports) ? data.diagnosticReports : [])].slice(0, 300);
        data.countyMutualRecognitionRecords = [normalized.recognition, ...(Array.isArray(data.countyMutualRecognitionRecords) ? data.countyMutualRecognitionRecords : [])].slice(0, 300);
        data.personalRecords = [normalized.personalRecord, ...(Array.isArray(data.personalRecords) ? data.personalRecords : [])].slice(0, 500);
        if (normalized.criticalSignal) {
          data.emergencySignals = [normalized.criticalSignal, ...(Array.isArray(data.emergencySignals) ? data.emergencySignals : [])].slice(0, 200);
        }
        data.securityEvents = prependAuditTrailEntry(data.securityEvents, {
          id: randomUUID(),
          at: new Date().toLocaleString("zh-CN", { hour12: false }),
          actor: user.name,
          role: user.role,
          action: "submit diagnostic report",
          target: `${normalized.report.residentId}/${normalized.report.item}`,
          result: "allowed",
          detail: `${normalized.report.status} · ${normalized.report.ruleId || "no-rule"}${normalized.criticalSignal ? " · critical" : ""}`
        });
        writeDatabase(data);
        sendJson(res, 201, normalized);
        return true;
      }
        return false;
      }
    },
    {
      id: "clinical-specialties-08",
      domain: "clinical-specialties",
      async handle(req, res, url) {
    const mutualRecognitionReviewMatch = url.pathname.match(/^\/api\/mutual-recognition\/records\/([^/]+)\/review$/);
      if (req.method === "POST" && mutualRecognitionReviewMatch) {
        const user = requireApiRole(req, res, ["county", "commission"], "/api/mutual-recognition/records/:id/review");
        if (!user) return true;
        const data = readDatabase();
        const payload = await collectJson(req);
        let reviewed;
        try {
          reviewed = reviewMutualRecognitionRecord(data, decodeURIComponent(mutualRecognitionReviewMatch[1]), payload, user);
        } catch (error) {
          sendJson(res, 400, { error: "Bad Request", message: error.message });
          return true;
        }
        if (!reviewed) {
          sendJson(res, 404, { error: "Not Found", message: "未找到互认记录" });
          return true;
        }
        data.securityEvents = prependAuditTrailEntry(data.securityEvents, {
          id: randomUUID(),
          at: new Date().toLocaleString("zh-CN", { hour12: false }),
          actor: user.name,
          role: user.role,
          action: "review mutual recognition",
          target: reviewed.id,
          result: "allowed",
          detail: `${reviewed.reviewStatus} · ${reviewed.reviewReasonCode}`
        });
        writeDatabase(data);
        sendJson(res, 200, reviewed);
        return true;
      }
        return false;
      }
    },
    {
      id: "clinical-specialties-09",
      domain: "clinical-specialties",
      async handle(req, res, url) {
    if (req.method === "PATCH" && url.pathname.startsWith("/api/emergency-signals/")) {
        const user = requireApiRole(req, res, ["institution", "county", "commission"], "/api/emergency-signals/:id");
        if (!user) return true;
        const result = patchCollectionItem({
          data: readDatabase(),
          collection: "emergencySignals",
          id: decodeURIComponent(url.pathname.replace("/api/emergency-signals/", "")),
          patch: await collectJson(req),
          user,
          action: "更新公卫预警"
        });
        sendJson(res, result.status, result.body);
        return true;
      }
        return false;
      }
    },
    {
      id: "clinical-specialties-10",
      domain: "clinical-specialties",
      async handle(req, res, url) {
    if (req.method === "GET" && url.pathname === "/api/blood-system/innovation") {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/blood-system/innovation");
        if (!user) return true;
        const data = readDatabase();
        sendJson(res, 200, { ...BloodInnovationService.dashboard(data, user, url.searchParams.get("code") || ""), eventHub: BloodEventHub.dashboard(data, user), goLive: BloodGoLiveService.center(data) });
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/blood-system/events") {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/blood-system/events");
        if (!user) return true;
        sendJson(res, 200, BloodEventHub.dashboard(readDatabase(), user));
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/blood-system/go-live") {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/blood-system/go-live"); if (!user) return true;
        sendJson(res, 200, BloodGoLiveService.center(readDatabase())); return true;
      }

      const bloodGoLiveActionMatch = url.pathname.match(/^\/api\/blood-system\/go-live\/(endpoints|requirements|drills|migrations|approvals)\/([^/]+)\/(probe|actions|complete|reconcile|sign)$/);
      if (req.method === "POST" && bloodGoLiveActionMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/blood-system/go-live/actions"); if (!user) return true;
        const data = readDatabase(), payload = await collectJson(req), [,resource,id] = bloodGoLiveActionMatch;
        try {
          const fn = { endpoints: BloodGoLiveService.probe, requirements: BloodGoLiveService.signRequirement, drills: BloodGoLiveService.completeDrill, migrations: BloodGoLiveService.reconcileMigration, approvals: BloodGoLiveService.signApproval }[resource];
          const item = fn(data, user, decodeURIComponent(id), payload); writeDatabase(data); sendJson(res, 200, { ok:true, item, center:BloodGoLiveService.center(data) });
        } catch (error) { sendJson(res, error.status || 400, { error:error.status===404?"Not Found":"Bad Request", message:error.message }); }
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/blood-system/events/publish") {
        const user = requireApiRole(req, res, ["commission"], "/api/blood-system/events/publish");
        if (!user) return true;
        const data = readDatabase();
        const payload = await collectJson(req);
        const result = BloodEventHub.publish(data, user, { correlationId: payload.correlationId || "", failConsumer: payload.failConsumer || "" });
        writeDatabase(data);
        sendJson(res, 200, { ...result, dashboard: BloodEventHub.dashboard(data, user) });
        return true;
      }

      const bloodEventRetryMatch = url.pathname.match(/^\/api\/blood-system\/events\/deliveries\/([^/]+)\/retry$/);
      if (req.method === "POST" && bloodEventRetryMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/blood-system/events/deliveries/:id/retry");
        if (!user) return true;
        const data = readDatabase();
        const result = BloodEventHub.retry(data, user, decodeURIComponent(bloodEventRetryMatch[1]));
        if (result.status < 500) writeDatabase(data);
        sendJson(res, result.status, result.body);
        return true;
      }

      const bloodInnovationMatch = url.pathname.match(/^\/api\/blood-system\/innovation\/([^/]+)\/execute$/);
      if (req.method === "POST" && bloodInnovationMatch) {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/blood-system/innovation/actions");
        if (!user) return true;
        const data = readDatabase();
        const result = BloodInnovationService.execute(data, user, decodeURIComponent(bloodInnovationMatch[1]), await collectJson(req));
        if (result.status < 500) writeDatabase(data);
        sendJson(res, result.status, result.body);
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/physical-exams") {
        const user = requireApiRole(req, res, ["citizen", "institution", "commission"], "/api/physical-exams");
        if (!user) return true;
        const data = readDatabase();
        const residentId = String(url.searchParams.get("residentId") || "").trim();
        const allowedResidentIds = allowedResidentIdsForUser(data, user);
        if (residentId && !allowedResidentIds.has(residentId)) {
          appendSecurityEvent({ actor: user.name, role: user.role, action: "查看体检报告", target: residentId, result: "拒绝", detail: "超出居民授权范围" });
          sendJson(res, 403, { error: "Forbidden", message: "无权查看该居民体检报告" });
          return true;
        }
        const overview = PhysicalExaminationService.buildOverview(data, {
          residentId,
          residentIds: [...allowedResidentIds],
          excludeDemoData: isProductionRuntime()
        });
        overview.readiness = buildPhysicalExamProductionReadiness(data, overview);
        if (!['commission', 'institution'].includes(user.role)) {
          delete overview.jointTests;
          delete overview.gatewayEvents;
          delete overview.specializedIntakes;
          overview.readiness = {
            codeReady: overview.readiness.codeReady,
            quality: overview.readiness.quality,
            blockers: overview.readiness.blockers.length
          };
        }
        if (residentId) {
          appendDataAccessLog(data, user, residentId, "历史体检报告", "同步查看居民健康档案中的体检报告");
          writeDatabase(data);
        }
        sendJson(res, 200, redactSensitiveResponse(overview, user));
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/physical-exams/highlights/actions") {
        const user = requireApiRole(req, res, ["citizen", "institution", "commission"], "/api/physical-exams/highlights/actions");
        if (!user) return true;
        const payload = await collectJson(req);
        const data = readDatabase();
        const residentId = String(payload.residentId || "").trim();
        try {
          const result = PhysicalExaminationService.applyHighlightAction(data, payload, {
            id: `pe-highlight-${randomUUID()}`,
            actor: user.username || user.role,
            now: new Date().toISOString(),
            canAccessResident: (targetResidentId) => canAccessResident(user, targetResidentId, data)
          });
          appendDataAccessLog(data, user, residentId, "体检创新服务", `${payload.action} · ${result.type}`);
          data.securityEvents = [{ id: randomUUID(), at: new Date().toLocaleString("zh-CN", { hour12: false }), actor: user.name, role: user.role, action: "体检创新服务", target: residentId, result: "允许", detail: `${payload.action} · ${result.type}` }, ...(data.securityEvents || [])].slice(0, 120);
          writeDatabase(normalizeState(data));
          const overview = PhysicalExaminationService.buildOverview(data, { residentId, residentIds: [...allowedResidentIdsForUser(data, user)], excludeDemoData: isProductionRuntime() });
          sendJson(res, 200, redactSensitiveResponse({ ok: true, result, highlights: overview.highlights }, user));
        } catch (error) {
          const status = Number(error?.statusCode || 400);
          appendSecurityEvent({ actor: user.name, role: user.role, action: "体检创新服务", target: residentId || "unknown", result: "拒绝", detail: error.message });
          sendJson(res, status, { error: status === 403 ? "Forbidden" : "Bad Request", message: error.message });
        }
        return true;
      }

      const physicalExamCaseActionMatch = url.pathname.match(/^\/api\/physical-exams\/abnormal-cases\/([^/]+)\/actions$/);
      if (req.method === "POST" && physicalExamCaseActionMatch) {
        const user = requireApiRole(req, res, ["institution", "commission"], "/api/physical-exams/abnormal-cases/:id/actions");
        if (!user) return true;
        const payload = await collectJson(req);
        const data = readDatabase();
        const caseId = decodeURIComponent(physicalExamCaseActionMatch[1]);
        const current = (data.physicalExamAbnormalCases || []).find((item) => item.id === caseId);
        if (!current) {
          sendJson(res, 404, { error: "Not Found", message: "未找到体检异常处置记录" });
          return true;
        }
        if (!canAccessResident(user, current.residentId, data)) {
          sendJson(res, 403, { error: "Forbidden", message: "无权处置该居民体检异常" });
          return true;
        }
        try {
          const abnormalCase = PhysicalExaminationService.applyAbnormalCaseAction(data, caseId, payload, { actor: user.username || user.role });
          if (String(payload.action || "").toLowerCase() === "notify") {
            data.taskMessages = [{
              id: `msg-${randomUUID()}`,
              taskId: `physicalExamAbnormalCases:${abnormalCase.id}`,
              collection: "physicalExamAbnormalCases",
              sourceId: abnormalCase.id,
              residentId: abnormalCase.residentId,
              targetRole: "citizen",
              channel: "in_app",
              notificationEvent: "physical-exam-abnormal-notice",
              deliveryChannels: ["in_app", "sms"],
              title: "体检异常项目随访提醒",
              body: abnormalCase.latestAction,
              status: "sent",
              receipts: [{ at: new Date().toISOString(), status: "delivered", channel: "in_app" }],
              createdAt: new Date().toISOString(),
              createdBy: user.username || user.role,
              createdByName: user.name
            }, ...(Array.isArray(data.taskMessages) ? data.taskMessages : [])].slice(0, 300);
          }
          appendDataAccessLog(data, user, abnormalCase.residentId, "体检异常闭环", `${payload.action} · ${abnormalCase.latestAction}`);
          data.securityEvents = [{ id: randomUUID(), at: new Date().toLocaleString("zh-CN", { hour12: false }), actor: user.name, role: user.role, action: "体检异常处置", target: caseId, result: "允许", detail: `${payload.action} · ${abnormalCase.status}` }, ...(data.securityEvents || [])].slice(0, 120);
          writeDatabase(normalizeState(data));
          const overview = PhysicalExaminationService.buildOverview(data, { residentIds: [...allowedResidentIdsForUser(data, user)], excludeDemoData: isProductionRuntime() });
          sendJson(res, 200, { abnormalCase, overview });
        } catch (error) {
          const status = Number(error?.statusCode || 400);
          sendJson(res, status, { error: status === 409 ? "Conflict" : "Bad Request", message: error.message });
        }
        return true;
      }

      const physicalExamSpecializedActionMatch = url.pathname.match(/^\/api\/physical-exams\/specialized-intakes\/([^/]+)\/actions$/);
      if (req.method === "POST" && physicalExamSpecializedActionMatch) {
        const user = requireApiRole(req, res, ["institution", "commission"], "/api/physical-exams/specialized-intakes/:id/actions");
        if (!user) return true;
        const payload = await collectJson(req);
        const data = readDatabase();
        const intakeId = decodeURIComponent(physicalExamSpecializedActionMatch[1]);
        const current = (data.physicalExamSpecializedIntakes || []).find((item) => item.id === intakeId);
        if (current && !canAccessResident(user, current.residentId, data)) {
          sendJson(res, 403, { error: "Forbidden", message: "无权处置该专项体检分流记录" });
          return true;
        }
        try {
          const intake = PhysicalExaminationService.applySpecializedIntakeAction(data, intakeId, payload, { actor: user.username || user.role, now: new Date().toISOString() });
          appendDataAccessLog(data, user, intake.residentId, "专项体检分流处置", `${intake.examProgramName} · ${payload.action}`);
          appendSecurityEvent({ actor: user.name, role: user.role, action: "专项体检分流处置", target: intake.id, result: "成功", detail: `${payload.action} · ${payload.evidenceRef}` });
          writeDatabase(normalizeState(data));
          sendJson(res, 200, { ok: true, intake });
        } catch (error) {
          const status = Number(error?.statusCode || 400);
          sendJson(res, status, { error: status === 404 ? "Not Found" : status === 409 ? "Conflict" : "Bad Request", message: error.message });
        }
        return true;
      }

      const physicalExamJointTestActionMatch = url.pathname.match(/^\/api\/physical-exams\/joint-tests\/([^/]+)\/actions$/);
      if (req.method === "POST" && physicalExamJointTestActionMatch) {
        const user = requireApiRole(req, res, ["institution", "commission"], "/api/physical-exams/joint-tests/:id/actions");
        if (!user) return true;
        const payload = await collectJson(req);
        const data = readDatabase();
        const jointTestId = decodeURIComponent(physicalExamJointTestActionMatch[1]);
        const current = (data.physicalExamJointTests || []).find((item) => item.id === jointTestId);
        if (!current) {
          sendJson(res, 404, { error: "Not Found", message: "未找到体检机构联调记录" });
          return true;
        }
        if (user.role === "institution" && !rowMatchesOrganizationScope(data, user, current)) {
          sendJson(res, 403, { error: "Forbidden", message: "只能维护本机构的现场联调记录" });
          return true;
        }
        try {
          const jointTest = PhysicalExaminationService.applyJointTestAction(data, jointTestId, payload, { actor: user.username || user.role, role: user.role });
          data.securityEvents = [{ id: randomUUID(), at: new Date().toLocaleString("zh-CN", { hour12: false }), actor: user.name, role: user.role, action: "体检机构联调验收", target: jointTestId, result: "允许", detail: `${payload.action} · ${payload.evidenceRef || ""}` }, ...(data.securityEvents || [])].slice(0, 120);
          writeDatabase(normalizeState(data));
          const overview = PhysicalExaminationService.buildOverview(data, { residentIds: [...allowedResidentIdsForUser(data, user)], excludeDemoData: isProductionRuntime() });
          sendJson(res, 200, { jointTest, readiness: buildPhysicalExamProductionReadiness(data, overview) });
        } catch (error) {
          const status = Number(error?.statusCode || 400);
          sendJson(res, status, { error: status === 409 ? "Conflict" : status === 404 ? "Not Found" : "Bad Request", message: error.message });
        }
        return true;
      }

      const physicalExamAttachmentMatch = url.pathname.match(/^\/api\/physical-exams\/([^/]+)\/link-attachment$/);
      if (req.method === "POST" && physicalExamAttachmentMatch) {
        const user = requireApiRole(req, res, ["institution", "commission"], "/api/physical-exams/:id/link-attachment");
        if (!user) return true;
        const payload = await collectJson(req);
        const data = readDatabase();
        const reportId = decodeURIComponent(physicalExamAttachmentMatch[1]);
        const report = (data.personalRecords || []).find((item) => item.id === reportId);
        const attachment = (data.secureAttachments || []).find((item) => item.id === String(payload.attachmentId || ""));
        if (!report || !PhysicalExaminationService.isPhysicalExamRecord(report)) {
          sendJson(res, 404, { error: "Not Found", message: "未找到体检报告" });
          return true;
        }
        if (!attachment) {
          sendJson(res, 404, { error: "Not Found", message: "未找到原报告安全附件" });
          return true;
        }
        if (!canAccessResident(user, report.residentId, data) || !canAccessSecureAttachment(user, attachment, data)) {
          sendJson(res, 403, { error: "Forbidden", message: "无权关联该报告或附件" });
          return true;
        }
        try {
          PhysicalExaminationService.linkSecureAttachment(report, attachment, { actor: user.username || user.role });
          appendDataAccessLog(data, user, report.residentId, "体检原报告归档", `${report.id} · ${attachment.id}`);
          writeDatabase(normalizeState(data));
          sendJson(res, 200, { report, attachment: { id: attachment.id, filename: attachment.filename, status: attachment.status, scanStatus: attachment.scanStatus } });
        } catch (error) {
          const status = Number(error?.statusCode || 400);
          sendJson(res, status, { error: status === 409 ? "Conflict" : "Bad Request", message: error.message });
        }
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/physical-exams/import") {
        const user = requireApiRole(req, res, ["institution", "commission"], "/api/physical-exams/import");
        if (!user) return true;
        const payload = await collectJson(req);
        const data = readDatabase();
        try {
          const result = PhysicalExaminationService.ingest(data, payload, {
            actor: user.username || user.role,
            actorName: user.name,
            requireStandards: String(process.env.NODE_ENV || "").toLowerCase() === "production",
            canAccessResident: (residentId) => canAccessResident(user, residentId, data)
          });
          result.created.forEach((record) => {
            appendDataAccessLog(data, user, record.residentId, "体检报告接入", `${record.source} · ${record.meta?.reportNo || record.meta?.externalId}`);
          });
          result.routed.forEach((record) => {
            appendDataAccessLog(data, user, record.residentId, "专项体检自动分流", `${record.examProgramName} · ${record.externalId}`);
          });
          writeDatabase(normalizeState(data));
          sendJson(res, result.created.length || result.routed.length ? 201 : 200, redactSensitiveResponse({
            ok: true,
            imported: result.created.length,
            duplicates: result.duplicates.length,
            routed: result.routed.length,
            routedDuplicates: result.routedDuplicates.length,
            total: result.total,
            records: result.created,
            duplicateRecords: result.duplicates,
            specializedIntakes: result.routed,
            specializedDuplicateRecords: result.routedDuplicates
          }, user));
        } catch (error) {
          const status = Number(error?.statusCode || 400);
          appendSecurityEvent({ actor: user.name, role: user.role, action: "导入体检报告", target: payload?.residentId || "batch", result: "拒绝", detail: error.message });
          sendJson(res, status, { error: status === 403 ? "Forbidden" : "Bad Request", message: error.message });
        }
        return true;
      }
        return false;
      }
    },
  ];
}

module.exports = { createRouteSegments };
