import { expect, test } from "@playwright/test";

test.describe("v2 full flow", () => {
  test("voice -> recommend -> map -> plan -> save", async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("aiyo_token", "e2e-token");
    });

    await page.route("**/api/v2/voice/intent", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          destination: "東京",
          days: 4,
          budget: "30000",
          preferences: ["夜景", "美食"],
          traceId: "abc123def456"
        })
      });
    });

    await page.route("**/api/v2/recommend/videos", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          status: "completed",
          traceId: "abc123def456",
          result: {
            traceId: "abc123def456",
            items: [
              {
                internalPlaceId: "11111111-1111-1111-1111-111111111111",
                googlePlaceId: "g-123",
                segmentId: "22222222-2222-2222-2222-222222222222",
                lat: 35.6595,
                lng: 139.7004,
                startSec: 30,
                endSec: 90,
                reason: ["query_match", "destination_match"],
                statsUpdatedAt: "2026-04-10T00:00:00.000Z",
                statsStale: false,
                geocodeStatus: "ok",
                placeName: "Shibuya Crossing",
                videoTitle: "Tokyo Night Walk"
              }
            ]
          }
        })
      });
    });

    await page.route("**/api/v2/trips/plan-from-intent", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          status: "completed",
          traceId: "abc123def456",
          result: {
            traceId: "abc123def456",
            recommendations: [
              {
                internalPlaceId: "11111111-1111-1111-1111-111111111111",
                googlePlaceId: "g-123",
                segmentId: "22222222-2222-2222-2222-222222222222",
                lat: 35.6595,
                lng: 139.7004,
                startSec: 30,
                endSec: 90,
                reason: ["query_match"],
                statsUpdatedAt: "2026-04-10T00:00:00.000Z",
                statsStale: false,
                geocodeStatus: "ok",
                placeName: "Shibuya Crossing"
              }
            ],
            plan: {
              feasible: true,
              warnings: [],
              days: [
                {
                  dayNumber: 1,
                  warnings: [],
                  stops: [
                    {
                      internalPlaceId: "11111111-1111-1111-1111-111111111111",
                      googlePlaceId: "g-123",
                      segmentId: "22222222-2222-2222-2222-222222222222",
                      lat: 35.6595,
                      lng: 139.7004,
                      startSec: 30,
                      endSec: 90,
                      reason: ["query_match"],
                      statsUpdatedAt: "2026-04-10T00:00:00.000Z",
                      statsStale: false,
                      placeName: "Shibuya Crossing",
                      timeStart: "09:00",
                      timeEnd: "10:30"
                    }
                  ]
                }
              ],
              unmappedSegments: []
            }
          }
        })
      });
    });

    await page.route("**/api/itinerary", async (route) => {
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ id: 888, status: "draft" })
      });
    });

    await page.goto("/v2");

    await page.getByRole("textbox").fill("東京 4 天，預算 30000，喜歡夜景和美食");
    await page.getByRole("button", { name: "Parse intent" }).click();
    await expect(page.getByText("Destination", { exact: true })).toBeVisible();
    const destinationCard = page.locator("div.rounded-xl.bg-slate-50", { hasText: "Destination" });
    await expect(destinationCard.getByText("東京", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "2. Recommend segments" }).click();
    await expect(page.getByText("Shibuya Crossing")).toBeVisible();
    const mapIframe = page.locator("iframe[title='segment-map']");
    await expect(mapIframe).toBeVisible();
    await expect(mapIframe).toHaveAttribute("src", /35\.6595,139\.7004/);

    await page.getByRole("button", { name: "3. Generate plan" }).click();
    await expect(page.getByRole("heading", { name: "Trip plan result" })).toBeVisible();
    await expect(page.getByText("Day 1")).toBeVisible();
    await expect(page.getByText("09:00 - 10:30 / segmentId")).toBeVisible();

    await page.getByRole("button", { name: "4. Save plan" }).click();
    await expect(page.getByText("Plan saved successfully (itinerary #888).")).toBeVisible();
  });
});
