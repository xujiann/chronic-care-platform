#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const MANIFEST_PATH = path.join(ROOT, "config", "process-workstreams.json");

function loadManifest(file = MANIFEST_PATH) {
  const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
  if (manifest.schemaVersion !== "process-workstreams-v1") {
    throw new Error(`unsupported process manifest: ${manifest.schemaVersion || "missing"}`);
  }
  if (!manifest.integrationBranch || !manifest.baselineTag || !manifest.processes || !Array.isArray(manifest.protectedPaths)) {
    throw new Error("process manifest is incomplete");
  }
  return manifest;
}

function parseArgs(argv = process.argv.slice(2)) {
  const [command = "list", ...rawFlags] = argv;
  const flags = {};
  rawFlags.forEach((flag) => {
    if (!flag.startsWith("--")) return;
    const [key, ...parts] = flag.slice(2).split("=");
    flags[key] = parts.length ? parts.join("=") : true;
  });
  return { command, flags };
}

function normalizeProcessId(value) {
  const id = String(value || "").trim().toUpperCase();
  if (!/^T\d{2}$/.test(id)) throw new Error("process must use TNN format");
  return id;
}

function normalizeTopic(value) {
  const topic = String(value || "").trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(topic)) {
    throw new Error("topic must contain lowercase letters, digits, and single hyphens");
  }
  return topic;
}

function normalizeDate(value = new Date().toISOString().slice(0, 10).replaceAll("-", "")) {
  const date = String(value || "").trim();
  if (!/^\d{8}$/.test(date)) throw new Error("date must use YYYYMMDD");
  return date;
}

function normalizeRepoPath(value) {
  return String(value || "").replaceAll("\\", "/").replace(/^\.?\//, "");
}

function isWithin(parent, target) {
  const relative = path.relative(path.resolve(parent), path.resolve(target));
  return relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}

function git(args, options = {}) {
  const result = spawnSync("git", args, {
    cwd: options.cwd || ROOT,
    encoding: "utf8",
    windowsHide: true
  });
  if (options.allowFailure !== true && result.status !== 0) {
    throw new Error(String(result.stderr || result.stdout || `git ${args.join(" ")} failed`).trim());
  }
  return result;
}

function defaultWorktreeRoot(root = ROOT) {
  const commonDir = git(["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: root }).stdout.trim();
  const primaryRoot = path.dirname(commonDir);
  return path.join(path.dirname(primaryRoot), ".codex-platform-worktrees", "process-v1");
}

function buildWorktreePlan(options, manifest = loadManifest()) {
  const processId = normalizeProcessId(options.process);
  const process = manifest.processes[processId];
  if (!process) throw new Error(`unknown process: ${processId}`);
  const topic = normalizeTopic(options.topic);
  const date = normalizeDate(options.date);
  const base = String(options.base || manifest.baselineTag);
  const branch = `process/${processId.toLowerCase()}-${topic}-${date}`;
  const worktreeRoot = path.resolve(options.worktreeRoot || defaultWorktreeRoot(options.root || ROOT));
  const worktree = path.resolve(options.path || path.join(worktreeRoot, `${processId.toLowerCase()}-${topic}-${date}`));
  if (!isWithin(worktreeRoot, worktree)) throw new Error("worktree path must stay inside the configured worktree root");
  return {
    processId,
    processName: process.name,
    topic,
    date,
    base,
    branch,
    worktreeRoot,
    worktree,
    ownedRoutes: process.ownedRoutes
  };
}

function matchesPattern(file, pattern) {
  const normalizedFile = normalizeRepoPath(file);
  const normalizedPattern = normalizeRepoPath(pattern);
  if (normalizedPattern.endsWith("/**")) {
    const prefix = normalizedPattern.slice(0, -3);
    return normalizedFile === prefix || normalizedFile.startsWith(`${prefix}/`);
  }
  return normalizedFile === normalizedPattern;
}

function resolveProtectedOwner(file, manifest = loadManifest()) {
  return manifest.protectedPaths.find((entry) => matchesPattern(file, entry.pattern))?.owner || null;
}

function validateChanges(processIdValue, files, manifest = loadManifest()) {
  const processId = normalizeProcessId(processIdValue);
  if (!manifest.processes[processId]) throw new Error(`unknown process: ${processId}`);
  const normalizedFiles = [...new Set((files || []).map(normalizeRepoPath).filter(Boolean))].sort();
  const protectedFiles = normalizedFiles
    .map((file) => ({ file, owner: resolveProtectedOwner(file, manifest) }))
    .filter((entry) => entry.owner);
  const violations = processId === "T00"
    ? []
    : protectedFiles.filter((entry) => entry.owner !== processId);
  return {
    ok: violations.length === 0,
    processId,
    files: normalizedFiles,
    protectedFiles,
    violations
  };
}

function parseProcessBranch(branch, manifest = loadManifest()) {
  const value = String(branch || "").trim();
  if (value === manifest.integrationBranch || value === "main") {
    return { integration: true, branch: value, processId: "T00" };
  }
  const match = value.match(/^process\/(t\d{2})-([a-z0-9]+(?:-[a-z0-9]+)*)-(\d{8})$/);
  if (!match) return null;
  const processId = normalizeProcessId(match[1]);
  if (!manifest.processes[processId]) return null;
  return { integration: false, branch: value, processId, topic: match[2], date: match[3] };
}

function changedFiles(base, root = ROOT) {
  const files = new Set();
  const collect = (args) => {
    const result = git(args, { cwd: root, allowFailure: true });
    if (result.status !== 0) return;
    result.stdout.split(/\r?\n/).map(normalizeRepoPath).filter(Boolean).forEach((file) => files.add(file));
  };
  collect(["diff", "--name-only", `${base}...HEAD`]);
  collect(["diff", "--name-only"]);
  collect(["diff", "--name-only", "--cached"]);
  const untracked = git(["ls-files", "--others", "--exclude-standard"], { cwd: root, allowFailure: true });
  if (untracked.status === 0) {
    untracked.stdout.split(/\r?\n/).map(normalizeRepoPath).filter(Boolean).forEach((file) => files.add(file));
  }
  return [...files].sort();
}

function createWorktree(plan, root = ROOT) {
  git(["rev-parse", "--verify", `${plan.base}^{commit}`], { cwd: root });
  if (fs.existsSync(plan.worktree)) throw new Error(`worktree path already exists: ${plan.worktree}`);
  const branchExists = git(["show-ref", "--verify", "--quiet", `refs/heads/${plan.branch}`], { cwd: root, allowFailure: true }).status === 0;
  if (branchExists) throw new Error(`branch already exists: ${plan.branch}`);
  fs.mkdirSync(plan.worktreeRoot, { recursive: true });
  git(["worktree", "add", "-b", plan.branch, plan.worktree, plan.base], { cwd: root });
  return { ...plan, created: true };
}

function listProcesses(manifest) {
  return Object.entries(manifest.processes).map(([id, process]) => ({
    id,
    name: process.name,
    slug: process.slug,
    ownedRoutes: process.ownedRoutes
  }));
}

function runCli() {
  const { command, flags } = parseArgs();
  const manifest = loadManifest();
  if (command === "list") {
    console.log(JSON.stringify({
      integrationBranch: manifest.integrationBranch,
      baselineTag: manifest.baselineTag,
      branchPattern: manifest.branchPattern,
      processes: listProcesses(manifest)
    }, null, 2));
    return;
  }
  if (command === "plan" || command === "create") {
    const plan = buildWorktreePlan({
      process: flags.process,
      topic: flags.topic,
      date: flags.date,
      base: flags.base,
      path: flags.path,
      worktreeRoot: flags["worktree-root"],
      root: ROOT
    }, manifest);
    const result = command === "create" ? createWorktree(plan) : { ...plan, created: false };
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (command === "verify") {
    const branch = String(flags.branch || git(["branch", "--show-current"]).stdout).trim();
    const parsed = flags.process
      ? { integration: false, branch, processId: normalizeProcessId(flags.process) }
      : parseProcessBranch(branch, manifest);
    if (!parsed) throw new Error(`branch does not follow ${manifest.branchPattern}: ${branch || "(detached)"}`);
    if (parsed.integration) {
      console.log(JSON.stringify({ ok: true, skipped: true, branch, reason: "integration branch is governed by T00" }, null, 2));
      return;
    }
    const base = String(flags.base || manifest.baselineTag);
    git(["rev-parse", "--verify", `${base}^{commit}`]);
    const report = { branch, base, ...validateChanges(parsed.processId, changedFiles(base), manifest) };
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) process.exitCode = 1;
    return;
  }
  throw new Error("Usage: process-worktree.js list|plan|create|verify [--process=T04] [--topic=name] [--date=YYYYMMDD] [--base=tag]");
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
  buildWorktreePlan,
  changedFiles,
  createWorktree,
  defaultWorktreeRoot,
  isWithin,
  listProcesses,
  loadManifest,
  matchesPattern,
  normalizeDate,
  normalizeProcessId,
  normalizeTopic,
  parseArgs,
  parseProcessBranch,
  resolveProtectedOwner,
  validateChanges
};
