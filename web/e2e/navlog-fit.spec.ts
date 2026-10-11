import { test, expect } from "@playwright/test";
import { controlsInSight, openTab, settle, slow } from "./helpers";

/**
 * The nav log fits a phone's panel, with a departure time's ETA as its
 * sixth column, a cruise in five figures, and waypoint names with words
 * longer than its column -- where the browser cannot hyphenate them (the
 * test's Chromium has no hyphenation dictionary, and CI's audit found the
 * table seven points wider than its panel for "Meadowbrook" at 10,500 ft).
 * The planner's own answers, renamed and raised.
 */

// An iPhone 16 Pro, touch: the figures at a finger's 15 points.
test.use({ viewport: { width: 402, height: 874 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 });

const LONG = ["River near Meadowbrookshire", "Alexander Fld South Wood County (ISW)", "Road or railway near Hawthorneville",
  "Snow Crest Ranch (0WI4)", "Wisconsinrapidsburg Municipal"];

test("the nav log fits a phone's panel with long names, five-figure altitudes and an ETA column", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) >= 768, "a phone's panel");
  await page.route(url => url.pathname.endsWith("/api/planner/checkpoints"), async route => {
    const response = await route.fetch();
    const json = await response.json();
    json.selected = (json.selected as { name: string }[]).map((c, i) => ({ ...c, name: LONG[i % LONG.length] }));
    await route.fulfill({ response, json });
  });
  await page.route(url => url.pathname.endsWith("/api/planner/navlog"), async route => {
    const response = await route.fetch();
    const body = (await response.text()).split("\n").map(line => {
      if (!line.trim()) return line;
      const message = JSON.parse(line);
      if (message.type === "leg" || message.type === "altitude") message.altitude_ft = 10500;
      return JSON.stringify(message);
    }).join("\n");
    await route.fulfill({ response, body });
  });
  const depart = new Date(Date.now() + 26 * 3600_000).toISOString().slice(0, 16);
  await page.goto(`/app/plan?dep=C81&dest=KDLH&depart=${encodeURIComponent(depart)}&view=briefing`);
  await settle(page);
  await expect(page.getByTestId("navlog-eta")).toBeVisible({ timeout: slow(120000) });
  await openTab(page, "Nav Log");
  const container = page.locator('[data-tab="navlog"] [data-slot="table-container"]');
  await expect(container.locator("tbody tr").first()).toBeVisible();
  await expect(container.locator("tbody")).toContainText("10,500");
  await expect(container.locator("thead")).toContainText("ETA");
  const overflow = await container.evaluate(el => el.scrollWidth - el.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  // Scrolled, its headings stick below the section's pills, not over them.
  await page.getByTestId("navlog-scroller").evaluate(el => { el.scrollTop = 400; });
  const [pills, head] = await Promise.all([
    page.locator('[data-tab="navlog"] [data-testid="section-tabs"]').boundingBox(),
    container.locator("thead").boundingBox(),
  ]);
  expect(head!.y).toBeGreaterThanOrEqual(pills!.y + pills!.height - 1);
  await controlsInSight(page);
});
