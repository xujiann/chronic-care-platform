const test = require("node:test");
const assert = require("node:assert/strict");

const { assess, requiredFiles } = require("../scripts/resident-mini-program-readiness");

test("resident mini program first increment passes its dedicated readiness gate", () => {
  const result = assess();
  assert.equal(result.ready, true);
  assert.deepEqual(result.missing, []);
  assert.equal(requiredFiles.length, 10);
  assert.match(result.decision, /生产上线仍受外部依赖约束/);
  assert.equal(result.externalDependencies.length, 4);
});
