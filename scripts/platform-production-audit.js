#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT, "release", "platform-production-audit.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "platform-production-audit.md");
const DEFAULT_DOCUMENT = path.join(ROOT, "docs", "数智医院标准平台全程审计与生产前开发规划.md");

const CAPABILITY_DOMAINS = [
  {
    id: "standards-governance",
    name: "标准治理与评价",
    level: "pilot-ready",
    functions: ["六大标准域", "医院自评与自动校验", "审核整改闭环", "生产证据包", "正式割接审批"],
    evidence: ["digital-hospital-standards.html", "scripts/digital-hospital-standards-readiness.js", "release/digital-hospital-standards-readiness-report.md"],
    boundary: "标准模型、流程和审批门禁可运行，正式评价仍需医院原始材料、专家复核和现场签字。"
  },
  {
    id: "data-governance",
    name: "数据治理与平台底座",
    level: "pilot-ready",
    functions: ["数据资产目录", "标准字典", "数据血缘", "质量规则", "平台总线", "二期数据与服务目录"],
    evidence: ["scripts/data-governance-readiness.js", "scripts/phase2-catalog-readiness.js", "release/data-governance-readiness-report.md"],
    boundary: "仓库已具备治理模型、演示数据和 SQLite WAL/FULL 试点生产配置，正式生产仍需真实主数据映射、历史数据迁移、容量验证和数据库验收。"
  },
  {
    id: "integration-exchange",
    name: "接口集成与区域交换",
    level: "pilot-ready",
    functions: ["HIS/EMR/LIS/PACS 契约", "HMAC 签名", "幂等与重试", "死信与人工对账", "区域共享", "双向转诊与远程会诊"],
    evidence: ["scripts/integration-readiness.js", "scripts/interface-mapping.js", "scripts/phase2-joint-test-readiness.js", "release/integration-readiness-report.md"],
    boundary: "接口契约和补偿机制已实现，生产仍需厂商联调、真实报文回执、网络策略和联合验收。"
  },
  {
    id: "identity-security-audit",
    name: "身份、安全与全程审计",
    level: "pilot-ready",
    functions: ["多角色会话", "机构与居民范围控制", "访问日志", "安全事件", "审计哈希", "国密适配中心"],
    evidence: ["scripts/identity-contract.js", "scripts/audit-retention.js", "scripts/commercial-crypto-readiness.js", "release/audit-retention-report.md"],
    boundary: "权限和审计链可运行，生产仍需统一身份、短信、密钥托管、SIEM、等保和密评证据。"
  },
  {
    id: "clinical-quality-operations",
    name: "医疗质量与医院运营",
    level: "pilot-ready",
    functions: ["质量安全事件", "整改闭环", "危急值与病历抽查", "床位人力设备监测", "资源调度", "药品耗材监管"],
    evidence: ["scripts/quality-safety-report.js", "scripts/hospital-operations-readiness.js", "scripts/drug-consumable-readiness.js", "release/quality-safety-report.md"],
    boundary: "业务闭环和监管看板已实现，生产仍需院内口径、真实设备与药耗数据、部门签字。"
  },
  {
    id: "public-health-chronic",
    name: "公共卫生与慢病协同",
    level: "pilot-ready",
    functions: ["21 个公共卫生标准域", "事件与交换任务", "慢病筛查分层", "院后随访", "家庭医生", "传染病直报与疾控指挥"],
    evidence: ["scripts/public-health-readiness.js", "scripts/chronic-followup-readiness.js", "scripts/phase2-disease-reporting-readiness.js", "release/public-health-readiness-report.md"],
    boundary: "标准映射、任务闭环和上线指挥台已实现，生产仍需属地口径、直报链路和疾控验收。"
  },
  {
    id: "citizen-services",
    name: "居民服务与连续就医",
    level: "pilot-ready",
    functions: ["个人健康档案", "预约挂号与候补", "停诊改签", "支付退费状态", "家庭医生", "互联网护理与陪诊"],
    evidence: ["citizen.html", "scripts/citizen-operations-readiness.js", "scripts/registration-journey-readiness.js", "release/registration-journey-readiness-report.md"],
    boundary: "居民端全流程可演示和审计，生产仍需实名、真实号源、支付医保、短信与移动发布通道。"
  },
  {
    id: "specialized-applications",
    name: "重点专科与惠民应用",
    level: "pilot-ready",
    functions: ["妇幼健康", "免疫规划", "医学影像云", "医师多点执业", "互联网护理", "助医陪诊", "临床辅助决策"],
    evidence: ["scripts/maternal-child-readiness.js", "scripts/immunization-readiness.js", "scripts/imaging-cloud-readiness.js", "scripts/internet-nursing-readiness.js"],
    boundary: "应用主流程已实现，生产仍需政策口径确认、专科系统接入和试点机构验收。"
  },
  {
    id: "research-sharing-dashboard",
    name: "科研、共享与综合驾驶舱",
    level: "pilot-ready",
    functions: ["科研数据沙箱", "伦理与导出审批", "区域数据共享", "八大应用指标", "行业治理指标", "领导驾驶舱"],
    evidence: ["scripts/research-sandbox-readiness.js", "scripts/regional-data-sharing.js", "scripts/health-dashboard-summary.js", "release/health-dashboard-summary.md"],
    boundary: "沙箱和指标模型可运行，生产仍需脱敏评估、指标口径签字、真实数据刷新和用途审计。"
  },
  {
    id: "operations-release",
    name: "运行保障与发布治理",
    level: "pilot-ready",
    functions: ["健康检查与指标", "SLO 与值班", "事件处置", "备份恢复演练", "发布报告", "割接清单与回滚快照"],
    evidence: ["scripts/monitoring-readiness.js", "scripts/operations-readiness.js", "scripts/release-report.js", "release/production-cutover-checklist.md"],
    boundary: "发布工具链完整，生产仍需目标环境部署、监控告警接入、灾备演练和四方签字。"
  }
];

const MVP_REQUIRED_MODULES = [
  {
    id: "mvp-production-database",
    name: "生产数据库与迁移",
    status: "primary-read-production-adapter-ready-site-acceptance-pending",
    priority: "P0",
    implemented: "SQLite schema v10、WAL/FULL、乐观锁、事务 outbox、链式批次摘要、基线入队、PostgreSQL 幂等影子同步 worker、只读版本与摘要核对、100 次核对历史、差异责任人、确认/关闭/自动重开、不可变处置历史、重试状态、迁移清单、受控全量导出、完整状态主读取演练、异步生产适配器、SERIALIZABLE 主写事务、全集合乐观锁和无正文写审计",
    remainingCode: "完成领域表转换、目标容量与故障切换、PostgreSQL 原生备份恢复和正式回切工具；主服务切换仍须数据库、灾备和四方审批证据",
    siteDependency: "目标容量、RTO/RPO、数据库资源和灾备签字"
  },
  {
    id: "mvp-identity-message",
    name: "统一身份与消息网关",
    status: "identity-sms-callback-ready-site-joint-test-pending",
    priority: "P0",
    implemented: "OIDC UserInfo、稳定 subject 受控绑定、同名回退阻断、token 刷新、token 撤销与本地注销、SCIM 目录预览、受控停用与会话撤销、短信 HTTP 适配、随机验证码、摘要存储、供应商受理回执、HMAC 最终送达回调、时间窗与重放防护、幂等乱序状态机和运维台账",
    remainingCode: "按实际身份与短信供应商补充专有字段映射、密钥托管、网络白名单、退订频控策略、协议差异和现场映射配置",
    siteDependency: "真实凭据、短信模板、目录映射、联合测试回执和责任方签字"
  },
  {
    id: "mvp-hospital-connectors",
    name: "医院核心系统运行时连接器",
    status: "adapter-foundation-ready",
    priority: "P0",
    implemented: "HIS/EMR/LIS/PACS/号源接口契约、出站 HTTP 适配、签名、幂等、受理回执、有限重试、死信和人工对账",
    remainingCode: "按试点厂商协议补充专有报文、双向证书、回调验签、错误码映射、字典转换和性能调优",
    siteDependency: "厂商接口文档、网络白名单、测试数据和联合验收单"
  },
  {
    id: "mvp-payment-insurance",
    name: "支付、医保与电子证照网关",
    status: "adapter-foundation-ready",
    priority: "P0",
    implemented: "支付、医保和电子证照通用出站网关，14 个受控操作，HMAC 签名、幂等、整数分金额、敏感字段拦截、有限重试、回执、死信和人工对账",
    remainingCode: "按支付机构、医保核心和证照平台协议补充专有报文、回调验签、防重放、乱序处理、日终对账和差错补偿",
    siteDependency: "商户与机构资质、真实密钥、网络白名单、沙箱/生产回执、字段字典和联合验收单"
  },
  {
    id: "mvp-object-storage",
    name: "对象存储与附件安全",
    status: "adapter-foundation-ready",
    priority: "P0",
    implemented: "安全附件元数据、外部直传授权、SHA-256 与大小复核、服务端恶意文件扫描、短时下载授权、隔离、法律保全和不可变留存控制",
    remainingCode: "按目标 S3/OBS/OSS/私有云补充厂商适配、KMS、分片续传、DICOM 专项扫描、WORM 验证、生命周期作业和容量调优",
    siteDependency: "存储资源、杀毒引擎、留存策略和容量预算"
  },
  {
    id: "mvp-observability-audit",
    name: "生产监控、告警与审计保全",
    status: "adapter-foundation-ready",
    priority: "P0",
    implemented: "健康指标、SLO、事件处置、审计哈希、去标识化 SIEM/Webhook 告警路由、HMAC 签名、幂等重试、投递回执和失败事件闭环",
    remainingCode: "按目标监控平台补充厂商协议、最终送达回调、分页值班升级、SIEM/WORM 留存和生产日志采集适配",
    siteDependency: "监控接收端、值班联系人、升级策略、留存目标、告警演练和正式签字"
  },
  {
    id: "mvp-secrets-deployment",
    name: "密钥配置与自动化部署",
    status: "automation-foundation-ready",
    priority: "P0",
    implemented: "生产环境校验、运行文件 SHA-256 清单、整体制品摘要、密钥引用契约、systemd 最小权限模板、完整性复核、回滚前置条件、CI 制品生成和启动 smoke",
    remainingCode: "按目标基础设施接入 Vault/KMS、TLS 证书轮换、制品仓库签名证明、环境级部署编排和自动回滚审批",
    siteDependency: "密钥提供方、域名证书、不可变制品仓库、网络区划、主机或容器资源和变更窗口"
  },
  {
    id: "mvp-security-compliance",
    name: "安全合规与国密生产适配",
    status: "control-center-ready",
    priority: "P0",
    implemented: "权限范围、审计链、合规控制台、国密适配中心和证据台账",
    remainingCode: "按测评整改接入 CA、密码设备、密钥服务和安全扫描流水线",
    siteDependency: "等保、密评、渗透测试、漏洞整改和放行意见"
  }
];

const PRODUCTION_BLOCKERS = [
  ["P0-01", "生产环境与配置", "platform-ops", "真实 .env、HTTPS、进程守护和文件权限", "生产地址 smoke 全部通过"],
  ["P0-02", "生产数据库与迁移", "data-platform", "数据库适配器、迁移清单、备份与恢复记录", "迁移校验通过且 RTO/RPO 演练签字"],
  ["P0-03", "统一身份与居民实名", "identity-integration", "OIDC/SAML、机构目录、医生和居民映射样例", "登录、登出、刷新、停用和越权测试通过"],
  ["P0-04", "短信、推送与移动发布", "mobile-release", "短信签名、送达回执、APP/小程序发布材料", "验证码和业务通知具备真实回执"],
  ["P0-05", "医院系统联合联调", "institution-integration", "HIS/EMR/LIS/PACS/号源联合测试单", "核心交易成功、失败、重试和对账均验收"],
  ["P0-06", "医保与电子证照", "cross-agency-integration", "医保结算、凭证和证照授权回执", "上游机构签署验收单"],
  ["P0-07", "安全合规与国密", "security-compliance", "等保、密评、渗透、漏洞整改和密钥交接材料", "无未豁免高危问题并取得放行意见"],
  ["P0-08", "审计留存与 SIEM", "security-admin", "AUDIT_EXPORT_PATH 或 SIEM_ENDPOINT、留存策略", "审计导出、查询和防篡改验证通过"],
  ["P0-09", "监控值班与告警", "platform-ops", "监控面板、告警路由、值班表和升级联系人", "生产告警演练和首日观察方案通过"],
  ["P0-10", "灾备、回滚与正式审批", "cutover-committee", "备份恢复、回滚演练、证据包和四方签字", "正式 go/no-go 审批全部完成"]
].map(([id, name, owner, evidence, doneWhen]) => ({
  id,
  name,
  owner,
  evidence,
  doneWhen,
  status: id === "P0-01"
    ? "automation-foundation-ready-site-acceptance-pending"
    : id === "P0-02"
    ? "primary-read-production-adapter-ready-site-acceptance-pending"
    : id === "P0-03"
    ? "identity-lifecycle-ready-site-joint-test-pending"
    : id === "P0-04"
    ? "signed-delivery-callback-ready-site-joint-test-pending"
    : (["P0-05", "P0-06", "P0-08", "P0-09"].includes(id) ? "adapter-foundation-ready-site-joint-test-pending" : "blocked-until-site-evidence"),
  progress: id === "P0-01"
    ? "已实现不可变部署包、运行文件摘要复核、密钥仅引用不落盘、最小权限进程模板、CI 验证和回滚契约；真实 Vault/KMS、TLS、制品仓库、服务账号和生产 smoke 签字未完成。"
    : id === "P0-02"
    ? "已实现 SQLite schema v10 事务 outbox、集合版本、基线入队、批次链式摘要、PostgreSQL 幂等影子同步、只读版本与 SHA-256 核对、核对历史、差异责任人、确认/关闭/自动重开、处置审计、完整状态主读取演练，以及具备 SERIALIZABLE 主写、全集合乐观锁和无正文写审计的异步生产适配器；主服务正式切换、领域转换、容量故障切换、原生备份恢复和灾备签字仍未完成。"
    : (id === "P0-03"
      ? "已实现 OIDC 稳定 subject 受控绑定、同名回退阻断、UserInfo、刷新、撤销、本地注销、SCIM 目录预览、受控账号停用、会话撤销和运维状态界面，并阻止自动开户、提权、复活、静默改绑、当前操作员停用及最后卫健委账号停用；真实凭据、目录归属与映射验收、供应商差异、联合测试和签字未完成。"
      : (id === "P0-04"
        ? "已实现短信 HTTP 适配、随机验证码、摘要存储、供应商受理回执、通用 HMAC 最终送达回调、时间窗与 nonce 重放防护、幂等和乱序终态保护、持久化回执台账及卫健委可视化；供应商专有字段映射、真实回调密钥、网络白名单、移动发布和现场签字未完成。"
        : (id === "P0-05"
          ? "已实现 HIS/EMR/LIS/PACS/号源通用出站适配、签名、幂等、有限重试、受理回执和死信对账；厂商专有协议、字典、网络、性能和联合签字未完成。"
          : (id === "P0-06"
            ? "已实现支付、医保与电子证照通用生产网关、14 个受控操作、签名、幂等、敏感字段拦截、有限重试和死信对账；机构专有协议、回调验签、日终对账和联合签字未完成。"
            : (id === "P0-08"
              ? "已实现去标识化 SIEM/Webhook 投递、HMAC 签名、投递回执和审计链；目标 SIEM/WORM 留存策略、查询验证和防篡改签字未完成。"
              : (id === "P0-09" ? "已实现告警信号、路由状态、幂等投递、有限重试、失败运维事件和恢复关闭；真实值班升级、生产演练和首日观察签字未完成。" : ""))))))
}));

const ROADMAP = [
  {
    phase: "P0 / 0-30 天",
    objective: "建立可部署、可联调、可审计的生产基线",
    deliverables: ["已完成不可变部署包、密钥引用和进程模板；继续 Vault/KMS、TLS、制品仓库和环境级编排", "已完成 PostgreSQL 主读取演练与证据门禁生产适配器；继续领域转换、容量故障切换、原生备份恢复和正式回切", "已完成统一身份和短信通用适配基础；继续真实供应商联调和密钥托管", "已完成医院出站连接器与 SIEM/Webhook 告警适配基础；继续厂商协议、目标接收端、网络环境和生产演练"],
    exit: "P0-01 至 P0-09 均形成可验证证据，生产配置检查不再使用占位值。"
  },
  {
    phase: "P1 / 31-60 天",
    objective: "完成真实数据和跨机构业务联合验收",
    deliverables: ["完成主数据映射、历史数据迁移和质量复核", "完成 HIS/EMR/LIS/PACS/号源/医保/证照全链路联调", "完成居民、机构、医生、护理、医保和卫健角色 UAT", "完成等保密评整改、渗透复测和性能容量测试"],
    exit: "核心业务成功、失败、重试、补偿和人工对账场景全部通过，重大安全问题清零。"
  },
  {
    phase: "P2 / 61-90 天",
    objective: "完成试点运行、灾备演练和正式割接",
    deliverables: ["灰度开放试点机构和居民范围", "执行备份恢复、回滚和故障切换演练", "完成首日指挥、事件台、值班交接和观察指标", "归档生产证据包并完成四方正式审批"],
    exit: "生产割接清单 10/10 通过，现场签字完整，launch smoke 在生产地址通过。"
  },
  {
    phase: "持续优化 / 90 天后",
    objective: "由项目交付转入标准运营和持续评价",
    deliverables: ["按月复盘 SLO、数据质量、接口成功率和居民体验", "扩展更多机构、专科和区域协同场景", "建立标准版本、规则版本和模型版本变更治理", "用真实运营数据驱动流程和资源配置优化"],
    exit: "形成月度运营报告、季度标准复评和年度灾备及安全复测机制。"
  }
];

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function readJson(relativePath, fallback = {}) {
  try {
    return JSON.parse(read(relativePath));
  } catch {
    return fallback;
  }
}

function exists(relativePath) {
  return fs.existsSync(path.join(ROOT, relativePath));
}

function check(id, passed, detail) {
  return { id, passed: Boolean(passed), detail };
}

function clean(value) {
  return String(value || "").replace(/\|/g, "/");
}

function buildPlatformProductionAudit(options = {}) {
  const pkg = options.pkg || readJson("package.json");
  const releaseReport = options.releaseReport || readJson("release/release-report.json");
  const cutoverArtifact = options.cutoverArtifact || readJson("release/production-cutover-checklist.json");
  const cutoverRows = options.cutoverRows || cutoverArtifact.checklist || releaseReport.productionCutover || [];
  const evidenceExists = options.evidenceExists || exists;
  const scriptSources = options.scriptSources || {
    manifest: read("scripts/release-artifact-manifest.js"),
    deploy: read("scripts/deploy-check.js"),
    release: read("scripts/release-report.js")
  };
  const runtimeSources = options.runtimeSources || {
    domain: read("platform-capability-operations.js"),
    server: read("server.js"),
    html: read("platform.html"),
    client: read("platform.js"),
    documentation: read("docs/platform-capability-operations-center.md"),
    postgresRuntime: read("postgres-runtime-sync.js"),
    postgresAdapter: read("postgres-production-adapter.js"),
    postgresDocumentation: read("docs/postgresql-runtime-sync.md"),
    identityAdapter: read("production-adapters.js"),
    identityDocumentation: read("docs/production-identity-message-adapters.md")
  };
  const document = options.document ?? (exists("docs/数智医院标准平台全程审计与生产前开发规划.md")
    ? read("docs/数智医院标准平台全程审计与生产前开发规划.md")
    : "");
  const capabilities = CAPABILITY_DOMAINS.map((domain) => {
    const sourceEvidence = domain.evidence.filter((item) => !item.startsWith("release/"));
    const generatedEvidence = domain.evidence.filter((item) => item.startsWith("release/"));
    return {
      ...domain,
      sourceEvidence,
      generatedEvidence: generatedEvidence.map((item) => ({ path: item, present: evidenceExists(item) })),
      evidenceReady: sourceEvidence.every(evidenceExists),
      missingEvidence: sourceEvidence.filter((item) => !evidenceExists(item))
    };
  });
  const passedCutover = cutoverRows.filter((item) => item.passed).length;
  const checks = [
    check("platformAudit:capabilities", capabilities.every((item) => item.evidenceReady), `${capabilities.filter((item) => item.evidenceReady).length}/${capabilities.length} capability domains have repository evidence`),
    check("platformAudit:boundaries", PRODUCTION_BLOCKERS.every((item) => item.owner && item.evidence && item.doneWhen), `${PRODUCTION_BLOCKERS.length} production blockers have owners, evidence and exit criteria`),
    check("platformAudit:mvpRequiredModules", MVP_REQUIRED_MODULES.length >= 8 && MVP_REQUIRED_MODULES.every((item) => item.priority === "P0" && item.remainingCode && item.siteDependency), `${MVP_REQUIRED_MODULES.length} mandatory MVP production modules have code scope and site dependencies`),
    check("platformAudit:roadmap", ROADMAP.length === 4 && ROADMAP.every((item) => item.deliverables.length >= 4 && item.exit), "30/60/90-day and continuous-improvement roadmap is complete"),
    check("platformAudit:capabilityOperationsCenter", runtimeSources.domain.includes("applyPlatformCapabilityReviewAction") && runtimeSources.domain.includes("applyPlatformProductionBlockerAction") && runtimeSources.server.includes("/api/platform/capability-operations/blockers/") && runtimeSources.html.includes("platform-capability-operations-center") && runtimeSources.client.includes("renderPlatformCapabilityOperationsCenter") && runtimeSources.client.includes("runPlatformProductionBlockerAction") && runtimeSources.documentation.includes("reviewed-preproduction") && runtimeSources.documentation.includes("evidence-reviewed-site-pending"), "capability review and production-blocker evidence workflows are runnable, audited and documented"),
    check("platformAudit:productionDatabaseAdapter", ["runPostgresPrimaryReadRehearsal", "buildPostgresPrimaryReadSnapshot"].every((marker) => runtimeSources.postgresRuntime.includes(marker)) && ["readPostgresProductionState", "writePostgresProductionState", "runtime_primary_write_audit", "POSTGRES_PRIMARY_WRITE_BLOCKED"].every((marker) => runtimeSources.postgresAdapter.includes(marker)) && ["/api/production-database/adapter", "/api/production-database/primary-read-rehearsal"].every((marker) => runtimeSources.server.includes(marker)) && ["生产数据库适配器", "SERIALIZABLE", "productionPrimary"].every((marker) => runtimeSources.postgresDocumentation.includes(marker)), "P0-02 primary-read rehearsal and evidence-gated production adapter are runnable, audited and documented"),
    check("platformAudit:identityLifecycleAdapter", ["refreshOidcAccessToken", "revokeOidcToken", "fetchIdentityDirectory", "identityLifecycleReady"].every((marker) => runtimeSources.identityAdapter.includes(marker)) && ["/api/auth/identity-lifecycle", "/api/auth/oidc/refresh", "/api/auth/oidc/revoke", "/api/auth/identity-directory/preview", "/api/auth/identity-directory/bind", "/api/auth/identity-directory/apply", "BIND EXTERNAL IDENTITY", "IDENTITY_BINDING_REASSIGNMENT_BLOCKED", "IDENTITY_DIRECTORY_SELF_DEACTIVATION_BLOCKED", "IDENTITY_DIRECTORY_LAST_COMMISSION_BLOCKED"].every((marker) => runtimeSources.server.includes(marker)) && runtimeSources.html.includes("identity-lifecycle-center") && ["renderIdentityLifecycleCenter", "runIdentityBindingAction", "runIdentityDirectoryAction"].every((marker) => runtimeSources.client.includes(marker)) && ["不按同名用户名自动回退", "不自动开户", "不自动提权", "不自动复活", "现场联合测试回执"].every((marker) => runtimeSources.identityDocumentation.includes(marker)), "P0-03 OIDC subject binding, lifecycle, safe directory deactivation, operations UI and production boundary are runnable, audited and documented"),
    check("platformAudit:smsDeliveryCallback", ["verifySmsDeliveryCallback", "applySmsDeliveryCallback", "buildSmsDeliveryCenter", "SMS_CALLBACK_REPLAY_DETECTED", "terminal-conflict"].every((marker) => runtimeSources.identityAdapter.includes(marker)) && ["/api/auth/sms-delivery-callback", "/api/auth/sms-deliveries", "smsDeliveryReceipts", "recordSmsDeliveryAcceptance"].every((marker) => runtimeSources.server.includes(marker)) && ["sms-delivery-status", "sms-delivery-metrics", "sms-delivery-receipts"].every((marker) => runtimeSources.html.includes(marker)) && runtimeSources.client.includes("smsDelivery") && ["SMS_DELIVERY_CALLBACK_SECRET", "回调验签", "重放", "乱序"].every((marker) => runtimeSources.identityDocumentation.includes(marker)), "P0-04 signed SMS final-delivery callbacks, replay protection, ordered persistence, operations visibility and site boundary are runnable, audited and documented"),
    check("platformAudit:releaseWiring", Boolean(pkg.scripts?.["platform:production-audit"]) && scriptSources.manifest.includes("platform-production-audit") && scriptSources.deploy.includes("platformProductionAudit") && scriptSources.release.includes("buildPlatformProductionAudit"), "package, manifest, deploy check and release report are wired"),
    check("platformAudit:formalDocument", ["审计结论", "正式生产前已实现的主要功能", "生产割接差距", "下一步开发规划", "正式上线退出条件"].every((marker) => document.includes(marker)), "formal audit document contains conclusion, capability inventory, gaps, roadmap and exit criteria")
  ];
  return {
    ok: checks.every((item) => item.passed),
    generatedAt: new Date().toISOString(),
    status: "pre-production-implemented-site-cutover-blocked",
    productionReady: false,
    conclusion: "平台主要标准能力已形成可运行、可测试、可审计的生产前版本；正式生产仍被真实环境、外部接口、安全合规、监控灾备和现场签字阻断。",
    summary: {
      capabilityDomains: capabilities.length,
      implementedDomains: capabilities.filter((item) => item.evidenceReady).length,
      productionReadyDomains: 0,
      productionBlockers: PRODUCTION_BLOCKERS.length,
      mvpRequiredModules: MVP_REQUIRED_MODULES.length,
      mvpAdapterFoundationsReady: MVP_REQUIRED_MODULES.filter((item) => /ready/.test(item.status)).length,
      mvpRuntimePending: MVP_REQUIRED_MODULES.filter((item) => /pending|in-progress/.test(item.status)).length,
      p0Blockers: PRODUCTION_BLOCKERS.filter((item) => item.id.startsWith("P0-")).length,
      cutoverChecks: cutoverRows.length,
      cutoverPassed: passedCutover,
      cutoverBlocked: Math.max(0, cutoverRows.length - passedCutover),
      releaseChecks: Number(releaseReport.summary?.total || 0),
      releaseChecksPassed: Number(releaseReport.summary?.passed || 0),
      capabilityOperationsCenter: checks.some((item) => item.id === "platformAudit:capabilityOperationsCenter" && item.passed),
      productionDatabaseAdapter: checks.some((item) => item.id === "platformAudit:productionDatabaseAdapter" && item.passed),
      identityLifecycleAdapter: checks.some((item) => item.id === "platformAudit:identityLifecycleAdapter" && item.passed),
      smsDeliveryCallbackAdapter: checks.some((item) => item.id === "platformAudit:smsDeliveryCallback" && item.passed)
    },
    auditBasis: [
      "运行页面与角色入口",
      "Node API 与状态集合",
      "功能 readiness 脚本",
      "自动化测试与 E2E",
      "release:report / deploy:check / launch:smoke",
      "生产割接清单、现场材料包和正式审批台账"
    ],
    capabilities,
    mvpRequiredModules: MVP_REQUIRED_MODULES,
    productionBlockers: PRODUCTION_BLOCKERS,
    roadmap: ROADMAP,
    checks
  };
}

function renderMarkdown(report) {
  return [
    "# 数智医院标准平台全程审计与生产前开发规划",
    "",
    `- 生成时间：${report.generatedAt}`,
    `- 审计结果：${report.ok ? "PASS" : "FAIL"}`,
    `- 当前状态：${report.status}`,
    `- 正式生产就绪：${report.productionReady ? "是" : "否"}`,
    "",
    "## 一、审计结论",
    "",
    report.conclusion,
    "",
    `本次审计覆盖 ${report.summary.capabilityDomains} 个能力域，其中 ${report.summary.implementedDomains} 个具备仓库内可运行证据；正式生产就绪能力按审慎口径计为 ${report.summary.productionReadyDomains} 个。当前演示发布检查为 ${report.summary.releaseChecksPassed}/${report.summary.releaseChecks}，生产割接检查为 ${report.summary.cutoverPassed}/${report.summary.cutoverChecks}。发布检查通过只证明代码、文档和演示证据结构完整，不等同于现场生产验收。`,
    `平台能力运营中心已${report.summary.capabilityOperationsCenter ? "纳入" : "未纳入"}发布门禁，用于统一管理能力域责任人、生产阻断整改、证据提交、生产前复核和审计留痕。`,
    `P0-02 PostgreSQL 主读取演练与生产适配器已${report.summary.productionDatabaseAdapter ? "纳入" : "未纳入"}发布门禁；正式主库切换仍由现场数据库、灾备和四方审批证据阻断。`,
    `P0-03 统一身份生命周期与目录安全停用已${report.summary.identityLifecycleAdapter ? "纳入" : "未纳入"}发布门禁；真实身份源、目录映射、供应商联合测试和责任方签字仍为上线阻断项。`,
    `P0-04 短信最终送达回调已${report.summary.smsDeliveryCallbackAdapter ? "纳入" : "未纳入"}发布门禁；真实供应商字段映射、密钥托管、网络白名单、移动发布和现场回执仍为上线阻断项。`,
    "",
    "## 二、审计范围与方法",
    "",
    ...report.auditBasis.map((item) => `- ${item}`),
    "",
    "## 三、正式生产前已实现的主要功能",
    "",
    "| 能力域 | 当前级别 | 已实现功能 | 生产边界 |",
    "|---|---|---|---|",
    ...report.capabilities.map((item) => `| ${clean(item.name)} | ${item.level} | ${clean(item.functions.join("、"))} | ${clean(item.boundary)} |`),
    "",
    "## 四、MVP 剩余必开发模块",
    "",
    "| 模块 | 状态 | 已实现 | 剩余代码 | 现场依赖 |",
    "|---|---|---|---|---|",
    ...report.mvpRequiredModules.map((item) => `| ${clean(item.name)} | ${item.status} | ${clean(item.implemented)} | ${clean(item.remainingCode)} | ${clean(item.siteDependency)} |`),
    "",
    "## 五、生产割接差距",
    "",
    "| 编号 | 阻断项 | 当前进展 | 责任方 | 必备证据 | 完成标准 |",
    "|---|---|---|---|---|---|",
    ...report.productionBlockers.map((item) => `| ${item.id} | ${clean(item.name)} | ${clean(item.progress || item.status)} | ${item.owner} | ${clean(item.evidence)} | ${clean(item.doneWhen)} |`),
    "",
    "## 六、下一步开发规划",
    "",
    ...report.roadmap.flatMap((phase) => [
      `### ${phase.phase}：${phase.objective}`,
      "",
      ...phase.deliverables.map((item) => `- ${item}`),
      `- 阶段退出条件：${phase.exit}`,
      ""
    ]),
    "## 七、正式上线退出条件",
    "",
    "1. 生产割接清单达到 10/10，并完成现场责任方签字。",
    "2. 生产数据库、统一身份、短信、HIS/EMR/LIS/PACS、医保和证照接口均有真实回执。",
    "3. 等保、密评、渗透和漏洞整改无未豁免高危问题。",
    "4. 监控、审计留存、备份恢复、故障回滚和值班升级完成演练。",
    "5. `npm.cmd run release:report -- --profile=production --config-env=.env`、`npm.cmd run deploy:check` 和生产地址 `launch:smoke` 全部通过。",
    "6. 业务、信息、运维、安全四方完成正式 go/no-go 审批。",
    "",
    "## 八、审计自动化检查",
    "",
    "| 结果 | 检查 | 说明 |",
    "|---|---|---|",
    ...report.checks.map((item) => `| ${item.passed ? "PASS" : "FAIL"} | ${item.id} | ${clean(item.detail)} |`),
    "",
    "## 九、复核命令",
    "",
    "```powershell",
    "npm.cmd run platform:production-audit",
    "npm.cmd run check",
    "npm.cmd test",
    "npm.cmd run release:report",
    "npm.cmd run deploy:check",
    "npm.cmd run launch:smoke",
    "```",
    ""
  ].join("\n");
}

function parseArgs(argv = process.argv.slice(2)) {
  const flags = {};
  argv.forEach((flag) => {
    if (!flag.startsWith("--")) return;
    const [key, ...rest] = flag.slice(2).split("=");
    flags[key] = rest.length ? rest.join("=") : true;
  });
  return flags;
}

function writeOutput(report, flags = {}) {
  const output = path.resolve(ROOT, String(flags.output || DEFAULT_OUTPUT));
  const markdown = path.resolve(ROOT, String(flags.markdown || DEFAULT_MARKDOWN));
  const document = path.resolve(ROOT, String(flags.document || DEFAULT_DOCUMENT));
  const rendered = renderMarkdown(report);
  [output, markdown, document].forEach((file) => fs.mkdirSync(path.dirname(file), { recursive: true }));
  fs.writeFileSync(output, JSON.stringify(report, null, 2), "utf8");
  fs.writeFileSync(markdown, rendered, "utf8");
  fs.writeFileSync(document, rendered, "utf8");
}

function runCli() {
  const flags = parseArgs();
  const report = buildPlatformProductionAudit();
  if (flags.write !== "false" && flags.write !== false) writeOutput(report, flags);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}

if (require.main === module) {
  try {
    runCli();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  CAPABILITY_DOMAINS,
  MVP_REQUIRED_MODULES,
  PRODUCTION_BLOCKERS,
  ROADMAP,
  buildPlatformProductionAudit,
  parseArgs,
  renderMarkdown,
  writeOutput
};
