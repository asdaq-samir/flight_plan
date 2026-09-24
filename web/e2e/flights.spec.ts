import { test, expect, type Page } from "@playwright/test";

/**
 * "Save this flight", at the head of the briefing drawer's sections, for
 * a signed-in pilot. Spring's own endpoints are mocked (a signed-in
 * session is not something the local stack has); the planner and its
 * nav log are real.
 */

const A_PILOT = { id: 1, email: "pilot@example.com", displayName: "A Pilot", developer: false };

async function signedIn(page: Page, filed: Record<string, unknown>[], list: object[] = []) {
  await page.route("**/api/me", route =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(A_PILOT) }));
  await page.route("**/api/aircraft", route =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.route("**/api/flights", async route => {
    if (route.request().method() === "POST") {
      filed.push(route.request().postDataJSON());
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ id: filed.length }) });
    } else {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(list) });
    }
  });
}

test("a flight is filed once, whole, and a new plan is offered for saving again", async ({ page }) => {
  test.setTimeout(120_000);
  const filed: Record<string, unknown>[] = [];
  await signedIn(page, filed);
  await page.goto("/app/plan?dep=C81&dest=KDLH&view=briefing");
  const save = page.getByRole("button", { name: /Save this flight|Saved|Saving/ });

  // Offered once the nav log is whole -- it used to be enabled
  // mid-stream, and filed null totals.
  await expect(save).toHaveText("Save this flight", { timeout: 90_000 });
  await expect(save).toBeEnabled({ timeout: 90_000 });
  await save.click();
  await expect(save).toHaveText("Saved");
  await expect(save).toBeDisabled();

  expect(filed).toHaveLength(1);
  const flight = filed[0] as { totalEteMin: number | null; checkpoints: { category: string; sequenceNo: number }[] };
  expect(flight.totalEteMin).not.toBeNull();
  expect(flight.checkpoints[0]).toMatchObject({ category: "departure", sequenceNo: 0 });
  expect(flight.checkpoints.at(-1)).toMatchObject({ category: "destination" });

  // Load again: a fresh nav log is a new plan. "Saved" used to stay for
  // the session, and a click filed a duplicate of whatever was on screen.
  // On a phone the drawer is a modal sheet over the header's Load, so it
  // is closed for the press and opened again after.
  const phone = (page.viewportSize()?.width ?? 0) < 768;
  if (phone) await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Load" }).click();
  if (phone) await page.getByTestId("sidebar-trigger-button").click();
  await expect(save).toHaveText("Save this flight", { timeout: 90_000 });
  await expect(save).toBeEnabled({ timeout: 90_000 });
});

test("signed out, there is nothing to save", async ({ page }) => {
  await page.route("**/api/me", route => route.fulfill({ status: 401, body: "" }));
  await page.goto("/app/plan?dep=C81&dest=KDLH&view=briefing");
  await expect(page.getByTestId("print-button")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: /Save this flight/ })).toHaveCount(0);
});

test("opening a saved flight puts its route in the header, and Load plans that route", async ({ page }) => {
  // The header read the address once. Opening a saved flight changes the
  // address in the page, so the header still showed the old route, and
  // Load quietly re-planned that one instead of the flight.
  await signedIn(page, [], [{
    id: 9, departureIdent: "KMSP", destinationIdent: "KDLH", cruiseAltitudeFt: 5500, aircraftTailNumber: null,
    createdAt: "2026-09-20T12:00:00Z", plannedFor: null, totalDistanceNm: 120, totalEteMin: 55, totalFuelGal: 8,
  }]);
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await expect(page.getByLabel("Departure", { exact: true })).toContainText("C81", { timeout: 15_000 });

  await page.getByTestId("pilot-button").click();
  await page.getByRole("tab", { name: "Flights" }).click();
  await page.getByRole("link", { name: "Open" }).click();
  await expect(page).toHaveURL(/dep=KMSP/);
  await page.keyboard.press("Escape");

  await expect(page.getByLabel("Departure", { exact: true })).toContainText("KMSP");
  await page.getByRole("button", { name: "Load" }).click();
  await expect(page).toHaveURL(/dep=KMSP/);
  await expect(page).toHaveURL(/altitude_ft=5500/);
});
