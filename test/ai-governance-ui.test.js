"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

test("platform AI governance center is published in the hierarchical left navigation", () => {
  const html = read("ai-governance.html");
  const client = read("ai-governance.js");
  const policy = require("../access-control-policy");
  const publication = require("../config/static-publication.json");

  assert.match(html, /平台人工智能治理中心/);
  assert.match(html, /场景清单/);
  assert.match(html, /data-roles="commission"/);
  assert.match(html, /<script[^>]+browser-safe-url\.js[^>]*><\/script>[\s\S]*<script[^>]+auth\.js/);
  assert.match(html, /shared\.js/);
  assert.match(client, /\/api\/runtime\/ai-governance\/center/);
  assert.match(client, /automaticDiagnosis: false/);
  assert.match(client, /automaticPublicHealthDecision: false/);
  assert.match(client, /productionActivation: false/);
  assert.doesNotMatch(client, /innerHTML|insertAdjacentHTML|document\.write|\.style\b|window\.prompt|\beval\s*\(/);
  assert.match(client, /createElement/);
  assert.match(client, /textContent/);
  assert.equal(policy.pageCatalog["ai-governance.html"].group, "平台治理");
  assert.equal(policy.pageCatalog["ai-governance.html"].parent, "platform.html");
  assert.deepEqual(policy.pageCatalog["ai-governance.html"].roles, ["commission"]);
  assert.deepEqual(policy.pageCatalog["ai-governance.html"].accountTypes, ["manager"]);
  assert.equal(publication.entrypoints.includes("ai-governance.html"), true);
});

test("platform AI governance capability has repository and procurement trace evidence", () => {
  const registry = require("../config/platform-capability-registry.json");
  const trace = require("../config/procurement-requirement-trace-catalog.json");
  const capability = registry.capabilities.find((item) => item.id === "L-GOV-AI");
  const mapping = trace.capabilities.find((item) => item.capabilityId === "L-GOV-AI");

  assert.equal(capability.ownerProcess, "T01");
  assert.equal(capability.coverage, "repository-verified");
  assert.equal(capability.evidence.length >= 8, true);
  assert.equal(capability.evidence.every((relative) => fs.existsSync(path.join(ROOT, relative))), true);
  assert.deepEqual(mapping.pages, ["ai-governance.html"]);
  assert.equal(mapping.interfaces.includes("GET /api/runtime/ai-governance/center"), true);
  assert.equal(mapping.interfaces.includes("GET /api/quality-safety/ai-cdss/center"), true);
  assert.equal(mapping.tests.includes("test/ai-governance-ui.test.js"), true);
});

test("platform AI governance browser surface stays region neutral and production restricted", () => {
  const surface = [read("ai-governance.html"), read("ai-governance.js"), read("ai-governance.css")].join("\n");
  assert.doesNotMatch(surface, /大连|Dalian|中山区|青泥洼桥|松江|上海|Songjiang|Shanghai/);
  assert.match(surface, /NO-GO/);
  assert.match(surface, /不得自动形成诊断/);
  assert.match(surface, /不展示居民、机构或临床明细/);
});
