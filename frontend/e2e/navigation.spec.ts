import { test, expect } from "@playwright/test";

test.describe("側欄與路由", () => {
  test("從 Explore 點選 Saved 導向登入（未認證）", async ({ page }) => {
    await page.goto("/explore");
    await expect(page.getByRole("heading", { name: /^Explore$/i })).toBeVisible();
    await page.getByRole("link", { name: "Saved", exact: true }).first().click();
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
  });

  test("Explore 頁可點選 Inspiration 導向靈感頁", async ({ page }) => {
    await page.goto("/explore");
    await page.getByRole("link", { name: "Inspiration", exact: true }).first().click();
    await expect(page).toHaveURL(/\/inspiration/);
    await expect(page.getByRole("heading", { name: /Get inspired|靈感/i })).toBeVisible();
  });
});
