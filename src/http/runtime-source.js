"use strict";

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_ROOT = path.resolve(__dirname, "..", "..");

function routeSourceFiles(root = DEFAULT_ROOT) {
  const routeDirectory = path.join(root, "src", "http", "routes");
  if (!fs.existsSync(routeDirectory)) return [];
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (entry.isFile() && entry.name.endsWith(".js")) files.push(target);
    }
  };
  visit(routeDirectory);
  return files.sort();
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
  readRuntimeSource,
  routeSourceFiles,
  runtimeSourceFiles
};
