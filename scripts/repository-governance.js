#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const CONFIG_PATH = path.join(ROOT, "config", "repository-governance.json");
const PROCESS_MANIFEST_PATH = path.join(ROOT, "config", "process-workstreams.json");

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function canonicalTextSha256(value) {
  return sha256(Buffer.isBuffer(value) ? value.toString("utf8").replace(/\r\n?/g, "\n") : String(value).replace(/\r\n?/g, "\n"));
}

function normalizePath(value) {
  return String(value || "").replaceAll("\\", "/").replace(/^\.\//, "");
}

function parseGitPaths(value) {
  return String(value || "").split("\0").map(normalizePath).filter(Boolean).sort();
}

function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function loadConfig(file = CONFIG_PATH) {
  const config = loadJson(file);
  if (config.schemaVersion !== "repository-governance-v1") {
    throw new Error(`unsupported repository governance contract: ${config.schemaVersion || "missing"}`);
  }
  return config;
}

function gitTracked(pattern, root = ROOT, includeUntracked = false) {
  const args = includeUntracked
    ? ["-c", "core.quotepath=false", "ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", pattern]
    : ["-c", "core.quotepath=false", "ls-files", "-z", "--", pattern];
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true
  });
  if (result.status !== 0) throw new Error(String(result.stderr || "git ls-files failed").trim());
  return parseGitPaths(result.stdout);
}

function ruleMatches(file, rule) {
  const exact = Array.isArray(rule.exactPaths) && rule.exactPaths.map(normalizePath).includes(file);
  const regex = Array.isArray(rule.regularExpressions)
    && rule.regularExpressions.some((source) => new RegExp(source, "u").test(file));
  return Boolean(exact || regex);
}

function classifyMarkdown(paths, markdownConfig) {
  const allowed = new Set(markdownConfig.classifications || []);
  if (!["current", "snapshot", "superseded"].every((item) => allowed.has(item)) || allowed.size !== 3) {
    throw new Error("markdown classifications must be exactly current, snapshot and superseded");
  }
  return [...new Set(paths.map(normalizePath))].sort().map((file) => {
    const matches = markdownConfig.rules.filter((rule) => ruleMatches(file, rule));
    if (matches.length !== 1) {
      throw new Error(`${file} must match exactly one markdown rule; matched ${matches.map((item) => item.id).join(", ") || "none"}`);
    }
    const classification = matches[0].classification;
    if (!allowed.has(classification)) throw new Error(`${matches[0].id} uses unsupported classification ${classification}`);
    return { path: file, classification, ruleId: matches[0].id };
  });
}

function digestPaths(paths) {
  return sha256(paths.join("\n"));
}

function buildMarkdownInventory(config, options = {}) {
  const paths = options.paths || gitTracked("*.md", options.root || ROOT, true);
  const readFile = options.readFile || ((file) => fs.readFileSync(path.join(options.root || ROOT, file)));
  const entries = classifyMarkdown(paths, config.markdown);
  const byClassification = {};
  config.markdown.classifications.forEach((classification) => {
    const classifiedPaths = entries.filter((item) => item.classification === classification).map((item) => item.path);
    byClassification[classification] = {
      count: classifiedPaths.length,
      pathDigest: digestPaths(classifiedPaths)
    };
  });
  const snapshotBindings = entries
    .filter((item) => item.classification === "snapshot")
    .map((item) => `${item.path}\0${canonicalTextSha256(readFile(item.path))}`);
  return {
    schemaVersion: config.markdown.schemaVersion,
    total: entries.length,
    pathDigest: digestPaths(entries.map((item) => item.path)),
    snapshotContentDigest: sha256(snapshotBindings.join("\n")),
    byClassification,
    entries
  };
}

function assertExpectedMarkdown(inventory, expected) {
  if (inventory.total !== expected.total) throw new Error(`tracked Markdown count drift: ${inventory.total} != ${expected.total}`);
  if (inventory.pathDigest !== expected.pathDigest) throw new Error("tracked Markdown path inventory drift");
  if (inventory.snapshotContentDigest !== expected.snapshotContentDigest) throw new Error("historical Markdown snapshot content drift");
  for (const classification of ["current", "snapshot", "superseded"]) {
    const actual = inventory.byClassification[classification];
    const wanted = expected.byClassification[classification];
    if (!wanted || actual.count !== wanted.count || actual.pathDigest !== wanted.pathDigest) {
      throw new Error(`${classification} Markdown inventory drift`);
    }
  }
}

function verifyAdrStatuses(inventory, options = {}) {
  const root = options.root || ROOT;
  inventory.entries
    .filter((item) => /^docs\/adr\/\d{4}-\d{2}-\d{2}-.+\.md$/.test(item.path))
    .forEach((item) => {
      const source = fs.readFileSync(path.join(root, item.path), "utf8");
      const status = /^(?:- 状态：|- Status: )(Proposed|Accepted|Rejected|Superseded|Deprecated)\s*$/m.exec(source)?.[1];
      if (!status) throw new Error(`${item.path} lacks a recognized ADR status`);
      if ((status === "Superseded") !== (item.classification === "superseded")) {
        throw new Error(`${item.path} ADR status and Markdown classification drift`);
      }
    });
}

function countPdfPages(buffer) {
  return (buffer.toString("latin1").match(/\/Type\s*\/Page(?!s)/g) || []).length;
}

function buildPdfInventory(config, options = {}) {
  const root = options.root || ROOT;
  const trackedPaths = options.paths || gitTracked("output/pdf/*.pdf", root);
  const configuredPaths = config.pdf.artifacts.map((item) => normalizePath(item.path)).sort();
  if (JSON.stringify(trackedPaths) !== JSON.stringify(configuredPaths)) {
    throw new Error("tracked PDF inventory differs from the governed artifact list");
  }
  if (config.pdf.manualEditAllowed !== false) throw new Error("tracked PDFs must prohibit manual editing");
  const entries = config.pdf.artifacts.map((artifact) => {
    if (!artifact.retentionReason || !/^[a-f0-9]{40}$/.test(artifact.introducedCommit || "")) {
      throw new Error(`${artifact.path} lacks retention or introducing commit provenance`);
    }
    if (artifact.generation?.status !== "untracked-historical") {
      throw new Error(`${artifact.path} must state the observed generator availability without guessing`);
    }
    if (!artifact.generation.producer || !artifact.generation.provenanceEvidence) {
      throw new Error(`${artifact.path} lacks generator provenance evidence`);
    }
    const sources = [artifact.generation.verifier, ...(artifact.generation.sourcePaths || [])].filter(Boolean);
    sources.forEach((source) => {
      if (!fs.existsSync(path.join(root, source))) throw new Error(`${artifact.path} source is missing: ${source}`);
    });
    const buffer = fs.readFileSync(path.join(root, artifact.path));
    const actual = {
      path: normalizePath(artifact.path),
      sha256: sha256(buffer),
      bytes: buffer.length,
      pages: countPdfPages(buffer)
    };
    if (actual.sha256 !== artifact.sha256 || actual.bytes !== artifact.bytes || actual.pages !== artifact.pages) {
      throw new Error(`${artifact.path} binary digest, size or page count drift`);
    }
    return actual;
  });
  return { schemaVersion: config.pdf.schemaVersion, manualEditAllowed: false, entries };
}

function verifyWorkflow(config, options = {}) {
  const root = options.root || ROOT;
  const processManifest = options.processManifest || loadJson(path.join(root, "config", "process-workstreams.json"));
  const iterationProgram = options.iterationProgram || loadJson(path.join(root, "config", "platform-iteration-program.json"));
  const workflow = config.workflow;
  if (processManifest.integrationBranch !== workflow.integrationBranch
    || processManifest.developmentBase !== workflow.developmentBase
    || processManifest.baselineTag !== workflow.evidenceBaselineTag
    || processManifest.developmentPolicy?.mergeDirection !== workflow.mergeDirection) {
    throw new Error("current process workflow drifted from the repository governance contract");
  }
  if (workflow.integrationBranch !== "main" || workflow.developmentBase !== "origin/main") {
    throw new Error("current development must target latest origin/main");
  }
  if (workflow.developmentBase === workflow.evidenceBaselineTag) {
    throw new Error("the evidence baseline tag cannot be the default development base");
  }
  if (iterationProgram.integrationBranch !== workflow.integrationBranch
    || iterationProgram.developmentBase !== workflow.developmentBase
    || iterationProgram.baselineTag !== workflow.evidenceBaselineTag
    || iterationProgram.baselinePurpose !== "reproducible-evidence-only") {
    throw new Error("platform iteration baseline purpose drifted from current workflow");
  }
  const agents = fs.readFileSync(path.join(root, "AGENTS.md"), "utf8");
  if (!agents.includes("default development base: latest fetched `origin/main`")
    || !agents.includes("reproducible evidence tag:")
    || agents.includes("process baseline:")) {
    throw new Error("AGENTS.md current workflow base is stale or ambiguous");
  }
  for (const snapshot of workflow.historicalSnapshots) {
    const contents = fs.readFileSync(path.join(root, snapshot.path));
    if (canonicalTextSha256(contents) !== snapshot.sha256) throw new Error(`historical workflow snapshot drift: ${snapshot.path}`);
  }
  return {
    integrationBranch: workflow.integrationBranch,
    developmentBase: workflow.developmentBase,
    evidenceBaselineTag: workflow.evidenceBaselineTag,
    mergeDirection: workflow.mergeDirection,
    historicalSnapshots: workflow.historicalSnapshots.length
  };
}

function buildRepositoryGovernanceReport(options = {}) {
  const config = options.config || loadConfig(options.configPath || CONFIG_PATH);
  const markdown = buildMarkdownInventory(config, options);
  if (!options.skipExpected) assertExpectedMarkdown(markdown, config.markdown.expected);
  verifyAdrStatuses(markdown, options);
  return {
    ok: true,
    schemaVersion: config.schemaVersion,
    workflow: verifyWorkflow(config, options),
    markdown,
    pdf: buildPdfInventory(config, options)
  };
}

function runCli() {
  const inventoryOnly = process.argv.includes("--inventory");
  const report = buildRepositoryGovernanceReport({ skipExpected: inventoryOnly });
  const verbose = process.argv.includes("--verbose");
  console.log(JSON.stringify(verbose ? report : {
    ...report,
    markdown: {
      ...report.markdown,
      entries: undefined
    }
  }, null, 2));
}

if (require.main === module) {
  try {
    runCli();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  assertExpectedMarkdown,
  buildMarkdownInventory,
  buildPdfInventory,
  buildRepositoryGovernanceReport,
  canonicalTextSha256,
  classifyMarkdown,
  countPdfPages,
  digestPaths,
  loadConfig,
  normalizePath,
  parseGitPaths,
  ruleMatches,
  sha256,
  verifyAdrStatuses,
  verifyWorkflow
};
