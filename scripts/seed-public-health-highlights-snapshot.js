#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const {
  seedPublicHealthAiReviews,
  seedPublicHealthAlerts,
  seedPublicHealthCommandTasks,
  seedPublicHealthEvidenceRecords,
  seedPublicHealthResources,
  seedPublicHealthSignals,
  seedPublicHealthTriggerRules
} = require("../public-health-highlights-service");

const ROOT = path.resolve(__dirname, "..");
const FILE = path.join(ROOT, "data", "db.json");

function mergeRows(seedRows, existingRows) {
  const rows = Array.isArray(existingRows) ? existingRows : [];
  const byId = new Map(rows.map((row) => [row.id, row]));
  return seedRows.map((seed) => ({ ...seed, ...(byId.get(seed.id) || {}) }))
    .concat(rows.filter((row) => !seedRows.some((seed) => seed.id === row.id)));
}

const data = JSON.parse(fs.readFileSync(FILE, "utf8"));
data.publicHealthTriggerRules = mergeRows(seedPublicHealthTriggerRules(), data.publicHealthTriggerRules);
data.publicHealthSignals = mergeRows(seedPublicHealthSignals(), data.publicHealthSignals);
data.publicHealthAlerts = mergeRows(seedPublicHealthAlerts(), data.publicHealthAlerts);
data.publicHealthCommandTasks = mergeRows(seedPublicHealthCommandTasks(), data.publicHealthCommandTasks);
data.publicHealthResources = mergeRows(seedPublicHealthResources(), data.publicHealthResources);
data.publicHealthAiReviews = mergeRows(seedPublicHealthAiReviews(), data.publicHealthAiReviews);
data.publicHealthEvidenceRecords = mergeRows(seedPublicHealthEvidenceRecords(), data.publicHealthEvidenceRecords);
fs.writeFileSync(FILE, `${JSON.stringify(data, null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  file: path.relative(ROOT, FILE),
  collections: {
    publicHealthTriggerRules: data.publicHealthTriggerRules.length,
    publicHealthSignals: data.publicHealthSignals.length,
    publicHealthAlerts: data.publicHealthAlerts.length,
    publicHealthCommandTasks: data.publicHealthCommandTasks.length,
    publicHealthResources: data.publicHealthResources.length,
    publicHealthAiReviews: data.publicHealthAiReviews.length,
    publicHealthEvidenceRecords: data.publicHealthEvidenceRecords.length
  }
}, null, 2));
