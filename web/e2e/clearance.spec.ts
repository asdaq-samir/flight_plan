import { test, expect } from "@playwright/test";
import { openPanel, settle, sideDrawer, slow } from "./helpers";

/**
 * A clearance into the route, from the route box's microphone: the
 * browser here has no microphone, so it is typed as it was read, which
 * the card takes as well. Its items are shown -- the limit and the route
 * found as idents, the altitudes, the frequency and the code -- and only
 * Enter Route changes the plan: the route through Gopher (GEP), "then
 * as filed", and the expected altitude flown (AIM 4-4-3, 5-2-6).
 */
test("a clearance read is shown in its items and entered as the route", async ({ page }) => {
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  await openPanel(page);
  const box = sideDrawer(page).getByTestId("route-box");
  await box.getByTestId("clearance-listen").click();
  await page.getByTestId("clearance-text").fill(
    "Cessna one two three alpha bravo cleared to the Duluth airport via Gopher then as filed, climb and maintain three thousand, "
    + "expect seven thousand one zero minutes after departure, departure frequency one two five point three five, squawk four five two one",
  );
  const body = page.getByTestId("clearance-body");
  await expect(body.getByText("GEP", { exact: true })).toBeVisible({ timeout: slow(20_000) });
  await expect(body).toContainText("KDLH");
  await expect(body).toContainText("3,000 ft");
  await expect(body).toContainText("7,000 ft, 10 min after departure");
  await expect(body).toContainText("125.35");
  await expect(body).toContainText("4521");
  // Nothing in the plan until it is entered.
  expect(new URL(page.url()).searchParams.get("stops")).toBeNull();
  const enter = page.getByTestId("clearance-enter");
  await expect(enter).toBeEnabled();
  await enter.click();
  await expect(page).toHaveURL(/stops=GEP/, { timeout: slow(10_000) });
  await expect(page).toHaveURL(/altitude_ft=7000/);
  await expect(box).toContainText("GEP");
});
