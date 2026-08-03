"use strict";

function defineRuntimeContext({ domain, process, dependencies }) {
  if (!domain || !process || !Array.isArray(dependencies) || dependencies.length === 0) {
    throw new TypeError("runtime context definition requires domain, process and dependencies");
  }
  if (new Set(dependencies).size !== dependencies.length) {
    throw new TypeError(`runtime context ${domain} has duplicate dependencies`);
  }

  const required = Object.freeze([...dependencies]);
  return Object.freeze({
    domain,
    process,
    dependencies: required,
    create(source) {
      if (!source || typeof source !== "object") {
        throw new TypeError(`runtime context ${domain} requires a source object`);
      }
      const missing = required.filter((name) => !(name in source));
      if (missing.length > 0) {
        throw new TypeError(`runtime context ${domain} is missing: ${missing.join(", ")}`);
      }
      return Object.freeze(Object.fromEntries(required.map((name) => [name, source[name]])));
    }
  });
}

module.exports = { defineRuntimeContext };
