"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

test("platform audit governance center is published in the hierarchical left navigation", () => {
  const html = read("audit-governance.html");
  const client = read("audit-governance.js");
  const policy = require("../access-control-policy");
  const publication = require("../config/static-publication.json");

  assert.match(html, /平台审计治理中心/);
  assert.match(html, /完整性/);
  assert.match(html, /data-roles="commission"/);
  assert.match(html, /<script[^>]+browser-safe-url\.js[^>]*><\/script>[\s\S]*<script[^>]+auth\.js/);
  assert.match(html, /shared\.js/);
  assert.match(client, /\/api\/security\/audit-governance\/center/);
  assert.match(client, /viewRawEvents: false/);
  assert.match(client, /exportRawEvents: false/);
  assert.match(client, /repairAuditChain: false/);
  assert.match(client, /activateDeliveryWorker: false/);
  assert.match(client, /productionActivation: false/);
  assert.doesNotMatch(client, /innerHTML|insertAdjacentHTML|document\.write|\.style\b|window\.prompt|\beval\s*\(/);
  assert.match(client, /createElement/);
  assert.match(client, /textContent/);
  assert.equal(policy.pageCatalog["audit-governance.html"].group, "平台治理");
  assert.equal(policy.pageCatalog["audit-governance.html"].parent, "platform.html");
  assert.deepEqual(policy.pageCatalog["audit-governance.html"].roles, ["commission"]);
  assert.deepEqual(policy.pageCatalog["audit-governance.html"].accountTypes, ["manager"]);
  assert.equal(publication.entrypoints.includes("audit-governance.html"), true);
});

test("platform audit governance capability has repository and procurement trace evidence", () => {
  const registry = require("../config/platform-capability-registry.json");
  const trace = require("../config/procurement-requirement-trace-catalog.json");
  const capability = registry.capabilities.find((item) => item.id === "L-GOV-AUDIT");
  const mapping = trace.capabilities.find((item) => item.capabilityId === "L-GOV-AUDIT");

  assert.equal(capability.ownerProcess, "T01");
  assert.equal(capability.coverage, "repository-verified");
  assert.equal(capability.evidence.length >= 10, true);
  assert.equal(capability.evidence.every((relative) => fs.existsSync(path.join(ROOT, relative))), true);
  assert.deepEqual(mapping.pages, ["audit-governance.html"]);
  assert.equal(mapping.interfaces.includes("GET /api/security/audit-governance/center"), true);
  assert.equal(mapping.interfaces.includes("GET /api/audit/verify"), true);
  assert.equal(mapping.tests.includes("test/audit-governance-ui.test.js"), true);
});

test("platform audit governance browser surface stays neutral, minimized and production restricted", () => {
  const surface = [read("audit-governance.html"), read("audit-governance.js"), read("audit-governance.css")].join("\n");
  assert.doesNotMatch(surface, /大连|Dalian|中山区|青泥洼桥|松江|上海|Songjiang|Shanghai/);
  assert.match(surface, /NO-GO/);
  assert.match(surface, /不展示人员、患者、机构、访问目标、用途或事件正文/);
  assert.match(surface, /不得修复、重封、删除或导出原始审计记录/);
});
