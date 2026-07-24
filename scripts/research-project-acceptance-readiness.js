"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  buildResearchProjectAcceptanceCenter,
  renderResearchProjectAcceptanceMarkdown
} = require("../research-project-acceptance");

const ROOT = path.resolve(__dirname, "..");

function parseArgs(argv = process.argv.slice(2)) {
  return Object.fromEntries(argv.filter((arg) => arg.startsWith("--") && arg.includes("=")).map((arg) => {
    const [key, ...parts] = arg.slice(2).split("=");
    return [key, parts.join("=")];
  }));
}

function writeOutput(center, options = {}) {
  const output = path.resolve(ROOT, options.output || "release/research-project-acceptance.json");
  const markdown = path.resolve(ROOT, options.markdown || "release/research-project-acceptance.md");
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.mkdirSync(path.dirname(markdown), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(center, null, 2)}\n`, "utf8");
  fs.writeFileSync(markdown, renderResearchProjectAcceptanceMarkdown(center), "utf8");
  return { output, markdown };
}

function main() {
  const args = parseArgs();
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "db.json"), "utf8"));
  const center = buildResearchProjectAcceptanceCenter(data);
  const files = writeOutput(center, args);
  process.stdout.write(`${JSON.stringify({ ok: center.ok, summary: center.summary, formalAcceptanceState: center.formalAcceptanceState, files }, null, 2)}\n`);
}

if (require.main === module) main();

module.exports = { parseArgs, writeOutput };
