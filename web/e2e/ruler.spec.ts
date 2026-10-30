import { test, expect, type CDPSession, type Page } from "@playwright/test";
import { settle, slow } from "./helpers";

/**
 * The map's ruler (MapRuler), as ForeFlight's: two fingers held still on
 * the chart put a line between them with its course each way, distance
 * and time, following the fingers until both lift (the owner's ask,
 * 2026-10-30). A pinch that moves at once still zooms. Fingers by the
 * DevTools protocol's touches, two at a time, which Playwright's own
 * touchscreen cannot give.
 */

test.use({ hasTouch: true });

type Finger = { x: number; y: number };

async function fingers(page: Page): Promise<{ cdp: CDPSession; touch: (type: string, at?: [Finger, Finger]) => Promise<unknown>; map: { x: number; y: number; width: number; height: number } }> {
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: string, at?: [Finger, Finger]) =>
    cdp.send("Input.dispatchTouchEvent", { type, touchPoints: at ? at.map((p, i) => ({ ...p, id: i + 1 })) : [] });
  const map = (await page.locator(".leaflet-container").boundingBox())!;
  return { cdp, touch, map };
}

/** The chart's tile level now: the highest of those drawn. */
const tileLevel = (page: Page) => page.evaluate(() => Math.max(...[...document.querySelectorAll<HTMLImageElement>("img.leaflet-tile")]
  .map(img => Number(new URL(img.src).pathname.split("/").at(-3))).filter(Number.isFinite)));

test("two fingers held on the chart bring up the ruler, with its course magnetic and its distance, until they lift", async ({ page }) => {
  test.skip(page.viewportSize()!.width >= 768, "a phone's fingers");
  await page.goto("/app/plan?place=C81");
  await settle(page);
  const { touch, map } = await fingers(page);
  // Over the chart, above the sheet.
  const y = map.y + 160;
  const at: [Finger, Finger] = [{ x: map.x + 60, y }, { x: map.x + map.width - 60, y: y + 80 }];
  await touch("touchStart", at);
  // Held, a finger wandering a little as one at rest does.
  await page.waitForTimeout(150);
  await touch("touchMove", [{ x: at[0].x + 2, y: at[0].y + 1 }, at[1]]);
  const ruler = page.getByTestId("map-ruler");
  await expect(ruler).toBeVisible({ timeout: slow(3000) });
  await expect(ruler).toContainText("nm");
  await expect(ruler).toContainText("°M", { timeout: slow(5000) });
  await expect(ruler).toContainText(/\d{3}°M →/);
  await expect(ruler).toContainText(/← \d{3}°M/);
  // VoiceOver is told as it comes.
  await expect(page.getByTestId("ruler-spoken")).toContainText(/nautical miles, .* magnetic/);

  // It follows the fingers: drawn out, the distance grows.
  const figures = async () => Number(/([\d.]+) nm/.exec((await ruler.textContent()) ?? "")?.[1]);
  const before = await figures();
  const zoom = await tileLevel(page);
  for (let i = 1; i <= 5; i++) await touch("touchMove", [{ x: at[0].x, y: at[0].y }, { x: at[1].x, y: at[1].y + 40 * i }]);
  await expect.poll(figures).toBeGreaterThan(before);
  // And the chart under it held still: fingers spread did not zoom it.
  expect(await tileLevel(page)).toBe(zoom);

  await touch("touchEnd");
  await expect(ruler).toHaveCount(0);
  await expect(page.getByTestId("ruler-spoken")).toHaveText("");
});

test("a pinch that moves at once still zooms the chart, with no ruler", async ({ page }) => {
  test.skip(page.viewportSize()!.width >= 768, "a phone's fingers");
  await page.goto("/app/plan?place=C81");
  await settle(page);
  await expect.poll(() => tileLevel(page), { timeout: slow(15000) }).toBeGreaterThan(4);
  const before = await tileLevel(page);
  const { touch, map } = await fingers(page);
  const middle = { x: map.x + map.width / 2, y: map.y + 220 };
  // Fingers 300 points apart drawn together to 40: out more than two levels.
  const apart = (d: number): [Finger, Finger] => [{ x: middle.x - d / 2, y: middle.y }, { x: middle.x + d / 2, y: middle.y }];
  await touch("touchStart", apart(300));
  for (let d = 280; d >= 40; d -= 20) await touch("touchMove", apart(d));
  await expect(page.getByTestId("map-ruler")).toHaveCount(0);
  await touch("touchEnd");
  await expect.poll(() => tileLevel(page), { timeout: slow(10000) }).toBeLessThan(before);
  // Past the ruler's hold, still none: the pinch was the map's.
  await page.waitForTimeout(500);
  await expect(page.getByTestId("map-ruler")).toHaveCount(0);
});
