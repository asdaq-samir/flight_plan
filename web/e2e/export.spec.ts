import { test, expect, type Page } from "@playwright/test";
import { settle, slow, controlsInSight } from "./helpers";

/**
 * The route as a file for another app or the panel's GPS: the capsule's
 * share opens a menu of the link and the files, and a file the browser
 * cannot share is downloaded.
 */

/** C81 to KDLH, its checkpoints in, as the files go through them. */
async function routeWithCheckpoints(page: Page) {
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  await expect(page.locator(".leaflet-marker-icon", { hasText: /^1$/ }).first()).toBeVisible({ timeout: slow(30000) });
  // Share is a round button in the chips' row, all the way up.
  await controlsInSight(page);
}

test("the route exports as a Garmin flight plan through its checkpoints", async ({ page }) => {
  await routeWithCheckpoints(page);
  await page.getByTestId("share-route").click();
  const download = page.waitForEvent("download");
  await page.getByTestId("export-fpl").click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("C81-KDLH.fpl");
  const text = await (await file.createReadStream()).toArray().then(chunks => Buffer.concat(chunks).toString());
  expect(text).toContain("<waypoint-identifier>C81</waypoint-identifier>");
  expect(text).toContain("<waypoint-identifier>KDLH</waypoint-identifier>");
  // Each field's ICAO region from the FAA's CIFP, which tells a panel
  // which of two of a name is meant; a checkpoint a user waypoint named
  // from its own name, its region empty, as the schema asks.
  expect(text).toContain("<identifier>KDLH</identifier>\n      <type>AIRPORT</type>\n      <country-code>K3</country-code>");
  expect(text).toContain("<identifier>C81</identifier>\n      <type>AIRPORT</type>\n      <country-code>K5</country-code>");
  expect(text).toMatch(/<identifier>[A-Z0-9]{1,6}<\/identifier>\n {6}<type>USER WAYPOINT<\/type>\n {6}<country-code><\/country-code>/);
  // The route's name and comments in Garmin's characters.
  for (const m of text.matchAll(/<(comment|route-name)>([^<]*)</g)) expect(m[2]).toMatch(/^[A-Z0-9 /]{0,25}$/);
});

/** A file the route's menu item downloads, its name and its text. */
async function downloaded(page: Page, testId: string): Promise<{ name: string; text: string }> {
  await page.getByTestId("share-route").click();
  const download = page.waitForEvent("download");
  await page.getByTestId(testId).click();
  const file = await download;
  return { name: file.suggestedFilename(), text: await (await file.createReadStream()).toArray().then(chunks => Buffer.concat(chunks).toString()) };
}

test("the route goes to a panel's own card: a GTN's flight plan and checkpoints, a Dynon's, and a GPX, each item saying where it goes", async ({ page }) => {
  await routeWithCheckpoints(page);
  await page.getByTestId("share-route").click();
  // Under each item, the one line it needs: where the file goes.
  await expect(page.getByTestId("export-gfp")).toContainText("In an FPL folder on the SD card");
  await expect(page.getByTestId("export-user-wpt")).toContainText("At the SD card's top level");
  await expect(page.getByTestId("export-gpx")).toContainText("on a USB stick");
  await page.keyboard.press("Escape");

  // The GTN's: one line of Garmin's characters (190-01007-F0), the fields
  // and each checkpoint at its place.
  const gfp = await downloaded(page, "export-gfp");
  expect(gfp.name).toBe("C81-KDLH.gfp");
  expect(gfp.text).toMatch(/^FPN\/RI:F:C81,N\d{5}W\d{6}(:F:N\d{5}W\d{6})+:F:KDLH,N\d{5}W\d{6}$/);
  // Its checkpoints for the card's top level: name, comment, place.
  const wpt = await downloaded(page, "export-user-wpt");
  expect(wpt.name).toBe("user.wpt");
  const rows = wpt.text.split("\r\n").filter(Boolean);
  expect(rows.length).toBe(gfp.text.match(/:F:N/g)!.length);
  for (const row of rows) expect(row).toMatch(/^[A-Z0-9]{1,6},[A-Z0-9 /]{0,25},4\d\.\d{6},-\d{2}\.\d{6}$/);
  // A SkyView's: Dynon's header, then the same checkpoints.
  const dynon = await downloaded(page, "export-dynon");
  expect(dynon.name).toBe("C81-KDLH-waypoints.csv");
  expect(dynon.text.split("\r\n")[0]).toBe("Short Name, Long Name, Latitude, Longitude, Altitude, Icon, Narrative Text, Dynon User Waypoints File v1.0,");
  expect(dynon.text.split("\r\n").filter(Boolean)).toHaveLength(rows.length + 1);
  // The GPX: one route, every point, the checkpoints by the same names.
  const gpx = await downloaded(page, "export-gpx");
  expect(gpx.text.match(/<rte>/g)).toHaveLength(1);
  for (const row of rows) expect(gpx.text).toContain(`<name>${row.split(",")[0]}</name>`);
});

test("Open in Garmin Pilot hands the Garmin flight plan to the share sheet, here a download", async ({ page }) => {
  await routeWithCheckpoints(page);
  const file = await downloaded(page, "open-garmin-pilot");
  expect(file.name).toBe("C81-KDLH.fpl");
  expect(file.text).toContain(`<flight-plan xmlns="http://www8.garmin.com/xmlschemas/FlightPlan/v1">`);
});

test("the route goes to ForeFlight in one button: its checkpoints' pack the first time, then the route by their names", async ({ page }) => {
  await routeWithCheckpoints(page);
  await page.getByTestId("share-route").click();
  // The first time, ForeFlight's content-pack link, to the pack on this server.
  const open = page.getByTestId("open-foreflight");
  const packLink = new URL((await open.getAttribute("href"))!);
  expect(packLink.origin + packLink.pathname).toBe("https://foreflight.com/content");
  expect(new URL(packLink.searchParams.get("downloadURL")!).pathname).toMatch(/\/C81-KDLH-checkpoints\.zip$/);
  await page.route(url => url.hostname === "foreflight.com", route => route.fulfill({ status: 200, contentType: "text/html", body: "ForeFlight" }));
  await open.click();
  await expect(page).toHaveURL(/foreflight\.com\/content/);

  // Back, and the same button opens the route, each checkpoint by its
  // name in the pack.
  await routeWithCheckpoints(page);
  await page.getByTestId("share-route").click();
  const routeLink = (await page.getByTestId("open-foreflight").getAttribute("href"))!;
  expect(routeLink).toMatch(/^foreflightmobile:\/\/maps\/search\?q=C81\+(CONTPACK@[A-Z0-9_]{3,}\+)+KDLH(\+\d+ft)?$/);
  await expect(page.getByTestId("foreflight-pack")).toHaveText("Send the checkpoints again");

  const download = page.waitForEvent("download");
  await page.getByTestId("export-foreflight").click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("C81-KDLH-checkpoints.zip");
  // A ZIP's entry names are stored as they are: a page beside the first
  // waypoint, named for it, and the course layer.
  const bytes = await (await file.createReadStream()).toArray().then(chunks => Buffer.concat(chunks));
  expect(bytes.subarray(0, 2).toString()).toBe("PK");
  // Named for its place where the place names know it, else the route and its number.
  expect(bytes.toString("latin1")).toMatch(/C81-KDLH-checkpoints\/navdata\/[A-Z0-9_]{3,}Checkpoint 1 of /);
  expect(bytes.includes("C81-KDLH-checkpoints/layers/C81-DLH course.kml")).toBe(true);
});
