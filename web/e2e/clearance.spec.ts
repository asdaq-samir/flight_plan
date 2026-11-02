import { test, expect } from "@playwright/test";
import { openPanel, settle, sideDrawer, slow } from "./helpers";

/**
 * A clearance into the route, from the map's microphone: the
 * browser here has no microphone, so it is typed as it was read, which
 * the card takes as well. Its items are shown -- the limit and the route
 * found as idents, the altitudes, the frequency and the code -- and only
 * Enter Route changes the plan: the route through Gopher (GEP), "then
 * as filed", and the expected altitude flown (AIM 4-4-3, 5-2-6).
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
  await expect(body.getByText("GEP", { exact: true })).toBeVisible({ timeout: slow(20_000) });
  await expect(body).toContainText("KDLH");
  await expect(body).toContainText("3,000 ft");
  await expect(body).toContainText("7,000 ft, 10 min after departure");
  await expect(body).toContainText("125.35");
  await expect(body).toContainText("4521");
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
    (window as unknown as Record<string, unknown>).webkitSpeechRecognition = Heard;
  });
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  await page.getByTestId("radio-button").click();
  const pill = page.getByTestId("radio-pill");
  await expect(pill).toContainText("climb and maintain five thousand", { timeout: slow(10_000) });
  // No card: the pill is the microphone's.
  await expect(page.getByTestId("clearance-card")).toHaveCount(0);
  const fly = pill.getByTestId("radio-fly");
  await expect(fly).toHaveText("Fly 5,000 ft", { timeout: slow(10_000) });
  await fly.click();
  await expect(page).toHaveURL(/altitude_ft=5000/);
  await expect(pill).toHaveCount(0);
});
