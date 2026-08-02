const test = require("node:test");
const assert = require("node:assert/strict");

const { assess, requiredFiles } = require("../scripts/resident-mini-program-readiness");

test("resident mini program second stage passes its dedicated readiness gate", () => {
  const result = assess();
  assert.equal(result.ready, true);
  assert.deepEqual(result.missing, []);
  assert.equal(requiredFiles.length, 18);
  assert.equal(Object.keys(result.checks).length, 13);
  assert.match(result.decision, /生产上线仍受外部依赖约束/);
  assert.equal(result.externalDependencies.length, 4);
});
