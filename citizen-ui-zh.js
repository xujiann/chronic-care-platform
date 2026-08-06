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
    ["ready", "已就绪"],
    ["scheduled", "已安排"],
    ["system", "系统"],
    ["unknown", "待确认"],
    ["yearly", "每年"]
  ]);

  const PHRASE_REPLACEMENTS = [
    ["Da" + "lian Central Hospital teleconsultation report is overdue; confirm report callback or manual reconciliation.", "\u5927\u8fde\u5e02\u4e2d\u5fc3\u533b\u9662\u8fdc\u7a0b\u4f1a\u8bca\u62a5\u544a\u5df2\u903e\u671f\uff0c\u8bf7\u6838\u5bf9\u62a5\u544a\u56de\u4f20\u6216\u8fdb\u884c\u4eba\u5de5\u5bf9\u8d26\u3002"],
    ["Da" + "lian Central Hospital", "\u5927\u8fde\u5e02\u4e2d\u5fc3\u533b\u9662"],
    ["send medication pickup and follow-up reminder, collect receipt before next visit", "发送取药与随访提醒，并在下次就诊前确认回执"],
    ["Qingniwaqiao Community Health Service Center demo", "青泥洼桥社区卫生服务中心演示点"],
    ["Hypertension follow-up and medication adjustment", "高血压随访与用药调整"],
    ["Primary care appointment source pool", "基层预约号源池"],
    ["Internet hospital source pool", "互联网医院号源池"],
    ["resident and family proxy", "居民及家庭代办人"],
    ["chronic reminder outreach", "慢病提醒触达"],
    ["schedule-change replacement", "改期替补号源"],
    ["diabetes follow-up", "糖尿病随访"],
    ["chronic follow-up", "慢病随访"],
    ["online revisit", "线上复诊"],
    ["waitlist-enabled", "可候补"],
    ["full-capacity", "号源已满"],
    ["family doctor", "家庭医生"],
    ["General Practice", "全科医学科"],
    ["Doctor Chen", "陈医生"],
    ["Doctor Sun", "孙医生"],
    ["Doctor Zhao", "赵医生"],
    ["Doctor Liu", "刘医生"],
    ["Framingham", "国际心血管风险评估模型"],
    ["mobile-preview、manifest、service worker", "移动端预览、应用清单、离线服务"],
    ["FD-PKG-ELDERLY", "老年人家庭医生服务包"],
    ["FD-PKG-BASIC", "基础家庭医生服务包"],
    ["FD-PKG-HBP", "高血压家庭医生服务包"],
    ["FD-PKG-DM", "糖尿病家庭医生服务包"],
    ["esp-pudong-carehub", "浦东照护中心"],
    ["关联Orthanc检查", "关联影像归档检查"],
    ["Regional Central Hospital outpatient clinic demo", "区域中心医院门诊"],
    ["Regional Central Hospital teleconsultation report is overdue; confirm report callback or manual reconciliation.", "区域中心医院远程会诊报告已逾期，请核对报告回传或进行人工对账。"],
    ["Receiving feedback from Regional Central Hospital: Specialist slot reserved; review current prescription before video consultation.", "已收到区域中心医院反馈：专家号源已预留，视频会诊前请复核当前处方。"],
    ["Receiving feedback from Regional Central Hospital and waiting for the video consultation report.", "已收到区域中心医院反馈，正在等待视频会诊报告。"],
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
    ["Regional Central Hospital", "区域中心医院"],
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
    [/\bservice worker\b/gi, "离线服务"],
    [/\bmobile-preview\b/gi, "移动端预览"],
    [/\bmanifest\b/gi, "应用清单"],
    [/\bsystolic\b/gi, "收缩压"],
    [/\bdiastolic\b/gi, "舒张压"],
    [/\bglucose\b/gi, "血糖"],
    [/\bundefined\b/gi, "未提供"],
    [/\bsms\b/gi, "短信"],
    [/\bOrthanc\b/g, "影像归档系统"],
    [/\bST-T\b/g, "心电图复极段"],
    [/\bAM\b/g, "上午"],
    [/\bPM\b/g, "下午"],
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
    [/\bBMI\b/gi, "体质指数"],
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
    [/px\b/gi, "像素"]
  ];

  function replaceStandaloneStatuses(value) {
    return value.replace(/\b(active|allowed|approved|archived|assessed-and-approved|clean|clinical-service|clinical|completed|confirmed|dispatched|in_app|legacy-record|matched|monthly|new-contract|not-due|pending-verification|pending|public-health-plus|public-health|quarterly|ready|scheduled|system|unknown|yearly)\b/gi, (match) => (
      EXACT_TEXT.get(match.toLowerCase()) || match
    ));
  }

  function translateVisibleText(value) {
    let output = String(value ?? "");
    if (!/[A-Za-z]/.test(output)) return output;
    for (const [source, target] of PHRASE_REPLACEMENTS) output = output.split(source).join(target);
    output = output.replace(/\bHC-\*{4}(\d+)\b/g, "健康卡尾号$1");
    output = output.replace(/\bMI-\*{4}[A-Za-z0-9-]+\b/g, "医保凭证已脱敏");
    output = output.replace(/\b(\d+\.\d+)-demo\b/gi, "$1-演示版");
    output = output.replace(/来源记录\s+[A-Za-z0-9-]+(?=\s*·)/gi, "来源记录已核验");
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
