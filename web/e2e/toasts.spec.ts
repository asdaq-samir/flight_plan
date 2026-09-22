import { test, expect, type Page, type Route } from "@playwright/test";

/**
 * What a pilot meets when things go wrong.
 *
 * Everything this app has to say about a failure it says through one
 * sonner toast stack, and every case below is reached by making the
 * planner fail on purpose rather than by waiting for it to. That is the
 * point: the failure path is the one a pilot hits in the air on a bad
 * connection, and it is the path no other test in this suite exercises,
 * because every other test wants the planner working.
 *
 * Each of these is a bug that actually happened. The planner went down
 * and produced a wall of three identical "planner service unreachable"
 * toasts, one per query that hit it. Widening the toasts so they read
 * properly on a phone made them swallow the wheel events meant for the
 * chart underneath. And dismissing a weather warning on a phone closed
 * the entire briefing with it, because sonner renders outside the
 * drawer's tree and the drawer counted the tap as a tap outside itself.
 */

const PLAN = "/app/plan?dep=C81&dest=KDLH";

const toasts = (page: Page) => page.locator("[data-sonner-toast]");
const titles = (page: Page) => page.locator("[data-sonner-toast] [data-title]");

/** Fail every planner call with one message, the way a planner that is
 *  simply down does. */
async function plannerDown(page: Page, detail = "planner service unreachable") {
  await page.route("**/api/planner/**", (route: Route) =>
    route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ detail }) }));
}

async function settle(page: Page) {
  await page.waitForTimeout(2500);
}

test("a planner that is down says so once, not once per call", async ({ page }) => {
  // The bug this exists for: the toast id was the query's own hash, so
  // the course, the checkpoints and the nav log each raised their own
  // toast carrying the identical sentence, and they stacked up the
  // screen. Keyed by the message, the three collapse into one.
  await plannerDown(page);
  await page.goto(PLAN);
  await settle(page);

  await expect(toasts(page).first()).toBeVisible({ timeout: 15000 });
  const shown = await titles(page).allTextContents();
  const unreachable = shown.filter(t => t.includes("planner service unreachable"));
  expect(unreachable).toHaveLength(1);
});

test("it offers a way out, and the way out works", async ({ page }) => {
  // A failure with no action is just bad news. Try again refetches
  // everything currently in error, so one tap recovers the whole page
  // rather than a third of it.
  await plannerDown(page);
  await page.goto(PLAN);
  await settle(page);

  const retry = page.locator("[data-sonner-toast] button").filter({ hasText: "Try again" });
  await expect(retry.first()).toBeVisible({ timeout: 15000 });

  // The planner comes back.
  await page.unroute("**/api/planner/**");
  await retry.first().click({ force: true });

  await expect
    .poll(async () => (await titles(page).allTextContents()).filter(t => t.includes("unreachable")).length,
          { timeout: 20000 })
    .toBe(0);
});

test("two different failures are two toasts, not one merged or three duplicated", async ({ page }) => {
  // Deduplication is by message, so genuinely different problems must
  // still each get said. Only the identical ones collapse.
  await page.route("**/api/planner/course**", (route: Route) =>
    route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ detail: "planner service unreachable" }) }));
  await page.route("**/api/planner/routes**", (route: Route) =>
    route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ detail: "the corridor store is offline" }) }));

  await page.goto(PLAN);
  await settle(page);

  await expect
    .poll(async () => {
      const shown = await titles(page).allTextContents();
      return [shown.some(t => t.includes("unreachable")), shown.some(t => t.includes("corridor store"))];
    }, { timeout: 15000 })
    .toEqual([true, true]);
});

test("the toast spans the screen and is centred on it", async ({ page }) => {
  // On a phone the default 356px card left the screen empty either
  // side while the sentence inside it wrapped to three lines.
  await plannerDown(page);
  await page.goto(PLAN);
  await settle(page);

  const first = toasts(page).first();
  await expect(first).toBeVisible({ timeout: 15000 });
  const box = (await first.boundingBox())!;
  const viewport = page.viewportSize()!;

  const leftGap = box.x;
  const rightGap = viewport.width - (box.x + box.width);
  expect(Math.abs(leftGap - rightGap)).toBeLessThanOrEqual(2);   // centred
  expect(leftGap).toBeGreaterThanOrEqual(8);                     // a gutter, not edge to edge
  if (viewport.width < 768) {
    // A phone: as wide as the screen allows.
    expect(box.width).toBeGreaterThan(viewport.width * 0.85);
  }
});

test("the chart underneath stays draggable while a toast is showing", async ({ page }) => {
  // Sonner gives its container and cards pointer-events, so the band
  // they occupy was swallowing wheel and drag events meant for the
  // map. A pilot moving the chart should not have to wait out a toast.
  await plannerDown(page);
  await page.goto(PLAN);
  await settle(page);

  const first = toasts(page).first();
  await expect(first).toBeVisible({ timeout: 15000 });
  const box = (await first.boundingBox())!;

  // Dead centre of the toast card -- the worst case.
  const beneath = await page.evaluate(([x, y]) => {
    const el = document.elementFromPoint(x, y);
    return el?.closest("[data-sonner-toast]") ? "the toast" : "something under it";
  }, [box.x + box.width / 2, box.y + box.height / 2]);
  expect(beneath).toBe("something under it");

  // Its own controls still take their clicks back.
  const control = first.locator("button").first();
  const cbox = await control.boundingBox();
  if (cbox) {
    const onControl = await page.evaluate(([x, y]) => {
      const el = document.elementFromPoint(x, y);
      return !!el?.closest("[data-sonner-toast] button");
    }, [cbox.x + cbox.width / 2, cbox.y + cbox.height / 2]);
    expect(onControl).toBe(true);
  }
});

test("dismissing a toast dismisses the toast, not the drawer under it", async ({ page }) => {
  // The phone bug: sonner renders in its own portal at the end of the
  // body, so the drawer's outside-interaction listener counted a tap on
  // a toast as a tap outside itself and closed the whole briefing.
  await page.goto(PLAN);
  await page.waitForTimeout(4000);

  await page.getByTestId("sidebar-trigger-button").click();
  await page.waitForTimeout(1500);

  const phoneDrawer = page.locator('[data-mobile="true"][data-sidebar="sidebar"]');
  const onPhone = (await phoneDrawer.count()) > 0;

  const closeable = page.locator("[data-sonner-toast]:has(button[data-close-button])");
  await expect(closeable.first()).toBeVisible({ timeout: 20000 });
  const before = await closeable.count();

  await closeable.first().locator("button[data-close-button]").click({ force: true });

  await expect.poll(() => closeable.count(), { timeout: 10000 }).toBe(before - 1);
  if (onPhone) {
    // The desktop panel is not a sheet and has no such listener, so
    // only the phone's drawer is the case that can regress.
    await expect(phoneDrawer).toHaveCount(1);
  }
});

test("a pile-up stays legible: at most three, stacked rather than marching up the screen", async ({ page }) => {
  await plannerDown(page);
  await page.goto(PLAN);
  await settle(page);
  await page.getByTestId("sidebar-trigger-button").click();
  await page.waitForTimeout(1500);

  const count = await toasts(page).count();
  expect(count).toBeGreaterThan(0);
  expect(count).toBeLessThanOrEqual(3);

  // Collapsed, the stack occupies about one card's height rather than
  // one card's height per toast.
  const boxes = await toasts(page).evaluateAll(els =>
    els.map(el => el.getBoundingClientRect()).map(r => ({ top: r.top, bottom: r.bottom })));
  const top = Math.min(...boxes.map(b => b.top));
  const bottom = Math.max(...boxes.map(b => b.bottom));
  const viewport = page.viewportSize()!;
  expect(bottom - top).toBeLessThan(viewport.height * 0.45);
});
