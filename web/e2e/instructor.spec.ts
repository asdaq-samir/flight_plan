import { test, expect, type Page } from "@playwright/test";
import { signInByEmail } from "./emailSignIn";
import { controlsInSight, library, noTips, openConsole, openPanel, sideDrawer } from "./helpers";

/**
 * An instructor and a student, both real accounts on the local stack
 * (InstructorService): the student gives their name and asks the
 * instructor in by address from their Checkride page, and puts a saved
 * flight to them as a solo cross-country; the instructor, signed in with
 * that address, gives their certificate on the Logbook's Instructing
 * page, takes the student on, reads what the student's record answers of
 * 14 CFR 61.93(d), ticks what is theirs to determine and signs AC 61-65K
 * A.10 -- which the student then holds, with the signature line AC 61-65K
 * asks for, and their flight's review says endorsed.
 */
test.use({ storageState: { cookies: [], origins: [] } });

async function signedInAs(page: Page, address: string) {
  await page.addInitScript(noTips);
  await page.goto("/app/plan");
  await signInByEmail(page, address);
  await expect.poll(async () => (await page.request.get("/api/me")).status()).toBe(200);
}

/** The console, once the page has drawn its tab bar: just signed in, the
 *  phone's panel was still coming up as openConsole looked for the
 *  minimized title, found none, and waited on a gear it never showed.
 *  openConsole shows the tabs itself (shown twice, the second tap folded
 *  them away again). */
async function consoleOpen(page: Page) {
  const console = page.getByTestId("console-sheet");
  await expect(page.getByTestId("tab-title").or(page.getByTestId("setup-button")).or(console).first()).toBeVisible();
  if (!(await console.isVisible())) await openConsole(page);
}

async function logbook(page: Page) {
  await consoleOpen(page);
  const console = page.getByTestId("console-sheet");
  await library(console, "Logbook");
  return console;
}

test("a student asks an instructor in, and the instructor endorses their solo cross-country", async ({ page, browser }) => {
  test.setTimeout(240_000);
  const stamp = Date.now();
  const student = `student-${stamp}@example.com`;
  const cfi = `cfi-${stamp}@example.com`;

  // The student: their name, then the instructor asked in.
  await signedInAs(page, student);
  let console = await logbook(page);
  await console.getByRole("button", { name: /^Checkride/ }).click();
  await console.getByTestId("student-name").fill("Avery B. Student");
  await console.getByTestId("instructor-email").fill(cfi);
  await console.getByTestId("instructor-ask").click();
  await expect(console.getByTestId("instructor-link")).toContainText(cfi);
  await expect(console.getByTestId("instructor-link")).toContainText("Asked, not answered yet");

  // A saved flight of theirs, filed through the app's own endpoint.
  const xsrf = async (p: Page) => decodeURIComponent((await p.context().cookies()).find(c => c.name === "XSRF-TOKEN")?.value ?? "");
  const filed = await page.request.post("/api/flights", {
    headers: { "X-XSRF-TOKEN": await xsrf(page) },
    data: { departureIdent: "KUGN", destinationIdent: "KUGN", stops: ["KRFD"], cruiseAltitudeFt: 4500, totalDistanceNm: 120,
      totalEteMin: 70, totalFuelGal: 9, checkpoints: [] },
  });
  expect(filed.ok()).toBe(true);

  // The instructor, in a browser of their own: the certificate, then the
  // student taken on.
  // The project's own options apply to a context made here too (baseURL,
  // the device); only the developer's session is left out.
  const theirs = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const instructor = await theirs.newPage();
  await signedInAs(instructor, cfi);
  let desk = await logbook(instructor);
  await desk.getByRole("button", { name: /^Instructing/ }).click();
  await desk.getByTestId("cfi-name").fill("J. J. Jones");
  await desk.getByTestId("cfi-number").fill("987654321CFI");
  await desk.getByTestId("cfi-until").fill("2027-12-31");
  await desk.getByTestId("cfi-save").click();
  await expect(desk.getByTestId("cfi-certificate")).toContainText("987654321CFI");
  await expect(desk.getByTestId("student-ask")).toContainText("Avery B. Student");
  await desk.getByTestId("student-accept").click();
  await expect(desk.getByRole("button", { name: /^Avery B\. Student/ })).toBeVisible();

  // The student puts the flight to them, from Flights.
  await page.reload();
  await consoleOpen(page);
  console = page.getByTestId("console-sheet");
  await library(console, "Flights");
  await console.getByRole("button", { name: /KUGN/ }).first().click();
  await console.getByTestId("review-make-model").fill("Cessna 172");
  await console.getByTestId("review-note").fill("Back by four");
  await console.getByTestId("review-ask").click();
  await expect(console.getByTestId("flight-review")).toContainText("Waiting for your instructor");

  // The instructor reads it and signs A.10.
  await instructor.reload();
  desk = await logbook(instructor);
  await desk.getByRole("button", { name: /^Instructing/ }).click();
  await desk.getByRole("button", { name: /^Avery B\. Student/ }).click();
  const review = desk.getByTestId("review");
  await expect(review).toContainText("KUGN KRFD KUGN");
  await expect(review).toContainText("“Back by four”");
  // No solo cross-country endorsement on record, nor a solo one: 61.93(d)(4), (5).
  await expect(review.getByTestId("review-check")).toHaveCount(2);
  await expect(review.getByTestId("review-check").first()).toContainText("None on record");
  await review.getByTestId("review-endorse").click();
  const form = desk.getByTestId("sign-form");
  await expect(form.getByTestId("sign-field-landings")).toHaveValue("KRFD, KUGN");
  await expect(form.getByTestId("signed-words")).toContainText(
    "I have reviewed the cross-country planning of Avery B. Student. I find the planning and preparation to be correct to make the"
    + " solo flight from KUGN to KUGN via KRFD with landings at KRFD, KUGN in a Cessna 172 aircraft on",
  );
  await expect(form.getByTestId("signed-words")).toContainText("J. J. Jones 987654321CFI RE 12-31-2027");
  // Not until what 61.93(d) asks of the instructor is ticked.
  await expect(form.getByTestId("sign-endorsement")).toBeDisabled();
  for (const tick of await form.getByTestId("sign-determination").all()) await tick.click();
  await form.getByTestId("sign-endorsement").click();
  await expect(desk.getByTestId("review")).toHaveCount(0);

  // The student holds it, its words and signature as signed.
  const record = await (await page.request.get("/api/training")).json() as {
    signed: { code: string; text: string; signature: string }[]; reviews: { endorsement: unknown }[];
  };
  expect(record.signed).toHaveLength(1);
  expect(record.signed[0]!.code).toBe("solo-xc-flight");
  expect(record.signed[0]!.signature).toMatch(/^\/s\/ \d\d-\d\d-\d{4} J\. J\. Jones 987654321CFI RE 12-31-2027$/);
  expect(record.reviews[0]!.endorsement).not.toBeNull();
  await theirs.close();

  // The next one asked from the route itself: Share's menu, which saves
  // the plan on screen as it asks.
  await page.goto("/app/plan?dep=KUGN&dest=KRFD");
  // Opened as the tabs alone: the panel half way, its route box in sight.
  await openPanel(page);
  await controlsInSight(page);
  await sideDrawer(page).getByTestId("share-route").click();
  await expect(page.getByTestId("save-flight-button")).toBeEnabled({ timeout: 90_000 });
  await page.getByTestId("ask-review").click();
  const sheet = page.getByTestId("review-sheet");
  await sheet.getByTestId("review-make-model").fill("Cessna 172");
  await sheet.getByTestId("review-ask").click();
  await expect(sheet).toBeHidden();
  const after = await (await page.request.get("/api/training")).json() as { reviews: { flight: { destinationIdent: string }; answeredAt: string | null }[] };
  expect(after.reviews).toHaveLength(2);
  expect(after.reviews[0]!.flight.destinationIdent).toBe("KRFD");
  expect(after.reviews[0]!.answeredAt).toBeNull();
});
