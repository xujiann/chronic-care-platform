const { expect, test } = require("@playwright/test");

const HOSTILE_TEXT = '<img data-blood-innovation-xss src="x" onerror="window.__bloodInnovationXss=true">';

async function loginInstitution(page) {
  await page.goto("/login.html");
  await page.locator("#login-user").selectOption("hospital");
  await page.locator("input[name='password']").fill("123456");
  await page.locator("#login-form button[type='submit']").click();
  await expect(page).toHaveURL(/institution\.html$/);
}

function dashboard() {
  return {
    summary: { implemented: HOSTILE_TEXT, total: 13, institutions: HOSTILE_TEXT, openRisks: 1 },
    capabilities: [{ order: HOSTILE_TEXT, name: HOSTILE_TEXT, side: HOSTILE_TEXT }],
    inventoryNodes: [{ institutionName: HOSTILE_TEXT, available: HOSTILE_TEXT, inTransit: 2, alert: "low" }],
    riskSignals: [{ type: HOSTILE_TEXT, message: HOSTILE_TEXT, level: HOSTILE_TEXT, subjectId: HOSTILE_TEXT }],
    forecast: [{ bloodType: HOSTILE_TEXT, available: 1, predictedDemand: 2, gap: -1, recommendation: HOSTILE_TEXT }],
    compliance: {
      passed: HOSTILE_TEXT,
      total: 1,
      checks: [{ name: HOSTILE_TEXT, ok: false, evidence: HOSTILE_TEXT }]
    },
    eventHub: {
      summary: { contracts: HOSTILE_TEXT, events: 1, delivered: 0, deadLetters: 1, projections: 0 },
      consumers: [{ id: HOSTILE_TEXT, records: 1, critical: 1 }],
      deliveries: [{ id: HOSTILE_TEXT, status: "dead_letter", consumer: HOSTILE_TEXT, eventId: HOSTILE_TEXT }]
    },
    digitalTwin: {
      unit: { donationCode: HOSTILE_TEXT, component: HOSTILE_TEXT, status: HOSTILE_TEXT },
      currentCustodian: HOSTILE_TEXT,
      events: [{ action: HOSTILE_TEXT, detail: HOSTILE_TEXT, at: HOSTILE_TEXT, actor: HOSTILE_TEXT }]
    }
  };
}

test("blood innovation dashboard keeps hostile API fields inert and preserves delivery retry", async ({ page }) => {
  await page.addInitScript(() => {
    window.__bloodInnovationXss = false;
  });
  await loginInstitution(page);

  let retryRequested = false;
  let retryMethod = "";
  let dashboardLoads = 0;
  const executions = [];
  await page.route(/\/api\/blood-system\/innovation(?:\?.*)?$/, async (route) => {
    dashboardLoads += 1;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(dashboard()) });
  });
  await page.route("**/api/blood-system/innovation/*/execute", async (route) => {
    const capability = new URL(route.request().url()).pathname.split("/").at(-2);
    executions.push({ capability, method: route.request().method() });
    const result = capability === "rational-use"
      ? { decision: "review", flags: [HOSTILE_TEXT] }
      : capability === "pda-bedside"
        ? { status: "blocked" }
        : {};
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ result }) });
  });
  await page.route("**/api/blood-system/events/deliveries/*/retry", async (route) => {
    retryRequested = true;
    retryMethod = route.request().method();
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });

  await page.goto("/blood-innovation.html");

  await expect(page.locator("#summary")).toContainText(HOSTILE_TEXT);
  await expect(page.locator("#capabilities")).toContainText(HOSTILE_TEXT);
  await expect(page.locator("#inventory")).toContainText(HOSTILE_TEXT);
  await expect(page.locator("#risks")).toContainText(HOSTILE_TEXT);
  await expect(page.locator("#forecast")).toContainText(HOSTILE_TEXT);
  await expect(page.locator("#compliance")).toContainText(HOSTILE_TEXT);
  await expect(page.locator("#event-hub")).toContainText(HOSTILE_TEXT);
  await expect(page.locator("#twin")).toContainText(HOSTILE_TEXT);
  await expect(page.locator("[data-blood-innovation-xss]")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__bloodInnovationXss)).toBe(false);

  const retry = page.locator("[data-retry-delivery]");
  await expect(retry).toHaveAttribute("data-retry-delivery", HOSTILE_TEXT);
  let previousLoads = dashboardLoads;
  await retry.click();
  await expect.poll(() => retryRequested).toBe(true);
  await expect.poll(() => retryMethod).toBe("POST");
  await expect.poll(() => dashboardLoads).toBeGreaterThan(previousLoads);

  previousLoads = dashboardLoads;
  await page.locator("[data-run='supply-forecast']").click();
  await expect.poll(() => executions.some((item) => item.capability === "supply-forecast" && item.method === "POST")).toBe(true);
  await expect.poll(() => dashboardLoads).toBeGreaterThan(previousLoads);

  previousLoads = dashboardLoads;
  await page.locator("[data-run='rational-use']").click();
  await expect.poll(() => executions.some((item) => item.capability === "rational-use" && item.method === "POST")).toBe(true);
  await expect(page.locator("#decision")).toContainText(HOSTILE_TEXT);
  await expect(page.locator("#decision [data-blood-innovation-xss]")).toHaveCount(0);
  await expect.poll(() => dashboardLoads).toBeGreaterThan(previousLoads);

  previousLoads = dashboardLoads;
  await page.locator("[data-run='pda-bedside']").click();
  await expect.poll(() => executions.some((item) => item.capability === "pda-bedside" && item.method === "POST")).toBe(true);
  await expect(page.locator("#pda")).toContainText("门禁阻断");
  await expect.poll(() => dashboardLoads).toBeGreaterThan(previousLoads);
});
