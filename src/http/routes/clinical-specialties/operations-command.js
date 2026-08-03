"use strict";

function createRouteSegment(runtime) {
  const { BloodBusinessService, BloodEventHub, BloodGoLiveService, BloodInnovationService, BloodIntegrationGateway, BloodMasterData, BloodService, BloodTransactionService, EmergencyLifeChain, EmergencyProduction, EmergencyService, ImagingCloudProduction, PhysicalExaminationService, allowedResidentIdsForUser, appendDataAccessLog, appendOperationsIntegrationAudit, appendQualitySafetyAudit, appendSecurityEvent, applyDispatchStatusUpdate, assertSignedOperationsPayload, buildHospitalOperationsDashboard, buildImageCloudDashboard, buildImageCloudDerivedRecords, buildImagingCloudProductionResponse, buildObservabilityAlertCenter, buildOhifStudyUrl, buildOperationsInterfaceMappingEvidence, buildOperationsMobileDuty, buildOperationsSiteJointPatrol, buildPerformanceMonitoringEvidence, buildPhysicalExamProductionReadiness, buildProductionOperationsCenter, buildQualitySafetyCoreSystemMatrix, buildQualitySafetyDashboard, buildQualitySafetyInterfaceJointTestPack, buildQualitySafetyInterfaceStandard, buildQualitySafetyIssues, buildRuntimeMetrics, canAccessResident, canAccessSecureAttachment, collectJson, createHash, createImageCloudMutualRecognitionChain, createOperationsMobileDutyReminder, integrationGatewaySecret, integrationPayloadAllowedForInstitution, isProductionRuntime, listOrthancStudySummaries, mergeByKey, normalizeDiagnosticReport, normalizeDispatchAction, normalizeHandoverSignoff, normalizeImageCloudStudy, normalizeOperationSnapshot, normalizeQualitySafetyStatus, normalizeReconciliationBatchItem, normalizeState, patchCollectionItem, personIndexForResident, prependAuditTrailEntry, publishDiagnosticReportToFhir, publishImagingStudyToFhir, qualitySafetySlaState, randomUUID, readDatabase, redactSensitiveResponse, requireApiRole, reviewImageCloudRecognitionAppeal, reviewMutualRecognitionRecord, rowMatchesOrganizationScope, sendDownload, sendJson, sendT10ProductionControlError, solutionAHealth, submitImageCloudRecognitionAppeal, upsertPhase2MutualRecognitionCitation, validateQualitySafetyInterfaceMessage, writeDatabase } = runtime;
  return {
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
    };
}

module.exports = { createRouteSegment, ROUTE_SEGMENT_ID: "clinical-specialties-03", SUBDOMAIN: "operations-command" };
