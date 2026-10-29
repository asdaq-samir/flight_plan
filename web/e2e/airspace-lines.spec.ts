import { test, expect, type Page } from "@playwright/test";
import { openMapSettings, slow } from "./helpers";

/**
 * The Class B, C and D over the chart, with their altitudes as the
 * sectional prints them, and the VORs (AirspaceLayer, NavaidsLayer): on
 * unless turned off, the owner's pick of the map's looks. Against the
 * real planner and its FAA airspace file, as the point is that the lines
 * and numbers are Chicago's own.
 */

const lines = (page: Page) => page.locator(".leaflet-airspace-pane path");
const labels = (page: Page) => page.locator(".leaflet-airspace-labels-pane [data-airspace-label]");
const vors = (page: Page) => page.locator(".leaflet-navaids-pane [data-vor]");

test("Chicago's airspace is drawn over the chart with its altitudes, and the switch takes it off", async ({ page }) => {
  // The planner's own answer, through the webapp: O'Hare's Class B
  // shelves, Midway's Class C and Wheeling's Class D under the Bravo.
  const answer = await page.request.get("/api/planner/airspace/in-view?south=41.5&west=-88.5&north=42.5&east=-87.5");
  expect(answer.ok()).toBe(true);
  const volumes: { ident: string | null; airspace_class: string; floor_sfc: boolean; ceiling_ft: number; ceiling_excluded: boolean }[] =
    (await answer.json()).volumes;
  expect(volumes.filter(v => v.ident === "ORD" && v.airspace_class === "B").length).toBeGreaterThanOrEqual(7);
  expect(volumes.some(v => v.ident === "MDW" && v.airspace_class === "C" && v.floor_sfc && v.ceiling_ft === 3600)).toBe(true);
  expect(volumes.some(v => v.ident === "PWK" && v.airspace_class === "D" && v.ceiling_excluded && v.ceiling_ft === 3000)).toBe(true);

  // O'Hare's card brings the map in on it, close enough for the labels.
  await page.goto("/app/plan?place=KORD");
  await expect(lines(page).first()).toBeAttached({ timeout: slow(30000) });
  expect(await lines(page).count()).toBeGreaterThan(5);
  // The surface area's "100 over SFC", and Wheeling's "-30" in its box.
  await expect(labels(page).filter({ hasText: "SFC" }).filter({ hasText: "100" }).first()).toBeAttached();
  await expect(labels(page).filter({ hasText: /^-30$/ }).first()).toBeAttached();
  // And the VORs about it: Northbrook's, north of the field.
  await expect(vors(page).and(page.locator('[data-vor="OBK"]'))).toBeAttached({ timeout: slow(15000) });

  // Not targets: a tap on a label is the chart's under it.
  const label = labels(page).first();
  const box = await label.boundingBox();
  if (box) {
    const under = await page.evaluate(([x, y]) => document.elementFromPoint(x!, y!)?.closest("[data-airspace-label]") != null,
      [box.x + box.width / 2, box.y + box.height / 2]);
    expect(under).toBe(false);
  }

  await openMapSettings(page);
  await page.getByTestId("airspace-toggle").click();
  await page.getByTestId("navaids-toggle").click();
  await page.keyboard.press("Escape");
  await expect(lines(page)).toHaveCount(0);
  await expect(labels(page)).toHaveCount(0);
  await expect(vors(page)).toHaveCount(0);
});
