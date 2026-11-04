import { test, expect, type Page } from "@playwright/test";
import { settle, sideDrawer, slow, openBrief } from "./helpers";

/**
 * The Brief at a glance (the owner's rule, 2026-11-03: "a pilot doesn't
 * want to spend too much time in studying the briefs so make it simpler
 * for them to just look and go"): the verdict, then at most three
 * one-sentence lines a pilot acts on, the rest folded into one row, and
 * a tap on a line unfolds why it matters with its rule and the report it
 * was read from. The briefing's answer is changed on its way in to put
 * a crosswind past the airplane's demonstrated on the departure.
 */

/** The briefing's answer, changed by `change` on its way in. */
async function briefingAs(page: Page, change: (json: Record<string, unknown>) => void) {
  await page.route("**/api/planner/briefing?*", async route => {
    const response = await route.fetch().catch(() => null);
    if (!response) return;
    const json = await response.json();
    change(json);
    await route.fulfill({ response, json }).catch(() => {});
  });
}

test("the Brief opens on the verdict and at most three one-sentence lines, each unfolding to why it matters", async ({ page }) => {
  await briefingAs(page, json => {
    // Every runway at C81 with 18 kt across, gusting 22: past the 15 kt
    // the C172's POH demonstrates (data/aircraft/c172.json).
    const airports = json.airports as Record<string, { runways: { wind: unknown }[] }>;
    for (const r of airports.C81!.runways) r.wind = { end: "27", headwind_kt: 4, crosswind_kt: 18, gust_crosswind_kt: 22, in_use: true };
    // C81 reports no METAR of its own: one given it, the report the line's
    // sources show as sent.
    const metars = json.metars as Record<string, unknown>;
    metars.C81 = {
      raw: "METAR C81 031753Z 36022G26KT 10SM CLR 12/03 A3001", observed_at: new Date().toISOString(), flight_category: "VFR",
      wind_dir_true_deg: 360, wind_speed_kt: 22, wind_gust_kt: 26, visibility_sm: 10, ceiling_ft: null, temp_c: 12, dewpoint_c: 3, altimeter_in_hg: 30.01,
    };
    // A quiet day otherwise, whatever the weather is as the test runs: the
    // crosswind among at most three lines.
    Object.assign(json, { vfr_not_recommended: [], fields_below_vfr: [], hazards: [], gairmets: [], pireps: [], tfrs: [], weather_unavailable: [] });
  });
  await page.goto("/app/plan?dep=C81&dest=KDLH&view=briefing");
  await settle(page);
  await expect(page.getByTestId("navlog-fuel")).toBeVisible({ timeout: slow(120000) });
  await openBrief(page);
  const glance = sideDrawer(page).getByTestId("brief-glance");
  // Runways in the verdict's line (with the day's risk, which may stop it).
  await expect(glance.getByTestId("brief-verdict")).toContainText(/Runways/, { timeout: slow(30_000) });

  // The lines a pilot acts on: at most three, each one sentence of at
  // most 140 characters, the crosswind's with its figures and its action.
  const lines = glance.locator("[data-testid^='brief-line-'][data-finding]");
  await expect(lines.first()).toBeVisible();
  const count = await lines.count();
  expect(count).toBeGreaterThanOrEqual(1);
  expect(count).toBeLessThanOrEqual(3);
  for (const words of await glance.getByTestId("brief-line-words").allTextContents()) {
    expect(words.length).toBeLessThanOrEqual(140);
    expect(words).not.toMatch(/\. [A-Z]/);
  }
  const runways = glance.getByTestId("brief-line-runways");
  await expect(runways).toHaveAttribute("data-finding", "caution");
  // The gusts' crosswind, the figure held against the demonstrated (lib/runwayCheck).
  await expect(runways.getByTestId("brief-line-words")).toContainText(/C81 has 22 kt across, past the POH's demonstrated: ask for another runway, or wait for the wind/);
  // The rest folded into one row.
  await expect(glance.getByTestId("brief-rest")).toBeVisible();
  await expect(glance.getByTestId("brief-rest-words")).toContainText(/nothing to fix|more to look at|Still checking/);
  // Folded until a tap: why it matters, with the rule, and the METAR as sent.
  await expect(runways.getByTestId("brief-line-why")).toBeHidden();
  await runways.getByTestId("brief-line-words").click();
  await expect(runways.getByTestId("brief-line-why")).toBeVisible();
  await expect(runways.getByTestId("brief-line-why")).toContainText("Why it matters: The POH's demonstrated crosswind is what the test pilot showed, not a limit");
  await expect(runways.getByTestId("brief-line-why")).toContainText("14 CFR 91.103(b)");
  await expect(runways.getByTestId("brief-line-raw")).toContainText("METAR C81 031753Z 36022G26KT");
  // The cards with their figures still under the lines.
  await expect(glance.locator("button[data-testid^='brief-glance-']")).toHaveCount(4);
  await page.unrouteAll({ behavior: "ignoreErrors" });
});
