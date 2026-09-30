import { test, expect } from "@playwright/test";
import { PAGES, slow, settle } from "./helpers";

/**
 * The chart layers the map asks for: the terminal area chart over the
 * sectional once it is pinned, and the IFR low enroute chart as the
 * base.
 */

for (const path of PAGES) {
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
    const tacTiles = page.locator('img.leaflet-tile[src*="/api/planner/chart-tile/tac/"]');
    const sectionalTiles = page.locator('img.leaflet-tile[src*="/api/planner/chart-tile/sec/"]');
    await expect(page.locator("img.leaflet-tile").first()).toBeAttached({ timeout: slow(15000) });
    expect(await tacTiles.count()).toBe(0);

    // Wheel-zoom in over the departure marker, a level at a time
    // (Leaflet's own 60 px per level), well past the sectional's own
    // zooms; Leaflet zooms about the cursor, so C81 stays under it.
    const marker = page.locator(".leaflet-marker-icon", { hasText: "C81" }).first();
    await expect(marker).toBeVisible();
    const box = (await marker.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (let i = 0; i < 8; i++) {
      await page.mouse.wheel(0, -60);
      await page.waitForTimeout(400);
    }
    await expect(sectionalTiles.first()).toBeAttached({ timeout: slow(10000) });
    expect(await tacTiles.count()).toBe(0);

    // Pinned: both chart layers are asked for, the sectional and the TAC.
    await page.getByTestId("settings-button").click();
    const pin = page.getByTestId("tac-toggle");
    await expect(pin).toHaveAttribute("aria-checked", "false");
    await pin.click();
    await expect(pin).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Escape");
    await expect(tacTiles.first()).toBeAttached({ timeout: slow(10000) });
    await expect.poll(
      () => page.evaluate(() =>
        [...document.querySelectorAll<HTMLImageElement>('img.leaflet-tile[src*="/api/planner/chart-tile/tac/"]')]
          .some(img => img.complete && img.naturalWidth > 0)),
      { timeout: slow(45000) },
    ).toBe(true);

    // Remembered per browser: a reload still has it pinned, and
    // unpinning it takes the TAC layer away again.
    await page.reload();
    await settle(page);
    await page.getByTestId("settings-button").click();
    const toggle = page.getByTestId("tac-toggle");
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await page.keyboard.press("Escape");
    await expect(tacTiles).toHaveCount(0);
  });

  test(`${path}: the base chart can be the IFR low enroute chart, and back`, async ({ page }) => {
    // The sectional by default; picking "IFR low" in the info popover
    // swaps the base layer for the IFR enroute chart's own tiles (and
    // the TAC checkbox, meaningless over it, is disabled); picking
    // "Sectional" brings the sectional back.
    test.setTimeout(slow(90000));
    await page.goto(`${path}?dep=C81&dest=KDLH`);
    await settle(page);
    const ifrTiles = page.locator('img.leaflet-tile[src*="/api/planner/chart-tile/ifr_low/"]');
    const sectionalTiles = page.locator('img.leaflet-tile[src*="/api/planner/chart-tile/sec/"]');
    await expect(sectionalTiles.first()).toBeAttached({ timeout: slow(15000) });
    expect(await ifrTiles.count()).toBe(0);

    await page.getByTestId("settings-button").click();
    await page.getByTestId("base-chart-select").getByRole("radio", { name: "IFR low" }).click();
    await expect(page.getByText("IFR area chart", { exact: true })).toBeVisible();
    await expect(ifrTiles.first()).toBeAttached({ timeout: slow(10000) });
    await expect.poll(
      () => page.evaluate(() =>
        [...document.querySelectorAll<HTMLImageElement>('img.leaflet-tile[src*="/api/planner/chart-tile/ifr_low/"]')]
          .some(img => img.complete && img.naturalWidth > 0)),
      { timeout: slow(45000) },
    ).toBe(true);
    expect(await sectionalTiles.count()).toBe(0);

    await page.getByTestId("base-chart-select").getByRole("radio", { name: "Sectional" }).click();
    await expect(sectionalTiles.first()).toBeAttached({ timeout: slow(10000) });
    await expect(page.getByText("Terminal area chart", { exact: true })).toBeVisible();
  });
}
