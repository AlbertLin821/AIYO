import { test, expect } from "@playwright/test";
import { e2eCredentials, loginWithEmailPassword } from "./helpers";

test.describe("AI 對話", () => {
  test("未登入時主頁導向登入", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login/);
  });

  test("已登入時顯示聊天輸入", async ({ page }) => {
    const cred = e2eCredentials();
    test.skip(!cred, "請設定 E2E_EMAIL 與 E2E_PASSWORD");
    await loginWithEmailPassword(page, cred!.email, cred!.password);
    const input = page.locator("#chat-message-input");
    await expect(input).toBeVisible({ timeout: 30_000 });
    await expect(input).toHaveAttribute("aria-label", "輸入聊天訊息");
  });
});
