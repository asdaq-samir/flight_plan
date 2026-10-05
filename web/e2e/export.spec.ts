import { test, expect, type Page } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
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

test("the checkpoints export as a ForeFlight content pack: waypoints, a page each, and the course", async ({ page }) => {
  await routeWithCheckpoints(page);
  await page.getByTestId("share-route").click();
  const download = page.waitForEvent("download");
  await page.getByTestId("export-foreflight").click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("C81-KDLH-checkpoints.zip");
  const zip = unzipSync(new Uint8Array(await (await file.createReadStream()).toArray().then(chunks => Buffer.concat(chunks))));
  const paths = Object.keys(zip);
  expect(paths).toContain("Wingtip-C81-DLH/manifest.json");
  expect(paths).toContain("Wingtip-C81-DLH/layers/C81-DLH course.kml");
  const waypoints = strFromU8(zip["Wingtip-C81-DLH/navdata/Checkpoints.kml"]!);
  const names = [...waypoints.matchAll(/<name>(C81DLH\d+)<\/name>/g)].map(m => m[1]!);
  expect(names.length).toBeGreaterThan(0);
  // A page beside each waypoint, named for it.
  for (const name of names) expect(paths.some(p => p.startsWith(`Wingtip-C81-DLH/navdata/${name}Checkpoint `))).toBe(true);
});
