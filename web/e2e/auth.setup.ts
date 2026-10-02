import { test as setup, expect } from "@playwright/test";
import { DEVELOPER, DEVELOPER_STATE, signInByEmail } from "./emailSignIn";
import { modeToggle } from "./helpers";

/**
 * The session the rest of the suite runs as (playwright.config.ts's
 * "setup" project), signed in the way anyone signs in: the pilot
 * console's sign-in, the link by email, and a developer's lands in dev
 * mode, Developer chosen in the console's title.
 */
setup("the developer signs in from the pilot console, and lands in dev mode", async ({ page }) => {
  await page.goto("/app/plan");
  await signInByEmail(page, DEVELOPER);

  await page.waitForURL("**/app/dev**");
  // Dev mode is the console's title. The console is put back on its
  // first tab, which it remembers: every spec starts from this session
  // and expects the console's guide.
  await expect((await modeToggle(page)).getByRole("radio", { name: "Developer" })).toBeChecked();
  await page.getByTestId("console-sheet").getByRole("tab", { name: "Guide" }).click();
  await page.keyboard.press("Escape");
  await page.context().storageState({ path: DEVELOPER_STATE });
});
