#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT, "release", "integration-control-ledger.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "integration-control-ledger.md");
const DEFAULT_INTAKE_DECISIONS = path.join(ROOT, "integration", "intake-decisions.json");
const ACCEPTED_BASELINE = "e2f2f5e8ce3ed1db576258494d74a6e5986e1c84";
const SOURCE_MAIN_BASELINE = "b861f1c4e87ee8c2221cb52940674dc9f62fad5b";
const INTAKE_DECISIONS = new Set(["pending", "accepted", "blocked"]);

const PUBLIC_FILES = [
  "server.js",
  "portal.css",
  "package.json",
  "README.md",
  "scripts/release-report.js"
];

const LINE_CONFIG = [
  {
    id: "T01",
    title: "账号与权限",
    branch: "codex/thread-t01-identity-access",
    wave: 1,
    mergeOrder: 1,
    dependencies: [],
    input: "identity contract、角色入口、机构与居民范围",
    output: "身份适配器、claim 映射、权限矩阵、账号生命周期和越权测试",
    blockers: "真实 OIDC/SAML、机构目录、医生与居民实名源",
    acceptance: "登录、登出、刷新、停用、机构隔离和拒绝访问审计全部通过"
  },
  {
    id: "T02",
    title: "生产数据平台与数据治理",
    branch: "codex/thread-t02-data-platform",
    wave: 1,
    mergeOrder: 2,
    dependencies: [],
    input: "SQLite/JSON 模型、生产库和数据治理报告",
    output: "PostgreSQL 适配、MPI/CDR、迁移回滚、备份恢复和质量报告",
    blockers: "生产数据库、账号权限、正式备份目标",
    acceptance: "迁移摘要一致，约束索引、备份恢复和 RTO/RPO 证据齐备"
  },
  {
    id: "T03",
    title: "医疗与政务接口联调",
    branch: "codex/thread-t03-interface-integration",
    wave: 1,
    mergeOrder: 3,
    dependencies: ["T01", "T02"],
    input: "接口契约、字段映射、P0 接口与连接器",
    output: "版本化契约、签名幂等、重试死信、对账和联合测试包",
    blockers: "HIS/EMR/LIS/PACS/医保等真实端点、密钥和厂商样例",
    acceptance: "真实报文、失败重放、对账、问题复测和联合签字可追溯"
  },
  {
    id: "T11",
    title: "安全运维、验收与上线",
    branch: "codex/thread-t11-security-release",
    wave: 1,
    mergeOrder: 4,
    dependencies: ["T01", "T02", "T03"],
    finalDependencies: ["T04", "T05", "T06", "T07", "T08", "T09", "T10"],
    finalizer: true,
    input: "全部专业线制品、生产配置和发布证据",
    output: "安全意见、审计留存、监控告警、灾备、切换和四方 Go/No-Go",
    blockers: "SIEM、生产环境、测评、灾备演练和四方审批",
    acceptance: "10 项 P0、5 项前置条件、2 项安全意见和 4 方审批全部通过"
  },
  {
    id: "T04",
    title: "居民健康档案",
    branch: "codex/thread-t04-citizen-records",
    wave: 1,
    mergeOrder: 5,
    dependencies: ["T01", "T02", "T03"],
    input: "身份、数据、接口和居民启动基础",
    output: "档案、病历、检验、影像、用药、授权撤回和移动端验收",
    blockers: "实名关系、真实院内接口和影像对象存储",
    acceptance: "居民隔离、来源追溯、撤回拒绝审计和移动端验收通过"
  },
  {
    id: "T06",
    title: "互联网护理与陪诊服务",
    branch: "codex/thread-t06-nursing-escort",
    wave: 1,
    mergeOrder: 6,
    dependencies: ["T01", "T03", "T04"],
    input: "身份、接口、居民档案和护理陪诊模型",
    output: "下单、评估、派单、接单、服务、签字、评价投诉闭环",
    blockers: "护士资质、定位、医院派单、支付和保险",
    acceptance: "全流程及高风险处置可审计，机构隔离和现场证据通过"
  },
  {
    id: "T05",
    title: "挂号、转诊与家庭医生",
    branch: "codex/thread-t05-registration-referral",
    wave: 2,
    mergeOrder: 7,
    dependencies: ["T01", "T02", "T03", "T04"],
    input: "居民档案、挂号、转诊、家医和慢病契约",
    output: "挂号、转诊、会诊、报告、家医签约和随访闭环",
    blockers: "号源、HIS/EMR/PACS、家医签约和处方系统",
    acceptance: "主链路端到端通过，状态、回执、报告和居民消息一致"
  },
  {
    id: "T07",
    title: "医保支付与按病种付费",
    branch: "codex/thread-t07-insurance-payment",
    wave: 2,
    mergeOrder: 8,
    dependencies: ["T01", "T02", "T03"],
    input: "身份、数据、接口、财务网关和按病种付费能力",
    output: "支付退款、医保结算、DRG/DIP、特例单议、签名包和对账",
    blockers: "医保核心、支付机构、真实密钥和结算政策",
    acceptance: "签名回调、幂等、退款和差错对账通过并完成联合签字"
  },
  {
    id: "T08",
    title: "公共卫生与基层健康",
    branch: "codex/thread-t08-public-health",
    wave: 2,
    mergeOrder: 9,
    dependencies: ["T02", "T03", "T04", "T05"],
    input: "数据、接口、居民记录和公卫标准目录",
    output: "传染病、免疫、妇幼、慢病、老年和家医协同及直报证据",
    blockers: "疾控、妇幼、免疫系统、现场数据和审批",
    acceptance: "直报回执可追溯，切换证据、演练、交接和审批完成"
  },
  {
    id: "T09",
    title: "医疗质量、运营与药耗监管",
    branch: "codex/thread-t09-quality-operations",
    wave: 2,
    mergeOrder: 10,
    dependencies: ["T02", "T03"],
    input: "数据接口、质量、运营和药耗模型",
    output: "质量预警、运营调度、床位资源、药耗和合理用药监管",
    blockers: "质控中心、实时床位设备、采购库存和医保数据",
    acceptance: "危急值和整改闭环，接口签字及指标责任链完整"
  },
  {
    id: "T10",
    title: "急救、用血、影像与体检专项",
    branch: "codex/thread-t10-emergency-specialty",
    wave: 2,
    mergeOrder: 11,
    dependencies: ["T01", "T02", "T03"],
    input: "身份、数据、接口及四个专项现有模块",
    output: "急救、用血、影像和体检生产契约、测试、演练与 readiness",
    blockers: "120、血液中心、设备/影像厂商和体检机构",
    acceptance: "专项测试、真实端点、演练和现场证据全部签字"
  }
];

const CONTRACT_CHANGE_FLOW = [
  "登记 contractId、生产者、消费者、路径、方法、版本和 schema diff。",
  "声明角色、机构、居民范围、签名、幂等、错误码、重试、死信、对账和审计语义。",
  "新增可选字段按兼容小版本处理；删除、改义、新增必填或权限变化必须新版本双轨运行。",
  "取得所有消费者确认，并同时提交样例、成功/失败/重放测试和现场证据模板。",
  "T00 串行接入公共文件，回归通过后冻结契约；真实联调由 T03 归档、T11 复核。"
];

const VALIDATION_COMMANDS = [
  "npm.cmd run check",
  "npm.cmd test",
  "npm.cmd run test:coverage",
  "npm.cmd run test:e2e",
  "npm.cmd run deploy:check:full",
  "npm.cmd run release:report:full",
  "npm.cmd run release:manifest",
  "npm.cmd run health-dashboard:summary",
  "npm.cmd run security:production-readiness",
  "npm.cmd run production:go-no-go-readiness",
  "npm.cmd run env:check:production"
];

function runGit(args, options = {}) {
  const result = spawnSync("git", args, {
    cwd: options.cwd || ROOT,
    encoding: "utf8",
    windowsHide: true
  });
  if (result.status !== 0) {
    const message = String(result.stderr || result.stdout || `git ${args.join(" ")} failed`).trim();
    if (options.allowFailure) return { ok: false, status: result.status, stdout: "", message };
    throw new Error(message);
  }
  return options.allowFailure
    ? { ok: true, status: 0, stdout: String(result.stdout || "").trim(), message: "" }
    : String(result.stdout || "").trim();
}

function splitLines(value) {
  return String(value || "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

function normalizeStatusPath(line) {
  const value = line.slice(3).trim();
  const target = value.includes(" -> ") ? value.split(" -> ").pop() : value;
  return target.replace(/^"|"$/g, "");
}

function listWorktrees() {
  const output = runGit(["worktree", "list", "--porcelain"]);
  const records = [];
  let current = null;
  for (const line of String(output).split(/\r?\n/)) {
    if (line.startsWith("worktree ")) {
      if (current) records.push(current);
      current = { path: line.slice(9), branch: "", head: "" };
    } else if (current && line.startsWith("HEAD ")) {
      current.head = line.slice(5);
    } else if (current && line.startsWith("branch refs/heads/")) {
      current.branch = line.slice("branch refs/heads/".length);
    }
  }
  if (current) records.push(current);
  return records;
}

function inspectLine(line, worktree, baseline = ACCEPTED_BASELINE, integrationHead = "HEAD") {
  if (!worktree) {
    return {
      ...line,
      state: "missing-worktree",
      worktree: "",
      head: "",
      integrated: false,
      baselineAligned: false,
      baseOnly: 0,
      branchOnly: 0,
      dirtyFiles: [],
      committedFiles: [],
      publicConflicts: [],
      blockersDetected: ["expected worktree is not registered"]
    };
  }

  const counts = runGit(["-C", worktree.path, "rev-list", "--left-right", "--count", `${baseline}...HEAD`]).split(/\s+/).map(Number);
  const mergeBase = runGit(["-C", worktree.path, "merge-base", baseline, "HEAD"]);
  const integrated = counts[1] > 0 && runGit(
    ["merge-base", "--is-ancestor", worktree.head, integrationHead],
    { allowFailure: true }
  ).ok;
  const statusLines = String(runGit(["-C", worktree.path, "status", "--porcelain=v1", "--untracked-files=all"]))
    .split(/\r?\n/)
    .filter(Boolean);
  const dirtyFiles = statusLines.map(normalizeStatusPath);
  const committedFiles = counts[1] > 0
    ? splitLines(runGit(["-C", worktree.path, "diff", "--name-only", `${baseline}...HEAD`]))
    : [];
  const publicConflicts = [...new Set(
    dirtyFiles.concat(committedFiles).filter((file) => PUBLIC_FILES.includes(file))
  )].sort();
  const blockersDetected = [];
  const baselineAligned = mergeBase === baseline;
  if (!baselineAligned) blockersDetected.push(`baseline drift: merge-base ${mergeBase.slice(0, 12)}`);
  if (dirtyFiles.length) blockersDetected.push(`${dirtyFiles.length} uncommitted files`);
  if (publicConflicts.length) blockersDetected.push(`T00-owned files changed: ${publicConflicts.join(", ")}`);
  if (!counts[1] && !dirtyFiles.length) blockersDetected.push("no deliverable yet");

  let state = "intake-ready";
  if (!baselineAligned) state = "blocked-baseline-drift";
  else if (dirtyFiles.length) state = "blocked-dirty-worktree";
  else if (publicConflicts.length) state = "blocked-public-conflict";
  else if (!counts[1]) state = "waiting-deliverable";

  return {
    ...line,
    state,
    worktree: path.basename(worktree.path),
    head: worktree.head,
    integrated,
    baselineAligned,
    baseOnly: counts[0] || 0,
    branchOnly: counts[1] || 0,
    dirtyFiles,
    committedFiles,
    publicConflicts,
    blockersDetected
  };
}

function detectCycle(lines) {
  const graph = new Map(lines.map((line) => [line.id, line.dependencies || []]));
  const visiting = new Set();
  const visited = new Set();
  function visit(id) {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const dependency of graph.get(id) || []) {
      if (visit(dependency)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  }
  return [...graph.keys()].some(visit);
}

function validateConfiguration(lines = LINE_CONFIG) {
  const expectedIds = Array.from({ length: 11 }, (_, index) => `T${String(index + 1).padStart(2, "0")}`);
  const ids = lines.map((line) => line.id).sort();
  const branches = lines.map((line) => line.branch);
  const orders = lines.map((line) => line.mergeOrder).sort((a, b) => a - b);
  const known = new Set(ids);
  const unknownDependencies = lines.flatMap((line) => (line.dependencies || []).filter((id) => !known.has(id)).map((id) => `${line.id}->${id}`));
  return [
    { id: "config:lines", passed: JSON.stringify(ids) === JSON.stringify(expectedIds), detail: `${lines.length}/11 professional lines` },
    { id: "config:branches", passed: new Set(branches).size === branches.length, detail: `${new Set(branches).size}/${branches.length} unique branches` },
    { id: "config:mergeOrder", passed: JSON.stringify(orders) === JSON.stringify(expectedIds.map((_, index) => index + 1)), detail: orders.join(",") },
    { id: "config:wave1", passed: lines.filter((line) => line.wave === 1).length === 6, detail: `${lines.filter((line) => line.wave === 1).length}/6 first-wave lines` },
    { id: "config:dependencies", passed: unknownDependencies.length === 0 && !detectCycle(lines), detail: unknownDependencies.length ? unknownDependencies.join(",") : "known and acyclic" },
    { id: "config:publicOwnership", passed: PUBLIC_FILES.length === 5, detail: `${PUBLIC_FILES.length} T00-owned public files` }
  ];
}

function readIntakeDecisions(file = DEFAULT_INTAKE_DECISIONS) {
  if (!fs.existsSync(file)) return { schemaVersion: 1, decisions: [] };
  const payload = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(payload.decisions)) throw new Error("integration intake decisions must contain a decisions array");
  return payload;
}

function validateIntakeDecisions(payload = { decisions: [] }, lines = LINE_CONFIG) {
  const knownLines = new Set(lines.map((line) => line.id));
  const decisions = Array.isArray(payload.decisions) ? payload.decisions : [];
  const ids = decisions.map((item) => item.lineId);
  const invalid = decisions.filter((item) => (
    !knownLines.has(item.lineId)
    || !INTAKE_DECISIONS.has(item.decision)
    || (item.decision !== "pending" && !String(item.candidateHead || "").trim())
  ));
  return {
    valid: invalid.length === 0 && new Set(ids).size === ids.length,
    decisions,
    invalid,
    duplicateLineIds: ids.filter((id, index) => ids.indexOf(id) !== index)
  };
}

function applyIntakeDecision(line, decision, dependencyWait = [], finalDependencyWait = []) {
  const blockersDetected = line.blockersDetected.slice();
  const recordedDecision = decision || { lineId: line.id, decision: "pending", candidateHead: "", blockers: [] };
  const decisionMatchesHead = Boolean(recordedDecision.candidateHead) && recordedDecision.candidateHead === line.head;
  let reviewState = recordedDecision.decision || "pending";
  if (reviewState !== "pending" && !decisionMatchesHead) reviewState = "stale";
  let state = line.state;

  if (line.integrated) {
    state = line.finalizer && finalDependencyWait.length
      ? "integrated-foundation-awaiting-final"
      : "integrated";
  } else if (state === "intake-ready") {
    if (reviewState === "blocked") {
      state = "blocked-intake-review";
      blockersDetected.push(...(recordedDecision.blockers || []));
    } else if (reviewState === "accepted") {
      if (dependencyWait.length) {
        state = "accepted-dependency-wait";
        blockersDetected.push(`dependencies not integrated: ${dependencyWait.join(", ")}`);
      } else {
        state = "merge-ready";
      }
    } else if (reviewState === "stale") {
      state = "review-stale";
      blockersDetected.push(`intake decision targets ${String(recordedDecision.candidateHead || "missing").slice(0, 12)}, current head ${line.head.slice(0, 12)}`);
    } else {
      state = "review-pending";
      blockersDetected.push("T00 code review and targeted regression decision pending");
    }
  }

  return {
    ...line,
    state,
    dependencyWait,
    finalDependencyWait,
    dependenciesSatisfied: dependencyWait.length === 0,
    intakeReview: {
      decision: recordedDecision.decision || "pending",
      effectiveState: reviewState,
      candidateHead: recordedDecision.candidateHead || "",
      decisionMatchesHead,
      reviewedAt: recordedDecision.reviewedAt || "",
      reviewer: recordedDecision.reviewer || "",
      checks: recordedDecision.checks || [],
      blockers: recordedDecision.blockers || []
    },
    blockersDetected
  };
}

function readGoNoGoSnapshot() {
  const file = path.join(ROOT, "release", "production-go-no-go-readiness-report.json");
  if (!fs.existsSync(file)) return { available: false, runtimeState: "missing", summary: {} };
  const payload = JSON.parse(fs.readFileSync(file, "utf8"));
  const center = payload.productionGoNoGo?.center || payload.center || {};
  return {
    available: true,
    generatedAt: payload.generatedAt || center.generatedAt || "",
    runtimeState: center.status || "unknown",
    summary: center.summary || {},
    gate: center.gate || {},
    decision: center.decision || null
  };
}

function buildIntegrationControlLedger(options = {}) {
  const generatedAt = options.generatedAt || new Date().toISOString();
  const baseline = options.baseline || ACCEPTED_BASELINE;
  const integrationHead = options.integrationHead || runGit(["rev-parse", "HEAD"]);
  const worktrees = options.worktrees || listWorktrees();
  const intakePayload = options.intakeDecisions || readIntakeDecisions(options.intakeDecisionsFile);
  const intakeValidation = validateIntakeDecisions(intakePayload);
  if (!intakeValidation.valid) throw new Error("integration intake decisions are invalid or duplicated");
  const intakeByLine = new Map(intakeValidation.decisions.map((item) => [item.lineId, item]));
  const byBranch = new Map(worktrees.map((item) => [item.branch, item]));
  const inspectedLines = LINE_CONFIG.map((line) => inspectLine(line, byBranch.get(line.branch), baseline, integrationHead));
  const inspectedById = new Map(inspectedLines.map((line) => [line.id, line]));
  const lines = inspectedLines.map((line) => {
    const dependencyWait = (line.dependencies || []).filter((id) => !inspectedById.get(id)?.integrated);
    const finalDependencyWait = (line.finalDependencies || []).filter((id) => !inspectedById.get(id)?.integrated);
    return applyIntakeDecision(line, intakeByLine.get(line.id), dependencyWait, finalDependencyWait);
  });
  const configurationChecks = validateConfiguration();
  const summary = {
    lines: lines.length,
    worktreesPresent: lines.filter((line) => line.worktree).length,
    baselineAligned: lines.filter((line) => line.baselineAligned).length,
    dirtyLines: lines.filter((line) => line.dirtyFiles.length).length,
    publicConflictLines: lines.filter((line) => line.publicConflicts.length).length,
    structuralReady: lines.filter((line) => ["merge-ready", "accepted-dependency-wait", "review-pending", "review-stale", "blocked-intake-review"].includes(line.state)).length,
    intakeAccepted: lines.filter((line) => line.intakeReview.effectiveState === "accepted").length,
    reviewPending: lines.filter((line) => line.state === "review-pending" || line.state === "review-stale").length,
    reviewBlocked: lines.filter((line) => line.state === "blocked-intake-review").length,
    intakeReady: lines.filter((line) => line.state === "merge-ready" || line.state === "accepted-dependency-wait").length,
    mergeReady: lines.filter((line) => line.state === "merge-ready").length,
    dependencyWait: lines.filter((line) => line.state === "accepted-dependency-wait").length,
    integrated: lines.filter((line) => line.state === "integrated").length,
    waitingDeliverable: lines.filter((line) => line.state === "waiting-deliverable").length,
    blocked: lines.filter((line) => line.state.startsWith("blocked") || line.state === "missing-worktree" || line.state === "accepted-dependency-wait" || line.state === "review-pending" || line.state === "review-stale").length
  };
  const checks = configurationChecks.concat([
    { id: "control:worktrees", passed: summary.worktreesPresent === 11, detail: `${summary.worktreesPresent}/11 registered` },
    { id: "control:baseline", passed: summary.baselineAligned === 11, detail: `${summary.baselineAligned}/11 aligned to ${baseline.slice(0, 12)}` },
    { id: "control:cleanIntake", passed: summary.dirtyLines === 0, detail: `${summary.dirtyLines} dirty professional lines` },
    { id: "control:publicExclusivity", passed: summary.publicConflictLines === 0, detail: `${summary.publicConflictLines} lines touch T00-owned files` }
  ]);
  const structuralOk = configurationChecks.every((item) => item.passed) && summary.worktreesPresent === 11;
  const releaseCandidateReady = structuralOk
    && summary.baselineAligned === 11
    && summary.dirtyLines === 0
    && summary.publicConflictLines === 0
    && summary.integrated === 11;
  return {
    project: "chronic-care-platform",
    generatedAt,
    ok: structuralOk,
    releaseCandidateReady,
    acceptedBaseline: baseline,
    sourceMainBaseline: SOURCE_MAIN_BASELINE,
    integrationHead,
    policy: {
      integrator: "T00",
      publicFiles: PUBLIC_FILES,
      firstWave: LINE_CONFIG.filter((line) => line.wave === 1).sort((a, b) => a.mergeOrder - b.mergeOrder).map((line) => line.id),
      mergeOrder: LINE_CONFIG.slice().sort((a, b) => a.mergeOrder - b.mergeOrder).map((line) => line.id),
      contractChangeFlow: CONTRACT_CHANGE_FLOW,
      validationCommands: VALIDATION_COMMANDS
    },
    intakeDecisions: intakePayload,
    summary,
    checks,
    lines,
    goNoGo: readGoNoGoSnapshot(),
    boundary: "This ledger inspects repository evidence and controls intake. It does not modify professional worktrees, fabricate site evidence, approve production release, or replace formal change authority."
  };
}

function safeCell(value) {
  return String(value ?? "").replace(/\|/g, "/").replace(/\r?\n/g, "<br>");
}

function renderMarkdown(report) {
  const checkRows = report.checks.map((item) => `| ${item.passed ? "PASS" : "BLOCKED"} | ${item.id} | ${safeCell(item.detail)} |`);
  const lineRows = report.lines.slice().sort((a, b) => a.mergeOrder - b.mergeOrder).map((line) => [
    line.id,
    line.title,
    line.wave,
    line.mergeOrder,
    line.state,
    `${line.intakeReview.effectiveState}${line.intakeReview.candidateHead ? ` @ ${line.intakeReview.candidateHead.slice(0, 12)}` : ""}`,
    line.head ? line.head.slice(0, 12) : "-",
    `${line.baseOnly}/${line.branchOnly}`,
    line.dirtyFiles.length,
    line.publicConflicts.join("<br>") || "-",
    `${(line.dependencies || []).join(", ") || "-"}${line.dependencyWait?.length ? ` / waiting: ${line.dependencyWait.join(", ")}` : ""}`
  ].map(safeCell).join(" | ")).map((row) => `| ${row} |`);
  const detailRows = report.lines.slice().sort((a, b) => a.mergeOrder - b.mergeOrder).map((line) => `| ${line.id} | ${safeCell(line.input)} | ${safeCell(line.output)} | ${safeCell(line.blockers)} | ${safeCell(line.acceptance)} |`);
  const goNoGo = report.goNoGo || {};
  return [
    "# T00 integration control ledger",
    "",
    `- Generated at: ${report.generatedAt}`,
    `- Control structure: ${report.ok ? "PASS" : "FAIL"}`,
    `- Release candidate gate: ${report.releaseCandidateReady ? "READY" : "BLOCKED"}`,
    `- Accepted baseline: ${report.acceptedBaseline}`,
    `- Source main baseline: ${report.sourceMainBaseline}`,
    `- Intake ready: ${report.summary.intakeReady}/11`,
    `- Merge ready: ${report.summary.mergeReady}/11`,
    `- Review pending/stale: ${report.summary.reviewPending}/11`,
    `- Review blocked: ${report.summary.reviewBlocked}/11`,
    `- Integrated: ${report.summary.integrated}/11`,
    `- Dirty lines: ${report.summary.dirtyLines}`,
    `- Baseline drift: ${11 - report.summary.baselineAligned}`,
    `- Public conflict lines: ${report.summary.publicConflictLines}`,
    "",
    "## Control checks",
    "",
    "| Result | Check | Detail |",
    "|---|---|---|",
    ...checkRows,
    "",
    "## Professional line intake",
    "",
    "`Base only/line only` is measured against the accepted baseline. Structural intake requires an aligned clean branch with commits and no T00-owned public files. Merge-ready additionally requires a T00 review decision bound to the exact candidate commit and every declared dependency to be integrated.",
    "",
    "| Line | Scope | Wave | Merge order | State | Intake review | Head | Base only/line only | Dirty | Public conflicts | Dependencies / waiting |",
    "|---|---|---:|---:|---|---|---|---|---:|---|---|",
    ...lineRows,
    "",
    "## Inputs, outputs and acceptance",
    "",
    "| Line | Input | Required output | External blockers | Acceptance |",
    "|---|---|---|---|---|",
    ...detailRows,
    "",
    "## T00-owned public files",
    "",
    ...report.policy.publicFiles.map((file) => `- \`${file}\``),
    "",
    "## Waves and serial gates",
    "",
    `- First wave: ${report.policy.firstWave.join(" -> ")}`,
    `- Serial merge order: ${report.policy.mergeOrder.join(" -> ")}`,
    "- T11 enters once for foundation controls and returns after T10 for final evidence and four-party decision.",
    "",
    "## Interface contract change flow",
    "",
    ...report.policy.contractChangeFlow.map((item, index) => `${index + 1}. ${item}`),
    "",
    "## Unified validation",
    "",
    "```powershell",
    ...report.policy.validationCommands,
    "```",
    "",
    "## Current production Go/No-Go snapshot",
    "",
    `- Runtime state: ${safeCell(goNoGo.runtimeState || "missing")}`,
    `- Prerequisites passed: ${goNoGo.summary?.prerequisitesPassed || 0}/${goNoGo.summary?.prerequisites || 0}`,
    `- Site acceptances: ${goNoGo.summary?.siteAcceptances || 0}`,
    `- Approvals recorded: ${goNoGo.summary?.approvalsRecorded || 0}/${goNoGo.summary?.approvals || 0}`,
    `- Production GO recorded: ${goNoGo.gate?.productionGoRecorded === true ? "yes" : "no"}`,
    "",
    "## Boundary",
    "",
    report.boundary,
    ""
  ].join("\n");
}

function parseArgs(argv = process.argv.slice(2)) {
  const flags = {};
  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const [key, ...rest] = arg.slice(2).split("=");
    flags[key] = rest.length ? rest.join("=") : true;
  }
  return flags;
}

function writeOutput(report, flags = {}) {
  const output = path.resolve(ROOT, String(flags.output || DEFAULT_OUTPUT));
  const markdown = path.resolve(ROOT, String(flags.markdown || DEFAULT_MARKDOWN));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2), "utf8");
  fs.mkdirSync(path.dirname(markdown), { recursive: true });
  fs.writeFileSync(markdown, renderMarkdown(report), "utf8");
}

function runCli() {
  const flags = parseArgs();
  const report = buildIntegrationControlLedger();
  if (flags.write !== "false") writeOutput(report, flags);
  console.log(JSON.stringify({
    ok: report.ok,
    releaseCandidateReady: report.releaseCandidateReady,
    acceptedBaseline: report.acceptedBaseline,
    summary: report.summary,
    intakeReady: report.lines.filter((line) => line.state === "merge-ready" || line.state === "accepted-dependency-wait").map((line) => line.id),
    mergeReady: report.lines.filter((line) => line.state === "merge-ready").map((line) => line.id),
    integrated: report.lines.filter((line) => line.state === "integrated").map((line) => line.id),
    blocked: report.lines.filter((line) => line.state.startsWith("blocked") || line.state === "missing-worktree" || line.state === "accepted-dependency-wait" || line.state === "review-pending" || line.state === "review-stale").map((line) => ({ id: line.id, state: line.state, reasons: line.blockersDetected }))
  }, null, 2));
  if (!report.ok || (flags.gate && !report.releaseCandidateReady)) process.exitCode = 1;
}

if (require.main === module) {
  try {
    runCli();
  } catch (error) {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  ACCEPTED_BASELINE,
  SOURCE_MAIN_BASELINE,
  PUBLIC_FILES,
  LINE_CONFIG,
  CONTRACT_CHANGE_FLOW,
  VALIDATION_COMMANDS,
  DEFAULT_INTAKE_DECISIONS,
  inspectLine,
  validateConfiguration,
  readIntakeDecisions,
  validateIntakeDecisions,
  applyIntakeDecision,
  buildIntegrationControlLedger,
  renderMarkdown,
  parseArgs,
  writeOutput
};
