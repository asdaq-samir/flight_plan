import { test, expect } from "@playwright/test";
import { slow, settle, openTab, openSection, controlsInSight, openNavLog, closeNavLog } from "./helpers";

/**
 * Planning under IFR (the planner's vfr.ifr): the flight rules are the
 * altitude popover's first choice; under IFR the nav log is asked for
 * with them, its altitude is chosen from 14 CFR 91.177's minimum IFR
 * altitude and 91.179's thousands -- said so in its reasoning -- and the
 * fuel keeps 91.167's 45-minute reserve. Kept for the next flight.
 */

test("under IFR the altitude is chosen from the minimum IFR altitude by direction of flight, with the IFR reserve", async ({ page }) => {
  test.slow();
  const asked: string[] = [];
  page.on("request", r => {
    const url = new URL(r.url());
    if (url.pathname.endsWith("/api/planner/navlog")) asked.push(url.searchParams.get("rules") ?? "vfr");
  });
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  await page.getByTestId("sidebar-trigger-button").click();
  await openTab(page, "Nav Log");
  await controlsInSight(page);
  const why = page.getByTestId("altitude-why");
  await expect(why).toHaveAccessibleName(/\d,\d{3} feet|FL\d{3}/, { timeout: slow(60000) });
  await why.click();
  const popover = page.getByTestId("profile-card");
  const rules = popover.getByTestId("flight-rules");
  await expect(rules.getByRole("radio", { name: "VFR" })).toHaveAttribute("aria-checked", "true");
  await expect(popover).toContainText("14 CFR 91.159");

  await rules.getByRole("radio", { name: "IFR" }).click();
  await expect.poll(() => asked.at(-1)).toBe("ifr");
  // Put away to read the chip beside the airplane, which the card covers.
  await page.getByTestId("profile-close").click();
  await expect(popover).toBeHidden();
  await expect(page.getByTestId("ifr-flag")).toBeVisible();
  // The re-plan's altitude: whole thousands, west of north out of C81
  // (even thousands, 91.179(b)(1)(ii)).
  await expect(why).toHaveAccessibleName(/under IFR, (\d*[02468],000 feet|FL\d[02468]0)/, { timeout: slow(90000) });
  await why.click();
  await expect(popover).toContainText("Minimum IFR altitude", { timeout: slow(30000) });
  await expect(popover).toContainText("14 CFR 91.179");
  await expect(popover).not.toContainText("14 CFR 91.159");
  // How the floor was found, under its step.
  // How it was chosen, folded under the altitude's figures.
  await popover.getByText("How the altitude was chosen").click();
  await popover.getByRole("button", { name: /Minimum IFR altitude/ }).click();
  await expect(popover).toContainText("14 CFR 91.177");
  await page.getByTestId("profile-close").click();
  await expect(page.getByTestId("navlog-fuel")).toBeVisible({ timeout: slow(60000) });
  await openSection(page, "Fuel");
  await expect(page.getByTestId("fuel-detail")).toContainText("45 min IFR reserve (14 CFR 91.167)", { timeout: slow(60000) });

  // Kept: the next visit plans under IFR from the start.
  asked.length = 0;
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await expect.poll(() => asked[0], { timeout: slow(30000) }).toBe("ifr");
});

test("under IFR an airway in the route is flown fix by fix, its published MEA the floor, and filed between its fixes", async ({ page, context }) => {
  test.slow();
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  // A departure and an arrival picked at the ends, made up: neither field
  // publishes one. Drawn as the planner would answer, with no lines.
  await page.route(url => /\/api\/planner\/airport\/[^/]+\/procedures\/[^/]+$/.test(url.pathname), route => {
    const [, , , , airport, , id] = new URL(route.request().url()).pathname.split("/");
    const departure = id === "BAEE1";
    return route.fulfill({ json: {
      airport, kind: departure ? "departure" : "arrival", id, name: departure ? "BAEE ONE" : "OSHH TWO",
      transition: departure ? "BAE" : "OSH", cycle: "261001", stale: false, lines: [], holds: [], fixes: [],
    } });
  });
  // IFR, and the legs point to point: no chart read for checkpoints.
  await page.addInitScript(() => {
    const kept = JSON.parse(localStorage.getItem("vfr.preferences") ?? '{"state":{},"version":0}');
    localStorage.setItem("vfr.preferences", JSON.stringify({ ...kept, state: { ...kept.state, flightRules: "ifr", waypoints: false } }));
  });
  // Milwaukee's VOR to Oshkosh's along V191, by its fix CORIR, then
  // Appleton.
  await page.goto("/app/plan?dep=C81&dest=KATW&stops=BAE,V191,OSH&procs=C81:BAEE1:BAE,KATW:OSHH2:OSH");
  await settle(page);
  await page.getByTestId("sidebar-trigger-button").click();
  await openNavLog(page);
  const log = page.getByRole("table", { name: /Navigation log from/i });
  await expect(log).toContainText("CORIR", { timeout: slow(90000) });
  await expect(log).toContainText("OSH");
  await closeNavLog(page);
  await controlsInSight(page);
  const why = page.getByTestId("altitude-why");
  await expect(why).toHaveAccessibleName(/under IFR, (\d*[02468],000 feet|FL\d[02468]0)/, { timeout: slow(90000) });
  await why.click();
  const popover = page.getByTestId("profile-card");
  // How it was chosen, folded under the altitude's figures.
  await popover.getByText("How the altitude was chosen").click();
  await popover.getByRole("button", { name: /Minimum IFR altitude/ }).click();
  await expect(popover).toContainText(/Along V191 from BAE the published MEA, [\d,]+ ft/);
  await page.getByTestId("profile-close").click();

  // The flight plan's form (FAA Form 7233-4): the airway between the
  // fixes it is joined and left at, the departure and the arrival picked
  // at its ends, the level in hundreds of feet.
  await openTab(page, "Brief");
  await openSection(page, "Flight Plan");
  const form = page.getByTestId("flight-plan");
  await expect(form.getByTestId("flight-plan-route")).toContainText("BAEE1 BAE V191 OSH OSHH2", { timeout: slow(30000) });
  await expect(form.getByTestId("flight-plan-rules")).toContainText("IFR");
  await expect(form.getByTestId("flight-plan-level")).toContainText(/A\d[02468]0/);
  await expect(form.getByTestId("flight-plan-speed")).toContainText(/N0\d{3}/);
  await expect(form.getByTestId("flight-plan-destination")).toContainText("KATW");
  // C81 has no four-letter indicator.
  await expect(form.getByTestId("flight-plan-departure")).toContainText("DEP/C81");
  await form.getByTestId("flight-plan-copy-route").click();
  await expect(form.getByTestId("flight-plan-copy-route")).toHaveText("Copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("BAEE1 BAE V191 OSH OSHH2");
});

test("under IFR the Weather tab says whether an alternate is needed, files one with a tap, and the fuel flies on to it", async ({ page }) => {
  test.slow();
  await page.addInitScript(() => {
    const kept = JSON.parse(localStorage.getItem("vfr.preferences") ?? '{"state":{},"version":0}');
    localStorage.setItem("vfr.preferences", JSON.stringify({ ...kept, state: { ...kept.state, flightRules: "ifr", waypoints: false } }));
  });
  // The TAFs are the day's: the planner's answer is stubbed, its fuel is not.
  const madison = {
    ident: "KMSN", approach: true, precision: true, minimums: { ceiling_ft: 600, visibility_sm: 2 }, alternate_minimums_url: null,
    ceiling_ft: 2500, visibility_sm: 6, taf: "TAF KMSN ...", good: true, meets_standard: true, reasons: [], distance_nm: 230.4,
  };
  const navlogs: string[] = [];
  page.on("request", r => {
    const url = new URL(r.url());
    if (url.pathname.endsWith("/api/planner/navlog")) navlogs.push(url.searchParams.get("alternate") ?? "");
  });
  await page.route(url => url.pathname.endsWith("/api/planner/alternate"), route => {
    const filed = new URL(route.request().url()).searchParams.get("alternate");
    return route.fulfill({ json: {
      destination: { ident: "KDLH", approach: true, ceiling_ft: 1500, visibility_sm: 4, taf: "TAF KDLH ...", required: true,
        reasons: ["The TAF has a 1,500 ft ceiling within an hour of the ETA: under 2,000 ft."] },
      alternate: filed === "KMSN" ? madison : null,
      suggestions: [madison],
    } });
  });
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  await page.getByTestId("sidebar-trigger-button").click();
  await openTab(page, "Weather");
  await openSection(page, "Alternate");
  const section = page.getByTestId("alternate");
  await expect(section.getByTestId("alternate-destination")).toContainText("An alternate is required", { timeout: slow(90000) });
  await section.getByTestId("alternate-suggestion-KMSN").click();
  await expect(page).toHaveURL(/[?&]alternate=KMSN/);
  await expect(section.getByTestId("alternate-filed")).toContainText("Meets 600-2");
  await expect.poll(() => navlogs.at(-1), { timeout: slow(30000) }).toBe("KMSN");
  await openSection(page, "Fuel");
  await expect(page.getByTestId("fuel-detail")).toContainText("on to KMSN", { timeout: slow(90000) });
  // And the flight plan's alternate (item 16).
  await openTab(page, "Brief");
  await openSection(page, "Flight Plan");
  await expect(page.getByTestId("flight-plan-alternate")).toContainText("KMSN");
});

test("under IFR a leg in cloud at or above the freezing level is icing possible, in the Go / No-Go and the adverse conditions", async ({ page }) => {
  test.slow();
  await page.addInitScript(() => {
    const kept = JSON.parse(localStorage.getItem("vfr.preferences") ?? '{"state":{},"version":0}');
    localStorage.setItem("vfr.preferences", JSON.stringify({ ...kept, state: { ...kept.state, flightRules: "ifr", waypoints: false } }));
  });
  // The day's weather pinned: the freezing level at 2,000 ft with cloud,
  // under any IFR altitude out of C81, a report of moderate icing, and no
  // hazard or alternate to say anything first.
  await page.route("**/api/planner/navlog?*", async route => {
    const response = await route.fetch();
    const body = (await response.text()).split("\n").map(line => {
      if (!line.trim()) return line;
      const message = JSON.parse(line);
      if (message.type === "altitude") Object.assign(message.altitude_selection, { freezing_level_ft: 2000, freezing_level_at_or_below: false, icing_possible: true });
      return JSON.stringify(message);
    }).join("\n");
    await route.fulfill({ response, body });
  });
  await page.route("**/api/planner/briefing?*", async route => {
    const response = await route.fetch();
    const json = await response.json();
    Object.assign(json, {
      hazards: [], gairmets: [], vfr_not_recommended: [],
      pireps: [{ observed_at: null, altitude_ft: 6000, aircraft: "C172", urgent: false, turbulence: null, icing: "MOD", raw: "UA /OV DLH/FL060/TP C172/IC MOD RIME", along_track_nm: 120 }],
    });
    await route.fulfill({ response, json });
  });
  await page.route(url => url.pathname.endsWith("/api/planner/alternate"), route => route.fulfill({ json: {
    destination: { ident: "KDLH", approach: true, ceiling_ft: null, visibility_sm: 6, taf: "TAF KDLH ...", required: false, reasons: [] },
    alternate: null, suggestions: [],
  } }));
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  await page.getByTestId("sidebar-trigger-button").click();
  await openTab(page, "Brief");
  const weather = page.getByTestId("verdict-weather");
  await expect(weather).toContainText(/Icing possible at [\d,]+ ft: the freezing level at 2,000 ft, in cloud; 1 pilot report of icing/, { timeout: slow(90000) });
  await expect(weather).toHaveAttribute("data-finding", "caution");
  await openTab(page, "Weather");
  await openSection(page, "Adverse Conditions");
  const alert = page.getByTestId("icing-alert");
  await expect(alert).toContainText("14 CFR 91.9(a)");
  await expect(page.getByTestId("icing-flag")).toBeVisible();
});
