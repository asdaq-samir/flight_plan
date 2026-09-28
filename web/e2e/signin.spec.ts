import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { DEVELOPER, signInByEmail } from "./emailSignIn";

/**
 * Signing in and out on the running stack, from a browser with no
 * session: the planner opens on the map, with sign-in one tap away in
 * the pilot console, a pilot's emailed link lands on the planner and a
 * developer's in dev mode, and either console signs out. Nothing here
 * is mocked -- the link is read from the local inbox (emailSignIn.ts).
 */
test.use({ storageState: { cookies: [], origins: [] } });

const consoleSheet = (page: Page) => page.locator('[data-slot="sheet-content"][data-side="top"]');

test("signed out, the planner opens on the map, and the sign-in is in the pilot console", async ({ page }) => {
  // The console used to come down by itself for anyone signed out,
  // over the map a pilot came to look at. It opens when asked.
  await page.goto("/app/plan");
  await expect(page.getByTestId("pilot-button")).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(consoleSheet(page)).toHaveCount(0);
  await expect(page.getByTestId("dev-switch")).toHaveCount(0);

  await page.getByTestId("pilot-button").click();
  await expect(consoleSheet(page).getByRole("button", { name: "Sign in" })).toBeVisible();
});

test("signed out, the dev page sends you to the planner", async ({ page }) => {
  await page.goto("/app/dev");
  await page.waitForURL(/\/app\/plan/);
  await expect(page.getByTestId("pilot-button")).toBeVisible();
  await expect(page.getByTestId("dev-switch")).toHaveCount(0);
});

test("a pilot's link lands on the planner, with no dev switch, and the pilot console logs out", async ({ page }) => {
  const address = `pilot-${randomUUID()}@example.com`;
  await page.goto("/app/plan");
  await signInByEmail(page, address);

  await page.waitForURL("**/app/plan**");
  await expect(page.getByLabel("Departure", { exact: true })).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(consoleSheet(page)).toHaveCount(0);
  await expect(page.getByTestId("dev-switch")).toHaveCount(0);

  await page.getByTestId("pilot-button").click();
  await expect(consoleSheet(page)).toContainText(`Signed in as ${address}`);
  await consoleSheet(page).getByRole("button", { name: "Log out" }).click();
  await expect(consoleSheet(page).getByRole("button", { name: "Sign in" })).toBeVisible();
  await page.reload();
  await expect(consoleSheet(page)).toHaveCount(0);
  await page.getByTestId("pilot-button").click();
  await expect(consoleSheet(page).getByRole("button", { name: "Sign in" })).toBeVisible();
});

test("a developer's link lands in dev mode, and the dev console logs out to the planner", async ({ page }, testInfo) => {
  // One address, so one project: two asking for its link at once would
  // each read whichever came in first. The phone's, since that is where
  // the switch and the console are squeezed hardest.
  test.skip(testInfo.project.name !== "mobile", "the developer's link is read by one project");
  await page.goto("/app/plan");
  await signInByEmail(page, DEVELOPER);

  await page.waitForURL("**/app/dev**");
  await expect(page.getByTestId("dev-switch")).toBeChecked();
  await page.getByTestId("dev-console-button").click();
  await expect(consoleSheet(page)).toContainText(`Signed in as ${DEVELOPER}`);
  await consoleSheet(page).getByRole("button", { name: "Log out" }).click();

  await page.waitForURL("**/app/plan**");
  await expect(page.getByTestId("pilot-button")).toBeVisible();
  await expect(consoleSheet(page)).toHaveCount(0);
  await expect(page.getByTestId("dev-switch")).toHaveCount(0);
});
