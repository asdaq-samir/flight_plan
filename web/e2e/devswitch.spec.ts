import { test, expect, type Page } from "@playwright/test";

/**
 * Who is offered the developer's workspace.
 *
 * The training workspace and the developer console are work on the
 * model, not on a flight, so a pilot should not see the way in. The
 * switch asks two questions and either answer is enough: does the
 * signed-in pilot hold the developer role, and can anyone sign in here
 * at all.
 *
 * That second one is the local case rather than a loophole. With no
 * Google or Apple credentials and no mail host there is no way to hold
 * a role, and hiding the switch would hide it from the only person who
 * could use it. Every case below is reached by mocking those two
 * endpoints, because a running stack can only be in one of them.
 */

const devSwitch = (page: Page) => page.getByTestId("dev-switch");

async function withAuth(page: Page, opts: { signInPossible: boolean; pilot: object | null }) {
  await page.route("**/api/auth/capabilities", route =>
    route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ signInPossible: opts.signInPossible, oauthConfigured: opts.signInPossible }),
    }));
  await page.route("**/api/me", route =>
    opts.pilot
      ? route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(opts.pilot) })
      : route.fulfill({ status: 401, body: "" }));
}

const A_PILOT = { id: 1, email: "pilot@example.com", displayName: "A Pilot", developer: false };
const A_DEVELOPER = { id: 2, email: "dev@example.com", displayName: "A Developer", developer: true };

test("with no way to sign in, the switch is there -- that is the local case", async ({ page }) => {
  await withAuth(page, { signInPossible: false, pilot: null });
  await page.goto("/app/plan");
  await expect(devSwitch(page)).toBeVisible({ timeout: 15000 });
});

test("where signing in is possible, a caller with no session does not get it", async ({ page }) => {
  await withAuth(page, { signInPossible: true, pilot: null });
  await page.goto("/app/plan");
  await page.waitForTimeout(3000);
  await expect(devSwitch(page)).toHaveCount(0);
});

test("a signed-in pilot does not get it either", async ({ page }) => {
  // The case this exists for: one user becomes two, and the second one
  // is a pilot who has no business retraining a model.
  await withAuth(page, { signInPossible: true, pilot: A_PILOT });
  await page.goto("/app/plan");
  await page.waitForTimeout(3000);
  await expect(devSwitch(page)).toHaveCount(0);
});

test("a signed-in developer does", async ({ page }) => {
  await withAuth(page, { signInPossible: true, pilot: A_DEVELOPER });
  await page.goto("/app/plan");
  await expect(devSwitch(page)).toBeVisible({ timeout: 15000 });
});

test("the header holds together without it", async ({ page }) => {
  // The switch is the leading item in the header. Hidden, the route
  // form and the two buttons must still be where they belong rather
  // than sliding into the gap.
  await withAuth(page, { signInPossible: true, pilot: A_PILOT });
  await page.goto("/app/plan");
  await page.waitForTimeout(3000);

  await expect(devSwitch(page)).toHaveCount(0);
  await expect(page.getByLabel("Departure", { exact: true })).toBeVisible();
  await expect(page.getByTestId("sidebar-trigger-button")).toBeVisible();

  const overflowing = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflowing).toBe(false);
});
