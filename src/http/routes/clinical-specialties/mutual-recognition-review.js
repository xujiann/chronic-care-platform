"use strict";

function createRouteSegment(runtime) {
  const { collectJson, prependAuditTrailEntry, randomUUID, readDatabase, requireApiRole, reviewMutualRecognitionRecord, sendJson, writeDatabase } = runtime;
  return {
      id: "clinical-specialties-08",
      domain: "clinical-specialties",
      async handle(req, res, url) {
    const mutualRecognitionReviewMatch = url.pathname.match(/^\/api\/mutual-recognition\/records\/([^/]+)\/review$/);
      if (req.method === "POST" && mutualRecognitionReviewMatch) {
        const user = requireApiRole(req, res, ["county", "commission"], "/api/mutual-recognition/records/:id/review");
        if (!user) return true;
        const data = readDatabase();
        const payload = await collectJson(req);
        let reviewed;
        try {
          reviewed = reviewMutualRecognitionRecord(data, decodeURIComponent(mutualRecognitionReviewMatch[1]), payload, user);
        } catch (error) {
          sendJson(res, 400, { error: "Bad Request", message: error.message });
          return true;
        }
        if (!reviewed) {
          sendJson(res, 404, { error: "Not Found", message: "未找到互认记录" });
          return true;
        }
        data.securityEvents = prependAuditTrailEntry(data.securityEvents, {
          id: randomUUID(),
          at: new Date().toLocaleString("zh-CN", { hour12: false }),
          actor: user.name,
          role: user.role,
          action: "review mutual recognition",
          target: reviewed.id,
          result: "allowed",
          detail: `${reviewed.reviewStatus} · ${reviewed.reviewReasonCode}`
        });
        writeDatabase(data);
        sendJson(res, 200, reviewed);
        return true;
      }
        return false;
      }
    };
}

module.exports = { createRouteSegment, ROUTE_SEGMENT_ID: "clinical-specialties-08", SUBDOMAIN: "mutual-recognition-review" };
