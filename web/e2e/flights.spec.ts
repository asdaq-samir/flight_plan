import { test, expect, type Page } from "@playwright/test";
import { consoleSheet, controlsInSight, grabberTo, library, openBrief, openConsole, openMapSettings, openPanel, showTabs, sideDrawer } from "./helpers";

/**
 * "Save this flight", at the head of the briefing drawer's sections, for
 * a signed-in pilot. Spring's own endpoints are mocked, so the pilot is
 * one with no airplanes and a known list of flights; the planner and
 * its nav log are real.
 */

const A_PILOT = { id: 1, email: "pilot@example.com", displayName: "A Pilot", developer: false };

async function signedIn(page: Page, filed: Record<string, unknown>[], list: object[] = []) {
  await page.route("**/api/me", route =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(A_PILOT) }));
  await page.route("**/api/aircraft", route =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.route("**/api/flights", async route => {
    if (route.request().method() === "POST") {
      filed.push(route.request().postDataJSON());
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ id: filed.length }) });
    } else {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(list) });
    }
  });
}

/** The plan settled: the runways picked into the wind as the route comes
 *  in write the address and plan it again with their patterns flown, a
 *  moment after Save is first offered -- a Save clicked before that saved
 *  the plan before them, and the menu rightly offered Save again for the
 *  one after (CI and locally, the first test of a fresh worker). The
 *  address the same for two seconds is the plan the page keeps. */
async function planSettled(page: Page) {
  await expect.poll(async () => {
    const was = page.url();
    await page.waitForTimeout(2000);
    return was === page.url();
  }, { timeout: 30_000 }).toBe(true);
}

test("a flight is filed once, whole, and a new plan is offered for saving again", { tag: "@smoke" }, async ({ page }) => {
  test.setTimeout(120_000);
  const filed: Record<string, unknown>[] = [];
  await signedIn(page, filed);
  await page.goto("/app/plan?dep=C81&dest=KDLH&view=briefing");
  // Save is in the half panel's Share menu: all the way up the head is
  // the tab bar.
  await controlsInSight(page);
  const save = page.getByTestId("save-flight-button");

  // Offered once the nav log is whole -- it used to be enabled
  // mid-stream, and filed null totals. An item of Share's menu, its state
  // its name, said again in the menu as it changes.
  await page.getByTestId("share-route").click();
  await expect(save).toHaveAccessibleName("Save this flight", { timeout: 90_000 });
  await expect(save).toBeEnabled({ timeout: 90_000 });
  await planSettled(page);
  await expect(save).toBeEnabled();
  await save.click();
  await page.getByTestId("share-route").click();
  await expect(save).toHaveAccessibleName("Saved");
  await expect(save).toBeDisabled();
  await page.keyboard.press("Escape");

  expect(filed).toHaveLength(1);
  const flight = filed[0] as { totalEteMin: number | null; checkpoints: { category: string; sequenceNo: number }[] };
  expect(flight.totalEteMin).not.toBeNull();
  expect(flight.checkpoints[0]).toMatchObject({ category: "departure", sequenceNo: 0 });
  expect(flight.checkpoints.at(-1)).toMatchObject({ category: "destination" });

  // A new departure time: a fresh nav log is a new plan. "Saved" used to
  // stay for the session, and a click filed a duplicate of whatever was
  // on screen. (There is no Load: every change plans again.)
  await page.getByTestId("depart-date").click();
  await page.locator('[data-slot="calendar"] td button').nth(20).click();
  await page.getByTestId("depart-done").click();
  await expect(page).toHaveURL(/[?&]depart=/);
  await page.getByTestId("share-route").click();
  await expect(save).toHaveAccessibleName("Save this flight", { timeout: 90_000 });
  await expect(save).toBeEnabled({ timeout: 90_000 });
});

// Fly Here's Direct-To in the air starts where the airplane is, and is a
// flight to file like any other: it was offered no Save.
test("a flight from a present position is filed from that position", async ({ page }) => {
  test.setTimeout(120_000);
  const filed: Record<string, unknown>[] = [];
  await signedIn(page, filed);
  await page.goto("/app/plan?dep=%4042.2340%2C-87.9877&dest=KDLH&view=briefing");
  await controlsInSight(page);
  const save = page.getByTestId("save-flight-button");
  await page.getByTestId("share-route").click();
  await expect(save).toBeEnabled({ timeout: 90_000 });
  await planSettled(page);
  await expect(save).toBeEnabled();
  await save.click();
  await page.getByTestId("share-route").click();
  await expect(save).toHaveAccessibleName("Saved");
  expect(filed).toHaveLength(1);
  expect(filed[0]).toMatchObject({ departureIdent: "@42.2340,-87.9877", destinationIdent: "KDLH" });
});

test("signed out, there is nothing to save", async ({ page }) => {
  await page.route("**/api/me", route => route.fulfill({ status: 401, body: "" }));
  await page.goto("/app/plan?dep=C81&dest=KDLH&view=briefing");
  await controlsInSight(page);
  // Share showing means the page is not hidden behind a console: while
  // one is up, the page under it is out of reach of the queries below.
  await expect(page.getByTestId("share-route")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("share-route").click();
  await expect(page.getByTestId("file-flight-plan")).toBeVisible();
  await expect(page.getByTestId("save-flight-button")).toHaveCount(0);
  await page.keyboard.press("Escape");
});

test("opening a saved flight puts its route in the header, and Load plans that route", async ({ page }) => {
  // The header read the address once. Opening a saved flight changes the
  // address in the page, so the header still showed the old route, and
  // Load quietly re-planned that one instead of the flight.
  await signedIn(page, [], [{
    id: 9, departureIdent: "KMSP", destinationIdent: "KDLH", stops: [], cruiseAltitudeFt: 5500, aircraftTailNumber: null,
    createdAt: "2026-09-20T12:00:00Z", plannedFor: null, totalDistanceNm: 120, totalEteMin: 55, totalFuelGal: 8,
    altitudes: "KDLH:2400",
  }]);
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await openPanel(page);
  await expect(page.getByLabel("Departure", { exact: true })).toContainText("C81", { timeout: 15_000 });

  // The console's button is at the end of the route's capsule, lowered.
  await grabberTo(page, "peek");
  await showTabs(page);
  await openConsole(page);
  await library(page, "Flights");
  // The row opens the flight's page; Open on the map is the way in, and
  // it puts the console away.
  await page.getByRole("button", { name: /^KMSP → KDLH/ }).click();
  await page.getByTestId("flight-open").click();
  await expect(page).toHaveURL(/dep=KMSP/);
  await expect(consoleSheet(page)).toHaveCount(0);

  await openPanel(page);
  // Planned at once: there is no Load to press.
  await expect(page.getByLabel("Departure", { exact: true })).toContainText("KMSP");
  await expect(page).toHaveURL(/dep=KMSP/);
  await expect(page).toHaveURL(/altitude_ft=5500/);
  // And at the altitudes the pilot set at its points: Duluth's pattern.
  await expect(page).toHaveURL(/altitudes=KDLH%3A2400/);
});

test("a saved flight opened from FPL's Saved opens its page, and Open on the map plans it", async ({ page }) => {
  // The same page as Setup's, outside Setup: its Open on the map was a
  // dialog's close with no dialog round it, which threw as the page was
  // drawn and took the whole planner down.
  await signedIn(page, [], [{
    id: 9, departureIdent: "KMSP", destinationIdent: "KDLH", stops: [], cruiseAltitudeFt: 5500, aircraftTailNumber: null,
    createdAt: "2026-09-20T12:00:00Z", plannedFor: null, totalDistanceNm: 120, totalEteMin: 55, totalFuelGal: 8,
  }]);
  await page.goto("/app/plan");
  await grabberTo(page, "half");
  const panel = sideDrawer(page);
  await panel.getByTestId("pill-section-saved-more").click();
  await panel.getByRole("button", { name: /^KMSP → KDLH/ }).click();
  await expect(panel.getByTestId("flight-open")).toBeVisible();
  await panel.getByTestId("flight-open").click();
  await expect(page).toHaveURL(/dep=KMSP/);
  await expect(page).not.toHaveURL(/[?&]saved=/);
});

test("Edit over the saved flights puts a minus before each, and the minus deletes one once asked", async ({ page }) => {
  const removed: string[] = [];
  await signedIn(page, [], [{
    id: 9, departureIdent: "KMSP", destinationIdent: "KDLH", stops: [], cruiseAltitudeFt: 5500, aircraftTailNumber: null,
    createdAt: "2026-09-20T12:00:00Z", plannedFor: null, totalDistanceNm: 120, totalEteMin: 55, totalFuelGal: 8,
  }]);
  await page.route("**/api/flights/*", async route => {
    removed.push(route.request().method());
    await route.fulfill({ status: 204, body: "" });
  });
  await page.goto("/app/plan");
  await showTabs(page);
  await openConsole(page);
  await library(page, "Flights");
  // Out of Edit, the row opens the flight's page and has no minus (its
  // Delete is behind it, for a swipe).
  await expect(page.getByRole("button", { name: /^Delete .*…$/ })).toHaveCount(0);

  await page.getByTestId("flights-edit").click();
  await expect(page.getByTestId("flights-edit")).toHaveText("Done");
  await expect(page.getByRole("link", { name: /KMSP → KDLH/ })).toHaveCount(0);
  // The minus brings out the row's Delete, as iOS's does, and the Delete
  // asks first: the flight is the server's.
  await page.getByRole("button", { name: "Delete KMSP → KDLH…", exact: true }).click();
  await page.getByRole("button", { name: "Delete KMSP → KDLH", exact: true }).click();
  await page.getByRole("button", { name: "Delete flight" }).click();
  await expect(page.locator("[data-sonner-toast]", { hasText: "Flight Deleted" })).toBeVisible();
  expect(removed).toEqual(["DELETE"]);
});

test("a saved flight's ••• and its long press offer Share and Remove alone, as every list's do; Remove asks first", async ({ page }) => {
  const removed: string[] = [];
  await signedIn(page, [], [{
    id: 9, departureIdent: "KMSP", destinationIdent: "KDLH", stops: [], cruiseAltitudeFt: 5500, aircraftTailNumber: null,
    createdAt: "2026-09-20T12:00:00Z", plannedFor: null, totalDistanceNm: 120, totalEteMin: 55, totalFuelGal: 8,
  }]);
  await page.route("**/api/flights/*", async route => {
    removed.push(route.request().method());
    await route.fulfill({ status: 204, body: "" });
  });
  await page.goto("/app/plan");
  await grabberTo(page, "half");
  const panel = sideDrawer(page);
  await panel.getByTestId("pill-section-saved-more").click();
  // A right click, as a long press on a phone, brings the same menu up.
  await panel.getByRole("button", { name: /^KMSP → KDLH/ }).click({ button: "right" });
  await expect(page.getByTestId("saved-flight-share")).toBeVisible();
  // Share and Remove, each with its icon, and nothing else (the owner,
  // 2026-10-28).
  await expect(page.getByRole("menuitem")).toHaveText(["Share", "Remove"]);
  await expect(page.getByRole("menuitem").locator("svg")).toHaveCount(2);
  await page.keyboard.press("Escape");
  // Delete picked from the keyboard, as VoiceOver picks it.
  await panel.getByTestId("saved-flight-more").click();
  // Picked again where the pick went unanswered: on the phone project, one
  // run in ten, the menu stays open with Delete focused (Radix's menu in
  // the sheet; not seen by hand).
  const ask = page.getByRole("button", { name: "Delete flight" });
  await expect(async () => {
    if (await ask.isVisible()) return;
    if (!(await page.getByTestId("saved-flight-delete").isVisible())) await panel.getByTestId("saved-flight-more").click();
    await page.getByTestId("saved-flight-delete").focus();
    await page.keyboard.press("Enter");
    await expect(ask).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 30_000 });
  await ask.click();
  await expect.poll(() => removed).toEqual(["DELETE"]);
});

test("Print is in the Brief's Share menu; Keep Charts Offline is in the map's menu, which cannot be on over plain http", async ({ page }) => {
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await controlsInSight(page);
  await openBrief(page);
  await page.getByTestId("tab-share").click();
  await expect(page.getByTestId("print-briefing")).toBeVisible();
  await page.keyboard.press("Escape");

  // From the search bar, the route closed.
  await page.goto("/app/plan");
  await openMapSettings(page);
  const keep = page.getByTestId("keep-offline-toggle");
  await expect(keep).toBeVisible();
  // The suite's stack is plain http, where the service worker that keeps
  // the tiles is not allowed: it cannot be turned on.
  if (!(await page.evaluate(() => window.isSecureContext))) await expect(keep).toBeDisabled();
});
