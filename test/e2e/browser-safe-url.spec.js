const { expect, test } = require("@playwright/test");

test("browser safe URL port allows controlled destinations and rejects hostile schemes before mutation", async ({ page }) => {
  await page.goto("/login.html");
  const result = await page.evaluate(() => {
    const SafeUrl = window.HealthBrowserSafeUrl;
    const link = document.createElement("a");
    SafeUrl.setElementUrl(link, "href", "./citizen.html?page=health-record", {
      capability: "internal-navigation",
      baseUrl: location.href
    });
    const calls = [];
    SafeUrl.navigate("./login.html?expired=1", {
      capability: "internal-navigation",
      baseUrl: location.href,
      mode: "replace",
      navigation: { replace: (href) => calls.push(href) }
    });
    const rejected = {};
    for (const [name, candidate] of Object.entries({
      javascript: "javascript:alert(1)",
      data: "data:text/html,<script>alert(1)</script>",
      userinfo: "https://user:secret@127.0.0.1:5210/citizen.html",
      protocolRelative: "//127.0.0.1:5210/citizen.html",
      unapprovedOrigin: "https://evil.example/citizen.html"
    })) {
      try {
        SafeUrl.setElementUrl(link, "href", candidate, {
          capability: "internal-navigation",
          baseUrl: location.href
        });
      } catch (error) {
        rejected[name] = error.code;
      }
    }
    return {
      contractId: SafeUrl.CONTRACT_ID,
      href: link.getAttribute("href"),
      calls,
      rejected
    };
  });
  expect(result.contractId).toBe("browser-safe-url-policy.v1");
  expect(result.href).toBe("./citizen.html?page=health-record");
  expect(result.calls).toEqual([`${new URL(page.url()).origin}/login.html?expired=1`]);
  expect(Object.keys(result.rejected)).toEqual([
    "javascript",
    "data",
    "userinfo",
    "protocolRelative",
    "unapprovedOrigin"
  ]);
  expect(Object.values(result.rejected).every((code) => /^SAFE_URL_/.test(code))).toBe(true);
});

test("login redirect still crosses the unified internal navigation port", async ({ page }) => {
  await page.goto("/login.html?redirect=citizen.html");
  await page.locator("#login-user").selectOption("citizen");
  await page.locator("input[name='password']").fill("123456");
  await page.locator("#login-form button[type='submit']").click();
  await expect(page).toHaveURL(/citizen\.html$/);
});

test("template URL bindings reject hostile values without leaving a navigable attribute", async ({ page }) => {
  await page.goto("/login.html");
  const result = await page.evaluate(() => {
    const candidates = {
      javascript: "javascript:alert(1)",
      data: "data:text/html,<script>alert(1)</script>",
      userinfo: "https://user:secret@www.nhc.gov.cn/policy",
      protocolRelative: "//www.nhc.gov.cn/policy",
      unapprovedOrigin: "https://evil.example/policy"
    };
    const links = Object.keys(candidates).map(() => {
      const link = document.createElement("a");
      link.setAttribute("href", "./stale.html");
      return link;
    });
    const outcomes = window.HealthBrowserSafeUrl.setElementUrlBindings(links.map((link, index) => ({
      element: link,
      input: Object.values(candidates)[index],
      options: {
        capability: "official-source",
        baseUrl: location.href,
        allowedOrigins: ["https://www.nhc.gov.cn"]
      }
    })));
    return {
      outcomes: outcomes.map((item) => ({ ok: item.ok, errorCode: item.errorCode })),
      hrefs: links.map((link) => link.getAttribute("href"))
    };
  });
  expect(result.outcomes.every((item) => item.ok === false && /^SAFE_URL_/.test(item.errorCode))).toBe(true);
  expect(result.hrefs).toEqual([null, null, null, null, null]);
});
