"use strict";

function createRouteSegment(runtime) {
  const { PUBLIC_HEALTH_SITE_EVIDENCE_LINKS, appendSecurityEvent, buildPublicHealthCutoverReadiness, buildPublicHealthHighlights, buildPublicHealthSiteEvidenceBridge, buildPublicHealthSystem, collectJson, mergeByKey, normalizePublicHealthAiReviewAction, normalizePublicHealthCommandTaskAction, normalizePublicHealthCutoverBlockerAction, normalizePublicHealthCutoverDrillAction, normalizePublicHealthCutoverEvidencePacketAction, normalizePublicHealthEventAction, normalizePublicHealthEvidenceAction, normalizePublicHealthExchangeExceptionAction, normalizePublicHealthExchangeRun, normalizePublicHealthGoLiveObservationAction, normalizePublicHealthHighlightAlertAction, normalizePublicHealthInstitutionTaskAction, normalizePublicHealthLaunchCommandBriefAction, normalizePublicHealthLaunchDutyShiftAction, normalizePublicHealthLaunchGateAction, normalizePublicHealthLaunchIncidentAction, normalizePublicHealthOnsiteAcceptanceAction, normalizePublicHealthProductionHandoffAction, normalizePublicHealthSignal, normalizePublicHealthSiteEvidenceVerificationTaskAction, normalizePublicHealthStandardImplementationAction, normalizeState, randomUUID, readDatabase, requireApiRole, sealAuditTrail, seedPublicHealthAiReviews, seedPublicHealthAlerts, seedPublicHealthCommandTasks, seedPublicHealthCutoverBlockers, seedPublicHealthCutoverDrills, seedPublicHealthCutoverEvidencePackets, seedPublicHealthEvents, seedPublicHealthEvidenceRecords, seedPublicHealthExchangeRuns, seedPublicHealthExchangeTasks, seedPublicHealthGoLiveObservations, seedPublicHealthInstitutionTasks, seedPublicHealthLaunchApprovals, seedPublicHealthLaunchCommandBriefs, seedPublicHealthLaunchDutyShifts, seedPublicHealthLaunchIncidents, seedPublicHealthOnsiteAcceptances, seedPublicHealthProductionHandoffs, seedPublicHealthReadinessEvidence, seedPublicHealthSignals, seedPublicHealthSiteEvidenceVerificationTasks, seedPublicHealthStandardImplementationLedger, sendJson, upsertSiteLaunchEvidence, writeDatabase } = runtime;
  return {
      id: "public-health-02",
      domain: "public-health",
      async handle(req, res, url) {
    if (req.method === "GET" && url.pathname === "/api/public-health/system") {
        const user = requireApiRole(req, res, ["commission"], "/api/public-health/system");
        if (!user) return true;
        const data = readDatabase();
        const system = buildPublicHealthSystem({ data });
        const highlights = buildPublicHealthHighlights({ data });
        appendSecurityEvent({
          actor: user.name,
          role: user.role,
          action: "public-health-system",
          target: "/api/public-health/system",
          result: "allowed",
          detail: "Public health standard matrix, institution scopes, events, and exchange tasks read."
        });
        sendJson(res, 200, {
          ...system,
          highlights,
          summary: {
            ...system.summary,
            highlightCapabilities: highlights.summary.capabilities,
            highlightActiveAlerts: highlights.summary.activeAlerts,
            highlightOpenTasks: highlights.summary.openTasks,
            highlightEvidenceScore: highlights.summary.evidenceScore
          }
        });
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/public-health/highlights") {
        const user = requireApiRole(req, res, ["commission"], "/api/public-health/highlights");
        if (!user) return true;
        const data = readDatabase();
        const highlights = buildPublicHealthHighlights({ data });
        appendSecurityEvent({
          actor: user.name,
          role: user.role,
          action: "public-health-highlight-read",
          target: "/api/public-health/highlights",
          result: "allowed",
          detail: `${highlights.summary.capabilities} capabilities / ${highlights.summary.activeAlerts} active alerts / ${highlights.summary.openTasks} open tasks`
        });
        sendJson(res, 200, highlights);
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/public-health/highlights/signals") {
        const user = requireApiRole(req, res, ["commission"], "/api/public-health/highlights/signals");
        if (!user) return true;
        const payload = await collectJson(req);
        const data = readDatabase();
        let signal;
        try {
          signal = normalizePublicHealthSignal(payload, user);
        } catch (error) {
          sendJson(res, 400, { error: "Bad Request", message: error.message });
          return true;
        }
        data.publicHealthSignals = [signal, ...mergeByKey(seedPublicHealthSignals(), data.publicHealthSignals, "id")].slice(0, 200);
        data.securityEvents = sealAuditTrail([
          {
            id: randomUUID(),
            at: new Date().toLocaleString("zh-CN", { hour12: false }),
            actor: user.name,
            role: user.role,
            action: "public-health-highlight-signal",
            target: signal.id,
            result: "allowed",
            detail: `${signal.sourceType} / ${signal.metric} / ${signal.value}`
          },
          ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
        ].slice(0, 120), { recompute: true });
        writeDatabase(data);
        sendJson(res, 201, {
          ok: true,
          signal,
          highlights: buildPublicHealthHighlights({ data: readDatabase() })
        });
        return true;
      }

      const publicHealthHighlightAlertActionMatchDuplicate = url.pathname.match(/^\/api\/public-health\/highlights\/alerts\/([^/]+)\/actions$/);
      if (req.method === "POST" && publicHealthHighlightAlertActionMatchDuplicate) {
        const user = requireApiRole(req, res, ["commission"], "/api/public-health/highlights/alerts/:id/actions");
        if (!user) return true;
        const alertId = decodeURIComponent(publicHealthHighlightAlertActionMatchDuplicate[1]);
        const payload = await collectJson(req);
        const data = readDatabase();
        const alerts = mergeByKey(seedPublicHealthAlerts(), data.publicHealthAlerts, "id");
        const index = alerts.findIndex((item) => item.id === alertId);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "public health highlight alert not found" });
          return true;
        }
        let normalized;
        try {
          normalized = normalizePublicHealthHighlightAlertAction(alerts[index], payload, user);
        } catch (error) {
          sendJson(res, 400, { error: "Bad Request", message: error.message });
          return true;
        }
        alerts[index] = normalized.item;
        data.publicHealthAlerts = alerts;
        data.securityEvents = sealAuditTrail([
          {
            id: randomUUID(),
            at: new Date().toLocaleString("zh-CN", { hour12: false }),
            actor: user.name,
            role: user.role,
            action: "public-health-highlight-alert-action",
            target: alertId,
            result: "allowed",
            detail: `${normalized.history.action} / ${normalized.item.status}`
          },
          ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
        ].slice(0, 120), { recompute: true });
        writeDatabase(data);
        sendJson(res, 200, {
          ok: true,
          alert: normalized.item,
          action: normalized.history,
          highlights: buildPublicHealthHighlights({ data: readDatabase() })
        });
        return true;
      }

      const publicHealthHighlightTaskActionMatch = url.pathname.match(/^\/api\/public-health\/highlights\/command-tasks\/([^/]+)\/actions$/);
      if (req.method === "POST" && publicHealthHighlightTaskActionMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/public-health/highlights/command-tasks/:id/actions");
        if (!user) return true;
        const taskId = decodeURIComponent(publicHealthHighlightTaskActionMatch[1]);
        const payload = await collectJson(req);
        const data = readDatabase();
        const tasks = mergeByKey(seedPublicHealthCommandTasks(), data.publicHealthCommandTasks, "id");
        const index = tasks.findIndex((item) => item.id === taskId);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "public health highlight command task not found" });
          return true;
        }
        let normalized;
        try {
          normalized = normalizePublicHealthCommandTaskAction(tasks[index], payload, user);
        } catch (error) {
          sendJson(res, 400, { error: "Bad Request", message: error.message });
          return true;
        }
        tasks[index] = normalized.item;
        data.publicHealthCommandTasks = tasks;
        data.securityEvents = sealAuditTrail([
          {
            id: randomUUID(),
            at: new Date().toLocaleString("zh-CN", { hour12: false }),
            actor: user.name,
            role: user.role,
            action: "public-health-highlight-command-task-action",
            target: taskId,
            result: "allowed",
            detail: `${normalized.history.action} / ${normalized.item.status}`
          },
          ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
        ].slice(0, 120), { recompute: true });
        writeDatabase(data);
        sendJson(res, 200, {
          ok: true,
          task: normalized.item,
          action: normalized.history,
          highlights: buildPublicHealthHighlights({ data: readDatabase() })
        });
        return true;
      }

      const publicHealthHighlightAiActionMatch = url.pathname.match(/^\/api\/public-health\/highlights\/ai-reviews\/([^/]+)\/actions$/);
      if (req.method === "POST" && publicHealthHighlightAiActionMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/public-health/highlights/ai-reviews/:id/actions");
        if (!user) return true;
        const reviewId = decodeURIComponent(publicHealthHighlightAiActionMatch[1]);
        const payload = await collectJson(req);
        const data = readDatabase();
        const reviews = mergeByKey(seedPublicHealthAiReviews(), data.publicHealthAiReviews, "id");
        const index = reviews.findIndex((item) => item.id === reviewId);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "public health highlight AI review not found" });
          return true;
        }
        let normalized;
        try {
          normalized = normalizePublicHealthAiReviewAction(reviews[index], payload, user);
        } catch (error) {
          sendJson(res, 400, { error: "Bad Request", message: error.message });
          return true;
        }
        reviews[index] = normalized.item;
        data.publicHealthAiReviews = reviews;
        data.securityEvents = sealAuditTrail([
          {
            id: randomUUID(),
            at: new Date().toLocaleString("zh-CN", { hour12: false }),
            actor: user.name,
            role: user.role,
            action: "public-health-highlight-ai-review-action",
            target: reviewId,
            result: "allowed",
            detail: `${normalized.history.action} / ${normalized.item.status}`
          },
          ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
        ].slice(0, 120), { recompute: true });
        writeDatabase(data);
        sendJson(res, 200, {
          ok: true,
          review: normalized.item,
          action: normalized.history,
          highlights: buildPublicHealthHighlights({ data: readDatabase() })
        });
        return true;
      }

      const publicHealthHighlightEvidenceActionMatch = url.pathname.match(/^\/api\/public-health\/highlights\/evidence\/([^/]+)\/actions$/);
      if (req.method === "POST" && publicHealthHighlightEvidenceActionMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/public-health/highlights/evidence/:id/actions");
        if (!user) return true;
        const evidenceId = decodeURIComponent(publicHealthHighlightEvidenceActionMatch[1]);
        const payload = await collectJson(req);
        const data = readDatabase();
        const records = mergeByKey(seedPublicHealthEvidenceRecords(), data.publicHealthEvidenceRecords, "id");
        const index = records.findIndex((item) => item.id === evidenceId);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "public health highlight evidence record not found" });
          return true;
        }
        let normalized;
        try {
          normalized = normalizePublicHealthEvidenceAction(records[index], payload, user);
        } catch (error) {
          sendJson(res, 400, { error: "Bad Request", message: error.message });
          return true;
        }
        records[index] = normalized.item;
        data.publicHealthEvidenceRecords = records;
        data.securityEvents = sealAuditTrail([
          {
            id: randomUUID(),
            at: new Date().toLocaleString("zh-CN", { hour12: false }),
            actor: user.name,
            role: user.role,
            action: "public-health-highlight-evidence-action",
            target: evidenceId,
            result: "allowed",
            detail: `${normalized.history.action} / ${normalized.item.status}`
          },
          ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
        ].slice(0, 120), { recompute: true });
        writeDatabase(data);
        sendJson(res, 200, {
          ok: true,
          evidence: normalized.item,
          action: normalized.history,
          highlights: buildPublicHealthHighlights({ data: readDatabase() })
        });
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/public-health/standard-implementation-ledger") {
        const user = requireApiRole(req, res, ["commission"], "/api/public-health/standard-implementation-ledger");
        if (!user) return true;
        const data = readDatabase();
        const system = buildPublicHealthSystem({ data });
        appendSecurityEvent({
          actor: user.name,
          role: user.role,
          action: "public-health-standard-implementation-ledger",
          target: "/api/public-health/standard-implementation-ledger",
          result: "allowed",
          detail: `${system.standardImplementationBoard?.summary?.mappingComplete || 0}/${system.standardImplementationBoard?.summary?.domains || 0} standard mappings complete`
        });
        sendJson(res, 200, {
          ok: true,
          generatedAt: system.generatedAt,
          summary: system.standardImplementationBoard?.summary || {},
          board: system.standardImplementationBoard,
          entries: system.standardImplementationLedger || [],
          standardImplementationEvidenceCandidates: system.standardImplementationEvidenceCandidates || []
        });
        return true;
      }

      const publicHealthStandardImplementationActionMatch = url.pathname.match(/^\/api\/public-health\/standard-implementation-ledger\/([^/]+)\/actions$/);
      if (req.method === "POST" && publicHealthStandardImplementationActionMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/public-health/standard-implementation-ledger/:id/actions");
        if (!user) return true;
        const entryId = decodeURIComponent(publicHealthStandardImplementationActionMatch[1]);
        const payload = await collectJson(req);
        const data = readDatabase();
        const ledger = mergeByKey(seedPublicHealthStandardImplementationLedger(), data.publicHealthStandardImplementationLedger, "id");
        const index = ledger.findIndex((item) => item.id === entryId);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "public health standard implementation entry not found" });
          return true;
        }
        let normalized;
        try {
          normalized = normalizePublicHealthStandardImplementationAction(ledger[index], payload, data, user);
        } catch (error) {
          sendJson(res, 400, { error: "Bad Request", message: error.message });
          return true;
        }
        ledger[index] = normalized.entry;
        data.publicHealthStandardImplementationLedger = ledger;
        data.publicHealthReadinessEvidence = mergeByKey(seedPublicHealthReadinessEvidence(), data.publicHealthReadinessEvidence, "id").map((row) => (
          row.id === "phev-standard-implementation-ledger"
            ? { ...row, status: "standard implementation action recorded", evidence: Array.from(new Set([...(row.evidence || []), "publicHealthStandardImplementationLedger"])) }
            : row
        ));
        data.securityEvents = sealAuditTrail([
          {
            id: randomUUID(),
            at: new Date().toLocaleString("zh-CN", { hour12: false }),
            actor: user.name,
            role: user.role,
            action: "public-health-standard-implementation-action",
            target: entryId,
            result: "allowed",
            detail: `${normalized.history.action} / ${normalized.history.status} / ${normalized.history.gapStatus}`
          },
          ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
        ].slice(0, 120), { recompute: true });
        writeDatabase(data);
        const system = buildPublicHealthSystem({ data: readDatabase() });
        sendJson(res, 200, {
          ok: true,
          entry: normalized.entry,
          action: normalized.history,
          board: system.standardImplementationBoard,
          system
        });
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/public-health/cutover-readiness") {
        const user = requireApiRole(req, res, ["commission"], "/api/public-health/cutover-readiness");
        if (!user) return true;
        const data = readDatabase();
        const system = buildPublicHealthSystem({ data });
        const readiness = system.cutoverReadiness || buildPublicHealthCutoverReadiness(system.cutoverBlockers || []);
        appendSecurityEvent({
          actor: user.name,
          role: user.role,
          action: "public-health-cutover-readiness",
          target: "/api/public-health/cutover-readiness",
          result: "allowed",
          detail: `${readiness.readinessLevel} / ${readiness.releaseGate} / ${readiness.summary?.p0Open || 0} P0 open`
        });
        sendJson(res, 200, {
          ok: true,
          generatedAt: system.generatedAt,
          productionReady: readiness.releaseGate === "production-ready",
          summary: readiness.summary,
          readiness,
          blockers: system.cutoverBlockers || []
        });
        return true;
      }

      const publicHealthEventActionMatch = url.pathname.match(/^\/api\/public-health\/events\/([^/]+)\/actions$/);
      if (req.method === "POST" && publicHealthEventActionMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/public-health/events/:id/actions");
        if (!user) return true;
        const eventId = decodeURIComponent(publicHealthEventActionMatch[1]);
        const payload = await collectJson(req);
        const data = readDatabase();
        const events = Array.isArray(data.publicHealthEvents) ? data.publicHealthEvents : seedPublicHealthEvents();
        const index = events.findIndex((item) => item.id === eventId);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "未找到公共卫生事件" });
          return true;
        }
        const { event, history } = normalizePublicHealthEventAction(events[index], payload, user);
        events[index] = event;
        data.publicHealthEvents = events;
        data.publicHealthReadinessEvidence = (Array.isArray(data.publicHealthReadinessEvidence) ? data.publicHealthReadinessEvidence : seedPublicHealthReadinessEvidence()).map((item) => (
          item.id === "phev-event-command"
            ? { ...item, status: "动作闭环已验证", nextAction: "继续接入正式事件分级、处置时限、信息发布审批和现场签字材料。" }
            : item
        ));
        data.securityEvents = [
          {
            id: randomUUID(),
            at: new Date().toLocaleString("zh-CN", { hour12: false }),
            actor: user.name,
            role: user.role,
            action: "public-health-event-action",
            target: eventId,
            result: "allowed",
            detail: `${history.label} / ${history.status}`
          },
          ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
        ].slice(0, 120);
        writeDatabase(data);
        sendJson(res, 200, {
          ok: true,
          event,
          action: history,
          system: buildPublicHealthSystem({ data })
        });
        return true;
      }

      const publicHealthExchangeExceptionActionMatch = url.pathname.match(/^\/api\/public-health\/exchange-runs\/([^/]+)\/actions$/);
      if (req.method === "POST" && publicHealthExchangeExceptionActionMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/public-health/exchange-runs/:id/actions");
        if (!user) return true;
        const runId = decodeURIComponent(publicHealthExchangeExceptionActionMatch[1]);
        const payload = await collectJson(req);
        const data = readDatabase();
        const runs = mergeByKey(seedPublicHealthExchangeRuns(), data.publicHealthExchangeRuns, "id");
        const index = runs.findIndex((item) => item.id === runId);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "public health exchange run not found" });
          return true;
        }
        let normalized;
        try {
          normalized = normalizePublicHealthExchangeExceptionAction(runs[index], payload, user);
        } catch (error) {
          sendJson(res, 400, { error: "Bad Request", message: error.message });
          return true;
        }
        runs[index] = normalized.run;
        data.publicHealthExchangeRuns = runs;
        data.publicHealthReadinessEvidence = mergeByKey(seedPublicHealthReadinessEvidence(), data.publicHealthReadinessEvidence, "id").map((item) => (
          item.id === "phev-exchange-security"
            ? { ...item, status: "exchange exception compensation recorded", evidence: Array.from(new Set([...(item.evidence || []), "publicHealthExchangeRuns"])) }
            : item
        ));
        data.securityEvents = sealAuditTrail([
          {
            id: randomUUID(),
            at: new Date().toLocaleString("zh-CN", { hour12: false }),
            actor: user.name,
            role: user.role,
            action: "public-health-exchange-exception-action",
            target: runId,
            result: "allowed",
            detail: `${normalized.history.action} / ${normalized.history.status} / ${normalized.history.compensationReceiptId || "pending"}`
          },
          ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
        ].slice(0, 120), { recompute: true });
        writeDatabase(data);
        sendJson(res, 200, {
          ok: true,
          run: normalized.run,
          action: normalized.history,
          system: buildPublicHealthSystem({ data: readDatabase() })
        });
        return true;
      }

      const publicHealthExchangeRunMatch = url.pathname.match(/^\/api\/public-health\/exchange-tasks\/([^/]+)\/runs$/);
      if (req.method === "POST" && publicHealthExchangeRunMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/public-health/exchange-tasks/:id/runs");
        if (!user) return true;
        const taskId = decodeURIComponent(publicHealthExchangeRunMatch[1]);
        const payload = await collectJson(req);
        const data = readDatabase();
        const tasks = Array.isArray(data.publicHealthExchangeTasks) ? data.publicHealthExchangeTasks : seedPublicHealthExchangeTasks();
        const index = tasks.findIndex((item) => item.id === taskId);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "未找到公共卫生交换任务" });
          return true;
        }
        const { run, task } = normalizePublicHealthExchangeRun(tasks[index], payload, user);
        tasks[index] = task;
        data.publicHealthExchangeTasks = tasks;
        data.publicHealthExchangeRuns = [run, ...(Array.isArray(data.publicHealthExchangeRuns) ? data.publicHealthExchangeRuns : [])].slice(0, 120);
        data.publicHealthReadinessEvidence = (Array.isArray(data.publicHealthReadinessEvidence) ? data.publicHealthReadinessEvidence : seedPublicHealthReadinessEvidence()).map((item) => (
          item.id === "phev-exchange-security"
            ? { ...item, status: "运行回执已验证", evidence: Array.from(new Set([...(item.evidence || []), "publicHealthExchangeRuns"])) }
            : item
        ));
        data.securityEvents = [
          {
            id: randomUUID(),
            at: new Date().toLocaleString("zh-CN", { hour12: false }),
            actor: user.name,
            role: user.role,
            action: "public-health-exchange-run",
            target: taskId,
            result: "allowed",
            detail: `${run.status} / ${run.receiptStatus} / ${run.compensationStatus}`
          },
          ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
        ].slice(0, 120);
        writeDatabase(data);
        sendJson(res, 200, {
          ok: true,
          task,
          run,
          system: buildPublicHealthSystem({ data })
        });
        return true;
      }

      const publicHealthInstitutionTaskActionMatch = url.pathname.match(/^\/api\/public-health\/institution-tasks\/([^/]+)\/actions$/);
      if (req.method === "POST" && publicHealthInstitutionTaskActionMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/public-health/institution-tasks/:id/actions");
        if (!user) return true;
        const taskId = decodeURIComponent(publicHealthInstitutionTaskActionMatch[1]);
        const payload = await collectJson(req);
        const data = readDatabase();
        const tasks = Array.isArray(data.publicHealthInstitutionTasks) ? data.publicHealthInstitutionTasks : seedPublicHealthInstitutionTasks();
        const index = tasks.findIndex((item) => item.id === taskId);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "未找到公共卫生机构协同任务" });
          return true;
        }
        const { task, history } = normalizePublicHealthInstitutionTaskAction(tasks[index], payload, user);
        tasks[index] = task;
        data.publicHealthInstitutionTasks = tasks;
        data.publicHealthReadinessEvidence = (Array.isArray(data.publicHealthReadinessEvidence) ? data.publicHealthReadinessEvidence : seedPublicHealthReadinessEvidence()).map((item) => (
          item.id === "phev-institution-collaboration"
            ? { ...item, status: "机构协同已验证", evidence: Array.from(new Set([...(item.evidence || []), "publicHealthInstitutionTasks"])) }
            : item
        ));
        data.securityEvents = [
          {
            id: randomUUID(),
            at: new Date().toLocaleString("zh-CN", { hour12: false }),
            actor: user.name,
            role: user.role,
            action: "public-health-institution-task-action",
            target: taskId,
            result: "allowed",
            detail: `${history.action} / ${history.status}`
          },
          ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
        ].slice(0, 120);
        writeDatabase(data);
        sendJson(res, 200, {
          ok: true,
          task,
          action: history,
          system: buildPublicHealthSystem({ data })
        });
        return true;
      }

      const publicHealthOnsiteAcceptanceActionMatch = url.pathname.match(/^\/api\/public-health\/onsite-acceptances\/([^/]+)\/actions$/);
      if (req.method === "POST" && publicHealthOnsiteAcceptanceActionMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/public-health/onsite-acceptances/:id/actions");
        if (!user) return true;
        const acceptanceId = decodeURIComponent(publicHealthOnsiteAcceptanceActionMatch[1]);
        const payload = await collectJson(req);
        const data = readDatabase();
        const acceptances = Array.isArray(data.publicHealthOnsiteAcceptances) ? data.publicHealthOnsiteAcceptances : seedPublicHealthOnsiteAcceptances();
        const index = acceptances.findIndex((item) => item.id === acceptanceId);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "未找到公共卫生现场验收项" });
          return true;
        }
        const { item, history } = normalizePublicHealthOnsiteAcceptanceAction(acceptances[index], payload, user);
        acceptances[index] = item;
        data.publicHealthOnsiteAcceptances = acceptances;
        data.publicHealthReadinessEvidence = (Array.isArray(data.publicHealthReadinessEvidence) ? data.publicHealthReadinessEvidence : seedPublicHealthReadinessEvidence()).map((row) => (
          row.id === "phev-onsite-acceptance"
            ? { ...row, status: "现场验收动作已记录", evidence: Array.from(new Set([...(row.evidence || []), "publicHealthOnsiteAcceptances"])) }
            : row
        ));
        data.securityEvents = [
          {
            id: randomUUID(),
            at: new Date().toLocaleString("zh-CN", { hour12: false }),
            actor: user.name,
            role: user.role,
            action: "public-health-onsite-acceptance",
            target: acceptanceId,
            result: "allowed",
            detail: `${history.action} / ${history.status}`
          },
          ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
        ].slice(0, 120);
        writeDatabase(data);
        sendJson(res, 200, {
          ok: true,
          acceptance: item,
          action: history,
          system: buildPublicHealthSystem({ data })
        });
        return true;
      }

      const publicHealthCutoverBlockerActionMatch = url.pathname.match(/^\/api\/public-health\/cutover-blockers\/([^/]+)\/actions$/);
      if (req.method === "POST" && publicHealthCutoverBlockerActionMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/public-health/cutover-blockers/:id/actions");
        if (!user) return true;
        const blockerId = decodeURIComponent(publicHealthCutoverBlockerActionMatch[1]);
        const payload = await collectJson(req);
        const data = readDatabase();
        const blockers = Array.isArray(data.publicHealthCutoverBlockers) ? data.publicHealthCutoverBlockers : seedPublicHealthCutoverBlockers();
        const index = blockers.findIndex((item) => item.id === blockerId);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "未找到公共卫生上线阻塞项" });
          return true;
        }
        const { item, history } = normalizePublicHealthCutoverBlockerAction(blockers[index], payload, user);
        blockers[index] = item;
        data.publicHealthCutoverBlockers = blockers;
        data.publicHealthReadinessEvidence = (Array.isArray(data.publicHealthReadinessEvidence) ? data.publicHealthReadinessEvidence : seedPublicHealthReadinessEvidence()).map((row) => (
          row.id === "phev-cutover-blockers"
            ? { ...row, status: "上线阻塞动作已记录", evidence: Array.from(new Set([...(row.evidence || []), "publicHealthCutoverBlockers"])) }
            : row
        ));
        data.securityEvents = [
          {
            id: randomUUID(),
            at: new Date().toLocaleString("zh-CN", { hour12: false }),
            actor: user.name,
            role: user.role,
            action: "public-health-cutover-blocker-action",
            target: blockerId,
            result: "allowed",
            detail: `${history.action} / ${history.status}`
          },
          ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
        ].slice(0, 120);
        writeDatabase(data);
        sendJson(res, 200, {
          ok: true,
          blocker: item,
          action: history,
          system: buildPublicHealthSystem({ data })
        });
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/public-health/cutover-evidence-packets") {
        const user = requireApiRole(req, res, ["commission"], "/api/public-health/cutover-evidence-packets");
        if (!user) return true;
        const data = readDatabase();
        const system = buildPublicHealthSystem({ data });
        appendSecurityEvent({
          actor: user.name,
          role: user.role,
          action: "public-health-cutover-evidence-packets",
          target: "/api/public-health/cutover-evidence-packets",
          result: "allowed",
          detail: `${system.cutoverEvidenceBoard?.summary?.packets || 0} packets / ${system.cutoverEvidenceBoard?.summary?.verifiedItems || 0} verified items`
        });
        sendJson(res, 200, {
          ok: true,
          generatedAt: system.generatedAt,
          summary: system.cutoverEvidenceBoard?.summary || {},
          board: system.cutoverEvidenceBoard,
          packets: system.cutoverEvidencePackets || []
        });
        return true;
      }

      const publicHealthCutoverEvidencePacketActionMatch = url.pathname.match(/^\/api\/public-health\/cutover-evidence-packets\/([^/]+)\/actions$/);
      if (req.method === "POST" && publicHealthCutoverEvidencePacketActionMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/public-health/cutover-evidence-packets/:id/actions");
        if (!user) return true;
        const packetId = decodeURIComponent(publicHealthCutoverEvidencePacketActionMatch[1]);
        const payload = await collectJson(req);
        const data = readDatabase();
        const blockers = Array.isArray(data.publicHealthCutoverBlockers) ? data.publicHealthCutoverBlockers : seedPublicHealthCutoverBlockers();
        const packets = Array.isArray(data.publicHealthCutoverEvidencePackets) ? data.publicHealthCutoverEvidencePackets : seedPublicHealthCutoverEvidencePackets(blockers);
        const index = packets.findIndex((item) => item.id === packetId);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "未找到公共卫生上线证据包" });
          return true;
        }
        let normalized;
        try {
          normalized = normalizePublicHealthCutoverEvidencePacketAction(packets[index], payload, user);
        } catch (error) {
          sendJson(res, 400, { error: "Bad Request", message: error.message });
          return true;
        }
        packets[index] = normalized.packet;
        data.publicHealthCutoverEvidencePackets = packets;
        data.publicHealthCutoverBlockers = blockers.map((row) => row.id === normalized.packet.blockerId
          ? {
              ...row,
              evidenceStatus: normalized.packet.signoffStatus === "signed" ? "packet-signed" : "packet-recorded",
              evidence: Array.from(new Set([...(row.evidence || []), normalized.history.artifactName].filter(Boolean)))
            }
          : row);
        data.publicHealthReadinessEvidence = (Array.isArray(data.publicHealthReadinessEvidence) ? data.publicHealthReadinessEvidence : seedPublicHealthReadinessEvidence()).map((row) => (
          row.id === "phev-cutover-evidence-packets"
            ? { ...row, status: "证据包动作已记录", evidence: Array.from(new Set([...(row.evidence || []), "publicHealthCutoverEvidencePackets"])) }
            : row
        ));
        data.securityEvents = [
          {
            id: randomUUID(),
            at: new Date().toLocaleString("zh-CN", { hour12: false }),
            actor: user.name,
            role: user.role,
            action: "public-health-cutover-evidence-packet-action",
            target: packetId,
            result: "allowed",
            detail: `${normalized.history.itemId} / ${normalized.history.status}`
          },
          ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
        ].slice(0, 120);
        writeDatabase(data);
        sendJson(res, 200, {
          ok: true,
          packet: normalized.packet,
          action: normalized.history,
          system: buildPublicHealthSystem({ data })
        });
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/public-health/site-evidence-bridge") {
        const user = requireApiRole(req, res, ["commission"], "/api/public-health/site-evidence-bridge");
        if (!user) return true;
        const data = readDatabase();
        const system = buildPublicHealthSystem({ data });
        appendSecurityEvent({
          actor: user.name,
          role: user.role,
          action: "public-health-site-evidence-bridge",
          target: "/api/public-health/site-evidence-bridge",
          result: "allowed",
          detail: `${system.siteEvidenceBridge?.summary?.verifiedLinks || 0}/${system.siteEvidenceBridge?.summary?.links || 0} verified links`
        });
        sendJson(res, 200, {
          ok: true,
          generatedAt: system.generatedAt,
          bridge: system.siteEvidenceBridge,
          summary: system.siteEvidenceBridge?.summary || {},
          links: system.siteEvidenceBridge?.links || []
        });
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/public-health/cutover-drills") {
        const user = requireApiRole(req, res, ["commission"], "/api/public-health/cutover-drills");
        if (!user) return true;
        const data = readDatabase();
        const system = buildPublicHealthSystem({ data });
        appendSecurityEvent({
          actor: user.name,
          role: user.role,
          action: "public-health-cutover-drills",
          target: "/api/public-health/cutover-drills",
          result: "allowed",
          detail: `${system.cutoverDrillBoard?.summary?.blockedDrills || 0}/${system.cutoverDrillBoard?.summary?.drills || 0} drills blocked`
        });
        sendJson(res, 200, {
          ok: true,
          generatedAt: system.generatedAt,
          summary: system.cutoverDrillBoard?.summary || {},
          board: system.cutoverDrillBoard,
          drills: system.cutoverDrills || []
        });
        return true;
      }

      const publicHealthCutoverDrillActionMatch = url.pathname.match(/^\/api\/public-health\/cutover-drills\/([^/]+)\/actions$/);
      if (req.method === "POST" && publicHealthCutoverDrillActionMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/public-health/cutover-drills/:id/actions");
        if (!user) return true;
        const drillId = decodeURIComponent(publicHealthCutoverDrillActionMatch[1]);
        const payload = await collectJson(req);
        const data = readDatabase();
        const drills = Array.isArray(data.publicHealthCutoverDrills) ? data.publicHealthCutoverDrills : seedPublicHealthCutoverDrills();
        const index = drills.findIndex((item) => item.id === drillId);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "public health cutover drill not found" });
          return true;
        }
        let normalized;
        try {
          normalized = normalizePublicHealthCutoverDrillAction(drills[index], payload, user);
        } catch (error) {
          sendJson(res, 400, { error: "Bad Request", message: error.message });
          return true;
        }
        drills[index] = normalized.drill;
        data.publicHealthCutoverDrills = drills;
        data.publicHealthReadinessEvidence = (Array.isArray(data.publicHealthReadinessEvidence) ? data.publicHealthReadinessEvidence : seedPublicHealthReadinessEvidence()).map((row) => (
          row.id === "phev-cutover-drills"
            ? { ...row, status: "上线演练动作已记录", evidence: Array.from(new Set([...(row.evidence || []), "publicHealthCutoverDrills"])) }
            : row
        ));
        data.securityEvents = [
          {
            id: randomUUID(),
            at: new Date().toLocaleString("zh-CN", { hour12: false }),
            actor: user.name,
            role: user.role,
            action: "public-health-cutover-drill-action",
            target: drillId,
            result: "allowed",
            detail: `${normalized.history.action} / ${normalized.history.status} / ${normalized.history.goNoGo}`
          },
          ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
        ].slice(0, 120);
        writeDatabase(data);
        const system = buildPublicHealthSystem({ data });
        sendJson(res, 200, {
          ok: true,
          drill: normalized.drill,
          action: normalized.history,
          board: system.cutoverDrillBoard,
          system
        });
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/public-health/production-handoffs") {
        const user = requireApiRole(req, res, ["commission"], "/api/public-health/production-handoffs");
        if (!user) return true;
        const data = readDatabase();
        const system = buildPublicHealthSystem({ data });
        appendSecurityEvent({
          actor: user.name,
          role: user.role,
          action: "public-health-production-handoffs",
          target: "/api/public-health/production-handoffs",
          result: "allowed",
          detail: `${system.productionHandoffBoard?.summary?.acceptedHandoffs || 0}/${system.productionHandoffBoard?.summary?.handoffs || 0} handoffs accepted`
        });
        sendJson(res, 200, {
          ok: true,
          generatedAt: system.generatedAt,
          summary: system.productionHandoffBoard?.summary || {},
          board: system.productionHandoffBoard,
          handoffs: system.productionHandoffs || []
        });
        return true;
      }

      const publicHealthProductionHandoffActionMatch = url.pathname.match(/^\/api\/public-health\/production-handoffs\/([^/]+)\/actions$/);
      if (req.method === "POST" && publicHealthProductionHandoffActionMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/public-health/production-handoffs/:id/actions");
        if (!user) return true;
        const handoffId = decodeURIComponent(publicHealthProductionHandoffActionMatch[1]);
        const payload = await collectJson(req);
        const data = readDatabase();
        const handoffs = Array.isArray(data.publicHealthProductionHandoffs) ? data.publicHealthProductionHandoffs : seedPublicHealthProductionHandoffs();
        const index = handoffs.findIndex((item) => item.id === handoffId);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "public health production handoff not found" });
          return true;
        }
        let normalized;
        try {
          normalized = normalizePublicHealthProductionHandoffAction(handoffs[index], payload, user);
        } catch (error) {
          sendJson(res, 400, { error: "Bad Request", message: error.message });
          return true;
        }
        handoffs[index] = normalized.handoff;
        data.publicHealthProductionHandoffs = handoffs;
        data.publicHealthReadinessEvidence = (Array.isArray(data.publicHealthReadinessEvidence) ? data.publicHealthReadinessEvidence : seedPublicHealthReadinessEvidence()).map((row) => (
          row.id === "phev-production-handoffs"
            ? { ...row, status: "production handoff action recorded", evidence: Array.from(new Set([...(row.evidence || []), "publicHealthProductionHandoffs"])) }
            : row
        ));
        data.securityEvents = [
          {
            id: randomUUID(),
            at: new Date().toLocaleString("zh-CN", { hour12: false }),
            actor: user.name,
            role: user.role,
            action: "public-health-production-handoff-action",
            target: handoffId,
            result: "allowed",
            detail: `${normalized.history.action} / ${normalized.history.status}`
          },
          ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
        ].slice(0, 120);
        writeDatabase(data);
        const system = buildPublicHealthSystem({ data });
        sendJson(res, 200, {
          ok: true,
          handoff: normalized.handoff,
          action: normalized.history,
          board: system.productionHandoffBoard,
          system
        });
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/public-health/go-live-observations") {
        const user = requireApiRole(req, res, ["commission"], "/api/public-health/go-live-observations");
        if (!user) return true;
        const data = readDatabase();
        const system = buildPublicHealthSystem({ data });
        appendSecurityEvent({
          actor: user.name,
          role: user.role,
          action: "public-health-go-live-observations",
          target: "/api/public-health/go-live-observations",
          result: "allowed",
          detail: `${system.goLiveObservationBoard?.summary?.planReady || 0}/${system.goLiveObservationBoard?.summary?.observations || 0} observation plans ready`
        });
        sendJson(res, 200, {
          ok: true,
          generatedAt: system.generatedAt,
          summary: system.goLiveObservationBoard?.summary || {},
          board: system.goLiveObservationBoard,
          observations: system.goLiveObservations || []
        });
        return true;
      }

      const publicHealthGoLiveObservationActionMatch = url.pathname.match(/^\/api\/public-health\/go-live-observations\/([^/]+)\/actions$/);
      if (req.method === "POST" && publicHealthGoLiveObservationActionMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/public-health/go-live-observations/:id/actions");
        if (!user) return true;
        const observationId = decodeURIComponent(publicHealthGoLiveObservationActionMatch[1]);
        const payload = await collectJson(req);
        const data = readDatabase();
        const observations = Array.isArray(data.publicHealthGoLiveObservations) ? data.publicHealthGoLiveObservations : seedPublicHealthGoLiveObservations();
        const index = observations.findIndex((item) => item.id === observationId);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "public health go-live observation not found" });
          return true;
        }
        let normalized;
        try {
          normalized = normalizePublicHealthGoLiveObservationAction(observations[index], payload, user);
        } catch (error) {
          sendJson(res, 400, { error: "Bad Request", message: error.message });
          return true;
        }
        observations[index] = normalized.observation;
        data.publicHealthGoLiveObservations = observations;
        data.publicHealthReadinessEvidence = (Array.isArray(data.publicHealthReadinessEvidence) ? data.publicHealthReadinessEvidence : seedPublicHealthReadinessEvidence()).map((row) => (
          row.id === "phev-go-live-observation"
            ? { ...row, status: "go-live observation action recorded", evidence: Array.from(new Set([...(row.evidence || []), "publicHealthGoLiveObservations"])) }
            : row
        ));
        data.securityEvents = [
          {
            id: randomUUID(),
            at: new Date().toLocaleString("zh-CN", { hour12: false }),
            actor: user.name,
            role: user.role,
            action: "public-health-go-live-observation-action",
            target: observationId,
            result: "allowed",
            detail: `${normalized.history.action} / ${normalized.history.status} / ${normalized.history.signalStatus}`
          },
          ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
        ].slice(0, 120);
        writeDatabase(data);
        const system = buildPublicHealthSystem({ data });
        sendJson(res, 200, {
          ok: true,
          observation: normalized.observation,
          action: normalized.history,
          board: system.goLiveObservationBoard,
          system
        });
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/public-health/launch-incidents") {
        const user = requireApiRole(req, res, ["commission"], "/api/public-health/launch-incidents");
        if (!user) return true;
        const data = readDatabase();
        const system = buildPublicHealthSystem({ data });
        appendSecurityEvent({
          actor: user.name,
          role: user.role,
          action: "public-health-launch-incidents",
          target: "/api/public-health/launch-incidents",
          result: "allowed",
          detail: `${system.launchIncidentBoard?.summary?.deskReady || 0}/${system.launchIncidentBoard?.summary?.lanes || 0} incident lanes ready`
        });
        sendJson(res, 200, {
          ok: true,
          generatedAt: system.generatedAt,
          summary: system.launchIncidentBoard?.summary || {},
          board: system.launchIncidentBoard,
          incidents: system.launchIncidents || []
        });
        return true;
      }

      const publicHealthLaunchIncidentActionMatch = url.pathname.match(/^\/api\/public-health\/launch-incidents\/([^/]+)\/actions$/);
      if (req.method === "POST" && publicHealthLaunchIncidentActionMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/public-health/launch-incidents/:id/actions");
        if (!user) return true;
        const incidentId = decodeURIComponent(publicHealthLaunchIncidentActionMatch[1]);
        const payload = await collectJson(req);
        const data = readDatabase();
        const incidents = mergeByKey(seedPublicHealthLaunchIncidents(), data.publicHealthLaunchIncidents, "id");
        const index = incidents.findIndex((item) => item.id === incidentId);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "public health launch incident not found" });
          return true;
        }
        let normalized;
        try {
          normalized = normalizePublicHealthLaunchIncidentAction(incidents[index], payload, user);
        } catch (error) {
          sendJson(res, 400, { error: "Bad Request", message: error.message });
          return true;
        }
        incidents[index] = normalized.incident;
        data.publicHealthLaunchIncidents = incidents;
        data.publicHealthReadinessEvidence = (Array.isArray(data.publicHealthReadinessEvidence) ? data.publicHealthReadinessEvidence : seedPublicHealthReadinessEvidence()).map((row) => (
          row.id === "phev-launch-incident-desk"
            ? { ...row, status: "launch incident action recorded", evidence: Array.from(new Set([...(row.evidence || []), "publicHealthLaunchIncidents"])) }
            : row
        ));
        data.securityEvents = [
          {
            id: randomUUID(),
            at: new Date().toLocaleString("zh-CN", { hour12: false }),
            actor: user.name,
            role: user.role,
            action: "public-health-launch-incident-action",
            target: incidentId,
            result: "allowed",
            detail: `${normalized.history.action} / ${normalized.history.status} / ${normalized.history.signalStatus}`
          },
          ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
        ].slice(0, 120);
        writeDatabase(data);
        const system = buildPublicHealthSystem({ data });
        sendJson(res, 200, {
          ok: true,
          incident: normalized.incident,
          action: normalized.history,
          board: system.launchIncidentBoard,
          system
        });
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/public-health/launch-duty-shifts") {
        const user = requireApiRole(req, res, ["commission"], "/api/public-health/launch-duty-shifts");
        if (!user) return true;
        const data = readDatabase();
        const system = buildPublicHealthSystem({ data });
        appendSecurityEvent({
          actor: user.name,
          role: user.role,
          action: "public-health-launch-duty-shifts",
          target: "/api/public-health/launch-duty-shifts",
          result: "allowed",
          detail: `${system.launchDutyBoard?.summary?.readyShifts || 0}/${system.launchDutyBoard?.summary?.shifts || 0} duty shifts ready`
        });
        sendJson(res, 200, {
          ok: true,
          generatedAt: system.generatedAt,
          summary: system.launchDutyBoard?.summary || {},
          board: system.launchDutyBoard,
          shifts: system.launchDutyShifts || []
        });
        return true;
      }

      const publicHealthLaunchDutyShiftActionMatch = url.pathname.match(/^\/api\/public-health\/launch-duty-shifts\/([^/]+)\/actions$/);
      if (req.method === "POST" && publicHealthLaunchDutyShiftActionMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/public-health/launch-duty-shifts/:id/actions");
        if (!user) return true;
        const shiftId = decodeURIComponent(publicHealthLaunchDutyShiftActionMatch[1]);
        const payload = await collectJson(req);
        const data = readDatabase();
        const shifts = mergeByKey(seedPublicHealthLaunchDutyShifts(), data.publicHealthLaunchDutyShifts, "id");
        const index = shifts.findIndex((item) => item.id === shiftId);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "public health launch duty shift not found" });
          return true;
        }
        let normalized;
        try {
          normalized = normalizePublicHealthLaunchDutyShiftAction(shifts[index], payload, user);
        } catch (error) {
          sendJson(res, 400, { error: "Bad Request", message: error.message });
          return true;
        }
        shifts[index] = normalized.shift;
        data.publicHealthLaunchDutyShifts = shifts;
        data.publicHealthReadinessEvidence = (Array.isArray(data.publicHealthReadinessEvidence) ? data.publicHealthReadinessEvidence : seedPublicHealthReadinessEvidence()).map((row) => (
          row.id === "phev-launch-duty-shifts"
            ? { ...row, status: "launch duty handoff action recorded", evidence: Array.from(new Set([...(row.evidence || []), "publicHealthLaunchDutyShifts"])) }
            : row
        ));
        data.securityEvents = [
          {
            id: randomUUID(),
            at: new Date().toLocaleString("zh-CN", { hour12: false }),
            actor: user.name,
            role: user.role,
            action: "public-health-launch-duty-shift-action",
            target: shiftId,
            result: "allowed",
            detail: `${normalized.history.action} / ${normalized.history.status} / ${normalized.history.signalStatus}`
          },
          ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
        ].slice(0, 120);
        writeDatabase(data);
        const system = buildPublicHealthSystem({ data });
        sendJson(res, 200, {
          ok: true,
          shift: normalized.shift,
          action: normalized.history,
          board: system.launchDutyBoard,
          system
        });
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/public-health/launch-command-briefs") {
        const user = requireApiRole(req, res, ["commission"], "/api/public-health/launch-command-briefs");
        if (!user) return true;
        const data = readDatabase();
        const system = buildPublicHealthSystem({ data });
        appendSecurityEvent({
          actor: user.name,
          role: user.role,
          action: "public-health-launch-command-briefs",
          target: "/api/public-health/launch-command-briefs",
          result: "allowed",
          detail: `${system.launchCommandBriefBoard?.summary?.readyBriefs || 0}/${system.launchCommandBriefBoard?.summary?.briefs || 0} launch command briefs ready`
        });
        sendJson(res, 200, {
          ok: true,
          generatedAt: system.generatedAt,
          summary: system.launchCommandBriefBoard?.summary || {},
          board: system.launchCommandBriefBoard,
          briefs: system.launchCommandBriefs || []
        });
        return true;
      }

      const publicHealthLaunchCommandBriefActionMatch = url.pathname.match(/^\/api\/public-health\/launch-command-briefs\/([^/]+)\/actions$/);
      if (req.method === "POST" && publicHealthLaunchCommandBriefActionMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/public-health/launch-command-briefs/:id/actions");
        if (!user) return true;
        const briefId = decodeURIComponent(publicHealthLaunchCommandBriefActionMatch[1]);
        const payload = await collectJson(req);
        const data = readDatabase();
        const briefs = mergeByKey(seedPublicHealthLaunchCommandBriefs(), data.publicHealthLaunchCommandBriefs, "id");
        const index = briefs.findIndex((item) => item.id === briefId);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "public health launch command brief not found" });
          return true;
        }
        let normalized;
        try {
          normalized = normalizePublicHealthLaunchCommandBriefAction(briefs[index], payload, user);
        } catch (error) {
          sendJson(res, 400, { error: "Bad Request", message: error.message });
          return true;
        }
        briefs[index] = normalized.brief;
        data.publicHealthLaunchCommandBriefs = briefs;
        data.publicHealthReadinessEvidence = (Array.isArray(data.publicHealthReadinessEvidence) ? data.publicHealthReadinessEvidence : seedPublicHealthReadinessEvidence()).map((row) => (
          row.id === "phev-launch-command-briefs"
            ? { ...row, status: "launch command brief action recorded", evidence: Array.from(new Set([...(row.evidence || []), "publicHealthLaunchCommandBriefs"])) }
            : row
        ));
        data.securityEvents = [
          {
            id: randomUUID(),
            at: new Date().toLocaleString("zh-CN", { hour12: false }),
            actor: user.name,
            role: user.role,
            action: "public-health-launch-command-brief-action",
            target: briefId,
            result: "allowed",
            detail: `${normalized.history.action} / ${normalized.history.status} / ${normalized.history.decision}`
          },
          ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
        ].slice(0, 120);
        writeDatabase(data);
        const system = buildPublicHealthSystem({ data });
        sendJson(res, 200, {
          ok: true,
          brief: normalized.brief,
          action: normalized.history,
          board: system.launchCommandBriefBoard,
          system
        });
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/public-health/site-evidence-verification-tasks") {
        const user = requireApiRole(req, res, ["commission"], "/api/public-health/site-evidence-verification-tasks");
        if (!user) return true;
        const data = readDatabase();
        const system = buildPublicHealthSystem({ data });
        appendSecurityEvent({
          actor: user.name,
          role: user.role,
          action: "public-health-site-evidence-verification-tasks",
          target: "/api/public-health/site-evidence-verification-tasks",
          result: "allowed",
          detail: `${system.siteEvidenceVerificationBoard?.summary?.verifiedTasks || 0}/${system.siteEvidenceVerificationBoard?.summary?.tasks || 0} site evidence verification tasks verified`
        });
        sendJson(res, 200, {
          ok: true,
          generatedAt: system.generatedAt,
          summary: system.siteEvidenceVerificationBoard?.summary || {},
          board: system.siteEvidenceVerificationBoard,
          tasks: system.siteEvidenceVerificationTasks || []
        });
        return true;
      }

      const publicHealthSiteEvidenceVerificationTaskActionMatch = url.pathname.match(/^\/api\/public-health\/site-evidence-verification-tasks\/([^/]+)\/actions$/);
      if (req.method === "POST" && publicHealthSiteEvidenceVerificationTaskActionMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/public-health/site-evidence-verification-tasks/:id/actions");
        if (!user) return true;
        const taskId = decodeURIComponent(publicHealthSiteEvidenceVerificationTaskActionMatch[1]);
        const payload = await collectJson(req);
        const data = readDatabase();
        const tasks = mergeByKey(seedPublicHealthSiteEvidenceVerificationTasks(), data.publicHealthSiteEvidenceVerificationTasks, "id");
        const index = tasks.findIndex((item) => item.id === taskId);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "public health site evidence verification task not found" });
          return true;
        }
        let normalized;
        try {
          normalized = normalizePublicHealthSiteEvidenceVerificationTaskAction(tasks[index], payload, data, user);
        } catch (error) {
          sendJson(res, 400, { error: "Bad Request", message: error.message });
          return true;
        }
        tasks[index] = normalized.task;
        data.publicHealthSiteEvidenceVerificationTasks = tasks;
        data.publicHealthReadinessEvidence = mergeByKey(seedPublicHealthReadinessEvidence(), data.publicHealthReadinessEvidence, "id").map((row) => (
          row.id === "phev-site-evidence-verification-desk"
            ? { ...row, status: "site evidence verification action recorded", evidence: Array.from(new Set([...(row.evidence || []), "publicHealthSiteEvidenceVerificationTasks", "siteLaunchEvidence"])) }
            : row
        ));
        data.securityEvents = sealAuditTrail([
          {
            id: randomUUID(),
            at: new Date().toLocaleString("zh-CN", { hour12: false }),
            actor: user.name,
            role: user.role,
            action: "public-health-site-evidence-verification-action",
            target: taskId,
            result: "allowed",
            detail: `${normalized.history.action} / ${normalized.history.status} / ${normalized.history.evidenceId || "no-evidence"}`
          },
          ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
        ].slice(0, 120), { recompute: true });
        writeDatabase(data);
        const system = buildPublicHealthSystem({ data: readDatabase() });
        sendJson(res, 200, {
          ok: true,
          task: normalized.task,
          action: normalized.history,
          board: system.siteEvidenceVerificationBoard,
          system
        });
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/public-health/site-evidence-bridge/actions") {
        const user = requireApiRole(req, res, ["commission"], "/api/public-health/site-evidence-bridge/actions");
        if (!user) return true;
        const payload = await collectJson(req);
        const data = readDatabase();
        const linkId = String(payload.linkId || payload.bridgeId || payload.id || "").trim();
        const templateId = String(payload.templateId || "").trim();
        const bridge = buildPublicHealthSiteEvidenceBridge(data.siteLaunchEvidence);
        const link = bridge.links.find((item) => (linkId && item.id === linkId) || (templateId && item.templateId === templateId))
          || PUBLIC_HEALTH_SITE_EVIDENCE_LINKS.find((item) => (linkId && item.id === linkId) || (templateId && item.templateId === templateId));
        if (!link) {
          sendJson(res, 404, { error: "Not Found", message: "public health site evidence bridge link not found" });
          return true;
        }
        let upsertResult;
        try {
          upsertResult = upsertSiteLaunchEvidence(data, user, {
            ...payload,
            templateId: link.templateId,
            status: payload.status || "verified",
            artifactName: payload.artifactName || payload.artifact || link.requirement || "public health site evidence",
            jointTestNo: payload.jointTestNo || payload.receiptNo || `PH-SITE-${Date.now()}`,
            attachmentNames: payload.attachmentNames || payload.attachments || [`${link.id}.pdf`],
            note: payload.note || `Mapped to public health evidence packet ${link.packetId}.`
          });
        } catch (error) {
          sendJson(res, 400, { error: "Bad Request", message: error.message });
          return true;
        }
        const latestData = readDatabase();
        latestData.publicHealthReadinessEvidence = (Array.isArray(latestData.publicHealthReadinessEvidence) ? latestData.publicHealthReadinessEvidence : seedPublicHealthReadinessEvidence()).map((row) => (
          row.id === "phev-site-evidence-bridge"
            ? { ...row, status: "现场材料桥接已记录", evidence: Array.from(new Set([...(row.evidence || []), "siteLaunchEvidence", "publicHealthSiteEvidenceBridge"])) }
            : row
        ));
        latestData.securityEvents = sealAuditTrail([
          {
            id: randomUUID(),
            at: new Date().toLocaleString("zh-CN", { hour12: false }),
            actor: user.name,
            role: user.role,
            action: "public-health-site-evidence-bridge-action",
            target: link.id,
            result: "allowed",
            detail: `${link.templateId} -> ${link.packetId}`
          },
          ...(Array.isArray(latestData.securityEvents) ? latestData.securityEvents : [])
        ].slice(0, 120), { recompute: true });
        writeDatabase(latestData);
        const system = buildPublicHealthSystem({ data: readDatabase() });
        sendJson(res, upsertResult.status || 200, {
          ok: true,
          evidence: upsertResult.body?.evidence,
          link: system.siteEvidenceBridge?.links?.find((item) => item.id === link.id) || link,
          bridge: system.siteEvidenceBridge,
          system
        });
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/public-health/launch-gate") {
        const user = requireApiRole(req, res, ["commission"], "/api/public-health/launch-gate");
        if (!user) return true;
        const data = readDatabase();
        const system = buildPublicHealthSystem({ data });
        appendSecurityEvent({
          actor: user.name,
          role: user.role,
          action: "public-health-launch-gate",
          target: "/api/public-health/launch-gate",
          result: "allowed",
          detail: `${system.launchGate?.status || "unknown"} / ${system.launchGate?.summary?.blockedRequirements || 0} blocked requirements`
        });
        sendJson(res, 200, {
          ok: true,
          generatedAt: system.generatedAt,
          gate: system.launchGate,
          summary: system.launchGate?.summary || {},
          approvals: system.launchApprovals || [],
          requirements: system.launchGate?.requirements || [],
          approvalPreflight: system.launchGate?.approvalPreflight || {}
        });
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/public-health/launch-gate/actions") {
        const user = requireApiRole(req, res, ["commission"], "/api/public-health/launch-gate/actions");
        if (!user) return true;
        const payload = await collectJson(req);
        const approvalId = String(payload.approvalId || payload.id || "").trim();
        const data = readDatabase();
        const approvals = Array.isArray(data.publicHealthLaunchApprovals) ? data.publicHealthLaunchApprovals : seedPublicHealthLaunchApprovals();
        const currentSystem = buildPublicHealthSystem({ data });
        const index = approvalId
          ? approvals.findIndex((item) => item.id === approvalId)
          : approvals.findIndex((item) => !/approved|signed|accepted|complete|已批准|已签署|已完成/i.test(`${item.status || ""} ${item.decision || ""}`));
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "public health launch approval not found" });
          return true;
        }
        let normalized;
        try {
          normalized = normalizePublicHealthLaunchGateAction(approvals[index], payload, user, currentSystem.launchGate?.approvalPreflight || {});
        } catch (error) {
          const statusCode = /launch approval is blocked until all prerequisite launch requirements pass/.test(String(error.message || "")) ? 409 : 400;
          sendJson(res, statusCode, { error: statusCode === 409 ? "Conflict" : "Bad Request", message: error.message });
          return true;
        }
        approvals[index] = normalized.approval;
        data.publicHealthLaunchApprovals = approvals;
        data.publicHealthReadinessEvidence = (Array.isArray(data.publicHealthReadinessEvidence) ? data.publicHealthReadinessEvidence : seedPublicHealthReadinessEvidence()).map((row) => (
          row.id === "phev-launch-gate"
            ? { ...row, status: "上线审批动作已记录", evidence: Array.from(new Set([...(row.evidence || []), "publicHealthLaunchApprovals"])) }
            : row
        ));
        data.securityEvents = [
          {
            id: randomUUID(),
            at: new Date().toLocaleString("zh-CN", { hour12: false }),
            actor: user.name,
            role: user.role,
            action: "public-health-launch-gate-action",
            target: normalized.approval.id,
            result: "allowed",
            detail: `${normalized.history.action} / ${normalized.history.status}`
          },
          ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
        ].slice(0, 120);
        writeDatabase(data);
        const system = buildPublicHealthSystem({ data });
        sendJson(res, 200, {
          ok: true,
          approval: normalized.approval,
          action: normalized.history,
          gate: system.launchGate,
          system
        });
        return true;
      }
        return false;
      }
    };
}

module.exports = { createRouteSegment, ROUTE_SEGMENT_ID: "public-health-02", SUBDOMAIN: "public-health-operations" };
