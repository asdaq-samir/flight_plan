import { test, expect, type Page } from "@playwright/test";
import { openSetup, settle, sideDrawer, slow } from "./helpers";

/**
 * The field over the tab bar (features/strip's FieldTabsBar, the owner's
 * third screen of 2026-11-04, Target's way): the pill is the strip's one
 * field with an Ask pill inside it, and under it the planner's four
 * tabs; half way up the tab's content is the tabs layout's own. The Ask
 * pill puts the field in ask mode, where a line goes to the assistant
 * however it reads, and idents typed without it are a route.
 */

const NDJSON = [
  { type: "text", text: "Yes: Duluth is reporting wind 270 at 12, ceiling 4,500 feet." },
  { type: "sources", sources: [{ id: "metar:KDLH", label: "METAR KDLH 1753Z", text: "KDLH 031753Z 27012KT 10SM BKN045 08/M02 A2992" }] },
  { type: "done" },
].map(line => JSON.stringify(line)).join("\n") + "\n";

/** The assistant answered here, so no billed Claude call is made. */
async function mockAssistant(page: Page, asked: { body: unknown }[]) {
  await page.route(url => url.pathname === "/api/planner/assistant", route => {
    asked.push({ body: route.request().postDataJSON() });
    return route.fulfill({ status: 200, contentType: "application/x-ndjson", body: NDJSON });
  });
}

const fieldTabsPlan = (query = "") => `/app/plan?layout=field-tabs${query ? `&${query}` : ""}`;

test("the pill is the field with its Ask pill over the four tabs, and a route typed plans", async ({ page }) => {
  await page.goto(fieldTabsPlan());
  await settle(page);
  const panel = sideDrawer(page);
  const bar = panel.getByTestId("field-tabs");
  await expect(bar).toBeVisible({ timeout: slow(30000) });
  const field = bar.getByTestId("strip-field");
  await expect(field).toBeVisible();
  await expect(bar.getByTestId("field-ask")).toBeVisible();
  await expect(bar.getByTestId("strip-mic")).toBeVisible();
  // No avatar over the tabs: the pilot's screens are Setup's.
  await expect(bar.getByTestId("strip-avatar")).toHaveCount(0);
  // The four tabs under the field, FPL up.
  for (const tab of ["tab-fpl", "tab-airport", "tab-aircraft", "setup-button"]) await expect(bar.getByTestId(tab)).toBeVisible();
  await expect(bar.getByTestId("tab-fpl")).toHaveAttribute("data-current", "true");
  // The field and the tabs stacked: the tabs under the field.
  const fieldBox = (await field.boundingBox())!;
  const tabsBox = (await bar.getByTestId("tab-fpl").boundingBox())!;
  expect(tabsBox.y).toBeGreaterThan(fieldBox.y + fieldBox.height - 1);
  // Idents typed are a route, as in the strip; the sheet opens half way
  // on FPL with the route's box.
  await field.fill("C81 KDLH");
  await field.press("Enter");
  await expect(panel.getByTestId("route-box")).toContainText("KDLH", { timeout: slow(30000) });
  await expect(bar.getByTestId("tab-fpl")).toHaveAttribute("data-current", "true");
});

test("the Ask pill puts the field in ask mode, and the line goes to the assistant", async ({ page }) => {
  const asked: { body: { messages: { role: string; content: string }[]; context: { dep: string; dest: string } } }[] = [];
  await mockAssistant(page, asked);
  await page.goto(fieldTabsPlan("dep=C81&dest=KDLH"));
  await settle(page);
  const panel = sideDrawer(page);
  const bar = panel.getByTestId("field-tabs");
  const field = bar.getByTestId("strip-field");
  await expect(field).toBeVisible({ timeout: slow(30000) });
  const ask = bar.getByTestId("field-ask");
  await expect(ask).toHaveAttribute("aria-pressed", "false");
  await ask.click();
  await expect(ask).toHaveAttribute("aria-pressed", "true");
  await expect(field).toHaveAttribute("data-ask", "");
  await expect(field).toHaveAttribute("placeholder", "Ask about this flight");
  // Focused and empty: the questions as chips.
  await expect(bar.getByTestId("strip-suggestion").first()).toHaveText("Can I go?");
  // Idents in ask mode are a question, never a route.
  await field.fill("KDLH");
  await field.press("Enter");
  const answer = bar.getByTestId("strip-answer");
  await expect(answer.getByTestId("ask-question")).toHaveText("KDLH");
  await expect(answer.getByTestId("ask-answer")).toContainText("ceiling 4,500 feet", { timeout: slow(15000) });
  expect(asked).toHaveLength(1);
  expect(asked[0]!.body.messages).toEqual([{ role: "user", content: "KDLH" }]);
  expect(asked[0]!.body.context).toMatchObject({ dep: "C81", dest: "KDLH" });
  // Tapped again, the field is its own.
  await ask.click();
  await expect(ask).toHaveAttribute("aria-pressed", "false");
  await expect(field).toHaveAttribute("placeholder", "Where to, or ask");
});

test("Setup's Screen row has the third choice, and picks it", async ({ page }) => {
  await page.goto("/app/plan");
  await settle(page);
  const panel = sideDrawer(page);
  await openSetup(page);
  const screen = page.getByTestId("layout-select");
  await expect(screen).toBeVisible();
  await screen.getByText("Field + tabs").click();
  await expect(panel.getByTestId("field-tabs")).toBeVisible({ timeout: slow(15000) });
  await expect(panel.getByTestId("field-tabs").getByTestId("strip-field")).toBeVisible();
});
