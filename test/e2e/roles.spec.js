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
  await page.goto("/platform.html");

  await expect(page.getByRole("heading", { name: "统一应用目录" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "医疗机构信用评价" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "安全信创验收台账" })).toBeVisible();
  await expect(page.locator("#application-catalog tbody tr")).toHaveCount(6);
  await expect(page.locator("#institution-credit-evaluations tbody tr")).toHaveCount(3);
  await expect(page.locator("#security-acceptance-ledger > div")).toHaveCount(4);

  const applicationRow = page.locator("#application-catalog tbody tr", { hasText: "全民健康信息平台一、二期" });
  await applicationRow.getByRole("button", { name: "维护" }).click();
  await expect(page.locator("#platform-edit-dialog")).toHaveAttribute("open", "");
  await expect(page.locator("#platform-edit-title")).toHaveText("维护：全民健康信息平台一、二期");
  await expect(page.locator("#platform-edit-form [name='owner']")).toHaveValue("规划信息处");
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
