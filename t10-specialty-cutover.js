const cutoverState = {
  pack: null,
  source: "fallback"
};

document.addEventListener("DOMContentLoaded", async () => {
  cutoverState.pack = await loadCutoverPack();
  renderCutoverPack(cutoverState.pack);
});

async function loadCutoverPack() {
  if (location.protocol !== "file:") {
    try {
      const response = await fetch("./release/t10-specialty-cutover-pack.json", { cache: "no-store" });
      if (response.ok) {
        cutoverState.source = "release-artifact";
        return withCutoverDefaults(await response.json());
      }
    } catch (error) {
      // Static fallback keeps the preview useful before release artifacts are generated.
    }
  }
  return fallbackCutoverPack();
}

function withCutoverDefaults(pack) {
  const fallback = fallbackCutoverPack();
  return {
    ...fallback,
    ...pack,
    summary: { ...fallback.summary, ...(pack.summary || {}) },
    stages: pack.stages || fallback.stages,
    firstIncrement: { ...fallback.firstIncrement, ...(pack.firstIncrement || {}) },
    tracks: pack.tracks || fallback.tracks,
    institutionDeploymentManifest: pack.institutionDeploymentManifest || fallback.institutionDeploymentManifest,
    crossTrackControls: pack.crossTrackControls || fallback.crossTrackControls,
    rehearsalPlan: pack.rehearsalPlan || fallback.rehearsalPlan,
    goNoGoDecision: pack.goNoGoDecision || fallback.goNoGoDecision,
    evidenceDossier: pack.evidenceDossier || fallback.evidenceDossier,
    pilotBatchPlan: pack.pilotBatchPlan || fallback.pilotBatchPlan,
    siteEvidenceWorkflow: pack.siteEvidenceWorkflow || fallback.siteEvidenceWorkflow,
    acceptanceScenarioSuite: pack.acceptanceScenarioSuite || fallback.acceptanceScenarioSuite,
    scenarioEvidenceMatrix: pack.scenarioEvidenceMatrix || fallback.scenarioEvidenceMatrix,
    cutoverCommandCenter: pack.cutoverCommandCenter || fallback.cutoverCommandCenter,
    observationSignalBoard: pack.observationSignalBoard || fallback.observationSignalBoard,
    runtimeSmokePlan: pack.runtimeSmokePlan || fallback.runtimeSmokePlan,
    integrity: pack.integrity || fallback.integrity
  };
}

function renderCutoverPack(pack) {
  renderKpis(pack);
  renderFirstIncrement(pack.firstIncrement || {});
  renderTracks(pack.tracks || [], pack.stages || []);
  renderInstitutionDeploymentManifest(pack.institutionDeploymentManifest || {});
  renderControls(pack.crossTrackControls || []);
  renderRehearsalPlan(pack.rehearsalPlan || {});
  renderDecisionMatrix(pack.goNoGoDecision || {});
  renderEvidenceDossier(pack.evidenceDossier || {});
  renderPilotBatchPlan(pack.pilotBatchPlan || {});
  renderSiteEvidenceWorkflow(pack.siteEvidenceWorkflow || {});
  renderAcceptanceScenarioSuite(pack.acceptanceScenarioSuite || {});
  renderScenarioEvidenceMatrix(pack.scenarioEvidenceMatrix || {});
  renderCutoverCommandCenter(pack.cutoverCommandCenter || {});
  renderObservationSignalBoard(pack.observationSignalBoard || {});
  renderRuntimeSmokePlan(pack.runtimeSmokePlan || {});
  renderBlockers(pack.tracks || []);
}

function renderKpis(pack) {
  const summary = pack.summary || {};
  const sourceLabel = cutoverState.source === "release-artifact" ? "release/t10-specialty-cutover-pack.json" : "前端内置边界";
  document.querySelector("#cutover-kpis").innerHTML = [
    kpi("代码就绪", `${summary.codeReady || 0}/${summary.tracks || 0}`, "ok"),
    kpi("检查通过", `${summary.passedChecks || 0}/${summary.totalChecks || 0}`, "ok"),
    kpi("生产就绪", `${summary.productionReady || 0}/${summary.tracks || 0}`, "warn"),
    kpi("现场阻断", summary.siteBlockers || 0, "warn")
  ].join("");
  document.querySelector("#cutover-state-note").textContent = `正式上线状态：${summary.formalGoLiveState || "blocked-until-site-evidence-signed"}；数据来源：${sourceLabel}；完整性摘要：${pack.integrity?.digest || "未生成"}`;
}

function renderFirstIncrement(increment) {
  document.querySelector("#first-increment").innerHTML = `
    <div class="cutover-card">
      <div class="badge-row">
        <span class="badge warn">${escapeHtml(increment.trackName || "待选择")}</span>
        <span class="badge">灰度验收</span>
      </div>
      <p>${escapeHtml(increment.recommendation || "")}</p>
      <p class="muted">${escapeHtml(increment.why || "")}</p>
      <h4>启动前必须补齐</h4>
      <ul class="evidence-list">${(increment.requiredBeforeStart || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    </div>
  `;
}

function renderTracks(tracks, stages) {
  document.querySelector("#track-grid").innerHTML = tracks.map((track) => `
    <article class="cutover-card">
      <h3>${escapeHtml(track.name)}</h3>
      <p class="muted">${escapeHtml(track.department)}</p>
      <div class="badge-row">
        <span class="badge ${track.codeReady ? "ok" : "warn"}">代码${track.codeReady ? "就绪" : "待补"}</span>
        <span class="badge ${track.productionReady ? "ok" : "warn"}">生产${track.productionReady ? "可上线" : "待签收"}</span>
        <span class="badge warn">${track.blockers?.length || 0}个现场阻断</span>
      </div>
      <ul class="stage-list">${stages.map((stage) => `<li class="${stage === track.currentStage ? "stage-active" : ""}">${escapeHtml(stage)}</li>`).join("")}</ul>
      <p><a href="./${encodeURIComponent(track.page)}">打开页面</a> · <code>${escapeHtml(track.api)}</code></p>
      <p class="muted">Readiness digest：${escapeHtml(track.readiness?.digest || "")}</p>
    </article>
  `).join("");
}

function renderInstitutionDeploymentManifest(manifest) {
  const modules = manifest.enabledModules || [];
  const rows = modules.map((item) => `
    <tr>
      <td><strong>${escapeHtml(item.name)}</strong><br><span class="muted">${escapeHtml(item.deploymentUnit)}</span></td>
      <td><a href="./${encodeURIComponent(item.page)}">${escapeHtml(item.page)}</a><br><code>${escapeHtml(item.api)}</code></td>
      <td><code>${escapeHtml(item.dataNamespace)}</code></td>
      <td>${escapeHtml(item.rollbackUnit)}</td>
      <td><span class="badge warn">${escapeHtml(item.productionTrafficState)}</span></td>
    </tr>
  `).join("");
  document.querySelector("#institution-deployment-manifest").innerHTML = `
    <div class="cutover-card">
      <div class="badge-row">
        <span class="badge">${escapeHtml(manifest.institutionId || "institution-template")}</span>
        <span class="badge ok">${escapeHtml(manifest.activationPolicy || "deny-by-default")}</span>
        <span class="badge warn">${escapeHtml(manifest.productionTrafficState || "blocked-until-site-evidence-signed")}</span>
      </div>
      <p class="muted">启用模块：${(manifest.enabledModuleIds || []).map(escapeHtml).join(" / ") || "无"}；禁用模块：${(manifest.disabledModuleIds || []).map(escapeHtml).join(" / ") || "无"}。</p>
      <p class="muted">页面白名单：${(manifest.routeAllowlist || []).map(escapeHtml).join(" / ") || "无"}；API 白名单：${(manifest.apiAllowlist || []).map(escapeHtml).join(" / ") || "无"}。</p>
    </div>
    <div class="table-wrap">
      <table class="cutover-table">
        <thead><tr><th>模块/部署单元</th><th>页面与 API</th><th>数据命名空间</th><th>独立回退单元</th><th>生产流量</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="5">未选择任何专项模块</td></tr>'}</tbody>
      </table>
    </div>
    <div class="cutover-card">
      <h3>部署校验规则</h3>
      <ul class="evidence-list">${(manifest.validationRules || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    </div>
  `;
}

function renderControls(controls) {
  document.querySelector("#control-grid").innerHTML = controls.map((control) => `
    <article class="cutover-card">
      <h3>${escapeHtml(control.name)}</h3>
      <p class="muted">${escapeHtml(control.owner)}</p>
      <p>${escapeHtml(control.acceptance)}</p>
      <p class="muted">适用：${(control.appliesTo || []).map(escapeHtml).join(" / ")}</p>
    </article>
  `).join("");
}

function renderRehearsalPlan(plan) {
  const timeline = plan.timeline || [];
  const dutyRoster = plan.dutyRoster || [];
  const rollbackTriggers = plan.rollbackTriggers || [];
  const evidenceToArchive = plan.evidenceToArchive || [];
  document.querySelector("#rehearsal-plan").innerHTML = `
    <div class="cutover-card">
      <div class="badge-row">
        <span class="badge warn">${escapeHtml(plan.scope?.primaryTrackName || "待选择主专项")}</span>
        <span class="badge">${escapeHtml(plan.scope?.pilotSize || "受控灰度")}</span>
      </div>
      <p class="muted">本次纳入：${(plan.scope?.includedTracks || []).map(escapeHtml).join(" / ") || "待定"}；旁路观察：${(plan.scope?.watchOnlyTracks || []).map(escapeHtml).join(" / ") || "无"}</p>
    </div>
    <div class="track-grid">
      ${timeline.map((item) => `
        <article class="cutover-card">
          <h3>${escapeHtml(item.stage)}</h3>
          <p class="muted">${escapeHtml(item.owner)}</p>
          <ul class="evidence-list">${(item.actions || []).map((action) => `<li>${escapeHtml(action)}</li>`).join("")}</ul>
          <p><strong>退出标准：</strong>${escapeHtml(item.exitCriteria)}</p>
        </article>
      `).join("")}
    </div>
    <div class="control-grid">
      <article class="cutover-card">
        <h3>回退触发</h3>
        <ul class="blocker-list">${rollbackTriggers.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      </article>
      <article class="cutover-card">
        <h3>值守责任</h3>
        <ul class="blocker-list">${dutyRoster.map((item) => `<li><strong>${escapeHtml(item.role)}</strong> · ${escapeHtml(item.owner)}：${escapeHtml(item.responsibility)}</li>`).join("")}</ul>
      </article>
      <article class="cutover-card">
        <h3>归档证据</h3>
        <ul class="blocker-list">${evidenceToArchive.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      </article>
    </div>
  `;
}

function renderDecisionMatrix(decision) {
  const scorecard = decision.scorecard || [];
  const hardStops = decision.hardStops || [];
  const rules = decision.decisionRules || [];
  const nextActions = decision.nextActions || [];
  document.querySelector("#decision-matrix").innerHTML = `
    <div class="cutover-card">
      <div class="badge-row">
        <span class="badge warn">${escapeHtml(decision.currentDecision || "no-go-site-evidence-pending")}</span>
        <span class="badge">${escapeHtml(decision.primaryTrackName || "首个灰度专项")}</span>
        <span class="badge ${Number(decision.score || 0) >= Number(decision.threshold || 100) ? "ok" : "warn"}">${escapeHtml(String(decision.score || 0))}/${escapeHtml(String(decision.threshold || 100))}</span>
      </div>
      <p class="muted">任何 hard stop 命中均直接 No-Go；本地演示数据不能关闭现场阻断。</p>
    </div>
    <div class="table-wrap">
      <table class="cutover-table">
        <thead>
          <tr>
            <th>判定项</th>
            <th>权重</th>
            <th>必须</th>
            <th>当前</th>
          </tr>
        </thead>
        <tbody>
          ${scorecard.map((item) => `
            <tr>
              <td>${escapeHtml(item.name)}</td>
              <td>${escapeHtml(item.weight)}</td>
              <td>${item.required ? "是" : "否"}</td>
              <td><span class="badge ${item.current === "pass" ? "ok" : "warn"}">${escapeHtml(item.current)}</span></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
    <div class="control-grid">
      <article class="cutover-card">
        <h3>Hard stops</h3>
        <ul class="blocker-list">${hardStops.map((item) => `<li><strong>${escapeHtml(item.name)}</strong>：${escapeHtml(item.noGo)}</li>`).join("")}</ul>
      </article>
      <article class="cutover-card">
        <h3>决策规则</h3>
        <ul class="blocker-list">${rules.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      </article>
      <article class="cutover-card">
        <h3>下一步动作</h3>
        <ul class="blocker-list">${nextActions.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      </article>
    </div>
  `;
}

function renderEvidenceDossier(dossier) {
  const entries = dossier.entries || [];
  const firstIncrementRequired = new Set(dossier.firstIncrementRequired || []);
  document.querySelector("#evidence-dossier").innerHTML = `
    <div class="cutover-kpis">
      ${kpi("证据条目", dossier.totalEntries || entries.length, "ok")}
      ${kpi("硬阻断未关", dossier.hardStopOpen || 0, "warn")}
      ${kpi("首增量必备", firstIncrementRequired.size, "warn")}
      ${kpi("证据状态", dossier.status || "site-evidence-pending", "warn")}
    </div>
    <div class="cutover-card">
      <h3>复核策略</h3>
      <p class="muted">提交人与复核人必须不同：${dossier.reviewPolicy?.submitterMustDifferFromReviewer ? "是" : "否"}；摘要算法：${escapeHtml(dossier.reviewPolicy?.digestAlgorithm || "sha256")}</p>
      <p>${escapeHtml(dossier.reviewPolicy?.closeRule || "only accepted evidence can close site-pending blockers")}</p>
    </div>
    <div class="table-wrap">
      <table class="cutover-table">
        <thead>
          <tr>
            <th>专项</th>
            <th>证据编号</th>
            <th>等级</th>
            <th>首增量</th>
            <th>验收检查</th>
          </tr>
        </thead>
        <tbody>
          ${entries.map((item) => `
            <tr>
              <td>${escapeHtml(item.trackName)}</td>
              <td><strong>${escapeHtml(item.evidenceId)}</strong><br>${escapeHtml(item.title)}</td>
              <td><span class="badge ${item.severity === "P0" ? "warn" : ""}">${escapeHtml(item.severity)}</span></td>
              <td>${item.requiredForFirstIncrement ? '<span class="badge warn">必备</span>' : '<span class="badge">旁路</span>'}</td>
              <td>${(item.verificationChecks || []).slice(0, 4).map((check) => `<span class="badge">${escapeHtml(check)}</span>`).join(" ")}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderPilotBatchPlan(plan) {
  const batches = plan.batches || [];
  document.querySelector("#pilot-batch-plan").innerHTML = `
    <div class="cutover-card">
      <div class="badge-row">
        <span class="badge warn">${escapeHtml(plan.status || "ready-to-plan-controlled-rehearsal")}</span>
      </div>
      <p class="muted">每一批只允许在上一批退出标准满足后推进；任何 hard stop 命中均回退到证据补齐和复盘。</p>
    </div>
    <div class="track-grid">
      ${batches.map((batch) => `
        <article class="cutover-card">
          <h3>${escapeHtml(batch.id)} · ${escapeHtml(batch.name)}</h3>
          <p>${escapeHtml(batch.scope)}</p>
          <h4>进入标准</h4>
          <ul class="evidence-list">${(batch.entryCriteria || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
          <h4>退出标准</h4>
          <ul class="evidence-list">${(batch.exitCriteria || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
          <p class="muted">推进结论：${escapeHtml(batch.promotionDecision)}</p>
        </article>
      `).join("")}
    </div>
  `;
}

function renderSiteEvidenceWorkflow(workflow) {
  const states = workflow.states || [];
  const transitions = workflow.transitions || [];
  const sla = workflow.sla || [];
  document.querySelector("#site-evidence-workflow").innerHTML = `
    <div class="cutover-card">
      <div class="badge-row">
        <span class="badge warn">${escapeHtml(workflow.currentGate || "submitted-or-accepted-site-evidence-required-before-batch-1")}</span>
        <span class="badge">Batch-1 ≥ ${escapeHtml(workflow.batchOneEntryRequires?.minimumStatus || "submitted")}</span>
        <span class="badge ok">Preferred ${escapeHtml(workflow.batchOneEntryRequires?.preferredStatus || "accepted")}</span>
      </div>
      <p class="muted">Batch-1 必需证据：${(workflow.batchOneEntryRequires?.evidenceIds || []).map(escapeHtml).join(" / ") || "待生成"}</p>
    </div>
    <div class="track-grid">
      ${states.map((state) => `
        <article class="cutover-card">
          <h3>${escapeHtml(state.id)}</h3>
          <p>${escapeHtml(state.name)}</p>
          <p class="muted">责任：${escapeHtml(state.owner)}；终态：${state.terminal ? "是" : "否"}</p>
        </article>
      `).join("")}
    </div>
    <div class="table-wrap">
      <table class="cutover-table">
        <thead>
          <tr>
            <th>From</th>
            <th>Action</th>
            <th>To</th>
            <th>Required checks</th>
          </tr>
        </thead>
        <tbody>
          ${transitions.map((item) => `
            <tr>
              <td>${escapeHtml(item.from)}</td>
              <td><strong>${escapeHtml(item.action)}</strong></td>
              <td>${escapeHtml(item.to)}</td>
              <td>${(item.requiredChecks || []).map((check) => `<span class="badge">${escapeHtml(check)}</span>`).join(" ")}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
    <div class="control-grid">
      <article class="cutover-card">
        <h3>SLA 与升级</h3>
        <ul class="blocker-list">${sla.map((item) => `<li>${escapeHtml(item.state)}：${escapeHtml(item.targetHours)}h → ${escapeHtml(item.escalation)}</li>`).join("")}</ul>
      </article>
      <article class="cutover-card">
        <h3>门禁规则</h3>
        <ul class="blocker-list">${(workflow.gateRules || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      </article>
      <article class="cutover-card">
        <h3>审计事件</h3>
        <ul class="blocker-list">${(workflow.auditEvents || []).slice(0, 6).map((item) => `<li>${escapeHtml(item.eventType)} · append-only</li>`).join("")}</ul>
      </article>
    </div>
  `;
}

function renderAcceptanceScenarioSuite(suite) {
  const scenarios = suite.scenarios || [];
  const summary = suite.summary || {};
  document.querySelector("#acceptance-scenario-suite").innerHTML = `
    <div class="cutover-kpis">
      ${kpi("场景总数", summary.scenarios || scenarios.length, "ok")}
      ${kpi("硬阻断场景", summary.hardStopScenarios || 0, "warn")}
      ${kpi("患者安全场景", summary.patientSafetyScenarios || 0, "warn")}
      ${kpi("审计回放", summary.auditReplayScenarios || 0, "ok")}
    </div>
    <div class="cutover-card">
      <div class="badge-row">
        <span class="badge warn">${escapeHtml(suite.status || "ready-for-controlled-rehearsal-only")}</span>
        <span class="badge">${escapeHtml(suite.primaryTrackName || "首增量专项")}</span>
      </div>
      <p class="muted">工作流门禁：${escapeHtml(suite.workflowGate || "submitted-or-accepted-site-evidence-required-before-batch-1")}</p>
      <p class="muted">必需证据：${(suite.requiredEvidenceIds || []).map(escapeHtml).join(" / ") || "待生成"}</p>
    </div>
    <div class="track-grid">
      ${scenarios.map((scenario) => `
        <article class="cutover-card">
          <div class="badge-row">
            <span class="badge">${escapeHtml(scenario.id)}</span>
            <span class="badge ${scenario.hardStopOnFail ? "warn" : "ok"}">${scenario.hardStopOnFail ? "Hard stop" : "Review"}</span>
            <span class="badge">${escapeHtml(scenario.type)}</span>
          </div>
          <h3>${escapeHtml(scenario.name)}</h3>
          <p class="muted">批次：${escapeHtml(scenario.batchId)}；通过标准：${escapeHtml(scenario.passCriteria)}</p>
          <h4>步骤</h4>
          <ol class="evidence-list">${(scenario.steps || []).map((step) => `<li>${escapeHtml(step)}</li>`).join("")}</ol>
          <h4>预期证据</h4>
          <ul class="evidence-list">${(scenario.expectedEvidence || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
        </article>
      `).join("")}
    </div>
    <div class="cutover-card">
      <h3>执行规则</h3>
      <ul class="blocker-list">${(suite.executionRules || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    </div>
  `;
}

function renderScenarioEvidenceMatrix(matrix) {
  const rows = matrix.rows || [];
  const summary = matrix.summary || {};
  document.querySelector("#scenario-evidence-matrix").innerHTML = `
    <div class="cutover-kpis">
      ${kpi("矩阵状态", matrix.status || "not-run", "warn")}
      ${kpi("场景行", summary.scenarios || rows.length, "ok")}
      ${kpi("证据链接", summary.evidenceLinks || 0, "warn")}
      ${kpi("硬阻断行", summary.hardStopRows || 0, "warn")}
    </div>
    <div class="table-wrap">
      <table class="cutover-table">
        <thead>
          <tr>
            <th>场景</th>
            <th>证据</th>
            <th>工作流事件</th>
            <th>Go/No-Go影响</th>
            <th>结果</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((row) => `
            <tr>
              <td><strong>${escapeHtml(row.scenarioId)}</strong><br>${escapeHtml(row.type)}</td>
              <td>${(row.evidence || []).map((item) => `<span class="badge ${item.minimumState === "accepted" ? "ok" : "warn"}">${escapeHtml(item.evidenceId)} ≥ ${escapeHtml(item.minimumState)}</span>`).join(" ")}</td>
              <td>${(row.requiredWorkflowEvents || []).map((item) => `<span class="badge">${escapeHtml(item)}</span>`).join(" ")}</td>
              <td><span class="badge ${row.hardStopOnFail ? "warn" : "ok"}">${escapeHtml(row.goNoGoImpact)}</span></td>
              <td>${escapeHtml(row.acceptanceResult || "not-run")}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
    <div class="cutover-card">
      <h3>矩阵判定规则</h3>
      <ul class="blocker-list">${(matrix.decisionRules || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    </div>
  `;
}

function renderCutoverCommandCenter(commandCenter) {
  const windows = commandCenter.windows || [];
  const roster = commandCenter.roster || [];
  const summary = commandCenter.summary || {};
  document.querySelector("#cutover-command-center").innerHTML = `
    <div class="cutover-kpis">
      ${kpi("Command status", commandCenter.status || "command-center-ready-for-rehearsal", "warn")}
      ${kpi("Windows", summary.windows || windows.length, "ok")}
      ${kpi("Roster seats", summary.rosterSeats || roster.length, "ok")}
      ${kpi("No-Go rules", summary.noGoRules || 0, "warn")}
    </div>
    <div class="cutover-card">
      <div class="badge-row">
        <span class="badge warn">${escapeHtml(commandCenter.primaryTrackName || "first increment")}</span>
        <span class="badge">watch-only ${(commandCenter.watchOnlyTrackIds || []).map(escapeHtml).join(" / ") || "none"}</span>
      </div>
      <p class="muted">Command center keeps scope freeze, batch-1 rehearsal, T+1 observation and watch-only expansion under one accountable duty board.</p>
    </div>
    <div class="track-grid">
      ${windows.map((windowItem) => `
        <article class="cutover-card">
          <div class="badge-row">
            <span class="badge warn">${escapeHtml(windowItem.stage)}</span>
            <span class="badge">${escapeHtml(windowItem.ownerRole)}</span>
          </div>
          <h3>${escapeHtml(windowItem.name)}</h3>
          <p class="muted">${escapeHtml(windowItem.ownerDepartment)}</p>
          <p><strong>Entry:</strong> ${escapeHtml(windowItem.entryGate)}</p>
          <p><strong>Exit:</strong> ${escapeHtml(windowItem.exitGate)}</p>
          <h4>Produces</h4>
          <ul class="evidence-list">${(windowItem.produces || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
          <h4>No-Go if missing</h4>
          <ul class="blocker-list">${(windowItem.noGoIfMissing || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
        </article>
      `).join("")}
    </div>
    <div class="table-wrap">
      <table class="cutover-table">
        <thead>
          <tr>
            <th>Seat</th>
            <th>Owner</th>
            <th>Decision right</th>
          </tr>
        </thead>
        <tbody>
          ${roster.map((item) => `
            <tr>
              <td><strong>${escapeHtml(item.seat)}</strong></td>
              <td>${escapeHtml(item.owner)}</td>
              <td>${escapeHtml(item.decisionRight)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
    <div class="control-grid">
      <article class="cutover-card">
        <h3>Escalation rules</h3>
        <ul class="blocker-list">${(commandCenter.escalationRules || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      </article>
      <article class="cutover-card">
        <h3>Decision artifacts</h3>
        <ul class="blocker-list">${(commandCenter.decisionArtifacts || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      </article>
    </div>
  `;
}

function renderObservationSignalBoard(board) {
  const lanes = board.lanes || [];
  const summary = board.summary || {};
  document.querySelector("#observation-signal-board").innerHTML = `
    <div class="cutover-kpis">
      ${kpi("Observation", board.status || "observation-ready", "warn")}
      ${kpi("Lanes", summary.lanes || lanes.length, "ok")}
      ${kpi("P0 signals", summary.p0Signals || 0, "warn")}
      ${kpi("Seats ready", `${summary.commandSeatsReady || 0}/${summary.lanes || lanes.length || 0}`, "ok")}
    </div>
    <div class="track-grid">
      ${lanes.map((lane) => `
        <article class="cutover-card">
          <div class="badge-row">
            <span class="badge warn">${escapeHtml(lane.ownerSeat)}</span>
            <span class="badge ${lane.commandSeatReady ? "ok" : "warn"}">${lane.commandSeatReady ? "seat ready" : "seat missing"}</span>
          </div>
          <h3>${escapeHtml(lane.name)}</h3>
          <p class="muted">${escapeHtml(lane.source)}</p>
          <h4>Signals</h4>
          <ul class="evidence-list">${(lane.signals || []).map((signal) => `<li><strong>${escapeHtml(signal.id)}</strong> · ${escapeHtml(signal.metric)} ≤ ${escapeHtml(signal.threshold)} · ${escapeHtml(signal.severity)}</li>`).join("")}</ul>
          <p><strong>No-Go:</strong> ${escapeHtml(lane.noGoRule)}</p>
          <p class="muted">Artifact: ${escapeHtml(lane.evidenceArtifact)} · Scenarios: ${(lane.linkedScenarios || []).map(escapeHtml).join(" / ")}</p>
        </article>
      `).join("")}
    </div>
    <div class="control-grid">
      <article class="cutover-card">
        <h3>Decision outcomes</h3>
        <ul class="blocker-list">${(board.decisionOutcomes || []).map((item) => `<li><strong>${escapeHtml(item.id)}</strong> · ${escapeHtml(item.when)} → ${escapeHtml(item.nextStep)}</li>`).join("")}</ul>
      </article>
      <article class="cutover-card">
        <h3>Required artifacts</h3>
        <ul class="blocker-list">${(board.requiredArtifacts || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      </article>
    </div>
  `;
}

function renderRuntimeSmokePlan(plan) {
  const suites = plan.suites || [];
  const summary = plan.summary || {};
  document.querySelector("#runtime-smoke-plan").innerHTML = `
    <div class="cutover-kpis">
      ${kpi("Runtime smoke", plan.status || "ready-for-runtime-smoke", "warn")}
      ${kpi("Launch mode", plan.launchMode || "controlled-rehearsal-only", "warn")}
      ${kpi("Suites", summary.suites || suites.length, "ok")}
      ${kpi("Hard stops", summary.hardStops || 0, "warn")}
    </div>
    <div class="cutover-card">
      <div class="badge-row">
        <span class="badge warn">${escapeHtml(plan.primaryTrackName || "first increment")}</span>
        <span class="badge">routes ${(plan.trackRoutes || []).length}</span>
      </div>
      <p class="muted">Runtime smoke is the final code-side gate before controlled rehearsal. It does not close site evidence or formal Go-Live approval.</p>
    </div>
    <div class="track-grid">
      ${suites.map((suite) => `
        <article class="cutover-card">
          <div class="badge-row">
            <span class="badge ${suite.automation === "manual-with-audit" ? "warn" : "ok"}">${escapeHtml(suite.automation)}</span>
            <span class="badge">${escapeHtml(suite.id)}</span>
          </div>
          <h3>${escapeHtml(suite.name)}</h3>
          <p><code>${escapeHtml(suite.command)}</code></p>
          <ul class="evidence-list">${(suite.checks || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
          <p><strong>Failure:</strong> ${escapeHtml(suite.failureAction)}</p>
        </article>
      `).join("")}
    </div>
    <div class="control-grid">
      <article class="cutover-card">
        <h3>Route contracts</h3>
        <ul class="blocker-list">${(plan.trackRoutes || []).map((route) => `<li><strong>${escapeHtml(route.trackId)}</strong> · ${escapeHtml(route.page)} · <code>${escapeHtml(route.api)}</code> · ${escapeHtml(route.expectedState)}</li>`).join("")}</ul>
      </article>
      <article class="cutover-card">
        <h3>Runtime hard stops</h3>
        <ul class="blocker-list">${(plan.hardStops || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      </article>
    </div>
  `;
}

function renderBlockers(tracks) {
  const rows = tracks.flatMap((track) => (track.blockers || []).map((blocker) => `
    <tr>
      <td>${escapeHtml(track.name)}</td>
      <td><strong>${escapeHtml(blocker.id)}</strong><br>${escapeHtml(blocker.title)}</td>
      <td>${escapeHtml(blocker.owner)}</td>
      <td><span class="badge warn">${escapeHtml(blocker.status)}</span></td>
    </tr>
  `));
  document.querySelector("#blocker-table").innerHTML = rows.join("") || `<tr><td colspan="4">暂无现场阻断项</td></tr>`;
}

function kpi(label, value, tone) {
  return `
    <div class="cutover-card">
      <span class="kpi-value">${escapeHtml(String(value))}</span>
      <span class="badge ${tone || ""}">${escapeHtml(label)}</span>
    </div>
  `;
}

function fallbackCutoverPack() {
  return {
    module: "t10-emergency-blood-imaging-physical-exam-cutover",
    generatedAt: "static-preview",
    summary: {
      tracks: 4,
      codeReady: 4,
      productionReady: 0,
      siteBlockers: 28,
      totalChecks: 160,
      passedChecks: 160,
      formalGoLiveState: "blocked-until-site-evidence-signed"
    },
    stages: ["code-readiness", "synthetic-acceptance", "joint-test", "site-evidence", "go-no-go", "grey-release"],
    firstIncrement: {
      trackId: "emergency-life-chain",
      trackName: "120急救生命链",
      recommendation: "选择一家120分站、一家胸痛/卒中接诊医院和一台受控网关设备，完成签名设备信号 -> 人工确认派车 -> 院前院内电子交接 -> 事件证据包导出。",
      why: "代码门禁已通过，但仍有现场证据和外部接口签收阻断；适合用受控单机构/单链路灰度来收集生产验收证据。",
      requiredBeforeStart: [
        "120调度系统联调回执",
        "车载设备/穿戴设备证书指纹与密钥托管记录",
        "接诊医院绿色通道值班与电子交接签收",
        "急救质控和调度复盘签字"
      ]
    },
    tracks: [
      track("emergency-life-chain", "120急救生命链", "市急救中心/卫健应急办", "emergency.html", "/api/emergency/production-center", 6, "120调度系统联调回执"),
      track("clinical-blood", "临床用血", "血液中心/医院输血科/医务部", "blood.html", "/api/blood-system/go-live", 10, "BIS/BTIS主数据与血袋唯一标识核对单"),
      track("regional-imaging-cloud", "区域影像云", "放射科/医院信息科/区域平台互联互通组", "imaging-cloud.html", "/api/imaging-cloud/production-center", 5, "PACS/RIS/DICOM TLS联通回执"),
      track("physical-examination", "健康体检", "体检中心/基层公卫/慢病管理团队", "physical-examination.html", "/api/physical-exams", 7, "体检中心源系统字段映射和签名报文")
    ],
    institutionDeploymentManifest: {
      contractVersion: "1.0.0",
      institutionId: "institution-template",
      activationPolicy: "deny-by-default",
      productionTrafficState: "blocked-until-site-evidence-signed",
      enabledModuleIds: ["emergency-life-chain", "clinical-blood", "regional-imaging-cloud", "physical-examination"],
      disabledModuleIds: [],
      routeAllowlist: ["emergency.html", "blood.html", "imaging-cloud.html", "physical-examination.html"],
      apiAllowlist: ["/api/emergency/production-center", "/api/blood-system/go-live", "/api/imaging-cloud/production-center", "/api/physical-exams"],
      enabledModules: [
        deploymentModule("emergency-life-chain", "120急救生命链", "emergency.html", "/api/emergency/production-center"),
        deploymentModule("clinical-blood", "临床用血", "blood.html", "/api/blood-system/go-live"),
        deploymentModule("regional-imaging-cloud", "区域影像云", "imaging-cloud.html", "/api/imaging-cloud/production-center"),
        deploymentModule("physical-examination", "健康体检", "physical-examination.html", "/api/physical-exams")
      ],
      validationRules: [
        "仅允许暴露机构已选择的专项页面和 API。",
        "每个模块使用独立数据命名空间和独立回退单元。",
        "禁用模块必须不可达且不得接收生产流量。",
        "启用模块后仍须完成现场证据和正式 Go/No-Go 审批。"
      ]
    },
    crossTrackControls: [
      control("identity-and-role-scope", "统一身份与最小权限", "平台账号管理员/机构管理员", "每个专项均使用现场实名账号、机构编码和角色授权；演示账号不得进入生产灰度。"),
      control("signed-interface-and-idempotency", "签名接口、时钟窗口和幂等", "平台互联互通组/外部系统厂商", "外部报文必须具备签名、时间窗、nonce或幂等键、回执和死信补偿证据。"),
      control("four-eyes-site-evidence", "四眼现场证据签收", "业务责任部门/卫生行政复核人", "提交人与复核人不得相同；证据编号、摘要、附件引用和签收时间必须可追溯。"),
      control("patient-safety-and-downgrade", "患者安全与降级预案", "医务部/急救中心/运维值班", "急救电话、人工调度、纸质/院内流程、冷链和报告原件均有停机或弱网降级路径。")
    ],
    rehearsalPlan: {
      scope: {
        primaryTrackId: "emergency-life-chain",
        primaryTrackName: "120急救生命链",
        pilotSize: "单机构/单链路/合成或脱敏样例优先，禁止直接扩大到全量居民或真实生产调度。",
        includedTracks: ["emergency-life-chain"],
        watchOnlyTracks: ["clinical-blood", "regional-imaging-cloud", "physical-examination"]
      },
      timeline: [
        {
          stage: "T-1 preflight",
          owner: "项目办/平台运维/业务责任部门",
          actions: ["冻结灰度范围、账号白名单、外部接口地址和回退联系人。", "复核 readiness 摘要、现场阻断项和四眼签收材料。"],
          exitCriteria: "所有本次范围内阻断项具备证据编号、责任人和可复核摘要。"
        },
        {
          stage: "T0 rehearsal",
          owner: "市急救中心/卫健应急办",
          actions: ["执行签名设备信号、人工确认派车、院前院内电子交接和证据包导出。", "记录接口请求、回执、失败重试、死信补偿和人工复核动作。"],
          exitCriteria: "端到端链路闭环成功，且未出现未解释的 P0/P1 安全、隐私或临床风险。"
        },
        {
          stage: "T+1 observation",
          owner: "运维值守/质控复盘/业务负责人",
          actions: ["复核告警、审计、接口回执、数据质量和人工处置记录。", "归档灰度验收记录，决定是否进入下一专项或下一机构。"],
          exitCriteria: "观察窗口无未关闭 P0/P1 问题，业务和技术双负责人签字。"
        }
      ],
      rollbackTriggers: ["签名或幂等连续失败且无法解释。", "出现越权可见或跨居民数据范围问题。", "出现可能影响患者安全的漏派、误派、漏告或误告。", "审计证据或回执摘要缺失。"],
      dutyRoster: [
        { role: "业务指挥", owner: "市急救中心/卫健应急办", responsibility: "确认灰度范围、患者安全和业务回退。" },
        { role: "平台运维", owner: "平台运维团队", responsibility: "监控服务、接口、日志、告警和回滚窗口。" },
        { role: "安全审计", owner: "安全管理岗", responsibility: "复核账号、签名、审计链、证据摘要和隐私范围。" }
      ],
      evidenceToArchive: ["灰度范围确认单", "接口请求/回执样例和签名校验日志", "四眼签收记录和 SHA-256 摘要", "T+1 观察窗口结论和下一步 go/no-go 决策"]
    },
    goNoGoDecision: {
      currentDecision: "no-go-site-evidence-pending",
      primaryTrackId: "emergency-life-chain",
      primaryTrackName: "120急救生命链",
      score: 20,
      threshold: 100,
      scorecard: [
        { id: "readiness", name: "代码门禁", weight: 20, required: true, current: "pass" },
        { id: "site-evidence", name: "现场证据", weight: 25, required: true, current: "pending" },
        { id: "dual-approval", name: "业务/技术双签", weight: 20, required: true, current: "pending" },
        { id: "rollback-ready", name: "回退路径", weight: 15, required: true, current: "ready-to-rehearse" },
        { id: "observation-window", name: "T+1观察", weight: 20, required: true, current: "pending" }
      ],
      hardStops: [
        { id: "patient-safety", name: "患者安全", noGo: "任一链路出现可能影响患者安全的未解释 P0/P1 事件。" },
        { id: "scope-and-privacy", name: "数据范围与隐私", noGo: "出现越权可见、跨居民串档、跨机构数据外溢或敏感字段暴露。" },
        { id: "interface-receipt", name: "外部接口回执", noGo: "接口连续失败、回执缺失或签名/幂等异常无法解释。" },
        { id: "evidence-replay", name: "证据复盘", noGo: "关键证据、原始记录或摘要缺失，导致无法重放业务链路。" }
      ],
      decisionRules: ["任何 hard stop 命中均直接 No-Go。", "所有必选项通过且总分达到 100 才允许进入正式 go/no-go 会。", "ready-to-rehearse 只允许开展受控演练。"],
      nextActions: ["补齐 external-evidence-1：120调度系统联调回执", "补齐 external-evidence-2：车载设备/穿戴设备证书指纹与密钥托管记录"]
    },
    evidenceDossier: {
      status: "site-evidence-pending",
      totalEntries: 4,
      hardStopOpen: 2,
      firstIncrementRequired: ["emergency-life-chain:external-evidence-1", "emergency-life-chain:external-evidence-2"],
      reviewPolicy: {
        submitterMustDifferFromReviewer: true,
        digestAlgorithm: "sha256",
        closeRule: "only accepted evidence can close site-pending blockers; demo data cannot close site evidence"
      },
      entries: [
        evidenceEntry("emergency-life-chain", "120急救生命链", "external-evidence-1", "120调度系统联调回执", "P0", true),
        evidenceEntry("emergency-life-chain", "120急救生命链", "external-evidence-2", "车载设备/穿戴设备证书指纹与密钥托管记录", "P0", true),
        evidenceEntry("clinical-blood", "临床用血", "BLOOD-SITE-01", "真实接口全场景联调", "P1", false),
        evidenceEntry("regional-imaging-cloud", "区域影像云", "IMG-SITE-01", "PACS/RIS/DICOM TLS全链路联调", "P1", false)
      ]
    },
    pilotBatchPlan: {
      status: "ready-to-plan-controlled-rehearsal",
      batches: [
        {
          id: "batch-0-preflight",
          name: "Evidence preflight",
          scope: "no live traffic; validate accounts, endpoints, evidence templates and rollback contacts",
          entryCriteria: ["all first-increment evidence IDs assigned"],
          exitCriteria: ["no P0 evidence gap remains unexplained"],
          promotionDecision: "allow batch-1 rehearsal only"
        },
        {
          id: "batch-1-single-chain",
          name: "120急救生命链",
          scope: "单链路灰度演练",
          entryCriteria: ["120调度系统联调回执", "车载设备证书指纹"],
          exitCriteria: ["end-to-end chain replay succeeds", "no patient-safety or privacy hard stop is triggered"],
          promotionDecision: "T+1 observation before any expansion"
        }
      ]
    },
    siteEvidenceWorkflow: {
      currentGate: "submitted-or-accepted-site-evidence-required-before-batch-1",
      states: [
        { id: "draft", name: "Evidence drafted", owner: "site submitter", terminal: false },
        { id: "submitted", name: "Submitted for four-eyes review", owner: "site submitter", terminal: false },
        { id: "under-review", name: "Business and technical review", owner: "commission reviewer", terminal: false },
        { id: "returned", name: "Returned for correction", owner: "site submitter", terminal: false },
        { id: "accepted", name: "Accepted and digest-locked", owner: "commission reviewer", terminal: true },
        { id: "expired", name: "Expired after scope or interface change", owner: "release manager", terminal: true }
      ],
      transitions: [
        workflowTransition("draft", "submit-evidence", "submitted", ["required-artifacts-present", "sha256-digest-recorded"]),
        workflowTransition("submitted", "start-four-eyes-review", "under-review", ["submitter-reviewer-separation", "role-scope-verified"]),
        workflowTransition("under-review", "accept-evidence", "accepted", ["verification-checks-pass", "audit-chain-linked"]),
        workflowTransition("under-review", "return-for-correction", "returned", ["rejection-reason-recorded", "next-owner-assigned"]),
        workflowTransition("returned", "resubmit-evidence", "submitted", ["correction-summary-present", "digest-refreshed"])
      ],
      sla: [
        { state: "submitted", targetHours: 24, escalation: "commission release manager" },
        { state: "under-review", targetHours: 48, escalation: "business owner + security audit" },
        { state: "returned", targetHours: 72, escalation: "site liaison" }
      ],
      gateRules: [
        "batch-1-single-chain cannot start until every first-increment evidence entry is submitted or accepted",
        "P0 evidence cannot be bypassed by a waiver; it must be accepted or the decision remains No-Go"
      ],
      batchOneEntryRequires: {
        batchId: "batch-1-single-chain",
        evidenceIds: ["emergency-life-chain:external-evidence-1", "emergency-life-chain:external-evidence-2"],
        minimumStatus: "submitted",
        preferredStatus: "accepted"
      },
      auditEvents: [
        { eventType: "site-evidence.submit-evidence", appendOnly: true },
        { eventType: "site-evidence.accept-evidence", appendOnly: true }
      ]
    },
    acceptanceScenarioSuite: {
      status: "ready-for-controlled-rehearsal-only",
      primaryTrackId: "emergency-life-chain",
      primaryTrackName: "120急救生命链",
      requiredEvidenceIds: ["emergency-life-chain:external-evidence-1", "emergency-life-chain:external-evidence-2"],
      workflowGate: "submitted-or-accepted-site-evidence-required-before-batch-1",
      summary: {
        scenarios: 5,
        hardStopScenarios: 4,
        patientSafetyScenarios: 2,
        auditReplayScenarios: 1
      },
      executionRules: [
        "run scenarios in batch-1 only after required evidence reaches submitted state",
        "any hard-stop scenario failure immediately keeps the decision at No-Go",
        "scenario evidence must be replayable without mutating original source records"
      ],
      scenarios: [
        scenario("scenario-1-normal-chain", "Normal end-to-end emergency life-chain", "happy-path", true, ["receive signed device or controlled gateway signal", "dispatcher confirms ambulance dispatch manually", "receiving hospital accepts electronic handover"], ["signed signal receipt", "dispatch confirmation record", "hospital handover acknowledgement"]),
        scenario("scenario-2-idempotency-replay", "Duplicate signal and idempotency replay", "resilience", true, ["send the same event twice", "verify the second event is deduplicated"], ["idempotency key ledger", "duplicate rejection or merge record"]),
        scenario("scenario-3-signature-rejection", "Invalid signature and certificate rejection", "security-negative", true, ["submit invalid signature", "verify no clinical workflow mutation"], ["signature verification failure", "security audit event"]),
        scenario("scenario-4-manual-downgrade", "Network outage and manual downgrade", "downgrade", true, ["simulate external gateway timeout", "switch to manual phone or paper handover path"], ["timeout alert", "manual downgrade record"]),
        scenario("scenario-5-evidence-replay", "Evidence packet replay and go/no-go update", "audit-replay", false, ["load evidence packet", "replay audit events and receipts"], ["evidence packet checksum", "append-only audit event sequence"])
      ]
    },
    scenarioEvidenceMatrix: {
      status: "not-run",
      summary: {
        scenarios: 5,
        evidenceLinks: 10,
        hardStopRows: 4,
        replayRows: 1
      },
      decisionRules: [
        "all hard-stop rows must pass before any Go/No-Go score can increase",
        "audit-replay row must prove evidence closure without source-record mutation",
        "missing required workflow event keeps the linked evidence item at submitted or returned"
      ],
      rows: [
        scenarioMatrixRow("scenario-1-normal-chain", "happy-path", true, "keep-no-go-on-failure"),
        scenarioMatrixRow("scenario-2-idempotency-replay", "resilience", true, "keep-no-go-on-failure"),
        scenarioMatrixRow("scenario-3-signature-rejection", "security-negative", true, "keep-no-go-on-failure"),
        scenarioMatrixRow("scenario-4-manual-downgrade", "downgrade", true, "keep-no-go-on-failure"),
        scenarioMatrixRow("scenario-5-evidence-replay", "audit-replay", false, "review-scorecard-after-replay", "accepted")
      ]
    },
    cutoverCommandCenter: {
      status: "command-center-ready-for-rehearsal",
      primaryTrackId: "emergency-life-chain",
      primaryTrackName: "120急救生命链",
      watchOnlyTrackIds: ["clinical-blood", "regional-imaging-cloud", "physical-examination"],
      summary: {
        windows: 3,
        rosterSeats: 5,
        watchOnlyTracks: 3,
        noGoRules: 9
      },
      windows: [
        commandWindow("window-t-1-freeze", "T-1 scope freeze and evidence preflight", "T-1", "release commander", "commission release office + platform operations", "all pilot scope, endpoint, account, evidence and rollback owners are assigned", "first-increment evidence reaches submitted state and batch-1 scope is frozen", ["emergency-life-chain:external-evidence-1", "emergency-life-chain:external-evidence-2"], ["frozen pilot roster", "signed evidence preflight checklist", "rollback contact sheet"], ["required evidence owner", "external endpoint receipt", "rollback contact"]),
        commandWindow("window-t0-controlled-rehearsal", "T0 controlled batch-1 rehearsal", "T0", "business commander", "120急救中心/卫健应急办", "T+1 observation before any expansion", "all hard-stop scenarios pass or remain No-Go with recorded reason", ["scenario-1-normal-chain", "scenario-2-idempotency-replay", "scenario-3-signature-rejection", "scenario-4-manual-downgrade"], ["scenario run sheet", "interface receipt ledger", "manual downgrade proof", "audit export digest"], ["patient safety proof", "signature/idempotency proof", "append-only audit digest"]),
        commandWindow("window-t-plus-1-observation", "T+1 observation and promotion decision", "T+1", "quality reviewer", "operations duty + quality control + business owner", "batch-1 rehearsal has no unexplained P0/P1 issue", "decide stay No-Go, repeat batch-1, or open watch-only batch-2", ["alert review", "audit replay", "data-quality sample", "manual-handling review"], ["T+1 observation memo", "go/no-go scorecard update", "next specialty watch-only recommendation"], ["unexplained P0/P1 event", "missing audit replay", "unreviewed manual handling"])
      ],
      roster: [
        { seat: "release-commander", owner: "commission release office", decisionRight: "freeze scope, pause rehearsal, call No-Go" },
        { seat: "business-commander", owner: "120急救中心/卫健应急办", decisionRight: "confirm patient-safety continuity and manual downgrade" },
        { seat: "operations-duty", owner: "platform operations", decisionRight: "observe service, logs, alerts, rollback window and deployment health" },
        { seat: "security-audit", owner: "security office", decisionRight: "reject unsigned, over-scoped or unreplayable evidence" },
        { seat: "site-liaison", owner: "pilot institution information office", decisionRight: "coordinate external system, device and clinical department availability" }
      ],
      escalationRules: [
        "any P0 patient-safety, privacy or security event pages release-commander and business-commander immediately",
        "two consecutive unexplained interface failures pause batch-1 and switch to manual downgrade",
        "missing append-only audit evidence keeps the decision No-Go even when the business flow appears successful",
        "watch-only specialty expansion can start only after the T+1 observation memo is accepted"
      ],
      decisionArtifacts: [
        "frozen-scope-sheet",
        "command-roster-and-contact-sheet",
        "scenario-run-sheet",
        "interface-and-idempotency-ledger",
        "manual-downgrade-or-rollback-proof",
        "t-plus-1-observation-memo"
      ]
    },
    observationSignalBoard: {
      status: "observation-ready",
      observationWindow: "T+1",
      primaryTrackId: "emergency-life-chain",
      primaryTrackName: "120急救生命链",
      summary: {
        lanes: 4,
        p0Signals: 5,
        commandSeatsReady: 4,
        hardStopScenarioLinks: 13
      },
      lanes: [
        observationLane("lane-patient-safety", "Patient safety continuity", "business-commander", "manual downgrade log + scenario run sheet + clinical handover acknowledgement", [["missed-dispatch-or-handover", "missed dispatch / handover / notification", 0, "P0"], ["manual-downgrade-reachable", "manual downgrade path reachable", "100%", "P0"]], "any missed dispatch, handover, notification or unreachable manual downgrade path keeps the decision No-Go", "patient-safety-continuity-review", ["scenario-1-normal-chain", "scenario-2-idempotency-replay", "scenario-3-signature-rejection", "scenario-4-manual-downgrade"]),
        observationLane("lane-interface-reliability", "Signed interface and idempotency", "operations-duty", "interface receipt ledger + idempotency ledger + retry/dead-letter queue", [["unexplained-interface-failure", "consecutive unexplained failures", 2, "P1"], ["duplicate-mutation", "duplicate input causing second mutation", 0, "P0"]], "duplicate mutation is a hard No-Go; two unexplained failures pause batch-1 and require manual downgrade review", "interface-and-idempotency-observation", ["scenario-1-normal-chain", "scenario-2-idempotency-replay", "scenario-3-signature-rejection", "scenario-4-manual-downgrade"]),
        observationLane("lane-data-quality-scope", "Data quality, scope and privacy", "security-audit", "resident scope sample + role audit + cross-institution visibility review", [["over-scoped-data-visible", "over-scoped resident or institution data visibility", 0, "P0"], ["unmatched-handover-fields", "unmatched required handover fields", 0, "P1"]], "any over-scoped data visibility keeps the decision No-Go until root cause and evidence are accepted", "scope-and-data-quality-sample", ["scenario-1-normal-chain", "scenario-2-idempotency-replay", "scenario-3-signature-rejection", "scenario-4-manual-downgrade"]),
        observationLane("lane-evidence-audit", "Evidence replay and audit completeness", "release-commander", "append-only audit export + evidence packet digest + four-eyes review events", [["missing-audit-event", "missing append-only audit event", 0, "P0"], ["digest-mismatch", "evidence packet digest mismatch", 0, "P0"]], "missing audit events or digest mismatch keep the decision No-Go even if the business flow appears successful", "audit-replay-and-digest-review", ["scenario-5-evidence-replay"])
      ],
      decisionOutcomes: [
        { id: "stay-no-go", when: "any P0 signal is open or audit evidence is unreplayable", nextStep: "pause expansion and return evidence for correction" },
        { id: "repeat-batch-1", when: "P1 signal is explained but needs another controlled run", nextStep: "rerun the affected scenario before scorecard update" },
        { id: "open-watch-only-batch-2", when: "all lanes are green and T+1 observation memo is accepted", nextStep: "start read-only or synthetic watch-only flow for the next specialty" }
      ],
      requiredArtifacts: [
        "t-plus-1-observation-memo",
        "patient-safety-continuity-review",
        "interface-and-idempotency-observation",
        "scope-and-data-quality-sample",
        "audit-replay-and-digest-review"
      ]
    },
    runtimeSmokePlan: {
      status: "ready-for-runtime-smoke",
      launchMode: "controlled-rehearsal-only",
      primaryTrackId: "emergency-life-chain",
      primaryTrackName: "120急救生命链",
      summary: {
        suites: 5,
        automatedSuites: 4,
        manualSuites: 1,
        routeChecks: 4,
        hardStops: 4
      },
      trackRoutes: [
        smokeRoute("emergency-life-chain", "emergency.html", "/api/emergency/production-center", "controlled-rehearsal-only"),
        smokeRoute("clinical-blood", "blood.html", "/api/blood-system/go-live", "watch-only"),
        smokeRoute("regional-imaging-cloud", "imaging-cloud.html", "/api/imaging-cloud/production-center", "watch-only"),
        smokeRoute("physical-examination", "physical-examination.html", "/api/physical-exams", "watch-only")
      ],
      suites: [
        smokeSuite("smoke-artifact-generation", "Cutover artifact generation", "automated", "node emergency-specialty-cutover.js", ["release/t10-specialty-cutover-pack.json exists", "release/t10-specialty-cutover-pack.md exists", "integrity digest is sha256-addressed"], "stop release packaging and keep batch-1 closed"),
        smokeSuite("smoke-static-preview", "Static preview and route rendering", "automated-or-browser", "open t10-specialty-cutover.html and specialty pages", ["t10-specialty-cutover.html renders release artifact or fallback pack", "runtime smoke, observation and command-center sections are visible"], "fix frontend projection before any production rehearsal"),
        smokeSuite("smoke-server-api", "Server API and authorization contract", "automated", "GET /api/t10-specialty/cutover-pack with commission role", ["/api/t10-specialty/cutover-pack returns the same module id", "/api/t10-specialty-cutover remains available as compatibility route"], "do not start batch-1 until API auth and route contracts pass"),
        smokeSuite("smoke-release-gates", "Release report and deployment gates", "automated", "node --test test/emergency-specialty-cutover.test.js && npm run t10:specialty-cutover && npm run release:report && npm run deploy:check", ["focused T10 tests pass", "release report has zero error failures", "deploy check has zero failed gates"], "block deploy and return to code readiness"),
        smokeSuite("smoke-observation-artifacts", "T+1 observation artifact readiness", "manual-with-audit", "review observation lanes and attach required artifacts", ["t-plus-1-observation-memo", "patient-safety-continuity-review", "interface-and-idempotency-observation", "scope-and-data-quality-sample", "audit-replay-and-digest-review"], "stay No-Go or repeat batch-1; do not open watch-only batch-2")
      ],
      hardStops: [
        "any failed automated smoke suite blocks runtime launch",
        "any missing T+1 observation artifact keeps the release at No-Go",
        "server API smoke cannot be waived by static preview success",
        "watch-only expansion cannot start until release report and deploy check are both green"
      ]
    },
    integrity: { algorithm: "sha256", digest: "sha256:static-preview-fallback" }
  };
}

function smokeRoute(trackId, page, api, expectedState) {
  return { trackId, page, api, expectedState };
}

function smokeSuite(id, name, automation, command, checks, failureAction) {
  return { id, name, automation, command, checks, failureAction };
}

function observationLane(id, name, ownerSeat, source, signals, noGoRule, evidenceArtifact, linkedScenarios) {
  return {
    id,
    name,
    ownerSeat,
    source,
    signals: signals.map(([signalId, metric, threshold, severity]) => ({ id: signalId, metric, threshold, severity })),
    noGoRule,
    evidenceArtifact,
    commandSeatReady: true,
    linkedScenarios
  };
}

function commandWindow(id, name, stage, ownerRole, ownerDepartment, entryGate, exitGate, requiredInputs, produces, noGoIfMissing) {
  return { id, name, stage, ownerRole, ownerDepartment, entryGate, exitGate, requiredInputs, produces, noGoIfMissing };
}

function scenarioMatrixRow(scenarioId, type, hardStopOnFail, goNoGoImpact, minimumState = "submitted") {
  return {
    scenarioId,
    type,
    batchId: "batch-1-single-chain",
    hardStopOnFail,
    evidence: [
      { evidenceId: "emergency-life-chain:external-evidence-1", minimumState, closesBlocker: minimumState === "accepted", requiredArtifacts: ["signed signal receipt"] },
      { evidenceId: "emergency-life-chain:external-evidence-2", minimumState, closesBlocker: minimumState === "accepted", requiredArtifacts: ["certificate fingerprint"] }
    ],
    requiredWorkflowEvents: ["site-evidence.submit-evidence", minimumState === "accepted" ? "site-evidence.accept-evidence" : "site-evidence.start-four-eyes-review"],
    goNoGoImpact,
    replayRequirement: "must reproduce steps, receipts, identities, timestamps and digest without editing original records",
    acceptanceResult: "not-run"
  };
}

function scenario(id, name, type, hardStopOnFail, steps, expectedEvidence) {
  return {
    id,
    name,
    trackId: "emergency-life-chain",
    type,
    batchId: "batch-1-single-chain",
    preconditions: ["pilot scope frozen and signed", "site evidence workflow gate is at least submitted"],
    steps,
    expectedEvidence,
    passCriteria: "scenario evidence is replayable and does not violate patient-safety or privacy gates",
    hardStopOnFail
  };
}

function workflowTransition(from, action, to, requiredChecks) {
  return { from, action, to, requiredChecks };
}

function evidenceEntry(trackId, trackName, blockerId, title, severity, requiredForFirstIncrement) {
  return {
    evidenceId: `${trackId}:${blockerId}`,
    trackId,
    trackName,
    blockerId,
    title,
    owner: "现场责任部门",
    status: "site-pending",
    severity,
    requiredForFirstIncrement,
    hardStopIfMissing: severity === "P0",
    verificationChecks: ["evidence-id-present", "business-and-technical-dual-signoff", "sha256-digest-recorded", "audit-chain-linked"]
  };
}

function track(id, name, department, page, api, blockerCount, blockerTitle) {
  return {
    id,
    name,
    department,
    page,
    api,
    codeReady: true,
    productionReady: false,
    currentStage: "site-evidence",
    readiness: { digest: `sha256:${id}-readiness` },
    blockers: Array.from({ length: blockerCount }, (_, index) => ({
      id: `${id.toUpperCase()}-${String(index + 1).padStart(2, "0")}`,
      title: index === 0 ? blockerTitle : "现场联调、运行证据或签收材料待补齐",
      owner: department,
      status: "site-pending"
    }))
  };
}

function deploymentModule(id, name, page, api) {
  const deploymentUnit = `t10-${id}`;
  return {
    id,
    name,
    deploymentUnit,
    page,
    api,
    dataNamespace: `t10.${id.replace(/-/g, "_")}`,
    rollbackUnit: deploymentUnit,
    productionTrafficState: "blocked-until-site-evidence-signed"
  };
}

function control(id, name, owner, acceptance) {
  return { id, name, owner, acceptance, appliesTo: ["emergency-life-chain", "clinical-blood", "regional-imaging-cloud", "physical-examination"] };
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char]));
}
