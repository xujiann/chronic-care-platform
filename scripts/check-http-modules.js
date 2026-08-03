#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { routeSourceFiles } = require("../src/http/runtime-source");

const ROOT = path.resolve(__dirname, "..");

function javascriptFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return javascriptFiles(target);
    return entry.isFile() && entry.name.endsWith(".js") ? [target] : [];
  });
}

function httpModuleFiles(root = ROOT) {
  return [...new Set([
    path.join(root, "server.js"),
    path.join(root, "src", "http", "api-router.js"),
    path.join(root, "src", "http", "runtime-source.js"),
    path.join(root, "src", "http", "route-subdomains.js"),
    ...routeSourceFiles(root),
    ...javascriptFiles(path.join(root, "src", "http", "runtime-contexts")),
    ...javascriptFiles(path.join(root, "src", "http", "contracts"))
  ])].sort();
}

function checkHttpModules(root = ROOT) {
  const files = httpModuleFiles(root);
  for (const file of files) {
    const result = spawnSync(process.execPath, ["--check", file], { cwd: root, encoding: "utf8", windowsHide: true });
    if (result.status !== 0) {
      throw new Error(String(result.stderr || result.stdout || `syntax check failed: ${file}`).trim());
    }
  }
  return Object.freeze({ ok: true, files: files.length });
}

if (require.main === module) {
  try {
    process.stdout.write(`${JSON.stringify(checkHttpModules())}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { checkHttpModules, httpModuleFiles, javascriptFiles };
