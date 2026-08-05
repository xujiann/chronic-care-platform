(function bootstrapRegionalContext(global) {
  "use strict";

  const FALLBACK = Object.freeze({
    schemaVersion: "regional-public-context-v1",
    regionCode: "template",
    regionName: "通用地区模板",
    locale: "zh-CN",
    timezone: "Asia/Shanghai",
    features: Object.freeze({}),
    organizations: Object.freeze({
      healthAuthority: Object.freeze({ code: "REGION-HEALTH", name: "地区卫生健康主管部门", shortName: "地区卫健主管部门", type: "health_admin" }),
      insuranceAuthority: Object.freeze({ code: "REGION-INSURANCE", name: "地区医疗保障主管部门", shortName: "地区医保主管部门", type: "insurance_bureau" }),
      insuranceCenter: Object.freeze({ code: "REGION-INSURANCE-CENTER", name: "地区医疗保障经办中心", shortName: "地区医保中心", type: "insurance_center" }),
      centralHospital: Object.freeze({ code: "MR1", name: "区域中心医院", shortName: "中心医院", type: "medical_institution" }),
      friendshipHospital: Object.freeze({ code: "MR2", name: "区域第二急救医院", shortName: "第二急救医院", type: "medical_institution" }),
      universityHospital: Object.freeze({ code: "REGION-HOSPITAL-UNIVERSITY", name: "区域大学附属医院", shortName: "大学附属医院", type: "medical_institution" }),
      womenChildrenCenter: Object.freeze({ code: "REGION-HOSPITAL-MCH", name: "区域妇女儿童医疗中心", shortName: "妇儿医疗中心", type: "medical_institution" }),
      bloodCenter: Object.freeze({ code: "REGION-BLOOD-CENTER", name: "区域血液中心", shortName: "血液中心", type: "blood_center" }),
      healthCity: Object.freeze({ code: "REGION-HEALTH-CITY", name: "区域健康城市平台", shortName: "健康城市平台", type: "city" }),
      examinationCenter: Object.freeze({ code: "REGION-EXAM-CENTER", name: "区域健康体检中心", shortName: "健康体检中心", type: "medical_institution" }),
      districtHospital: Object.freeze({ code: "REGION-HOSPITAL-DISTRICT", name: "区县中心医院", shortName: "区县医院", type: "medical_institution" }),
      communityHealthCenter: Object.freeze({ code: "MR3", name: "示范社区卫生服务中心", shortName: "社区卫生服务中心", type: "primary_care_institution" })
    }),
    areas: Object.freeze({
      primaryDistrict: Object.freeze({ code: "REGION-DISTRICT-01", name: "示范一区", shortName: "示范一区" }),
      secondaryDistrict: Object.freeze({ code: "REGION-DISTRICT-02", name: "示范二区", shortName: "示范二区" }),
      tertiaryDistrict: Object.freeze({ code: "REGION-DISTRICT-03", name: "示范三区", shortName: "示范三区" }),
      laboratoryDistrict: Object.freeze({ code: "REGION-DISTRICT-04", name: "示范四区", shortName: "示范四区" }),
      peripheralDistrict: Object.freeze({ code: "REGION-DISTRICT-05", name: "示范五区", shortName: "示范五区" })
    }),
    terms: Object.freeze({
      platformName: "区域卫生健康信息平台",
      platformShortName: "区域卫健平台",
      citizenPortalName: "区域居民健康服务",
      governmentUnifiedEntry: "地区政务服务统一入口",
      statisticsTitle: "地区卫生健康统计提要",
      regionLabel: "当前地区",
      demonstrationDistrict: "示范区"
    }),
    localization: Object.freeze({
      legacyReplacements: Object.freeze({
        "Dalian Women and Children Medical Center": "区域妇女儿童医疗中心",
        "Dalian Medical University Affiliated Hospital": "区域大学附属医院",
        "Dalian Medical University Hospital": "区域大学附属医院",
        "Dalian Central Hospital": "区域中心医院",
        "Xinghaiwan Community Health Service Center": "示范社区卫生服务中心",
        "大连医科大学附属医院": "区域大学附属医院",
        "大连市妇女儿童医疗中心": "区域妇女儿童医疗中心",
        "大连市卫生健康委员会": "地区卫生健康主管部门",
        "大连市卫生健康委": "地区卫生健康主管部门",
        "大连市医保中心": "地区医疗保障经办中心",
        "大连市医保局": "地区医疗保障主管部门",
        "大连市中心医院": "区域中心医院",
        "大连市友谊医院": "区域第二急救医院",
        "大连市普兰店区中心医院": "区县中心医院",
        "普兰店区中心医院": "区县中心医院",
        "青泥洼桥社区卫生服务中心": "示范社区卫生服务中心",
        "大连市血液中心": "区域血液中心",
        "大连市健康城市平台": "区域健康城市平台",
        "大连健康体检中心": "区域健康体检中心",
        "健康大连": "区域居民健康服务",
        "e 大连": "地区政务服务"
      })
    }),
    productionReady: false
  });

  let current = FALLBACK;
  let observer = null;

  function isHttpRuntime() {
    return global.location && /^https?:$/.test(global.location.protocol);
  }

  function validContext(value) {
    return value && value.schemaVersion === "regional-public-context-v1"
      && typeof value.regionCode === "string"
      && value.organizations && value.terms;
  }

  const readyPromise = isHttpRuntime() && typeof global.fetch === "function"
    ? global.fetch("/api/regional/context", { credentials: "same-origin", cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error(`regional context request failed: ${response.status}`);
        return response.json();
      })
      .then((value) => {
        if (!validContext(value)) throw new Error("regional context response is invalid");
        current = Object.freeze(value);
        return current;
      })
      .catch(() => current)
    : Promise.resolve(current);

  function replacements() {
    return Object.entries(current.localization?.legacyReplacements || {})
      .filter(([source, target]) => source && typeof target === "string")
      .sort(([left], [right]) => right.length - left.length);
  }

  function localizeText(value) {
    return replacements().reduce(
      (result, [source, target]) => result.replaceAll(source, target),
      String(value == null ? "" : value)
    );
  }

  function localize(value, depth) {
    const level = Number(depth || 0);
    if (level > 24) throw new TypeError("regional client payload is too deeply nested");
    if (typeof value === "string") return localizeText(value);
    if (Array.isArray(value)) return value.map((item) => localize(item, level + 1));
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, localize(nested, level + 1)]));
  }

  function organization(id) {
    return current.organizations?.[id] || FALLBACK.organizations[id] || null;
  }

  function area(id) {
    return current.areas?.[id] || FALLBACK.areas[id] || null;
  }

  function term(id) {
    return current.terms?.[id] || FALLBACK.terms[id] || "";
  }

  function localizeElement(element) {
    if (!element || element.nodeType !== 1 || ["SCRIPT", "STYLE", "NOSCRIPT"].includes(element.tagName)) return;
    for (const attribute of ["aria-label", "placeholder", "title", "value"]) {
      if (!element.hasAttribute(attribute)) continue;
      const before = element.getAttribute(attribute);
      const after = localizeText(before);
      if (after !== before) element.setAttribute(attribute, after);
    }
    if (element.dataset.regionalTerm) element.textContent = term(element.dataset.regionalTerm);
    if (element.dataset.regionalOrganization) {
      element.textContent = organization(element.dataset.regionalOrganization)?.name || "";
    }
  }

  function applyDocument(root) {
    if (!root || !global.document || typeof global.document.createTreeWalker !== "function") return;
    const documentRoot = root.nodeType === 9 ? root.documentElement : root;
    if (!documentRoot) return;
    localizeElement(documentRoot);
    const walker = global.document.createTreeWalker(
      documentRoot,
      global.NodeFilter.SHOW_ELEMENT | global.NodeFilter.SHOW_TEXT
    );
    let node = walker.nextNode();
    while (node) {
      if (node.nodeType === 1) {
        localizeElement(node);
      } else if (node.nodeType === 3 && !["SCRIPT", "STYLE", "NOSCRIPT"].includes(node.parentElement?.tagName)) {
        const after = localizeText(node.nodeValue);
        if (after !== node.nodeValue) node.nodeValue = after;
      }
      node = walker.nextNode();
    }
    global.document.documentElement.dataset.regionCode = current.regionCode;
  }

  function observeDocument() {
    if (observer || typeof global.MutationObserver !== "function" || !global.document?.documentElement) return;
    observer = new global.MutationObserver((mutations) => {
      mutations.forEach((mutation) => mutation.addedNodes.forEach((node) => {
        if (node.nodeType === 1) applyDocument(node);
        if (node.nodeType === 3) {
          const after = localizeText(node.nodeValue);
          if (after !== node.nodeValue) node.nodeValue = after;
        }
      }));
    });
    observer.observe(global.document.documentElement, { childList: true, subtree: true });
  }

  const api = Object.freeze({
    ready: () => readyPromise,
    get current() {
      return current;
    },
    area,
    organization,
    term,
    localize,
    localizeText,
    applyDocument
  });
  global.HealthRegionalContext = api;

  if (global.document) {
    global.document.addEventListener("DOMContentLoaded", async () => {
      await readyPromise;
      applyDocument(global.document);
      observeDocument();
    });
  }
})(typeof window === "undefined" ? globalThis : window);
