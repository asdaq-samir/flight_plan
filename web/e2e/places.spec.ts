import { test, expect, type Page } from "@playwright/test";
import { expectDrawerClosed, expectDrawerOpen, settle, sideDrawer, slow, tapTheChart } from "./helpers";

/**
 * Airports as places, as Maps has them: a tap on one on the chart opens
 * its card in the panel -- its name, what kind of field it is, the
 * weather there as pilots read it -- with Fly Here, Weather and
 * Frequencies; the card is the address's (?place=) and puts itself away.
 */

const card = (page: Page) => sideDrawer(page).getByTestId("place-card");

test("an airport's card names the field, its airspace and tower, how far it is, and the weather there", async ({ page }) => {
  await page.goto("/app/plan?dep=C81&dest=KDLH&place=KDLH");
  await settle(page);
  await expectDrawerOpen(page);
  await expect(card(page).getByTestId("place-name")).toHaveText("Duluth International Airport");
  // Measured from the route's departure while the pilot's own position
  // is not known.
  await expect(card(page)).toContainText(/KDLH · Class [BCD] · Towered · \d+ nm NW of C81/);
  await expect(card(page).getByTestId("place-category")).toBeVisible();
  for (const id of ["fly-here", "place-weather", "place-frequencies"]) await expect(card(page).getByTestId(id)).toBeVisible();

  // Frequencies brings its section into sight, the panel all the way up.
  await card(page).getByTestId("place-frequencies").click();
  await expect(sideDrawer(page)).toHaveAttribute("data-panel", "full");
  await expect(card(page).getByText("118.300")).toBeInViewport();

  // Put away: the address forgets it, and the nav log is the panel again.
  await card(page).getByTestId("place-close").click();
  await expect(card(page)).toHaveCount(0);
  await expect(page).not.toHaveURL(/[?&]place=/);
  await expectDrawerClosed(page);
});

test("a tap on an airport on the chart opens its card, a tap elsewhere puts it away, and Fly Here makes it the destination", async ({ page }) => {
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  // Close in on the departure, where the chart's airports are drawn big
  // enough to tap: the wheel over its marker, a level at a time
  // (Leaflet zooms about the cursor, so C81 stays under it).
  const departure = page.locator(".leaflet-marker-icon", { hasText: "C81" }).first();
  await expect(departure).toBeVisible({ timeout: slow(30000) });
  const box = (await departure.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 4; i++) {
    await page.mouse.wheel(0, -60);
    await page.waitForTimeout(400);
  }
  const targets = page.locator(".leaflet-airports-pane path.leaflet-airport-target");
  await expect.poll(() => targets.count(), { timeout: slow(20000) }).toBeGreaterThan(1);
  // One whose middle nothing else covers -- not the route's own marker,
  // not the panel.
  const at = await page.evaluate(() => {
    for (const path of document.querySelectorAll(".leaflet-airports-pane path.leaflet-airport-target")) {
      const r = path.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      if (document.elementFromPoint(x, y) === path) return { x, y };
    }
    return null;
  });
  expect(at, "an airport on the chart with nothing over it").not.toBeNull();
  await page.mouse.click(at!.x, at!.y);
  await expect(page).toHaveURL(/[?&]place=[A-Z0-9]+/);
  await expect(card(page).getByTestId("place-name")).not.toBeEmpty();
  await expectDrawerOpen(page);

  // A tap on the chart elsewhere puts it away, as in Maps; the same
  // airport tapped again brings it back.
  await tapTheChart(page);
  await expect(page).not.toHaveURL(/[?&]place=/);
  await expect(card(page)).toHaveCount(0);
  await page.mouse.click(at!.x, at!.y);
  await expect(card(page).getByTestId("place-name")).not.toBeEmpty();

  // Fly Here: the field becomes the destination, from the route's
  // departure, and the card goes.
  const ident = new URL(page.url()).searchParams.get("place")!;
  await card(page).getByTestId("fly-here").click();
  await expect(page).toHaveURL(new RegExp(`[?&]dest=${ident}(&|$)`));
  await expect(page).toHaveURL(/[?&]dep=C81(&|$)/);
  await expect(page).not.toHaveURL(/[?&]place=/);
  await expect(card(page)).toHaveCount(0);
});
