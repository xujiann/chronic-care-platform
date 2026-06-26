const { expect, test } = require("@playwright/test");

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

test("about page explains runnable platform capabilities", async ({ page }) => {
  await page.goto("/about.html");

  await expect(page.locator("[data-about-section='runtime-capabilities']")).toBeVisible();
  await expect(page.locator("[data-about-section='role-portals']")).toBeVisible();
  await expect(page.locator("[data-about-capability='service-acceptance']")).toContainText("/api/service-acceptance-summary");
  await expect(page.locator("[data-about-capability='site-template-readmes']")).toContainText("/api/site-template-readmes");
  await expect(page.locator("[data-about-capability='workflow-tasks']")).toContainText("/api/tasks");
  await expect(page.locator("[data-about-capability='release-gates']")).toContainText("npm run deploy:check");
  await expect(page.locator("[data-about-section='referral-policy']")).toBeVisible();
  await expect(page.locator("[data-about-section='external-dependencies']")).toBeVisible();

  await page.goto("/referral-teleconsultation-about.html");
  await expect(page.locator("[data-referral-about-section='policy-basis']")).toBeVisible();
  await expect(page.locator("[data-referral-policy='graded-diagnosis']")).toBeVisible();
  await expect(page.locator("[data-referral-about-section='joint-signoff']")).toBeVisible();
  await expect(page.locator("[data-referral-signoff='referral-center']")).toContainText("feedback-callback");
  await expect(page.locator("[data-referral-signoff='hospital-it']")).toContainText("report-callback");
  await expect(page.locator("[data-referral-about-section='developer']")).toContainText("Dr.Xu");

  await login(page, "health", "index.html");
  await page.goto("/about.html");
  await expect(page.locator(".auth-bar a[href='./about.html']")).toHaveCount(1);
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
