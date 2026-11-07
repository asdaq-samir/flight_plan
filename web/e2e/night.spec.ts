import { test, expect, type Page } from "@playwright/test";
import { openMapSettings, openSetup, pickControl, settle, slow } from "./helpers";

/**
 * Night: in the dark theme the sheets are the cockpit palette's navy and
 * the FAA chart's tiles alone are dimmed, so the white paper chart does
 * not take the pilot's night vision -- not the marks, the course or the
 * sheets over it. Settings' "Chart at night" puts the chart back as
 * printed. A browser that prefers dark is in the dark theme on System.
 */

test.use({ colorScheme: "dark" });

/** How the map paints the chart's tiles (ChartGl's data-chart-look): dimmed
 *  at night, as printed, or brightened in sunlight -- the map's own raster
 *  paint, nothing over the chart touched. */
const lookOf = (page: Page) => page.getByTestId("gl-map").getAttribute("data-chart-look");

test("in the dark theme the page is the night's navy and only the chart's tiles are dimmed, until Chart at night is Normal", async ({ page }) => {
  test.setTimeout(slow(60000));
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  const html = page.locator("html");
  await expect(html).toHaveClass(/dark/);
  await expect(html).toHaveAttribute("data-chart-night", "dimmed");

  // The tokens: the palette's ground and surface.
  const tokens = await page.evaluate(() => {
    const s = getComputedStyle(document.documentElement);
    return { background: s.getPropertyValue("--background").trim(), card: s.getPropertyValue("--card").trim() };
  });
  expect(tokens).toEqual({ background: "#0b1422", card: "#17283a" });
  expect(await page.locator("body").evaluate(el => getComputedStyle(el).backgroundColor)).toBe("rgb(11, 20, 34)");

  // The chart's tiles dimmed, by the map's paint.
  await expect.poll(() => lookOf(page), { timeout: slow(15000) }).toBe("dimmed");

  // Normal: the chart as printed, and kept so across a reload.
  await openMapSettings(page);
  const night = page.getByTestId("chart-night-select");
  await expect(night.getByRole("radio", { name: "Dimmed" })).toHaveAttribute("aria-checked", "true");
  await night.getByRole("radio", { name: "Normal" }).click();
  await expect(html).toHaveAttribute("data-chart-night", "normal");
  await expect.poll(() => lookOf(page)).toBe("normal");
  await page.reload();
  await settle(page);
  await expect(html).toHaveAttribute("data-chart-night", "normal");
  await expect.poll(() => lookOf(page)).toBe("normal");

  // Back to Dimmed for the next test's sake, and the light theme never dims.
  await openMapSettings(page);
  await page.getByTestId("chart-night-select").getByRole("radio", { name: "Dimmed" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("map-settings")).toHaveCount(0);
  await openSetup(page);
  await pickControl(page, "theme-select", "theme-light");
  await expect(html).not.toHaveClass(/dark/);
  await expect.poll(() => lookOf(page)).toBe("normal");
});
