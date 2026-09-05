"use strict";

const AiGovernance = require("../../identity-security/ai-governance-center");

function createRouteSegments(runtime) {
  const { BloodEventHub, PROJECT_VERSION, RUNTIME_STARTED_AT, appendSecurityEvent, buildHealthDashboardSummary, buildReleaseReport, buildRuntimeMetrics, buildSystemReadinessReport, collectJson, normalizeHealthStatisticsImportJob, prependAuditTrailEntry, probeSessionStoreStatus, randomUUID, readDatabase, renderPrometheusRuntimeMetrics, requireApiRole, seedHealthStatisticsIngestion, sendJson, sendText, sessionStoreHealthStatus, storageMeta, writeDatabase } = runtime;
  return [
    {
      id: "runtime-01",
      domain: "runtime",
      async handle(req, res, url) {
    if (req.method === "GET" && req.url === "/api/live") {
        sendJson(res, 200, {
          ok: true,
          service: {
            name: "chronic-care-platform",
            version: PROJECT_VERSION,
            environment: process.env.NODE_ENV || "development",
            uptimeSeconds: Math.round((Date.now() - RUNTIME_STARTED_AT.getTime()) / 1000)
          }
        });
        return true;
      }

      if (req.method === "GET" && req.url === "/api/health") {
        let sessionStore;
        try {
          sessionStore = await probeSessionStoreStatus();
        } catch (error) {
          console.error(`session store health check failed: ${error.message}`);
          sendJson(res, 503, {
            ok: false,
            code: "SESSION_STORE_UNAVAILABLE",
            message: "authentication session service is temporarily unavailable",
            service: {
              name: "chronic-care-platform",
              version: PROJECT_VERSION,
              environment: process.env.NODE_ENV || "development",
              uptimeSeconds: Math.round((Date.now() - RUNTIME_STARTED_AT.getTime()) / 1000)
            },
            storage: storageMeta(),
            sessionStore: sessionStoreHealthStatus()
          });
          return true;
        }
        sendJson(res, 200, {
          ok: true,
          service: {
            name: "chronic-care-platform",
            version: PROJECT_VERSION,
            environment: process.env.NODE_ENV || "development",
            uptimeSeconds: Math.round((Date.now() - RUNTIME_STARTED_AT.getTime()) / 1000)
          },
          storage: storageMeta(),
          sessionStore: sessionStoreHealthStatus(sessionStore)
        });
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/runtime/dependencies") {
        const user = requireApiRole(req, res, ["commission"], "/api/runtime/dependencies");
        if (!user) return true;
        const dependencies = buildRuntimeMetrics(readDatabase()).dependencies || {};
        const checks = Object.entries(dependencies).map(([name, status]) => ({
          name,
          ok: status?.ok === true,
          latencyMs: Number(status?.latencyMs || 0),
          checkedAt: status?.checkedAt || "",
          detail: String(status?.detail || "")
        }));
        const unavailable = checks.filter((item) => !item.ok);
        appendSecurityEvent({
          actor: user.name,
          role: user.role,
          action: "runtime-dependency-health-read",
          target: "/api/runtime/dependencies",
          result: "allowed",
          detail: `${checks.length} dependencies; ${unavailable.length} unavailable; correlation ${req.correlationId}`
        });
        sendJson(res, unavailable.length ? 503 : 200, {
          ok: unavailable.length === 0,
          correlationId: req.correlationId,
          generatedAt: new Date().toISOString(),
          summary: {
            total: checks.length,
            available: checks.length - unavailable.length,
            unavailable: unavailable.length
          },
          dependencies: checks
        });
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/metrics") {
        const user = requireApiRole(req, res, ["commission"], "/api/metrics");
        if (!user) return true;
        sendJson(res, 200, buildRuntimeMetrics(readDatabase()));
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/system/readiness") {
        const user = requireApiRole(req, res, ["commission"], "/api/system/readiness");
        if (!user) return true;
        sendJson(res, 200, buildSystemReadinessReport(readDatabase()));
        return true;
      }
        return false;
      }
    },
    {
      id: "runtime-02",
      domain: "runtime",
      async handle(req, res, url) {
    if (req.method === "GET" && url.pathname === "/api/health-dashboard/summary") {
        const user = requireApiRole(req, res, ["commission"], "/api/health-dashboard/summary");
        if (!user) return true;
        const data = readDatabase();
        appendSecurityEvent({
          actor: user.name,
          role: user.role,
          action: "health-dashboard-summary",
          target: "/api/health-dashboard/summary",
          result: "allowed",
          detail: "Commission dashboard aggregate summary read."
        });
        sendJson(res, 200, { ...buildHealthDashboardSummary({
          data,
          runtime: buildRuntimeMetrics(data),
          readiness: buildSystemReadinessReport(data)
        }), bloodCoordination: BloodEventHub.dashboard(data, user) });
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/metrics/prometheus") {
        const user = requireApiRole(req, res, ["commission"], "/api/metrics/prometheus");
        if (!user) return true;
        sendText(res, 200, renderPrometheusRuntimeMetrics(readDatabase()), "text/plain; version=0.0.4; charset=utf-8");
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/health-dashboard/industry-governance-indicators") {
        const user = requireApiRole(req, res, ["commission"], "/api/health-dashboard/industry-governance-indicators");
        if (!user) return true;
        const data = readDatabase();
        const dashboard = buildHealthDashboardSummary({
          data,
          runtime: buildRuntimeMetrics(data),
          readiness: buildSystemReadinessReport(data)
        });
        const indicatorCenter = dashboard.indicatorCenter;
        appendSecurityEvent({
          actor: user.name,
          role: user.role,
          action: "health-dashboard-industry-governance-indicators",
          target: "/api/health-dashboard/industry-governance-indicators",
          result: "allowed",
          detail: `${indicatorCenter.summary.indicators} indicators / ${indicatorCenter.summary.blocked} blocked sources`
        });
        sendJson(res, 200, {
          ok: dashboard.ok,
          generatedAt: dashboard.generatedAt,
          summary: indicatorCenter.summary,
          categories: indicatorCenter.categories,
          periodViews: indicatorCenter.periodViews,
          indicators: indicatorCenter.indicators,
          exportFields: indicatorCenter.exportFields,
          releaseEvidence: indicatorCenter.releaseEvidence,
          boundary: indicatorCenter.boundary
        });
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/runtime/ai-governance/center") {
        const user = requireApiRole(req, res, ["commission"], "/api/runtime/ai-governance/center");
        if (!user) return true;
        try {
          const center = AiGovernance.buildAiGovernanceCenter(readDatabase(), user);
          appendSecurityEvent({
            actor: user.name || user.username,
            role: user.role,
            action: "platform ai governance center read",
            target: AiGovernance.CAPABILITY_ID,
            result: "allowed",
            detail: `${center.summary.useCases} use cases / ${center.summary.openRisks} open risks / ${center.summary.pendingOwnerBindings} owner bindings pending`
          });
          sendJson(res, 200, center);
        } catch (error) {
          const known = error instanceof AiGovernance.AiGovernanceCenterError;
          try {
            appendSecurityEvent({
              actor: user.name || user.username,
              role: user.role,
              action: "platform ai governance center read",
              target: AiGovernance.CAPABILITY_ID,
              result: "denied",
              detail: known ? error.code : "AI_GOVERNANCE_CENTER_FAILED"
            });
          } catch {
            // The read remains fail-closed when the audit sink is unavailable.
          }
          sendJson(res, known ? error.statusCode : 503, {
            ok: false,
            code: known ? error.code : "AI_GOVERNANCE_CENTER_FAILED",
            message: known ? error.message : "platform AI governance center is temporarily unavailable",
            productionReady: false,
            decision: "NO-GO"
          });
        }
        return true;
      }
        return false;
      }
    },
    {
      id: "runtime-03",
      domain: "runtime",
      async handle(req, res, url) {
    if (req.method === "GET" && url.pathname === "/api/health-dashboard/production-readiness") {
        const user = requireApiRole(req, res, ["commission"], "/api/health-dashboard/production-readiness");
        if (!user) return true;
        const data = readDatabase();
        const healthDashboard = buildHealthDashboardSummary({
          data,
          runtime: buildRuntimeMetrics(data),
          readiness: buildSystemReadinessReport(data)
        });
        const releaseReport = buildReleaseReport({ data, env: process.env, profile: "demo" });
        const cutoverChecklist = releaseReport.productionCutover || [];
        const blockedGates = (healthDashboard.productionReadinessGate?.items || []).filter((item) => item.status === "blocked");
        appendSecurityEvent({
          actor: user.name,
          role: user.role,
          action: "health-dashboard-production-readiness",
          target: "/api/health-dashboard/production-readiness",
          result: "allowed",
          detail: `Production readiness gate read: ${blockedGates.length} blocked gates.`
        });
        sendJson(res, 200, {
          ok: healthDashboard.ok,
          generatedAt: healthDashboard.generatedAt,
          productionReady: healthDashboard.totals?.productionReady === true,
          boundary: healthDashboard.productionReadinessGate?.boundary || "",
          summary: healthDashboard.productionReadinessGate?.summary || {},
          gates: healthDashboard.productionReadinessGate?.items || [],
          acceptanceRouting: healthDashboard.productionReadinessGate?.acceptanceRouting || [],
          backendGoLiveChecklist: healthDashboard.productionReadinessGate?.backendGoLiveChecklist || {},
          indicatorCenterSummary: healthDashboard.indicatorCenter?.summary || {},
          indicatorCenterEvidence: healthDashboard.indicatorCenter?.releaseEvidence || [],
          blockedGates,
          cutover: {
            ok: cutoverChecklist.every((item) => item.passed),
            total: cutoverChecklist.length,
            passed: cutoverChecklist.filter((item) => item.passed).length,
            blocked: cutoverChecklist.filter((item) => !item.passed).length,
            checklist: cutoverChecklist
          },
          siteIssues: healthDashboard.siteIssueLedger?.items || [],
          evidence: healthDashboard.siteEvidencePackage?.items || []
        });
        return true;
      }
        return false;
      }
    },
    {
      id: "runtime-04",
      domain: "runtime",
      async handle(req, res, url) {
    if (req.method === "POST" && url.pathname === "/api/health-statistics/import-jobs") {
        const user = requireApiRole(req, res, ["commission"], "/api/health-statistics/import-jobs");
        if (!user) return true;
        const data = readDatabase();
        const job = normalizeHealthStatisticsImportJob(await collectJson(req), user);
        data.healthStatisticsIngestion = data.healthStatisticsIngestion || seedHealthStatisticsIngestion();
        data.healthStatisticsIngestion.jobs = [
          job,
          ...(Array.isArray(data.healthStatisticsIngestion.jobs) ? data.healthStatisticsIngestion.jobs : [])
        ].slice(0, 80);
        data.securityEvents = prependAuditTrailEntry(data.securityEvents, {
          id: randomUUID(),
          at: new Date().toLocaleString("zh-CN", { hour12: false }),
          actor: user.name,
          role: user.role,
          action: "登记统计导入任务",
          target: job.target,
          result: "允许",
          detail: `${job.source} · ${job.period} · ${job.name}`
        });
        writeDatabase(data);
        sendJson(res, 201, job);
        return true;
      }
        return false;
      }
    },
  ];
}

module.exports = { createRouteSegments };
