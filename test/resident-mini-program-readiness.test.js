const test = require("node:test");
const assert = require("node:assert/strict");

const { assess, requiredFiles } = require("../scripts/resident-mini-program-readiness");

test("resident mini program fourth stage passes its dedicated readiness gate", () => {
  const result = assess();
  assert.equal(result.ready, true);
  assert.deepEqual(result.missing, []);
  assert.equal(requiredFiles.length, 31);
  assert.equal(Object.keys(result.checks).length, 26);
  assert.match(result.decision, /生产发布仍受外部阻断项约束/);
  assert.equal(result.externalDependencies.length, 4);
});
