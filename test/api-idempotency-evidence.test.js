"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { DEFAULT_REGISTRY, validateEvidenceRegistry } = require("../scripts/api-idempotency-evidence");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test("idempotency evidence registry validates the single SMS callback pilot and remains fail closed", () => {
  assert.deepEqual(validateEvidenceRegistry(), []);
  assert.equal(DEFAULT_REGISTRY.contracts.length, 1);
  assert.equal(DEFAULT_REGISTRY.contracts[0].key, "POST /api/auth/sms-delivery-callback");
  assert.equal(DEFAULT_REGISTRY.contracts[0].owner, "T01");
  assert.equal(DEFAULT_REGISTRY.contracts[0].productionReady, false);
  assert.equal(DEFAULT_REGISTRY.contracts[0].idempotency.distributedExactlyOnceClaimed, false);
});

test("idempotency evidence registry rejects marker promotion, production promotion and missing executable evidence", () => {
  const markerPromotion = clone(DEFAULT_REGISTRY);
  markerPromotion.policy.sourceMarkersAreBehaviorProof = true;
  assert.match(validateEvidenceRegistry(markerPromotion).join("\n"), /source markers must not be behavior proof/);

  const productionPromotion = clone(DEFAULT_REGISTRY);
  productionPromotion.contracts[0].productionReady = true;
  assert.match(validateEvidenceRegistry(productionPromotion).join("\n"), /production fail closed/);

  const missingTestAnchor = clone(DEFAULT_REGISTRY);
  missingTestAnchor.contracts[0].testEvidence[0].anchors.push("this executable assertion does not exist");
  assert.match(validateEvidenceRegistry(missingTestAnchor).join("\n"), /missing evidence anchor/);

  const duplicate = clone(DEFAULT_REGISTRY);
  duplicate.contracts.push(clone(duplicate.contracts[0]));
  assert.match(validateEvidenceRegistry(duplicate).join("\n"), /duplicate or missing contract id|duplicate or invalid evidence key/);
});
