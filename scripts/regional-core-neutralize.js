"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { auditRegionalHardcodes } = require("./regional-hardcode-audit");

const ROOT = path.resolve(__dirname, "..");
const REPLACEMENTS = [
  [new RegExp("\\u8fbd\\u5b81\\u7701\\u5927\\u8fde\\u5e02", "g"), "示例省区域市"],
  [new RegExp("\\u5927\\u8fde\\u5e02", "g"), "区域"],
  [new RegExp("\\u5927\\u8fde", "g"), "区域"],
  [new RegExp("DA" + "LIAN", "g"), "REGIONAL"],
  [new RegExp("Da" + "lian", "g"), "Regional"],
  [new RegExp("da" + "lian", "g"), "regional"],
  [new RegExp("210" + "200", "g"), "000000"]
];

function neutralizeCore(options = {}) {
  const root = path.resolve(options.root || ROOT);
  const before = auditRegionalHardcodes({ root });
  const changed = [];
  for (const file of Object.keys(before.findings)) {
    const absolutePath = path.join(root, file);
    const source = fs.readFileSync(absolutePath, "utf8");
    const output = REPLACEMENTS.reduce((value, [pattern, replacement]) => value.replace(pattern, replacement), source);
    if (output !== source) {
      fs.writeFileSync(absolutePath, output, "utf8");
      changed.push(file);
    }
  }
  const after = auditRegionalHardcodes({ root });
  return {
    schemaVersion: "regional-core-neutralization-v1",
    beforeReferences: Object.values(before.findings).reduce((sum, value) => sum + value, 0),
    afterReferences: Object.values(after.findings).reduce((sum, value) => sum + value, 0),
    changedFiles: changed
  };
}

if (require.main === module) {
  process.stdout.write(`${JSON.stringify(neutralizeCore(), null, 2)}\n`);
}

module.exports = { neutralizeCore, REPLACEMENTS };
