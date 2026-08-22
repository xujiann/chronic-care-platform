"use strict";

const { createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const RISK_TYPES = Object.freeze({
  "inline-script": Object.freeze({ priority: "P0", description: "Executable inline script block" }),
  "event-handler": Object.freeze({ priority: "P0", description: "Inline HTML event handler attribute" }),
  "javascript-url": Object.freeze({ priority: "P0", description: "javascript: URL" }),
  "eval-call": Object.freeze({ priority: "P0", description: "eval call" }),
  "function-constructor": Object.freeze({ priority: "P0", description: "Function constructor" }),
  "string-timer": Object.freeze({ priority: "P0", description: "String-evaluating timer" }),
  "inline-style-block": Object.freeze({ priority: "P1", description: "Inline style block" }),
  "style-attribute": Object.freeze({ priority: "P1", description: "Inline style attribute" }),
  "inert-inline-script": Object.freeze({ priority: "P2", description: "Non-executable inline data script" })
});

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function normalizedMatch(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function lineNumber(content, index) {
  return content.slice(0, index).split("\n").length;
}

function addMatches(findings, asset, content, type, expression) {
  for (const match of content.matchAll(expression)) {
    const normalized = normalizedMatch(match[0]);
    findings.push({
      asset,
      type,
      priority: RISK_TYPES[type].priority,
      line: lineNumber(content, match.index || 0),
      fingerprint: sha256(`${type}\0${normalized}`)
    });
  }
}

function scanHtml(asset, content, findings) {
  for (const match of content.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    const attributes = match[1] || "";
    if (/\bsrc\s*=/i.test(attributes)) continue;
    const inert = /\btype\s*=\s*["'](?:application\/(?:json|ld\+json)|importmap)["']/i.test(attributes);
    const type = inert ? "inert-inline-script" : "inline-script";
    const normalized = normalizedMatch(match[0]);
    findings.push({
      asset,
      type,
      priority: RISK_TYPES[type].priority,
      line: lineNumber(content, match.index || 0),
      fingerprint: sha256(`${type}\0${normalized}`)
    });
  }
  addMatches(findings, asset, content, "inline-style-block", /<style\b[^>]*>[\s\S]*?<\/style\s*>/gi);
  addMatches(findings, asset, content, "event-handler", /\son[a-z][a-z0-9_-]*\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi);
  addMatches(findings, asset, content, "style-attribute", /\sstyle\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi);
  addMatches(findings, asset, content, "javascript-url", /\b(?:href|src|action)\s*=\s*["']\s*javascript:[^"']*["']/gi);
}

function scanJavaScript(asset, content, findings) {
  addMatches(findings, asset, content, "eval-call", /\beval\s*\(/g);
  addMatches(findings, asset, content, "function-constructor", /\b(?:new\s+)?Function\s*\(/g);
  addMatches(findings, asset, content, "string-timer", /\b(?:setTimeout|setInterval)\s*\(\s*["'`]/g);
}

function aggregateFindings(rawFindings) {
  const groups = new Map();
  rawFindings.forEach((finding) => {
    const key = `${finding.asset}\0${finding.type}\0${finding.fingerprint}`;
    const current = groups.get(key) || { ...finding, count: 0, lines: [] };
    current.count += 1;
    current.lines.push(finding.line);
    groups.set(key, current);
  });
  return [...groups.values()]
    .map((finding) => ({ ...finding, lines: [...new Set(finding.lines)].sort((a, b) => a - b) }))
    .sort((left, right) => left.asset.localeCompare(right.asset) || left.type.localeCompare(right.type) || left.fingerprint.localeCompare(right.fingerprint));
}

function scanBrowserSecurityInventory(options = {}) {
  const root = path.resolve(options.root);
  const assets = [...(options.assets || [])].sort();
  const rawFindings = [];
  assets.forEach((asset) => {
    const extension = path.posix.extname(asset).toLowerCase();
    if (extension !== ".html" && extension !== ".js") return;
    const content = fs.readFileSync(path.resolve(root, ...asset.split("/")), "utf8");
    if (extension === ".html") scanHtml(asset, content, rawFindings);
    else scanJavaScript(asset, content, rawFindings);
  });
  const findings = aggregateFindings(rawFindings);
  const summary = findings.reduce((result, finding) => {
    result.total += finding.count;
    result.byPriority[finding.priority] = (result.byPriority[finding.priority] || 0) + finding.count;
    result.byType[finding.type] = (result.byType[finding.type] || 0) + finding.count;
    return result;
  }, {
    total: 0,
    byPriority: { P0: 0, P1: 0, P2: 0 },
    byType: Object.fromEntries(Object.keys(RISK_TYPES).map((type) => [type, 0]))
  });
  return Object.freeze({
    schemaVersion: 1,
    contractId: "browser-security-risk-inventory.v1",
    assetsScanned: assets.length,
    riskTypes: RISK_TYPES,
    summary,
    findings
  });
}

function riskBaselineFromInventory(inventory, sourceRevision) {
  return {
    schemaVersion: 1,
    sourceRevision: String(sourceRevision || "unrecorded"),
    failClosedPriorities: ["P0", "P1"],
    findings: inventory.findings.map(({ asset, type, priority, fingerprint, count }) => ({ asset, type, priority, fingerprint, count }))
  };
}

function verifyBrowserSecurityInventory(inventory, baseline) {
  if (baseline?.schemaVersion !== 1 || !Array.isArray(baseline.findings) || !Array.isArray(baseline.failClosedPriorities)) {
    return { ok: false, code: "BROWSER_SECURITY_BASELINE_INVALID", violations: [] };
  }
  const protectedPriorities = new Set(baseline.failClosedPriorities);
  const allowed = new Map(baseline.findings.map((finding) => [
    `${finding.asset}\0${finding.type}\0${finding.fingerprint}`,
    Number(finding.count) || 0
  ]));
  const violations = inventory.findings.filter((finding) => {
    if (!protectedPriorities.has(finding.priority)) return false;
    const key = `${finding.asset}\0${finding.type}\0${finding.fingerprint}`;
    return finding.count > (allowed.get(key) || 0);
  }).map(({ asset, type, priority, fingerprint, count }) => ({ asset, type, priority, fingerprint, count }));
  return {
    ok: violations.length === 0,
    code: violations.length ? "BROWSER_SECURITY_HIGH_RISK_ADDITION" : "BROWSER_SECURITY_BASELINE_VERIFIED",
    violations
  };
}

module.exports = {
  RISK_TYPES,
  riskBaselineFromInventory,
  scanBrowserSecurityInventory,
  verifyBrowserSecurityInventory
};
