const clinicalGateLabels = {
  receiptsValid: "现场证据回执双签",
  mastersValid: "BIS/BTIS 主数据契约",
  coldChainValid: "冷链校准与告警证据",
  scenariosValid: "配血、床旁与召回验收",
  smokePassed: "独立运行冒烟",
  rollbackPassed: "回退恢复演练"
};

async function load() {
  const request = window.HealthCityAuth?.authFetch || fetch;
  const response = await request(`${location.origin}/api/blood-system/go-live`);
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || "加载失败");
  render(data);
}

function render(data) {
  const summary = data.summary;
  const summaryRows = [
    ["正式上线状态", data.productionReady ? "可切换" : "现场证据阻断"],
    ["生产接口", `${summary.endpointsReady}/${summary.endpoints}`],
    ["现场要求", `${summary.requirementsSigned}/${summary.requirements}`],
    ["演练", `${summary.drillsPassed}/${summary.drills}`],
    ["迁移对账", `${summary.migrationsReconciled}/${summary.migrations}`]
  ];
  bloodGoLiveReplace("#gl-summary", summaryRows.map(([label, value]) => bloodGoLiveElement("article", { className: "gl-card" }, [
    bloodGoLiveElement("small", { text: label }),
    bloodGoLiveElement("strong", { className: data.productionReady ? "ready" : "blocked", text: value })
  ])));

  const gates = data.clinicalProduction?.gates || {};
  bloodGoLiveReplace("#gl-clinical-gates", [bloodGoLiveTable(
    ["生产门禁", "状态", "上线判定"],
    Object.entries(clinicalGateLabels).map(([key, label]) => [
      label,
      bloodGoLiveStatus(gates[key] ? "已签收" : "待现场签收", Boolean(gates[key])),
      gates[key] ? "通过" : "No-Go"
    ])
  )]);

  const registry = window.BloodStandardRegistry;
  const coverage = registry.coverage();
  bloodGoLiveReplace("#gl-standard-registry", [bloodGoLiveTable(
    ["标准", "数据子集", "登记数据元", "状态"],
    [[
      [
        document.createTextNode(String(coverage.standard.number ?? "")),
        bloodGoLiveElement("br"),
        bloodGoLiveElement("small", { text: `${coverage.standard.datasetId || ""} · ${coverage.standard.effectiveAt || ""} 生效` })
      ],
      `${coverage.representedSubsets}/${coverage.subsets}`,
      String(coverage.registeredElements),
      bloodGoLiveStatus(coverage.completeSubsetCoverage ? "十二类子集已建档" : "存在缺失", coverage.completeSubsetCoverage)
    ]]
  )]);

  bloodGoLiveReplace("#gl-endpoints", [bloodGoLiveTable(
    ["接口/设备", "责任方", "状态"],
    data.endpoints.map((item) => [item.name, item.owner, item.status])
  )]);
  bloodGoLiveReplace("#gl-requirements", [bloodGoLiveTable(
    ["要求", "责任方", "状态"],
    data.requirements.map((item) => [item.title, item.owner, item.status])
  )]);
  bloodGoLiveReplace("#gl-drills", [bloodGoLiveTable(
    ["演练", "状态", "证据"],
    data.drills.map((item) => [item.title, item.status, item.evidenceRef || "待现场执行"])
  )]);
  bloodGoLiveReplace("#gl-migrations", [bloodGoLiveTable(
    ["批次", "源/目标", "状态"],
    data.migrations.map((item) => [item.name, `${item.sourceCount ?? "-"}/${item.targetCount ?? "-"}`, item.status])
  )]);
  bloodGoLiveReplace("#gl-approvals", [bloodGoLiveTable(
    ["审批", "状态", "签署人"],
    data.approvals.map((item) => [item.title, item.status, item.signedBy || "待签"])
  )]);
  document.querySelector("#gl-rollback").textContent = `回滚：${data.rollback.strategy}；RPO ${data.rollback.rpoMinutes}分钟，RTO ${data.rollback.rtoMinutes}分钟；触发条件：${data.rollback.triggers.join("、")}`;
}

function bloodGoLiveElement(tagName, options = {}, children = []) {
  const element = document.createElement(tagName);
  if (options.className) element.className = options.className;
  if (options.text !== undefined) element.textContent = String(options.text ?? "");
  element.append(...children.filter(Boolean));
  return element;
}

function bloodGoLiveReplace(selector, children) {
  document.querySelector(selector).replaceChildren(...children);
}

function bloodGoLiveStatus(label, ready) {
  return bloodGoLiveElement("span", { className: ready ? "ready" : "blocked", text: label });
}

function bloodGoLiveTable(headers, rows) {
  return bloodGoLiveElement("table", { className: "gl-table" }, [
    bloodGoLiveElement("thead", {}, [
      bloodGoLiveElement("tr", {}, headers.map((header) => bloodGoLiveElement("th", { text: header })))
    ]),
    bloodGoLiveElement("tbody", {}, rows.map((row) => bloodGoLiveElement("tr", {}, row.map(bloodGoLiveCell))))
  ]);
}

function bloodGoLiveCell(value) {
  const cell = bloodGoLiveElement("td");
  if (Array.isArray(value)) cell.append(...value);
  else if (value instanceof Node) cell.append(value);
  else cell.textContent = String(value ?? "");
  return cell;
}

document.addEventListener("DOMContentLoaded", () => load().catch((error) => alert(error.message)));
