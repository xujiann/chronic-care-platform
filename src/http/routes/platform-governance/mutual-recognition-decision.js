"use strict";

const ROUTE_SEGMENT_ID = "platform-governance-10";
const SUBDOMAIN = "mutual-recognition-decision";

function createRouteSegment(runtime) {
  const { buildPhase2MutualRecognitionOverview, collectJson, randomUUID, readDatabase, requireApiRole, reviewMutualRecognitionRecord, sendJson, upsertPhase2MutualRecognitionCitation, writeDatabase } = runtime;
  return {
      id: "platform-governance-10",
      domain: "platform-governance",
      async handle(req, res, url) {
    const phase2MutualRecognitionDecisionMatch = url.pathname.match(/^\/api\/phase2\/mutual-recognition\/records\/([^/]+)\/decision$/);
      if (req.method === "POST" && phase2MutualRecognitionDecisionMatch) {
        const user = requireApiRole(req, res, ["county", "commission"], "/api/phase2/mutual-recognition/records/:id/decision");
        if (!user) return true;
        const data = readDatabase();
        const payload = await collectJson(req);
        let reviewed;
        try {
          reviewed = reviewMutualRecognitionRecord(data, decodeURIComponent(phase2MutualRecognitionDecisionMatch[1]), payload, user);
        } catch (error) {
          sendJson(res, 400, { error: "Bad Request", message: error.message });
          return true;
        }
        if (!reviewed) {
          sendJson(res, 404, { error: "Not Found", message: "未找到互认记录" });
          return true;
        }
        const citation = upsertPhase2MutualRecognitionCitation(data, reviewed, payload, user);
        data.securityEvents = [
          {
            id: randomUUID(),
            at: new Date().toLocaleString("zh-CN", { hour12: false }),
            actor: user.name,
            role: user.role,
            action: "phase2-mutual-recognition-decision",
            target: reviewed.id,
            result: "allowed",
            detail: `${reviewed.reviewStatus} · ${reviewed.reviewReasonCode} · ${citation?.evidenceHash || "no-citation"}`
          },
          ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
        ].slice(0, 120);
        writeDatabase(data);
        sendJson(res, 200, { record: reviewed, citation, overview: buildPhase2MutualRecognitionOverview(data) });
        return true;
      }
        return false;
      }
    };
}

module.exports = { ROUTE_SEGMENT_ID, SUBDOMAIN, createRouteSegment };
