import { test, expect } from "@playwright/test";
import { slow, settle, sideDrawer, expectDrawerOpen, openTab, openSection, grabberTo, controlsInSight, showTabs, openNavLog, navLogSheet, closeNavLog, closeCard } from "./helpers";

/**
 * What the nav log is computed from: the altitude plans and a pilot's
 * own altitude, a departure time's winds and ETAs, and the airplane
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
  await openTab(page, "Nav Log");
  // The cruising altitude arrives with the nav log stream, after the
  // checkpoints: beside the airplane, the figure in feet to type over, and
  // the profile's button after it (the owner's pick, 2026-10-20).
  await controlsInSight(page);
  const why = page.getByTestId("altitude-why");
  const input = page.getByTestId("altitude-input");
  await expect(why).toHaveAccessibleName(/\d,\d{3} feet|FL\d{3}/, { timeout: slow(60000) });
  // Hundreds of feet after "FL", at the owner's pick: FL045 for 4,500 ft.
  await expect(input).toHaveValue(/^\d{3}$/);
  await why.click();
  // The Profile card: the route from the side with the wheel of legal
  // altitudes in its corner, the altitude's figures, the flight rules,
  // and how it was chosen, folded.
  const popover = page.getByTestId("profile-card");
  await expect(popover).toBeVisible();
  const wheel = popover.getByTestId("altitude-wheel");
  await expect(wheel).toBeVisible();
  await expect(wheel).toHaveAttribute("aria-valuetext", /feet, .*Fastest/);
  await expect(popover.getByTestId("mini-profile")).toBeVisible();
  await expect(popover.getByTestId("altitude-figures")).toContainText(/\d+h \d{2}m/);
  await expect(popover).toContainText("Floor");
  await expect(popover).toContainText("Ceiling");
  await expect(popover).toContainText("14 CFR 91.159");
  await expect(popover).toContainText("Checked as well");
  // A step down the wheel, as VoiceOver's adjustable control steps it:
  // flown once it rests, its plan where it is one's, else as the pilot's own.
  const was = Number(await wheel.getAttribute("aria-valuenow"));
  await wheel.focus();
  await page.keyboard.press("ArrowDown");
  await expect.poll(async () => Number(await wheel.getAttribute("aria-valuenow"))).toBeLessThan(was);
  await expect(page).toHaveURL(/[?&](altitude_ft|altitude_choice)=/, { timeout: slow(10000) });
  await closeCard(page, "profile-close");
  await expect(popover).toHaveCount(0);

  // An altitude typed beside the airplane: the whole log at it.
  await input.fill("3500");
  await input.press("Enter");
  await expect(page).toHaveURL(/[?&]altitude_ft=3500/);
  await expect(why).toHaveAccessibleName(/3,500 feet/, { timeout: slow(30000) });
  // The log at it: said where the altitude is reached -- a top of climb's
  // level, or the first leg's where the climb ends before its checkpoint.
  await openNavLog(page);
  await expect(navLogSheet(page).getByTestId("navlog-list")).toContainText("3,500 ft", { timeout: slow(30000) });
  await closeNavLog(page);
  // No altitude box over FPL's list: the altitude is beside the airplane.
  await expect(sideDrawer(page).getByTestId("navlog-scroller")).not.toContainText("Cruise altitude");
  // Back to the default plan from the wheel: its Fastest row, the address
  // without the altitude or the choice.
  await why.click();
  await expect(popover).toBeVisible();
  await popover.getByTestId("altitude-wheel-row").filter({ hasText: "Fastest" }).first().click();
  await expect(page).not.toHaveURL(/[?&]altitude_ft=/, { timeout: slow(10000) });
  await expect(page).not.toHaveURL(/[?&]altitude_choice=/);
  await closeCard(page, "profile-close");
  // Planned again as the plan, whatever its altitude: with CI's winds
  // Fastest cruises at the very 3,500 ft typed above, so the figure alone
  // cannot tell the two apart -- the plan's name in the Brief can.
  await expect(why).toHaveAccessibleName(/\d,\d{3} feet|FL\d{3}/, { timeout: slow(30000) });

  // The Brief's Cruise Altitude section carries the same steps, the plan
  // flown first with its time and fuel, and says the floor and the
  // ceiling once each, with their reasons (the owner's pick of the
  // redesign): there is no list over the steps that said them again.
  const drawer = sideDrawer(page);
  await openTab(page, "Nav Log");
  await openSection(page, "Cruise Altitude");
  const cruise = drawer.locator('[data-title="Cruise Altitude"]');
  await expect(cruise).toBeVisible();
  await expect(drawer.getByText("14 CFR 91.159")).toBeVisible();
  const steps = cruise.getByTestId("altitude-steps").locator('[data-slot="accordion-trigger"]');
  await expect(steps.first()).toContainText(/^Fastest plan.+\d+h \d{2}m · [\d.]+ gal$/);
  await expect(steps.nth(1)).toContainText(/^FloorTerrain and obstacles, with margin[\d,]+ ft$/);
  await expect(cruise.getByText(/^(Floor|Ceiling)\b/)).toHaveCount(2);
  await expect(cruise).not.toContainText("How it was chosen");
});

test("plan page: a departure time gives every checkpoint its time, and the nav log's line the arrival", async ({ page }) => {
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  await page.getByTestId("sidebar-trigger-button").click();
  await openTab(page, "Nav Log");
  const table = page.getByRole("table", { name: /Navigation log from/i });
  const times = table.getByTestId("navlog-row-eta");

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
  await controlsInSight(page);
  await page.getByTestId("depart-date").click();
  const calendar = page.locator('[data-slot="calendar"]');
  await expect(calendar).toBeVisible();
  const day = calendar.locator(`td[data-day="${isoDay}"] button`);
  if (await day.count() === 0) await calendar.getByRole("button", { name: /next month/i }).click();
  await day.click();
  await expect(page).toHaveURL(/[?&]depart=/);
  // The time under the calendar, and Done.
  await page.getByTestId("depart-time").fill("15:00");
  await page.getByTestId("depart-done").click();
  await expect(calendar).toHaveCount(0);
  await expect(page.getByTestId("depart-date")).toContainText("15:00");
  // The nav log, in its sheet: the departure row's time is the departure
  // itself.
  await openNavLog(page);
  await expect(times.first()).toHaveText("15:00");
  // The route's figures say where it lands, the time en route and the
  // fuel required (the owner's "To, Dist, ETE, Fuel").
  await expect(page.getByTestId("navlog-fuel")).toHaveText(/^\d+\.\d gal$/, { timeout: slow(60000) });
  await expect(page.getByTestId("navlog-to")).toHaveText("KDLH");
  await expect(page.getByTestId("navlog-ete")).toHaveText(/^\d+h \d\dm$/);
  // Every later row has a time once its leg is in.
  await expect.poll(async () => (await times.last().textContent())?.trim(), { timeout: slow(60000) }).toMatch(/^\d\d:\d\d$/);
  await closeNavLog(page);
  // The time en route tapped, the arrival in its place, and back.
  await page.getByTestId("ete-eta-toggle").click();
  await expect(page.getByTestId("navlog-eta")).toHaveText(/^\d\d:\d\d$/);
  await page.getByTestId("ete-eta-toggle").click();
  await expect(page.getByTestId("navlog-ete")).toHaveText(/^\d+h \d\dm$/);
  // The fuel tapped, what it is made of, summing to it.
  await page.getByTestId("fuel-breakdown-open").click();
  const breakdown = page.getByTestId("fuel-breakdown");
  await expect(breakdown).toContainText("Flying the legs");
  await expect(breakdown).toContainText("Start, taxi and takeoff");
  await expect(breakdown).toContainText(/Reserve, (30|45) min/);
  await expect(breakdown).toContainText(/Fuel required\s*\d+\.\d gal/);
  await page.keyboard.press("Escape");
  await expect(breakdown).toHaveCount(0);
  // And the fuel check, against the stock C172's 40 usable gallons, with
  // the day reserve for a mid-afternoon flight: the figure's alone now,
  // no line under the route (the owner's "Remove fuel required at the
  // bottom of arrival"), and in full in the Brief.
  await expect(page.getByTestId("fuel-check")).toHaveCount(0);
  await expect(page.getByTestId("fuel-breakdown-open")).not.toHaveAttribute("data-alert");
  await openSection(page, "Fuel");
  const detail = page.getByTestId("fuel-detail");
  await expect(detail.locator("[data-slot=item]", { hasText: "Usable fuel" })).toContainText("40 gal");
  await expect(detail).toContainText("30 min day reserve");
});

test("plan page: the nav log is computed for an airplane the pilot picks in its own header", async ({ page }) => {
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  // All the way up, which the address keeps (`view`), for the reload below.
  await grabberTo(page, "full");
  await controlsInSight(page);
  const picker = page.getByTestId("aircraft-select");
  await expect(picker).toBeVisible();
  await expect(picker).toContainText("C172");
  await picker.click();
  await page.getByRole("option", { name: /PA28/ }).click();
  await expect(picker).toContainText("PA28");
  // Remembered per browser: the same airplane with the plan opened
  // again from its address -- on which the drawer is already open, since
  // the address kept it all the way up. (A reload forgets the route:
  // lib/freshLoad.)
  await grabberTo(page, "full");
  await page.goto(page.url());
  await settle(page);
  await expectDrawerOpen(page);
  await controlsInSight(page);
  await expect(page.getByTestId("aircraft-select")).toContainText("PA28");
});

test("plan page: no legal altitude is the route's own problem: its chip says so at rest, and a mark beside the Nav Log opens to why and the two ways on", async ({ page }) => {
  // The planner's answer for Chicago to Las Vegas in a 172, without the
  // minutes of terrain and winds it takes to reach it.
  await page.route("**/api/planner/navlog**", route => route.fulfill({
    status: 200, contentType: "application/x-ndjson",
    body: [
      { type: "stage", detail: "Planning cruise altitudes…" },
      {
        type: "error", retry: false, detail: "No legal VFR cruising altitude 830-858 nm along the route",
        brief: "Aircraft ceiling restricts mountainous flying",
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

  // At rest the route says so, a red mark on its tab in the pill:
  // nothing over the map.
  await expect(page.getByTestId("tab-mark-fpl")).toHaveAttribute("data-finding", "stop", { timeout: slow(30000) });
  await showTabs(page);
  await expect(page.getByTestId("tab-fpl")).toHaveAccessibleName(/^FPL, warning$/);
  await expect(page.locator("[data-problem-banner]")).toHaveCount(0);
  await expect(page.locator("[data-sonner-toast]", { hasText: "No legal" })).toHaveCount(0);
  // The figures in the pill, under its profile, at the pilot's ask: the
  // book's time, marked "≈".
  await grabberTo(page, "peek");
  await expect(sideDrawer(page).getByTestId("navlog-ete")).toHaveText(/^≈/);

  // All the way up: the cruising altitude's chip red, and no line under
  // the route.
  await grabberTo(page, "full");
  // The figures stay, the book's marked "≈", where why stood in their
  // place in red; why is the Brief's, its Go / No-Go's altitude red.
  await expect(sideDrawer(page).getByTestId("navlog-ete")).toHaveText(/^≈/);
  await openTab(page, "Brief");
  const altitude = sideDrawer(page).getByTestId("verdict-altitude");
  await expect(altitude).toHaveAttribute("data-finding", "stop");
  await expect(altitude).toContainText("Aircraft ceiling restricts mountainous flying");
  await openTab(page, "Nav Log");
  await controlsInSight(page);
  const mark = page.getByTestId("altitude-why");
  await expect(mark).toHaveAccessibleName(/no legal altitude/);
  await expect(page.getByTestId("altitude-input")).toHaveValue("");
  const problem = page.getByTestId("route-problem");
  await expect(problem).toHaveCount(0);
  // By its slot: on a phone the chip's sheet hides the page from the
  // accessibility tree, and a role lookup with it.
  const navLog = sideDrawer(page).getByTestId("navlog-scroller");

  // A tap on the mark: where, why as a list -- with no Try again, which
  // would only say the same -- and the section left as it was.
  await mark.click();
  await expect(problem).toContainText("No legal VFR cruising altitude 830-858 nm along the route");
  await expect(problem.getByRole("listitem")).toHaveText([
    "The terrain and obstacles there need 10,600 ft.",
    "The first westbound VFR altitude above that is 12,500 ft.",
    "The aircraft's service ceiling stops at 11,700 ft.",
  ]);
  await expect(problem.getByRole("button", { name: "Try again" })).toHaveCount(0);
  await expect(navLog).toBeAttached();
  await expect(sideDrawer(page).getByTestId("brief-card")).toHaveCount(0);

  // An altitude of the pilot's own, typed beside the airplane: planned
  // anyway, at it.
  await closeCard(page, "profile-close");
  await page.getByTestId("altitude-input").fill("12500");
  await page.getByTestId("altitude-input").press("Enter");
  await expect(page).toHaveURL(/[?&]altitude_ft=12500/);

  // Or a stop: the route's box takes the typing. Once planned again at that
  // altitude: the problem goes and comes back as the plan is made, and a
  // tap while it was gone found nothing -- the tap tried again with it.
  await expect(page.locator("[data-sonner-toast][data-type=loading]")).toHaveCount(0, { timeout: slow(30000) });
  await expect(async () => {
    if (!(await problem.isVisible())) await mark.click();
    await problem.getByTestId("unflyable-add-stop").click({ timeout: 2000 });
  }).toPass({ timeout: slow(30000) });
  await expect(sideDrawer(page).getByTestId("route-type")).toBeFocused();
});

test("plan page: Class B is planned through by default, said with its clearance, and Avoid Class B puts the waypoint round it in the stops", async ({ page }) => {
  // The owner's pick (2026-10-20): Class B accepted unless avoided. The
  // planner's own plan, with a Class B on the side view at its altitude
  // and the waypoint round it (BEPKE, 6 nm further) put in its answer.
  let asked = "";
  await page.route(url => url.pathname.endsWith("/planner/navlog"), async route => {
    asked = new URL(route.request().url()).searchParams.get("class_b_clearance") ?? "";
    const response = await route.fetch();
    const body = (await response.text()).split("\n").map(line => {
      if (!line.trim()) return line;
      const message = JSON.parse(line);
      if (message.type === "altitude") message.class_b_detours = [{ ident: "BEPKE", kind: "GPS waypoint", added_nm: 5.9, stop_index: 0 }];
      return JSON.stringify(message);
    }).join("\n");
    await route.fulfill({ response, body });
  });
  await page.route(url => url.pathname.includes("/planner/route-profile"), async route => {
    const response = await route.fetch();
    const profile = await response.json();
    profile.airspace = [...profile.airspace, { name: "CHICAGO CLASS B", class: "B", from_nm: 0, to_nm: 20, floor_ft: 0, ceiling_ft: 18000 }];
    await route.fulfill({ response, json: profile });
  });
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  await controlsInSight(page);
  await expect(page.getByTestId("altitude-why")).toHaveAccessibleName(/feet|FL/, { timeout: slow(60000) });
  expect(asked).toBe("true");
  await page.getByTestId("altitude-why").click();
  const accepted = page.getByTestId("class-b-accepted");
  await expect(accepted).toContainText("Through Chicago Class B: clearance needed");
  await page.getByTestId("avoid-class-b").click();
  await expect(page).toHaveURL(/[?&]class_b=0/);
  await expect(page).toHaveURL(/[?&]stops=BEPKE/);
  // Avoided, and allowed again from the same card, which stays open.
  await page.getByTestId("class-b-avoided").getByRole("button", { name: "Allow Class B" }).click();
  await expect(page).not.toHaveURL(/class_b=/);
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("plan page: Class B avoided with no legal altitude offers the waypoint round it, or allowing the Class B", async ({ page }) => {
  // Midway to Duluth runs over O'Hare, where the Chicago Class B reaches
  // the ground: avoided (class_b=0), the planner names a waypoint round it.
  await page.route("**/api/planner/navlog**", route => {
    if (new URL(route.request().url()).searchParams.get("class_b_clearance") === "true") return route.fallback();
    return route.fulfill({
      status: 200, contentType: "application/x-ndjson",
      body: JSON.stringify({
        type: "error", retry: false, detail: "No legal VFR cruising altitude 1-15 nm along the route",
        reasons: ["The Chicago Class B reaches the ground there; going through it needs a clearance."],
        advice: "Fly via BEPKE (6 nm further) to stay out of it, or plan it with a Class B clearance.",
        class_b: true, detours: [{ ident: "BEPKE", kind: "GPS waypoint", added_nm: 5.9, stop_index: 0 }],
      }) + "\n",
    });
  });
  await page.goto("/app/plan?dep=C81&dest=KDLH&class_b=0");
  await expect(page.getByTestId("tab-mark-fpl")).toHaveAttribute("data-finding", "stop", { timeout: slow(30000) });
  await controlsInSight(page);
  const problem = page.getByTestId("route-problem");
  const mark = page.getByTestId("altitude-why");
  await mark.click();
  await expect(problem.getByRole("listitem")).toHaveText(["The Chicago Class B reaches the ground there; going through it needs a clearance."]);
  // The two ways past it, and no altitude of the pilot's own: under a
  // Class B to the ground there is none.
  await expect(problem.getByTestId("unflyable-fly-via")).toBeVisible();
  // The card put away, the field beside the airplane still takes a figure,
  // at the owner's ask ("altitude should not be disabled").
  await closeCard(page, "profile-close");
  await expect(page.getByTestId("altitude-input")).toBeEnabled();
  // Allowed: planned through it, the address back to its default.
  await mark.click();
  await problem.getByTestId("unflyable-accept-class-b").click();
  await expect(page).not.toHaveURL(/class_b=/);
});

test("plan page: no legal altitude's own altitude field takes a tap", async ({ page }) => {
  // Beside the airplane: a tap on the field is the field's, its keyboard
  // coming up.
  await page.route("**/api/planner/navlog**", route => route.fulfill({
    status: 200, contentType: "application/x-ndjson",
    body: JSON.stringify({ type: "error", retry: false, detail: "No legal VFR cruising altitude 830-858 nm along the route",
      reasons: ["The terrain and obstacles there need 10,600 ft."], advice: "Route around the high ground." }) + "\n",
  }));
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await expect(page.getByTestId("tab-mark-fpl")).toHaveAttribute("data-finding", "stop", { timeout: slow(30000) });
  await controlsInSight(page);
  const field = page.getByTestId("altitude-input");
  await expect(field).toBeVisible();
  await expect.poll(async () => {
    const box = (await field.boundingBox())!;
    return page.evaluate(([x, y]) => (document.elementFromPoint(x, y) as HTMLElement | null)?.dataset.testid ?? null,
      [box.x + box.width / 2, box.y + box.height / 2]);
  }, { timeout: 5000 }).toBe("altitude-input");
  await field.click();
  await expect(field).toBeFocused();
});

test("plan page: an altitude of the pilot's own that breaks a rule is flown as set and warned, with the rule, beside the airplane", async ({ page }) => {
  // C81 to KDLH is westbound: 5,500 ft, well over 3,000 ft above the
  // ground, is an eastbound altitude (14 CFR 91.159).
  await page.goto("/app/plan?dep=C81&dest=KDLH&altitude_ft=5500");
  await settle(page);
  await controlsInSight(page);
  const chip = page.getByTestId("altitude-why");
  await expect(chip).toHaveAccessibleName(/5,500 feet.*caution/, { timeout: slow(60000) });
  await expect(page.getByTestId("own-altitude-flag")).toBeVisible();
  await chip.click();
  const cautions = page.getByTestId("own-altitude-cautions");
  await expect(cautions).toContainText("5,500 ft C81 → KDLH");
  await expect(cautions).toContainText("Westbound above");
  await expect(cautions).toContainText("(14 CFR 91.159)");
});

test("an altitude typed is the field's at once: with no route, kept for the route to come; with one, before its log is planned again", async ({ page }) => {
  // The owner's asks ("it's not letting me enter altitude if no route is
  // there"; "as soon as I enter a new altitude, it should not let me
  // wait"): the figure went blank with no route, and back to the one
  // before, "Planning altitudes…" over it, while the log was planned anew.
  test.slow();
  await page.goto("/app/plan");
  await settle(page);
  await controlsInSight(page);
  const field = page.getByTestId("altitude-input");
  await field.fill("55");
  await field.press("Enter");
  await expect(page).toHaveURL(/[?&]altitude_ft=5500/);
  await expect(field).toHaveValue("055");

  // A route planned, then another altitude: the planner held three seconds
  // over it, the field at it all the while, and nothing said to wait on.
  await page.goto("/app/plan?dep=C81&dest=KDLH&altitude_ft=5500");
  await settle(page);
  await controlsInSight(page);
  await expect(page.getByTestId("altitude-why")).toHaveAccessibleName(/5,500 feet/, { timeout: slow(60000) });
  await page.route(url => url.pathname.endsWith("/navlog") && url.searchParams.get("altitude_ft") === "7500", async route => {
    await new Promise(done => setTimeout(done, 3000));
    await route.continue().catch(() => {});
  });
  await field.fill("75");
  await field.press("Enter");
  await expect(field).toHaveValue("075", { timeout: 1000 });
  await expect(page.locator("[data-sonner-toast][data-type=loading]")).toHaveCount(0);
  await expect(page.getByTestId("altitude-why")).toHaveAccessibleName(/7,500 feet/);
});
