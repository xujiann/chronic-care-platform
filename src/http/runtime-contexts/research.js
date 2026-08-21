"use strict";

const DOMAIN = "research";
const PROCESS = "T09";
const DEPENDENCIES = Object.freeze([
  "appendResearchAudit", "buildResearchSandboxSummary", "collectJson", "normalizeResearchApproval",
  "normalizeResearchDatasetApplication", "normalizeResearchEvidenceDocument", "readDatabase",
  "requireApiRole", "requireDatasetSandboxAccess", "sendJson", "writeDatabase"
]);

module.exports = { DEPENDENCIES, DOMAIN, PROCESS };

