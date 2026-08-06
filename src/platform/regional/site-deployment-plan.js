"use strict";

const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { buildCompositeRegionalRelease } = require("./composite-release");
const {
  deepFreeze,
  resolveWithin,
  sha256,
  stableJson
} = require("./region-manifest");

const DESCRIPTOR_SCHEMA_VERSION = "regional-site-deployment-set-v1";
const PLAN_SCHEMA_VERSION = "regional-site-deployment-plan-v1";
const STAGES = Object.freeze(["validation", "production"]);
const SITE_ID_PATTERN = /^[a-z][a-z0-9-]{2,62}$/;
const SERVICE_NAME_PATTERN = /^[a-z][a-z0-9@_.-]{2,95}$/;
const HOST_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{1,127}$/;
const REGION_CODE_PATTERN = /^(?:template|\d{6})$/;
const IMAGE_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9./:_-]{2,255}(?:@sha256:[a-f0-9]{64})?$/;
const OIDC_CLIENT_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{2,255}$/;
const BUCKET_PATTERN = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const SERVICE_ACCOUNT_PATTERN = /^[a-z_][a-z0-9_-]{0,31}$/;
const GIT_COMMIT_PATTERN = /^[a-f0-9]{7,64}$/;
const SENSITIVE_KEY_PATTERN = /(?:password|passwd|token|secret|credential|private.?key|access.?key|api.?key|client.?secret)/i;
const SENSITIVE_VALUE_PATTERN = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;

function assertPlainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
}

function assertAllowedKeys(value, allowed, label) {
  assertPlainObject(value, label);
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) throw new TypeError(`${label} contains unsupported fields: ${unknown.join(", ")}`);
}

function assertNonSecret(value, location = "site deployment descriptor") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNonSecret(item, `${location}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, nested]) => {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        throw new TypeError(`${location}.${key} is a prohibited sensitive field`);
      }
      assertNonSecret(nested, `${location}.${key}`);
    });
    return;
  }
  if (typeof value === "string" && SENSITIVE_VALUE_PATTERN.test(value)) {
    throw new TypeError(`${location} contains private key material`);
  }
}

function assertString(value, pattern, label) {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function assertLinuxAbsolutePath(value, label) {
  if (typeof value !== "string"
    || !value.startsWith("/")
    || !/^\/[A-Za-z0-9._/-]+$/.test(value)
    || value.includes("\0")
    || /[\r\n]/.test(value)
    || path.posix.normalize(value) !== value) {
    throw new TypeError(`${label} must be a normalized shell-safe absolute Linux path`);
  }
  return value;
}

function normalizeSite(site, index) {
  const label = `site deployment descriptor sites[${index}]`;
  assertAllowedKeys(site, [
    "siteId",
    "regionCode",
    "stage",
    "hostId",
    "port",
    "serviceName",
    "directories",
    "objectStorage",
    "identity",
    "runtime"
  ], label);
  assertAllowedKeys(site.directories, ["application", "data", "logs"], `${label}.directories`);
  assertAllowedKeys(site.objectStorage, ["bucket"], `${label}.objectStorage`);
  assertAllowedKeys(site.identity, ["oidcClientId"], `${label}.identity`);
  assertAllowedKeys(site.runtime, [
    "containerImage",
    "nodeBinary",
    "environmentFile",
    "serviceUser",
    "serviceGroup"
  ], `${label}.runtime`);
  const stage = assertString(site.stage, /^(?:validation|production)$/, `${label}.stage`);
  const port = Number(site.port);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new TypeError(`${label}.port must be an integer between 1024 and 65535`);
  }
  return deepFreeze({
    siteId: assertString(site.siteId, SITE_ID_PATTERN, `${label}.siteId`),
    regionCode: assertString(String(site.regionCode || ""), REGION_CODE_PATTERN, `${label}.regionCode`),
    stage,
    hostId: assertString(site.hostId, HOST_ID_PATTERN, `${label}.hostId`),
    port,
    serviceName: assertString(site.serviceName, SERVICE_NAME_PATTERN, `${label}.serviceName`),
    directories: {
      application: assertLinuxAbsolutePath(site.directories.application, `${label}.directories.application`),
      data: assertLinuxAbsolutePath(site.directories.data, `${label}.directories.data`),
      logs: assertLinuxAbsolutePath(site.directories.logs, `${label}.directories.logs`)
    },
    objectStorage: {
      bucket: assertString(site.objectStorage.bucket, BUCKET_PATTERN, `${label}.objectStorage.bucket`)
    },
    identity: {
      oidcClientId: assertString(site.identity.oidcClientId, OIDC_CLIENT_ID_PATTERN, `${label}.identity.oidcClientId`)
    },
    runtime: {
      containerImage: assertString(site.runtime.containerImage, IMAGE_PATTERN, `${label}.runtime.containerImage`),
      nodeBinary: assertLinuxAbsolutePath(site.runtime.nodeBinary, `${label}.runtime.nodeBinary`),
      environmentFile: assertLinuxAbsolutePath(site.runtime.environmentFile, `${label}.runtime.environmentFile`),
      serviceUser: assertString(site.runtime.serviceUser, SERVICE_ACCOUNT_PATTERN, `${label}.runtime.serviceUser`),
      serviceGroup: assertString(site.runtime.serviceGroup, SERVICE_ACCOUNT_PATTERN, `${label}.runtime.serviceGroup`)
    }
  });
}

function validateSiteDeploymentDescriptor(descriptor) {
  assertNonSecret(descriptor);
  assertAllowedKeys(descriptor, ["schemaVersion", "deploymentId", "sites"], "site deployment descriptor");
  if (descriptor.schemaVersion !== DESCRIPTOR_SCHEMA_VERSION) {
    throw new TypeError(`site deployment descriptor schemaVersion must be ${DESCRIPTOR_SCHEMA_VERSION}`);
  }
  const deploymentId = assertString(
    descriptor.deploymentId,
    SITE_ID_PATTERN,
    "site deployment descriptor deploymentId"
  );
  if (!Array.isArray(descriptor.sites) || descriptor.sites.length === 0) {
    throw new TypeError("site deployment descriptor sites must be a non-empty array");
  }
  const sites = descriptor.sites.map(normalizeSite);
  if (new Set(sites.map((site) => site.siteId)).size !== sites.length) {
    throw new TypeError("site deployment descriptor contains duplicate siteId values");
  }
  return deepFreeze({
    schemaVersion: DESCRIPTOR_SCHEMA_VERSION,
    deploymentId,
    sites
  });
}

function readSiteDeploymentDescriptor(absolutePath) {
  const stat = fs.statSync(absolutePath);
  if (!stat.isFile()) throw new TypeError("site deployment descriptor must be a file");
  if (stat.size > 256 * 1024) throw new TypeError("site deployment descriptor exceeds 262144 bytes");
  return validateSiteDeploymentDescriptor(JSON.parse(fs.readFileSync(absolutePath, "utf8")));
}

function detectResourceConflicts(sites) {
  const resources = new Map();
  const conflicts = [];
  function register(kind, value, siteId) {
    const key = `${kind}:${String(value).toLowerCase()}`;
    if (resources.has(key)) {
      conflicts.push({
        kind,
        value,
        siteIds: [resources.get(key), siteId]
      });
    } else {
      resources.set(key, siteId);
    }
  }
  sites.forEach((site) => {
    register("hostPort", `${site.hostId.toLowerCase()}:${site.port}`, site.siteId);
    register("serviceName", site.serviceName, site.siteId);
    register("directory", site.directories.application, site.siteId);
    register("directory", site.directories.data, site.siteId);
    register("directory", site.directories.logs, site.siteId);
    register("objectStorageBucket", site.objectStorage.bucket, site.siteId);
    register("oidcClientId", site.identity.oidcClientId, site.siteId);
    register("serviceUser", site.runtime.serviceUser, site.siteId);
  });
  return deepFreeze(conflicts);
}

function resolveGitCommit(projectRoot, override) {
  const value = String(override || process.env.GIT_COMMIT || "").trim().toLowerCase();
  if (value) return assertString(value, GIT_COMMIT_PATTERN, "git commit");
  const gitCommit = childProcess.execFileSync(
    "git",
    ["rev-parse", "HEAD"],
    { cwd: projectRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
  ).trim().toLowerCase();
  return assertString(gitCommit, GIT_COMMIT_PATTERN, "git commit");
}

function systemdQuote(value) {
  return JSON.stringify(String(value));
}

function renderSystemdUnit(site) {
  return [
    "[Unit]",
    `Description=Health platform regional site ${site.siteId}`,
    "After=network-online.target",
    "Wants=network-online.target",
    "",
    "[Service]",
    "Type=simple",
    `User=${site.runtime.serviceUser}`,
    `Group=${site.runtime.serviceGroup}`,
    `WorkingDirectory=${systemdQuote(site.directories.application)}`,
    `EnvironmentFile=${systemdQuote(site.runtime.environmentFile)}`,
    `ExecStart=${systemdQuote(site.runtime.nodeBinary)} server.js`,
    `StandardOutput=append:${site.directories.logs}/application.log`,
    `StandardError=append:${site.directories.logs}/error.log`,
    "Restart=on-failure",
    "RestartSec=5s",
    "NoNewPrivileges=true",
    "PrivateTmp=true",
    "ProtectHome=true",
    "ProtectSystem=strict",
    "UMask=0027",
    `ReadWritePaths=${systemdQuote(site.directories.data)} ${systemdQuote(site.directories.logs)}`,
    "",
    "[Install]",
    "WantedBy=multi-user.target",
    ""
  ].join("\n");
}

function renderActivationEnvironment(site, release) {
  return [
    `NODE_ENV=${site.stage}`,
    `PORT=${site.port}`,
    `DATA_DIR=${site.directories.data}`,
    "STORAGE_ENGINE=auto",
    "SESSION_STORE=sqlite",
    "SESSION_TOPOLOGY=single-host",
    `REGION_CODE=${release.activation.REGION_CODE}`,
    `REGION_DEPLOYMENT_CLASS=${release.activation.REGION_DEPLOYMENT_CLASS}`,
    `REGION_CONTENT_DIGEST=${release.activation.REGION_CONTENT_DIGEST}`,
    `OBJECT_STORAGE_BUCKET=${site.objectStorage.bucket}`,
    `OIDC_CLIENT_ID=${site.identity.oidcClientId}`,
    ""
  ].join("\n");
}

function renderValidationCompose(site, release) {
  return [
    "services:",
    "  platform:",
    `    image: ${site.runtime.containerImage}`,
    "    restart: unless-stopped",
    "    environment:",
    "      NODE_ENV: validation",
    "      PORT: 5173",
    "      DATA_DIR: /app/data",
    "      STORAGE_ENGINE: auto",
    "      SESSION_STORE: sqlite",
    "      SESSION_TOPOLOGY: single-host",
    `      REGION_CODE: ${release.activation.REGION_CODE}`,
    `      REGION_DEPLOYMENT_CLASS: ${release.activation.REGION_DEPLOYMENT_CLASS}`,
    `      REGION_CONTENT_DIGEST: ${release.activation.REGION_CONTENT_DIGEST}`,
    `      OBJECT_STORAGE_BUCKET: ${site.objectStorage.bucket}`,
    `      OIDC_CLIENT_ID: ${site.identity.oidcClientId}`,
    "    ports:",
    `      - \"${site.port}:5173\"`,
    "    volumes:",
    `      - ${site.directories.data}:/app/data`,
    "    healthcheck:",
    "      test: [\"CMD\", \"node\", \"-e\", \"fetch('http://127.0.0.1:5173/api/live').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))\"]",
    "      interval: 10s",
    "      timeout: 5s",
    "      retries: 12",
    ""
  ].join("\n");
}

function buildSitePlan(site, options) {
  const release = buildCompositeRegionalRelease({
    root: options.projectRoot,
    regionCode: site.regionCode,
    generatedAt: options.generatedAt
  });
  if (site.stage === "production" && release.region.deploymentClass !== "production") {
    throw new TypeError(
      `${release.region.deploymentClass} region ${site.regionCode} cannot produce a production deployment plan`
    );
  }
  const activation = {
    NODE_ENV: site.stage,
    PORT: String(site.port),
    DATA_DIR: site.directories.data,
    STORAGE_ENGINE: "auto",
    SESSION_STORE: "sqlite",
    SESSION_TOPOLOGY: "single-host",
    ...release.activation,
    OBJECT_STORAGE_BUCKET: site.objectStorage.bucket,
    OIDC_CLIENT_ID: site.identity.oidcClientId
  };
  const artifacts = {
    systemd: {
      path: `systemd/${site.serviceName}.service`,
      content: renderSystemdUnit(site)
    },
    activationEnvironment: {
      path: `env/${site.siteId}.activation.env`,
      content: renderActivationEnvironment(site, release)
    },
    validationCompose: {
      path: `compose/${site.siteId}.compose.yml`,
      content: renderValidationCompose(site, release)
    }
  };
  const technicalChecks = [
    {
      id: "deployment:regionalCompositeRelease",
      passed: release.technicalReady,
      detail: release.artifact.digest
    },
    {
      id: "deployment:singleRegionPerProcess",
      passed: true,
      detail: `REGION_CODE=${site.regionCode}`
    },
    {
      id: "deployment:testRegionProductionGuard",
      passed: site.stage !== "production" || release.region.deploymentClass === "production",
      detail: `${site.stage}/${release.region.deploymentClass}`
    },
    {
      id: "deployment:secretlessDescriptor",
      passed: true,
      detail: "only activation values and managed secret injection paths are rendered"
    }
  ];
  return {
    siteId: site.siteId,
    regionCode: site.regionCode,
    regionName: release.region.name,
    stage: site.stage,
    deploymentClass: release.region.deploymentClass,
    hostId: site.hostId,
    port: site.port,
    serviceName: site.serviceName,
    directories: site.directories,
    runtime: {
      containerImage: site.runtime.containerImage,
      nodeBinary: site.runtime.nodeBinary,
      environmentFile: site.runtime.environmentFile,
      serviceUser: site.runtime.serviceUser,
      serviceGroup: site.runtime.serviceGroup
    },
    resources: {
      objectStorageBucket: site.objectStorage.bucket,
      oidcClientId: site.identity.oidcClientId
    },
    activation,
    sourceBinding: {
      gitCommit: options.gitCommit,
      coreIdentityDigest: options.coreIdentityDigest,
      regionalManifestDigest: `sha256:${release.region.manifestDigest}`,
      regionalContentDigest: release.activation.REGION_CONTENT_DIGEST,
      compositeReleaseDigest: release.artifact.digest,
      compositeReleaseId: release.releaseId
    },
    technicalReady: technicalChecks.every((check) => check.passed),
    productionReady: false,
    technicalChecks,
    artifacts,
    blockers: release.blockers
  };
}

function buildSiteDeploymentPlan(descriptorInput, options = {}) {
  const descriptor = validateSiteDeploymentDescriptor(descriptorInput);
  const conflicts = detectResourceConflicts(descriptor.sites);
  if (conflicts.length) {
    const summary = conflicts.map((item) => `${item.kind}=${item.value} (${item.siteIds.join(",")})`).join("; ");
    throw new TypeError(`site deployment resource conflicts: ${summary}`);
  }
  const projectRoot = path.resolve(options.root || path.resolve(__dirname, "../../.."));
  const generatedAt = options.generatedAt || new Date().toISOString();
  const gitCommit = resolveGitCommit(projectRoot, options.gitCommit);
  const platformPackage = JSON.parse(fs.readFileSync(
    resolveWithin(projectRoot, "package.json", "platform package"),
    "utf8"
  ));
  const coreIdentityDigest = `sha256:${sha256(stableJson({
    schemaVersion: "regional-core-identity-v1",
    name: platformPackage.name,
    version: platformPackage.version,
    gitCommit
  }))}`;
  const sites = descriptor.sites.map((site) => buildSitePlan(site, {
    projectRoot,
    generatedAt,
    gitCommit,
    coreIdentityDigest
  }));
  const base = {
    schemaVersion: PLAN_SCHEMA_VERSION,
    deploymentId: descriptor.deploymentId,
    generatedAt,
    topology: "one-region-per-process",
    sourceBinding: {
      gitCommit,
      coreIdentityDigest,
      platformName: platformPackage.name,
      platformVersion: platformPackage.version
    },
    resourceConflictChecks: {
      passed: true,
      checkedKinds: [
        "hostPort",
        "serviceName",
        "directory",
        "objectStorageBucket",
        "oidcClientId",
        "serviceUser"
      ],
      conflicts: []
    },
    technicalReady: sites.every((site) => site.technicalReady),
    productionReady: false,
    sites,
    blockers: [
      "real environment secrets must be injected outside this descriptor",
      "production activation requires independent external evidence and approval",
      "multi-node business storage is outside this single-node deployment plan"
    ]
  };
  return deepFreeze({
    ...base,
    deploymentPlanDigest: `sha256:${sha256(stableJson(base))}`
  });
}

function escapeMarkdown(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}

function renderSiteDeploymentMarkdown(plan) {
  return [
    `# 地区站点部署计划：${plan.deploymentId}`,
    "",
    `- 生成时间：${plan.generatedAt}`,
    `- Git 提交：\`${plan.sourceBinding.gitCommit}\``,
    `- 核心身份摘要：\`${plan.sourceBinding.coreIdentityDigest}\``,
    `- 部署计划摘要：\`${plan.deploymentPlanDigest}\``,
    `- 拓扑：${plan.topology}`,
    `- 技术校验：${plan.technicalReady ? "通过" : "未通过"}`,
    "- 生产就绪：否（真实联调、安全、灾备、现场验收和审批证据必须在仓库外完成）",
    "",
    "## 站点清单",
    "",
    "| 站点 | 地区 | 阶段/注册类别 | 主机端口 | 服务 | 组合发布 |",
    "|---|---|---|---|---|---|",
    ...plan.sites.map((site) => [
      escapeMarkdown(site.siteId),
      `${escapeMarkdown(site.regionName)}（${site.regionCode}）`,
      `${site.stage}/${site.deploymentClass}`,
      `${escapeMarkdown(site.hostId)}:${site.port}`,
      escapeMarkdown(site.serviceName),
      `\`${site.sourceBinding.compositeReleaseId}\``
    ].join(" | ").replace(/^/, "| ").replace(/$/, " |")),
    "",
    "## 资源隔离",
    "",
    "| 站点 | 应用目录 | 数据目录 | 日志目录 | Bucket | OIDC Client ID |",
    "|---|---|---|---|---|---|",
    ...plan.sites.map((site) => `| ${escapeMarkdown(site.siteId)} | ${escapeMarkdown(site.directories.application)} | ${escapeMarkdown(site.directories.data)} | ${escapeMarkdown(site.directories.logs)} | ${escapeMarkdown(site.resources.objectStorageBucket)} | ${escapeMarkdown(site.resources.oidcClientId)} |`),
    "",
    "## 激活与制品",
    "",
    ...plan.sites.flatMap((site) => [
      `### ${site.siteId}`,
      "",
      `- 地区内容摘要：\`${site.sourceBinding.regionalContentDigest}\``,
      `- 地区组合摘要：\`${site.sourceBinding.compositeReleaseDigest}\``,
      `- systemd：\`${site.artifacts.systemd.path}\``,
      `- 无密钥激活环境：\`${site.artifacts.activationEnvironment.path}\``,
      `- 单地区验证 Compose：\`${site.artifacts.validationCompose.path}\``,
      ""
    ]),
    "## 固定安全边界",
    "",
    ...plan.blockers.map((item) => `- ${item}`),
    ""
  ].join("\n");
}

module.exports = {
  DESCRIPTOR_SCHEMA_VERSION,
  PLAN_SCHEMA_VERSION,
  STAGES,
  assertNonSecret,
  buildSiteDeploymentPlan,
  detectResourceConflicts,
  readSiteDeploymentDescriptor,
  renderActivationEnvironment,
  renderSiteDeploymentMarkdown,
  renderSystemdUnit,
  renderValidationCompose,
  validateSiteDeploymentDescriptor
};
