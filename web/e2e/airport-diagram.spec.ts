import { test, expect, type Page } from "@playwright/test";
import { grabberTo, settle, sideDrawer, slow } from "./helpers";

/**
 * An airport's diagram in its card, as a picture (PublicationRows): the
 * whole sheet in the card, a tap away from full screen to pinch in on
 * (ChartViewer) -- and where the picture cannot be had, a row that draws
 * the FAA's PDF in the app instead. Every other chart and the Chart
 * Supplement show in the app too, nothing leading out of it. The card and
 * the pictures are stubbed: the FAA's publications are not the suite's
 * to depend on.
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

test("an airport's card shows its diagram, and a tap shows it full screen, in the app", async ({ page }) => {
  await withDiagram(page, "drawn");
  await page.goto("/app/plan?place=KDLH");
  await settle(page);
  await grabberTo(page, "full");
  // Under the Diagrams tab, the card's last.
  await card(page).getByTestId("place-tab-diagrams").click();
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
  // Nothing in it leads out of the app.
  await expect(viewer.locator("a[href^='http']")).toHaveCount(0);
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

test("the card's sketch of the runways sits over Call and Address, their width, and a tap shows the diagram", async ({ page }) => {
  await withDiagram(page, "drawn");
  await withChartPages(page);
  await page.goto("/app/plan?place=KDLH");
  await settle(page);
  const sketch = card(page).getByTestId("place-runway-sketch");
  // KDLH's runways, named for a screen reader.
  await expect(sketch.getByTestId("runway-sketch")).toHaveAttribute("aria-label", /^Runways .*09\/27.*, north up$/, { timeout: slow(15000) });
  const [box, call, address] = await Promise.all([sketch, card(page).getByTestId("place-call"), card(page).getByTestId("place-address")]
    .map(async l => (await l.boundingBox())!));
  expect(Math.abs(box.x - call.x)).toBeLessThan(1);
  expect(Math.abs(box.x + box.width - (address.x + address.width))).toBeLessThan(1);
  expect(box.y + box.height).toBeLessThanOrEqual(call.y);
  // The line under the name beside it.
  await expect(card(page)).toContainText(/KDLH · Class [BCD] · Towered/);

  await sketch.click();
  await expect(page.getByTestId("airport-diagram-viewer").getByRole("heading", { name: "KDLH airport diagram" })).toBeVisible();
});

test("where the diagram's picture cannot be had, the card links the FAA's PDF", async ({ page }) => {
  await withDiagram(page, "missing");
  await page.goto("/app/plan?place=KDLH");
  await settle(page);
  await grabberTo(page, "full");
  // Under the Diagrams tab, the card's last.
  await card(page).getByTestId("place-tab-diagrams").click();
  await expect(card(page).getByTestId("airport-diagram-picture")).toHaveCount(0);
  // A row that draws the FAA's PDF in the app instead, not a link out.
  const row = card(page).getByTestId("airport-diagram");
  await expect(row).not.toHaveAttribute("href", /.*/);
  await withChartPages(page);
  await row.click();
  await expect(page.getByTestId("airport-diagram-viewer").locator(".leaflet-image-layer")).toHaveCount(2);
});

/** The planner's pages for any FAA chart asked for: two, as a region's
 *  booklet gives a field's, each a sheet. */
async function withChartPages(page: Page) {
  const asked: string[] = [];
  await page.route(url => url.pathname.endsWith("/api/planner/faa-chart"), route => {
    asked.push(new URL(route.request().url()).searchParams.get("url") ?? "");
    return route.fulfill({ json: { pages: [1, 2].map(n => ({ source: "dtpp", edition: "2610", pdf: "EC3TO.PDF", page: n, width: 1937, height: 2970 })) } });
  });
  await page.route(url => url.pathname.includes("/api/planner/faa-chart/page/"), route =>
    route.fulfill({ status: 200, contentType: "image/svg+xml", body: SHEET }));
  return asked;
}

test("the Diagrams tab's charts and the Chart Supplement open in the app, the field's own pages of a booklet", async ({ page }) => {
  await page.route(url => url.pathname.endsWith("/api/planner/airport/KDLH"), async route => {
    const answer = await route.fetch();
    await route.fulfill({ response: answer, json: { ...await answer.json(),
      chart_supplement_url: "https://aeronav.faa.gov/afd/03Sep2026/nc_161_03SEP2026.pdf",
      procedures: [{ kind: "MIN", name: "TAKEOFF MINIMUMS", url: "https://aeronav.faa.gov/d-tpp/2610/NC1TO.PDF" }] } });
  });
  const asked = await withChartPages(page);
  await page.goto("/app/plan?place=KDLH");
  await settle(page);
  await card(page).getByTestId("place-tab-diagrams").click();
  const panel = card(page).getByRole("tabpanel");
  // No link out of the app in the tab.
  await expect(panel.getByTestId("terminal-chart")).toHaveText(/TAKEOFF MINIMUMS/, { timeout: slow(15000) });
  await expect(panel.locator("a[href^='http']")).toHaveCount(0);

  await panel.getByTestId("terminal-chart").click();
  const viewer = page.getByTestId("airport-diagram-viewer");
  await expect(viewer.getByRole("heading", { name: "TAKEOFF MINIMUMS" })).toBeVisible();
  await expect(viewer.locator(".leaflet-image-layer")).toHaveCount(2);
  await viewer.getByTestId("airport-diagram-close").click();

  await panel.getByTestId("chart-supplement").click();
  await expect(viewer.getByRole("heading", { name: "Chart Supplement" })).toBeVisible();
  expect(asked).toEqual(["https://aeronav.faa.gov/d-tpp/2610/NC1TO.PDF", "https://aeronav.faa.gov/afd/03Sep2026/nc_161_03SEP2026.pdf"]);
});
