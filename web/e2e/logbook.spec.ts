import { test, expect, type Route } from "@playwright/test";

/**
 * The pilot console's Logbook: where the pilot stands first, then the
 * flights. Spring's endpoints are mocked, as account.spec's are, so the
 * test is the pilot it says.
 */

const A_PILOT = { id: 1, email: "pilot@example.com", displayName: "A Pilot", developer: false };
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

test("the logbook says where the pilot stands, and a flight logged is posted as typed", async ({ page }) => {
  await page.route("**/api/me", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(A_PILOT) }));
  await page.route("**/api/logbook/currency", route => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({
      dayPassengersUntil: inDays(40), nightPassengersUntil: null, flightReviewOn: "2025-06-14", flightReviewUntil: "2027-06-30",
      medicalExpiresOn: null, totalHours: 3.4, nightHours: 0, crossCountryHours: 3.4, landings: 3, flights: 1,
    }),
  }));
  const posted: unknown[] = [];
  await page.route("**/api/logbook", async (route: Route) => {
    if (route.request().method() === "POST") {
      posted.push(route.request().postDataJSON());
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: 9, ...posted[0] as object }) });
    } else {
      await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    }
  });

  await page.goto("/app/plan");
  await page.getByTestId("settings-button").click();
  const console = page.getByTestId("console-sheet");
  await console.getByRole("tab", { name: "Logbook" }).click();

  await expect(console.getByTestId("currency-day")).toHaveText(/^To /);
  await expect(console.getByTestId("currency-night")).toHaveText("Not current");
  await expect(console.getByTestId("currency-review")).toHaveText("To 30 Jun 2027");

  await console.getByTestId("logbook-add").click();
  await page.getByTestId("logbook-totalHours").fill("3.4");
  await page.getByTestId("logbook-save").click();
  await expect.poll(() => posted.length).toBe(1);
  expect(posted[0]).toMatchObject({ totalHours: 3.4, dayLandings: 1 });
});
