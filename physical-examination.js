const PHYSICAL_EXAM_API = location.protocol === "file:" ? "" : `${location.origin}/api`;
const physicalExamState = { overview: null, residentId: "", year: "", user: null };
const PHYSICAL_EXAM_OFFICIAL_SOURCE_ORIGINS = Object.freeze([
  "https://flk.npc.gov.cn",
  "https://std.samr.gov.cn",
  "https://www.cac.gov.cn",
  "https://www.gov.cn",
  "https://www.nhc.gov.cn",
  "https://www.npc.gov.cn"
]);
const PHYSICAL_EXAM_TRANSLATION_STATUS_CLASSES = new Set(["within-report-range", "abnormal", "high-risk"]);
const PHYSICAL_EXAM_QUALITY_STATUS_CLASSES = new Set(["blocked", "review", "passed"]);
const PHYSICAL_EXAM_ISSUE_LEVEL_CLASSES = new Set(["blocking", "review", "passed"]);

function createPhysicalExamElement(tagName, options = {}, children = []) {
  const node = document.createElement(tagName);
  if (options.className) node.className = options.className;
  if (Object.hasOwn(options, "text")) node.textContent = String(options.text ?? "");
  if (Object.hasOwn(options, "value")) node.value = String(options.value ?? "");
  if (options.dataset) {
    Object.entries(options.dataset).forEach(([key, value]) => {
      node.dataset[key] = String(value ?? "");
    });
  }
  if (options.attributes) {
    Object.entries(options.attributes).forEach(([name, value]) => {
      node.setAttribute(name, String(value ?? ""));
    });
  }
  (Array.isArray(children) ? children : [children]).flat(Infinity).forEach((child) => {
    if (child == null) return;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  });
  return node;
}

function replacePhysicalExamChildren(target, children, emptyNode) {
  const nodes = (Array.isArray(children) ? children : [children]).flat(Infinity).filter(Boolean);
  target.replaceChildren(...(nodes.length ? nodes : [emptyNode]));
}

function physicalExamMetricCard([label, value, hint], className = "metric-card") {
  return createPhysicalExamElement("article", { className }, [
    createPhysicalExamElement("span", { text: label }),
    createPhysicalExamElement("strong", { text: value }),
    createPhysicalExamElement("small", { text: hint })
  ]);
}

function physicalExamEmpty(text, tagName = "p", className = "muted") {
  return createPhysicalExamElement(tagName, { className, text });
}

function physicalExamButton(text, dataset = {}, className = "") {
  return createPhysicalExamElement("button", { className, text, dataset, attributes: { type: "button" } });
}

function physicalExamInput(dataset, placeholder, options = {}) {
  const attributes = { placeholder };
  if (options.maxLength) attributes.maxlength = options.maxLength;
  return createPhysicalExamElement("input", { dataset, value: options.value, attributes });
}

function physicalExamClassName(baseClass, candidate, allowedClasses) {
  const value = String(candidate ?? "");
  return allowedClasses.has(value) ? `${baseClass} ${value}` : baseClass;
}

document.addEventListener("DOMContentLoaded", async () => {
  const user = window.HealthCityAuth?.getUser?.();
  physicalExamState.user = user;
  if (user?.role === "citizen") {
    document.querySelector("#physical-exam-import-panel")?.remove();
    document.querySelectorAll(".operations-panel").forEach((item) => item.remove());
  }
  bindPhysicalExamControls();
  seedImportDefaults();
  await loadPhysicalExams();
  renderPhysicalExamSystem();
});

async function loadPhysicalExams() {
  const params = new URLSearchParams();
  if (physicalExamState.residentId) params.set("residentId", physicalExamState.residentId);
  if (PHYSICAL_EXAM_API) {
    try {
      const request = window.HealthCityAuth?.authFetch || fetch;
      const response = await request(`${PHYSICAL_EXAM_API}/physical-exams${params.toString() ? `?${params}` : ""}`);
      if (response.ok) {
        physicalExamState.overview = await response.json();
        return;
      }
    } catch (error) {
      // Static/demo fallback remains available.
    }
  }
  physicalExamState.overview = buildFallbackOverview();
}

function buildFallbackOverview() {
  const service = window.PhysicalExaminationService;
  const residents = [
    { id: "r1", name: "演示居民A" },
    { id: "r2", name: "演示居民B" },
    { id: "r3", name: "演示居民C" }
  ];
  const fallback = { residents, personalRecords: service.seedRecords(), chronicScreeningTasks: [], taskMessages: [], phase2FamilyDoctorContracts: [] };
  service.synchronizeCareLinks(fallback, { notify: false, actor: "static-preview" });
  return service.buildOverview(fallback, { residentId: physicalExamState.residentId });
}

function renderPhysicalExamSystem() {
  const overview = physicalExamState.overview || buildFallbackOverview();
  renderPhysicalExamSummary(overview.summary || {});
  renderPhysicalExamHighlights(overview.highlights || {});
  renderSourceContracts(overview.sourceContracts || []);
  renderSpecializedIntakes(overview.specializedIntakes || [], overview.examPrograms || []);
  renderStandards(overview.standards || window.PhysicalExaminationStandards?.STANDARD_CATALOG || []);
  renderQualityIndicators(overview.qualityIndicators || []);
  renderPhysicalExamFilters(overview);
  renderPhysicalExamReports(overview.reports || []);
  renderProductionReadiness(overview.readiness);
  renderAbnormalCases(overview.abnormalCases || []);
  renderJointTests(overview.jointTests || []);
  renderGatewayEvents(overview.gatewayEvents || []);
  populateImportResidents(overview.residents || []);
}

function renderPhysicalExamSummary(summary) {
  const cards = [
    ["历史报告", summary.reports || 0, "全部年份统一归档"],
    ["覆盖居民", summary.residents || 0, "按居民主索引合并"],
    ["接入机构", summary.institutions || 0, "体检中心与医院"],
    ["异常报告", summary.abnormalReports || 0, "保留异常项和建议"],
    ["历史跨度", summary.years || 0, "可按年度连续查看"],
    ["档案同步", summary.synced || 0, "已写入健康档案"],
    ["电子签章", `${summary.signedReports || 0}/${summary.reports || 0}`, "报告签章核验"],
    ["字典映射", `${summary.mappingRate ?? 100}%`, "标准项目编码"],
    ["国标数据元", `${summary.nationalMappingRate ?? 0}%`, "WS/T 363-2023"],
    ["规范合规", `${summary.standardCompliantReports || 0}/${summary.reports || 0}`, "逐报告生产门禁"],
    ["慢病分层", `${summary.careLinkedReports || 0}/${summary.abnormalReports || 0}`, "体检异常自动入层"],
    ["家医建议", summary.familyDoctorSuggestions || 0, "不替代居民签约同意"],
    ["居民待办", summary.residentRiskTasks || 0, "复测、复诊与确认"],
    ["待闭环", summary.openAbnormalCases || 0, "异常随访任务"],
    ["死信事件", summary.deadLetters || 0, "需补偿的接入事件"]
  ];
  document.querySelector("#physical-exam-summary").replaceChildren(...cards.map((card) => physicalExamMetricCard(card)));
}

function renderPhysicalExamHighlights(highlights) {
  const summary = highlights.summary || {};
  const summaryTarget = document.querySelector("#physical-exam-highlight-summary");
  if (summaryTarget) {
    const cards = [
      ["健康轨迹", summary.trajectories || 0, "跨年度可计算指标"],
      ["居民解释", summary.translatedFindings || 0, "专业报告分层翻译"],
      ["行动卡", summary.openActions || 0, "异常到复查/家医"],
      ["重复候选", summary.repeatCandidates || 0, "医师判断能否互认"],
      ["放射记录", summary.radiationRecords || 0, "正当化与剂量台账"],
      ["质量问题", summary.qualityIssues || 0, "报告啄木鸟发现"],
      ["健康护照", summary.activePassports || 0, "居民授权的数据范围"]
    ];
    summaryTarget.replaceChildren(...cards.map((card) => physicalExamMetricCard(card, "")));
  }
  renderHighlightTrajectories(highlights.trajectories || []);
  renderHighlightTranslations(highlights.translations || []);
  renderHighlightPlans(highlights.examPlans || []);
  renderRepeatRadiation(highlights.repeatAvoidance || [], highlights.radiationLedger || []);
  renderQualityReviews(highlights.qualityReviews || []);
  renderInstitutionBenchmarks(highlights.institutionBenchmarks || []);
  renderCityRadar(highlights.cityRadar || []);
  renderStandardsImpact(highlights.standardsImpact || []);
  renderCriticalPaths(highlights.criticalPaths || []);
}

function renderHighlightTrajectories(rows) {
  const target = document.querySelector("#physical-exam-trajectories");
  if (!target) return;
  const cards = rows.slice(0, 12).map((item) => {
    const values = (item.points || []).map((point) => Number(point.value)).filter(Number.isFinite);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = Math.max(1, max - min);
    const bars = (item.points || []).map((point) => {
      const numericValue = Number(point.value);
      const heightLevel = Number.isFinite(numericValue) && Number.isFinite(min)
        ? Math.max(0, Math.min(6, Math.round(((numericValue - min) / range) * 6)))
        : 0;
      return createPhysicalExamElement("span", {
        className: `${point.abnormal ? "warn" : "ok"} height-${heightLevel}`,
        attributes: { title: `${String(point.date ?? "")} ${String(point.value ?? "")}${String(point.unit || "")}` }
      });
    });
    return createPhysicalExamElement("article", { className: "trajectory-card" }, [
      createPhysicalExamElement("div", {}, [
        createPhysicalExamElement("strong", { text: item.name }),
        createPhysicalExamElement("small", { text: `${item.latest ? `${String(item.latest.value ?? "")}${String(item.latest.unit || "")}` : "-"} · ${String(item.evidenceLevel ?? "")}` })
      ]),
      createPhysicalExamElement("div", { className: "mini-bars" }, bars),
      createPhysicalExamElement("em", { text: item.delta === null ? "建立基线" : `较上次 ${item.delta > 0 ? "+" : ""}${String(item.delta ?? "")}` })
    ]);
  });
  replacePhysicalExamChildren(target, cards, physicalExamEmpty("接入至少一份含结构化数值的报告后生成健康时间轴。"));
}

function renderHighlightTranslations(rows) {
  const target = document.querySelector("#physical-exam-translations");
  if (!target) return;
  const prioritized = [...rows].sort((a, b) => Number(b.status !== "within-report-range") - Number(a.status !== "within-report-range"));
  const cards = prioritized.slice(0, 8).map((item) => createPhysicalExamElement("article", {
    className: physicalExamClassName("translation-card", item.status, PHYSICAL_EXAM_TRANSLATION_STATUS_CLASSES)
  }, [
    createPhysicalExamElement("header", {}, [
      createPhysicalExamElement("strong", { text: item.title }),
      createPhysicalExamElement("span", { text: item.value })
    ]),
    createPhysicalExamElement("p", { text: item.plainMeaning }),
    createPhysicalExamElement("small", { text: `下一步：${String(item.nextStep ?? "")} · ${String(item.department ?? "")}` }),
    createPhysicalExamElement("em", { text: item.boundary })
  ]));
  target.replaceChildren(...(cards.length ? cards : [createPhysicalExamElement("p", { className: "muted", text: "暂无可翻译的结构化项目。" })]));
}

function renderHighlightPlans(rows) {
  const target = document.querySelector("#physical-exam-plans");
  if (!target) return;
  const cards = rows.map((item) => createPhysicalExamElement("article", { className: "plan-card" }, [
    createPhysicalExamElement("header", {}, [
      createPhysicalExamElement("strong", { text: item.nextExamDate || "下次日期待医师确认" }),
      createPhysicalExamElement("span", { text: "医师待审核" })
    ]),
    createPhysicalExamElement("p", { text: item.reason }),
    createPhysicalExamElement("div", { className: "tag-row" }, (item.personalizedItems || []).length
      ? item.personalizedItems.map((value) => createPhysicalExamElement("span", { text: value }))
      : [createPhysicalExamElement("span", { text: "保持基础体检项目" })]),
    (item.reduceOrReview || []).map((value) => createPhysicalExamElement("small", { text: value })),
    createPhysicalExamElement("em", { text: item.ruleVersion })
  ]));
  replacePhysicalExamChildren(target, cards, physicalExamEmpty("暂无居民体检计划。"));
}

function renderRepeatRadiation(repeats, radiation) {
  const target = document.querySelector("#physical-exam-repeat-radiation");
  if (!target) return;
  const repeatCards = repeats.length ? repeats.map((item) => createPhysicalExamElement("article", {}, [
    createPhysicalExamElement("strong", { text: `重复检查候选 · ${String(item.name || item.code || "")}` }),
    createPhysicalExamElement("p", { text: `${String(item.previousDate ?? "")} 至 ${String(item.date ?? "")}，间隔 ${String(item.intervalDays ?? "")} 天` }),
    createPhysicalExamElement("small", { text: item.recommendation })
  ])) : [createPhysicalExamElement("article", { className: "ok-card" }, [
    createPhysicalExamElement("strong", { text: "未发现30天内重复项目" }),
    createPhysicalExamElement("p", { text: "继续在接入新报告时自动检查。" })
  ])];
  const radiationCards = radiation.length ? radiation.map((item) => createPhysicalExamElement("article", {}, [
    createPhysicalExamElement("strong", { text: `${String(item.modality ?? "")} · ${String(item.date ?? "")}` }),
    createPhysicalExamElement("p", { text: `${String(item.purpose || "检查目的待补")} · ${String(item.dose ?? "-")}${String(item.doseUnit || "")}` }),
    createPhysicalExamElement("small", { text: item.governanceStatus === "complete" ? "正当化、告知、防护与剂量记录完整" : "放射治理记录待复核" })
  ])) : [createPhysicalExamElement("article", { className: "ok-card" }, [
    createPhysicalExamElement("strong", { text: "暂无放射剂量记录" }),
    createPhysicalExamElement("p", { text: "不是“零辐射”结论，仅表示当前接入数据无记录。" })
  ])];
  target.replaceChildren(...repeatCards, ...radiationCards);
}

function renderQualityReviews(rows) {
  const target = document.querySelector("#physical-exam-quality-reviews");
  if (!target) return;
  const cards = rows.map((item) => {
    const issues = (item.issues || []).slice(0, 5).map((issue) => createPhysicalExamElement("span", {
      className: physicalExamClassName("issue", issue.level, PHYSICAL_EXAM_ISSUE_LEVEL_CLASSES),
      text: issue.message
    }));
    return createPhysicalExamElement("article", {
      className: physicalExamClassName("quality-review-card", item.status, PHYSICAL_EXAM_QUALITY_STATUS_CLASSES)
    }, [
      createPhysicalExamElement("header", {}, [
        createPhysicalExamElement("strong", { text: item.institution }),
        createPhysicalExamElement("span", { text: `${String(item.score ?? "")}分` })
      ]),
      createPhysicalExamElement("p", { text: `${String(item.reportId ?? "")} · ${String(item.date ?? "")}` }),
      createPhysicalExamElement("div", {}, issues.length ? issues : [createPhysicalExamElement("span", { className: "issue passed", text: "自动检查未发现结构缺口" })])
    ]);
  });
  target.replaceChildren(...(cards.length ? cards : [createPhysicalExamElement("p", { className: "muted", text: "暂无报告质检结果。" })]));
}

function renderInstitutionBenchmarks(rows) {
  const target = document.querySelector("#physical-exam-benchmarks");
  if (!target) return;
  const cards = rows.map((item) => createPhysicalExamElement("article", {}, [
    createPhysicalExamElement("strong", { text: item.institutionName }),
    createPhysicalExamElement("p", { text: `报告 ${String(item.reports ?? "")} · 异常任务 ${String(item.abnormalCases ?? "")}` }),
    createPhysicalExamElement("small", { text: `通知率 ${item.notificationRate === null ? "暂无分母" : `${String(item.notificationRate ?? "")}%`} · 随访率 ${item.followupRate === null ? "暂无分母" : `${String(item.followupRate ?? "")}%`}` }),
    createPhysicalExamElement("em", { text: item.comparisonStatus === "sample-too-small" ? "样本不足，不排名" : "需完成风险校正后比较" })
  ]));
  replacePhysicalExamChildren(target, cards, physicalExamEmpty("暂无机构质量画像。"));
}

function renderCityRadar(rows) {
  const target = document.querySelector("#physical-exam-city-radar");
  if (!target) return;
  const cards = rows.map((item) => createPhysicalExamElement("article", {}, [
    createPhysicalExamElement("strong", { text: item.name }),
    createPhysicalExamElement("p", { text: `异常报告 ${String(item.abnormalReports ?? "")} · 来源机构 ${String(item.institutionCount ?? "")}` }),
    createPhysicalExamElement("small", { text: item.message }),
    createPhysicalExamElement("em", { text: item.privacyStatus })
  ]));
  replacePhysicalExamChildren(target, cards, physicalExamEmpty("暂无可聚合异常趋势。"));
}

function renderStandardsImpact(rows) {
  const target = document.querySelector("#physical-exam-standards-impact");
  if (!target) return;
  const cards = rows.map((item) => createPhysicalExamElement("article", {}, [
    createPhysicalExamElement("strong", { text: `${String(item.code ?? "")} · ${String(item.affectedReports ?? "")}份` }),
    createPhysicalExamElement("div", { className: "tag-row" }, (item.affectedLayers || []).map((layer) => createPhysicalExamElement("span", { text: layer }))),
    createPhysicalExamElement("small", { text: item.nextAction })
  ]));
  replacePhysicalExamChildren(target, cards, physicalExamEmpty("当前没有规范影响项。"));
}

function renderCriticalPaths(rows) {
  const target = document.querySelector("#physical-exam-critical-paths");
  if (!target) return;
  const cards = rows.map((item) => createPhysicalExamElement("article", { className: `critical-path-card${item.overdue ? " overdue" : ""}` }, [
    createPhysicalExamElement("header", {}, [
      createPhysicalExamElement("strong", { text: item.classification === "high-risk" ? "高危异常" : "重要异常" }),
      createPhysicalExamElement("span", { text: item.status })
    ]),
    createPhysicalExamElement("div", { className: "critical-steps" }, (item.steps || []).map((step) => createPhysicalExamElement("span", {
      className: step.completed ? "done" : "pending",
      text: `${step.completed ? "✓" : "○"} ${String(step.name ?? "")}`
    }))),
    createPhysicalExamElement("small", { text: `时限 ${String(item.dueAt || "待确定")} · ${String(item.escalation ?? "")}` })
  ]));
  replacePhysicalExamChildren(target, cards, physicalExamEmpty("暂无重要异常生命通道任务。"));
}

function renderProductionReadiness(readiness) {
  const target = document.querySelector("#physical-exam-readiness");
  if (!target) return;
  const status = document.querySelector("#physical-exam-readiness-status");
  if (!readiness) {
    target.replaceChildren(physicalExamEmpty("静态预览不判定生产门禁，启动服务后读取真实环境配置。"));
    return;
  }
  const cards = [
    ["代码能力", readiness.codeReady ? "已就绪" : "未就绪", "接口、归档、闭环与审计"],
    ["签名网关", readiness.gateway?.secretConfigured ? "已配置" : "待配置", readiness.gateway?.signatureAlgorithm || "HMAC-SHA256"],
    ["原件存储", readiness.storage?.adapterReady ? "已配置" : "待配置", "校验和、扫描、15年留存"],
    ["报告质量", readiness.quality?.standardsReady ? "通过" : "待治理", `国标 ${readiness.quality?.nationalMappingRate ?? 0}% · 合规 ${readiness.quality?.standardCompliantReports || 0}/${readiness.quality?.reports || 0}`],
    ["现场验收", readiness.siteAcceptance?.ready ? "四眼核验通过" : "待独立核验", `${readiness.siteAcceptance?.independentlyVerified || 0}/${readiness.siteAcceptance?.jointTests || 0} 家机构`]
  ];
  target.replaceChildren(...cards.map((card) => physicalExamMetricCard(card, "readiness-card")));
  const ready = readiness.goLiveReady === true;
  status.textContent = ready ? "可上线" : "上线阻断";
  status.className = `status-chip ${ready ? "ok" : "warn"}`;
  const blockers = document.querySelector("#physical-exam-blockers");
  replacePhysicalExamChildren(
    blockers,
    (readiness.blockers || []).map((item) => createPhysicalExamElement("span", { text: `阻断 · ${String(item ?? "")}` })),
    createPhysicalExamElement("span", { className: "ok-line", text: "所有上线门禁已通过" })
  );
}

function renderAbnormalCases(cases) {
  const target = document.querySelector("#physical-exam-abnormal-cases");
  if (!target) return;
  const cards = cases.map((item) => createPhysicalExamElement("article", { className: "workflow-card" }, [
    createPhysicalExamElement("header", {}, [
      createPhysicalExamElement("strong", { text: item.findingCodes?.join("、") || "异常项目" }),
      createPhysicalExamElement("span", {
        className: `status-chip ${item.status === "closed" ? "ok" : "warn"}`,
        text: `${item.classification === "high-risk" ? "高危异常" : "重要异常"} · ${String(item.status ?? "")}`
      })
    ]),
    createPhysicalExamElement("p", { text: item.latestAction || "待处置" }),
    createPhysicalExamElement("small", { text: `负责人：${String(item.owner || "待分派")} · 时限：${String(item.dueAt || "待确定")}` }),
    createPhysicalExamElement("div", { className: "inline-actions" }, [
      physicalExamButton("确认异常", { caseId: item.id, caseAction: "confirm" }),
      physicalExamButton("通知居民", { caseId: item.id, caseAction: "notify" }),
      physicalExamButton("安排复查", { caseId: item.id, caseAction: "schedule" }),
      physicalExamButton("记录随访", { caseId: item.id, caseAction: "followup" }),
      physicalExamButton("关闭", { caseId: item.id, caseAction: "close" })
    ])
  ]));
  replacePhysicalExamChildren(target, cards, physicalExamEmpty("当前没有待处置的异常报告。"));
}

function renderJointTests(rows) {
  const target = document.querySelector("#physical-exam-joint-tests");
  if (!target) return;
  const evidenceField = (label, input) => createPhysicalExamElement("label", { className: "evidence-field" }, [label, input]);
  const cards = rows.map((item) => createPhysicalExamElement("article", { className: "workflow-card", dataset: { jointTest: item.id } }, [
    createPhysicalExamElement("header", {}, [
      createPhysicalExamElement("strong", { text: item.institutionName }),
      createPhysicalExamElement("span", {
        className: `status-chip ${item.siteSignoffVerified ? "ok" : "warn"}`,
        text: item.siteSignoffVerified ? "四眼核验通过" : item.signoffStatus || "待现场验收"
      })
    ]),
    createPhysicalExamElement("ul", { className: "check-list" }, (item.checks || []).map((check) => createPhysicalExamElement("li", {}, [
      createPhysicalExamElement("span", { text: check.name }),
      createPhysicalExamElement("em", { text: check.status }),
      check.status !== "site-passed" && check.status !== "not-applicable" ? physicalExamButton("现场通过", { jointCheck: check.id }) : null
    ]))),
    item.signoffSubmission ? createPhysicalExamElement("p", {
      className: "signoff-proof",
      text: `已提交：${String(item.signoffSubmission.externalSigner ?? "")} · ${String(item.signoffSubmission.signerOrganization ?? "")} · 摘要 ${String(item.signoffSubmission.evidenceDigest ?? "").slice(0, 12)}…`
    }) : null,
    createPhysicalExamElement("div", { className: "evidence-grid" }, [
      evidenceField("验收证据编号或附件引用", physicalExamInput({ jointEvidence: "" }, `例如 UAT-${String(item.sourceType ?? "")}-001`)),
      evidenceField("证据 SHA-256 摘要", physicalExamInput({ jointDigest: "" }, "64 位十六进制摘要", { maxLength: 64 })),
      evidenceField("外部签署人", physicalExamInput({ jointExternalSigner: "" }, "现场业务/信息负责人")),
      evidenceField("签署人所属机构", physicalExamInput({ jointSignerOrg: "" }, "体检中心或医院")),
      evidenceField("独立复核记录", physicalExamInput({ jointVerification: "" }, "卫生行政复核单号或附件"))
    ]),
    createPhysicalExamElement("div", { className: "inline-actions" }, [
      physicalExamButton("提交上线证据", { jointSubmit: "" }),
      item.signoffSubmission && !item.siteSignoffVerified ? physicalExamButton("独立核验通过", { jointVerify: "" }) : null,
      item.signoffSubmission && !item.siteSignoffVerified ? physicalExamButton("退回证据", { jointReject: "" }) : null
    ])
  ]));
  replacePhysicalExamChildren(target, cards, physicalExamEmpty("暂无机构联调记录。"));
}

function renderGatewayEvents(events) {
  const target = document.querySelector("#physical-exam-gateway-events");
  if (!target) return;
  const cards = events.map((item) => createPhysicalExamElement("article", {}, [
    createPhysicalExamElement("strong", { text: item.externalId || item.id }),
    createPhysicalExamElement("span", { text: item.status }),
    createPhysicalExamElement("small", { text: `${String(item.receivedAt || "")} · 重试 ${String(item.retryCount || 0)} 次${item.deadLetter ? ` · ${String(item.deadLetterReason ?? "")}` : ""}` })
  ]));
  replacePhysicalExamChildren(target, cards, physicalExamEmpty("暂无签名网关接入事件。"));
}

function renderSourceContracts(contracts) {
  document.querySelector("#physical-exam-contracts").replaceChildren(...contracts.map((item) => createPhysicalExamElement("article", { className: "contract-card" }, [
    createPhysicalExamElement("header", {}, [
      createPhysicalExamElement("div", {}, [
        createPhysicalExamElement("h3", { text: item.name }),
        createPhysicalExamElement("small", { text: (item.systems || []).join(" / ") })
      ]),
      createPhysicalExamElement("span", { className: "status-chip ok", text: "可联调" })
    ]),
    createPhysicalExamElement("p", { text: `${String(item.transport ?? "")} · ${String(item.identity ?? "")}` }),
    createPhysicalExamElement("div", { className: "contract-fields", text: `必填：${(item.required || []).join("、")}` })
  ])));
}

function renderSpecializedIntakes(rows, programs) {
  const target = document.querySelector("#physical-exam-specialized-intakes");
  if (!target) return;
  if (!rows.length) {
    const labels = programs.filter((item) => item.route === "specialized-profile").map((item) => item.name).join("、");
    target.replaceChildren(createPhysicalExamElement("article", { className: "workflow-card specialized-routing-empty" }, [
      createPhysicalExamElement("header", {}, [
        createPhysicalExamElement("strong", { text: "当前无待分流专项体检" }),
        createPhysicalExamElement("span", { className: "status-chip ok", text: "一般档案零混入" })
      ]),
      createPhysicalExamElement("p", { text: `已启用独立画像：${labels || "职业健康、学生、征兵、驾驶及公共卫生专项体检"}。` }),
      createPhysicalExamElement("small", { text: "专项载荷仅登记最小路由元数据和摘要，不进入 personalRecords[physical-exam]。" })
    ]));
    return;
  }
  target.replaceChildren(...rows.map((item) => createPhysicalExamElement("article", {
    className: "workflow-card",
    dataset: { specializedIntake: item.id }
  }, [
    createPhysicalExamElement("header", {}, [
      createPhysicalExamElement("strong", { text: item.examProgramName }),
      createPhysicalExamElement("span", { className: `status-chip ${item.status === "closed" ? "ok" : "warn"}`, text: item.status })
    ]),
    createPhysicalExamElement("p", { text: `${String(item.institutionName ?? "")} · ${String(item.examDate ?? "")} · ${String(item.externalId ?? "")}` }),
    createPhysicalExamElement("small", { text: `${String(item.routingReason ?? "")} · 目标分类 ${String(item.targetArchiveCategory ?? "")}` }),
    createPhysicalExamElement("div", { className: "specialized-routing-fields" }, [
      physicalExamInput({ specializedTarget: "" }, "专项系统标识", { value: item.targetSystem || "" }),
      physicalExamInput({ specializedProfile: "" }, "专项画像 ID", { value: item.profileId || "" }),
      physicalExamInput({ specializedEvidence: "" }, "证据编号")
    ]),
    createPhysicalExamElement("div", { className: "inline-actions" }, [
      physicalExamButton("分配专项画像", { specializedAction: "assign-profile" }),
      physicalExamButton("退回来源", { specializedAction: "return-source" }),
      physicalExamButton("关闭分流", { specializedAction: "close" })
    ])
  ])));
}

function renderStandards(standards) {
  const target = document.querySelector("#physical-exam-standards");
  if (!target) return;
  target.replaceChildren(...standards.map((item, index) => createPhysicalExamElement("article", { className: "contract-card" }, [
    createPhysicalExamElement("header", {}, [
      createPhysicalExamElement("div", {}, [
        createPhysicalExamElement("h3", { text: item.code }),
        createPhysicalExamElement("small", { text: `${String(item.level ?? "")} · ${String(item.status ?? "")}` })
      ]),
      createPhysicalExamElement("span", { className: `status-chip ${item.mandatory ? "warn" : "ok"}`, text: item.mandatory ? "强制依据" : "标准依据" })
    ]),
    createPhysicalExamElement("p", { text: item.name }),
    createPhysicalExamElement("a", {
      className: "text-action",
      text: "查看官方文件",
      dataset: { examStandardSource: index },
      attributes: { target: "_blank", rel: "noreferrer" }
    })
  ])));
  window.HealthBrowserSafeUrl.setElementUrlBindings([...target.querySelectorAll("[data-exam-standard-source]")].map((link) => ({
    element: link,
    input: standards[Number(link.dataset.examStandardSource)]?.source,
    options: {
      capability: "official-source",
      baseUrl: location.href,
      allowedOrigins: PHYSICAL_EXAM_OFFICIAL_SOURCE_ORIGINS
    }
  })));
}

function renderQualityIndicators(indicators) {
  const target = document.querySelector("#physical-exam-quality-indicators");
  if (!target) return;
  target.replaceChildren(...indicators.map((item) => physicalExamMetricCard([
    item.code,
    !item.collectable ? "待采集" : item.value === null ? "暂无分母" : `${String(item.value ?? "")}${String(item.unit ?? "")}`,
    `${String(item.name ?? "")} · ${String(item.numerator || 0)}/${String(item.denominator || 0)}`
  ], "readiness-card")));
}

function renderPhysicalExamFilters(overview) {
  const residentSelect = document.querySelector("#physical-exam-resident-filter");
  const residentOptions = [createPhysicalExamElement("option", { value: "", text: "全部可授权居民" })]
    .concat((overview.residents || []).map((item) => createPhysicalExamElement("option", { value: item.id, text: item.name })));
  residentSelect.replaceChildren(...residentOptions);
  residentSelect.value = physicalExamState.residentId;
  const yearSelect = document.querySelector("#physical-exam-year-filter");
  yearSelect.replaceChildren(
    createPhysicalExamElement("option", { value: "", text: "全部年度" }),
    ...(overview.years || []).map((year) => createPhysicalExamElement("option", { value: year, text: `${String(year ?? "")} 年` }))
  );
  yearSelect.value = physicalExamState.year;
}

function renderPhysicalExamReports(reports) {
  const visible = reports.filter((item) => !physicalExamState.year || String(item.date || "").startsWith(physicalExamState.year));
  document.querySelector("#physical-exam-report-summary").textContent = `已从健康档案同步 ${visible.length} 份报告`;
  const cards = visible.map((item) => {
    const [year, month, day] = String(item.date || "---- -- --").split("-");
    const abnormal = Number(item.meta?.abnormalCount || 0);
    return createPhysicalExamElement("article", { className: "report-card" }, [
      createPhysicalExamElement("div", { className: "report-date" }, [
        createPhysicalExamElement("strong", { text: year }),
        createPhysicalExamElement("span", { text: `${month || "--"}-${day || "--"}` })
      ]),
      createPhysicalExamElement("div", {}, [
        createPhysicalExamElement("h3", { text: item.name }),
        createPhysicalExamElement("p", { text: item.result }),
        createPhysicalExamElement("small", { text: `${String(item.source ?? "")} · 报告号 ${String(item.meta?.reportNo || item.meta?.externalId || "已归档")}` })
      ]),
      createPhysicalExamElement("div", { className: "report-actions" }, [
        createPhysicalExamElement("span", { className: `status-chip ${abnormal ? "warn" : "ok"}`, text: abnormal ? `${abnormal} 项异常` : "未标记异常" }),
        physicalExamButton("查看报告", { reportId: item.id }, "text-action")
      ])
    ]);
  });
  replacePhysicalExamChildren(document.querySelector("#physical-exam-report-list"), cards, physicalExamEmpty("当前筛选条件下暂无体检报告。"));
}

function populateImportResidents(residents) {
  const select = document.querySelector("#physical-exam-import-form select[name='residentId']");
  if (!select) return;
  select.replaceChildren(...residents.map((item) => createPhysicalExamElement("option", { value: item.id, text: `${String(item.name ?? "")} · ${String(item.id ?? "")}` })));
}

function bindPhysicalExamControls() {
  document.querySelector("#physical-exam-resident-filter")?.addEventListener("change", async (event) => {
    physicalExamState.residentId = event.target.value;
    physicalExamState.year = "";
    await loadPhysicalExams();
    renderPhysicalExamSystem();
  });
  document.querySelector("#physical-exam-year-filter")?.addEventListener("change", (event) => {
    physicalExamState.year = event.target.value;
    renderPhysicalExamReports(physicalExamState.overview?.reports || []);
  });
  document.querySelector("#physical-exam-refresh")?.addEventListener("click", async () => {
    await loadPhysicalExams();
    renderPhysicalExamSystem();
    showPhysicalExamToast("体检报告已与健康档案重新同步");
  });
  document.querySelector("#physical-exam-import-form")?.addEventListener("submit", submitPhysicalExamImport);
  document.querySelector("#physical-exam-report-list")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-report-id]");
    if (button) showPhysicalExamDetail(button.dataset.reportId);
  });
  document.querySelector("#physical-exam-abnormal-cases")?.addEventListener("click", handleAbnormalCaseAction);
  document.querySelector("#physical-exam-joint-tests")?.addEventListener("click", handleJointTestAction);
  document.querySelector("#physical-exam-specialized-intakes")?.addEventListener("click", handleSpecializedIntakeAction);
  document.querySelector("#physical-exam-detail")?.addEventListener("click", handleAttachmentLink);
  document.querySelector("[data-close-report]")?.addEventListener("click", () => document.querySelector("#physical-exam-detail-dialog")?.close());
}

async function handleSpecializedIntakeAction(event) {
  const button = event.target.closest("[data-specialized-action]");
  const card = event.target.closest("[data-specialized-intake]");
  if (!button || !card) return;
  const evidenceRef = card.querySelector("[data-specialized-evidence]")?.value.trim();
  if (!evidenceRef) {
    showPhysicalExamToast("专项体检分流必须填写证据编号");
    return;
  }
  const payload = { action: button.dataset.specializedAction, evidenceRef, note: "专项体检隔离分流处置" };
  if (payload.action === "assign-profile") {
    payload.targetSystem = card.querySelector("[data-specialized-target]")?.value.trim();
    payload.profileId = card.querySelector("[data-specialized-profile]")?.value.trim();
  }
  button.disabled = true;
  try {
    await postPhysicalExamAction(`/physical-exams/specialized-intakes/${encodeURIComponent(card.dataset.specializedIntake)}/actions`, payload);
    await refreshPhysicalExamWorkbench("专项体检分流状态已更新");
  } catch (error) {
    showPhysicalExamToast(error.message);
  } finally {
    button.disabled = false;
  }
}

async function handleAbnormalCaseAction(event) {
  const button = event.target.closest("[data-case-action]");
  if (!button) return;
  const labels = { confirm: "医师已确认重要异常结果及分级", notify: "已向居民发送异常项目随访提醒", schedule: "已安排复查并进入任务队列", followup: "已回收后续诊疗情况并完成随访记录", close: "确认、通知和随访证据完整，异常处置已闭环" };
  button.disabled = true;
  try {
    await postPhysicalExamAction(`/physical-exams/abnormal-cases/${encodeURIComponent(button.dataset.caseId)}/actions`, { action: button.dataset.caseAction, note: labels[button.dataset.caseAction] });
    await refreshPhysicalExamWorkbench("异常处置状态已更新");
  } catch (error) {
    showPhysicalExamToast(error.message);
  } finally {
    button.disabled = false;
  }
}

async function handleJointTestAction(event) {
  const card = event.target.closest("[data-joint-test]");
  if (!card) return;
  const checkButton = event.target.closest("[data-joint-check]");
  const submitButton = event.target.closest("[data-joint-submit]");
  const verifyButton = event.target.closest("[data-joint-verify]");
  const rejectButton = event.target.closest("[data-joint-reject]");
  if (!checkButton && !submitButton && !verifyButton && !rejectButton) return;
  const evidenceRef = card.querySelector("[data-joint-evidence]")?.value.trim();
  const evidenceDigest = card.querySelector("[data-joint-digest]")?.value.trim().toLowerCase();
  const externalSigner = card.querySelector("[data-joint-external-signer]")?.value.trim();
  const signerOrganization = card.querySelector("[data-joint-signer-org]")?.value.trim();
  const verificationRef = card.querySelector("[data-joint-verification]")?.value.trim();
  if ((checkButton || submitButton) && !evidenceRef) {
    showPhysicalExamToast("请先填写真实验收证据编号或附件引用");
    return;
  }
  if ((submitButton || verifyButton || rejectButton) && !/^[a-f0-9]{64}$/.test(evidenceDigest || "")) {
    showPhysicalExamToast("请填写与验收附件一致的 64 位 SHA-256 摘要");
    return;
  }
  if (submitButton && (!externalSigner || !signerOrganization)) {
    showPhysicalExamToast("提交上线证据必须填写外部签署人及所属机构");
    return;
  }
  if ((verifyButton || rejectButton) && !verificationRef) {
    showPhysicalExamToast("独立复核必须填写复核记录编号或附件引用");
    return;
  }
  const payload = checkButton
    ? { action: "update-check", checkId: checkButton.dataset.jointCheck, status: "site-passed", note: "现场联调验证通过", evidenceRef }
    : submitButton
      ? { action: "submit-signoff", note: "提交机构现场验收证据，等待独立复核", evidenceRef, evidenceDigest, externalSigner, signerOrganization }
      : { action: verifyButton ? "verify-signoff" : "reject-signoff", note: verifyButton ? "卫生行政独立核验通过" : "证据核验不通过，退回补正", evidenceDigest, verificationRef };
  const button = checkButton || submitButton || verifyButton || rejectButton;
  button.disabled = true;
  try {
    await postPhysicalExamAction(`/physical-exams/joint-tests/${encodeURIComponent(card.dataset.jointTest)}/actions`, payload);
    await refreshPhysicalExamWorkbench(checkButton ? "联调检查项已留证" : submitButton ? "上线证据已提交，等待独立复核" : verifyButton ? "上线证据已完成四眼核验" : "上线证据已退回补正");
  } catch (error) {
    showPhysicalExamToast(error.message);
  } finally {
    button.disabled = false;
  }
}

async function handleAttachmentLink(event) {
  const button = event.target.closest("[data-link-attachment]");
  if (!button) return;
  const input = document.querySelector("#physical-exam-attachment-id");
  const attachmentId = input?.value.trim();
  if (!attachmentId) {
    showPhysicalExamToast("请填写已完成扫描的安全附件 ID");
    return;
  }
  try {
    await postPhysicalExamAction(`/physical-exams/${encodeURIComponent(button.dataset.linkAttachment)}/link-attachment`, { attachmentId });
    document.querySelector("#physical-exam-detail-dialog")?.close();
    await refreshPhysicalExamWorkbench("原始体检报告已安全归档关联");
  } catch (error) {
    showPhysicalExamToast(error.message);
  }
}

async function postPhysicalExamAction(path, payload) {
  if (!PHYSICAL_EXAM_API) throw new Error("静态预览不执行写入操作");
  const request = window.HealthCityAuth?.authFetch || fetch;
  const response = await request(`${PHYSICAL_EXAM_API}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.message || `操作失败：${response.status}`);
  return result;
}

async function refreshPhysicalExamWorkbench(message) {
  await loadPhysicalExams();
  renderPhysicalExamSystem();
  showPhysicalExamToast(message);
}

function seedImportDefaults() {
  const form = document.querySelector("#physical-exam-import-form");
  if (!form) return;
  const token = Date.now().toString().slice(-8);
  form.elements.externalId.value = `DEMO-PE-${token}`;
  form.elements.reportNo.value = `TJ${token}`;
  form.elements.examDate.value = new Date().toISOString().slice(0, 10);
}

async function submitPhysicalExamImport(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form));
  const itemCodes = { "血压": "BP", "空腹血糖": "GLU", "糖化血红蛋白": "HBA1C", "体质指数": "BMI", "肌酐": "CRE", "心电图": "ECG" };
  const findings = String(values.abnormalFindings || "").split("\n").map((line) => line.trim()).filter(Boolean).map((line, index) => {
    const [name, value, unit] = line.split("|").map((part) => part.trim());
    return { code: itemCodes[name] || `MANUAL-${index + 1}`, name, value, unit, abnormal: true, status: "异常" };
  });
  const token = String(values.reportNo || values.externalId || Date.now());
  const payload = {
    ...values,
    findings,
    recommendations: String(values.recommendations || "").split("\n").filter(Boolean),
    signature: { standardCode: "WS/T 847-2024", status: "verified", mode: "demo", asymmetricAlgorithm: "SM2 demo", digestAlgorithm: "SM3 demo", format: "ES-T XML demo", signatureNo: `DEMO-${token}`, signer: "接入演示总检医师", signedAt: new Date().toISOString(), certificateSerial: "DEMO-CERT", certificateChainVerified: true, revocationStatusVerified: true, timestamp: new Date().toISOString(), timestampVerified: true, digestValue: "demo-digest", signatureValueRef: `demo://${token}`, verifiedAt: new Date().toISOString() }
  };
  delete payload.abnormalFindings;
  const resultTarget = document.querySelector("#physical-exam-import-result");
  if (!PHYSICAL_EXAM_API) {
    resultTarget.textContent = "静态预览不执行写入；启动本地服务后可验证接入与幂等去重。";
    return;
  }
  try {
    const request = window.HealthCityAuth?.authFetch || fetch;
    const response = await request(`${PHYSICAL_EXAM_API}/physical-exams/import`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || `接入失败：${response.status}`);
    resultTarget.textContent = result.imported
      ? `已接入 ${result.imported} 份一般成人体检报告并同步健康档案。`
      : result.routed
        ? `已将 ${result.routed} 份专项体检分流至受限队列，未写入一般体检档案。`
        : `检测到 ${result.duplicates + (result.routedDuplicates || 0)} 份重复报告，未重复归档。`;
    physicalExamState.residentId = values.residentId;
    await loadPhysicalExams();
    renderPhysicalExamSystem();
    seedImportDefaults();
  } catch (error) {
    resultTarget.textContent = error.message;
  }
}

function showPhysicalExamDetail(id) {
  const report = physicalExamState.overview?.reports?.find((item) => item.id === id);
  if (!report) return;
  const findings = report.meta?.findings || [];
  const recommendations = report.meta?.recommendations || [];
  const signature = report.meta?.signature || {};
  const compliance = report.meta?.standardCompliance || { compliant: false, gaps: ["未执行规范核验"] };
  const careLinkage = report.meta?.careLinkage;
  const qualification = report.meta?.institutionQualification || {};
  const sectionSignatures = report.meta?.sectionSignatures || [];
  const questionnaire = report.meta?.healthQuestionnaire || {};
  const radiationExaminations = report.meta?.radiationExaminations || [];
  const canOperate = ["commission", "institution"].includes(physicalExamState.user?.role);
  const proof = (label, value, detail) => createPhysicalExamElement("div", { className: "report-proof" }, [
    createPhysicalExamElement("span", { text: label }),
    createPhysicalExamElement("strong", { text: value }),
    createPhysicalExamElement("small", { text: detail })
  ]);
  const findingTable = createPhysicalExamElement("table", { className: "finding-table" }, [
    createPhysicalExamElement("thead", {}, createPhysicalExamElement("tr", {}, ["项目", "结果", "参考", "标准映射", "判定"].map((label) => createPhysicalExamElement("th", { text: label })))),
    createPhysicalExamElement("tbody", {}, findings.map((item) => createPhysicalExamElement("tr", { className: item.abnormal ? "abnormal" : "" }, [
      createPhysicalExamElement("td", { text: item.name }),
      createPhysicalExamElement("td", { text: `${String(item.value ?? "")}${String(item.unit || "")}` }),
      createPhysicalExamElement("td", { text: item.reference || "-" }),
      createPhysicalExamElement("td", { text: item.standard || item.mappingStatus || "待映射" }),
      createPhysicalExamElement("td", { text: item.abnormal ? "异常" : "正常/未标记" })
    ])))
  ]);
  const recommendationItems = (recommendations.length ? recommendations : ["遵医嘱保持定期体检"])
    .map((item) => createPhysicalExamElement("li", { text: item }));
  const detailNodes = [
    createPhysicalExamElement("h3", { text: report.name }),
    createPhysicalExamElement("p", { text: `${String(report.residentName ?? "")} · ${String(report.date ?? "")} · ${String(report.source ?? "")}` }),
    createPhysicalExamElement("p", { text: report.result }),
    findingTable,
    createPhysicalExamElement("h4", { text: "健康建议" }),
    createPhysicalExamElement("ul", {}, recommendationItems),
    proof("电子签章", signature.status === "verified" ? "核验通过" : "待核验", `${String(signature.algorithm || "-")} · ${String(signature.signatureNo || "无签章号")}`),
    proof("规范门禁", compliance.compliant ? "生产合规" : "未达生产合规", compliance.compliant ? `${String(compliance.passed ?? "")}/${String(compliance.total ?? "")} 项通过` : `缺口：${(compliance.gaps || []).join("、")}`),
    proof("分项与主检签署", `${sectionSignatures.length} 个分项 · ${String(qualification.signerProfessionalTitle || "主检资质待核")}`, sectionSignatures.map((item) => `${String(item.sectionId ?? "")}:${String(item.physicianName || item.physicianId || "")}`).join("；") || "分项医师签名待接入"),
    proof("健康问卷", window.PhysicalExaminationStandards?.questionnaireComplete?.(questionnaire) ? "已完成" : "待补齐", "基本信息、健康史、生活方式、心理健康"),
    radiationExaminations.length ? proof("放射检查治理", `${radiationExaminations.length} 项已记录`, radiationExaminations.map((item) => `${String(item.modality ?? "")} ${String(item.dose ?? "-")}${String(item.doseUnit || "")}`).join("；")) : null,
    careLinkage ? proof("慢病与家医联动", `${String(careLinkage.riskLevel ?? "")} · 已生成居民待办`, `${String(careLinkage.familyDoctorSuggestion?.suggestion || "家庭医生复核")} · ${String(careLinkage.dueAt || "尽快处理")}`) : null,
    proof("原报告归档", report.attachment ? "安全附件已关联" : "待关联", report.attachment?.filename || "需经校验和与恶意文件扫描后关联"),
    canOperate && !report.attachment ? createPhysicalExamElement("div", { className: "attachment-link" }, [
      createPhysicalExamElement("label", {}, [
        "安全附件 ID",
        createPhysicalExamElement("input", { attributes: { id: "physical-exam-attachment-id", placeholder: "att-..." } })
      ]),
      physicalExamButton("关联原报告", { linkAttachment: report.id }, "text-action")
    ]) : null,
    createPhysicalExamElement("p", { className: "muted", text: `来源标识：${String(report.meta?.externalId ?? "")} · 标准版本：${String(report.meta?.standardVersion ?? "")} · 质量：${String(report.meta?.qualityStatus || "待核验")}` })
  ].filter(Boolean);
  document.querySelector("#physical-exam-detail").replaceChildren(...detailNodes);
  document.querySelector("#physical-exam-detail-dialog")?.showModal();
}

function showPhysicalExamToast(message) {
  const toast = document.querySelector("#physical-exam-toast");
  toast.textContent = message;
  toast.classList.add("visible");
  setTimeout(() => { toast.classList.remove("visible"); }, 2200);
}
