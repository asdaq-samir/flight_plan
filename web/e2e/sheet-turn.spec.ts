import { test, expect, type Page } from "@playwright/test";
import { settle, sideDrawer } from "./helpers";

/**
 * A phone's sheet going from the pill to half way and back keeps what it
 * shows where it was, frame by frame: the tabs docked at the screen's foot
 * not moving at all (the owner's pick, 2026-11-04: "The tab bar seems to
 * be moving from bottom as I am moving it between detents"), and with a
 * route the figures at the sheet's visible foot over them the whole way,
 * where they were once out of sight under it from the turn until the
 * sheet was most of the way up (2026-10-15).
 */

type Frame = { height: number; bar: { top: number } | null; figures: { top: number; bottom: number } | null; dock: number | null; content: number; short: number };

/** Each frame of the sheet's move after `move`: its height, where the
 *  tabs are on the screen, where the route's figures are from its top,
 *  and the docked tabs' top from the sheet's. */
async function frames(page: Page, move: () => Promise<void>): Promise<Frame[]> {
  await page.evaluate(() => {
    const w = window as unknown as { __frames: Frame[] };
    w.__frames = [];
    const t0 = performance.now();
    const tick = () => {
      // The sheet as it shows on the screen: on a phone it is laid out as
      // tall as the larger end and moved by a translate (MapPanel), what
      // is past the screen's edge out of sight.
      const sheet = document.querySelector<HTMLElement>("[data-slot=map-panel]")!;
      const box = sheet.getBoundingClientRect();
      const foot = Math.min(box.bottom, window.innerHeight);
      const panel = { top: box.top, height: foot - box.top };
      const at = (selector: string) => {
        const r = document.querySelector(`[data-slot=map-panel] ${selector}`)?.getBoundingClientRect();
        return r && r.height > 0 ? { top: r.top - panel.top, bottom: r.bottom - panel.top } : null;
      };
      const tabs = document.querySelector("[data-testid=tab-bar]")?.getBoundingClientRect();
      const dock = document.querySelector("[data-tab-dock]")?.getBoundingClientRect();
      // The box everything over the sheet's floor is clipped to -- the
      // head, the body, the figures -- and how far short of the screen's
      // foot the sheet's glass ends.
      const content = document.querySelector("[data-slot=map-panel] [data-sheet-content]")!.getBoundingClientRect();
      w.__frames.push({
        height: panel.height, bar: tabs && tabs.height > 0 ? { top: tabs.top } : null,
        figures: at("[data-testid=flight-line]"), dock: dock ? dock.top - panel.top : null,
        content: content.bottom - panel.top, short: window.innerHeight - box.bottom,
      });
      if (performance.now() - t0 < 1200) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await move();
  await page.waitForTimeout(1400);
  return page.evaluate(() => (window as unknown as { __frames: Frame[] }).__frames);
}

/** Under the docked tabs, in a frame: the sheet's glass alone -- its
 *  head, its body and its figures cut off at the tabs' top (the route's
 *  box and the airplane's field were drawn through the tabs as the sheet
 *  set off from the pill, 2026-11-04's review), and the glass on down to
 *  the screen's foot, the tabs never on bare chart. */
function underTheDock(f: Frame) {
  if (f.dock === null) return;
  expect(f.content, `the sheet's content in a sheet ${f.height} tall`).toBeLessThanOrEqual(f.dock + 1);
  expect(f.short, `the sheet's glass in a sheet ${f.height} tall`).toBeLessThanOrEqual(0.5);
}

async function step(page: Page, key: "ArrowUp" | "ArrowDown") {
  await page.getByTestId("sidebar-trigger-button").focus();
  await page.keyboard.press(key);
}

test("on a phone the tabs stay where they are, docked, as the sheet goes from the pill to half way and back", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) >= 768, "a phone's sheet");
  await page.goto("/app/plan");
  await settle(page);
  await expect(sideDrawer(page)).toHaveAttribute("data-panel", "peek");
  for (const key of ["ArrowUp", "ArrowDown"] as const) {
    const seen = await frames(page, () => step(page, key));
    const first = seen[0]!;
    expect(first.bar).not.toBeNull();
    // At the screen's foot in every frame, not a fraction of a point off.
    for (const f of seen) {
      expect(f.bar, `the tabs in a sheet ${f.height} tall`).not.toBeNull();
      expect(Math.abs(f.bar!.top - first.bar!.top), `the tabs at ${f.bar!.top} in a sheet ${f.height} tall`).toBeLessThan(0.5);
      underTheDock(f);
    }
    // And the sheet did move.
    expect(Math.abs(seen[seen.length - 1]!.height - first.height)).toBeGreaterThan(100);
  }
});

test("on a phone a route's figures stay in sight at the sheet's foot as the pill turns into the sheet and back", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) >= 768, "a phone's sheet");
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  await expect(sideDrawer(page)).toHaveAttribute("data-panel", "peek");
  await expect(sideDrawer(page).getByTestId("flight-line")).toBeVisible();
  for (const key of ["ArrowUp", "ArrowDown"] as const) {
    const seen = await frames(page, () => step(page, key));
    for (const f of seen) {
      expect(f.figures, `the figures in a sheet ${f.height} tall`).not.toBeNull();
      expect(f.figures!.top, `the figures in a sheet ${f.height} tall`).toBeGreaterThanOrEqual(-1);
      // Over the docked tabs: nothing of the sheet's under them.
      expect(f.figures!.bottom, `the figures in a sheet ${f.height} tall`).toBeLessThanOrEqual((f.dock ?? f.height) + 1);
      underTheDock(f);
    }
  }
});
