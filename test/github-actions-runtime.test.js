"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");

function workflow(name) {
  return fs.readFileSync(path.join(ROOT, ".github", "workflows", name), "utf8");
}

test("repository workflows use Node 24 compatible GitHub Actions", () => {
  const ci = workflow("ci.yml");
  const pages = workflow("pages.yml");

  assert.match(ci, /actions\/checkout@v7/);
  assert.match(ci, /actions\/setup-node@v7/);
  assert.match(ci, /node-version:\s*24/);
  assert.match(ci, /actions\/upload-artifact@v7/);

  assert.match(pages, /actions\/checkout@v7/);
  assert.match(pages, /actions\/configure-pages@v6/);
  assert.match(pages, /actions\/upload-pages-artifact@v5/);
  assert.match(pages, /actions\/deploy-pages@v5/);
  assert.doesNotMatch(`${ci}\n${pages}`, /uses:\s+actions\/[^@\s]+@v[1-4](?:\s|$)/);
});

test("Pages workflow keeps deployment permissions scoped to the deploy job", () => {
  const pages = workflow("pages.yml");

  assert.match(pages, /^permissions:\r?\n\s+contents:\s+read/m);
  assert.match(pages, /deploy:[\s\S]*permissions:\r?\n\s+pages:\s+write\r?\n\s+id-token:\s+write/);
  assert.match(pages, /environment:[\s\S]*name:\s+github-pages/);
  assert.match(pages, /concurrency:[\s\S]*cancel-in-progress:\s+false/);
});
