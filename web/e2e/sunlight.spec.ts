import { test, expect } from "@playwright/test";
import { openMapSettings, settle, slow } from "./helpers";

/**
 * The chart in sunlight (lib/sunlight, index.css): the map's settings'
 * Sunlight On puts `data-chart-light="bright"` on <html>, under which
 * the chart's tiles are at more contrast, the course wider and black-cased
 * and the sheets solid white with black figures. Off takes it away. Auto
 * reads the phone's light sensor, which the test's browser has none of.
 */

test.beforeEach(async ({ page }) => {
  // Once: a reload after Off must find Off kept, not On put back.
  await page.addInitScript(() => {
    if (sessionStorage.getItem("sunlight-set")) return;
    sessionStorage.setItem("sunlight-set", "1");
    const kept = JSON.parse(localStorage.getItem("wingtip.preferences") ?? "{}") as { state?: object };
    localStorage.setItem("wingtip.preferences", JSON.stringify({ state: { waypoints: true, ...kept.state, chartLight: "on" }, version: 3 }));
  });
});

test("Sunlight On: the page is marked bright, the figure strip is solid white with black figures, and Off takes it away", async ({ page }) => {
  test.setTimeout(slow(60_000));
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  const html = page.locator("html");
  await expect(html).toHaveAttribute("data-chart-light", "bright");

  const strip = page.locator('[data-slot="section-summary"]').first();
  await expect(strip).toBeVisible();
  expect(await strip.evaluate(el => getComputedStyle(el).backgroundColor)).toBe("rgb(255, 255, 255)");
  expect(await strip.evaluate(el => getComputedStyle(el).color)).toBe("rgb(0, 0, 0)");

  // The tiles at more contrast, by the map's own raster paint (ChartGl's
  // data-chart-look).
  await expect.poll(() => page.getByTestId("gl-map").getAttribute("data-chart-look"), { timeout: slow(15_000) }).toBe("bright");

  // Off, from the map's settings: the page as it was, and kept so.
  await openMapSettings(page);
  const sunlight = page.getByTestId("sunlight-select");
  await expect(sunlight.getByRole("radio", { name: "On" })).toHaveAttribute("aria-checked", "true");
  await sunlight.getByRole("radio", { name: "Off" }).click();
  await expect(html).toHaveAttribute("data-chart-light", "normal");
  expect(await strip.evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe("rgb(255, 255, 255)");
  await page.reload();
  await settle(page);
  await expect(html).toHaveAttribute("data-chart-light", "normal");
});
