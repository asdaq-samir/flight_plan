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
/** A problem's minimize (lib/notify): an error or a warning has no
 *  close, and folds to a line instead. */
const MINIMIZE = "[data-testid=problem-minimize]";
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
  await page.route("**/api/planner/aircraft-profiles**", (route: Route) =>
    route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ detail: "the aircraft store is offline" }) }));

  await page.goto(PLAN);
  await settle(page);

  await expect
    .poll(async () => {
      const shown = await titles(page).allTextContents();
      return [shown.some(t => t.includes("unreachable")), shown.some(t => t.includes("aircraft store"))];
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
  expect(leftGap).toBeGreaterThanOrEqual(8);                     // a gutter, not edge to edge
  if (viewport.width < 768) {
    // A phone: the screen's width less a gutter either side, across the
    // map's buttons as at the bottom -- level with them, its top on their
    // card's.
    const controls = (await page.locator("[data-map-controls] > *").first().boundingBox())!;
    expect(Math.abs(leftGap - rightGap)).toBeLessThanOrEqual(2);
    expect(Math.abs(box.y - controls.y)).toBeLessThanOrEqual(1);
    expect(box.width).toBeGreaterThan(viewport.width * 0.7);
  } else {
    expect(Math.abs(leftGap - rightGap)).toBeLessThanOrEqual(2); // centred
  }
});

test("a toast sits clear of the panel: at the top of a phone's screen, the bottom of a desktop's", async ({ page }) => {
  // On a phone the panel is a sheet up from the bottom of the screen,
  // and a toast anchored there covered it: it comes in from the top
  // there, as an iOS banner does. From md up the panel is at the top,
  // and the toast comes in from the bottom.
  await plannerDown(page);
  await page.goto(PLAN);
  await settle(page);

  const first = toasts(page).first();
  await expect(first).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(500);
  const box = (await first.boundingBox())!;
  const panel = (await page.locator('[data-slot="map-panel"]').boundingBox())!;
  if (page.viewportSize()!.width < 768) {
    expect(box.y).toBeLessThan(60);
    expect(box.y + box.height).toBeLessThanOrEqual(panel.y);
  } else {
    expect(box.y).toBeGreaterThanOrEqual(panel.y + panel.height);
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

test("minimizing a problem folds the problem, not the drawer under it", async ({ page }) => {
  // The phone bug: sonner renders in its own portal at the end of the
  // body, so the drawer's outside-interaction listener counted a tap on
  // a toast as a tap outside itself and closed the whole briefing.
  // Toasts to dismiss: the planner down (the briefing no longer raises
  // one of its own on opening -- its reminder is the drawer's last line).
  await plannerDown(page);
  await page.goto(PLAN);
  await page.waitForTimeout(4000);

  await page.getByTestId("sidebar-trigger-button").click();
  await page.waitForTimeout(1500);

  const phoneDrawer = page.locator('[data-mobile="true"][data-sidebar="sidebar"]');
  const onPhone = (await phoneDrawer.count()) > 0;

  // A problem open -- under a phone's sheet all the way out it comes
  // folded, and a tap on its line opens it -- its minimize; folded, it is
  // still there, a line.
  const open = page.locator('[data-problem="open"]');
  const folded = page.locator('[data-problem="minimized"]');
  await expect(open.or(folded).first()).toBeVisible({ timeout: 20000 });
  if (!(await open.count())) await folded.first().getByTestId("problem-open").click();
  await expect(open.first()).toBeVisible();
  await open.first().locator(MINIMIZE).click({ force: true });
  await expect(folded.first()).toBeVisible({ timeout: 10000 });
  // No close: an error goes when its cause does.
  await expect(page.getByRole("button", { name: "Dismiss" })).toHaveCount(0);
  if (onPhone) {
    // The desktop panel is not a sheet and has no such listener, so
    // only the phone's drawer is the case that can regress.
    await expect(phoneDrawer).toHaveCount(1);
  }
});

test("a tap on a toast over the open drawer is the toast's, not the drawer's", async ({ page }) => {
  // Over the chart a toast is transparent to the pointer (the test
  // above). Over the drawer that made a tap on the card fall through to
  // the drawer's own controls: tapping a toast opened the briefing
  // section behind it. The planner down, for a toast that stays: a
  // working planner's only toast is its progress line, gone in a
  // moment once CI's warm planner has answered. The front one, the
  // card on top of the stack.
  await plannerDown(page);
  await page.goto(`${PLAN}&view=briefing`);
  const first = page.locator('[data-sonner-toast][data-front="true"]');
  await expect(first).toBeVisible({ timeout: 20000 });
  await page.waitForTimeout(1000);
  const box = (await first.boundingBox())!;

  const hit = await page.evaluate(([x, y]) => {
    const el = document.elementFromPoint(x, y);
    return el?.closest("[data-sonner-toast]") ? "the toast" : "something under it";
  }, [box.x + box.width / 2, box.y + box.height / 2]);
  expect(hit).toBe("the toast");
});

test("minimizing a problem over the console leaves the console open", async ({ page }) => {
  // The same guard, on the stock sheet the console is. A caller passing
  // its own onInteractOutside used to replace the guard silently, and
  // nothing covered the console to notice.
  await plannerDown(page);
  // The search bar's console, over the map with no route: the chart's
  // own answer fails, and says so.
  await page.goto("/app/plan");
  await page.getByTestId("settings-button").click();
  const console = page.getByTestId("console-sheet");
  await expect(console).toBeVisible();

  // With the console out a problem comes folded: a tap on its line opens
  // it over the console, and its minimize folds it again -- the console
  // staying out either way. Once the card has come to rest: the first
  // in the page could still be sliding in from off screen (from the top,
  // on a phone), where a forced click missed it.
  const line = page.locator('[data-problem="minimized"]').first();
  await expect(line).toBeVisible({ timeout: 20000 });
  await line.getByTestId("problem-open").click();
  await expect(console).toBeVisible();
  const front = page.locator(`[data-sonner-toast][data-front="true"]:has(${MINIMIZE})`);
  await expect(front).toBeVisible({ timeout: 20000 });
  await front.locator(MINIMIZE).click();

  await expect(page.locator('[data-problem="minimized"]').first()).toBeVisible({ timeout: 10000 });
  await expect(console).toBeVisible();
});

test("a pile-up stays legible: at most three, stacked rather than marching across the screen", async ({ page }) => {
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

test("a problem folded to its line leaves the map's buttons in sight beside it", async ({ page }) => {
  // Open, a problem runs across the map's buttons; folded, it is a line
  // that may last a while, and the location arrow under it was out of
  // reach for as long as it did.
  await plannerDown(page);
  await page.goto(PLAN);
  // The front card's: one stacked behind it may sit off the screen.
  const open = page.locator('[data-sonner-toast][data-front="true"] [data-problem="open"]');
  await expect(open).toBeVisible({ timeout: 20000 });
  // Once it has come to rest: it slides in from the screen's edge.
  await open.evaluate(el => Promise.all(el.closest("[data-sonner-toast]")!.getAnimations({ subtree: true }).map(a => a.finished)));
  await open.locator(MINIMIZE).click({ force: true });
  const folded = page.locator('[data-sonner-toast][data-front="true"] [data-problem="minimized"]');
  await expect(folded).toBeVisible({ timeout: 10000 });
  await folded.evaluate(el => Promise.all(el.closest("[data-sonner-toast]")!.getAnimations({ subtree: true }).map(a => a.finished)));

  const pill = (await folded.boundingBox())!;
  const arrow = (await page.getByTestId("my-position-button").boundingBox())!;
  const overlaps = pill.x < arrow.x + arrow.width && arrow.x < pill.x + pill.width
    && pill.y < arrow.y + arrow.height && arrow.y < pill.y + pill.height;
  expect(overlaps).toBe(false);
  // And the arrow takes its tap: nothing of the line over it.
  const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest("[data-testid=my-position-button]") !== null,
    [arrow.x + arrow.width / 2, arrow.y + arrow.height / 2]);
  expect(hit).toBe(true);
});

test("with a problem folded to its line, the panel all the way out stops short of it, and its grabber still lowers it", async ({ page }) => {
  // From the bottom of a phone the sheet all the way out has its grabber
  // at the top of the screen, where a toast came in and a folded line
  // stayed: the sheet could not be lowered while the problem lasted. It
  // stops short of the line now, the line in its place.
  test.skip(page.viewportSize()!.width >= 768, "a phone's sheet");
  await page.route("**/api/planner/navlog**", route => route.fulfill({
    status: 200, contentType: "application/x-ndjson",
    body: JSON.stringify({ type: "error", retry: false, detail: "No legal VFR cruising altitude 830-858 nm along the route",
      reasons: ["The terrain and obstacles there need 10,600 ft."], advice: "Route around the high ground." }) + "\n",
  }));
  await page.goto(`${PLAN}&view=briefing`);
  // Raised with the sheet all the way out: it comes folded.
  const folded = page.locator('[data-problem="minimized"]').first();
  await expect(folded).toBeVisible({ timeout: 20000 });
  await folded.evaluate(el => Promise.all(el.closest("[data-sonner-toast]")!.getAnimations({ subtree: true }).map(a => a.finished)));

  const line = (await folded.boundingBox())!;
  const sheet = page.locator('[data-slot="map-panel"]');
  await sheet.evaluate(el => Promise.all(el.getAnimations().map(a => a.finished)));
  expect((await sheet.boundingBox())!.y).toBeGreaterThanOrEqual(line.y + line.height);
  const grabber = page.getByTestId("sidebar-trigger-button");
  // Once the stack and the sheet have come to rest -- another line folded
  // in eases the sheet a little shorter -- nothing is over the grabber.
  await expect.poll(async () => {
    const box = (await grabber.boundingBox())!;
    return page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest("[data-testid=sidebar-trigger-button]") !== null,
      [box.x + box.width / 2, box.y + box.height / 2]);
  }, { timeout: 5000 }).toBe(true);
  await grabber.click();
  await expect(page.locator('[data-slot="map-panel"]')).toHaveAttribute("data-panel", "peek");
});

test("a problem open as the panel comes all the way out folds to its line, and one raised then comes folded", async ({ page }) => {
  test.skip(page.viewportSize()!.width >= 768, "a phone's sheet");
  await page.route("**/api/planner/navlog**", route => route.fulfill({
    status: 200, contentType: "application/x-ndjson",
    body: JSON.stringify({ type: "error", retry: false, detail: "No legal VFR cruising altitude 830-858 nm along the route",
      reasons: ["The terrain and obstacles there need 10,600 ft."], advice: "Route around the high ground." }) + "\n",
  }));
  await page.goto(PLAN);
  await expect(page.locator('[data-problem="open"]')).toBeVisible({ timeout: 20000 });
  // All the way out -- the grabber from rest -- folded at once, not
  // after its eight seconds.
  await page.getByTestId("sidebar-trigger-button").click();
  await expect(page.locator('[data-slot="map-panel"]')).toHaveAttribute("data-panel", "full");
  await expect(page.locator('[data-problem="minimized"]')).toBeVisible({ timeout: 2000 });
  await expect(page.locator('[data-problem="open"]')).toHaveCount(0);

  // Raised again with the panel out (Load: a fresh nav log): folded.
  await page.reload();
  await expect(page.locator('[data-slot="map-panel"]')).toHaveAttribute("data-panel", "full");
  await expect(page.locator('[data-problem="minimized"]')).toBeVisible({ timeout: 20000 });
  await expect(page.locator('[data-problem="open"]')).toHaveCount(0);
  // A tap still opens it to be read.
  await page.getByTestId("problem-open").click();
  await expect(page.locator('[data-problem="open"]')).toBeVisible();
});

test("a problem open as the panel comes half way out folds to its line too", async ({ page }) => {
  test.skip(page.viewportSize()!.width >= 768, "a phone's sheet");
  await page.route("**/api/planner/navlog**", route => route.fulfill({
    status: 200, contentType: "application/x-ndjson",
    body: JSON.stringify({ type: "error", retry: false, detail: "No legal VFR cruising altitude 830-858 nm along the route",
      reasons: ["The terrain and obstacles there need 10,600 ft.", "The first westbound VFR altitude above that is 12,500 ft."],
      advice: "Route around the high ground." }) + "\n",
  }));
  await page.goto(PLAN);
  await expect(page.locator('[data-problem="open"]')).toBeVisible({ timeout: 20000 });
  await page.getByTestId("capsule-detail").click();
  await expect(page.locator('[data-slot="map-panel"]')).toHaveAttribute("data-panel", "half");
  await expect(page.locator('[data-problem="open"]')).toHaveCount(0, { timeout: 2000 });
  const line = (await page.locator('[data-problem="minimized"]').boundingBox())!;
  const sheet = (await page.locator('[data-slot="map-panel"]').boundingBox())!;
  expect(line.y + line.height).toBeLessThanOrEqual(sheet.y);
});
