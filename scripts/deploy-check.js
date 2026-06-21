#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: ROOT, stdio: "pipe", shell: process.platform === "win32", encoding: "utf8" });
  return {
    command: [command, ...args].join(" "),
    status: result.status,
    ok: result.status === 0,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim()
  };
}

function assertFile(relativePath) {
  const file = path.join(ROOT, relativePath);
  return { name: `file:${relativePath}`, ok: fs.existsSync(file), detail: fs.existsSync(file) ? "present" : "missing" };
}

function main() {
  const pkg = readJson("package.json");
  const data = readJson("data/db.json");
  const requiredCollections = [
    "residents",
    "authUsers",
    "platformRoadmap",
    "institutionCreditEvaluations",
    "creditEvaluationRules",
    "researchDatasets",
    "diseaseRegistryModels",
    "mobileExperienceSettings",
    "accessibilityChecklist",
    "securityAcceptanceLedger"
  ];
  const checks = [
    assertFile("README.md"),
    assertFile("DEPLOYMENT.md"),
    assertFile("data/db.json"),
    assertFile("server.js"),
    assertFile("scripts/storage-admin.js"),
    { name: "package:scripts", ok: Boolean(pkg.scripts?.check && pkg.scripts?.test && pkg.scripts?.["test:coverage"] && pkg.scripts?.["test:e2e"] && pkg.scripts?.["env:check"] && pkg.scripts?.["release:report"]), detail: Object.keys(pkg.scripts || {}).join(",") },
    { name: "snapshot:collections", ok: requiredCollections.every((key) => data[key]), detail: requiredCollections.filter((key) => !data[key]).join(",") || "all present" },
    { name: "snapshot:p2-complete", ok: (data.platformRoadmap || []).filter((item) => item.priority === "P2").every((item) => item.status === "已完成"), detail: (data.platformRoadmap || []).filter((item) => item.priority === "P2").map((item) => `${item.title}:${item.status}`).join(";") },
    { name: "snapshot:accessibility", ok: Array.isArray(data.accessibilityChecklist) && data.accessibilityChecklist.length >= 5, detail: `${data.accessibilityChecklist?.length || 0} checklist items` },
    { name: "snapshot:storageMeta", ok: Boolean(data.storageMeta?.engine && data.storageMeta?.mode), detail: data.storageMeta ? `${data.storageMeta.engine}/${data.storageMeta.mode}` : "missing" }
  ];

  const runCommands = process.argv.includes("--run-commands");
  const commandResults = runCommands ? [
    run("npm.cmd", ["run", "check"]),
    run("npm.cmd", ["test"])
  ] : [];
  const allChecks = [...checks, ...commandResults.map((item) => ({ name: `command:${item.command}`, ok: item.ok, detail: item.ok ? "passed" : item.stderr || item.stdout }))];
  const report = {
    ok: allChecks.every((item) => item.ok),
    checkedAt: new Date().toISOString(),
    project: pkg.name,
    version: pkg.version,
    checks: allChecks
  };
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exit(1);
}

if (require.main === module) main();
