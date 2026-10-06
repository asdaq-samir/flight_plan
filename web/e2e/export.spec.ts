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
