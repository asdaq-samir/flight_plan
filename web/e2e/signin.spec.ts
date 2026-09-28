import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { DEVELOPER, signInByEmail } from "./emailSignIn";

/**
 * Signing in and out on the running stack, from a browser with no
 * session: the planner opens on the pilot console's sign-in, a pilot's
 * emailed link lands on the planner and a developer's in dev mode,
 * and either console signs out. Nothing here is mocked -- the link is
 * read from the local inbox (emailSignIn.ts).
 */
test.use({ storageState: { cookies: [], origins: [] } });

const consoleSheet = (page: Page) => page.locator('[data-slot="sheet-content"][data-side="top"]');

test("signed out, the planner opens on the pilot console's sign-in, and once put away it stays away", async ({ page }) => {
  await page.goto("/app/plan");
  await expect(consoleSheet(page)).toBeVisible();
  await expect(consoleSheet(page).getByRole("button", { name: "Sign in" })).toBeVisible();
  await expect(page.getByTestId("dev-switch")).toHaveCount(0);

  await page.keyboard.press("Escape");
  await expect(consoleSheet(page)).toHaveCount(0);
  await page.waitForTimeout(1500);
  await expect(consoleSheet(page)).toHaveCount(0);
});

test("signed out, the dev page sends you to the planner and its sign-in", async ({ page }) => {
  await page.goto("/app/dev");
  await page.waitForURL(/\/app\/plan/);
  await expect(consoleSheet(page).getByRole("button", { name: "Sign in" })).toBeVisible();
});

test("a pilot's link lands on the planner, with no dev switch, and the pilot console logs out", async ({ page }) => {
  const address = `pilot-${randomUUID()}@example.com`;
  await page.goto("/app/plan");
  await expect(consoleSheet(page)).toBeVisible();
  await signInByEmail(page, address);

  await page.waitForURL("**/app/plan**");
  await expect(page.getByLabel("Departure", { exact: true })).toBeVisible();
  // Signed in, the console no longer opens by itself.
  await page.waitForTimeout(1500);
  await expect(consoleSheet(page)).toHaveCount(0);
  await expect(page.getByTestId("dev-switch")).toHaveCount(0);

  await page.getByTestId("pilot-button").click();
  await expect(consoleSheet(page)).toContainText(`Signed in as ${address}`);
  await consoleSheet(page).getByRole("button", { name: "Log out" }).click();
  await expect(consoleSheet(page).getByRole("button", { name: "Sign in" })).toBeVisible();
  await page.reload();
  await expect(consoleSheet(page).getByRole("button", { name: "Sign in" })).toBeVisible();
});

test("a developer's link lands in dev mode, and the dev console logs out to the planner", async ({ page }, testInfo) => {
  // One address, so one project: two asking for its link at once would
  // each read whichever came in first. The phone's, since that is where
  // the switch and the console are squeezed hardest.
  test.skip(testInfo.project.name !== "mobile", "the developer's link is read by one project");
  await page.goto("/app/plan");
  await expect(consoleSheet(page)).toBeVisible();
  await signInByEmail(page, DEVELOPER);

  await page.waitForURL("**/app/dev**");
  await expect(page.getByTestId("dev-switch")).toBeChecked();
  await page.getByTestId("dev-console-button").click();
  await expect(consoleSheet(page)).toContainText(`Signed in as ${DEVELOPER}`);
  await consoleSheet(page).getByRole("button", { name: "Log out" }).click();

  await page.waitForURL("**/app/plan**");
  await expect(consoleSheet(page).getByRole("button", { name: "Sign in" })).toBeVisible();
  await expect(page.getByTestId("dev-switch")).toHaveCount(0);
});
