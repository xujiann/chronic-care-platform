const { expect, test } = require("@playwright/test");

async function loginCommission(page) {
  await page.goto("/login.html");
  await page.locator("#login-user").selectOption("health");
  await page.locator("input[name='password']").fill("123456");
  await page.locator("#login-form button[type='submit']").click();
  await expect(page).toHaveURL(/index\.html$/);
}

test("blood dashboard renders provider fields as text without creating executable markup", async ({ page }) => {
  const payload = '<img id="blood-xss" src="x" onerror="window.__bloodXss=true">';
  await loginCommission(page);

  await page.route(/\/api\/blood-system$/, (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      role: "commission",
      summary: { requests: 1, bloodUnits: 1, alerts: 1, traceEvents: 1 },
      donorSafetyCases: [{ donorCode: payload, type: payload, reason: payload, status: "active", notificationStatus: payload }],
      recalls: [],
      reactions: [{ id: payload, requestId: payload, severity: payload, symptoms: [payload], status: "reported" }],
      specimens: [],
      emergencyAllocations: [{ id: "emergency-1", priority: "critical", bloodType: payload, component: payload, amount: payload, reason: payload, status: "approved" }],
      bloodUnits: [{ id: payload, donationCode: payload, component: payload, bloodType: payload, volume: payload, status: "testing", inventoryLock: { status: payload, version: 1 } }],
      releaseReviews: [], shipments: [], compatibilityTests: [], transfusionEpisodes: [], transfusionRequests: []
    })
  }));
  await page.route(/\/api\/blood-system\/integration$/, (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      summary: { contracts: 1, endpoints: 0, accepted: 0, deadLetters: 1 },
      contracts: [{ id: payload, name: payload, source: payload, target: payload, standard: payload, required: [payload] }],
      endpoints: [],
      events: [{ messageId: payload, contractId: payload, direction: payload, status: "dead_letter", receivedAt: payload }],
      deadLetters: [{ id: payload, contractId: payload, messageId: payload, errors: [payload] }]
    })
  }));

  await page.goto("/blood.html");
  await expect(page.locator("#donor-recall-table")).toContainText(payload);
  await expect(page.locator("#integration-contracts")).toContainText(payload);
  await expect(page.locator("#blood-xss")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__bloodXss)).toBeUndefined();
  await expect(page.locator("#transaction-units .blood-table tbody tr")).toHaveCount(1);
  await expect(page.locator("#transaction-actions [data-transaction-action='sign-report']")).toHaveCount(1);
});
