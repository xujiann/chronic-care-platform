const { test, expect } = require("@playwright/test");

async function loginAsResident(page) {
  await page.goto("/login.html");
  await page.locator("#login-user").selectOption("citizen");
  await page.locator("input[name='password']").fill("123456");
  await Promise.all([
    page.waitForURL(/citizen\.html/),
    page.locator("#login-form button[type='submit']").click()
  ]);
}

test("resident mini program validates session, isolates family scope and fits 390 by 844", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAsResident(page);
  await page.goto("/resident-mini-program.html");

  await expect(page.locator("#app-content")).toBeVisible();
  await expect(page.locator("#session-gate")).toBeHidden();
  await expect(page.getByRole("heading", { name: "健康区域" })).toBeVisible();
  await expect(page.locator("#current-member-name")).toContainText("演示居民A");
  await expect(page.getByRole("button", { name: "打开健康档案" })).toBeVisible();
  await expect(page.getByRole("button", { name: "打开急救服务" })).toBeVisible();

  await page.locator("#member-switcher").click();
  await expect(page.locator("#member-dialog")).toBeVisible();
  await expect(page.locator("#member-list")).toContainText("家庭关系尚未完成核验");
  await expect(page.locator("#member-list [aria-disabled='true']")).toHaveCount(1);
  await expect(page.getByRole("link", { name: "重新申请" })).toBeVisible();
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
  await expect(page).toHaveURL(/login\.html\?redirect=resident-mini-program\.html/);
  await expect(page.locator("#login-form")).toBeVisible();
  await expect(page.locator("#app-content")).toHaveCount(0);
});

test("background and offline transitions clear resident state before secure recovery", async ({ page }) => {
  await loginAsResident(page);
  await page.goto("/resident-mini-program.html");
  await expect(page.locator("#app-content")).toBeVisible();
  await page.evaluate(() => window.ResidentMiniProgramApp.navigate({
    page: "health-record",
    recordId: "record-1"
  }));
  await expect(page.locator("#page-detail")).toBeVisible();

  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await expect(page.locator("#gate-title")).toHaveText("网络连接已断开");
  await expect(page.locator("#app-content")).toBeHidden();
  expect(await page.evaluate(() => window.ResidentMiniProgramApp.getState())).toMatchObject({
    suspended: true,
    residentId: "",
    route: "home"
  });

  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.locator("#app-content")).toBeVisible();
  await expect(page.locator("#page-home")).toBeVisible();
  expect(await page.evaluate(() => window.ResidentMiniProgramApp.getState())).toMatchObject({
    suspended: false,
    residentId: "r1",
    route: "home"
  });
});

test("unsafe start and message links fail closed to the current resident home", async ({ page }) => {
  await loginAsResident(page);
  await page.goto("/resident-mini-program.html?page=emr&residentId=r4");
  await expect(page.locator("#app-content")).toBeVisible();
  await expect(page.locator("#page-home")).toBeVisible();
  await expect(page.locator("#toast")).toContainText("已阻止不安全或越权的页面链接");
  expect(await page.evaluate(() => window.ResidentMiniProgramApp.getState())).toMatchObject({
    residentId: "r1",
    route: "home"
  });

  await page.getByRole("button", { name: "消息" }).click();
  const messageLink = page.locator("[data-message-link]").first();
  if (await messageLink.count()) {
    await messageLink.evaluate((element) => element.setAttribute("data-message-link", "missing-message"));
    await messageLink.click();
    await expect(page.locator("#toast")).toContainText("已过期或不属于当前居民");
    expect((await page.evaluate(() => window.ResidentMiniProgramApp.getState())).route).toBe("messages");
  }
});

test("message receipt failures roll back without claiming local success", async ({ page }) => {
  await loginAsResident(page);
  await page.route("**/api/messages", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        messages: [{
          id: "e2e-unread-message",
          residentId: "r1",
          targetRole: "citizen",
          status: "unread",
          title: "健康档案更新提醒",
          body: "请查看最新健康档案摘要。",
          route: "health-record",
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          receipts: []
        }]
      })
    });
  });
  await page.route("**/api/messages/*/receipt", async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ message: "service unavailable" })
    });
  });
  await page.goto("/resident-mini-program.html?page=messages");
  const unread = page.locator("[data-mark-read]").first();
  await expect(unread).toHaveCount(1);
  const messageId = await unread.getAttribute("data-mark-read");
  const card = page.locator(`[data-message-id="${messageId}"]`);

  await unread.click();
  await expect(page.locator("#toast")).toContainText("未收到有效回执，消息仍保持未读");
  await expect(card).toContainText("未读");
  await expect(card.locator("[data-mark-read]")).toHaveCount(1);
});

test("slow service shows a Chinese timeout gate and retry restores the app", async ({ page }) => {
  await page.addInitScript(() => {
    window.__RESIDENT_MINI_PROGRAM_TIMEOUT_MS__ = 500;
  });
  await loginAsResident(page);
  let stateRequestCount = 0;
  let releaseFirstStateRequest;
  let finishFirstStateRequest;
  const firstStateRequestBlocked = new Promise((resolve) => {
    releaseFirstStateRequest = resolve;
  });
  const firstStateRequestFinished = new Promise((resolve) => {
    finishFirstStateRequest = resolve;
  });
  await page.route("**/api/state", async (route) => {
    stateRequestCount += 1;
    const isFirstRequest = stateRequestCount === 1;
    try {
      if (isFirstRequest) {
        await firstStateRequestBlocked;
      }
      await route.continue();
    } finally {
      if (isFirstRequest) finishFirstStateRequest();
    }
  });
  await page.goto("/resident-mini-program.html");

  await expect(page.locator("#gate-title")).toHaveText("安全连接超时");
  await expect(page.locator("#app-content")).toBeHidden();
  releaseFirstStateRequest();
  await firstStateRequestFinished;
  await page.locator("#gate-retry").click();
  await expect.poll(() => stateRequestCount).toBe(2);
  await expect(page.locator("#app-content")).toBeVisible();
  await expect(page.locator("#page-home")).toBeVisible();
  expect(await page.evaluate(() => window.ResidentMiniProgramApp.getState())).toMatchObject({
    recovering: false,
    retryQueued: false
  });
});

test("a changed local subject is blocked on foreground recovery", async ({ page }) => {
  await loginAsResident(page);
  await page.goto("/resident-mini-program.html");
  await expect(page.locator("#app-content")).toBeVisible();

  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  await page.evaluate(() => {
    const session = JSON.parse(localStorage.getItem("health-city-auth-session"));
    localStorage.setItem("health-city-auth-session", JSON.stringify({
      ...session,
      id: "different-user",
      accountId: "different-account",
      residentId: "r4"
    }));
    window.dispatchEvent(new Event("pageshow"));
  });

  await expect(page.locator("#gate-title")).toHaveText("登录主体发生变化");
  await expect(page.locator("#gate-login")).toBeVisible();
  await expect(page.locator("#app-content")).toBeHidden();
  expect((await page.evaluate(() => window.ResidentMiniProgramApp.getState())).residentId).toBe("");
});

test("forged signed links and cross-resident message responses fail closed", async ({ page }) => {
  await loginAsResident(page);
  await page.goto("/resident-mini-program.html?page=home&page=messages");
  await expect(page.locator("#page-home")).toBeVisible();
  await expect(page.locator("#toast")).toContainText("已阻止不安全或越权的页面链接");

  const issuedAt = encodeURIComponent(new Date(Date.now() - 30_000).toISOString());
  const expiresAt = encodeURIComponent(new Date(Date.now() + 60_000).toISOString());
  await page.goto(`/resident-mini-program.html?page=health-record&residentId=r1&recordId=record-1&issuedAt=${issuedAt}&expiresAt=${expiresAt}&nonce=nonce-0123456789&signature=abcdefghijklmnopqrstuvwxyz_0123456789-ABCD`);
  await expect(page.locator("#page-home")).toBeVisible();
  await expect(page.locator("#toast")).toContainText("已阻止不安全或越权的页面链接");

  await page.route("**/api/messages", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        messages: [{
          id: "cross-resident-message",
          residentId: "r4",
          targetRole: "citizen",
          status: "unread",
          title: "不应展示",
          createdAt: new Date().toISOString()
        }]
      })
    });
  });
  await page.reload();
  await expect(page.locator("#app-content")).toBeVisible();
  await expect(page.locator("#page-home")).toBeVisible();
  expect((await page.evaluate(() => window.ResidentMiniProgramApp.getState())).unreadCount).toBe(0);
  await page.getByRole("button", { name: "消息" }).click();
  await expect(page.locator("#message-list")).not.toContainText("不应展示");
});

test("duplicate read clicks produce one idempotent server write", async ({ page }) => {
  await loginAsResident(page);
  const createdAt = new Date().toISOString();
  let receiptRequests = 0;
  await page.route("**/api/messages", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        messages: [{
          id: "duplicate-write-message",
          residentId: "r1",
          targetRole: "citizen",
          status: "unread",
          title: "健康服务提醒",
          body: "请打开应用查看服务状态。",
          createdAt,
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          receipts: []
        }]
      })
    });
  });
  await page.route("**/api/messages/duplicate-write-message/receipt", async (route) => {
    receiptRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "duplicate-write-message",
        residentId: "r1",
        targetRole: "citizen",
        status: "read",
        title: "健康服务提醒",
        body: "请打开应用查看服务状态。",
        createdAt,
        receipts: [{ status: "read", at: new Date().toISOString() }]
      })
    });
  });
  await page.goto("/resident-mini-program.html?page=messages");
  await expect(page.locator("[data-mark-read='duplicate-write-message']")).toBeVisible();
  await page.evaluate(() => {
    const button = document.querySelector("[data-mark-read='duplicate-write-message']");
    button.click();
    button.click();
  });
  await expect(page.locator("[data-message-id='duplicate-write-message']")).toContainText("已读");
  expect(receiptRequests).toBe(1);
});

test("withdrawn and expired messages are suppressed while a partial batch receipt rolls back", async ({ page }) => {
  await loginAsResident(page);
  const createdAt = new Date().toISOString();
  const activeExpiry = new Date(Date.now() + 60_000).toISOString();
  await page.route("**/api/messages", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        messages: [
          { id: "batch-1", residentId: "r1", targetRole: "citizen", status: "unread", title: "服务提醒一", createdAt, expiresAt: activeExpiry },
          { id: "batch-2", residentId: "r1", targetRole: "citizen", status: "unread", title: "服务提醒二", createdAt, expiresAt: activeExpiry },
          { id: "withdrawn-1", residentId: "r1", targetRole: "citizen", status: "withdrawn", title: "已撤回提醒", createdAt, expiresAt: activeExpiry },
          { id: "expired-1", residentId: "r1", targetRole: "citizen", status: "unread", title: "过期提醒", createdAt, expiresAt: new Date(Date.now() - 1000).toISOString() }
        ]
      })
    });
  });
  let batchRequests = 0;
  await page.route("**/api/messages/receipts", async (route) => {
    batchRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        receipts: [
          { id: "batch-1", residentId: "r1", status: "read" },
          { id: "batch-2", residentId: "r1", status: "failed" }
        ]
      })
    });
  });
  await page.goto("/resident-mini-program.html?page=messages");
  await expect(page.locator("#message-list")).toContainText("服务提醒一");
  await expect(page.locator("#message-list")).toContainText("服务提醒二");
  await expect(page.locator("#message-list")).not.toContainText("已撤回提醒");
  await expect(page.locator("#message-list")).not.toContainText("过期提醒");
  await page.getByRole("button", { name: "本页全部已读" }).click();
  await expect(page.locator("#toast")).toContainText("部分回执失败，全部保持未读");
  await expect(page.locator("[data-mark-read]")).toHaveCount(2);
  expect(batchRequests).toBe(1);
});

test("message refresh is single-flight and all eight services keep a return path", async ({ page }) => {
  await loginAsResident(page);
  let messageRequests = 0;
  let releaseRefresh;
  const refreshBlocked = new Promise((resolve) => {
    releaseRefresh = resolve;
  });
  await page.route("**/api/messages", async (route) => {
    messageRequests += 1;
    if (messageRequests === 2) await refreshBlocked;
    await route.continue();
  });
  await page.goto("/resident-mini-program.html?page=messages");
  await expect(page.locator("#app-content")).toBeVisible();
  await page.evaluate(() => {
    const button = document.querySelector("#message-refresh");
    button.click();
    button.click();
  });
  await expect.poll(() => messageRequests).toBe(2);
  await expect(page.locator("#message-refresh")).toBeDisabled();
  releaseRefresh();
  await expect(page.locator("#message-refresh")).toBeEnabled();
  await expect(page.locator("#toast")).toContainText("当前居民消息已刷新");

  await page.getByRole("button", { name: "首页", exact: true }).click();
  for (const label of ["健康档案", "电子病历", "预约挂号", "护理服务", "陪诊服务", "家庭医生", "急救服务", "健康待办"]) {
    await page.getByRole("button", { name: `打开${label}` }).click();
    await expect(page.locator("#detail-title")).toHaveText(label);
    await expect(page.locator("#detail-state")).not.toBeEmpty();
    await page.getByRole("button", { name: "返回" }).click();
  }
});

test("resident shell is mobile safe at 320, 375, 390 and 430 widths", async ({ page }) => {
  await loginAsResident(page);
  for (const width of [320, 375, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/resident-mini-program.html");
    await expect(page.locator("#app-content")).toBeVisible();
    const result = await page.evaluate(() => {
      const targets = Array.from(document.querySelectorAll("button, a")).filter((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      });
      return {
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        minimumHeight: Math.min(...targets.map((element) => element.getBoundingClientRect().height)),
        english: (document.querySelector("#app-main")?.innerText || "").match(/[A-Za-z]{2,}/g) || []
      };
    });
    expect(result.scrollWidth).toBe(result.clientWidth);
    expect(result.minimumHeight).toBeGreaterThanOrEqual(44);
    expect(result.english).toEqual([]);
  }
  await page.setViewportSize({ width: 320, height: 844 });
  const enlarged = await page.evaluate(() => {
    document.body.style.fontSize = "200%";
    document.body.classList.add("soft-keyboard-open");
    return {
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      navigationHidden: getComputedStyle(document.querySelector(".bottom-nav")).display === "none"
    };
  });
  expect(enlarged.scrollWidth).toBeLessThanOrEqual(enlarged.clientWidth);
  expect(enlarged.navigationHidden).toBe(true);
});
