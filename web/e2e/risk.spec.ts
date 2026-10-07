import { test, expect } from "@playwright/test";
import { settle, sideDrawer, slow, openTab } from "./helpers";

/**
 * The briefing's Risk Assessment (lib/frat): what the briefing raises
 * and what the pilot ticks, the level they make, and the assessment
 * filed with the flight. The briefing's weather and the nav log's night
 * are pinned so the points have one answer; the flight is not filed for
 * real.
 */
test("a quiet day is low, what the pilot ticks raises it, and Save files it with the flight", async ({ page }) => {
  await page.route("**/api/planner/briefing?*", async route => {
    const response = await route.fetch();
    const json = await response.json();
    Object.assign(json, { hazards: [], gairmets: [], tfrs: [], vfr_not_recommended: [] });
    await route.fulfill({ response, json });
  });
  await page.route("**/api/planner/navlog?*", async route => {
    const response = await route.fetch();
    const body = (await response.text()).split("\n").map(line => {
      if (!line.trim()) return line;
      const message = JSON.parse(line);
      if (message.type === "done") message.totals.night = false;
      return JSON.stringify(message);
    }).join("\n");
    await route.fulfill({ response, body });
  });
  let filed: { risk?: { score: number; level: string; factors: string[] } } | null = null;
  await page.route("**/api/flights", async route => {
    if (route.request().method() !== "POST") return route.fallback();
    filed = route.request().postDataJSON();
    await route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ id: 1, departureIdent: "C81", destinationIdent: "KDLH", stops: [], aircraftTailNumber: null, cruiseAltitudeFt: null,
        totalDistanceNm: null, totalEteMin: null, totalFuelGal: null, plannedFor: null, createdAt: new Date().toISOString(), risk: null, checkpoints: [] }),
    });
  });

  await page.goto("/app/plan?dep=C81&dest=KDLH&view=briefing");
  await settle(page);
  await expect(page.getByTestId("navlog-eta")).toBeVisible({ timeout: slow(120000) });
  const drawer = sideDrawer(page);
  await openTab(page, "Brief");
  await expect(drawer.getByTestId("risk-level")).toContainText(/^Low · \d+ points?/);
  const base = Number((await drawer.getByTestId("risk-level").innerText()).match(/· (\d+) point/)![1]);

  await drawer.getByTestId("risk-check-pressure").click();
  await drawer.getByTestId("risk-check-fatigue").click();
  await expect(drawer.getByTestId("risk-level")).toContainText(`· ${base + 7} points`);
  await expect(drawer.getByTestId("risk-check-fatigue")).toHaveAttribute("aria-checked", "true");
  await drawer.getByTestId("risk-check-alcohol").click();
  await expect(drawer.getByTestId("risk-level")).toContainText("High");
  await expect(drawer.getByTestId("risk-flag")).toContainText("High risk");

  await drawer.getByTestId("save-flight-button").click();
  await expect.poll(() => filed?.risk?.level).toBe("high");
  expect(filed!.risk!.factors).toEqual(expect.arrayContaining([
    "Somewhere to be by a time, or people counting on it", "Alcohol in the last 8 hours, or still feeling it",
  ]));
  // About the pilot today, not the route: put back for the next test.
  await drawer.getByTestId("risk-check-alcohol").click();
  await page.unrouteAll({ behavior: "ignoreErrors" });
});
