import { test, expect, type Page } from "@playwright/test";
import { consoleSheet } from "./helpers";

/**
 * The pilot console's Practice pages (the Guide tab): the flash-card
 * drills (lib/drills), the holding entries (lib/holding) and the
 * lost-comms rules (lib/lostComms). Nothing here asks a server.
 */
async function practicePage(page: Page, name: string) {
  await page.goto("/app/plan");
  await page.getByTestId("settings-button").click();
  const sheet = consoleSheet(page);
  await sheet.getByRole("tab", { name: "Guide" }).click();
  await sheet.getByRole("button", { name: new RegExp(`^${name}`) }).click();
  await expect(sheet.getByRole("heading", { name, exact: true })).toBeVisible();
  return sheet;
}

test("a light-gun card: the light, its meaning on showing, and the next card on Knew it", async ({ page }) => {
  const sheet = await practicePage(page, "Light gun signals");
  const prompt = sheet.getByTestId("drill-prompt");
  const first = await prompt.innerText();
  expect(first).toMatch(/^(Steady|Flashing|Alternating)/);
  await sheet.getByTestId("drill-reveal").click();
  await expect(sheet.getByTestId("drill-answer")).not.toBeEmpty();
  await sheet.getByTestId("drill-knew").click();
  await expect(prompt).not.toHaveText(first);
  await expect(sheet.getByText("11 to go")).toBeVisible();
});

test("a hold's entry from the heading to the fix, and its outbound time in the wind", async ({ page }) => {
  const sheet = await practicePage(page, "Holding entries");
  // The page opens on a right-turn hold inbound on 360, arriving on 220.
  await expect(sheet.getByTestId("hold-entry")).toContainText("Parallel entry");
  await expect(sheet.getByTestId("hold-diagram")).toBeVisible();
  await sheet.getByTestId("hold-heading").fill("150");
  await expect(sheet.getByTestId("hold-entry")).toContainText("Teardrop entry");
  await expect(sheet.getByTestId("hold-entry")).toContainText("150°");
  // Left turns put the holding side to the west: from the north-west, a parallel entry.
  await sheet.getByTestId("hold-turns").getByText("Left").click();
  await expect(sheet.getByTestId("hold-entry")).toContainText("Parallel entry");
  await sheet.getByTestId("hold-heading").fill("270");
  await expect(sheet.getByTestId("hold-entry")).toContainText("Direct entry");
  // A 20 kt headwind on the inbound leg at 100 kt: 40 seconds outbound.
  await sheet.getByTestId("hold-wind-from").fill("360");
  await sheet.getByTestId("hold-wind-kt").fill("20");
  await expect(sheet.getByTestId("hold-out-time")).toContainText("40 s");
});

test("lost comms: each segment at the highest altitude, and when to leave the limit", async ({ page }) => {
  const sheet = await practicePage(page, "Lost communications");
  const fly = sheet.getByTestId("lost-segment-fly");
  await expect(fly.nth(0)).toHaveText("Fly 4,000 ft: assigned");
  await expect(fly.nth(1)).toHaveText("Fly 6,000 ft: expected");
  // The expected altitude from the first segment on.
  await fly.nth(0).click();
  await expect(fly.nth(0)).toHaveText("Fly 6,000 ft: expected");
  await expect(sheet.getByTestId("lost-leave")).toContainText("Leave the clearance limit on arriving over it");
  await sheet.getByTestId("lost-approach-fix").click();
  await sheet.getByTestId("lost-efc").fill("1420Z");
  await expect(sheet.getByTestId("lost-leave")).toContainText("expect-further-clearance time, 1420Z");
});
