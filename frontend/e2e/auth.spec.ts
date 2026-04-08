import { test, expect } from "@playwright/test";
import { e2eCredentials, loginWithEmailPassword } from "./helpers";

test.describe("認證 UI", () => {
  test("登入頁顯示信箱步驟與繼續按鈕", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: /Welcome to AIYO/i })).toBeVisible();
    await expect(page.getByRole("button", { name: "繼續" })).toBeVisible();
  });

  test("輸入信箱後可進入密碼步驟", async ({ page }) => {
    await page.goto("/login");
    await page.getByPlaceholder("name@example.com").fill("e2e-check@example.com");
    await page.getByRole("button", { name: "繼續" }).click();
    await expect(page.getByRole("heading", { name: /歡迎回來/i })).toBeVisible();
    await expect(page.getByPlaceholder("請輸入密碼")).toBeVisible();
  });
});

test.describe("認證 API 整合", () => {
  test("帳密登入成功後進入主頁", async ({ page }) => {
    const cred = e2eCredentials();
    test.skip(!cred, "請設定 E2E_EMAIL 與 E2E_PASSWORD 以執行登入整合測試");
    await loginWithEmailPassword(page, cred!.email, cred!.password);
    await expect(page).toHaveURL(/\/$/, { timeout: 5_000 });
    await expect(page.locator("#chat-message-input")).toBeVisible({ timeout: 30_000 });
  });
});
