import type { Page } from "@playwright/test";

/**
 * 完成登入表單（電子郵件兩步）。需 api-gateway 可連線且帳密正確。
 */
export async function loginWithEmailPassword(
  page: Page,
  email: string,
  password: string
): Promise<void> {
  await page.goto("/login");
  await page.getByPlaceholder("name@example.com").fill(email);
  await page.getByRole("button", { name: "繼續" }).click();
  await page.getByPlaceholder("請輸入密碼").fill(password);
  await page.getByRole("button", { name: "登入" }).click();
  await page.waitForURL((url) => !url.pathname.includes("/login"), {
    timeout: 45_000,
  });
}

export function e2eCredentials(): { email: string; password: string } | null {
  const email = process.env.E2E_EMAIL?.trim();
  const password = process.env.E2E_PASSWORD?.trim();
  if (!email || !password) return null;
  return { email, password };
}
