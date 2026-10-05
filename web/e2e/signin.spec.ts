import { test, expect, type Page } from "@playwright/test";
import { DEVELOPER, openLinkFor, signInByEmail } from "./emailSignIn";
import { closeConsole, roleMenu } from "./helpers";

/**
 * Signing in and out on the running stack, from a browser with no
 * session: the planner opens on the map, with sign-in one tap away in
 * the pilot console, a pilot's emailed link lands on the planner and a
 * developer's in dev mode, and either console signs out. Nothing here
 * is mocked -- the link is read from the local inbox (emailSignIn.ts).
 */
test.use({ storageState: { cookies: [], origins: [] } });

const consoleSheet = (page: Page) => page.getByTestId("console-sheet");

/** Dev mode, Developer in the console's role menu: the console and the
 *  menu opened first. Present or absent, it is looked for there. */
async function devSwitchInSettings(page: Page) {
  return (await roleMenu(page)).developer;
}

/** One pilot per test and project, the same on every run: a fresh
 *  address each time added a pilot row to the local database on every
 *  run, 76 of them in a day. Per project, so the phone's and the
 *  desktop's runs never read each other's link. */
const pilotAddress = (test: string, project: string) => `pilot-${test}-${project}@example.com`;

test("signed out, the planner opens on the map, and the sign-in is in the pilot console", { tag: "@smoke" }, async ({ page }) => {
  // The console used to come down by itself for anyone signed out,
  // over the map a pilot came to look at. It opens when asked.
  await page.goto("/app/plan");
  await expect(page.getByTestId("settings-button")).toBeVisible();
  await page.waitForTimeout(500);   // a moment for a console that was coming down by itself
  await expect(consoleSheet(page)).toHaveCount(0);
  await expect(await devSwitchInSettings(page)).toHaveCount(0);
  await closeConsole(page);

  await page.getByTestId("settings-button").click();
  await expect(consoleSheet(page).getByRole("button", { name: "Sign in" })).toBeVisible();
});

test("signed out, the Library says once what signing in keeps, and the dialog offers only the providers registered", async ({ page }) => {
  await page.goto("/app/plan");
  await page.getByTestId("settings-button").click();
  const sheet = consoleSheet(page);
  await sheet.getByRole("tab", { name: "Library" }).click();
  await expect(sheet.getByText("Not Signed In")).toBeVisible();
  await expect(sheet.getByTestId("library-section")).toHaveCount(0);
  // This stack registers neither Google nor Apple: their buttons opened a blank 401.
  await sheet.getByRole("tabpanel").getByRole("button", { name: "Sign in" }).click();
  const dialog = page.getByRole("dialog", { name: "Sign in to Wingtip Maps" });
  await expect(dialog.getByLabel("Email address")).toBeVisible();
  await expect(dialog.getByRole("link", { name: /Continue with/ })).toHaveCount(0);
  await page.keyboard.press("Escape");

  // Where Google is registered, Google alone.
  await page.route("**/api/auth/capabilities", route => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ access: "SIGN_IN", providers: ["google"] }),
  }));
  await page.reload();
  await page.getByTestId("settings-button").click();
  await consoleSheet(page).getByRole("tabpanel").getByRole("button", { name: "Sign in" }).click();
  await expect(dialog.getByRole("link", { name: "Continue with Google" })).toBeVisible();
  await expect(dialog.getByRole("link", { name: "Continue with Apple" })).toHaveCount(0);
});

test("signed out, the dev page sends you to the planner", async ({ page }) => {
  await page.goto("/app/dev");
  await page.waitForURL(/\/app\/plan/);
  await expect(page.getByTestId("settings-button")).toBeVisible();
  await expect(await devSwitchInSettings(page)).toHaveCount(0);
  await closeConsole(page);
});

test("the emailed link opens the app's own sign-in dialog, over the planner, and a spent link says so", async ({ page }, testInfo) => {
  // It used to open a bare server page with one button. The button
  // stays -- a mail scanner fetching the link must not spend it -- but
  // it is the app's dialog now, and the token never leaves the fragment.
  const address = pilotAddress("link", testInfo.project.name);
  await page.goto("/app/plan");
  const link = await openLinkFor(page, address);
  // The dialog, over the planner; and the token in the fragment or
  // nowhere, never in the query string, which the server would see.
  // (The fragment itself goes as soon as the planner writes the route
  // into the address, which is why it is not looked for here: the
  // dialog has the token by then, and checking the address for it was
  // a race the test lost once the page got quicker.)
  await expect(page.getByRole("dialog").getByRole("button", { name: "Sign in" })).toBeVisible();
  await expect(page.getByTestId("settings-button")).toBeVisible();
  expect(new URL(page.url()).search).not.toContain("signin");

  await page.getByRole("dialog").getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(url => url.pathname === "/app/plan" && url.hash === "");
  await page.getByTestId("settings-button").click();
  await expect(consoleSheet(page).getByTestId("pilot-address")).toHaveText(address);

  await page.goto(link);
  await page.getByRole("dialog").getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("expired or was already used");
});

test("a pilot's link lands on the planner, with no dev switch, and the pilot console logs out", async ({ page }, testInfo) => {
  const address = pilotAddress("landing", testInfo.project.name);
  await page.goto("/app/plan");
  await signInByEmail(page, address);

  await page.waitForURL("**/app/plan**");
  await expect(page.getByTestId("search-airports")).toBeVisible();
  await page.waitForTimeout(500);   // a moment for a console that was coming down by itself
  await expect(consoleSheet(page)).toHaveCount(0);
  await expect(await devSwitchInSettings(page)).toHaveCount(0);
  await closeConsole(page);

  await page.getByTestId("settings-button").click();
  // Who is signed in beside the role, whose menu ends in Sign out.
  await expect(consoleSheet(page).getByTestId("pilot-address")).toHaveText(address);
  await consoleSheet(page).getByTestId("role-menu").click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(consoleSheet(page).getByRole("button", { name: "Sign in" })).toBeVisible();
  await expect(consoleSheet(page).getByTestId("role-menu")).toHaveCount(0);
  await page.reload();
  await expect(consoleSheet(page)).toHaveCount(0);
  await page.getByTestId("settings-button").click();
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
  await expect(await devSwitchInSettings(page)).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
  // Gone, not just closing: a tap on the trigger while the menu animates
  // out is the closing menu's tap outside as well, and the menu opens and
  // is dismissed at once -- every time on CI's runners, never here.
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(consoleSheet(page).getByTestId("pilot-address")).toHaveText(DEVELOPER);
  await consoleSheet(page).getByTestId("role-menu").click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();

  await page.waitForURL("**/app/plan**");
  await expect(page.getByTestId("settings-button")).toBeVisible();
  await expect(consoleSheet(page)).toHaveCount(0);
  await expect(await devSwitchInSettings(page)).toHaveCount(0);
  await closeConsole(page);
});
