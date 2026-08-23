const { expect, test } = require("@playwright/test");

const HOSTILE_TEXT = '<img data-product-operations-xss src="x" onerror="window.__productOperationsXss=true">';

async function loginCommission(page) {
  await page.goto("/login.html");
  await page.locator("#login-user").selectOption("health");
  await page.locator("input[name='password']").fill("123456");
  await page.locator("#login-form button[type='submit']").click();
  await expect(page).toHaveURL(/index\.html$/);
}

test("product operations cockpit keeps hostile API fields as inert text and dataset values", async ({ page }) => {
  await page.addInitScript(() => {
    window.__productOperationsXss = false;
  });
  await loginCommission(page);

  await page.route("**/api/platform/productization/operations/cockpit", async (route) => {
    const response = await route.fetch();
    const report = await response.json();
    report.cockpit = {
      schemaVersion: "product-operations-view-model-v1",
      status: HOSTILE_TEXT,
      productionReady: false,
      cards: [{ id: "hostile-card", label: HOSTILE_TEXT, value: HOSTILE_TEXT, state: HOSTILE_TEXT }],
      sections: [],
      workItems: [{
        id: HOSTILE_TEXT,
        label: HOSTILE_TEXT,
        domain: HOSTILE_TEXT,
        status: HOSTILE_TEXT,
        priority: HOSTILE_TEXT,
        version: 0
      }],
      boundary: HOSTILE_TEXT
    };

    await route.fulfill({
      response,
      contentType: "application/json",
      body: JSON.stringify(report)
    });
  });

  await page.goto("/platform.html");

  const cockpit = page.locator("#platform-product-operations");
  await expect(cockpit.locator(".metric")).toContainText(HOSTILE_TEXT);
  await expect(cockpit.locator(".evidence-card")).toContainText(HOSTILE_TEXT);
  await expect(cockpit.locator(".muted").last()).toContainText(HOSTILE_TEXT);
  await expect(cockpit.locator("section")).toHaveAttribute("data-product-operations-status", HOSTILE_TEXT);
  await expect(cockpit.locator("[data-product-operation-item]")).toHaveAttribute("data-product-operation-item", HOSTILE_TEXT);
  await expect(page.locator("[data-product-operations-xss]")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__productOperationsXss)).toBe(false);
});
