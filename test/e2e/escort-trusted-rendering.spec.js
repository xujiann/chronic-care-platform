const { expect, test } = require("@playwright/test");

const HOSTILE_TEXT = '<img data-escort-xss src="x" onerror="window.__escortXss=true">';

async function loginCommission(page) {
  await page.goto("/login.html");
  await page.locator("#login-user").selectOption("health");
  await page.locator("input[name='password']").fill("123456");
  await page.locator("#login-form button[type='submit']").click();
  await expect(page).toHaveURL(/index\.html$/);
}

test("escort dashboard keeps hostile API fields as inert text and dataset values", async ({ page }) => {
  await page.addInitScript(() => {
    window.__escortXss = false;
  });
  await loginCommission(page);

  await page.route("**/api/escort-services/dashboard", async (route) => {
    const response = await route.fetch();
    const dashboard = await response.json();
    const provider = dashboard.providers[0];
    const worker = dashboard.workers[0];
    const order = dashboard.orders[0];

    dashboard.summary.providers = HOSTILE_TEXT;
    provider.id = HOSTILE_TEXT;
    provider.name = HOSTILE_TEXT;
    provider.type = HOSTILE_TEXT;
    worker.name = HOSTILE_TEXT;
    worker.providerId = HOSTILE_TEXT;
    order.id = HOSTILE_TEXT;
    order.residentId = HOSTILE_TEXT;
    order.hospital = HOSTILE_TEXT;
    order.department = HOSTILE_TEXT;
    dashboard.riskQueue = [{
      id: HOSTILE_TEXT,
      priority: "high",
      riskLevel: "high",
      status: HOSTILE_TEXT,
      nextAction: HOSTILE_TEXT
    }];
    dashboard.policy.providerEntryRule = HOSTILE_TEXT;
    dashboard.policy.requiredEvidence = [HOSTILE_TEXT];
    dashboard.boundaries = [HOSTILE_TEXT];
    dashboard.integrationTargets = [HOSTILE_TEXT];

    await route.fulfill({
      response,
      contentType: "application/json",
      body: JSON.stringify(dashboard)
    });
  });

  await page.goto("/escort.html");

  for (const selector of [
    "#escort-metrics",
    "#escort-provider-select",
    "#escort-orders",
    "#escort-providers",
    "#escort-workers",
    "#escort-risks",
    "#escort-policy",
    "#escort-boundary"
  ]) {
    await expect(page.locator(selector)).toContainText(HOSTILE_TEXT);
  }

  const actionButton = page.locator("[data-escort-action]").first();
  await expect(actionButton).toHaveAttribute("data-escort-action", HOSTILE_TEXT);
  const hospitalButton = page.locator("[data-escort-hospital]").first();
  await expect(hospitalButton).toHaveAttribute("data-escort-hospital", HOSTILE_TEXT);
  await expect(page.locator("[data-escort-xss]")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__escortXss)).toBe(false);
});
