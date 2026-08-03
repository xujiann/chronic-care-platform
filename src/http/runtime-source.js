"use strict";

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_ROOT = path.resolve(__dirname, "..", "..");

function routeSourceFiles(root = DEFAULT_ROOT) {
  const routeDirectory = path.join(root, "src", "http", "routes");
  if (!fs.existsSync(routeDirectory)) return [];
  return fs.readdirSync(routeDirectory)
    .filter((file) => file.endsWith(".js"))
    .sort()
    .map((file) => path.join(routeDirectory, file));
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
