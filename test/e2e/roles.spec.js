const { expect, test } = require("@playwright/test");
const { createHmac } = require("node:crypto");

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function integrationSignature(payload) {
  return createHmac("sha256", "health-platform-demo-integration-secret").update(stableStringify(payload)).digest("hex");
}

async function login(page, username, expectedPage) {
  await page.goto("/login.html");
  await page.locator("#login-user").selectOption(username);
  await page.locator("input[name='password']").fill("123456");
  await page.getByRole("button", { name: "进入系统" }).click();
  await expect(page).toHaveURL(new RegExp(`${expectedPage.replace(".", "\\.")}$`));
}

test("commission user reaches the governance dashboard and opens maintenance", async ({ page }) => {
  await login(page, "health", "index.html");
  await expect(page.locator("#data-source")).toHaveText("本地服务");

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
  await expect(page.locator("#identity-lifecycle-metrics")).toContainText("会话存储");
  await expect(page.locator("#identity-lifecycle-metrics")).toContainText("进程内存");
  await expect(page.locator("#identity-lifecycle-metrics")).toContainText("仅限本地开发和测试");
  await expect(page.locator("#identity-lifecycle-metrics")).toContainText("会话保留");
  await expect(page.locator("#identity-lifecycle-metrics")).toContainText("最近清理 0 条");

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

test("digital hospital self-assessment exposes tiered expert review without mobile overflow", async ({ page }) => {
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await login(page, "health", "index.html");
  await page.goto("/digital-hospital-self-assessment.html");
  await expect(page.getByRole("heading", { name: "医院自评申报工作台" })).toBeVisible();
  await expect(page.locator("#digital-self-assessment-metrics .metric-card")).toHaveCount(6);
  await expect(page.locator("#digital-self-assessment-review-filter")).toBeVisible();
  await expect(page.locator("#digital-self-assessment-status-filter")).toContainText("省级初审中");
  await expect(page.locator("#digital-self-assessment-status-filter")).toContainText("专家复核中");
  await expect(page.locator("#digital-self-assessment-dispute-indicators")).toBeAttached();
  await expect(page.locator("#digital-self-assessment-opinion-ref")).toBeAttached();
  await page.setViewportSize({ width: 375, height: 812 });
  const overflow = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
  expect(overflow.scrollWidth).toBe(overflow.width);
  expect(consoleErrors).toEqual([]);
});

test("digital hospital pilot issue desk is scoped, actionable and mobile safe", async ({ page }) => {
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await login(page, "health", "index.html");
  await page.goto("/digital-hospital-evaluation.html");
  await expect(page.getByRole("heading", { name: "试点问题督办" })).toBeVisible();
  await expect(page.locator("#digital-evaluation-pilot-issues tbody tr")).toHaveCount(2);
  await expect(page.locator("#digital-evaluation-issue-summary")).toContainText("项开放");
  await expect(page.locator("#digital-evaluation-issue-action")).toHaveValue("assign");
  await expect(page.locator("#digital-evaluation-issue-action-no-pii")).toBeAttached();
  await page.setViewportSize({ width: 375, height: 812 });
  const overflow = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
  expect(overflow.scrollWidth).toBe(overflow.width);
  expect(consoleErrors).toEqual([]);
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
  await expect(page.locator("#site-readiness-pack .priority-row")).toHaveCount(9);
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

test("operations metrics navigate to the matching work areas", async ({ page }) => {
  await login(page, "health", "index.html");
  await page.goto("/operations.html");

  await expect(page.getByRole("heading", { name: "运行监测、资源调度、统计直报对账" })).toBeVisible();
  await expect(page.locator("#operations-metrics [data-metric-action]")).toHaveCount(10);
  await expect(page.locator("#operations-duty-priority")).toContainText("首要处置");
  await expect(page.locator("#operations-duty-queue [data-duty-action]")).toHaveCount(3);
  await expect(page.locator("#operations-duty-actions [data-duty-action]")).toHaveCount(3);
  await expect(page.locator("#operations-duty-actions")).toContainText("上线判定");
  await expect(page.locator("#operations-duty-actions")).toContainText("责任：");
  await expect(page.locator("#operations-duty-actions")).toContainText("下一步：");
  await expect(page.locator("#operations-duty-actions")).toContainText("时限：");

  await page.locator("#operations-metrics [data-metric-action='critical']").click();
  await expect(page.locator("#operation-status-filter")).toHaveValue("critical");
  await expect(page.locator("#operations-snapshots")).toContainText("机构");

  await page.locator("#operations-duty-actions [data-duty-action='dispatch']").click();
  await expect(page.locator("#operation-status-filter")).toHaveValue("all");
  await expect(page.locator("#dispatch-requests")).toContainText("调度单");
  await expect(page.locator("#dispatch-batch-toolbar")).toContainText("批量处置");
  await page.locator("#dispatch-batch-toolbar [data-dispatch-batch-note]").fill("到位凭证 TEST-001");
  await expect(page.locator("#dispatch-batch-toolbar [data-dispatch-batch-note]")).toHaveValue("到位凭证 TEST-001");
  await page.locator("#dispatch-requests [data-dispatch-select]:not([disabled])").first().check();
  await expect(page.locator("#dispatch-batch-toolbar")).toContainText("已选择 1");
  await expect(page.locator("#dispatch-batch-toolbar [data-dispatch-batch-note]")).toHaveValue("到位凭证 TEST-001");
  await page.locator("#dispatch-batch-toolbar [data-dispatch-clear]").click();
  await expect(page.locator("#dispatch-batch-toolbar")).toContainText("已选择 0");

  await page.locator("#operations-duty-actions [data-duty-action='reconciliation']").click();
  await expect(page.locator("#operation-sort")).toHaveValue("variance");
  await expect(page.locator("#reconciliation-reviews")).toContainText("统计复核单");

  await page.locator("#operations-duty-actions [data-duty-action='launch']").click();
  await expect(page.locator("#operation-launch-readiness")).toContainText("上线运行判定");

  const queueAction = await page.locator("#operations-duty-queue [data-duty-action]").first().getAttribute("data-duty-action");
  await page.locator("#operations-duty-queue [data-duty-action]").first().click();
  if (queueAction === "dispatch") {
    await expect(page.locator("#dispatch-requests")).toContainText("调度单");
  } else if (queueAction === "reconciliation") {
    await expect(page.locator("#reconciliation-reviews")).toContainText("统计复核单");
  } else {
    await expect(page.locator("#operation-launch-readiness")).toContainText("上线运行判定");
  }

  const primaryAction = await page.locator("#operations-duty-priority [data-duty-action]").getAttribute("data-duty-action");
  await page.locator("#operations-duty-priority [data-duty-action]").click();
  if (primaryAction === "dispatch") {
    await expect(page.locator("#dispatch-requests")).toContainText("调度单");
  } else if (primaryAction === "reconciliation") {
    await expect(page.locator("#reconciliation-reviews")).toContainText("统计复核单");
  } else {
    await expect(page.locator("#operation-launch-readiness")).toContainText("上线运行判定");
  }
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

test("regional sharing page renders referral handoff boundary", async ({ page }) => {
  await login(page, "health", "index.html");
  await page.goto("/regional-data-sharing.html");

  await expect(page.getByRole("heading", { name: "上线前缺口" })).toBeVisible();
  await expect(page.locator("#regional-launch-readiness")).toContainText("已实现能力");
  await expect(page.locator("#regional-launch-readiness")).toContainText("待开发项");
  await expect(page.locator("#regional-launch-readiness")).toContainText("OIDC/SAML");
  await expect(page.locator("[data-regional-section='site-integration']")).toBeVisible();
  await expect(page.locator("#regional-site-integration .capability-card")).toHaveCount(8);
  await expect(page.locator("#regional-site-integration")).toContainText("身份与权限");
  await expect(page.locator("#regional-site-integration")).toContainText("监控灾备");
  await expect(page.locator("#regional-site-integration")).toContainText("联调样例");
  await expect(page.locator("#regional-site-integration")).toContainText("验收证据");
  await expect(page.locator("#regional-site-integration")).toContainText("下一步");
  await expect(page.locator("#regional-launch-readiness")).toContainText("现场签字");

  await expect(page.getByRole("heading", { name: "转诊会诊交接" })).toBeVisible();
  await expect(page.locator("#regional-referral-handoff-summary")).toContainText(/项证据可交接/);
  await expect(page.locator("#regional-referral-handoff .handoff-grid article")).toHaveCount(6);
  await expect(page.locator("#regional-referral-handoff")).toContainText("调阅审计");
  await expect(page.locator("#regional-referral-boundary")).toContainText("可以合并");
  await expect(page.locator("#regional-referral-boundary")).toContainText("不合并运行时");
  await expect(page.locator("#regional-referral-boundary")).toContainText("不把区域共享包当作转诊单主表");

  await page.getByRole("button", { name: "生成交接清单" }).click();
  await expect(page.locator("#regional-handoff-report")).toContainText("区域共享-转诊会诊交接清单");
  await expect(page.locator("#regional-handoff-report")).toContainText(/rshr-/);
  await expect(page.locator("#regional-handoff-report")).toContainText("证据进度");
  await expect(page.locator("#regional-handoff-report .handoff-report-list article")).toHaveCount(3);
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
  await expect(page.locator("#registration-integration-center")).toBeVisible();
  await expect(page.locator("#registration-integration-status")).toHaveText("appointment-order-v1");
  await expect(page.locator('[data-registration-integration-source="MR1"]')).toHaveCount(1);
  await expect(page.locator('[data-registration-integration-source="MR2"]')).toHaveCount(0);

  await page.goto("/login.html");
  await page.locator("#login-user").selectOption("insurance");
  await page.locator("input[name='password']").fill("123456");
  await page.getByRole("button", { name: "进入系统" }).click();
  await expect(page).toHaveURL(/insurance\.html$/);
  await expect(page.getByRole("heading", { name: "医保支付、经办审核与基金监管" })).toBeVisible();
});

test("institution retries its own appointment callback dead letter", async ({ page, request }, testInfo) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const apiLogin = async (username) => {
    const response = await request.post("/api/auth/login", { data: { username, password: "123456" } });
    expect(response.ok()).toBe(true);
    return (await response.json()).token;
  };
  const citizenToken = await apiLogin("citizen");
  const hospitalToken = await apiLogin("hospital");
  const dashboardResponse = await request.get("/api/registrations/dashboard", { headers: { Authorization: `Bearer ${citizenToken}` } });
  const dashboard = await dashboardResponse.json();
  const schedule = dashboard.schedules.find((item) => item.hospitalCode === "MR1");
  const orderResponse = await request.post("/api/registrations/orders", {
    headers: { Authorization: `Bearer ${citizenToken}` },
    data: { residentId: "r1", scheduleId: schedule.id, visitType: "onsite", reason: "E2E callback remediation" }
  });
  expect(orderResponse.status()).toBe(201);
  const order = await orderResponse.json();
  const callback = (eventType, sequence) => ({
    contractId: "appointment-order-v1",
    idempotencyKey: `e2e-remediation-${order.id}-${sequence}`,
    externalId: `E2E-REMEDIATION-${order.id}-${sequence}`,
    residentId: order.residentId,
    orderNo: order.registrationNo,
    slotId: order.scheduleId,
    eventType,
    orderStatus: eventType,
    occurredAt: `2026-07-10T15:0${sequence}:00.000Z`
  });
  const postCallback = async (payload) => request.post("/api/integration/events", {
    headers: {
      Authorization: `Bearer ${hospitalToken}`,
      "x-integration-signature": integrationSignature(payload)
    },
    data: payload
  });
  const earlyCheckInResponse = await postCallback(callback("checked-in", 1));
  expect(earlyCheckInResponse.status()).toBe(202);
  const earlyCheckIn = await earlyCheckInResponse.json();
  expect(earlyCheckIn.deadLetter).toBe(true);
  expect((await postCallback(callback("payment-succeeded", 2))).status()).toBe(202);
  expect((await postCallback(callback("his-confirmed", 3))).status()).toBe(202);

  await login(page, "hospital", "institution.html");
  const eventRow = page.locator(`[data-registration-integration-event="${earlyCheckIn.id}"]`);
  await expect(eventRow).toContainText("重试 0/3");
  await eventRow.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("institution-registration-remediation-mobile.png") });
  const eventLayout = await eventRow.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      viewportWidth: document.documentElement.clientWidth,
      pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
    };
  });
  expect(eventLayout.pageOverflow).toBe(false);
  expect(eventLayout.left).toBeGreaterThanOrEqual(0);
  expect(eventLayout.right).toBeLessThanOrEqual(eventLayout.viewportWidth);
  const noteInput = eventRow.getByLabel("回调重试处理备注");
  await noteInput.fill("HIS 与支付前置回调已补齐");
  await eventRow.getByRole("button", { name: "重试回调" }).click();
  await expect(eventRow.getByRole("button", { name: "重试回调" })).toHaveCount(0);
  await expect(eventRow).toContainText("已匹配");
  await expect(eventRow).toContainText("最近处理：HIS 与支付前置回调已补齐");
  await expect(page.locator("#registration-integration-boundary")).toContainText("回调重试成功");
});

test("institution assigns and resolves an appointment reconciliation case", async ({ page, request }, testInfo) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const apiLogin = async (username) => {
    const response = await request.post("/api/auth/login", { data: { username, password: "123456" } });
    expect(response.ok()).toBe(true);
    return (await response.json()).token;
  };
  const citizenToken = await apiLogin("citizen");
  const hospitalToken = await apiLogin("hospital");
  const dashboard = await (await request.get("/api/registrations/dashboard", { headers: { Authorization: `Bearer ${citizenToken}` } })).json();
  const schedule = dashboard.schedules.find((item) => item.hospitalCode === "MR1");
  const orderResponse = await request.post("/api/registrations/orders", {
    headers: { Authorization: `Bearer ${citizenToken}` },
    data: { residentId: "r1", scheduleId: schedule.id, visitType: "onsite", reason: "E2E manual reconciliation" }
  });
  expect(orderResponse.status()).toBe(201);
  const order = await orderResponse.json();
  const callback = {
    contractId: "appointment-order-v1",
    idempotencyKey: `e2e-manual-${order.id}`,
    externalId: `E2E-MANUAL-${order.id}`,
    residentId: order.residentId,
    orderNo: order.registrationNo,
    slotId: order.scheduleId,
    eventType: "checked-in",
    orderStatus: "checked-in",
    occurredAt: "2026-07-10T16:30:00.000Z"
  };
  const deadLetterResponse = await request.post("/api/integration/events", {
    headers: { Authorization: `Bearer ${hospitalToken}`, "x-integration-signature": integrationSignature(callback) },
    data: callback
  });
  expect(deadLetterResponse.status()).toBe(202);
  const deadLetter = await deadLetterResponse.json();
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const retryResponse = await request.post(`/api/registrations/integration-events/${deadLetter.id}/retry`, {
      headers: { Authorization: `Bearer ${hospitalToken}` },
      data: { note: `E2E exhausted retry ${attempt}` }
    });
    expect(retryResponse.status()).toBe(200);
  }

  await login(page, "hospital", "institution.html");
  const eventRow = page.locator(`[data-registration-integration-event="${deadLetter.id}"]`);
  await expect(eventRow).toContainText("已达到重试上限");
  await eventRow.getByLabel("人工对账责任人").fill("医院接口负责人");
  await eventRow.getByLabel("人工对账处理时限").fill("2026-07-20");
  await eventRow.getByLabel("人工对账优先级").selectOption("P0");
  await eventRow.getByLabel("人工对账分派备注").fill("自动重试耗尽，转人工核验回执");
  await eventRow.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("institution-registration-reconciliation-mobile.png") });
  const assignmentLayout = await eventRow.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, right: rect.right, viewportWidth: document.documentElement.clientWidth, pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth };
  });
  expect(assignmentLayout.pageOverflow).toBe(false);
  expect(assignmentLayout.left).toBeGreaterThanOrEqual(0);
  expect(assignmentLayout.right).toBeLessThanOrEqual(assignmentLayout.viewportWidth);
  await eventRow.getByRole("button", { name: "转人工对账" }).click();
  await expect(eventRow).toContainText("人工工单");
  await expect(eventRow).toContainText("医院接口负责人");
  await eventRow.getByLabel("人工对账结论").selectOption("manual-compensation");
  await eventRow.getByLabel("人工对账证据引用").fill("E2E-RECON-RECEIPT-001");
  await eventRow.getByLabel("人工对账结案备注").fill("补偿回执已完成双人复核");
  await eventRow.getByRole("button", { name: "登记结案" }).click();
  await expect(eventRow).toContainText("人工已结案");
  await expect(eventRow).toContainText("E2E-RECON-RECEIPT-001");
  await expect(page.locator("#registration-integration-boundary")).toContainText("原预约订单未被改写");
  await expect(page.locator("#registration-integration-metrics")).toContainText("人工结案");
});

test("hospital disruption notice is accepted by the resident on mobile", async ({ page, request }, testInfo) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const apiLogin = async (username) => {
    const response = await request.post("/api/auth/login", { data: { username, password: "123456" } });
    expect(response.ok()).toBe(true);
    return (await response.json()).token;
  };
  const citizenToken = await apiLogin("citizen");
  const dashboard = await (await request.get("/api/registrations/dashboard", { headers: { Authorization: `Bearer ${citizenToken}` } })).json();
  const currentSchedule = dashboard.schedules.find((item) => item.id === "reg-sch-cardio-am");
  const replacementSchedule = dashboard.schedules.find((item) => item.id !== currentSchedule.id && item.hospitalCode === currentSchedule.hospitalCode && item.departmentCode === currentSchedule.departmentCode && item.remaining > 0);
  expect(replacementSchedule).toBeTruthy();
  const orderResponse = await request.post("/api/registrations/orders", {
    headers: { Authorization: `Bearer ${citizenToken}` },
    data: { residentId: "r1", scheduleId: currentSchedule.id, visitType: "onsite", reason: "E2E hospital schedule disruption" }
  });
  expect(orderResponse.status()).toBe(201);
  const order = await orderResponse.json();

  await login(page, "hospital", "institution.html");
  const institutionRow = page.locator(`[data-registration-journey-order="${order.id}"]`);
  await expect(institutionRow.getByLabel("停诊变更类型")).toHaveCount(1);
  await institutionRow.getByLabel("停诊变更类型").selectOption("doctor-unavailable");
  await institutionRow.getByLabel("替代预约号源").selectOption(replacementSchedule.id);
  await institutionRow.getByLabel("居民确认时限").fill("2099-07-20T18:00");
  await institutionRow.getByLabel("停诊改签原因").fill("原接诊医生临时停诊，提供同科室替代号源");
  await institutionRow.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("institution-registration-disruption-mobile.png") });
  const institutionLayout = await institutionRow.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, right: rect.right, viewportWidth: document.documentElement.clientWidth, pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth };
  });
  expect(institutionLayout.pageOverflow).toBe(false);
  expect(institutionLayout.left).toBeGreaterThanOrEqual(0);
  expect(institutionLayout.right).toBeLessThanOrEqual(institutionLayout.viewportWidth);
  await institutionRow.getByRole("button", { name: "发送改签通知" }).click();
  await expect(institutionRow).toContainText("待居民确认");
  await expect(institutionRow).toContainText("原接诊医生临时停诊");
  await expect(page.locator("#registration-journey-boundary")).toContainText("原号源暂时保留");

  await login(page, "citizen", "citizen.html");
  await page.goto("/citizen.html?client=app&page=registration#service-registration");
  const citizenRow = page.locator(`[data-registration-order="${order.id}"]`);
  await expect(citizenRow).toContainText("医生停诊");
  await expect(citizenRow).toContainText("待我确认");
  await expect(citizenRow.getByRole("button", { name: "确认改签" })).toHaveCount(1);
  await citizenRow.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("citizen-registration-disruption-mobile.png") });
  const citizenLayout = await citizenRow.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, right: rect.right, viewportWidth: document.documentElement.clientWidth, pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth };
  });
  expect(citizenLayout.pageOverflow).toBe(false);
  expect(citizenLayout.left).toBeGreaterThanOrEqual(0);
  expect(citizenLayout.right).toBeLessThanOrEqual(citizenLayout.viewportWidth);
  await citizenRow.getByRole("button", { name: "确认改签" }).click();
  await expect(citizenRow).toContainText("改签已确认");
  await expect(citizenRow).toContainText(replacementSchedule.date);
  await expect(citizenRow).toContainText("新号源待医院再次确认");
  await expect(citizenRow.getByRole("button", { name: "确认改签" })).toHaveCount(0);
});

test("full appointment schedule automatically promotes the first waitlist resident", async ({ page, request }, testInfo) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const loginResponse = await request.post("/api/auth/login", { data: { username: "citizen", password: "123456" } });
  expect(loginResponse.ok()).toBe(true);
  const citizenToken = (await loginResponse.json()).token;

  await login(page, "citizen", "citizen.html");
  await page.goto("/citizen.html?client=app&page=registration#service-registration");
  const fullScheduleCard = page.locator(".registration-schedule-card", { hasText: "Doctor Sun" });
  await expect(fullScheduleCard).toContainText("余号 0 个");
  await expect(fullScheduleCard.getByRole("button", { name: "加入候补" })).toHaveCount(1);
  await fullScheduleCard.getByLabel("候补通知方式").selectOption("sms");
  await fullScheduleCard.getByRole("button", { name: "加入候补" }).click();
  const waitingCard = page.locator("[data-registration-waitlist-entry]", { hasText: "Doctor Sun" });
  await expect(waitingCard).toContainText("候补排队中");
  await expect(waitingCard).toContainText("当前第 1 位");

  const releaseResponse = await request.post("/api/registrations/orders/reg-r4-waitlist-capacity/cancel", {
    headers: { Authorization: `Bearer ${citizenToken}` },
    data: { reason: "E2E cancellation releases the full schedule slot" }
  });
  expect(releaseResponse.status()).toBe(200);
  await page.reload();
  const offerCard = page.locator("[data-registration-waitlist-entry]", { hasText: "Doctor Sun" });
  await expect(offerCard).toContainText("号源待我确认");
  await expect(offerCard.getByRole("button", { name: "确认候补号源" })).toHaveCount(1);
  await offerCard.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("citizen-registration-waitlist-offer-mobile.png") });
  const waitlistLayout = await offerCard.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, right: rect.right, viewportWidth: document.documentElement.clientWidth, pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth };
  });
  expect(waitlistLayout.pageOverflow).toBe(false);
  expect(waitlistLayout.left).toBeGreaterThanOrEqual(0);
  expect(waitlistLayout.right).toBeLessThanOrEqual(waitlistLayout.viewportWidth);
  await offerCard.getByRole("button", { name: "确认候补号源" }).click();
  await expect(offerCard).toContainText("候补已转预约");
  await expect(offerCard.getByRole("button", { name: "确认候补号源" })).toHaveCount(0);
  await expect(page.locator("[data-registration-order]", { hasText: "Doctor Sun" })).toContainText("候补");
  await expect(page.locator("#registration-journey-timeline")).toContainText("候补待确认");
});

test("registration journey crosses resident and institution portals", async ({ page }) => {
  test.setTimeout(60_000);
  const orderId = "reg-r1-20260630-cardio";

  await login(page, "citizen", "citizen.html");
  await page.goto("/citizen.html?client=app&page=registration#service-registration");
  const payButton = page.locator(`[data-registration-journey-action="pay-demo"][data-registration-id="${orderId}"]`);
  await expect(payButton).toHaveCount(1);
  await payButton.click();
  await expect(payButton).toHaveCount(0);

  await login(page, "hospital", "institution.html");
  await expect(page.locator("#registration-journey-workbench")).toBeVisible();
  const confirmButton = page.locator(`[data-registration-institution-action="confirm-his-demo"][data-registration-id="${orderId}"]`);
  await expect(confirmButton).toHaveCount(1);
  await confirmButton.click();
  await expect(confirmButton).toHaveCount(0);

  await login(page, "citizen", "citizen.html");
  await page.goto("/citizen.html?client=app&page=registration#service-registration");
  const checkInButton = page.locator(`[data-registration-journey-action="check-in-demo"][data-registration-id="${orderId}"]`);
  await expect(checkInButton).toHaveCount(1);
  await checkInButton.click();
  await expect(checkInButton).toHaveCount(0);

  await login(page, "hospital", "institution.html");
  const completeButton = page.locator(`[data-registration-institution-action="complete-demo"][data-registration-id="${orderId}"]`);
  await expect(completeButton).toHaveCount(1);
  await completeButton.click();
  await expect(completeButton).toHaveCount(0);

  await login(page, "health", "index.html");
  const result = await page.evaluate(async (id) => {
    const dashboard = await (await window.HealthCityAuth.authFetch("/api/registrations/dashboard")).json();
    const audit = await (await window.HealthCityAuth.authFetch("/api/audit/verify")).json();
    return { order: dashboard.orders.find((item) => item.id === id), audit };
  }, orderId);
  expect(result.order.status).toBe("completed");
  expect(result.order.journeyStage).toBe("completed-demo");
  expect(result.order.productionReady).toBe(false);
  expect(result.audit.passed).toBe(true);
});

test("registration journey remains readable on a mobile viewport", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });

  await login(page, "citizen", "citizen.html");
  await page.goto("/citizen.html?client=app&page=registration#service-registration");
  const citizenJourney = page.locator("#registration-journey-timeline").locator("..");
  await expect(citizenJourney).toBeVisible();
  await expect(citizenJourney).toContainText("号源锁定");
  await citizenJourney.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("citizen-registration-mobile.png") });
  const citizenLayout = await page.evaluate(() => {
    const section = document.querySelector("#registration-journey-timeline")?.parentElement;
    const rect = section?.getBoundingClientRect();
    return {
      pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      left: rect?.left ?? -1,
      right: rect?.right ?? Number.POSITIVE_INFINITY,
      viewportWidth: document.documentElement.clientWidth
    };
  });
  expect(citizenLayout.pageOverflow).toBe(false);
  expect(citizenLayout.left).toBeGreaterThanOrEqual(0);
  expect(citizenLayout.right).toBeLessThanOrEqual(citizenLayout.viewportWidth);

  await login(page, "hospital", "institution.html");
  const institutionJourney = page.locator("#registration-journey-workbench");
  await expect(institutionJourney).toBeVisible();
  await expect(institutionJourney).toContainText("生产：否");
  await institutionJourney.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("institution-registration-mobile.png") });
  const institutionLayout = await page.evaluate(() => {
    const panel = document.querySelector("#registration-journey-workbench");
    const rect = panel?.getBoundingClientRect();
    return {
      pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      left: rect?.left ?? -1,
      right: rect?.right ?? Number.POSITIVE_INFINITY,
      viewportWidth: document.documentElement.clientWidth
    };
  });
  expect(institutionLayout.pageOverflow).toBe(false);
  expect(institutionLayout.left).toBeGreaterThanOrEqual(0);
  expect(institutionLayout.right).toBeLessThanOrEqual(institutionLayout.viewportWidth);

  const integrationCenter = page.locator("#registration-integration-center");
  await integrationCenter.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("institution-registration-integration-mobile.png") });
  const integrationLayout = await page.evaluate(() => {
    const selectors = [
      "#registration-integration-center",
      "#registration-integration-metrics",
      "#registration-integration-sources",
      "#registration-integration-events",
      "#registration-integration-boundary"
    ];
    return {
      viewportWidth: document.documentElement.clientWidth,
      pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      regions: selectors.map((selector) => {
        const rect = document.querySelector(selector)?.getBoundingClientRect();
        return { selector, left: rect?.left ?? -1, right: rect?.right ?? Number.POSITIVE_INFINITY };
      })
    };
  });
  expect(integrationLayout.pageOverflow).toBe(false);
  integrationLayout.regions.forEach((region) => {
    expect(region.left, `${region.selector} should start inside the viewport`).toBeGreaterThanOrEqual(0);
    expect(region.right, `${region.selector} should end inside the viewport`).toBeLessThanOrEqual(integrationLayout.viewportWidth);
  });
});
