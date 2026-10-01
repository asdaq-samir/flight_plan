import { test as setup, expect } from "@playwright/test";
import { DEVELOPER, DEVELOPER_STATE, signInByEmail } from "./emailSignIn";
import { openSettings } from "./helpers";

/**
 * The session the rest of the suite runs as (playwright.config.ts's
 * "setup" project), signed in the way anyone signs in: the pilot
 * console's sign-in, the link by email, and a developer's lands in dev
 * mode with the switch on.
 */
setup("the developer signs in from the pilot console, and lands in dev mode", async ({ page }) => {
  await page.goto("/app/plan");
  await signInByEmail(page, DEVELOPER);

  await page.waitForURL("**/app/dev**");
  // The switch is in the settings, the console's last tab. The console
  // is put back on its first tab after, which it remembers: every spec
  // starts from this session and expects the console's guide.
  await openSettings(page);
  await expect(page.getByTestId("dev-switch")).toBeChecked();
  await page.getByTestId("console-sheet").getByRole("tab", { name: "Guide" }).click();
  await page.keyboard.press("Escape");
  await page.context().storageState({ path: DEVELOPER_STATE });
});
