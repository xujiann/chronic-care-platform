"use strict";

const {
  LEGACY_FULL_STATE_CONTRACT,
  changedCollections,
  ownerForCollection,
  ownershipEntries,
  setLegacyWriteHeaders,
  setOwnedWriteHeaders
} = require("./t02-state-ownership-contract");

function createRouteSegments(runtime) {
  const { COLLECTION_WRITE_KEYS, auditTrailRowsMatch, auditTrailRowsMatchById, collectJson, normalizeState, prependAuditEventPreservingTrail, prependAuditTrailEntry, randomUUID, readDatabase, redactSensitiveResponse, requireApiRole, resealAuditTrail, scopeStateForUser, sealAuditTrail, seedState, sendJson, storageMeta, verifyAuditTrail, writeDatabase } = runtime;
  return [
    {
      id: "state-data-01",
      domain: "state-data",
      async handle(req, res, url) {
    if (req.method === "GET" && url.pathname === "/api/state") {
        const user = requireApiRole(req, res, ["commission", "institution", "insurance", "citizen", "county"], "/api/state");
        if (!user) return true;
        sendJson(res, 200, redactSensitiveResponse(scopeStateForUser(readDatabase(), user), user));
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
        const currentData = readDatabase();
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
        const incomingSecurityEvents = Array.isArray(payload.securityEvents) ? payload.securityEvents : [];
        const incomingAccessLogs = Array.isArray(payload.dataAccessLogs) ? payload.dataAccessLogs : [];
        const incomingSecurityTrailOk = incomingSecurityEvents.length === 0 ||
          verifyAuditTrail(incomingSecurityEvents).passed ||
          auditTrailRowsMatch(incomingSecurityEvents, currentData.securityEvents) ||
          auditTrailRowsMatchById(incomingSecurityEvents, currentData.securityEvents);
        const incomingAccessTrailOk = incomingAccessLogs.length === 0 || verifyAuditTrail(incomingAccessLogs).passed;
        const data = normalizeState(payload);
        data.storageMeta = payload.storageMeta;
        const ownershipChanges = ownershipEntries(
          changedCollections(currentData, data).filter((collection) =>
            collection !== "securityEvents" && collection !== "dataAccessLogs"
          ),
          { allowLegacy: true }
        );
        data.dataAccessLogs = incomingAccessTrailOk ? resealAuditTrail(data.dataAccessLogs) : sealAuditTrail(data.dataAccessLogs);
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
        const nextSecurityEvents = [saveEvent, ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])].slice(0, 120);
        data.securityEvents = incomingSecurityTrailOk
          ? resealAuditTrail(nextSecurityEvents)
          : prependAuditEventPreservingTrail(saveEvent, data.securityEvents);
        writeDatabase(data);
        const normalized = readDatabase();
        setLegacyWriteHeaders(res);
        sendJson(res, 200, normalized);
        return true;
      }

      if (req.method === "PUT" && url.pathname.startsWith("/api/state-collections/")) {
        const user = requireApiRole(req, res, ["commission"], "/api/state-collections/:collection");
        if (!user) return true;
        const collection = decodeURIComponent(url.pathname.replace("/api/state-collections/", "")).trim();
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

module.exports = { createRouteSegments };
