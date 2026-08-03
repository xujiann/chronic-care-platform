"use strict";

function createRouteSegments(runtime) {
  const { CitizenRecordsPolicy, CitizenRecordsV1, CitizenRecordsV2, PERSONAL_RECORD_PROTECTED_FIELDS, appendDataAccessLog, appendSecurityEvent, applyCitizenLifecycleAction, applyCitizenOperationsAction, buildChronicAcceptanceLedger, buildChronicArchiveStandardization, buildChronicFollowupSummary, buildChronicInstitutionInterfaceReport, buildChronicInteroperabilityProfiles, buildChronicLaunchCoreReport, buildChronicPathwayQualityReport, buildChronicPharmacyInsuranceClosure, buildChronicProductionSafetyEvidenceBridge, buildChronicProductionSafetyReport, buildChronicPublicHealthLoop, buildChronicReferralContinuity, buildChronicRiskStratification, buildCitizenLifecycleActionMessage, buildCitizenLifecycleActions, buildCitizenOperationsCenter, buildCitizenOperationsPublic, canAccessResident, canManageResidentProfile, citizenCareIdempotencyKey, citizenCareReceipt, citizenCareReplay, citizenCareRequestDigest, citizenCareWorkspace, cleanResidentPatch, closeFamilyDoctorChronicAction, collectJson, createHash, dispatchChronicFollowupAction, escalateChronicFollowupAction, ingestChronicDeviceMeasurement, mergeByKey, normalizePersonalRecord, normalizeState, patchBusinessCollectionItem, personIndexForResident, prependAuditTrailEntry, randomUUID, readDatabase, recordChronicLaunchCoreAction, recordChronicPharmacyCallback, recordChronicReferralContinuity, redactSensitiveResponse, requireApiRole, scheduleChronicReminderOutreach, scopeStateForUser, sealAuditTrail, seedCitizenHospitalServiceConfigs, seedCitizenIdentityReviewCases, seedCitizenOperationContents, seedCitizenServiceBlacklist, sendJson, upsertChronicFeedback, upsertResidentExperienceCheckin, validateChronicInteroperabilityMessage, writeDatabase } = runtime;
  return [
    {
      id: "citizen-chronic-01",
      domain: "citizen-chronic",
      async handle(req, res, url) {
    if (req.method === "GET" && url.pathname === "/api/citizen/lifecycle-actions") {
        const user = requireApiRole(req, res, ["commission", "institution", "citizen"], "/api/citizen/lifecycle-actions");
        if (!user) return true;
        const data = readDatabase();
        const residentId = url.searchParams.get("residentId") || "";
        if (residentId && !canAccessResident(user, residentId, data)) {
          appendSecurityEvent({ actor: user.name, role: user.role, action: "read citizen lifecycle actions", target: residentId, result: "denied", detail: "resident scope denied" });
          sendJson(res, 403, { error: "Forbidden", message: "resident scope denied" });
          return true;
        }
        sendJson(res, 200, redactSensitiveResponse(buildCitizenLifecycleActions(data, user, residentId), user));
        return true;
      }

      const citizenLifecycleActionMatch = url.pathname.match(/^\/api\/citizen\/lifecycle-actions\/([^/]+)\/actions$/);
      if (req.method === "POST" && citizenLifecycleActionMatch) {
        const user = requireApiRole(req, res, ["citizen"], "/api/citizen/lifecycle-actions/:id/actions");
        if (!user) return true;
        const data = readDatabase();
        const actionId = decodeURIComponent(citizenLifecycleActionMatch[1]);
        const lifecycleAction = buildCitizenLifecycleActions(data, user).actions.find((item) => item.id === actionId);
        if (!lifecycleAction) {
          sendJson(res, 404, { error: "Not Found", message: "未找到可处理的生命周期待办" });
          return true;
        }
        if (!canAccessResident(user, lifecycleAction.residentId, data)) {
          appendSecurityEvent({ actor: user.name, role: user.role, action: "handle citizen lifecycle action", target: actionId, result: "denied", detail: "resident scope denied" });
          sendJson(res, 403, { error: "Forbidden", message: "resident scope denied" });
          return true;
        }
        const payload = await collectJson(req);
        let receipt;
        try {
          receipt = applyCitizenLifecycleAction(data, lifecycleAction, payload, user);
        } catch (error) {
          sendJson(res, 400, { error: "Bad Request", message: error.message });
          return true;
        }
        const message = buildCitizenLifecycleActionMessage(lifecycleAction, payload, user);
        data.taskMessages = [message, ...(Array.isArray(data.taskMessages) ? data.taskMessages : [])].slice(0, 300);
        data.securityEvents = [
          {
            id: randomUUID(),
            at: new Date().toLocaleString("zh-CN", { hour12: false }),
            actor: user.name,
            role: user.role,
            action: "handle citizen lifecycle action",
            target: actionId,
            result: "allowed",
            detail: `${String(payload.action || "resident-remind")} · ${lifecycleAction.sourceCollection || "generated"}`
          },
          ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
        ].slice(0, 120);
        appendDataAccessLog(data, user, lifecycleAction.residentId, "citizenLifecycleActions", String(payload.action || "resident-remind"), "allowed");
        writeDatabase(data);
        const refreshed = buildCitizenLifecycleActions(readDatabase(), user, lifecycleAction.residentId);
        sendJson(res, 200, { ok: true, action: lifecycleAction, message, sourceUpdated: receipt.sourceUpdated, receipt: receipt.receipt, actions: refreshed.actions });
        return true;
      }
        return false;
      }
    },
    {
      id: "citizen-chronic-02",
      domain: "citizen-chronic",
      async handle(req, res, url) {
    if (req.method === "GET" && url.pathname === "/api/chronic/acceptance-ledger") {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/chronic/acceptance-ledger");
        if (!user) return true;
        sendJson(res, 200, buildChronicAcceptanceLedger(readDatabase()));
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/chronic/risk-stratification") {
        const user = requireApiRole(req, res, ["commission", "institution", "county"], "/api/chronic/risk-stratification");
        if (!user) return true;
        sendJson(res, 200, redactSensitiveResponse(buildChronicRiskStratification(scopeStateForUser(readDatabase(), user)), user));
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/chronic/followup-summary") {
        const user = requireApiRole(req, res, ["commission", "institution", "citizen"], "/api/chronic/followup-summary");
        if (!user) return true;
        const data = readDatabase();
        const residentId = url.searchParams.get("residentId") || "";
        if (residentId && !canAccessResident(user, residentId, data)) {
          appendSecurityEvent({ actor: user.name, role: user.role, action: "read chronic follow-up summary", target: residentId, result: "denied", detail: "resident scope denied" });
          sendJson(res, 403, { error: "Forbidden", message: "resident scope denied" });
          return true;
        }
        sendJson(res, 200, redactSensitiveResponse(buildChronicFollowupSummary(data, user, residentId), user));
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/chronic/referral-continuity") {
        const user = requireApiRole(req, res, ["commission", "institution", "citizen"], "/api/chronic/referral-continuity");
        if (!user) return true;
        const data = readDatabase();
        const residentId = url.searchParams.get("residentId") || "";
        if (residentId && !canAccessResident(user, residentId, data)) {
          appendSecurityEvent({ actor: user.name, role: user.role, action: "read chronic referral continuity", target: residentId, result: "denied", detail: "resident scope denied" });
          sendJson(res, 403, { error: "Forbidden", message: "resident scope denied" });
          return true;
        }
        sendJson(res, 200, redactSensitiveResponse(buildChronicReferralContinuity(data, user, residentId), user));
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/chronic/archive-standard") {
        const user = requireApiRole(req, res, ["commission", "institution", "citizen"], "/api/chronic/archive-standard");
        if (!user) return true;
        const data = readDatabase();
        const residentId = url.searchParams.get("residentId") || "";
        if (residentId && !canAccessResident(user, residentId, data)) {
          appendSecurityEvent({ actor: user.name, role: user.role, action: "read chronic archive standard", target: residentId, result: "denied", detail: "resident scope denied" });
          sendJson(res, 403, { error: "Forbidden", message: "resident scope denied" });
          return true;
        }
        sendJson(res, 200, redactSensitiveResponse(buildChronicArchiveStandardization(data, user, residentId), user));
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/chronic/pathway-quality") {
        const user = requireApiRole(req, res, ["commission", "institution", "citizen"], "/api/chronic/pathway-quality");
        if (!user) return true;
        const data = readDatabase();
        const residentId = url.searchParams.get("residentId") || "";
        if (residentId && !canAccessResident(user, residentId, data)) {
          appendSecurityEvent({ actor: user.name, role: user.role, action: "read chronic pathway quality", target: residentId, result: "denied", detail: "resident scope denied" });
          sendJson(res, 403, { error: "Forbidden", message: "resident scope denied" });
          return true;
        }
        sendJson(res, 200, redactSensitiveResponse(buildChronicPathwayQualityReport(data, user, residentId), user));
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/chronic/pharmacy-insurance-closure") {
        const user = requireApiRole(req, res, ["commission", "institution", "insurance", "citizen"], "/api/chronic/pharmacy-insurance-closure");
        if (!user) return true;
        const data = readDatabase();
        const residentId = url.searchParams.get("residentId") || "";
        if (residentId && !canAccessResident(user, residentId, data)) {
          appendSecurityEvent({ actor: user.name, role: user.role, action: "read chronic pharmacy insurance closure", target: residentId, result: "denied", detail: "resident scope denied" });
          sendJson(res, 403, { error: "Forbidden", message: "resident scope denied" });
          return true;
        }
        sendJson(res, 200, redactSensitiveResponse(buildChronicPharmacyInsuranceClosure(data, user, residentId), user));
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/chronic/production-safety") {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/chronic/production-safety");
        if (!user) return true;
        sendJson(res, 200, buildChronicProductionSafetyReport(readDatabase()));
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/chronic/production-safety-evidence") {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/chronic/production-safety-evidence");
        if (!user) return true;
        sendJson(res, 200, buildChronicProductionSafetyEvidenceBridge(readDatabase()));
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/chronic/interoperability-profiles") {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/chronic/interoperability-profiles");
        if (!user) return true;
        sendJson(res, 200, buildChronicInteroperabilityProfiles());
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/chronic/interoperability-validation") {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/chronic/interoperability-validation");
        if (!user) return true;
        const result = validateChronicInteroperabilityMessage(readDatabase(), user, await collectJson(req));
        sendJson(res, result.status, result.body);
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/chronic/public-health-loop") {
        const user = requireApiRole(req, res, ["commission", "institution", "county"], "/api/chronic/public-health-loop");
        if (!user) return true;
        const data = readDatabase();
        const residentId = url.searchParams.get("residentId") || "";
        if (residentId && !canAccessResident(user, residentId, data)) {
          appendSecurityEvent({ actor: user.name, role: user.role, action: "read chronic public health loop", target: residentId, result: "denied", detail: "resident scope denied" });
          sendJson(res, 403, { error: "Forbidden", message: "resident scope denied" });
          return true;
        }
        sendJson(res, 200, redactSensitiveResponse(buildChronicPublicHealthLoop(data, user, residentId), user));
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/chronic/institution-interfaces") {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/chronic/institution-interfaces");
        if (!user) return true;
        sendJson(res, 200, buildChronicInstitutionInterfaceReport({ data: readDatabase() }));
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/chronic/launch-core") {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/chronic/launch-core");
        if (!user) return true;
        sendJson(res, 200, buildChronicLaunchCoreReport({ data: readDatabase() }));
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/chronic/launch-core/actions") {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/chronic/launch-core/actions");
        if (!user) return true;
        const result = recordChronicLaunchCoreAction(readDatabase(), user, await collectJson(req));
        sendJson(res, result.status, redactSensitiveResponse(result.body, user));
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/chronic/followup-feedback") {
        const user = requireApiRole(req, res, ["citizen", "institution", "commission"], "/api/chronic/followup-feedback");
        if (!user) return true;
        let result;
        try {
          result = upsertChronicFeedback(readDatabase(), user, await collectJson(req));
        } catch (error) {
          sendJson(res, 400, { error: "Bad Request", message: error.message });
          return true;
        }
        sendJson(res, result.status, redactSensitiveResponse(result.body, user));
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/chronic/resident-checkins") {
        const user = requireApiRole(req, res, ["citizen", "institution", "commission"], "/api/chronic/resident-checkins");
        if (!user) return true;
        const result = upsertResidentExperienceCheckin(readDatabase(), user, await collectJson(req));
        sendJson(res, result.status, redactSensitiveResponse(result.body, user));
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/chronic/device-measurements") {
        const user = requireApiRole(req, res, ["citizen", "institution", "commission"], "/api/chronic/device-measurements");
        if (!user) return true;
        const result = ingestChronicDeviceMeasurement(readDatabase(), user, await collectJson(req));
        sendJson(res, result.status, redactSensitiveResponse(result.body, user));
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/chronic/pharmacy-callbacks") {
        const user = requireApiRole(req, res, ["institution", "insurance", "commission"], "/api/chronic/pharmacy-callbacks");
        if (!user) return true;
        const result = recordChronicPharmacyCallback(readDatabase(), user, await collectJson(req));
        sendJson(res, result.status, redactSensitiveResponse(result.body, user));
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/chronic/family-doctor-actions") {
        const user = requireApiRole(req, res, ["institution", "commission"], "/api/chronic/family-doctor-actions");
        if (!user) return true;
        const result = closeFamilyDoctorChronicAction(readDatabase(), user, await collectJson(req));
        sendJson(res, result.status, redactSensitiveResponse(result.body, user));
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/chronic/reminder-outreach") {
        const user = requireApiRole(req, res, ["institution", "commission"], "/api/chronic/reminder-outreach");
        if (!user) return true;
        const result = scheduleChronicReminderOutreach(readDatabase(), user, await collectJson(req));
        sendJson(res, result.status, redactSensitiveResponse(result.body, user));
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/chronic/referral-continuity") {
        const user = requireApiRole(req, res, ["institution", "commission"], "/api/chronic/referral-continuity");
        if (!user) return true;
        const result = recordChronicReferralContinuity(readDatabase(), user, await collectJson(req));
        sendJson(res, result.status, redactSensitiveResponse(result.body, user));
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/chronic/followup-escalations") {
        const user = requireApiRole(req, res, ["institution", "commission"], "/api/chronic/followup-escalations");
        if (!user) return true;
        const result = escalateChronicFollowupAction(readDatabase(), user, await collectJson(req));
        sendJson(res, result.status, redactSensitiveResponse(result.body, user));
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/chronic/followup-dispatch") {
        const user = requireApiRole(req, res, ["institution", "commission"], "/api/chronic/followup-dispatch");
        if (!user) return true;
        const result = dispatchChronicFollowupAction(readDatabase(), user, await collectJson(req));
        sendJson(res, result.status, redactSensitiveResponse(result.body, user));
        return true;
      }
        return false;
      }
    },
    {
      id: "citizen-chronic-03",
      domain: "citizen-chronic",
      async handle(req, res, url) {
    if (req.method === "GET" && url.pathname === "/api/citizen-operations/public") {
        const user = requireApiRole(req, res, ["commission", "county", "institution", "citizen"], "/api/citizen-operations/public");
        if (!user) return true;
        const publicFeed = buildCitizenOperationsPublic(readDatabase());
        appendSecurityEvent({
          actor: user.name,
          role: user.role,
          action: "citizen-operations-public-read",
          target: "/api/citizen-operations/public",
          result: "allowed",
          detail: `${publicFeed.contents.length} contents / ${publicFeed.agreements.length} agreements / ${publicFeed.hospitalServices.length} hospitals`
        });
        sendJson(res, 200, publicFeed);
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/citizen-operations/center") {
        const user = requireApiRole(req, res, ["commission"], "/api/citizen-operations/center");
        if (!user) return true;
        const center = buildCitizenOperationsCenter(readDatabase());
        appendSecurityEvent({
          actor: user.name,
          role: user.role,
          action: "citizen-operations-center-read",
          target: "/api/citizen-operations/center",
          result: "allowed",
          detail: `${center.summary.publishedContents} published / ${center.summary.pendingIdentityReviews} identity reviews / ${center.summary.orders} orders`
        });
        sendJson(res, 200, { ok: center.ok, generatedAt: new Date().toISOString(), center });
        return true;
      }

      const citizenOperationsActionMatch = url.pathname.match(/^\/api\/citizen-operations\/(contents|identity-reviews|blacklist|hospitals)\/([^/]+)\/actions$/);
      if (req.method === "POST" && citizenOperationsActionMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/citizen-operations/:resource/:id/actions");
        if (!user) return true;
        const payload = await collectJson(req);
        const resource = citizenOperationsActionMatch[1];
        const itemId = decodeURIComponent(citizenOperationsActionMatch[2]);
        const resources = {
          contents: { collection: "citizenOperationContents", seed: seedCitizenOperationContents },
          "identity-reviews": { collection: "citizenIdentityReviewCases", seed: seedCitizenIdentityReviewCases },
          blacklist: { collection: "citizenServiceBlacklist", seed: seedCitizenServiceBlacklist },
          hospitals: { collection: "citizenHospitalServiceConfigs", seed: seedCitizenHospitalServiceConfigs }
        };
        const definition = resources[resource];
        const data = readDatabase();
        const rows = mergeByKey(definition.seed(), data[definition.collection], "id");
        const index = rows.findIndex((item) => item.id === itemId);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "citizen operations item not found" });
          return true;
        }
        let normalized;
        try {
          normalized = applyCitizenOperationsAction(resource, rows[index], payload, user);
        } catch (error) {
          sendJson(res, 400, { error: "Bad Request", message: error.message });
          return true;
        }
        rows[index] = normalized.item;
        data[definition.collection] = rows;
        data.securityEvents = sealAuditTrail([
          {
            id: randomUUID(),
            at: new Date().toLocaleString("zh-CN", { hour12: false }),
            actor: user.name,
            role: user.role,
            action: "citizen-operations-action",
            target: `${resource}:${itemId}`,
            result: "allowed",
            detail: `${normalized.history.action} / ${normalized.history.fromStatus} -> ${normalized.history.toStatus}`
          },
          ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
        ].slice(0, 120), { recompute: true });
        writeDatabase(normalizeState(data));
        const refreshed = readDatabase();
        sendJson(res, 200, {
          ok: true,
          item: normalized.item,
          action: normalized.history,
          center: buildCitizenOperationsCenter(refreshed),
          publicFeed: buildCitizenOperationsPublic(refreshed)
        });
        return true;
      }
        return false;
      }
    },
    {
      id: "citizen-chronic-04",
      domain: "citizen-chronic",
      async handle(req, res, url) {
    if (req.method === "PATCH" && url.pathname.startsWith("/api/residents/")) {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/residents/:id");
        if (!user) return true;
        const residentId = decodeURIComponent(url.pathname.replace("/api/residents/", "")).trim();
        const patch = await collectJson(req);
        const data = readDatabase();
        const index = data.residents.findIndex((item) => item.id === residentId);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "未找到居民" });
          return true;
        }
        if (!canManageResidentProfile(user, residentId, data)) {
          appendSecurityEvent({ actor: user.name, role: user.role, action: "更新居民档案", target: residentId, result: "拒绝", detail: "超出居民授权范围" });
          sendJson(res, 403, { error: "Forbidden", message: "无权更新该居民档案" });
          return true;
        }
        data.residents[index] = {
          ...data.residents[index],
          ...cleanResidentPatch(patch),
          updatedBy: user.username || user.role,
          updatedByName: user.name,
          updatedAt: new Date().toISOString()
        };
        data.storageMeta = {
          ...(data.storageMeta || {}),
          collectionVersions: Object.hasOwn(patch, "expectedVersion") ? { residents: Number(patch.expectedVersion) } : {}
        };
        appendDataAccessLog(data, user, residentId, "居民主索引与健康档案", "更新居民基础档案");
        writeDatabase(data);
        sendJson(res, 200, data.residents[index]);
        return true;
      }
        return false;
      }
    },
    {
      id: "citizen-chronic-05",
      domain: "citizen-chronic",
      async handle(req, res, url) {
    if (req.method === "PATCH" && url.pathname.startsWith("/api/chronic-management-plans/")) {
        const user = requireApiRole(req, res, ["institution", "commission"], "/api/chronic-management-plans/:id");
        if (!user) return true;
        const result = patchBusinessCollectionItem({
          data: readDatabase(),
          collection: "chronicManagementPlans",
          id: decodeURIComponent(url.pathname.replace("/api/chronic-management-plans/", "")),
          patch: await collectJson(req),
          user,
          action: "更新慢病管理计划"
        });
        sendJson(res, result.status, result.body);
        return true;
      }

      if (req.method === "PATCH" && url.pathname.startsWith("/api/chronic-comorbidity-plans/")) {
        const user = requireApiRole(req, res, ["institution", "commission"], "/api/chronic-comorbidity-plans/:id");
        if (!user) return true;
        const result = patchBusinessCollectionItem({
          data: readDatabase(),
          collection: "chronicComorbidityPlans",
          id: decodeURIComponent(url.pathname.replace("/api/chronic-comorbidity-plans/", "")),
          patch: await collectJson(req),
          user,
          action: "更新多病共管计划"
        });
        sendJson(res, result.status, result.body);
        return true;
      }

      if (req.method === "PATCH" && url.pathname.startsWith("/api/chronic-tcm-services/")) {
        const user = requireApiRole(req, res, ["institution", "commission"], "/api/chronic-tcm-services/:id");
        if (!user) return true;
        const result = patchBusinessCollectionItem({
          data: readDatabase(),
          collection: "chronicTcmServices",
          id: decodeURIComponent(url.pathname.replace("/api/chronic-tcm-services/", "")),
          patch: await collectJson(req),
          user,
          action: "更新中医药慢病服务"
        });
        sendJson(res, result.status, result.body);
        return true;
      }

      if (req.method === "PATCH" && url.pathname.startsWith("/api/chronic-self-management/")) {
        const user = requireApiRole(req, res, ["institution", "commission"], "/api/chronic-self-management/:id");
        if (!user) return true;
        const result = patchBusinessCollectionItem({
          data: readDatabase(),
          collection: "chronicSelfManagement",
          id: decodeURIComponent(url.pathname.replace("/api/chronic-self-management/", "")),
          patch: await collectJson(req),
          user,
          action: "更新居民自我健康管理"
        });
        sendJson(res, result.status, result.body);
        return true;
      }

      if (req.method === "PATCH" && url.pathname.startsWith("/api/chronic-medication-support/")) {
        const user = requireApiRole(req, res, ["institution", "commission"], "/api/chronic-medication-support/:id");
        if (!user) return true;
        const result = patchBusinessCollectionItem({
          data: readDatabase(),
          collection: "chronicMedicationSupport",
          id: decodeURIComponent(url.pathname.replace("/api/chronic-medication-support/", "")),
          patch: await collectJson(req),
          user,
          action: "更新慢病用药保障"
        });
        sendJson(res, result.status, result.body);
        return true;
      }

      if (req.method === "PATCH" && url.pathname.startsWith("/api/chronic-quality-metrics/")) {
        const user = requireApiRole(req, res, ["institution", "commission"], "/api/chronic-quality-metrics/:id");
        if (!user) return true;
        const result = patchBusinessCollectionItem({
          data: readDatabase(),
          collection: "chronicQualityMetrics",
          id: decodeURIComponent(url.pathname.replace("/api/chronic-quality-metrics/", "")),
          patch: await collectJson(req),
          user,
          action: "更新慢病质控指标"
        });
        sendJson(res, result.status, result.body);
        return true;
      }
        return false;
      }
    },
    {
      id: "citizen-chronic-06",
      domain: "citizen-chronic",
      async handle(req, res, url) {
    if (req.method === "PATCH" && url.pathname.startsWith("/api/followups/")) {
        const user = requireApiRole(req, res, ["institution", "commission"], "/api/followups/:id");
        if (!user) return true;
        const result = patchBusinessCollectionItem({
          data: readDatabase(),
          collection: "followups",
          id: decodeURIComponent(url.pathname.replace("/api/followups/", "")),
          patch: await collectJson(req),
          user,
          action: "更新随访记录"
        });
        sendJson(res, result.status, result.body);
        return true;
      }

      if (req.method === "PATCH" && url.pathname.startsWith("/api/chronic-screening-tasks/")) {
        const user = requireApiRole(req, res, ["institution", "commission"], "/api/chronic-screening-tasks/:id");
        if (!user) return true;
        const result = patchBusinessCollectionItem({
          data: readDatabase(),
          collection: "chronicScreeningTasks",
          id: decodeURIComponent(url.pathname.replace("/api/chronic-screening-tasks/", "")),
          patch: await collectJson(req),
          user,
          action: "更新慢病筛查任务"
        });
        sendJson(res, result.status, result.body);
        return true;
      }

      if (req.method === "PATCH" && url.pathname.startsWith("/api/chronic-education-pushes/")) {
        const user = requireApiRole(req, res, ["institution", "commission"], "/api/chronic-education-pushes/:id");
        if (!user) return true;
        const result = patchBusinessCollectionItem({
          data: readDatabase(),
          collection: "chronicEducationPushes",
          id: decodeURIComponent(url.pathname.replace("/api/chronic-education-pushes/", "")),
          patch: await collectJson(req),
          user,
          action: "更新慢病宣教推送"
        });
        sendJson(res, result.status, result.body);
        return true;
      }
        return false;
      }
    },
    {
      id: "citizen-chronic-07",
      domain: "citizen-chronic",
      async handle(req, res, url) {
    if (req.method === "GET" && url.pathname === "/api/record-care-workspace") {
        const user = requireApiRole(req, res, ["citizen", "commission"], "/api/record-care-workspace");
        if (!user) return true;
        const residentId = String(url.searchParams.get("residentId") || "").trim();
        const data = readDatabase();
        if (!residentId || !canAccessResident(user, residentId, data)) {
          appendSecurityEvent({ actor: user.name, role: user.role, action: "查询居民照护工作台", target: residentId || "missing", result: "拒绝", detail: "超出居民授权范围" });
          sendJson(res, residentId ? 403 : 400, { error: residentId ? "Forbidden" : "Bad Request", message: residentId ? "无权查询该居民照护工作台" : "residentId 不能为空" });
          return true;
        }
        appendDataAccessLog(data, user, residentId, "居民照护工作台", "查询纠错、资料包和处置进度");
        writeDatabase(normalizeState(data));
        sendJson(res, 200, citizenCareWorkspace(data, residentId));
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/record-corrections") {
        const user = requireApiRole(req, res, ["citizen"], "/api/record-corrections");
        if (!user) return true;
        const payload = await collectJson(req);
        const data = readDatabase();
        try {
          if (!user.residentId || (payload.residentId && payload.residentId !== user.residentId)) {
            throw new Error("居民只能为本人提交纠错申请");
          }
          const idempotencyKey = citizenCareIdempotencyKey(req, payload);
          const requestDigest = citizenCareRequestDigest(payload);
          const replay = citizenCareReplay(data.recordCorrections, idempotencyKey, requestDigest);
          if (replay.existing) {
            sendJson(res, 200, citizenCareReceipt(replay.existing));
            return true;
          }
          const target = data.personalRecords.find((item) => item.id === String(payload.recordId || "") && item.residentId === user.residentId);
          if (!target) throw new Error("未找到本人可纠错的健康记录");
          const at = new Date();
          const built = CitizenRecordsV2.buildCorrectionRequest({
            ...payload,
            residentId: user.residentId,
            submittedAt: at
          });
          const clientId = String(payload.id || "").trim().slice(0, 200);
          const id = /^correction-[a-z0-9._:-]+$/i.test(clientId) ? clientId : `correction-${randomUUID()}`;
          if (data.recordCorrections.some((item) => item.id === id)) throw new Error("纠错申请标识已存在");
          const item = {
            ...built,
            id,
            receiptId: `care-receipt-${randomUUID()}`,
            auditRef: `care-audit-${randomUUID()}`,
            acceptedAt: at.toISOString(),
            updatedAt: at.toISOString(),
            syncStatus: "accepted",
            idempotencyKeyHash: replay.keyHash,
            requestDigest,
            actorId: user.username || user.id || user.residentId
          };
          data.recordCorrections.push(item);
          appendDataAccessLog(data, user, user.residentId, "健康记录纠错", `提交 ${target.id} 的纠错申请`);
          data.securityEvents = prependAuditTrailEntry(data.securityEvents, {
            id: randomUUID(), at: at.toLocaleString("zh-CN", { hour12: false }), actor: user.name, role: user.role,
            action: "提交居民健康记录纠错", target: id, result: "允许", detail: item.auditRef
          });
          writeDatabase(normalizeState(data));
          sendJson(res, 201, citizenCareReceipt(item));
        } catch (error) {
          appendSecurityEvent({ actor: user.name, role: user.role, action: "提交居民健康记录纠错", target: String(payload.recordId || user.residentId || ""), result: "拒绝", detail: error.message });
          sendJson(res, /本人|超出/.test(error.message) ? 403 : 400, { error: /本人|超出/.test(error.message) ? "Forbidden" : "Bad Request", message: error.message });
        }
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/record-share-packages") {
        const user = requireApiRole(req, res, ["citizen"], "/api/record-share-packages");
        if (!user) return true;
        const payload = await collectJson(req);
        const data = readDatabase();
        try {
          if (!user.residentId || (payload.residentId && payload.residentId !== user.residentId)) {
            throw new Error("居民只能为本人创建健康资料包");
          }
          const idempotencyKey = citizenCareIdempotencyKey(req, payload);
          const requestDigest = citizenCareRequestDigest(payload);
          const replay = citizenCareReplay(data.recordSharePackages, idempotencyKey, requestDigest);
          if (replay.existing) {
            sendJson(res, 200, citizenCareReceipt(replay.existing));
            return true;
          }
          const at = new Date();
          const built = CitizenRecordsV2.buildSharePackage({
            ...payload,
            residentId: user.residentId,
            createdAt: at
          });
          const clientId = String(payload.id || "").trim().slice(0, 200);
          const id = /^share-[a-z0-9._:-]+$/i.test(clientId) ? clientId : `share-${randomUUID()}`;
          if (data.recordSharePackages.some((item) => item.id === id)) throw new Error("健康资料包标识已存在");
          const item = {
            ...built,
            id,
            receiptId: `care-receipt-${randomUUID()}`,
            auditRef: `care-audit-${randomUUID()}`,
            acceptedAt: at.toISOString(),
            updatedAt: at.toISOString(),
            syncStatus: "accepted",
            idempotencyKeyHash: replay.keyHash,
            requestDigest,
            actorId: user.username || user.id || user.residentId
          };
          data.recordSharePackages.push(item);
          appendDataAccessLog(data, user, user.residentId, "一次性健康资料包", `创建 ${item.accessRef}`);
          data.securityEvents = prependAuditTrailEntry(data.securityEvents, {
            id: randomUUID(), at: at.toLocaleString("zh-CN", { hour12: false }), actor: user.name, role: user.role,
            action: "创建居民健康资料包", target: id, result: "允许", detail: item.auditRef
          });
          writeDatabase(normalizeState(data));
          sendJson(res, 201, citizenCareReceipt(item));
        } catch (error) {
          appendSecurityEvent({ actor: user.name, role: user.role, action: "创建居民健康资料包", target: user.residentId || "", result: "拒绝", detail: error.message });
          sendJson(res, /本人|超出/.test(error.message) ? 403 : 400, { error: /本人|超出/.test(error.message) ? "Forbidden" : "Bad Request", message: error.message });
        }
        return true;
      }

      const recordShareRevokeMatch = url.pathname.match(/^\/api\/record-share-packages\/([^/]+)\/revoke$/);
      if (req.method === "POST" && recordShareRevokeMatch) {
        const user = requireApiRole(req, res, ["citizen"], "/api/record-share-packages/:id/revoke");
        if (!user) return true;
        const payload = await collectJson(req);
        const data = readDatabase();
        const id = decodeURIComponent(recordShareRevokeMatch[1]);
        try {
          if (!user.residentId || (payload.residentId && payload.residentId !== user.residentId)) {
            throw new Error("居民只能撤销本人的健康资料包");
          }
          const idempotencyKey = citizenCareIdempotencyKey(req, payload);
          const requestDigest = citizenCareRequestDigest(payload);
          const keyHash = createHash("sha256").update(idempotencyKey).digest("hex");
          const item = data.recordSharePackages.find((candidate) => candidate.id === id && candidate.residentId === user.residentId);
          if (!item) throw new Error("未找到本人可撤销的健康资料包");
          if (item.revocationIdempotencyKeyHash === keyHash) {
            if (item.revocationRequestDigest !== requestDigest) throw new Error("幂等键已用于不同的撤销操作");
            sendJson(res, 200, citizenCareReceipt(item));
            return true;
          }
          if (item.revocationIdempotencyKeyHash) throw new Error("健康资料包已经撤销");
          const at = new Date();
          Object.assign(item, CitizenRecordsV2.revokeSharePackage(item, at), {
            receiptId: `care-receipt-${randomUUID()}`,
            auditRef: `care-audit-${randomUUID()}`,
            acceptedAt: at.toISOString(),
            updatedAt: at.toISOString(),
            syncStatus: "accepted",
            revocationIdempotencyKeyHash: keyHash,
            revocationRequestDigest: requestDigest,
            actorId: user.username || user.id || user.residentId
          });
          appendDataAccessLog(data, user, user.residentId, "一次性健康资料包", `撤销 ${item.accessRef}`);
          data.securityEvents = prependAuditTrailEntry(data.securityEvents, {
            id: randomUUID(), at: at.toLocaleString("zh-CN", { hour12: false }), actor: user.name, role: user.role,
            action: "撤销居民健康资料包", target: id, result: "允许", detail: item.auditRef
          });
          writeDatabase(normalizeState(data));
          sendJson(res, 200, citizenCareReceipt(item));
        } catch (error) {
          appendSecurityEvent({ actor: user.name, role: user.role, action: "撤销居民健康资料包", target: id, result: "拒绝", detail: error.message });
          sendJson(res, /本人|超出/.test(error.message) ? 403 : 400, { error: /本人|超出/.test(error.message) ? "Forbidden" : "Bad Request", message: error.message });
        }
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/personal-records") {
        const user = requireApiRole(req, res, ["citizen", "institution", "insurance", "county", "commission"], "/api/personal-records");
        if (!user) return true;
        const data = readDatabase();
        const residentId = url.searchParams.get("residentId");
        const category = url.searchParams.get("category");
        const citizenDecision = user.role === "citizen"
          ? CitizenRecordsPolicy.evaluateCitizenRecordAccess(data, user, {
              residentId,
              category: category || "health-record-summary"
            }, {
              scope: category ? CitizenRecordsPolicy.scopeForRecordCategory(category) : "health-record-summary",
              purpose: "居民健康记录查询",
              now: new Date()
            })
          : null;
        if (user.role === "citizen" ? !citizenDecision.allowed : !canAccessResident(user, residentId, data)) {
          appendSecurityEvent({ actor: user.name, role: user.role, action: "访问个人健康信息", target: residentId || "all", result: "拒绝", detail: "超出居民授权范围" });
          sendJson(res, 403, { error: "Forbidden", message: "无权访问该居民健康信息" });
          return true;
        }
        let records = data.personalRecords.filter((item) => (!residentId || item.residentId === residentId) && (!category || item.category === category));
        if (user.role === "citizen") {
          records = records
            .filter((item) => CitizenRecordsPolicy.canCitizenReadRecord(data, user, item, { purpose: "居民健康记录查询", now: new Date() }))
            .map((item) => CitizenRecordsPolicy.projectCitizenRecordResponse(item, residentId))
            .filter(Boolean);
        }
        if (residentId) {
          appendDataAccessLog(data, user, residentId, "个人健康信息库", `查询 ${category || "全部"} 记录`);
          writeDatabase(data);
        }
        sendJson(res, 200, redactSensitiveResponse(records, user));
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/personal-records") {
        const user = requireApiRole(req, res, ["citizen", "institution", "commission"], "/api/personal-records");
        if (!user) return true;
        const data = readDatabase();
        const payload = await collectJson(req);
        let recordData;
        let replay = null;
        let requestDigest = "";
        try {
          if (user.role === "citizen") {
            const idempotencyKey = citizenCareIdempotencyKey(req, payload);
            requestDigest = citizenCareRequestDigest(payload);
            replay = citizenCareReplay(data.personalRecords, idempotencyKey, requestDigest);
            if (replay.existing) {
              sendJson(res, 200, redactSensitiveResponse(citizenCareReceipt(replay.existing), user));
              return true;
            }
            if (payload.category === "authorizations") {
              recordData = normalizePersonalRecord(CitizenRecordsV1.buildAuthorizationRecord({
                residentId: user.residentId,
                granteeName: payload.name,
                granteeId: payload.meta?.granteeId,
                granteeType: payload.meta?.granteeType,
                previousAuthorizationId: payload.meta?.previousAuthorizationId,
                purpose: payload.meta?.purpose,
                scopes: payload.meta?.scopes,
                expiresAt: payload.meta?.expiresAt || payload.date,
                consentVersion: payload.meta?.consentVersion,
                source: payload.source,
                grantedAt: new Date().toISOString()
              }));
            } else {
              recordData = normalizePersonalRecord(CitizenRecordsPolicy.normalizeCitizenSupplement(payload, user));
            }
          } else {
            recordData = normalizePersonalRecord(payload);
          }
        } catch (error) {
          appendSecurityEvent({ actor: user.name, role: user.role, action: "新增个人健康信息", target: String(payload.residentId || user.residentId || ""), result: "拒绝", detail: error.message });
          const forbidden = /本人|self record|超出/i.test(error.message);
          sendJson(res, forbidden ? 403 : 400, { error: forbidden ? "Forbidden" : "Bad Request", message: error.message });
          return true;
        }
        if (!canAccessResident(user, recordData.residentId, data)) {
          appendSecurityEvent({ actor: user.name, role: user.role, action: "create personal health record", target: recordData.residentId, result: "拒绝", detail: "超出居民授权范围" });
          sendJson(res, 403, { error: "Forbidden", message: "无权新增该居民健康信息" });
          return true;
        }
        const residentMap = new Map(data.residents.map((resident) => [resident.id, resident]));
        recordData.id = randomUUID();
        recordData.personIndex = recordData.personIndex || personIndexForResident(residentMap, recordData.residentId);
        recordData.createdBy = user.username || user.role;
        recordData.createdByName = user.name;
        if (user.role === "citizen") {
          recordData.receiptId = `record-receipt-${randomUUID()}`;
          recordData.auditRef = `record-audit-${randomUUID()}`;
          recordData.acceptedAt = new Date().toISOString();
          recordData.syncStatus = "accepted";
          recordData.idempotencyKeyHash = replay.keyHash;
          recordData.requestDigest = requestDigest;
        }
        data.personalRecords.push(recordData);
        if (Object.hasOwn(payload, "expectedVersion")) {
          data.storageMeta = {
            ...(data.storageMeta || {}),
            collectionVersions: { personalRecords: Number(payload.expectedVersion) }
          };
        }
        appendDataAccessLog(data, user, recordData.residentId, "个人健康信息库", `新增 ${recordData.category} 记录`);
        writeDatabase(data);
        sendJson(res, 201, recordData);
        return true;
      }

      if (req.method === "PATCH" && url.pathname.startsWith("/api/personal-records/")) {
        const user = requireApiRole(req, res, ["citizen", "institution", "commission"], "/api/personal-records/:id");
        if (!user) return true;
        const id = decodeURIComponent(url.pathname.replace("/api/personal-records/", ""));
        const patch = await collectJson(req);
        const data = readDatabase();
        const index = data.personalRecords.findIndex((item) => item.id === id);
        if (index < 0) {
          sendJson(res, 404, { error: "personal record not found" });
          return true;
        }
        if (!canAccessResident(user, data.personalRecords[index].residentId, data)) {
          appendSecurityEvent({ actor: user.name, role: user.role, action: "更新个人健康信息", target: data.personalRecords[index].residentId, result: "拒绝", detail: "超出居民授权范围" });
          sendJson(res, 403, { error: "Forbidden", message: "无权更新该居民健康信息" });
          return true;
        }
        if (user.role === "citizen" && data.personalRecords[index].meta?.authority !== "resident-upload") {
          appendSecurityEvent({ actor: user.name, role: user.role, action: "更新个人健康信息", target: data.personalRecords[index].residentId, result: "拒绝", detail: "权威来源记录不得由居民直接覆盖，请提交纠错申请" });
          sendJson(res, 403, { error: "Forbidden", message: "权威来源记录不得由居民直接覆盖，请提交纠错申请" });
          return true;
        }
        const safePatch = Object.fromEntries(Object.entries(patch).filter(([key]) => !PERSONAL_RECORD_PROTECTED_FIELDS.has(key)));
        data.personalRecords[index] = {
          ...data.personalRecords[index],
          ...safePatch,
          meta: {
            ...(data.personalRecords[index].meta || {}),
            ...(safePatch.meta && typeof safePatch.meta === "object" ? safePatch.meta : {})
          },
          updatedBy: user.username || user.role,
          updatedByName: user.name,
          updatedAt: new Date().toISOString()
        };
        appendDataAccessLog(data, user, data.personalRecords[index].residentId, "个人健康信息库", `更新 ${data.personalRecords[index].category} 记录`);
        if (Object.hasOwn(patch, "expectedVersion")) {
          data.storageMeta = {
            ...(data.storageMeta || {}),
            collectionVersions: { personalRecords: Number(patch.expectedVersion) }
          };
        }
        writeDatabase(data);
        sendJson(res, 200, data.personalRecords[index]);
        return true;
      }
        return false;
      }
    },
  ];
}

module.exports = { createRouteSegments };
