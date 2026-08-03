"use strict";

const ROUTE_SEGMENT_ID = "platform-governance-05";
const SUBDOMAIN = "digital-hospital-readiness";

function createRouteSegment(runtime) {
  const { buildCapabilityMap, buildPlatformBlockerRegister, buildPlatformGoLiveSlices, buildPlatformServiceOrderCenter, buildPlatformStandardsLedgerDetail, buildPlatformStandardsLedgers, buildReleaseArtifactManifest, buildReleaseReport, buildSiteLaunchEvidenceDashboard, buildSiteReadinessPack, buildSiteTemplateReadmes, collectJson, readDatabase, renderCapabilityMapMarkdown, renderPlatformGoLiveSlicesMarkdown, renderPlatformStandardsLedgerDetailMarkdown, renderPlatformStandardsLedgersMarkdown, requireApiRole, sendJson, sendText, upsertSiteLaunchEvidence } = runtime;
  return {
      id: "platform-governance-05",
      domain: "platform-governance",
      async handle(req, res, url) {
    if (req.method === "GET" && url.pathname === "/api/site-readiness-pack") {
        const user = requireApiRole(req, res, ["commission"], "/api/site-readiness-pack");
        if (!user) return true;
        sendJson(res, 200, buildSiteReadinessPack({ data: readDatabase(), env: process.env }));
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/site-template-readmes") {
        const user = requireApiRole(req, res, ["commission"], "/api/site-template-readmes");
        if (!user) return true;
        sendJson(res, 200, buildSiteTemplateReadmes(readDatabase()));
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/site-launch-evidence") {
        const user = requireApiRole(req, res, ["commission"], "/api/site-launch-evidence");
        if (!user) return true;
        sendJson(res, 200, buildSiteLaunchEvidenceDashboard(readDatabase()));
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/site-launch-evidence") {
        const user = requireApiRole(req, res, ["commission"], "/api/site-launch-evidence");
        if (!user) return true;
        try {
          const result = upsertSiteLaunchEvidence(readDatabase(), user, await collectJson(req));
          sendJson(res, result.status, result.body);
        } catch (error) {
          sendJson(res, 400, { error: "Bad Request", message: error.message });
        }
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/release-report") {
        const user = requireApiRole(req, res, ["commission"], "/api/release-report");
        if (!user) return true;
        sendJson(res, 200, buildReleaseReport({ data: readDatabase(), env: process.env, profile: "demo" }));
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/production-cutover-checklist") {
        const user = requireApiRole(req, res, ["commission"], "/api/production-cutover-checklist");
        if (!user) return true;
        const releaseReport = buildReleaseReport({ data: readDatabase(), env: process.env, profile: "demo" });
        sendJson(res, 200, {
          ok: releaseReport.productionCutover.every((item) => item.passed),
          generatedAt: releaseReport.generatedAt,
          profile: releaseReport.profile,
          summary: {
            total: releaseReport.productionCutover.length,
            passed: releaseReport.productionCutover.filter((item) => item.passed).length,
            blocked: releaseReport.productionCutover.filter((item) => !item.passed).length
          },
          checklist: releaseReport.productionCutover
        });
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/release-artifact-manifest") {
        const user = requireApiRole(req, res, ["commission"], "/api/release-artifact-manifest");
        if (!user) return true;
        const releaseReport = buildReleaseReport({ data: readDatabase(), env: process.env, profile: "demo" });
        sendJson(res, 200, buildReleaseArtifactManifest({ releaseReport }));
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/platform/capability-map") {
        const user = requireApiRole(req, res, ["commission"], "/api/platform/capability-map");
        if (!user) return true;
        const data = readDatabase();
        const releaseReport = buildReleaseReport({ data, env: process.env, profile: "demo" });
        const manifest = buildReleaseArtifactManifest({ releaseReport });
        const capabilityMap = buildCapabilityMap({ data, manifest });
        if (url.searchParams.get("format") === "markdown") {
          sendText(res, 200, renderCapabilityMapMarkdown(capabilityMap), "text/markdown; charset=utf-8");
          return true;
        }
        sendJson(res, 200, capabilityMap);
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/platform/blocker-register") {
        const user = requireApiRole(req, res, ["commission"], "/api/platform/blocker-register");
        if (!user) return true;
        const data = readDatabase();
        const releaseReport = buildReleaseReport({ data, env: process.env, profile: "demo" });
        const manifest = buildReleaseArtifactManifest({ releaseReport });
        const capabilityMap = buildCapabilityMap({ data, manifest });
        sendJson(res, 200, buildPlatformBlockerRegister(data, capabilityMap));
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/platform/service-order-center") {
        const user = requireApiRole(req, res, ["commission"], "/api/platform/service-order-center");
        if (!user) return true;
        const data = readDatabase();
        sendJson(res, 200, buildPlatformServiceOrderCenter(data));
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/platform/go-live-slices") {
        const user = requireApiRole(req, res, ["commission"], "/api/platform/go-live-slices");
        if (!user) return true;
        const data = readDatabase();
        const releaseReport = buildReleaseReport({ data, env: process.env, profile: "demo" });
        const manifest = buildReleaseArtifactManifest({ releaseReport });
        const capabilityMap = buildCapabilityMap({ data, manifest });
        const goLiveSlices = buildPlatformGoLiveSlices(data, capabilityMap);
        if (url.searchParams.get("format") === "markdown") {
          sendText(res, 200, renderPlatformGoLiveSlicesMarkdown(goLiveSlices), "text/markdown; charset=utf-8");
          return true;
        }
        sendJson(res, 200, goLiveSlices);
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/platform/standards-ledgers") {
        const user = requireApiRole(req, res, ["commission"], "/api/platform/standards-ledgers");
        if (!user) return true;
        const data = readDatabase();
        const releaseReport = buildReleaseReport({ data, env: process.env, profile: "demo", skipPlatformStandardsLedgers: true });
        const manifest = buildReleaseArtifactManifest({ releaseReport });
        const standardsLedgers = buildPlatformStandardsLedgers(data, { manifest });
        if (url.searchParams.get("format") === "markdown") {
          sendText(res, 200, renderPlatformStandardsLedgersMarkdown(standardsLedgers), "text/markdown; charset=utf-8");
          return true;
        }
        sendJson(res, 200, standardsLedgers);
        return true;
      }

      const platformStandardsLedgerDetailMatch = url.pathname.match(/^\/api\/platform\/standards-ledgers\/([^/]+)$/);
      if (req.method === "GET" && platformStandardsLedgerDetailMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/platform/standards-ledgers/:id");
        if (!user) return true;
        const data = readDatabase();
        const ledgerId = decodeURIComponent(platformStandardsLedgerDetailMatch[1]);
        const detail = buildPlatformStandardsLedgerDetail(data, ledgerId, {
          query: url.searchParams.get("q") || "",
          status: url.searchParams.get("status") || "",
          collection: url.searchParams.get("collection") || ""
        });
        if (!detail) {
          sendJson(res, 404, { error: "Not Found", message: "Platform standards ledger not found" });
          return true;
        }
        if (url.searchParams.get("format") === "markdown") {
          sendText(res, 200, renderPlatformStandardsLedgerDetailMarkdown(detail), "text/markdown; charset=utf-8");
          return true;
        }
        sendJson(res, 200, detail);
        return true;
      }
        return false;
      }
    };
}

module.exports = { ROUTE_SEGMENT_ID, SUBDOMAIN, createRouteSegment };
