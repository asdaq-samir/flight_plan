import { test, expect, type Page } from "@playwright/test";
import { settle, slow, controlsInSight } from "./helpers";

/**
 * The route to ForeFlight, which sends it on to the panel's GPS
 * wirelessly, by ForeFlight's own links.
 */

/** C81 to KDLH, its checkpoints in, as the files go through them. */
async function routeWithCheckpoints(page: Page) {
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  await expect(page.locator(".maplibregl-marker", { hasText: /^1$/ }).first()).toBeVisible({ timeout: slow(30000) });
  // Share is a round button in the chips' row, all the way up.
  await controlsInSight(page);
}

test("the route goes to the panel through ForeFlight, with no Garmin Pilot item and no files for an SD card or a USB stick", async ({ page }) => {
  await routeWithCheckpoints(page);
  await page.getByTestId("share-route").click();
  await expect(page.getByTestId("open-foreflight")).toBeVisible();
  // The owner's calls (2026-11-02): wireless through ForeFlight, which
  // most pilots have; no Garmin Pilot, no SD card or USB stick.
  for (const id of ["open-garmin-pilot", "export-fpl", "export-gfp", "export-gpx", "export-user-wpt", "export-dynon"]) await expect(page.getByTestId(id)).toHaveCount(0);
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
