import { test as setup, expect } from "@playwright/test";
import { DEVELOPER, DEVELOPER_STATE, signInByEmail } from "./emailSignIn";
import { noTips, roleMenu, consolePage } from "./helpers";

/**
 * The session the rest of the suite runs as (playwright.config.ts's
 * "setup" project), signed in the way anyone signs in: the pilot
 * console's sign-in, the link by email, and a developer's lands in dev
 * mode, Developer the role in the console's title.
 */
setup("the developer signs in from the pilot console, and lands in dev mode", async ({ page }) => {
  // The first-run tips seen before the page loads, as every spec starts
  // with them seen (the session saved below).
  await page.addInitScript(noTips);
  await page.goto("/app/plan");
  await signInByEmail(page, DEVELOPER);

  await page.waitForURL("**/app/dev**");
  // Dev mode is the console's title, a menu of roles. The console is put
  // back on its first tab, which it remembers: every spec starts from
  // this session and expects the console's guide.
  await expect((await roleMenu(page)).developer).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
  await consolePage(page.getByTestId("console-sheet"), "Guide");
  await page.keyboard.press("Escape");
  // The first-run tips (lib/tips) seen, every one: a tip over a control
  // takes the click a spec meant for it. tips.spec offers them afresh.
  await page.evaluate(noTips);
  // FPL's fields opened at first (ProceduresRoute's fieldsOpenAtFirst): the
  // specs work on their runways and procedures; route-fields.spec folds
  // them as a pilot sees them.
  await page.evaluate(() => localStorage.setItem("vfr.fieldsOpen", "1"));
  await page.context().storageState({ path: DEVELOPER_STATE });
});
