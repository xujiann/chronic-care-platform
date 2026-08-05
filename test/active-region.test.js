"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const {
  getActiveRegionalRuntime,
  regionalOrganization,
  resetActiveRegionalRuntime
} = require("../src/platform/regional/active-region");

const ROOT = path.resolve(__dirname, "..");

test("active region follows deployment selection and can return to the registry default", () => {
  resetActiveRegionalRuntime();
  const generic = getActiveRegionalRuntime({ root: ROOT, env: {}, reload: true });
  assert.equal(generic.context.regionCode, "template");
  assert.equal(regionalOrganization("centralHospital").name, "区域中心医院");

  const dalian = getActiveRegionalRuntime({ root: ROOT, regionCode: "210200" });
  assert.equal(dalian.values.area("primaryDistrict").name, "中山区");
  assert.equal(regionalOrganization("centralHospital", { root: ROOT, regionCode: "210200" }).name, "大连市中心医院");

  const restored = getActiveRegionalRuntime({ root: ROOT, env: {} });
  assert.equal(restored.context.regionCode, "template");
  assert.equal(regionalOrganization("centralHospital").name, "区域中心医院");
});
