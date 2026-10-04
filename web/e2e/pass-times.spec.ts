import { test, expect } from "@playwright/test";
import { settle, sideDrawer, slow } from "./helpers";

/**
 * When the flight gets to each TFR and special-use area on the route,
 * against the times it is in force (lib/passTimes): the briefing's and
 * the nav log's own answers, with a TFR and an area put in them.
 */
test("a TFR in force when the flight gets there is flagged, one that starts later is not, and each area says when it is passed", async ({ page }) => {
  const now = Date.now();
  const iso = (minutes: number) => new Date(now + minutes * 60_000).toISOString();
  await page.route("**/api/planner/briefing?*", async route => {
    const response = await route.fetch();
    const json = await response.json();
    json.tfrs = [
      { notam_id: "6/1111", title: "IN FORCE", kind: "Security", effective: iso(-60), expires: iso(240),
        along_track_nm: 20, crosses: true, active_now: true, ceiling_ft: 3000, ceiling_ref: "AGL" },
      { notam_id: "6/2222", title: "LATER", kind: "Hazards", effective: iso(600), expires: iso(720),
        along_track_nm: 40, crosses: true, active_now: false, ceiling_ft: 3000, ceiling_ref: "AGL" },
    ];
    await route.fulfill({ response, json });
  });
  await page.route("**/api/planner/navlog?*", async route => {
    const response = await route.fetch();
    const body = (await response.text()).split("\n").map(line => {
      if (!line.trim()) return line;
      const message = JSON.parse(line);
      if (message.type === "altitude") {
        message.altitude_selection.special_use = [{
          name: "VOLK EAST MOA", type: "MOA", kind: "military operations area", floor_ft: 8000, floor_ref: "MSL",
          ceiling_ft: 18000, ceiling_ref: "STD", times_of_use: "CONTINUOUS", controlling_agency: "ZMP",
          along_track_nm: 120, legs: [7],
        }];
      }
      return JSON.stringify(message);
    }).join("\n");
    await route.fulfill({ response, body });
  });

  await page.goto("/app/plan?dep=C81&dest=KDLH&view=briefing");
  await settle(page);
  await expect(page.getByTestId("navlog-eta")).toBeVisible({ timeout: slow(120000) });
  await expect(page.getByTestId("tfr-flag")).toBeVisible();
  await page.getByRole("button", { name: "Check before you fly", exact: true }).click();
  const passes = sideDrawer(page).getByTestId("tfr-pass");
  await expect(passes.nth(0)).toContainText("in force then");
  await expect(passes.nth(1)).toContainText("before it starts");
  await expect(sideDrawer(page).getByTestId("sua-pass")).toContainText("scheduled in use then");
  await expect(sideDrawer(page).getByTestId("special-use-area")).toContainText("8,000 ft to FL180");
  await page.unrouteAll({ behavior: "ignoreErrors" });
});
