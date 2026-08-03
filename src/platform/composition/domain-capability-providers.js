"use strict";

function createDomainCapabilityProviders({ definitions, source }) {
  if (!definitions || typeof definitions !== "object" || Object.keys(definitions).length === 0) {
    throw new TypeError("domain capability providers require context definitions");
  }
  if (!source || typeof source !== "object") {
    throw new TypeError("domain capability providers require a runtime source");
  }
  const providers = Object.freeze(Object.fromEntries(
    Object.entries(definitions).map(([domain, definition]) => {
      const missing = definition.dependencies.filter((name) => !(name in source));
      if (missing.length > 0) {
        throw new TypeError(`capability provider ${domain} is missing: ${missing.join(", ")}`);
      }
      const capabilities = Object.freeze(Object.fromEntries(
        definition.dependencies.map((name) => [name, source[name]])
      ));
      return [domain, Object.freeze({
        domain,
        process: definition.process,
        capabilities,
        resolve() {
          return capabilities;
        }
      })];
    })
  ));

  return Object.freeze({
    kind: "domain-capability-providers",
    providers,
    forDomain(domain) {
      const provider = providers[domain];
      if (!provider) throw new TypeError(`unknown domain capability provider: ${domain}`);
      return provider;
    }
  });
}

module.exports = { createDomainCapabilityProviders };
