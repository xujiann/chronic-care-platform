#!/usr/bin/env node
"use strict";

const path = require("node:path");
const {
  applyRegionScaffold,
  buildRegionScaffoldPlan,
  validateRegisteredRegionPackage
} = require("../src/platform/regional/region-scaffold");

const ROOT = path.resolve(__dirname, "..");
const ALLOWED_FLAGS = new Set(["region", "name", "level", "parent", "write", "validate"]);
const BOOLEAN_FLAGS = new Set(["write", "validate"]);

function parseArgs(argv = process.argv.slice(2)) {
  const flags = {};
  argv.forEach((item) => {
    if (!item.startsWith("--")) throw new TypeError(`unsupported argument: ${item}`);
    const [key, ...parts] = item.slice(2).split("=");
    if (!ALLOWED_FLAGS.has(key)) throw new TypeError(`unsupported regional scaffold flag: --${key}`);
    if (Object.prototype.hasOwnProperty.call(flags, key)) {
      throw new TypeError(`duplicate regional scaffold flag: --${key}`);
    }
    if (BOOLEAN_FLAGS.has(key) && parts.length > 0) {
      throw new TypeError(`regional scaffold flag --${key} does not accept a value`);
    }
    flags[key] = parts.length > 0 ? parts.join("=") : true;
  });
  return flags;
}

function runCli(argv = process.argv.slice(2), options = {}) {
  const flags = parseArgs(argv);
  if (flags.validate === true) {
    if (flags.write === true) throw new TypeError("--validate and --write cannot be combined");
    const validation = validateRegisteredRegionPackage({
      root: options.root || ROOT,
      regionCode: flags.region
    });
    const output = `${JSON.stringify(validation, null, 2)}\n`;
    if (options.stdout) options.stdout.write(output);
    else process.stdout.write(output);
    return validation;
  }
  const plan = buildRegionScaffoldPlan({
    root: options.root || ROOT,
    regionCode: flags.region,
    name: flags.name,
    level: flags.level,
    parentCode: flags.parent
  });
  const result = flags.write === true ? applyRegionScaffold(plan) : plan;
  const output = `${JSON.stringify(result, null, 2)}\n`;
  if (options.stdout) options.stdout.write(output);
  else process.stdout.write(output);
  return result;
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
  ALLOWED_FLAGS,
  BOOLEAN_FLAGS,
  parseArgs,
  runCli
};
