const { expect, test } = require("@playwright/test");
const fs = require("node:fs");

async function login(page, username, expectedPage) {
  await page.goto("/login.html");
  await page.locator("#login-user").selectOption(username);
  await page.locator("input[name='password']").fill("123456");
  await page.getByRole("button", { name: "进入系统" }).click();
  await expect(page).toHaveURL(new RegExp(`${expectedPage.replace(".", "\\.")}$`));
}

test("commission user reaches the governance dashboard and opens maintenance", async ({ page }) => {
  await login(page, "health", "index.html");

  await page.locator("[data-view='chronic']").click();
  await expect(page.locator("#chronic-risk-summary")).toBeVisible();
  await expect(page.locator("#chronic-risk-stratification tbody tr")).toHaveCount(4);
  await expect(page.locator("[data-chronic-risk-resident='r1']")).toContainText("重点管理");
  await expect(page.locator("[data-chronic-risk-resident='r1']")).toContainText("逾期随访");

  await page.goto("/platform.html");

  await expect(page.getByRole("heading", { name: "统一应用目录" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "医疗机构信用评价" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "科研数据集与专病库治理" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "移动适老化与无障碍" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "安全信创验收台账" })).toBeVisible();
  await expect(page.locator("#application-catalog tbody tr")).toHaveCount(6);
  await expect(page.locator("#institution-credit-evaluations tbody tr")).toHaveCount(3);
  await expect(page.locator("#research-governance table").first().locator("tbody tr")).toHaveCount(2);
  await expect(page.locator("#research-governance table").nth(1).locator("tbody tr")).toHaveCount(2);
  await expect(page.locator("#mobile-accessibility-governance > div")).toHaveCount(10);
  await expect(page.locator("#security-acceptance-ledger > div")).toHaveCount(4);
  await expect(page.locator("#production-deployment-plan .priority-row")).toHaveCount(4);

  await page.goto("/workbench.html");
  await expect(page.locator("#system-readiness")).toBeVisible();
  await expect(page.locator("#system-readiness .priority-row")).toHaveCount(15);
  await expect(page.locator("#system-readiness")).toContainText("现场高风险依赖");
  await expect(page.locator("#system-readiness")).toContainText("政务统一身份源");
  await expect(page.locator("#system-readiness")).toContainText("HIS/EMR/LIS/PACS/心电");

  await page.goto("/platform.html");

  const applicationRow = page.locator("#application-catalog tbody tr", { hasText: "全民健康信息平台一、二期" });
  await applicationRow.getByRole("button", { name: "维护" }).click();
  await expect(page.locator("#platform-edit-dialog")).toHaveAttribute("open", "");
  await expect(page.locator("#platform-edit-title")).toHaveText("维护：全民健康信息平台一、二期");
  await expect(page.locator("#platform-edit-form [name='owner']")).toHaveValue("规划信息处");
});

test("commission workbench renders live release gates and site templates", async ({ page }) => {
  await login(page, "health", "index.html");
  await page.goto("/workbench.html");

  const releaseGates = page.locator("#release-evidence-gates .release-evidence-gate");
  await expect(releaseGates).toHaveCount(11);
  await expect(page.locator("[data-gate='process:audit']")).toContainText("PASS");
  await expect(page.locator("[data-gate='service:acceptance']")).toContainText("domains");
  await expect(page.locator("[data-gate='service:acceptance']")).toContainText("actions");
  await expect(page.locator("[data-gate='service:acceptance']")).toContainText("release/service-acceptance-summary.md");
  await expect(page.locator("[data-gate='site:pack']")).toContainText("PASS");
  await expect(page.locator("[data-gate='release:report']")).toContainText("release checks passed");
  await expect(page.locator("[data-gate='production:cutover']")).toContainText("blocked");
  await expect(page.locator("[data-gate='release:manifest']")).toContainText("artifacts");
  await expect(page.locator("[data-gate='release:report']")).toContainText("live API evidence");

  await expect(page.locator("#acceptance-ledgers .priority-row")).toHaveCount(2);
  await expect(page.locator("[data-acceptance-ledger='chronic']")).toContainText("service domains ready");
  await expect(page.locator("[data-service-open-action='chronic:cst-001']")).toContainText("chronicScreeningTasks");
  await expect(page.locator("[data-service-open-action='chronic:cst-001']")).toContainText("high");
  await expect(page.locator("[data-acceptance-ledger='county']")).toContainText("service domains ready");
  await expect(page.locator("[data-service-open-action='county:cco-001']")).toContainText("countyCollaborationOrders");
  await expect(page.locator("#site-readiness-pack .priority-row")).toHaveCount(8);
  await expect(page.locator("#site-readiness-pack .site-template-readme")).toHaveCount(4);
  await expect(page.locator("#site-readiness-pack")).toContainText("release/site-readiness-pack.md");
  await expect(page.locator("[data-template-readme='identity-source-mapping']")).toContainText("README generated");
  await expect(page.locator("#process-audit-matrix")).toContainText("site-readiness");
  await expect(page.locator("#process-audit-matrix")).toContainText("evidence domains passed");
  await expect(page.locator("[data-unified-task='chronicScreeningTasks:cst-001']")).toContainText("screening");
  await expect(page.locator("[data-unified-task='chronicScreeningTasks:cst-001']")).toContainText("high");

  const releaseReport = await page.evaluate(async () => {
    const response = await window.HealthCityAuth.authFetch("/api/release-report");
    return response.json();
  });
  expect(releaseReport.ok).toBe(true);
  expect(releaseReport.siteReadinessPack.summary.packs).toBe(4);

  const templateReadmes = await page.evaluate(async () => {
    const response = await window.HealthCityAuth.authFetch("/api/site-template-readmes");
    return response.json();
  });
  expect(templateReadmes.ok).toBe(true);
  expect(templateReadmes.summary.readmes).toBe(4);

  const serviceAcceptance = await page.evaluate(async () => {
    const response = await window.HealthCityAuth.authFetch("/api/service-acceptance-summary");
    return response.json();
  });
  expect(serviceAcceptance.ok).toBe(true);
  expect(serviceAcceptance.serviceAcceptance.county.openActions.some((item) => item.id === "cco-001")).toBe(true);
});

test("commission health dashboard filters live source actions and drills into source app", async ({ page }) => {
  await login(page, "health", "index.html");
  await page.goto("/health-dashboard.html");

  await expect(page.locator("#dashboard-api-state")).toHaveAttribute("data-source-mode", "api");
  await expect(page.locator("#dashboard-metrics .metric-card")).toHaveCount(9);
  await expect(page.locator("#dashboard-metrics")).toContainText("181");
  await expect(page.locator("#dashboard-metrics")).toContainText("12");
  await expect(page.locator("#dashboard-applications tbody tr")).toHaveCount(7);
  await expect(page.locator("#dashboard-policy-notes")).toBeVisible();
  await expect(page.locator("[data-dashboard-policy='certificates']")).toContainText("出生");
  await expect(page.locator("#dashboard-policy-notes a[href='./health-dashboard-about.html']")).toHaveCount(1);
  await expect(page.locator("#dashboard-function-list [data-function-report]")).toHaveCount(14);
  await expect(page.locator("#dashboard-function-list [data-function-report='aggregate-entry']")).toContainText("7 个源应用");
  await expect(page.locator("#dashboard-function-list [data-function-report='production-readiness-gate']")).toContainText("上线运行门禁");
  await expect(page.locator("#population-service-board")).toBeVisible();
  await expect(page.locator("#population-service-board")).toHaveAttribute("data-active-period", "day");
  await expect(page.locator("#population-metric-cards [data-population-metric]")).toHaveCount(4);
  await expect(page.locator("#population-chart .population-bar-row")).toHaveCount(4);
  await expect(page.locator("#population-insights [data-population-insight]")).toHaveCount(4);
  await expect(page.locator("#population-insights [data-population-insight='site-cutover']")).toContainText("5类接口");
  await expect(page.locator("#population-metric-cards [data-population-metric='deaths']")).toContainText("1");
  await page.locator("[data-population-period='month']").click();
  await expect(page.locator("#population-service-board")).toHaveAttribute("data-active-period", "month");
  await expect(page.locator("#population-metric-cards [data-population-metric='births']")).toContainText("3");
  await expect(page.locator("#certificate-exchange-cards [data-certificate-exchange='exchange-birth-license']")).toContainText("出生医学证明");
  await expect(page.locator("#risk-drilldown-list [data-risk-drilldown]")).toHaveCount(8);
  await expect(page.locator("#site-evidence-list [data-site-evidence]")).toHaveCount(4);
  await expect(page.locator("#production-readiness-board")).toHaveAttribute("data-production-status", "blocked");
  await expect(page.locator("#production-readiness-list [data-production-gate]")).toHaveCount(5);
  await expect(page.locator("#production-readiness-list [data-production-gate='operations-dr']")).toContainText("监控告警与灾备演练");
  await expect(page.locator("#site-issue-ledger-board")).toHaveAttribute("data-filtered", "false");
  await expect(page.locator("#site-issue-reset-filters")).toBeDisabled();
  await page.locator("#site-issue-owner-filter").selectOption({ index: 1 });
  await expect(page.locator("#site-issue-ledger-board")).toHaveAttribute("data-filtered", "true");
  await expect(page.locator("#site-issue-reset-filters")).toBeEnabled();
  await page.locator("#site-issue-reset-filters").click();
  await expect(page.locator("#site-issue-ledger-board")).toHaveAttribute("data-filtered", "false");
  await expect(page.locator("#site-issue-reset-filters")).toBeDisabled();
  await expect(page.locator("#population-metric-cards [data-population-metric='visits']")).toContainText("92,800");
  await page.locator("[data-population-period='year']").click();
  await expect(page.locator("#population-service-board")).toHaveAttribute("data-active-period", "year");

  await page.locator("#dashboard-application-filter").selectOption("county-consortium");
  await page.locator("#dashboard-priority-filter").selectOption("high");
  await expect(page.locator("#dashboard-filter-summary")).toContainText("2 条待办");
  await expect(page.locator("#dashboard-actions .priority-row")).toHaveCount(2);
  await expect(page.locator("#dashboard-actions")).toContainText("县域协同工单");

  const countyLinks = page.locator("#dashboard-actions a[href='./county.html']");
  await expect(countyLinks).toHaveCount(2);

  const downloadPromise = page.waitForEvent("download");
  await page.locator("#dashboard-export-json").click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^health-dashboard-summary-.*\.json$/);
  const exportPath = await download.path();
  const exported = JSON.parse(fs.readFileSync(exportPath, "utf8"));
  expect(exported.sourceMode).toBe("api");
  expect(exported.filters.applicationId).toBe("county-consortium");
  expect(exported.filters.priority).toBe("high");
  expect(exported.filteredOpenActions).toHaveLength(2);
  expect(exported.summary.totals.sourceOpenActions).toBe(181);
  expect(exported.summary.totals.previewOpenActions).toBe(12);

  await countyLinks.first().click();
  await expect(page).toHaveURL(/county\.html$/);
});

test("about page explains runnable platform capabilities", async ({ page }) => {
  await page.goto("/about.html");

  await expect(page.locator("[data-about-section='runtime-capabilities']")).toBeVisible();
  await expect(page.locator("[data-about-section='role-portals']")).toBeVisible();
  await expect(page.locator("[data-about-capability='service-acceptance']")).toContainText("/api/service-acceptance-summary");
  await expect(page.locator("[data-about-capability='site-template-readmes']")).toContainText("/api/site-template-readmes");
  await expect(page.locator("[data-about-capability='workflow-tasks']")).toContainText("/api/tasks");
  await expect(page.locator("[data-about-capability='release-gates']")).toContainText("npm run deploy:check");
  await expect(page.locator("[data-about-section='external-dependencies']")).toBeVisible();

  await login(page, "health", "index.html");
  await page.goto("/about.html");
  await expect(page.locator(".auth-bar a[href='./about.html']")).toHaveCount(1);

  await page.goto("/health-dashboard-about.html");
  await expect(page.locator("[data-dashboard-about-section='runtime-report']")).toBeVisible();
  await expect(page.locator("#dashboard-about-runtime-state")).toHaveAttribute("data-source-mode", "api");
  await expect(page.locator("#dashboard-about-function-report [data-about-runtime-function]")).toHaveCount(14);
  await expect(page.locator("#dashboard-about-function-report [data-about-runtime-function='aggregate-entry']")).toContainText("212 条源记录");
  await expect(page.locator("#dashboard-about-release-evidence [data-about-runtime-evidence='summary-script']")).toContainText("综合管理服务系统摘要脚本");
  await expect(page.locator("[data-dashboard-about-section='template-functions']")).toBeVisible();
  await expect(page.locator("[data-dashboard-template-function='aggregate-entry']")).toContainText("前七应用汇总入口");
  await expect(page.locator("[data-dashboard-template-function='population-service-board']")).toContainText("日");
  await expect(page.locator("[data-dashboard-template-function='release-report']")).toContainText("主要功能报告");
  await expect(page.locator("[data-dashboard-about-section='policy-basis']")).toBeVisible();
  await expect(page.locator("[data-dashboard-policy='certificates']")).toContainText("出生");
  await expect(page.locator("[data-dashboard-about-section='data-boundary']")).toContainText("卫生统计日报");
  await expect(page.locator("[data-dashboard-about-section='api-evidence']")).toContainText("摘要接口");
  await expect(page.locator("[data-dashboard-about-section='site-cutover']")).toBeVisible();
  await expect(page.locator("[data-dashboard-about-section='production-launch-requirements']")).toContainText("productionReady");
  await expect(page.locator("[data-dashboard-launch-requirements-link]")).toHaveAttribute("href", "./docs/health-dashboard-production-launch-requirements.md");
  await expect(page.locator("[data-dashboard-about-section='next-plan']")).toBeVisible();
  await expect(page.locator("[data-dashboard-next-plan='daily-interface-done']")).toContainText("日报");
  await expect(page.locator("[data-dashboard-next-plan='site-evidence-done']")).toContainText("验收");
});

test("citizen stays in the household experience and cannot open commission pages", async ({ page }) => {
  await login(page, "citizen", "citizen.html");
  await expect(page.getByRole("heading", { name: "个人健康信息库" })).toBeVisible();
  await expect(page.locator("#member-list")).toContainText("演示居民A");
  await expect(page.locator("#member-list")).toContainText("演示居民D");

  await page.goto("/platform.html");
  await expect(page).toHaveURL(/citizen\.html\?denied=platform\.html$/);
  await expect(page.getByRole("heading", { name: "个人健康信息库" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "统一应用目录" })).toHaveCount(0);
});

test("institution and insurance accounts land on their own modules", async ({ page }) => {
  await login(page, "hospital", "institution.html");
  await expect(page.getByRole("heading", { name: "诊疗协同工作台" })).toBeVisible();

  await page.goto("/login.html");
  await page.locator("#login-user").selectOption("insurance");
  await page.locator("input[name='password']").fill("123456");
  await page.getByRole("button", { name: "进入系统" }).click();
  await expect(page).toHaveURL(/insurance\.html$/);
  await expect(page.getByRole("heading", { name: "医保支付、经办审核与基金监管" })).toBeVisible();
});
