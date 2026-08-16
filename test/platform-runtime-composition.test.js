"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createPlatformRuntimeComposition } = require("../src/http/platform-runtime-composition");
const { createPlatformRequestHandler } = require("../src/http/platform-request-handler");

test("runtime composition builds providers contexts and one immutable router", () => {
  const calls = [];
  const router = { manifest: [{ id: "runtime-01", domain: "runtime" }], handle: async () => true };
  const composition = createPlatformRuntimeComposition({
    source: { dependency: true },
    regionalRuntime: { publicContext: {} },
    createProviders: (source) => (calls.push(["providers", source]), { source }),
    createContexts: (providers, options) => (calls.push(["contexts", providers, options]), { providers }),
    createRouter: (contexts) => (calls.push(["router", contexts]), router)
  });
  assert.equal(composition.apiRouter, router);
  assert.deepEqual(composition.routeManifest, router.manifest);
  assert.equal(Object.isFrozen(composition), true);
  assert.deepEqual(calls.map((item) => item[0]), ["providers", "contexts", "router"]);
});

test("request handler centralizes API session failure and static dispatch", async () => {
  const dependencies = [];
  const responses = [];
  const staticRequests = [];
  const finish = [];
  const base = {
    observability: {
      run: async (_req, _res, work) => work(),
      recordDependency: (name, state) => dependencies.push({ name, state })
    },
    hydrateRequestSession: async () => {},
    handleApi: async (_req, res) => { res.api = true; },
    serveStatic: (req) => staticRequests.push(req.url),
    recordRequestMetrics: () => {},
    sendJson: (_res, status, body) => responses.push({ status, body }),
    handleError: (_req, _res, error) => { throw error; },
    logger: { error: () => {} }
  };
  const response = { on: (name, handler) => finish.push({ name, handler }) };
  await createPlatformRequestHandler(base)({ url: "/api/health" }, response);
  assert.equal(response.api, true);
  assert.equal(dependencies[0].state.ok, true);
  await createPlatformRequestHandler(base)({ url: "/index.html" }, response);
  assert.deepEqual(staticRequests, ["/index.html"]);

  const failed = createPlatformRequestHandler({ ...base, hydrateRequestSession: async () => { throw new Error("offline"); } });
  await failed({ url: "/api/health" }, response);
  assert.equal(responses[0].status, 503);
  assert.equal(responses[0].body.code, "SESSION_STORE_UNAVAILABLE");
});
