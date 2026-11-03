import { test, expect, type Page } from "@playwright/test";
import { airportMark, openMapSettings, slow } from "./helpers";

/**
 * The Class B, C and D over the chart, with their altitudes as the
 * sectional words them, written along their lines as ForeFlight's, and
 * the VORs (AirspaceLayer, NavaidsLayer): on
 * unless turned off, the owner's pick of the map's looks. Against the
 * real planner and its FAA airspace file, as the point is that the lines
 * and numbers are Chicago's own.
 */

/** How many volumes' lines are drawn in the view, as their canvas writes
 *  what it drew (AirspaceLinesLayer): a count by class, summed. */
const lines = async (page: Page): Promise<number> => {
  const canvas = page.locator(".leaflet-airspace-pane canvas[data-airspace-lines]");
  if (!(await canvas.count())) return 0;
  const counts: Record<string, number> = JSON.parse((await canvas.getAttribute("data-airspace-lines")) ?? "{}");
  return Object.values(counts).reduce((sum, n) => sum + n, 0);
};
/** The altitudes along the lines, as their canvas writes what it drew
 *  (AirspaceLabelsLayer): each label's words and angle. */
const labels = async (page: Page): Promise<{ text: string; angle: number }[]> => {
  const canvas = page.locator(".leaflet-airspace-labels-pane canvas[data-airspace-edge-labels]");
  if (!(await canvas.count())) return [];
  return JSON.parse((await canvas.getAttribute("data-airspace-edge-labels")) ?? "[]");
};
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
  await expect.poll(() => lines(page), { timeout: slow(30000) }).toBeGreaterThan(5);
  // The altitudes along the lines, no plates (the owner, 2026-10-30):
  // O'Hare's shelves among them, and a Class D's
  // ceiling alone. In sight, and turned to read upright.
  // O'Hare's shelves' "100/…": the surface area's "100/SFC" is a small
  // ring round KORD's own mark, its label skipped where the mark is.
  await expect.poll(async () => (await labels(page)).some(l => /^100\/(SFC|\d+)$/.test(l.text)), { timeout: slow(15000) }).toBe(true);
  const written = await labels(page);
  expect(written.some(l => /^-?\d+$/.test(l.text))).toBe(true);
  expect(written.some(l => /^\d+\/\d+$/.test(l.text))).toBe(true);
  await expect(page.locator(".leaflet-airspace-labels-pane [data-airspace-label]")).toHaveCount(0);
  expect(written.length).toBeGreaterThan(3);
  // Upright: a line straight up and down reads bottom to top, either
  // end of the half-turn.
  expect(written.every(l => l.angle >= -90 && l.angle <= 90)).toBe(true);
  // And the VORs about it: Northbrook's, north of the field.
  await expect(vors(page).and(page.locator('[data-vor="OBK"]'))).toBeAttached({ timeout: slow(15000) });

  await openMapSettings(page);
  await page.getByTestId("airspace-toggle").click();
  await page.getByTestId("navaids-toggle").click();
  await page.keyboard.press("Escape");
  await expect.poll(() => lines(page)).toBe(0);
  await expect.poll(async () => (await labels(page)).length).toBe(0);
  await expect(vors(page)).toHaveCount(0);
});

test("a tap on a Class D ring opens its card, with its ceiling and hours", async ({ page }) => {
  // Wheeling's, under O'Hare's 3,000 ft shelf: up to but not including it.
  // O'Hare's card brings the map in on Chicago, Wheeling's ring in sight
  // (KPWK's own card left the map where it was).
  await page.goto("/app/plan?place=KORD");
  // A point on a Class D ring in sight, as the canvas writes one of each
  // ring it drew at rest (data-airspace-rings, in the map's own points),
  // clear of the airports' marks (which take a tap near them) and of the
  // sheet over the lower half of a phone's screen.
  const ringPoint = async () => page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>(".leaflet-airspace-pane canvas[data-airspace-rings]");
    const marks = document.querySelector<HTMLCanvasElement>("canvas[data-airport-marks]");
    if (!canvas) return null;
    const box = document.querySelector(".leaflet-container")!.getBoundingClientRect();
    // Only the fields wearing a mark take a tap near them; the canvas
    // writes every field it knows, mark or not.
    const fields: { x: number; y: number; chip: boolean }[] = JSON.parse(marks?.dataset.airportMarks || "[]");
    const rings: { class: string; x: number; y: number }[] = JSON.parse(canvas.dataset.airspaceRings || "[]");
    // A Class D ring is 35 px across its radius at the card's zoom on a
    // phone, so the clearance is the mark's own reach (22 px) and a little;
    // and clear of the map's buttons down the right edge (BUTTONS_CLEAR).
    for (const ring of rings) {
      if (ring.class !== "D" || ring.y < 80 || ring.y > box.height * 0.48 || ring.x < 20 || ring.x > box.width - 64) continue;
      if (fields.some(f => f.chip && Math.hypot(f.x - ring.x, f.y - ring.y) < 26)) continue;
      return { x: box.left + ring.x, y: box.top + ring.y };
    }
    return null;
  });
  await expect.poll(ringPoint, { timeout: slow(30000) }).not.toBeNull();
  const at = (await ringPoint())!;
  await page.mouse.click(at.x, at.y);
  const card = page.getByTestId("airspace-card");
  await expect(card).toBeVisible({ timeout: slow(10000) });
  // Named "Class D": on a phone in the card's head, or in its pill's
  // (MapCard's pill) over it, a heading; over the chart on a desktop, in
  // the popup's head, a line of its own (MapCard's), as CI's desktop
  // project found it (run 41014180625).
  if (page.viewportSize()!.width < 768) await expect(page.getByRole("heading", { name: "Class D" }).first()).toBeAttached();
  else await expect(page.locator(".leaflet-popup").getByText("Class D", { exact: true })).toBeVisible();
  await expect(card).toContainText("Ceiling");
  await expect(card).toContainText(/\d,\d{3} ft MSL/);
  await expect(card).toContainText("Hours");
  // On a phone, one close, the tab bar's, and no tab name over a card
  // that names itself (the owner, 2026-10-29).
  if (page.viewportSize()!.width < 768) {
    await expect(page.locator("[data-sheet-card]").getByTestId("sheet-card-close")).toHaveCount(0);
    await expect(page.getByTestId("tab-title")).toBeHidden();
    await page.screenshot({ path: "test-results/look/airspace-card.png" });
  }
});

test("a tap on a field's mark opens the field, over an airspace ring or a VOR beside it", async ({ page }) => {
  // KDPA: its Class D ring through its mark and the DPA VOR on the field
  // (the owner, 2026-10-30: the airspace or the VOR took the tap).
  await page.goto("/app/plan?place=KORD");
  await expect.poll(() => lines(page), { timeout: slow(30000) }).toBeGreaterThan(0);
  await expect.poll(async () => (await airportMark(page, "KDPA")) != null, { timeout: slow(15000) }).toBe(true);
  const mark = (await airportMark(page, "KDPA"))!;
  await page.mouse.click(mark.x, mark.y);
  await expect(page).toHaveURL(/[?&]place=KDPA/, { timeout: slow(10000) });
  await expect(page.getByTestId("airspace-card")).toHaveCount(0);
});
