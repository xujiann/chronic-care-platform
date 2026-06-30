const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { buildIdentityContract, parseArgs, renderMarkdown, writeOutput } = require("../scripts/identity-contract");

const ROOT = path.resolve(__dirname, "..");

test("identity contract validates required claims, roles and sample mappings", () => {
  const contract = buildIdentityContract();
  assert.equal(contract.ok, true);
  assert.equal(contract.checks.every((item) => item.passed), true);
  assert.equal(contract.requiredClaims.some((item) => item.claim === "sub" && item.required), true);
  assert.equal(contract.requiredClaims.some((item) => item.claim === "orgCode" && item.required), true);
  assert.equal(contract.roleCoverage.commission.users >= 1, true);
  assert.equal(contract.roleCoverage.institution.users >= 1, true);
  assert.equal(contract.roleCoverage.insurance.users >= 1, true);
  assert.equal(contract.roleCoverage.citizen.users >= 1, true);
  assert.equal(contract.roleCoverage.county.users >= 1, true);
  assert.equal(contract.sampleMappings.every((item) => item.passed), true);
  assert.equal(contract.sampleMappings.find((item) => item.id === "identity-institution").mappedHome, "doctor.html");
});

test("identity contract renders and writes release artifacts", (t) => {
  const outputDir = path.join(ROOT, "tmp", "identity-contract-test");
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
  const contract = buildIdentityContract();
  const markdown = renderMarkdown(contract);
  assert.match(markdown, /Identity integration contract/);
  assert.match(markdown, /Required external claims/);
  assert.match(markdown, /Sample mappings/);

  writeOutput(contract, {
    output: path.join("tmp", "identity-contract-test", "identity-contract.json"),
    markdown: path.join("tmp", "identity-contract-test", "identity-contract.md")
  });

  const writtenJson = JSON.parse(fs.readFileSync(path.join(outputDir, "identity-contract.json"), "utf8"));
  const writtenMarkdown = fs.readFileSync(path.join(outputDir, "identity-contract.md"), "utf8");
  assert.equal(writtenJson.ok, true);
  assert.match(writtenMarkdown, /identity-commission/);
});

test("identity contract CLI parser keeps output flags", () => {
  const parsed = parseArgs(["--output=release/identity-contract.json", "--markdown=release/identity-contract.md"]);
  assert.equal(parsed.output, "release/identity-contract.json");
  assert.equal(parsed.markdown, "release/identity-contract.md");
});
