"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { assessChineseCopy, scanTextGroups, visibleHtmlText } = require("../scripts/resident-mini-program-chinese-scan");

test("resident-visible shell, states and platform failures pass the Chinese copy gate", () => {
  const result = assessChineseCopy();
  assert.equal(result.ready, true);
  assert.deepEqual(result.violations, []);
  assert.deepEqual(result.scannedGroups, ["shell", "statuses", "reasons", "platformFailures", "platformCapabilities"]);
});

test("Chinese copy gate catches English state regressions", () => {
  assert.equal(visibleHtmlText("<p>正在加载</p>"), "正在加载");
  assert.deepEqual(scanTextGroups({ shell: ["正在加载"] }), []);
  assert.deepEqual(scanTextGroups({ shell: ["pending approval"] }), [
    { group: "shell", text: "pending approval" }
  ]);
});
