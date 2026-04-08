import { test, expect } from "@playwright/test";

/** 未登入時應可載入或可預期導向的公開頁 */
const PUBLIC_LOAD_PATHS: { path: string; heading: RegExp }[] = [
  { path: "/home", heading: /Travel|differently|AIYO/i },
  { path: "/explore", heading: /Explore/i },
  { path: "/inspiration", heading: /inspired|靈感|Get inspired/i },
  { path: "/privacy", heading: /隱私|Privacy/i },
  { path: "/terms", heading: /服務條款|Terms/i },
];

/** 未登入時應導向 /login */
const PROTECTED_REDIRECT_LOGIN = [
  "/",
  "/saved",
  "/trips",
  "/updates",
  "/create",
  "/settings",
  "/chat/sessions",
];

test.describe("smoke: 頁面載入", () => {
  for (const { path, heading } of PUBLIC_LOAD_PATHS) {
    test(`GET ${path} 回應成功且可見主要標題`, async ({ page }) => {
      const res = await page.goto(path);
      expect(res?.ok()).toBeTruthy();
      await expect(page.locator("body")).toBeVisible();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);
    });
  }

  for (const path of PROTECTED_REDIRECT_LOGIN) {
    test(`GET ${path} 未登入時導向 /login`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login/, { timeout: 20_000 });
    });
  }

  test("GET /login 載入登入表單", async ({ page }) => {
    const res = await page.goto("/login");
    expect(res?.ok()).toBeTruthy();
    await expect(page.getByPlaceholder("name@example.com")).toBeVisible();
  });

  test("GET /dev/login 載入開發者登入表單", async ({ page }) => {
    const res = await page.goto("/dev/login");
    expect(res?.ok()).toBeTruthy();
    await expect(page.locator("body")).toBeVisible();
  });

  test("GET /dev/dashboard 未帶 dev_token 時導向 /dev/login", async ({ page }) => {
    await page.goto("/dev/dashboard");
    await expect(page).toHaveURL(/\/dev\/login/, { timeout: 20_000 });
  });
});
