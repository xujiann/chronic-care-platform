const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const INCLUDED_EXTENSIONS = new Set([".js", ".json", ".html", ".css", ".md", ".yml", ".yaml", ".cmd"]);
const SKIPPED_DIRECTORIES = new Set([".git", "node_modules", "tmp", "coverage", "playwright-report", "test-results"]);
const SECRET_PATTERNS = [
  ["private key", /-----BEGIN (?:RSA |OPENSSH |EC |DSA |PGP )?PRIVATE KEY-----/],
  ["GitHub token", /\bgh[pousr]_[A-Za-z0-9]{20,}\b/],
  ["OpenAI API key", /\bsk-[A-Za-z0-9_-]{20,}\b/],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/]
];

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (SKIPPED_DIRECTORIES.has(entry.name)) return [];
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(fullPath);
    return INCLUDED_EXTENSIONS.has(path.extname(entry.name).toLowerCase()) ? [fullPath] : [];
  });
}

test("repository source does not contain common committed secret formats", () => {
  const findings = [];
  sourceFiles(ROOT).forEach((file) => {
    if (!fs.existsSync(file)) return;
    const content = fs.readFileSync(file, "utf8");
    SECRET_PATTERNS.forEach(([label, pattern]) => {
      if (pattern.test(content)) findings.push(`${path.relative(ROOT, file)}: ${label}`);
    });
  });
  assert.deepEqual(findings, [], `发现疑似敏感信息：\n${findings.join("\n")}`);
});
