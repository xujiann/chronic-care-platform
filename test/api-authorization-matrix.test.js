"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { buildMatrix, validateMatrix } = require("../scripts/api-authorization-matrix");

test("modular API authorization matrix covers owners roles scopes purposes and high-risk routes", () => {
  const matrix = buildMatrix();
  assert.deepEqual(validateMatrix(matrix), []);
  assert.equal(matrix.generatedFrom, "src/http/routes/**/*.js");
  assert.equal(matrix.summary.protected >= 550, true);
  assert.equal(matrix.summary.highRisk, 9);
  assert.equal(matrix.summary.residentScoped > 0, true);
  assert.equal(matrix.summary.institutionScoped > 0, true);
  assert.equal(matrix.routes.every((route) => route.owner && route.identity && route.dataScope && route.purpose), true);
});
