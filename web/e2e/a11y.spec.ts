import AxeBuilder from "@axe-core/playwright";
import { test, expect, type Page } from "@playwright/test";
import { settle, slow } from "./helpers";

/**
 * Accessibility by axe-core, beside the iOS audit's measured rules
 * (e2e/ios): WCAG 2 A and AA on the planner's main states -- the search
 * bar, a route's panel out with its sections, the console -- no serious
 * or critical violation. The chart itself (Leaflet's panes and tiles) is
 * left out: its markers are named for a screen reader where they matter,
 * and its tiles are pictures of a chart.
 */

/** Every animation on the page finished (a spinner's, which never does,
 *  left out): a sheet sliding in is glass over a moving map, and its
 *  words were read against that. */
async function atRest(page: Page) {
  await page.evaluate(() => Promise.all(document.getAnimations()
    .filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => undefined))));
  await page.waitForTimeout(300);
}

async function violations(page: Page, within?: string) {
  await atRest(page);
  let axe = new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .exclude(".leaflet-pane")
    // maximum-scale=1 is deliberate: it keeps iOS from zooming the page
    // in on a field a finger taps (checkpoints.spec), and iOS lets a
    // pinch zoom it all the same.
    .disableRules(["meta-viewport"]);
  // A sheet over the page: what is under its dimming is not what is read.
  if (within) axe = axe.include(within);
  const results = await axe.analyze();
  return results.violations
    .filter(v => v.impact === "serious" || v.impact === "critical")
    .map(v => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map(n => n.target.join(" ")).join(" | ")}`);
}

test("the search bar, with no route", async ({ page }) => {
  await page.goto("/app/plan");
  await settle(page);
  expect(await violations(page)).toEqual([]);
});

test("a route's panel out, its sections open", async ({ page }) => {
  await page.goto("/app/plan?dep=C81&dest=KDLH&view=briefing");
  await settle(page);
  await expect(page.getByTestId("navlog-eta")).toBeVisible({ timeout: slow(120000) });
  for (const title of ["Nav Log", "Current Conditions", "Check before you fly", "Weight & Balance"]) {
    await page.getByRole("button", { name: new RegExp(`^${title}`) }).click();
  }
  await page.waitForTimeout(1000);
  expect(await violations(page)).toEqual([]);
});

test("the console's Settings", async ({ page }) => {
  await page.goto("/app/plan");
  await settle(page);
  await page.getByTestId("settings-button").click();
  await page.getByTestId("console-sheet").getByRole("tab", { name: "Settings" }).click();
  // Come to rest: sliding in, its glass is over the moving map, and its
  // words were read against that.
  await page.getByTestId("console-sheet").evaluate(el => Promise.all(el.getAnimations({ subtree: true })
    .filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished)));
  await page.waitForTimeout(800);
  expect(await violations(page, '[data-testid="console-sheet"]')).toEqual([]);
});
