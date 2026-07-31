const { test, expect } = require("@playwright/test");

async function loginAsResident(page) {
  await page.goto("/login.html");
  await page.locator("#login-user").selectOption("citizen");
  await page.locator("input[name='password']").fill("123456");
  await Promise.all([
    page.waitForURL(/citizen\.html/),
    page.getByRole("button", { name: "进入系统" }).click()
  ]);
}

test("resident mini program validates session, isolates family scope and fits 390 by 844", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAsResident(page);
  await page.goto("/resident-mini-program.html");

  await expect(page.locator("#app-content")).toBeVisible();
  await expect(page.locator("#session-gate")).toBeHidden();
  await expect(page.getByRole("heading", { name: "健康大连" })).toBeVisible();
  await expect(page.locator("#current-member-name")).toContainText("演示居民A");
  await expect(page.getByRole("button", { name: "打开健康档案" })).toBeVisible();
  await expect(page.getByRole("button", { name: "打开急救服务" })).toBeVisible();

  await page.locator("#member-switcher").click();
  await expect(page.locator("#member-dialog")).toBeVisible();
  await expect(page.locator("#member-list")).toContainText("家庭关系尚未完成核验");
  await expect(page.locator("#member-list button:disabled")).toHaveCount(1);
  await page.locator("#member-dialog .dialog-close").click();

  const layout = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    minimumTarget: Math.min(...Array.from(document.querySelectorAll("button, a")).filter((element) => {
      const style = getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden" && element.getBoundingClientRect().width > 0;
    }).map((element) => element.getBoundingClientRect().height))
  }));
  expect(layout.document).toBeLessThanOrEqual(layout.viewport);
  expect(layout.minimumTarget).toBeGreaterThanOrEqual(44);

  await page.getByRole("button", { name: "我的", exact: true }).click();
  await page.locator("#large-text-toggle").check();
  await expect(page.locator("body")).toHaveClass(/large-text/);
  await page.locator("#contrast-toggle").check();
  await expect(page.locator("body")).toHaveClass(/high-contrast/);
});

test("messages use Chinese copy, deep links and confirmed read receipts", async ({ page }) => {
  await loginAsResident(page);
  await page.goto("/resident-mini-program.html?page=messages");
  await expect(page.locator("#app-content")).toBeVisible();
  await expect(page.getByRole("heading", { name: "消息与待办" })).toBeVisible();

  const visibleText = await page.locator("#app-main").innerText();
  expect(visibleText).not.toMatch(/[A-Za-z]{2,}/);

  const unread = page.locator("[data-mark-read]").first();
  if (await unread.count()) {
    const messageId = await unread.getAttribute("data-mark-read");
    const card = page.locator(`[data-message-id="${messageId}"]`);
    await unread.click();
    await expect(card).toContainText("已读");
    await expect(card.locator("[data-mark-read]")).toHaveCount(0);
  }

  const serviceButton = page.locator("[data-message-route]").first();
  if (await serviceButton.count()) {
    await serviceButton.click();
    await expect(page.locator("#page-detail")).toBeVisible();
    await expect(page.locator("#detail-boundary")).not.toBeEmpty();
  }
});

test("expired or locally forged session is blocked before resident data loads", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("health-city-auth-session", JSON.stringify({
      id: "u4",
      role: "citizen",
      accountId: "a1",
      residentId: "r1",
      authMode: "local",
      expiresAt: new Date(Date.now() + 60_000).toISOString()
    }));
  });
  await page.goto("/resident-mini-program.html");
  await expect(page.locator("#session-gate")).toBeVisible();
  await expect(page.locator("#gate-title")).toHaveText("需要安全登录");
  await expect(page.locator("#app-content")).toBeHidden();
  await expect(page.locator("#gate-login")).toBeVisible();
});
