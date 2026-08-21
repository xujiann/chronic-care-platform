#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { routeSourceFiles } = require("../src/http/runtime-source");

const ROOT = path.resolve(__dirname, "..");
const HIGH_RISK = require("../config/high-risk-api-authorization.json").routes;
const PUBLIC_ROUTES = Object.freeze([
  { method: "GET", path: "/api/live", owner: "T01", purpose: "liveness-probe" },
  { method: "GET", path: "/api/health", owner: "T01", purpose: "readiness-probe" },
  { method: "POST", path: "/api/auth/login", owner: "T01", purpose: "establish-session" },
  { method: "POST", path: "/api/auth/phone-code", owner: "T01", purpose: "request-phone-verification" },
  { method: "POST", path: "/api/auth/phone-login", owner: "T01", purpose: "establish-phone-session" }
]);

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

function findCallEnd(source, openIndex) {
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === "\"" || char === "'" || char === "`") quote = char;
    else if (char === "(") depth += 1;
    else if (char === ")" && --depth === 0) return index;
  }
  return -1;
}

function splitArguments(value) {
  const args = [];
  let current = "";
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (const char of value) {
    if (quote) {
      current += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === "\"" || char === "'" || char === "`") quote = char;
    else if ("([{ ".includes(char) && char !== " ") depth += 1;
    else if (")] }".includes(char) && char !== " ") depth -= 1;
    if (char === "," && depth === 0) {
      args.push(current.trim());
      current = "";
    } else current += char;
  }
  if (current.trim()) args.push(current.trim());
  return args;
}

function quotedValue(expression) {
  return String(expression || "").match(/^["']([^"']+)["']$/)?.[1] || "";
}

function inferMethod(context) {
  return [...context.matchAll(/req\.method\s*===\s*["'](GET|POST|PUT|PATCH|DELETE)["']/g)].at(-1)?.[1] || "ANY";
}

function inferPath(context, targetExpression, sourceRef) {
  const target = quotedValue(targetExpression);
  if (target.startsWith("/api/")) return target;
  const exact = [...context.matchAll(/url\.pathname\s*===\s*["']([^"']+)["']/g)].at(-1)?.[1];
  if (exact) return exact;
  const prefix = [...context.matchAll(/url\.pathname\.startsWith\(["']([^"']+)["']\)/g)].at(-1)?.[1];
  return prefix ? `${prefix}:dynamic` : `runtime-policy@${sourceRef}`;
}

function inferRoles(expression) {
  const roles = [...String(expression || "").matchAll(/["']([a-z-]+)["']/g)].map((match) => match[1]);
  return roles.length ? [...new Set(roles)] : [`runtime-policy:${String(expression || "unknown").replace(/\s+/g, " ")}`];
}

function inferScope(context, routePath) {
  if (/canAccessResident|allowedResident|residentId|residents\/me/.test(context + routePath)) return "resident";
  if (/institution|orgCode|orgName|tenant/i.test(context + routePath)) return "institution";
  if (/region/i.test(context + routePath)) return "region";
  return "platform";
}

function inferPurpose(method, routePath) {
  if (/callback|webhook/.test(routePath)) return "receive-protected-external-callback";
  if (/audit/.test(routePath)) return method === "GET" ? "read-audit-evidence" : "write-audit-governance-action";
  if (method === "GET") return "read-business-data";
  if (method === "DELETE") return "delete-business-data";
  if (/actions|action/.test(routePath)) return "execute-business-action";
  return "write-business-data";
}

function domainForFile(file) {
  const relative = path.relative(path.join(ROOT, "src", "http", "routes"), file).replaceAll("\\", "/");
  const name = relative.split("/")[0].replace(/\.js$/, "");
  return name;
}

function readRouteSources(root = ROOT) {
  return routeSourceFiles(root).map((file) => ({
    file,
    source: fs.readFileSync(file, "utf8")
  }));
}

function buildMatrix(sourceFiles = readRouteSources()) {
  const routes = PUBLIC_ROUTES.map((route) => ({
    ...route,
    key: `${route.method} ${route.path}`,
    domain: "identity-security",
    identity: { required: false, mechanism: "public-explicit" },
    roles: [],
    dataScope: "none",
    highRisk: false,
    source: "explicit-public-route-register"
  }));

  for (const entry of sourceFiles) {
    const source = entry.source;
    const relative = path.relative(ROOT, entry.file).replaceAll("\\", "/");
    const domain = domainForFile(entry.file);
    const owner = DOMAIN_OWNERS[domain] || "T00-review-required";
    const needle = "requireApiRole(";
    let cursor = 0;
    while ((cursor = source.indexOf(needle, cursor)) >= 0) {
      const openIndex = cursor + needle.length - 1;
      const end = findCallEnd(source, openIndex);
      if (end < 0) throw new Error(`unterminated requireApiRole call in ${relative}`);
      const args = splitArguments(source.slice(openIndex + 1, end));
      cursor = end + 1;
      if (args[0] !== "req" || args[1] !== "res") continue;
      const line = source.slice(0, cursor).split("\n").length;
      const before = source.slice(Math.max(0, cursor - 2200), cursor);
      const after = source.slice(cursor, Math.min(source.length, cursor + 1600));
      const method = inferMethod(before);
      const routePath = inferPath(before, args[3], `${relative}:${line}`);
      const key = `${method} ${routePath}`;
      const override = HIGH_RISK[key];
      routes.push({
        key,
        method,
        path: routePath,
        owner: override?.owner || owner,
        domain,
        identity: { required: true, mechanism: "bearer-or-cookie-session" },
        roles: override?.roles || inferRoles(args[2]),
        dataScope: override?.dataScope || inferScope(before + after, routePath),
        purpose: override?.purpose || inferPurpose(method, routePath),
        highRisk: Boolean(override),
        source: `${relative}:${line}`
      });
    }
  }

  return {
    schemaVersion: "api-authorization-matrix-v2",
    generatedFrom: "src/http/routes/**/*.js",
    generatedAt: new Date().toISOString(),
    summary: {
      declarations: routes.length,
      protected: routes.filter((route) => route.identity.required).length,
      public: routes.filter((route) => !route.identity.required).length,
      highRisk: routes.filter((route) => route.highRisk).length,
      residentScoped: routes.filter((route) => route.dataScope === "resident").length,
      institutionScoped: routes.filter((route) => route.dataScope === "institution").length
    },
    routes
  };
}

function validateMatrix(matrix) {
  const errors = [];
  if (matrix.summary.protected < 550) errors.push(`protected declaration count unexpectedly low: ${matrix.summary.protected}`);
  for (const route of matrix.routes) {
    if (!route.method || !route.path || !route.owner || !route.purpose || !route.dataScope) errors.push(`incomplete route: ${route.source}`);
    if (route.identity.required && route.roles.length === 0) errors.push(`protected route has no roles: ${route.key}`);
  }
  for (const key of Object.keys(HIGH_RISK)) {
    const matches = matrix.routes.filter((route) => route.key === key && route.highRisk);
    if (matches.length !== 1) errors.push(`high-risk route must resolve exactly once: ${key} (${matches.length})`);
  }
  return errors;
}

function runCli(argv = process.argv.slice(2)) {
  const matrix = buildMatrix();
  const errors = validateMatrix(matrix);
  const output = argv.includes("--check") ? { ok: errors.length === 0, errors, summary: matrix.summary } : matrix;
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (errors.length) process.exitCode = 1;
}

if (require.main === module) runCli();

module.exports = { buildMatrix, readRouteSources, validateMatrix };
