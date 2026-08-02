const test = require("node:test");
const assert = require("node:assert/strict");

const { assess, requiredFiles } = require("../scripts/resident-mini-program-readiness");

test("resident mini program third stage passes its dedicated readiness gate", () => {
  const result = assess();
  assert.equal(result.ready, true);
  assert.deepEqual(result.missing, []);
  assert.equal(requiredFiles.length, 22);
  assert.equal(Object.keys(result.checks).length, 19);
  assert.match(result.decision, /生产上线仍受外部依赖约束/);
  assert.equal(result.externalDependencies.length, 4);
});
