import { test, expect, type Page } from "@playwright/test";
import { settle, slow } from "./helpers";

/**
 * The TV apps (tv/, lib/tv): the page their app opens with `?tv=`, driven
 * by a remote -- its arrows from control to control, OK, Back closing what
 * is open, and the map panned and zoomed while the remote is on it. A
 * desktop's keyboard stands in for the remote: its arrows and Enter are a
 * remote's, and LG's Back (461) is sent as the TV sends it.
 */

test.skip(({ viewport }) => (viewport?.width ?? 0) < 768, "a TV's screen");

/** LG's Back, as webOS sends it with disableBackHistoryAPI on (tv/webos). */
const back = (page: Page) => page.evaluate(() => {
  const target = document.activeElement ?? document.body;
  target.dispatchEvent(new KeyboardEvent("keydown", { key: "GoBack", keyCode: 461, bubbles: true, cancelable: true }));
});

/** The map's zoom, from its chart's tiles: Leaflet raises the level it
 *  is drawing over the others (its z-index), each tile's address its zoom. */
const mapZoom = (page: Page) => page.evaluate(() => {
  const levels = [...document.querySelectorAll<HTMLElement>(".leaflet-tile-container")]
    .filter(level => level.querySelector("img"))
    .sort((a, b) => Number(b.style.zIndex) - Number(a.style.zIndex));
  const src = levels[0]?.querySelector("img")?.getAttribute("src") ?? "";
  return Number(src.match(/\/(\d+)\/\d+\/\d+\.png/)?.[1] ?? NaN);
});

test("on a TV the remote's arrows move from control to control, Back closes what is open, and OK zooms the map", async ({ page }) => {
  await page.goto("/app/plan?tv=webos");
  await settle(page);
  await expect(page.locator("html")).toHaveAttribute("data-tv", "webos");
  // Kept for the visit, the address rewritten by the planner without it.
  expect(await page.evaluate(() => sessionStorage.getItem("vfr.tv"))).toBe("webos");

  // The remote starts on the panel's first control, ringed, and the
  // arrows take it on to another.
  const focused = () => page.evaluate(() => document.activeElement?.outerHTML.slice(0, 80) ?? "");
  await expect.poll(focused, { timeout: slow(15000) }).toMatch(/^<button/);
  expect(await page.evaluate(() => getComputedStyle(document.activeElement!).outlineStyle)).toBe("solid");
  const first = await focused();
  await page.keyboard.press("ArrowRight");
  await expect.poll(focused).not.toBe(first);
  expect(await focused()).not.toMatch(/^<body/);

  // A card opened, and Back closes it -- a step at a time, as Escape
  // does: out of its field first where the remote is in it.
  await page.getByTestId("nearest-button").click();
  const card = page.getByTestId("nearest-card");
  await expect(card).toBeVisible({ timeout: slow(15000) });
  await expect(async () => {
    if (await card.count()) await back(page);
    await expect(card).toHaveCount(0, { timeout: 500 });
  }).toPass({ timeout: slow(10000) });

  // On the map: its + and - to reach, and OK zooms in.
  await expect(page.locator(".leaflet-control-zoom-in")).toBeVisible();
  await page.locator(".leaflet-container").first().focus();
  await expect.poll(() => mapZoom(page), { timeout: slow(15000) }).toBeGreaterThan(0);
  const before = await mapZoom(page);
  await page.keyboard.press("Enter");
  await expect.poll(() => mapZoom(page), { timeout: slow(15000) }).toBe(before + 1);
  // And Back takes the remote off the map, the app still open.
  await back(page);
  await expect.poll(() => page.evaluate(() => document.activeElement?.classList.contains("leaflet-container"))).toBe(false);
});

test("off a TV the page is as it was: no ring of its own, no zoom buttons", async ({ page }) => {
  await page.goto("/app/plan");
  await settle(page);
  await expect(page.locator("html")).not.toHaveAttribute("data-tv", /.+/);
  await expect(page.locator(".leaflet-control-zoom-in")).toHaveCount(0);
});
