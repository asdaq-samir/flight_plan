import { test, expect } from "@playwright/test";
import { settle, sideDrawer, slow, controlsInSight } from "./helpers";

/**
 * The route's Procedures (ProceduresButton), at the pilot's ask: a field's
 * traffic pattern picked by its runway, kept in the address, and drawn on
 * the map round the runway with its 45° entry (PatternLayer); None takes
 * it off.
 */
test("a field's traffic pattern is picked by its runway, kept in the address and drawn on the map", async ({ page }) => {
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  await controlsInSight(page);
  await sideDrawer(page).getByTestId("route-approaches").click();
  const procedures = page.getByTestId("procedures");
  await expect(procedures).toContainText("C81 · Departure · traffic pattern");
  const destination = procedures.locator("section").filter({ hasText: "KDLH · Destination" });
  const runway = destination.getByTestId("procedure-pattern").and(page.locator(":not([disabled])")).first();
  await expect(runway).toBeVisible({ timeout: slow(20000) });
  const name = (await runway.getByText(/^Runway /).innerText()).replace("Runway ", "");
  await runway.click();
  await expect(runway).toHaveAttribute("aria-checked", "true");
  await expect(page).toHaveURL(new RegExp(`[?&]pattern=KDLH(%3A|:)${name}`));
  await expect(page.locator("path.traffic-pattern")).toHaveCount(1, { timeout: slow(10000) });
  await expect(page.locator("path.traffic-pattern-entry")).toHaveCount(1);

  // None: off the map and the address.
  await destination.getByRole("radio", { name: /None/ }).click();
  await expect(page.locator("path.traffic-pattern")).toHaveCount(0);
  await expect(page).not.toHaveURL(/[?&]pattern=/);
});

// KDLH's ILS as the planner would send it (vfr.procedures), stubbed: the
// FAA's file is not read on CI's runner.
const LIST = {
  airport: "KDLH", cycle: "261001",
  procedures: [
    { kind: "approach", id: "I09", name: "ILS RWY 09", runway: "09", transitions: ["DLH"], runway_transitions: [] },
    { kind: "arrival", id: "SKETC1", name: "SKETC1", runway: null, transitions: [], runway_transitions: ["ALL"] },
  ],
};
const DRAWN = {
  airport: "KDLH", kind: "approach", id: "I09", name: "ILS RWY 09", transition: "DLH", cycle: "261001",
  lines: [
    { role: "transition", name: "DLH", points: [[46.80, -92.36], [46.84, -92.40]] },
    { role: "final", name: null, points: [[46.84, -92.40], [46.84, -92.30], [46.842, -92.21]] },
    { role: "missed", name: null, points: [[46.842, -92.21], [46.843, -92.17], [46.80, -92.36]] },
  ],
  holds: [{ fix: "DLH", turn: "R", inbound_deg: 90, missed: true, points: [[46.80, -92.36], [46.79, -92.34], [46.78, -92.36], [46.80, -92.36]] }],
  fixes: [
    { ident: "DLH", lat: 46.80, lon: -92.36, roles: ["hold"], min_ft: 3500, max_ft: null, speed_kt: null, missed: false },
    { ident: "OFOFO", lat: 46.84, lon: -92.40, roles: ["IAF", "IF"], min_ft: 3500, max_ft: null, speed_kt: null, missed: false },
    { ident: "FAKER", lat: 46.84, lon: -92.30, roles: ["FAF"], min_ft: 2700, max_ft: 2700, speed_kt: null, missed: false },
  ],
};

test("a field's approach is picked on its own page with its transition, drawn on the map as it is chosen, and added to the route with Add to Route, as ForeFlight picks one", async ({ page }) => {
  const asked: string[] = [];
  await page.route(url => /\/airport\/[^/]+\/procedures/.test(url.pathname), route => {
    const url = new URL(route.request().url());
    asked.push(`${url.pathname}${url.search}`);
    if (url.pathname.endsWith("/KDLH/procedures")) return route.fulfill({ json: LIST });
    if (url.pathname.endsWith("/KDLH/procedures/I09")) return route.fulfill({ json: { ...DRAWN, transition: url.searchParams.get("transition") } });
    return route.fulfill({ json: { airport: "C81", cycle: "261001", procedures: [] } });
  });
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  await controlsInSight(page);
  await sideDrawer(page).getByTestId("route-approaches").click();
  const procedures = page.getByTestId("procedures");
  // The departure's departures: none at C81.
  const c81 = procedures.locator("section").filter({ hasText: "C81 · instrument procedures" });
  await expect(c81).toContainText(/Departures\s*None/, { timeout: slow(10000) });
  // The destination's approaches, a page of their own.
  const kdlh = procedures.locator("section").filter({ hasText: "KDLH · instrument procedures" });
  await kdlh.getByRole("button", { name: /^Approaches/ }).click();
  await expect(page.getByRole("heading", { name: "KDLH approaches" })).toBeVisible();
  // Its own page: drawn on the map from vectors as it opens, before it is
  // added -- the route's address untouched.
  await page.getByTestId("procedure-option").filter({ hasText: "ILS RWY 09" }).click();
  await expect(page.getByRole("heading", { name: "KDLH ILS RWY 09" })).toBeVisible();
  await expect.poll(() => asked, { timeout: slow(10000) }).toContain("/api/planner/airport/KDLH/procedures/I09");
  await expect(page.locator("path.instrument-procedure").first()).toBeAttached({ timeout: slow(10000) });
  await expect(page).not.toHaveURL(/[?&]procs=/);
  // By DLH, drawn as it is chosen.
  await page.getByTestId("procedure-transition").filter({ hasText: "DLH" }).click();
  await expect.poll(() => asked, { timeout: slow(10000) }).toContain("/api/planner/airport/KDLH/procedures/I09?transition=DLH");
  await expect(page).not.toHaveURL(/[?&]procs=/);
  // Add to Route: in the address, and the sheet put away.
  await page.getByTestId("procedure-add").click();
  await expect(page).toHaveURL(/[?&]procs=KDLH(%3A|:)I09(%3A|:)DLH(&|$)/);
  await expect(page.getByRole("heading", { name: "KDLH ILS RWY 09" })).toBeHidden();

  // On the map: the transition and the final, the missed approach dashed,
  // its hold, and the fixes with their altitudes.
  await expect(page.locator("path.instrument-procedure")).toHaveCount(2, { timeout: slow(10000) });
  await expect(page.locator("path.instrument-procedure-missed")).toHaveCount(1);
  await expect(page.locator("path.instrument-procedure-hold")).toHaveCount(1);
  await expect(page.locator("[data-procedure-fix]")).toHaveCount(3);
  // Said in the route's box after the destination's pill, and a tap there
  // opens the Procedures.
  const chip = sideDrawer(page).getByTestId("route-procedure");
  await expect(chip).toHaveText("ILS 09 · DLH");
  await expect(chip).toHaveAccessibleName(/ILS RWY 09 via DLH/);
  await chip.click();
  await expect(page.getByTestId("procedures")).toBeVisible();
  await page.keyboard.press("Escape");

  // Checked in the list, and on its page Remove from Route takes it off
  // the address, and off the map once the sheet is put away.
  await sideDrawer(page).getByTestId("route-approaches").click();
  await procedures.locator("section").filter({ hasText: "KDLH · instrument procedures" }).getByRole("button", { name: /^Approaches/ }).click();
  const ils = page.getByTestId("procedure-option").filter({ hasText: "ILS RWY 09" });
  await expect(ils).toContainText("In the route, via DLH");
  await ils.click();
  await page.getByTestId("procedure-remove").click();
  await expect(page).not.toHaveURL(/[?&]procs=/);
  await expect(page.getByTestId("procedure-add")).toBeVisible();
  // Put away by its own close.
  await page.getByTestId("procedures-close").click();
  await expect(page.getByTestId("procedures")).toBeHidden();
  await expect(page.locator("path.instrument-procedure")).toHaveCount(0);
});
