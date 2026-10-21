import { test, expect, type Page } from "@playwright/test";
import { grabberTo, navLogSheet, openNavLog, openPanel, openProfile, closeProfile, openTab, settle, settled, sideDrawer, slow } from "./helpers";

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
  await openProfile(page);
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
  // Each tap goes out to the route and back in on the airplane (the
  // owner's "toggling the zoom in and out is not working"): the base
  // chart's level in use, its top tile container's.
  const level = () => page.evaluate(() => {
    const levels = [...document.querySelectorAll<HTMLElement>(".leaflet-tile-pane .leaflet-layer:nth-child(2) .leaflet-tile-container")];
    const top = levels.reduce<HTMLElement | null>((t, c) => (!t || Number(c.style.zIndex) > Number(t.style.zIndex) ? c : t), null);
    return Number(top?.querySelector<HTMLImageElement>("img.leaflet-tile")?.src.match(/\/(\d+)\/\d+\/\d+/)?.[1] ?? NaN);
  });
  const arrow = page.locator("[data-map-controls]").getByTestId("my-position-button");
  await expect(arrow).toHaveAttribute("data-face", "route");
  await expect(arrow).toHaveAccessibleName("Show the whole route");
  await expect.poll(level, { timeout: slow(10_000) }).toBe(10);
  await arrow.click();
  await expect(arrow).toHaveAttribute("data-face", "position");
  await expect(arrow).toHaveAccessibleName("Follow the airplane");
  await expect.poll(level, { timeout: slow(10_000) }).toBeLessThan(10);
  await arrow.click();
  await expect(arrow).toHaveAttribute("data-face", "route");
  await expect.poll(level, { timeout: slow(10_000) }).toBe(10);
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
  await openProfile(page);
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

test("the dry run waits for the legs: no way to it until the plan is in, and then it flies", async ({ page }) => {
  // A tap before the legs had streamed in did nothing (the side view is
  // drawn before them): seen as the phone's run of this spec tapped it.
  // The Profile card, where the dry run is, opens from the altitude's
  // button, which shows only once there is a plan (the owner's ask: "profile
  // button only shows with an altitude there"), so with the plan held back
  // there is no way to the run at all.
  let release!: () => void;
  const held = new Promise<void>(done => { release = done; });
  await page.route(url => url.pathname.endsWith("/planner/navlog"), async route => {
    await held;
    await route.continue();
  });
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  await openPanel(page);
  await expect(sideDrawer(page).getByTestId("altitude-group")).toBeVisible({ timeout: slow(60_000) });
  await expect(sideDrawer(page).getByTestId("altitude-why")).toHaveCount(0);
  release();
  await openProfile(page);
  const start = sideDrawer(page).getByTestId("dry-run-start");
  await expect(start).toBeEnabled({ timeout: slow(60_000) });
  await start.click();
  await expect(page.locator('[data-own-ship="on"]')).toHaveCount(1);
});

test("the dry run keeps the flight's own figures at the foot, counting down from where the airplane is", async ({ page }) => {
  // The owner's "Dry run should keep the calculations as in the profile":
  // To, Dist, ETE and Fuel, their taps the same, where the run had its own
  // (Dist left, Time left, ETA, To burn).
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  await openPanel(page);
  await openProfile(page);
  const start = sideDrawer(page).getByTestId("dry-run-start");
  await expect(start).toBeEnabled({ timeout: slow(60_000) });
  const line = sideDrawer(page).getByTestId("flight-line");
  const planned = await line.locator("dt").allTextContents();
  expect(planned).toEqual(["To", "Dist", "ETE", "Fuel"]);
  const plannedNm = parseFloat(await line.locator("dd").nth(1).innerText());

  await start.click();
  const figures = sideDrawer(page).getByTestId("dry-run-figures");
  await expect(figures.locator("dt")).toHaveText(planned);
  await expect(figures.getByTestId("navlog-to")).toHaveText("KDLH");
  await expect(figures.getByTestId("ete-eta-toggle")).toBeVisible();
  await expect(figures.getByTestId("fuel-breakdown-open")).toBeVisible();
  const leftNm = async () => parseFloat(await figures.locator("dd").nth(1).innerText());
  expect(await leftNm()).toBeLessThanOrEqual(Math.ceil(plannedNm));
  await expect.poll(leftNm, { timeout: slow(15_000) }).toBeLessThan(plannedNm - 1);
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
  await openProfile(page);
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

test("half way a dry run started from the profile's card plays in the card, in on its airplane", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) >= 768, "a phone's sheet");
  // The owner's asks: "Let's make the half card this tall. This way we
  // won't have to hide the buttons for dry run"; "the dry run drags up
  // instead of staying still like the profile".
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  await grabberTo(page, "half");
  const panel = sideDrawer(page);
  await openProfile(page);
  const start = panel.getByTestId("dry-run-start");
  await expect(start).toBeVisible({ timeout: slow(60_000) });
  // The finest sectional level drawn (the coarse one kept under the map,
  // ChartTiles, aside): the route's as it was fitted, then on play the
  // dry run's, in on its airplane, smoothly (the owner's "When play is
  // pressed it should also zoom into plane on the route").
  const level = () => page.evaluate(() => Math.max(0, ...[...document.querySelectorAll<HTMLImageElement>('img.leaflet-tile[src*="/sec/"]')]
    .map(tile => Number(tile.src.match(/\/sec\/(\d+)\//)?.[1] ?? NaN)).filter(Number.isFinite)));
  await settled(panel);
  const fitted = await level();
  await start.click();
  // In the card, in the side view's place (the owner's "profile should play
  // the dry run within profile card").
  const run = page.getByTestId("profile-card").getByTestId("dry-run");
  await expect(run).toBeVisible();
  expect(fitted).toBeLessThan(10);
  await expect.poll(level, { timeout: slow(10_000) }).toBe(10);
});

test("the profile is a card from its button beside the nav log's, no swipe at the foot; a dry run started there plays over the route, and stopped, the card is back", async ({ page }) => {
  // The owner's ask (2026-10-20): "profile view can move next to the
  // navlog button and open like brief and navlog opens instead of the
  // swipe"; and before, "When stopping dry run it should become profile
  // view".
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  await grabberTo(page, "half");
  const panel = sideDrawer(page);
  await expect(panel.getByTestId("procedures")).toBeVisible({ timeout: slow(60_000) });
  await expect(panel.getByTestId("foot-pager")).toHaveCount(0);
  await expect(panel.getByTestId("mini-profile")).toHaveCount(0);
  // No button of its own beside the nav log's (the owner, 2026-10-20):
  // the altitude's opens it, the card's name and the route under it.
  await expect(panel.getByTestId("route-profile")).toHaveCount(0);
  const card = await openProfile(page);
  await expect(card.getByTestId("profile-name")).toHaveText("C81 → KDLH");
  await expect(card.getByTestId("mini-profile")).toBeVisible();
  // Flown in the card, in the side view's place (the owner's "profile
  // should play the dry run within profile card"); stopped, the side view
  // again.
  const start = card.getByTestId("dry-run-start");
  await expect(start).toBeEnabled({ timeout: slow(60_000) });
  await start.click();
  await expect(card.getByTestId("dry-run")).toBeVisible();
  await expect(card.getByTestId("mini-profile")).toHaveCount(0);
  await card.getByTestId("dry-run-close").click();
  await expect(card.getByTestId("mini-profile")).toBeVisible();
  // Its close: FPL's route again.
  await closeProfile(page);
  await expect(panel.getByTestId("procedures")).toBeVisible();
});

test("all the way up the dry run plays at the foot under the route, and the nav log's sheet follows it, the row it is flying to tinted and kept in sight", async ({ page }) => {
  // The owner's asks: "I wanna be able to do the dry run with navlog in
  // full fpl"; "keep the profile at the bottom as you pull up the
  // scrollable navlog"; then the nav log a sheet of its own ("Only stops
  // in the route box and separate navlog").
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  await grabberTo(page, "full");
  await openTab(page, "Nav Log");
  const panel = sideDrawer(page);
  await openProfile(page);
  const start = panel.getByTestId("dry-run-start");
  await expect(start).toBeVisible({ timeout: slow(60_000) });
  await start.click();
  await expect(panel.getByTestId("dry-run")).toBeVisible();
  await expect(panel.getByTestId("dry-run-play")).toBeVisible();
  // The card put away, the run at the sheet's foot under the route; the
  // nav log opened from the route's box: the tinted row moves on with the
  // run, in sight.
  await closeProfile(page);
  await expect(panel.getByTestId("dry-run")).toBeVisible();
  await expect(panel.getByTestId("navlog-scroller").locator('[data-title="Legs"]')).toBeVisible();
  await openNavLog(page);
  const flying = navLogSheet(page).locator('[role="row"][data-flying]');
  await expect(flying).toHaveCount(1, { timeout: slow(10_000) });
  const place = () => flying.evaluate(row => [...row.closest('[role="table"]')!.querySelectorAll('[role="row"][data-kind]')].indexOf(row));
  const first = await place();
  await expect.poll(place, { timeout: slow(20_000) }).toBeGreaterThan(first);
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
  await openProfile(page);
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

  // No from the start (the chart's drag takes the run back), and Go
  // missed on the final only (the owner's "I don't think we need the
  // replay button, instead just show a go missed button when on the final
  // of the approach"): not here, before the final approach fix; five
  // miles on, inside CIRUS on the final, there. Pressed, the run goes on
  // past the runway along the missed approach and ends at its hold's fix,
  // UDTEG, where it ended at the runway.
  await expect(panel.getByTestId("dry-run-again")).toHaveCount(0);
  const missed = panel.getByTestId("dry-run-missed");
  await expect(missed).toHaveCount(0);
  await page.keyboard.press("ArrowRight");
  await expect(missed).toBeVisible();
  await missed.click();
  await expect(missed).toHaveCount(0);
  await page.mouse.click(box.x + box.width - 2, box.y + box.height / 2);
  await expect(async () => {
    const ship = await shipAt(page), udteg = await fixAt("UDTEG");
    expect(Math.hypot(ship.x - udteg.x, ship.y - udteg.y)).toBeLessThan(12);
  }).toPass({ timeout: slow(10_000) });
});
