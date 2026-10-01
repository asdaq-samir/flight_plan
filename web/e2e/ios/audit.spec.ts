import { test, expect } from "@playwright/test";
import { SCREENS } from "./screens";
import { hitAreaMisses, horizontalOverflow, quiet, still, typeFindings } from "./metrics";

/**
 * The iOS audit's rules P1, P2, P3 and P11, one test per screen, run on
 * every iOS project (playwright.config.ts, IOS_AUDIT=1): every broken
 * rule reported in one run (soft), and what broke it attached as data
 * for the audit's report.
 */
for (const screen of SCREENS) {
  test(`${screen.name}: iOS hit regions, type and fit`, async ({ page }, info) => {
    // The nav log and the training drawer wait on the planner's streams.
    test.slow();
    await screen.ready(page);
    await quiet(page);
    await still(page);

    const misses = await hitAreaMisses(page);
    const { offScale, offLeading } = await typeFindings(page);
    const overflow = await horizontalOverflow(page);
    // Safari's page zoom at 150%: the same screen laid out two thirds as wide.
    const { width, height } = page.viewportSize()!;
    await page.setViewportSize({ width: Math.round(width / 1.5), height: Math.round(height / 1.5) });
    await still(page);
    const zoomed = await horizontalOverflow(page);

    await info.attach("findings", {
      contentType: "application/json",
      body: JSON.stringify({ misses, offScale, offLeading, overflow, zoomed }),
    });
    expect.soft(misses, "P1: every control owns a 44 × 44 pt hit region").toEqual([]);
    expect.soft(offScale, "P2: all text on the iOS type scale").toEqual([]);
    expect.soft(offLeading, "P3: each size at its iOS leading").toEqual([]);
    expect.soft(overflow, "P11: no sideways scroll").toBeLessThanOrEqual(0);
    expect.soft(zoomed, "P11: no sideways scroll at 150% page zoom").toBeLessThanOrEqual(0);
  });
}
