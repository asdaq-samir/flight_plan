import { test, expect, type Route } from "@playwright/test";

/**
 * The Logbook's Checkride page (CheckridePage): 61.109's experience as
 * the planner's webapp reckons it, a knowledge test report's codes in the
 * FAA's own words, and an endorsement dated. Spring's endpoints are
 * mocked, as logbook.spec's are.
 */
const A_STUDENT = { id: 1, email: "student@example.com", displayName: "A Student", developer: false };

test("experience item by item, a report's codes looked up, and an endorsement dated", async ({ page }) => {
  await page.route("**/api/me", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(A_STUDENT) }));
  await page.route("**/api/logbook/currency", route => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({
      dayPassengersUntil: null, nightPassengersUntil: null, flightReviewOn: null, flightReviewUntil: null,
      medicalExpiresOn: null, totalHours: 24.5, nightHours: 1, crossCountryHours: 4, landings: 60, flights: 18,
    }),
  }));
  await page.route("**/api/logbook", route => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  let record = {
    experience: [
      { key: "total", rule: "61.109(a)", label: "Flight time", have: 24.5, need: 40, unit: "h", met: false },
      { key: "longSoloCrossCountry", rule: "61.109(a)(5)(ii)", label: "A solo cross-country of 150 nm", have: 1, need: 1, unit: "flights", met: true },
    ],
    knowledgeTestCodes: [] as string[],
    endorsements: [] as { code: string; endorsedOn: string }[],
  };
  const sent: { url: string; body: unknown }[] = [];
  // A URL test, not a glob: Playwright reads "training**" as "training"
  // and anything short of a slash, which leaves the PUTs' paths out.
  await page.route(url => url.pathname.startsWith("/api/training"), async (route: Route) => {
    const request = route.request();
    if (request.method() === "PUT" && request.url().includes("knowledge-test")) {
      const body = request.postDataJSON() as { codes: string[] };
      sent.push({ url: request.url(), body });
      record = { ...record, knowledgeTestCodes: body.codes };
    } else if (request.method() === "PUT") {
      const body = request.postDataJSON() as { endorsedOn: string };
      sent.push({ url: request.url(), body });
      record = { ...record, endorsements: [{ code: request.url().split("/").pop()!, endorsedOn: body.endorsedOn }] };
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(record) });
  });

  await page.goto("/app/plan");
  await page.getByTestId("settings-button").click();
  const console = page.getByTestId("console-sheet");
  await console.getByRole("tab", { name: "Logbook" }).click();
  await console.getByRole("button", { name: /^Checkride/ }).click();

  const items = console.getByTestId("experience-item");
  await expect(items.first()).toContainText("24.5 of 40 h");
  await expect(items.nth(1)).toContainText("Done");

  await console.getByTestId("acs-codes-input").fill("pa.i.e.k1, PA.VI.C.K3 and PA.I.E.K1");
  await console.getByTestId("acs-codes-save").click();
  await expect.poll(() => sent.at(-1)?.body).toEqual({ codes: ["PA.I.E.K1", "PA.VI.C.K3"] });
  const codes = console.getByTestId("acs-code");
  await expect(codes.first()).toContainText("National Airspace System: Airspace classes and associated requirements and limitations.");
  await expect(codes.nth(1)).toContainText("Diversion");

  await console.getByTestId("endorsement-solo-90").fill("2026-09-01");
  await expect.poll(() => sent.at(-1)?.url ?? "").toContain("/api/training/endorsements/solo-90");
  await expect(console.getByTestId("endorsement").nth(2)).toContainText(/Good to 30 Nov 2026|Ran out 30 Nov 2026/);
});
