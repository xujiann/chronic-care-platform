(function initImmunizationSchedule(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.ImmunizationSchedule2026 = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function buildImmunizationScheduleApi() {
  const POLICY = {
    name: "国家免疫规划疫苗儿童免疫程序及说明（2026年版）",
    version: "2026",
    issued: "2026-06",
    source: "国家免疫规划疫苗儿童免疫程序及说明（2026年版）PDF",
    referenceDate: "2026-07-07"
  };

  const GENERAL_PRINCIPLES = [
    "受种对象达到相应剂次最小接种年龄后应尽早接种。",
    "未按推荐年龄完成接种者，应尽早补种，只需补齐未完成剂次，无需重新开始全程接种。",
    "两种及以上注射类疫苗同时接种时应在不同部位接种，不得混入同一注射器。",
    "两种及以上注射类减毒活疫苗如未同时接种，应间隔不小于 28 天。",
    "国家免疫规划疫苗可全年开展常规接种，也可按需要开展补充免疫和应急接种。"
  ];

  const SPECIAL_HEALTH_RULES = [
    { id: "preterm-low-weight", name: "早产儿与低出生体重儿", guidance: "医学评估稳定且未患需住院治疗严重疾病者，按出生后实际月龄接种；乙肝和卡介苗按具体说明处理。" },
    { id: "hbsag-positive", name: "HBsAg 阳性或不详母亲所生新生儿", guidance: "出生后 12 小时内尽早接种第 1 剂乙肝疫苗；体重小于 2000g 者满 1、2、7 月龄再完成 3 剂次。" },
    { id: "hiv-exposed", name: "HIV 感染母亲所生儿童", guidance: "暂缓卡介苗直至确认未感染；严重免疫抑制时不接种含麻疹成分疫苗；减毒活疫苗按感染状态审慎处理。" },
    { id: "immunodeficiency", name: "免疫功能异常", guidance: "原则上可接种非减毒活疫苗，减毒活疫苗需结合免疫功能和临床评估决定。" },
    { id: "blood-products", name: "血液制品使用", guidance: "非减毒活疫苗、卡介苗和口服减毒活疫苗无时间间隔限制；除卡介苗外的注射类减毒活疫苗需间隔至少 3 个月。" }
  ];

  const LAUNCH_REQUIREMENTS = [
    {
      id: "registry-interface",
      category: "integration",
      title: "Registry interface receipt",
      owner: "CDC immunization program / platform integration",
      status: "site-pending",
      severity: "P0",
      evidence: ["immunization:readiness", "publicHealth:readiness", "sample child vaccination registry receipt"],
      nextAction: "Replay one formal child registry payload and archive accepted / rejected receipts."
    },
    {
      id: "birth-certificate-linkage",
      category: "data",
      title: "Birth certificate linkage",
      owner: "Maternal-child health / certificate service",
      status: "ready",
      severity: "P0",
      evidence: ["birthCertificates", "maternal-child:readiness", "immunization.html"],
      nextAction: "Confirm production certificate identifier and resident authorization mapping."
    },
    {
      id: "appointment-channel",
      category: "service",
      title: "Vaccination appointment channel",
      owner: "Vaccination clinic / citizen service team",
      status: "site-pending",
      severity: "P1",
      evidence: ["citizen.html", "phone-code login", "appointment adapter sample"],
      nextAction: "Connect the clinic appointment slot and cancellation callback sample."
    },
    {
      id: "inventory-cold-chain",
      category: "safety",
      title: "Inventory and cold-chain exception receipt",
      owner: "CDC cold-chain / vaccine stock team",
      status: "site-pending",
      severity: "P0",
      evidence: ["public health exchange task", "cold-chain exception receipt", "stock risk ledger"],
      nextAction: "Archive a cold-chain exception and stock lockout receipt for launch rehearsal."
    },
    {
      id: "adverse-event-monitoring",
      category: "safety",
      title: "Adverse event monitoring handoff",
      owner: "Vaccination clinic / AEFI monitoring",
      status: "site-pending",
      severity: "P0",
      evidence: ["AEFI receipt sample", "public-health incident desk", "onsite signoff"],
      nextAction: "Confirm AEFI escalation path and receipt fields with the vaccination unit."
    },
    {
      id: "resident-notification-consent",
      category: "citizen",
      title: "Resident notification and consent",
      owner: "Citizen service / privacy officer",
      status: "ready",
      severity: "P1",
      evidence: ["citizen.html", "citizen:launch-foundation", "privacy notice"],
      nextAction: "Confirm SMS template, guardian consent wording and opt-out path."
    },
    {
      id: "role-permission-audit",
      category: "security",
      title: "Role permission and audit boundary",
      owner: "Security administrator / platform operations",
      status: "ready",
      severity: "P0",
      evidence: ["auth.js", "audit:retention", "dataAccessLogs"],
      nextAction: "Review production roles for commission, institution and citizen access."
    },
    {
      id: "onsite-signoff-drill",
      category: "cutover",
      title: "On-site launch drill and signoff",
      owner: "Release manager / site project office",
      status: "site-pending",
      severity: "P0",
      evidence: ["release:report", "deploy:check", "launch:smoke"],
      nextAction: "Run launch smoke against the production base URL and archive the signed checklist."
    }
  ];

  const HEALTH_PROFILES = [
    { id: "routine", name: "常规儿童", description: "按出生日期、性别和既往接种记录生成国家免疫规划提醒。" },
    { id: "preterm-low-weight", name: "早产儿/低出生体重儿", description: "医学评估稳定后按实际月龄接种，乙肝和卡介苗按具体说明处理。" },
    { id: "hbsag-positive-low-weight", name: "HBsAg 阳性或不详且体重小于 2000g", description: "出生后尽早接种第 1 剂乙肝疫苗，满 1、2、7 月龄再完成 3 剂次。" },
    { id: "hiv-exposed-unknown", name: "HIV 感染母亲所生且感染状况不详", description: "卡介苗暂缓，脊灰/乙脑/甲肝减毒活疫苗禁止，麻腮风按是否严重免疫抑制评估。" },
    { id: "hiv-infected-no-severe", name: "HIV 感染且无严重免疫抑制", description: "非减毒活疫苗无特殊禁忌，卡介苗和脊灰/乙脑/甲肝减毒活疫苗禁止，麻腮风可按程序评估接种。" },
    { id: "hiv-infected-severe", name: "HIV 感染且有症状或严重免疫抑制", description: "卡介苗、脊灰/乙脑/甲肝减毒活疫苗和麻腮风疫苗禁止，非减毒活疫苗无特殊禁忌。" },
    { id: "immunodeficiency", name: "免疫功能异常或免疫抑制治疗", description: "非减毒活疫苗原则可接种，减毒活疫苗需结合免疫功能和临床评估决定。" },
    { id: "blood-products", name: "近期使用含免疫球蛋白血液制品", description: "非减毒活疫苗、卡介苗和口服减毒活疫苗无间隔限制，其他注射类减毒活疫苗需间隔至少 3 个月。" }
  ];

  const HIV_MATRIX = {
    inactivated: {
      "hiv-infected-severe": "allow",
      "hiv-infected-no-severe": "allow",
      "hiv-exposed-unknown": "allow"
    },
    bcg: {
      "hiv-infected-severe": "prohibit",
      "hiv-infected-no-severe": "prohibit",
      "hiv-exposed-unknown": "defer"
    },
    liveNotMmr: {
      "hiv-infected-severe": "prohibit",
      "hiv-infected-no-severe": "prohibit",
      "hiv-exposed-unknown": "prohibit"
    },
    mmr: {
      "hiv-infected-severe": "prohibit",
      "hiv-infected-no-severe": "allow",
      "hiv-exposed-unknown": "evaluate"
    }
  };

  const DOSES = [
    dose("HepB-1", "HepB", "乙肝疫苗", "乙型病毒性肝炎", 0, 1, "肌内注射", "10 或 20μg", "出生后 24 小时内完成", { group: "birth", recommendedBeforeMonths: 0.03 }),
    dose("HepB-2", "HepB", "乙肝疫苗", "乙型病毒性肝炎", 1, 2, "肌内注射", "10 或 20μg", "1 月龄", { minIntervalDays: 28 }),
    dose("HepB-3", "HepB", "乙肝疫苗", "乙型病毒性肝炎", 6, 3, "肌内注射", "10 或 20μg", "6 月龄，小于 12 月龄完成", { recommendedBeforeMonths: 12, minIntervalDays: 60 }),
    dose("BCG-1", "BCG", "卡介苗", "结核病", 0, 1, "皮内注射", "0.1mL", "出生时，小于 3 月龄完成", { group: "birth", recommendedBeforeMonths: 3 }),
    dose("IPV-1", "IPV", "脊灰灭活疫苗", "脊髓灰质炎", 2, 1, "肌内注射", "0.5mL", "2 月龄", { family: "polio" }),
    dose("IPV-2", "IPV", "脊灰灭活疫苗", "脊髓灰质炎", 3, 2, "肌内注射", "0.5mL", "3 月龄", { family: "polio", minIntervalDays: 28 }),
    dose("bOPV-3", "bOPV", "脊灰减毒活疫苗", "脊髓灰质炎", 4, 3, "口服", "1 粒或 2 滴", "4 月龄，小于 12 月龄完成", { family: "polio", recommendedBeforeMonths: 12, minIntervalDays: 28 }),
    dose("bOPV-4", "bOPV", "脊灰减毒活疫苗", "脊髓灰质炎", 48, 4, "口服", "1 粒或 2 滴", "4 周岁，小于 5 周岁完成", { family: "polio", recommendedBeforeMonths: 60 }),
    dose("DTaP-1", "DTaP", "百白破疫苗", "百日咳、白喉、破伤风", 2, 1, "肌内注射", "0.5mL", "2 月龄", { minIntervalDays: 28 }),
    dose("DTaP-2", "DTaP", "百白破疫苗", "百日咳、白喉、破伤风", 4, 2, "肌内注射", "0.5mL", "4 月龄", { minIntervalDays: 28 }),
    dose("DTaP-3", "DTaP", "百白破疫苗", "百日咳、白喉、破伤风", 6, 3, "肌内注射", "0.5mL", "6 月龄，小于 12 月龄完成", { recommendedBeforeMonths: 12, minIntervalDays: 28 }),
    dose("DTaP-4", "DTaP", "百白破疫苗", "百日咳、白喉、破伤风", 18, 4, "肌内注射", "0.5mL", "18 月龄，小于 24 月龄完成", { recommendedBeforeMonths: 24, minIntervalMonths: 6 }),
    dose("DTaP-5", "DTaP", "百白破疫苗", "百日咳、白喉、破伤风", 72, 5, "肌内注射", "0.5mL", "6 周岁，小于 7 周岁完成", { recommendedBeforeMonths: 84, minIntervalMonths: 12 }),
    dose("MMR-1", "MMR", "麻腮风疫苗", "麻疹、风疹、流行性腮腺炎", 8, 1, "皮下注射", "0.5mL", "8 月龄，小于 12 月龄完成", { liveInjection: true, recommendedBeforeMonths: 12 }),
    dose("MMR-2", "MMR", "麻腮风疫苗", "麻疹、风疹、流行性腮腺炎", 18, 2, "皮下注射", "0.5mL", "18 月龄，小于 24 月龄完成", { liveInjection: true, recommendedBeforeMonths: 24, minIntervalDays: 28 }),
    dose("JE-L-1", "JE-L", "乙脑减毒活疫苗", "流行性乙型脑炎", 8, 1, "皮下注射", "0.5mL", "8 月龄，小于 12 月龄完成", { optionGroup: "JE", defaultOption: true, liveInjection: true, recommendedBeforeMonths: 12 }),
    dose("JE-L-2", "JE-L", "乙脑减毒活疫苗", "流行性乙型脑炎", 24, 2, "皮下注射", "0.5mL", "2 周岁，小于 3 周岁完成", { optionGroup: "JE", defaultOption: true, liveInjection: true, recommendedBeforeMonths: 36, minIntervalMonths: 12 }),
    dose("JE-I-1", "JE-I", "乙脑灭活疫苗", "流行性乙型脑炎", 8, 1, "肌内注射", "0.5mL", "8 月龄第 1 剂", { optionGroup: "JE", alternateOption: true }),
    dose("JE-I-2", "JE-I", "乙脑灭活疫苗", "流行性乙型脑炎", 8, 2, "肌内注射", "0.5mL", "第 1、2 剂间隔 7-10 天", { optionGroup: "JE", alternateOption: true, dueOffsetDays: 10 }),
    dose("JE-I-3", "JE-I", "乙脑灭活疫苗", "流行性乙型脑炎", 24, 3, "肌内注射", "0.5mL", "2 周岁，小于 3 周岁完成", { optionGroup: "JE", alternateOption: true, recommendedBeforeMonths: 36 }),
    dose("JE-I-4", "JE-I", "乙脑灭活疫苗", "流行性乙型脑炎", 72, 4, "肌内注射", "0.5mL", "6 周岁，小于 7 周岁完成", { optionGroup: "JE", alternateOption: true, recommendedBeforeMonths: 84 }),
    dose("MPSV-A-1", "MPSV-A", "A 群流脑多糖疫苗", "流行性脑脊髓膜炎", 6, 1, "皮下注射", "0.5mL", "6 月龄，小于 12 月龄完成", { recommendedBeforeMonths: 12 }),
    dose("MPSV-A-2", "MPSV-A", "A 群流脑多糖疫苗", "流行性脑脊髓膜炎", 9, 2, "皮下注射", "0.5mL", "9 月龄，小于 24 月龄完成", { recommendedBeforeMonths: 24, minIntervalMonths: 3 }),
    dose("MPSV-AC-3", "MPSV-AC", "A 群 C 群流脑多糖疫苗", "流行性脑脊髓膜炎", 36, 3, "皮下注射", "0.5mL", "3 周岁，小于 4 周岁完成", { recommendedBeforeMonths: 48, minIntervalMonths: 12 }),
    dose("MPSV-AC-4", "MPSV-AC", "A 群 C 群流脑多糖疫苗", "流行性脑脊髓膜炎", 72, 4, "皮下注射", "0.5mL", "6 周岁，小于 7 周岁完成", { recommendedBeforeMonths: 84, minIntervalMonths: 36 }),
    dose("HepA-L-1", "HepA-L", "甲肝减毒活疫苗", "甲型病毒性肝炎", 18, 1, "皮下注射", "0.5 或 1.0mL", "18 月龄，小于 24 月龄完成", { optionGroup: "HepA", defaultOption: true, liveInjection: true, recommendedBeforeMonths: 24 }),
    dose("HepA-I-1", "HepA-I", "甲肝灭活疫苗", "甲型病毒性肝炎", 18, 1, "肌内注射", "0.5mL", "18 月龄，小于 24 月龄完成", { optionGroup: "HepA", alternateOption: true, recommendedBeforeMonths: 24 }),
    dose("HepA-I-2", "HepA-I", "甲肝灭活疫苗", "甲型病毒性肝炎", 24, 2, "肌内注射", "0.5mL", "2 周岁，小于 3 周岁完成", { optionGroup: "HepA", alternateOption: true, recommendedBeforeMonths: 36, minIntervalMonths: 6 }),
    dose("2vHPV-1", "2vHPV", "双价人乳头瘤病毒疫苗", "人乳头瘤病毒感染", 156, 1, "肌内注射", "0.5mL", "13 周岁女孩，第 1 剂小于 14 周岁完成", { femaleOnly: true, recommendedBeforeMonths: 168 }),
    dose("2vHPV-2", "2vHPV", "双价人乳头瘤病毒疫苗", "人乳头瘤病毒感染", 162, 2, "肌内注射", "0.5mL", "第 1、2 剂间隔 6 个月，12 个月内完成", { femaleOnly: true, recommendedBeforeMonths: 168, minIntervalMonths: 6 })
  ];

  const CONDITIONAL_DOSES = {
    "hbsag-positive-low-weight": [
      dose("HepB-LBW-3", "HepB", "乙肝疫苗", "乙型病毒性肝炎", 2, 3, "肌内注射", "10 或 20μg", "HBsAg 阳性或不详母亲且体重小于 2000g：满 2 月龄补齐后续程序", { conditionalProfile: "hbsag-positive-low-weight", minIntervalDays: 28 }),
      dose("HepB-LBW-4", "HepB", "乙肝疫苗", "乙型病毒性肝炎", 7, 4, "肌内注射", "10 或 20μg", "HBsAg 阳性或不详母亲且体重小于 2000g：满 7 月龄完成后续第 3 剂", { conditionalProfile: "hbsag-positive-low-weight", recommendedBeforeMonths: 12, minIntervalDays: 60 })
    ]
  };

  function dose(id, code, vaccine, disease, ageMonths, doseNo, route, amount, timing, extra = {}) {
    return { id, code, vaccine, disease, ageMonths, doseNo, route, amount, timing, ...extra };
  }

  function parseDate(value) {
    if (!value) return null;
    const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return null;
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  }

  function formatDate(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function addMonths(date, months) {
    const copy = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const day = copy.getDate();
    copy.setMonth(copy.getMonth() + months);
    if (copy.getDate() < day) copy.setDate(0);
    return copy;
  }

  function addDays(date, days) {
    const copy = new Date(date);
    copy.setDate(copy.getDate() + days);
    return copy;
  }

  function daysBetween(a, b) {
    return Math.floor((a.getTime() - b.getTime()) / 86400000);
  }

  function childFromCertificate(certificate) {
    if (!certificate) return null;
    return {
      id: certificate.residentId || certificate.newbornResidentId || certificate.id,
      name: certificate.newbornName || "新生儿",
      gender: certificate.newbornGender || "",
      birthDate: String(certificate.birthDateTime || "").slice(0, 10),
      certificateNo: certificate.certificateNo || "",
      sourceId: certificate.id
    };
  }

  function defaultDoseFilter(doseItem, child, options = {}) {
    if (doseItem.femaleOnly && !/女|female/i.test(child.gender || "")) return false;
    const variants = options.variants || { JE: "JE-L", HepA: "HepA-L" };
    if (doseItem.optionGroup) return variants[doseItem.optionGroup] === doseItem.code;
    return true;
  }

  function getDoseRules(options = {}) {
    const healthProfile = options.healthProfile || "routine";
    const base = healthProfile === "hbsag-positive-low-weight"
      ? DOSES.filter((item) => item.id !== "HepB-3")
      : DOSES.slice();
    return base.concat(CONDITIONAL_DOSES[healthProfile] || []);
  }

  function recordMatchesDose(record, doseItem) {
    const source = `${record.vaccineCode || ""} ${record.name || ""} ${record.result || ""} ${record.meta?.vaccineCode || ""} ${record.meta?.doseId || ""}`;
    if (record.meta?.doseId === doseItem.id) return true;
    return source.includes(doseItem.code) || source.includes(doseItem.vaccine);
  }

  function buildPlan(child, options = {}) {
    const birthDate = parseDate(child?.birthDate || child?.birthDateTime);
    if (!birthDate) return { child, rows: [], summary: emptySummary(), nextDose: null };
    const referenceDate = parseDate(options.referenceDate || POLICY.referenceDate) || new Date();
    const records = Array.isArray(options.records) ? options.records : [];
    const healthProfile = options.healthProfile || "routine";
    const rows = getDoseRules(options)
      .filter((doseItem) => defaultDoseFilter(doseItem, child, options))
      .map((doseItem) => {
        const dueDate = addDays(addMonths(birthDate, doseItem.ageMonths), doseItem.dueOffsetDays || 0);
        const matchedRecord = records.find((record) => recordMatchesDose(record, doseItem));
        const overdueDays = daysBetween(referenceDate, dueDate);
        const safety = assessDoseForHealthProfile(doseItem, healthProfile);
        let status = "未到期";
        if (matchedRecord) status = "已接种";
        else if (overdueDays > 0) status = "逾期未种";
        else if (overdueDays >= -30) status = "30天内到期";
        return {
          ...doseItem,
          dueDate: formatDate(dueDate),
          status,
          overdueDays: Math.max(0, overdueDays),
          completedAt: matchedRecord?.date || "",
          sourceRecordId: matchedRecord?.id || "",
          safetyAction: safety.action,
          safetyLabel: safety.label,
          safetyReason: safety.reason,
          childName: child.name
        };
      })
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id));
    const summary = summarizePlan(rows);
    return {
      policy: POLICY,
      child,
      healthProfile,
      rows,
      summary,
      nextDose: rows.find((row) => row.status !== "已接种" && row.safetyAction !== "prohibit") || null,
      principles: GENERAL_PRINCIPLES,
      healthProfiles: HEALTH_PROFILES,
      specialHealthRules: SPECIAL_HEALTH_RULES,
      launchRequirements: LAUNCH_REQUIREMENTS
    };
  }

  function assessDoseForHealthProfile(doseItem, healthProfile = "routine") {
    const profile = healthProfile || "routine";
    if (profile === "routine") return action("routine", "按程序", "按常规免疫程序提醒。");
    if (profile === "preterm-low-weight") {
      if (doseItem.code === "HepB" || doseItem.code === "BCG") return action("evaluate", "需评估", "早产儿或低出生体重儿需结合医学稳定性和本疫苗具体说明处理。");
      return action("routine", "按程序", "医学评估稳定且未患需住院治疗严重疾病者，按出生后实际月龄接种。");
    }
    if (profile === "hbsag-positive-low-weight") {
      if (doseItem.code === "HepB") return action("special", "特殊程序", "出生后尽早接种第 1 剂，满 1、2、7 月龄再完成 3 剂次。");
      if (doseItem.code === "BCG") return action("evaluate", "需评估", "低体重儿卡介苗按医学稳定性和胎龄评估后接种。");
      return action("routine", "按程序", "除乙肝专项安排外，其他疫苗按月龄和接种单位评估执行。");
    }
    if (profile.startsWith("hiv-")) {
      const group = hivDoseGroup(doseItem);
      const matrixAction = HIV_MATRIX[group]?.[profile] || "allow";
      if (matrixAction === "prohibit") return action("prohibit", "禁种", "依据 HIV 感染母亲所生儿童接种建议表，本疫苗在该状态下禁止接种。");
      if (matrixAction === "defer") return action("defer", "暂缓", "感染状况不详时暂缓，确认 HIV 抗体阴性后再补种，确认阳性不予接种。");
      if (matrixAction === "evaluate") return action("evaluate", "需评估", "需由医疗机构确认是否有严重免疫抑制后再执行。");
      return action("routine", "无特殊禁忌", "依据 HIV 暴露/感染儿童附表，本类疫苗无特殊禁忌。");
    }
    if (profile === "immunodeficiency") {
      if (doseItem.liveInjection || doseItem.code === "BCG" || doseItem.code === "bOPV") return action("evaluate", "需评估", "免疫功能异常者接种减毒活疫苗需综合免疫功能和临床状态决定。");
      return action("routine", "可接种", "免疫功能异常者原则上可以接种非减毒活疫苗。");
    }
    if (profile === "blood-products") {
      if (doseItem.liveInjection && doseItem.code !== "BCG") return action("defer", "间隔3个月", "使用含免疫球蛋白血液制品后，除卡介苗外的注射类减毒活疫苗需间隔至少 3 个月。");
      return action("routine", "无间隔限制", "非减毒活疫苗、卡介苗和口服减毒活疫苗无时间间隔限制。");
    }
    return action("routine", "按程序", "按常规免疫程序提醒。");
  }

  function action(actionId, label, reason) {
    return { action: actionId, label, reason };
  }

  function hivDoseGroup(doseItem) {
    if (doseItem.code === "BCG") return "bcg";
    if (doseItem.code === "MMR") return "mmr";
    if (["bOPV", "JE-L", "HepA-L"].includes(doseItem.code)) return "liveNotMmr";
    return "inactivated";
  }

  function summarizePlan(rows) {
    return rows.reduce((acc, row) => {
      acc.total += 1;
      if (row.status === "已接种") acc.completed += 1;
      if (row.status === "逾期未种") acc.overdue += 1;
      if (row.status === "30天内到期") acc.dueSoon += 1;
      if (row.liveInjection) acc.liveInjection += 1;
      if (row.safetyAction === "prohibit") acc.prohibited += 1;
      if (row.safetyAction === "defer") acc.deferred += 1;
      if (row.safetyAction === "evaluate") acc.needsEvaluation += 1;
      if (row.safetyAction === "special") acc.specialProgram += 1;
      return acc;
    }, emptySummary());
  }

  function emptySummary() {
    return { total: 0, completed: 0, overdue: 0, dueSoon: 0, liveInjection: 0, prohibited: 0, deferred: 0, needsEvaluation: 0, specialProgram: 0 };
  }

  function buildPlansFromCertificates(certificates = [], personalRecords = [], options = {}) {
    return certificates
      .map(childFromCertificate)
      .filter(Boolean)
      .map((child) => buildPlan(child, {
        ...options,
        records: personalRecords.filter((record) => record.residentId === child.id || record.sourceId === child.sourceId || record.meta?.birthCertificateId === child.sourceId)
      }));
  }

  return {
    POLICY,
    DOSES,
    GENERAL_PRINCIPLES,
    HEALTH_PROFILES,
    LAUNCH_REQUIREMENTS,
    SPECIAL_HEALTH_RULES,
    assessDoseForHealthProfile,
    addDays,
    addMonths,
    buildPlan,
    buildPlansFromCertificates,
    childFromCertificate,
    formatDate,
    getDoseRules,
    parseDate,
    summarizePlan
  };
});
