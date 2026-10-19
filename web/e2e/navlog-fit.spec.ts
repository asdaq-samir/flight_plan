import { test, expect } from "@playwright/test";
import { controlsInSight, settle, sideDrawer, slow, openNavLog, navLogSheet, navLogScroller, closeNavLog } from "./helpers";

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
  await expect(page.getByTestId("navlog-fuel")).toBeVisible({ timeout: slow(120000) });
  await openNavLog(page);
  const scroller = navLogScroller(page);
  const log = navLogSheet(page).getByTestId("navlog-list");
  await expect(log.locator('[role="row"][data-kind]').first()).toBeVisible();
  await expect(log).toContainText("10,500");
  // Every row's time, the departure's the time picked, all on the
  // drawer's width: nothing past its side.
  await expect(log.getByTestId("navlog-row-eta").first()).toHaveText(/^\d\d:\d\d$/);
  const overflow = await scroller.evaluate(el => el.scrollWidth - el.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await expect(scroller.locator('[data-testid="section-tabs"]')).toHaveCount(0);
  await closeNavLog(page);
  await controlsInSight(page);
});

test("a long trip's figures are set smaller to fit the strip, not cut short", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) >= 768, "a phone's panel");
  // The pilot's iPhone, 393 points wide.
  await page.setViewportSize({ width: 393, height: 852 });
  // Chicago to Las Vegas, over 1,300 nm, with no legal altitude: the
  // book's figures, rounded, were still too wide for a phone's quarter
  // of the strip at a larger text size and cut to "131…", "≈12.…" and
  // "≈10…" (2026-10-11).
  await page.route("**/api/planner/navlog**", route => route.fulfill({
    status: 200, contentType: "application/x-ndjson",
    body: [
      { type: "stage", detail: "Planning cruise altitudes…" },
      {
        type: "error", retry: false, detail: "No legal VFR cruising altitude 830-858 nm along the route",
        brief: "Aircraft ceiling restricts mountainous flying",
        reasons: ["The aircraft's service ceiling stops at 11,700 ft."],
        advice: "Route around the high ground, or set a cruise altitude of your own to plan it anyway.",
      },
    ].map(m => JSON.stringify(m)).join("\n") + "\n",
  }));
  await page.goto("/app/plan?dep=C81&dest=KLAS");
  await controlsInSight(page);
  await expect(sideDrawer(page).getByTestId("altitude-why")).toHaveAccessibleName(/no legal altitude/, { timeout: slow(30000) });
  await expect(sideDrawer(page).getByTestId("navlog-ete")).toHaveText(/^≈/);
  const figures = sideDrawer(page).locator('[data-tip="flight-line"] dd');
  await expect(figures.first()).toHaveText(/^1\d{3}(\.\d)? nm$/);
  // At the default text size and the two above it, as an iPhone sets the
  // root from Settings' text size (lib/dynamicType, which a test browser
  // does not run): a 19-point Body, 17.88 px; a 21-point one, held to the
  // 393-point screen's 19.65. Every figure whole in its column, none
  // overflowing into an ellipsis.
  for (const root of ["", "17.88px", "19.65px"]) {
    await page.evaluate(size => { document.documentElement.style.fontSize = size; }, root);
    await expect.poll(() => figures.evaluateAll(dds => dds.filter(dd => dd.scrollWidth > dd.clientWidth).map(dd => dd.textContent)),
      { message: `at a root of ${root || "16px"}` }).toEqual([]);
  }
});
