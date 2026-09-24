import { test, expect, type Page } from "@playwright/test";

/**
 * "Save this flight", at the head of the briefing drawer's sections, for
 * a signed-in pilot. Spring's own endpoints are mocked (a signed-in
 * session is not something the local stack has); the planner and its
 * nav log are real.
 */

const A_PILOT = { id: 1, email: "pilot@example.com", displayName: "A Pilot", developer: false };

async function signedIn(page: Page, filed: Record<string, unknown>[]) {
  await page.route("**/api/me", route =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(A_PILOT) }));
  await page.route("**/api/aircraft", route =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.route("**/api/flights", async route => {
    if (route.request().method() === "POST") {
      filed.push(route.request().postDataJSON());
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ id: filed.length }) });
    } else {
      await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
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
  await page.getByRole("button", { name: "Load" }).click();
  await expect(save).toHaveText("Save this flight", { timeout: 90_000 });
  await expect(save).toBeEnabled({ timeout: 90_000 });
});

test("signed out, there is nothing to save", async ({ page }) => {
  await page.route("**/api/me", route => route.fulfill({ status: 401, body: "" }));
  await page.goto("/app/plan?dep=C81&dest=KDLH&view=briefing");
  await expect(page.getByTestId("print-button")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: /Save this flight/ })).toHaveCount(0);
});
