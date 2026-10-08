import { test, expect } from "@playwright/test";
import { signInByEmail } from "./emailSignIn";
import { noTips } from "./helpers";

/**
 * Deleting an account from inside the app (App Review 5.1.1(v)): signed
 * in by email as a pilot of its own, with an airplane, the role menu's
 * Delete account asks first, then takes the account -- signed out, and
 * signing in again with the same address starts with nothing.
 */
test.use({ storageState: { cookies: [], origins: [] } });

test("Delete account asks, then deletes the account and everything in it, and signs out", async ({ page }) => {
  test.setTimeout(120_000);
  const address = `delete-${Date.now()}@example.com`;
  // The tips and the first-launch notice given, on every load: deleting
  // the account clears this device's copies of both.
  await page.addInitScript(noTips);
  await page.goto("/app/plan");
  await signInByEmail(page, address);

  // Signed in once the server says so; then an airplane of theirs, saved
  // through the app's own endpoint with the session's CSRF token.
  await expect.poll(async () => (await page.request.get("/api/me")).status()).toBe(200);
  const xsrf = (await page.context().cookies()).find(c => c.name === "XSRF-TOKEN")?.value ?? "";
  const added = await page.request.post("/api/aircraft", {
    headers: { "X-XSRF-TOKEN": decodeURIComponent(xsrf) },
    data: { tailNumber: "N12345", typeDesignator: "C172", cruiseTasKt: 110, fuelBurnGph: 8 },
  });
  expect(added.ok()).toBe(true);

  const console = page.getByTestId("console-sheet");
  if (!(await console.isVisible())) await page.getByTestId("settings-button").click();
  await console.getByTestId("role-menu").click();
  await page.getByTestId("delete-account").click();
  // Asked first: Cancel keeps it.
  await page.getByRole("alertdialog").getByRole("button", { name: "Cancel" }).click();
  expect((await page.request.get("/api/me")).status()).toBe(200);

  await console.getByTestId("role-menu").click();
  await page.getByTestId("delete-account").click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete account" }).click();

  // Signed out, here and on the server.
  await expect(page).toHaveURL(/\/app\/plan/);
  await expect.poll(async () => (await page.request.get("/api/me")).status()).toBe(401);

  // The same address again is a new pilot, with no airplanes.
  await signInByEmail(page, address);
  await expect.poll(async () => (await page.request.get("/api/me")).status()).toBe(200);
  expect(await (await page.request.get("/api/aircraft")).json()).toEqual([]);
});
