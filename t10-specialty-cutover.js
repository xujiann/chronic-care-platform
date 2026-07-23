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
      const request = window.HealthCityAuth?.authFetch || fetch;
      const response = await request("/api/t10-specialty/cutover-pack");
      if (response.ok) {
        cutoverState.source = "server-api";
        return withCutoverDefaults(await response.json());
      }
    } catch (error) {
      // T00 server API may be unavailable in static preview.
    }
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
    crossTrackControls: pack.crossTrackControls || fallback.crossTrackControls,
    rehearsalPlan: pack.rehearsalPlan || fallback.rehearsalPlan,
    goNoGoDecision: pack.goNoGoDecision || fallback.goNoGoDecision,
    integrity: pack.integrity || fallback.integrity
  };
}

function renderCutoverPack(pack) {
  renderKpis(pack);
  renderFirstIncrement(pack.firstIncrement || {});
  renderTracks(pack.tracks || [], pack.stages || []);
  renderControls(pack.crossTrackControls || []);
  renderRehearsalPlan(pack.rehearsalPlan || {});
  renderDecisionMatrix(pack.goNoGoDecision || {});
  renderBlockers(pack.tracks || []);
}

function renderKpis(pack) {
  const summary = pack.summary || {};
  const sourceLabel = cutoverState.source === "server-api"
    ? "/api/t10-specialty/cutover-pack"
    : cutoverState.source === "release-artifact"
      ? "release/t10-specialty-cutover-pack.json"
      : "前端内置边界";
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
    integrity: { algorithm: "sha256", digest: "sha256:static-preview-fallback" }
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
