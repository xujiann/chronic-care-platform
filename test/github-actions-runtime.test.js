"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");

const PINNED_ACTIONS = Object.freeze({
  "actions/checkout": Object.freeze({ version: "v7", sha: "3d3c42e5aac5ba805825da76410c181273ba90b1" }),
  "actions/setup-node": Object.freeze({ version: "v7", sha: "820762786026740c76f36085b0efc47a31fe5020" }),
  "actions/configure-pages": Object.freeze({ version: "v6", sha: "45bfe0192ca1faeb007ade9deae92b16b8254a0d" }),
  "actions/upload-pages-artifact": Object.freeze({ version: "v5", sha: "fc324d3547104276b827a68afc52ff2a11cc49c9" }),
  "actions/deploy-pages": Object.freeze({ version: "v5", sha: "cd2ce8fcbc39b97be8ca5fce6e763baed58fa128" }),
  "actions/upload-artifact": Object.freeze({ version: "v7", sha: "043fb46d1a93c77aae656e7c1c64a875d1fc6a0a" })
});

function workflow(name) {
  return fs.readFileSync(path.join(ROOT, ".github", "workflows", name), "utf8");
}

function actionReferences(source) {
  return [...source.matchAll(/^\s*uses:\s+(actions\/[^@\s]+)@([^\s#]+)(?:\s+#\s*(v\d+))?\s*$/gm)].map((match) => ({
    action: match[1],
    reference: match[2],
    version: match[3] || ""
  }));
}

test("repository workflows pin official action versions to audited commit SHAs", () => {
  const ci = workflow("ci.yml");
  const pages = workflow("pages.yml");
  const references = actionReferences(`${ci}\n${pages}`);

  assert.equal(references.length, 18);
  assert.doesNotMatch(`${ci}\n${pages}`, /^\s*uses:\s+actions\/[^@\s]+@v\d+(?:\s+#.*)?$/gm);
  references.forEach(({ action, reference, version }) => {
    assert.ok(PINNED_ACTIONS[action], `unexpected GitHub Action: ${action}`);
    assert.match(reference, /^[a-f0-9]{40}$/, `${action} must use a full commit SHA`);
    assert.equal(reference, PINNED_ACTIONS[action].sha, `${action} pin drifted from the audited ${PINNED_ACTIONS[action].version} tag`);
    assert.equal(version, PINNED_ACTIONS[action].version, `${action} must retain its human-readable version comment`);
  });

  assert.match(ci, /node-version:\s*24/);
  assert.match(ci, /regional-foundation:/);
  assert.match(ci, /npm run regional:status -- --region=template/);
  assert.match(ci, /npm run regional:status -- --region=210200/);
});

test("Pages workflow keeps deployment permissions scoped to the deploy job", () => {
  const pages = workflow("pages.yml");

  assert.match(pages, /^permissions:\r?\n\s+contents:\s+read/m);
  assert.match(pages, /deploy:[\s\S]*permissions:\r?\n\s+pages:\s+write\r?\n\s+id-token:\s+write/);
  assert.match(pages, /environment:[\s\S]*name:\s+github-pages/);
  assert.match(pages, /concurrency:[\s\S]*cancel-in-progress:\s+false/);
});
