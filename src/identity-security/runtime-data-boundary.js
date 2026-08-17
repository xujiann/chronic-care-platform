"use strict";

const fs = require("node:fs");
const path = require("node:path");

function samePath(left, right) {
  const normalize = (value) => path.resolve(value).replace(/[\\/]+$/, "").toLowerCase();
  return normalize(left) === normalize(right);
}

function resolveRuntimeDataBoundary({ root, env = process.env } = {}) {
  if (!root) throw new TypeError("runtime data boundary requires root");
  const seedDirectory = path.join(path.resolve(root), "data");
  const seedFile = path.join(seedDirectory, "db.json");
  const runtimeDirectory = env.DATA_DIR
    ? path.resolve(env.DATA_DIR)
    : path.join(path.resolve(root), "var", "runtime");
  if (samePath(runtimeDirectory, seedDirectory)) {
    const error = new Error("DATA_DIR must not point at the tracked read-only seed directory");
    error.code = "TRACKED_SEED_RUNTIME_FORBIDDEN";
    throw error;
  }
  return {
    seedDirectory,
    seedFile,
    runtimeDirectory,
    runtimeFile: path.join(runtimeDirectory, "db.json"),
    sqliteFile: path.join(runtimeDirectory, "health-city.sqlite")
  };
}

function initializeRuntimeJson(boundary, fallbackFactory) {
  if (!boundary?.runtimeFile || !boundary?.seedFile) {
    throw new TypeError("runtime data boundary is incomplete");
  }
  fs.mkdirSync(boundary.runtimeDirectory, { recursive: true });
  if (fs.existsSync(boundary.runtimeFile)) return { created: false, source: "runtime" };
  if (fs.existsSync(boundary.seedFile)) {
    fs.copyFileSync(boundary.seedFile, boundary.runtimeFile, fs.constants.COPYFILE_EXCL);
    return { created: true, source: "tracked-seed" };
  }
  if (typeof fallbackFactory !== "function") {
    const error = new Error("read-only seed data is unavailable");
    error.code = "RUNTIME_SEED_UNAVAILABLE";
    throw error;
  }
  fs.writeFileSync(boundary.runtimeFile, JSON.stringify(fallbackFactory(), null, 2), {
    encoding: "utf8",
    flag: "wx"
  });
  return { created: true, source: "generated-seed" };
}

module.exports = {
  initializeRuntimeJson,
  resolveRuntimeDataBoundary,
  samePath
};
