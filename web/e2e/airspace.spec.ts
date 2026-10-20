import { test, expect } from "@playwright/test";
import { closeCard, grabberTo, settle, slow } from "./helpers";

/**
 * The airspace over a point (AirspaceCard): a right-click on the chart,
 * which a phone raises for a finger held on it, opens the card, held in
 * the address; the planner answers from the FAA's airspace file.
 */

test("C81's column: G at the surface, E from 700 ft above it, Chicago's Class B over both, in the Mode C veil", async ({ page }) => {
  await page.goto("/app/plan?at=42.3172,-88.0905");
  const card = page.getByTestId("airspace-card");
  await expect(card.getByTestId("airspace-band").first()).toBeVisible({ timeout: slow(30000) });
  // At the pill's size the lowest two; every one all the way up.
  await grabberTo(page, "full");
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
  await closeCard(page, "airspace-close");
  await expect(page).not.toHaveURL(/[?&]at=/);
  await expect(card).toHaveCount(0);
});

test("a point held on the chart goes into the route as the pilot's own point off the nearest fix: added, flown to direct, or held at", async ({ page }) => {
  // The owner's pick (mock 2 of the canvas's points, 2026-10-20): the
  // dropped point's card with Add to route, Direct to and Hold here. Its
  // name is the planner's (vfr.fixes.frd_near), stubbed here.
  await page.route(url => url.pathname.endsWith("/airspace/at"), async route => {
    const real = await (await route.fetch()).json();
    await route.fulfill({ json: { ...real, point: {
      ident: "VPBNG/280/20", base: "VPBNG", course_deg: 280, distance_nm: 20, radial: false, name: "20 nm on 280° from VPBNG",
    } } });
  });
  const open = async () => {
    await page.goto("/app/plan?dep=C81&dest=KDLH&at=42.35,-88.55");
    const card = page.getByTestId("airspace-card");
    await expect(card.getByTestId("airspace-where")).toContainText("VPBNG/280/20 · 20 nm on 280° from VPBNG", { timeout: slow(30000) });
    return card;
  };
  // Added: in the stops, the card put away.
  await (await open()).getByTestId("point-add").click();
  await expect(page).toHaveURL(/[?&]stops=VPBNG(%2F|\/)280(%2F|\/)20(&|$)/);
  await expect(page).not.toHaveURL(/[?&]at=/);
  // Flown to direct: from the departure with no position, the route as it
  // was kept for Cancel.
  await (await open()).getByTestId("point-direct").click();
  await expect(page).toHaveURL(/[?&]direct=VPBNG(%2F|\/)280(%2F|\/)20(&|$)/);
  await expect(page).toHaveURL(/[?&]was=/);
  // Held at: its hold's sheet once the plan has the leg to it.
  await (await open()).getByTestId("point-hold").click();
  await expect(page).toHaveURL(/[?&]stops=VPBNG(%2F|\/)280(%2F|\/)20(&|$)/);
  const sheet = page.getByTestId("hold-sheet");
  await expect(sheet).toBeVisible({ timeout: slow(60000) });
  await expect(sheet.getByTestId("hold-course")).toHaveValue(/^\d{3}$/);
  await sheet.getByTestId("hold-set").click();
  await expect(page).toHaveURL(/[?&]holds=VPBNG(%2F|\/)280(%2F|\/)20(%3A|:)\d{3}(%3A|:)R(%3A|:)1M(%3A|:)2T(&|$)/);
});
