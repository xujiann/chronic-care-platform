"use strict";

const crypto = require("node:crypto");

const SEMANTIC_FIELDS = Object.freeze([
  "semanticDigest",
  "targetCapabilityIds",
  "productClass",
  "decision",
  "priority",
  "ownerProcess"
]);

function semanticValue(candidate, field) {
  if (field === "targetCapabilityIds") return [...candidate.targetCapabilityIds].sort();
  return candidate[field];
}

function candidateSemanticDigest(candidate) {
  const value = Object.fromEntries(SEMANTIC_FIELDS.map((field) => [field, semanticValue(candidate, field)]));
  return `sha256:${crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function publicChange(candidate, change, changedFields = []) {
  return Object.freeze({
    logicalRequirementId: candidate.logicalRequirementId,
    candidateId: candidate.id,
    title: `需求候选 ${candidate.logicalRequirementId.slice(4)}`,
    change,
    changedFields: Object.freeze([...changedFields]),
    comparisonDigest: candidateSemanticDigest(candidate),
    productionReady: false
  });
}

function compareProcurementDocumentRevisions(previous, current) {
  if (!previous || !current || previous.seriesId !== current.seriesId) throw new TypeError("revision comparison requires one source series");
  if (current.revision !== previous.revision + 1 || current.supersedesDocumentId !== previous.id) throw new TypeError("revision comparison requires adjacent documents");
  const earlier = new Map(previous.candidates.map((candidate) => [candidate.logicalRequirementId, candidate]));
  const later = new Map(current.candidates.map((candidate) => [candidate.logicalRequirementId, candidate]));
  const added = [];
  const changed = [];
  const withdrawn = [];
  let unchanged = 0;

  for (const candidate of current.candidates) {
    const prior = earlier.get(candidate.logicalRequirementId);
    if (!prior) {
      added.push(publicChange(candidate, "added"));
      continue;
    }
    const changedFields = SEMANTIC_FIELDS.filter((field) => JSON.stringify(semanticValue(prior, field)) !== JSON.stringify(semanticValue(candidate, field)));
    if (changedFields.length) changed.push(publicChange(candidate, "changed", changedFields));
    else unchanged += 1;
  }
  for (const candidate of previous.candidates) {
    if (!later.has(candidate.logicalRequirementId)) withdrawn.push(publicChange(candidate, "withdrawn"));
  }

  return Object.freeze({
    seriesId: current.seriesId,
    sourceAlias: current.sourceAlias,
    fromDocumentId: previous.id,
    toDocumentId: current.id,
    fromRevision: previous.revision,
    toRevision: current.revision,
    summary: Object.freeze({ added: added.length, changed: changed.length, withdrawn: withdrawn.length, unchanged }),
    added: Object.freeze(added),
    changed: Object.freeze(changed),
    withdrawn: Object.freeze(withdrawn),
    productionReady: false
  });
}

function buildProcurementRevisionComparisons(catalog) {
  const series = new Map();
  for (const document of catalog.documents) {
    if (!series.has(document.seriesId)) series.set(document.seriesId, []);
    series.get(document.seriesId).push(document);
  }
  const comparisons = [];
  for (const documents of series.values()) {
    const ordered = [...documents].sort((left, right) => left.revision - right.revision);
    for (let index = 1; index < ordered.length; index += 1) {
      comparisons.push(compareProcurementDocumentRevisions(ordered[index - 1], ordered[index]));
    }
  }
  return Object.freeze(comparisons);
}

module.exports = {
  SEMANTIC_FIELDS,
  buildProcurementRevisionComparisons,
  candidateSemanticDigest,
  compareProcurementDocumentRevisions
};
