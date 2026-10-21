import { test, expect } from "@playwright/test";
import { openPanel, settle, sideDrawer, slow } from "./helpers";

/**
 * FPL's airports one block each, folded until the arrow by their fuel is
 * tapped, as the pilot first sees them, at the owner's pick (boards 4 and 5
 * of the canvas): the ident on top, a fuel stop's pump before it and the
 * fuel in the tanks after it, the time over the elevation, the wind under;
 * opened, a line for the landing and one for the takeoff, no words for
 * either ("no need to use the word depart, fuel stop, arrive"). The rest of
 * the suite starts with them opened (auth.setup's vfr.fieldsOpen); here
 * they start as a pilot's do.
 */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.removeItem("vfr.fieldsOpen"); } catch { /* no storage */ } });
});

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("the departure and the destination are one block each, opened and folded by the arrow by their fuel", async ({ page }) => {
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  await openPanel(page);
  const route = sideDrawer(page).getByTestId("procedures");
  for (const name of ["C81 · Depart", "KDLH · Arrive"]) {
    const field = route.getByRole("region", { name });
    const toggle = field.getByTestId("field-toggle");
    await expect(toggle).toHaveAttribute("aria-expanded", "false", { timeout: slow(30_000) });
    // Its time over its elevation, its wind and its menu, no runways or
    // procedures under it, and no words for what it is.
    await expect(field.getByTestId("point-figures")).toBeVisible();
    await expect(field.getByTestId("point-altitude-figure")).toContainText(/\d ft/);
    await expect(field).not.toContainText(/Depart|Arrive|Destination/);
    await expect(field.getByTestId("procedure-pattern")).toHaveCount(0);
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(field.getByTestId("procedure-pattern").first()).toBeVisible({ timeout: slow(30_000) });
    await toggle.click();
    await expect(field.getByTestId("procedure-pattern")).toHaveCount(0);
  }
});

test("a stop is one block, its landing and its takeoff a tap away, and a fuel stop wears the pump before its ident", async ({ page }) => {
  // The fields alone: the plan through the stop is not what is tried.
  await page.route(url => /\/(course|checkpoints|navlog|briefing)$/.test(url.pathname) && !!url.searchParams.get("stops"), route => route.abort());
  await page.goto("/app/plan?dep=C81&stops=KMSN&dest=KDLH&fuel=KMSN");
  await settle(page);
  await openPanel(page);
  const route = sideDrawer(page).getByTestId("procedures");
  const stop = route.getByRole("region", { name: "KMSN · Arrive" });
  await expect(stop).toBeVisible({ timeout: slow(30_000) });
  await expect(stop.getByRole("img", { name: "fuel stop" })).toBeVisible();
  await expect(route).not.toContainText("Fuel stop");
  await expect(route.getByRole("region", { name: "KMSN · Depart" })).toHaveCount(0);
  await stop.getByTestId("field-toggle").click();
  await expect(stop.getByRole("img", { name: "landing" })).toBeVisible();
  await expect(route.getByRole("region", { name: "KMSN · Depart" }).getByRole("img", { name: "takeoff" })).toBeVisible();
  await stop.getByTestId("field-toggle").click();
  await expect(route.getByRole("region", { name: "KMSN · Depart" })).toHaveCount(0);
  // A stop of the pilot's own: no pump.
  await page.goto("/app/plan?dep=C81&stops=KMSN&dest=KDLH");
  await openPanel(page);
  await expect(route.getByRole("region", { name: "KMSN · Arrive" })).toBeVisible({ timeout: slow(30_000) });
  await expect(route.getByRole("img", { name: "fuel stop" })).toHaveCount(0);
});
