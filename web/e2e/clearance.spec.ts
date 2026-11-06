import { test, expect } from "@playwright/test";
import { openPanel, settle, sideDrawer, slow } from "./helpers";

/**
 * A clearance into the route, from the map's microphone: the
 * browser here has no microphone, so it is typed as it was read, which
 * the card takes as well, under its Hear row, open while there is
 * nothing yet. Its items are shown there -- the limit and the route
 * found as idents, the altitudes, the frequency and the code -- the
 * Enter row says what it would put in and Compare how that differs from
 * the route planned, and only Enter Route changes the plan: the route
 * through Gopher (GEP), "then as filed", and the expected altitude flown
 * (AIM 4-4-3, 5-2-6).
 */
test("a clearance read is shown in its items and entered as the route", async ({ page }) => {
  // A browser with no recognizer, as Firefox: the microphone opens the
  // card to type in.
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    delete w.SpeechRecognition;
    delete w.webkitSpeechRecognition;
  });
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  await openPanel(page);
  const box = sideDrawer(page).getByTestId("route-box");
  await page.getByTestId("radio-button").click();
  await page.getByTestId("clearance-text").fill(
    "Cessna one two three alpha bravo cleared to the Duluth airport via Gopher then as filed, climb and maintain three thousand, "
    + "expect seven thousand one zero minutes after departure, departure frequency one two five point three five, squawk four five two one",
  );
  const body = page.getByTestId("clearance-body");
  const hear = body.getByTestId("clearance-detail-hear");
  await expect(hear.getByText("GEP", { exact: true })).toBeVisible({ timeout: slow(20_000) });
  await expect(hear).toContainText("KDLH");
  await expect(hear).toContainText("Maintain 3,000 ft, expect 7,000 ft 10 min after departure");
  await expect(hear).toContainText("Departure 125.35");
  await expect(hear).toContainText("4521");
  await expect(body.getByTestId("clearance-state-hear")).toHaveText("Heard");
  // What Enter would put in, and how it differs from the route planned,
  // each on its row's one line; the differences under a tap.
  await expect(body.getByTestId("clearance-state-enter")).toHaveText("KDLH via GEP, fly 7,000 ft");
  await expect(body.getByTestId("clearance-state-compare")).toHaveText("1 difference");
  await body.getByTestId("clearance-row-compare").click();
  await expect(body.getByTestId("clearance-detail-compare")).toContainText("Differs from what you filed: adds GEP.");
  // Nothing in the plan until it is entered.
  expect(new URL(page.url()).searchParams.get("stops")).toBeNull();
  const enter = page.getByTestId("clearance-enter");
  await expect(enter).toBeEnabled();
  await enter.click();
  await expect(page).toHaveURL(/stops=GEP/, { timeout: slow(10_000) });
  await expect(page).toHaveURL(/altitude_ft=7000/);
  await expect(box).toContainText("GEP");
});

/**
 * The microphone used as Siri's is (the owner's pick, 2026-11-02): a tap
 * listens, the pill over the map typing the words; at the pause after
 * them, the chips of what was heard, and Fly flies its altitude. The
 * browser's recognizer is a stand-in saying one transmission.
 */
test("the microphone listens once into a pill, and its chip flies the altitude said", async ({ page }) => {
  await page.addInitScript(() => {
    class Heard {
      lang = ""; continuous = false; interimResults = false;
      onresult: ((e: unknown) => void) | null = null; onerror: ((e: unknown) => void) | null = null; onend: (() => void) | null = null;
      start() {
        const said = "November one two three alpha bravo climb and maintain five thousand";
        setTimeout(() => this.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: said.slice(0, 30) }], { isFinal: false })] }), 200);
        setTimeout(() => this.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: said }], { isFinal: true })] }), 500);
      }
      stop() { setTimeout(() => this.onend?.(), 50); }
    }
    // Both names: this Chromium has the unprefixed one as well.
    Object.assign(window, { SpeechRecognition: Heard, webkitSpeechRecognition: Heard });
  });
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  const pill = page.getByTestId("radio-pill");
  // The page's first tap can land before its handlers are in on a slow
  // load: tapped again until it listens.
  await expect(async () => {
    if (!(await pill.count())) await page.getByTestId("radio-button").click();
    await expect(pill).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: slow(20_000) });
  await expect(pill).toContainText("climb and maintain five thousand", { timeout: slow(10_000) });
  // No card: the pill is the microphone's.
  await expect(page.getByTestId("clearance-card")).toHaveCount(0);
  const fly = pill.getByTestId("radio-fly");
  await expect(fly).toHaveText("Fly 5,000 ft", { timeout: slow(10_000) });
  await fly.click();
  await expect(page).toHaveURL(/altitude_ft=5000/);
  await expect(pill).toHaveCount(0);
});

test("the pilot's own words are chips: the nearest airports and a timer", { tag: "@smoke" }, async ({ page }) => {
  await page.addInitScript(() => {
    class Heard {
      lang = ""; continuous = false; interimResults = false;
      onresult: ((e: unknown) => void) | null = null; onerror: ((e: unknown) => void) | null = null; onend: (() => void) | null = null;
      start() {
        setTimeout(() => this.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: "nearest airport and start the timer" }], { isFinal: true })] }), 300);
      }
      stop() { setTimeout(() => this.onend?.(), 50); }
    }
    Object.assign(window, { SpeechRecognition: Heard, webkitSpeechRecognition: Heard });
  });
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  const pill = page.getByTestId("radio-pill");
  await expect(async () => {
    if (!(await pill.count())) await page.getByTestId("radio-button").click();
    await expect(pill).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: slow(20_000) });
  await expect(pill).toContainText("nearest airport", { timeout: slow(10_000) });
  // The timer counts in the pill once started, and stays as the chips go.
  await pill.getByTestId("radio-timer").click();
  await expect(pill.getByTestId("radio-timer-time")).toContainText(/Timer 0:0\d/);
  // Nearest opens the list over Airport, and puts the words away.
  await pill.getByTestId("radio-nearest").click();
  await expect(page).toHaveURL(/[?&]near=1/);
  await expect(pill).toHaveCount(0);
});

test("with nothing heard the pill stays and says so until put away", async ({ page }) => {
  // A recognizer that hears nothing and ends, as Safari's does in a quiet
  // cockpit.
  await page.addInitScript(() => {
    class Quiet {
      onresult = null; onerror: ((e: unknown) => void) | null = null; onend: (() => void) | null = null;
      start() { setTimeout(() => { this.onerror?.({ error: "audio-capture" }); this.onend?.(); }, 300); }
      stop() { setTimeout(() => this.onend?.(), 50); }
    }
    Object.assign(window, { SpeechRecognition: Quiet, webkitSpeechRecognition: Quiet });
  });
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  const pill = page.getByTestId("radio-pill");
  await expect(async () => {
    if (!(await pill.count())) await page.getByTestId("radio-button").click();
    await expect(pill).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: slow(20_000) });
  await expect(pill).toContainText("No microphone could be used", { timeout: slow(10_000) });
  // Still there a while on.
  await page.waitForTimeout(3000);
  await expect(pill).toBeVisible();
  await pill.getByTestId("radio-pill-close").click();
  await expect(pill).toHaveCount(0);
});
