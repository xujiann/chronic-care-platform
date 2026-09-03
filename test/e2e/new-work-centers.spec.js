const { expect, test } = require("@playwright/test");

async function loginCommission(page) {
  await page.goto("/login.html");
  await page.locator("#login-user").selectOption("health");
  await page.locator("input[name='password']").fill("123456");
  await page.locator("#login-form button[type='submit']").click();
  await expect(page).toHaveURL(/index\.html$/);
}

test("commission navigation exposes the new governed work centers and pages remain mobile safe", async ({ page }) => {
  test.setTimeout(120_000);
  await loginCommission(page);

  const pages = [
    ["unified-work-center.html", "统一待办与消息中心"],
    ["account-lifecycle.html", "账号全生命周期工作台"],
    ["maternal-child.html", "出生证明与妇幼接续任务工作台"],
    ["referral-teleconsultation.html", "转诊与远程会诊任务工作台"],
    ["drug-consumable.html", "药耗监管与整改协同工作台"],
    ["research-sandbox.html", "科研数据集与安全沙箱工作台"],
    ["public-health-supervision-cases.html", "卫生监督案件协同工作台"]
  ];

  for (const [target] of pages) {
    await expect(page.locator(`.navigation-sidebar a[data-navigation-page='${target}']`)).toHaveCount(1);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  for (const [target, title] of pages) {
    await page.goto(`/${target}`);
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-auth-resolved", "allowed");
    if (target === "unified-work-center.html") {
      await expect(page.locator("#work-source-title")).toHaveText("实时业务数据已连接");
    }
    if (target === "account-lifecycle.html") {
      await expect(page.locator("#account-source-title")).toHaveText("账号治理数据已连接");
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflow, `${target} must stay inside the mobile viewport`).toBe(false);
  }
});

test("account lifecycle remains commission-manager only", async ({ page }) => {
  await page.goto("/login.html");
  await page.locator("#login-user").selectOption("hospital");
  await page.locator("input[name='password']").fill("123456");
  await page.locator("#login-form button[type='submit']").click();
  await expect(page).toHaveURL(/institution\.html$/);
  await page.goto("/account-lifecycle.html");
  await expect(page).toHaveURL(/institution\.html\?denied=account-lifecycle\.html$/);
});
