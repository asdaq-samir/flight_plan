import { test, expect, type Page } from "@playwright/test";
import { grabberTo, settle, sideDrawer } from "./helpers";

/**
 * An airport's diagram in its card, as a picture (PublicationRows): the
 * whole sheet in the card, a tap away from full screen to pinch in on
 * (AirportDiagramViewer), with the FAA's PDF a tap away there -- and the
 * PDF's row again where the picture cannot be had. The card and the
 * picture are stubbed: the FAA's d-TPP is not the suite's to depend on.
 */

const PDF = "https://aeronav.faa.gov/d-tpp/2610/00125AD.PDF";
/** A diagram-shaped sheet: a d-TPP page's proportions, drawn in lines. */
const SHEET = `<svg xmlns="http://www.w3.org/2000/svg" width="1937" height="2970" viewBox="0 0 1937 2970">
  <rect width="1937" height="2970" fill="#fff"/><path d="M300 2600 L1600 400 M300 400 L1600 2600" stroke="#000" stroke-width="80"/></svg>`;

const card = (page: Page) => sideDrawer(page).getByTestId("place-card");

async function withDiagram(page: Page, picture: "drawn" | "missing") {
  await page.route(url => url.pathname.endsWith("/api/planner/airport/KDLH"), async route => {
    const answer = await route.fetch();
    const place = await answer.json();
    await route.fulfill({ response: answer, json: { ...place, airport_diagram_url: PDF, airport_diagram_cycle: "2610" } });
  });
  await page.route(url => url.pathname.includes("/api/planner/airport-diagram/"), route =>
    (picture === "drawn"
      ? route.fulfill({ status: 200, contentType: "image/svg+xml", body: SHEET })
      : route.fulfill({ status: 404, contentType: "application/json", body: '{"detail":"No airport diagram"}' })));
}

test("an airport's card shows its diagram, and a tap shows it full screen with the FAA's PDF", async ({ page }) => {
  await withDiagram(page, "drawn");
  await page.goto("/app/plan?place=KDLH");
  await settle(page);
  await grabberTo(page, "full");
  const picture = card(page).getByTestId("airport-diagram-picture");
  await picture.scrollIntoViewIfNeeded();
  await expect(picture.locator("img")).toHaveAttribute("src", "/api/planner/airport-diagram/2610/KDLH.png");
  await expect(picture).toBeEnabled();
  // The PDF is not a row of its own while the picture is there.
  await expect(card(page).getByTestId("airport-diagram")).toHaveCount(0);

  await picture.click();
  const viewer = page.getByTestId("airport-diagram-viewer");
  await expect(viewer).toBeVisible();
  await expect(viewer.getByRole("heading", { name: "KDLH airport diagram" })).toBeVisible();
  await expect(viewer.getByTestId("airport-diagram-pdf")).toHaveAttribute("href", PDF);
  // The whole sheet in sight, inside the screen.
  const sheet = viewer.locator(".leaflet-image-layer");
  await expect(sheet).toBeVisible();
  const box = (await sheet.boundingBox())!;
  const screen = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(-1);
  expect(box.x + box.width).toBeLessThanOrEqual(screen.width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(screen.height + 1);

  await viewer.getByTestId("airport-diagram-close").click();
  await expect(viewer).toHaveCount(0);
  await expect(card(page)).toBeVisible();
});

test("where the diagram's picture cannot be had, the card links the FAA's PDF", async ({ page }) => {
  await withDiagram(page, "missing");
  await page.goto("/app/plan?place=KDLH");
  await settle(page);
  await grabberTo(page, "full");
  await expect(card(page).getByTestId("airport-diagram")).toHaveAttribute("href", PDF);
  await expect(card(page).getByTestId("airport-diagram-picture")).toHaveCount(0);
});
