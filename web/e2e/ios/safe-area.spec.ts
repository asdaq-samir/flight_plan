import { test, expect } from "@playwright/test";
import { SCREENS } from "./screens";
import { emulateSafeArea, outsideSafeArea, quiet, still, type Insets } from "./metrics";

/**
 * The iOS audit's rule P12 on the island iPhones: nothing pinned to the
 * screen under the island or the home indicator. In portrait no inset at
 * the top: Safari's own bar is there, and a home-screen app starts below
 * the status bar (index.html's apple-mobile-web-app-status-bar-style is
 * "default"; "black-translucent" would put the page under it, and this
 * top inset would be the status bar's 59). The home indicator's 34 at the
 * bottom. On its side, the island's 59 at either edge and 21 at the
 * bottom. Not measured: the SE, which has no insets, and the iPads.
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
  test(`${screen.name}: nothing pinned under the notch, the island or the home indicator`, async ({ page }, info) => {
    const insets = INSETS[info.project.name];
    test.skip(!insets, "no island here: the SE has no insets, and an iPad's are its own");
    test.slow();
    await screen.ready(page);
    await quiet(page);
    await emulateSafeArea(page, insets);
    await still(page);

    const outside = await outsideSafeArea(page, insets);
    await info.attach("findings", { contentType: "application/json", body: JSON.stringify({ insets, outside }) });
    expect(outside, "P12: pinned controls inside the safe area").toEqual([]);
  });
}
