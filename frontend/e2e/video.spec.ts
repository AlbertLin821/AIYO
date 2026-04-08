import { test, expect } from "@playwright/test";
import { e2eCredentials, loginWithEmailPassword } from "./helpers";

test.describe("影片推薦區塊", () => {
  test("已登入主頁載入後可找到聊天表單（影片區依對話內容顯示）", async ({
    page,
  }) => {
    const cred = e2eCredentials();
    test.skip(!cred, "請設定 E2E_EMAIL 與 E2E_PASSWORD");
    await loginWithEmailPassword(page, cred!.email, cred!.password);
    await expect(page.locator("#chat-message-input")).toBeVisible({
      timeout: 30_000,
    });
    // 影片列表為條件顯示；僅確認主版面可互動
    await page.locator("#chat-message-input").fill("推薦旅遊影片");
    await expect(page.locator("#chat-message-input")).toHaveValue("推薦旅遊影片");
  });
});
