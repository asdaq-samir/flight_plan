import { test, expect } from "@playwright/test";

/**
 * A nav log the winds could not be read for. The planner's own stream is
 * taken and cut where the winds failed -- its altitude line with nothing
 * flown, then the error -- so the rest of the page is the real one.
 */

test("a winds outage never reads as an altitude the pilot typed", async ({ page }) => {
  // It read "0 ft · yours", with Custom pressed, for an altitude nobody
  // typed, and the reasoning said some leg had no legal altitude.
  await page.route("**/api/planner/navlog?**", async route => {
    const response = await route.fetch();
    const lines = (await response.text()).split("\n").filter(Boolean).map(l => JSON.parse(l));
    const altitude = lines.find(m => m.type === "altitude");
    const cut = [
      ...lines.filter(m => m.type === "stage"),
      { ...altitude, flown: null, altitude_ft: null, options: [] },
      { type: "error", detail: "aviationweather.gov winds-06 unavailable: timed out" },
    ];
    await route.fulfill({
      status: 200, contentType: "application/x-ndjson", body: cut.map(m => JSON.stringify(m)).join("\n") + "\n",
    });
  });
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await page.getByTestId("sidebar-trigger-button").click();
  await page.locator('[data-slot="sidebar"][data-side="right"]').getByText("Nav log", { exact: true }).click();

  const why = page.getByTestId("altitude-why");
  await expect(why).toContainText("No altitude", { timeout: 60000 });
  await expect(why).not.toContainText("yours");
  await why.click();
  const popover = page.locator("[data-slot=popover-content]");
  await expect(popover).toContainText("winds aloft could not be read");
  await expect(popover).not.toContainText("no legal altitude");
  await expect(popover.getByRole("form", { name: "Custom altitude" })).not.toHaveClass(/bg-primary/);
});
