"use strict";

const citizenChronic = require("./citizen-chronic");
const careCoordination = require("./care-coordination");
const clinicalSpecialties = require("./clinical-specialties");
const identitySecurity = require("./identity-security");
const insurancePayment = require("./insurance-payment");
const integration = require("./integration");
const platformGovernance = require("./platform-governance");
const publicHealth = require("./public-health");
const research = require("./research");
const runtime = require("./runtime");
const shared = require("./shared");
const stateData = require("./state-data");
const { defineRuntimeContext } = require("./context-factory");

const CONTEXT_DEFINITIONS = Object.freeze(Object.fromEntries(
  [
    runtime,
    identitySecurity,
    platformGovernance,
    stateData,
    publicHealth,
    citizenChronic,
    careCoordination,
    clinicalSpecialties,
    insurancePayment,
    integration,
    research,
    shared
  ].map((definition) => [
    definition.DOMAIN,
    defineRuntimeContext({
      domain: definition.DOMAIN,
      process: definition.PROCESS,
      dependencies: definition.DEPENDENCIES,
      subdomains: definition.SUBDOMAIN_DEPENDENCIES
    })
  ])
));

function createPlatformRuntimeContexts(source) {
  const contexts = Object.freeze(Object.fromEntries(
    Object.entries(CONTEXT_DEFINITIONS).map(([domain, definition]) => [domain, definition.create(source)])
  ));
  return Object.freeze({
    contexts,
    forDomain(domain) {
      if (!contexts[domain]) throw new TypeError(`unknown runtime context domain: ${domain}`);
      return contexts[domain];
    }
  });
}

module.exports = { CONTEXT_DEFINITIONS, createPlatformRuntimeContexts };
