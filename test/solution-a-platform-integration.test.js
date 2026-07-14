const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

test("solution A is wired into the authenticated imaging cloud API", () => {
  const server = read("server.js");
  assert.match(server, /solutionAHealth/);
  assert.match(server, /\/api\/imaging-cloud\/solution-a\/health/);
  assert.match(server, /\/api\/imaging-cloud\/solution-a\/studies/);
  assert.match(server, /Governance Evidence Required/);
  assert.match(server, /synthetic-test-data/);
  assert.match(server, /publishImagingStudyToFhir/);
  assert.match(server, /FHIR Sync Failed/);
  assert.match(server, /\/api\/imaging-cloud\/studies\/:id\/viewer/);
  assert.match(server, /buildOhifStudyUrl/);
  assert.match(server, /canAccessResident/);
});

test("imaging cloud renders service health and OHIF actions", () => {
  const html = read("imaging-cloud.html");
  const js = read("imaging-cloud.js");
  assert.match(html, /data-imaging-section="solution-a-health"/);
  assert.match(html, /id="solution-a-health"/);
  assert.match(html, /data-imaging-section="solution-a-studies"/);
  assert.match(js, /loadSolutionAHealth/);
  assert.match(js, /data-open-ohif/);
  assert.match(js, /openOhifViewer/);
  assert.match(js, /loadSolutionAStudies/);
  assert.match(js, /linkExternalStudy/);
  assert.match(js, /data-link-external-study/);
});
