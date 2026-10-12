import { test, expect } from "@playwright/test";
import { settle, slow, showTabs } from "./helpers";

/**
 * Signing a TV in from a phone (#207, DeviceSignInController): the TV's
 * sign-in shows a code and the address to type it at, and asks until it
 * has been typed in, then goes where it is sent signed in; the phone,
 * opened at that address, takes the code. The webapp's three steps are
 * stubbed here (its own tests are DeviceSignInControllerTest's).
 */

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("on a TV, sign-in is a code to type in on a phone, and the TV signs in once it has been", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) < 768, "a TV's screen");
  await page.route(url => url.pathname === "/api/me", route => route.fulfill({ status: 204, body: "" }));
  let asks = 0;
  await page.route(url => url.pathname === "/api/auth/device", route => route.fulfill({
    json: { deviceCode: "device-1", userCode: "BCDF-GHJK", verificationPath: "/tv", expiresIn: 600, interval: 1 },
  }));
  await page.route(url => url.pathname === "/api/auth/device/token", route => {
    asks += 1;
    return asks < 2
      ? route.fulfill({ status: 202, json: { status: "pending", interval: 1 } })
      : route.fulfill({ json: { next: "/app/plan?signed-in=tv" } });
  });
  await page.goto("/app/plan?tv=webos");
  await settle(page);
  await showTabs(page);
  await page.getByTestId("settings-button").click();
  await page.getByTestId("console-sheet").getByRole("button", { name: "Sign in" }).click();
  const dialog = page.getByRole("dialog", { name: "Sign in to Wingtip Maps" });
  await expect(dialog.getByTestId("tv-code")).toHaveText("BCDF-GHJK");
  await expect(dialog.getByTestId("tv-address")).toHaveText(/\/tv$/);
  // No email to type on a TV.
  await expect(dialog.getByLabel("Email address")).toHaveCount(0);
  // Asked once, waiting; asked again, signed in and sent on.
  await expect(page).toHaveURL(/[?&]signed-in=tv/, { timeout: slow(15000) });
  expect(asks).toBeGreaterThanOrEqual(2);
});

test("on the phone, the TV's address opens a box for its code, and the code signs the TV in", async ({ page }) => {
  const typed: string[] = [];
  await page.route(url => url.pathname === "/api/auth/device/approve", route => {
    const code = (route.request().postDataJSON() as { userCode: string }).userCode;
    typed.push(code);
    return code.replace(/[^a-z0-9]/gi, "").toUpperCase() === "BCDFGHJK"
      ? route.fulfill({ status: 204, body: "" })
      : route.fulfill({ status: 404, json: { error: "No TV is showing that code now. Check it, or ask the TV for a new one." } });
  });
  await page.goto("/app/plan?tv-link=1");
  await settle(page);
  const box = page.getByTestId("tv-link");
  await expect(box.getByRole("heading", { name: "Sign in a TV" })).toBeVisible();
  // Off the address, so a reload does not ask again.
  await expect(page).not.toHaveURL(/tv-link/);
  await box.getByTestId("tv-link-code").fill("bcdf-ghj9");
  await box.getByTestId("tv-link-approve").click();
  await expect(box.getByTestId("tv-link-error")).toContainText("No TV is showing that code now");
  await box.getByTestId("tv-link-code").fill("bcdf-ghjk");
  await box.getByTestId("tv-link-approve").click();
  await expect(box.getByTestId("tv-link-done")).toContainText("The TV is signing in as");
  expect(typed).toEqual(["bcdf-ghj9", "bcdf-ghjk"]);
});
