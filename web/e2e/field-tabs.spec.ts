import { test, expect, type Page } from "@playwright/test";
import { openSetup, settle, sideDrawer, slow } from "./helpers";

/**
 * The field over the tabs (the owner's third screen of 2026-11-04,
 * Target's way, then "the search pill can be on top and the tabs pill
 * can be at the bottom"): the strip's one field with its one mic, the
 * assistant's by default, is a glass bar at the top of the map, and the sheet's pill at the
 * foot is the tabs' own; the tab's content is the tabs layout's. Idents
 * typed are still a route at once; anything else goes to the assistant.
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

test("the field is at the top of the map, the four tabs in the pill, and a route typed plans", async ({ page }) => {
  await page.goto(fieldTabsPlan());
  await settle(page);
  const top = page.getByTestId("field-tabs");
  await expect(top).toBeVisible({ timeout: slow(30000) });
  const field = top.getByTestId("strip-field");
  await expect(field).toBeVisible();
  await expect(top.getByTestId("strip-mic")).toBeVisible();
  // No avatar in the bar: the pilot's screens are Setup's.
  await expect(top.getByTestId("strip-avatar")).toHaveCount(0);
  // The map's own microphone is put away: the field has one.
  await expect(page.getByTestId("mic-circle")).toHaveCount(0);
  // The four tabs at the foot, docked under the sheet, FPL up.
  const panel = sideDrawer(page);
  for (const tab of ["tab-fpl", "tab-airport", "tab-aircraft", "setup-button"]) await expect(page.getByTestId(tab)).toBeVisible();
  await expect(page.getByTestId("tab-fpl")).toHaveAttribute("data-current", "true");
  // The field at the top, the tabs under it.
  const fieldBox = (await field.boundingBox())!;
  const tabsBox = (await page.getByTestId("tab-fpl").boundingBox())!;
  expect(fieldBox.height).toBeGreaterThanOrEqual(44);
  expect(tabsBox.y).toBeGreaterThan(fieldBox.y + fieldBox.height);
  // Idents typed are a route, as in the strip: the sheet comes up half
  // way on FPL with the route's box.
  await field.fill("C81 KDLH");
  await field.press("Enter");
  await expect(panel.getByTestId("route-box")).toContainText("KDLH", { timeout: slow(30000) });
  await expect(page.getByTestId("tab-fpl")).toHaveAttribute("data-current", "true");
});

test("the field is the assistant's by default, one mic and no Ask button, its answer under the field", async ({ page }) => {
  const asked: { body: { messages: { role: string; content: string }[]; context: { dep: string; dest: string } } }[] = [];
  await mockAssistant(page, asked);
  await page.goto(fieldTabsPlan("dep=C81&dest=KDLH"));
  await settle(page);
  const top = page.getByTestId("field-tabs");
  const field = top.getByTestId("strip-field");
  await expect(field).toBeVisible({ timeout: slow(30000) });
  await expect(top.getByTestId("field-ask")).toHaveCount(0);
  await expect(top.getByTestId("strip-mic")).toHaveCount(1);
  await expect(field).toHaveAttribute("data-ask", "");
  await expect(field).toHaveAttribute("placeholder", "Ask anything, or where to");
  // Focused and empty: the questions first, as chips under the field.
  await field.focus();
  const chip = top.getByTestId("strip-suggestion").first();
  await expect(chip).toHaveText("Can I go?");
  expect((await chip.boundingBox())!.y).toBeGreaterThan((await field.boundingBox())!.y);
  await field.fill("Can I make Duluth before dark?");
  await field.press("Enter");
  const answer = top.getByTestId("strip-answer");
  await expect(answer.getByTestId("ask-question")).toHaveText("Can I make Duluth before dark?");
  await expect(answer.getByTestId("ask-answer")).toContainText("ceiling 4,500 feet", { timeout: slow(15000) });
  expect(asked).toHaveLength(1);
  expect(asked[0]!.body.context).toMatchObject({ dep: "C81", dest: "KDLH" });
});

test("the tabs are docked: nothing of the map under the sheet at the pill", async ({ page }) => {
  await page.goto(fieldTabsPlan());
  await settle(page);
  const panel = sideDrawer(page);
  await expect(page.getByTestId("tab-fpl")).toBeVisible({ timeout: slow(30000) });
  const box = (await panel.boundingBox())!;
  const height = page.viewportSize()!.height;
  expect(Math.abs(box.y + box.height - height)).toBeLessThanOrEqual(1);
  expect(box.x).toBe(0);
});

test("Setup has no Screen row: the tabs are the app's", async ({ page }) => {
  await page.goto("/app/plan");
  await settle(page);
  await expect(page.getByTestId("field-tabs")).toHaveCount(0);
  await openSetup(page);
  await expect(page.getByTestId("layout-select")).toHaveCount(0);
});
