"use strict";

const HUMAN_ACTIONS = new Set([
  "validate-event",
  "review-standard-mapping",
  "create-report-card",
  "submit-report",
  "review-by-cdc",
  "close-followup"
]);

const STANDARD_ITEMS = Object.freeze([
  "case-reporting",
  "epidemiological-investigation",
  "laboratory-testing",
  "report-quality-control"
]);

function clean(value, maximum = 240) {
  return String(value ?? "").trim().replace(/[\r\n\t]+/g, " ").slice(0, maximum);
}

function commandError(code, message, statusCode = 400) {
  return Object.assign(new Error(message), { code, statusCode });
}

function required(value, field, maximum = 240) {
  const result = clean(value, maximum);
  if (!result) throw commandError(
    "PUBLIC_HEALTH_INFECTIOUS_REPORTING_INPUT_INVALID",
    `${field} is required`
  );
  return result;
}

function safeId(value, field) {
  const result = required(value, field, 160);
  if (!/^[A-Za-z0-9._:-]+$/.test(result)) {
    throw commandError(
      "PUBLIC_HEALTH_INFECTIOUS_REPORTING_INPUT_INVALID",
      `${field} contains unsupported characters`
    );
  }
  return result;
}

function statusFor(error) {
  if (Number.isInteger(error?.statusCode)) return error.statusCode;
  const message = clean(error?.message, 300).toLowerCase();
  if (message.includes("not found")) return 404;
  if (
    message.includes("conflict")
    || message.includes("already linked")
    || message.includes("not allowed from state")
  ) return 409;
  return 400;
}

function appendAudit(runtime, data, user, workflow, action, detail) {
  runtime.appendDataAccessLog(
    data,
    user,
    clean(workflow?.event?.residentId, 120),
    "public-health-infectious-reporting",
    `${action}:${clean(workflow?.id, 160)}`,
    "allowed"
  );
  data.securityEvents = runtime.sealAuditTrail([
    {
      id: runtime.randomUUID(),
      at: new Date().toISOString(),
      actor: user.name,
      role: user.role,
      action,
      target: clean(workflow?.id, 160),
      result: "allowed",
      detail: clean(detail, 300)
    },
    ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
  ].slice(0, 120), { recompute: true });
}

function sendCommandError(runtime, res, error) {
  const status = statusFor(error);
  runtime.sendJson(res, status, {
    error: status === 404 ? "Not Found" : status === 409 ? "Conflict" : "Bad Request",
    code: clean(error?.code || "PUBLIC_HEALTH_INFECTIOUS_REPORTING_COMMAND_REJECTED", 120),
    message: clean(error?.message || "infectious reporting command was rejected", 300),
    businessClosureComplete: false,
    productionReady: false
  });
}

function auditDenial(runtime, user, target, action, error) {
  runtime.appendSecurityEvent({
    actor: user.name,
    role: user.role,
    action,
    target: clean(target, 200),
    result: "denied",
    detail: clean(error?.code || "PUBLIC_HEALTH_INFECTIOUS_REPORTING_COMMAND_REJECTED", 120)
  });
}

function createRouteSegment(runtime) {
  const { appendDataAccessLog, appendSecurityEvent, applyInfectiousReportingAction, buildInfectiousReportingCaseFromSources, collectJson, randomUUID, readDatabase, requireApiRole, sealAuditTrail, sendJson, upsertInfectiousReportingCase, writeDatabase } = runtime;
  return {
    id: "public-health-04",
    domain: "public-health",
    async handle(req, res, url) {
      if (req.method === "POST" && url.pathname === "/api/public-health/infectious-reporting-cases") {
        const user = runtime.requireApiRole(
          req,
          res,
          ["commission"],
          "/api/public-health/infectious-reporting-cases"
        );
        if (!user) return true;
        try {
          const payload = await runtime.collectJson(req);
          const data = runtime.readDatabase();
          const publicHealthEventId = safeId(payload.publicHealthEventId, "publicHealthEventId");
          const reportId = safeId(payload.reportId, "reportId");
          const externalEventId = safeId(payload.externalEventId, "externalEventId");
          const event = (Array.isArray(data.publicHealthEvents) ? data.publicHealthEvents : [])
            .find((item) => item.id === publicHealthEventId);
          const report = (Array.isArray(data.phase2DiseaseReportQueue) ? data.phase2DiseaseReportQueue : [])
            .find((item) => item.id === reportId);
          if (!event || !report) {
            throw commandError(
              "PUBLIC_HEALTH_INFECTIOUS_REPORTING_SOURCE_NOT_FOUND",
              "linked public health event or disease report was not found",
              404
            );
          }
          const candidate = runtime.buildInfectiousReportingCaseFromSources({
            event,
            report,
            link: {
              id: payload.caseId
                ? safeId(payload.caseId, "caseId")
                : `pherl-${runtime.randomUUID()}`,
              externalEventId,
              publicHealthEventId,
              reportId,
              ruleId: clean(report.ruleId, 160),
              diagnosisCode: clean(report.diseaseCode, 80),
              sampleNo: required(payload.sampleNo || report.sampleNo, "sampleNo", 160),
              standardDomainId: "ph-infectious",
              standardItems: STANDARD_ITEMS
            }
          });
          const result = runtime.upsertInfectiousReportingCase(
            Array.isArray(data.publicHealthInfectiousReportingCases)
              ? data.publicHealthInfectiousReportingCases
              : [],
            candidate
          );
          data.publicHealthInfectiousReportingCases = result.cases.slice(-500);
          appendAudit(
            runtime,
            data,
            user,
            result.case,
            "public-health-infectious-reporting-intake",
            `${result.created ? "created" : "idempotent"}; version=${result.case.version}; production=false`
          );
          runtime.writeDatabase(data);
          runtime.sendJson(res, result.created ? 201 : 200, {
            ok: true,
            created: result.created,
            idempotent: result.idempotent,
            case: result.case,
            businessClosureComplete: result.case.businessClosureComplete === true,
            productionReady: false
          });
        } catch (error) {
          auditDenial(
            runtime,
            user,
            "/api/public-health/infectious-reporting-cases",
            "public-health-infectious-reporting-intake",
            error
          );
          sendCommandError(runtime, res, error);
        }
        return true;
      }

      const caseMatch = url.pathname.match(
        /^\/api\/public-health\/infectious-reporting-cases\/([^/]+)$/
      );
      if (req.method === "GET" && caseMatch) {
        const user = runtime.requireApiRole(
          req,
          res,
          ["commission"],
          "/api/public-health/infectious-reporting-cases/:id"
        );
        if (!user) return true;
        try {
          const caseId = safeId(decodeURIComponent(caseMatch[1]), "caseId");
          const data = runtime.readDatabase();
          const workflow = (Array.isArray(data.publicHealthInfectiousReportingCases)
            ? data.publicHealthInfectiousReportingCases
            : []).find((item) => item.id === caseId);
          if (!workflow) throw commandError(
            "PUBLIC_HEALTH_INFECTIOUS_REPORTING_NOT_FOUND",
            "infectious reporting case was not found",
            404
          );
          appendAudit(
            runtime,
            data,
            user,
            workflow,
            "public-health-infectious-reporting-read",
            `state=${clean(workflow.state, 80)}; version=${Number(workflow.version)}; production=false`
          );
          runtime.writeDatabase(data);
          runtime.sendJson(res, 200, {
            ok: true,
            case: workflow,
            businessClosureComplete: workflow.businessClosureComplete === true,
            productionReady: false
          });
        } catch (error) {
          auditDenial(
            runtime,
            user,
            "/api/public-health/infectious-reporting-cases/:id",
            "public-health-infectious-reporting-read",
            error
          );
          sendCommandError(runtime, res, error);
        }
        return true;
      }

      const actionMatch = url.pathname.match(
        /^\/api\/public-health\/infectious-reporting-cases\/([^/]+)\/actions$/
      );
      if (req.method === "POST" && actionMatch) {
        const user = runtime.requireApiRole(
          req,
          res,
          ["commission"],
          "/api/public-health/infectious-reporting-cases/:id/actions"
        );
        if (!user) return true;
        try {
          const caseId = safeId(decodeURIComponent(actionMatch[1]), "caseId");
          const payload = await runtime.collectJson(req);
          const action = required(payload.action, "action", 80);
          if (action === "record-receipt") {
            throw commandError(
              "PUBLIC_HEALTH_SIGNED_RECEIPT_REQUIRED",
              "direct-report receipts must enter through a verified signed callback",
              409
            );
          }
          if (!HUMAN_ACTIONS.has(action)) {
            throw commandError(
              "PUBLIC_HEALTH_INFECTIOUS_REPORTING_ACTION_INVALID",
              "unsupported infectious reporting API action"
            );
          }
          const expectedVersion = Number(payload.expectedVersion);
          if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
            throw commandError(
              "PUBLIC_HEALTH_INFECTIOUS_REPORTING_VERSION_REQUIRED",
              "expectedVersion must be a positive integer"
            );
          }
          const data = runtime.readDatabase();
          const cases = Array.isArray(data.publicHealthInfectiousReportingCases)
            ? data.publicHealthInfectiousReportingCases
            : [];
          const index = cases.findIndex((item) => item.id === caseId);
          if (index < 0) throw commandError(
            "PUBLIC_HEALTH_INFECTIOUS_REPORTING_NOT_FOUND",
            "infectious reporting case was not found",
            404
          );
          const result = runtime.applyInfectiousReportingAction(
            cases[index],
            { ...payload, action, expectedVersion },
            user
          );
          const nextCases = [...cases];
          nextCases[index] = result.case;
          data.publicHealthInfectiousReportingCases = nextCases.slice(-500);
          appendAudit(
            runtime,
            data,
            user,
            result.case,
            `public-health-infectious-reporting-${action}`,
            `${result.idempotent ? "idempotent" : "applied"}; version=${result.case.version}; production=false`
          );
          runtime.writeDatabase(data);
          runtime.sendJson(res, 200, {
            ok: true,
            idempotent: result.idempotent,
            case: result.case,
            audit: result.history,
            businessClosureComplete: result.case.businessClosureComplete === true,
            productionReady: false
          });
        } catch (error) {
          auditDenial(
            runtime,
            user,
            "/api/public-health/infectious-reporting-cases/:id/actions",
            "public-health-infectious-reporting-action",
            error
          );
          sendCommandError(runtime, res, error);
        }
        return true;
      }

      return false;
    }
  };
}

module.exports = {
  HUMAN_ACTIONS,
  ROUTE_SEGMENT_ID: "public-health-04",
  STANDARD_ITEMS,
  SUBDOMAIN: "infectious-reporting",
  createRouteSegment
};
