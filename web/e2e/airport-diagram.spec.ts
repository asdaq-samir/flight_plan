import { test, expect, type Page } from "@playwright/test";
import { grabberTo, settle, settled, sideDrawer, slow } from "./helpers";

// A route's handler still running as the test ends -- the Recents and
// Saved planned ahead at idle ask the planner then -- found the page
// closed and failed the test (navlog-fit.spec, CI, 2026-10-28): the
// handlers taken off, their errors let go, as each test ends.
test.afterEach(async ({ page }) => { await page.unrouteAll({ behavior: "ignoreErrors" }); });

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

/** No photos of the field, so its runways are the card's one picture
 *  (PhotoHead) -- the first page where it has photos (places.spec). */
async function noPhotos(page: Page) {
  await page.route(url => /\/api\/planner\/airport\/[^/]+\/photos$/.test(url.pathname), route => route.fulfill({ status: 404, json: { detail: "No photos" } }));
}

/** The card's Charts tab, which takes the panel all the way up. */
async function toCharts(page: Page) {
  await card(page).getByTestId("place-tab-diagrams").click();
  await expect(sideDrawer(page)).toHaveAttribute("data-panel", "full");
}

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
  // On the Charts tab, the card's last.
  await toCharts(page);
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

test("the card's runways are a page of the pictures across its top, the FAA's diagram cropped to them, its elevation in its details, the same all the way up", async ({ page }) => {
  await withDiagram(page, "drawn");
  await withChartPages(page);
  await noPhotos(page);
  await page.goto("/app/plan?place=KDLH");
  await settle(page);
  // Half way, as every card opens, as Maps opens a place: the pictures
  // across its top (the owner's pick of the redesign, A2).
  await expect(sideDrawer(page)).toHaveAttribute("data-panel", "half");
  const sketch = card(page).getByTestId("place-runway-sketch");
  // KDLH's runways, named for a screen reader.
  await expect(sketch).toHaveAttribute("aria-label", /^KDLH runways .*09\/27.*, north up\./, { timeout: slow(15000) });
  // The ident over the pictures, and no line under it with nothing to
  // measure from (places.spec has the distance).
  await expect(card(page).getByTestId("place-name")).toHaveText("KDLH");
  await expect(card(page).getByTestId("place-line")).toHaveCount(0);
  await expect(sketch.getByTestId("place-diagram-runways")).toHaveAttribute("src", "/api/planner/airport-diagram/2610/runways/KDLH.png");
  await expect(card(page).getByTestId("place-elevation")).toContainText(/^Elevation[\d,]+ ft$/);
  const layout = async () => {
    const [head, box, call] = await Promise.all([
      card(page).getByTestId("place-head"), sketch, card(page).getByTestId("place-call"),
    ].map(async l => (await l.boundingBox())!));
    // Inside the pictures, the actions under them.
    expect(box.y).toBeGreaterThanOrEqual(head.y - 0.5);
    expect(box.y + box.height).toBeLessThanOrEqual(head.y + head.height + 0.5);
    expect(head.y + head.height).toBeLessThanOrEqual(call.y);
    return [Math.round(box.y - head.y), Math.round(call.y - head.y)];
  };
  const half = await layout();
  // All the way up, the same head, the owner's "the top half stay the
  // same as half card".
  await grabberTo(page, "full");
  await expect.poll(() => layout()).toEqual(half);

  await sketch.click();
  await expect(page.getByTestId("airport-diagram-viewer").getByRole("heading", { name: "KDLH airport diagram" })).toBeVisible();
});

test("where the diagram's picture cannot be had, the card links the FAA's PDF", async ({ page }) => {
  await withDiagram(page, "missing");
  await page.goto("/app/plan?place=KDLH");
  await settle(page);
  // On the Charts tab, the card's last.
  await toCharts(page);
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
  await toCharts(page);
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

test("the Charts tab's charts and the Chart Supplement open in the app, the field's own pages of a booklet", async ({ page }) => {
  await page.route(url => url.pathname.endsWith("/api/planner/airport/KDLH"), async route => {
    const answer = await route.fetch();
    await route.fulfill({ response: answer, json: { ...await answer.json(),
      chart_supplement_url: "https://aeronav.faa.gov/afd/03Sep2026/nc_161_03SEP2026.pdf",
      procedures: [{ kind: "MIN", name: "TAKEOFF MINIMUMS", url: "https://aeronav.faa.gov/d-tpp/2610/NC1TO.PDF" }] } });
  });
  const asked = await withChartPages(page);
  await page.goto("/app/plan?place=KDLH");
  await settle(page);
  await toCharts(page);
  const panel = card(page).getByTestId("place-charts");
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
  // Each end's number just past it, at the pilot's ask: 06 beyond the
  // south-west end, 24 beyond the north-east.
  const sketch = card(page).getByTestId("runway-sketch");
  const number = async (end: string) => sketch.locator(`[data-runway-end="${end}"]`).evaluate(t => [Number(t.getAttribute("x")), Number(t.getAttribute("y"))]);
  const [x06, y06] = await number("06");
  const [x24, y24] = await number("24");
  expect(x06).toBeLessThan(ax);
  expect(y06).toBeGreaterThan(ay);
  expect(x24).toBeGreaterThan(bx);
  expect(y24).toBeLessThan(by);
  // Looked up by end, not read in order: the order they are written in
  // is the longest runway's first, which is no business of the pilot's.
  for (const end of ["06", "24", "09", "27"]) await expect(sketch.locator(`[data-runway-end="${end}"]`)).toHaveText(end);
  await expect(sketch.locator("[data-runway-end]")).toHaveCount(4);
});


test("a field the FAA draws no diagram for has the row all the same, showing the card's sketch of its runways", async ({ page }) => {
  await page.route(url => url.pathname.endsWith("/api/planner/airport/C81"), async route => {
    const answer = await route.fetch();
    await route.fulfill({ response: answer, json: { ...await answer.json(), airport_diagram_url: null, airport_diagram_cycle: null } });
  });
  await page.goto("/app/plan?place=C81");
  await settle(page);
  await toCharts(page);
  const row = card(page).getByTestId("airport-diagram-sketch");
  await expect(row).toContainText("Airport diagram");
  await expect(row).toContainText("A sketch of the runways");
  await row.click();
  const viewer = page.getByTestId("airport-sketch-viewer");
  await expect(viewer.getByRole("heading", { name: "C81 runways" })).toBeVisible();
  // Its runways drawn across the screen, not a thumbnail's box -- measured
  // once the dialog has grown in (its zoom-in from 95%): on CI's desktop
  // it measured 1,275 of 1,280 at the animation's end.
  const sketch = viewer.getByTestId("runway-sketch");
  await expect(sketch.locator("line").first()).toBeVisible();
  await settled(viewer);
  const box = (await sketch.boundingBox())!;
  expect(box.width).toBeGreaterThan(page.viewportSize()!.width - 2);
  await expect(viewer).toContainText("Not an FAA airport diagram");
  await viewer.getByTestId("airport-sketch-close").click();
  await expect(viewer).toHaveCount(0);
});

test("a tap on the card's sketch of a field the FAA draws no diagram for shows the sketch full screen", async ({ page }) => {
  await page.route(url => url.pathname.endsWith("/api/planner/airport/C81"), async route => {
    const answer = await route.fetch();
    await route.fulfill({ response: answer, json: { ...await answer.json(), airport_diagram_url: null, airport_diagram_cycle: null } });
  });
  await noPhotos(page);
  await page.goto("/app/plan?place=C81");
  await settle(page);
  const thumbnail = card(page).getByTestId("place-runway-sketch");
  await expect(thumbnail).toHaveAccessibleName(/Runways sketch, full screen$/);
  await thumbnail.click();
  const viewer = page.getByTestId("airport-sketch-viewer");
  await expect(viewer.getByRole("heading", { name: "C81 runways" })).toBeVisible();
  await expect(viewer.getByTestId("runway-sketch").locator("line").first()).toBeVisible();
  // Not the Runways tab, which the tap used to open: the card still half
  // way, on its first tab.
  await expect(sideDrawer(page)).toHaveAttribute("data-panel", "half");
  await expect(card(page).getByTestId("place-tab-runways")).not.toHaveAttribute("data-state", "active");
  await viewer.getByTestId("airport-sketch-close").click();
  await expect(viewer).toHaveCount(0);
});
