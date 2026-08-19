"use strict";

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_CONTRACT_FILE = path.resolve(__dirname, "../../config/static-publication.json");

function toPosix(value) {
  return String(value || "").replace(/\\/g, "/");
}

function normalizeRelativePath(value) {
  const normalized = path.posix.normalize(toPosix(value).replace(/^\/+/, ""));
  if (!normalized || normalized === "." || normalized === ".." || normalized.startsWith("../")) return "";
  return normalized;
}

function loadStaticPublicationContract(file = DEFAULT_CONTRACT_FILE) {
  const contract = JSON.parse(fs.readFileSync(file, "utf8"));
  if (contract.schemaVersion !== 1) throw new Error("Unsupported static publication contract schema");
  if (!Array.isArray(contract.entrypoints) || !contract.entrypoints.length) throw new Error("Static publication contract requires entrypoints");
  return contract;
}

function isGeneratedAsset(relativePath, contract) {
  return Object.prototype.hasOwnProperty.call(contract.generatedAssets || {}, relativePath);
}

function isProhibited(relativePath, contract) {
  const lower = relativePath.toLowerCase();
  if ((contract.prohibitedFiles || []).some((file) => lower === file.toLowerCase())) return true;
  return (contract.prohibitedPrefixes || []).some((prefix) => lower.startsWith(prefix.toLowerCase()));
}

function isExplicitAsset(relativePath, contract) {
  return [...(contract.entrypoints || []), ...(contract.seedAssets || [])]
    .map(normalizeRelativePath)
    .includes(relativePath);
}

function assertPublishable(relativePath, contract) {
  if (!relativePath) throw new Error("Static asset path is empty or escapes the repository");
  if (isGeneratedAsset(relativePath, contract)) return;
  if (isProhibited(relativePath, contract) && !isExplicitAsset(relativePath, contract)) {
    throw new Error(`Static asset is prohibited: ${relativePath}`);
  }
  const extension = path.posix.extname(relativePath).toLowerCase();
  if (!(contract.allowedExtensions || []).includes(extension)) {
    throw new Error(`Static asset extension is not allowed: ${relativePath}`);
  }
}

function hasPublishableExtension(relativePath, contract) {
  return (contract.allowedExtensions || []).includes(path.posix.extname(relativePath).toLowerCase());
}

function cleanReference(reference) {
  const raw = String(reference || "").trim();
  if (!raw || raw.startsWith("#") || /^(?:https?:|data:|mailto:|tel:|javascript:|\/\/)/i.test(raw)) return "";
  const withoutSuffix = raw.split(/[?#]/, 1)[0];
  if (!withoutSuffix || withoutSuffix.startsWith("/api/")) return "";
  try {
    return decodeURIComponent(withoutSuffix);
  } catch {
    throw new Error(`Static asset reference cannot be decoded: ${raw}`);
  }
}

function resolveReference(fromFile, reference, contract) {
  const cleaned = cleanReference(reference);
  if (!cleaned) return "";
  if (cleaned === "/") return contract.defaultDocument;
  const target = cleaned.endsWith("/") ? `${cleaned}${contract.defaultDocument}` : cleaned;
  const relative = target.startsWith("/")
    ? normalizeRelativePath(target)
    : normalizeRelativePath(path.posix.join(path.posix.dirname(fromFile), toPosix(target)));
  return relative;
}

function matchesFrom(content, expression) {
  const matches = [];
  for (const match of content.matchAll(expression)) matches.push(match[1]);
  return matches;
}

function manifestReferences(content) {
  const manifest = JSON.parse(content);
  return [
    manifest.start_url,
    ...(Array.isArray(manifest.icons) ? manifest.icons.map((icon) => icon && icon.src) : [])
  ].filter(Boolean);
}

function extractStaticReferences(relativePath, content) {
  const extension = path.posix.extname(relativePath).toLowerCase();
  if (extension === ".html") {
    return matchesFrom(content, /\b(?:href|poster|src)\s*=\s*["']([^"'<>]+)["']/gi);
  }
  if (extension === ".css") {
    return [
      ...matchesFrom(content, /url\(\s*["']?([^"')]+)["']?\s*\)/gi),
      ...matchesFrom(content, /@import\s+["']([^"']+)["']/gi)
    ];
  }
  if (extension === ".webmanifest") return manifestReferences(content);
  if (path.posix.basename(relativePath) === "service-worker.js") {
    return matchesFrom(content, /["'`]((?:\.{0,2}\/|\/)[^"'`]+)["'`]/g);
  }
  if (extension === ".js") {
    return [
      ...matchesFrom(content, /(?:importScripts|register|Worker)\s*\(\s*["'`]([^"'`]+)["'`]/g),
      ...matchesFrom(content, /(?:import|export)\s+(?:[^"'`]+?\s+from\s+)?["'`]([^"'`]+)["'`]/g)
    ];
  }
  return [];
}

function collectPublicAssets(root, contract = loadStaticPublicationContract()) {
  const repositoryRoot = path.resolve(root);
  const realRepositoryRoot = fs.realpathSync(repositoryRoot);
  const generated = new Set(Object.keys(contract.generatedAssets || {}).map(normalizeRelativePath));
  const queued = [...contract.entrypoints, ...(contract.seedAssets || [])].map(normalizeRelativePath);
  const assets = new Set();

  while (queued.length) {
    const relativePath = queued.shift();
    if (!relativePath || assets.has(relativePath)) continue;
    assertPublishable(relativePath, contract);
    assets.add(relativePath);
    if (generated.has(relativePath)) continue;

    const absolutePath = path.resolve(repositoryRoot, ...relativePath.split("/"));
    if (!fs.existsSync(absolutePath)) throw new Error(`Static asset is missing: ${relativePath}`);
    const realPath = fs.realpathSync(absolutePath);
    const realRelativePath = path.relative(realRepositoryRoot, realPath);
    if (realRelativePath.startsWith("..") || path.isAbsolute(realRelativePath) || !fs.statSync(realPath).isFile()) {
      throw new Error(`Static asset is missing: ${relativePath}`);
    }
    const content = fs.readFileSync(realPath, "utf8");
    extractStaticReferences(relativePath, content).forEach((reference) => {
      const resolved = resolveReference(relativePath, reference, contract);
      if (!resolved || assets.has(resolved)) return;
      if (!hasPublishableExtension(resolved, contract) && !generated.has(resolved)) return;
      assertPublishable(resolved, contract);
      queued.push(resolved);
    });
  }

  generated.forEach((relativePath) => {
    assertPublishable(relativePath, contract);
    assets.add(relativePath);
  });
  return Object.freeze([...assets].sort());
}

function createStaticAssetPolicy(options = {}) {
  const root = path.resolve(options.root || path.resolve(__dirname, "../.."));
  const contract = options.contract || loadStaticPublicationContract(options.contractFile);
  const assets = options.assets || collectPublicAssets(root, contract);
  const allowed = new Set(assets);

  function evaluate(requestPath) {
    let decoded;
    try {
      decoded = decodeURIComponent(String(requestPath || "/").split(/[?#]/, 1)[0]);
    } catch {
      return { allowed: false, code: "INVALID_PATH", relativePath: "" };
    }
    const requested = decoded === "/"
      ? contract.defaultDocument
      : (decoded.endsWith("/") ? `${decoded}${contract.defaultDocument}` : decoded);
    const relativePath = normalizeRelativePath(requested);
    if (!relativePath || !allowed.has(relativePath)) {
      return { allowed: false, code: "NOT_PUBLISHED", relativePath };
    }
    return {
      allowed: true,
      code: isGeneratedAsset(relativePath, contract) ? "GENERATED_ASSET" : "PUBLISHED_ASSET",
      generated: isGeneratedAsset(relativePath, contract),
      relativePath
    };
  }

  return Object.freeze({ assets, contract, evaluate, root });
}

module.exports = {
  assertPublishable,
  collectPublicAssets,
  createStaticAssetPolicy,
  extractStaticReferences,
  loadStaticPublicationContract,
  normalizeRelativePath,
  resolveReference
};
