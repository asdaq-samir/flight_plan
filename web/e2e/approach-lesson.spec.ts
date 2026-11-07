import { test, expect } from "@playwright/test";
import { closeCard, drawn, openTab, settle, slow } from "./helpers";

/**
 * An approach taught (ApproachLesson), at the owner's ask ("do it all",
 * 2026-10-30): from a picked approach's pull-down, Learn This Approach
 * opens a card -- Brief, Fly, Quiz -- that briefs it a Got It a step, flies
 * it fix by fix with a coaching word at each, and asks it back, each step
 * showing its fix on the map. KDLH's ILS 09 via DLH, stubbed as the CIFP
 * codes it (the planner's tests hold the planner to the file).
 */
const LIST = {
  airport: "KDLH", cycle: "261029",
  procedures: [{ kind: "approach", id: "I09", name: "ILS RWY 09", runway: "09", transitions: ["DLH"], runway_transitions: [] }],
};
const DRAWN = {
  airport: "KDLH", kind: "approach", id: "I09", name: "ILS RWY 09", transition: "DLH", cycle: "261029",
  glidepath_deg: 3, final_course_deg: 93,
  lines: [
    { role: "transition", name: "DLH", points: [[46.80, -92.20], [46.84, -92.36]] },
    { role: "final", name: null, points: [[46.84, -92.36], [46.84, -92.33], [46.84, -92.30], [46.842, -92.21]] },
    { role: "missed", name: null, points: [[46.842, -92.21], [46.843, -92.17], [47.0, -92.1]] },
  ],
  holds: [{ fix: "CHERL", turn: "R", inbound_deg: 196, missed: true, kind: "hold", points: [[47.0, -92.1], [47.02, -92.12], [47.0, -92.1]] }],
  fixes: [
    { ident: "DLH", lat: 46.80, lon: -92.20, roles: [], min_ft: null, max_ft: null, speed_kt: null, missed: false },
    { ident: "DL", lat: 46.84, lon: -92.36, roles: ["IAF"], min_ft: 3300, max_ft: null, speed_kt: null, missed: false },
    { ident: "CFBSJ", lat: 46.84, lon: -92.33, roles: ["FACF"], min_ft: 3300, max_ft: null, speed_kt: null, missed: false },
    { ident: "PYKLA", lat: 46.84, lon: -92.30, roles: ["FAF"], min_ft: 3300, max_ft: null, speed_kt: null, missed: false, vertical_angle_deg: 3 },
    { ident: "RW09", lat: 46.842, lon: -92.21, roles: ["MAP"], min_ft: null, max_ft: null, speed_kt: null, missed: false },
    { ident: "CHERL", lat: 47.0, lon: -92.1, roles: ["hold"], min_ft: 4500, max_ft: null, speed_kt: null, missed: true },
  ],
  missed_legs: [
    { path: "CA", fix: null, course_deg: 93, turn: null, min_ft: 3000, max_ft: null },
    { path: "VI", fix: null, course_deg: 320, turn: "L", min_ft: null, max_ft: null },
    { path: "CF", fix: "CHERL", course_deg: 17, turn: null, min_ft: 4500, max_ft: null },
    { path: "HM", fix: "CHERL", course_deg: 197, turn: "R", min_ft: 4500, max_ft: null },
  ],
};

test("a picked approach is taught: briefed a step at a time, flown fix by fix with coaching, and asked back", async ({ page }) => {
  await page.route(url => /\/airport\/[^/]+\/procedures/.test(url.pathname), route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/KDLH/procedures")) return route.fulfill({ json: LIST });
    if (url.pathname.endsWith("/plate")) return route.fulfill({ status: 404, json: { detail: "none" } });
    if (url.pathname.endsWith("/KDLH/procedures/I09")) return route.fulfill({ json: { ...DRAWN, transition: url.searchParams.get("transition") } });
    return route.fulfill({ json: { airport: "C81", cycle: "261029", procedures: [] } });
  });
  await page.goto("/app/plan?dep=C81&dest=KDLH&procs=KDLH:I09:DLH");
  await settle(page);
  await openTab(page, "Nav Log");
  const kdlh = page.getByTestId("procedures").getByRole("region", { name: "KDLH · Arrive" });
  const approach = kdlh.locator("[data-testid=procedure-kind][data-kind=approach]");
  await expect(approach).toContainText("ILS 09 · DLH", { timeout: slow(20000) });
  await approach.click();
  await page.getByTestId("procedure-menu").getByTestId("procedure-menu-learn").click();

  const lesson = page.getByTestId("approach-lesson");
  await expect(lesson).toBeVisible({ timeout: slow(10000) });
  // Its one safety line, the card's subtitle on a phone, its first line beside a desktop's.
  await expect(lesson.getByText("Training aid — fly the FAA plate")).toBeVisible();

  // The brief, a Got It a step: the approach, the radio, the course...
  const brief = lesson.getByTestId("approach-brief");
  await expect(brief).toContainText("ILS RWY 09 at KDLH");
  await brief.getByTestId("approach-brief-next").click();
  await expect(brief).toContainText("Frequencies");
  await brief.getByTestId("approach-brief-next").click();
  await expect(brief).toContainText("093° magnetic");
  await expect(brief).toContainText("Glidepath 3.00°");
  // ...the fixes, each ringed on the map.
  await brief.getByTestId("approach-brief-next").click();
  await brief.getByTestId("approach-brief-next").click();
  await expect(brief).toContainText("Initial Approach Fix");
  await expect(brief).toContainText("Cross at or above 3,300 ft");
  await expect.poll(async () => (await drawn(page, "lesson")).length).toBeGreaterThan(0);

  // Fly: the airplane taken fix by fix, a coaching word at each.
  await lesson.getByTestId("approach-lesson-steps").getByRole("radio", { name: "Fly" }).click();
  const fly = lesson.getByTestId("approach-fly");
  await expect(fly.getByTestId("approach-coach")).toBeVisible();
  for (let i = 0; i < 3; i++) await fly.getByTestId("approach-fly-next").click();
  await expect(fly.getByTestId("approach-coach")).toHaveText("Descend on the 3.00° path, about 480 ft/min at 90 kt, and start the timer.");
  await expect(fly.getByTestId("approach-profile-airplane")).toBeVisible();
  // At 120 kt, the rate for it.
  await fly.getByTestId("approach-fly-speed").getByRole("radio", { name: "120 kt" }).click();
  await expect(fly.getByTestId("approach-coach")).toContainText("about 640 ft/min at 120 kt");
  await fly.getByTestId("approach-fly-next").click();
  await expect(fly.getByTestId("approach-coach")).toContainText("Runway in sight? Land. Otherwise go missed: climb to 3,000 on course 093°");

  // Quiz: one question answered, and what it says after.
  await lesson.getByTestId("approach-lesson-steps").getByRole("radio", { name: "Quiz" }).click();
  const quiz = lesson.getByTestId("approach-quiz");
  await expect(quiz.getByTestId("approach-quiz-question")).toHaveText("What's the minimum altitude at DL?");
  await quiz.getByTestId("approach-quiz-choice").filter({ hasText: "3,300 ft" }).click();
  await expect(quiz.getByTestId("approach-quiz-result")).toContainText("Right");
  await quiz.getByTestId("approach-quiz-next").click();
  await expect(quiz.getByTestId("approach-lesson-progress")).toHaveText("2 of 8");

  // Closed, nothing of it left on the chart.
  // On a phone the tab bar's close, the card drawing none of its own
  // under it (SheetCard); its own from md up.
  await closeCard(page, "approach-lesson-close");
  await expect(lesson).toHaveCount(0);
  await expect.poll(async () => (await drawn(page, "lesson")).length).toBe(0);
});
