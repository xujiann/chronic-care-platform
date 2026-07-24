(function (root) {
  const Production = root?.PhysicalExaminationProduction;
  if (!Production) throw new Error("PhysicalExaminationProduction is required");

  function buildNoGoTemplate() {
    return {
      environment: "staging",
      enabledSourceTypes: ["exam-center", "hospital"],
      mappingEvidence: [],
      integrationReceipts: [],
      reports: [],
      archiveEvidence: [],
      workflows: [],
      siteSignoffs: [],
      smoke: {
        moduleId: "physical-examination",
        entry: "physical-examination-standalone.html",
        loadedModules: ["physical-examination-standards", "physical-examination-production", "physical-examination-standalone"],
        requiredFiles: [...Production.REQUIRED_STANDALONE_FILES],
        probes: [],
        executedAt: "",
        evidenceRef: ""
      },
      rollback: {
        currentVersion: Production.VERSION,
        previousVersion: "",
        artifactSha256: "",
        snapshotRef: "",
        rehearsalRef: "",
        rehearsedAt: "",
        targetRtoMinutes: 30,
        restoreDurationMinutes: 0,
        reconciliationPassed: false,
        preparedBy: "",
        approvedBy: "",
        approved: false
      }
    };
  }

  function renderCatalogs() {
    const profiles = document.querySelector("#standalone-mapping-profiles");
    profiles.innerHTML = Object.values(Production.SOURCE_MAPPING_PROFILES).map((profile) => `
      <article class="card">
        <span>${escapeHtml(profile.sourceType)}</span>
        <strong>${escapeHtml(profile.id)}</strong>
        <small>版本 ${escapeHtml(profile.version)} · ${Object.keys(profile.fields).length} 个标准字段</small>
      </article>`).join("");
    const requirements = document.querySelector("#standalone-evidence-requirements");
    requirements.innerHTML = `<ul>${Production.SITE_EVIDENCE_REQUIREMENTS.map((item) => `<li><strong>${escapeHtml(item.name)}</strong><br><code>${escapeHtml(item.validator)}</code></li>`).join("")}</ul>`;
    const capabilities = [
      ["字段映射", "2类", "体检中心 / 医院"],
      ["报告签名", "WS/T 847", "SM2 / SM3 / ES-T"],
      ["异常闭环", "5步", "确认至家医随访关闭"],
      ["上线结论", "NO-GO默认", "现场证据齐备才GO"]
    ];
    document.querySelector("#standalone-capabilities").innerHTML = capabilities.map(([label, value, hint]) => `<article class="card"><span>${label}</span><strong>${value}</strong><small>${hint}</small></article>`).join("");
  }

  function runGate() {
    const error = document.querySelector("#standalone-error");
    error.textContent = "";
    try {
      const bundle = JSON.parse(document.querySelector("#standalone-bundle").value);
      renderDecision(Production.buildGoLiveDecision(bundle));
    } catch (cause) {
      error.textContent = `证据包无法校验：${cause.message}`;
    }
  }

  function renderDecision(report) {
    const decision = document.querySelector("#standalone-decision");
    decision.textContent = report.decision;
    decision.className = `status ${report.goLiveReady ? "go" : ""}`;
    const summary = [
      ["代码能力", report.codeReady ? "就绪" : "未就绪"],
      ["现场证据", report.externalEvidenceReady ? "齐备" : "缺失"],
      ["运行环境", report.productionEnvironment ? "生产" : "非生产"],
      ["正式切换", report.goLiveReady ? "允许" : "阻断"]
    ];
    document.querySelector("#standalone-summary").innerHTML = summary.map(([label, value]) => `<article class="card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></article>`).join("");
    document.querySelector("#standalone-checks").innerHTML = report.checks.map((item) => `
      <li class="${item.ok ? "" : "failed"}"><strong>${escapeHtml(item.id)} · ${item.ok ? "通过" : "未通过"}</strong>
      <small>${escapeHtml(item.issues.join("；") || JSON.stringify(item.evidence))}</small></li>`).join("");
    document.querySelector("#standalone-blockers").innerHTML = report.blockers.map((item) => `<li>${escapeHtml(item)}</li>`).join("") || "<li>没有阻断项；请归档本次证据包和判定结果。</li>";
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  }

  if (typeof document !== "undefined") {
    document.addEventListener("DOMContentLoaded", () => {
      renderCatalogs();
      const template = buildNoGoTemplate();
      document.querySelector("#standalone-bundle").value = JSON.stringify(template, null, 2);
      document.querySelector("#standalone-run").addEventListener("click", runGate);
      renderDecision(Production.buildGoLiveDecision(template));
    });
  }

  root.PhysicalExaminationStandalone = { buildNoGoTemplate, renderDecision };
})(typeof globalThis !== "undefined" ? globalThis : this);
