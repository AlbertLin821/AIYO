import { test, expect } from "@playwright/test";

test.describe("視覺與設計代幣", () => {
  test("globals.css 定義的 body 背景變數存在", async ({ page }) => {
    await page.goto("/home");
    const bg = await page.evaluate(() =>
      getComputedStyle(document.body).getPropertyValue("--color-bg-body").trim()
    );
    expect(bg.length).toBeGreaterThan(0);
    expect(bg).toMatch(/^#/);
  });

  test("登入頁主容器使用 surface 類別", async ({ page }) => {
    await page.goto("/login");
    const modal = page.locator(".rounded-card.border").first();
    await expect(modal).toBeVisible();
  });
});
