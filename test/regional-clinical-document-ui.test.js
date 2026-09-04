"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

test("regional clinical document center is registered and uses trusted DOM rendering", () => {
  const html = read("regional-clinical-documents.html");
  const client = read("regional-clinical-documents.js");
  const policy = require("../access-control-policy");
  const publication = require("../config/static-publication.json");

  assert.match(html, /区域医疗文书中心/);
  assert.match(html, /电子病历卡与电子出院小结/);
  assert.match(html, /page-auth-bootstrap\.js/);
  assert.match(html, /data-roles="commission,institution"/);
  assert.match(client, /\/api\/integration\/clinical-documents\/center/);
  assert.match(client, /\/api\/integration\/events\/\$\{encodeURIComponent\(id\)\}\/retry/);
  assert.match(client, /\/api\/attachments\/\$\{encodeURIComponent\(item\.pdf\.attachmentId\)\}\/download-intent/);
  assert.match(client, /HealthBrowserSafeUrl\.navigate/);
  assert.doesNotMatch(client, /innerHTML|insertAdjacentHTML|document\.write|\.style\b|window\.prompt|\beval\s*\(/);
  assert.match(client, /createElement/);
  assert.match(client, /textContent/);
  assert.equal(policy.pageCatalog["regional-clinical-documents.html"].group, "平台治理");
  assert.equal(policy.pageCatalog["regional-clinical-documents.html"].parent, "regional-data-sharing.html");
  assert.deepEqual(policy.pageCatalog["regional-clinical-documents.html"].roles, ["commission", "institution"]);
  assert.equal(publication.entrypoints.includes("regional-clinical-documents.html"), true);
});

test("regional clinical document capability carries repository and procurement trace evidence", () => {
  const registry = require("../config/platform-capability-registry.json");
  const trace = require("../config/procurement-requirement-trace-catalog.json");
  const capability = registry.capabilities.find((item) => item.id === "D-INT-DOC");
  const mapping = trace.capabilities.find((item) => item.capabilityId === "D-INT-DOC");
  assert.equal(capability.coverage, "repository-verified");
  assert.equal(capability.evidence.length >= 6, true);
  assert.equal(capability.evidence.every((relative) => fs.existsSync(path.join(ROOT, relative))), true);
  assert.deepEqual(mapping.pages, ["regional-clinical-documents.html"]);
  assert.equal(mapping.interfaces.includes("GET /api/integration/clinical-documents/center"), true);
  assert.equal(mapping.interfaces.includes("POST /api/attachments/:id/download-intent"), true);
  assert.equal(mapping.tests.includes("test/regional-clinical-document-ui.test.js"), true);
});

test("regional clinical document browser surface remains region neutral", () => {
  const surface = [
    read("regional-clinical-documents.html"),
    read("regional-clinical-documents.js"),
    read("regional-clinical-documents.css")
  ].join("\n");
  assert.doesNotMatch(surface, /大连|Dalian|中山区|青泥洼桥|松江|上海/);
});
