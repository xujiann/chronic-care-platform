const imagingState = {
  payload: null,
  fallbackData: null,
  selectedResidentId: "",
  selectedInstitutionCode: "",
  selectedStudyId: ""
};

const IMAGING_API_BASE = location.protocol === "file:" ? "" : `${location.origin}/api`;

document.addEventListener("DOMContentLoaded", async () => {
  await Promise.all([loadImagingCloud(), loadSolutionAHealth(), loadSolutionAStudies()]);
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
    await loadImagingCloud();
    renderImagingCloud();
  });
  document.querySelector("#reload-solution-a")?.addEventListener("click", loadSolutionAHealth);
  document.querySelector("#reload-solution-a-studies")?.addEventListener("click", loadSolutionAStudies);
  document.querySelector("#ingest-form")?.addEventListener("submit", submitImagingIngest);
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
  renderStudyTable(studies);
  renderMutualRecognition(payload.mutualRecognition || []);
  renderDevelopmentPlan(payload);
  renderGateways(payload);
  renderMobileViewer(studies.find((item) => item.id === imagingState.selectedStudyId) || studies[0], payload);
}

function renderFilters(payload) {
  const residents = getFallbackResidents();
  const residentSelect = document.querySelector("#resident-filter");
  const ingestResidentSelect = document.querySelector("#ingest-form select[name='residentId']");
  const residentOptions = [`<option value="">全部可授权居民</option>`].concat(residents.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)} · ${escapeHtml(item.id)}</option>`)).join("");
  if (residentSelect) {
    residentSelect.innerHTML = residentOptions;
    residentSelect.value = imagingState.selectedResidentId;
  }
  if (ingestResidentSelect) {
    ingestResidentSelect.innerHTML = residents.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)} · ${escapeHtml(item.id)}</option>`).join("");
  }
  const institutions = [...new Map([...(payload.gateways || []).map((item) => [item.institutionCode, item.institutionName]), ...(payload.studies || []).map((item) => [item.institutionCode, item.institutionName])]).entries()];
  const institutionSelect = document.querySelector("#institution-filter");
  if (institutionSelect) {
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
      <td><span class="badge ${/通过|已写入|passed/i.test(`${item.qcStatus} ${item.emrSyncStatus}`) ? "ok" : "warn"}">${escapeHtml(item.qcStatus)}</span><br><small>${escapeHtml(item.emrSyncStatus)}</small></td>
      <td><span class="badge ${/已互认|recognized/i.test(item.mutualRecognitionStatus || "") ? "ok" : /不予|拒绝/i.test(item.mutualRecognitionStatus || "") ? "warn" : "info"}">${escapeHtml(item.mutualRecognitionStatus || "未发起")}</span><br><small>${escapeHtml(item.mutualRecognitionReason || "可发起区域互认")}</small></td>
      <td>
        <button class="inline-action" type="button" data-view-study="${escapeHtml(item.id)}">手机查看</button>
        <button class="inline-action primary" type="button" data-open-ohif="${escapeHtml(item.id)}">OHIF调阅</button>
        <button class="inline-action" type="button" data-share-study="${escapeHtml(item.id)}">分享</button>
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
  const share = (payload.shares || []).find((item) => item.studyId === study.id && item.status === "active");
  target.innerHTML = `
    <div class="dicom-stage">
      <div>
        <strong>${escapeHtml(study.modality)} ${escapeHtml(study.bodyPart)}</strong>
        <span>${study.diagnosticLevel ? "诊断级原始序列" : "浏览级预览"}</span>
        <small>${escapeHtml(study.seriesCount)} 序列 · ${escapeHtml(study.imageCount)} 图像</small>
      </div>
    </div>
    <div class="viewer-toolbar" aria-label="影像工具">
      <button class="inline-action" type="button">窗宽窗位</button>
      <button class="inline-action" type="button">缩放</button>
      <button class="inline-action" type="button">三维</button>
      <button class="inline-action" type="button">报告</button>
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
  }
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
