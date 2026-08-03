"use strict";

const ROUTE_SEGMENT_ID = "platform-governance-07";
const SUBDOMAIN = "digital-hospital-governance";

function createRouteSegment(runtime) {
  const { appendSecurityEvent, buildDigitalHospitalControlMatrixBoard, buildDigitalHospitalEvaluationCatalog, buildDigitalHospitalLaunchCommandBriefBoard, buildDigitalHospitalLaunchReadiness, buildDigitalHospitalPilotBoard, buildDigitalHospitalPolicyRegisterBoard, buildDigitalHospitalProductionEvidenceBoard, buildDigitalHospitalSecurityCenter, buildDigitalHospitalSelfAssessmentBoard, buildDigitalHospitalStandardsOverview, collectJson, createDigitalHospitalPilotInstitution, createDigitalHospitalPilotIssue, createDigitalHospitalSelfAssessment, digitalHospitalClientCertificate, digitalHospitalExecutionRuntime, digitalHospitalWorkerFingerprints, isProductionRuntime, normalizeDigitalHospitalCollectionJobAction, normalizeDigitalHospitalControlAction, normalizeDigitalHospitalEvaluationEvidenceAction, normalizeDigitalHospitalFormalCutoverApprovalAction, normalizeDigitalHospitalLaunchCommandBriefAction, normalizeDigitalHospitalLaunchRequirementAction, normalizeDigitalHospitalPilotInstitutionAction, normalizeDigitalHospitalPilotIssueAction, normalizeDigitalHospitalPolicyReview, normalizeDigitalHospitalPreAssessmentAction, normalizeDigitalHospitalProductionEvidencePacketAction, normalizeDigitalHospitalSelfAssessmentAction, normalizeState, randomUUID, readDatabase, requireApiRole, requireDigitalHospitalExecutionWorker, runDigitalHospitalPreAssessment, sealAuditTrail, seedDigitalHospitalCollectionJobs, seedDigitalHospitalControlMatrix, seedDigitalHospitalEvaluationEvidence, seedDigitalHospitalFormalCutoverApprovals, seedDigitalHospitalLaunchCommandBriefs, seedDigitalHospitalLaunchRequirements, seedDigitalHospitalPilotInstitutions, seedDigitalHospitalPilotIssues, seedDigitalHospitalPolicyRegister, seedDigitalHospitalPreAssessments, seedDigitalHospitalProductionEvidencePackets, seedDigitalHospitalSelfAssessments, sendDigitalHospitalExecutionError, sendJson, verifySignedExecutionCallback, writeDatabase } = runtime;
  return {
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
    };
}

module.exports = { ROUTE_SEGMENT_ID, SUBDOMAIN, createRouteSegment };
