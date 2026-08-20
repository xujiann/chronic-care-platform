"use strict";

const { createHash } = require("node:crypto");

const AUDIT_CHAIN_VERSION = "audit-chain-v2";
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function auditHashFor(item) {
  const { auditHash, ...payload } = item || {};
  return createHash("sha256").update(stableStringify(payload)).digest("hex");
}

function verifyAuditTrail(rows) {
  const items = Array.isArray(rows) ? rows : [];
  const broken = [];
  const linkBroken = [];
  const duplicateIds = [];
  const structuralBroken = [];
  const seenIds = new Set();
  let previousHash = "";

  if (!Array.isArray(rows)) {
    structuralBroken.push({ index: -1, id: "", reason: "TRAIL_NOT_ARRAY" });
  }

  for (let index = items.length - 1; index >= 0; index -= 1) {
    const row = items[index];
    const item = row && typeof row === "object" && !Array.isArray(row) ? row : {};
    const id = typeof item.id === "string" ? item.id.trim() : "";
    const expectedHash = auditHashFor(item);
    const expectedPreviousHash = previousHash;

    if (!id) structuralBroken.push({ index, id: "", reason: "MISSING_ID" });
    else if (seenIds.has(id)) duplicateIds.push({ index, id });
    else seenIds.add(id);

    if (!SHA256_PATTERN.test(String(item.auditHash || ""))) {
      structuralBroken.push({ index, id, reason: "INVALID_AUDIT_HASH" });
    }
    if (item.previousAuditHash !== "" && !SHA256_PATTERN.test(String(item.previousAuditHash || ""))) {
      structuralBroken.push({ index, id, reason: "INVALID_PREVIOUS_AUDIT_HASH" });
    }
    if (item.auditHash !== expectedHash) {
      broken.push({
        index,
        id,
        expectedPreviousHash,
        actualPreviousHash: item.previousAuditHash || "",
        expectedHash,
        actualHash: item.auditHash || ""
      });
    }
    if (item.previousAuditHash !== expectedPreviousHash) {
      linkBroken.push({
        index,
        id,
        expectedPreviousHash,
        actualPreviousHash: item.previousAuditHash || ""
      });
    }
    previousHash = item.auditHash || expectedHash;
  }

  return {
    version: AUDIT_CHAIN_VERSION,
    passed: broken.length === 0 && linkBroken.length === 0 && duplicateIds.length === 0 && structuralBroken.length === 0,
    count: items.length,
    broken,
    linkBroken,
    duplicateIds,
    structuralBroken
  };
}

module.exports = {
  AUDIT_CHAIN_VERSION,
  auditHashFor,
  stableStringify,
  verifyAuditTrail
};
