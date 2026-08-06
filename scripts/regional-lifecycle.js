#!/usr/bin/env node
"use strict";

const path = require("node:path");
const {
  applyTestActivation,
  planTestActivation,
  regionalPortfolio
} = require("../src/platform/regional/region-lifecycle");

const ROOT = path.resolve(__dirname, "..");

function parseArgs(argv = process.argv.slice(2)) {
  const [command = "inventory", ...items] = argv;
  if (!["inventory", "enable-test"].includes(command)) {
    throw new TypeError(`unsupported regional lifecycle command: ${command}`);
  }
  const flags = {};
  items.forEach((item) => {
    if (!item.startsWith("--")) throw new TypeError(`unsupported argument: ${item}`);
    const [key, ...parts] = item.slice(2).split("=");
    if (!["region", "write"].includes(key)) throw new TypeError(`unsupported regional lifecycle flag: --${key}`);
    if (Object.prototype.hasOwnProperty.call(flags, key)) {
      throw new TypeError(`duplicate regional lifecycle flag: --${key}`);
    }
    if (key === "write" && parts.length > 0) {
      throw new TypeError("regional lifecycle flag --write does not accept a value");
    }
    flags[key] = parts.length > 0 ? parts.join("=") : true;
  });
  if (command === "inventory" && Object.keys(flags).length > 0) {
    throw new TypeError("regional lifecycle inventory does not accept flags");
  }
  return { command, flags };
}

function runCli(argv = process.argv.slice(2), options = {}) {
  const { command, flags } = parseArgs(argv);
  let result;
  if (command === "inventory") {
    result = regionalPortfolio({ root: options.root || ROOT });
  } else {
    const plan = planTestActivation({
      root: options.root || ROOT,
      regionCode: flags.region
    });
    result = flags.write === true ? applyTestActivation(plan) : plan;
  }
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
  parseArgs,
  runCli
};
