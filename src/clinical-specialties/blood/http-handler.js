"use strict";

const {
  createBloodDashboardQuery
} = require("./dashboard-query");
const {
  createLegacyBloodStateRepository
} = require("./state-repository");

const BLOOD_CORE_HTTP_DEPENDENCIES = Object.freeze([
  "BloodBusinessService",
  "BloodIntegrationGateway",
  "BloodMasterData",
  "BloodService",
  "BloodTransactionService",
  "collectJson",
  "readDatabase",
  "requireApiRole",
  "sendJson",
  "writeDatabase"
]);

function createBloodCoreHttpHandler(runtime) {
  const { BloodBusinessService, BloodIntegrationGateway, BloodMasterData, BloodService, BloodTransactionService, collectJson, readDatabase: readLegacyDatabase, requireApiRole, sendJson, writeDatabase: writeLegacyDatabase } = runtime;
  let stateRepository;
  const repository = () => stateRepository ||= createLegacyBloodStateRepository({
    readDatabase: readLegacyDatabase,
    writeDatabase: writeLegacyDatabase
  });
  const readDatabase = () => repository().read();
  const writeDatabase = (data) => repository().commit(data);
  return {
    async handle(req, res, url) {
      if (req.method === "GET" && url.pathname === "/api/blood-system") {
          const user = requireApiRole(req, res, ["commission", "institution"], "/api/blood-system");
          if (!user) return true;
          const bloodDashboardQuery = createBloodDashboardQuery({
            buildBloodDashboard: BloodService.buildDashboard,
            normalizeTransactionState: BloodTransactionService.normalizeTransactionState
          });
        // Preserve the established dashboard port identity while write paths use the scoped repository.
        const data = readLegacyDatabase();
          sendJson(res, 200, bloodDashboardQuery.execute({ data, user }));
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
          const user = recallAcknowledgeMatch
            ? requireApiRole(req, res, ["institution"], "/api/blood-system/recalls/:id/acknowledge")
            : recallCloseMatch
              ? requireApiRole(req, res, ["commission"], "/api/blood-system/recalls/:id/close")
              : reactionInvestigateMatch
                ? requireApiRole(req, res, ["commission", "institution"], "/api/blood-system/transfusion-reactions/:id/investigate")
                : requireApiRole(req, res, ["commission", "institution"], "/api/blood-system/emergency-allocations/:id/actions");
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
          "/api/blood-system/test-reports/sign": BloodTransactionService.signTestReport,
          "/api/blood-system/release-reviews": BloodTransactionService.reviewRelease,
          "/api/blood-system/shipments": BloodTransactionService.createShipment,
          "/api/blood-system/shipments/receive": BloodTransactionService.receiveShipment,
          "/api/blood-system/safety-incidents/cold-chain/review": BloodTransactionService.reviewColdChainIncident,
          "/api/blood-system/compatibility-tests": BloodTransactionService.recordCompatibility,
          "/api/blood-system/transfusions/start": BloodTransactionService.startTransfusion,
          "/api/blood-system/transfusions/complete": BloodTransactionService.completeTransfusion
        };
        if (req.method === "POST" && bloodTransactionRoutes[url.pathname]) {
          const user = url.pathname === "/api/blood-system/test-reports/sign"
            ? requireApiRole(req, res, ["commission"], "/api/blood-system/test-reports/sign")
            : url.pathname === "/api/blood-system/release-reviews"
              ? requireApiRole(req, res, ["commission"], "/api/blood-system/release-reviews")
              : url.pathname === "/api/blood-system/shipments"
                ? requireApiRole(req, res, ["commission"], "/api/blood-system/shipments")
                : url.pathname === "/api/blood-system/shipments/receive"
                  ? requireApiRole(req, res, ["institution"], "/api/blood-system/shipments/receive")
                  : url.pathname === "/api/blood-system/safety-incidents/cold-chain/review"
                    ? requireApiRole(req, res, ["commission"], "/api/blood-system/safety-incidents/cold-chain/review")
                    : url.pathname === "/api/blood-system/compatibility-tests"
                      ? requireApiRole(req, res, ["institution"], "/api/blood-system/compatibility-tests")
                      : url.pathname === "/api/blood-system/transfusions/start"
                        ? requireApiRole(req, res, ["institution"], "/api/blood-system/transfusions/start")
                        : requireApiRole(req, res, ["institution"], "/api/blood-system/transfusions/complete");
          if (!user) return true;
          const data = readDatabase();
          const payload = await collectJson(req);
          const idempotencyKey = String(req.headers["idempotency-key"] || payload.idempotencyKey || "").trim();
          const result = bloodTransactionRoutes[url.pathname](data, user, payload, idempotencyKey);
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
      return false;
    }
  };
}

const BLOOD_OPERATIONS_HTTP_DEPENDENCIES = Object.freeze([
  "BloodEventHub",
  "BloodGoLiveService",
  "BloodInnovationService",
  "collectJson",
  "readDatabase",
  "requireApiRole",
  "sendJson",
  "writeDatabase"
]);

function createBloodOperationsHttpHandler(runtime) {
  const { BloodEventHub, BloodGoLiveService, BloodInnovationService, collectJson, readDatabase: readLegacyDatabase, requireApiRole, sendJson, writeDatabase: writeLegacyDatabase } = runtime;
  let stateRepository;
  const repository = () => stateRepository ||= createLegacyBloodStateRepository({
    readDatabase: readLegacyDatabase,
    writeDatabase: writeLegacyDatabase
  });
  const readDatabase = () => repository().read();
  const writeDatabase = (data) => repository().commit(data);
  return {
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
      return false;
    }
  };
}

module.exports = {
  BLOOD_CORE_HTTP_DEPENDENCIES,
  BLOOD_OPERATIONS_HTTP_DEPENDENCIES,
  createBloodCoreHttpHandler,
  createBloodOperationsHttpHandler
};
