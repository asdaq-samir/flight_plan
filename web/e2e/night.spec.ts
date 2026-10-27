import { test, expect, type Page } from "@playwright/test";
import { openMapSettings, openSettings, settle, slow } from "./helpers";

/**
 * Night: in the dark theme the sheets are the cockpit palette's navy and
 * the FAA chart's tiles alone are dimmed, so the white paper chart does
 * not take the pilot's night vision -- not the marks, the course or the
 * sheets over it. Settings' "Chart at night" puts the chart back as
 * printed. A browser that prefers dark is in the dark theme on System.
 */

test.use({ colorScheme: "dark" });

const DIMMED = "brightness(0.5) contrast(1.15)";

const filterOf = (page: Page, selector: string) =>
  page.locator(selector).first().evaluate(el => getComputedStyle(el).filter);

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

  // The chart's layer dimmed; the panes over it as they were.
  const chart = page.locator(".leaflet-layer.chart-tiles").first();
  await expect(chart).toBeAttached({ timeout: slow(15000) });
  await expect.poll(() => filterOf(page, ".leaflet-layer.chart-tiles")).toBe(DIMMED);
  for (const pane of [".leaflet-marker-pane", ".leaflet-overlay-pane", ".leaflet-tooltip-pane"]) {
    expect(await filterOf(page, pane)).toBe("none");
  }
  // The course in the night's magenta over it, once the route is drawn.
  const core = page.locator("path.course-core").first();
  if (await core.count()) {
    expect(await core.evaluate(el => getComputedStyle(el).stroke)).toBe("rgb(242, 119, 230)");
  }

  // Normal: the chart as printed, and kept so across a reload.
  await openMapSettings(page);
  const night = page.getByTestId("chart-night-select");
  await expect(night.getByRole("radio", { name: "Dimmed" })).toHaveAttribute("aria-checked", "true");
  await night.getByRole("radio", { name: "Normal" }).click();
  await expect(html).toHaveAttribute("data-chart-night", "normal");
  await expect.poll(() => filterOf(page, ".leaflet-layer.chart-tiles")).toBe("none");
  await page.reload();
  await settle(page);
  await expect(html).toHaveAttribute("data-chart-night", "normal");
  await expect.poll(() => filterOf(page, ".leaflet-layer.chart-tiles")).toBe("none");

  // Back to Dimmed for the next test's sake, and the light theme never dims.
  await openMapSettings(page);
  await page.getByTestId("chart-night-select").getByRole("radio", { name: "Dimmed" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("map-settings")).toHaveCount(0);
  await openSettings(page);
  await page.getByTestId("theme-select").getByRole("radio", { name: "Light" }).click();
  await expect(html).not.toHaveClass(/dark/);
  await expect.poll(() => filterOf(page, ".leaflet-layer.chart-tiles")).toBe("none");
});
