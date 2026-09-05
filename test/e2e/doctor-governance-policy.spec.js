const { expect, test } = require("@playwright/test");

for (const governanceStatus of ["suspended", "stale", "draft"]) {
  test(`doctor cannot adopt ${governanceStatus} recommendations and may retain an order`, async ({ page }) => {
    const commands = [];
    const hostile = '<img src=x onerror="globalThis.doctorGovernanceCompromised=true">';
    await page.route("**/api/phase2/clinical-assist", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ alerts: [{
      id: "alert-governance-test", alertTitle: "待复核临床提醒", residentId: "demo-reference", messageReceiptStatus: "pending", status: "pending", recommendation: "SHOULD-NOT-DISPLAY", decisionAvailable: false, governanceStatus: `${governanceStatus} ${hostile}`
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
    await expect.poll(() => commands.length).toBe(1);
    expect(commands[0].doctorAction).toBe("kept-order-with-reason");
    await expect(panel.locator("img")).toHaveCount(0);
    expect(await page.evaluate(() => globalThis.doctorGovernanceCompromised)).toBeUndefined();
  });
}
