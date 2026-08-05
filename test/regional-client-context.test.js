"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { loadRegionalRuntime } = require("../src/platform/regional/regional-runtime");

const ROOT = path.resolve(__dirname, "..");
const SOURCE = fs.readFileSync(path.join(ROOT, "regional-context.js"), "utf8");

test("regional browser context loads before authentication on regionalized surfaces", () => {
  const pages = [
    "citizen.html", "disease-payment.html", "doctor.html", "emergency.html",
    "health-city.html", "imaging-cloud.html", "index.html", "institution.html",
    "insurance.html", "internet-nursing.html", "login.html", "physical-examination.html",
    "platform.html", "public-health.html", "workbench.html"
  ];
  pages.forEach((page) => {
    const source = fs.readFileSync(path.join(ROOT, page), "utf8");
    assert.ok(source.indexOf("regional-context.js") >= 0, `${page} must load regional context`);
    assert.ok(source.indexOf("regional-context.js") < source.indexOf("auth.js"), `${page} must load regional context before auth`);
  });
});

function runClient({ protocol = "file:", context } = {}) {
  const window = {
    location: { protocol },
    fetch: context
      ? async () => ({ ok: true, json: async () => structuredClone(context) })
      : undefined
  };
  vm.runInNewContext(SOURCE, {
    window,
    globalThis: window,
    Promise,
    Object,
    Array,
    String,
    Number,
    TypeError
  });
  return window.HealthRegionalContext;
}

test("regional browser client fails safely to the generic template", async () => {
  const client = runClient();
  await client.ready();
  assert.equal(client.current.regionCode, "template");
  assert.equal(client.organization("centralHospital").name, "区域中心医院");
  assert.equal(client.localizeText("大连市中心医院"), "区域中心医院");
});

test("regional browser client hydrates the server-selected Dalian public context", async () => {
  const publicContext = loadRegionalRuntime({ root: ROOT, regionCode: "210200" }).publicContext;
  const client = runClient({ protocol: "https:", context: publicContext });
  await client.ready();
  assert.equal(client.current.regionCode, "210200");
  assert.equal(client.organization("centralHospital").name, "大连市中心医院");
  assert.equal(client.area("primaryDistrict").name, "中山区");
  assert.equal(client.localizeText("Dalian Central Hospital"), "大连市中心医院");
});
