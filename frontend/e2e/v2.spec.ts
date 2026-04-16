import { expect, test } from "@playwright/test";

test.describe("v2 routes", () => {
  test("loads /v2 page", async ({ page }) => {
    const response = await page.goto("/v2");
    expect(response?.ok()).toBeTruthy();
    await expect(
      page.getByRole("heading", { name: /Voice-first map planning with segment-based recommendations/i })
    ).toBeVisible();
  });

  test("loads /legacy page", async ({ page }) => {
    const response = await page.goto("/legacy");
    expect(response?.ok()).toBeTruthy();
    await expect(page.getByRole("heading", { name: /AIYO V1 \(Read-Only Window\)/i })).toBeVisible();
  });
});
