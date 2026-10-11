import { test, expect } from "@playwright/test";
import { slow, settle, openTab, openSection } from "./helpers";

/**
 * The Brief tab's Flight Plan: the FAA's form (FAA Form 7233-4) filled in
 * from the plan, item by item as AIM Appendix 4 writes each, to copy into
 * a filing service, with Flight Service's site beside it. Under IFR (the
 * airway between its fixes, the alternate) it is ifr.spec's, on the
 * routes it plans already.
 */

test("under VFR the flight plan flies direct, with no alternate, and says where to file it", async ({ page, context }) => {
  test.slow();
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.addInitScript(() => {
    const kept = JSON.parse(localStorage.getItem("vfr.preferences") ?? '{"state":{},"version":0}');
    localStorage.setItem("vfr.preferences", JSON.stringify({ ...kept, state: { ...kept.state, flightRules: "vfr", waypoints: false } }));
  });
  await page.goto("/app/plan?dep=KMSN&dest=KOSH");
  await settle(page);
  await page.getByTestId("sidebar-trigger-button").click();
  await openTab(page, "Brief");
  await openSection(page, "Flight Plan");
  const form = page.getByTestId("flight-plan");
  await expect(form.getByTestId("flight-plan-eet")).toContainText(/\d{4}/, { timeout: slow(90000) });
  await expect(form.getByTestId("flight-plan-rules")).toContainText("VFR");
  await expect(form.getByTestId("flight-plan-route")).toContainText("DCT");
  await expect(form.getByTestId("flight-plan-level")).toContainText(/A0\d{2}/);
  await expect(form.getByTestId("flight-plan-alternate")).toHaveCount(0);
  await expect(form.getByTestId("flight-plan-file")).toHaveAttribute("href", "https://www.1800wxbrief.com");
  await expect(form).toContainText("5-1-14");
  // The whole form, an item to a line.
  await form.getByTestId("flight-plan-copy").click();
  await expect(form.getByTestId("flight-plan-copy")).toHaveText("Copied");
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text.split("\n").slice(0, 2)).toEqual(["KMSN to KOSH", "8 Flight rules: VFR"]);
  expect(text).toContain("15 Route: DCT");
});
