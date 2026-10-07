import { test, expect, type Page, type Route } from "@playwright/test";
import { library, openPanel } from "./helpers";

/**
 * The pilot console's two saves, each answered only when the test lets
 * it go: what a save does when it lands must follow what it was for, not
 * whatever the form or the box shows by then. Spring's endpoints are
 * mocked, so each test is whichever pilot it says, or nobody.
 */

const A_PILOT = { id: 1, email: "pilot@example.com", displayName: "A Pilot", developer: false };
const aircraft = (id: number, tailNumber: string) => ({
  id, tailNumber, typeDesignator: "C172", cruiseTasKt: 110, fuelBurnGph: 8, usableFuelGal: 53,
});

/** A route whose answer waits until `release()` is called. */
function held() {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  return { gate, release: () => release() };
}

const consoleSheet = (page: Page) => page.getByTestId("console-sheet");

async function openConsole(page: Page) {
  await page.goto("/app/plan");
  await page.getByTestId("settings-button").click();
  return consoleSheet(page);
}

test("an add still saving when Edit is clicked says added, and leaves the airplane being edited in the form", { tag: "@smoke" }, async ({ page }) => {
  await page.route("**/api/me", route =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(A_PILOT) }));
  const hold = held();
  await page.route("**/api/aircraft", async (route: Route) => {
    if (route.request().method() === "POST") {
      await hold.gate;
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(aircraft(3, "N3")) });
    } else {
      await route.fulfill({
        status: 200, contentType: "application/json", body: JSON.stringify([aircraft(1, "N1"), aircraft(2, "N2")]),
      });
    }
  });
  const console = await openConsole(page);
  await library(console, "Aircraft");
  // The form opens from the list's New aircraft row -- a popover, or
  // on a phone a sheet from the bottom -- on the page, not inside the
  // console's own element.
  await expect(page.getByLabel("Tail number")).toHaveCount(0);
  await console.getByTestId("new-aircraft-button").click();
  await page.getByLabel("Tail number").fill("N3");
  await page.getByLabel("Type designator").fill("C172");
  await page.getByLabel("Cruise TAS in knots").fill("110");
  await page.getByLabel("Cruise fuel burn in gallons per hour").fill("8");
  await page.getByRole("button", { name: "Add aircraft" }).click();

  // The popover away first (the add is in flight regardless): on a
  // phone it covers the rows, and their Edit buttons, under it.
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("Tail number")).toHaveCount(0);
  // The airplane's row, or on a phone its card: whichever is shown.
  await console.locator("[data-aircraft-row]:visible", { hasText: "N2" }).getByRole("button", { name: "Edit" }).click();
  await expect(page.getByLabel("Tail number")).toHaveValue("N2");
  hold.release();

  await expect(page.locator("[data-sonner-toast]", { hasText: "Aircraft added" })).toBeVisible();
  await expect(page.locator("[data-sonner-toast]", { hasText: "Aircraft updated" })).toHaveCount(0);
  await expect(page.getByLabel("Tail number")).toHaveValue("N2");
});

test.describe("the email sign-in link", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/me", route => route.fulfill({ status: 401, body: "" }));
  });

  test("says which address it went to, whatever was typed after", async ({ page }) => {
    const hold = held();
    await page.route("**/api/auth/magic-link", async route => {
      await hold.gate;
      await route.fulfill({ status: 204, body: "" });
    });
    const console = await openConsole(page);
    await console.getByRole("button", { name: "Sign in" }).click();
    const box = page.getByLabel("Email address");
    await box.fill("a@example.com");
    await page.getByRole("button", { name: "Send sign-in link" }).click();
    await box.fill("b@example.com");
    hold.release();

    // The dialog's own status line: a toast is a status too (sonner's),
    // and the planner's progress toast is often up while this runs.
    await expect(page.getByRole("dialog").getByRole("status")).toContainText("Check a@example.com");
  });

  test("closed while sending, it opens again on the form", async ({ page }) => {
    const hold = held();
    await page.route("**/api/auth/magic-link", async route => {
      await hold.gate;
      await route.fulfill({ status: 204, body: "" });
    });
    const console = await openConsole(page);
    await console.getByRole("button", { name: "Sign in" }).click();
    await page.getByLabel("Email address").fill("a@example.com");
    await page.getByRole("button", { name: "Send sign-in link" }).click();
    await page.keyboard.press("Escape");
    // Escape closes the sign-in dialog, the top layer, and leaves the
    // console under it open.
    await expect(page.getByLabel("Email address")).toHaveCount(0);
    await expect(console).toBeVisible();
    hold.release();
    await page.waitForTimeout(500);

    await console.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByLabel("Email address")).toBeVisible();
    await expect(page.getByRole("dialog").getByRole("status")).toHaveCount(0);
  });

  test("too many asked for says so, not to check the address", async ({ page }) => {
    await page.route("**/api/auth/magic-link", route => route.fulfill({ status: 429, body: "" }));
    const console = await openConsole(page);
    await console.getByRole("button", { name: "Sign in" }).click();
    await page.getByLabel("Email address").fill("a@example.com");
    await page.getByRole("button", { name: "Send sign-in link" }).click();

    // Under the field it is about, not over the map.
    await expect(page.getByTestId("sign-in-error")).toContainText("Too many sign-in links");
  });

  test("a refused token says to reload, not to check the address", async ({ page }) => {
    // What an http page that could not read the https port's Secure
    // XSRF-TOKEN got: its POST refused before the address was looked at.
    await page.route("**/api/auth/magic-link", route => route.fulfill({ status: 401, body: "" }));
    const console = await openConsole(page);
    await console.getByRole("button", { name: "Sign in" }).click();
    await page.getByLabel("Email address").fill("a@example.com");
    await page.getByRole("button", { name: "Send sign-in link" }).click();
    await expect(page.getByTestId("sign-in-error")).toHaveText("Couldn't send that link. Reload the page and try again.");
  });
});

test("the airplane the nav log flies is ticked, and a tap on another flies that one", async ({ page }) => {
  await page.route("**/api/me", route =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(A_PILOT) }));
  await page.route("**/api/aircraft", route => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify([aircraft(1, "N1"), aircraft(2, "N2")]),
  }));
  const console = await openConsole(page);
  await library(console, "Aircraft");
  // The row's own button, which says whether it is the one flown.
  const pick = (tail: string) => console.locator("[data-aircraft-row]", { hasText: tail }).locator("button[aria-pressed]");
  // A stock profile to start with: neither of these is ticked.
  await expect(console.locator('button[aria-pressed="true"]')).toHaveCount(0);
  await expect(console).toContainText("flies the stock C172");

  await pick("N2").click();
  await expect(pick("N2")).toHaveAttribute("aria-pressed", "true");
  await expect(pick("N1")).toHaveAttribute("aria-pressed", "false");
  // The ⓘ still opens its figures, and the tick stays where it is.
  await console.getByRole("button", { name: "Edit N1" }).click();
  await expect(page.getByLabel("Tail number")).toHaveValue("N1");
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByLabel("Tail number")).toHaveCount(0);
  await expect(pick("N2")).toHaveAttribute("aria-pressed", "true");

  // The picker under the route flies it too, with the panel out.
  await console.getByRole("button", { name: "Close" }).click();
  await expect(consoleSheet(page)).toHaveCount(0);
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await openPanel(page);
  await expect(page.getByTestId("aircraft-select")).toContainText("N2");
});
