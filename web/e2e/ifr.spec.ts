import { test, expect } from "@playwright/test";
import { slow, settle, openTab, controlsInSight } from "./helpers";

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
  await expect(why).toHaveAccessibleName(/FL\d{3}/, { timeout: slow(60000) });
  await why.click();
  const popover = page.locator("[data-slot=popover-content], [data-slot=drawer-content]");
  const rules = popover.getByTestId("flight-rules");
  await expect(rules.getByRole("radio", { name: "VFR" })).toHaveAttribute("aria-checked", "true");
  await expect(popover).toContainText("14 CFR 91.159");

  await rules.getByRole("radio", { name: "IFR" }).click();
  await expect.poll(() => asked.at(-1)).toBe("ifr");
  // Put away to read the chip: on a phone the popover is a sheet over it.
  await page.keyboard.press("Escape");
  await expect(popover).toBeHidden();
  await expect(page.getByTestId("ifr-flag")).toBeVisible();
  // The re-plan's altitude: whole thousands, west of north out of C81
  // (even thousands, 91.179(b)(1)(ii)).
  await expect(why).toHaveAccessibleName(/under IFR, FL\d[02468]0/, { timeout: slow(90000) });
  await why.click();
  await expect(popover).toContainText("Minimum IFR altitude", { timeout: slow(30000) });
  await expect(popover).toContainText("14 CFR 91.179");
  await expect(popover).not.toContainText("14 CFR 91.159");
  // How the floor was found, under its step.
  await popover.getByRole("button", { name: /Minimum IFR altitude/ }).click();
  await expect(popover).toContainText("14 CFR 91.177");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("fuel-check")).toContainText("45 min IFR reserve (14 CFR 91.167)", { timeout: slow(60000) });

  // Kept: the next visit plans under IFR from the start.
  asked.length = 0;
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await expect.poll(() => asked[0], { timeout: slow(30000) }).toBe("ifr");
});

test("under IFR an airway in the route is flown fix by fix, its published MEA the floor", async ({ page }) => {
  test.slow();
  // IFR, and the legs point to point: no chart read for checkpoints.
  await page.addInitScript(() => {
    const kept = JSON.parse(localStorage.getItem("vfr.preferences") ?? '{"state":{},"version":0}');
    localStorage.setItem("vfr.preferences", JSON.stringify({ ...kept, state: { ...kept.state, flightRules: "ifr", waypoints: false } }));
  });
  // Milwaukee's VOR to Oshkosh's along V191, by its fix CORIR, then
  // Appleton.
  await page.goto("/app/plan?dep=C81&dest=KATW&stops=BAE,V191,OSH");
  await settle(page);
  await page.getByTestId("sidebar-trigger-button").click();
  await openTab(page, "Nav Log");
  const log = page.getByRole("table", { name: /Navigation log from/i });
  await expect(log).toContainText("CORIR", { timeout: slow(90000) });
  await expect(log).toContainText("OSH");
  await controlsInSight(page);
  const why = page.getByTestId("altitude-why");
  await expect(why).toHaveAccessibleName(/under IFR, FL\d[02468]0/, { timeout: slow(90000) });
  await why.click();
  const popover = page.locator("[data-slot=popover-content], [data-slot=drawer-content]");
  await popover.getByRole("button", { name: /Minimum IFR altitude/ }).click();
  await expect(popover).toContainText(/Along V191 from BAE the published MEA, [\d,]+ ft/);
});
