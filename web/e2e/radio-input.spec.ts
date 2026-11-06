import { test, expect, type Page } from "@playwright/test";
import { settle, slow } from "./helpers";

/**
 * The input the radio is heard through, chosen in the Radio card's Hear
 * row (Listen through, lib/audioInput): the owner asked whether the mic
 * can "tune into a frequency" and said "Bluetooth is fine" (2026-11-04),
 * so the radio comes to the phone from the audio panel as an input. The
 * browser's devices are stand-ins, as Safari gives them: one input with
 * no name until a capture is granted, then "iPhone Microphone" and
 * "GMA 350c", each a real track from an oscillator whose loudness rises
 * and falls, for the meter to show. The recognizer is a stand-in that
 * keeps what each start() was handed.
 */
async function stubs(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    const present = [{ id: "iphone", label: "iPhone Microphone" }, { id: "gma", label: "GMA 350c" }];
    let granted = false;
    const tracks: MediaStreamTrack[] = [];
    const starts: (string | null)[] = [];
    const devices = new EventTarget() as EventTarget & Record<string, unknown>;
    devices.enumerateDevices = async () => (granted
      ? present.map(d => ({ kind: "audioinput", deviceId: d.id, label: d.label, groupId: "g" }))
      : [{ kind: "audioinput", deviceId: "", label: "", groupId: "" }]);
    devices.getUserMedia = (constraints: { audio: { deviceId?: { exact: string } } }) => {
      // No device asked for: the route's own, the first.
      const id = constraints.audio.deviceId?.exact ?? present[0]!.id;
      const device = present.find(d => d.id === id);
      if (!device) return Promise.reject(Object.assign(new Error("gone"), { name: "OverconstrainedError" }));
      granted = true;
      // A tone whose loudness swings with a slow second oscillator.
      const ctx = new AudioContext();
      void ctx.resume();
      const tone = ctx.createOscillator();
      tone.frequency.value = 440;
      const loudness = ctx.createGain();
      loudness.gain.value = 0.5;
      const swing = ctx.createOscillator();
      swing.frequency.value = 0.7;
      const depth = ctx.createGain();
      depth.gain.value = 0.45;
      swing.connect(depth).connect(loudness.gain);
      const out = ctx.createMediaStreamDestination();
      tone.connect(loudness).connect(out);
      tone.start();
      swing.start();
      const track = out.stream.getAudioTracks()[0]!;
      Object.defineProperty(track, "label", { value: device.label, configurable: true });
      const settings = track.getSettings.bind(track);
      track.getSettings = () => ({ ...settings(), deviceId: device.id });
      tracks.push(track);
      return Promise.resolve(out.stream);
    };
    Object.defineProperty(navigator, "mediaDevices", { value: devices, configurable: true });
    w.__starts = starts;
    // The panel switched off: its capture ends and it is no longer listed.
    w.__panelGone = () => {
      present.splice(present.findIndex(d => d.id === "gma"), 1);
      for (const t of tracks.filter(t => t.label === "GMA 350c")) {
        t.stop();
        t.dispatchEvent(new Event("ended"));
      }
      devices.dispatchEvent(new Event("devicechange"));
    };
    class Heard {
      lang = ""; continuous = false; interimResults = false;
      onresult = null; onerror = null;
      onend: (() => void) | null = null;
      start(track?: MediaStreamTrack) { starts.push(track ? track.label : null); }
      stop() { setTimeout(() => this.onend?.(), 50); }
    }
    Object.assign(window, { SpeechRecognition: Heard, webkitSpeechRecognition: Heard });
  });
}

test("the Radio card finds the inputs, listens through the one picked with its level shown, and says when it is lost", async ({ page }) => {
  await stubs(page);
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  const mic = page.getByTestId("mic-circle");
  await expect(mic).toBeVisible({ timeout: slow(30000) });
  const placed = (await mic.boundingBox())!;

  // With a recognizer the mic listens once; stopped, its pill opens the
  // card. The page's first tap can land before its handlers are in.
  const pill = page.getByTestId("radio-pill");
  await expect(async () => {
    if (!(await pill.count())) await page.getByTestId("radio-button").click();
    await expect(pill).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: slow(20_000) });
  await page.getByTestId("radio-button").click();
  await expect(pill).toContainText("Nothing was heard", { timeout: slow(10_000) });
  await page.getByTestId("radio-pill-text").click();
  const card = page.getByTestId("clearance-card");
  await expect(card).toBeVisible({ timeout: slow(10_000) });

  // Hear is open with nothing heard: Find Inputs, its 44-point area
  // meeting the Hear row's foot, not lying over it (index.css's rule).
  const find = card.getByTestId("listen-find");
  await expect(find).toBeVisible();
  const row = (await card.getByTestId("clearance-row-hear").boundingBox())!;
  const findBox = (await find.boundingBox())!;
  const atRowFoot = await page.evaluate(([x, y]) => {
    const hit = document.elementFromPoint(x!, y!);
    return !!hit?.closest("[data-testid=clearance-row-hear]") && !hit.closest("[data-testid=listen-find]");
  }, [findBox.x + findBox.width / 2, row.y + row.height - 2]);
  expect(atRowFoot).toBe(true);
  // Its name on one line, not broken over two in a column too narrow.
  const name = (await card.getByTestId("listen-through").getByText("Listen through", { exact: true }).boundingBox())!;
  expect(name.height).toBeLessThan(findBox.height * 1.5);
  await find.click();
  const menu = card.getByTestId("listen-input");
  await expect(menu).toBeVisible({ timeout: slow(10_000) });
  await menu.click();
  await page.getByTestId("listen-input-option").filter({ hasText: "GMA 350c" }).click();
  const hearing = card.getByTestId("listen-hearing");
  await expect(hearing).toContainText("GMA 350c");
  // The guide under it (InputGuide, lib/audioGear): Garmin documents the
  // GMA 350c sending the radio over Bluetooth, so one line and no steps.
  const guide = card.getByTestId("input-guide");
  await expect(guide).toHaveText("Hears the radio");
  await expect(guide).toHaveAttribute("data-hears", "radio");
  await expect(card.getByTestId("input-guide-how")).toHaveCount(0);
  // The bars are the sound: their heights change as it swings.
  const middle = hearing.getByTestId("waveform").locator("span").nth(2);
  const heights = new Set<string>();
  await expect.poll(async () => {
    heights.add(await middle.evaluate(el => (el as HTMLElement).style.transform));
    return [...heights].filter(h => h !== "scaleY(0.4)").length;
  }, { timeout: slow(10_000), intervals: [250] }).toBeGreaterThan(2);

  // Listen: the captions name the input, and the recognizer was handed it.
  await card.getByTestId("clearance-toggle").click();
  const captions = page.getByTestId("radio-captions");
  await expect(captions).toContainText("Listening to the radio through GMA 350c…", { timeout: slow(10_000) });
  expect(await page.evaluate(() => (window as unknown as { __starts: (string | null)[] }).__starts.at(-1))).toBe("GMA 350c");

  // The panel switched off: the captions and the card, under the picker, say so.
  await page.evaluate(() => (window as unknown as { __panelGone: () => void }).__panelGone());
  const lost = "GMA 350c disconnected; hearing the default microphone";
  await expect(captions).toContainText(lost, { timeout: slow(10_000) });
  await expect(card.getByTestId("listen-problem")).toHaveText(lost);

  // Nothing moved: the mic is where it was. On a phone at the left of the
  // map's foot (map-mic.spec, the owner's "Move the mic back to the left
  // side, above the tabs", 2026-11-04), its pill grown to the right of it,
  // its height following the sheet's, which the Radio card raised; from
  // md up over the map's buttons at the right edge (the owner,
  // 2026-11-06), its pill grown to the left of it.
  const box = (await mic.boundingBox())!;
  const wide = page.viewportSize()!.width >= 768;
  expect(Math.abs(wide ? box.x + box.width - (placed.x + placed.width) : box.x - placed.x)).toBeLessThanOrEqual(1);
});
