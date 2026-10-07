import { readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";
import { settle, sideDrawer, slow, openTab } from "./helpers";

/**
 * The briefing's Mock Oral (MockOral, the planner's app.oral): the
 * developer's for now. The examiner's replies are a real question and
 * grade, saved (fixtures/oral.json), so the suite makes no billed call;
 * what is checked is what the page sends and shows.
 */
const ORAL = JSON.parse(readFileSync(new URL("./fixtures/oral.json", import.meta.url), "utf8"));

test("a developer is asked about this flight, answers, and is graded against quoted sources", async ({ page }) => {
  const asked: { plan: string; focus: { code: string }[] }[] = [];
  const graded: { answer: string; source_ids: string[] }[] = [];
  await page.route("**/api/planner/oral/question", async route => {
    asked.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(ORAL.question) });
  });
  await page.route("**/api/planner/oral/grade", async route => {
    graded.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(ORAL.grade) });
  });

  await page.goto("/app/plan?dep=C81&dest=KDLH&view=briefing");
  await settle(page);
  await expect(page.getByTestId("navlog-eta")).toBeVisible({ timeout: slow(120000) });
  const drawer = sideDrawer(page);
  await openTab(page, "Brief");
  await drawer.getByTestId("oral-ask").click();

  await expect(drawer.getByTestId("oral-question")).toContainText("VOLK EAST MOA");
  // The flight, in plain lines from the briefing, and three ACS elements.
  expect(asked[0]!.plan).toMatch(/^Route: C81 .* to KDLH/);
  expect(asked[0]!.focus.length).toBeGreaterThan(0);
  expect(asked[0]!.focus.every(f => /^PA\./.test(f.code))).toBe(true);

  await drawer.getByTestId("oral-answer").fill("A MOA is restricted airspace, so I need permission.");
  await drawer.getByTestId("oral-check").click();
  await expect(drawer.getByTestId("oral-grade")).toContainText("Unsatisfactory");
  expect(graded[0]).toMatchObject({ answer: "A MOA is restricted airspace, so I need permission.", source_ids: ORAL.question.source_ids });
  await expect(drawer.getByTestId("oral-citation").first()).toContainText("nonregulatory special use airspace");
  await expect(drawer.getByTestId("oral-ask")).toHaveText("Next question");
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("a pilot who is not the developer has no mock oral yet", async ({ page }) => {
  await page.route("**/api/me", route => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ id: 1, email: "pilot@example.com", displayName: "A Pilot", developer: false }),
  }));
  await page.goto("/app/plan?dep=C81&dest=KDLH&view=briefing");
  await settle(page);
  await expect(page.getByTestId("navlog-eta")).toBeVisible({ timeout: slow(120000) });
  await openTab(page, "Brief");
  await expect(sideDrawer(page).getByRole("heading", { name: "Risk Assessment", exact: true })).toBeVisible();
  await expect(sideDrawer(page).getByRole("heading", { name: "Mock Oral", exact: true })).toHaveCount(0);
});
