"use strict";

const citizenChronic = require("./citizen-chronic");
const careCoordination = require("./care-coordination");
const identitySecurity = require("./identity-security");
const insurancePayment = require("./insurance-payment");
const integration = require("./integration");
const runtime = require("./runtime");
const { defineRuntimeContext } = require("./context-factory");

const CONTEXT_DEFINITIONS = Object.freeze(Object.fromEntries(
  [runtime, identitySecurity, citizenChronic, careCoordination, insurancePayment, integration].map((definition) => [
    definition.DOMAIN,
    defineRuntimeContext({
      domain: definition.DOMAIN,
      process: definition.PROCESS,
      dependencies: definition.DEPENDENCIES
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
      return contexts[domain] || source;
    }
  });
}

module.exports = { CONTEXT_DEFINITIONS, createPlatformRuntimeContexts };
