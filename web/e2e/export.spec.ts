import { test, expect, type Page } from "@playwright/test";
import { settle, slow } from "./helpers";

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
  expect(text).toContain("<waypoint-identifier>CP01</waypoint-identifier>");
});

test("the route goes to ForeFlight: its own link with the checkpoints in the flight plan, and the checkpoints' pack to download", async ({ page }) => {
  await routeWithCheckpoints(page);
  await page.getByTestId("share-route").click();
  // ForeFlight's maps link: the route in order, each checkpoint at its place.
  const link = (await page.getByTestId("open-foreflight").getAttribute("href"))!;
  expect(link).toMatch(/^foreflightmobile:\/\/maps\/search\?q=C81\+(-?\d+\.\d{4}\/-?\d+\.\d{4}\+)+KDLH(\+\d+ft)?$/);
  // And ForeFlight's content-pack link, to the pack on this server.
  const packLink = new URL((await page.getByTestId("foreflight-pack").getAttribute("href"))!);
  expect(packLink.origin + packLink.pathname).toBe("https://foreflight.com/content");
  expect(new URL(packLink.searchParams.get("downloadURL")!).pathname).toMatch(/\/C81-KDLH-checkpoints\.zip$/);

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
