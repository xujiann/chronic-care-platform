(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) {
    root.CitizenUiZh = api;
    if (root.document) api.install(root.document);
  }
}(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const EXACT_TEXT = new Map([
    ["active", "有效"],
    ["allowed", "已允许"],
    ["approved", "已通过"],
    ["archived", "已归档"],
    ["assessed-and-approved", "已评估并通过"],
    ["clean", "安全"],
    ["clinical", "医疗机构可信来源"],
    ["clinical-service", "医疗服务可信来源"],
    ["completed", "已完成"],
    ["confirmed", "已确认"],
    ["dispatched", "已派单"],
    ["in_app", "站内消息"],
    ["legacy-record", "历史记录"],
    ["matched", "已匹配"],
    ["monthly", "每月"],
    ["new-contract", "新签约"],
    ["not-due", "暂未到续约期"],
    ["pending", "待处理"],
    ["pending-verification", "待核验"],
    ["public-health", "基本公共卫生服务"],
    ["public-health-plus", "基本公共卫生增强服务"],
    ["quarterly", "每季度"],
    ["scheduled", "已安排"],
    ["system", "系统"],
    ["unknown", "待确认"],
    ["yearly", "每年"]
  ]);

  const PHRASE_REPLACEMENTS = [
    ["Dalian Central Hospital outpatient clinic demo", "大连市中心医院门诊"],
    ["Dalian Central Hospital teleconsultation report is overdue; confirm report callback or manual reconciliation.", "大连市中心医院远程会诊报告已逾期，请核对报告回传或进行人工对账。"],
    ["Receiving feedback from Dalian Central Hospital: Specialist slot reserved; review current prescription before video consultation.", "已收到大连市中心医院反馈：专家号源已预留，视频会诊前请复核当前处方。"],
    ["Receiving feedback from Dalian Central Hospital and waiting for the video consultation report.", "已收到大连市中心医院反馈，正在等待视频会诊报告。"],
    ["Resident feedback and self-monitoring have been delivered to the family doctor team.", "居民反馈和自测结果已送达家庭医生团队。"],
    ["Chronic follow-up feedback requires review", "慢病随访反馈需要复核"],
    ["Teleconsultation feedback returned", "远程会诊反馈已返回"],
    ["Teleconsultation SLA reminder", "远程会诊时限提醒"],
    ["Referral teleconsultation resident authorization", "转诊远程会诊居民授权"],
    ["research dataset sandbox readiness evidence", "科研数据沙箱就绪证据"],
    ["researchSandbox", "科研数据沙箱"],
    ["family doctor application", "家庭医生签约申请"],
    ["family doctor contract", "家庭医生签约合同"],
    ["wound care home service", "伤口护理上门服务"],
    ["Nurse Sun", "孙护士"],
    ["Doctor Wang", "王医生"],
    ["Dalian Central Hospital", "大连市中心医院"],
    ["Cardiology", "心内科"],
    ["Endocrinology", "内分泌科"],
    ["Ophthalmology", "眼科"],
    ["internetNursingOrders", "互联网护理订单"],
    ["escortServiceOrders", "陪诊服务订单"],
    ["registrationOrders", "挂号订单"],
    ["phase2FamilyDoctorApplications", "家庭医生签约申请"],
    ["phase2FamilyDoctorContracts", "家庭医生签约合同"],
    ["personalRecords", "个人健康记录"],
    ["serviceOrders", "服务订单"],
    ["dataAccessLogs", "数据访问记录"],
    ["authorizations", "授权记录"],
    ["imaging-report", "影像报告"],
    ["emr-summary", "电子病历摘要"],
    ["health-record-summary", "健康档案摘要"],
    ["pharmacy-service", "药房服务"],
    ["home-care-followup-plan", "居家照护随访计划"],
    ["elderly-care", "老年照护"],
    ["liability-insurance-active", "责任保险有效"],
    ["refunded-demo", "已完成演示退款"],
    ["not-required", "无需处理"],
    ["offer-pending", "号源待确认"],
    ["pending-resident", "等待居民确认"],
    ["resident cancellation from citizen portal", "居民从居民端取消"],
    ["Resident registration journey action.", "居民挂号流程操作。"]
  ].sort((left, right) => right[0].length - left[0].length);

  const TERM_REPLACEMENTS = [
    [/\bSHA-256\b/gi, "摘要校验"],
    [/\bDICOM\b/g, "医学影像原图"],
    [/\bPACS\b/g, "医学影像系统"],
    [/\bEMR\b/g, "电子病历系统"],
    [/\bLIS\b/g, "检验信息系统"],
    [/\bHIS\b/g, "医院信息系统"],
    [/\bKMS\b/g, "密钥管理系统"],
    [/\bSIEM\b/g, "安全信息与事件管理系统"],
    [/\bOIDC\b/g, "统一身份认证"],
    [/\bSMS\b/g, "短信"],
    [/\bHTTPS\b/g, "加密网络连接"],
    [/\bAPP\b/g, "手机应用"],
    [/\bPDF\b/g, "便携文档"],
    [/\bJSON\b/g, "标准数据文件"],
    [/\bECG\b/g, "心电图"],
    [/\bCT\b/g, "计算机断层扫描"],
    [/\bBMI\b/g, "体质指数"],
    [/\bBP\b/g, "血压"],
    [/\bV1\b/g, "第一版"],
    [/\bV2\b/g, "第二版"],
    [/C端/g, "居民端"],
    [/\bOT\b/g, "其他影像"],
    [/mmHg/gi, "毫米汞柱"],
    [/mmol\/L/gi, "毫摩尔/升"],
    [/kg\/m²/gi, "千克/平方米"],
    [/kg\/m2/gi, "千克/平方米"],
    [/MB/g, "兆字节"],
    [/\bpx\b/gi, "像素"]
  ];

  function replaceStandaloneStatuses(value) {
    return value.replace(/\b(active|allowed|approved|archived|assessed-and-approved|clean|clinical-service|clinical|completed|confirmed|dispatched|in_app|legacy-record|matched|monthly|new-contract|not-due|pending-verification|pending|public-health-plus|public-health|quarterly|scheduled|system|unknown|yearly)\b/gi, (match) => (
      EXACT_TEXT.get(match.toLowerCase()) || match
    ));
  }

  function translateVisibleText(value) {
    let output = String(value ?? "");
    if (!/[A-Za-z]/.test(output)) return output;
    for (const [source, target] of PHRASE_REPLACEMENTS) output = output.split(source).join(target);
    const protectedIdentifiers = [];
    output = output.replace(/\b(?=[A-Z0-9-]*\d)[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+\b/g, (match) => {
      if (match.toUpperCase() === "SHA-256") return match;
      const placeholder = `\uE000${protectedIdentifiers.length}\uE001`;
      protectedIdentifiers.push(match);
      return placeholder;
    });
    for (const [pattern, target] of TERM_REPLACEMENTS) output = output.replace(pattern, target);
    output = replaceStandaloneStatuses(output);
    return output.replace(/\uE000(\d+)\uE001/g, (_, index) => protectedIdentifiers[Number(index)]);
  }

  function localizeTextNode(node) {
    const parentName = node.parentElement?.tagName;
    if (["SCRIPT", "STYLE", "CODE", "PRE"].includes(parentName)) return;
    const translated = translateVisibleText(node.nodeValue);
    if (translated !== node.nodeValue) node.nodeValue = translated;
  }

  function localizeElementAttributes(element) {
    for (const attribute of ["aria-label", "placeholder", "title"]) {
      const value = element.getAttribute?.(attribute);
      if (!value) continue;
      const translated = translateVisibleText(value);
      if (translated !== value) element.setAttribute(attribute, translated);
    }
  }

  function localizeTree(documentRef, rootNode = documentRef.documentElement) {
    if (!rootNode) return;
    if (rootNode.nodeType === 3) {
      localizeTextNode(rootNode);
      return;
    }
    if (rootNode.nodeType !== 1 && rootNode.nodeType !== 9 && rootNode.nodeType !== 11) return;
    if (rootNode.nodeType === 1) localizeElementAttributes(rootNode);
    const walker = documentRef.createTreeWalker(rootNode, 4);
    let node = walker.nextNode();
    while (node) {
      localizeTextNode(node);
      node = walker.nextNode();
    }
    rootNode.querySelectorAll?.("[aria-label], [placeholder], [title]").forEach(localizeElementAttributes);
  }

  function install(documentRef) {
    if (!documentRef || documentRef.documentElement?.dataset.citizenChineseUiInstalled === "true") return null;
    documentRef.documentElement.dataset.citizenChineseUiInstalled = "true";
    localizeTree(documentRef);
    if (typeof MutationObserver === "undefined") return null;
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "characterData") localizeTextNode(mutation.target);
        if (mutation.type === "attributes") localizeElementAttributes(mutation.target);
        mutation.addedNodes?.forEach((node) => localizeTree(documentRef, node));
      }
    });
    observer.observe(documentRef.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["aria-label", "placeholder", "title"]
    });
    return observer;
  }

  return {
    EXACT_TEXT,
    translateVisibleText,
    localizeTree,
    install
  };
}));
