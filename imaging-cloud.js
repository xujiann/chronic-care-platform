const imagingState = {
  payload: null,
  fallbackData: null,
  productionCenter: null,
  productionApiReady: false,
  selectedResidentId: "",
  selectedInstitutionCode: "",
  selectedStudyId: ""
};

const IMAGING_API_BASE = location.protocol === "file:" ? "" : `${location.origin}/api`;

document.addEventListener("DOMContentLoaded", async () => {
  await Promise.all([loadImagingCloud(), loadProductionCenter(), loadSolutionAHealth(), loadSolutionAStudies()]);
  bindImagingControls();
  renderImagingCloud();
});

async function loadImagingCloud() {
  const params = new URLSearchParams();
  if (imagingState.selectedResidentId) params.set("residentId", imagingState.selectedResidentId);
  if (imagingState.selectedInstitutionCode) params.set("institutionCode", imagingState.selectedInstitutionCode);
  if (IMAGING_API_BASE) {
    try {
      const request = window.HealthCityAuth?.authFetch || fetch;
      const response = await request(`${IMAGING_API_BASE}/imaging-cloud${params.toString() ? `?${params}` : ""}`);
      if (response.ok) {
        imagingState.payload = await response.json();
        return;
      }
    } catch (error) {
      // Static preview falls through to embedded demo data.
    }
  }
  imagingState.payload = buildFallbackImagingCloud();
}

async function loadProductionCenter() {
  if (IMAGING_API_BASE) {
    try {
      const request = window.HealthCityAuth?.authFetch || fetch;
      const response = await request(`${IMAGING_API_BASE}/imaging-cloud/production-center`);
      if (response.ok) {
        imagingState.productionCenter = await response.json();
        imagingState.productionApiReady = true;
        return;
      }
    } catch (error) {
      // T00 may not have integrated the production route yet.
    }
  }
  imagingState.productionApiReady = false;
  imagingState.productionCenter = imagingState.payload?.productionCenter || fallbackProductionCenter();
}

function bindImagingControls() {
  document.querySelector("#resident-filter")?.addEventListener("change", async (event) => {
    imagingState.selectedResidentId = event.target.value;
    await loadImagingCloud();
    renderImagingCloud();
  });
  document.querySelector("#institution-filter")?.addEventListener("change", async (event) => {
    imagingState.selectedInstitutionCode = event.target.value;
    await loadImagingCloud();
    renderImagingCloud();
  });
  document.querySelector("#reload-imaging")?.addEventListener("click", async () => {
    await Promise.all([loadImagingCloud(), loadProductionCenter()]);
    renderImagingCloud();
  });
  document.querySelector("#reload-solution-a")?.addEventListener("click", loadSolutionAHealth);
  document.querySelector("#reload-solution-a-studies")?.addEventListener("click", loadSolutionAStudies);
  document.querySelector("#ingest-form")?.addEventListener("submit", submitImagingIngest);
  document.addEventListener("submit", handleProductionSubmit);
  document.addEventListener("click", handleImagingAction);
}

function renderImagingCloud() {
  const payload = imagingState.payload || buildFallbackImagingCloud();
  const studies = payload.studies || [];
  if (!imagingState.selectedStudyId || !studies.some((item) => item.id === imagingState.selectedStudyId)) {
    imagingState.selectedStudyId = studies[0]?.id || "";
  }
  renderFilters(payload);
  renderSummary(payload.summary || {});
  renderProductionGate(imagingState.productionCenter || payload.productionCenter || fallbackProductionCenter());
  renderStudyTable(studies);
  renderMutualRecognition(payload.mutualRecognition || []);
  renderImagingTeleconsultations(payload.teleconsultations || []);
  renderGovernance(payload.governance || {});
  renderDevelopmentPlan(payload);
  renderGateways(payload);
  renderMobileViewer(studies.find((item) => item.id === imagingState.selectedStudyId) || studies[0], payload);
}

function renderProductionGate(center = {}) {
  const target = document.querySelector("#production-gate");
  if (!target) return;
  const summary = center.summary || {};
  const formalReady = center.productionReady === true;
  const metrics = [
    ["合成验收", summary.syntheticChecksPassed || 0, summary.syntheticChecks || 10],
    ["生产端点", summary.endpointsReady || 0, summary.endpoints || 5],
    ["现场签署", summary.requirementsSigned || 0, summary.requirements || 7],
    ["结构化回执", summary.siteReceiptsVerified || 0, summary.siteReceipts || 5],
    ["故障演练", summary.drillsPassed || 0, summary.drills || 4],
    ["上线审批", summary.approvalsSigned || 0, summary.approvals || 2]
  ];
  const blockers = (center.requirements || []).filter((item) => item.status !== "signed").slice(0, 7);
  target.innerHTML = `
    <div class="metric-grid">
      <article class="metric-card"><span>功能状态</span><strong>${escapeHtml(center.functionalState || "ready-for-synthetic-acceptance")}</strong><small>合成闭环通过后才进入现场联调</small></article>
      <article class="metric-card"><span>正式上线</span><strong>${formalReady ? "可上线" : "阻断"}</strong><small>${escapeHtml(center.formalGoLiveState || "blocked-until-site-evidence-signed")}</small></article>
      ${metrics.map(([label, passed, total]) => `<article class="metric-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(passed)}/${escapeHtml(total)}</strong><small>${Number(passed) === Number(total) ? "已完成" : "仍需生产证据"}</small></article>`).join("")}
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>现场要求</th><th>责任方</th><th>关联端点</th><th>状态</th><th>证据</th></tr></thead>
      <tbody>${blockers.map((item) => `<tr>
        <td><strong>${escapeHtml(item.id)}</strong><br><small>${escapeHtml(item.title)}</small></td>
        <td>${escapeHtml(item.owner)}</td>
        <td>${escapeHtml((item.endpointIds || []).join("、") || "综合验收")}</td>
        <td><span class="badge warn">${escapeHtml(item.status)}</span></td>
        <td>${escapeHtml(item.evidenceRef || "待现场提交")}</td>
      </tr>`).join("") || `<tr><td colspan="5">全部现场证据已签署；仍需确认故障演练和双人审批。</td></tr>`}</tbody>
    </table></div>
    <div class="table-wrap"><table>
      <thead><tr><th>结构化现场回执</th><th>覆盖现场要求</th><th>状态</th><th>证据</th></tr></thead>
      <tbody>${(center.siteReceipts || []).map((item) => `<tr>
        <td><strong>${escapeHtml(item.title)}</strong><br><small>${escapeHtml(item.type)}</small></td>
        <td>${escapeHtml((item.requirementIds || []).join("、"))}</td>
        <td><span class="badge ${item.status === "verified" ? "ok" : "warn"}">${escapeHtml(item.status)}</span></td>
        <td>${escapeHtml(item.evidenceRef || "待现场提交")}</td>
      </tr>`).join("") || `<tr><td colspan="4">等待 T00 接入生产领域回执接口。</td></tr>`}</tbody>
    </table></div>
    <p><small>生产控制接口由 <code>imaging-cloud-production.js</code> 提供领域契约，公共路由由T00集成。</small></p>
    ${renderProductionOperations(center)}`;
}

function renderProductionOperations(center = {}) {
  const role = window.HealthCityAuth?.getUser?.()?.role;
  if (!IMAGING_API_BASE) return `<p class="status-message">静态预览不写入生产证据；请在T00完成公共路由集成后登录操作。</p>`;
  if (!imagingState.productionApiReady) return `<p class="status-message">生产领域服务已就绪，T00公共路由尚未接通；当前保持只读，避免把演示数据写成生产证据。</p>`;
  if (!["commission", "institution"].includes(role)) return `<p class="status-message">当前角色仅可查看生产门禁。</p>`;
  const options = (rows, label) => (rows || []).map((item)=>`<option value="${escapeHtml(item.id)}">${escapeHtml(item.id)} · ${escapeHtml(item[label] || item.name || item.title)}</option>`).join("");
  return `<details class="production-operations">
    <summary>生产操作工作台</summary>
    <p id="production-action-status" class="status-message">所有动作均写入领域审计；现场证据不会由页面自动生成。</p>
    <div class="imaging-layout">
      <form class="ingest-form" data-production-action="endpoint">
        <h3>生产端点探测</h3>
        <label>端点<select name="id">${options(center.endpoints, "name")}</select></label>
        <label>HTTPS / DICOM TLS 地址<input name="endpoint" required placeholder="https://production.example/fhir"></label>
        <label>凭据引用<input name="credentialRef" required placeholder="vault://imaging/fhir"></label>
        <label>证书 SHA-256<input name="certificateFingerprint" required placeholder="sha256:64位摘要"></label>
        <label>时延(ms)<input name="latencyMs" type="number" min="0"></label>
        <button class="inline-action primary" type="submit">记录探测通过</button>
      </form>
      <form class="ingest-form" data-production-action="synthetic">
        <h3>合成数据验收</h3>
        <label>检查项<select name="id">${options(center.syntheticChecks, "title")}</select></label>
        <label>精确确认语<input name="confirmation" required placeholder="CONFIRM SYNTHETIC IMAGING CHECK"></label>
        <label>证据引用<input name="evidenceRef" required></label>
        <label>说明<input name="detail"></label>
        <button class="inline-action primary" type="submit">记录合成验收通过</button>
      </form>
      <form class="ingest-form" data-production-action="requirement">
        <h3>现场证据四眼流转</h3>
        <label>要求<select name="id">${options(center.requirements, "title")}</select></label>
        <label>动作<select name="action"><option value="submit-evidence">提交证据</option><option value="verify-evidence">独立核验</option><option value="reject-evidence">驳回证据</option></select></label>
        <label>精确确认语<input name="confirmation" placeholder="SUBMIT/VERIFY IMAGING SITE EVIDENCE"></label>
        <label>证据引用<input name="evidenceRef"></label>
        <label>证据摘要<input name="evidenceDigest" placeholder="sha256:64位摘要"></label>
        <label>外部签署人<input name="externalSigner"></label>
        <label>外部机构<input name="externalOrganization"></label>
        <label>核验引用<input name="verificationRef"></label>
        <button class="inline-action primary" type="submit">执行证据动作</button>
      </form>
      <form class="ingest-form" data-production-action="receipt">
        <h3>结构化现场回执</h3>
        <label>回执类型<select name="id">${options(center.siteReceipts, "title")}</select></label>
        <label>精确确认语<input name="confirmation" required placeholder="SUBMIT IMAGING SITE EVIDENCE"></label>
        <label>证据引用<input name="evidenceRef" required></label>
        <label>证据摘要<input name="evidenceDigest" required placeholder="sha256:64位摘要"></label>
        <label>外部签署人<input name="externalSigner" required></label>
        <label>外部机构<input name="externalOrganization" required></label>
        <label class="full">契约字段 JSON<textarea name="receiptPayload" rows="5" required placeholder='{"contractVersion":"1.0"}'></textarea></label>
        <button class="inline-action primary" type="submit">提交结构化回执</button>
      </form>
      <form class="ingest-form" data-production-action="receipt-verify">
        <h3>独立核验结构化回执</h3>
        <label>回执类型<select name="id">${options(center.siteReceipts, "title")}</select></label>
        <label>精确确认语<input name="confirmation" required placeholder="VERIFY IMAGING SITE EVIDENCE"></label>
        <label>证据摘要<input name="evidenceDigest" required placeholder="sha256:64位摘要"></label>
        <label>核验引用<input name="verificationRef" required></label>
        <button class="inline-action primary" type="submit">独立核验回执</button>
      </form>
      <form class="ingest-form" data-production-action="drill">
        <h3>生产故障演练</h3>
        <label>演练<select name="id">${options(center.drills, "title")}</select></label>
        <label>证据引用<input name="evidenceRef" required></label>
        <button class="inline-action primary" type="submit">记录演练通过</button>
      </form>
      <form class="ingest-form" data-production-action="approval">
        <h3>上线双人审批</h3>
        <label>审批<select name="id">${options(center.approvals, "title")}</select></label>
        <label>精确确认语<input name="confirmation" required placeholder="CONFIRM IMAGING PRODUCTION CUTOVER"></label>
        <label>证据引用<input name="evidenceRef" required></label>
        <button class="inline-action primary" type="submit">签署上线审批</button>
      </form>
    </div>
  </details>`;
}

async function handleProductionSubmit(event) {
  const form = event.target.closest?.("form[data-production-action]");
  if (!form) return;
  event.preventDefault();
  const kind = form.dataset.productionAction;
  const values = Object.fromEntries([...new FormData(form).entries()].filter(([, value])=>String(value).trim() !== ""));
  if (values.receiptPayload) {
    try {
      Object.assign(values, JSON.parse(values.receiptPayload));
    } catch {
      const status = document.querySelector("#production-action-status");
      if (status) status.textContent = "提交失败：契约字段必须为有效 JSON。";
      return;
    }
    delete values.receiptPayload;
  }
  const id = encodeURIComponent(values.id || "");
  delete values.id;
  const contracts = {
    endpoint:{ path:`/imaging-cloud/production/endpoints/${id}/probe`, defaults:{ environment:"production", result:"passed" } },
    synthetic:{ path:`/imaging-cloud/production/synthetic-checks/${id}/actions`, defaults:{ result:"passed", dataClass:"synthetic-test-data" } },
    requirement:{ path:`/imaging-cloud/production/requirements/${id}/actions`, defaults:{} },
    receipt:{ path:`/imaging-cloud/production/receipts/${id}/submit`, defaults:{} },
    "receipt-verify":{ path:`/imaging-cloud/production/receipts/${id}/verify`, defaults:{} },
    drill:{ path:`/imaging-cloud/production/drills/${id}/complete`, defaults:{ result:"passed" } },
    approval:{ path:`/imaging-cloud/production/approvals/${id}/sign`, defaults:{} }
  };
  const contract = contracts[kind];
  if (!contract || !id) return;
  const status = document.querySelector("#production-action-status");
  if (status) status.textContent = "正在提交生产控制动作...";
  try {
    const request = window.HealthCityAuth?.authFetch || fetch;
    const response = await request(`${IMAGING_API_BASE}${contract.path}`, {
      method:"POST", headers:{ "Content-Type":"application/json" }, body:JSON.stringify({ ...values, ...contract.defaults })
    });
    const result = await response.json().catch(()=>({}));
    if (!response.ok) throw new Error(result.message || result.error || `HTTP ${response.status}`);
    await loadProductionCenter();
    renderProductionGate(imagingState.productionCenter);
  } catch (error) {
    const nextStatus = document.querySelector("#production-action-status");
    if (nextStatus) nextStatus.textContent = `提交失败：${error.message}`;
  }
}

function renderFilters(payload) {
  const isPatientView = window.HealthCityAuth?.getUser?.()?.role === "citizen";
  const residents = getFallbackResidents();
  const residentSelect = document.querySelector("#resident-filter");
  const ingestResidentSelect = document.querySelector("#ingest-form select[name='residentId']");
  const residentOptions = [`<option value="">全部可授权居民</option>`].concat(residents.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)} · ${escapeHtml(item.id)}</option>`)).join("");
  if (residentSelect) {
    residentSelect.closest("label")?.toggleAttribute("hidden", isPatientView);
    residentSelect.innerHTML = residentOptions;
    residentSelect.value = imagingState.selectedResidentId;
  }
  if (ingestResidentSelect) {
    ingestResidentSelect.innerHTML = residents.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)} · ${escapeHtml(item.id)}</option>`).join("");
  }
  const institutions = [...new Map([...(payload.gateways || []).map((item) => [item.institutionCode, item.institutionName]), ...(payload.studies || []).map((item) => [item.institutionCode, item.institutionName])]).entries()];
  const institutionSelect = document.querySelector("#institution-filter");
  if (institutionSelect) {
    institutionSelect.closest("label")?.toggleAttribute("hidden", isPatientView);
    institutionSelect.innerHTML = [`<option value="">全部机构</option>`].concat(institutions.map(([code, name]) => `<option value="${escapeHtml(code)}">${escapeHtml(name)} · ${escapeHtml(code)}</option>`)).join("");
    institutionSelect.value = imagingState.selectedInstitutionCode;
  }
}

function renderSummary(summary) {
  const target = document.querySelector("#imaging-summary");
  if (!target) return;
  target.innerHTML = [
    ["影像检查", summary.studies || 0, "跨机构主索引归集"],
    ["接入机构", summary.institutions || 0, "PACS/RIS/EMR 网关"],
    ["诊断级序列", summary.diagnosticLevel || 0, "DICOM 无损压缩"],
    ["浏览级可看", summary.browserLevel || 0, "手机端流畅调阅"],
    ["质控通过", summary.qcPassed || 0, "扫描评价与报告审核"],
    ["EMR 已同步", summary.emrSynced || 0, "电子病历索引兼容"],
    ["有效分享", summary.activeShares || 0, "二维码/短信限时授权"],
    ["跨机构互认", summary.mutualRecognition || 0, `${summary.recognized || 0} 已互认 / ${summary.pendingRecognition || 0} 待确认 / ${summary.pendingAppeals || 0} 待复核`]
  ].map(([label, value, hint]) => `<article class="metric-card">
    <span>${escapeHtml(label)}</span>
    <strong>${escapeHtml(value)}</strong>
    <small>${escapeHtml(hint)}</small>
  </article>`).join("");
}

function renderStudyTable(studies) {
  const target = document.querySelector("#study-table");
  if (!target) return;
  target.innerHTML = `<table>
    <thead><tr><th>检查</th><th>医院</th><th>主索引</th><th>入云</th><th>质控/EMR</th><th>跨机构互认</th><th>操作</th></tr></thead>
    <tbody>${studies.map((item) => `<tr>
      <td><strong>${escapeHtml(item.modality)} · ${escapeHtml(item.bodyPart)}</strong><br><small>${escapeHtml(item.studyDate)} · ${escapeHtml(item.accessionNumber)}</small></td>
      <td>${escapeHtml(item.institutionName)}<br><small>${escapeHtml(item.uploadMode)}</small></td>
      <td><small>${escapeHtml(item.mainIndex)}</small></td>
      <td><span class="badge ok">${escapeHtml(item.uploadStatus)}</span><br><small>${escapeHtml(item.integrityCheck)} · ${escapeHtml(item.imageCount)} 幅</small></td>
      <td><span class="badge ${/通过|已写入|passed/i.test(`${item.qcStatus} ${item.emrSyncStatus}`) ? "ok" : "warn"}">${escapeHtml(item.qcStatus)}</span><br><small>${escapeHtml(item.emrSyncStatus)}${item.fhirReportSyncStatus === "failed" ? ` · FHIR回写失败：${escapeHtml(item.fhirReportLastError || "待重试")}` : item.fhirReportSyncStatus === "synced" ? " · FHIR已同步" : ""}</small></td>
      <td><span class="badge ${/已互认|recognized/i.test(item.mutualRecognitionStatus || "") ? "ok" : /不予|拒绝/i.test(item.mutualRecognitionStatus || "") ? "warn" : "info"}">${escapeHtml(item.mutualRecognitionStatus || "未发起")}</span><br><small>${escapeHtml(item.mutualRecognitionReason || "可发起区域互认")}</small></td>
      <td>
        <button class="inline-action" type="button" data-view-study="${escapeHtml(item.id)}">手机查看</button>
        ${canOpenDiagnosticViewer(item) ? `<button class="inline-action primary" type="button" data-open-ohif="${escapeHtml(item.id)}">诊断调阅</button>` : ""}
        <button class="inline-action" type="button" data-share-study="${escapeHtml(item.id)}">分享</button>
        ${canRetryFhirWriteback(item) ? `<button class="inline-action" type="button" data-retry-fhir-writeback="${escapeHtml(item.id)}">重试FHIR回写</button>` : ""}
        ${canStartImagingTeleconsultation(item) ? `<button class="inline-action" type="button" data-start-imaging-teleconsultation="${escapeHtml(item.id)}">发起远程会诊</button>` : ""}
        ${canManageMutualRecognition() && !item.mutualRecognitionRecordId ? `<button class="inline-action" type="button" data-start-recognition="${escapeHtml(item.id)}">纳入互认</button>` : ""}
      </td>
    </tr>`).join("") || `<tr><td colspan="7">暂无影像云检查。</td></tr>`}</tbody>
  </table>`;
}

function renderRecognitionActions(item) {
  const state = `${item.status || ""} ${item.reviewStatus || ""}`;
  if (item.appeal?.status === "pending-review") {
    return canDecideMutualRecognition()
      ? `<button class="inline-action primary" type="button" data-review-recognition-appeal="${escapeHtml(item.imageCloudStudyId)}" data-appeal-decision="approve">通过申诉</button>
         <button class="inline-action" type="button" data-review-recognition-appeal="${escapeHtml(item.imageCloudStudyId)}" data-appeal-decision="reject">驳回申诉</button>`
      : "待独立复核";
  }
  if (/不予|拒绝|rejected/i.test(state) && canSubmitRecognitionAppeal()) {
    return `<button class="inline-action" type="button" data-appeal-recognition="${escapeHtml(item.imageCloudStudyId)}">提交申诉</button>`;
  }
  if (canDecideMutualRecognition() && /待|pending/i.test(state)) {
    return `<button class="inline-action primary" type="button" data-decide-recognition="${escapeHtml(item.imageCloudStudyId)}" data-recognition-decision="recognize">确认互认</button>
      <button class="inline-action" type="button" data-decide-recognition="${escapeHtml(item.imageCloudStudyId)}" data-recognition-decision="reject">不予互认</button>`;
  }
  return "-";
}

function renderMutualRecognition(records) {
  const target = document.querySelector("#mutual-recognition-table");
  if (!target) return;
  target.innerHTML = `<table>
    <thead><tr><th>检查/主索引</th><th>协同路径</th><th>互认状态</th><th>质控与理由</th><th>操作</th></tr></thead>
    <tbody>${records.map((item) => `<tr>
      <td><strong>${escapeHtml(item.item)}</strong><br><small>${escapeHtml(item.mainIndex)}</small></td>
      <td>${escapeHtml(item.sourceInstitution)}<br><small>至 ${escapeHtml(item.targetInstitution)}</small></td>
      <td><span class="badge ${/已互认|recognized/i.test(`${item.status} ${item.reviewStatus}`) ? "ok" : /不予|拒绝|rejected/i.test(`${item.status} ${item.reviewStatus}`) ? "warn" : "info"}">${escapeHtml(item.reviewStatus || item.status)}</span>${item.appeal?.status ? `<br><small>申诉：${escapeHtml(item.appeal.status)}</small>` : ""}</td>
      <td>${escapeHtml(item.qualityStatus || "待质控")}<br><small>${escapeHtml(item.appeal?.reason || item.reviewReasonCode || item.reason || "待目标机构确认")}</small></td>
      <td>${renderRecognitionActions(item)}</td>
    </tr>`).join("") || `<tr><td colspan="5">暂未纳入跨机构互认；机构端可在影像检查列表发起。</td></tr>`}</tbody>
  </table>`;
}

function canManageMutualRecognition() {
  return ["commission", "institution", "county"].includes(window.HealthCityAuth?.getUser?.()?.role);
}

function canDecideMutualRecognition() {
  return ["commission", "county"].includes(window.HealthCityAuth?.getUser?.()?.role);
}

function canSubmitRecognitionAppeal() {
  return window.HealthCityAuth?.getUser?.()?.role === "institution";
}

function canRetryFhirWriteback(item) {
  return ["commission", "institution"].includes(window.HealthCityAuth?.getUser?.()?.role) && item?.fhirReportSyncStatus === "failed";
}

function canOpenDiagnosticViewer(item) {
  return Boolean(item?.diagnosticLevel) && ["commission", "institution", "county"].includes(window.HealthCityAuth?.getUser?.()?.role);
}

function canStartImagingTeleconsultation(item) {
  return ["commission", "institution", "county"].includes(window.HealthCityAuth?.getUser?.()?.role) && !item?.teleconsultationId;
}

function renderImagingTeleconsultations(rows) {
  const target = document.querySelector("#imaging-teleconsultation-table");
  if (!target) return;
  target.innerHTML = `<table>
    <thead><tr><th>影像检查</th><th>会诊路径</th><th>状态</th><th>材料边界</th></tr></thead>
    <tbody>${rows.map((item) => `<tr>
      <td><strong>${escapeHtml(item.imageReference?.modality || "影像检查")} · ${escapeHtml(item.imageReference?.bodyPart || "")}</strong><br><small>${escapeHtml(item.imageCloudStudyId || "")}</small></td>
      <td>${escapeHtml(item.sourceInstitution)}<br><small>至 ${escapeHtml(item.targetInstitution)} · ${escapeHtml(item.department || "待分诊")}</small></td>
      <td><span class="badge ${/returned|closed/i.test(`${item.status} ${item.reportStatus}`) ? "ok" : "info"}">${escapeHtml(item.status)}</span><br><small>${escapeHtml(item.reportStatus || "待报告回传")}</small></td>
      <td><small>${escapeHtml((item.materials || []).join("、"))}<br>原始 DICOM：${item.imageReference?.rawDicomIncluded === false ? "未携带" : "受控调阅"}</small></td>
    </tr>`).join("") || `<tr><td colspan="4">暂无影像远程会诊；机构端可从检查列表发起。</td></tr>`}</tbody>
  </table>`;
}

function renderGateways(payload) {
  const gateways = payload.gateways || [];
  const gatewayTarget = document.querySelector("#gateway-grid");
  if (gatewayTarget) {
    gatewayTarget.innerHTML = gateways.map((item) => `<article class="capability-card">
      <strong>${escapeHtml(item.institutionName)}</strong>
      <span>${escapeHtml(item.mode)} · ${escapeHtml(item.status)} · ${escapeHtml(item.lastHeartbeat)}</span>
      <small>${escapeHtml((item.dicomProtocols || []).join(" / "))}</small>
      <small>${escapeHtml(item.encryption)}；${escapeHtml(item.compression)}</small>
    </article>`).join("");
  }
  const emr = payload.emrCompatibility || {};
  const emrTarget = document.querySelector("#emr-compatibility");
  if (emrTarget) {
    emrTarget.innerHTML = [
      ["主索引规则", emr.mainIndexRule],
      ["来源系统", (emr.sourceSystems || []).join("、")],
      ["交换协议", (emr.exchange || []).join("、")],
      ["映射集合", (emr.mappedCollections || []).join("、")],
      ["兼容状态", emr.status === "ready" ? "已可供 EMR 授权调阅" : "等待报告或授权数据"]
    ].map(([label, value]) => `<div><strong>${escapeHtml(label)}</strong><span>${escapeHtml(value)}</span></div>`).join("");
  }
}

function renderDevelopmentPlan(payload) {
  const featuresTarget = document.querySelector("#imaging-current-capabilities");
  const planTarget = document.querySelector("#imaging-development-plan");
  const features = payload.implementedFeatures || [];
  const plan = payload.developmentPlan || [];
  if (featuresTarget) {
    featuresTarget.innerHTML = features.map((item) => `<article class="capability-card">
      <strong>${escapeHtml(item.name)}</strong>
      <span>${escapeHtml(item.status)} · ${escapeHtml(item.evidence)}</span>
      <small>${escapeHtml(item.detail)}</small>
    </article>`).join("");
  }
  if (planTarget) {
    planTarget.innerHTML = `<table>
      <thead><tr><th>优先级</th><th>阶段</th><th>责任方</th><th>下一动作</th><th>验收口径</th><th>状态</th></tr></thead>
      <tbody>${plan.map((item) => `<tr>
        <td><span class="badge ${item.priority === "P0" ? "warn" : item.priority === "P1" ? "info" : ""}">${escapeHtml(item.priority)}</span></td>
        <td><strong>${escapeHtml(item.phase)}</strong><br><small>${escapeHtml(item.target)}</small></td>
        <td>${escapeHtml(item.owner)}</td>
        <td>${escapeHtml(item.nextAction)}</td>
        <td>${escapeHtml(item.acceptance)}</td>
        <td>${escapeHtml(item.status)}<br><small>${escapeHtml((item.evidence || []).join(" / "))}</small></td>
      </tr>`).join("") || `<tr><td colspan="6">暂无下一步开发计划。</td></tr>`}</tbody>
    </table>`;
  }
}

function renderGovernance(governance = {}) {
  const summaryTarget = document.querySelector("#imaging-governance-summary");
  const tableTarget = document.querySelector("#imaging-governance-table");
  const catalog = governance.recognitionCatalog || [];
  const assessments = governance.recognitionAssessment || [];
  const ranking = governance.operations?.institutionRanking || [];
  const performance = governance.performance || {};
  if (summaryTarget) {
    summaryTarget.innerHTML = [
      ["互认目录", catalog.filter((item) => item.status === "active").length, `共 ${catalog.length} 项`],
      ["负面清单", (governance.negativeRules || []).filter((item) => item.status === "active").length, "复查/复核情形"],
      ["质控计划", (governance.qualityPlans || []).filter((item) => item.status === "active").length, "抽样与评分阈值"],
      ["移动性能", `${performance.withinTarget || 0}/${performance.samples || 0}`, `首帧目标 ${performance.targets?.firstFrameMs || 5000}ms`]
    ].map(([label, value, hint]) => `<article class="metric-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(hint)}</small></article>`).join("");
  }
  if (tableTarget) {
    tableTarget.innerHTML = `<table>
      <thead><tr><th>检查</th><th>目录</th><th>互认评估</th><th>复查/复核原因</th></tr></thead>
      <tbody>${assessments.map((item) => `<tr>
        <td>${escapeHtml(item.studyId)}</td>
        <td>${item.catalog ? `${escapeHtml(item.catalog.modality)} · ${escapeHtml(item.catalog.bodyPart)} · ${escapeHtml(item.catalog.validDays)}天` : "未纳入目录"}</td>
        <td><span class="badge ${item.eligible ? "ok" : "warn"}">${escapeHtml(item.decision)}</span></td>
        <td>${escapeHtml((item.negativeRules || []).map((rule) => rule.title).join("；") || "无")}</td>
      </tr>`).join("") || `<tr><td colspan="4">当前筛选范围暂无可评估检查。</td></tr>`}</tbody>
    </table>
    <h3>机构接入与质量排名</h3>
    <table>
      <thead><tr><th>机构</th><th>入云检查</th><th>诊断级</th><th>质控通过</th><th>互认</th></tr></thead>
      <tbody>${ranking.map((item) => `<tr>
        <td><strong>${escapeHtml(item.institutionName)}</strong><br><small>${escapeHtml(item.institutionCode)}</small></td>
        <td>${escapeHtml(item.studies)}</td>
        <td>${escapeHtml(item.diagnosticLevel)} · ${escapeHtml(item.diagnosticLevelRate)}%</td>
        <td>${escapeHtml(item.qualityPassed)} · ${escapeHtml(item.qualityPassRate)}%</td>
        <td>${escapeHtml(item.recognized)} 已互认 / ${escapeHtml(item.pendingRecognition)} 待复核</td>
      </tr>`).join("") || `<tr><td colspan="5">暂无机构统计。</td></tr>`}</tbody>
    </table>
    ${renderRecognitionCatalogActions(catalog)}`;
  }
}

function renderRecognitionCatalogActions(catalog = []) {
  if (window.HealthCityAuth?.getUser?.()?.role !== "commission") return "";
  return `<details class="production-operations">
    <summary>互认目录治理</summary>
    <div class="table-wrap"><table>
      <thead><tr><th>目录项</th><th>时效/质控</th><th>状态</th><th>操作</th></tr></thead>
      <tbody>${catalog.map((item) => {
        const nextStatus = item.status === "active" ? "suspended" : "active";
        return `<tr>
          <td><strong>${escapeHtml(item.modality)} · ${escapeHtml(item.bodyPart)}</strong><br><small>${escapeHtml(item.id)}</small></td>
          <td>${escapeHtml(item.validDays)} 天 · ${escapeHtml(item.qualityRule)}</td>
          <td><span class="badge ${item.status === "active" ? "ok" : "warn"}">${escapeHtml(item.status)}</span><br><small>${escapeHtml(item.policyVersion)}</small></td>
          <td><button class="inline-action" type="button" data-imaging-catalog-action="${escapeHtml(item.id)}" data-imaging-catalog-status="${nextStatus}">${nextStatus === "active" ? "启用" : "暂停"}</button></td>
        </tr>`;
      }).join("") || `<tr><td colspan="4">暂无互认目录项。</td></tr>`}</tbody>
    </table></div>
  </details>`;
}

function renderMobileViewer(study, payload) {
  const target = document.querySelector("#mobile-viewer");
  const title = document.querySelector("#phone-title");
  const subtitle = document.querySelector("#phone-subtitle");
  if (!target) return;
  if (!study) {
    target.innerHTML = `<p>暂无可调阅影像。</p>`;
    return;
  }
  title.textContent = `${study.modality} ${study.bodyPart}`;
  subtitle.textContent = `${study.institutionName} · ${study.studyDate}`;
  const share = (payload.shares || []).find((item) => item.studyId === study.id && item.status === "active" && new Date(item.expiresAt).getTime() > Date.now());
  target.innerHTML = `
    <div class="dicom-stage">
      <div>
        <strong>${escapeHtml(study.modality)} ${escapeHtml(study.bodyPart)}</strong>
        <span>${study.diagnosticLevel ? "诊断级原始序列" : "浏览级预览"}</span>
        <small>${escapeHtml(study.seriesCount)} 序列 · ${escapeHtml(study.imageCount)} 图像</small>
      </div>
    </div>
    <div class="viewer-toolbar" aria-label="影像工具">
      ${canOpenDiagnosticViewer(study) ? `<button class="inline-action primary" type="button" data-open-ohif="${escapeHtml(study.id)}">诊断级调阅</button>` : `<span>${study.diagnosticLevel ? "诊断级序列仅对授权医护人员开放" : "当前为浏览级预览，不开放诊断级原始序列"}</span>`}
    </div>
    <div class="series-strip">
      ${Array.from({ length: Math.max(1, Math.min(Number(study.seriesCount || 1), 4)) }, (_, index) => `<button type="button">S${index + 1}<br><small>${index === 0 ? "定位" : "序列"}</small></button>`).join("")}
    </div>
    <div class="viewer-meta">
      <div><strong>报告结论</strong><br>${escapeHtml(study.reportConclusion)}</div>
      <div><strong>安全调阅</strong><br>实名身份认证、授权访问、终端不保存原始 DICOM。</div>
      <div><strong>电子病历</strong><br>${escapeHtml(study.emrSyncStatus)}；主索引用于 EMR 调阅。</div>
    </div>
    <div class="share-box">
      <div><strong>分享状态</strong><br>${share ? `${escapeHtml(share.channel)} · ${escapeHtml(share.expiresAt)}` : "未生成有效分享，可按需创建二维码或短信链接。"}</div>
      ${share ? `<button class="inline-action" type="button" data-revoke-imaging-share="${escapeHtml(share.id)}" data-share-study-id="${escapeHtml(study.id)}">撤销分享</button>` : ""}
      <button class="inline-action" type="button" data-record-imaging-performance="${escapeHtml(study.id)}">记录本次浏览性能</button>
    </div>`;
}

async function submitImagingIngest(event) {
  event.preventDefault();
  const status = document.querySelector("#ingest-status");
  const form = event.currentTarget;
  const payload = Object.fromEntries(new FormData(form).entries());
  payload.imageCount = 128;
  payload.seriesCount = 3;
  payload.shareEnabled = true;
  if (!IMAGING_API_BASE) {
    status.textContent = "静态预览已模拟入云。";
    const study = {
      ...payload,
      id: `ics-static-${Date.now()}`,
      institutionName: payload.institutionCode === "MR1" ? "大连市中心医院" : "接入医院",
      mainIndex: `${payload.institutionCode}#DEMO#${payload.accessionNumber}`,
      studyDate: new Date().toISOString().slice(0, 10),
      uploadMode: "前置网关",
      uploadStatus: "已入云",
      integrityCheck: "passed",
      qcStatus: "待质控",
      emrSyncStatus: "已写入电子病历索引",
      diagnosticLevel: true,
      browserLevel: true
    };
    imagingState.payload.studies = [study, ...(imagingState.payload.studies || [])];
    imagingState.selectedStudyId = study.id;
    renderImagingCloud();
    return;
  }
  try {
    const request = window.HealthCityAuth?.authFetch || fetch;
    const response = await request(`${IMAGING_API_BASE}/imaging-cloud/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.message || "影像接入失败");
    status.textContent = "影像已入云，并同步电子病历索引。";
    imagingState.selectedStudyId = body.study?.id || imagingState.selectedStudyId;
    await loadImagingCloud();
    renderImagingCloud();
  } catch (error) {
    status.textContent = error.message;
  }
}

async function handleImagingAction(event) {
  const linkExternalButton = event.target.closest("[data-link-external-study]");
  const externalOhifButton = event.target.closest("[data-open-external-ohif]");
  const ohifButton = event.target.closest("[data-open-ohif]");
  const viewButton = event.target.closest("[data-view-study]");
  const shareButton = event.target.closest("[data-share-study]");
  const startRecognitionButton = event.target.closest("[data-start-recognition]");
  const decideRecognitionButton = event.target.closest("[data-decide-recognition]");
  const appealRecognitionButton = event.target.closest("[data-appeal-recognition]");
  const reviewAppealButton = event.target.closest("[data-review-recognition-appeal]");
  const performanceButton = event.target.closest("[data-record-imaging-performance]");
  const revokeShareButton = event.target.closest("[data-revoke-imaging-share]");
  const catalogActionButton = event.target.closest("[data-imaging-catalog-action]");
  const retryFhirWritebackButton = event.target.closest("[data-retry-fhir-writeback]");
  const startImagingTeleconsultationButton = event.target.closest("[data-start-imaging-teleconsultation]");
  if (linkExternalButton) {
    await linkExternalStudy(linkExternalButton.dataset.linkExternalStudy);
    return;
  }
  if (externalOhifButton) {
    window.open(externalOhifButton.dataset.openExternalOhif, "_blank", "noopener,noreferrer");
    return;
  }
  if (ohifButton) {
    await openOhifViewer(ohifButton.dataset.openOhif);
    return;
  }
  if (viewButton) {
    imagingState.selectedStudyId = viewButton.dataset.viewStudy;
    renderImagingCloud();
    document.querySelector(".phone-shell")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  if (shareButton) {
    await shareStudy(shareButton.dataset.shareStudy);
    return;
  }
  if (startRecognitionButton) {
    await startMutualRecognition(startRecognitionButton.dataset.startRecognition);
    return;
  }
  if (decideRecognitionButton) {
    await decideMutualRecognition(decideRecognitionButton.dataset.decideRecognition, decideRecognitionButton.dataset.recognitionDecision);
    return;
  }
  if (appealRecognitionButton) {
    await submitMutualRecognitionAppeal(appealRecognitionButton.dataset.appealRecognition);
    return;
  }
  if (reviewAppealButton) {
    await reviewMutualRecognitionAppeal(reviewAppealButton.dataset.reviewRecognitionAppeal, reviewAppealButton.dataset.appealDecision);
    return;
  }
  if (revokeShareButton) {
    await revokeImagingShare(revokeShareButton.dataset.shareStudyId, revokeShareButton.dataset.revokeImagingShare);
    return;
  }
  if (catalogActionButton) {
    await updateRecognitionCatalog(catalogActionButton.dataset.imagingCatalogAction, catalogActionButton.dataset.imagingCatalogStatus);
    return;
  }
  if (retryFhirWritebackButton) {
    await retryFhirWriteback(retryFhirWritebackButton.dataset.retryFhirWriteback);
    return;
  }
  if (startImagingTeleconsultationButton) {
    await startImagingTeleconsultation(startImagingTeleconsultationButton.dataset.startImagingTeleconsultation);
    return;
  }
  if (performanceButton) {
    await recordImagingPerformance(performanceButton.dataset.recordImagingPerformance);
  }
}

async function updateRecognitionCatalog(catalogId, status) {
  if (!IMAGING_API_BASE) { window.alert("静态预览不写入互认目录。\n"); return; }
  const policyVersion = (window.prompt("请输入政策或目录版本", "2026.07") || "").trim();
  const evidenceRef = (window.prompt("请输入已审定目录或政策证据引用") || "").trim();
  if (!policyVersion || !evidenceRef) return;
  const request = window.HealthCityAuth?.authFetch || fetch;
  const response = await request(`${IMAGING_API_BASE}/imaging-cloud/governance/catalog/${encodeURIComponent(catalogId)}/actions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status, policyVersion, evidenceRef })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) { window.alert(payload.message || "更新互认目录失败"); return; }
  await loadImagingCloud();
  renderImagingCloud();
}

async function revokeImagingShare(studyId, shareId) {
  if (!window.confirm("撤销后，该二维码或短信链接将立即失效。确认撤销？")) return;
  if (!IMAGING_API_BASE) {
    const share = (imagingState.payload.shares || []).find((item) => item.id === shareId && item.studyId === studyId);
    if (share) Object.assign(share, { status: "revoked", revokedAt: new Date().toISOString(), revokeReason: "静态预览撤销" });
    renderImagingCloud();
    return;
  }
  const request = window.HealthCityAuth?.authFetch || fetch;
  const response = await request(`${IMAGING_API_BASE}/imaging-cloud/studies/${encodeURIComponent(studyId)}/shares/${encodeURIComponent(shareId)}/revoke`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason: "用户在影像云移动端主动撤销" })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) { window.alert(payload.message || "撤销分享失败"); return; }
  await loadImagingCloud();
  renderImagingCloud();
}

async function retryFhirWriteback(studyId) {
  if (!window.confirm("将按现有主索引、FHIR引用和质控记录重试报告回写。确认继续？")) return;
  if (!IMAGING_API_BASE) { window.alert("静态预览不执行FHIR报告回写。\n"); return; }
  const request = window.HealthCityAuth?.authFetch || fetch;
  const response = await request(`${IMAGING_API_BASE}/imaging-cloud/studies/${encodeURIComponent(studyId)}/fhir-writeback/retry`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source: "imaging-workbench" })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) { window.alert(payload.message || "FHIR报告回写失败，已记录供运维处理。"); await loadImagingCloud(); renderImagingCloud(); return; }
  await loadImagingCloud();
  renderImagingCloud();
  window.alert("FHIR影像报告回写成功。");
}

async function startImagingTeleconsultation(studyId) {
  const targetInstitution = (window.prompt("请输入接诊机构", "大连市中心医院") || "").trim();
  const department = (window.prompt("请输入会诊科室", "放射科") || "").trim();
  const clinicalQuestion = (window.prompt("请输入会诊问题（不填写患者身份信息）", "请结合影像报告给予诊断与后续检查建议") || "").trim();
  if (!targetInstitution || !department || !clinicalQuestion) return;
  if (!IMAGING_API_BASE) { window.alert("静态预览不创建远程会诊工单。\n"); return; }
  const response = await (window.HealthCityAuth?.authFetch || fetch)(`${IMAGING_API_BASE}/imaging-cloud/studies/${encodeURIComponent(studyId)}/teleconsultations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ targetInstitution, department, clinicalQuestion, priority: "normal" })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) { window.alert(payload.message || "发起影像远程会诊失败"); return; }
  await loadImagingCloud();
  renderImagingCloud();
  window.alert("影像远程会诊工单已创建，等待接诊机构反馈与报告回传。");
}

async function recordImagingPerformance(studyId) {
  if (!IMAGING_API_BASE) { window.alert("静态预览不会上传性能采样。"); return; }
  const request = window.HealthCityAuth?.authFetch || fetch;
  const elapsed = Math.max(1, Math.round(performance.now()));
  const response = await request(`${IMAGING_API_BASE}/imaging-cloud/studies/${encodeURIComponent(studyId)}/performance`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ firstFrameMs: elapsed, seriesLoadMs: elapsed, interactionMs: 120, viewportClass: "mobile", networkClass: "unknown" })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) { window.alert(payload.message || "性能采样记录失败"); return; }
  await loadImagingCloud();
  renderImagingCloud();
}

async function linkExternalStudy(studyInstanceUID) {
  if (!imagingState.selectedResidentId) { window.alert("请先在运行总览中选择要关联的演示居民。"); return; }
  const request = window.HealthCityAuth?.authFetch || fetch;
  const response = await request(`${IMAGING_API_BASE}/imaging-cloud/solution-a/studies/${encodeURIComponent(studyInstanceUID)}/link`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ residentId: imagingState.selectedResidentId, approvalEvidence: "synthetic-test-data" })
  });
  const payload = await response.json();
  if (!response.ok) { window.alert(payload.message || "外部影像关联失败"); return; }
  await Promise.all([loadImagingCloud(), loadSolutionAStudies()]);
  renderImagingCloud();
  window.alert(payload.created ? "合成检查已关联到当前居民。" : "关联信息已更新。");
}

async function loadSolutionAHealth() {
  const target = document.querySelector("#solution-a-health");
  if (!target || !IMAGING_API_BASE) return;
  target.setAttribute("aria-busy", "true");
  try {
    const request = window.HealthCityAuth?.authFetch || fetch;
    const response = await request(`${IMAGING_API_BASE}/imaging-cloud/solution-a/health`);
    const payload = await response.json();
    target.innerHTML = (payload.services || []).map((item) => `<article class="metric-card">
      <span>${escapeHtml(item.name)}</span><strong>${item.ok ? "在线" : "异常"}</strong>
      <small>HTTP ${escapeHtml(item.status)} · ${escapeHtml(item.latencyMs)} ms</small>
    </article>`).join("") || `<article class="metric-card"><span>方案A</span><strong>不可用</strong><small>${escapeHtml(payload.message || "健康探测失败")}</small></article>`;
  } catch (error) {
    target.innerHTML = `<article class="metric-card"><span>方案A</span><strong>不可用</strong><small>${escapeHtml(error.message)}</small></article>`;
  } finally { target.removeAttribute("aria-busy"); }
}

async function openOhifViewer(studyId) {
  if (!IMAGING_API_BASE) return;
  const request = window.HealthCityAuth?.authFetch || fetch;
  const response = await request(`${IMAGING_API_BASE}/imaging-cloud/studies/${encodeURIComponent(studyId)}/viewer`);
  const payload = await response.json();
  if (!response.ok) { window.alert(payload.message || "OHIF调阅失败"); return; }
  window.open(payload.viewerUrl, "_blank", "noopener,noreferrer");
}

async function loadSolutionAStudies() {
  const target = document.querySelector("#solution-a-studies");
  if (!target || !IMAGING_API_BASE) return;
  target.setAttribute("aria-busy", "true");
  try {
    const request = window.HealthCityAuth?.authFetch || fetch;
    const response = await request(`${IMAGING_API_BASE}/imaging-cloud/solution-a/studies`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.message || "DICOMweb检查清单读取失败");
    target.innerHTML = `<table><thead><tr><th>患者边界</th><th>检查</th><th>模态</th><th>StudyInstanceUID</th><th>操作</th></tr></thead><tbody>${(payload.studies || []).map((item) => `<tr>
      <td><strong>${escapeHtml(item.patientName)}</strong><br><small>${escapeHtml(item.patientId)} · ${item.synthetic ? "合成数据" : "身份已脱敏"}</small></td>
      <td>${escapeHtml(item.studyDescription || "未命名检查")}<br><small>${escapeHtml(item.studyDate || "日期未提供")}</small></td>
      <td>${escapeHtml(item.modalities || "OT")}</td>
      <td><small>${escapeHtml(item.studyInstanceUID)}</small></td>
      <td><button class="inline-action primary" type="button" data-open-external-ohif="${escapeHtml(item.viewerUrl)}">OHIF调阅</button>
      <button class="inline-action" type="button" data-link-external-study="${escapeHtml(item.studyInstanceUID)}">关联当前居民</button></td>
    </tr>`).join("") || `<tr><td colspan="5">Orthanc中暂无检查。</td></tr>`}</tbody></table><p class="hint">${escapeHtml(payload.boundary || "")}</p>`;
  } catch (error) {
    target.innerHTML = `<p class="error">${escapeHtml(error.message)}</p>`;
  } finally { target.removeAttribute("aria-busy"); }
}

async function shareStudy(studyId) {
  if (!IMAGING_API_BASE) {
    const study = (imagingState.payload.studies || []).find((item) => item.id === studyId);
    imagingState.payload.shares = [{
      id: `share-static-${Date.now()}`,
      studyId,
      residentId: study?.residentId || "",
      token: "IMG-STATIC",
      channel: "二维码/短信链接",
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      status: "active"
    }, ...(imagingState.payload.shares || [])];
    renderImagingCloud();
    return;
  }
  const request = window.HealthCityAuth?.authFetch || fetch;
  const response = await request(`${IMAGING_API_BASE}/imaging-cloud/studies/${encodeURIComponent(studyId)}/share`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ validDays: 7, channel: "二维码/短信链接" })
  });
  if (response.ok) {
    await loadImagingCloud();
    renderImagingCloud();
  }
}

async function startMutualRecognition(studyId) {
  if (!IMAGING_API_BASE) {
    const study = (imagingState.payload.studies || []).find((item) => item.id === studyId);
    if (!study) return;
    const record = { id: `cmr-static-${studyId}`, imageCloudStudyId: studyId, residentId: study.residentId, item: `${study.bodyPart}${study.modality}`, mainIndex: study.mainIndex, sourceInstitution: study.institutionName, targetInstitution: "区域医学影像资源共享中心", status: "pending_review", reviewStatus: "pending", qualityStatus: study.qcStatus, reason: "影像云报告已回传，待目标机构确认。" };
    study.mutualRecognitionStatus = "待中心确认";
    study.mutualRecognitionRecordId = record.id;
    imagingState.payload.mutualRecognition = [record, ...(imagingState.payload.mutualRecognition || [])];
    renderImagingCloud();
    return;
  }
  const response = await (window.HealthCityAuth?.authFetch || fetch)(`${IMAGING_API_BASE}/imaging-cloud/studies/${encodeURIComponent(studyId)}/mutual-recognition`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ targetInstitution: "区域医学影像资源共享中心", priority: "中" })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) { window.alert(payload.message || "发起跨机构互认失败"); return; }
  await loadImagingCloud();
  renderImagingCloud();
}

async function decideMutualRecognition(studyId, decision = "recognize") {
  const approved = decision === "recognize";
  if (!IMAGING_API_BASE || !window.confirm(approved ? "确认该影像检查满足互认条件？" : "确认不予互认并登记原因？")) return;
  const reasonCode = approved ? "qc-passed" : (window.prompt("请输入不予互认原因编码", "quality-not-qualified") || "").trim();
  if (!reasonCode) return;
  const response = await (window.HealthCityAuth?.authFetch || fetch)(`${IMAGING_API_BASE}/imaging-cloud/studies/${encodeURIComponent(studyId)}/mutual-recognition/decision`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ decision, reasonCode, comment: approved ? "影像云检查、报告和主索引复核通过。" : "未满足当前互认质量规则。" })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) { window.alert(payload.message || "互认判定失败"); return; }
  await loadImagingCloud();
  renderImagingCloud();
}

async function submitMutualRecognitionAppeal(studyId) {
  if (!IMAGING_API_BASE) return;
  const reason = (window.prompt("请输入申诉理由（不填写患者身份信息）", "补充质控证据后申请复核") || "").trim();
  if (!reason) return;
  const evidenceRefs = (window.prompt("请输入证据引用，多个引用用逗号分隔", "IMG-QC-EVIDENCE-001") || "").split(",").map((item) => item.trim()).filter(Boolean);
  if (!evidenceRefs.length) return;
  const response = await (window.HealthCityAuth?.authFetch || fetch)(`${IMAGING_API_BASE}/imaging-cloud/studies/${encodeURIComponent(studyId)}/mutual-recognition/appeal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason, evidenceRefs, noPatientPii: true })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) { window.alert(payload.message || "提交申诉失败"); return; }
  await loadImagingCloud();
  renderImagingCloud();
}

async function reviewMutualRecognitionAppeal(studyId, decision) {
  if (!IMAGING_API_BASE || !window.confirm(decision === "approve" ? "确认通过申诉并恢复互认？" : "确认驳回申诉？")) return;
  const comment = (window.prompt("请输入独立复核意见", decision === "approve" ? "补充证据有效，复核通过" : "补充证据仍不满足互认规则") || "").trim();
  if (!comment) return;
  const response = await (window.HealthCityAuth?.authFetch || fetch)(`${IMAGING_API_BASE}/imaging-cloud/studies/${encodeURIComponent(studyId)}/mutual-recognition/appeal/review`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ decision, reasonCode: decision === "approve" ? "appeal-approved" : "appeal-rejected", comment })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) { window.alert(payload.message || "复核申诉失败"); return; }
  await loadImagingCloud();
  renderImagingCloud();
}

function buildFallbackImagingCloud() {
  if (imagingState.fallbackData) return imagingState.fallbackData;
  imagingState.fallbackData = {
    summary: { studies: 2, institutions: 2, diagnosticLevel: 1, browserLevel: 2, qcPassed: 1, emrSynced: 1, activeShares: 1 },
    gateways: [
      { institutionCode: "MR1", institutionName: "大连市中心医院", mode: "前置网关", status: "online", lastHeartbeat: "2026-07-07 09:20", dicomProtocols: ["C-STORE", "C-MOVE", "DICOM TLS"], encryption: "DICOM TLS + HTTPS + AES", compression: "诊断级 DICOM 无损压缩" },
      { institutionCode: "MR3", institutionName: "青泥洼桥社区卫生服务中心", mode: "无前置采集软件", status: "warning", lastHeartbeat: "2026-07-07 08:55", dicomProtocols: ["C-STORE"], encryption: "HTTPS + AES", compression: "浏览级压缩预览" }
    ],
    studies: [
      { id: "ics-ct-r1-20260521", residentId: "r1", institutionCode: "MR1", institutionName: "大连市中心医院", accessionNumber: "CT-DEMO-20260521", studyInstanceUID: "1.2.156.112605.140380.20260521.1", mainIndex: "MR1#DEMO-ID-R1#CT-DEMO-20260521", modality: "CT", bodyPart: "胸部", studyDate: "2026-05-21", reportConclusion: "双肺纹理增多，未见明确急性实变影。", seriesCount: 4, imageCount: 286, diagnosticLevel: true, browserLevel: true, uploadMode: "前置网关", uploadStatus: "已入云", integrityCheck: "passed", qcStatus: "质控通过", emrSyncStatus: "已写入电子病历索引" },
      { id: "ics-dr-r2-20260603", residentId: "r2", institutionCode: "MR3", institutionName: "青泥洼桥社区卫生服务中心", accessionNumber: "DR-DEMO-20260603", studyInstanceUID: "1.2.156.112605.140380.20260603.2", mainIndex: "MR3#DEMO-ID-R2#DR-DEMO-20260603", modality: "DR", bodyPart: "胸片", studyDate: "2026-06-03", reportConclusion: "基层初筛影像已上传，等待影像中心复核。", seriesCount: 1, imageCount: 2, diagnosticLevel: false, browserLevel: true, uploadMode: "无前置采集软件", uploadStatus: "已入云", integrityCheck: "pending", qcStatus: "待质控", emrSyncStatus: "待报告审核后写入" }
    ],
    shares: [{ studyId: "ics-ct-r1-20260521", channel: "二维码/短信链接", expiresAt: "2026-07-31T23:59:59.000Z", status: "active" }],
    qualityReviews: [],
    implementedFeatures: fallbackImplementedFeatures(),
    developmentPlan: fallbackDevelopmentPlan(),
    productionCenter: fallbackProductionCenter(),
    emrCompatibility: {
      mainIndexRule: "医疗机构编码 + 身份证号 + 检查号",
      sourceSystems: ["PACS", "RIS", "EMR"],
      exchange: ["DICOM C-STORE/C-MOVE", "DICOM TLS", "REST/IHE", "HTTPS + AES"],
      mappedCollections: ["imageCloudStudies", "diagnosticReports", "personalRecords"],
      status: "ready"
    }
  };
  return imagingState.fallbackData;
}

function fallbackProductionCenter() {
  return {
    functionalState: "ready-for-synthetic-acceptance",
    formalGoLiveState: "blocked-until-site-evidence-signed",
    productionReady: false,
    summary: { syntheticChecksPassed: 0, syntheticChecks: 10, endpointsReady: 0, endpoints: 5, requirementsSigned: 0, requirements: 7, siteReceiptsVerified: 0, siteReceipts: 5, drillsPassed: 0, drills: 4, approvalsSigned: 0, approvals: 2 },
    requirements: [
      { id: "IMG-SITE-01", title: "试点医院PACS/RIS/DICOM TLS全链路联调", owner: "试点医院信息科/放射科", endpointIds: ["imaging-pacs-ris", "imaging-orthanc"], status: "site-pending" },
      { id: "IMG-SITE-02", title: "FHIR资源引用与EMR报告回写验收", owner: "平台互联互通组/医院病案部门", endpointIds: ["imaging-fhir"], status: "site-pending" },
      { id: "IMG-SITE-03", title: "居民主索引、机构人员和授权范围核验", owner: "市卫生健康信息中心", endpointIds: ["imaging-mpi-audit"], status: "site-pending" },
      { id: "IMG-SITE-04", title: "OHIF实名授权调阅、越权拒绝和访问留痕", owner: "影像产品与安全组", endpointIds: ["imaging-ohif", "imaging-mpi-audit"], status: "site-pending" },
      { id: "IMG-SITE-05", title: "省内本地存储、等保三级、密码和隐私评估", owner: "网信与安全责任部门", endpointIds: [], status: "site-pending" },
      { id: "IMG-SITE-06", title: "性能容量、备份恢复和灾备切换验收", owner: "平台运维组", endpointIds: ["imaging-fhir", "imaging-orthanc", "imaging-ohif"], status: "site-pending" },
      { id: "IMG-SITE-07", title: "业务、技术和管理多方现场验收", owner: "项目办", endpointIds: [], status: "site-pending" }
    ],
    siteReceipts: [
      { type: "pacs-ris-dicom-tls", title: "PACS/RIS 与 DICOM TLS 联调回执", requirementIds: ["IMG-SITE-01"], status: "site-pending" },
      { type: "fhir-report-writeback", title: "FHIR DiagnosticReport/EMR 回写回执", requirementIds: ["IMG-SITE-02"], status: "site-pending" },
      { type: "object-storage-authorization-audit", title: "对象存储、授权与访问审计边界回执", requirementIds: ["IMG-SITE-04", "IMG-SITE-05"], status: "site-pending" },
      { type: "mutual-recognition-appeal", title: "检查互认申诉与独立复核回执", requirementIds: ["IMG-SITE-07"], status: "site-pending" },
      { type: "failure-degradation-rollback", title: "故障降级、回退与独立冒烟回执", requirementIds: ["IMG-SITE-06"], status: "site-pending" }
    ]
  };
}

function fallbackImplementedFeatures() {
  return [
    { id: "imaging-feature-hospital-ingest", name: "医院影像数据接入", status: "已实现", evidence: "POST /api/imaging-cloud/ingest", detail: "影像检查入云后生成检查、报告和居民健康信息库索引。" },
    { id: "imaging-feature-mobile-viewer", name: "患者手机查看", status: "已实现", evidence: "imaging-cloud.html #mobile-viewer", detail: "展示影像序列、报告结论、授权分享和移动端安全提示。" },
    { id: "imaging-feature-emr-index", name: "电子病历兼容索引", status: "已实现", evidence: "diagnosticReports + personalRecords", detail: "通过主索引兼容 EMR 授权调阅。" },
    { id: "imaging-feature-share-qc", name: "授权分享与质控回写", status: "已实现", evidence: "share/qc APIs", detail: "支持限时分享和质控结论回写。" }
  ];
}

function fallbackDevelopmentPlan() {
  return [
    { id: "imaging-plan-p0-joint-test", priority: "P0", phase: "试点医院联调", owner: "institution-integration", target: "形成首批医院 PACS/RIS/EMR 联调闭环。", nextAction: "补齐真实联调单号、DICOM TLS 证书和回传原院 PACS 验收记录。", acceptance: "完成入云、报告回写、居民调阅、EMR 调阅和越权拒绝测试。", status: "开发中", evidence: ["GET /api/imaging-cloud", "test/api.test.js"] },
    { id: "imaging-plan-p0-security", priority: "P0", phase: "安全与合规加固", owner: "security-admin", target: "把省内本地存储、等保三级和访问留痕转为验收清单。", nextAction: "增加生产证书、密钥轮换、日志留存和审计抽查证据入口。", acceptance: "所有调阅、分享、质控和回传操作可追踪。", status: "待开发", evidence: ["dataAccessLogs", "securityEvents"] },
    { id: "imaging-plan-p1-viewer-performance", priority: "P1", phase: "诊断级浏览能力", owner: "imaging-product", target: "完善二维、三维、窗宽窗位和移动网络流畅性。", nextAction: "接入真实 DICOM 浏览器或 DICOMweb/WADO-RS 代理。", acceptance: "移动端浏览不卡顿，医生端按权限调阅诊断级序列。", status: "待开发", evidence: ["mobile-viewer"] }
  ];
}

function getFallbackResidents() {
  return [
    { id: "r1", name: "演示居民A" },
    { id: "r2", name: "演示居民B" },
    { id: "r4", name: "演示居民D" }
  ];
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  }[char]));
}
