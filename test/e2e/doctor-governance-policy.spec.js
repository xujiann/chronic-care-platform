const { expect, test } = require("@playwright/test");

async function checkUnavailableRecommendation(page, governanceStatus) {
    const commands = [];
    const hostile = '<img src=x onerror="globalThis.doctorGovernanceCompromised=true">';
    await page.route("**/api/phase2/clinical-assist", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ alerts: [{
      id: "alert-governance-test", version: 4, alertTitle: "待复核临床提醒", residentId: "demo-reference", messageReceiptStatus: "pending", status: "pending", recommendation: "SHOULD-NOT-DISPLAY", decisionAvailable: false, governanceStatus: `${governanceStatus} ${hostile}`
    }] }) }));
    await page.route("**/api/phase2/clinical-assist/alerts/alert-governance-test/receipt", (route) => {
      commands.push(route.request().postDataJSON());
      return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    });
    await page.goto("/login.html");
    await page.locator("#login-user").selectOption("doctor");
    await page.locator("input[name='password']").fill("123456");
    await page.locator("#login-form button[type='submit']").click();
    await expect(page).toHaveURL(/doctor\.html$/);
    const panel = page.locator("#doctor-clinical-assist");
    await expect(panel).toContainText("decisionAvailable=false");
    await expect(panel).toContainText("建议暂不可采纳");
    await expect(panel).not.toContainText("SHOULD-NOT-DISPLAY");
    const accept = panel.getByRole("button", { name: "采纳提醒" });
    await expect(accept).toBeDisabled();
    // Removing the DOM disabled flag must not bypass the command-side check.
    await accept.evaluate((button) => { button.disabled = false; });
    await accept.click();
    await panel.getByRole("button", { name: "保留并说明" }).click();
    await expect(panel.getByRole("status")).toContainText("请填写 8–2000 个字符");
    expect(commands).toHaveLength(0);
    await panel.getByRole("textbox", { name: "保留原医嘱的临床理由" }).fill("太短");
    await panel.getByRole("button", { name: "保留并说明" }).click();
    expect(commands).toHaveLength(0);
    const reason = "已复核当前诊疗记录，需要保留原医嘱等待进一步检查。";
    await panel.getByRole("textbox", { name: "保留原医嘱的临床理由" }).fill(reason);
    await panel.getByRole("button", { name: "保留并说明" }).click();
    await expect.poll(() => commands.length).toBe(1);
    expect(commands[0].doctorAction).toBe("kept-order-with-reason");
    expect(commands[0].actionDetail).toBe(reason);
    expect(commands[0].expectedVersion).toBe(4);
    await expect(panel.locator("img")).toHaveCount(0);
    expect(await page.evaluate(() => globalThis.doctorGovernanceCompromised)).toBeUndefined();
}

test("doctor cannot adopt suspended recommendations and may retain an order", async ({ page }) => checkUnavailableRecommendation(page, "suspended"));
test("doctor cannot adopt stale recommendations and may retain an order", async ({ page }) => checkUnavailableRecommendation(page, "stale"));
test("doctor cannot adopt draft recommendations and may retain an order", async ({ page }) => checkUnavailableRecommendation(page, "draft"));

test("doctor receipt retries bind the same reason and version to a stable idempotency key", async ({ page }) => {
  const commands = [];
  await page.route("**/api/phase2/clinical-assist", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ alerts: [{ id: "retry-alert", version: 7, status: "pending", decisionAvailable: false }] }) }));
  await page.route("**/api/phase2/clinical-assist/alerts/retry-alert/receipt", (route) => {
    commands.push({ payload: route.request().postDataJSON(), key: route.request().headers()["idempotency-key"] });
    return route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
  });
  await page.goto("/login.html");
  await page.locator("#login-user").selectOption("doctor");
  await page.locator("input[name='password']").fill("123456");
  await page.locator("#login-form button[type='submit']").click();
  await expect(page).toHaveURL(/doctor\.html$/);
  const panel = page.locator("#doctor-clinical-assist");
  const reason = panel.getByRole("textbox", { name: "保留原医嘱的临床理由" });
  await reason.fill("原医嘱经复核后继续执行，并等待检查结果。");
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    await panel.getByRole("button", { name: "保留并说明" }).click();
    await expect.poll(() => commands.length).toBe(attempt);
    await expect(panel.getByRole("status")).toContainText("回执未确认");
    await expect(reason).toBeEnabled();
  }
  expect(commands[0]).toEqual(commands[1]);
  expect(commands[0].key).toBe(commands[0].payload.idempotencyKey);
  expect(commands[0].payload.expectedVersion).toBe(7);
  await reason.fill("经新检查结果复核，原医嘱暂予保留并继续观察。");
  await panel.getByRole("button", { name: "保留并说明" }).click();
  await expect.poll(() => commands.length).toBe(3);
  expect(commands[2].key).not.toBe(commands[0].key);
  expect(commands[2].payload.actionDetail).toBe("经新检查结果复核，原医嘱暂予保留并继续观察。");
});
