import { test, expect } from "@playwright/test";
import { settle, slow } from "./helpers";

/**
 * The airspace over a point (AirspaceCard): a right-click on the chart,
 * which a phone raises for a finger held on it, opens the card, held in
 * the address; the planner answers from the FAA's airspace file.
 */

test("C81's column: G at the surface, E from 700 ft above it, Chicago's Class B over both, in the Mode C veil", async ({ page }) => {
  await page.goto("/app/plan?at=42.3172,-88.0905");
  const card = page.getByTestId("airspace-card");
  await expect(card.getByTestId("airspace-band").first()).toBeVisible({ timeout: slow(30000) });
  await expect(card.getByTestId("airspace-class")).toHaveText(["G", "E", "B", "E", "A"]);
  await expect(card.getByTestId("airspace-band").nth(2)).toContainText("Class B · Chicago");
  await expect(card.getByTestId("airspace-band").first()).toContainText("1 sm, clear of clouds");
  await expect(card.getByTestId("airspace-veil")).toContainText("KORD");
  await expect(card.getByTestId("airspace-where")).toContainText("N42°19.0′ W088°05.4′");
});

test("a right-click on the chart asks what is there, and Close puts the card away", async ({ page }) => {
  await page.goto("/app/plan");
  await settle(page);
  const map = page.locator(".leaflet-container");
  const box = (await map.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.3, { button: "right" });
  await expect(page).toHaveURL(/[?&]at=-?\d+\.\d+%2C-?\d+\.\d+/);
  const card = page.getByTestId("airspace-card");
  await expect(card.getByTestId("airspace-band").first()).toBeVisible({ timeout: slow(30000) });
  await card.getByTestId("airspace-close").click();
  await expect(page).not.toHaveURL(/[?&]at=/);
  await expect(card).toHaveCount(0);
});
