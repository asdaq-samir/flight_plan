import { test, expect, type Page } from "@playwright/test";
import { grabberTo, settle, sideDrawer, slow } from "./helpers";

/**
 * The strip layout (features/strip, the owner's "let's try it" of
 * 2026-11-04): one field at the foot of the chart that takes anything a
 * pilot types or says, and the flight as one strip in time. Idents typed
 * into the field are a route, planned, and the ribbon on the pill names
 * its end; a question goes to the assistant and its answer is a card
 * over the field; the profile button's menu opens Settings in the sheet.
 */

const NDJSON = [
  { type: "tool", name: "weather_at", label: "The weather at KDLH" },
  { type: "text", text: "Yes: Duluth is reporting wind 270 at 12 gusting 18, " },
  { type: "text", text: "and the ceiling is 4,500 feet." },
  { type: "sources", sources: [{ id: "metar:KDLH", label: "METAR KDLH 1753Z", text: "KDLH 031753Z 27012G18KT 10SM BKN045 08/M02 A2992" }] },
  { type: "done" },
].map(line => JSON.stringify(line)).join("\n") + "\n";

/** The assistant answered here, so no billed Claude call is made (a URL
 *  predicate: a glob's `**` does not cross the path's slashes). */
async function mockAssistant(page: Page, asked: { body: unknown }[]) {
  await page.route(url => url.pathname === "/api/planner/assistant", route => {
    asked.push({ body: route.request().postDataJSON() });
    return route.fulfill({ status: 200, contentType: "application/x-ndjson", body: NDJSON });
  });
}

/** The strip layout asked for through the address (`?layout=strip`),
 *  which sets the preference as the tabs' is set from Setup's Controls. */
const stripPlan = (query = "") => `/app/plan?layout=strip${query ? `&${query}` : ""}`;

test("idents typed into the field are a route, and the ribbon names its end", async ({ page }) => {
  await page.goto(stripPlan());
  await settle(page);
  const panel = sideDrawer(page);
  const field = panel.getByTestId("strip-field");
  await expect(field).toBeVisible({ timeout: slow(30000) });
  // No route: the ribbon says the app's name and the field's word.
  await expect(panel.getByTestId("strip-ribbon-route")).toHaveText("Wingtip");
  await field.fill("C81 KDLH");
  await field.press("Enter");
  await expect(page).toHaveURL(/dep=C81/);
  await expect(page).toHaveURL(/dest=KDLH/);
  await expect(panel.getByTestId("strip-ribbon-route")).toHaveText("C81 → KDLH");
  // The plan in: the route's points on the ribbon's line, and the strip's
  // head over the sheet.
  await expect(panel.getByTestId("strip-ribbon-figures")).toContainText("gal", { timeout: slow(120000) });
  await expect(panel.getByTestId("strip-ribbon-line").locator("[data-point=checkpoint]").first()).toBeAttached();
  await expect(panel.getByTestId("strip-head")).toBeVisible();
  await expect(panel.getByTestId("strip-departure-open")).toContainText("C81");
  await expect(panel.getByTestId("strip-destination-open")).toContainText("KDLH");
  // The tabs' bar and the route box are not here.
  await expect(page.getByTestId("tab-bar")).toHaveCount(0);
});

test("a question in the field goes to the assistant, its answer a card over the field", async ({ page }) => {
  const asked: { body: { messages: { role: string; content: string }[]; context: { dep: string; dest: string } } }[] = [];
  await mockAssistant(page, asked);
  await page.goto(stripPlan("dep=C81&dest=KDLH"));
  await settle(page);
  const panel = sideDrawer(page);
  const field = panel.getByTestId("strip-field");
  await expect(field).toBeVisible({ timeout: slow(30000) });
  await field.fill("Can I make Duluth before dark with this wind?");
  await field.press("Enter");
  const answer = panel.getByTestId("strip-answer");
  await expect(answer.getByTestId("ask-question")).toHaveText("Can I make Duluth before dark with this wind?");
  await expect(answer.getByTestId("ask-answer")).toContainText("ceiling is 4,500 feet", { timeout: slow(15000) });
  await expect(answer.getByTestId("ask-source")).toHaveText("METAR KDLH 1753Z");
  expect(asked).toHaveLength(1);
  expect(asked[0]!.body.messages).toEqual([{ role: "user", content: "Can I make Duluth before dark with this wind?" }]);
  expect(asked[0]!.body.context).toMatchObject({ dep: "C81", dest: "KDLH" });
  // Its ✕ forgets the conversation.
  await answer.getByTestId("strip-answer-close").click();
  await expect(panel.getByTestId("strip-answer")).toHaveCount(0);
});

test("a screen's word in the field opens it, and the profile menu opens Settings", async ({ page }) => {
  await page.goto(stripPlan("dep=C81&dest=KDLH"));
  await settle(page);
  const panel = sideDrawer(page);
  const field = panel.getByTestId("strip-field");
  await expect(field).toBeVisible({ timeout: slow(30000) });
  // The chips while the field is focused and empty, each a screen.
  await field.focus();
  await expect(panel.getByTestId("strip-suggestion").first()).toBeVisible();
  await field.fill("Brief me");
  await field.press("Enter");
  await expect(panel.getByTestId("brief-glance")).toBeVisible({ timeout: slow(30000) });
  await expect(panel.getByTestId("strip-card-title")).toHaveText("Brief");
  await panel.getByTestId("strip-card-close").click();
  await expect(panel.getByTestId("brief-glance")).toHaveCount(0);

  await page.getByTestId("profile-button").click();
  await page.getByTestId("profile-settings").click();
  await expect(page.getByTestId("quick-controls").first()).toBeVisible({ timeout: slow(15000) });
  await expect(page.getByTestId("layout-select")).toBeVisible();
});

test("the altitude's row under the head opens the altitude's wheel, named on the ribbon", async ({ page }) => {
  await page.goto(stripPlan("dep=C81&dest=KDLH"));
  await settle(page);
  const panel = sideDrawer(page);
  await expect(panel.getByTestId("strip-field")).toBeVisible({ timeout: slow(30000) });
  // The plan's altitude in the row once the legs are in.
  const row = panel.getByTestId("strip-altitude");
  await expect(row).toContainText(/FL-\d{3}/, { timeout: slow(120000) });
  // The strip's body is out of sight at the pill: the sheet half way up
  // first, as a finger would take it.
  await grabberTo(page, "half");
  await row.click();
  // The Profile's own wheel (AltitudeProfile), in its card over the strip.
  await expect(panel.getByTestId("altitude-wheel")).toBeVisible({ timeout: slow(30000) });
  await expect(panel.getByTestId("strip-card-title")).toHaveText("Altitude");
  await panel.getByTestId("strip-card-close").click();
  await expect(panel.getByTestId("altitude-profile")).toHaveCount(0);
  await expect(row).toBeVisible();
});

test("a page's word in the field opens that page of Setup", async ({ page }) => {
  // Signed in, as the logbook spec is, Spring's endpoints answered here.
  await page.route("**/api/me", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: 1, email: "pilot@example.com", displayName: "A Pilot", developer: false }) }));
  await page.route("**/api/logbook/currency", route => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({
      dayPassengersUntil: null, nightPassengersUntil: null, flightReviewOn: null, flightReviewUntil: null,
      medicalExpiresOn: null, totalHours: 0, nightHours: 0, crossCountryHours: 0, landings: 0, flights: 0,
    }),
  }));
  await page.route("**/api/logbook", route => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.goto(stripPlan());
  await settle(page);
  const panel = sideDrawer(page);
  const field = panel.getByTestId("strip-field");
  await expect(field).toBeVisible({ timeout: slow(30000) });
  await field.fill("logbook");
  await field.press("Enter");
  // Setup, open on its Logbook page (useWantedPage), not its list.
  const console = page.getByTestId("console-sheet");
  await expect(console.getByTestId("console-page").first()).toContainText("Logbook", { timeout: slow(15000) });
  await expect(console.getByTestId("currency-day")).toBeVisible();
  // The avatar is in the field's row now, the map's own microphone gone.
  await expect(panel.getByTestId("strip-avatar")).toBeVisible();
  await expect(page.getByTestId("mic-circle")).toHaveCount(0);
});
