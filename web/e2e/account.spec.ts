import { test, expect, type Page, type Route } from "@playwright/test";

/**
 * The pilot console's two saves, each answered only when the test lets
 * it go: what a save does when it lands must follow what it was for, not
 * whatever the form or the box shows by then. Spring's endpoints are
 * mocked; a signed-in session is not something the local stack has.
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

async function openConsole(page: Page) {
  await page.goto("/app/plan");
  await page.getByTestId("pilot-button").click();
  return page.locator('[data-slot="sheet-content"][data-side="top"]');
}

test("an add still saving when Edit is clicked says added, and leaves the aeroplane being edited in the form", async ({ page }) => {
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
  await console.getByLabel("Tail number").fill("N3");
  await console.getByLabel("Type designator").fill("C172");
  await console.getByLabel("Cruise TAS in knots").fill("110");
  await console.getByLabel("Fuel burn in gallons per hour").fill("8");
  await console.getByRole("button", { name: "Add aircraft" }).click();

  await console.getByRole("row", { name: /N2/ }).getByRole("button", { name: "Edit" }).click();
  await expect(console.getByLabel("Tail number")).toHaveValue("N2");
  hold.release();

  await expect(page.locator("[data-sonner-toast]", { hasText: "Aircraft added" })).toBeVisible();
  await expect(page.locator("[data-sonner-toast]", { hasText: "Aircraft updated" })).toHaveCount(0);
  await expect(console.getByLabel("Tail number")).toHaveValue("N2");
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

    await expect(page.getByRole("status")).toContainText("Check a@example.com");
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
    hold.release();
    await page.waitForTimeout(500);

    await console.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByLabel("Email address")).toBeVisible();
    await expect(page.getByRole("status")).toHaveCount(0);
  });

  test("too many asked for says so, not to check the address", async ({ page }) => {
    await page.route("**/api/auth/magic-link", route => route.fulfill({ status: 429, body: "" }));
    const console = await openConsole(page);
    await console.getByRole("button", { name: "Sign in" }).click();
    await page.getByLabel("Email address").fill("a@example.com");
    await page.getByRole("button", { name: "Send sign-in link" }).click();

    await expect(page.locator("[data-sonner-toast]", { hasText: "Too many sign-in links" })).toBeVisible();
  });
});
