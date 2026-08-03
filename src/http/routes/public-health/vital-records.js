"use strict";

function createRouteSegment(runtime) {
  const { appendSecurityEvent, canAccessResident, collectJson, normalizeBirthCertificate, normalizeDeathCertificate, normalizeState, prependAuditTrailEntry, randomUUID, readDatabase, redactSensitiveResponse, refreshBirthStatistics, refreshDeathStatistics, requireApiRole, sendJson, writeDatabase } = runtime;
  return {
      id: "public-health-03",
      domain: "public-health",
      async handle(req, res, url) {
    if (req.method === "GET" && url.pathname === "/api/birth-certificates") {
        const user = requireApiRole(req, res, ["institution", "commission", "citizen"], "/api/birth-certificates");
        if (!user) return true;
        const data = readDatabase();
        const residentId = url.searchParams.get("residentId");
        if (!canAccessResident(user, residentId, data)) {
          appendSecurityEvent({ actor: user.name, role: user.role, action: "访问出生医学证明", target: residentId || "all", result: "拒绝", detail: "超出居民授权范围" });
          sendJson(res, 403, { error: "Forbidden", message: "无权访问该居民出生医学证明" });
          return true;
        }
        const certificates = (data.birthCertificates || []).filter((item) => !residentId || item.maternalResidentId === residentId || item.residentId === residentId);
        sendJson(res, 200, redactSensitiveResponse({ certificates, statistics: data.birthStatistics, forms: data.birthCertificateForms }, user));
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/birth-certificates") {
        const user = requireApiRole(req, res, ["institution", "commission"], "/api/birth-certificates");
        if (!user) return true;
        const data = readDatabase();
        const payload = await collectJson(req);
        let certificate;
        try {
          certificate = normalizeBirthCertificate(payload, user, data);
        } catch (error) {
          sendJson(res, 400, { error: "Bad Request", message: error.message });
          return true;
        }
        if (!canAccessResident(user, certificate.maternalResidentId, data)) {
          appendSecurityEvent({ actor: user.name, role: user.role, action: "登记出生医学证明", target: certificate.maternalResidentId, result: "拒绝", detail: "超出居民授权范围" });
          sendJson(res, 403, { error: "Forbidden", message: "无权登记该居民出生医学证明" });
          return true;
        }
        data.birthCertificates = [certificate, ...(Array.isArray(data.birthCertificates) ? data.birthCertificates : [])].slice(0, 200);
        refreshBirthStatistics(data);
        data.securityEvents = prependAuditTrailEntry(data.securityEvents, {
          id: randomUUID(),
          at: new Date().toLocaleString("zh-CN", { hour12: false }),
          actor: user.name,
          role: user.role,
          action: "登记出生医学证明",
          target: certificate.certificateNo,
          result: "允许",
          detail: `${certificate.newbornName} · ${certificate.issueType} · ${certificate.issuingInstitution}`
        });
        const normalized = normalizeState(data);
        if (Object.hasOwn(payload, "expectedVersion")) {
          normalized.storageMeta = {
            collectionVersions: { birthCertificates: Number(payload.expectedVersion) }
          };
        }
        writeDatabase(normalized);
        sendJson(res, 201, certificate);
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/death-certificates") {
        const user = requireApiRole(req, res, ["institution", "commission"], "/api/death-certificates");
        if (!user) return true;
        const data = readDatabase();
        const residentId = url.searchParams.get("residentId");
        if (!canAccessResident(user, residentId, data)) {
          appendSecurityEvent({ actor: user.name, role: user.role, action: "访问死亡医学证明", target: residentId || "all", result: "拒绝", detail: "超出居民授权范围" });
          sendJson(res, 403, { error: "Forbidden", message: "无权访问该居民死亡证明" });
          return true;
        }
        const certificates = (data.deathCertificates || []).filter((item) => !residentId || item.residentId === residentId);
        sendJson(res, 200, redactSensitiveResponse({ certificates, statistics: data.deathStatistics, forms: data.deathCertificateForms }, user));
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/death-certificates") {
        const user = requireApiRole(req, res, ["institution", "commission"], "/api/death-certificates");
        if (!user) return true;
        const data = readDatabase();
        const payload = await collectJson(req);
        let certificate;
        try {
          certificate = normalizeDeathCertificate(payload, user, data);
        } catch (error) {
          sendJson(res, 400, { error: "Bad Request", message: error.message });
          return true;
        }
        if (!canAccessResident(user, certificate.residentId, data)) {
          appendSecurityEvent({ actor: user.name, role: user.role, action: "登记死亡医学证明", target: certificate.residentId, result: "拒绝", detail: "超出居民授权范围" });
          sendJson(res, 403, { error: "Forbidden", message: "无权登记该居民死亡证明" });
          return true;
        }
        data.deathCertificates = [certificate, ...(Array.isArray(data.deathCertificates) ? data.deathCertificates : [])].slice(0, 200);
        refreshDeathStatistics(data);
        data.securityEvents = prependAuditTrailEntry(data.securityEvents, {
          id: randomUUID(),
          at: new Date().toLocaleString("zh-CN", { hour12: false }),
          actor: user.name,
          role: user.role,
          action: "登记死亡医学证明",
          target: certificate.certificateNo,
          result: "允许",
          detail: `${certificate.deceasedName} · ${certificate.deathReasonType} · ${certificate.reportChannel}`
        });
        const normalized = normalizeState(data);
        if (Object.hasOwn(payload, "expectedVersion")) {
          normalized.storageMeta = {
            collectionVersions: { deathCertificates: Number(payload.expectedVersion) }
          };
        }
        writeDatabase(normalized);
        sendJson(res, 201, certificate);
        return true;
      }
        return false;
      }
    };
}

module.exports = { createRouteSegment, ROUTE_SEGMENT_ID: "public-health-03", SUBDOMAIN: "vital-records" };
