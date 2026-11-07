import { test, expect } from "@playwright/test";
import { slow, settle, openMapSettings } from "./helpers";

/**
 * The chart layers the map asks for: the terminal area chart over the
 * sectional once it is pinned, and the IFR low enroute chart as the
 * base. Switched with a route on screen, on the training page: the
 * planner's map is the same (MapShell), and its settings are on the
 * search bar, which a route takes the place of (classb.spec.ts sets
 * them there before one is loaded).
 *
 * A chart's tiles are told apart by its kind in their path, wherever they
 * come from: the planner's /api/planner/chart-tile/<kind>/... locally,
 * the CDN's /tiles/<cycle>/<kind>/... once a cycle is published (the
 * production rehearsal, infra/rehearsal).
 */

for (const path of ["/app/dev"] as const) {
  test(`${path}: the TAC is drawn over the sectional only once it is pinned`, async ({ page }) => {
    // Nothing but the sectional by default, at every zoom: zoomed in
    // over C81 (inside the Chicago TAC) past the sectional's own
    // detail, no TAC tile is asked for. Pinned, the map asks for TAC
    // tiles and at least one of them actually renders -- the planner
    // draws it from the FAA's own TAC raster, which on a cold tile
    // cache is a quarter of a second per tile for a screenful of
    // them; hence the longer budget.
    //
    // Pinned here from the map's settings, which is the setting itself.
    // A Class B marker's card pins the same thing for its own field;
    // that is classb.spec.ts.
    test.setTimeout(slow(90000));
    await page.goto(`${path}?dep=C81&dest=KDLH`);
    await settle(page);
    // The charts the map draws (ChartGl's data-chart-kinds), and the TAC's
    // tiles that came back drawn.
    const kinds = () => page.getByTestId("gl-map").getAttribute("data-chart-kinds");
    let tacDrawn = 0;
    page.on("response", r => { if (/\/tac\/\d+\//.test(r.url()) && r.ok()) tacDrawn += 1; });
    await expect.poll(kinds, { timeout: slow(15000) }).toBe("sec");

    // Wheel-zoom in over the departure marker, well past the sectional's
    // own zooms; the map zooms about the cursor, so C81 stays under it.
    const marker = page.locator(".maplibregl-marker", { hasText: "C81" }).first();
    await expect(marker).toBeVisible();
    const box = (await marker.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (let i = 0; i < 8; i++) {
      await page.mouse.wheel(0, -60);
      await page.waitForTimeout(400);
    }
    expect(await kinds()).toBe("sec");
    expect(tacDrawn).toBe(0);

    // Pinned: both chart layers are asked for, the sectional and the TAC.
    await openMapSettings(page);
    const pin = page.getByTestId("tac-toggle");
    await expect(pin).toHaveAttribute("aria-checked", "false");
    await pin.click();
    await expect(pin).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Escape");
    await expect.poll(kinds, { timeout: slow(10000) }).toBe("sec tac");
    await expect.poll(() => tacDrawn, { timeout: slow(45000) }).toBeGreaterThan(0);

    // Remembered per browser: a reload still has it pinned, and
    // unpinning it takes the TAC layer away again.
    await page.reload();
    await settle(page);
    await openMapSettings(page);
    const toggle = page.getByTestId("tac-toggle");
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await page.keyboard.press("Escape");
    await expect.poll(kinds).toBe("sec");
  });

  test(`${path}: the base chart can be the IFR low enroute chart, and back`, async ({ page }) => {
    // The sectional by default; picking "IFR low" in the info popover
    // swaps the base layer for the IFR enroute chart's own tiles (and
    // the TAC checkbox, meaningless over it, is disabled); picking
    // "Sectional" brings the sectional back.
    test.setTimeout(slow(90000));
    await page.goto(`${path}?dep=C81&dest=KDLH`);
    await settle(page);
    const kinds = () => page.getByTestId("gl-map").getAttribute("data-chart-kinds");
    let ifrDrawn = 0;
    page.on("response", r => { if (/\/ifr_low\/\d+\//.test(r.url()) && r.ok()) ifrDrawn += 1; });
    await expect.poll(kinds, { timeout: slow(15000) }).toBe("sec");

    await openMapSettings(page);
    await page.getByTestId("base-chart-select").getByRole("radio", { name: "IFR low" }).click();
    // The terminal sheet's row is the IFR area chart over the IFR charts.
    await expect(page.getByTestId("map-settings").getByText("IFR Area Charts")).toBeVisible();
    await expect.poll(kinds, { timeout: slow(10000) }).toBe("ifr_low");
    await expect.poll(() => ifrDrawn, { timeout: slow(45000) }).toBeGreaterThan(0);

    await page.getByTestId("base-chart-select").getByRole("radio", { name: "Sectional" }).click();
    await expect.poll(kinds, { timeout: slow(10000) }).toBe("sec");
    await expect(page.getByTestId("map-settings").getByText("Terminal Area Charts")).toBeVisible();
  });
}
