"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_TRACKS = [
  {
    id: "emergency-life-chain",
    name: "120急救生命链",
    department: "市急救中心/卫健应急办",
    readinessBuilder: () => require("./scripts/emergency-readiness").buildEmergencyReadinessReport(),
    page: "emergency.html",
    api: "/api/emergency/production-center",
    acceptanceIncrement: "选择一家120分站、一家胸痛/卒中接诊医院和一台受控网关设备，完成签名设备信号 -> 人工确认派车 -> 院前院内电子交接 -> 事件证据包导出。",
    requiredExternalEvidence: [
      "120调度系统联调回执",
      "车载设备/穿戴设备证书指纹与密钥托管记录",
      "接诊医院绿色通道值班与电子交接签收",
      "急救质控和调度复盘签字"
    ]
  },
  {
    id: "clinical-blood",
    name: "临床用血",
    department: "血液中心/医院输血科/医务部",
    readinessBuilder: () => require("./scripts/blood-system-readiness").buildBloodSystemReadinessReport(),
    page: "blood.html",
    api: "/api/blood-system/go-live",
    acceptanceIncrement: "选择一个血液中心批次和一家医院输血科，完成冷链事件、交叉配血双人复核、发血签收、床旁输血记录和召回应答闭环。",
    requiredExternalEvidence: [
      "BIS/BTIS主数据与血袋唯一标识核对单",
      "冷链IoT网关签名样例和温度曲线",
      "输血科双人复核账号授权记录",
      "临床用血质控/召回演练签字"
    ]
  },
  {
    id: "regional-imaging-cloud",
    name: "区域影像云",
    department: "放射科/医院信息科/区域平台互联互通组",
    readinessBuilder: () => require("./scripts/imaging-cloud-readiness").buildImagingCloudReadinessReport(),
    page: "imaging-cloud.html",
    api: "/api/imaging-cloud/production-center",
    acceptanceIncrement: "选择CT单一模态与两家试点机构，完成DICOM TLS传输、FHIR报告回写、居民授权查看、互认链关闭和PACS故障演练。",
    requiredExternalEvidence: [
      "PACS/RIS/DICOM TLS联通回执",
      "FHIR/EMR报告回写样例",
      "影像对象存储与脱敏访问审计",
      "互认规则、申诉和质控复核签字"
    ]
  },
  {
    id: "physical-examination",
    name: "健康体检",
    department: "体检中心/基层公卫/慢病管理团队",
    readinessBuilder: () => require("./scripts/physical-examination-readiness").buildReport(),
    page: "physical-examination.html",
    api: "/api/physical-exams",
    acceptanceIncrement: "选择一家体检中心与一个基层团队，完成签名体检报告接入、异常自动建单、居民通知、复查/随访闭环和原件归档校验。",
    requiredExternalEvidence: [
      "体检中心源系统字段映射和签名报文",
      "主检医师/分项医师资质和签名样例",
      "异常通知、复查和家医随访记录",
      "报告原件存储、恶意文件扫描和留存策略"
    ]
  }
];

const CUTOVER_STAGES = [
  "code-readiness",
  "synthetic-acceptance",
  "joint-test",
  "site-evidence",
  "go-no-go",
  "grey-release"
];

function sha256(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function countBlockers(report) {
  const direct = [
    ...asArray(report.siteBlockers),
    ...asArray(report.onsiteBlockers),
    ...asArray(report.productionBlockers)
  ];
  if (direct.length > 0) return direct.length;
  const summary = report.summary || {};
  return Number(summary.sitePending || summary.production?.blockers || summary.cutoverBlockers || 0);
}

function blockerDetails(report, fallbackEvidence = []) {
  const items = [
    ...asArray(report.siteBlockers),
    ...asArray(report.onsiteBlockers),
    ...asArray(report.productionBlockers)
  ];
  if (items.length > 0) {
    return items.map((item, index) => ({
      id: item.id || `site-blocker-${index + 1}`,
      title: item.title || item.name || item.detail || String(item),
      owner: item.owner || item.department || "现场责任部门",
      status: item.status || "site-pending"
    }));
  }
  return fallbackEvidence.map((title, index) => ({
    id: `external-evidence-${index + 1}`,
    title,
    owner: "现场责任部门",
    status: "site-pending"
  }));
}

function normalizeTrack(track, report) {
  const checks = Number(report.summary?.checks || report.total || report.checks?.length || 0);
  const passed = Number(report.summary?.passed || report.passed || 0);
  const blockers = countBlockers(report);
  const codeReady = Boolean(report.ok && (report.codeReady !== false));
  const productionReady = Boolean(report.productionReady || report.goLiveReady);
  const formalGoLiveState = report.formalGoLiveState || (productionReady ? "ready-for-production" : "blocked-until-site-evidence-signed");
  const currentStage = !codeReady
    ? "code-readiness"
    : blockers > 0 || !productionReady
      ? "site-evidence"
      : "go-no-go";

  return {
    id: track.id,
    name: track.name,
    department: track.department,
    page: track.page,
    api: track.api,
    codeReady,
    productionReady,
    formalGoLiveState,
    currentStage,
    readiness: {
      checks,
      passed,
      failed: Math.max(0, checks - passed),
      digest: `sha256:${sha256({ id: track.id, checks: report.checks, summary: report.summary, state: formalGoLiveState })}`
    },
    blockers: blockerDetails(report, track.requiredExternalEvidence),
    requiredExternalEvidence: track.requiredExternalEvidence,
    acceptanceIncrement: track.acceptanceIncrement
  };
}

function buildSpecialtyCutoverPack(options = {}) {
  const generatedAt = options.generatedAt || new Date().toISOString();
  const tracks = (options.tracks || DEFAULT_TRACKS).map((track) => {
    const report = options.reports?.[track.id] || track.readinessBuilder();
    return normalizeTrack(track, report);
  });
  const firstIncrement = selectFirstIncrement(tracks);
  const summary = {
    tracks: tracks.length,
    codeReady: tracks.filter((item) => item.codeReady).length,
    productionReady: tracks.filter((item) => item.productionReady).length,
    siteBlockers: tracks.reduce((sum, item) => sum + item.blockers.length, 0),
    totalChecks: tracks.reduce((sum, item) => sum + item.readiness.checks, 0),
    passedChecks: tracks.reduce((sum, item) => sum + item.readiness.passed, 0),
    formalGoLiveState: tracks.every((item) => item.productionReady) ? "ready-for-production-go-no-go" : "blocked-until-site-evidence-signed"
  };
  const pack = {
    module: "t10-emergency-blood-imaging-physical-exam-cutover",
    generatedAt,
    summary,
    stages: CUTOVER_STAGES,
    tracks,
    firstIncrement,
    crossTrackControls: buildCrossTrackControls(tracks),
    acceptanceChecklist: buildAcceptanceChecklist(tracks)
  };
  pack.integrity = {
    algorithm: "sha256",
    digest: `sha256:${sha256({ summary, tracks, firstIncrement, crossTrackControls: pack.crossTrackControls, acceptanceChecklist: pack.acceptanceChecklist })}`
  };
  return pack;
}

function selectFirstIncrement(tracks) {
  const order = ["emergency-life-chain", "clinical-blood", "regional-imaging-cloud", "physical-examination"];
  const readyTracks = tracks.filter((item) => item.codeReady && !item.productionReady);
  const chosen = readyTracks.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))[0] || tracks[0];
  return {
    trackId: chosen.id,
    trackName: chosen.name,
    recommendation: chosen.acceptanceIncrement,
    why: "代码门禁已通过，但仍有现场证据和外部接口签收阻断；适合用受控单机构/单链路灰度来收集生产验收证据。",
    requiredBeforeStart: chosen.blockers.slice(0, 4).map((item) => `${item.id}: ${item.title}`)
  };
}

function buildCrossTrackControls(tracks) {
  return [
    {
      id: "identity-and-role-scope",
      name: "统一身份与最小权限",
      owner: "平台账号管理员/机构管理员",
      appliesTo: tracks.map((item) => item.id),
      acceptance: "每个专项均使用现场实名账号、机构编码和角色授权；演示账号不得进入生产灰度。"
    },
    {
      id: "signed-interface-and-idempotency",
      name: "签名接口、时钟窗口和幂等",
      owner: "平台互联互通组/外部系统厂商",
      appliesTo: tracks.map((item) => item.id),
      acceptance: "外部报文必须具备签名、时间窗、nonce或幂等键、回执和死信补偿证据。"
    },
    {
      id: "four-eyes-site-evidence",
      name: "四眼现场证据签收",
      owner: "业务责任部门/卫生行政复核人",
      appliesTo: tracks.map((item) => item.id),
      acceptance: "提交人与复核人不得相同；证据编号、摘要、附件引用和签收时间必须可追溯。"
    },
    {
      id: "patient-safety-and-downgrade",
      name: "患者安全与降级预案",
      owner: "医务部/急救中心/运维值班",
      appliesTo: tracks.map((item) => item.id),
      acceptance: "急救电话、人工调度、纸质/院内流程、冷链和报告原件均有停机或弱网降级路径。"
    }
  ];
}

function buildAcceptanceChecklist(tracks) {
  return tracks.flatMap((track) => [
    {
      trackId: track.id,
      item: `${track.name} readiness 全量通过`,
      status: track.codeReady ? "passed" : "blocked",
      evidence: track.readiness.digest
    },
    {
      trackId: track.id,
      item: `${track.name} 现场接口与证据签收`,
      status: track.productionReady ? "passed" : "site-pending",
      evidence: track.blockers.map((blocker) => blocker.id)
    },
    {
      trackId: track.id,
      item: `${track.name} 首个灰度增量验收`,
      status: "ready-to-rehearse",
      evidence: track.acceptanceIncrement
    }
  ]);
}

function renderMarkdown(pack) {
  const rows = pack.tracks.map((item) => `| ${item.name} | ${item.department} | ${item.codeReady ? "是" : "否"} | ${item.productionReady ? "是" : "否"} | ${item.blockers.length} | ${item.page} |`);
  const blockers = pack.tracks.flatMap((track) => track.blockers.map((item) => `| ${track.name} | ${item.id} | ${item.title} | ${item.owner} | ${item.status} |`));
  return [
    "# T10 急救、用血、影像与体检专项上线割接包",
    "",
    `- Generated at: ${pack.generatedAt}`,
    `- Formal go-live state: ${pack.summary.formalGoLiveState}`,
    `- Code readiness: ${pack.summary.codeReady}/${pack.summary.tracks}`,
    `- Production readiness: ${pack.summary.productionReady}/${pack.summary.tracks}`,
    `- Site blockers: ${pack.summary.siteBlockers}`,
    `- Integrity: ${pack.integrity.digest}`,
    "",
    "## 专项状态",
    "",
    "| 专项 | 责任部门 | 代码就绪 | 生产就绪 | 现场阻断 | 页面 |",
    "|---|---|---:|---:|---:|---|",
    ...rows,
    "",
    "## 首个可验收灰度增量",
    "",
    `- Track: ${pack.firstIncrement.trackName}`,
    `- Recommendation: ${pack.firstIncrement.recommendation}`,
    `- Why: ${pack.firstIncrement.why}`,
    "",
    "## 现场阻断项",
    "",
    "| 专项 | 编号 | 阻断项 | 责任方 | 状态 |",
    "|---|---|---|---|---|",
    ...blockers,
    "",
    "## 跨专项控制",
    "",
    ...pack.crossTrackControls.map((item) => `- ${item.name}（${item.owner}）：${item.acceptance}`),
    ""
  ].join("\n");
}

function writeCutoverPack(pack, options = {}) {
  const outputDir = options.outputDir || path.join(__dirname, "release");
  fs.mkdirSync(outputDir, { recursive: true });
  const jsonPath = path.join(outputDir, options.jsonName || "t10-specialty-cutover-pack.json");
  const markdownPath = path.join(outputDir, options.markdownName || "t10-specialty-cutover-pack.md");
  fs.writeFileSync(jsonPath, `${JSON.stringify(pack, null, 2)}\n`, "utf8");
  fs.writeFileSync(markdownPath, renderMarkdown(pack), "utf8");
  return { jsonPath, markdownPath };
}

function runCli() {
  const pack = buildSpecialtyCutoverPack();
  const output = writeCutoverPack(pack);
  console.log(JSON.stringify({ summary: pack.summary, firstIncrement: pack.firstIncrement, integrity: pack.integrity, output }, null, 2));
  if (pack.summary.codeReady !== pack.summary.tracks) process.exitCode = 1;
}

if (require.main === module) runCli();

module.exports = {
  DEFAULT_TRACKS,
  CUTOVER_STAGES,
  buildSpecialtyCutoverPack,
  renderMarkdown,
  writeCutoverPack,
  normalizeTrack,
  selectFirstIncrement
};
