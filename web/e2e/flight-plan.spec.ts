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

test("where Flight Service is connected, the form is filed from here in the pilot's name", async ({ page }) => {
  test.slow();
  const filed: Record<string, unknown>[] = [];
  await page.route(url => url.pathname === "/api/flight-service", route => route.fulfill({ json: { connected: true, provider: "test" } }));
  await page.route(url => url.pathname === "/api/flight-service/flight-plans", async route => {
    filed.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({ status: 201, json: { reference: "FP-123" } });
  });
  await page.addInitScript(() => {
    const kept = JSON.parse(localStorage.getItem("vfr.preferences") ?? '{"state":{},"version":0}');
    localStorage.setItem("vfr.preferences", JSON.stringify({ ...kept, state: { ...kept.state, flightRules: "vfr", waypoints: false,
      aircraft: { profile: "c172", label: "N12345 · C172", aircraftId: 5, cruiseTasKt: 110, fuelBurnGph: 8.5, usableFuelGal: 40 } } }));
  });
  const depart = new Date(Math.ceil(Date.now() / 3600_000 + 3) * 3600_000).toISOString();
  await page.goto(`/app/plan?dep=KMSN&dest=KOSH&depart=${encodeURIComponent(depart)}`);
  await settle(page);
  await page.getByTestId("sidebar-trigger-button").click();
  await openTab(page, "Brief");
  await openSection(page, "Flight Plan");
  const form = page.getByTestId("flight-plan");
  const fileIt = form.getByTestId("flight-plan-file-fss");
  await expect(fileIt).toBeEnabled({ timeout: slow(90000) });
  await fileIt.click();
  await expect(fileIt).toContainText("Filed with Flight Service");
  await expect(fileIt).toContainText("Reference FP-123");
  expect(filed[0]).toMatchObject({ rules: "VFR", aircraftId: "N12345", aircraftType: "C172", departure: "KMSN", destination: "KOSH" });
});
