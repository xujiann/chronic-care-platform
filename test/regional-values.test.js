"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { loadRegionalRuntime } = require("../src/platform/regional/regional-runtime");

const ROOT = path.resolve(__dirname, "..");

test("generic regional values replace legacy Dalian deployment labels without changing object keys", () => {
  const runtime = loadRegionalRuntime({ root: ROOT, regionCode: "template" });
  assert.equal(runtime.values.organization("centralHospital").name, "区域中心医院");
  assert.equal(runtime.values.area("primaryDistrict").name, "示范一区");
  assert.equal(runtime.values.term("platformName"), "区域卫生健康信息平台");
  assert.equal(runtime.values.localizeString("Dalian Central Hospital outpatient clinic"), "区域中心医院 outpatient clinic");
  const localized = runtime.values.localize({
    dalianHealthStatistics2025: {
      owner: "大连市卫生健康委",
      institution: "大连市中心医院"
    }
  });
  assert.deepEqual(Object.keys(localized), ["dalianHealthStatistics2025"]);
  assert.equal(localized.dalianHealthStatistics2025.owner, "地区卫生健康主管部门");
  assert.equal(localized.dalianHealthStatistics2025.institution, "区域中心医院");
});

test("Dalian regional values resolve the same business roles to Dalian organizations", () => {
  const runtime = loadRegionalRuntime({ root: ROOT, regionCode: "210200" });
  assert.equal(runtime.values.organization("centralHospital").code, "MR1");
  assert.equal(runtime.values.organization("insuranceAuthority").name, "大连市医疗保障局");
  assert.equal(runtime.values.area("primaryDistrict").code, "210202");
  assert.equal(runtime.values.localizeString("Dalian Central Hospital"), "大连市中心医院");
  assert.equal(runtime.values.publicContext.productionReady, false);
  assert.throws(() => runtime.values.organization("missing"), /unknown regional organization/);
  assert.throws(() => runtime.values.term("missing"), /unknown regional term/);
});

test("regional values reject over-deep payloads", () => {
  const runtime = loadRegionalRuntime({ root: ROOT });
  let payload = "大连市中心医院";
  for (let index = 0; index < 26; index += 1) payload = { nested: payload };
  assert.throws(() => runtime.values.localize(payload), /too deeply nested/);
});
