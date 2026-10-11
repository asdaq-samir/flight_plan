import { writeFileSync } from "node:fs";
import { test, type Page } from "@playwright/test";
import { noTips } from "./helpers";

/**
 * The nightly lab run for the speed trend (ci.yml, SpeedController): the
 * same steps a pilot takes, timed the same way every night on the same
 * kind of machine at a phone's speed (CPU 4x slower), so a change that
 * slows the app shows as a step in the developer console's Speed tab with
 * its commit. Each step three times and the median kept: single samples
 * of the same build spread by a fifth (the measure-speed skill).
 *
 *   open_app       navigation to the search bar on screen
 *   fly_here       a tap on Fly Here to the route's destination on screen
 *   map_settings,  a tap's Interaction to Next Paint (the Event Timing
 *   share_menu,    API's duration, what Chrome reports as INP)
 *   aircraft_menu
 *   zoom           the main thread's long tasks in the 1.5 s after a wheel
 *
 * Only when asked (SPEED_LAB=1), on the phone project; the medians go to
 * SPEED_LAB_OUT as JSON, and to the log.
 */
test.skip(!process.env.SPEED_LAB, "the speed lab runs nightly, when asked");
// A second try would only time a second night's worth: a failed one is
// a night with no figures.
test.describe.configure({ retries: 0 });
test.use({ geolocation: { latitude: 42.234, longitude: -87.988 }, permissions: ["geolocation"] });

const RUNS = 3;

async function probes(page: Page) {
  await page.addInitScript(noTips);
  await page.addInitScript(() => {
    const w = window as unknown as { __inp: { t: number; d: number }[]; __long: { t: number; d: number }[]; __search: number | null };
    w.__inp = []; w.__long = []; w.__search = null;
    new PerformanceObserver(list => {
      for (const e of list.getEntries() as PerformanceEventTiming[]) if (e.interactionId) w.__inp.push({ t: e.startTime, d: e.duration });
    }).observe({ type: "event", buffered: true, durationThreshold: 16 } as PerformanceObserverInit);
    new PerformanceObserver(list => { for (const e of list.getEntries()) w.__long.push({ t: e.startTime, d: e.duration }); })
      .observe({ type: "longtask", buffered: true });
    const look = () => {
      if (document.querySelector("[data-testid=search-airports]")) w.__search = performance.now();
      else requestAnimationFrame(look);
    };
    requestAnimationFrame(look);
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
}

const now = (page: Page) => page.evaluate(() => performance.now());

/** The slowest interaction since `from`: the step's INP. */
const inpSince = (page: Page, from: number) => page.evaluate(f => {
  const w = window as unknown as { __inp: { t: number; d: number }[] };
  return Math.max(0, ...w.__inp.filter(e => e.t >= f).map(e => e.d));
}, from);

const longSince = (page: Page, from: number) => page.evaluate(f => {
  const w = window as unknown as { __long: { t: number; d: number }[] };
  return w.__long.filter(e => e.t >= f).reduce((n, e) => n + e.d, 0);
}, from);

/** When `selector` is first on screen, by the page's clock, looked for
 *  every 16 ms: by timer rather than by frame, since a page the browser
 *  is not drawing for a moment has no frames and would wait for ever. */
const shownAt = (page: Page, selector: string) => page.evaluate(sel => new Promise<number>((resolve, reject) => {
  const until = performance.now() + 60_000;
  const look = () => {
    if (document.querySelector(sel)) resolve(performance.now());
    else if (performance.now() > until) reject(new Error(`no ${sel}`));
    else setTimeout(look, 16);
  };
  look();
}), selector);

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;

test("the nightly speed lab", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile", "measured as a phone");
  test.setTimeout(900_000);
  await probes(page);
  const taken: Record<string, number[]> = {};
  const keep = (name: string, value: number) => (taken[name] ??= []).push(Math.round(value));

  for (let run = 0; run < RUNS; run++) {
    // Opening the app, and the map's own steps on it.
    await page.goto("/app/plan");
    await page.getByTestId("search-airports").waitFor({ timeout: 60_000 });
    keep("open_app", await page.evaluate(() => (window as unknown as { __search: number }).__search));
    await page.locator("img.leaflet-tile").first().waitFor({ state: "attached", timeout: 60_000 });
    await page.waitForTimeout(3000);
    const map = (await page.locator(".leaflet-container").boundingBox())!;
    await page.mouse.move(map.x + map.width / 2, map.y + 250);
    let from = await now(page);
    await page.mouse.wheel(0, -300);
    await page.waitForTimeout(1500);
    keep("zoom", await longSince(page, from));
    from = await now(page);
    await page.locator("[data-map-controls]").getByTestId("map-settings-button").click();
    await page.getByTestId("map-settings").waitFor();
    await page.waitForTimeout(600);
    keep("map_settings", await inpSince(page, from));
    await page.keyboard.press("Escape");

    // A route by Fly Here from an airport's card.
    await page.goto("/app/plan?place=KRST");
    await page.getByTestId("fly-here").waitFor({ timeout: 60_000 });
    await page.waitForTimeout(3000);
    from = await now(page);
    await page.getByTestId("fly-here").click();
    keep("fly_here", (await shownAt(page, "[data-testid=route-dest]")) - from);

    // The route's own menus.
    await page.goto("/app/plan?dep=C81&dest=KDLH");
    await page.getByTestId("capsule-detail").click({ timeout: 60_000 });
    await page.locator("[data-testid=navlog-eta]").first().waitFor({ state: "attached", timeout: 90_000 });
    await page.waitForTimeout(3000);
    for (const [name, open, shown] of [
      ["share_menu", () => page.getByTestId("share-route").first().click(), "[role=menu]"],
      ["aircraft_menu", () => page.getByTestId("aircraft-select").click(), "[role=listbox]"],
    ] as const) {
      from = await now(page);
      await open();
      await page.locator(shown).first().waitFor();
      await page.waitForTimeout(600);
      keep(name, await inpSince(page, from));
      await page.keyboard.press("Escape");
      await page.waitForTimeout(800);
    }
  }

  const medians = Object.fromEntries(Object.entries(taken).map(([name, values]) => [name, median(values)]));
  console.log(`SPEED_LAB ${JSON.stringify(medians)} from ${JSON.stringify(taken)}`);
  if (process.env.SPEED_LAB_OUT) writeFileSync(process.env.SPEED_LAB_OUT, JSON.stringify(medians));
});
