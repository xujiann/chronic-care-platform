"use strict";

const { isDeepStrictEqual } = require("node:util");
const { withLock } = require("./identity-security/account-lifecycle");

const {
  LEGACY_FULL_STATE_CONTRACT,
  changedCollections,
  ownerForCollection,
  ownershipEntries,
  setLegacyWriteHeaders,
  setOwnedWriteHeaders
} = require("./t02-state-ownership-contract");

const SERVER_MANAGED_REGIONAL_COLLECTIONS = Object.freeze([
  "regionalDataSharingScope",
  "regionalSharingPackages",
  "regionalSharingSnapshots",
  "regionalSharingAccessReviews"
]);
const SERVER_MANAGED_PROCUREMENT_COLLECTIONS = Object.freeze([
  "procurementRequirementCatalog",
  "procurementRequirementGovernance",
  "procurementRequirementDelivery"
]);

const AUTH_USER_READ_SECRET_FIELDS = Object.freeze([
  "password",
  "passwordHash"
]);

const SERVER_MANAGED_CLINICAL_COLLECTIONS = Object.freeze([
  "phase2ClinicalAssistRules", "phase2ClinicalAssistAlerts",
  "phase2ClinicalAssistReceipts", "phase2ClinicalAssistPluginContracts"
]);

function projectClinicalForStateRead(state) {
  const projected = { ...state };
  SERVER_MANAGED_CLINICAL_COLLECTIONS.forEach((collection) => delete projected[collection]);
  return projected;
}

function projectAuthUsersForStateRead(state = {}) {
  if (!Array.isArray(state.authUsers)) return state;
  return {
    ...state,
    authUsers: state.authUsers.map((user) => Object.fromEntries(
      Object.entries(user).filter(([field]) => !AUTH_USER_READ_SECRET_FIELDS.includes(field))
    ))
  };
}

function serverManagedRegionalState(currentData = {}) {
  return Object.fromEntries(SERVER_MANAGED_REGIONAL_COLLECTIONS
    .filter((collection) => Object.hasOwn(currentData, collection))
    .map((collection) => [collection, currentData[collection]]));
}

function firstServerManagedRegionalConflict(currentData = {}, payload = {}) {
  return SERVER_MANAGED_REGIONAL_COLLECTIONS.find((collection) =>
    Object.hasOwn(payload, collection) && !isDeepStrictEqual(payload[collection], currentData[collection])
  ) || null;
}

function projectProcurementForStateRead(state = {}, user = {}) {
  if (user.role === "commission") return state;
  const projected = { ...state };
  SERVER_MANAGED_PROCUREMENT_COLLECTIONS.forEach((collection) => delete projected[collection]);
  return projected;
}

function serverManagedProcurementState(currentData = {}) {
  return Object.fromEntries(SERVER_MANAGED_PROCUREMENT_COLLECTIONS
    .filter((collection) => Object.hasOwn(currentData, collection))
    .map((collection) => [collection, currentData[collection]]));
}

function firstServerManagedProcurementConflict(currentData = {}, payload = {}) {
  return SERVER_MANAGED_PROCUREMENT_COLLECTIONS.find((collection) =>
    Object.hasOwn(payload, collection) && !isDeepStrictEqual(payload[collection], currentData[collection])
  ) || null;
}

function firstVersionConflict(currentData, payload) {
  const expectedVersions = payload?.storageMeta?.collectionVersions || {};
  const currentVersions = currentData?.storageMeta?.collectionVersions || {};
  const collections = changedCollections(currentData, payload).filter((collection) =>
    collection !== "storageMeta" && collection !== "securityEvents" && collection !== "dataAccessLogs"
  ).sort((left, right) =>
    Number(ownerForCollection(right, { allowLegacy: true }).registered) -
    Number(ownerForCollection(left, { allowLegacy: true }).registered)
  );
  for (const collection of collections) {
    if (!Object.hasOwn(expectedVersions, collection)) continue;
    const expectedVersion = Number(expectedVersions[collection]);
    const currentVersion = Number(currentVersions[collection]);
    if (Number.isFinite(expectedVersion) && Number.isFinite(currentVersion) && expectedVersion !== currentVersion) {
      return { collection, expectedVersion, currentVersion };
    }
  }
  return null;
}

function createRouteSegments(runtime, options = {}) {
  const { COLLECTION_WRITE_KEYS, auditTrailRowsMatch, collectJson, normalizeState, prependAuditTrailEntry, randomUUID, readDatabase, redactSensitiveResponse, requireApiRole, scopeStateForUser, seedState, sendJson, storageMeta, verifyAuditTrail, writeDatabase } = runtime;
  return [
    {
      id: "state-data-01",
      domain: "state-data",
      async handle(req, res, url) {
    if (req.method === "GET" && url.pathname === "/api/state") {
        const user = requireApiRole(req, res, ["commission", "institution", "insurance", "citizen", "county"], "/api/state");
        if (!user) return true;
        const scopedState = projectClinicalForStateRead(projectProcurementForStateRead(scopeStateForUser(readDatabase(), user), user));
        sendJson(res, 200, redactSensitiveResponse(projectAuthUsersForStateRead(scopedState), user));
        return true;
      }
        return false;
      }
    },
    {
      id: "state-data-02",
      domain: "state-data",
      async handle(req, res, url) {
    if (req.method === "PUT" && url.pathname === "/api/state") {
        const user = requireApiRole(req, res, ["commission"], "/api/state");
        if (!user) return true;
        const payload = await collectJson(req);
        return withLock("clinical-assist:state", async () => {
        const currentData = readDatabase();
        const clinicalConflict = SERVER_MANAGED_CLINICAL_COLLECTIONS.find((collection) =>
          Object.hasOwn(payload, collection) && !isDeepStrictEqual(payload[collection], currentData[collection]));
        if (clinicalConflict) {
          sendJson(res, 409, { code: "CDSS_SERVER_MANAGED_COLLECTION_CONFLICT", collection: clinicalConflict, message: "临床辅助集合必须通过专用命令修改" });
          return true;
        }
        const unregisteredKeys = Object.keys(payload).filter((collection) =>
          collection !== "storageMeta" && !Object.hasOwn(currentData, collection)
        );
        if (unregisteredKeys.length) {
          sendJson(res, 400, {
            error: "Bad Request",
            code: "UNREGISTERED_STATE_COLLECTION",
            message: "Legacy full-state writes cannot create new top-level collections",
            collections: unregisteredKeys
          });
          return true;
        }
        const regionalConflict = firstServerManagedRegionalConflict(currentData, payload);
        if (regionalConflict) {
          sendJson(res, 409, {
            error: "Conflict",
            code: "REGIONAL_SHARING_SERVER_MANAGED_COLLECTION_CONFLICT",
            message: "区域共享集合由服务端命令管理，提交值必须省略或与当前值完全一致。",
            collection: regionalConflict
          });
          return true;
        }
        const procurementConflict = firstServerManagedProcurementConflict(currentData, payload);
        if (procurementConflict) {
          sendJson(res, 409, {
            error: "Conflict",
            code: "PROCUREMENT_SERVER_MANAGED_COLLECTION_CONFLICT",
            message: "招标需求治理集合由服务端命令管理，提交值必须省略或与当前值完全一致。",
            collection: procurementConflict
          });
          return true;
        }
        const effectivePayload = {
          ...payload,
          ...Object.fromEntries(SERVER_MANAGED_CLINICAL_COLLECTIONS.filter((collection) => Object.hasOwn(currentData, collection)).map((collection) => [collection, currentData[collection]])),
          ...serverManagedRegionalState(currentData),
          ...serverManagedProcurementState(currentData)
        };
        const versionConflict = firstVersionConflict(currentData, effectivePayload);
        if (versionConflict) {
          sendJson(res, 409, {
            error: "Conflict",
            code: "STORAGE_CONFLICT",
            message: "数据已被其他写入更新，请刷新后重试。",
            ...versionConflict
          });
          return true;
        }
        const incomingSecurityTrailOk = !Object.hasOwn(payload, "securityEvents") ||
          (Array.isArray(payload.securityEvents) && auditTrailRowsMatch(payload.securityEvents, currentData.securityEvents));
        const incomingAccessTrailOk = !Object.hasOwn(payload, "dataAccessLogs") ||
          (Array.isArray(payload.dataAccessLogs) && auditTrailRowsMatch(payload.dataAccessLogs, currentData.dataAccessLogs));
        if (!incomingSecurityTrailOk || !incomingAccessTrailOk) {
          sendJson(res, 400, {
            error: "Bad Request",
            code: "AUDIT_TRAIL_WRITE_REJECTED",
            message: "审计链由服务端管理，提交值必须省略或与当前值完全一致。"
          });
          return true;
        }
        const currentTrails = {
          securityEvents: verifyAuditTrail(currentData.securityEvents),
          dataAccessLogs: verifyAuditTrail(currentData.dataAccessLogs)
        };
        if (!currentTrails.securityEvents.passed || !currentTrails.dataAccessLogs.passed) {
          sendJson(res, 409, {
            error: "Conflict",
            code: "AUDIT_TRAIL_INTEGRITY_FAILED",
            message: "现有审计链完整性校验失败，写入已拒绝。",
            trails: currentTrails
          });
          return true;
        }
        const data = normalizeState({
          ...effectivePayload,
          securityEvents: currentData.securityEvents,
          dataAccessLogs: currentData.dataAccessLogs
        });
        data.storageMeta = payload.storageMeta;
        const ownershipChanges = ownershipEntries(
          changedCollections(currentData, data).filter((collection) =>
            collection !== "securityEvents" && collection !== "dataAccessLogs"
          ),
          { allowLegacy: true }
        );
        data.dataAccessLogs = currentData.dataAccessLogs;
        const saveEvent = {
          id: randomUUID(),
          at: new Date().toLocaleString("zh-CN", { hour12: false }),
          actor: user.name,
          role: user.role,
          action: "更新数据",
          target: "/api/state",
          result: "允许",
          detail: "全量保存平台数据",
          ownershipContract: {
            id: LEGACY_FULL_STATE_CONTRACT.id,
            deprecated: true,
            successor: LEGACY_FULL_STATE_CONTRACT.successor,
            collections: ownershipChanges
          }
        };
        data.securityEvents = prependAuditTrailEntry(currentData.securityEvents, saveEvent);
        writeDatabase(data);
        const normalized = readDatabase();
        setLegacyWriteHeaders(res);
        sendJson(res, 200, projectClinicalForStateRead(normalized));
        return true;
        });
      }

      if (req.method === "PUT" && url.pathname.startsWith("/api/state-collections/")) {
        const user = requireApiRole(req, res, ["commission"], "/api/state-collections/:collection");
        if (!user) return true;
        const collection = decodeURIComponent(url.pathname.replace("/api/state-collections/", "")).trim();
        if (SERVER_MANAGED_CLINICAL_COLLECTIONS.includes(collection)) {
          sendJson(res, 403, { code: "CDSS_SERVER_MANAGED_COLLECTION_WRITE_DENIED", collection, message: "临床辅助集合必须通过专用命令修改" });
          return true;
        }
        if (SERVER_MANAGED_REGIONAL_COLLECTIONS.includes(collection)) {
          sendJson(res, 403, {
            error: "Forbidden",
            code: "REGIONAL_SHARING_SERVER_MANAGED_COLLECTION_WRITE_DENIED",
            message: "区域共享集合只能通过其 owner command 写入。",
            collection
          });
          return true;
        }
        if (SERVER_MANAGED_PROCUREMENT_COLLECTIONS.includes(collection)) {
          sendJson(res, 403, {
            error: "Forbidden",
            code: "PROCUREMENT_SERVER_MANAGED_COLLECTION_WRITE_DENIED",
            message: "招标需求治理集合只能通过其治理命令写入。",
            collection
          });
          return true;
        }
        if (!COLLECTION_WRITE_KEYS.has(collection)) {
          sendJson(res, 400, { error: "Bad Request", message: "不支持集合级保存该数据集合" });
          return true;
        }
        const ownershipPolicy = setOwnedWriteHeaders(res, collection);
        const payload = await collectJson(req);
        const value = Array.isArray(payload.value) ? payload.value : payload[collection];
        if (!Array.isArray(value)) {
          sendJson(res, 400, { error: "Bad Request", message: "集合级保存必须提交数组 value" });
          return true;
        }
        return withLock("clinical-assist:state", async () => {
        const data = readDatabase();
        data[collection] = value;
        data.storageMeta = {
          ...(data.storageMeta || {}),
          collectionVersions: Object.hasOwn(payload, "expectedVersion") ? { [collection]: Number(payload.expectedVersion) } : {}
        };
        data.securityEvents = prependAuditTrailEntry(data.securityEvents, {
          id: randomUUID(),
          at: new Date().toLocaleString("zh-CN", { hour12: false }),
          actor: user.name,
          role: user.role,
          action: "集合级保存数据",
          target: collection,
          result: "允许",
          detail: `保存 ${collection}，记录数 ${value.length}`,
          ownershipContract: {
            id: `state-data.${collection}.delegated-write.v1`,
            owner: ownershipPolicy.owner,
            collection
          }
        });
        writeDatabase(data);
        const versions = storageMeta().collectionVersions;
        sendJson(res, 200, { ok: true, collection, version: versions[collection] ?? null, count: value.length });
        return true;
        });
      }
        return false;
      }
    },
    {
      id: "state-data-03",
      domain: "state-data",
      async handle(req, res, url) {
    if (req.method === "POST" && url.pathname === "/api/reset") {
        const user = requireApiRole(req, res, ["commission"], "/api/reset");
        if (!user) return true;
        if (String(options.environment?.NODE_ENV || "").toLowerCase() === "production") {
          sendJson(res, 403, {
            error: "Forbidden",
            code: "DEMO_RESET_DISABLED_IN_PRODUCTION",
            message: "演示数据重置在生产环境中不可用。"
          });
          return true;
        }
        const data = seedState();
        setLegacyWriteHeaders(res, {
          ...LEGACY_FULL_STATE_CONTRACT,
          id: "state-data.demo-reset.v1",
          successor: "/api/domain-commands"
        });
        data.securityEvents = prependAuditTrailEntry(data.securityEvents, {
          id: randomUUID(),
          at: new Date().toLocaleString("zh-CN", { hour12: false }),
          actor: user.name,
          role: user.role,
          action: "重置数据",
          target: "/api/reset",
          result: "允许",
          detail: "恢复演示数据",
          ownershipContract: {
            id: "state-data.demo-reset.v1",
            owner: ownerForCollection("securityEvents").owner,
            deprecated: true,
            environment: "demo-only"
          }
        });
        writeDatabase(data);
        sendJson(res, 200, data);
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/id") {
        const user = requireApiRole(req, res, ["citizen", "institution", "insurance", "county", "commission"], "/api/id");
        if (!user) return true;
        sendJson(res, 200, { id: randomUUID() });
        return true;
      }
        return false;
      }
    },
  ];
}

module.exports = {
  AUTH_USER_READ_SECRET_FIELDS,
  SERVER_MANAGED_PROCUREMENT_COLLECTIONS,
  SERVER_MANAGED_REGIONAL_COLLECTIONS,
  createRouteSegments,
  firstServerManagedRegionalConflict,
  firstServerManagedProcurementConflict,
  projectProcurementForStateRead,
  projectAuthUsersForStateRead,
  serverManagedRegionalState,
  serverManagedProcurementState
};
