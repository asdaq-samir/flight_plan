import { test, expect } from "@playwright/test";
import { library, showTabs } from "./helpers";

/**
 * Instrument currency in the Logbook (14 CFR 61.57(c), (d)): what the
 * webapp reckons from the approaches, holding and tracking logged, said
 * with the window's count, and the last proficiency check given beside
 * it; a flight logged with its approaches sends them. The webapp's
 * answers are stubbed: the rule's arithmetic is CurrencyServiceTest's.
 */

const CURRENCY = {
  dayPassengersUntil: null, nightPassengersUntil: null, flightReviewOn: null, flightReviewUntil: null, medicalExpiresOn: null,
  totalHours: 12, nightHours: 0, crossCountryHours: 4, landings: 6, flights: 3,
  instrumentCurrentUntil: "2099-07-31", ipcOn: null, ipcNeededAfter: "2100-01-31",
  approachesInWindow: 4, holdingInWindow: true, trackingInWindow: false,
};

test("the Logbook says how far instrument currency runs, logs approaches with a flight, and keeps the IPC's date", async ({ page }) => {
  let currency = CURRENCY;
  const logged: Record<string, unknown>[] = [];
  const datesSent: Record<string, unknown>[] = [];
  await page.route(url => url.pathname === "/api/logbook/currency", async route => {
    if (route.request().method() === "PUT") {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      datesSent.push(body);
      currency = { ...currency, ipcOn: body.ipcOn as null };
    }
    await route.fulfill({ json: currency });
  });
  await page.route(url => url.pathname === "/api/logbook", async route => {
    if (route.request().method() === "POST") {
      logged.push(route.request().postDataJSON() as Record<string, unknown>);
      await route.fulfill({ status: 201, json: { id: 9, ...logged.at(-1) } });
    } else {
      await route.fulfill({ json: [] });
    }
  });
  await page.route(url => url.pathname === "/api/training", route => route.fulfill({ json: { experience: [], knowledgeTestCodes: [], endorsements: [] } }));

  await page.goto("/app/plan");
  await showTabs(page);
  await page.getByTestId("settings-button").click();
  const console = page.getByTestId("console-sheet");
  await library(console, "Logbook");
  await expect(console.getByTestId("currency-instrument")).toHaveText("To 31 Jul 2099");
  await expect(console).toContainText("4 of 6 approaches, holding in the window");

  // The proficiency check's date, sent with the other two.
  await console.getByTestId("ipc-date").fill("2026-09-18");
  await expect.poll(() => datesSent.at(-1)?.ipcOn).toBe("2026-09-18");

  // A flight with its approaches, holding and tracking.
  await console.getByTestId("logbook-add").click();
  await page.getByTestId("logbook-totalHours").fill("1.5");
  await page.getByTestId("logbook-approaches").fill("3");
  await page.getByTestId("logbook-holding").click();
  await page.getByTestId("logbook-tracking").click();
  await page.getByTestId("logbook-save").click();
  await expect.poll(() => logged.at(-1)).toMatchObject({ approaches: 3, holding: true, tracking: true });
});

test("an airplane's VOR check is recorded with its kind and error, and says how long it is good for", async ({ page }) => {
  const plane = {
    id: 5, tailNumber: "N12345", typeDesignator: "C172", cruiseTasKt: 110, fuelBurnGph: 8.5, cruisePowerPct: null,
    climbTasKt: null, climbFuelBurnGph: null, usableFuelGal: 40, createdAt: "2026-01-01T00:00:00Z",
    vorCheck: { checkedOn: "2099-10-01", kind: "VOT", place: "KDLH VOT", errorDeg: 2, limitDeg: 4, withinLimit: true, goodThrough: "2099-10-31" },
  };
  const recorded: Record<string, unknown>[] = [];
  await page.route(url => url.pathname === "/api/aircraft", route => route.fulfill({ json: [plane] }));
  await page.route(url => url.pathname === "/api/aircraft/5/vor-check", async route => {
    recorded.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({ json: plane });
  });
  await page.goto("/app/plan");
  await showTabs(page);
  await page.getByTestId("settings-button").click();
  const console = page.getByTestId("console-sheet");
  await library(console, "Aircraft");
  await console.getByRole("button", { name: "Edit N12345" }).click();
  await expect(page.getByTestId("vor-check-standing")).toHaveText("To 2099-10-31");
  await page.getByTestId("vor-check-error").fill("-3");
  await page.getByTestId("vor-check-record").click();
  await expect.poll(() => recorded.at(-1)).toMatchObject({ kind: "VOT", errorDeg: -3 });
});

test("the Logbook's reminders are turned on, and kept", async ({ page }) => {
  let on = false;
  const sent: boolean[] = [];
  await page.route(url => url.pathname === "/api/logbook/reminders", async route => {
    if (route.request().method() === "PUT") {
      on = (route.request().postDataJSON() as { on: boolean }).on;
      sent.push(on);
    }
    await route.fulfill({ json: { on } });
  });
  await page.route(url => url.pathname === "/api/logbook/currency", route => route.fulfill({ json: CURRENCY }));
  await page.route(url => url.pathname === "/api/logbook", route => route.fulfill({ json: [] }));
  await page.route(url => url.pathname === "/api/training", route => route.fulfill({ json: { experience: [], knowledgeTestCodes: [], endorsements: [] } }));
  await page.goto("/app/plan");
  await showTabs(page);
  await page.getByTestId("settings-button").click();
  const console = page.getByTestId("console-sheet");
  await library(console, "Logbook");
  const toggle = console.getByTestId("reminders-toggle");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  expect(sent).toEqual([true]);
});
