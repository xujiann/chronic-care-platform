#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { buildCompositeRegionalRelease } = require("../src/platform/regional/composite-release");
const { buildFleetStatus } = require("../src/platform/regional/multi-region-operations");
const {
  applyTransitionPlanToRegistry,
  buildReleaseBindingFromComposite,
  buildTransitionPlan,
  createEmptyRegistry,
  summarizeRegistry
} = require("../src/platform/regional/regional-release-governance");
const { loadRegionalRuntime } = require("../src/platform/regional/regional-runtime");
const { buildSiteDeploymentPlan } = require("../src/platform/regional/site-deployment-plan");
const {
  buildPostgresPrimaryStorageConfig
} = require("../src/platform/storage/postgres-primary-storage-contract");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_JSON = path.join(ROOT, "release", "regional-replication-exercise.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "regional-replication-exercise.md");
const DEFAULT_DESCRIPTOR = path.join(ROOT, "config", "regional-replication-sites.json");

function deploymentDescriptor(options = {}) {
  const descriptorPath = path.resolve(options.descriptorPath || DEFAULT_DESCRIPTOR);
  return JSON.parse(fs.readFileSync(descriptorPath, "utf8"));
}

function registerValidationReleases(plan, options = {}) {
  let registry = createEmptyRegistry();
  const registered = [];
  plan.sites.forEach((site, index) => {
    const composite = buildCompositeRegionalRelease({
      root: options.root || ROOT,
      regionCode: site.regionCode,
      generatedAt: options.generatedAt
    });
    const release = buildReleaseBindingFromComposite(composite, {
      root: options.root || ROOT,
      platformDigest: plan.sourceBinding.coreIdentityDigest,
      dataImpact: "none"
    });
    for (const [offset, toState] of ["draft", "validation"].entries()) {
      const recordedAt = new Date(Date.parse(options.generatedAt) + ((index * 2 + offset + 1) * 1000)).toISOString();
      const transition = buildTransitionPlan(registry, {
        release,
        toState,
        actor: "replication-exercise",
        reason: `synthetic two-region exercise ${toState}`,
        recordedAt
      });
      registry = applyTransitionPlanToRegistry(registry, transition).registry;
    }
    registered.push({
      regionCode: site.regionCode,
      releaseId: release.releaseId,
      identityDigest: release.identityDigest,
      state: "validation"
    });
  });
  return { registry, registered };
}

function buildExercise(options = {}) {
  const root = options.root || ROOT;
  const generatedAt = options.generatedAt || new Date().toISOString();
  const descriptor = options.descriptor || deploymentDescriptor({ descriptorPath: options.descriptorPath });
  const plan = buildSiteDeploymentPlan(descriptor, {
    root,
    generatedAt,
    gitCommit: options.gitCommit
  });
  const productionSite = plan.sites.find((site) => site.stage === "production");
  const validationSite = plan.sites.find((site) => site.deploymentClass === "test");
  if (!productionSite || !validationSite) {
    throw new Error("replication exercise requires one production candidate and one validation fixture");
  }
  const productionRuntime = loadRegionalRuntime({
    root,
    env: {
      NODE_ENV: "production",
      REGION_CODE: productionSite.regionCode,
      REGION_DEPLOYMENT_CLASS: "production",
      REGION_CONTENT_DIGEST: productionSite.sourceBinding.regionalContentDigest
    }
  });
  const validationRuntime = loadRegionalRuntime({
    root,
    env: {
      NODE_ENV: "validation",
      REGION_CODE: validationSite.regionCode,
      REGION_DEPLOYMENT_CLASS: "test",
      REGION_CONTENT_DIGEST: validationSite.sourceBinding.regionalContentDigest
    }
  });
  let testProductionBlocked = false;
  try {
    loadRegionalRuntime({
      root,
      env: {
        NODE_ENV: "production",
        REGION_CODE: validationSite.regionCode,
        REGION_DEPLOYMENT_CLASS: "test",
        REGION_CONTENT_DIGEST: validationRuntime.context.contentDigest
      }
    });
  } catch (error) {
    testProductionBlocked = /cannot run in production/.test(error.message);
  }
  const governance = registerValidationReleases(plan, { root, generatedAt });
  const governanceSummary = summarizeRegistry(governance.registry);
  const fleet = buildFleetStatus({ root, env: {}, receipts: [], now: generatedAt });
  const postgres = buildPostgresPrimaryStorageConfig({});
  const checks = [
    {
      id: "replication:singleCore",
      passed: plan.sites.every((site) => site.sourceBinding.gitCommit === plan.sourceBinding.gitCommit
        && site.sourceBinding.coreIdentityDigest === plan.sourceBinding.coreIdentityDigest),
      detail: `${plan.sites.length} sites share one immutable core identity`
    },
    {
      id: "replication:independentRegionalContent",
      passed: productionRuntime.context.contentDigest !== validationRuntime.context.contentDigest,
      detail: "regional content digests are independent"
    },
    {
      id: "replication:organizationIsolation",
      passed: productionRuntime.publicContext.organizations.centralHospital.name
        !== validationRuntime.publicContext.organizations.centralHospital.name,
      detail: "organization names are resolved from each regional context"
    },
    {
      id: "replication:resourceIsolation",
      passed: plan.resourceConflictChecks.passed
        && plan.resourceConflictChecks.conflicts.length === 0
        && new Set(plan.sites.map((site) => site.runtime.serviceUser)).size === plan.sites.length,
      detail: "ports, paths, buckets, clients, services and users are unique"
    },
    {
      id: "replication:activationLocks",
      passed: plan.sites.every((site) => site.activation.REGION_CODE === site.regionCode
        && site.activation.REGION_CONTENT_DIGEST === site.sourceBinding.regionalContentDigest),
      detail: "each runtime activation is digest-pinned"
    },
    {
      id: "replication:testProductionGuard",
      passed: testProductionBlocked,
      detail: "validation fixture is rejected by production runtime"
    },
    {
      id: "replication:releaseGovernance",
      passed: governanceSummary.ok
        && governanceSummary.releases.length === 2
        && governanceSummary.releases.every((release) => release.state === "validation"),
      detail: "both immutable releases reached validation without production authorization"
    },
    {
      id: "replication:operationsInventory",
      passed: fleet.summary.sites === 2
        && fleet.containsBusinessData === false
        && fleet.probeTargetsExposed === false,
      detail: "fleet control plane contains only minimized deployment metadata"
    },
    {
      id: "replication:storageDefault",
      passed: postgres.mode === "disabled"
        && postgres.productionPrimary === false
        && postgres.runtimeCutoverEnabled === false,
      detail: "PostgreSQL primary storage remains fail-closed by default"
    },
    {
      id: "replication:productionBoundary",
      passed: plan.productionReady === false
        && governanceSummary.productionReady === false
        && fleet.productionReady === false,
      detail: "repository exercise cannot manufacture site approval"
    }
  ];
  return {
    schemaVersion: "regional-replication-exercise-v1",
    generatedAt,
    ok: checks.every((check) => check.passed),
    technicalReady: checks.every((check) => check.passed),
    productionReady: false,
    topology: plan.topology,
    sourceBinding: plan.sourceBinding,
    sites: plan.sites.map((site) => ({
      siteId: site.siteId,
      regionCode: site.regionCode,
      deploymentClass: site.deploymentClass,
      stage: site.stage,
      serviceName: site.serviceName,
      serviceUser: site.runtime.serviceUser,
      compositeReleaseId: site.sourceBinding.compositeReleaseId,
      regionalContentDigest: site.sourceBinding.regionalContentDigest,
      productionReady: false
    })),
    governance: {
      registryDigest: governanceSummary.registryDigest,
      eventCount: governanceSummary.eventCount,
      releases: governanceSummary.releases,
      productionReady: false
    },
    operations: fleet.summary,
    checks,
    externalBlockers: [
      "second real region organization and policy data",
      "real identity and hospital-system joint testing",
      "production PostgreSQL capacity, failover and restore evidence",
      "regional security and commercial-cryptography assessment",
      "staffed monitoring, disaster recovery and signed site approval"
    ]
  };
}

function renderMarkdown(report) {
  return [
    "# 第二地区复制演练报告",
    "",
    `- Generated at: ${report.generatedAt}`,
    `- Technical ready: ${report.technicalReady ? "yes" : "no"}`,
    "- Production ready: no",
    `- Core identity: \`${report.sourceBinding.coreIdentityDigest}\``,
    "",
    "## 地区实例",
    "",
    "| 地区 | 环境/类别 | 服务 | 运行账号 | 组合发布 |",
    "| --- | --- | --- | --- | --- |",
    ...report.sites.map((site) =>
      `| ${site.regionCode} | ${site.stage}/${site.deploymentClass} | ${site.serviceName} | ${site.serviceUser} | ${site.compositeReleaseId} |`
    ),
    "",
    "## 验证结果",
    "",
    "| 状态 | 检查 | 说明 |",
    "| --- | --- | --- |",
    ...report.checks.map((check) => `| ${check.passed ? "PASS" : "FAIL"} | ${check.id} | ${check.detail} |`),
    "",
    "## 外部阻断项",
    "",
    ...report.externalBlockers.map((item) => `- ${item}`),
    ""
  ].join("\n");
}

function writeExercise(report, options = {}) {
  const output = path.resolve(options.output || DEFAULT_JSON);
  const markdown = path.resolve(options.markdown || DEFAULT_MARKDOWN);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.mkdirSync(path.dirname(markdown), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(markdown, renderMarkdown(report), "utf8");
  return { output, markdown };
}

function runCli() {
  const report = buildExercise();
  const written = writeExercise(report);
  process.stdout.write(`${JSON.stringify({ ...written, ok: report.ok, productionReady: false }, null, 2)}\n`);
  if (!report.ok) process.exitCode = 1;
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
  buildExercise,
  deploymentDescriptor,
  registerValidationReleases,
  renderMarkdown,
  runCli,
  writeExercise
};
