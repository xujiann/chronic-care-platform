"use strict";

function validateDependencies(label, dependencies) {
  if (!Array.isArray(dependencies) || dependencies.length === 0) {
    throw new TypeError(`${label} requires dependencies`);
  }
  if (new Set(dependencies).size !== dependencies.length) {
    throw new TypeError(`${label} has duplicate dependencies`);
  }
  dependencies.forEach((name) => {
    if (typeof name !== "string" || !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) {
      throw new TypeError(`${label} has invalid dependency: ${String(name)}`);
    }
  });
  return Object.freeze([...dependencies]);
}

function projectRuntimeDependencies(source, dependencies, label) {
  if (!source || typeof source !== "object") {
    throw new TypeError(`${label} requires a source object`);
  }
  const missing = dependencies.filter((name) => !(name in source));
  if (missing.length > 0) {
    throw new TypeError(`${label} is missing: ${missing.join(", ")}`);
  }
  return Object.freeze(Object.fromEntries(dependencies.map((name) => [name, source[name]])));
}

function normalizeSubdomains(domain, dependencies, subdomains = {}) {
  if (!subdomains || typeof subdomains !== "object" || Array.isArray(subdomains)) {
    throw new TypeError(`runtime context ${domain} subdomains must be an object`);
  }
  const entries = Object.entries(subdomains);
  if (entries.length === 0) return Object.freeze({});

  const allowed = new Set(dependencies);
  const normalized = Object.fromEntries(entries.map(([subdomain, names]) => {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(subdomain)) {
      throw new TypeError(`runtime context ${domain} has invalid subdomain: ${subdomain}`);
    }
    const required = validateDependencies(`runtime subcontext ${domain}/${subdomain}`, names);
    const outside = required.filter((name) => !allowed.has(name));
    if (outside.length > 0) {
      throw new TypeError(`runtime subcontext ${domain}/${subdomain} is outside its domain context: ${outside.join(", ")}`);
    }
    return [subdomain, required];
  }));
  const used = new Set(Object.values(normalized).flat());
  const unused = dependencies.filter((name) => !used.has(name));
  if (unused.length > 0) {
    throw new TypeError(`runtime context ${domain} has dependencies unused by subcontexts: ${unused.join(", ")}`);
  }
  return Object.freeze(normalized);
}

function projectRuntimeSubcontext(source, { domain, subdomain, dependencies }) {
  if (!domain || !subdomain) {
    throw new TypeError("runtime subcontext projection requires domain and subdomain");
  }
  const required = validateDependencies(`runtime subcontext ${domain}/${subdomain}`, dependencies);
  return projectRuntimeDependencies(source, required, `runtime subcontext ${domain}/${subdomain}`);
}

function defineRuntimeContext({ domain, process, dependencies, subdomains }) {
  if (!domain || !process || !Array.isArray(dependencies) || dependencies.length === 0) {
    throw new TypeError("runtime context definition requires domain, process and dependencies");
  }

  const required = validateDependencies(`runtime context ${domain}`, dependencies);
  const ownedSubdomains = normalizeSubdomains(domain, required, subdomains);
  return Object.freeze({
    domain,
    process,
    dependencies: required,
    subdomains: ownedSubdomains,
    create(source) {
      return projectRuntimeDependencies(source, required, `runtime context ${domain}`);
    },
    createSubcontext(subdomain, source) {
      const names = ownedSubdomains[subdomain];
      if (!names) throw new TypeError(`unknown runtime subcontext: ${domain}/${subdomain}`);
      return projectRuntimeDependencies(source, names, `runtime subcontext ${domain}/${subdomain}`);
    }
  });
}

module.exports = { defineRuntimeContext, projectRuntimeSubcontext };
