import { test, expect } from "@playwright/test";
import { slow, settle, openTab, openSection } from "./helpers";

/**
 * The Brief's Passengers: 14 CFR 91.107's briefing ticked off for the
 * flight, and the flight sent to the passengers in a few lines.
 */
test("the passengers are briefed as 91.107 asks, and sent the flight", async ({ page, context }) => {
  test.slow();
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.addInitScript(() => {
    const kept = JSON.parse(localStorage.getItem("vfr.preferences") ?? '{"state":{},"version":0}');
    localStorage.setItem("vfr.preferences", JSON.stringify({ ...kept, state: { ...kept.state, waypoints: false } }));
  });
  await page.goto("/app/plan?dep=KMSN&dest=KOSH");
  await settle(page);
  await page.getByTestId("sidebar-trigger-button").click();
  await openTab(page, "Brief");
  await openSection(page, "Passengers");
  const section = page.getByTestId("passengers");
  await expect(section).toContainText("14 CFR 91.107(a)(1)");
  await section.getByTestId("passenger-pax-belts").click();
  await expect(section.getByTestId("passenger-pax-belts")).toHaveAttribute("aria-checked", "true");
  await expect(section).toContainText("Brief them · 1 of 5");
  // Sent once the nav log has the time in the air.
  await expect(section).toContainText("in the air", { timeout: slow(90000) });
  await section.getByTestId("passenger-send").click();
  await expect(section.getByTestId("passenger-send")).toHaveText("Copied");
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text.split("\n")[0]).toMatch(/^KMSN to .*\(KOSH\)$|^KMSN to KOSH$/);
  expect(text).toContain("in the air");
});
