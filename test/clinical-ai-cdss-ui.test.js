"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

test("clinical AI CDSS center is published in the left navigation with trusted DOM rendering", () => {
  const html = read("clinical-ai-cdss.html");
  const client = read("clinical-ai-cdss.js");
  const policy = require("../access-control-policy");
  const publication = require("../config/static-publication.json");

  assert.match(html, /临床决策支持安全治理中心/);
  assert.match(
    html,
    /<script[^>]+browser-safe-url\.js[^>]*><\/script>[\s\S]*<script[^>]+auth\.js/,
    "safe URL policy must load before the shared authorization runtime"
  );
  assert.match(html, /规则\/模型卡/);
  assert.match(html, /data-roles="commission,institution"/);
  assert.match(html, /shared\.js/);
  assert.match(client, /\/api\/quality-safety\/ai-cdss\/center/);
  assert.match(client, /automaticDiagnosis: false/);
  assert.match(client, /automaticOrder: false/);
  assert.match(client, /automaticPrescription: false/);
  assert.doesNotMatch(client, /innerHTML|insertAdjacentHTML|document\.write|\.style\b|window\.prompt|\beval\s*\(/);
  assert.match(client, /createElement/);
  assert.match(client, /textContent/);
  assert.equal(policy.pageCatalog["clinical-ai-cdss.html"].group, "监管治理");
  assert.equal(policy.pageCatalog["clinical-ai-cdss.html"].parent, "quality-safety.html");
  assert.deepEqual(policy.pageCatalog["clinical-ai-cdss.html"].roles, ["commission", "institution"]);
  assert.equal(publication.entrypoints.includes("clinical-ai-cdss.html"), true);
});

test("clinical decision support capability carries repository and procurement trace evidence", () => {
  const registry = require("../config/platform-capability-registry.json");
  const trace = require("../config/procurement-requirement-trace-catalog.json");
  const capability = registry.capabilities.find((item) => item.id === "J-CLIN-CDSS");
  const upstream = registry.capabilities.find((item) => item.id === "L-GOV-AI");
  const mapping = trace.capabilities.find((item) => item.capabilityId === "J-CLIN-CDSS");

  assert.equal(capability.coverage, "repository-verified");
  assert.equal(capability.evidence.length >= 7, true);
  assert.equal(capability.evidence.every((relative) => fs.existsSync(path.join(ROOT, relative))), true);
  assert.equal(upstream.coverage, "declared-only");
  assert.deepEqual(mapping.pages, ["clinical-ai-cdss.html"]);
  assert.equal(mapping.interfaces.includes("GET /api/quality-safety/ai-cdss/center"), true);
  assert.equal(mapping.interfaces.includes("POST /api/phase2/clinical-assist/alerts/:id/receipt"), true);
  assert.equal(mapping.tests.includes("test/clinical-ai-cdss-ui.test.js"), true);
});

test("clinical AI CDSS browser surface remains region neutral and production restricted", () => {
  const surface = [
    read("clinical-ai-cdss.html"),
    read("clinical-ai-cdss.js"),
    read("clinical-ai-cdss.css")
  ].join("\n");
  assert.doesNotMatch(surface, /大连|Dalian|中山区|青泥洼桥|松江|上海|Songjiang|Shanghai/);
  assert.match(surface, /NO-GO/);
  assert.match(surface, /不得自动形成诊断结论/);
});
