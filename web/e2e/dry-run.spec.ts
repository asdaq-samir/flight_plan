import { test, expect, type Page } from "@playwright/test";
import { grabberTo, openPanel, openTab, settle, settled, sideDrawer, slow } from "./helpers";

/**
 * The planned flight's dry run flies own ship, as if a pilot were flying
 * the route (lib/map/ownShip's simulateFix): the location arrow on, own
 * ship moving along the course with the plan's heading, and put back as
 * the pilot had it -- here off, no GPS asked -- when the run is closed;
 * nothing of it kept as where the pilot has flown (ownTrail).
 */
test("the dry run flies own ship along the route, and gives it back as it was", async ({ page }) => {
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  await openPanel(page);
  const start = sideDrawer(page).getByTestId("dry-run-start");
  await expect(start).toBeVisible({ timeout: slow(60_000) });
  await expect(page.locator("[data-own-ship]")).toHaveCount(0);

  await start.click();
  const ship = page.locator('[data-own-ship="on"]');
  await expect(ship).toHaveCount(1);
  // The airplane followed: the location arrow is the whole route's button
  // (the owner's "Can the locator button change to fit line during dry
  // run when plane is centered on the screen"). Tapped, the map takes the
  // route, and the arrow comes back to bring the airplane to the middle.
  const arrow = page.locator("[data-map-controls]").getByTestId("my-position-button");
  await expect(arrow).toHaveAttribute("data-face", "route");
  await expect(arrow).toHaveAccessibleName("Show the whole route");
  await arrow.click();
  await expect(arrow).toHaveAttribute("data-face", "position");
  await expect(arrow).toHaveAccessibleName("Follow the airplane");
  await arrow.click();
  await expect(arrow).toHaveAttribute("data-face", "route");
  // Moving: its place on the chart changes as the run plays (with the
  // map following it, the marker itself may stay put, so the map pane's too).
  const where = () => page.evaluate(() => {
    const icon = document.querySelector('[data-own-ship="on"]')!.closest(".leaflet-marker-icon") as HTMLElement;
    const pane = document.querySelector(".leaflet-map-pane") as HTMLElement;
    return `${icon.style.transform} ${pane.style.transform}`;
  });
  const first = await where();
  await expect.poll(where, { timeout: slow(10_000) }).not.toBe(first);

  await sideDrawer(page).getByTestId("dry-run-close").click();
  await expect(page.locator("[data-own-ship]")).toHaveCount(0);
  const kept = await page.evaluate(() => ({ ship: localStorage.getItem("vfr.ownship"), trail: localStorage.getItem("vfr.owntrail") }));
  expect(JSON.parse(kept.ship ?? "{}").state?.enabled ?? false).toBe(false);
  expect(kept.trail).toBeNull();
});

test("the dry run's chart draws the airspace the course passes through, named as the side view names it", async ({ page }) => {
  // The owner's ask: "Also draw the airspace on the dry run as well". Out
  // of C81, under Chicago's Class B, to Madison's Class C.
  await page.goto("/app/plan?dep=C81&dest=KMSN");
  await settle(page);
  await openPanel(page);
  const side = sideDrawer(page).getByTestId("mini-profile-airspace");
  await expect(side.first()).toBeVisible({ timeout: slow(60_000) });
  const names = (await side.allTextContents()).map(t => t.trim()).sort();
  expect(names.some(n => n.startsWith("KMSN "))).toBe(true);

  await sideDrawer(page).getByTestId("dry-run-start").click();
  const run = sideDrawer(page).getByTestId("dry-run");
  // Each piece drawn, and each name once, as the side view had them (the
  // chart's only labels: recharts draws them in a layer of their own).
  await expect.poll(() => run.locator(".recharts-reference-area").count(), { timeout: slow(10_000) }).toBeGreaterThanOrEqual(names.length);
  const drawn = async () => (await run.locator(".recharts-label").allTextContents()).map(t => t.trim()).sort();
  await expect.poll(drawn).toEqual(names);
  // Inside the chart, its ends' names too.
  const chart = (await run.locator(".recharts-surface").boundingBox())!;
  for (const box of await run.locator(".recharts-label").evaluateAll(els => els.map(el => {
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right };
  }))) {
    expect(box.left).toBeGreaterThanOrEqual(chart.x - 1);
    expect(box.right).toBeLessThanOrEqual(chart.x + chart.width + 1);
  }
});

test("the dry run waits for the legs: its button dimmed until they are all in, and then it flies", async ({ page }) => {
  // A tap before the legs had streamed in did nothing (the side view is
  // drawn before them): seen as the phone's run of this spec tapped it.
  let release!: () => void;
  const held = new Promise<void>(done => { release = done; });
  await page.route(url => url.pathname.endsWith("/planner/navlog"), async route => {
    await held;
    await route.continue();
  });
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  await openPanel(page);
  const start = sideDrawer(page).getByTestId("dry-run-start");
  await expect(start).toBeVisible({ timeout: slow(60_000) });
  await expect(start).toBeDisabled();
  release();
  await expect(start).toBeEnabled({ timeout: slow(60_000) });
  await start.click();
  await expect(page.locator('[data-own-ship="on"]')).toHaveCount(1);
});

/** Own ship's marker, on screen. */
async function shipAt(page: Page) {
  const box = (await page.locator(".leaflet-marker-icon").filter({ has: page.locator('[data-own-ship="on"]') }).last().boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** The middle of what the panel leaves of the map: above a phone's sheet,
 *  beside a desktop's card out, under it at rest. */
async function middleOfMap(page: Page) {
  const viewport = page.viewportSize()!;
  const sheet = (await sideDrawer(page).boundingBox())!;
  if (viewport.width < 768) return { x: viewport.width / 2, y: sheet.y / 2 };
  return (await sideDrawer(page).getAttribute("data-panel")) !== "peek"
    ? { x: (sheet.x + sheet.width + viewport.width) / 2, y: viewport.height / 2 }
    : { x: viewport.width / 2, y: (sheet.y + sheet.height + viewport.height) / 2 };
}

test("the dry run's airplane is brought back to the middle of what the panel leaves as the sheet goes down and up, after a pan too", async ({ page }) => {
  // The owner's notice: "during dry run map should adjust as well to the
  // pill and half card".
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  await openPanel(page);
  const start = sideDrawer(page).getByTestId("dry-run-start");
  await expect(start).toBeVisible({ timeout: slow(60_000) });
  await start.click();
  await expect(page.locator('[data-own-ship="on"]')).toHaveCount(1);
  // Panned by hand, off the middle: the map no longer follows it.
  const viewport = page.viewportSize()!;
  const from = { x: viewport.width < 768 ? viewport.width / 2 : viewport.width * 0.75, y: 150 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x - 90, from.y - 60, { steps: 8 });
  await page.mouse.up();
  const inTheMiddle = async () => {
    await settled(sideDrawer(page));
    await expect(async () => {
      const at = await shipAt(page), middle = await middleOfMap(page);
      expect(Math.abs(at.x - middle.x)).toBeLessThan(40);
      expect(Math.abs(at.y - middle.y)).toBeLessThan(40);
    }).toPass({ timeout: slow(10_000) });
  };
  await grabberTo(page, "peek");
  await inTheMiddle();
  await grabberTo(page, "half");
  await inTheMiddle();
});

test("half way the side view is whole, its dry run plays under the route's chips, and stays still as the sheet is dragged up", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) >= 768, "a phone's sheet");
  // The owner's asks: "Let's make the half card this tall. This way we
  // won't have to hide the buttons for dry run"; "the dry run drags up
  // instead of staying still like the profile".
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  await grabberTo(page, "half");
  const panel = sideDrawer(page);
  const start = panel.getByTestId("dry-run-start");
  await expect(start).toBeVisible({ timeout: slow(60_000) });
  // The side view at its ten rem, nothing of it given way.
  const side = start.locator("xpath=ancestor::*[@data-pill-hides][1]");
  expect((await side.boundingBox())!.height).toBeGreaterThanOrEqual(159);
  // The chart's level as the route was fitted, a quarter level at that:
  // the run follows its airplane at it, the chart not drawn again at the
  // whole level beside it (the owner's "When tapping play for a dry run,
  // the map seems to reload").
  const level = () => page.evaluate(() => [...document.querySelectorAll<HTMLElement>(".leaflet-tile-container")]
    .filter(c => c.querySelector(".leaflet-tile-loaded")).map(c => c.style.transform.match(/scale\(([\d.]+)\)/)?.[1] ?? "1").join());
  await settled(panel);
  const fitted = await level();
  await start.click();
  const run = panel.getByTestId("dry-run");
  await expect(run).toBeVisible();
  await expect(panel.getByTestId("route-brief")).toBeVisible();
  await page.waitForTimeout(1500);
  expect(await level()).toBe(fitted);
  // Dragged up and held: the run where it was and its size, the nav log
  // coming out over it.
  await settled(panel);
  const before = (await run.boundingBox())!;
  const grabber = (await page.getByTestId("sidebar-trigger-button").boundingBox())!;
  await page.mouse.move(grabber.x + grabber.width / 2, grabber.y + grabber.height / 2);
  await page.mouse.down();
  await page.mouse.move(grabber.x + grabber.width / 2, grabber.y + grabber.height / 2 - 150, { steps: 12 });
  await expect.poll(async () => (await panel.getByTestId("navlog-scroller").boundingBox())?.height ?? 0).toBeGreaterThan(100);
  const held = (await run.boundingBox())!;
  expect(Math.abs(held.y - before.y)).toBeLessThan(2);
  expect(Math.abs(held.height - before.height)).toBeLessThan(2);
  await page.mouse.up();
});

test("all the way up the dry run plays at the foot under the nav log, the row it is flying to tinted and kept in sight", async ({ page }) => {
  // The owner's asks: "I wanna be able to do the dry run with navlog in
  // full fpl"; "keep the profile at the bottom as you pull up the
  // scrollable navlog".
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  await grabberTo(page, "full");
  await openTab(page, "Nav Log");
  const panel = sideDrawer(page);
  const start = panel.getByTestId("dry-run-start");
  await expect(start).toBeVisible({ timeout: slow(60_000) });
  await start.click();
  // Its chart in the side view's place, the nav log still over it.
  await expect(panel.getByTestId("dry-run")).toBeVisible();
  await expect(panel.getByTestId("navlog-scroller").locator('[data-title="Legs"]')).toBeVisible();
  // Held, and stepped along the course from its chart, five miles a key:
  // the tinted row moves on with it, in sight.
  await panel.getByTestId("dry-run-play").click();
  const flying = panel.locator('[role="row"][data-flying]');
  await expect(flying).toHaveCount(1);
  const place = () => flying.evaluate(row => [...row.closest('[role="table"]')!.querySelectorAll('[role="row"][data-kind]')].indexOf(row));
  const first = await place();
  await panel.getByTestId("dry-run-scrub").focus();
  for (let i = 0; i < 12; i++) await page.keyboard.press("ArrowRight");
  await expect.poll(place, { timeout: slow(10_000) }).toBeGreaterThan(first);
  await expect(flying).toBeInViewport();
});

// Duluth's RNAV (GPS) RWY 27 via PLANE as the planner draws it
// (vfr.procedures, the 2026-10 cycle), stubbed: the FAA's file is not read
// on CI's runner. From PLANE, south-east of the field, north to HOMUV, and
// west down its final through CIRUS to the runway.
const R27 = {
  airport: "KDLH", kind: "approach", id: "R27", name: "RNAV (GPS) RWY 27", transition: "PLANE", cycle: "261001", stale: false,
  lines: [
    { role: "transition", name: "PLANE", points: [[46.733597, -91.910758], [46.833461, -91.904417]] },
    { role: "final", name: null, points: [[46.833461, -91.904417], [46.837675, -92.048269], [46.841361, -92.180119]] },
    { role: "missed", name: null, points: [[46.841361, -92.180119], [46.842746, -92.228777], [46.849967, -92.511453]] },
  ],
  holds: [],
  fixes: [
    { ident: "PLANE", lat: 46.733597, lon: -91.910758, roles: ["IAF"], min_ft: null, max_ft: null, speed_kt: null, missed: false },
    { ident: "HOMUV", lat: 46.833461, lon: -91.904417, roles: ["IF", "FACF"], min_ft: 4000, max_ft: null, speed_kt: null, missed: false },
    { ident: "CIRUS", lat: 46.837675, lon: -92.048269, roles: ["FAF"], min_ft: 3200, max_ft: null, speed_kt: null, missed: false },
    { ident: "RW27", lat: 46.841361, lon: -92.180119, roles: ["MAP"], min_ft: null, max_ft: null, speed_kt: null, missed: false },
    { ident: "UDTEG", lat: 46.849967, lon: -92.511453, roles: ["hold"], min_ft: 3300, max_ft: null, speed_kt: null, missed: true },
  ],
};

test("with an approach picked, the dry run flies it into the field: out to its first fix and down its final", async ({ page }) => {
  // The owner's notice: "Dry run is not following approach when selected".
  await page.route(url => /\/airport\/KDLH\/procedures\/R27$/.test(url.pathname), route => route.fulfill({ json: R27 }));
  await page.goto("/app/plan?dep=C81&dest=KDLH&procs=KDLH:R27:PLANE");
  await settle(page);
  await openPanel(page);
  const start = sideDrawer(page).getByTestId("dry-run-start");
  await expect(start).toBeVisible({ timeout: slow(60_000) });
  // The approach drawn, so in hand as the run starts.
  await expect(page.locator('[data-procedure-fix="CIRUS"]')).toHaveCount(1, { timeout: slow(10_000) });
  await start.click();
  await expect(page.locator('[data-own-ship="on"]')).toHaveCount(1);
  // Held at its end, then ten miles back: on the final, between HOMUV and
  // CIRUS -- where straight in it was still south-east of the field.
  const panel = sideDrawer(page);
  await panel.getByTestId("dry-run-play").click();
  const scrub = panel.getByTestId("dry-run-scrub");
  const box = (await scrub.boundingBox())!;
  await page.mouse.click(box.x + box.width - 2, box.y + box.height / 2);
  await expect(scrub).toHaveAttribute("aria-valuenow", (await scrub.getAttribute("aria-valuemax"))!);
  await scrub.focus();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  const fixAt = async (ident: string) => {
    const b = (await page.locator(`[data-procedure-fix="${ident}"]`).boundingBox())!;
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };
  await expect(async () => {
    const ship = await shipAt(page), from = await fixAt("HOMUV"), to = await fixAt("CIRUS");
    // HOMUV to CIRUS is 5.9 nm: the ship within half a mile of the line
    // between them, and between them along it.
    const dx = to.x - from.x, dy = to.y - from.y, length = Math.hypot(dx, dy);
    const along = ((ship.x - from.x) * dx + (ship.y - from.y) * dy) / (length * length);
    const off = Math.abs((ship.x - from.x) * dy - (ship.y - from.y) * dx) / length;
    expect(along).toBeGreaterThan(0);
    expect(along).toBeLessThan(1);
    expect(off).toBeLessThan((length / 5.9) * 0.5);
  }).toPass({ timeout: slow(10_000) });
});
