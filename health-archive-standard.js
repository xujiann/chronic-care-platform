(function () {
  const healthArchiveStandardDefaults = {
    version: "健康档案基本架构与数据标准（试行）",
    dimensions: [
      { key: "lifeStage", title: "生命阶段", detail: "按婴儿、儿童、青少年、成年、中年、老年等阶段组织全生命周期档案。" },
      { key: "healthProblem", title: "健康和疾病问题", detail: "围绕慢病、风险因素、过敏史、健康指标和重大疾病问题持续更新。" },
      { key: "serviceActivity", title: "卫生服务活动", detail: "归集预防、医疗、保健、康复、健康教育和随访干预记录。" }
    ],
    contentGroups: [
      { key: "basic", title: "个人基本信息", detail: "人口学、社会经济、亲属、社会保障、基本健康、建档信息。" },
      { key: "child", title: "儿童保健", detail: "出生医学证明、新生儿筛查、儿童体检、体弱儿童管理。" },
      { key: "women", title: "妇女保健", detail: "婚前保健、妇女病普查、计划生育、孕产期保健、产前筛查、出生缺陷监测。" },
      { key: "diseaseControl", title: "疾病预防", detail: "预防接种、传染病、结核病、艾滋病、职业病、伤害、中毒、行为危险因素、死亡证明。" },
      { key: "diseaseManagement", title: "疾病管理", detail: "高血压、糖尿病、肿瘤、严重精神障碍、老年人健康管理。" },
      { key: "medical", title: "医疗服务", detail: "门诊、住院、住院病案首页、成人健康体检。" }
    ],
    datasets: [
      { code: "HRA00.01", group: "basic", name: "个人信息基本数据集", activity: "建档", appliesTo: "all" },
      { code: "HRB01.01", group: "child", name: "出生医学证明", activity: "儿童保健", appliesTo: "child" },
      { code: "HRB01.02", group: "child", name: "新生儿疾病筛查", activity: "儿童保健", appliesTo: "child" },
      { code: "HRB01.03", group: "child", name: "儿童健康体检", activity: "儿童保健", appliesTo: "child" },
      { code: "HRB01.04", group: "child", name: "体弱儿童管理", activity: "儿童保健", appliesTo: "child" },
      { code: "HRB02.01", group: "women", name: "婚前保健服务", activity: "妇女保健", appliesTo: "women" },
      { code: "HRB02.02", group: "women", name: "妇女病普查", activity: "妇女保健", appliesTo: "women" },
      { code: "HRB02.03", group: "women", name: "计划生育技术服务", activity: "妇女保健", appliesTo: "women" },
      { code: "HRB02.04", group: "women", name: "孕产期保健服务与高危管理", activity: "妇女保健", appliesTo: "women" },
      { code: "HRB02.05", group: "women", name: "产前筛查与诊断", activity: "妇女保健", appliesTo: "women" },
      { code: "HRB02.06", group: "women", name: "出生缺陷监测", activity: "妇女保健", appliesTo: "women" },
      { code: "HRB03.01", group: "diseaseControl", name: "预防接种", activity: "疾病预防", appliesTo: "all" },
      { code: "HRB03.02", group: "diseaseControl", name: "传染病报告", activity: "疾病预防", appliesTo: "event" },
      { code: "HRB03.03", group: "diseaseControl", name: "结核病防治", activity: "疾病预防", appliesTo: "event" },
      { code: "HRB03.04", group: "diseaseControl", name: "艾滋病防治", activity: "疾病预防", appliesTo: "event" },
      { code: "HRB03.05", group: "diseaseControl", name: "血吸虫病病人管理", activity: "疾病预防", appliesTo: "event" },
      { code: "HRB03.06", group: "diseaseControl", name: "慢性丝虫病病人管理", activity: "疾病预防", appliesTo: "event" },
      { code: "HRB03.07", group: "diseaseControl", name: "职业病报告", activity: "疾病预防", appliesTo: "event" },
      { code: "HRB03.08", group: "diseaseControl", name: "职业性健康监护", activity: "疾病预防", appliesTo: "event" },
      { code: "HRB03.09", group: "diseaseControl", name: "伤害监测报告", activity: "疾病预防", appliesTo: "event" },
      { code: "HRB03.10", group: "diseaseControl", name: "中毒报告", activity: "疾病预防", appliesTo: "event" },
      { code: "HRB03.11", group: "diseaseControl", name: "行为危险因素监测", activity: "疾病预防", appliesTo: "all" },
      { code: "HRB03.12", group: "diseaseControl", name: "死亡医学证明", activity: "疾病预防", appliesTo: "event" },
      { code: "HRB04.01", group: "diseaseManagement", name: "高血压病例管理", activity: "疾病管理", appliesTo: "disease" },
      { code: "HRB04.02", group: "diseaseManagement", name: "糖尿病病例管理", activity: "疾病管理", appliesTo: "disease" },
      { code: "HRB04.03", group: "diseaseManagement", name: "肿瘤病例管理", activity: "疾病管理", appliesTo: "disease" },
      { code: "HRB04.04", group: "diseaseManagement", name: "精神分裂症病例管理", activity: "疾病管理", appliesTo: "disease" },
      { code: "HRB04.05", group: "diseaseManagement", name: "老年人健康管理", activity: "疾病管理", appliesTo: "elderly" },
      { code: "HRC00.01", group: "medical", name: "门诊诊疗", activity: "医疗服务", appliesTo: "all" },
      { code: "HRC00.02", group: "medical", name: "住院诊疗", activity: "医疗服务", appliesTo: "event" },
      { code: "HRC00.03", group: "medical", name: "住院病案首页", activity: "医疗服务", appliesTo: "event" },
      { code: "HRC00.04", group: "medical", name: "成人健康体检", activity: "医疗服务", appliesTo: "adult" }
    ]
  };

  function getStandard(state) {
    return state?.healthArchiveStandard || healthArchiveStandardDefaults;
  }

  function ageOf(birthDate) {
    const birth = new Date(birthDate);
    const now = new Date();
    let age = now.getFullYear() - birth.getFullYear();
    const monthDiff = now.getMonth() - birth.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birth.getDate())) age -= 1;
    return Number.isFinite(age) ? age : 0;
  }

  function lifeStageOf(resident) {
    const age = ageOf(resident?.birthDate);
    if (age < 1) return "婴儿期";
    if (age < 7) return "幼儿/学龄前";
    if (age < 13) return "学龄期";
    if (age < 18) return "青春期";
    if (age < 45) return "青年期";
    if (age < 60) return "中年期";
    return "老年期";
  }

  function assessRisk(resident) {
    const metrics = resident?.metrics || {};
    if (metrics.systolic >= 160 || metrics.glucose >= 7 || metrics.bmi >= 30) return "高危";
    if (metrics.systolic >= 140 || metrics.glucose >= 6.1 || metrics.bmi >= 28) return "中危";
    return "低危";
  }

  function recordsOf(state, residentId, category) {
    return (state?.personalRecords || []).filter((item) => item.residentId === residentId && item.category === category);
  }

  function diseaseNames(state, residentId) {
    return (state?.diseases || []).filter((item) => item.residentId === residentId).map((item) => item.type);
  }

  function hasDisease(state, residentId, keywords) {
    return diseaseNames(state, residentId).some((name) => keywords.some((keyword) => name.includes(keyword)));
  }

  function addEvidence(evidence, code, text) {
    if (!evidence[code]) evidence[code] = [];
    evidence[code].push(text);
  }

  function getResidentCoverage(state, residentId) {
    const standard = getStandard(state);
    const resident = (state?.residents || []).find((item) => item.id === residentId);
    const evidence = {};
    if (!resident) return emptyCoverage(standard);

    const age = ageOf(resident.birthDate);
    const diseases = diseaseNames(state, residentId);
    const emrs = recordsOf(state, residentId, "emr");
    const labs = recordsOf(state, residentId, "labs");
    const meds = recordsOf(state, residentId, "medications");
    const allergies = recordsOf(state, residentId, "allergies");
    const vaccines = recordsOf(state, residentId, "vaccines");
    const admissions = recordsOf(state, residentId, "admissions");
    const followups = (state?.followups || []).filter((item) => item.residentId === residentId);
    const pickups = (state?.medicationPickups || []).filter((item) => item.residentId === residentId);
    const seniorServices = (state?.seniorServices || []).filter((item) => item.residentId === residentId);
    const credentials = (state?.digitalCredentials || []).filter((item) => item.residentId === residentId);

    addEvidence(evidence, "HRA00.01", `身份、联系方式、家庭医生、地址、personIndex：${resident.personIndex || resident.idCard || "待生成"}`);
    if (resident.metrics) addEvidence(evidence, "HRC00.04", `基础健康指标：血压 ${resident.metrics.systolic}/${resident.metrics.diastolic}，血糖 ${resident.metrics.glucose}，BMI ${resident.metrics.bmi}`);
    if (allergies.length) addEvidence(evidence, "HRA00.01", `过敏史 ${allergies.length} 条`);
    if (credentials.length) addEvidence(evidence, "HRA00.01", `电子健康码/医保凭证 ${credentials.length} 项`);
    if (vaccines.length) addEvidence(evidence, "HRB03.01", `预防接种 ${vaccines.length} 条`);
    if (resident.metrics) addEvidence(evidence, "HRB03.11", `行为和代谢风险：${assessRisk(resident)}`);
    if (hasDisease(state, residentId, ["高血压"])) addEvidence(evidence, "HRB04.01", `高血压登记、随访 ${followups.filter((item) => item.diseaseType.includes("高血压")).length} 项、固定取药 ${pickups.length} 项`);
    if (hasDisease(state, residentId, ["糖尿病"])) addEvidence(evidence, "HRB04.02", `糖尿病登记、随访 ${followups.filter((item) => item.diseaseType.includes("糖尿病")).length} 项`);
    if (hasDisease(state, residentId, ["肿瘤", "癌"])) addEvidence(evidence, "HRB04.03", "肿瘤管理记录");
    if (hasDisease(state, residentId, ["精神", "分裂"])) addEvidence(evidence, "HRB04.04", "严重精神障碍管理记录");
    if (age >= 60 || seniorServices.length) addEvidence(evidence, "HRB04.05", `老年健康/适老服务 ${seniorServices.length} 项`);
    if (emrs.length) addEvidence(evidence, "HRC00.01", `门诊和诊疗摘要 ${emrs.length} 条`);
    if (labs.length) addEvidence(evidence, "HRC00.04", `检查检验 ${labs.length} 条`);
    if (meds.length) addEvidence(evidence, "HRC00.01", `用药处方 ${meds.length} 条`);
    if (admissions.some((item) => /住院|入院/.test(`${item.name}${item.result}`))) {
      addEvidence(evidence, "HRC00.02", `住院诊疗 ${admissions.length} 条`);
      addEvidence(evidence, "HRC00.03", "住院病案首页待结构化抽取");
    }

    const datasets = standard.datasets.map((dataset) => {
      const applicable = isApplicable(dataset, resident, state, residentId);
      const matched = evidence[dataset.code] || [];
      return {
        ...dataset,
        applicable,
        status: matched.length ? "已归集" : applicable ? "待补齐" : "当前不适用",
        evidence: matched
      };
    });
    const applicableDatasets = datasets.filter((item) => item.applicable);
    const completed = datasets.filter((item) => item.status === "已归集").length;
    const applicableCompleted = applicableDatasets.filter((item) => item.status === "已归集").length;
    return {
      standard,
      resident,
      age,
      lifeStage: lifeStageOf(resident),
      risk: assessRisk(resident),
      problems: diseases.length ? diseases : ["暂无慢病登记"],
      activities: [
        { title: "预防", detail: `接种 ${vaccines.length} 条，风险监测 ${resident.metrics ? "已记录" : "待补齐"}` },
        { title: "医疗", detail: `电子病历 ${emrs.length} 条，检查检验 ${labs.length} 条，用药 ${meds.length} 条` },
        { title: "保健/康复", detail: `随访 ${followups.length} 项，适老服务 ${seniorServices.length} 项` },
        { title: "健康教育", detail: pickups.length ? `固定取药 ${pickups.length} 项，用药依从性提醒` : "待补充健康教育记录" }
      ],
      datasets,
      completed,
      total: datasets.length,
      applicableCompleted,
      applicableTotal: applicableDatasets.length || datasets.length,
      score: Math.round((applicableCompleted / (applicableDatasets.length || datasets.length)) * 100)
    };
  }

  function isApplicable(dataset, resident, state, residentId) {
    const age = ageOf(resident?.birthDate);
    if (dataset.appliesTo === "all") return true;
    if (dataset.appliesTo === "adult") return age >= 18;
    if (dataset.appliesTo === "elderly") return age >= 60;
    if (dataset.appliesTo === "child") return age < 14;
    if (dataset.appliesTo === "women") return resident?.gender === "女" && age >= 15 && age <= 64;
    if (dataset.appliesTo === "disease") {
      return hasDisease(state, residentId, ["高血压", "糖尿病", "肿瘤", "癌", "精神", "分裂"]);
    }
    return Boolean((evidenceTriggerMap[dataset.code] || []).some((category) => recordsOf(state, residentId, category).length));
  }

  const evidenceTriggerMap = {
    "HRC00.02": ["admissions"],
    "HRC00.03": ["admissions"]
  };

  function emptyCoverage(standard) {
    return {
      standard,
      datasets: standard.datasets.map((dataset) => ({ ...dataset, applicable: false, status: "待补齐", evidence: [] })),
      completed: 0,
      total: standard.datasets.length,
      applicableCompleted: 0,
      applicableTotal: 0,
      score: 0,
      activities: [],
      problems: []
    };
  }

  window.HealthArchiveStandard = {
    defaults: healthArchiveStandardDefaults,
    getStandard,
    getResidentCoverage,
    lifeStageOf,
    ageOf
  };
})();
