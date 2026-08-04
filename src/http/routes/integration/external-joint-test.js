"use strict";

const {
  buildExternalJointTestCampaign,
  evaluateExternalJointTestCampaign
} = require("../../../platform/integration/external-joint-test-campaign");

function createRouteSegments(runtime) {
  const {
    collectJson,
    requireApiRole,
    sendJson
  } = runtime;
  return [{
    id: "integration-04",
    domain: "integration",
    async handle(req, res, url) {
      if (req.method === "GET" && url.pathname === "/api/integration/joint-test-campaign") {
        const user = requireApiRole(
          req,
          res,
          ["commission", "institution"],
          "/api/integration/joint-test-campaign"
        );
        if (!user) return true;
        sendJson(res, 200, buildExternalJointTestCampaign());
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/integration/joint-test-campaign/evaluate") {
        const user = requireApiRole(
          req,
          res,
          ["commission"],
          "/api/integration/joint-test-campaign/evaluate"
        );
        if (!user) return true;
        const body = await collectJson(req);
        try {
          sendJson(res, 200, evaluateExternalJointTestCampaign({
            evidenceBundle: body.evidenceBundle,
            trustRegistry: body.trustRegistry
          }));
        } catch (error) {
          sendJson(res, Number(error.statusCode || 400), {
            error: "Bad Request",
            code: String(error.code || "EXTERNAL_JOINT_TEST_EVALUATION_FAILED"),
            message: String(error.message || "external joint-test evidence evaluation failed")
          });
        }
        return true;
      }
      return false;
    }
  }];
}

module.exports = { createRouteSegments };
