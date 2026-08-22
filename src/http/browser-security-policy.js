"use strict";

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_POLICY_FILE = path.resolve(__dirname, "../../browser-security-policy.json");

function loadBrowserSecurityPolicy(file = DEFAULT_POLICY_FILE) {
  const policy = JSON.parse(fs.readFileSync(file, "utf8"));
  if (policy.schemaVersion !== 1 || policy.contractId !== "browser-security-headers.v1") {
    throw new Error("Unsupported browser security policy contract");
  }
  if (policy.csp?.mode !== "report-only") throw new Error("Browser CSP must remain report-only while the legacy risk baseline is open");
  if (!policy.csp.directives || typeof policy.csp.directives !== "object") throw new Error("Browser CSP directives are required");
  if (policy.csp.compatibilityBaselineEnforced !== true || !policy.csp.compatibilityDirectives) {
    throw new Error("Browser CSP compatibility baseline must remain enforced during migration");
  }
  const targetCsp = serializeCsp(policy.csp.directives);
  const compatibilityCsp = serializeCsp(policy.csp.compatibilityDirectives);
  if (/unsafe-inline|unsafe-eval/.test(targetCsp)) throw new Error("Strict report-only CSP cannot allow inline or eval execution");
  if (/unsafe-eval/.test(compatibilityCsp)) throw new Error("Compatibility CSP cannot allow eval execution");
  if (!/script-src-attr 'none'/.test(compatibilityCsp)) throw new Error("Compatibility CSP must reject inline event handlers");
  if (!policy.productionHsts || !/^max-age=\d+/.test(policy.productionHsts)) throw new Error("Production HSTS policy is required");
  if (policy.riskBaseline?.schemaVersion !== 2 || !Array.isArray(policy.riskBaseline.findings)) {
    throw new Error("Browser security risk baseline is required");
  }
  if (policy.productionReady !== false || policy.staticHosting?.productionReady !== false) {
    throw new Error("Browser security policy cannot claim production readiness in the report-only phase");
  }
  return policy;
}

function serializeCsp(directives) {
  return Object.entries(directives)
    .map(([name, values]) => `${name}${Array.isArray(values) && values.length ? ` ${values.join(" ")}` : ""}`)
    .join("; ");
}

function createBrowserSecurityHeaders(options = {}) {
  const policy = options.policy || loadBrowserSecurityPolicy(options.policyFile);
  const headers = {
    ...policy.headers,
    "Content-Security-Policy": serializeCsp(policy.csp.compatibilityDirectives),
    "Content-Security-Policy-Report-Only": serializeCsp(policy.csp.directives)
  };
  if (options.production === true) headers["Strict-Transport-Security"] = policy.productionHsts;
  return Object.freeze(headers);
}

function browserSecurityReadiness(options = {}) {
  const policy = options.policy || loadBrowserSecurityPolicy(options.policyFile);
  return Object.freeze({
    contractId: policy.contractId,
    cspMode: policy.csp.mode,
    compatibilityBaselineEnforced: policy.csp.compatibilityBaselineEnforced === true,
    productionReady: false,
    staticHostingReady: policy.staticHosting.productionReady === true,
    blockers: Object.freeze([...policy.blockers])
  });
}

module.exports = {
  DEFAULT_POLICY_FILE,
  browserSecurityReadiness,
  createBrowserSecurityHeaders,
  loadBrowserSecurityPolicy,
  serializeCsp
};
