import { test, expect, type Page, type Route } from "@playwright/test";

/**
 * What a pilot meets when things go wrong, and the toasts that are left.
 *
 * What went wrong is said where it belongs, taking no more room than it
 * must (lib/problems): the planner or a service out is one line beside
 * the map's buttons, a route with no legal altitude says so in its own
 * panel (plans.spec), and a one-off failure is an alert with OK. Every
 * case here is reached by making the planner fail on purpose rather than
 * by waiting for it to: the failure path is the one a pilot hits in the
 * air on a bad connection, and no other test takes it.
 *
 * Each of these is a bug that actually happened. The planner went down
 * and produced a wall of three identical "planner service unreachable"
 * toasts, one per query that hit it. Widening the toasts so they read
 * properly on a phone made them swallow the wheel events meant for the
 * chart underneath. And errors as toasts that stayed, folded to lines,
 * sat over the location arrow and the panel's grabber.
 */

const PLAN = "/app/plan?dep=C81&dest=KDLH";

const banner = (page: Page) => page.locator("[data-problem-banner]");
const toasts = (page: Page) => page.locator("[data-sonner-toast]");

/** Fail every planner call with one message, the way a planner that is
 *  simply down does. */
async function plannerDown(page: Page, detail = "planner service unreachable") {
  await page.route("**/api/planner/**", (route: Route) =>
    route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ detail }) }));
}

/** The planner's progress line held up: the course never answers. */
async function holdCourse(page: Page) {
  await page.route("**/api/planner/course**", () => new Promise<void>(() => undefined));
}

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

/** The problems' words: the one, or each of several, opened to them. */
async function problemTitles(page: Page): Promise<string[]> {
  const title = page.getByTestId("problem-banner-title");
  if (!(await title.isVisible())) return [];
  const text = (await title.textContent()) ?? "";
  if (!/^\d+ problems$/.test(text)) return [text];
  if ((await title.getAttribute("aria-expanded")) !== "true") await title.click();
  return page.locator("[data-problem-item]").allTextContents();
}

/** Come to rest: its moves done, the progress line's spinner, which never
 *  is, left out. */
async function settled(page: Page, selector: string) {
  await page.locator(selector).first().evaluate(el => Promise.all(el.getAnimations({ subtree: true })
    .filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished)));
}

test("a planner that is down says so once, in one line, not once per call", async ({ page }) => {
  // The bug this exists for: the problem was keyed by the query's own
  // hash, so the course, the checkpoints and the nav log each raised one
  // carrying the identical sentence, and they stacked up the screen.
  // Keyed by the message, the three are one -- and never a toast.
  await plannerDown(page);
  await page.goto(PLAN);

  await expect.poll(async () => (await problemTitles(page)).filter(t => t.includes("unreachable")).length,
    { timeout: 20000 }).toBe(1);
  await expect(toasts(page).filter({ hasText: "unreachable" })).toHaveCount(0);
});

test("it offers a way out, the way out works, and the line goes with the problem", async ({ page }) => {
  // A failure with no action is just bad news. Try again refetches
  // everything currently in error, so one tap recovers the whole page
  // rather than a third of it; with no close, the line goes when what
  // caused it has.
  await plannerDown(page);
  await page.goto(PLAN);

  const retry = banner(page).getByRole("button", { name: "Try again" });
  await expect(retry).toBeVisible({ timeout: 20000 });

  // The planner comes back.
  await page.unroute("**/api/planner/**");
  await retry.click();
  await expect(banner(page)).toHaveCount(0, { timeout: 30000 });
});

test("two different failures are two problems, counted on the line and listed on a tap", async ({ page }) => {
  // Deduplication is by message, so genuinely different problems must
  // still each get said. Only the identical ones collapse.
  await page.route("**/api/planner/course**", (route: Route) =>
    route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ detail: "planner service unreachable" }) }));
  await page.route("**/api/planner/aircraft-profiles**", (route: Route) =>
    route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ detail: "the aircraft store is offline" }) }));
  await page.goto(PLAN);

  await expect(page.getByTestId("problem-banner-title")).toHaveText(/^\d+ problems$/, { timeout: 20000 });
  await expect.poll(async () => {
    const shown = await problemTitles(page);
    return [shown.some(t => t.includes("unreachable")), shown.some(t => t.includes("aircraft store"))];
  }, { timeout: 15000 }).toEqual([true, true]);
});

test("a problem goes with the route it was about", async ({ page }) => {
  // With no close of its own, a problem left behind by a route since
  // closed stayed on the map.
  await page.route("**/api/planner/course**", (route: Route) =>
    route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ detail: "unknown airport KZZZ" }) }));
  await page.goto("/app/plan?dep=C81&dest=KZZZ");
  await expect(page.getByTestId("problem-banner-title")).toHaveText("unknown airport KZZZ", { timeout: 20000 });

  await page.getByTestId("clear-route").click();
  await expect(banner(page)).toHaveCount(0);
});

test("the line sits beside the map's buttons, level with them, one line tall, and the location arrow takes its tap", async ({ page }) => {
  // Problems that stayed were folded to lines over the map's buttons, and
  // the location arrow under them was out of reach for as long as they
  // lasted.
  await plannerDown(page);
  await page.goto(PLAN);
  const line = banner(page).getByRole("status");
  await expect(line).toBeVisible({ timeout: 20000 });

  const box = (await line.boundingBox())!;
  const controls = (await page.locator("[data-map-controls]").boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(controls.x);
  const levelTop = Math.abs(box.y - controls.y) <= 1;
  const levelBottom = Math.abs(box.y + box.height - (controls.y + controls.height)) <= 1;
  expect(levelTop || levelBottom).toBe(true);
  expect(box.height).toBeLessThanOrEqual(48);

  const arrow = (await page.getByTestId("my-position-button").boundingBox())!;
  const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest("[data-testid=my-position-button]") !== null,
    [arrow.x + arrow.width / 2, arrow.y + arrow.height / 2]);
  expect(hit).toBe(true);
});

test("the panel all the way out goes over the line, and its grabber still lowers it", async ({ page }) => {
  // The line is the map's, under the panel: from the bottom of a phone the
  // sheet all the way out has its grabber at the top of the screen, where
  // a toast came in and a folded one stayed, and the sheet could not be
  // lowered while the problem lasted.
  test.skip(page.viewportSize()!.width >= 768, "a phone's sheet");
  await plannerDown(page);
  await page.goto(PLAN);
  const line = banner(page).getByRole("status");
  await expect(line).toBeVisible({ timeout: 20000 });

  await page.getByTestId("sidebar-trigger-button").click();
  const sheet = page.locator('[data-slot="map-panel"]');
  await expect(sheet).toHaveAttribute("data-panel", "full");
  await settled(page, '[data-slot="map-panel"]');

  const box = (await line.boundingBox())!;
  const over = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('[data-slot="map-panel"]') !== null,
    [box.x + box.width / 2, box.y + box.height / 2]);
  expect(over).toBe(true);
  await page.getByTestId("sidebar-trigger-button").click();
  await expect(sheet).toHaveAttribute("data-panel", "peek");
});

test("the progress line spans the screen and is centred on it", async ({ page }) => {
  // On a phone the default 356px card left the screen empty either
  // side while the sentence inside it wrapped to three lines.
  await holdCourse(page);
  await page.goto(PLAN);

  const first = toasts(page).first();
  await expect(first).toBeVisible({ timeout: 15000 });
  await settled(page, "[data-sonner-toast]");
  const box = (await first.boundingBox())!;
  const viewport = page.viewportSize()!;

  const leftGap = box.x;
  const rightGap = viewport.width - (box.x + box.width);
  expect(leftGap).toBeGreaterThanOrEqual(8);                     // a gutter, not edge to edge
  expect(Math.abs(leftGap - rightGap)).toBeLessThanOrEqual(2);   // centred
  if (viewport.width < 768) {
    // A phone: the screen's width less a gutter either side, across the
    // map's buttons, level with them -- its top on their card's.
    const controls = (await page.locator("[data-map-controls] > *").first().boundingBox())!;
    expect(Math.abs(box.y - controls.y)).toBeLessThanOrEqual(1);
    expect(box.width).toBeGreaterThan(viewport.width * 0.7);
  }
});

test("a toast sits clear of the panel: at the top of a phone's screen, the bottom of a desktop's", async ({ page }) => {
  // On a phone the panel is a sheet up from the bottom of the screen,
  // and a toast anchored there covered it: it comes in from the top
  // there, as an iOS banner does. From md up the panel is at the top,
  // and the toast comes in from the bottom.
  await holdCourse(page);
  await page.goto(PLAN);

  const first = toasts(page).first();
  await expect(first).toBeVisible({ timeout: 15000 });
  await settled(page, "[data-sonner-toast]");
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
  await holdCourse(page);
  await page.goto(PLAN);

  const first = toasts(page).first();
  await expect(first).toBeVisible({ timeout: 15000 });
  await settled(page, "[data-sonner-toast]");
  const box = (await first.boundingBox())!;

  // Dead centre of the toast card -- the worst case.
  const beneath = await page.evaluate(([x, y]) => {
    const el = document.elementFromPoint(x, y);
    return el?.closest("[data-sonner-toast]") ? "the toast" : "something under it";
  }, [box.x + box.width / 2, box.y + box.height / 2]);
  expect(beneath).toBe("something under it");
});

test("a tap on a toast over the open panel is the toast's, not the panel's", async ({ page }) => {
  // Over the chart a toast is transparent to the pointer (the test
  // above). Over the open panel that made a tap on the card fall through
  // to the panel's own controls: tapping a toast opened the briefing
  // section behind it.
  await holdCourse(page);
  await page.goto(`${PLAN}&view=briefing`);
  const first = page.locator('[data-sonner-toast][data-front="true"]');
  await expect(first).toBeVisible({ timeout: 20000 });
  await settled(page, '[data-sonner-toast][data-front="true"]');
  const box = (await first.boundingBox())!;

  const hit = await page.evaluate(([x, y]) => {
    const el = document.elementFromPoint(x, y);
    return el?.closest("[data-sonner-toast]") ? "the toast" : "something under it";
  }, [box.x + box.width / 2, box.y + box.height / 2]);
  expect(hit).toBe("the toast");
});
