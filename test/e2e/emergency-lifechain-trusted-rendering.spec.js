"use strict";

const { expect, test } = require("@playwright/test");

const HOSTILE_MARKUP = '<img data-lifechain-xss src="x" onerror="window.__lifechainXss=true">';

async function loginAsCommission(page) {
  await page.goto("/login.html");
  await page.locator("#login-user").selectOption("health");
  await page.locator("input[name='password']").fill("123456");
  await page.locator("#login-form button[type='submit']").click();
  await expect(page).toHaveURL(/index\.html$/);
}

test("emergency life-chain renders hostile API fields as inert text", async ({ page }) => {
  let rejectOverview = false;
  await page.route("**/api/emergency/life-chain/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith("/overview")) {
      if (rejectOverview) {
        await route.fulfill({ status: 500, json: { message: HOSTILE_MARKUP } });
        return;
      }
      await route.fulfill({
        json: {
          activeEvent: { id: HOSTILE_MARKUP, eventNo: HOSTILE_MARKUP, status: HOSTILE_MARKUP, sos: {} },
          firstAidTasks: [{ status: HOSTILE_MARKUP, distanceMeters: HOSTILE_MARKUP }],
          greenChannelPreparations: [{ eventId: HOSTILE_MARKUP, channel: HOSTILE_MARKUP, status: "pending-hospital-confirmation" }],
          familyNotifications: [{ contactName: HOSTILE_MARKUP, status: HOSTILE_MARKUP }],
          fallbackDeliveries: [{ channel: HOSTILE_MARKUP, status: HOSTILE_MARKUP }],
          authorizations: [{ id: HOSTILE_MARKUP, deviceId: HOSTILE_MARKUP, active: true }],
          summary: { goldenFourMinuteTasks: HOSTILE_MARKUP, pendingHospitalConfirmation: HOSTILE_MARKUP }
        }
      });
      return;
    }
    if (pathname.endsWith("/quality")) {
      await route.fulfill({
        json: {
          summary: {
            cases: HOSTILE_MARKUP,
            automaticSos: HOSTILE_MARKUP,
            firstAidTaskCoverage: HOSTILE_MARKUP,
            hospitalPrealertsConfirmed: HOSTILE_MARKUP,
            suppressedDuplicateSignals: HOSTILE_MARKUP,
            cancellationReviews: HOSTILE_MARKUP
          },
          rows: [{ eventNo: HOSTILE_MARKUP, qualityState: HOSTILE_MARKUP, signal: HOSTILE_MARKUP, fallback: HOSTILE_MARKUP }],
          boundary: HOSTILE_MARKUP
        }
      });
      return;
    }
    await route.fulfill({
      json: {
        coverage: {
          activeEvents: HOSTILE_MARKUP,
          availableVehicles: HOSTILE_MARKUP,
          availableAed: HOSTILE_MARKUP,
          responderTasks: HOSTILE_MARKUP,
          pendingCancellationReviews: HOSTILE_MARKUP,
          gap: HOSTILE_MARKUP
        },
        activeEvents: [{ eventNo: HOSTILE_MARKUP, status: HOSTILE_MARKUP }],
        cancellationReviews: [{ eventId: HOSTILE_MARKUP, reason: HOSTILE_MARKUP }],
        boundary: HOSTILE_MARKUP
      }
    });
  });

  await loginAsCommission(page);
  await page.goto("/emergency.html");

  for (const selector of ["#lifechain-overview", "#lifechain-quality", "#lifechain-command-center"]) {
    await expect(page.locator(selector)).toContainText(HOSTILE_MARKUP);
  }
  await expect(page.locator("[data-lifechain-xss], #lifechain-overview script, #lifechain-quality script, #lifechain-command-center script")).toHaveCount(0);
  expect(await page.evaluate(() => window.__lifechainXss || false)).toBe(false);
  await expect(page.locator("[data-green-channel-event]")).toHaveAttribute("data-green-channel-event", HOSTILE_MARKUP);
  await expect(page.locator("[data-revoke-authorization]")).toHaveAttribute("data-revoke-authorization", HOSTILE_MARKUP);

  rejectOverview = true;
  await page.evaluate(() => loadLifeChain());
  await expect(page.locator("#lifechain-overview")).toHaveText(HOSTILE_MARKUP);
  await expect(page.locator("[data-lifechain-xss]")).toHaveCount(0);
});
