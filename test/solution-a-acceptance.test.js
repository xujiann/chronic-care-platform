const test = require("node:test");
const assert = require("node:assert/strict");
const { syntheticPatient } = require("../scripts/solution-a-acceptance");
test("solution A acceptance uses explicitly synthetic patient data", () => {
  const patient = syntheticPatient();
  assert.equal(patient.resourceType, "Patient");
  assert.match(patient.identifier[0].value, /^SYNTHETIC-/);
  assert.equal(patient.meta.tag[0].code, "synthetic-test-data");
});
