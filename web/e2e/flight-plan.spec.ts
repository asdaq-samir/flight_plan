import { test, expect } from "@playwright/test";
import { slow, settle, openTab, openSection, openConsole } from "./helpers";

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
  // Open as you leave and close when you land, on the row that files it
  // (AIM 5-1-5, 5-1-14), where it was a footnote.
  await expect(form.getByTestId("flight-plan-file")).toContainText("close it when you land");
  // The whole form, an item to a line.
  await form.getByTestId("flight-plan-copy").click();
  await expect(form.getByTestId("flight-plan-copy")).toHaveText("Copied");
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text.split("\n").slice(0, 2)).toEqual(["KMSN to KOSH", "Item 8  Flight rules: VFR"]);
  expect(text).toContain("Item 15  Route: DCT");
});

test("items 10 and 19 come from the airplane's page, the pilot's and the persons typed, and Open in 1800wxbrief copies the form", async ({ page, context }) => {
  test.slow();
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  // The pilot's own airplane, with its flight plan's items, and the
  // pilot's name, number and home base.
  await page.route(url => url.pathname === "/api/aircraft", route => route.fulfill({ json: [{
    id: 5, tailNumber: "N12345", typeDesignator: "C172", cruiseTasKt: 110, fuelBurnGph: 8.5, cruisePowerPct: null,
    climbTasKt: null, climbFuelBurnGph: null, usableFuelGal: 40, createdAt: "2026-10-01T00:00:00Z", vorCheck: null,
    inspections: {}, openSquawks: [], equipment: "SDFGRY", surveillance: "B1", colour: "White blue stripes",
  }] }));
  await page.route(url => url.pathname === "/api/me", async route => {
    const me = await (await route.fetch()).json() as Record<string, unknown>;
    await route.fulfill({ json: { ...me, fullName: "Avery B. Pilot", phone: "608-555-0100", homeBase: "KMSN" } });
  });
  await page.addInitScript(() => {
    const kept = JSON.parse(localStorage.getItem("vfr.preferences") ?? '{"state":{},"version":0}');
    localStorage.setItem("vfr.preferences", JSON.stringify({ ...kept, state: { ...kept.state, flightRules: "vfr", waypoints: false,
      aircraft: { profile: "c172", label: "N12345 · C172", aircraftId: 5, cruiseTasKt: 110, fuelBurnGph: 8.5, usableFuelGal: 40 } } }));
  });
  await page.goto("/app/plan?dep=KMSN&dest=KOSH");
  await settle(page);
  await page.getByTestId("sidebar-trigger-button").click();
  await openTab(page, "Brief");
  await openSection(page, "Flight Plan");
  const form = page.getByTestId("flight-plan");
  await expect(form.getByTestId("flight-plan-eet")).toContainText(/\d{4}/, { timeout: slow(90000) });
  await expect(form.getByTestId("flight-plan-equipment")).toContainText("SDFGRY");
  await expect(form.getByTestId("flight-plan-surveillance")).toContainText("B1");
  await expect(form.getByTestId("flight-plan-colour")).toContainText("White blue stripes");
  await expect(form.getByTestId("flight-plan-pilot")).toContainText("Avery B. Pilot, 608-555-0100, home base KMSN");
  // The persons on board start blank, the flight's own to type.
  const persons = form.getByTestId("flight-plan-persons");
  await expect(persons).toHaveValue("");
  await persons.fill("2");
  // The form copied as the site opens in a new tab, to paste in: the
  // FAA's site answered here, not asked.
  await context.route(url => url.hostname === "www.1800wxbrief.com", route => route.fulfill({ contentType: "text/html", body: "<title>1800wxbrief</title>" }));
  const opened = context.waitForEvent("page");
  await form.getByTestId("flight-plan-open-wx").click();
  const wx = await opened;
  await wx.waitForURL(url => url.hostname === "www.1800wxbrief.com");
  await wx.close();
  await expect(form.getByTestId("flight-plan-open-wx")).toContainText("Copied");
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toContain("Item 10a  Equipment: SDFGRY");
  expect(text).toContain("Item 10b  Surveillance: B1");
  expect(text).toContain("Item 19  Persons on board: 2");
  expect(text).toContain("Item 19  Color and markings: White blue stripes");
  expect(text).toContain("Item 19  Pilot in command: Avery B. Pilot, 608-555-0100, home base KMSN");
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
  expect(filed[0]).toMatchObject({ rules: "VFR", aircraftId: "N12345", aircraftType: "C172/L", departure: "KMSN", destination: "KOSH" });
});

test("the pilot's number and home base are set in Setup's Pilot details, and a wrong one is said under its label", async ({ page }) => {
  const sent: Record<string, unknown>[] = [];
  await page.route(url => url.pathname === "/api/me/contact", async route => {
    const body = route.request().postDataJSON() as { phone: string; homeBase: string };
    sent.push(body);
    const me = await (await page.request.get("/api/me")).json() as Record<string, unknown>;
    await route.fulfill({ json: { ...me, phone: body.phone || null, homeBase: body.homeBase.toUpperCase() || null } });
  });
  await page.goto("/app/plan");
  await settle(page);
  await openConsole(page);
  const setup = page.getByTestId("console-sheet").getByTestId("setup-page");
  await setup.getByTestId("pilot-row").click();
  const details = page.getByRole("region", { name: "Pilot details" });
  await details.getByTestId("pilot-phone").fill("call me");
  await expect(details.getByText("Figures, spaces and + ( ) - . only")).toBeVisible();
  await details.getByTestId("pilot-phone").fill("608-555-0100");
  await details.getByTestId("pilot-home-base").fill("kmsn");
  await details.getByTestId("pilot-phone").focus();
  await expect.poll(() => sent.at(-1)).toEqual({ phone: "608-555-0100", homeBase: "kmsn" });
  // A save still on its way as the test ends (a field left as the page
  // closes) reads /api/me with the page gone.
  await page.unrouteAll({ behavior: "ignoreErrors" });
});
