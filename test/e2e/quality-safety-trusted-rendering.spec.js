const { expect, test } = require("@playwright/test");

const HOSTILE_TEXT = '<img data-quality-safety-xss src="x" onerror="window.__qualitySafetyXss=true">';

async function loginCommission(page) {
  await page.goto("/login.html");
  await page.locator("#login-user").selectOption("health");
  await page.locator("input[name='password']").fill("123456");
  await page.locator("#login-form button[type='submit']").click();
  await expect(page).toHaveURL(/index\.html$/);
}

test("quality safety dashboard keeps hostile API fields as inert text and dataset values", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.addInitScript(() => {
    window.__qualitySafetyXss = false;
  });
  await loginCommission(page);
  let dispatchIssueId = "";
  let dispatchPath = "";

  await page.route("**/api/quality-safety/dashboard", async (route) => {
    const response = await route.fetch();
    const dashboard = await response.json();
    const issue = dashboard.issues[0];
    dispatchIssueId = issue.id;

    dashboard.issues = [
      {
        ...issue,
        id: HOSTILE_TEXT,
        title: HOSTILE_TEXT,
        owner: HOSTILE_TEXT,
        institutionName: HOSTILE_TEXT,
        sourceCollection: HOSTILE_TEXT,
        sourceId: HOSTILE_TEXT
      },
      { ...issue, title: "委托交互回归" }
    ];
    dashboard.departmentTaskView = {
      ...(dashboard.departmentTaskView || {}),
      queue: [{
        id: HOSTILE_TEXT,
        priority: "high",
        title: HOSTILE_TEXT,
        context: HOSTILE_TEXT,
        owner: HOSTILE_TEXT,
        source: HOSTILE_TEXT,
        dueAt: HOSTILE_TEXT,
        targetSection: HOSTILE_TEXT,
        actionLabel: HOSTILE_TEXT
      }]
    };

    await route.fulfill({
      response,
      contentType: "application/json",
      body: JSON.stringify(dashboard)
    });
  });
  await page.route("**/api/quality-safety/issues/*/dispatch", async (route) => {
    dispatchPath = new URL(route.request().url()).pathname;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });
  await page.route("**/api/quality-safety/interface-joint-test-pack", async (route) => {
    const response = await route.fetch();
    const pack = await response.json();
    const sample = pack.sampleRequests[0];
    pack.securityFixture.algorithm = HOSTILE_TEXT;
    pack.securityFixture.demoSecretName = HOSTILE_TEXT;
    pack.securityFixture.signatureBase = HOSTILE_TEXT;
    pack.sampleRequests = [{
      ...sample,
      interfaceId: HOSTILE_TEXT,
      method: HOSTILE_TEXT,
      path: HOSTILE_TEXT,
      headers: { ...sample.headers, "X-Idempotency-Key": HOSTILE_TEXT },
      bodySha256: HOSTILE_TEXT,
      message: { ...sample.message, eventType: HOSTILE_TEXT }
    }];
    await route.fulfill({ response, contentType: "application/json", body: JSON.stringify(pack) });
  });

  await page.goto("/quality-safety.html");

  const issues = page.locator("#quality-safety-issues");
  const queue = page.locator("#quality-safety-department-queue");
  const interfacePack = page.locator("#quality-safety-interface-pack");
  await expect(issues).toContainText(HOSTILE_TEXT);
  await expect(queue).toContainText(HOSTILE_TEXT);
  await expect(interfacePack).toContainText(HOSTILE_TEXT);
  await expect(issues.locator("[data-dispatch]").first()).toHaveAttribute("data-dispatch", HOSTILE_TEXT);
  await expect(queue.locator("[data-scroll-target]")).toHaveAttribute("data-scroll-target", HOSTILE_TEXT);
  await expect(interfacePack.locator("[data-interface-validate]")).toHaveAttribute("data-interface-validate", HOSTILE_TEXT);
  await expect(page.locator("[data-quality-safety-xss]")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__qualitySafetyXss)).toBe(false);
  expect(pageErrors).toEqual([]);
  const reloadedDashboard = page.waitForResponse((response) => response.url().endsWith("/api/quality-safety/dashboard"));
  await issues.locator("[data-dispatch]").nth(1).click();
  await expect.poll(() => dispatchPath).toContain(encodeURIComponent(dispatchIssueId));
  await reloadedDashboard;
  await expect(issues).toContainText("委托交互回归");
  expect(pageErrors).toEqual([]);
  await page.unrouteAll({ behavior: "wait" });
});
