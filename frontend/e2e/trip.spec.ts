import { test, expect } from "@playwright/test";
import { e2eCredentials, loginWithEmailPassword } from "./helpers";

test.describe("行程頁", () => {
  test("未登入時 /trips 導向登入", async ({ page }) => {
    await page.goto("/trips");
    await expect(page).toHaveURL(/\/login/);
  });

  test("已登入時顯示 Trips 標題", async ({ page }) => {
    const cred = e2eCredentials();
    test.skip(!cred, "請設定 E2E_EMAIL 與 E2E_PASSWORD");
    await loginWithEmailPassword(page, cred!.email, cred!.password);
    await page.goto("/trips");
    await expect(page.getByRole("heading", { name: /^Trips$/ })).toBeVisible({
      timeout: 20_000,
    });
  });
});
