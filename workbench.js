const fallbackState = {
  residents: [],
  diseases: [],
  followups: [],
  personalRecords: [],
  insuranceClaims: [],
  medicationPickups: [],
  emergencySignals: [],
  countyConsortium: null,
  chronicProjectBlueprint: null,
  countyProjectBlueprint: null,
  referralSystem: null,
  platformRoadmap: [],
  platformAudit: [],
  platformProcessAudit: []
};

document.addEventListener("DOMContentLoaded", async () => {
  const state = await loadPlatformState(fallbackState);
  const operations = await loadOperationalMetrics();
  const readiness = await loadSystemReadiness();
  const processAudit = await loadProcessAudit();
  const acceptanceLedgers = await loadAcceptanceLedgers();
  const siteReadinessPack = await loadSiteReadinessPack();
  const siteTemplateReadmes = await loadSiteTemplateReadmes();
  const releaseReport = await loadReleaseReport();
  const productionCutover = await loadProductionCutoverChecklist();
  const releaseArtifactManifest = await loadReleaseArtifactManifest();
  const tasks = collectUnifiedTasks(state);
  const roadmap = state.platformRoadmap?.length ? state.platformRoadmap : defaultRoadmap();
  renderMetrics(state, tasks, roadmap, operations);
  renderSystemReadiness(readiness);
  renderReleaseEvidenceGates(state, readiness, operations, processAudit, siteReadinessPack, releaseReport, productionCutover, releaseArtifactManifest);
  renderAcceptanceLedgers(state, acceptanceLedgers);
  renderSiteReadinessPack(siteReadinessPack, siteTemplateReadmes);
  renderSourceAlignment(state);
  renderAudit(state, tasks);
  renderProcessAudit(state, processAudit);
  renderPlatformMap(state);
  renderPriorityList(roadmap);
  renderUnifiedTasks(tasks);
  renderDataMaturity(state);
  renderNextQueue(roadmap);
});

async function loadOperationalMetrics() {
  if (location.protocol === "file:") return null;
  try {
    const request = window.HealthCityAuth?.authFetch || fetch;
    const response = await request("/api/metrics");
    if (!response.ok) return null;
    return response.json();
  } catch (error) {
    return null;
  }
}

async function loadSystemReadiness() {
  if (location.protocol === "file:") return null;
  try {
    const request = window.HealthCityAuth?.authFetch || fetch;
    const response = await request("/api/system/readiness");
    if (!response.ok) return null;
    return response.json();
  } catch (error) {
    return null;
  }
}

async function loadProcessAudit() {
  if (location.protocol === "file:") return null;
  try {
    const request = window.HealthCityAuth?.authFetch || fetch;
    const response = await request("/api/process-audit");
    if (!response.ok) return null;
    return response.json();
  } catch (error) {
    return null;
  }
}

async function loadAcceptanceLedgers() {
  if (location.protocol === "file:") return null;
  try {
    const request = window.HealthCityAuth?.authFetch || fetch;
    const [chronic, county] = await Promise.all([
      request("/api/chronic/acceptance-ledger"),
      request("/api/county/acceptance-ledger")
    ]);
    return {
      chronic: chronic.ok ? await chronic.json() : null,
      county: county.ok ? await county.json() : null
    };
  } catch (error) {
    return null;
  }
}

async function loadSiteReadinessPack() {
  if (location.protocol === "file:") return null;
  try {
    const request = window.HealthCityAuth?.authFetch || fetch;
    const response = await request("/api/site-readiness-pack");
    if (!response.ok) return null;
    return response.json();
  } catch (error) {
    return null;
  }
}

async function loadSiteTemplateReadmes() {
  if (location.protocol === "file:") return null;
  try {
    const request = window.HealthCityAuth?.authFetch || fetch;
    const response = await request("/api/site-template-readmes");
    if (!response.ok) return null;
    return response.json();
  } catch (error) {
    return null;
  }
}

async function loadReleaseReport() {
  if (location.protocol === "file:") return null;
  try {
    const request = window.HealthCityAuth?.authFetch || fetch;
    const response = await request("/api/release-report");
    if (!response.ok) return null;
    return response.json();
  } catch (error) {
    return null;
  }
}

async function loadProductionCutoverChecklist() {
  if (location.protocol === "file:") return null;
  try {
    const request = window.HealthCityAuth?.authFetch || fetch;
    const response = await request("/api/production-cutover-checklist");
    if (!response.ok) return null;
    return response.json();
  } catch (error) {
    return null;
  }
}

async function loadReleaseArtifactManifest() {
  if (location.protocol === "file:") return null;
  try {
    const request = window.HealthCityAuth?.authFetch || fetch;
    const response = await request("/api/release-artifact-manifest");
    if (!response.ok) return null;
    return response.json();
  } catch (error) {
    return null;
  }
}

function renderMetrics(state, tasks, roadmap, operations) {
  const dataCollections = Object.keys(state).filter((key) => Array.isArray(state[key]) || (state[key] && typeof state[key] === "object")).length;
  const p0 = roadmap.filter((item) => item.priority === "P0").length;
  const activeTasks = tasks.filter((item) => !["已完成", "已取药", "已通过"].includes(item.status)).length;
  document.querySelector("#workbench-metrics").innerHTML = [
    ["业务端", 5, "卫健委、机构、医保、个人、医共体"],
    ["核心数据集", dataCollections, "data/db.json 当前集合"],
    ["跨端待办", activeTasks, "自动从业务数据汇总"],
    ["运行请求", operations?.http?.apiRequests ?? "静态", operations ? "来自 /api/metrics" : "静态预览不运行 API"],
    ["慢请求", operations?.http?.slowRequests?.length ?? 0, "500ms 以上请求采样"],
    ["数据质量", operations?.workload?.dataQualityIssues ?? 0, "运行指标中的质量问题数"],
    ["P0 优先项", p0, "先补平台底座"],
    ["居民主索引", state.residents?.length || 0, "身份证号 + 手机号"]
  ].map(([label, value, hint]) => `<article class="metric-card"><span>${label}</span><strong>${value}</strong><small>${hint}</small></article>`).join("");
}

function renderSystemReadiness(readiness) {
  const container = document.querySelector("#system-readiness");
  if (!container) return;

  if (!readiness) {
    container.innerHTML = `<article class="priority-row">
      <div class="priority-rank warn">API</div>
      <div>
        <h3>静态预览模式</h3>
        <p>请通过 Node 服务登录后查看实时系统就绪报告；GitHub Pages 只展示静态快照。</p>
      </div>
      <div class="capability-side">
        <span class="badge warn">未运行</span>
        <small>/api/system/readiness</small>
      </div>
    </article>`;
    return;
  }

  const checks = readiness.checks || [];
  const dependencies = readiness.externalDependencies || [];
  const checkRows = checks.map((item, index) => {
    const ok = Boolean(item.passed);
    return `<article class="priority-row">
      <div class="priority-rank ${ok ? "info" : "danger"}">${index + 1}</div>
      <div>
        <h3>${item.name}</h3>
        <p>${item.detail}</p>
      </div>
      <div class="capability-side">
        <span class="badge ${ok ? "info" : "danger"}">${ok ? "通过" : "需处理"}</span>
        <small>${item.id}</small>
      </div>
    </article>`;
  }).join("");

  const dependencyRows = dependencies.slice(0, 6).map((item) => {
    const severity = item.severity || "medium";
    const label = item.name || item;
    return `<span class="badge ${severity === "high" ? "danger" : "warn"}">${label}</span>`;
  }).join("");
  const dependencyDetailRows = dependencies.slice(0, 4).map((item) => {
    if (!item || typeof item === "string") return "";
    return `<article class="priority-row">
      <div class="priority-rank ${item.severity === "high" ? "danger" : "warn"}">${item.severity === "high" ? "高" : "中"}</div>
      <div>
        <h3>${item.name}</h3>
        <p>${item.reason}</p>
        <small>下一步：${item.nextAction}</small>
      </div>
      <div class="capability-side">
        <span class="badge warn">${item.owner}</span>
        <small>${item.evidence || item.id}</small>
      </div>
    </article>`;
  }).join("");
  const productionEnv = readiness.productionEnvironment || null;
  const dependencySummary = readiness.externalDependencySummary || null;
  const productionEnvRows = (productionEnv?.checks || []).map((item) =>
    `<span class="badge ${item.passed ? "info" : "warn"}">${item.name}: ${item.detail}</span>`
  ).join("");
  const interfaceReadiness = readiness.interfaceReadiness || null;
  const interfaceRows = (interfaceReadiness?.rows || []).filter((item) => item.priority === "P0").map((item) =>
    `<span class="badge ${item.externalBlocked ? "warn" : "info"}">${item.domain}: ${item.status}</span>`
  ).join("");

  container.innerHTML = `<article class="priority-row">
    <div class="priority-rank ${readiness.passed ? "info" : "danger"}">${readiness.passed ? "OK" : "!"}</div>
    <div>
      <h3>${readiness.service || "系统"}发布就绪总览</h3>
      <p>生成时间：${readiness.generatedAt || "未知"}；P2 集合、审计链和运行负载已纳入统一检查。</p>
      <div class="standard-tags">${dependencySummary ? `<span class="badge danger">现场高风险依赖：${dependencySummary.high}</span><span class="badge warn">现场中风险依赖：${dependencySummary.medium}</span>` : ""}</div>
      <div class="standard-tags">${dependencyRows || `<span class="badge info">暂无外部依赖提示</span>`}</div>
      <div class="standard-tags">${productionEnvRows || `<span class="badge warn">生产环境门禁待运行</span>`}</div>
      <div class="standard-tags">${interfaceRows || `<span class="badge warn">接口准备度待生成</span>`}</div>
    </div>
    <div class="capability-side">
      <span class="badge ${readiness.passed ? "info" : "danger"}">${readiness.passed ? "代码闭环通过" : "仍需处理"}</span>
      <small>现场依赖需按部署计划另行验收</small>
    </div>
  </article>${checkRows}${dependencyDetailRows}`;
}

function renderReleaseEvidenceGates(state, readiness, operations, processAudit, siteReadinessPack, releaseReport, productionCutover, releaseArtifactManifest) {
  const container = document.querySelector("#release-evidence-gates");
  if (!container) return;

  const checksById = Object.fromEntries((readiness?.checks || []).map((item) => [item.id, item]));
  const externalSummary = readiness?.externalDependencySummary || null;
  const interoperability = (state.platformEvidence || []).find((item) => item.id === "ev-interoperability") || {};
  const securityLedger = state.securityAcceptanceLedger || readiness?.securityAcceptanceLedger || [];
  const chronicAcceptance = state.chronicAcceptanceLedger || [];
  const countyAcceptance = state.countyAcceptanceLedger || [];
  const productionTracks = state.productionDeploymentPlan || readiness?.productionDeploymentPlan || [];
  const p0Interfaces = (state.platformInterfaces || []).filter((item) => item.priority === "P0");
  const residentsWithIndex = (state.residents || []).filter((item) => item.personIndex || item.identityIndex).length;
  const residentCompleteness = state.residents?.length ? Math.round((residentsWithIndex / state.residents.length) * 100) : 0;
  const runtime = readiness?.runtime || operations?.workload || {};
  const processLedger = processAudit?.ledgers || null;
  const processSummary = processAudit?.summary || null;
  const sitePackSummary = siteReadinessPack?.summary || null;
  const serviceAcceptance = releaseReport?.serviceAcceptance || null;
  const chronicService = serviceAcceptance?.chronic?.summary || null;
  const countyService = serviceAcceptance?.county?.summary || null;

  const gates = [
    {
      id: "data-quality:report",
      title: "Data quality / master index",
      passed: residentCompleteness === 100 && Number(runtime.dataQualityIssues || 0) === 0,
      detail: `${residentCompleteness}% resident index completeness; ${Number(runtime.dataQualityIssues || 0)} runtime quality issues`,
      evidence: "release/data-quality-report.md"
    },
    {
      id: "integration:readiness",
      title: "Integration readiness",
      passed: Boolean(checksById["interface-readiness"]?.passed || p0Interfaces.length >= 5),
      detail: `${p0Interfaces.length} P0 interface tracks; external blocked=${readiness?.interfaceReadiness?.blocked ?? "n/a"}`,
      evidence: "release/integration-readiness-report.md"
    },
    {
      id: "operations:readiness",
      title: "Operations readiness",
      passed: Boolean(checksById["production-deployment-plan"]?.passed && checksById["runtime-workload"]?.passed),
      detail: `${productionTracks.length} production tracks; external risks high=${externalSummary?.high ?? "n/a"}`,
      evidence: "release/operations-readiness-report.md"
    },
    {
      id: "evaluation:evidence",
      title: "Interoperability evaluation evidence",
      passed: Boolean(interoperability.records?.length >= 2 && interoperability.artifacts?.length >= 4),
      detail: `${interoperability.records?.length || 0} records; ${(interoperability.artifacts || []).join(", ") || "no artifacts"}`,
      evidence: "release/evaluation-evidence-report.md"
    },
    {
      id: "audit:retention",
      title: "Audit retention / security acceptance",
      passed: Boolean(checksById["audit-chain"]?.passed && securityLedger.length >= 4),
      detail: `${securityLedger.length} security controls; audit=${checksById["audit-chain"]?.detail || "static preview"}`,
      evidence: "release/audit-retention-report.md"
    },
    {
      id: "process:audit",
      title: "Full process audit",
      passed: processAudit ? Boolean(processAudit.ok) : Boolean((state.platformProcessAudit || []).length >= 10 && chronicAcceptance.length >= 5 && countyAcceptance.length >= 4 && securityLedger.length >= 4 && productionTracks.length >= 4),
      detail: processAudit
        ? `${processSummary?.passedDomains || 0}/${processSummary?.evidenceDomains || 0} evidence domains; chronic=${processLedger?.chronic?.ready || 0}/${processLedger?.chronic?.total || 0}; county=${processLedger?.county?.ready || 0}/${processLedger?.county?.total || 0}`
        : `${state.platformProcessAudit?.length || 0} process rows; chronic=${chronicAcceptance.length}; county=${countyAcceptance.length}; security=${securityLedger.length}; cutover=${productionTracks.length}`,
      evidence: "release/process-audit-report.md"
    },
    {
      id: "service:acceptance",
      title: "Service acceptance summary",
      passed: serviceAcceptance
        ? Boolean(chronicService?.modeledDomains === chronicService?.domains && countyService?.modeledDomains === countyService?.domains)
        : Boolean(chronicAcceptance.length >= 5 && countyAcceptance.length >= 4),
      detail: serviceAcceptance
        ? `chronic=${chronicService?.modeledDomains || 0}/${chronicService?.domains || 0} domains, open=${chronicService?.openItems || 0}; county=${countyService?.modeledDomains || 0}/${countyService?.domains || 0} domains, open=${countyService?.openItems || 0}`
        : `static ledgers chronic=${chronicAcceptance.length}; county=${countyAcceptance.length}`,
      evidence: "release/service-acceptance-summary.md"
    },
    {
      id: "site:pack",
      title: "Site readiness pack",
      passed: siteReadinessPack ? Boolean(siteReadinessPack.ok) : Boolean(productionTracks.length >= 4 && p0Interfaces.length >= 5),
      detail: siteReadinessPack
        ? `${sitePackSummary?.packs || 0} packs; ${sitePackSummary?.templateRows || 0} template rows; ${siteReadinessPack.templates?.signoff?.length || 0} signoff templates`
        : `${productionTracks.length} production tracks; ${p0Interfaces.length} P0 interfaces; run Node API for live templates`,
      evidence: "release/site-readiness-pack.md"
    },
    {
      id: "release:report",
      title: "Release readiness aggregate",
      passed: releaseReport ? Boolean(releaseReport.ok) : readiness ? Boolean(readiness.passed) : Boolean(state.platformRoadmap?.length),
      detail: releaseReport
        ? `${releaseReport.summary?.passed || 0}/${releaseReport.summary?.total || 0} release checks passed; warnings=${releaseReport.summary?.warnings || 0}`
        : readiness ? `${readiness.checks?.filter((item) => item.passed).length || 0}/${readiness.checks?.length || 0} readiness checks passed` : "static snapshot preview; run Node API for live readiness",
      evidence: "release/release-report.md"
    },
    {
      id: "production:cutover",
      title: "Production cutover checklist",
      passed: productionCutover ? Boolean(productionCutover.ok) : Boolean(releaseReport?.productionCutover?.every((item) => item.passed)),
      detail: productionCutover
        ? `${productionCutover.summary?.passed || 0}/${productionCutover.summary?.total || 0} cutover items passed; blocked=${productionCutover.summary?.blocked || 0}`
        : "site signoff checklist is available from release report",
      evidence: "release/production-cutover-checklist.md"
    },
    {
      id: "release:manifest",
      title: "Release artifact manifest",
      passed: releaseArtifactManifest ? Boolean(releaseArtifactManifest.ok) : Boolean(releaseReport?.ok),
      detail: releaseArtifactManifest
        ? `${releaseArtifactManifest.summary?.artifacts || 0} artifacts; ${releaseArtifactManifest.summary?.templateReadmes || 0} template READMEs; ${releaseArtifactManifest.summary?.releaseChecks || 0} release checks indexed`
        : "run Node API for release artifact index",
      evidence: "release/release-artifact-manifest.md"
    }
  ];

  container.innerHTML = gates.map((gate, index) => `<article class="priority-row release-evidence-gate" data-gate="${gate.id}">
    <div class="priority-rank ${gate.passed ? "info" : "warn"}">${index + 1}</div>
    <div>
      <h3>${gate.title}</h3>
      <p>${gate.detail}</p>
      <div class="standard-tags">
        <span class="badge ${gate.passed ? "info" : "warn"}">${gate.passed ? "PASS" : "REVIEW"}</span>
        <span class="badge info">${gate.id}</span>
      </div>
    </div>
    <div class="capability-side">
      <small>${gate.evidence}</small>
      <small>${readiness || processAudit || siteReadinessPack || releaseReport || productionCutover || releaseArtifactManifest ? "live API evidence" : "static snapshot evidence"}</small>
    </div>
  </article>`).join("");
}

function renderAcceptanceLedgers(state, acceptanceLedgers) {
  const container = document.querySelector("#acceptance-ledgers");
  if (!container) return;

  const fallbackChronic = {
    ok: (state.chronicAcceptanceLedger || []).length >= 5,
    summary: {
      total: (state.chronicAcceptanceLedger || []).length,
      ready: (state.chronicAcceptanceLedger || []).filter((item) => /ready|建档|归档|闭环|完成|通过|已/.test(String(item.acceptanceStatus || item.status || ""))).length
    },
    ledger: state.chronicAcceptanceLedger || []
  };
  const fallbackCounty = {
    ok: (state.countyAcceptanceLedger || []).length >= 4,
    summary: {
      total: (state.countyAcceptanceLedger || []).length,
      ready: (state.countyAcceptanceLedger || []).filter((item) => /ready|建档|归档|闭环|完成|通过|已/.test(String(item.acceptanceStatus || item.status || ""))).length
    },
    ledger: state.countyAcceptanceLedger || []
  };
  const ledgers = [
    { id: "chronic", title: "Chronic care acceptance", source: "/api/chronic/acceptance-ledger", report: acceptanceLedgers?.chronic || fallbackChronic },
    { id: "county", title: "County consortium acceptance", source: "/api/county/acceptance-ledger", report: acceptanceLedgers?.county || fallbackCounty }
  ];

  container.innerHTML = ledgers.map((group) => {
    const summary = group.report?.summary || {};
    const serviceSummary = group.report?.serviceSummary?.summary || null;
    const openServiceItems = serviceSummary?.openWorkflowItems ?? serviceSummary?.openCollaborationOrders ?? 0;
    const rows = (group.report?.ledger || []).map((item) => {
      const ready = String(item.acceptanceStatus || item.status || "").includes("ready") || /建档|归档|闭环|完成|通过|已/.test(String(item.acceptanceStatus || item.status || ""));
      return `<div>
        <strong>${item.name || item.id}</strong>
        <span>${item.metric?.detail || item.evidence || "evidence pending"}<br>${item.owner || "owner pending"} · ${item.next || item.nextAction || "next action pending"}</span>
        <span class="badge ${ready ? "info" : "warn"}">${item.acceptanceStatus || item.status || "review"}</span>
      </div>`;
    }).join("");
    return `<article class="priority-row" data-acceptance-ledger="${group.id}">
      <div class="priority-rank ${group.report?.ok ? "info" : "warn"}">${summary.ready || 0}/${summary.total || 0}</div>
      <div>
        <h3>${group.title}</h3>
        <p>${serviceSummary ? `${serviceSummary.readyDomains}/${serviceSummary.domains} service domains ready; ${openServiceItems} open items; ` : ""}${summary.needsFollowUp || 0} rows need follow-up; source ${group.source}.</p>
        <div class="rules">${rows}</div>
      </div>
      <div class="capability-side">
        <span class="badge ${group.report?.ok ? "info" : "warn"}">${group.report?.ok ? "PASS" : "REVIEW"}</span>
        <small>${acceptanceLedgers ? "live API ledger" : "static snapshot ledger"}</small>
      </div>
    </article>`;
  }).join("");
}

function renderSiteReadinessPack(siteReadinessPack, siteTemplateReadmes) {
  const container = document.querySelector("#site-readiness-pack");
  if (!container) return;

  if (!siteReadinessPack) {
    container.innerHTML = `<article class="priority-row">
      <div class="priority-rank warn">API</div>
      <div>
        <h3>Site readiness pack</h3>
        <p>Run Node service and sign in as commission to view live identity, interface, monitoring, and signoff templates.</p>
      </div>
      <div class="capability-side">
        <span class="badge warn">static preview</span>
        <small>/api/site-readiness-pack</small>
      </div>
    </article>`;
    return;
  }

  const readmeById = Object.fromEntries((siteTemplateReadmes?.readmes || []).map((item) => [item.id, item]));
  const readmeIdByPack = {
    "identity-source-pack": "identity-source-mapping",
    "interface-joint-test-pack": "interface-joint-test",
    "monitoring-operations-pack": "monitoring-on-call",
    "production-signoff-pack": "production-signoff"
  };
  const packRows = (siteReadinessPack.packs || []).map((pack, index) => {
    const ready = pack.status === "template-ready";
    const readme = readmeById[readmeIdByPack[pack.id]];
    return `<article class="priority-row" data-site-pack="${pack.id}">
      <div class="priority-rank ${ready ? "info" : "warn"}">${index + 1}</div>
      <div>
        <h3>${pack.name}</h3>
        <p>${pack.rows} template rows; required artifacts: ${(pack.requiredArtifacts || []).join(", ")}</p>
        <div class="standard-tags">
          <span class="badge ${ready ? "info" : "warn"}">${pack.status}</span>
          <span class="badge info">${pack.owner}</span>
          ${readme ? `<span class="badge info">README rows ${readme.rows}</span>` : ""}
        </div>
      </div>
      <div class="capability-side">
        <small>/api/site-readiness-pack</small>
        ${readme ? `<small>${readme.file}</small>` : ""}
        <small>release/site-readiness-pack.md</small>
      </div>
    </article>`;
  }).join("");

  const readmeRows = (siteTemplateReadmes?.readmes || []).map((readme) => `<article class="priority-row site-template-readme" data-template-readme="${readme.id}">
    <div class="priority-rank ${readme.status === "template-ready" ? "info" : "warn"}">MD</div>
    <div>
      <h3>${readme.title}</h3>
      <p>${readme.rows} rows; ${readme.requiredArtifacts?.length || 0} artifact types; ${readme.liveEvidence}</p>
      <div class="standard-tags">
        <span class="badge info">${readme.owner}</span>
        <span class="badge ${readme.status === "template-ready" ? "info" : "warn"}">${readme.status}</span>
        <span class="badge info">README generated</span>
      </div>
    </div>
    <div class="capability-side">
      <small>${readme.file}</small>
      <small>/api/site-template-readmes</small>
    </div>
  </article>`).join("");

  container.innerHTML = `${packRows}${readmeRows || `<article class="priority-row">
    <div class="priority-rank warn">MD</div>
    <div>
      <h3>Template README bundle</h3>
      <p>Run Node service and sign in as commission to view generated template README content.</p>
    </div>
    <div class="capability-side">
      <span class="badge warn">static preview</span>
      <small>/api/site-template-readmes</small>
    </div>
  </article>`}`;
}

function renderAudit(state, tasks) {
  const chronicOpen = countOpen(state.chronicScreeningTasks, ["已评估", "已推送干预"]) +
    countOpen(state.chronicEducationPushes, ["已确认", "已阅读"]) +
    countOpen(state.chronicManagementPlans, ["已复核"]);
  const countyOpen = countOpen(state.countyCollaborationOrders, ["已回传", "已完成"]) +
    countOpen(state.countyMutualRecognitionRecords, ["已互认"]) +
    countOpen(state.countyAiDiagnosisCases, ["已完成"]);
  const interfaceCount = state.chronicProjectBlueprint?.externalInterfaces?.length || 0;
  const countyNewApps = state.countyProjectBlueprint?.newApps?.length || 0;
  const activeRisks = tasks.filter((item) => item.level === "高").length;

  const summaryEl = document.querySelector("#audit-summary");
  if (summaryEl) {
    summaryEl.innerHTML = [
      ["慢病业务闭环", chronicOpen === 0, chronicOpen ? `${chronicOpen} 项筛查、宣教或分级管理任务仍需推进。` : "演示台账已闭环。"],
      ["医共体业务闭环", countyOpen === 0, countyOpen ? `${countyOpen} 项协同工单、互认或 AI 辅诊事项仍需推进。` : "演示台账已闭环。"],
      ["慢病外部接口", false, `${interfaceCount} 类接口已列入蓝图，仍需现场对接真实业务系统。`],
      ["医共体新建应用", false, `${countyNewApps} 个专项应用已列入清单，需继续完成实施排期和验收口径。`],
      ["跨端高风险待办", activeRisks === 0, activeRisks ? `${activeRisks} 项高风险事项需优先处理。` : "暂无高风险待办。"]
    ].map(([name, ok, detail]) => `<section class="item">
      <div>
        <h3>${name}</h3>
        <p>${detail}</p>
      </div>
      <span class="badge ${ok ? "info" : "warn"}">${ok ? "已闭环" : "需推进"}</span>
    </section>`).join("");
  }

  const gapsEl = document.querySelector("#audit-gaps");
  if (gapsEl) {
    const gaps = (state.platformAudit || []).length ? state.platformAudit.map((item) => [item.module, `${item.issue} 下一步：${item.nextAction}`]) : [
      ["慢病", "把筛查任务、宣教推送、分级管理计划从展示台账推进到可追踪的责任人、截止日期、结果回写和质控复核。"],
      ["慢病", "对接居民基本信息、门诊/住院、体检、死因监测、民政死亡、专病库等外部接口，并标注接口状态。"],
      ["医共体", "把影像、心电、检验、消毒供应、跨机构预约、合理用药、绩效等新建应用拆成上线批次。"],
      ["医共体", "建立互认规则、不互认原因、危急值、报告回传、医保调阅和质控复核的闭环验收指标。"]
    ];
    gapsEl.innerHTML = gaps.map(([module, detail]) => `<div><strong>${module}</strong><span>${detail}</span></div>`).join("");
  }
}

function countOpen(rows, closedStatuses) {
  const closed = new Set(closedStatuses);
  return (rows || []).filter((item) => !closed.has(item.status)).length;
}

function renderProcessAudit(state, processAudit) {
  const container = document.querySelector("#process-audit-matrix");
  if (!container) return;
  const rows = processAudit?.processRows?.length ? processAudit.processRows : (state.platformProcessAudit?.length ? state.platformProcessAudit : buildProcessAudit(state));
  const domains = (processAudit?.evidenceDomains || []).map((item) =>
    `<span class="badge ${item.passed ? "info" : "warn"}">${item.id}</span>`
  ).join("");
  container.innerHTML = rows.map((item, index) => {
    const badge = item.status === "已闭环" ? "info" : item.status === "进行中" ? "warn" : "danger";
    return `<article class="priority-row">
      <div class="priority-rank ${badge}">${index + 1}</div>
      <div>
        <h3>${item.process}</h3>
        <p>${item.auditPoint}</p>
        <div class="standard-tags">
          <span class="badge info">${item.owner}</span>
          <span class="badge ${badge}">${item.status}</span>
          <span class="badge warn">${item.risk}</span>
        </div>
      </div>
      <div class="capability-side">
        <small>${item.evidence}</small>
        <small>${item.nextAction}</small>
      </div>
    </article>`;
  }).join("") + (domains ? `<article class="priority-row">
    <div class="priority-rank ${processAudit?.ok ? "info" : "warn"}">${processAudit?.ok ? "OK" : "!"}</div>
    <div>
      <h3>Full process evidence domains</h3>
      <p>${processAudit?.summary?.passedDomains || 0}/${processAudit?.summary?.evidenceDomains || 0} evidence domains passed from /api/process-audit.</p>
      <div class="standard-tags">${domains}</div>
    </div>
    <div class="capability-side">
      <small>/api/process-audit</small>
      <small>release/process-audit-report.md</small>
    </div>
  </article>` : "");
}

function buildProcessAudit(state) {
  const hasAuth = Boolean(state.authUsers?.length && state.securityEvents?.length);
  const hasIndex = Boolean(state.residents?.every((item) => item.personIndex || item.identityIndex));
  const pendingFollowups = countOpen(state.followups, ["已完成"]);
  const pendingReferrals = countOpen(state.referralSystem?.referrals, ["已完成", "已接诊", "基层承接"]);
  const pendingPickups = countOpen(state.medicationPickups, ["已取药", "已完成"]);
  const pendingClaims = countOpen(state.insuranceClaims, ["已通过"]);
  const pendingCounty = countOpen(state.countyCollaborationOrders, ["已回传", "已完成"]);
  const pendingEmergency = countOpen(state.emergencySignals, ["已处置"]);
  return [
    { process: "统一登录与角色权限", owner: "市级平台", status: hasAuth ? "进行中" : "待补齐", risk: "真实身份源待接入", auditPoint: "核查账号、角色、机构范围、拒绝访问和安全事件是否留痕。", evidence: `${state.authUsers?.length || 0} 个演示账号 / ${state.securityEvents?.length || 0} 条安全事件`, nextAction: "接入政务统一认证、密码哈希和机构级权限。" },
    { process: "居民主索引与个人健康信息库", owner: "市级平台", status: hasIndex ? "已闭环" : "待补齐", risk: "正式人口主索引待接入", auditPoint: "核查居民、档案、病历、授权、取药、医保是否使用同一 personIndex。", evidence: `${state.residents?.length || 0} 名居民 / ${state.personalRecords?.length || 0} 条个人健康记录`, nextAction: "对接人口库、电子健康码和正式健康档案主索引。" },
    { process: "慢病筛查、随访与分级管理", owner: "疾控/卫健委", status: pendingFollowups ? "进行中" : "已闭环", risk: "外部专病库与质控待接入", auditPoint: "核查筛查建档、风险分层、随访、宣教、分级管理是否形成闭环。", evidence: `${state.chronicScreeningTasks?.length || 0} 个筛查任务 / ${pendingFollowups} 个随访待办`, nextAction: "补齐模型版本、触发阈值、人工复核和质控抽查。" },
    { process: "分级诊疗与双向转诊", owner: "转诊中心", status: pendingReferrals ? "进行中" : "已闭环", risk: "真实号源床位接口待接入", auditPoint: "核查基层评估、上转、接诊、下转、随访和医保引导。", evidence: `${state.referralSystem?.referrals?.length || 0} 条转诊记录 / ${pendingReferrals} 条待处理`, nextAction: "接入预约号源、床位、接诊反馈和下转随访消息。" },
    { process: "固定取药与长期处方", owner: "基层机构/医保中心", status: pendingPickups ? "进行中" : "已闭环", risk: "药房库存与医保结算接口待接入", auditPoint: "核查个人申请、机构确认、医保中心审核、药房取药和状态回流。", evidence: `${state.medicationPickups?.length || 0} 条取药计划 / ${pendingPickups} 条待处理`, nextAction: "对接处方、药房库存、配送和医保结算状态。" },
    { process: "医保审核与监管", owner: "医保局/医保中心/区市县医保局", status: pendingClaims ? "进行中" : "已闭环", risk: "医保核心系统待接入", auditPoint: "核查慢病结算、支付引导、凭证核验、机构监管和审核留痕，区分行政监管、经办审核和属地监管职责。", evidence: `${state.insuranceClaims?.length || 0} 条医保审核 / ${pendingClaims} 条待审核`, nextAction: "接入医保核心结算、门慢门特、双通道和异地转诊规则。" },
    { process: "县域医共体协同", owner: "医共体办公室", status: pendingCounty ? "进行中" : "已闭环", risk: "新建应用批次与验收待细化", auditPoint: "核查医技共享、互认、基层 AI、绩效、人财物和药耗协同。", evidence: `${state.countyProjectBlueprint?.newApps?.length || 0} 个新建应用 / ${pendingCounty} 个协同工单待处理`, nextAction: "拆分上线批次，建立互认、危急值、报告回传和绩效验收指标。" },
    { process: "公共卫生应急预警", owner: "卫健委端", status: pendingEmergency ? "进行中" : "已闭环", risk: "多点触发真实数据源待接入", auditPoint: "核查风险信号、资源调度、处置反馈和复盘记录。", evidence: `${state.emergencySignals?.length || 0} 条预警信号 / ${pendingEmergency} 条待处置`, nextAction: "接入疾控、医疗资源、基层随访和医保异常监测。" },
    { process: "出生死亡证明与人口统计", owner: "医疗机构/卫健委", status: "进行中", risk: "国家平台与公安民政共享待接入", auditPoint: "核查证照签发、材料、上报、共享、质控和统计回流。", evidence: `${state.birthCertificates?.length || 0} 条出生证明 / ${state.deathCertificates?.length || 0} 条死亡证明`, nextAction: "对接电子证照、人口死亡登记、公安户籍和民政殡葬共享。" },
    { process: "卫生统计导入与发布", owner: "规划发展与信息化处", status: "进行中", risk: "国家直报系统接口待接入", auditPoint: "核查采集、解析、指标映射、质控、入库、发布和审计留痕。", evidence: `${state.healthStatisticsIngestion?.jobs?.length || 0} 个导入任务 / ${state.healthStatistics?.resourceReports?.length || 0} 条资源报表`, nextAction: "固化指标口径、映射规则、版本发布和差异复核。" },
    { process: "数据安全与访问审计", owner: "安全管理岗", status: state.dataAccessLogs?.length ? "进行中" : "待补齐", risk: "生产级脱敏、密评、等保待实施", auditPoint: "核查授权、访问、拒绝、脱敏、敏感写操作和审计日志。", evidence: `${state.dataAccessLogs?.length || 0} 条访问日志 / ${state.securityEvents?.length || 0} 条安全事件`, nextAction: "补齐生产级日志保全、脱敏策略、密评和等保验收证据。" }
  ];
}

function renderSourceAlignment(state) {
  const chronic = state.chronicProjectBlueprint || {};
  const county = state.countyProjectBlueprint || {};
  const coverage = county.coverage || [];
  const chronicSourceEl = document.querySelector("#source-alignment-chronic-source");
  const countySourceEl = document.querySelector("#source-alignment-county-source");
  if (chronicSourceEl) chronicSourceEl.textContent = chronic.source || "";
  if (countySourceEl) countySourceEl.textContent = county.source || "";

  const chronicEl = document.querySelector("#source-alignment-chronic");
  if (chronicEl) {
    chronicEl.innerHTML = [
      ["总体目标", chronic.goal || "待配置"],
      ["建设架构", `${(chronic.architecture || []).length} 项：${(chronic.architecture || []).map((item) => item.name).join("、")}`],
      ["三网三智能体", `${(chronic.networks || []).length} 张业务网 / ${(chronic.aiAgents || []).length} 个智能体`],
      ["专病与模型", `${(chronic.diseaseLibraries || []).length} 个病种库 / ${(chronic.screeningModels || []).length} 个筛查模型`],
      ["外部接口", `${(chronic.externalInterfaces || []).length} 类接口`]
    ].map(([title, text]) => `<div><strong>${title}</strong><span>${text}</span></div>`).join("");
  }

  const countyEl = document.querySelector("#source-alignment-county");
  if (countyEl) {
    const totals = coverage.reduce((acc, item) => ({
      consortiums: acc.consortiums + Number(item.consortiums || 0),
      hospitals: acc.hospitals + Number(item.hospitals || 0),
      primaryCenters: acc.primaryCenters + Number(item.primaryCenters || 0)
    }), { consortiums: 0, hospitals: 0, primaryCenters: 0 });
    countyEl.innerHTML = [
      ["总体目标", county.goal || "待配置"],
      ["建设模型", `${county.model || "16255"}：${(county.modelItems || []).map((item) => item.name).join("、")}`],
      ["覆盖范围", `${coverage.length} 个区县 / ${totals.consortiums} 个医共体 / ${totals.hospitals} 家医院 / ${totals.primaryCenters} 家乡镇卫生院`],
      ["应用清单", `${(county.reusedApps || []).length} 个复用应用 / ${(county.newApps || []).length} 个新建应用`],
      ["资源与安全", `${(county.centers || []).length} 个协同中心 / ${county.dataResources?.catalogs || 0} 项数据资源目录`]
    ].map(([title, text]) => `<div><strong>${title}</strong><span>${text}</span></div>`).join("");
  }
}

function renderPlatformMap(state) {
  const modules = [
    ["统一入口", "login.html / health-city.html / workbench.html", "角色登录、系统总览、总控台。"],
    ["卫健委端", "index.html", "监管总览、慢病医防整合、分级诊疗、公共卫生应急、数据安全审计。"],
    ["县域医共体平台", "county.html", "36 项功能、医技共享、基层综合管理、分级诊疗建设。"],
    ["医疗机构端", "institution.html", "授权档案、标准健康档案、转诊中心、固定取药协同。"],
    ["医保管理与经办", "insurance.html", "医保局政策与基金监管、医保中心经办审核、区市县医保局属地监管。"],
    ["个人端", "citizen.html", "个人健康信息库、电子病历、固定取药、分级诊疗服务。"],
    ["统一数据底座", "data/db.json / server.js", `${Object.keys(state).length} 类数据集合，后续升级 SQLite/PostgreSQL。`],
    ["标准模型", "health-archive-standard.js / referralSystem", "健康档案标准、分级诊疗、县域医共体、个人主索引。"]
  ];
  document.querySelector("#platform-map").innerHTML = modules.map(([title, path, text]) => `<article>
    <strong>${title}</strong>
    <span>${path}</span>
    <p>${text}</p>
  </article>`).join("");
}

function renderPriorityList(roadmap) {
  document.querySelector("#priority-list").innerHTML = roadmap.map((item) => {
    const badge = item.priority === "P0" ? "danger" : item.priority === "P1" ? "warn" : "info";
    const statusClass = item.status === "已完成" ? "" : item.status === "进行中" ? "info" : "warn";
    return `<article class="priority-row">
      <div class="priority-rank ${badge}">${item.priority}</div>
      <div>
        <h3>${item.title}</h3>
        <p>${item.reason}</p>
        <div class="standard-tags">
          ${(item.scope || []).map((scope) => `<span class="badge info">${scope}</span>`).join("")}
        </div>
      </div>
      <div class="capability-side">
        <span class="badge ${statusClass}">${item.status}</span>
        <small>${item.nextAction}</small>
      </div>
    </article>`;
  }).join("");
}

function renderUnifiedTasks(tasks) {
  document.querySelector("#task-count").textContent = `${tasks.length} 项`;
  document.querySelector("#unified-tasks").innerHTML = tasks.slice(0, 12).map((task) => `<section class="item">
    <div>
      <h3>${task.title}</h3>
      <p>${task.owner} · ${task.module}</p>
      <p>${task.detail}</p>
    </div>
    <span class="badge ${task.level === "高" ? "danger" : task.level === "中" ? "warn" : "info"}">${task.status}</span>
  </section>`).join("") || `<p class="muted">暂无跨端待办。</p>`;
}

function renderDataMaturity(state) {
  const rows = [
    ["居民主索引", state.residents?.every((item) => item.personIndex || item.identityIndex), "跨端数据已使用 personIndex 贯通。"],
    ["健康档案标准", Boolean(state.healthArchiveStandard), "32 类基础数据集已经进入个人端和医生端。"],
    ["分级诊疗模型", Boolean(state.referralSystem), "基层首诊、转诊、医保支付和家庭医生服务已入模。"],
    ["县域医共体模型", Boolean(state.countyConsortium), "36 项功能清单和运营监管已入模。"],
    ["登录权限", Boolean(state.authUsers?.length && state.securityEvents?.length), "已具备后端会话、角色校验和安全事件日志第一版。"],
    ["持久化数据库", Boolean(state.storageMeta?.engine), `${state.storageMeta?.mode || "已配置 SQLite 主存储与 JSON 快照兼容策略。"}${state.storageMeta?.sqliteFile ? ` · ${state.storageMeta.sqliteFile}` : ""}`]
  ];
  document.querySelector("#data-maturity").innerHTML = rows.map(([name, ok, detail]) => `<section class="item">
    <div>
      <h3>${name}</h3>
      <p>${detail}</p>
    </div>
    <span class="badge ${ok ? "info" : "warn"}">${ok ? "已具备" : "待建设"}</span>
  </section>`).join("");
}

function renderNextQueue(roadmap) {
  const next = roadmap.filter((item) => item.status !== "已完成").slice(0, 5);
  document.querySelector("#next-queue").innerHTML = next.map((item) => `<div>
    <strong>${item.priority} · ${item.title}</strong>
    <span>${item.nextAction}</span>
  </div>`).join("");
}

function collectUnifiedTasks(state) {
  const tasks = [];
  (state.followups || []).filter((item) => item.status !== "已完成").forEach((item) => {
    const resident = residentOf(state, item.residentId);
    tasks.push({
      title: `${resident?.name || "未知居民"} · ${item.diseaseType}随访`,
      owner: item.assignee,
      module: "慢病医防整合",
      detail: `${item.plannedAt} · ${item.advice || item.result}`,
      status: item.status,
      level: item.status === "已逾期" ? "高" : "中"
    });
  });
  (state.referralSystem?.referrals || []).filter((item) => !["已完成", "已接诊", "基层承接"].includes(item.status)).forEach((item) => {
    const resident = residentOf(state, item.residentId);
    tasks.push({
      title: `${resident?.name || "未知居民"} · ${item.type}`,
      owner: "转诊中心",
      module: "分级诊疗",
      detail: `${item.from} -> ${item.to} · ${item.reason}`,
      status: item.status,
      level: item.priority === "高" ? "高" : "中"
    });
  });
  (state.insuranceClaims || []).filter((item) => item.status !== "已通过").forEach((item) => {
    const resident = residentOf(state, item.residentId);
    tasks.push({
      title: `${resident?.name || "未知居民"} · ${item.claimType}`,
      owner: "医保中心经办端",
      module: "医保审核",
      detail: `${item.institution} · ${money(item.totalAmount)} · ${item.risk}`,
      status: item.status,
      level: item.status === "待审核" ? "高" : "中"
    });
  });
  (state.medicationPickups || []).filter((item) => !["已取药", "已完成"].includes(item.status)).forEach((item) => {
    const resident = residentOf(state, item.residentId);
    tasks.push({
      title: `${resident?.name || "未知居民"} · 固定取药`,
      owner: item.pharmacy,
      module: "个人端/医疗机构/医保",
      detail: `${item.medication} · ${item.nextPickup} · ${item.institutionReview || "待机构确认"} / ${item.insuranceReview || "待医保审核"}`,
      status: item.status,
      level: item.status === "待取药" ? "中" : "高"
    });
  });
  (state.emergencySignals || []).filter((item) => item.status !== "已处置").forEach((item) => {
    tasks.push({
      title: item.title,
      owner: "卫健委端",
      module: "公共卫生应急",
      detail: `${item.region} · ${item.action}`,
      status: item.status,
      level: item.level
    });
  });
  (state.chronicScreeningTasks || []).filter((item) => !["已评估", "已推送干预"].includes(item.status)).forEach((item) => {
    const resident = residentOf(state, item.residentId);
    tasks.push({
      title: `${resident?.name || "未知居民"} · ${item.taskName}`,
      owner: item.assignee,
      module: "慢病筛查任务中心",
      detail: `${item.model} · ${item.nextStep}`,
      status: item.status,
      level: item.riskLevel === "高危" ? "高" : "中"
    });
  });
  (state.chronicEducationPushes || []).filter((item) => !["已确认", "已阅读"].includes(item.status)).forEach((item) => {
    const resident = residentOf(state, item.residentId);
    tasks.push({
      title: `${resident?.name || "未知居民"} · ${item.topic}`,
      owner: "健康宣教智能体",
      module: "慢病精准宣教",
      detail: `${item.channel} · ${item.trigger}`,
      status: item.status,
      level: "中"
    });
  });
  (state.chronicManagementPlans || []).filter((item) => item.status !== "已复核").forEach((item) => {
    const resident = residentOf(state, item.residentId);
    tasks.push({
      title: `${resident?.name || "未知居民"} · ${item.diseaseType}管理计划`,
      owner: item.owner,
      module: "慢病分级管理",
      detail: `${item.grade} · ${item.intervention}`,
      status: item.status,
      level: item.grade === "高危" ? "高" : "中"
    });
  });
  (state.countyCollaborationOrders || []).filter((item) => !["已回传", "已完成"].includes(item.status)).forEach((item) => {
    tasks.push({
      title: `${item.region} · ${item.orderType}`,
      owner: item.center,
      module: "医共体协同中心",
      detail: `${item.fromInstitution} -> ${item.toInstitution} · ${item.result}`,
      status: item.status,
      level: item.priority === "高" ? "高" : "中"
    });
  });
  (state.countyMutualRecognitionRecords || []).filter((item) => item.status !== "已互认").forEach((item) => {
    const resident = residentOf(state, item.residentId);
    tasks.push({
      title: `${resident?.name || "未知居民"} · ${item.item}互认`,
      owner: "医共体质控中心",
      module: "检查检验结果互认",
      detail: `${item.sourceInstitution} -> ${item.targetInstitution} · ${item.reason}`,
      status: item.status,
      level: item.status === "退回复核" ? "高" : "中"
    });
  });
  (state.countyAiDiagnosisCases || []).filter((item) => item.status !== "已完成").forEach((item) => {
    const resident = residentOf(state, item.residentId);
    tasks.push({
      title: `${resident?.name || "未知居民"} · AI辅诊确认`,
      owner: item.institution,
      module: "基层AI辅助诊断",
      detail: `${item.chiefComplaint} · ${item.suggestion}`,
      status: item.status,
      level: item.status === "转诊中" ? "高" : "中"
    });
  });
  (state.countyConsortium?.tasks || []).filter((item) => item.status !== "已完成").forEach((item) => {
    tasks.push({
      title: item.title,
      owner: item.owner,
      module: "县域医共体平台",
      detail: `${item.due} · ${item.action}`,
      status: item.status,
      level: item.level
    });
  });
  return tasks.sort((a, b) => weightOf(b.level) - weightOf(a.level));
}

function residentOf(state, id) {
  return (state.residents || []).find((item) => item.id === id);
}

function weightOf(level) {
  return { 高: 3, 中: 2, 低: 1 }[level] || 0;
}

function defaultRoadmap() {
  return [
    {
      priority: "P0",
      title: "统一运营工作台",
      reason: "系统功能多、端口多，需要总控台承接整体梳理、跨端待办和后续开发顺序。",
      scope: ["系统总览", "跨端待办", "路线图"],
      status: "已完成",
      nextAction: "继续从工作台选择下一项 P0。"
    },
    {
      priority: "P0",
      title: "真实认证、角色权限和审计闭环",
      reason: "健康档案和电子病历属于敏感数据，当前登录仍是前端演示，需要后端会话、接口权限和审计。",
      scope: ["登录", "权限", "审计", "API"],
      status: "已完成",
      nextAction: "已完成后端会话、接口权限、字段脱敏、授权撤销、访问复核和审计闭环；真实身份源接入列为现场实施。"
    },
    {
      priority: "P0",
      title: "SQLite 数据库迁移",
      reason: "JSON 适合演示，不适合长期开发。需要结构化表、索引、迁移脚本和数据备份。",
      scope: ["数据层", "持久化", "迁移"],
      status: "已完成",
      nextAction: "已完成 SQLite 主存储、集合版本、乐观锁、恢复演练和结构化镜像表；生产拆表按部署环境继续扩展。"
    },
    {
      priority: "P1",
      title: "居民 360 详情与趋势图",
      reason: "医生和居民都需要按时间查看指标、病历、用药、检查、随访、取药和转诊。",
      scope: ["个人端", "医疗机构端", "健康档案"],
      status: "已完成",
      nextAction: "已在卫健委端、居民端和医疗机构端形成 360 总览、健康指标趋势、档案病历、协同闭环和访问审计。"
    },
    {
      priority: "P1",
      title: "业务动作闭环",
      reason: "当前多数状态为展示型，下一步要能接诊、审核、下转、完成取药、完成随访。",
      scope: ["分级诊疗", "医保", "取药", "随访"],
      status: "已完成",
      nextAction: "已完成通用业务闭环状态接口和多类业务级 PATCH，覆盖接诊、审核、签发、上报、取药、备案、预警和县域处置。"
    },
    {
      priority: "P1",
      title: "检查检验互认与资源共享中心深化",
      reason: "县域医共体和分级诊疗都依赖医技共享、结果互认、危急值和质控。",
      scope: ["医共体", "医疗机构", "医保监管"],
      status: "已完成",
      nextAction: "已完成互认规则、报告回传、危急值预警、县域处置、质控复核、不互认原因和任务消息接入。"
    },
    {
      priority: "P2",
      title: "统计报表和绩效考核",
      reason: "卫健委和医共体办公室需要面向管理的月报、绩效、机构排名和导出能力。",
      scope: ["卫健委端", "县域医共体", "导出"],
      status: "已完成",
      nextAction: "已完成机构信用评分、公示申诉、医共体绩效、人财物、药耗和基层履约报表 API。"
    },
    {
      priority: "P2",
      title: "移动端和适老化深化",
      reason: "居民端最终要在手机上使用，需要大字模式、家属代办、消息提醒和无障碍优化。",
      scope: ["个人端", "手机预览", "适老化"],
      status: "已完成",
      nextAction: "已完成移动体验设置、无障碍验收清单、大字模式、读屏语义、家属代办、线下帮办、消息触达、弱网模式和居民偏好隔离 API。"
    }
  ];
}
