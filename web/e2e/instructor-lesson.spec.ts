import { test, expect, type Page } from "@playwright/test";
import { signInByEmail } from "./emailSignIn";
import { library, noTips, openConsole, slow } from "./helpers";

/**
 * An approach set as a lesson (LessonService), at the owner's "do it all"
 * (2026-10-30), between two real accounts on the local stack: the
 * instructor a student asked in sets them KDLH's ILS 09 from Logbook,
 * Instructing, with a note at its final approach fix; the student opens it
 * from their Checkride page, finds the note on the brief ("Your
 * instructor: …") and answers a quiz question; and the instructor reads
 * the score back. KDLH's procedures stubbed as the CIFP codes them, as the
 * approach lesson's own spec has them.
 */
test.use({ storageState: { cookies: [], origins: [] } });

const LIST = {
  airport: "KDLH", cycle: "261029", stale: false,
  procedures: [{ kind: "approach", id: "I09", name: "ILS RWY 09", runway: "09", transitions: ["DLH"], runway_transitions: [] }],
};
const DRAWN = {
  airport: "KDLH", kind: "approach", id: "I09", name: "ILS RWY 09", transition: null, cycle: "261029", stale: false,
  glidepath_deg: 3, final_course_deg: 93,
  lines: [
    { role: "final", name: null, points: [[46.84, -92.36], [46.84, -92.33], [46.84, -92.30], [46.842, -92.21]] },
    { role: "missed", name: null, points: [[46.842, -92.21], [46.843, -92.17], [47.0, -92.1]] },
  ],
  holds: [{ fix: "CHERL", turn: "R", inbound_deg: 196, missed: true, kind: "hold", points: [[47.0, -92.1], [47.02, -92.12], [47.0, -92.1]] }],
  fixes: [
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

async function stubProcedures(page: Page) {
  await page.route(url => /\/airport\/[^/]+\/procedures/.test(url.pathname), route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/plate")) return route.fulfill({ status: 404, json: { detail: "none" } });
    if (/\/KDLH\/procedures$/.test(url.pathname)) return route.fulfill({ json: LIST });
    if (url.pathname.endsWith("/KDLH/procedures/I09")) return route.fulfill({ json: DRAWN });
    return route.fulfill({ json: { airport: "C81", cycle: "261029", stale: false, procedures: [] } });
  });
}

async function signedInAs(page: Page, address: string) {
  await page.addInitScript(noTips);
  await stubProcedures(page);
  await page.goto("/app/plan");
  await signInByEmail(page, address);
  await expect.poll(async () => (await page.request.get("/api/me")).status()).toBe(200);
}

/** The console once the page has drawn its tab bar (instructor.spec's). */
async function logbook(page: Page) {
  const console = page.getByTestId("console-sheet");
  await expect(page.getByTestId("tab-title").or(page.getByTestId("setup-button")).or(console).first()).toBeVisible();
  if (!(await console.isVisible())) await openConsole(page);
  await library(console, "Logbook");
  return console;
}

test("an instructor sets an approach as a lesson, the student answers its quiz, and the instructor sees the score", async ({ page, browser }) => {
  test.setTimeout(240_000);
  const stamp = Date.now();
  const student = `lesson-student-${stamp}@example.com`;
  const cfi = `lesson-cfi-${stamp}@example.com`;

  // The student asks the instructor in.
  await signedInAs(page, student);
  let console = await logbook(page);
  await console.getByRole("button", { name: /^Checkride/ }).click();
  await console.getByTestId("student-name").fill("Avery B. Student");
  await console.getByTestId("instructor-email").fill(cfi);
  await console.getByTestId("instructor-ask").click();
  await expect(console.getByTestId("instructor-link")).toContainText(cfi);

  // The instructor, in a browser of their own, takes them on and sets the ILS 09.
  const theirs = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const instructor = await theirs.newPage();
  await signedInAs(instructor, cfi);
  let desk = await logbook(instructor);
  await desk.getByRole("button", { name: /^Instructing/ }).click();
  await desk.getByTestId("cfi-name").fill("J. J. Jones");
  await desk.getByTestId("cfi-number").fill("987654321CFI");
  await desk.getByTestId("cfi-until").fill("2027-12-31");
  await desk.getByTestId("cfi-save").click();
  await desk.getByTestId("student-accept").click();
  await desk.getByRole("button", { name: /^Avery B\. Student/ }).click();
  await desk.getByTestId("lesson-assign").click();
  const form = desk.getByTestId("lesson-form");
  await form.getByTestId("lesson-field").fill("KDLH");
  await form.getByTestId("lesson-approach").filter({ hasText: "ILS RWY 09" }).click();
  await form.getByTestId("lesson-note-PYKLA").fill("Power to 1,800 rpm, gear down");
  await form.getByTestId("lesson-assign-send").click();
  await expect(desk.getByTestId("student-lesson")).toContainText("ILS RWY 09 · KDLH");
  await expect(desk.getByTestId("student-lesson")).toContainText("Not started");

  // The student opens it from Checkride: the note on the brief at PYKLA.
  await page.reload();
  console = await logbook(page);
  await console.getByRole("button", { name: /^Checkride/ }).click();
  await expect(console.getByTestId("lesson-row")).toContainText("From J. J. Jones");
  await console.getByTestId("lesson-row").click();
  await expect(page).toHaveURL(/lesson=\d+/);
  const lesson = page.getByTestId("approach-lesson");
  await expect(lesson).toBeVisible({ timeout: slow(15000) });
  const brief = lesson.getByTestId("approach-brief");
  const note = brief.getByTestId("approach-instructor-note");
  for (let i = 0; i < 10 && !(await note.isVisible()); i++) await brief.getByTestId("approach-brief-next").click();
  await expect(note).toContainText("Your instructor: “Power to 1,800 rpm, gear down”");
  await expect(brief).toContainText("PYKLA");

  // A quiz question answered, and sent as it is.
  await lesson.getByTestId("approach-lesson-steps").getByRole("radio", { name: "Quiz" }).click();
  const quiz = lesson.getByTestId("approach-quiz");
  await expect(quiz.getByTestId("approach-quiz-question")).toHaveText("What's the minimum altitude at DL?");
  const sent = page.waitForResponse(r => /\/api\/training\/lessons\/\d+\/progress$/.test(new URL(r.url()).pathname) && r.ok());
  await quiz.getByTestId("approach-quiz-choice").filter({ hasText: "3,300 ft" }).click();
  await expect(quiz.getByTestId("approach-quiz-result")).toContainText("Right");
  await sent;

  // The instructor reads the score, and the answer under it.
  await instructor.reload();
  desk = await logbook(instructor);
  await desk.getByRole("button", { name: /^Instructing/ }).click();
  await desk.getByRole("button", { name: /^Avery B\. Student/ }).click();
  await expect(desk.getByTestId("student-lesson")).toContainText(/Quiz 1 of \d+ answered, 1 right/);
  await desk.getByTestId("student-lesson").click();
  await expect(desk.getByTestId("lesson-answer")).toContainText("What's the minimum altitude at DL?");
  await expect(desk.getByTestId("lesson-answer")).toContainText("3,300 ft");
  await theirs.close();
});
