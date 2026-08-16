"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const manifest = require("../config/domain-data-ownership.json");
const { buildCollectionGovernanceInventory } = require("../src/platform/data/collection-governance");
const { renderMarkdown } = require("../scripts/data-collection-governance");

test("collection inventory classifies every collection and blocks unregistered production writes", () => {
  const report = buildCollectionGovernanceInventory({
    residents: [{ id: "resident-1" }],
    securityEvents: [],
    legacyOrders: [{ id: "legacy-1" }]
  });
  assert.equal(report.ok, true);
  assert.equal(report.summary.classified, 3);
  assert.equal(report.collections.find((item) => item.name === "residents").owner, "identity-security");
  assert.equal(report.collections.find((item) => item.name === "securityEvents").kind, "governed-system");
  assert.deepEqual(report.collections.find((item) => item.name === "legacyOrders"), {
    name: "legacyOrders",
    records: 1,
    kind: "legacy-non-authoritative",
    owner: "",
    classification: "legacy-non-authoritative",
    readers: [],
    productionWriteAllowed: false,
    promotionRequired: true
  });
  assert.equal(report.productionReady, false);
  const markdown = renderMarkdown(report);
  assert.match(markdown, /Collections: 3/);
  assert.match(markdown, /legacyOrders: legacy-non-authoritative; production write blocked/);
  assert.doesNotMatch(markdown, /undefined/);
});

test("collection inventory rejects a permissive legacy policy", () => {
  const unsafe = structuredClone(manifest);
  unsafe.unregisteredCollectionPolicy.productionWriteAllowed = true;
  assert.throws(() => buildCollectionGovernanceInventory({ legacy: [] }, unsafe), /fail closed/);
});
