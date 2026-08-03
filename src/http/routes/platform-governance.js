"use strict";

function createRouteSegments(runtime) {
  const { POSTGRES_PRIMARY_READ_MODE, POSTGRES_SYNC_MODE, SQLITE_FILE, advanceDigitalHospitalPublicHealthIncident, allowedResidentIdsForUser, appendSecurityEvent, applyCommercialCryptoAction, applyGovernanceResultToData, applyPlatformCapabilityReviewAction, applyPlatformProductionBlockerAction, applyPostgresReconciliationCaseAction, applyProductionDatabaseCutoverAction, applyProductionOperationsAction, authorizeDigitalHospitalPublicHealthHospital, buildCapabilityMap, buildCommercialCryptoCenter, buildDigitalHospitalControlMatrixBoard, buildDigitalHospitalEvaluationCatalog, buildDigitalHospitalLaunchCommandBriefBoard, buildDigitalHospitalLaunchReadiness, buildDigitalHospitalPilotBoard, buildDigitalHospitalPolicyRegisterBoard, buildDigitalHospitalProductionEvidenceBoard, buildDigitalHospitalPublicHealthBoard, buildDigitalHospitalSecurityCenter, buildDigitalHospitalSelfAssessmentBoard, buildDigitalHospitalStandardsOverview, buildGovernanceCatalog, buildGovernanceRuntimeState, buildPhase2CatalogOverview, buildPhase2ClinicalAssistOverview, buildPhase2DiseaseReportingOverview, buildPhase2FamilyDoctorContractFromApplication, buildPhase2FamilyDoctorOverview, buildPhase2JointTestPilotOverview, buildPhase2MutualRecognitionOverview, buildPlatformBlockerRegister, buildPlatformCapabilityOperationsCenter, buildPlatformGoLiveSlices, buildPlatformServiceOrderCenter, buildPlatformStandardsLedgerDetail, buildPlatformStandardsLedgers, buildPostgresProductionAdapterConfig, buildProcessAuditReport, buildProductionDatabaseCutoverCenter, buildProductionOperationsCenter, buildProductionReleaseEvidencePublicSummary, buildProductionSecurityAcceptanceCenter, buildReleaseArtifactManifest, buildReleaseReport, buildRuntimeMetrics, buildRuntimeProductionGoNoGoCenter, buildSiteLaunchEvidenceDashboard, buildSiteReadinessPack, buildSiteTemplateReadmes, canAccessPhase2ClinicalAssistAlert, canAccessPhase2FamilyDoctorRow, collectJson, createDigitalHospitalPilotInstitution, createDigitalHospitalPilotIssue, createDigitalHospitalPublicHealthIncident, createDigitalHospitalSelfAssessment, createProductionDatabaseCutoverRun, digitalHospitalClientCertificate, digitalHospitalExecutionRuntime, digitalHospitalPublicHealthHospitalScope, digitalHospitalWorkerFingerprints, escalateDigitalHospitalPublicHealthIncident, executeGovernanceCommand, fs, governanceActorFromUser, governanceAuditForRecord, governanceHttpStatus, isProductionRuntime, listGovernanceRecords, listPostgresReconciliationCases, listPostgresReconciliationHistory, mergeByKey, normalizeDigitalHospitalCollectionJobAction, normalizeDigitalHospitalControlAction, normalizeDigitalHospitalEvaluationEvidenceAction, normalizeDigitalHospitalFormalCutoverApprovalAction, normalizeDigitalHospitalLaunchCommandBriefAction, normalizeDigitalHospitalLaunchRequirementAction, normalizeDigitalHospitalPilotInstitutionAction, normalizeDigitalHospitalPilotIssueAction, normalizeDigitalHospitalPolicyReview, normalizeDigitalHospitalPreAssessmentAction, normalizeDigitalHospitalProductionEvidencePacketAction, normalizeDigitalHospitalSelfAssessmentAction, normalizePhase2ClinicalAssistReceipt, normalizePhase2DiseaseReportReceipt, normalizePhase2FamilyDoctorApplication, normalizeProductionGoNoGoApprovalAction, normalizeProductionGoNoGoDecision, normalizeProductionSecurityFindingAction, normalizeProductionSecurityReleaseApprovalAction, normalizeState, phase2EvidenceHash, publicGovernanceRecord, randomUUID, readDatabase, readLatestPostgresReconciliation, readPostgresReconciliationCase, readPostgresReconciliationRun, renderCapabilityMapMarkdown, renderDigitalHospitalPublicHealthIncidentCsv, renderPlatformGoLiveSlicesMarkdown, renderPlatformStandardsLedgerDetailMarkdown, renderPlatformStandardsLedgersMarkdown, requireApiRole, requireDigitalHospitalExecutionWorker, reviewDigitalHospitalPublicHealthIncidentEvidence, reviewMutualRecognitionRecord, runDigitalHospitalPreAssessment, runPostgresPrimaryReadRehearsal, sealAuditTrail, seedCommercialCryptoCapabilities, seedCommercialCryptoEvidencePackets, seedDigitalHospitalCollectionJobs, seedDigitalHospitalControlMatrix, seedDigitalHospitalEvaluationEvidence, seedDigitalHospitalFormalCutoverApprovals, seedDigitalHospitalLaunchCommandBriefs, seedDigitalHospitalLaunchRequirements, seedDigitalHospitalPilotInstitutions, seedDigitalHospitalPilotIssues, seedDigitalHospitalPolicyRegister, seedDigitalHospitalPreAssessments, seedDigitalHospitalProductionEvidencePackets, seedDigitalHospitalSelfAssessments, seedDisasterRecoveryDrills, seedOperationsDutyShifts, seedOperationsEvidencePackets, seedOperationsIncidents, seedPhase2ClinicalAssistAlerts, seedPhase2ClinicalAssistRules, seedPhase2DiseaseReportQueue, seedPhase2FamilyDoctorApplications, seedPhase2FamilyDoctorContracts, seedProductionDatabaseCutoverRuns, seedProductionDatabaseMigrationBatches, sendDigitalHospitalExecutionError, sendDownload, sendJson, sendText, shouldUseSqlite, submitDigitalHospitalPublicHealthIncidentEvidence, todayOffset, upsertPhase2MutualRecognitionCitation, upsertSiteLaunchEvidence, verifySignedExecutionCallback, writeDatabase } = runtime;
  return [
    {
      id: "platform-governance-01",
      domain: "platform-governance",
      async handle(req, res, url) {
    if (req.method === "GET" && url.pathname === "/api/quality-operations-governance/catalog") {
        const user = requireApiRole(req, res, ["commission", "institution", "insurance"], url.pathname);
        if (!user) return true;
        sendJson(res, 200, buildGovernanceCatalog(readDatabase()));
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/quality-operations-governance/items") {
        const user = requireApiRole(req, res, ["commission", "institution", "insurance"], url.pathname);
        if (!user) return true;
        sendJson(res, 200, listGovernanceRecords(readDatabase(), user, {
          domain: url.searchParams.get("domain"),
          status: url.searchParams.get("status"),
          institutionId: url.searchParams.get("institutionId")
        }));
        return true;
      }

      const governanceAuditMatch = url.pathname.match(/^\/api\/quality-operations-governance\/items\/([^/]+)\/audit$/);
      if (req.method === "GET" && governanceAuditMatch) {
        const user = requireApiRole(req, res, ["commission", "institution", "insurance"], "/api/quality-operations-governance/items/:id/audit");
        if (!user) return true;
        const result = governanceAuditForRecord(readDatabase(), decodeURIComponent(governanceAuditMatch[1]), user);
        if (!result.found) {
          sendJson(res, 404, { error: "Not Found", code: "RECORD_NOT_FOUND", message: "governance record not found" });
          return true;
        }
        if (!result.allowed) {
          sendJson(res, 403, { error: "Forbidden", code: "INSTITUTION_SCOPE_DENIED", message: "record is outside the actor scope" });
          return true;
        }
        sendJson(res, 200, result);
        return true;
      }

      const governanceActionMatch = url.pathname.match(/^\/api\/quality-operations-governance\/items\/([^/]+)\/actions$/);
      if (req.method === "POST" && governanceActionMatch) {
        const user = requireApiRole(req, res, ["commission", "institution", "insurance"], "/api/quality-operations-governance/items/:id/actions");
        if (!user) return true;
        const payload = await collectJson(req);
        const data = readDatabase();
        const command = {
          idempotencyKey: String(req.headers["idempotency-key"] || "").trim(),
          domain: String(payload.domain || "").trim(),
          recordId: decodeURIComponent(governanceActionMatch[1]),
          action: String(payload.action || "").trim(),
          actor: governanceActorFromUser(user),
          expectedVersion: payload.expectedVersion,
          occurredAt: new Date().toISOString(),
          payload: payload.payload && typeof payload.payload === "object" ? payload.payload : {}
        };
        const runtime = buildGovernanceRuntimeState(data);
        const result = executeGovernanceCommand(runtime.state, command);
        applyGovernanceResultToData(data, result);
        data.securityEvents = sealAuditTrail(data.securityEvents, { recompute: true });
        writeDatabase(data);
        sendJson(res, result.ok ? 200 : governanceHttpStatus(result.error?.code), {
          ok: result.ok,
          replayed: result.replayed,
          record: publicGovernanceRecord(result.record),
          auditEvent: result.auditEvent,
          error: result.error
        });
        return true;
      }
        return false;
      }
    },
    {
      id: "platform-governance-02",
      domain: "platform-governance",
      async handle(req, res, url) {
    if (req.method === "GET" && url.pathname === "/api/digital-hospital/public-health/coordination") {
        const user = requireApiRole(req, res, ["commission"], "/api/digital-hospital/public-health/coordination");
        if (!user) return true;
        const data = readDatabase();
        const filters = Object.fromEntries(url.searchParams.entries());
        const authorizedHospitalCodes = digitalHospitalPublicHealthHospitalScope(user, data);
        if (!authorizeDigitalHospitalPublicHealthHospital(
          user,
          filters.hospitalCode,
          authorizedHospitalCodes,
          res,
          "/api/digital-hospital/public-health/coordination"
        )) return true;
        const board = await buildDigitalHospitalPublicHealthBoard(data, {
          filters,
          authorizedHospitalCodes
        });
        appendSecurityEvent({
          actor: user.name,
          role: user.role,
          action: "digital-hospital-public-health-coordination-read",
          target: "/api/digital-hospital/public-health/coordination",
          result: "allowed",
          detail: `${authorizedHospitalCodes.length} hospitals / ${board.summary.totalLanes} lanes / ${board.summary.filteredIncidents} filtered incidents / ${board.summary.overdueIncidents} overdue / productionReady=false`
        });
        sendJson(res, 200, board);
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/digital-hospital/public-health/incidents/export") {
        const user = requireApiRole(req, res, ["commission"], "/api/digital-hospital/public-health/incidents/export");
        if (!user) return true;
        const data = readDatabase();
        const query = Object.fromEntries(url.searchParams.entries());
        const authorizedHospitalCodes = digitalHospitalPublicHealthHospitalScope(user, data);
        if (!authorizeDigitalHospitalPublicHealthHospital(
          user,
          query.hospitalCode,
          authorizedHospitalCodes,
          res,
          "/api/digital-hospital/public-health/incidents/export"
        )) return true;
        const format = String(query.format || "json").trim().toLowerCase();
        if (!["json", "csv"].includes(format)) {
          sendJson(res, 400, {
            error: "Bad Request",
            code: "PUBLIC_HEALTH_EXPORT_FORMAT_INVALID",
            message: "format must be json or csv"
          });
          return true;
        }
        const board = await buildDigitalHospitalPublicHealthBoard(data, {
          filters: query,
          authorizedHospitalCodes
        });
        appendSecurityEvent({
          actor: user.name,
          role: user.role,
          action: "digital-hospital-public-health-incident-export",
          target: "/api/digital-hospital/public-health/incidents/export",
          result: "allowed",
          detail: `${format} / ${board.summary.filteredIncidents} incidents / productionReady=false`
        });
        const filename = `digital-hospital-public-health-incidents-${new Date().toISOString().slice(0, 10)}.${format}`;
        if (format === "csv") {
          sendDownload(
            res,
            200,
            renderDigitalHospitalPublicHealthIncidentCsv(board),
            "text/csv; charset=utf-8",
            filename
          );
          return true;
        }
        sendDownload(
          res,
          200,
          JSON.stringify({
            ok: true,
            generatedAt: board.generatedAt,
            filters: board.filters,
            summary: board.summary,
            statistics: board.statistics,
            incidents: board.coordination.incidents,
            productionBoundary: board.productionBoundary
          }, null, 2),
          "application/json; charset=utf-8",
          filename
        );
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/digital-hospital/public-health/incidents") {
        const user = requireApiRole(req, res, ["commission"], "/api/digital-hospital/public-health/incidents");
        if (!user) return true;
        const payload = await collectJson(req);
        const data = readDatabase();
        const authorizedHospitalCodes = digitalHospitalPublicHealthHospitalScope(user, data);
        if (!authorizeDigitalHospitalPublicHealthHospital(
          user,
          payload.hospitalCode,
          authorizedHospitalCodes,
          res,
          "/api/digital-hospital/public-health/incidents"
        )) return true;
        try {
          const result = createDigitalHospitalPublicHealthIncident(
            data.digitalHospitalPublicHealthCoordination,
            payload,
            user,
            { authorizedHospitalCodes }
          );
          data.digitalHospitalPublicHealthCoordination = result.state;
          data.securityEvents = sealAuditTrail([
            {
              id: randomUUID(),
              at: new Date().toISOString(),
              actor: user.name,
              role: user.role,
              action: "digital-hospital-public-health-incident-create",
              target: result.incident.id,
              result: "allowed",
              detail: `${result.incident.level} / ${result.incident.laneId} / revision ${result.incident.revision}`
            },
            ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
          ].slice(0, 120), { recompute: true });
          writeDatabase(data);
          sendJson(res, 201, {
            ok: true,
            incident: result.incident,
            action: result.action,
            board: await buildDigitalHospitalPublicHealthBoard(data, { authorizedHospitalCodes })
          });
        } catch (error) {
          sendJson(res, Number(error.status || 400), {
            error: Number(error.status || 400) === 409 ? "Conflict" : "Bad Request",
            code: error.code || "PUBLIC_HEALTH_COORDINATION_INVALID",
            message: error.message
          });
        }
        return true;
      }

      const digitalHospitalPublicHealthIncidentEvidenceMatch = url.pathname.match(
        /^\/api\/digital-hospital\/public-health\/incidents\/([^/]+)\/evidence$/
      );
      if (req.method === "POST" && digitalHospitalPublicHealthIncidentEvidenceMatch) {
        const user = requireApiRole(
          req,
          res,
          ["commission"],
          "/api/digital-hospital/public-health/incidents/:id/evidence"
        );
        if (!user) return true;
        const incidentId = decodeURIComponent(digitalHospitalPublicHealthIncidentEvidenceMatch[1]);
        const payload = await collectJson(req);
        const data = readDatabase();
        const authorizedHospitalCodes = digitalHospitalPublicHealthHospitalScope(user, data);
        try {
          const result = submitDigitalHospitalPublicHealthIncidentEvidence(
            data.digitalHospitalPublicHealthCoordination,
            incidentId,
            payload,
            user,
            { authorizedHospitalCodes }
          );
          data.digitalHospitalPublicHealthCoordination = result.state;
          data.securityEvents = sealAuditTrail([
            {
              id: randomUUID(),
              at: new Date().toISOString(),
              actor: user.name,
              role: user.role,
              action: "digital-hospital-public-health-evidence-submit",
              target: result.evidence.id,
              result: "allowed",
              detail: `${result.incident.id} / ${result.evidence.evidenceType} / incident revision ${result.incident.revision} / productionEvidence=false`
            },
            ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
          ].slice(0, 120), { recompute: true });
          writeDatabase(data);
          sendJson(res, 201, {
            ok: true,
            incident: result.incident,
            evidence: result.evidence,
            action: result.action,
            closureGate: result.closureGate,
            board: await buildDigitalHospitalPublicHealthBoard(data, { authorizedHospitalCodes })
          });
        } catch (error) {
          sendJson(res, Number(error.status || 400), {
            error: Number(error.status || 400) === 409
              ? "Conflict"
              : Number(error.status || 400) === 404 ? "Not Found" : "Bad Request",
            code: error.code || "PUBLIC_HEALTH_COORDINATION_INVALID",
            message: error.message
          });
        }
        return true;
      }

      const digitalHospitalPublicHealthEvidenceActionMatch = url.pathname.match(
        /^\/api\/digital-hospital\/public-health\/evidence\/([^/]+)\/actions$/
      );
      if (req.method === "POST" && digitalHospitalPublicHealthEvidenceActionMatch) {
        const user = requireApiRole(
          req,
          res,
          ["commission"],
          "/api/digital-hospital/public-health/evidence/:id/actions"
        );
        if (!user) return true;
        const evidenceId = decodeURIComponent(digitalHospitalPublicHealthEvidenceActionMatch[1]);
        const payload = await collectJson(req);
        const data = readDatabase();
        const authorizedHospitalCodes = digitalHospitalPublicHealthHospitalScope(user, data);
        try {
          const result = reviewDigitalHospitalPublicHealthIncidentEvidence(
            data.digitalHospitalPublicHealthCoordination,
            evidenceId,
            payload,
            user,
            { authorizedHospitalCodes }
          );
          data.digitalHospitalPublicHealthCoordination = result.state;
          data.securityEvents = sealAuditTrail([
            {
              id: randomUUID(),
              at: new Date().toISOString(),
              actor: user.name,
              role: user.role,
              action: "digital-hospital-public-health-evidence-review",
              target: result.evidence.id,
              result: "allowed",
              detail: `${result.action.action} / ${result.incident.id} / incident revision ${result.incident.revision} / productionEvidence=false`
            },
            ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
          ].slice(0, 120), { recompute: true });
          writeDatabase(data);
          sendJson(res, 200, {
            ok: true,
            incident: result.incident,
            evidence: result.evidence,
            action: result.action,
            closureGate: result.closureGate,
            board: await buildDigitalHospitalPublicHealthBoard(data, { authorizedHospitalCodes })
          });
        } catch (error) {
          sendJson(res, Number(error.status || 400), {
            error: Number(error.status || 400) === 409
              ? "Conflict"
              : Number(error.status || 400) === 404 ? "Not Found" : "Bad Request",
            code: error.code || "PUBLIC_HEALTH_COORDINATION_INVALID",
            message: error.message
          });
        }
        return true;
      }

      const digitalHospitalPublicHealthIncidentActionMatch = url.pathname.match(
        /^\/api\/digital-hospital\/public-health\/incidents\/([^/]+)\/actions$/
      );
      if (req.method === "POST" && digitalHospitalPublicHealthIncidentActionMatch) {
        const user = requireApiRole(
          req,
          res,
          ["commission"],
          "/api/digital-hospital/public-health/incidents/:id/actions"
        );
        if (!user) return true;
        const incidentId = decodeURIComponent(digitalHospitalPublicHealthIncidentActionMatch[1]);
        const payload = await collectJson(req);
        const data = readDatabase();
        const authorizedHospitalCodes = digitalHospitalPublicHealthHospitalScope(user, data);
        try {
          const result = String(payload.action || "") === "escalate-overdue"
            ? escalateDigitalHospitalPublicHealthIncident(
              data.digitalHospitalPublicHealthCoordination,
              incidentId,
              payload,
              user,
              { authorizedHospitalCodes }
            )
            : advanceDigitalHospitalPublicHealthIncident(
              data.digitalHospitalPublicHealthCoordination,
              incidentId,
              payload,
              user,
              { authorizedHospitalCodes }
            );
          data.digitalHospitalPublicHealthCoordination = result.state;
          data.securityEvents = sealAuditTrail([
            {
              id: randomUUID(),
              at: new Date().toISOString(),
              actor: user.name,
              role: user.role,
              action: "digital-hospital-public-health-incident-action",
              target: result.incident.id,
              result: "allowed",
              detail: `${result.action.action} / ${result.incident.status} / revision ${result.incident.revision}`
            },
            ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
          ].slice(0, 120), { recompute: true });
          writeDatabase(data);
          sendJson(res, 200, {
            ok: true,
            incident: result.incident,
            action: result.action,
            board: await buildDigitalHospitalPublicHealthBoard(data, { authorizedHospitalCodes })
          });
        } catch (error) {
          sendJson(res, Number(error.status || 400), {
            error: Number(error.status || 400) === 409 ? "Conflict" : "Bad Request",
            code: error.code || "PUBLIC_HEALTH_COORDINATION_INVALID",
            message: error.message
          });
        }
        return true;
      }
        return false;
      }
    },
    {
      id: "platform-governance-03",
      domain: "platform-governance",
      async handle(req, res, url) {
    if (req.method === "GET" && url.pathname === "/api/process-audit") {
        const user = requireApiRole(req, res, ["commission"], "/api/process-audit");
        if (!user) return true;
        sendJson(res, 200, buildProcessAuditReport({ data: readDatabase() }));
        return true;
      }
        return false;
      }
    },
    {
      id: "platform-governance-04",
      domain: "platform-governance",
      async handle(req, res, url) {
    if (req.method === "GET" && url.pathname === "/api/production-operations/center") {
        const user = requireApiRole(req, res, ["commission"], "/api/production-operations/center");
        if (!user) return true;
        const data = readDatabase();
        const center = buildProductionOperationsCenter(data, { runtimeMetrics: buildRuntimeMetrics(data) });
        appendSecurityEvent({
          actor: user.name,
          role: user.role,
          action: "production-operations-center-read",
          target: "/api/production-operations/center",
          result: "allowed",
          detail: `${center.summary.serviceLevels} SLOs / ${center.summary.openIncidents} open incidents / ${center.summary.validatedDrills} local drills / production ready 0`
        });
        sendJson(res, 200, { ok: center.ok, generatedAt: new Date().toISOString(), center });
        return true;
      }

      const productionOperationsActionMatch = url.pathname.match(/^\/api\/production-operations\/(incidents|duty-shifts|drills)\/([^/]+)\/actions$/);
      if (req.method === "POST" && productionOperationsActionMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/production-operations/:resource/:id/actions");
        if (!user) return true;
        const payload = await collectJson(req);
        const resource = productionOperationsActionMatch[1];
        const itemId = decodeURIComponent(productionOperationsActionMatch[2]);
        const definitions = {
          incidents: { collection: "operationsIncidents", seed: seedOperationsIncidents },
          "duty-shifts": { collection: "operationsDutyShifts", seed: seedOperationsDutyShifts },
          drills: { collection: "disasterRecoveryDrills", seed: seedDisasterRecoveryDrills }
        };
        const definition = definitions[resource];
        const data = readDatabase();
        const rows = mergeByKey(definition.seed(), data[definition.collection], "id");
        const index = rows.findIndex((item) => item.id === itemId);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "production operations item not found" });
          return true;
        }
        let normalized;
        try {
          normalized = applyProductionOperationsAction(resource, rows[index], payload, user);
        } catch (error) {
          sendJson(res, 400, { error: "Bad Request", message: error.message });
          return true;
        }
        rows[index] = normalized.item;
        data[definition.collection] = rows;
        if (normalized.evidencePacket) {
          data.operationsEvidencePackets = [normalized.evidencePacket, ...mergeByKey(seedOperationsEvidencePackets(), data.operationsEvidencePackets, "id")].slice(0, 80);
        }
        data.securityEvents = sealAuditTrail([
          {
            id: randomUUID(),
            at: new Date().toLocaleString("zh-CN", { hour12: false }),
            actor: user.name,
            role: user.role,
            action: "production-operations-action",
            target: `${resource}:${itemId}`,
            result: "allowed",
            detail: `${normalized.history.action} / ${normalized.history.fromStatus} -> ${normalized.history.toStatus} / production ready false`
          },
          ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
        ].slice(0, 120), { recompute: true });
        writeDatabase(normalizeState(data));
        const refreshed = readDatabase();
        sendJson(res, 200, {
          ok: true,
          item: normalized.item,
          action: normalized.history,
          evidencePacket: normalized.evidencePacket,
          center: buildProductionOperationsCenter(refreshed, { runtimeMetrics: buildRuntimeMetrics(refreshed) })
        });
        return true;
      }
        return false;
      }
    },
    {
      id: "platform-governance-05",
      domain: "platform-governance",
      async handle(req, res, url) {
    if (req.method === "GET" && url.pathname === "/api/site-readiness-pack") {
        const user = requireApiRole(req, res, ["commission"], "/api/site-readiness-pack");
        if (!user) return true;
        sendJson(res, 200, buildSiteReadinessPack({ data: readDatabase(), env: process.env }));
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/site-template-readmes") {
        const user = requireApiRole(req, res, ["commission"], "/api/site-template-readmes");
        if (!user) return true;
        sendJson(res, 200, buildSiteTemplateReadmes(readDatabase()));
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/site-launch-evidence") {
        const user = requireApiRole(req, res, ["commission"], "/api/site-launch-evidence");
        if (!user) return true;
        sendJson(res, 200, buildSiteLaunchEvidenceDashboard(readDatabase()));
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/site-launch-evidence") {
        const user = requireApiRole(req, res, ["commission"], "/api/site-launch-evidence");
        if (!user) return true;
        try {
          const result = upsertSiteLaunchEvidence(readDatabase(), user, await collectJson(req));
          sendJson(res, result.status, result.body);
        } catch (error) {
          sendJson(res, 400, { error: "Bad Request", message: error.message });
        }
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/release-report") {
        const user = requireApiRole(req, res, ["commission"], "/api/release-report");
        if (!user) return true;
        sendJson(res, 200, buildReleaseReport({ data: readDatabase(), env: process.env, profile: "demo" }));
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/production-cutover-checklist") {
        const user = requireApiRole(req, res, ["commission"], "/api/production-cutover-checklist");
        if (!user) return true;
        const releaseReport = buildReleaseReport({ data: readDatabase(), env: process.env, profile: "demo" });
        sendJson(res, 200, {
          ok: releaseReport.productionCutover.every((item) => item.passed),
          generatedAt: releaseReport.generatedAt,
          profile: releaseReport.profile,
          summary: {
            total: releaseReport.productionCutover.length,
            passed: releaseReport.productionCutover.filter((item) => item.passed).length,
            blocked: releaseReport.productionCutover.filter((item) => !item.passed).length
          },
          checklist: releaseReport.productionCutover
        });
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/release-artifact-manifest") {
        const user = requireApiRole(req, res, ["commission"], "/api/release-artifact-manifest");
        if (!user) return true;
        const releaseReport = buildReleaseReport({ data: readDatabase(), env: process.env, profile: "demo" });
        sendJson(res, 200, buildReleaseArtifactManifest({ releaseReport }));
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/platform/capability-map") {
        const user = requireApiRole(req, res, ["commission"], "/api/platform/capability-map");
        if (!user) return true;
        const data = readDatabase();
        const releaseReport = buildReleaseReport({ data, env: process.env, profile: "demo" });
        const manifest = buildReleaseArtifactManifest({ releaseReport });
        const capabilityMap = buildCapabilityMap({ data, manifest });
        if (url.searchParams.get("format") === "markdown") {
          sendText(res, 200, renderCapabilityMapMarkdown(capabilityMap), "text/markdown; charset=utf-8");
          return true;
        }
        sendJson(res, 200, capabilityMap);
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/platform/blocker-register") {
        const user = requireApiRole(req, res, ["commission"], "/api/platform/blocker-register");
        if (!user) return true;
        const data = readDatabase();
        const releaseReport = buildReleaseReport({ data, env: process.env, profile: "demo" });
        const manifest = buildReleaseArtifactManifest({ releaseReport });
        const capabilityMap = buildCapabilityMap({ data, manifest });
        sendJson(res, 200, buildPlatformBlockerRegister(data, capabilityMap));
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/platform/service-order-center") {
        const user = requireApiRole(req, res, ["commission"], "/api/platform/service-order-center");
        if (!user) return true;
        const data = readDatabase();
        sendJson(res, 200, buildPlatformServiceOrderCenter(data));
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/platform/go-live-slices") {
        const user = requireApiRole(req, res, ["commission"], "/api/platform/go-live-slices");
        if (!user) return true;
        const data = readDatabase();
        const releaseReport = buildReleaseReport({ data, env: process.env, profile: "demo" });
        const manifest = buildReleaseArtifactManifest({ releaseReport });
        const capabilityMap = buildCapabilityMap({ data, manifest });
        const goLiveSlices = buildPlatformGoLiveSlices(data, capabilityMap);
        if (url.searchParams.get("format") === "markdown") {
          sendText(res, 200, renderPlatformGoLiveSlicesMarkdown(goLiveSlices), "text/markdown; charset=utf-8");
          return true;
        }
        sendJson(res, 200, goLiveSlices);
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/platform/standards-ledgers") {
        const user = requireApiRole(req, res, ["commission"], "/api/platform/standards-ledgers");
        if (!user) return true;
        const data = readDatabase();
        const releaseReport = buildReleaseReport({ data, env: process.env, profile: "demo", skipPlatformStandardsLedgers: true });
        const manifest = buildReleaseArtifactManifest({ releaseReport });
        const standardsLedgers = buildPlatformStandardsLedgers(data, { manifest });
        if (url.searchParams.get("format") === "markdown") {
          sendText(res, 200, renderPlatformStandardsLedgersMarkdown(standardsLedgers), "text/markdown; charset=utf-8");
          return true;
        }
        sendJson(res, 200, standardsLedgers);
        return true;
      }

      const platformStandardsLedgerDetailMatch = url.pathname.match(/^\/api\/platform\/standards-ledgers\/([^/]+)$/);
      if (req.method === "GET" && platformStandardsLedgerDetailMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/platform/standards-ledgers/:id");
        if (!user) return true;
        const data = readDatabase();
        const ledgerId = decodeURIComponent(platformStandardsLedgerDetailMatch[1]);
        const detail = buildPlatformStandardsLedgerDetail(data, ledgerId, {
          query: url.searchParams.get("q") || "",
          status: url.searchParams.get("status") || "",
          collection: url.searchParams.get("collection") || ""
        });
        if (!detail) {
          sendJson(res, 404, { error: "Not Found", message: "Platform standards ledger not found" });
          return true;
        }
        if (url.searchParams.get("format") === "markdown") {
          sendText(res, 200, renderPlatformStandardsLedgerDetailMarkdown(detail), "text/markdown; charset=utf-8");
          return true;
        }
        sendJson(res, 200, detail);
        return true;
      }
        return false;
      }
    },
    {
      id: "platform-governance-06",
      domain: "platform-governance",
      async handle(req, res, url) {
    if (req.method === "GET" && url.pathname === "/api/production-go-no-go/center") {
        const user = requireApiRole(req, res, ["commission"], "/api/production-go-no-go/center");
        if (!user) return true;
        sendJson(res, 200, buildRuntimeProductionGoNoGoCenter(readDatabase()));
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/production-release/evidence-readiness") {
        const user = requireApiRole(req, res, ["commission"], url.pathname);
        if (!user) return true;
        const summary = buildProductionReleaseEvidencePublicSummary();
        appendSecurityEvent({
          actor: user.name,
          role: user.role,
          action: "production-release-evidence-readiness-read",
          target: url.pathname,
          result: "allowed",
          detail: `${summary.summary.present}/${summary.summary.documents} documents; ${summary.status}; production gate closed`
        });
        sendJson(res, 200, summary);
        return true;
      }

      const productionGoNoGoApprovalMatch = url.pathname.match(/^\/api\/production-go-no-go\/approvals\/([^/]+)\/actions$/);
      if (req.method === "POST" && productionGoNoGoApprovalMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/production-go-no-go/approvals/:id/actions");
        if (!user) return true;
        const data = normalizeState(readDatabase());
        const approvalId = decodeURIComponent(productionGoNoGoApprovalMatch[1]);
        const index = data.productionGoNoGoApprovals.findIndex((item) => item.id === approvalId);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "production go/no-go approval not found" });
          return true;
        }
        const payload = await collectJson(req);
        const currentCenter = buildRuntimeProductionGoNoGoCenter(data);
        try {
          data.productionGoNoGoApprovals[index] = normalizeProductionGoNoGoApprovalAction(data.productionGoNoGoApprovals[index], payload, user, currentCenter);
        } catch (error) {
          sendJson(res, 409, { error: "Conflict", message: error.message });
          return true;
        }
        const center = buildRuntimeProductionGoNoGoCenter(data);
        data.securityEvents = [{
          id: randomUUID(), at: new Date().toISOString(), actor: user.name, role: user.role,
          action: "production-go-no-go-approval", target: approvalId, result: "allowed",
          detail: `${payload.action || "unknown"}:${data.productionGoNoGoApprovals[index].status}`
        }, ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])].slice(0, 120);
        writeDatabase(normalizeState(data));
        sendJson(res, 200, { ok: true, approval: data.productionGoNoGoApprovals[index], center });
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/production-go-no-go/decision") {
        const user = requireApiRole(req, res, ["commission"], "/api/production-go-no-go/decision");
        if (!user) return true;
        const data = normalizeState(readDatabase());
        const payload = await collectJson(req);
        const currentCenter = buildRuntimeProductionGoNoGoCenter(data);
        try {
          data.productionGoNoGoDecision = normalizeProductionGoNoGoDecision(payload, user, currentCenter);
        } catch (error) {
          sendJson(res, 409, { error: "Conflict", message: error.message });
          return true;
        }
        const center = buildRuntimeProductionGoNoGoCenter(data);
        data.securityEvents = [{
          id: randomUUID(), at: new Date().toISOString(), actor: user.name, role: user.role,
          action: "production-go-no-go-decision", target: data.productionGoNoGoDecision.id, result: "allowed",
          detail: `${data.productionGoNoGoDecision.decision}:${data.productionGoNoGoDecision.changeTicket}`
        }, ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])].slice(0, 120);
        writeDatabase(normalizeState(data));
        sendJson(res, 200, { ok: true, decision: data.productionGoNoGoDecision, center });
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/production-security/center") {
        const user = requireApiRole(req, res, ["commission"], "/api/production-security/center");
        if (!user) return true;
        const data = normalizeState(readDatabase());
        const center = buildProductionSecurityAcceptanceCenter(data.productionSecurityFindings, data.productionSecurityReleaseApprovals);
        sendJson(res, 200, center);
        return true;
      }

      const productionSecurityFindingActionMatch = url.pathname.match(/^\/api\/production-security\/findings\/([^/]+)\/actions$/);
      if (req.method === "POST" && productionSecurityFindingActionMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/production-security/findings/:id/actions");
        if (!user) return true;
        const data = normalizeState(readDatabase());
        const findingId = decodeURIComponent(productionSecurityFindingActionMatch[1]);
        const index = data.productionSecurityFindings.findIndex((item) => item.id === findingId);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "production security finding not found" });
          return true;
        }
        const payload = await collectJson(req);
        try {
          data.productionSecurityFindings[index] = normalizeProductionSecurityFindingAction(data.productionSecurityFindings[index], payload, user);
        } catch (error) {
          sendJson(res, 400, { error: "Bad Request", message: error.message });
          return true;
        }
        let center = buildProductionSecurityAcceptanceCenter(data.productionSecurityFindings, data.productionSecurityReleaseApprovals);
        if (!center.summary.releaseEligible) {
          data.productionSecurityReleaseApprovals = data.productionSecurityReleaseApprovals.map((item) => item.status === "approved"
            ? { ...item, status: "pending", invalidatedAt: new Date().toISOString(), invalidatedByFindingId: findingId }
            : item);
          center = buildProductionSecurityAcceptanceCenter(data.productionSecurityFindings, data.productionSecurityReleaseApprovals);
        }
        data.securityEvents = [{
          id: randomUUID(),
          at: new Date().toISOString(),
          actor: user.name,
          role: user.role,
          action: "production-security-finding-action",
          target: findingId,
          result: "allowed",
          detail: `${payload.action || "unknown"}:${data.productionSecurityFindings[index].status}`
        }, ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])].slice(0, 120);
        writeDatabase(normalizeState(data));
        sendJson(res, 200, { ok: true, finding: data.productionSecurityFindings[index], center });
        return true;
      }

      const productionSecurityApprovalActionMatch = url.pathname.match(/^\/api\/production-security\/release-approvals\/([^/]+)\/actions$/);
      if (req.method === "POST" && productionSecurityApprovalActionMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/production-security/release-approvals/:id/actions");
        if (!user) return true;
        const data = normalizeState(readDatabase());
        const approvalId = decodeURIComponent(productionSecurityApprovalActionMatch[1]);
        const index = data.productionSecurityReleaseApprovals.findIndex((item) => item.id === approvalId);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "production security release approval not found" });
          return true;
        }
        const payload = await collectJson(req);
        const currentCenter = buildProductionSecurityAcceptanceCenter(data.productionSecurityFindings, data.productionSecurityReleaseApprovals);
        try {
          data.productionSecurityReleaseApprovals[index] = normalizeProductionSecurityReleaseApprovalAction(
            data.productionSecurityReleaseApprovals[index], payload, user, currentCenter
          );
        } catch (error) {
          sendJson(res, 409, { error: "Conflict", message: error.message });
          return true;
        }
        const center = buildProductionSecurityAcceptanceCenter(data.productionSecurityFindings, data.productionSecurityReleaseApprovals);
        data.securityEvents = [{
          id: randomUUID(),
          at: new Date().toISOString(),
          actor: user.name,
          role: user.role,
          action: "production-security-release-opinion",
          target: approvalId,
          result: "allowed",
          detail: `${payload.action || "unknown"}:${data.productionSecurityReleaseApprovals[index].status}`
        }, ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])].slice(0, 120);
        writeDatabase(normalizeState(data));
        sendJson(res, 200, { ok: true, approval: data.productionSecurityReleaseApprovals[index], center });
        return true;
      }
        return false;
      }
    },
    {
      id: "platform-governance-07",
      domain: "platform-governance",
      async handle(req, res, url) {
    if (req.method === "GET" && url.pathname === "/api/digital-hospital/execution/runtime") {
        const user = requireApiRole(req, res, ["commission"], "/api/digital-hospital/execution/runtime");
        if (!user) return true;
        try {
          const board = digitalHospitalExecutionRuntime().runtimeBoard();
          sendJson(res, 200, {
            ...board,
            security: buildDigitalHospitalSecurityCenter(),
            workerIdentity: {
              mode: isProductionRuntime() ? "mTLS-service-identity" : "commission-session-compatibility",
              trustedFingerprintCount: digitalHospitalWorkerFingerprints().length,
              productionReady: digitalHospitalWorkerFingerprints().length > 0
            }
          });
        } catch (error) {
          sendDigitalHospitalExecutionError(res, error);
        }
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/digital-hospital/execution/security") {
        const user = requireApiRole(req, res, ["commission"], "/api/digital-hospital/execution/security");
        if (!user) return true;
        sendJson(res, 200, {
          ok: true,
          generatedAt: new Date().toISOString(),
          security: buildDigitalHospitalSecurityCenter(),
          workerIdentity: {
            mode: isProductionRuntime() ? "mTLS-service-identity" : "commission-session-compatibility",
            trustedFingerprintCount: digitalHospitalWorkerFingerprints().length,
            productionReady: digitalHospitalWorkerFingerprints().length > 0
          }
        });
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/digital-hospital/execution/workers") {
        const actor = requireDigitalHospitalExecutionWorker(req, res, "/api/digital-hospital/execution/workers");
        if (!actor) return true;
        try {
          const payload = await collectJson(req, 100_000);
          const result = digitalHospitalExecutionRuntime().registerWorker({
            id: payload.id,
            node: payload.node,
            pool: payload.pool,
            capabilities: payload.capabilities,
            now: new Date().toISOString()
          });
          sendJson(res, 201, result);
        } catch (error) {
          sendDigitalHospitalExecutionError(res, error);
        }
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/digital-hospital/execution/vault-references") {
        const user = requireApiRole(req, res, ["commission"], "/api/digital-hospital/execution/vault-references");
        if (!user) return true;
        try {
          const payload = await collectJson(req, 100_000);
          const result = digitalHospitalExecutionRuntime().registerVaultReference({
            ...payload,
            owner: user.name,
            updatedAt: new Date().toISOString()
          });
          sendJson(res, 201, result);
        } catch (error) {
          sendDigitalHospitalExecutionError(res, error);
        }
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/digital-hospital/execution/jobs") {
        const user = requireApiRole(req, res, ["commission"], "/api/digital-hospital/execution/jobs");
        if (!user) return true;
        try {
          const payload = await collectJson(req, 200_000);
          const idempotencyKey = String(req.headers["idempotency-key"] || "").trim();
          if (!idempotencyKey) {
            sendJson(res, 400, {
              ok: false,
              code: "IDEMPOTENCY_KEY_REQUIRED",
              message: "Idempotency-Key header is required"
            });
            return true;
          }
          const result = digitalHospitalExecutionRuntime().enqueue({
            connectorId: payload.connectorId,
            environmentId: payload.environmentId,
            jobType: payload.jobType,
            payload: payload.payload,
            maxAttempts: payload.maxAttempts,
            retryBaseSeconds: payload.retryBaseSeconds,
            retryMaxSeconds: payload.retryMaxSeconds,
            idempotencyKey,
            now: new Date().toISOString()
          });
          sendJson(res, result.result.duplicate ? 200 : 201, result);
        } catch (error) {
          sendDigitalHospitalExecutionError(res, error);
        }
        return true;
      }

      const digitalHospitalExecutionJobActionMatch = url.pathname.match(/^\/api\/digital-hospital\/execution\/jobs\/([^/]+)\/actions$/);
      if (req.method === "POST" && digitalHospitalExecutionJobActionMatch) {
        const actor = requireDigitalHospitalExecutionWorker(req, res, "/api/digital-hospital/execution/jobs/:id/actions");
        if (!actor) return true;
        const jobId = decodeURIComponent(digitalHospitalExecutionJobActionMatch[1]);
        try {
          const payload = await collectJson(req, 100_000);
          const now = new Date().toISOString();
          let result;
          if (payload.action === "claim") {
            result = digitalHospitalExecutionRuntime().claim({
              jobId,
              workerId: payload.workerId,
              leaseSeconds: payload.leaseSeconds,
              now
            });
          } else if (payload.action === "heartbeat") {
            result = digitalHospitalExecutionRuntime().heartbeat(jobId, {
              workerId: payload.workerId,
              leaseToken: payload.leaseToken,
              leaseSeconds: payload.leaseSeconds,
              progress: payload.progress,
              now
            });
          } else if (payload.action === "complete-attempt") {
            result = digitalHospitalExecutionRuntime().completeAttempt(jobId, {
              workerId: payload.workerId,
              leaseToken: payload.leaseToken,
              now
            });
          } else if (payload.action === "fail") {
            result = digitalHospitalExecutionRuntime().failAttempt(jobId, {
              workerId: payload.workerId,
              leaseToken: payload.leaseToken,
              errorCode: payload.errorCode,
              failureClass: payload.failureClass,
              now
            });
          } else {
            sendJson(res, 400, {
              ok: false,
              code: "EXECUTION_JOB_ACTION_INVALID",
              message: "action must be claim, heartbeat, complete-attempt or fail"
            });
            return true;
          }
          sendJson(res, 200, result);
        } catch (error) {
          sendDigitalHospitalExecutionError(res, error);
        }
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/digital-hospital/execution/leases/recover-expired") {
        const actor = requireDigitalHospitalExecutionWorker(req, res, "/api/digital-hospital/execution/leases/recover-expired");
        if (!actor) return true;
        try {
          const result = digitalHospitalExecutionRuntime().recoverExpiredLeases({
            now: new Date().toISOString()
          });
          sendJson(res, 200, result);
        } catch (error) {
          sendDigitalHospitalExecutionError(res, error);
        }
        return true;
      }

      const digitalHospitalDeadLetterActionMatch = url.pathname.match(/^\/api\/digital-hospital\/execution\/dead-letters\/([^/]+)\/actions$/);
      if (req.method === "POST" && digitalHospitalDeadLetterActionMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/digital-hospital/execution/dead-letters/:id/actions");
        if (!user) return true;
        try {
          const payload = await collectJson(req, 100_000);
          if (payload.action !== "redrive") {
            sendJson(res, 400, { ok: false, code: "DEAD_LETTER_ACTION_INVALID", message: "only redrive is accepted" });
            return true;
          }
          const result = digitalHospitalExecutionRuntime().redrive(
            decodeURIComponent(digitalHospitalDeadLetterActionMatch[1]),
            {
              reviewedBy: user.username || user.name,
              reviewNote: payload.reviewNote,
              now: new Date().toISOString()
            }
          );
          sendJson(res, 200, result);
        } catch (error) {
          sendDigitalHospitalExecutionError(res, error);
        }
        return true;
      }

      const digitalHospitalQuarantineActionMatch = url.pathname.match(/^\/api\/digital-hospital\/execution\/quarantines\/([^/]+)\/actions$/);
      if (req.method === "POST" && digitalHospitalQuarantineActionMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/digital-hospital/execution/quarantines/:id/actions");
        if (!user) return true;
        try {
          const payload = await collectJson(req, 100_000);
          if (payload.action !== "release") {
            sendJson(res, 400, { ok: false, code: "QUARANTINE_ACTION_INVALID", message: "only release is accepted" });
            return true;
          }
          const result = digitalHospitalExecutionRuntime().releaseQuarantine(
            decodeURIComponent(digitalHospitalQuarantineActionMatch[1]),
            {
              releasedBy: user.username || user.name,
              reviewNote: payload.reviewNote,
              now: new Date().toISOString()
            }
          );
          sendJson(res, 200, result);
        } catch (error) {
          sendDigitalHospitalExecutionError(res, error);
        }
        return true;
      }

      const digitalHospitalCutoverWindowActionMatch = url.pathname.match(/^\/api\/digital-hospital\/execution\/cutover-windows\/([^/]+)\/actions$/);
      if (req.method === "POST" && digitalHospitalCutoverWindowActionMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/digital-hospital/execution/cutover-windows/:id/actions");
        if (!user) return true;
        try {
          const payload = await collectJson(req, 100_000);
          if (payload.action !== "evaluate") {
            sendJson(res, 400, { ok: false, code: "CUTOVER_WINDOW_ACTION_INVALID", message: "only evaluate is accepted" });
            return true;
          }
          const result = digitalHospitalExecutionRuntime().evaluateCutover(
            decodeURIComponent(digitalHospitalCutoverWindowActionMatch[1]),
            new Date().toISOString()
          );
          sendJson(res, 200, result);
        } catch (error) {
          sendDigitalHospitalExecutionError(res, error);
        }
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/digital-hospital/execution/cutover-evidence-packs") {
        const user = requireApiRole(req, res, ["commission"], "/api/digital-hospital/execution/cutover-evidence-packs");
        if (!user) return true;
        try {
          const payload = await collectJson(req, 100_000);
          const result = digitalHospitalExecutionRuntime().createCutoverEvidencePack({
            windowId: payload.windowId,
            institutionId: payload.institutionId,
            institutionName: payload.institutionName,
            releaseVersion: payload.releaseVersion,
            createdBy: user.username || user.name,
            role: user.role,
            now: new Date().toISOString()
          });
          sendJson(res, 201, result);
        } catch (error) {
          sendDigitalHospitalExecutionError(res, error);
        }
        return true;
      }

      const digitalHospitalCutoverEvidenceActionMatch = url.pathname.match(/^\/api\/digital-hospital\/execution\/cutover-evidence-packs\/([^/]+)\/evidence\/([^/]+)\/actions$/);
      if (req.method === "POST" && digitalHospitalCutoverEvidenceActionMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/digital-hospital/execution/cutover-evidence-packs/:id/evidence/:evidenceId/actions");
        if (!user) return true;
        try {
          const payload = await collectJson(req, 100_000);
          if (payload.action !== "verify") {
            sendJson(res, 400, { ok: false, code: "CUTOVER_EVIDENCE_ACTION_INVALID", message: "only verify is accepted" });
            return true;
          }
          const result = digitalHospitalExecutionRuntime().verifyCutoverEvidence(
            decodeURIComponent(digitalHospitalCutoverEvidenceActionMatch[1]),
            decodeURIComponent(digitalHospitalCutoverEvidenceActionMatch[2]),
            {
              verifiedBy: user.username || user.name,
              verificationNote: payload.verificationNote,
              accepted: payload.accepted,
              role: payload.role || user.role,
              now: new Date().toISOString()
            }
          );
          sendJson(res, 200, result);
        } catch (error) {
          sendDigitalHospitalExecutionError(res, error);
        }
        return true;
      }

      const digitalHospitalCutoverPackActionMatch = url.pathname.match(/^\/api\/digital-hospital\/execution\/cutover-evidence-packs\/([^/]+)\/actions$/);
      if (req.method === "POST" && digitalHospitalCutoverPackActionMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/digital-hospital/execution/cutover-evidence-packs/:id/actions");
        if (!user) return true;
        const packId = decodeURIComponent(digitalHospitalCutoverPackActionMatch[1]);
        try {
          const payload = await collectJson(req, 100_000);
          const now = new Date().toISOString();
          const runtime = digitalHospitalExecutionRuntime();
          let result;
          if (payload.action === "record-evidence") {
            result = runtime.recordCutoverEvidence(packId, {
              requirementId: payload.requirementId,
              artifactName: payload.artifactName,
              artifactDigest: payload.artifactDigest,
              signatureDigest: payload.signatureDigest,
              sourceSystem: payload.sourceSystem,
              submittedBy: user.username || user.name,
              role: payload.role || user.role,
              now
            });
          } else if (payload.action === "approve") {
            result = runtime.approveCutover(packId, {
              role: payload.role,
              approver: user.username || user.name,
              decision: payload.decision,
              note: payload.note,
              now
            });
          } else if (payload.action === "evaluate") {
            const board = runtime.runtimeBoard(now);
            result = runtime.evaluateProductionCutover(packId, {
              now,
              actor: user.username || user.name,
              role: user.role,
              security: buildDigitalHospitalSecurityCenter(),
              repository: board.repository
            });
          } else if (payload.action === "start") {
            result = runtime.startProductionCutover(packId, {
              actor: user.username || user.name,
              role: user.role,
              changeTicket: payload.changeTicket,
              now
            });
          } else if (payload.action === "complete") {
            result = runtime.completeProductionCutover(packId, {
              actor: user.username || user.name,
              role: user.role,
              receiptDigest: payload.receiptDigest,
              now
            });
          } else if (payload.action === "rollback") {
            result = runtime.rollbackProductionCutover(packId, {
              actor: user.username || user.name,
              role: user.role,
              reason: payload.reason,
              now
            });
          } else {
            sendJson(res, 400, {
              ok: false,
              code: "CUTOVER_PACK_ACTION_INVALID",
              message: "unsupported cutover evidence pack action"
            });
            return true;
          }
          sendJson(res, 200, result);
        } catch (error) {
          sendDigitalHospitalExecutionError(res, error);
        }
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/digital-hospital/execution/callbacks") {
        try {
          const payload = await collectJson(req, 200_000);
          const certificate = digitalHospitalClientCertificate(
            req,
            String(process.env.DIGITAL_HOSPITAL_TRUST_PROXY_MTLS || "").toLowerCase() === "true"
              ? "x-client-cert-fingerprint"
              : ""
          );
          const verified = await verifySignedExecutionCallback(payload, {
            timestamp: req.headers["x-execution-timestamp"],
            nonce: req.headers["x-execution-nonce"],
            signature: req.headers["x-execution-signature"],
            clientCertificateFingerprint: certificate.fingerprint,
            clientCertificateAuthorized: certificate.authorized,
            nowMs: Date.now()
          });
          const result = digitalHospitalExecutionRuntime().verifyCallback(verified, {
            maxSkewSeconds: buildDigitalHospitalSecurityCenter().maxSkewSeconds
          });
          sendJson(res, result.result.accepted ? 202 : 409, result);
        } catch (error) {
          sendDigitalHospitalExecutionError(res, error);
        }
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/digital-hospital/evaluation-catalog") {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/digital-hospital/evaluation-catalog");
        if (!user) return true;
        const catalog = buildDigitalHospitalEvaluationCatalog();
        appendSecurityEvent({
          actor: user.name,
          role: user.role,
          action: "digital-hospital-evaluation-catalog-read",
          target: "/api/digital-hospital/evaluation-catalog",
          result: "allowed",
          detail: `${catalog.summary.packs} packs / ${catalog.summary.projects} projects / ${catalog.summary.clauses} clauses`
        });
        sendJson(res, 200, catalog);
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/digital-hospital/pilot-readiness") {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/digital-hospital/pilot-readiness");
        if (!user) return true;
        const data = readDatabase();
        const board = buildDigitalHospitalPilotBoard(data, user, { institutionId: url.searchParams.get("institutionId") || "" });
        appendSecurityEvent({
          actor: user.name,
          role: user.role,
          action: "digital-hospital-pilot-readiness-read",
          target: "/api/digital-hospital/pilot-readiness",
          result: "allowed",
          detail: `${board.functionalState} / ${board.formalGoLiveState} / ${board.summary.openFindings} open findings`
        });
        sendJson(res, 200, board);
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/digital-hospital/pilot-institutions/actions") {
        const user = requireApiRole(req, res, ["commission"], "/api/digital-hospital/pilot-institutions/actions");
        if (!user) return true;
        const payload = await collectJson(req);
        if (payload.action !== "register") {
          sendJson(res, 400, { error: "Bad Request", message: "Only register is accepted" });
          return true;
        }
        const data = readDatabase();
        const institutions = Array.isArray(data.digitalHospitalPilotInstitutions) ? data.digitalHospitalPilotInstitutions : seedDigitalHospitalPilotInstitutions();
        if (institutions.some((item) => item.institutionId === String(payload.institutionId || "").trim())) {
          sendJson(res, 409, { error: "Conflict", message: "Pilot institution already exists" });
          return true;
        }
        let institution;
        try {
          institution = createDigitalHospitalPilotInstitution(payload, user);
        } catch (error) {
          const status = Number(error.status) || 400;
          sendJson(res, status, { error: status === 403 ? "Forbidden" : "Bad Request", message: error.message });
          return true;
        }
        data.digitalHospitalPilotInstitutions = [institution, ...institutions].slice(0, 100);
        data.securityEvents = sealAuditTrail([{
          id: randomUUID(), at: new Date().toISOString(), actor: user.name, role: user.role,
          action: "digital-hospital-pilot-institution-register", target: institution.id, result: "allowed",
          detail: `${institution.institutionId} / onboarding / pilot only`
        }, ...(data.securityEvents || [])].slice(0, 120), { recompute: true });
        writeDatabase(normalizeState(data));
        sendJson(res, 201, { ok: true, institution, board: buildDigitalHospitalPilotBoard(readDatabase(), user) });
        return true;
      }

      const digitalHospitalPilotInstitutionActionMatch = url.pathname.match(/^\/api\/digital-hospital\/pilot-institutions\/([^/]+)\/actions$/);
      if (req.method === "POST" && digitalHospitalPilotInstitutionActionMatch) {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/digital-hospital/pilot-institutions/:id/actions");
        if (!user) return true;
        const institutionRecordId = decodeURIComponent(digitalHospitalPilotInstitutionActionMatch[1]);
        const payload = await collectJson(req);
        const data = readDatabase();
        const institutions = Array.isArray(data.digitalHospitalPilotInstitutions) ? data.digitalHospitalPilotInstitutions : seedDigitalHospitalPilotInstitutions();
        const index = institutions.findIndex((item) => item.id === institutionRecordId);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "Digital hospital pilot institution not found" });
          return true;
        }
        try {
          institutions[index] = normalizeDigitalHospitalPilotInstitutionAction(institutions[index], payload, user);
        } catch (error) {
          const status = Number(error.status) || 400;
          sendJson(res, status, { error: status === 403 ? "Forbidden" : status === 409 ? "Conflict" : "Bad Request", message: error.message });
          return true;
        }
        data.digitalHospitalPilotInstitutions = institutions;
        data.securityEvents = sealAuditTrail([{
          id: randomUUID(), at: new Date().toISOString(), actor: user.name, role: user.role,
          action: "digital-hospital-pilot-institution-action", target: institutionRecordId, result: "allowed",
          detail: `${payload.action} / ${institutions[index].status} / ${institutions[index].stage}`
        }, ...(data.securityEvents || [])].slice(0, 120), { recompute: true });
        writeDatabase(normalizeState(data));
        sendJson(res, 200, { ok: true, institution: institutions[index], board: buildDigitalHospitalPilotBoard(readDatabase(), user) });
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/digital-hospital/pilot-issues/actions") {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/digital-hospital/pilot-issues/actions");
        if (!user) return true;
        const payload = await collectJson(req);
        if (payload.action !== "create") {
          sendJson(res, 400, { error: "Bad Request", message: "Only create is accepted" });
          return true;
        }
        const data = readDatabase();
        const institutionId = String(payload.institutionId || (user.role === "institution" ? user.orgCode : "") || "").trim();
        const pilotInstitutions = Array.isArray(data.digitalHospitalPilotInstitutions) ? data.digitalHospitalPilotInstitutions : seedDigitalHospitalPilotInstitutions();
        const pilotInstitution = pilotInstitutions.find((item) => item.institutionId === institutionId);
        if (!pilotInstitution) {
          sendJson(res, 400, { error: "Bad Request", message: "Pilot issue institution must be registered in the pilot roster" });
          return true;
        }
        const existingIssues = Array.isArray(data.digitalHospitalPilotIssues) ? data.digitalHospitalPilotIssues : seedDigitalHospitalPilotIssues();
        if (existingIssues.some((item) => item.institutionId === institutionId && item.title === String(payload.title || "").trim() && item.status !== "verified-closed")) {
          sendJson(res, 409, { error: "Conflict", message: "An open pilot issue with the same institution and title already exists" });
          return true;
        }
        let issue;
        try {
          issue = createDigitalHospitalPilotIssue({ ...payload, institutionId, institutionName: pilotInstitution.institutionName }, user);
        } catch (error) {
          const status = Number(error.status) || 400;
          sendJson(res, status, { error: status === 403 ? "Forbidden" : "Bad Request", message: error.message });
          return true;
        }
        data.digitalHospitalPilotIssues = [issue, ...existingIssues].slice(0, 1000);
        data.securityEvents = sealAuditTrail([{
          id: randomUUID(), at: new Date().toISOString(), actor: user.name, role: user.role,
          action: "digital-hospital-pilot-issue-create", target: issue.id, result: "allowed",
          detail: `${issue.institutionId} / ${issue.severity} / no patient PII`
        }, ...(data.securityEvents || [])].slice(0, 120), { recompute: true });
        writeDatabase(normalizeState(data));
        sendJson(res, 201, { ok: true, issue, board: buildDigitalHospitalPilotBoard(readDatabase(), user) });
        return true;
      }

      const digitalHospitalPilotIssueActionMatch = url.pathname.match(/^\/api\/digital-hospital\/pilot-issues\/([^/]+)\/actions$/);
      if (req.method === "POST" && digitalHospitalPilotIssueActionMatch) {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/digital-hospital/pilot-issues/:id/actions");
        if (!user) return true;
        const issueId = decodeURIComponent(digitalHospitalPilotIssueActionMatch[1]);
        const payload = await collectJson(req);
        const data = readDatabase();
        const issues = Array.isArray(data.digitalHospitalPilotIssues) ? data.digitalHospitalPilotIssues : seedDigitalHospitalPilotIssues();
        const index = issues.findIndex((item) => item.id === issueId);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "Digital hospital pilot issue not found" });
          return true;
        }
        try {
          issues[index] = normalizeDigitalHospitalPilotIssueAction(issues[index], payload, user);
        } catch (error) {
          const status = Number(error.status) || 400;
          sendJson(res, status, { error: status === 403 ? "Forbidden" : status === 409 ? "Conflict" : "Bad Request", message: error.message });
          return true;
        }
        data.digitalHospitalPilotIssues = issues;
        data.securityEvents = sealAuditTrail([{
          id: randomUUID(), at: new Date().toISOString(), actor: user.name, role: user.role,
          action: "digital-hospital-pilot-issue-action", target: issueId, result: "allowed",
          detail: `${payload.action} / ${issues[index].status} / ${issues[index].institutionId}`
        }, ...(data.securityEvents || [])].slice(0, 120), { recompute: true });
        writeDatabase(normalizeState(data));
        sendJson(res, 200, { ok: true, issue: issues[index], board: buildDigitalHospitalPilotBoard(readDatabase(), user) });
        return true;
      }

      const digitalHospitalCollectionJobActionMatch = url.pathname.match(/^\/api\/digital-hospital\/collection-jobs\/([^/]+)\/actions$/);
      if (req.method === "POST" && digitalHospitalCollectionJobActionMatch) {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/digital-hospital/collection-jobs/:id/actions");
        if (!user) return true;
        const jobId = decodeURIComponent(digitalHospitalCollectionJobActionMatch[1]);
        const payload = await collectJson(req);
        const data = readDatabase();
        const jobs = Array.isArray(data.digitalHospitalCollectionJobs) ? data.digitalHospitalCollectionJobs : seedDigitalHospitalCollectionJobs();
        const index = jobs.findIndex((item) => item.id === jobId);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "Digital hospital collection job not found" });
          return true;
        }
        try {
          jobs[index] = normalizeDigitalHospitalCollectionJobAction(jobs[index], payload, user);
        } catch (error) {
          const status = Number(error.status) || 400;
          sendJson(res, status, { error: status === 403 ? "Forbidden" : "Bad Request", message: error.message });
          return true;
        }
        data.digitalHospitalCollectionJobs = jobs;
        data.securityEvents = sealAuditTrail([{
          id: randomUUID(), at: new Date().toISOString(), actor: user.name, role: user.role,
          action: "digital-hospital-collection-validation", target: jobId, result: "allowed",
          detail: `${jobs[index].system} / ${jobs[index].sampleSize} rows / ${jobs[index].receiptRef}`
        }, ...(data.securityEvents || [])].slice(0, 120), { recompute: true });
        writeDatabase(normalizeState(data));
        sendJson(res, 200, { ok: true, job: jobs[index], board: buildDigitalHospitalPilotBoard(readDatabase(), user) });
        return true;
      }

      const digitalHospitalEvaluationEvidenceActionMatch = url.pathname.match(/^\/api\/digital-hospital\/evaluation-evidence\/([^/]+)\/actions$/);
      if (req.method === "POST" && digitalHospitalEvaluationEvidenceActionMatch) {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/digital-hospital/evaluation-evidence/:id/actions");
        if (!user) return true;
        const evidenceId = decodeURIComponent(digitalHospitalEvaluationEvidenceActionMatch[1]);
        const payload = await collectJson(req);
        const data = readDatabase();
        const evidence = Array.isArray(data.digitalHospitalEvaluationEvidence) ? data.digitalHospitalEvaluationEvidence : seedDigitalHospitalEvaluationEvidence();
        const index = evidence.findIndex((item) => item.id === evidenceId);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "Digital hospital evaluation evidence not found" });
          return true;
        }
        try {
          evidence[index] = normalizeDigitalHospitalEvaluationEvidenceAction(evidence[index], payload, user);
        } catch (error) {
          const status = Number(error.status) || 400;
          sendJson(res, status, { error: status === 403 ? "Forbidden" : status === 409 ? "Conflict" : "Bad Request", message: error.message });
          return true;
        }
        data.digitalHospitalEvaluationEvidence = evidence;
        data.securityEvents = sealAuditTrail([{
          id: randomUUID(), at: new Date().toISOString(), actor: user.name, role: user.role,
          action: "digital-hospital-evaluation-evidence-action", target: evidenceId, result: "allowed",
          detail: `${payload.action} / ${evidence[index].status} / ${evidence[index].evidenceLevel}`
        }, ...(data.securityEvents || [])].slice(0, 120), { recompute: true });
        writeDatabase(normalizeState(data));
        sendJson(res, 200, { ok: true, evidence: evidence[index], board: buildDigitalHospitalPilotBoard(readDatabase(), user) });
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/digital-hospital/pre-assessments/actions") {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/digital-hospital/pre-assessments/actions");
        if (!user) return true;
        const payload = await collectJson(req);
        if (payload.action !== "run-preassessment") {
          sendJson(res, 400, { error: "Bad Request", message: "Only run-preassessment is accepted" });
          return true;
        }
        const data = readDatabase();
        let assessment;
        try {
          assessment = runDigitalHospitalPreAssessment(payload, user);
        } catch (error) {
          const status = Number(error.status) || 400;
          sendJson(res, status, { error: status === 403 ? "Forbidden" : "Bad Request", message: error.message });
          return true;
        }
        data.digitalHospitalPreAssessments = [assessment, ...(Array.isArray(data.digitalHospitalPreAssessments) ? data.digitalHospitalPreAssessments : seedDigitalHospitalPreAssessments())].slice(0, 50);
        data.securityEvents = sealAuditTrail([{
          id: randomUUID(), at: new Date().toISOString(), actor: user.name, role: user.role,
          action: "digital-hospital-preassessment-run", target: assessment.id, result: "allowed",
          detail: `${assessment.institutionId} / ${assessment.summary.gaps} gaps / pilot simulation only`
        }, ...(data.securityEvents || [])].slice(0, 120), { recompute: true });
        writeDatabase(normalizeState(data));
        sendJson(res, 201, { ok: true, assessment, board: buildDigitalHospitalPilotBoard(readDatabase(), user) });
        return true;
      }

      const digitalHospitalPreAssessmentActionMatch = url.pathname.match(/^\/api\/digital-hospital\/pre-assessments\/([^/]+)\/actions$/);
      if (req.method === "POST" && digitalHospitalPreAssessmentActionMatch) {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/digital-hospital/pre-assessments/:id/actions");
        if (!user) return true;
        const assessmentId = decodeURIComponent(digitalHospitalPreAssessmentActionMatch[1]);
        const payload = await collectJson(req);
        const data = readDatabase();
        const assessments = Array.isArray(data.digitalHospitalPreAssessments) ? data.digitalHospitalPreAssessments : seedDigitalHospitalPreAssessments();
        const index = assessments.findIndex((item) => item.id === assessmentId);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "Digital hospital pre-assessment not found" });
          return true;
        }
        try {
          assessments[index] = normalizeDigitalHospitalPreAssessmentAction(assessments[index], payload, user);
        } catch (error) {
          const status = Number(error.status) || 400;
          sendJson(res, status, { error: status === 403 ? "Forbidden" : status === 409 ? "Conflict" : "Bad Request", message: error.message });
          return true;
        }
        data.digitalHospitalPreAssessments = assessments;
        data.securityEvents = sealAuditTrail([{
          id: randomUUID(), at: new Date().toISOString(), actor: user.name, role: user.role,
          action: "digital-hospital-preassessment-action", target: assessmentId, result: "allowed",
          detail: `${payload.action} / ${assessments[index].status}`
        }, ...(data.securityEvents || [])].slice(0, 120), { recompute: true });
        writeDatabase(normalizeState(data));
        sendJson(res, 200, { ok: true, assessment: assessments[index], board: buildDigitalHospitalPilotBoard(readDatabase(), user) });
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/digital-hospital/self-assessments") {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/digital-hospital/self-assessments");
        if (!user) return true;
        const data = readDatabase();
        const board = buildDigitalHospitalSelfAssessmentBoard(data, user, {
          status: url.searchParams.get("status") || "",
          institutionId: url.searchParams.get("institutionId") || "",
          overdueOnly: url.searchParams.get("overdueOnly") || "",
          reviewOnly: url.searchParams.get("reviewOnly") || "",
          query: url.searchParams.get("q") || ""
        });
        appendSecurityEvent({
          actor: user.name,
          role: user.role,
          action: "digital-hospital-self-assessment-read",
          target: "/api/digital-hospital/self-assessments",
          result: "allowed",
          detail: `${board.summary.filteredAssessments}/${board.summary.assessments} role-scoped assessments returned`
        });
        sendJson(res, 200, board);
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/digital-hospital/self-assessments/actions") {
        const user = requireApiRole(req, res, ["commission"], "/api/digital-hospital/self-assessments/actions");
        if (!user) return true;
        const payload = await collectJson(req);
        if (payload.action !== "assign-assessment") {
          sendJson(res, 400, { error: "Bad Request", message: "Only assign-assessment is accepted on the collection action endpoint" });
          return true;
        }
        const data = readDatabase();
        const assessments = Array.isArray(data.digitalHospitalSelfAssessments)
          ? data.digitalHospitalSelfAssessments
          : seedDigitalHospitalSelfAssessments();
        if (assessments.some((item) => item.institutionId === String(payload.institutionId || "").trim() && item.cycle === String(payload.cycle || "").trim())) {
          sendJson(res, 409, { error: "Conflict", message: "该机构在当前评价周期已有自评任务" });
          return true;
        }
        let assessment;
        try {
          assessment = createDigitalHospitalSelfAssessment(payload, user, { id: `dhsa-${randomUUID()}` });
        } catch (error) {
          sendJson(res, Number(error.status) || 400, { error: Number(error.status) === 403 ? "Forbidden" : "Bad Request", message: error.message });
          return true;
        }
        data.digitalHospitalSelfAssessments = [assessment, ...assessments];
        data.securityEvents = sealAuditTrail([
          {
            id: randomUUID(),
            at: new Date().toLocaleString("zh-CN", { hour12: false }),
            actor: user.name,
            role: user.role,
            action: "digital-hospital-self-assessment-action",
            target: assessment.id,
            result: "allowed",
            detail: `assign-assessment / ${assessment.institutionId} / ${assessment.cycle}`
          },
          ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
        ].slice(0, 120), { recompute: true });
        writeDatabase(normalizeState(data));
        const refreshed = readDatabase();
        sendJson(res, 201, { ok: true, assessment, board: buildDigitalHospitalSelfAssessmentBoard(refreshed, user) });
        return true;
      }

      const digitalHospitalSelfAssessmentActionMatch = url.pathname.match(/^\/api\/digital-hospital\/self-assessments\/([^/]+)\/actions$/);
      if (req.method === "POST" && digitalHospitalSelfAssessmentActionMatch) {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/digital-hospital/self-assessments/:id/actions");
        if (!user) return true;
        const assessmentId = decodeURIComponent(digitalHospitalSelfAssessmentActionMatch[1]);
        const payload = await collectJson(req);
        const data = readDatabase();
        const assessments = Array.isArray(data.digitalHospitalSelfAssessments)
          ? data.digitalHospitalSelfAssessments
          : seedDigitalHospitalSelfAssessments();
        const index = assessments.findIndex((item) => item.id === assessmentId);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "Digital hospital self-assessment not found" });
          return true;
        }
        let normalized;
        try {
          normalized = normalizeDigitalHospitalSelfAssessmentAction(assessments[index], payload, user);
        } catch (error) {
          const status = Number(error.status) || 400;
          sendJson(res, status, { error: status === 403 ? "Forbidden" : status === 409 ? "Conflict" : "Bad Request", message: error.message });
          return true;
        }
        assessments[index] = normalized.assessment;
        data.digitalHospitalSelfAssessments = assessments;
        data.securityEvents = sealAuditTrail([
          {
            id: randomUUID(),
            at: new Date().toLocaleString("zh-CN", { hour12: false }),
            actor: user.name,
            role: user.role,
            action: "digital-hospital-self-assessment-action",
            target: assessmentId,
            result: "allowed",
            detail: `${normalized.event.action} / ${normalized.assessment.status} / ${normalized.assessment.institutionId}`
          },
          ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
        ].slice(0, 120), { recompute: true });
        writeDatabase(normalizeState(data));
        const refreshed = readDatabase();
        sendJson(res, 200, {
          ok: true,
          assessment: normalized.assessment,
          event: normalized.event,
          board: buildDigitalHospitalSelfAssessmentBoard(refreshed, user),
          standards: user.role === "commission" ? buildDigitalHospitalStandardsOverview(refreshed) : undefined
        });
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/digital-hospital/control-matrix") {
        const user = requireApiRole(req, res, ["commission"], "/api/digital-hospital/control-matrix");
        if (!user) return true;
        const data = readDatabase();
        const board = buildDigitalHospitalControlMatrixBoard(data, {
          domain: url.searchParams.get("domain") || "",
          controlStatus: url.searchParams.get("controlStatus") || "",
          blockingOnly: url.searchParams.get("blockingOnly") || "",
          overdueOnly: url.searchParams.get("overdueOnly") || "",
          query: url.searchParams.get("q") || ""
        });
        appendSecurityEvent({
          actor: user.name,
          role: user.role,
          action: "digital-hospital-control-matrix",
          target: "/api/digital-hospital/control-matrix",
          result: "allowed",
          detail: `${board.summary.filteredControls}/${board.summary.controls} controls returned`
        });
        sendJson(res, 200, board);
        return true;
      }

      const digitalHospitalControlActionMatch = url.pathname.match(/^\/api\/digital-hospital\/control-matrix\/([^/]+)\/actions$/);
      if (req.method === "POST" && digitalHospitalControlActionMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/digital-hospital/control-matrix/:id/actions");
        if (!user) return true;
        const controlId = decodeURIComponent(digitalHospitalControlActionMatch[1]);
        const payload = await collectJson(req);
        const data = readDatabase();
        const controls = Array.isArray(data.digitalHospitalControlMatrix)
          ? data.digitalHospitalControlMatrix
          : seedDigitalHospitalControlMatrix();
        const index = controls.findIndex((item) => item.id === controlId);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "Digital hospital control not found" });
          return true;
        }
        let normalized;
        try {
          normalized = normalizeDigitalHospitalControlAction(controls[index], payload, user);
        } catch (error) {
          sendJson(res, Number(error.status) || 400, {
            error: Number(error.status) === 409 ? "Conflict" : "Bad Request",
            message: error.message
          });
          return true;
        }
        controls[index] = normalized.control;
        data.digitalHospitalControlMatrix = controls;
        data.securityEvents = [
          {
            id: randomUUID(),
            at: new Date().toLocaleString("zh-CN", { hour12: false }),
            actor: user.name,
            role: user.role,
            action: "digital-hospital-control-action",
            target: controlId,
            result: "allowed",
            detail: `${normalized.action.action} / ${normalized.control.controlStatus}`
          },
          ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
        ].slice(0, 120);
        data.securityEvents = sealAuditTrail(data.securityEvents, { recompute: true });
        writeDatabase(normalizeState(data));
        const refreshed = readDatabase();
        sendJson(res, 200, {
          ok: true,
          control: normalized.control,
          action: normalized.action,
          board: buildDigitalHospitalControlMatrixBoard(refreshed),
          standards: buildDigitalHospitalStandardsOverview(refreshed)
        });
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/digital-hospital/policy-register") {
        const user = requireApiRole(req, res, ["commission"], "/api/digital-hospital/policy-register");
        if (!user) return true;
        const data = readDatabase();
        const board = buildDigitalHospitalPolicyRegisterBoard(data, {
          domain: url.searchParams.get("domain") || "",
          bindingLevel: url.searchParams.get("bindingLevel") || "",
          lifecycleStatus: url.searchParams.get("lifecycleStatus") || "",
          query: url.searchParams.get("q") || ""
        });
        appendSecurityEvent({
          actor: user.name,
          role: user.role,
          action: "digital-hospital-policy-register",
          target: "/api/digital-hospital/policy-register",
          result: "allowed",
          detail: `${board.summary.filteredPolicies}/${board.summary.policies} policies returned`
        });
        sendJson(res, 200, board);
        return true;
      }

      const digitalHospitalPolicyReviewMatch = url.pathname.match(/^\/api\/digital-hospital\/policy-register\/([^/]+)\/actions$/);
      if (req.method === "POST" && digitalHospitalPolicyReviewMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/digital-hospital/policy-register/:id/actions");
        if (!user) return true;
        const policyId = decodeURIComponent(digitalHospitalPolicyReviewMatch[1]);
        const payload = await collectJson(req);
        const data = readDatabase();
        const policies = Array.isArray(data.digitalHospitalPolicyRegister) ? data.digitalHospitalPolicyRegister : seedDigitalHospitalPolicyRegister();
        const index = policies.findIndex((item) => item.id === policyId);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "Digital hospital policy record not found" });
          return true;
        }
        let normalized;
        try {
          normalized = normalizeDigitalHospitalPolicyReview(policies[index], payload, user);
        } catch (error) {
          sendJson(res, 400, { error: "Bad Request", message: error.message });
          return true;
        }
        policies[index] = normalized.policy;
        data.digitalHospitalPolicyRegister = policies;
        data.securityEvents = [
          {
            id: randomUUID(),
            at: new Date().toLocaleString("zh-CN", { hour12: false }),
            actor: user.name,
            role: user.role,
            action: "digital-hospital-policy-review",
            target: policyId,
            result: "allowed",
            detail: `${normalized.action.reviewStatus} / ${normalized.action.nextReviewAt || "historical"}`
          },
          ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
        ].slice(0, 120);
        data.securityEvents = sealAuditTrail(data.securityEvents, { recompute: true });
        writeDatabase(normalizeState(data));
        const refreshed = readDatabase();
        sendJson(res, 200, {
          ok: true,
          policy: normalized.policy,
          action: normalized.action,
          board: buildDigitalHospitalPolicyRegisterBoard(refreshed),
          standards: buildDigitalHospitalStandardsOverview(refreshed)
        });
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/digital-hospital/standards") {
        const user = requireApiRole(req, res, ["commission"], "/api/digital-hospital/standards");
        if (!user) return true;
        const data = readDatabase();
        sendJson(res, 200, buildDigitalHospitalStandardsOverview(data));
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/digital-hospital/launch-readiness") {
        const user = requireApiRole(req, res, ["commission"], "/api/digital-hospital/launch-readiness");
        if (!user) return true;
        const data = readDatabase();
        const launchReadiness = buildDigitalHospitalLaunchReadiness(data);
        appendSecurityEvent({
          actor: user.name,
          role: user.role,
          action: "digital-hospital-launch-readiness",
          target: "/api/digital-hospital/launch-readiness",
          result: "allowed",
          detail: `${launchReadiness.launchGate.releaseGate} / ${launchReadiness.summary.formalBlockers} formal blockers`
        });
        sendJson(res, 200, launchReadiness);
        return true;
      }

      const digitalHospitalLaunchActionMatch = url.pathname.match(/^\/api\/digital-hospital\/launch-readiness\/([^/]+)\/actions$/);
      if (req.method === "POST" && digitalHospitalLaunchActionMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/digital-hospital/launch-readiness/:id/actions");
        if (!user) return true;
        const requirementId = decodeURIComponent(digitalHospitalLaunchActionMatch[1]);
        const payload = await collectJson(req);
        const data = readDatabase();
        const requirements = Array.isArray(data.digitalHospitalLaunchRequirements) ? data.digitalHospitalLaunchRequirements : seedDigitalHospitalLaunchRequirements();
        const index = requirements.findIndex((item) => item.id === requirementId);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "Digital hospital launch requirement not found" });
          return true;
        }
        const normalized = normalizeDigitalHospitalLaunchRequirementAction(requirements[index], payload, user);
        requirements[index] = normalized.item;
        data.digitalHospitalLaunchRequirements = requirements;
        data.securityEvents = [
          {
            id: randomUUID(),
            at: new Date().toLocaleString("zh-CN", { hour12: false }),
            actor: user.name,
            role: user.role,
            action: "digital-hospital-launch-requirement-action",
            target: requirementId,
            result: "allowed",
            detail: `${normalized.history.action} / ${normalized.history.status}`
          },
          ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
        ].slice(0, 120);
        data.securityEvents = sealAuditTrail(data.securityEvents, { recompute: true });
        writeDatabase(normalizeState(data));
        const refreshed = readDatabase();
        sendJson(res, 200, {
          ok: true,
          requirement: normalized.item,
          action: normalized.history,
          launchReadiness: buildDigitalHospitalLaunchReadiness(refreshed),
          standards: buildDigitalHospitalStandardsOverview(refreshed)
        });
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/digital-hospital/production-evidence-packets") {
        const user = requireApiRole(req, res, ["commission"], "/api/digital-hospital/production-evidence-packets");
        if (!user) return true;
        const data = readDatabase();
        const requirements = Array.isArray(data.digitalHospitalLaunchRequirements) ? data.digitalHospitalLaunchRequirements : seedDigitalHospitalLaunchRequirements();
        const packets = Array.isArray(data.digitalHospitalProductionEvidencePackets) ? data.digitalHospitalProductionEvidencePackets : seedDigitalHospitalProductionEvidencePackets();
        const board = buildDigitalHospitalProductionEvidenceBoard(packets, requirements);
        appendSecurityEvent({
          actor: user.name,
          role: user.role,
          action: "digital-hospital-production-evidence-packets",
          target: "/api/digital-hospital/production-evidence-packets",
          result: "allowed",
          detail: `${board.summary.verifiedItems}/${board.summary.requiredItems} evidence items verified`
        });
        sendJson(res, 200, {
          ok: true,
          generatedAt: new Date().toISOString(),
          summary: board.summary,
          board,
          packets: board.packets,
          launchReadiness: buildDigitalHospitalLaunchReadiness(data)
        });
        return true;
      }

      const digitalHospitalProductionEvidenceActionMatch = url.pathname.match(/^\/api\/digital-hospital\/production-evidence-packets\/([^/]+)\/actions$/);
      if (req.method === "POST" && digitalHospitalProductionEvidenceActionMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/digital-hospital/production-evidence-packets/:id/actions");
        if (!user) return true;
        const packetId = decodeURIComponent(digitalHospitalProductionEvidenceActionMatch[1]);
        const payload = await collectJson(req);
        const data = readDatabase();
        const packets = Array.isArray(data.digitalHospitalProductionEvidencePackets) ? data.digitalHospitalProductionEvidencePackets : seedDigitalHospitalProductionEvidencePackets();
        const index = packets.findIndex((item) => item.id === packetId);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "digital hospital production evidence packet not found" });
          return true;
        }
        let normalized;
        try {
          normalized = normalizeDigitalHospitalProductionEvidencePacketAction(packets[index], payload, user);
        } catch (error) {
          sendJson(res, 400, { error: "Bad Request", message: error.message });
          return true;
        }
        packets[index] = normalized.packet;
        data.digitalHospitalProductionEvidencePackets = packets;
        const requirements = Array.isArray(data.digitalHospitalLaunchRequirements) ? data.digitalHospitalLaunchRequirements : seedDigitalHospitalLaunchRequirements();
        data.digitalHospitalLaunchRequirements = requirements.map((item) => {
          if (item.id !== normalized.packet.linkedRequirementId || normalized.packet.signoffStatus !== "signed") return item;
          return {
            ...item,
            status: "signed",
            siteSigned: true,
            evidence: Array.from(new Set([...(item.evidence || []), normalized.history.artifactName, "digitalHospitalProductionEvidencePackets"].filter(Boolean))),
            latestAction: normalized.history,
            auditTrail: [normalized.history, ...(Array.isArray(item.auditTrail) ? item.auditTrail : [])].slice(0, 20),
            updatedAt: new Date().toISOString(),
            updatedBy: user.username || user.role || "commission",
            updatedByName: user.name || "digital hospital operator"
          };
        });
        data.securityEvents = [
          {
            id: randomUUID(),
            at: new Date().toLocaleString("zh-CN", { hour12: false }),
            actor: user.name,
            role: user.role,
            action: "digital-hospital-production-evidence-packet-action",
            target: packetId,
            result: "allowed",
            detail: `${normalized.history.itemId} / ${normalized.history.status}`
          },
          ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
        ].slice(0, 120);
        writeDatabase(data);
        const refreshed = readDatabase();
        const launchReadiness = buildDigitalHospitalLaunchReadiness(refreshed);
        sendJson(res, 200, {
          ok: true,
          packet: normalized.packet,
          action: normalized.history,
          board: launchReadiness.productionEvidenceBoard,
          launchReadiness,
          standards: buildDigitalHospitalStandardsOverview(refreshed)
        });
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/digital-hospital/launch-command-briefs") {
        const user = requireApiRole(req, res, ["commission"], "/api/digital-hospital/launch-command-briefs");
        if (!user) return true;
        const data = readDatabase();
        const briefs = Array.isArray(data.digitalHospitalLaunchCommandBriefs) ? data.digitalHospitalLaunchCommandBriefs : seedDigitalHospitalLaunchCommandBriefs();
        const board = buildDigitalHospitalLaunchCommandBriefBoard(briefs);
        appendSecurityEvent({
          actor: user.name,
          role: user.role,
          action: "digital-hospital-launch-command-briefs",
          target: "/api/digital-hospital/launch-command-briefs",
          result: "allowed",
          detail: `${board.summary.readyBriefs}/${board.summary.briefs} launch command briefs ready`
        });
        sendJson(res, 200, {
          ok: true,
          generatedAt: new Date().toISOString(),
          summary: board.summary,
          board,
          briefs: board.briefs,
          launchReadiness: buildDigitalHospitalLaunchReadiness(data)
        });
        return true;
      }

      const digitalHospitalLaunchCommandBriefActionMatch = url.pathname.match(/^\/api\/digital-hospital\/launch-command-briefs\/([^/]+)\/actions$/);
      if (req.method === "POST" && digitalHospitalLaunchCommandBriefActionMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/digital-hospital/launch-command-briefs/:id/actions");
        if (!user) return true;
        const briefId = decodeURIComponent(digitalHospitalLaunchCommandBriefActionMatch[1]);
        const payload = await collectJson(req);
        const data = readDatabase();
        const briefs = Array.isArray(data.digitalHospitalLaunchCommandBriefs) ? data.digitalHospitalLaunchCommandBriefs : seedDigitalHospitalLaunchCommandBriefs();
        const index = briefs.findIndex((item) => item.id === briefId);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "digital hospital launch command brief not found" });
          return true;
        }
        let normalized;
        try {
          normalized = normalizeDigitalHospitalLaunchCommandBriefAction(briefs[index], payload, user);
        } catch (error) {
          sendJson(res, 400, { error: "Bad Request", message: error.message });
          return true;
        }
        briefs[index] = normalized.brief;
        data.digitalHospitalLaunchCommandBriefs = briefs;
        data.digitalHospitalLaunchRequirements = (Array.isArray(data.digitalHospitalLaunchRequirements) ? data.digitalHospitalLaunchRequirements : seedDigitalHospitalLaunchRequirements()).map((item) => (
          Array.isArray(normalized.brief.linkedRequirementIds) && normalized.brief.linkedRequirementIds.includes(item.id)
            ? { ...item, evidence: Array.from(new Set([...(item.evidence || []), "digitalHospitalLaunchCommandBriefs", normalized.history.artifactName].filter(Boolean))), latestBriefAction: normalized.history }
            : item
        ));
        data.securityEvents = [
          {
            id: randomUUID(),
            at: new Date().toLocaleString("zh-CN", { hour12: false }),
            actor: user.name,
            role: user.role,
            action: "digital-hospital-launch-command-brief-action",
            target: briefId,
            result: "allowed",
            detail: `${normalized.history.status} / ${normalized.history.publishChannel}`
          },
          ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
        ].slice(0, 120);
        writeDatabase(data);
        const refreshed = readDatabase();
        const launchReadiness = buildDigitalHospitalLaunchReadiness(refreshed);
        sendJson(res, 200, {
          ok: true,
          brief: normalized.brief,
          action: normalized.history,
          board: launchReadiness.launchCommandBriefBoard,
          launchReadiness,
          standards: buildDigitalHospitalStandardsOverview(refreshed)
        });
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/digital-hospital/formal-cutover-approvals") {
        const user = requireApiRole(req, res, ["commission"], "/api/digital-hospital/formal-cutover-approvals");
        if (!user) return true;
        const data = readDatabase();
        const launchReadiness = buildDigitalHospitalLaunchReadiness(data);
        const board = launchReadiness.formalCutoverApprovalBoard;
        appendSecurityEvent({
          actor: user.name,
          role: user.role,
          action: "digital-hospital-formal-cutover-approvals",
          target: "/api/digital-hospital/formal-cutover-approvals",
          result: "allowed",
          detail: `${board.summary.approvedApprovals}/${board.summary.approvals} formal cutover approvals`
        });
        sendJson(res, 200, {
          ok: true,
          generatedAt: new Date().toISOString(),
          summary: board.summary,
          board,
          approvals: board.approvals,
          launchReadiness
        });
        return true;
      }

      const digitalHospitalFormalCutoverApprovalActionMatch = url.pathname.match(/^\/api\/digital-hospital\/formal-cutover-approvals\/([^/]+)\/actions$/);
      if (req.method === "POST" && digitalHospitalFormalCutoverApprovalActionMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/digital-hospital/formal-cutover-approvals/:id/actions");
        if (!user) return true;
        const approvalId = decodeURIComponent(digitalHospitalFormalCutoverApprovalActionMatch[1]);
        const payload = await collectJson(req);
        const data = readDatabase();
        const approvals = Array.isArray(data.digitalHospitalFormalCutoverApprovals) ? data.digitalHospitalFormalCutoverApprovals : seedDigitalHospitalFormalCutoverApprovals();
        const index = approvals.findIndex((item) => item.id === approvalId);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "digital hospital formal cutover approval not found" });
          return true;
        }
        const currentReadiness = buildDigitalHospitalLaunchReadiness(data);
        let normalized;
        try {
          normalized = normalizeDigitalHospitalFormalCutoverApprovalAction(approvals[index], payload, user, approvals, currentReadiness.formalCutoverApprovalBoard);
        } catch (error) {
          const blocked = /blocked until all site evidence/i.test(String(error.message || ""));
          data.securityEvents = sealAuditTrail([
            {
              id: randomUUID(),
              at: new Date().toLocaleString("zh-CN", { hour12: false }),
              actor: user.name,
              role: user.role,
              action: "digital-hospital-formal-cutover-approval-action",
              target: approvalId,
              result: blocked ? "blocked" : "denied",
              detail: String(error.message || "formal cutover approval rejected")
            },
            ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
          ].slice(0, 120), { recompute: true });
          writeDatabase(normalizeState(data));
          sendJson(res, blocked ? 409 : 400, { error: blocked ? "Conflict" : "Bad Request", message: error.message, launchReadiness: currentReadiness });
          return true;
        }
        approvals[index] = normalized.approval;
        data.digitalHospitalFormalCutoverApprovals = approvals;
        data.securityEvents = sealAuditTrail([
          {
            id: randomUUID(),
            at: new Date().toLocaleString("zh-CN", { hour12: false }),
            actor: user.name,
            role: user.role,
            action: "digital-hospital-formal-cutover-approval-action",
            target: approvalId,
            result: "allowed",
            detail: `${normalized.history.status} / ${normalized.history.changeTicket || "no-ticket"}`
          },
          ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
        ].slice(0, 120), { recompute: true });
        writeDatabase(normalizeState(data));
        const refreshed = readDatabase();
        const launchReadiness = buildDigitalHospitalLaunchReadiness(refreshed);
        sendJson(res, 200, {
          ok: true,
          approval: normalized.approval,
          action: normalized.history,
          board: launchReadiness.formalCutoverApprovalBoard,
          launchReadiness,
          standards: buildDigitalHospitalStandardsOverview(refreshed)
        });
        return true;
      }
        return false;
      }
    },
    {
      id: "platform-governance-08",
      domain: "platform-governance",
      async handle(req, res, url) {
    if (req.method === "GET" && url.pathname === "/api/production-database/cutover-center") {
        const user = requireApiRole(req, res, ["commission"], "/api/production-database/cutover-center");
        if (!user) return true;
        const data = readDatabase();
        const center = buildProductionDatabaseCutoverCenter(data);
        appendSecurityEvent({
          actor: user.name,
          role: user.role,
          action: "production-database-cutover-center-read",
          target: "/api/production-database/cutover-center",
          result: "allowed",
          detail: `${center.summary.migrationBatches} batches / ${center.summary.cutoverRuns} rehearsal runs`
        });
        sendJson(res, 200, { ok: center.ok, generatedAt: new Date().toISOString(), center });
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/platform/capability-operations") {
        const user = requireApiRole(req, res, ["commission"], "/api/platform/capability-operations");
        if (!user) return true;
        const center = buildPlatformCapabilityOperationsCenter(readDatabase());
        appendSecurityEvent({
          actor: user.name,
          role: user.role,
          action: "platform-capability-operations-read",
          target: "/api/platform/capability-operations",
          result: "allowed",
          detail: `${center.summary.reviewedPreproduction}/${center.summary.capabilityDomains} reviewed / production ready 0`
        });
        sendJson(res, 200, { ok: center.ok, generatedAt: center.generatedAt, center });
        return true;
      }

      const platformCapabilityActionMatch = url.pathname.match(/^\/api\/platform\/capability-operations\/([^/]+)\/actions$/);
      if (req.method === "POST" && platformCapabilityActionMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/platform/capability-operations/:id/actions");
        if (!user) return true;
        const payload = await collectJson(req);
        const capabilityId = decodeURIComponent(platformCapabilityActionMatch[1]);
        const data = readDatabase();
        try {
          const normalized = applyPlatformCapabilityReviewAction(data, capabilityId, payload, user);
          data.platformCapabilityReviews = normalized.reviews;
          data.securityEvents = sealAuditTrail([
            {
              id: randomUUID(),
              at: new Date().toLocaleString("zh-CN", { hour12: false }),
              actor: user.name,
              role: user.role,
              action: "platform-capability-review-action",
              target: capabilityId,
              result: "allowed",
              detail: `${normalized.history.action} / ${normalized.history.fromStatus} -> ${normalized.history.toStatus} / production ready false`
            },
            ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
          ].slice(0, 120), { recompute: true });
          writeDatabase(normalizeState(data));
          sendJson(res, 200, {
            ok: true,
            capability: normalized.item,
            action: normalized.history,
            center: buildPlatformCapabilityOperationsCenter(readDatabase())
          });
        } catch (error) {
          const status = error.statusCode || 400;
          sendJson(res, status, {
            error: status === 404 ? "Not Found" : status === 409 ? "Conflict" : "Bad Request",
            code: error.code || "PLATFORM_CAPABILITY_ACTION_FAILED",
            message: error.message
          });
        }
        return true;
      }

      const platformProductionBlockerActionMatch = url.pathname.match(/^\/api\/platform\/capability-operations\/blockers\/([^/]+)\/actions$/);
      if (req.method === "POST" && platformProductionBlockerActionMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/platform/capability-operations/blockers/:id/actions");
        if (!user) return true;
        const payload = await collectJson(req);
        const blockerId = decodeURIComponent(platformProductionBlockerActionMatch[1]);
        const data = readDatabase();
        try {
          const normalized = applyPlatformProductionBlockerAction(data, blockerId, payload, user);
          data.platformProductionBlockerReviews = normalized.reviews;
          data.securityEvents = sealAuditTrail([
            {
              id: randomUUID(),
              at: new Date().toLocaleString("zh-CN", { hour12: false }),
              actor: user.name,
              role: user.role,
              action: "platform-production-blocker-action",
              target: blockerId,
              result: "allowed",
              detail: `${normalized.history.action} / ${normalized.history.fromStatus} -> ${normalized.history.toStatus} / site acceptance required`
            },
            ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
          ].slice(0, 120), { recompute: true });
          writeDatabase(normalizeState(data));
          sendJson(res, 200, {
            ok: true,
            blocker: normalized.item,
            action: normalized.history,
            center: buildPlatformCapabilityOperationsCenter(readDatabase())
          });
        } catch (error) {
          const status = error.statusCode || 400;
          sendJson(res, status, {
            error: status === 404 ? "Not Found" : status === 409 ? "Conflict" : "Bad Request",
            code: error.code || "PLATFORM_PRODUCTION_BLOCKER_ACTION_FAILED",
            message: error.message
          });
        }
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/commercial-crypto/center") {
        const user = requireApiRole(req, res, ["commission"], "/api/commercial-crypto/center");
        if (!user) return true;
        const center = buildCommercialCryptoCenter(readDatabase());
        appendSecurityEvent({
          actor: user.name,
          role: user.role,
          action: "commercial-crypto-center-read",
          target: "/api/commercial-crypto/center",
          result: "allowed",
          detail: `${center.summary.contractsReady}/${center.summary.capabilities} contracts / ${center.summary.primitiveAvailability}/3 runtime primitives / production ready 0`
        });
        sendJson(res, 200, { ok: center.ok, generatedAt: new Date().toISOString(), center });
        return true;
      }

      const commercialCryptoActionMatch = url.pathname.match(/^\/api\/commercial-crypto\/capabilities\/([^/]+)\/actions$/);
      if (req.method === "POST" && commercialCryptoActionMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/commercial-crypto/capabilities/:id/actions");
        if (!user) return true;
        const payload = await collectJson(req);
        const capabilityId = decodeURIComponent(commercialCryptoActionMatch[1]);
        const data = readDatabase();
        const capabilities = mergeByKey(seedCommercialCryptoCapabilities(), data.commercialCryptoCapabilities, "id");
        const index = capabilities.findIndex((item) => item.id === capabilityId);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "commercial crypto capability not found" });
          return true;
        }
        let normalized;
        try {
          normalized = applyCommercialCryptoAction(capabilities[index], payload, user);
        } catch (error) {
          sendJson(res, 400, { error: "Bad Request", message: error.message });
          return true;
        }
        capabilities[index] = normalized.item;
        data.commercialCryptoCapabilities = capabilities;
        if (normalized.probeRun) {
          data.commercialCryptoProbeRuns = [normalized.probeRun, ...(Array.isArray(data.commercialCryptoProbeRuns) ? data.commercialCryptoProbeRuns : [])].slice(0, 40);
        }
        if (normalized.evidencePacket) {
          data.commercialCryptoEvidencePackets = [normalized.evidencePacket, ...mergeByKey(seedCommercialCryptoEvidencePackets(), data.commercialCryptoEvidencePackets, "id")].slice(0, 80);
        }
        data.securityEvents = sealAuditTrail([
          {
            id: randomUUID(),
            at: new Date().toLocaleString("zh-CN", { hour12: false }),
            actor: user.name,
            role: user.role,
            action: "commercial-crypto-action",
            target: capabilityId,
            result: "allowed",
            detail: `${normalized.history.action} / ${normalized.history.fromStatus} -> ${normalized.history.toStatus} / production ready false`
          },
          ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
        ].slice(0, 120), { recompute: true });
        writeDatabase(normalizeState(data));
        const refreshed = readDatabase();
        sendJson(res, 200, {
          ok: true,
          capability: normalized.item,
          action: normalized.history,
          probeRun: normalized.probeRun,
          evidencePacket: normalized.evidencePacket,
          center: buildCommercialCryptoCenter(refreshed)
        });
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/production-database/adapter") {
        const user = requireApiRole(req, res, ["commission"], "/api/production-database/adapter");
        if (!user) return true;
        try {
          const config = buildPostgresProductionAdapterConfig(process.env);
          sendJson(res, 200, {
            ok: true,
            configured: config.configured,
            adapterMode: config.adapterMode,
            writeMode: config.writeMode,
            writeEnabled: config.writeEnabled,
            evidenceReady: config.evidenceReady,
            requirements: config.requirements,
            capabilities: {
              readTransaction: "repeatable-read-read-only",
              writeTransaction: "serializable",
              optimisticLock: "all-collection-versions",
              writeAudit: "runtime_primary_write_audit"
            },
            productionPrimary: false,
            runtimeCutoverEnabled: false
          });
        } catch (error) {
          sendJson(res, error.statusCode || 400, { error: "Bad Request", code: error.code || "POSTGRES_ADAPTER_CONFIG_INVALID", message: error.message });
        }
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/production-database/primary-read-rehearsal") {
        const user = requireApiRole(req, res, ["commission"], "/api/production-database/primary-read-rehearsal");
        if (!user) return true;
        const requirements = {
          readMode: POSTGRES_PRIMARY_READ_MODE === "rehearsal",
          shadowSync: POSTGRES_SYNC_MODE === "outbox",
          sqliteBaseline: shouldUseSqlite() && fs.existsSync(SQLITE_FILE),
          databaseUrl: Boolean(process.env.DATABASE_URL)
        };
        sendJson(res, 200, {
          ok: true,
          configured: Object.values(requirements).every(Boolean),
          mode: POSTGRES_PRIMARY_READ_MODE,
          requirements,
          transaction: "repeatable-read-read-only",
          productionPrimary: false,
          writePrimary: false,
          runtimeCutoverEnabled: false
        });
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/production-database/primary-read-rehearsal") {
        const user = requireApiRole(req, res, ["commission"], "/api/production-database/primary-read-rehearsal");
        if (!user) return true;
        const payload = await collectJson(req);
        const note = String(payload.note || "").trim();
        if (note.length < 8) {
          sendJson(res, 400, { error: "Bad Request", code: "PRIMARY_READ_REHEARSAL_NOTE_REQUIRED", message: "Primary read rehearsal requires an operational note" });
          return true;
        }
        const configured = POSTGRES_PRIMARY_READ_MODE === "rehearsal"
          && POSTGRES_SYNC_MODE === "outbox"
          && shouldUseSqlite()
          && fs.existsSync(SQLITE_FILE)
          && Boolean(process.env.DATABASE_URL);
        if (!configured) {
          sendJson(res, 409, { error: "Conflict", code: "PRIMARY_READ_REHEARSAL_NOT_CONFIGURED", message: "PostgreSQL primary read rehearsal configuration is incomplete" });
          return true;
        }
        try {
          const result = await runPostgresPrimaryReadRehearsal({
            mode: POSTGRES_PRIMARY_READ_MODE,
            syncMode: POSTGRES_SYNC_MODE,
            sqliteFile: SQLITE_FILE,
            env: process.env,
            requiredCollections: Array.isArray(payload.requiredCollections) ? payload.requiredCollections : []
          });
          appendSecurityEvent({
            actor: user.name,
            role: user.role,
            action: "postgres-primary-read-rehearsal",
            target: result.report.runId,
            result: "allowed",
            detail: `${result.report.status}; ${result.report.collections} collections; production primary false`
          });
          sendJson(res, 200, { ok: true, report: result.report });
        } catch (error) {
          sendJson(res, error.statusCode || 502, {
            error: error.statusCode === 409 ? "Conflict" : "Bad Gateway",
            code: error.code || "POSTGRES_PRIMARY_READ_FAILED",
            message: error.message === "PostgreSQL primary read rehearsal failed" ? error.message : "PostgreSQL primary read rehearsal was blocked by verification"
          });
        }
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/production-database/shadow-reconciliation") {
        const user = requireApiRole(req, res, ["commission"], "/api/production-database/shadow-reconciliation");
        if (!user) return true;
        const report = shouldUseSqlite() ? readLatestPostgresReconciliation(SQLITE_FILE) : null;
        const caseLedger = shouldUseSqlite() ? listPostgresReconciliationCases(SQLITE_FILE, { limit: 20 }) : null;
        sendJson(res, 200, {
          ok: true,
          configured: POSTGRES_SYNC_MODE === "outbox",
          productionPrimary: false,
          report,
          cases: caseLedger
        });
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/production-database/shadow-reconciliations") {
        const user = requireApiRole(req, res, ["commission"], "/api/production-database/shadow-reconciliations");
        if (!user) return true;
        try {
          const runs = shouldUseSqlite()
            ? listPostgresReconciliationHistory(SQLITE_FILE, { limit: url.searchParams.get("limit"), status: url.searchParams.get("status") })
            : [];
          sendJson(res, 200, {
            ok: true,
            configured: POSTGRES_SYNC_MODE === "outbox",
            productionPrimary: false,
            summary: {
              runs: runs.length,
              matched: runs.filter((item) => item.status === "matched").length,
              mismatched: runs.filter((item) => item.status === "mismatched").length,
              errors: runs.filter((item) => item.status === "error").length
            },
            runs
          });
        } catch (error) {
          sendJson(res, error.statusCode || 400, { error: "Bad Request", code: error.code || "RECONCILIATION_HISTORY_QUERY_FAILED", message: error.message });
        }
        return true;
      }

      const shadowReconciliationRunMatch = url.pathname.match(/^\/api\/production-database\/shadow-reconciliations\/([^/]+)$/);
      if (req.method === "GET" && shadowReconciliationRunMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/production-database/shadow-reconciliations/:id");
        if (!user) return true;
        const run = shouldUseSqlite() ? readPostgresReconciliationRun(SQLITE_FILE, decodeURIComponent(shadowReconciliationRunMatch[1])) : null;
        if (!run) {
          sendJson(res, 404, { error: "Not Found", code: "RECONCILIATION_RUN_NOT_FOUND", message: "Shadow reconciliation run not found" });
          return true;
        }
        sendJson(res, 200, { ok: true, productionPrimary: false, run });
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/production-database/reconciliation-cases") {
        const user = requireApiRole(req, res, ["commission"], "/api/production-database/reconciliation-cases");
        if (!user) return true;
        try {
          const ledger = shouldUseSqlite()
            ? listPostgresReconciliationCases(SQLITE_FILE, { limit: url.searchParams.get("limit"), status: url.searchParams.get("status") })
            : { summary: { total: 0, open: 0, acknowledged: 0, resolved: 0, reopened: 0, unresolved: 0, clearedAwaitingResolution: 0 }, cases: [] };
          sendJson(res, 200, { ok: true, configured: POSTGRES_SYNC_MODE === "outbox", productionPrimary: false, ...ledger });
        } catch (error) {
          sendJson(res, error.statusCode || 400, { error: "Bad Request", code: error.code || "RECONCILIATION_CASE_QUERY_FAILED", message: error.message });
        }
        return true;
      }

      const reconciliationCaseMatch = url.pathname.match(/^\/api\/production-database\/reconciliation-cases\/([^/]+)$/);
      if (req.method === "GET" && reconciliationCaseMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/production-database/reconciliation-cases/:id");
        if (!user) return true;
        const item = shouldUseSqlite() ? readPostgresReconciliationCase(SQLITE_FILE, decodeURIComponent(reconciliationCaseMatch[1])) : null;
        if (!item) {
          sendJson(res, 404, { error: "Not Found", code: "RECONCILIATION_CASE_NOT_FOUND", message: "Reconciliation case not found" });
          return true;
        }
        sendJson(res, 200, { ok: true, productionPrimary: false, case: item });
        return true;
      }

      const reconciliationCaseActionMatch = url.pathname.match(/^\/api\/production-database\/reconciliation-cases\/([^/]+)\/actions$/);
      if (req.method === "POST" && reconciliationCaseActionMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/production-database/reconciliation-cases/:id/actions");
        if (!user) return true;
        if (!shouldUseSqlite()) {
          sendJson(res, 409, { error: "Conflict", code: "RECONCILIATION_CASE_LEDGER_UNAVAILABLE", message: "SQLite reconciliation case ledger is unavailable" });
          return true;
        }
        const payload = await collectJson(req);
        try {
          const item = applyPostgresReconciliationCaseAction(
            SQLITE_FILE,
            decodeURIComponent(reconciliationCaseActionMatch[1]),
            payload,
            user
          );
          appendSecurityEvent({
            actor: user.name,
            role: user.role,
            action: "postgres-reconciliation-case-action",
            target: item.caseId,
            result: "allowed",
            detail: `${String(payload.action || "").slice(0, 40)} -> ${item.status}; evidence refs: ${Array.isArray(payload.evidenceRefs) ? payload.evidenceRefs.length : 0}`
          });
          sendJson(res, 200, { ok: true, productionPrimary: false, case: item });
        } catch (error) {
          sendJson(res, error.statusCode || 400, { error: error.statusCode === 404 ? "Not Found" : error.statusCode === 409 ? "Conflict" : "Bad Request", code: error.code || "RECONCILIATION_CASE_ACTION_FAILED", message: error.message });
        }
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/production-database/cutover-runs") {
        const user = requireApiRole(req, res, ["commission"], "/api/production-database/cutover-runs");
        if (!user) return true;
        const payload = await collectJson(req);
        const data = readDatabase();
        const run = createProductionDatabaseCutoverRun(data, {
          createdBy: user.name,
          note: payload.note
        });
        data.productionDatabaseMigrationBatches = mergeByKey(seedProductionDatabaseMigrationBatches(), data.productionDatabaseMigrationBatches, "id");
        data.productionDatabaseCutoverRuns = [
          run,
          ...mergeByKey(seedProductionDatabaseCutoverRuns(), data.productionDatabaseCutoverRuns, "id").filter((item) => item.id !== run.id)
        ].slice(0, 20);
        data.securityEvents = sealAuditTrail([
          {
            id: randomUUID(),
            at: new Date().toLocaleString("zh-CN", { hour12: false }),
            actor: user.name,
            role: user.role,
            action: "production-database-cutover-rehearsal",
            target: run.id,
            result: "allowed",
            detail: `${run.status} / ${run.sampleValidations.filter((item) => item.passed).length}/${run.sampleValidations.length} sample validations`
          },
          ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
        ].slice(0, 120), { recompute: true });
        writeDatabase(normalizeState(data));
        const center = buildProductionDatabaseCutoverCenter(readDatabase());
        sendJson(res, 201, { ok: true, run, center });
        return true;
      }

      const productionDatabaseCutoverActionMatch = url.pathname.match(/^\/api\/production-database\/cutover-runs\/([^/]+)\/actions$/);
      if (req.method === "POST" && productionDatabaseCutoverActionMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/production-database/cutover-runs/:id/actions");
        if (!user) return true;
        const payload = await collectJson(req);
        const data = readDatabase();
        const runs = mergeByKey(seedProductionDatabaseCutoverRuns(), data.productionDatabaseCutoverRuns, "id");
        const runId = decodeURIComponent(productionDatabaseCutoverActionMatch[1]);
        const index = runs.findIndex((item) => item.id === runId);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "production database cutover run not found" });
          return true;
        }
        let normalized;
        try {
          normalized = applyProductionDatabaseCutoverAction(runs[index], payload, user);
        } catch (error) {
          sendJson(res, 400, { error: "Bad Request", message: error.message });
          return true;
        }
        runs[index] = normalized.run;
        data.productionDatabaseCutoverRuns = runs;
        data.securityEvents = sealAuditTrail([
          {
            id: randomUUID(),
            at: new Date().toLocaleString("zh-CN", { hour12: false }),
            actor: user.name,
            role: user.role,
            action: "production-database-cutover-action",
            target: runId,
            result: "allowed",
            detail: `${normalized.history.action} / ${normalized.run.status} / ${normalized.run.reviewStatus}`
          },
          ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
        ].slice(0, 120), { recompute: true });
        writeDatabase(normalizeState(data));
        const center = buildProductionDatabaseCutoverCenter(readDatabase());
        sendJson(res, 200, { ok: true, run: normalized.run, action: normalized.history, center });
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/phase2/catalog") {
        const user = requireApiRole(req, res, ["commission"], "/api/phase2/catalog");
        if (!user) return true;
        const data = readDatabase();
        sendJson(res, 200, buildPhase2CatalogOverview(data));
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/phase2/joint-test-pilot") {
        const user = requireApiRole(req, res, ["commission"], "/api/phase2/joint-test-pilot");
        if (!user) return true;
        const data = readDatabase();
        sendJson(res, 200, buildPhase2JointTestPilotOverview(data));
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/phase2/disease-reporting") {
        const user = requireApiRole(req, res, ["commission", "county", "institution"], "/api/phase2/disease-reporting");
        if (!user) return true;
        const data = readDatabase();
        sendJson(res, 200, buildPhase2DiseaseReportingOverview(data));
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/phase2/clinical-assist") {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/phase2/clinical-assist");
        if (!user) return true;
        const data = readDatabase();
        sendJson(res, 200, buildPhase2ClinicalAssistOverview(data, user));
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/phase2/family-doctor-contracts") {
        const user = requireApiRole(req, res, ["commission", "institution", "citizen"], "/api/phase2/family-doctor-contracts");
        if (!user) return true;
        const data = readDatabase();
        sendJson(res, 200, buildPhase2FamilyDoctorOverview(data, user));
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/phase2/family-doctor-contracts/applications") {
        const user = requireApiRole(req, res, ["commission", "institution", "citizen"], "/api/phase2/family-doctor-contracts/applications");
        if (!user) return true;
        const data = readDatabase();
        const payload = await collectJson(req);
        const application = normalizePhase2FamilyDoctorApplication(payload, user, data);
        if (user.role === "citizen") {
          const allowedIds = allowedResidentIdsForUser(data, user);
          if (!application.residentId || !allowedIds?.has(application.residentId)) {
            appendSecurityEvent({ actor: user.name, role: user.role, action: "phase2-family-doctor-application", target: application.residentId, result: "denied", detail: "resident scope denied" });
            sendJson(res, 403, { error: "Forbidden", message: "无权为该居民提交家庭医生签约申请" });
            return true;
          }
        }
        data.phase2FamilyDoctorApplications = mergeByKey(data.phase2FamilyDoctorApplications, [application], "id");
        data.taskMessages = [
          {
            id: randomUUID(),
            taskId: `phase2FamilyDoctorApplications:${application.id}`,
            collection: "phase2FamilyDoctorApplications",
            sourceId: application.id,
            residentId: application.residentId,
            targetRole: "institution",
            targetOrgCode: application.reviewInstitutionCode,
            channel: "in_app",
            title: "家庭医生签约申请待审核",
            body: `${application.residentName || application.residentId} 提交 ${application.packageId} 签约申请`,
            status: "sent",
            receipts: [],
            createdAt: new Date().toISOString(),
            createdBy: user.username || user.role
          },
          ...(Array.isArray(data.taskMessages) ? data.taskMessages : [])
        ].slice(0, 300);
        data.securityEvents = [
          {
            id: randomUUID(),
            at: new Date().toLocaleString("zh-CN", { hour12: false }),
            actor: user.name,
            role: user.role,
            action: "phase2-family-doctor-application",
            target: application.id,
            result: "allowed",
            detail: `${application.residentId} / ${application.packageId} / ${application.teamId}`
          },
          ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
        ].slice(0, 120);
        writeDatabase(data);
        sendJson(res, 201, { application, overview: buildPhase2FamilyDoctorOverview(data, user) });
        return true;
      }

      const phase2FamilyDoctorReviewMatch = url.pathname.match(/^\/api\/phase2\/family-doctor-contracts\/applications\/([^/]+)\/review$/);
      if (req.method === "POST" && phase2FamilyDoctorReviewMatch) {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/phase2/family-doctor-contracts/applications/:id/review");
        if (!user) return true;
        const data = readDatabase();
        const applicationId = decodeURIComponent(phase2FamilyDoctorReviewMatch[1]);
        const applications = Array.isArray(data.phase2FamilyDoctorApplications) ? data.phase2FamilyDoctorApplications : seedPhase2FamilyDoctorApplications();
        const index = applications.findIndex((item) => item.id === applicationId);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "未找到家庭医生签约申请" });
          return true;
        }
        if (!canAccessPhase2FamilyDoctorRow(user, applications[index], data)) {
          appendSecurityEvent({ actor: user.name, role: user.role, action: "phase2-family-doctor-application-review", target: applicationId, result: "denied", detail: "institution scope denied" });
          sendJson(res, 403, { error: "Forbidden", message: "无权审核该家庭医生签约申请" });
          return true;
        }
        const payload = await collectJson(req);
        const decision = String(payload.decision || payload.reviewStatus || "approved").trim();
        const approved = /approve|approved|pass|通过|同意/i.test(decision);
        const now = new Date().toISOString();
        applications[index] = {
          ...applications[index],
          status: approved ? "approved" : "rejected",
          reviewStatus: approved ? "approved" : "rejected",
          reviewer: user.username || user.role,
          reviewedAt: now,
          reviewComment: String(payload.comment || payload.reviewComment || (approved ? "机构审核通过。" : "机构审核退回。")).trim(),
          lastAction: approved ? "机构审核通过并生成或续约签约合同。" : "机构审核退回，等待居民补充。"
        };
        data.phase2FamilyDoctorApplications = applications;
        let contract = null;
        if (approved) {
          contract = buildPhase2FamilyDoctorContractFromApplication(applications[index], payload, user);
          const existingContracts = Array.isArray(data.phase2FamilyDoctorContracts) ? data.phase2FamilyDoctorContracts : seedPhase2FamilyDoctorContracts();
          data.phase2FamilyDoctorContracts = mergeByKey(existingContracts, [contract], "id");
        }
        data.securityEvents = [
          {
            id: randomUUID(),
            at: new Date().toLocaleString("zh-CN", { hour12: false }),
            actor: user.name,
            role: user.role,
            action: "phase2-family-doctor-application-review",
            target: applicationId,
            result: "allowed",
            detail: `${applications[index].reviewStatus} / ${applications[index].reviewInstitutionCode}`
          },
          ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
        ].slice(0, 120);
        writeDatabase(data);
        sendJson(res, 200, { application: applications[index], contract, overview: buildPhase2FamilyDoctorOverview(data, user) });
        return true;
      }

      const phase2FamilyDoctorFulfillmentMatch = url.pathname.match(/^\/api\/phase2\/family-doctor-contracts\/contracts\/([^/]+)\/fulfillments$/);
      if (req.method === "POST" && phase2FamilyDoctorFulfillmentMatch) {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/phase2/family-doctor-contracts/contracts/:id/fulfillments");
        if (!user) return true;
        const data = readDatabase();
        const contractId = decodeURIComponent(phase2FamilyDoctorFulfillmentMatch[1]);
        const contracts = Array.isArray(data.phase2FamilyDoctorContracts) ? data.phase2FamilyDoctorContracts : seedPhase2FamilyDoctorContracts();
        const index = contracts.findIndex((item) => item.id === contractId);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "未找到家庭医生签约合同" });
          return true;
        }
        if (!canAccessPhase2FamilyDoctorRow(user, contracts[index], data)) {
          appendSecurityEvent({ actor: user.name, role: user.role, action: "phase2-family-doctor-fulfillment", target: contractId, result: "denied", detail: "institution scope denied" });
          sendJson(res, 403, { error: "Forbidden", message: "无权登记该家庭医生履约记录" });
          return true;
        }
        const payload = await collectJson(req);
        const now = new Date().toISOString();
        const fulfillment = {
          id: `p2fdf-${contractId}-${Date.now()}`,
          contractId,
          residentId: contracts[index].residentId,
          teamId: contracts[index].teamId,
          packageId: contracts[index].packageId,
          serviceDate: String(payload.serviceDate || todayOffset(0)).trim(),
          serviceType: String(payload.serviceType || "followup").trim(),
          serviceItem: String(payload.serviceItem || payload.note || "家庭医生履约服务").trim(),
          status: String(payload.status || "completed").trim(),
          evidenceCollection: String(payload.evidenceCollection || "phase2FamilyDoctorFulfillments").trim(),
          evidenceId: String(payload.evidenceId || "").trim(),
          fulfillmentValue: Number(payload.fulfillmentValue || 10),
          satisfaction: String(payload.satisfaction || "pending").trim(),
          createdBy: user.username || user.role,
          createdAt: now,
          auditHash: phase2EvidenceHash(`${contractId}/${payload.serviceType || "followup"}/${now}`)
        };
        data.phase2FamilyDoctorFulfillments = mergeByKey(data.phase2FamilyDoctorFulfillments, [fulfillment], "id");
        contracts[index] = {
          ...contracts[index],
          status: contracts[index].status || "active",
          fulfillmentPercent: Math.min(100, Number(contracts[index].fulfillmentPercent || 0) + Number(fulfillment.fulfillmentValue || 0)),
          lastServiceAt: fulfillment.serviceDate,
          nextServiceAt: String(payload.nextServiceAt || contracts[index].nextServiceAt || todayOffset(30)).trim()
        };
        data.phase2FamilyDoctorContracts = contracts;
        data.securityEvents = [
          {
            id: randomUUID(),
            at: new Date().toLocaleString("zh-CN", { hour12: false }),
            actor: user.name,
            role: user.role,
            action: "phase2-family-doctor-fulfillment",
            target: contractId,
            result: "allowed",
            detail: `${fulfillment.serviceType} / ${fulfillment.auditHash}`
          },
          ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
        ].slice(0, 120);
        writeDatabase(data);
        sendJson(res, 201, { contract: contracts[index], fulfillment, overview: buildPhase2FamilyDoctorOverview(data, user) });
        return true;
      }

      const phase2ClinicalAssistReceiptMatch = url.pathname.match(/^\/api\/phase2\/clinical-assist\/alerts\/([^/]+)\/receipt$/);
      if (req.method === "POST" && phase2ClinicalAssistReceiptMatch) {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/phase2/clinical-assist/alerts/:id/receipt");
        if (!user) return true;
        const data = readDatabase();
        const alertId = decodeURIComponent(phase2ClinicalAssistReceiptMatch[1]);
        const alerts = Array.isArray(data.phase2ClinicalAssistAlerts) ? data.phase2ClinicalAssistAlerts : seedPhase2ClinicalAssistAlerts();
        const index = alerts.findIndex((item) => item.id === alertId);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "未找到临床辅助提醒" });
          return true;
        }
        if (!canAccessPhase2ClinicalAssistAlert(user, alerts[index])) {
          appendSecurityEvent({ actor: user.name, role: user.role, action: "phase2-clinical-assist-receipt", target: alertId, result: "denied", detail: "超出医生工作站授权范围" });
          sendJson(res, 403, { error: "Forbidden", message: "无权处理该临床辅助提醒" });
          return true;
        }
        const payload = await collectJson(req);
        const receipt = normalizePhase2ClinicalAssistReceipt(alerts[index], payload, user);
        alerts[index] = {
          ...alerts[index],
          status: /dismiss|ignore|拒绝|忽略|保留/i.test(receipt.doctorAction) ? "dismissed-with-reason" : "acknowledged",
          doctorAction: receipt.doctorAction,
          messageReceiptStatus: receipt.receiptStatus,
          receiptId: receipt.id,
          lastAction: receipt.actionDetail,
          lastReceiptAt: receipt.receivedAt
        };
        data.phase2ClinicalAssistAlerts = alerts;
        data.phase2ClinicalAssistReceipts = mergeByKey(data.phase2ClinicalAssistReceipts, [receipt], "id");
        data.securityEvents = [
          {
            id: randomUUID(),
            at: new Date().toLocaleString("zh-CN", { hour12: false }),
            actor: user.name,
            role: user.role,
            action: "phase2-clinical-assist-receipt",
            target: alertId,
            result: "allowed",
            detail: `${receipt.doctorAction} · ${receipt.receiptStatus} · ${receipt.auditHash}`
          },
          ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
        ].slice(0, 120);
        writeDatabase(data);
        sendJson(res, 200, { alert: alerts[index], receipt, overview: buildPhase2ClinicalAssistOverview(data, user) });
        return true;
      }

      const phase2ClinicalAssistRuleConfigMatch = url.pathname.match(/^\/api\/phase2\/clinical-assist\/rules\/([^/]+)\/config$/);
      if (req.method === "POST" && phase2ClinicalAssistRuleConfigMatch) {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/phase2/clinical-assist/rules/:id/config");
        if (!user) return true;
        const data = readDatabase();
        const ruleId = decodeURIComponent(phase2ClinicalAssistRuleConfigMatch[1]);
        const rules = Array.isArray(data.phase2ClinicalAssistRules) ? data.phase2ClinicalAssistRules : seedPhase2ClinicalAssistRules();
        const index = rules.findIndex((item) => item.id === ruleId);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "未找到临床辅助规则" });
          return true;
        }
        const payload = await collectJson(req);
        rules[index] = {
          ...rules[index],
          configStatus: String(payload.configStatus || payload.status || rules[index].configStatus || "active").trim(),
          severity: String(payload.severity || rules[index].severity || "medium").trim(),
          defaultAction: String(payload.defaultAction || rules[index].defaultAction || "").trim(),
          owner: String(payload.owner || rules[index].owner || user.orgName || "").trim(),
          lastConfiguredBy: user.username || user.role,
          lastConfiguredAt: new Date().toISOString()
        };
        data.phase2ClinicalAssistRules = rules;
        data.securityEvents = [
          {
            id: randomUUID(),
            at: new Date().toLocaleString("zh-CN", { hour12: false }),
            actor: user.name,
            role: user.role,
            action: "phase2-clinical-assist-rule-config",
            target: ruleId,
            result: "allowed",
            detail: `${rules[index].configStatus} · ${rules[index].severity}`
          },
          ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
        ].slice(0, 120);
        writeDatabase(data);
        sendJson(res, 200, { rule: rules[index], overview: buildPhase2ClinicalAssistOverview(data, user) });
        return true;
      }

      const phase2DiseaseReportReceiptMatch = url.pathname.match(/^\/api\/phase2\/disease-reporting\/reports\/([^/]+)\/receipt$/);
      if (req.method === "POST" && phase2DiseaseReportReceiptMatch) {
        const user = requireApiRole(req, res, ["commission", "county"], "/api/phase2/disease-reporting/reports/:id/receipt");
        if (!user) return true;
        const data = readDatabase();
        const reportId = decodeURIComponent(phase2DiseaseReportReceiptMatch[1]);
        const queue = Array.isArray(data.phase2DiseaseReportQueue) ? data.phase2DiseaseReportQueue : seedPhase2DiseaseReportQueue();
        const index = queue.findIndex((item) => item.id === reportId);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "未找到二期报病记录" });
          return true;
        }
        const payload = await collectJson(req);
        const receipt = normalizePhase2DiseaseReportReceipt(queue[index], payload, user);
        queue[index] = {
          ...queue[index],
          status: /accept|received|通过|接收/i.test(receipt.receiptStatus) ? "receipt-confirmed" : "receipt-review",
          pushStatus: receipt.receiptStatus,
          receiptId: receipt.id,
          exceptionStatus: /reject|error|退回|失败/i.test(receipt.receiptStatus) ? "open" : "closed",
          lastAction: receipt.detail,
          lastReceiptAt: receipt.receivedAt
        };
        data.phase2DiseaseReportQueue = queue;
        data.phase2DiseaseReportReceipts = mergeByKey(data.phase2DiseaseReportReceipts, [receipt], "id");
        data.securityEvents = [
          {
            id: randomUUID(),
            at: new Date().toLocaleString("zh-CN", { hour12: false }),
            actor: user.name,
            role: user.role,
            action: "phase2-disease-report-receipt",
            target: reportId,
            result: "allowed",
            detail: `${receipt.receiptStatus} · ${receipt.receiptCode} · ${receipt.auditHash}`
          },
          ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
        ].slice(0, 120);
        writeDatabase(data);
        sendJson(res, 200, { report: queue[index], receipt, overview: buildPhase2DiseaseReportingOverview(data) });
        return true;
      }
        return false;
      }
    },
    {
      id: "platform-governance-09",
      domain: "platform-governance",
      async handle(req, res, url) {
    if (req.method === "GET" && url.pathname === "/api/phase2/mutual-recognition") {
        const user = requireApiRole(req, res, ["commission", "institution", "county"], "/api/phase2/mutual-recognition");
        if (!user) return true;
        const data = readDatabase();
        sendJson(res, 200, buildPhase2MutualRecognitionOverview(data));
        return true;
      }
        return false;
      }
    },
    {
      id: "platform-governance-10",
      domain: "platform-governance",
      async handle(req, res, url) {
    const phase2MutualRecognitionDecisionMatch = url.pathname.match(/^\/api\/phase2\/mutual-recognition\/records\/([^/]+)\/decision$/);
      if (req.method === "POST" && phase2MutualRecognitionDecisionMatch) {
        const user = requireApiRole(req, res, ["county", "commission"], "/api/phase2/mutual-recognition/records/:id/decision");
        if (!user) return true;
        const data = readDatabase();
        const payload = await collectJson(req);
        let reviewed;
        try {
          reviewed = reviewMutualRecognitionRecord(data, decodeURIComponent(phase2MutualRecognitionDecisionMatch[1]), payload, user);
        } catch (error) {
          sendJson(res, 400, { error: "Bad Request", message: error.message });
          return true;
        }
        if (!reviewed) {
          sendJson(res, 404, { error: "Not Found", message: "未找到互认记录" });
          return true;
        }
        const citation = upsertPhase2MutualRecognitionCitation(data, reviewed, payload, user);
        data.securityEvents = [
          {
            id: randomUUID(),
            at: new Date().toLocaleString("zh-CN", { hour12: false }),
            actor: user.name,
            role: user.role,
            action: "phase2-mutual-recognition-decision",
            target: reviewed.id,
            result: "allowed",
            detail: `${reviewed.reviewStatus} · ${reviewed.reviewReasonCode} · ${citation?.evidenceHash || "no-citation"}`
          },
          ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
        ].slice(0, 120);
        writeDatabase(data);
        sendJson(res, 200, { record: reviewed, citation, overview: buildPhase2MutualRecognitionOverview(data) });
        return true;
      }
        return false;
      }
    },
  ];
}

module.exports = { createRouteSegments };
