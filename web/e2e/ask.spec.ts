import { test, expect, type Page } from "@playwright/test";
import { controlsInSight, openBrief, settle, sideDrawer, slow } from "./helpers";

/**
 * The assistant in the Brief (AskCard): a question typed into "Ask about
 * this flight" is answered as the planner streams it, with the reports
 * it rests on as chips, and a chip opens the report as sent. The Brief's
 * words sections (BriefWords) and the flight watch are answered here
 * too, so no billed Claude call is made, and the one that cannot be
 * reached shows its reason in place rather than a toast.
 */

const NDJSON = [
  { type: "tool", name: "weather_at", label: "The weather at KDLH" },
  { type: "text", text: "Yes: Duluth is reporting wind 270 at 12 gusting 18, " },
  { type: "text", text: "and the ceiling is 4,500 feet." },
  { type: "sources", sources: [{ id: "metar:KDLH", label: "METAR KDLH 1753Z", text: "KDLH 031753Z 27012G18KT 10SM BKN045 08/M02 A2992" }] },
  { type: "done" },
].map(line => JSON.stringify(line)).join("\n") + "\n";

const WORDS = {
  sentences: [{ text: "Nothing in the NOTAMs bears on this flight.", sources: ["notam:none"] }],
  sources: [{ id: "notam:none", label: "NOTAMs C81, KDLH", text: "No NOTAMs." }],
  model: "claude-haiku-5-5", unavailable: null,
};

/** The planner's AI routes, each answered here (a URL predicate: a glob's
 *  `**` does not cross the path's slashes). */
async function mockAi(page: Page, asked: { body: unknown }[]) {
  await page.route(url => url.pathname === "/api/planner/assistant", route => {
    asked.push({ body: route.request().postDataJSON() });
    return route.fulfill({ status: 200, contentType: "application/x-ndjson", body: NDJSON });
  });
  await page.route(url => url.pathname.startsWith("/api/planner/words/"), route => {
    const kind = route.request().url().split("/words/")[1]!;
    if (kind === "weather") {
      return route.fulfill({ json: { sentences: [], sources: [], model: null, unavailable: "the model could not be reached" } });
    }
    return route.fulfill({ json: WORDS });
  });
  await page.route(url => /\/api\/flights\/\d+\/watch$/.test(url.pathname), route => route.fulfill({ status: 404, body: "" }));
}

test("a question in the Brief is answered with its sources, and a chip opens the report as sent", async ({ page }) => {
  const asked: { body: { messages: { role: string; content: string }[]; context: { dep: string; dest: string } } }[] = [];
  await mockAi(page, asked);
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  await openBrief(page);
  const panel = sideDrawer(page);
  const field = panel.getByTestId("ask-field");
  await expect(field).toBeVisible({ timeout: slow(30000) });
  await field.fill("Can I make Duluth before dark with this wind?");
  await field.press("Enter");

  await expect(panel.getByTestId("ask-question")).toHaveText("Can I make Duluth before dark with this wind?");
  await expect(panel.getByTestId("ask-answer")).toContainText("ceiling is 4,500 feet", { timeout: slow(15000) });
  const chip = panel.getByTestId("ask-source");
  await expect(chip).toHaveText("METAR KDLH 1753Z");
  // The question went with the plan, as one user message.
  expect(asked).toHaveLength(1);
  expect(asked[0]!.body.messages).toEqual([{ role: "user", content: "Can I make Duluth before dark with this wind?" }]);
  expect(asked[0]!.body.context).toMatchObject({ dep: "C81", dest: "KDLH" });

  await chip.click();
  await expect(page.getByTestId("source-text")).toHaveText("KDLH 031753Z 27012G18KT 10SM BKN045 08/M02 A2992");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("source-dialog")).toHaveCount(0);

  // A second question carries the first and its answer back, unedited.
  await field.fill("And the return leg?");
  await field.press("Enter");
  await expect(panel.getByTestId("ask-turn")).toHaveCount(2);
  await expect.poll(() => asked.length).toBe(2);
  expect(asked[1]!.body.messages.map(m => m.role)).toEqual(["user", "assistant", "user"]);
  expect(asked[1]!.body.messages[1]!.content).toBe("Yes: Duluth is reporting wind 270 at 12 gusting 18, and the ceiling is 4,500 feet.");
});

test("the Brief's words come with their chips, and a reading the model could not write says so in place", async ({ page }) => {
  await mockAi(page, []);
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  await openBrief(page);
  const panel = sideDrawer(page);
  await expect(panel.getByTestId("brief-notam-words-words")).toHaveText("Nothing in the NOTAMs bears on this flight.", { timeout: slow(30000) });
  await expect(panel.getByTestId("brief-notam-words-source")).toHaveText("NOTAMs C81, KDLH");
  await expect(panel.getByTestId("brief-weather-words-unavailable")).toHaveText("Words unavailable: the model could not be reached");
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);
});

test("the route's AI button opens the AI brief, its Ask at its foot, and the menu has no Ask of its own", async ({ page }) => {
  await mockAi(page, []);
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  const panel = sideDrawer(page);
  await controlsInSight(page);
  const ai = panel.getByTestId("route-brief");
  await expect(ai).toHaveAccessibleName(/^AI brief/, { timeout: slow(30000) });
  // The route's menu: the nav log in it, no Ask, no Profile (its own
  // button now).
  await panel.getByTestId("share-route").click();
  await expect(page.getByTestId("route-navlog")).toBeVisible({ timeout: slow(60000) });
  await expect(page.getByTestId("route-ask")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await ai.click();
  await expect(panel.getByTestId("brief-card")).toBeVisible();
  await expect(panel.getByTestId("ask-field")).toBeAttached({ timeout: slow(10000) });
});
