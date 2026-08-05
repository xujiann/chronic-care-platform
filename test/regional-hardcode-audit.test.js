"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { compareFindings, countMatches } = require("../scripts/regional-hardcode-audit");

test("regional hardcode audit counts case-insensitive deployment labels", () => {
  assert.equal(countMatches("大连 Dalian dALiAn 210200", "大连|210200|dalian"), 4);
});

test("regional hardcode audit permits reductions and blocks growth or new files", () => {
  const result = compareFindings(
    { "reduced.js": 1, "grown.js": 3, "new.js": 1 },
    { "reduced.js": 2, "grown.js": 2 }
  );
  assert.deepEqual(result.reductions, [{ file: "reduced.js", count: 1, allowed: 2, removed: 1 }]);
  assert.deepEqual(result.violations, [
    { file: "grown.js", count: 3, allowed: 2, added: 1 },
    { file: "new.js", count: 1, allowed: 0, added: 1 }
  ]);
});
