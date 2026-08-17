"use strict";

const fs = require("node:fs");
const path = require("node:path");
const program = require("../../../config/platform-productization-program.json");
const { buildPlatformNonfunctionalReadiness } = require("../governance/platform-nonfunctional-readiness");
const { buildRegionalProductAssembly } = require("../regional/regional-product-assembly");
const { buildPlatformProductizationCenter } = require("./runtime");

const REQUIRED_FILES = Object.freeze([
  "src/platform/productization/data-promotion-center.js",
  "src/platform/productization/work-item-center.js",
  "src/platform/productization/institution-integration-center.js",
  "src/platform/regional/regional-product-assembly.js",
  "src/http/routes/platform-governance/productization-center.js",
  "platform-productization-ui.js"
]);

function validateProgram(value = program) {
  if (value?.schemaVersion !== "platform-productization-program-v1") throw new TypeError("platform productization program is invalid");
  if (!Array.isArray(value.iterations) || value.iterations.length !== 6) throw new TypeError("platform productization program requires six iterations");
  if (new Set(value.iterations.map((item) => item.id)).size !== value.iterations.length) throw new TypeError("platform productization iteration ids must be unique");
  return true;
}

function buildPlatformProductizationReadiness(options = {}) {
  validateProgram(options.program || program);
  const root = path.resolve(options.root || path.join(__dirname, "..", "..", ".."));
  const data = options.data || JSON.parse(fs.readFileSync(path.join(root, "data", "db.json"), "utf8"));
  const center = buildPlatformProductizationCenter(data, { now: options.now });
  const nonfunctional = buildPlatformNonfunctionalReadiness({ root });
  const assembly = buildRegionalProductAssembly({
    root,
    regionCode: options.regionCode || "210200",
    env: options.env || {},
    data,
    now: options.now
  });
  const files = REQUIRED_FILES.map((file) => Object.freeze({ file, present: fs.existsSync(path.join(root, file)) }));
  const iterations = (options.program || program).iterations.map((item) => Object.freeze({
    id: item.id,
    name: item.name,
    priority: item.priority,
    locallyDelivered: true,
    productionReady: false
  }));
  const checks = Object.freeze([
    { id: "productization:sixIterations", passed: iterations.length === 6, detail: `${iterations.length}/6` },
    { id: "productization:requiredFiles", passed: files.every((item) => item.present), detail: `${files.filter((item) => item.present).length}/${files.length}` },
    { id: "productization:p0DataPromotion", passed: center.dataPromotion.localGateReady, detail: `${center.dataPromotion.summary.promotedP0} P0 collections` },
    { id: "productization:workItemProjection", passed: center.workItems.ok, detail: `${center.workItems.summary.total} metadata-only projections` },
    { id: "productization:syntheticIntegration", passed: center.institutionIntegration.ok, detail: `${center.institutionIntegration.summary.adapters} adapters` },
    { id: "productization:regionalAssembly", passed: assembly.ok, detail: assembly.region.code },
    { id: "productization:nonfunctional", passed: nonfunctional.ok, detail: `${nonfunctional.summary.testFiles} tests / ${nonfunctional.summary.routeFiles} routes` },
    { id: "productization:productionFailClosed", passed: center.productionReady === false && assembly.productionReady === false, detail: "NO-GO until site evidence and authorization" }
  ]);
  return Object.freeze({
    schemaVersion: "platform-productization-readiness-v1",
    generatedAt: options.now || new Date().toISOString(),
    ok: checks.every((item) => item.passed),
    localFoundationReady: checks.every((item) => item.passed),
    siteReady: false,
    productionReady: false,
    containsPatientData: false,
    containsCredentials: false,
    summary: Object.freeze({
      iterations: iterations.length,
      promotedP0: center.dataPromotion.summary.promotedP0,
      projectedWorkItems: center.workItems.summary.total,
      institutionAdapters: center.institutionIntegration.summary.adapters,
      regionalBundles: assembly.regionalBundles.length
    }),
    iterations: Object.freeze(iterations),
    files: Object.freeze(files),
    checks,
    blockers: Object.freeze([
      "production-data-migration-rehearsal-pending",
      "real-institution-connectivity-pending",
      "signed-site-evidence-pending",
      "independent-acceptance-pending",
      "production-cutover-authorization-pending"
    ]),
    boundary: "Local productization gates are complete; site readiness and production authorization remain external fail-closed gates."
  });
}

module.exports = { REQUIRED_FILES, buildPlatformProductizationReadiness, validateProgram };
