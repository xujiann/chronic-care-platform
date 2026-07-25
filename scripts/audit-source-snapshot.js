#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const SNAPSHOT_VERSION = 1;
const FALLBACK_SOURCE_FILES = [
  "package.json",
  "server.js",
  "scripts/audit-source-snapshot.js",
  "scripts/platform-production-audit.js",
  "scripts/release-report.js"
];
const SOURCE_EXTENSIONS = new Set([".css", ".html", ".js", ".json", ".md", ".mjs", ".ps1", ".service", ".sql", ".timer", ".yaml", ".yml"]);
const EXCLUDED_PREFIXES = ["coverage/", "node_modules/", "release/", "tmp/"];

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function readJson(root, relativePath, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
  } catch {
    return fallback;
  }
}

function gitCommitSha(root, env = process.env) {
  const declared = String(env.GIT_COMMIT_SHA || env.SOURCE_VERSION || env.GITHUB_SHA || "").trim();
  if (declared) return declared;
  const result = spawnSync("git", ["rev-parse", "--verify", "HEAD"], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true
  });
  return result.status === 0 ? result.stdout.trim() : "unavailable";
}

function trackedSourceFiles(root) {
  const result = spawnSync("git", ["ls-files", "-z", "--cached"], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024
  });
  const listed = result.status === 0 ? result.stdout.split("\0").filter(Boolean) : [];
  const candidates = new Set([...listed, ...FALLBACK_SOURCE_FILES]);
  return [...candidates]
    .map((item) => item.replaceAll("\\", "/"))
    .filter((item) => item !== "data/db.json")
    .filter((item) => !EXCLUDED_PREFIXES.some((prefix) => item.startsWith(prefix)))
    .filter((item) => SOURCE_EXTENSIONS.has(path.extname(item).toLowerCase()))
    .filter((item) => fs.existsSync(path.join(root, item)))
    .sort();
}

function sourceTreeDigest(root, files = trackedSourceFiles(root)) {
  const hash = createHash("sha256");
  files.forEach((relativePath) => {
    hash.update(relativePath);
    hash.update("\0");
    hash.update(fs.readFileSync(path.join(root, relativePath)));
    hash.update("\0");
  });
  return { sha256: hash.digest("hex"), files: files.length };
}

function buildAuditSourceSnapshot(options = {}) {
  const root = path.resolve(options.root || ROOT);
  const pkg = options.pkg || readJson(root, "package.json");
  const data = options.data || readJson(root, "data/db.json");
  const sourceTree = options.sourceTree || sourceTreeDigest(root, options.sourceFiles);
  return {
    version: SNAPSHOT_VERSION,
    commitSha: String(options.commitSha || gitCommitSha(root, options.env)).trim() || "unavailable",
    sourceTreeSha256: sourceTree.sha256,
    sourceFileCount: Number(sourceTree.files || 0),
    packageSha256: sha256(canonicalJson(pkg)),
    dataSha256: sha256(canonicalJson(data)),
    profile: String(options.profile || "demo"),
    configFile: path.basename(String(options.configFile || ".env.example")),
    dataFile: path.basename(String(options.dataFile || "data/db.json"))
  };
}

function compareAuditSourceSnapshots(expected, current) {
  const fields = ["version", "commitSha", "sourceTreeSha256", "packageSha256", "dataSha256", "profile", "configFile", "dataFile"];
  const mismatches = [];
  if (!expected || typeof expected !== "object") {
    return { matches: false, mismatches: ["missing-source-snapshot"] };
  }
  fields.forEach((field) => {
    if (String(expected[field] ?? "") !== String(current?.[field] ?? "")) mismatches.push(field);
  });
  return { matches: mismatches.length === 0, mismatches };
}

module.exports = {
  SNAPSHOT_VERSION,
  buildAuditSourceSnapshot,
  canonicalJson,
  compareAuditSourceSnapshots,
  sourceTreeDigest,
  trackedSourceFiles
};
