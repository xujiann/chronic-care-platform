"use strict";

const citizenChronic = require("./citizen-chronic");
const careCoordination = require("./care-coordination");
const { defineRuntimeContext } = require("./context-factory");

const CONTEXT_DEFINITIONS = Object.freeze(Object.fromEntries(
  [citizenChronic, careCoordination].map((definition) => [
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
