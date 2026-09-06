"use strict";

const { createClinicalDecisionSupport } = require("../clinical-specialties/clinical-decision-support");
const { evaluateAiRulePolicy } = require("../identity-security/ai-governance");

// Historical names resolve only through the trusted server directory. Ambiguous
// names never expand scope; explicit codes must be present in that directory.
function resolveClinicalOrganizationCode(data, row) {
  const directory = Array.isArray(data.authOrganizations) ? data.authOrganizations : [];
  const explicit = row.orgCode || row.institutionCode || row.sourceInstitutionCode;
  if (explicit) return directory.filter((item) => item.orgCode === explicit).length === 1 ? explicit : "";
  const name = row.institution || row.institutionName || row.sourceInstitution;
  if (typeof name !== "string" || !name) return "";
  const codes = new Set(directory.filter((item) => item.name === name).map((item) => item.orgCode));
  for (const resource of (Array.isArray(data.medicalResources) ? data.medicalResources : [])) {
    if (resource.institution !== name) continue;
    const code = typeof resource.id === "string" ? resource.id.toUpperCase() : "";
    if (directory.filter((item) => item.orgCode === code).length === 1) codes.add(code);
  }
  const code = codes.size === 1 ? [...codes][0] : "";
  return code && directory.filter((item) => item.orgCode === code).length === 1 ? code : "";
}

function createClinicalAssistRuntime(ports) {
  return createClinicalDecisionSupport({ ...ports, resolveOrganizationCode: resolveClinicalOrganizationCode, rulePolicy: evaluateAiRulePolicy });
}

function createClinicalGovernancePorts() {
  return { canAccessAlert: createClinicalAssistRuntime({}).canAccessAlert, rulePolicy: evaluateAiRulePolicy };
}

module.exports = { createClinicalAssistRuntime, createClinicalGovernancePorts, resolveClinicalOrganizationCode };
