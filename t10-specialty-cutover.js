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
      const response = await request("/api/t10-specialty-cutover", { cache: "no-store" });
      if (response.ok) {
        cutoverState.source = "server-api";
        return await response.json();
      }
    } catch (error) {
      // Fall through to the generated release artifact.
    }
    try {
      const response = await fetch("./release/t10-specialty-cutover-pack.json", { cache: "no-store" });
      if (response.ok) {
        cutoverState.source = "release-artifact";
        return await response.json();
      }
    } catch (error) {
      // Static fallback keeps the preview useful before release artifacts are generated.
    }
  }
  return fallbackCutoverPack();
}

function renderCutoverPack(pack) {
  renderKpis(pack);
  renderFirstIncrement(pack.firstIncrement || {});
  renderTracks(pack.tracks || [], pack.stages || []);
  renderControls(pack.crossTrackControls || []);
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
