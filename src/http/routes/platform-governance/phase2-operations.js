"use strict";

const ROUTE_SEGMENT_ID = "platform-governance-08";
const SUBDOMAIN = "phase2-operations";

function createRouteSegment(runtime) {
  const { POSTGRES_PRIMARY_READ_MODE, POSTGRES_SYNC_MODE, SQLITE_FILE, allowedResidentIdsForUser, appendSecurityEvent, applyCommercialCryptoAction, applyPlatformCapabilityReviewAction, applyPlatformProductionBlockerAction, applyPostgresReconciliationCaseAction, applyProductionDatabaseCutoverAction, buildCommercialCryptoCenter, buildPhase2CatalogOverview, buildPhase2ClinicalAssistOverview, buildPhase2DiseaseReportingOverview, buildPhase2FamilyDoctorContractFromApplication, buildPhase2FamilyDoctorOverview, buildPhase2JointTestPilotOverview, buildPlatformCapabilityOperationsCenter, buildPostgresProductionAdapterConfig, buildProductionDatabaseCutoverCenter, canAccessPhase2ClinicalAssistAlert, canAccessPhase2FamilyDoctorRow, collectJson, createProductionDatabaseCutoverRun, fs, listPostgresReconciliationCases, listPostgresReconciliationHistory, mergeByKey, normalizePhase2ClinicalAssistReceipt, normalizePhase2DiseaseReportReceipt, normalizePhase2FamilyDoctorApplication, normalizeState, phase2EvidenceHash, randomUUID, readDatabase, readLatestPostgresReconciliation, readPostgresReconciliationCase, readPostgresReconciliationRun, requireApiRole, runPostgresPrimaryReadRehearsal, sealAuditTrail, seedCommercialCryptoCapabilities, seedCommercialCryptoEvidencePackets, seedPhase2ClinicalAssistAlerts, seedPhase2ClinicalAssistRules, seedPhase2DiseaseReportQueue, seedPhase2FamilyDoctorApplications, seedPhase2FamilyDoctorContracts, seedProductionDatabaseCutoverRuns, seedProductionDatabaseMigrationBatches, sendJson, shouldUseSqlite, todayOffset, writeDatabase } = runtime;
  return {
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
    };
}

module.exports = { ROUTE_SEGMENT_ID, SUBDOMAIN, createRouteSegment };
