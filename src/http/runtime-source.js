"use strict";

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_ROOT = path.resolve(__dirname, "..", "..");
const IMPLEMENTATION_SOURCE_REGISTRY = path.join("config", "clinical-subdomains.json");
const DOMAIN_OWNERS = Object.freeze({
  runtime: "T01",
  "identity-security": "T01",
  "authorization-context": "T01",
  "platform-governance": "T02",
  "state-data": "T02",
  "public-health": "T03",
  "citizen-chronic": "T04",
  "care-coordination": "T05",
  "clinical-specialties": "T06",
  "insurance-payment": "T07",
  integration: "T08",
  research: "T09",
  shared: "T09",
  regional: "T00"
});

function isWithin(directory, target) {
  const relative = path.relative(directory, target);
  return relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}

function samePath(left, right) {
  const normalize = (value) => process.platform === "win32" ? path.resolve(value).toLowerCase() : path.resolve(value);
  return normalize(left) === normalize(right);
}

function isNormalizedRepositoryPath(value) {
  return typeof value === "string" && Boolean(value) && !value.includes("\\")
    && !path.posix.isAbsolute(value) && !path.win32.isAbsolute(value)
    && path.posix.normalize(value) === value;
}

function matchesRoutePrefix(apiPath, prefix) {
  return apiPath === prefix || apiPath.startsWith(`${prefix}/`);
}

function apiLiterals(source) {
  return [...new Set(String(source || "").match(/\/api\/[A-Za-z0-9_./:-]+/g) || [])];
}

function validateRegisteredRouteSource(record, source) {
  const routePrefixes = Array.isArray(record?.routePrefixes) ? record.routePrefixes : [];
  if (routePrefixes.length === 0) {
    throw new Error(`registered route source has no route prefixes: ${record?.subdomain || "unknown"}`);
  }
  const allowed = (apiPath) => routePrefixes.filter((prefix) => matchesRoutePrefix(apiPath, prefix));
  const literals = apiLiterals(source);
  if (literals.length === 0) {
    throw new Error(`registered route source has no API literal: ${record.subdomain}`);
  }
  for (const apiPath of literals) {
    if (allowed(apiPath).length !== 1) {
      throw new Error(`registered route source API literal is outside its single subdomain prefix: ${apiPath}`);
    }
  }
  const authorizationCalls = String(source || "").match(/requireApiRole\s*\([^;]+?\)/gs) || [];
  for (const call of authorizationCalls) {
    const paths = apiLiterals(call);
    if (paths.length !== 1 || allowed(paths[0]).length !== 1) {
      throw new Error(`registered route authorization declaration must bind one subdomain API path: ${record.subdomain}`);
    }
  }
}

function resolveLocalRequire(fromFile, request) {
  if (!request.startsWith(".")) return null;
  const base = path.resolve(path.dirname(fromFile), request);
  for (const candidate of [base, `${base}.js`, path.join(base, "index.js")]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return fs.realpathSync(candidate);
  }
  return null;
}

function staticRequireSpecifiers(source) {
  const requests = [];
  const startsWithBom = source.charCodeAt(0) === 0xFEFF;
  let index = startsWithBom ? 1 : 0;
  const scriptStart = index;
  const skipLine = () => {
    index = source.indexOf("\n", index);
    if (index < 0) index = source.length;
  };
  const hasOnlyLinePrefixWhitespace = () => {
    const lineStart = source.lastIndexOf("\n", index - 1) + 1;
    return source.slice(lineStart, index).trim() === "";
  };
  const skipQuoted = (quote) => {
    index += 1;
    while (index < source.length) {
      if (source[index] === "\\") index += 2;
      else if (source[index++] === quote) return;
    }
  };
  while (index < source.length) {
    if ((index === scriptStart && source.startsWith("#!", index)) || source.startsWith("//", index)
      || source.startsWith("<!--", index) || (source.startsWith("-->", index) && hasOnlyLinePrefixWhitespace())) {
      skipLine();
    } else if (source.startsWith("/*", index)) {
      const end = source.indexOf("*/", index + 2);
      index = end < 0 ? source.length : end + 2;
    } else if (["'", '"', "`"].includes(source[index])) {
      skipQuoted(source[index]);
    } else if (source.startsWith("require", index)
      && !/[A-Za-z0-9_$\.]/.test(source[index - 1] || "")
      && !/[A-Za-z0-9_$]/.test(source[index + 7] || "")) {
      let cursor = index + 7;
      while (/\s/.test(source[cursor] || "")) cursor += 1;
      if (source[cursor++] !== "(") {
        index += 7;
        continue;
      }
      while (/\s/.test(source[cursor] || "")) cursor += 1;
      const quote = source[cursor++];
      if (quote !== "'" && quote !== '"') {
        index += 7;
        continue;
      }
      let request = "";
      let escaped = false;
      while (cursor < source.length && source[cursor] !== quote) {
        if (source[cursor] === "\\") escaped = true;
        request += source[cursor++];
      }
      if (source[cursor++] !== quote) break;
      while (/\s/.test(source[cursor] || "")) cursor += 1;
      if (!escaped && source[cursor] === ")") requests.push(request);
      index = cursor + 1;
    } else index += 1;
  }
  return requests;
}

function readImplementationSourceRegistry(root) {
  const registryFile = path.join(root, IMPLEMENTATION_SOURCE_REGISTRY);
  if (!fs.existsSync(registryFile)) return null;
  return JSON.parse(fs.readFileSync(registryFile, "utf8"));
}

function routeImplementationSourceRecords(root = DEFAULT_ROOT, registryOverride) {
  const resolvedRoot = path.resolve(root);
  const registry = registryOverride || readImplementationSourceRegistry(resolvedRoot);
  if (!registry) return [];
  const registrations = registry.routeImplementationSources;
  if (registrations === undefined) return [];
  if (!Array.isArray(registrations)) {
    throw new Error("routeImplementationSources must be an array");
  }
  if (!DOMAIN_OWNERS[registry.domain] || DOMAIN_OWNERS[registry.domain] !== registry.processOwner) {
    throw new Error("route implementation source registry domain and process owner must match canonical ownership");
  }

  const subdomains = Array.isArray(registry.subdomains) ? registry.subdomains : [];
  const subdomainById = new Map();
  for (const subdomain of subdomains) {
    if (!subdomain?.id || subdomainById.has(subdomain.id)) {
      throw new Error("route implementation source subdomains must have unique ids");
    }
    subdomainById.set(subdomain.id, subdomain);
  }

  const records = new Map();
  for (const registration of registrations) {
    if (!registration || typeof registration !== "object" || Array.isArray(registration)) {
      throw new Error("route implementation source registration must be an object");
    }
    const keys = Object.keys(registration).sort();
    if (!keys.includes("source") || !keys.includes("subdomain")
      || keys.some((key) => !["mountedBy", "source", "subdomain"].includes(key))) {
      throw new Error("route implementation source registration must contain only mountedBy, source and subdomain");
    }
    const subdomain = subdomainById.get(registration.subdomain);
    if (!subdomain) {
      throw new Error(`route implementation source has unknown subdomain: ${registration.subdomain || "missing"}`);
    }
    const source = registration.source;
    if (!isNormalizedRepositoryPath(source)) {
      throw new Error(`route implementation source must be a normalized repository-relative path: ${String(source || "missing")}`);
    }
    if (path.posix.extname(source) !== ".js") {
      throw new Error(`route implementation source must be a .js file: ${source}`);
    }

    if (!isNormalizedRepositoryPath(subdomain.targetSourceRoot)) {
      throw new Error(`route implementation targetSourceRoot must be a normalized repository-relative path: ${String(subdomain.targetSourceRoot || "missing")}`);
    }
    const targetSourceRoot = path.resolve(resolvedRoot, subdomain.targetSourceRoot);
    const file = path.resolve(resolvedRoot, source);
    if (!isWithin(resolvedRoot, targetSourceRoot) || !isWithin(targetSourceRoot, file)) {
      throw new Error(`route implementation source is outside ${registration.subdomain} targetSourceRoot: ${source}`);
    }
    if (!fs.existsSync(targetSourceRoot) || !fs.statSync(targetSourceRoot).isDirectory()) {
      throw new Error(`route implementation targetSourceRoot does not exist: ${subdomain.targetSourceRoot}`);
    }
    if (!fs.existsSync(file) || !fs.statSync(file).isFile() || fs.lstatSync(file).isSymbolicLink()) {
      throw new Error(`route implementation source does not exist or is not a file: ${source}`);
    }
    const realRoot = fs.realpathSync(resolvedRoot);
    const realTargetSourceRoot = fs.realpathSync(targetSourceRoot);
    const realFile = fs.realpathSync(file);
    if (!isWithin(realRoot, realTargetSourceRoot) || !isWithin(realRoot, realFile)) {
      throw new Error(`route implementation targetSourceRoot resolves outside the repository: ${subdomain.targetSourceRoot}`);
    }
    if (!isWithin(realTargetSourceRoot, realFile)) {
      throw new Error(`route implementation source resolves outside ${registration.subdomain} targetSourceRoot: ${source}`);
    }
    if (!samePath(realTargetSourceRoot, path.resolve(realRoot, subdomain.targetSourceRoot))) {
      throw new Error(`route implementation targetSourceRoot must not be a filesystem alias: ${subdomain.targetSourceRoot}`);
    }
    if (!samePath(realFile, path.resolve(realRoot, source))) {
      throw new Error(`route implementation source must not use a filesystem alias: ${source}`);
    }

    const routePrefixes = Array.isArray(subdomain.routePrefixes) ? [...subdomain.routePrefixes] : [];
    if (routePrefixes.length === 0 || routePrefixes.some((prefix) => typeof prefix !== "string" || !prefix.startsWith("/api/") || prefix.endsWith("/"))) {
      throw new Error(`route implementation subdomain must declare normalized API route prefixes: ${registration.subdomain}`);
    }
    if (!Array.isArray(registration.mountedBy) || registration.mountedBy.length === 0) {
      throw new Error(`route implementation source must declare at least one mountedBy route facade: ${source}`);
    }
    const routeSourceRoot = registry.routeSourceRoot;
    if (!isNormalizedRepositoryPath(routeSourceRoot)) {
      throw new Error("route implementation registry routeSourceRoot must be a normalized repository-relative path");
    }
    const routeRoot = path.resolve(resolvedRoot, routeSourceRoot);
    if (!isWithin(resolvedRoot, routeRoot) || !fs.existsSync(routeRoot) || !fs.statSync(routeRoot).isDirectory()
      || !samePath(fs.realpathSync(routeRoot), path.resolve(realRoot, routeSourceRoot))) {
      throw new Error(`route implementation registry routeSourceRoot must be a real repository directory: ${routeSourceRoot}`);
    }
    const realRouteRoot = fs.realpathSync(routeRoot);
    const mountedBy = [];
    for (const facadeSource of registration.mountedBy) {
      if (!isNormalizedRepositoryPath(facadeSource) || path.posix.extname(facadeSource) !== ".js") {
        throw new Error(`route implementation mountedBy must be a normalized repository-relative .js path: ${String(facadeSource || "missing")}`);
      }
      const facade = path.resolve(resolvedRoot, facadeSource);
      if (!isWithin(routeRoot, facade) || !fs.existsSync(facade) || !fs.statSync(facade).isFile() || fs.lstatSync(facade).isSymbolicLink()) {
        throw new Error(`route implementation mountedBy must be an existing route source file: ${facadeSource}`);
      }
      if (!isWithin(realRouteRoot, fs.realpathSync(facade)) || !samePath(fs.realpathSync(facade), path.resolve(realRoot, facadeSource))) {
        throw new Error(`route implementation mountedBy must not use a filesystem alias: ${facadeSource}`);
      }
      const requiredFiles = staticRequireSpecifiers(fs.readFileSync(facade, "utf8"))
        .map((request) => resolveLocalRequire(facade, request))
        .filter(Boolean);
      if (!requiredFiles.some((required) => samePath(required, realFile))) {
        throw new Error(`route implementation mountedBy does not statically require source: ${facadeSource}`);
      }
      mountedBy.push(facadeSource);
    }

    const key = process.platform === "win32" ? realFile.toLowerCase() : realFile;
    const existing = records.get(key);
    if (existing && existing.subdomain !== registration.subdomain) {
      throw new Error(`route implementation source has multiple subdomain owners: ${source}`);
    }
    const record = Object.freeze({
      file,
      domain: registry.domain,
      owner: registry.processOwner,
      subdomain: registration.subdomain,
      routePrefixes: Object.freeze(routePrefixes),
      mountedBy: Object.freeze([...new Set(mountedBy)].sort()),
      sourceKind: "registered-implementation"
    });
    validateRegisteredRouteSource(record, fs.readFileSync(file, "utf8"));
    records.set(key, record);
  }
  return [...records.values()].sort((left, right) => left.file.localeCompare(right.file));
}

function routeDirectorySourceRecords(root = DEFAULT_ROOT) {
  const resolvedRoot = path.resolve(root);
  const routeDirectory = path.join(resolvedRoot, "src", "http", "routes");
  if (!fs.existsSync(routeDirectory)) return [];
  const records = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (entry.isFile() && entry.name.endsWith(".js")) {
        const relative = path.relative(routeDirectory, target).replaceAll("\\", "/");
        records.push(Object.freeze({
          file: target,
          domain: relative.split("/")[0].replace(/\.js$/, ""),
          owner: null,
          subdomain: null,
          sourceKind: "route-directory"
        }));
      }
    }
  };
  visit(routeDirectory);
  return records.sort((left, right) => left.file.localeCompare(right.file));
}

function routeSourceRecords(root = DEFAULT_ROOT) {
  const records = [...routeDirectorySourceRecords(root), ...routeImplementationSourceRecords(root)];
  const unique = new Map();
  for (const record of records) {
    const resolved = path.resolve(record.file);
    const key = process.platform === "win32" ? resolved.toLowerCase() : resolved;
    if (!unique.has(key)) unique.set(key, record);
  }
  return [...unique.values()].sort((left, right) => left.file.localeCompare(right.file));
}

function routeSourceFiles(root = DEFAULT_ROOT) {
  return routeSourceRecords(root).map((record) => record.file);
}

function routeSourceDomain(file, root = DEFAULT_ROOT) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(file);
  const routeDirectory = path.join(resolvedRoot, "src", "http", "routes");
  if (isWithin(routeDirectory, resolved)) {
    const relative = path.relative(routeDirectory, resolved).replaceAll("\\", "/");
    return relative.split("/")[0].replace(/\.js$/, "");
  }
  const key = process.platform === "win32" ? resolved.toLowerCase() : resolved;
  return routeImplementationSourceRecords(resolvedRoot).find((record) => {
    const candidate = path.resolve(record.file);
    return (process.platform === "win32" ? candidate.toLowerCase() : candidate) === key;
  })?.domain || "";
}

function runtimeSourceFiles(root = DEFAULT_ROOT) {
  return [path.join(root, "server.js"), ...routeSourceFiles(root)];
}

function readRuntimeSource(root = DEFAULT_ROOT) {
  return runtimeSourceFiles(root)
    .map((file) => fs.readFileSync(file, "utf8"))
    .join("\n");
}

module.exports = {
  DEFAULT_ROOT,
  DOMAIN_OWNERS,
  readRuntimeSource,
  routeImplementationSourceRecords,
  routeSourceDomain,
  routeSourceFiles,
  routeSourceRecords,
  runtimeSourceFiles,
  validateRegisteredRouteSource
};
