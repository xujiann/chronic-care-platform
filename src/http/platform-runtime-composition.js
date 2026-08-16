"use strict";

const { createPlatformApiRouter } = require("./routes");
const {
  createPlatformCapabilityProviders,
  createPlatformRuntimeContexts
} = require("./runtime-contexts");

function createPlatformRuntimeComposition(options = {}) {
  if (!options.source || typeof options.source !== "object") {
    throw new TypeError("platform runtime composition requires a capability source");
  }
  const createProviders = options.createProviders || createPlatformCapabilityProviders;
  const createContexts = options.createContexts || createPlatformRuntimeContexts;
  const createRouter = options.createRouter || createPlatformApiRouter;
  const providers = createProviders(options.source);
  const contexts = createContexts(providers, { regionalRuntime: options.regionalRuntime || null });
  const apiRouter = createRouter(contexts);
  if (!apiRouter || typeof apiRouter.handle !== "function" || !Array.isArray(apiRouter.manifest)) {
    throw new TypeError("platform runtime composition produced an invalid API router");
  }
  return Object.freeze({
    schemaVersion: "platform-runtime-composition-v1",
    providers,
    contexts,
    apiRouter,
    routeManifest: apiRouter.manifest,
    productionReady: false
  });
}

module.exports = { createPlatformRuntimeComposition };
