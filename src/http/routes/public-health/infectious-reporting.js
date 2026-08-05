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

const TERMINAL_CALLBACK_STATUSES = Object.freeze({
  accepted: "accepted",
  succeeded: "accepted",
  failed: "rejected",
  rejected: "rejected",
  cancelled: "rejected"
});

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
    error: status === 401
      ? "Unauthorized"
      : status === 403
        ? "Forbidden"
        : status === 404
          ? "Not Found"
          : status === 409
            ? "Conflict"
            : status === 503
              ? "Service Unavailable"
              : "Bad Request",
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

function auditCallbackDenial(runtime, target, error) {
  runtime.appendSecurityEvent({
    actor: "public-health-direct-report-adapter",
    role: "system",
    action: "public-health-infectious-reporting-direct-report-callback",
    target: clean(target, 200),
    result: "denied",
    detail: clean(error?.code || "PUBLIC_HEALTH_DIRECT_REPORT_CALLBACK_REJECTED", 120)
  });
}

function projectTimeline(workflow) {
  return (Array.isArray(workflow?.timeline) ? workflow.timeline : []).map((item) => ({
    sequence: Number(item.sequence || 0),
    action: clean(item.action, 80),
    from: clean(item.from, 80),
    to: clean(item.to, 80),
    at: clean(item.at, 80),
    actor: clean(item.actor, 120),
    role: clean(item.role, 80),
    note: clean(item.note, 300)
  }));
}

function latestDeliveryForCase(deliveries, caseId) {
  return (Array.isArray(deliveries) ? deliveries : [])
    .filter((item) => item.caseId === caseId)
    .sort((left, right) => {
      const versionDifference = Number(right.version || 0) - Number(left.version || 0);
      return versionDifference || clean(right.updatedAt, 80).localeCompare(clean(left.updatedAt, 80));
    })[0] || null;
}

function projectCaseSummary(workflow, delivery = null) {
  const trustedCallback = workflow?.receipt?.trustedCallback;
  return {
    id: clean(workflow?.id, 160),
    version: Number(workflow?.version || 0),
    state: clean(workflow?.state, 80),
    externalEventId: clean(workflow?.externalEventId, 160),
    publicHealthEventId: clean(workflow?.publicHealthEventId, 160),
    reportId: clean(workflow?.reportId, 160),
    reportCardNo: clean(workflow?.reportCard?.reportCardNo || workflow?.draftReport?.reportCardNo, 160),
    receipt: workflow?.receipt ? {
      id: clean(workflow.receipt.id, 200),
      status: clean(workflow.receipt.receiptStatus, 40),
      code: clean(workflow.receipt.receiptCode, 120),
      receivedAt: clean(workflow.receipt.receivedAt, 80),
      trusted: trustedCallback?.signatureVerified === true,
      contractId: clean(trustedCallback?.contractId, 120),
      providerStatus: clean(trustedCallback?.providerStatus, 40)
    } : null,
    delivery,
    standardMappingStatus: clean(workflow?.standardMapping?.status, 80),
    followupStatus: clean(workflow?.followup?.status, 80),
    timeline: projectTimeline(workflow),
    businessClosureComplete: workflow?.businessClosureComplete === true,
    productionReady: false
  };
}

function callbackHeader(req, name) {
  const headers = req?.headers || {};
  return clean(headers[name] || headers[name.toLowerCase()], 200);
}

function callbackDueAt(occurredAt) {
  const dueAt = new Date(occurredAt);
  dueAt.setUTCDate(dueAt.getUTCDate() + 1);
  return dueAt.toISOString();
}

function createRouteSegment(runtime) {
  const { DIRECT_REPORT_CONTRACT_ID, appendDataAccessLog, appendSecurityEvent, applyInfectiousReportingAction, buildInfectiousReportingCaseFromSources, collectJson, enqueueDirectReportDeliveryToState, projectDirectReportDelivery, publicDirectReportControlStatus, randomUUID, readDatabase, recordTrustedDirectReportCallbackToState, requeueDirectReportDeadLetterToState, requireApiRole, sealAuditTrail, sendJson, upsertInfectiousReportingCase, verifyDirectReportCallback, writeDatabase } = runtime;
  return {
    id: "public-health-04",
    domain: "public-health",
    async handle(req, res, url) {
      if (req.method === "GET" && url.pathname === "/api/public-health/infectious-reporting-cases") {
        const user = runtime.requireApiRole(
          req,
          res,
          ["commission"],
          "/api/public-health/infectious-reporting-cases"
        );
        if (!user) return true;
        const data = runtime.readDatabase();
        const deliveries = Array.isArray(data.publicHealthInfectiousReportingDeliveries)
          ? data.publicHealthInfectiousReportingDeliveries
          : [];
        const cases = (Array.isArray(data.publicHealthInfectiousReportingCases)
          ? data.publicHealthInfectiousReportingCases
          : [])
          .map((item) => projectCaseSummary(
            item,
            runtime.projectDirectReportDelivery(latestDeliveryForCase(deliveries, item.id))
          ))
          .sort((left, right) => {
            const leftAt = clean(left.timeline.at(-1)?.at, 80);
            const rightAt = clean(right.timeline.at(-1)?.at, 80);
            return rightAt.localeCompare(leftAt);
          });
        runtime.appendSecurityEvent({
          actor: user.name,
          role: user.role,
          action: "public-health-infectious-reporting-list",
          target: "/api/public-health/infectious-reporting-cases",
          result: "allowed",
          detail: `cases=${cases.length}; projection=minimized; production=false`
        });
        runtime.sendJson(res, 200, {
          ok: true,
          summary: {
            total: cases.length,
            open: cases.filter((item) => item.businessClosureComplete !== true).length,
            trustedReceipts: cases.filter((item) => item.receipt?.trusted === true).length,
            closed: cases.filter((item) => item.businessClosureComplete === true).length,
            deliveryQueued: cases.filter((item) => (
              item.delivery && ["queued", "retry-scheduled", "leased"].includes(item.delivery.state)
            )).length,
            deliveryDeadLetter: cases.filter((item) => item.delivery?.state === "dead-letter").length
          },
          controlPackage: publicDirectReportControlStatus(),
          cases,
          productionReady: false
        });
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/public-health/infectious-reporting-control-package") {
        const user = runtime.requireApiRole(
          req,
          res,
          ["commission"],
          "/api/public-health/infectious-reporting-control-package"
        );
        if (!user) return true;
        const controlPackage = publicDirectReportControlStatus();
        runtime.appendSecurityEvent({
          actor: user.name,
          role: user.role,
          action: "public-health-infectious-reporting-control-package-read",
          target: "/api/public-health/infectious-reporting-control-package",
          result: "allowed",
          detail: `activationReady=${controlPackage.activationReady === true}; projection=minimized; production=false`
        });
        runtime.sendJson(res, 200, {
          ok: true,
          controlPackage,
          credentialsExposed: false,
          payloadsExposed: false,
          productionReady: false
        });
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/public-health/infectious-reporting-deliveries") {
        const user = runtime.requireApiRole(
          req,
          res,
          ["commission"],
          "/api/public-health/infectious-reporting-deliveries"
        );
        if (!user) return true;
        const data = runtime.readDatabase();
        const deliveries = (Array.isArray(data.publicHealthInfectiousReportingDeliveries)
          ? data.publicHealthInfectiousReportingDeliveries
          : [])
          .map((item) => runtime.projectDirectReportDelivery(item))
          .sort((left, right) => clean(right.updatedAt, 80).localeCompare(clean(left.updatedAt, 80)));
        runtime.appendSecurityEvent({
          actor: user.name,
          role: user.role,
          action: "public-health-infectious-reporting-delivery-list",
          target: "/api/public-health/infectious-reporting-deliveries",
          result: "allowed",
          detail: `deliveries=${deliveries.length}; projection=minimized; production=false`
        });
        runtime.sendJson(res, 200, {
          ok: true,
          summary: {
            total: deliveries.length,
            queued: deliveries.filter((item) => ["queued", "retry-scheduled"].includes(item.state)).length,
            awaitingCallback: deliveries.filter((item) => item.state === "awaiting-callback").length,
            deadLetter: deliveries.filter((item) => item.state === "dead-letter").length,
            completed: deliveries.filter((item) => ["callback-accepted", "callback-rejected"].includes(item.state)).length
          },
          deliveries,
          payloadsExposed: false,
          subjectDataExposed: false,
          credentialsExposed: false,
          productionReady: false
        });
        return true;
      }

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

      const callbackMatch = url.pathname.match(
        /^\/api\/public-health\/infectious-reporting-cases\/([^/]+)\/direct-report-callback$/
      );
      if (req.method === "POST" && callbackMatch) {
        const target = "/api/public-health/infectious-reporting-cases/:id/direct-report-callback";
        try {
          const caseId = safeId(decodeURIComponent(callbackMatch[1]), "caseId");
          const payload = await runtime.collectJson(req);
          const verified = runtime.verifyDirectReportCallback(payload, {
            timestamp: callbackHeader(req, "x-public-health-direct-report-timestamp"),
            nonce: callbackHeader(req, "x-public-health-direct-report-nonce"),
            signature: callbackHeader(req, "x-public-health-direct-report-signature")
          });
          const receiptStatus = TERMINAL_CALLBACK_STATUSES[verified.status];
          if (!receiptStatus) {
            throw commandError(
              "PUBLIC_HEALTH_DIRECT_REPORT_CALLBACK_NOT_TERMINAL",
              "direct-report callback status is not terminal",
              409
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
          const workflow = cases[index];
          if (verified.eventId !== workflow.externalEventId) {
            throw commandError(
              "PUBLIC_HEALTH_DIRECT_REPORT_CALLBACK_BINDING_MISMATCH",
              "direct-report callback event does not match the reporting case",
              409
            );
          }
          const nonceOwner = cases.find((item) => (
            item.receipt?.trustedCallback?.nonceDigest === verified.nonceDigest
          ));
          if (nonceOwner && nonceOwner.id !== workflow.id) {
            throw commandError(
              "PUBLIC_HEALTH_DIRECT_REPORT_CALLBACK_NONCE_REPLAY",
              "direct-report callback nonce is already bound to another case",
              409
            );
          }
          const actor = {
            name: "public-health-direct-report-adapter",
            role: "system"
          };
          const result = runtime.applyInfectiousReportingAction(
            workflow,
            {
              action: "record-receipt",
              expectedVersion: workflow.version,
              idempotencyKey: `direct-report-callback:${verified.receiptId}`,
              receiptId: verified.receiptId,
              receiptStatus,
              receiptCode: verified.providerCode || verified.receiptId,
              receivedAt: verified.occurredAt,
              at: verified.occurredAt,
              detail: receiptStatus === "accepted"
                ? "direct-report platform confirmed receipt"
                : "direct-report platform rejected the submission",
              ...(receiptStatus === "rejected" ? {
                reason: "direct-report platform rejected the submission",
                exceptionOwner: "public-health-direct-report-operations",
                dueAt: callbackDueAt(verified.occurredAt)
              } : {}),
              evidenceRefs: [`direct-report-receipt:${verified.receiptId}`],
              trustedCallback: {
                contractId: runtime.DIRECT_REPORT_CONTRACT_ID,
                eventId: verified.eventId,
                receiptId: verified.receiptId,
                providerStatus: verified.status,
                nonceDigest: verified.nonceDigest,
                signatureVerified: true,
                payloadsExposed: false,
                credentialsPersisted: false
              }
            },
            actor
          );
          const deliveryResult = runtime.recordTrustedDirectReportCallbackToState(data, {
            caseId: workflow.id,
            receiptId: verified.receiptId,
            status: receiptStatus,
            at: verified.occurredAt
          });
          const nextData = deliveryResult.nextData;
          const nextCases = [...cases];
          nextCases[index] = result.case;
          nextData.publicHealthInfectiousReportingCases = nextCases.slice(-500);
          appendAudit(
            runtime,
            nextData,
            actor,
            result.case,
            "public-health-infectious-reporting-direct-report-callback",
            `${result.idempotent ? "idempotent" : "applied"}; status=${receiptStatus}; version=${result.case.version}; signature=verified; production=false`
          );
          runtime.writeDatabase(nextData);
          runtime.sendJson(res, 200, {
            ok: true,
            idempotent: result.idempotent,
            case: projectCaseSummary(
              result.case,
              runtime.projectDirectReportDelivery(deliveryResult.delivery)
            ),
            callback: {
              contractId: runtime.DIRECT_REPORT_CONTRACT_ID,
              eventId: verified.eventId,
              receiptId: verified.receiptId,
              providerStatus: verified.status,
              signatureVerified: true,
              payloadsExposed: false,
              credentialsPersisted: false
            },
            deliveryMatched: deliveryResult.matched,
            businessClosureComplete: result.case.businessClosureComplete === true,
            productionReady: false
          });
        } catch (error) {
          auditCallbackDenial(runtime, target, error);
          sendCommandError(runtime, res, error);
        }
        return true;
      }

      const deliveryRetryMatch = url.pathname.match(
        /^\/api\/public-health\/infectious-reporting-deliveries\/([^/]+)\/retry$/
      );
      if (req.method === "POST" && deliveryRetryMatch) {
        const user = runtime.requireApiRole(
          req,
          res,
          ["commission"],
          "/api/public-health/infectious-reporting-deliveries/:id/retry"
        );
        if (!user) return true;
        try {
          const deliveryId = safeId(decodeURIComponent(deliveryRetryMatch[1]), "deliveryId");
          const payload = await runtime.collectJson(req);
          const expectedVersion = Number(payload.expectedVersion);
          if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
            throw commandError(
              "PUBLIC_HEALTH_DIRECT_REPORT_DELIVERY_VERSION_REQUIRED",
              "expectedVersion must be a positive integer"
            );
          }
          const data = runtime.readDatabase();
          const replayed = runtime.requeueDirectReportDeadLetterToState(data, deliveryId, {
            expectedVersion,
            idempotencyKey: required(payload.idempotencyKey, "idempotencyKey", 200),
            at: payload.at || new Date().toISOString()
          });
          const workflow = (Array.isArray(replayed.nextData.publicHealthInfectiousReportingCases)
            ? replayed.nextData.publicHealthInfectiousReportingCases
            : []).find((item) => item.id === replayed.delivery.caseId);
          appendAudit(
            runtime,
            replayed.nextData,
            user,
            workflow || { id: replayed.delivery.caseId, event: {} },
            "public-health-infectious-reporting-delivery-retry",
            `${replayed.idempotent ? "idempotent" : "requeued"}; delivery=${deliveryId}; version=${replayed.delivery.version}; production=false`
          );
          runtime.writeDatabase(replayed.nextData);
          runtime.sendJson(res, 200, {
            ok: true,
            idempotent: replayed.idempotent,
            delivery: runtime.projectDirectReportDelivery(replayed.delivery),
            productionReady: false
          });
        } catch (error) {
          auditDenial(
            runtime,
            user,
            "/api/public-health/infectious-reporting-deliveries/:id/retry",
            "public-health-infectious-reporting-delivery-retry",
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
          let nextData = data;
          let deliveryResult = null;
          if (action === "submit-report") {
            deliveryResult = runtime.enqueueDirectReportDeliveryToState(nextData, result.case, {
              at: result.history.at
            });
            nextData = deliveryResult.nextData;
          }
          const nextCases = [...cases];
          nextCases[index] = result.case;
          nextData.publicHealthInfectiousReportingCases = nextCases.slice(-500);
          appendAudit(
            runtime,
            nextData,
            user,
            result.case,
            `public-health-infectious-reporting-${action}`,
            `${result.idempotent ? "idempotent" : "applied"}; version=${result.case.version}; production=false`
          );
          runtime.writeDatabase(nextData);
          runtime.sendJson(res, 200, {
            ok: true,
            idempotent: result.idempotent,
            case: result.case,
            delivery: deliveryResult
              ? runtime.projectDirectReportDelivery(deliveryResult.delivery)
              : null,
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
  createRouteSegment,
  latestDeliveryForCase,
  projectCaseSummary
};
