import { test, expect, type Page } from "@playwright/test";
import { openSettings } from "./helpers";

/**
 * Who is offered the developer's workspace.
 *
 * The training workspace and the developer console are work on the
 * model, not on a flight, so a pilot should not see the way in. The
 * switch asks two questions and either answer is enough: does the
 * signed-in pilot hold the developer role, and is this deployment open
 * to everyone (one that says so, app.open-writes).
 *
 * That second one is not a loophole. With no Google or Apple
 * credentials and no mail host there is no way to hold a role, and
 * hiding the switch would hide it from the only person who could use
 * it. A deployment that cannot sign anyone in and did not say to open
 * up refuses the developer's paths, and does not offer them. Every case
 * below is reached by mocking those two endpoints, because a running
 * stack can only be in one of them (the local one signs in: see
 * signin.spec.ts for it unmocked).
 */

const devSwitch = (page: Page) => page.getByTestId("dev-switch");

/** The settings drawn without the switch: the pilot button is there
 *  (the header has rendered with who is signed in known), and the
 *  switch has not followed within a moment. It used to be a flat three
 *  seconds. */
async function noDevSwitch(page: Page) {
  await expect(page.getByTestId("pilot-button")).toBeVisible();
  await openSettings(page);
  await page.waitForTimeout(500);
  await expect(devSwitch(page)).toHaveCount(0);
}

async function withAuth(page: Page, opts: { access: "SIGN_IN" | "OPEN" | "CLOSED"; pilot: object | null }) {
  await page.route("**/api/auth/capabilities", route =>
    route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ access: opts.access, oauthConfigured: opts.access === "SIGN_IN" }),
    }));
  await page.route("**/api/me", route =>
    opts.pilot
      ? route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(opts.pilot) })
      : route.fulfill({ status: 401, body: "" }));
}

const A_PILOT = { id: 1, email: "pilot@example.com", displayName: "A Pilot", developer: false };
const A_DEVELOPER = { id: 2, email: "dev@example.com", displayName: "A Developer", developer: true };

test("with no way to sign in and everything opened, the switch is there", async ({ page }) => {
  await withAuth(page, { access: "OPEN", pilot: null });
  await page.goto("/app/plan");
  await openSettings(page);
  await expect(devSwitch(page)).toBeVisible({ timeout: 15000 });
});

test("with no way to sign in and nothing opened, it is not: every developer path there is refused", async ({ page }) => {
  // It read only "can anyone sign in", so a closed deployment offered a
  // workspace whose every write and status read was refused.
  await withAuth(page, { access: "CLOSED", pilot: null });
  await page.goto("/app/plan");
  await noDevSwitch(page);
});

test("where signing in is possible, a caller with no session does not get it", async ({ page }) => {
  await withAuth(page, { access: "SIGN_IN", pilot: null });
  await page.goto("/app/plan");
  await noDevSwitch(page);
});

test("a signed-in pilot does not get it either", async ({ page }) => {
  // The case this exists for: one user becomes two, and the second one
  // is a pilot who has no business retraining a model.
  await withAuth(page, { access: "SIGN_IN", pilot: A_PILOT });
  await page.goto("/app/plan");
  await noDevSwitch(page);
});

test("a signed-in developer does", async ({ page }) => {
  await withAuth(page, { access: "SIGN_IN", pilot: A_DEVELOPER });
  await page.goto("/app/plan");
  await openSettings(page);
  await expect(devSwitch(page)).toBeVisible({ timeout: 15000 });
});

test("the header holds together without it", async ({ page }) => {
  // The switch led the header once, and now lives in the settings.
  // For a pilot, the route form and the buttons must still be where
  // they belong, and the page no wider than the screen.
  await withAuth(page, { access: "SIGN_IN", pilot: A_PILOT });
  await page.goto("/app/plan");
  await noDevSwitch(page);
  await page.keyboard.press("Escape");

  await expect(devSwitch(page)).toHaveCount(0);
  await expect(page.getByLabel("Departure", { exact: true })).toBeVisible();
  await expect(page.getByTestId("sidebar-trigger-button")).toBeVisible();

  const overflowing = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflowing).toBe(false);
});
