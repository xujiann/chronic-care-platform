const { readRuntimeSource } = require("../src/http/runtime-source");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  buildQualityOperationsGovernanceReadiness,
  renderMarkdown
} = require("../scripts/quality-operations-governance-readiness");

const ROOT = path.resolve(__dirname, "..");
const data = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "db.json"), "utf8"));
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const serverSource = readRuntimeSource(ROOT);

test("governance readiness requires three mapped collections routes and production blockers", () => {
  const report = buildQualityOperationsGovernanceReadiness({
    data,
    pkg: {
      ...pkg,
      scripts: {
        ...pkg.scripts,
        "quality-operations:governance-readiness": "node scripts/quality-operations-governance-readiness.js"
      }
    },
    serverSource
  });
  assert.equal(report.ok, true);
  assert.equal(report.productionReady, false);
  assert.equal(report.catalog.sourceCollections.length, 3);
  assert.equal(report.catalog.summary.unmapped, 0);
  assert.equal(report.routes.every((item) => item.registered), true);
  assert.match(renderMarkdown(report), /production database, SIEM/);
});

test("governance readiness fails when a public route is absent", () => {
  const report = buildQualityOperationsGovernanceReadiness({
    data,
    pkg: {
      ...pkg,
      scripts: {
        ...pkg.scripts,
        "quality-operations:governance-readiness": "node scripts/quality-operations-governance-readiness.js"
      }
    },
    serverSource: serverSource.replace("/api/quality-operations-governance/catalog", "/api/removed-governance-catalog")
  });
  assert.equal(report.ok, false);
  assert.equal(report.checks.find((item) => item.id === "governance:routes").passed, false);
});
