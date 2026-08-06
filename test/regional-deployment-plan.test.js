"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  buildSiteDeploymentPlan,
  detectResourceConflicts,
  renderSiteDeploymentMarkdown,
  validateSiteDeploymentDescriptor
} = require("../src/platform/regional/site-deployment-plan");
const {
  parseArgs,
  writePlanArtifacts
} = require("../scripts/regional-deployment-plan");

const ROOT = path.resolve(__dirname, "..");
const GENERATED_AT = "2026-08-06T00:00:00.000Z";
const GIT_COMMIT = "a".repeat(40);

function descriptor(overrides = {}) {
  return {
    schemaVersion: "regional-site-deployment-set-v1",
    deploymentId: "regional-validation-test",
    sites: [
      {
        siteId: "synthetic-validation-a",
        regionCode: "990001",
        stage: "validation",
        hostId: "host-a",
        port: 3101,
        serviceName: "health-platform-990001",
        directories: {
          application: "/opt/health-platform/990001/current",
          data: "/var/lib/health-platform/990001",
          logs: "/var/log/health-platform/990001"
        },
        objectStorage: { bucket: "health-platform-990001" },
        identity: { oidcClientId: "health-platform-990001" },
        runtime: {
          containerImage: "health-platform:validation",
          nodeBinary: "/usr/bin/node",
          environmentFile: "/etc/health-platform/990001.env",
          serviceUser: "health_990001",
          serviceGroup: "health_990001"
        },
        ...overrides
      }
    ]
  };
}

test("deployment plan is deterministic and binds git, core and regional digests", () => {
  const first = buildSiteDeploymentPlan(descriptor(), {
    root: ROOT,
    generatedAt: GENERATED_AT,
    gitCommit: GIT_COMMIT
  });
  const second = buildSiteDeploymentPlan(descriptor(), {
    root: ROOT,
    generatedAt: GENERATED_AT,
    gitCommit: GIT_COMMIT
  });
  assert.deepEqual(first, second);
  assert.equal(first.technicalReady, true);
  assert.equal(first.productionReady, false);
  assert.equal(first.topology, "one-region-per-process");
  assert.equal(first.sourceBinding.gitCommit, GIT_COMMIT);
  assert.match(first.sourceBinding.coreIdentityDigest, /^sha256:[a-f0-9]{64}$/);
  assert.match(first.deploymentPlanDigest, /^sha256:[a-f0-9]{64}$/);
  assert.match(first.sites[0].sourceBinding.regionalContentDigest, /^sha256:[a-f0-9]{64}$/);
  assert.match(first.sites[0].sourceBinding.compositeReleaseDigest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(first.sites[0].activation.REGION_CODE, "990001");
  assert.equal(first.sites[0].activation.REGION_DEPLOYMENT_CLASS, "test");
});

test("site descriptor is secretless, strict and rejects test-to-production promotion", () => {
  assert.throws(
    () => validateSiteDeploymentDescriptor({
      ...descriptor(),
      clientSecret: "must-not-be-here"
    }),
    /prohibited sensitive field/
  );
  const productionAttempt = descriptor({ stage: "production" });
  assert.throws(
    () => buildSiteDeploymentPlan(productionAttempt, {
      root: ROOT,
      generatedAt: GENERATED_AT,
      gitCommit: GIT_COMMIT
    }),
    /test region 990001 cannot produce a production deployment plan/
  );
  const unsafePath = descriptor();
  unsafePath.sites[0].directories.data = "/var/lib/health platform/990001";
  assert.throws(
    () => validateSiteDeploymentDescriptor(unsafePath),
    /shell-safe absolute Linux path/
  );
});

test("production-class site can be rendered without manufacturing production readiness", () => {
  const production = descriptor({
    regionCode: "210200",
    stage: "production"
  });
  const plan = buildSiteDeploymentPlan(production, {
    root: ROOT,
    generatedAt: GENERATED_AT,
    gitCommit: GIT_COMMIT
  });
  assert.equal(plan.technicalReady, true);
  assert.equal(plan.productionReady, false);
  assert.equal(plan.sites[0].deploymentClass, "production");
  assert.equal(plan.sites[0].activation.NODE_ENV, "production");
  assert.equal(plan.sites[0].productionReady, false);
  assert.ok(plan.blockers.some((item) => /external evidence/.test(item)));
});

test("cross-site resource conflicts cover port, paths, bucket, OIDC client and service", () => {
  const first = descriptor().sites[0];
  const second = structuredClone(first);
  second.siteId = "synthetic-validation-b";
  const conflicts = detectResourceConflicts([first, second]);
  assert.deepEqual(
    new Set(conflicts.map((item) => item.kind)),
    new Set(["hostPort", "serviceName", "directory", "objectStorageBucket", "oidcClientId", "serviceUser"])
  );
  assert.throws(
    () => buildSiteDeploymentPlan({
      ...descriptor(),
      sites: [first, second]
    }, {
      root: ROOT,
      generatedAt: GENERATED_AT,
      gitCommit: GIT_COMMIT
    }),
    /site deployment resource conflicts/
  );
});

test("rendered systemd, activation and compose artifacts remain single-region and secretless", () => {
  const plan = buildSiteDeploymentPlan(descriptor(), {
    root: ROOT,
    generatedAt: GENERATED_AT,
    gitCommit: GIT_COMMIT
  });
  const site = plan.sites[0];
  assert.match(site.artifacts.systemd.content, /EnvironmentFile="\/etc\/health-platform\/990001\.env"/);
  assert.match(site.artifacts.systemd.content, /User=health_990001/);
  assert.match(site.artifacts.systemd.content, /ProtectHome=true/);
  assert.match(site.artifacts.systemd.content, /NoNewPrivileges=true/);
  assert.match(site.artifacts.activationEnvironment.content, /REGION_CODE=990001/);
  assert.match(site.artifacts.activationEnvironment.content, /REGION_DEPLOYMENT_CLASS=test/);
  assert.match(site.artifacts.validationCompose.content, /NODE_ENV: validation/);
  assert.match(site.artifacts.validationCompose.content, /REGION_CODE: 990001/);
  assert.doesNotMatch(JSON.stringify(plan), /CLIENT_SECRET|SESSION_SECRETS|PRIVATE KEY/);
  const markdown = renderSiteDeploymentMarkdown(plan);
  assert.match(markdown, /生产就绪：否/);
});

test("writer emits reproducible JSON, Markdown and per-site runtime files", () => {
  const plan = buildSiteDeploymentPlan(descriptor(), {
    root: ROOT,
    generatedAt: GENERATED_AT,
    gitCommit: GIT_COMMIT
  });
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "regional-deployment-plan-"));
  try {
    writePlanArtifacts(plan, temporary);
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(temporary, "deployment-plan.json"), "utf8")).deploymentPlanDigest,
      plan.deploymentPlanDigest
    );
    assert.match(fs.readFileSync(path.join(temporary, "deployment-plan.md"), "utf8"), /地区站点部署计划/);
    assert.equal(
      fs.readFileSync(path.join(temporary, plan.sites[0].artifacts.systemd.path), "utf8"),
      plan.sites[0].artifacts.systemd.content
    );
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test("CLI arguments require an explicit descriptor and keep write boolean", () => {
  assert.deepEqual(parseArgs([
    "--descriptor=deploy/validation/sites.example.json",
    "--write",
    "--output=example"
  ]), {
    descriptor: "deploy/validation/sites.example.json",
    write: true,
    output: "example"
  });
  assert.throws(() => parseArgs([]), /requires --descriptor/);
  assert.throws(() => parseArgs(["--descriptor=x", "--write=true"]), /does not accept a value/);
});
