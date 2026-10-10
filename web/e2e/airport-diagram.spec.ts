import { test, expect, type Page } from "@playwright/test";
import { grabberTo, settle, sideDrawer, slow } from "./helpers";

/**
 * An airport's diagram in its card, a row as the Chart Supplement's is
 * (PublicationRows), a tap away from full screen to pinch in on
 * (ChartViewer) -- the FAA's PDF drawn in the app where the picture
 * cannot be had, and the card's own sketch of the runways where the FAA
 * publishes none. Every other chart and the Chart Supplement show in the
 * app too, nothing leading out of it. The card and the pictures are
 * stubbed: the FAA's publications are not the suite's to depend on.
 */

const PDF = "https://aeronav.faa.gov/d-tpp/2610/00125AD.PDF";
/** A diagram-shaped sheet: a d-TPP page's proportions, drawn in lines. */
const SHEET = `<svg xmlns="http://www.w3.org/2000/svg" width="1937" height="2970" viewBox="0 0 1937 2970">
  <rect width="1937" height="2970" fill="#fff"/><path d="M300 2600 L1600 400 M300 400 L1600 2600" stroke="#000" stroke-width="80"/></svg>`;

const card = (page: Page) => sideDrawer(page).getByTestId("place-card");

async function withDiagram(page: Page, picture: "drawn" | "missing", pdf = true) {
  await page.route(url => url.pathname.endsWith("/api/planner/airport/KDLH"), async route => {
    const answer = await route.fetch();
    const place = await answer.json();
    // A report of its own, so the card wears its weather's chip whatever
    // aviationweather.gov says of KDLH today.
    const metar = { raw: "KDLH 102155Z 27008KT 10SM CLR 12/02 A3001", flight_category: "VFR" };
    await route.fulfill({ response: answer, json: { ...place, metar, weather_unavailable: false, airport_diagram_url: pdf ? PDF : null, airport_diagram_cycle: "2610" } });
  });
  await page.route(url => url.pathname.includes("/api/planner/airport-diagram/"), route =>
    (picture === "drawn"
      ? route.fulfill({ status: 200, contentType: "image/svg+xml", body: SHEET })
      : route.fulfill({ status: 404, contentType: "application/json", body: '{"detail":"No airport diagram"}' })));
}

test("an airport's card has its diagram as a row, and a tap shows it full screen, in the app", async ({ page }) => {
  await withDiagram(page, "drawn");
  await page.goto("/app/plan?place=KDLH");
  await settle(page);
  await grabberTo(page, "full");
  // Under the Diagrams tab, the card's last.
  await card(page).getByTestId("place-tab-diagrams").click();
  // A row, as the Chart Supplement's is, not the sheet itself in the tab.
  const row = card(page).getByTestId("airport-diagram");
  await row.scrollIntoViewIfNeeded();
  await expect(row).toHaveText(/^Airport diagram/);
  await expect(card(page).getByTestId("chart-supplement")).toBeVisible();
  await expect(card(page).locator("img[src*='/airport-diagram/2610/KDLH.png']")).toHaveCount(0);

  await row.click();
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

test("the card's sketch of the runways sits between the name and the close, star and weather chip stacked at the right, over the tiles, with the elevation at its top left", async ({ page }) => {
  await withDiagram(page, "drawn");
  await withChartPages(page);
  await page.goto("/app/plan?place=KDLH");
  await settle(page);
  const sketch = card(page).getByTestId("place-runway-sketch");
  // KDLH's runways, named for a screen reader.
  await expect(sketch).toHaveAttribute("aria-label", /^KDLH runways .*09\/27.*, north up\./, { timeout: slow(15000) });
  // The ident's pill at the end of the name, and no line under it with nothing
  // to measure from (places.spec has the distance); the elevation, "Elev"
  // and the figure and its feet, at the sketch's top left.
  const name = card(page).getByTestId("place-name");
  await expect(name).toHaveText("Duluth International Airport KDLH");
  await expect(card(page).getByTestId("place-line")).toHaveCount(0);
  // The FAA's diagram cropped to its runways, the field having one.
  await expect(sketch.getByTestId("place-diagram-runways")).toHaveAttribute("src", "/api/planner/airport-diagram/2610/runways/KDLH.png");
  const elevation = card(page).getByTestId("place-elevation");
  // "Elev 788 ft" to the eye, "Elevation 788 ft" to a screen reader.
  await expect(elevation).toHaveText(/Elevation [\d,]+ ft$/);
  await expect(elevation.locator('[aria-hidden="true"]')).toHaveText("Elev");
  const [height, box, named, close, star, chip, call] = await Promise.all([
    elevation, sketch, name, card(page).getByTestId("place-close"), card(page).getByTestId("place-favorite"),
    card(page).getByTestId("place-category"), card(page).getByTestId("place-call"),
  ].map(async l => (await l.boundingBox())!));
  // The name, then the sketch from the card's top, then the column: the
  // close, the star under it and the weather's chip under that, their
  // right edges one.
  expect(box.x).toBeGreaterThan(named.x + named.width - 1);
  expect(Math.abs(box.y - close.y)).toBeLessThan(1);
  expect(box.x + box.width).toBeLessThan(Math.min(close.x, star.x, chip.x));
  expect(star.y).toBeGreaterThan(close.y + close.height - 1);
  expect(chip.y).toBeGreaterThan(star.y + star.height - 1);
  // One width, the star's, so the sketch reaches as far right as it can.
  for (const b of [star, chip]) {
    expect(Math.abs(b.x + b.width - (close.x + close.width))).toBeLessThan(1.5);
    expect(Math.abs(b.width - close.width)).toBeLessThan(1);
  }
  expect(height.x).toBeLessThan(box.x + 12);
  expect(height.y).toBeLessThan(box.y + 12);
  expect(box.y + box.height).toBeLessThanOrEqual(call.y);

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
  // And the card's own sketch of the runways where the crop is not had.
  await expect(card(page).getByTestId("runway-sketch")).toBeVisible();
  await expect(card(page).getByTestId("place-diagram-runways")).toHaveCount(0);
  // A row that draws the FAA's PDF in the app instead, not a link out.
  const row = card(page).getByTestId("airport-diagram");
  await expect(row).not.toHaveAttribute("href", /.*/);
  await withChartPages(page);
  await row.click();
  await expect(page.getByTestId("airport-diagram-viewer").locator(".leaflet-image-layer")).toHaveCount(2);
});

test("where the picture cannot be had and the FAA gives no PDF, the row says the diagram could not be loaded", async ({ page }) => {
  await withDiagram(page, "missing", false);
  await page.goto("/app/plan?place=KDLH");
  await settle(page);
  await grabberTo(page, "full");
  await card(page).getByTestId("place-tab-diagrams").click();
  const row = card(page).getByTestId("airport-diagram");
  await row.scrollIntoViewIfNeeded();
  await row.click();
  await expect(row).toContainText("The airport diagram could not be loaded");
  await expect(page.getByTestId("airport-diagram-viewer")).toHaveCount(0);
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

test("the card's sketch draws a runway's turf green, C81's south-west 1,000 ft of its 06/24", async ({ page }) => {
  // The planner's answer as it reads the FAA's remarks ("SW 1000 FT
  // TURF-GRVL."), whatever this stack's remarks file says.
  await page.route(url => url.pathname.endsWith("/api/planner/airport/C81"), async route => {
    const answer = await route.fetch();
    const place = await answer.json();
    for (const runway of place.runways) runway.turf = runway.ends === "06/24" ? [{ end: "06", from_ft: 0, to_ft: 1000 }] : [];
    await route.fulfill({ response: answer, json: { ...place, airport_diagram_url: null, airport_diagram_cycle: null } });
  });
  await page.goto("/app/plan?place=C81");
  await settle(page);
  const turf = card(page).getByTestId("runway-sketch").locator("[data-turf]");
  await expect(turf).toHaveCount(1, { timeout: slow(15000) });
  // From 06's end, south-west of the field, a little over a quarter of
  // the runway's length.
  const [x1, y1, x2, y2] = await turf.evaluate(line => ["x1", "y1", "x2", "y2"].map(a => Number(line.getAttribute(a))));
  const runway = card(page).getByTestId("runway-sketch").locator("g").first().locator("line").first();
  const [ax, ay, bx, by] = await runway.evaluate(line => ["x1", "y1", "x2", "y2"].map(a => Number(line.getAttribute(a))));
  expect(x1).toBeCloseTo(ax, 1);
  expect(y1).toBeCloseTo(ay, 1);
  expect(Math.hypot(x2 - x1, y2 - y1) / Math.hypot(bx - ax, by - ay)).toBeCloseTo(1000 / 3573, 1);
  // The south-west end: left of and below the other.
  expect(ax).toBeLessThan(bx);
  expect(ay).toBeGreaterThan(by);
});


test("a field the FAA draws no diagram for has the row all the same, showing the card's sketch of its runways", async ({ page }) => {
  await page.route(url => url.pathname.endsWith("/api/planner/airport/C81"), async route => {
    const answer = await route.fetch();
    await route.fulfill({ response: answer, json: { ...await answer.json(), airport_diagram_url: null, airport_diagram_cycle: null } });
  });
  await page.goto("/app/plan?place=C81");
  await settle(page);
  await grabberTo(page, "full");
  await card(page).getByTestId("place-tab-diagrams").click();
  const row = card(page).getByTestId("airport-diagram-sketch");
  await expect(row).toContainText("Airport diagram");
  await expect(row).toContainText("A sketch of the runways");
  await row.click();
  const viewer = page.getByTestId("airport-sketch-viewer");
  await expect(viewer.getByRole("heading", { name: "C81 runways" })).toBeVisible();
  // Its runways drawn across the screen, not a thumbnail's box.
  const sketch = viewer.getByTestId("runway-sketch");
  await expect(sketch.locator("line").first()).toBeVisible();
  const box = (await sketch.boundingBox())!;
  expect(box.width).toBeGreaterThan(page.viewportSize()!.width - 2);
  await expect(viewer).toContainText("Not an FAA airport diagram");
  await viewer.getByTestId("airport-sketch-close").click();
  await expect(viewer).toHaveCount(0);
});
