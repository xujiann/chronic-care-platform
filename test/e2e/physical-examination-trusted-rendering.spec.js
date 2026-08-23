const { expect, test } = require("@playwright/test");

const HOSTILE_TEXT = '<img data-physical-exam-text-xss src="x" onerror="window.__physicalExamXss=true">';
const HOSTILE_CLASS = '"><img data-physical-exam-class-xss src="x" onerror="window.__physicalExamXss=true">';

async function loginCommission(page) {
  await page.goto("/login.html");
  await page.locator("#login-user").selectOption("health");
  await page.locator("input[name='password']").fill("123456");
  await page.locator("#login-form button[type='submit']").click();
  await expect(page).toHaveURL(/index\.html$/);
}

test("physical examination translations and quality reviews keep hostile API fields inert", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.addInitScript(() => {
    window.__physicalExamXss = false;
  });
  await loginCommission(page);

  await page.route("**/api/physical-exams", async (route) => {
    const response = await route.fetch();
    const overview = await response.json();
    overview.highlights = {
      ...(overview.highlights || {}),
      translations: [
        {
          status: HOSTILE_CLASS,
          title: HOSTILE_TEXT,
          value: HOSTILE_TEXT,
          plainMeaning: HOSTILE_TEXT,
          nextStep: HOSTILE_TEXT,
          department: HOSTILE_TEXT,
          boundary: HOSTILE_TEXT
        },
        { status: "high-risk", title: "高危解释", value: "1", plainMeaning: "需复核", nextStep: "复诊", department: "全科", boundary: "不替代诊断" }
      ],
      qualityReviews: [
        {
          status: HOSTILE_CLASS,
          institution: HOSTILE_TEXT,
          score: HOSTILE_TEXT,
          reportId: HOSTILE_TEXT,
          date: HOSTILE_TEXT,
          issues: [{ level: HOSTILE_CLASS, message: HOSTILE_TEXT }]
        },
        { status: "passed", institution: "安全机构", score: 100, reportId: "report-safe", date: "2026-08-23", issues: [{ level: "blocking", message: "阻断项" }] }
      ]
    };
    await route.fulfill({ response, contentType: "application/json", body: JSON.stringify(overview) });
  });

  await page.goto("/physical-examination.html");

  const translations = page.locator("#physical-exam-translations");
  const qualityReviews = page.locator("#physical-exam-quality-reviews");
  await expect(translations).toContainText(HOSTILE_TEXT);
  await expect(qualityReviews).toContainText(HOSTILE_TEXT);
  await expect(translations.locator(".translation-card")).toHaveCount(2);
  await expect(qualityReviews.locator(".quality-review-card")).toHaveCount(2);
  const hostileTranslation = translations.locator(".translation-card").filter({ hasText: HOSTILE_TEXT });
  const hostileQualityReview = qualityReviews.locator(".quality-review-card").filter({ hasText: HOSTILE_TEXT });
  await expect(hostileTranslation).toHaveAttribute("class", "translation-card");
  await expect(hostileQualityReview).toHaveAttribute("class", "quality-review-card");
  await expect(hostileQualityReview.locator(".issue")).toHaveAttribute("class", "issue");
  await expect(translations.locator(".translation-card.high-risk")).toContainText("高危解释");
  await expect(qualityReviews.locator(".quality-review-card.passed .issue.blocking")).toHaveText("阻断项");
  await expect(page.locator("[data-physical-exam-class-xss], [data-physical-exam-text-xss]")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__physicalExamXss)).toBe(false);
  expect(pageErrors).toEqual([]);
  await page.unrouteAll({ behavior: "wait" });
});
