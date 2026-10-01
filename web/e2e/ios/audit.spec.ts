import { test, expect } from "@playwright/test";
import { SCREENS } from "./screens";
import {
  componentFindings, contrastFindings, emulateSafeArea, hitAreaMisses, horizontalOverflow, outsideSafeArea, quiet, roleFindings, still,
  typeFindings, type Insets,
} from "./metrics";

/**
 * The iOS audit, one test per screen on each iOS project
 * (playwright.config.ts): P1 hit regions, P2 and P3 type, P16 typeface,
 * P17 the text's colour by role, P18 one size for one component (P14 an
 * iPad's form sheet among them), P15 contrast light and dark, P11 fit
 * and, on the island iPhones, P12 the safe area -- every broken rule
 * reported in one run (soft), and what broke it attached as data for the
 * report. One page load a screen measures them all: CI runs three of the
 * projects on every push.
 *
 * P12's insets: in portrait none at the top -- Safari's own bar is there,
 * and a home-screen app starts below the status bar (index.html's
 * apple-mobile-web-app-status-bar-style is "default"; "black-translucent"
 * would put the page under it, and this top inset would be the status
 * bar's 59) -- and the home indicator's 34 at the bottom. On its side,
 * the island's 59 at either edge and 21 at the bottom. Not measured: the
 * SE, which has no insets, and the iPads, whose insets are their own.
 */
const ISLAND_PORTRAIT: Insets = { top: 0, right: 0, bottom: 34, left: 0 };
const ISLAND_LANDSCAPE: Insets = { top: 0, right: 59, bottom: 21, left: 59 };
const INSETS: Record<string, Insets> = {
  "iphone-16-pro": ISLAND_PORTRAIT,
  "iphone-16-pro-max": ISLAND_PORTRAIT,
  "iphone-landscape": ISLAND_LANDSCAPE,
  "webkit-iphone": ISLAND_PORTRAIT,
};

for (const screen of SCREENS) {
  test(`${screen.name}: iOS hit regions, type, fit and safe area`, async ({ page }, info) => {
    // The nav log and the training drawer wait on the planner's streams.
    test.slow();
    await screen.ready(page);
    await quiet(page);
    await still(page);

    const misses = await hitAreaMisses(page);
    const { offScale, offLeading, offFace } = await typeFindings(page);
    const greyed = await roleFindings(page);
    const components = await componentFindings(page);
    // P15 in both schemes: the app follows the system's (Settings,
    // Appearance), and dark is a palette of its own to pass or fail.
    const contrast = await contrastFindings(page);
    await page.emulateMedia({ colorScheme: "dark" });
    await still(page);
    const contrastDark = await contrastFindings(page);
    await page.emulateMedia({ colorScheme: "light" });
    await still(page);
    const overflow = await horizontalOverflow(page);
    // The safe area last on the screen as laid out, since it rewrites the
    // page's own CSS to a device's insets.
    const insets = INSETS[info.project.name];
    let outside: Awaited<ReturnType<typeof outsideSafeArea>> = [];
    if (insets) {
      await emulateSafeArea(page, insets);
      await still(page);
      outside = await outsideSafeArea(page, insets);
    }
    // Safari's page zoom at 150%: the same screen laid out two thirds as wide.
    const { width, height } = page.viewportSize()!;
    await page.setViewportSize({ width: Math.round(width / 1.5), height: Math.round(height / 1.5) });
    await still(page);
    const zoomed = await horizontalOverflow(page);

    await info.attach("findings", {
      contentType: "application/json",
      body: JSON.stringify({ misses, offScale, offLeading, offFace, greyed, components, contrast, contrastDark, overflow, zoomed, insets: insets ?? null, outside }),
    });
    expect.soft(misses, "P1: every control owns a 44 × 44 pt hit region").toEqual([]);
    expect.soft(offScale, "P2: all text on the iOS type scale").toEqual([]);
    expect.soft(offLeading, "P3: each size at its iOS leading").toEqual([]);
    expect.soft(offFace, "P16: the app's own typeface").toEqual([]);
    expect.soft(greyed, "P17: reading text and headings in the text's own colour").toEqual([]);
    expect.soft(components, "P18: the same component at the same size wherever it is").toEqual([]);
    expect.soft(contrast, "P15: WCAG contrast, light").toEqual([]);
    expect.soft(contrastDark, "P15: WCAG contrast, dark").toEqual([]);
    expect.soft(overflow, "P11: no sideways scroll").toBeLessThanOrEqual(0);
    expect.soft(zoomed, "P11: no sideways scroll at 150% page zoom").toBeLessThanOrEqual(0);
    expect.soft(outside, "P12: pinned controls inside the safe area").toEqual([]);
  });
}
