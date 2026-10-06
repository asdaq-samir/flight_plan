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

test("the checkpoints go to ForeFlight: its own link to the planner's pack, and the pack to download", async ({ page }) => {
  await routeWithCheckpoints(page);
  await page.getByTestId("share-route").click();
  // ForeFlight's link, which on a device with ForeFlight opens it and
  // has it download the pack from here.
  const link = new URL((await page.getByTestId("open-foreflight").getAttribute("href"))!);
  expect(link.origin + link.pathname).toBe("https://foreflight.com/content");
  const packUrl = new URL(link.searchParams.get("downloadURL")!);
  // Ending in the pack's name, which ForeFlight names the download by.
  expect(packUrl.pathname).toMatch(/^\/api\/planner\/foreflight-pack\/[A-Za-z0-9_-]+\/C81-KDLH-checkpoints\.zip$/);

  const download = page.waitForEvent("download");
  await page.getByTestId("export-foreflight").click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("C81-KDLH-checkpoints.zip");
  // A ZIP's entry names are stored as they are: a page beside the first
  // waypoint, named for it, and the course layer.
  const bytes = await (await file.createReadStream()).toArray().then(chunks => Buffer.concat(chunks));
  expect(bytes.subarray(0, 2).toString()).toBe("PK");
  expect(bytes.includes("Wingtip-C81-DLH/navdata/C81DLH01Checkpoint 1 of ")).toBe(true);
  expect(bytes.includes("Wingtip-C81-DLH/layers/C81-DLH course.kml")).toBe(true);
});
