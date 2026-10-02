import { test, expect } from "@playwright/test";
import { slow, settle, sideDrawer, expectDrawerOpen } from "./helpers";

/**
 * What the nav log is computed from: the altitude plans and a pilot's
 * own altitude, a departure time's winds and ETAs, and the aeroplane
 * picked in the drawer's header.
 */

test("plan page: the nav log's altitude opens the planner's own reasoning, and the briefing's Cruise Altitude section carries the same steps", { tag: "@smoke" }, async ({ page }) => {
  // Three re-plans, each allowed 30 s below, inside the default 30 s for
  // the whole test: 18 s on a quiet machine, and past the limit in a
  // full run, where the other workers are asking the planner too.
  test.slow();
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  await page.getByTestId("sidebar-trigger-button").click();
  // The sections start closed: the altitude is in the nav log's own.
  await sideDrawer(page).getByText("Nav Log", { exact: true }).click();
  // The altitude arrives with the nav log stream, after the checkpoints:
  // the Alt column's own heading, named with the figure. The figure
  // alone: which plan it is shows as the pressed row in the popover, not
  // as a word after every altitude.
  const why = page.getByTestId("altitude-why");
  await expect(why).toBeVisible({ timeout: slow(60000) });
  await expect(why).toHaveAccessibleName(/\d ft/);
  await expect(why).not.toHaveAccessibleName(/·/);
  await why.click();
  // A popover beside the altitude, or on a phone a sheet from the bottom.
  const popover = page.locator("[data-slot=popover-content], [data-slot=drawer-content]");
  await expect(popover).toBeVisible();
  await expect(popover).toContainText("Floor");
  await expect(popover).toContainText("Ceiling");
  await expect(popover).toContainText("14 CFR 91.159");
  await expect(popover).toContainText("Four plans");
  await expect(popover).toContainText("Checked as well");
  // The four plans are buttons, the flown one pressed -- the fastest
  // for the winds unless the address says otherwise; picking another
  // re-plans on it and the URL carries the choice.
  for (const kind of ["lowest", "highest", "fastest", "economical"]) {
    await expect(popover.getByTestId(`altitude-plan-${kind}`)).toBeVisible();
  }
  await expect(popover.getByTestId("altitude-plan-fastest")).toHaveAttribute("aria-pressed", "true");
  // Picking a plan closes the popover, and the re-plan takes the
  // altitude figure (and so the popover) off the page and back: opened
  // again, and again if the re-plan closed it, the plan is the pressed
  // one once the log flies it. Every step with a short wait of its own,
  // retried as a whole (toPass, where expect.poll stops at the first
  // throw): the attribute was once read off a popover the re-plan took
  // away mid-read, and the read waited for it for the rest of the minute.
  const flies = (kind: string) => expect(async () => {
    if (!(await popover.isVisible())) await page.getByTestId("altitude-why").click({ timeout: 2000 });
    await expect(popover.getByTestId(`altitude-plan-${kind}`)).toHaveAttribute("aria-pressed", "true", { timeout: 2000 });
  }).toPass({ timeout: slow(30000) });
  await popover.getByTestId("altitude-plan-lowest").click();
  await expect(page).toHaveURL(/[?&]altitude_choice=lowest/);
  await flies("lowest");
  // The fourth, the least fuel: the planner takes it by name.
  await popover.getByTestId("altitude-plan-economical").click();
  await expect(page).toHaveURL(/[?&]altitude_choice=economical/);
  await flies("economical");

  // A custom altitude: the fourth row under the plans. Typed and flown,
  // the whole log is at it, the Alt heading is named with it, and the
  // plans stay offered beside it with none pressed.
  await popover.getByTestId("custom-altitude").fill("3500");
  await popover.getByTestId("custom-altitude-fly").click();
  await expect(page).toHaveURL(/[?&]altitude_ft=3500/);
  await expect(page.getByTestId("altitude-why")).toHaveAccessibleName(/3,500 ft/, { timeout: slow(30000) });
  await expect(sideDrawer(page).locator('table tbody tr[tabindex="0"]').nth(1).locator("td").nth(1)).toHaveText("3,500", { timeout: slow(30000) });
  await page.getByTestId("altitude-why").click();
  await expect(popover).toBeVisible();
  await expect(popover.getByTestId("altitude-plan-lowest")).toHaveAttribute("aria-pressed", "false");
  // Back to the default plan: the custom box empties and the URL drops
  // both the altitude and the choice.
  await popover.getByTestId("altitude-plan-fastest").click();
  await expect(page).not.toHaveURL(/[?&]altitude_ft=/);
  await expect(page).not.toHaveURL(/[?&]altitude_choice=/);
  await flies("fastest");
  // No altitude box in the table's head: Alt is a heading that opens the plans.
  await expect(sideDrawer(page).locator('table thead')).not.toContainText("Cruise altitude");
  expect(await sideDrawer(page).locator('table thead input').count()).toBe(0);

  // Escape closes the popover (open from the check above, opened here
  // if the re-plan has closed it since) and leaves the drawer open.
  if (!(await popover.isVisible())) await page.getByTestId("altitude-why").click();
  await expect(popover).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(popover).toHaveCount(0);
  await expectDrawerOpen(page);

  // The briefing's Cruise Altitude section, closed like the rest until
  // its title is clicked, carries the same steps.
  const drawer = sideDrawer(page);
  await expect(drawer.getByText("Cruise Altitude", { exact: true })).toBeVisible();
  await expect(drawer.getByText("14 CFR 91.159")).toBeHidden();
  await drawer.getByText("Cruise Altitude", { exact: true }).click();
  await expect(drawer.getByText("14 CFR 91.159")).toBeVisible();
});

test("plan page: a departure time gives every checkpoint an ETA, and the nav log's line the arrival", async ({ page }) => {
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  await page.getByTestId("sidebar-trigger-button").click();
  await sideDrawer(page).getByText("Nav Log", { exact: true }).click();
  const table = page.getByRole("table", { name: /Navigation log from/i });
  await expect(table.locator("thead")).not.toContainText("ETA");

  // The day after tomorrow at 15:00 in the browser's own zone: always
  // more than 18 hours out, so the 24-hour winds product, and daytime
  // in Chicago whether the browser keeps UTC (a test container) or
  // Central time, so the day reserve.
  const when = new Date();
  when.setDate(when.getDate() + 2);
  when.setHours(15, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  const isoDay = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`;
  // shadcn's date picker: the day from the calendar in its popover
  // (the next month's, when the day after tomorrow falls there), then
  // the time in the box beside it. No native datetime-local control.
  expect(await page.locator('input[type="datetime-local"]').count()).toBe(0);
  await page.getByTestId("depart-date").click();
  const calendar = page.locator('[data-slot="calendar"]');
  await expect(calendar).toBeVisible();
  const day = calendar.locator(`td[data-day="${isoDay}"] button`);
  if (await day.count() === 0) await calendar.getByRole("button", { name: /next month/i }).click();
  await day.click();
  await expect(calendar).toHaveCount(0);   // a pick closes the popover
  await expect(page).toHaveURL(/[?&]depart=/);
  await expect(page.getByTestId("depart-date")).toContainText(String(when.getDate()));
  await page.getByTestId("depart-time").fill("15:00");
  await expect(table.locator("thead")).toContainText("ETA");
  // The ETA column by its heading: the print-only ATA and fuel columns
  // sit after it, empty on screen.
  const etaIndex = (await table.locator("thead th").allTextContents()).findIndex(text => text.startsWith("ETA"));
  expect(etaIndex).toBeGreaterThan(0);
  // The departure row's own ETA is the departure time itself.
  await expect(table.locator("tbody tr[tabindex='0']").first().locator("td").nth(etaIndex)).toHaveText("15:00");
  // The section's own line says when it arrives, the time en route after it.
  await expect(page.getByTestId("navlog-eta")).toContainText(/^ETA \d\d:\d\d \(\d+h \d\dm\)$/, { timeout: slow(60000) });
  // Every later row has a time once its leg is in.
  await expect.poll(async () => (await table.locator("tbody tr[tabindex='0']").last().locator("td").nth(etaIndex).textContent())?.trim(), { timeout: slow(60000) }).toMatch(/^\d\d:\d\d$/);
  // And the fuel check, against the stock C172's 40 usable gallons,
  // with the day reserve for a mid-afternoon flight -- under the table,
  // where the fuel column it sums ends.
  const fuel = page.getByTestId("fuel-check");
  await expect(fuel.locator("[data-slot=item]", { hasText: "Usable fuel" })).toContainText("40 gal", { timeout: slow(60000) });
  await expect(fuel).toContainText("30 min day reserve");
  const tableBox = (await table.boundingBox())!;
  const noteBox = (await page.getByTestId("fuel-check").boundingBox())!;
  expect(noteBox.y).toBeGreaterThanOrEqual(tableBox.y + tableBox.height);
});

test("plan page: the nav log is computed for an aeroplane the pilot picks in its own header", async ({ page }) => {
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  await page.getByTestId("sidebar-trigger-button").click();
  const picker = page.getByTestId("aircraft-select");
  await expect(picker).toBeVisible();
  await expect(picker).toContainText("C172");
  await picker.click();
  await page.getByRole("option", { name: /PA28/ }).click();
  await expect(picker).toContainText("PA28");
  // Remembered per browser: the same aeroplane after a reload -- on
  // which the drawer is already open, since the address kept it.
  await page.reload();
  await settle(page);
  await expectDrawerOpen(page);
  await expect(page.getByTestId("aircraft-select")).toContainText("PA28");
});

test("plan page: no legal altitude is a short toast, and the nav log opens on why, as a list, with the pilot's own altitude to plan it anyway", async ({ page }) => {
  // The planner's answer for Chicago to Las Vegas in a 172, without the
  // minutes of terrain and winds it takes to reach it.
  await page.route("**/api/planner/navlog**", route => route.fulfill({
    status: 200, contentType: "application/x-ndjson",
    body: [
      { type: "stage", detail: "Planning cruise altitudes…" },
      {
        type: "error", retry: false, detail: "No legal VFR cruising altitude 830-858 nm along the route",
        reasons: [
          "The terrain and obstacles there need 10,600 ft.",
          "The first westbound VFR altitude above that is 12,500 ft.",
          "The aircraft's service ceiling stops at 11,700 ft.",
        ],
        advice: "Route around the high ground, or set a cruise altitude of your own to plan it anyway.",
      },
    ].map(m => JSON.stringify(m)).join("\n") + "\n",
  }));
  await page.goto("/app/plan?dep=C81&dest=KDLH");

  // The toast: the headline, and where the rest is -- with no Try again.
  const toast = page.locator("[data-sonner-toast]", { hasText: "No legal VFR cruising altitude" });
  await expect(toast).toBeVisible({ timeout: slow(30000) });
  await expect(toast).toContainText("The Nav Log says why");
  await expect(toast).not.toContainText("terrain");
  await expect(toast.getByRole("button", { name: "Try again" })).toHaveCount(0);

  // The nav log, open on it: the reasons a list, the advice under them.
  await page.getByTestId("sidebar-trigger-button").click();
  const why = sideDrawer(page).getByTestId("navlog-unflyable");
  await expect(why).toBeVisible();
  await expect(why.getByRole("listitem")).toHaveText([
    "The terrain and obstacles there need 10,600 ft.",
    "The first westbound VFR altitude above that is 12,500 ft.",
    "The aircraft's service ceiling stops at 11,700 ft.",
  ]);
  await expect(why).toContainText("Route around the high ground");

  // Planned anyway, at the pilot's own altitude.
  await why.getByTestId("custom-altitude").fill("12500");
  await why.getByTestId("custom-altitude-fly").click();
  await expect(page).toHaveURL(/[?&]altitude_ft=12500/);
});
