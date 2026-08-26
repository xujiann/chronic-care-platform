"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const data = require("../data/db.json");
const ownership = require("../config/domain-data-ownership.json");
const { buildDataPromotionCenter, validatePromotionProgram } = require("../src/platform/productization/data-promotion-center");

test("P0 data promotion and T02 regional ownership reduce legacy authority debt", () => {
  const report = buildDataPromotionCenter(data, { now: "2026-08-17T01:00:00.000Z" });
  assert.equal(report.ok, true);
  assert.equal(report.summary.promotedP0, 12);
  assert.equal(report.summary.authoritative, 61);
  assert.equal(report.summary.legacyBlocked, 188);
  for (const collection of [
    "regionalDataSharingScope",
    "regionalSharingPackages",
    "regionalSharingSnapshots",
    "regionalSharingAccessReviews"
  ]) {
    assert.equal(ownership.collections[collection]?.owner, "platform-governance", collection);
  }
  assert.equal(report.collections.every((item) => item.registered && item.contract.endsWith(".v1")), true);
  assert.equal(report.productionReady, false);
});

test("P0 data promotion rejects request-path dual writes", () => {
  const program = structuredClone(require("../config/p0-data-promotions.json"));
  program.migrationContract.requestPathDualWrite = true;
  assert.throws(() => validatePromotionProgram(program), /outbox-based/);
});
