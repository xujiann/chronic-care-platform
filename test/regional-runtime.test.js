"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { loadRegionalRuntime } = require("../src/platform/regional/regional-runtime");
const { createPlatformRuntimeContexts, CONTEXT_DEFINITIONS } = require("../src/http/runtime-contexts");

const ROOT = path.resolve(__dirname, "..");

test("generic region runtime is the platform-safe default with no executable extensions", () => {
  const runtime = loadRegionalRuntime({ root: ROOT });
  assert.equal(runtime.context.regionCode, "template");
  assert.equal(runtime.context.deploymentClass, "template");
  assert.equal(runtime.context.productionReady, false);
  assert.equal(runtime.extensions.length, 0);
  assert.equal(runtime.context.isFeatureEnabled("regional.integration"), false);
  assert.equal(runtime.publicContext.organizations.centralHospital.name, "区域中心医院");
  assert.equal("configs" in runtime.publicContext, false);
  assert.equal(Object.isFrozen(runtime.context), true);
});

test("Dalian runtime activates five typed extensions without enabling production integration", () => {
  const runtime = loadRegionalRuntime({ root: ROOT, regionCode: "210200" });
  assert.deepEqual(runtime.extensions.map((item) => item.kind).sort(), [
    "adapter", "dictionary", "policy", "ui", "workflow"
  ]);
  assert.equal(runtime.resolveExtension("regional-health-exchange").productionEnabled, false);
  assert.equal(runtime.context.deploymentClass, "production");
  assert.equal(runtime.publicContext.organizations.healthAuthority.name, "大连市卫生健康委员会");
  assert.equal(runtime.forDomain("integration").extensions.length, 1);
  assert.equal(runtime.forDomain("public-health").extensions.length, 0);
  assert.throws(() => runtime.resolveExtension("missing"), /unknown active/);
});

test("second region fixture proves configuration variance without production eligibility", () => {
  const runtime = loadRegionalRuntime({ root: ROOT, regionCode: "990001" });
  assert.equal(runtime.context.deploymentClass, "test");
  assert.equal(runtime.values.organization("centralHospital").name, "第二地区中心医院");
  assert.equal(runtime.values.localizeString("区域中心医院"), "第二地区中心医院");
  assert.equal(runtime.values.term("platformName"), "第二地区卫生健康信息平台");
  assert.equal(runtime.extensions.length, 0);
  assert.equal(runtime.publicContext.productionReady, false);
});

test("platform composition exposes regional context separately from least-privilege domain capabilities", () => {
  const dependencyNames = [...new Set(Object.values(CONTEXT_DEFINITIONS).flatMap((item) => item.dependencies))];
  const source = Object.fromEntries(dependencyNames.map((name) => [name, Symbol(name)]));
  const regionalRuntime = loadRegionalRuntime({ root: ROOT, regionCode: "210200" });
  const platform = createPlatformRuntimeContexts(source, { regionalRuntime });
  assert.equal(platform.regional.regionCode, "210200");
  assert.equal("regional" in platform.forDomain("integration"), false);
  assert.equal(platform.forRegionalDomain("integration").extensions[0].id, "regional-health-exchange");
  assert.equal(platform.forRegionalDomain("public-health").extensions.length, 0);
});
