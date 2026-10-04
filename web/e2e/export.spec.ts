import { test, expect } from "@playwright/test";
import { settle, slow } from "./helpers";

/**
 * The route as a file for another app or the panel's GPS: the capsule's
 * share opens a menu of the link and the two files, and a file the
 * browser cannot share is downloaded.
 */

test("the route exports as a Garmin flight plan through its checkpoints", async ({ page }) => {
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  // The checkpoints in, as the file goes through them.
  await expect(page.locator(".leaflet-marker-icon", { hasText: /^1$/ }).first()).toBeVisible({ timeout: slow(30000) });
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
