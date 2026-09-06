const { expect, test } = require("@playwright/test");

async function login(page, username = "health") {
  await page.goto("/login.html");
  await page.locator("#login-user").selectOption(username);
  await page.locator("input[name='password']").fill("123456");
  await page.locator("#login-form button[type='submit']").click();
  await expect(page).toHaveURL(username === "health" ? /index\.html$/ : /institution\.html$/);
  await expect(page.locator("html")).toHaveAttribute("data-auth-resolved", "allowed");
  await expect(page.locator("html")).toHaveAttribute("data-navigation-shell", "ready");
}

const digest = "a".repeat(64);
function center(status = "draft", version = 2, text = "controlled-rule") {
  return {
    contractVersion: "ai-governance.v1", productionReady: false,
    summary: { total: 1, submitted: 0, approved: 0, suspended: 0 },
    rules: [{ id: "rule-001", productionReady: false, governance: {
      status, version, sourceDigest: digest, submittedBy: "independent-submitter", reviewedBy: "",
      card: { sourceRef: text, sourceDigest: digest, ruleVersion: "v1", evidenceRef: text, evidenceDigest: digest, riskLevel: "medium" }
    } }]
  };
}
function json(route, payload, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(payload) });
}

test("governance navigation and mobile hostile metadata rendering remain safe", async ({ page }) => {
  const hostile = '<img src=x onerror="globalThis.aiCompromised=true">';
  await page.route("**/api/ai-governance/center", (route) => json(route, center("draft", 2, hostile)));
  await login(page);
  await expect(page.locator(".navigation-sidebar a[data-navigation-page='ai-governance.html']")).toHaveCount(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/ai-governance.html");
  await expect(page.locator("#ai-source-title")).toHaveText("治理数据已连接");
  await expect(page.locator("#ai-rules")).toContainText(hostile);
  await expect(page.locator("#ai-rules img")).toHaveCount(0);
  await expect(page.locator("#ai-boundary-title")).toHaveText("生产保持 NO-GO");
  expect(await page.evaluate(() => globalThis.aiCompromised)).toBeUndefined();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
});

test("governance authorization failure clears data and refresh retries the authoritative query", async ({ page }) => {
  await login(page);
  let denied = true;
  await page.route("**/api/ai-governance/center", (route) => json(route, denied ? { message: "denied" } : { ...center(), rules: [], summary: {} }, denied ? 403 : 200));
  await page.goto("/ai-governance.html");
  await expect(page.locator("#ai-source-title")).toHaveText("无权访问治理中心");
  await expect(page.locator("[data-ai-select]")).toHaveCount(0);
  await expect(page.locator("#ai-command-panel")).toBeHidden();
  denied = false;
  await page.locator("#ai-refresh").click();
  await expect(page.locator("#ai-source-title")).toHaveText("治理数据已连接");
  await expect(page.locator("#ai-rules")).toContainText("当前没有可治理");
});

test("failed command retries reuse idempotency and version without optimistic approval", async ({ page }) => {
  await login(page);
  let current = center();
  const commands = [];
  await page.route("**/api/ai-governance/center", (route) => json(route, current));
  await page.route("**/api/ai-governance/rules/rule-001/actions", async (route) => {
    const request = route.request();
    commands.push({ body: request.postDataJSON(), key: request.headers()["idempotency-key"] });
    if (commands.length === 1) return json(route, { message: "temporary failure" }, 503);
    current = center("submitted", 3);
    return json(route, { productionReady: false });
  });
  await page.goto("/ai-governance.html");
  await page.locator("[data-ai-select]").click();
  await page.locator("#ai-action").selectOption("submit");
  await page.locator("#ai-submit").click();
  await expect(page.locator("#ai-source-title")).toHaveText("治理操作未确认");
  await expect(page.locator("#ai-rules")).toContainText("草稿");
  await page.locator("#ai-submit").click();
  await expect(page.locator("#ai-rules")).toContainText("待独立审批");
  expect(commands).toHaveLength(2);
  expect(commands[0]).toEqual(commands[1]);
  expect(commands[0].body.expectedVersion).toBe(2);
  expect(commands[0].body.action).toBe("submit");
  expect(commands[0].key).toBe(commands[0].body.idempotencyKey);
  expect(commands[0].body.card).toBeUndefined();
});

test("metadata registration binds the server digest and stale/self approvals stay unconfirmed", async ({ page }) => {
  await login(page);
  let current = center("unregistered", 0);
  const commands = [];
  await page.route("**/api/ai-governance/center", (route) => json(route, current));
  await page.route("**/api/ai-governance/rules/rule-001/actions", (route) => {
    const body = route.request().postDataJSON();
    commands.push(body);
    return json(route, { message: body.action === "register" ? "version conflict" : "independent review required" }, body.action === "register" ? 409 : 403);
  });
  await page.goto("/ai-governance.html");
  await page.locator("[data-ai-select]").click();
  await expect(page.locator("#ai-source-digest")).toHaveValue(digest);
  await expect(page.locator("#ai-source-digest")).toHaveAttribute("readonly", "");
  await page.locator("#ai-submit").click();
  await expect(page.locator("#ai-source-detail")).toContainText("version conflict");
  expect(commands[0].card.sourceDigest).toBe(digest);
  await expect(page.locator("#ai-rules")).toContainText("未登记");
  current = center("submitted", 4);
  await page.locator("#ai-refresh").click();
  await page.locator("[data-ai-select]").click();
  await page.locator("#ai-action").selectOption("approve");
  await page.locator("#ai-submit").click();
  await expect(page.locator("#ai-source-detail")).toContainText("当前账号无权执行");
  await expect(page.locator("#ai-rules")).toContainText("待独立审批");
  expect(commands[1].expectedVersion).toBe(4);
});

test("institution accounts cannot open governance or see its navigation", async ({ page }) => {
  await login(page, "hospital");
  await expect(page.locator(".navigation-sidebar a[data-navigation-page='ai-governance.html']")).toHaveCount(0);
  await page.goto("/ai-governance.html");
  await expect(page).toHaveURL(/institution\.html\?denied=ai-governance\.html$/);
});

test("source drift replaces historic approval with registration-only controls", async ({ page }) => {
  await login(page);
  const stale = center("stale", 8);
  stale.summary.stale = 1;
  stale.rules[0].governance.storedStatus = "approved";
  stale.rules[0].governance.sourceIntegrity = "drifted";
  stale.rules[0].governance.card.sourceDigest = "b".repeat(64);
  await page.route("**/api/ai-governance/center", (route) => json(route, stale));
  await page.goto("/ai-governance.html");
  await expect(page.locator("#ai-rules")).toContainText("来源漂移，待重新登记");
  await expect(page.locator("#ai-rules")).toContainText("历史批准不适用于当前来源");
  await expect(page.locator("#ai-summary")).toContainText("来源漂移待登记");
  await page.locator("[data-ai-select]").click();
  await expect(page.locator("#ai-action option")).toHaveCount(1);
  await expect(page.locator("#ai-action")).toHaveValue("register");
  await expect(page.locator("#ai-source-digest")).toHaveValue(digest);
});
