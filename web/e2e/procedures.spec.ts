import { test, expect } from "@playwright/test";
import { openPanel, settle, sideDrawer, slow } from "./helpers";

/**
 * The route's Procedures (ProceduresButton), at the pilot's ask: a field's
 * traffic pattern picked by its runway, kept in the address, and drawn on
 * the map round the runway with its 45° entry (PatternLayer); None takes
 * it off.
 */
test("a field's traffic pattern is picked by its runway, kept in the address and drawn on the map", async ({ page }) => {
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  await openPanel(page);
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
