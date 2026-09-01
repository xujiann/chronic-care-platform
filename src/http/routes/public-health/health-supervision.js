"use strict";

const templates = require("../../../../config/public-health-supervision-templates.json");
const {
  appendApiCommandReceipt,
  assertApiCommandExpectedVersion,
  commandBehaviorError,
  createApiCommandIdentity,
  findApiCommandReceipt,
  withApiCommandResourceLock
} = require("../../api-command-behavior");
const {
  collectionVersion,
  isStorageConflict,
  prepareCollectionCas
} = require("../../../platform/storage/state-command-consistency");
const {
  COLLECTIONS,
  ERROR_PREFIX,
  projectFinding,
  projectInspectionRecord,
  projectInspectionTask,
  projectSubject
} = require("../../../public-health/health-supervision/contracts");
const {
  applyInspectionTaskActionToState,
  applySupervisionFindingActionToState,
  buildHealthSupervisionWorkbench,
  createInspectionTaskToState,
  createSupervisionSubjectToState
} = require("../../../public-health/health-supervision/service");

const ALLOWED_COMMISSION_ORG_TYPES = new Set(["city", "health_admin", "district"]);
const REQUIRED_DEPENDENCIES = Object.freeze([
  "appendSecurityEvent",
  "collectJson",
  "randomUUID",
  "readDatabase",
  "requireApiRole",
  "sealAuditTrail",
  "sendJson",
  "writeDatabase"
]);

function normalizedCode(value) {
  return String(value || "").trim().toUpperCase();
}

function requireManagerOrganization(user, allowedRoles) {
  const role = String(user?.role || "").trim();
  const accountType = String(user?.accountType || "").trim().toLowerCase();
  const orgType = String(user?.orgType || "").trim().toLowerCase();
  const orgCode = normalizedCode(user?.orgCode);
  const allowed = allowedRoles.includes(role)
    && accountType === "manager"
    && Boolean(orgCode)
    && ((role === "commission" && ALLOWED_COMMISSION_ORG_TYPES.has(orgType))
      || (role === "institution" && orgType === "medical_institution"));
  if (!allowed) {
    throw commandBehaviorError(`${ERROR_PREFIX}_SCOPE_FORBIDDEN`, "organization scope denied", 403);
  }
  return { role, accountType, orgType, orgCode };
}

function organizationDirectoryEntry(data, organizationCode) {
  const expected = normalizedCode(organizationCode);
  return (Array.isArray(data?.authOrganizations) ? data.authOrganizations : [])
    .find((item) => normalizedCode(item?.orgCode) === expected) || null;
}

function subjectInScope(user, subject) {
  const actor = requireManagerOrganization(user, ["commission", "institution"]);
  if (actor.role === "institution") return normalizedCode(subject?.organizationCode) === actor.orgCode;
  if (["city", "health_admin"].includes(actor.orgType)) return true;
  return normalizedCode(subject?.jurisdictionCode) === actor.orgCode;
}

function requireSubjectScope(user, subject) {
  if (!subject || !subjectInScope(user, subject)) {
    throw commandBehaviorError(`${ERROR_PREFIX}_SCOPE_FORBIDDEN`, "supervision subject scope denied", 403);
  }
}

function requireAssignedTaskScope(user, task) {
  const actor = requireManagerOrganization(user, ["commission"]);
  if (normalizedCode(task?.assignedOrgCode) !== actor.orgCode) {
    throw commandBehaviorError(`${ERROR_PREFIX}_SCOPE_FORBIDDEN`, "inspection task scope denied", 403);
  }
}

function requireFindingScope(user, data, finding, action) {
  const task = (Array.isArray(data?.publicHealthSupervisionInspectionTasks)
    ? data.publicHealthSupervisionInspectionTasks
    : []).find((item) => item.id === finding?.taskId);
  const subject = (Array.isArray(data?.publicHealthSupervisionSubjects)
    ? data.publicHealthSupervisionSubjects
    : []).find((item) => item.id === finding?.subjectId);
  if (!task || !subject) {
    throw commandBehaviorError(`${ERROR_PREFIX}_NOT_FOUND`, "supervision finding context not found", 404);
  }
  if (action === "submit-remediation") {
    const actor = requireManagerOrganization(user, ["institution"]);
    if (normalizedCode(subject.organizationCode) !== actor.orgCode) {
      throw commandBehaviorError(`${ERROR_PREFIX}_SCOPE_FORBIDDEN`, "remediation subject scope denied", 403);
    }
    return { task, subject };
  }
  requireAssignedTaskScope(user, task);
  return { task, subject };
}

function requireExplicitCommand(command, expectedCreateVersion = false) {
  if (!command.explicitContract) {
    throw commandBehaviorError(`${ERROR_PREFIX}_IDEMPOTENCY_KEY_REQUIRED`, "Idempotency-Key is required", 400);
  }
  if (command.expectedVersion === null) {
    throw commandBehaviorError(`${ERROR_PREFIX}_EXPECTED_VERSION_REQUIRED`, "expectedVersion is required", 400);
  }
  if (expectedCreateVersion && command.expectedVersion !== 0) {
    throw commandBehaviorError(`${ERROR_PREFIX}_VERSION_CONFLICT`, "create command expectedVersion must be 0", 409);
  }
}

function responseError(error) {
  if (error?.code && Number.isInteger(error.statusCode)) {
    const status = error.statusCode;
    return {
      status,
      body: {
        error: status === 403 ? "Forbidden" : status === 404 ? "Not Found" : status === 409 ? "Conflict" : "Bad Request",
        code: error.code,
        message: error.message
      }
    };
  }
  if (error instanceof SyntaxError) {
    return {
      status: 400,
      body: { error: "Bad Request", code: `${ERROR_PREFIX}_INPUT_INVALID`, message: "request body is invalid" }
    };
  }
  if (isStorageConflict(error) || /SQLite optimistic lock conflict|version conflict|CAS conflict/i.test(String(error?.message || ""))) {
    return {
      status: 409,
      body: { error: "Conflict", code: `${ERROR_PREFIX}_VERSION_CONFLICT`, message: "resource version changed; refresh and retry" }
    };
  }
  return {
    status: 500,
    body: { error: "Internal Server Error", code: `${ERROR_PREFIX}_STORAGE_FAILED`, message: "supervision command persistence failed" }
  };
}

function sendRouteError(runtime, res, error, user, target) {
  const response = responseError(error);
  if (response.status === 403 && user) {
    try {
      runtime.appendSecurityEvent({
        actor: String(user.name || user.username || user.id || user.role || "unknown"),
        role: String(user.role || "unknown"),
        action: "public-health-supervision-scope",
        target,
        result: "denied",
        detail: String(error.code || `${ERROR_PREFIX}_SCOPE_FORBIDDEN`).slice(0, 160)
      });
    } catch {
      runtime.sendJson(res, 500, {
        error: "Internal Server Error",
        code: `${ERROR_PREFIX}_AUDIT_FAILED`,
        message: "supervision access audit failed"
      });
      return;
    }
  }
  runtime.sendJson(res, response.status, response.body);
}

function replaceById(records, replacement) {
  return (Array.isArray(records) ? records : []).map((item) => item.id === replacement.id ? replacement : item);
}

function appendAudit(runtime, data, user, action, target, detail) {
  data.securityEvents = runtime.sealAuditTrail([
    {
      id: runtime.randomUUID(),
      at: new Date().toISOString(),
      actor: String(user?.name || user?.username || user?.id || user?.role || "unknown"),
      role: String(user?.role || "unknown"),
      action,
      target: String(target || "").slice(0, 160),
      result: "allowed",
      detail: String(detail || "").slice(0, 300)
    },
    ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
  ].slice(0, 120), { recompute: true });
}

function prepareWrite(nextData, originalData, touchedCollections, primaryCollection) {
  const expectedCollectionVersion = collectionVersion(originalData, primaryCollection);
  prepareCollectionCas(
    nextData,
    [...new Set([...touchedCollections, "securityEvents"])],
    primaryCollection,
    expectedCollectionVersion,
    `${ERROR_PREFIX}_VERSION_CONFLICT`
  );
}

function replayResponse(receipt) {
  return { status: 200, body: { ...receipt.response, idempotent: true } };
}

function commandIdentity(req, user, payload, route, resourceId) {
  const command = createApiCommandIdentity({ req, user, payload, route, resourceId, errorPrefix: ERROR_PREFIX });
  requireExplicitCommand(command, route.endsWith("/subjects") || route.endsWith("/inspection-tasks"));
  return command;
}

function createRouteSegment(runtime) {
  const { appendSecurityEvent, collectJson, randomUUID, readDatabase, requireApiRole, sealAuditTrail, sendJson, writeDatabase } = runtime;
  return createScopedRouteSegment(Object.freeze({
    appendSecurityEvent,
    collectJson,
    randomUUID,
    readDatabase,
    requireApiRole,
    sealAuditTrail,
    sendJson,
    writeDatabase
  }));
}

function createScopedRouteSegment(runtime) {
  return {
    id: "public-health-05",
    domain: "public-health",
    async handle(req, res, url) {
      if (req.method === "GET" && url.pathname === "/api/public-health/supervision/workbench") {
        const user = runtime.requireApiRole(req, res, ["commission", "institution"], url.pathname);
        if (!user) return true;
        try {
          requireManagerOrganization(user, ["commission", "institution"]);
          if ([...url.searchParams.keys()].length) {
            throw commandBehaviorError(`${ERROR_PREFIX}_INPUT_INVALID`, "query parameters are not supported", 400);
          }
          const data = runtime.readDatabase();
          runtime.sendJson(res, 200, buildHealthSupervisionWorkbench(data, { user, templates: templates.templates, now: new Date().toISOString() }));
        } catch (error) {
          sendRouteError(runtime, res, error, user, url.pathname);
        }
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/public-health/supervision/subjects") {
        const user = runtime.requireApiRole(req, res, ["commission"], url.pathname);
        if (!user) return true;
        try {
          const actor = requireManagerOrganization(user, ["commission"]);
          const payload = await runtime.collectJson(req);
          const command = commandIdentity(req, user, payload, url.pathname, normalizedCode(payload.organizationCode));
          const result = await withApiCommandResourceLock(`health-supervision:subject:${normalizedCode(payload.organizationCode)}`, () => {
            const data = runtime.readDatabase();
            const directoryEntry = organizationDirectoryEntry(data, payload.organizationCode);
            if (!directoryEntry || String(directoryEntry.orgType || "").trim().toLowerCase() !== "medical_institution") {
              throw commandBehaviorError(`${ERROR_PREFIX}_NOT_FOUND`, "organization directory subject not found", 404);
            }
            if (actor.orgType === "district" && normalizedCode(directoryEntry.parentCode) !== actor.orgCode) {
              throw commandBehaviorError(`${ERROR_PREFIX}_SCOPE_FORBIDDEN`, "organization directory subject scope denied", 403);
            }
            const records = Array.isArray(data.publicHealthSupervisionSubjects) ? data.publicHealthSupervisionSubjects : [];
            const receipt = findApiCommandReceipt(records, command);
            if (receipt) return replayResponse(receipt);
            const created = createSupervisionSubjectToState(data, {
              payload,
              user,
              directoryEntry,
              id: `phss-${runtime.randomUUID()}`,
              now: new Date().toISOString()
            });
            const body = { ok: true, idempotent: false, subject: projectSubject(created.subject), productionReady: false };
            const withReceipt = appendApiCommandReceipt(created.subject, command, body, 201, created.subject.createdAt);
            created.nextData.publicHealthSupervisionSubjects = replaceById(created.nextData.publicHealthSupervisionSubjects, withReceipt);
            appendAudit(runtime, created.nextData, user, "public-health-supervision-subject-create", withReceipt.id, `organization=${withReceipt.organizationCode}; version=${withReceipt.version}; production=false`);
            prepareWrite(created.nextData, data, [COLLECTIONS.subjects], COLLECTIONS.subjects);
            runtime.writeDatabase(created.nextData);
            return { status: 201, body };
          });
          runtime.sendJson(res, result.status, result.body);
        } catch (error) {
          sendRouteError(runtime, res, error, user, url.pathname);
        }
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/public-health/supervision/inspection-tasks") {
        const user = runtime.requireApiRole(req, res, ["commission"], url.pathname);
        if (!user) return true;
        try {
          requireManagerOrganization(user, ["commission"]);
          const payload = await runtime.collectJson(req);
          const command = commandIdentity(req, user, payload, url.pathname, payload.subjectId);
          const result = await withApiCommandResourceLock(`health-supervision:subject:${String(payload.subjectId || "")}`, () => {
            const data = runtime.readDatabase();
            const subject = (Array.isArray(data.publicHealthSupervisionSubjects) ? data.publicHealthSupervisionSubjects : [])
              .find((item) => item.id === payload.subjectId);
            if (!subject) throw commandBehaviorError(`${ERROR_PREFIX}_NOT_FOUND`, "supervision subject not found", 404);
            requireSubjectScope(user, subject);
            const tasks = Array.isArray(data.publicHealthSupervisionInspectionTasks) ? data.publicHealthSupervisionInspectionTasks : [];
            const receipt = findApiCommandReceipt(tasks, command);
            if (receipt) return replayResponse(receipt);
            const created = createInspectionTaskToState(data, {
              payload,
              user,
              id: `phst-${runtime.randomUUID()}`,
              now: new Date().toISOString(),
              templates: templates.templates
            });
            const body = { ok: true, idempotent: false, task: projectInspectionTask(created.task), productionReady: false };
            const withReceipt = appendApiCommandReceipt(created.task, command, body, 201, created.task.createdAt);
            created.nextData.publicHealthSupervisionInspectionTasks = replaceById(created.nextData.publicHealthSupervisionInspectionTasks, withReceipt);
            appendAudit(runtime, created.nextData, user, "public-health-supervision-task-create", withReceipt.id, `subject=${withReceipt.subjectId}; version=${withReceipt.version}; production=false`);
            prepareWrite(created.nextData, data, [COLLECTIONS.tasks], COLLECTIONS.tasks);
            runtime.writeDatabase(created.nextData);
            return { status: 201, body };
          });
          runtime.sendJson(res, result.status, result.body);
        } catch (error) {
          sendRouteError(runtime, res, error, user, url.pathname);
        }
        return true;
      }

      const taskActionMatch = url.pathname.match(/^\/api\/public-health\/supervision\/inspection-tasks\/([^/]+)\/actions$/);
      if (req.method === "POST" && taskActionMatch) {
        const user = runtime.requireApiRole(req, res, ["commission"], "/api/public-health/supervision/inspection-tasks/:id/actions");
        if (!user) return true;
        try {
          requireManagerOrganization(user, ["commission"]);
          const taskId = decodeURIComponent(taskActionMatch[1]);
          const payload = await runtime.collectJson(req);
          const command = commandIdentity(req, user, payload, "/api/public-health/supervision/inspection-tasks/:id/actions", taskId);
          const result = await withApiCommandResourceLock(`health-supervision:task:${taskId}`, () => {
            const data = runtime.readDatabase();
            const task = (Array.isArray(data.publicHealthSupervisionInspectionTasks) ? data.publicHealthSupervisionInspectionTasks : [])
              .find((item) => item.id === taskId);
            if (!task) throw commandBehaviorError(`${ERROR_PREFIX}_NOT_FOUND`, "inspection task not found", 404);
            requireAssignedTaskScope(user, task);
            const receipt = findApiCommandReceipt([task], command);
            if (receipt) return replayResponse(receipt);
            assertApiCommandExpectedVersion(task, command);
            const findingCount = Array.isArray(payload.findings) ? payload.findings.length : 0;
            const changed = applyInspectionTaskActionToState(data, {
              payload,
              user,
              taskId,
              now: new Date().toISOString(),
              recordId: `phsr-${runtime.randomUUID()}`,
              findingIds: Array.from({ length: findingCount }, () => `phsf-${runtime.randomUUID()}`),
              templates: templates.templates
            });
            const body = {
              ok: true,
              idempotent: false,
              task: projectInspectionTask(changed.task),
              ...(changed.record ? { record: projectInspectionRecord(changed.record) } : {}),
              ...(Array.isArray(changed.findings) ? { findings: changed.findings.map(projectFinding) } : {}),
              productionReady: false
            };
            const withReceipt = appendApiCommandReceipt(changed.task, command, body, 200, changed.task.updatedAt);
            changed.nextData.publicHealthSupervisionInspectionTasks = replaceById(changed.nextData.publicHealthSupervisionInspectionTasks, withReceipt);
            appendAudit(runtime, changed.nextData, user, `public-health-supervision-task-${payload.action}`, taskId, `version=${withReceipt.version}; status=${withReceipt.status}; production=false`);
            const touched = [COLLECTIONS.tasks];
            if (changed.record) touched.push(COLLECTIONS.records);
            if (Array.isArray(changed.findings) && changed.findings.length) touched.push(COLLECTIONS.findings);
            prepareWrite(changed.nextData, data, touched, COLLECTIONS.tasks);
            runtime.writeDatabase(changed.nextData);
            return { status: 200, body };
          });
          runtime.sendJson(res, result.status, result.body);
        } catch (error) {
          sendRouteError(runtime, res, error, user, url.pathname);
        }
        return true;
      }

      const findingActionMatch = url.pathname.match(/^\/api\/public-health\/supervision\/findings\/([^/]+)\/actions$/);
      if (req.method === "POST" && findingActionMatch) {
        const user = runtime.requireApiRole(req, res, ["commission", "institution"], "/api/public-health/supervision/findings/:id/actions");
        if (!user) return true;
        try {
          const findingId = decodeURIComponent(findingActionMatch[1]);
          const payload = await runtime.collectJson(req);
          const command = commandIdentity(req, user, payload, "/api/public-health/supervision/findings/:id/actions", findingId);
          const initial = runtime.readDatabase();
          const initialFinding = (Array.isArray(initial.publicHealthSupervisionFindings) ? initial.publicHealthSupervisionFindings : [])
            .find((item) => item.id === findingId);
          if (!initialFinding) throw commandBehaviorError(`${ERROR_PREFIX}_NOT_FOUND`, "supervision finding not found", 404);
          requireFindingScope(user, initial, initialFinding, payload.action);
          const result = await withApiCommandResourceLock(`health-supervision:task:${initialFinding.taskId}`, () => {
            const data = runtime.readDatabase();
            const finding = (Array.isArray(data.publicHealthSupervisionFindings) ? data.publicHealthSupervisionFindings : [])
              .find((item) => item.id === findingId);
            if (!finding) throw commandBehaviorError(`${ERROR_PREFIX}_NOT_FOUND`, "supervision finding not found", 404);
            requireFindingScope(user, data, finding, payload.action);
            const receipt = findApiCommandReceipt([finding], command);
            if (receipt) return replayResponse(receipt);
            assertApiCommandExpectedVersion(finding, command);
            const changed = applySupervisionFindingActionToState(data, {
              payload,
              user,
              findingId,
              now: new Date().toISOString()
            });
            const body = {
              ok: true,
              idempotent: false,
              finding: projectFinding(changed.finding),
              task: projectInspectionTask(changed.task),
              productionReady: false
            };
            const withReceipt = appendApiCommandReceipt(changed.finding, command, body, 200, changed.finding.updatedAt);
            changed.nextData.publicHealthSupervisionFindings = replaceById(changed.nextData.publicHealthSupervisionFindings, withReceipt);
            appendAudit(runtime, changed.nextData, user, `public-health-supervision-finding-${payload.action}`, findingId, `version=${withReceipt.version}; task=${changed.task.status}; production=false`);
            prepareWrite(changed.nextData, data, [COLLECTIONS.findings, COLLECTIONS.tasks], COLLECTIONS.findings);
            runtime.writeDatabase(changed.nextData);
            return { status: 200, body };
          });
          runtime.sendJson(res, result.status, result.body);
        } catch (error) {
          sendRouteError(runtime, res, error, user, url.pathname);
        }
        return true;
      }

      return false;
    }
  };
}

module.exports = {
  REQUIRED_DEPENDENCIES,
  ROUTE_SEGMENT_ID: "public-health-05",
  SUBDOMAIN: "health-supervision",
  createRouteSegment
};
