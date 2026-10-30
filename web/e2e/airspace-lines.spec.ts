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

const lines = (page: Page) => page.locator(".leaflet-airspace-pane path");
const labels = (page: Page) => page.locator(".leaflet-airspace-labels-pane [data-airspace-edge-label]");
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
  // The altitudes along the lines, no plates (the owner, 2026-10-30):
  // O'Hare's surface area's "100/SFC" among them, and a Class D's
  // ceiling alone. In sight, and turned to read upright.
  await expect(labels(page).filter({ hasText: /^100\/SFC$/ }).first()).toBeAttached({ timeout: slow(15000) });
  await expect(labels(page).filter({ hasText: /^-?\d+$/ }).first()).toBeAttached();
  await expect(labels(page).filter({ hasText: /^\d+\/\d+$/ }).first()).toBeVisible();
  await expect(page.locator(".leaflet-airspace-labels-pane [data-airspace-label]")).toHaveCount(0);
  const angles = await labels(page).evaluateAll(texts =>
    texts.map(t => Number(/rotate\((-?[\d.]+)/.exec(t.getAttribute("transform") ?? "")?.[1])));
  expect(angles.length).toBeGreaterThan(3);
  // Upright: a line straight up and down reads bottom to top, either
  // end of the half-turn.
  expect(angles.every(a => a >= -90 && a <= 90)).toBe(true);
  // And the VORs about it: Northbrook's, north of the field.
  await expect(vors(page).and(page.locator('[data-vor="OBK"]'))).toBeAttached({ timeout: slow(15000) });

  await openMapSettings(page);
  await page.getByTestId("airspace-toggle").click();
  await page.getByTestId("navaids-toggle").click();
  await page.keyboard.press("Escape");
  await expect(lines(page)).toHaveCount(0);
  await expect(labels(page)).toHaveCount(0);
  await expect(vors(page)).toHaveCount(0);
});

test("a tap on a Class D ring opens its card, with its ceiling and hours", async ({ page }) => {
  // Wheeling's, under O'Hare's 3,000 ft shelf: up to but not including it.
  // O'Hare's card brings the map in on Chicago, Wheeling's ring in sight
  // (KPWK's own card left the map where it was).
  await page.goto("/app/plan?place=KORD");
  const rings = page.locator(".leaflet-airspace-taps-pane path.airspace-tap-D");
  await expect(rings.first()).toBeAttached({ timeout: slow(30000) });
  // A point on a Class D ring in sight that the ring's own target is the
  // top of there (not an airport's mark or a panel over it).
  const at = await rings.evaluateAll(paths => {
    for (const path of paths as SVGPathElement[]) {
      const length = path.getTotalLength();
      for (let i = 0; i < 24; i++) {
        const point = path.getPointAtLength((length * i) / 24);
        const screen = new DOMPoint(point.x, point.y).matrixTransform(path.getScreenCTM()!);
        if (screen.x < 0 || screen.y < 0 || screen.x > innerWidth || screen.y > innerHeight) continue;
        if (document.elementFromPoint(screen.x, screen.y) === path) return { x: screen.x, y: screen.y };
      }
    }
    return null;
  });
  expect(at).not.toBeNull();
  await page.mouse.click(at!.x, at!.y);
  const card = page.getByTestId("airspace-card");
  await expect(card).toBeVisible({ timeout: slow(10000) });
  // Named "Class D": in the card's head, or in its pill's (MapCard's pill)
  // over it.
  await expect(page.getByRole("heading", { name: "Class D" }).first()).toBeAttached();
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
  await expect(page.locator(".leaflet-airspace-taps-pane path").first()).toBeAttached({ timeout: slow(30000) });
  await expect.poll(async () => (await airportMark(page, "KDPA")) != null, { timeout: slow(15000) }).toBe(true);
  const mark = (await airportMark(page, "KDPA"))!;
  await page.mouse.click(mark.x, mark.y);
  await expect(page).toHaveURL(/[?&]place=KDPA/, { timeout: slow(10000) });
  await expect(page.getByTestId("airspace-card")).toHaveCount(0);
});
