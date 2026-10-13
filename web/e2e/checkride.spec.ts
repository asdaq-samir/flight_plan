import { test, expect, type Route } from "@playwright/test";
import { library, openConsole, showTabs } from "./helpers";

/**
 * The Logbook's Checkride page (CheckridePage): 61.109's experience as
 * the planner's webapp reckons it, a knowledge test report's codes in the
 * FAA's own words, an endorsement dated, and one an instructor signed in
 * the app read as signed. Spring's endpoints are
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
    endorsements: [] as { code: string; endorsedOn: string; until: string | null }[],
    // One signed by an instructor in the app, its words a tap away.
    signed: [{
      id: 1, code: "pre-solo-knowledge", studentName: "Avery B. Student", fields: { mm: "Cessna 172" },
      text: "I certify that Avery B. Student has satisfactorily completed the pre-solo knowledge test of 14 CFR § 61.87(b) for the Cessna 172 aircraft.",
      signature: "/s/ 09-01-2026 J. J. Jones 987654321CFI RE 12-31-2027", signedOn: "2026-09-01", until: null, voided: false, digest: "0".repeat(64),
    }],
    // The webapp's own list (EndorsementKind), the first three.
    kinds: [
      { code: "pre-solo-knowledge", paragraph: "A.3", rule: "61.87(b)", label: "Pre-solo aeronautical knowledge", validDays: null, template: "", fields: [] },
      { code: "pre-solo-flight", paragraph: "A.4", rule: "61.87(c)(1) and (2)", label: "Pre-solo flight training", validDays: null, template: "", fields: [] },
      { code: "solo-90", paragraph: "A.7", rule: "61.87(p)", label: "Solo flight (each further 90 days)", validDays: 90, template: "", fields: [] },
    ],
    fullName: "Avery B. Student",
    instructors: [],
    reviews: [],
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
      // The webapp works out the day it runs out: 90 days on, for this one.
      const until = new Date(`${body.endorsedOn}T00:00:00Z`);
      until.setUTCDate(until.getUTCDate() + 90);
      record = { ...record, endorsements: [{ code: request.url().split("/").pop()!, endorsedOn: body.endorsedOn, until: until.toISOString().slice(0, 10) }] };
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(record) });
  });

  await page.goto("/app/plan");
  await showTabs(page);
  await openConsole(page);
  const console = page.getByTestId("console-sheet");
  await library(console, "Logbook");
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
  await expect(console.getByTestId("endorsement").filter({ has: page.getByTestId("endorsement-solo-90") }))
    .toContainText(/Good to 30 Nov 2026|Ran out 30 Nov 2026/);

  // The signed one, read as signed.
  const signed = console.getByTestId("signed-endorsement");
  await expect(signed).toContainText("Pre-solo aeronautical knowledge");
  await signed.click();
  await expect(console.getByTestId("signed-words")).toContainText("/s/ 09-01-2026 J. J. Jones 987654321CFI RE 12-31-2027");
});
