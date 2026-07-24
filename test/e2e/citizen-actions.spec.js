const { expect, test } = require("@playwright/test");

test("citizen mobile action dock remembers and resets the current service order", async ({ page }) => {
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await page.route("**/api/record-care-workspace**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        corrections: [],
        sharePackages: [],
        taskUpdates: {},
        syncedAt: new Date().toISOString(),
        cursor: "e2e-citizen-actions"
      })
    });
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/login.html");
  await page.locator("#login-user").selectOption("citizen");
  await page.locator("input[name='password']").fill("123456");
  await page.getByRole("button", { name: "进入系统" }).click();
  await expect(page).toHaveURL(/citizen\.html$/);

  await page.goto("/citizen.html?client=mini-program&page=health-record&compact=1");
  const actionDock = page.locator("#citizen-action-dock");
  const timelineAction = actionDock.getByRole("button", { name: "健康档案：看时间轴" });
  await expect(timelineAction).toBeVisible();
  await timelineAction.click();

  const resetAction = actionDock.locator("[data-action-dock-reset]");
  await expect(actionDock).toContainText("最近使用：看时间轴");
  await expect(resetAction).toBeVisible();
  await expect(resetAction).toHaveText("恢复默认");

  await resetAction.click();
  await expect(resetAction).toHaveCount(0);
  await expect(actionDock).not.toContainText("最近使用：");

  await page.goto("/citizen.html?client=mini-program&page=registration&compact=1");
  const serviceRail = page.locator("#mobile-service-rail .mobile-service-rail-scroll");
  const currentRegistration = serviceRail.locator('[data-mobile-rail-tab="registration"][aria-current="page"]');
  await expect(currentRegistration).toBeVisible();
  await expect.poll(() => serviceRail.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  const registrationIsInsideRail = await serviceRail.evaluate((element) => {
    const current = element.querySelector('[data-mobile-rail-tab="registration"][aria-current="page"]');
    if (!current) return false;
    const railBox = element.getBoundingClientRect();
    const currentBox = current.getBoundingClientRect();
    return currentBox.left >= railBox.left - 1 && currentBox.right <= railBox.right + 1;
  });
  expect(registrationIsInsideRail).toBe(true);

  const overflow = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth
  }));
  expect(overflow.scrollWidth).toBe(overflow.width);
  expect(consoleErrors).toEqual([]);
});
