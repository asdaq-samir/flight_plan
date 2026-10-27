import { expect, type Page } from "@playwright/test";
import { consolePage, controlsInSight, openNavLog, grabberTo, openConsole, openProfile, openPanel, openSection, openSetup, openTab, settle, showTabs, sideDrawer, slow, stripShows } from "../helpers";

/** One state of the app as a pilot sees it, reached from a fresh page. */
export type Screen = { name: string; ready: (page: Page) => Promise<void> };

const ROUTE = "dep=C81&dest=KDLH";

/**
 * The screens the iOS audit measures: the planner's map, its panel and
 * the nav log with a leg open, the panel's other four tabs, an airport's card, the training drawer with a waypoint open,
 * both consoles and the settings. Nothing is written: a row is selected,
 * never rated, and no note is typed.
 */
export const SCREENS: Screen[] = [
  {
    name: "map",
    ready: async page => {
      await page.goto(`/app/plan?${ROUTE}`);
      await settle(page);
      await expect(page.locator(".leaflet-marker-icon").first()).toBeVisible({ timeout: slow(30000) });
      // And the plan in, the capsule at rest over it: its checkpoints
      // drawn and the progress toast gone.
      await expect(page.locator(".leaflet-marker-icon", { hasText: /^\d+$/ }).first()).toBeVisible({ timeout: slow(30000) });
      await expect(page.locator("[data-sonner-toast]")).toHaveCount(0, { timeout: slow(30000) });
    },
  },
  {
    // All the way up: the route's box, the route in order (the nav log a
    // sheet of its own), the side view and the figures (FPL's own, the
    // Brief a card of its own).
    name: "flight planning drawer",
    ready: async page => {
      await page.goto(`/app/plan?${ROUTE}&view=briefing`);
      await expect(sideDrawer(page).getByTestId("procedures")).toBeVisible({ timeout: slow(30000) });
      await expect(sideDrawer(page).getByTestId("navlog-fuel")).toBeVisible({ timeout: slow(120000) });
    },
  },
  {
    // Half way: the route's box, the airplane, the time, the Nav log and
    // Share, the figures at the card's foot.
    name: "route panel, half way",
    ready: async page => {
      await page.goto(`/app/plan?${ROUTE}&view=briefing`);
      await expect(sideDrawer(page).getByTestId("route-brief")).toBeVisible({ timeout: slow(30000) });
      await controlsInSight(page);
      // The plan in, its figures whole: not judged fading in.
      await expect(page.getByTestId("navlog-fuel")).toBeVisible({ timeout: slow(30000) });
      await expect(page.getByTestId("share-route")).toBeEnabled();
    },
  },
  {
    name: "nav log, a leg open",
    ready: async page => {
      await page.goto(`/app/plan?${ROUTE}&view=briefing`);
      // Not tapped when it is up already: a tap on the tab up takes the
      // panel back to half, and the map's tooltips came up under the
      // pointer where the panel had been, fading in, read at 1:1 (P15).
      await openTab(page, "Nav Log");
      await page.getByTestId("navlog-fuel").waitFor({ timeout: slow(120000) });
      // The nav log in its own sheet, from the route's box.
      await openNavLog(page);
      // A tap's click, without Playwright's own scroll into view first:
      // where the table is wider than its drawer (every column, on a
      // phone on its side or an iPad), that scrolled it to its far end,
      // which no finger does.
      await page.locator('[role="row"][data-kind="checkpoint"]').nth(2).dispatchEvent("click");
      await expect(page.getByTestId("navlog-list").locator("textarea").first()).toBeVisible();
    },
  },
  // The Brief's pages, each laid out once its briefing is in: the
  // narrative asked for only by a tap, not here.
  ...([
    ["Preflight", "verdict"], ["Depart", "takeoff-landing"], ["En route", "weather-places"], ["Arrive", "weather-places"],
  ] as const).map(([tab, shown]): Screen => ({
    name: `panel, ${tab} tab`,
    ready: async page => {
      await page.goto(`/app/plan?${ROUTE}&view=briefing`);
      await page.getByTestId("navlog-fuel").waitFor({ timeout: slow(120000) });
      await openTab(page, tab);
      if (tab === "En route") await openSection(page, "Along the Route");
      await expect(sideDrawer(page).locator('[role="tabpanel"][data-state="active"]').getByTestId(shown).first()).toBeVisible({ timeout: slow(30000) });
      // And the briefing in: the Brief's Go / No-Go says what it found, and
      // the mock oral's button is enabled once its question table loads --
      // measured as it faded in, it read 2:1 on CI's iPad.
      if (tab === "Preflight") {
        await expect(sideDrawer(page).getByTestId("verdict-weather")).not.toHaveAttribute("data-finding", "pending", { timeout: slow(60000) });
        const ask = sideDrawer(page).getByTestId("oral-ask");
        if (await ask.count()) await expect(ask).toBeEnabled({ timeout: slow(30000) });
      }
    },
  })),
  {
    name: "airport card",
    ready: async page => {
      await page.goto(`/app/plan?${ROUTE}&place=KDLH`);
      await expect(page.getByTestId("place-name")).toHaveText("Duluth International Airport KDLH", { timeout: slow(30000) });
    },
  },
  {
    name: "training drawer, a waypoint open",
    ready: async page => {
      await page.goto(`/app/dev?${ROUTE}`);
      await settle(page);
      await grabberTo(page, "full");
      const rows = sideDrawer(page).locator("[data-waypoint-row]");
      await expect.poll(() => rows.count(), { timeout: slow(60000) }).toBeGreaterThan(10);
      await rows.nth(2).click();
      await expect(sideDrawer(page).getByTestId("rating-card").getByRole("button", { name: "Rate 5" })).toBeVisible();
    },
  },
  {
    name: "developer console, System tab",
    ready: async page => {
      await page.goto("/app/dev");
      await showTabs(page);
      await openConsole(page);
      await consolePage(page, "Status");
      await expect(page.getByTestId("dev-refresh")).toBeVisible();
    },
  },
  {
    name: "pilot console, Guide tab",
    ready: async page => {
      await page.goto("/app/plan");
      await showTabs(page);
      await openConsole(page);
      await consolePage(page, "Guide");
      await expect(page.getByRole("heading", { name: "Plan a flight" })).toBeVisible();
    },
  },
  {
    // Aircraft, Flights, Logbook and Minimums, one tab: its list of the
    // four, each opening its page.
    name: "pilot console, Personal tab",
    ready: async page => {
      await page.goto("/app/plan");
      await showTabs(page);
      await openConsole(page);
      await consolePage(page, "Account");
      await expect(page.getByTestId("library-section")).toBeVisible();
    },
  },
  {
    // One of them open: its way back, its title and its rows.
    name: "pilot console, Personal's Aircraft page",
    ready: async page => {
      await page.goto("/app/plan");
      await showTabs(page);
      await openConsole(page);
      await consolePage(page, "Account");
      await page.getByTestId("library-section").getByRole("button", { name: /^Airplanes/ }).click();
      await expect(page.getByRole("heading", { name: "Airplanes", exact: true })).toBeVisible();
    },
  },
  // The Logbook's training pages: the Checkride page (61.109, the ACS
  // codes, the endorsements and the student's instructor) and the
  // Instructing page, where the developer, no instructor, has the form
  // for a flight instructor certificate.
  ...([
    ["Checkride", "Private pilot experience"],
    ["Instructing", "Your flight instructor certificate"],
  ] as const).map(([row, heading]): Screen => ({
    name: `pilot console, Logbook's ${row} page`,
    ready: async page => {
      await page.goto("/app/plan");
      await showTabs(page);
      await openConsole(page);
      await consolePage(page, "Account");
      await page.getByTestId("library-section").getByRole("button", { name: /^Logbook/ }).click();
      await page.getByRole("button", { name: new RegExp(`^${row}`) }).click();
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    },
  })),
  // The Guide's Practice pages: a drill's card with its answer shown, the
  // holding page's fields and drawing, the lost-comms page's segments.
  ...([
    ["practice, a drill card", "Light gun signals", async (page: Page) => {
      await page.getByTestId("drill-reveal").click();
      await expect(page.getByTestId("drill-knew")).toBeVisible();
    }],
    ["practice, holding entries", "Holding entries", async (page: Page) => {
      await expect(page.getByTestId("hold-diagram")).toBeVisible();
    }],
    ["practice, lost communications", "Lost communications", async (page: Page) => {
      await expect(page.getByTestId("lost-segment").first()).toBeVisible();
    }],
  ] as const).map(([name, row, open]): Screen => ({
    name,
    ready: async page => {
      await page.goto("/app/plan");
      await showTabs(page);
      await openConsole(page);
      await consolePage(page, "Guide");
      await page.getByRole("button", { name: new RegExp(`^${row}`) }).click();
      await open(page);
    },
  })),
  {
    name: "developer console, Guide tab",
    ready: async page => {
      await page.goto("/app/dev");
      await showTabs(page);
      await openConsole(page);
      await consolePage(page, "Guide");
      await expect(page.getByRole("heading", { name: "Train the model" })).toBeVisible();
    },
  },
  {
    name: "setup controls",
    ready: async page => {
      await page.goto("/app/plan");
      await openSetup(page);
      await expect(page.getByTestId("quick-controls").first()).toBeVisible();
    },
  },
  {
    name: "pilot console, About tab",
    ready: async page => {
      await page.goto("/app/plan");
      await openSetup(page);
      await consolePage(page.getByTestId("console-sheet"), "About");
      await expect(page.getByTestId("about-build")).toBeVisible();
    },
  },
  // The tab bar's other places, each as it opens: the airplanes about
  // and the airports nearest, half way up.
  {
    name: "Aircraft tab",
    ready: async page => {
      await page.goto("/app/plan?aircraft=1");
      await settle(page);
      await openPanel(page);
      await expect(sideDrawer(page).getByTestId("aircraft-search")).toBeVisible();
    },
  },
  // An airplane's card in the air, half way as it opens: its column of three,
  // its sketch, Alert, Debrief and its airport, the flight it is on and
  // the one before (adsb.lol and Planespotters stubbed); then its Alert's
  // menu open.
  ...["card", "Alert menu"].map(part => ({
    name: `an airplane's ${part}`,
    ready: async (page: Page) => {
      const now = Date.now() / 1000;
      const plane = { hex: "a89c1e", callsign: "N654FL", registration: "N654FL", type: "P28A", lat: 42.35, lon: -88.0,
        altitude_ft: 4500, pressure_altitude: false, track_deg: 45, speed_kt: 112, vertical_fpm: 500, seen_s: 0.5, squawk: "1200" };
      const c81 = { ident: "C81", name: "Campbell Airport", city: "Grayslake", region: "US-IL" };
      await page.route(url => url.pathname.endsWith("/api/planner/traffic"), route =>
        route.fulfill({ json: { aircraft: [plane], age_s: 1, source: "adsb.lol", license: "ODbL 1.0" } }));
      await page.route(url => /\/api\/planner\/traffic\/flight\/a89c1e\/history$/.test(url.pathname), route => route.fulfill({ json: {
        hex: "a89c1e", registration: "N654FL", type: "P28A", flights: [
          { id: Math.floor(now - 3600), origin: c81, destination: null, off: now - 3600, on: now - 5, landed: false, in_air: true, max_alt_ft: 4500 },
          { id: Math.floor(now - 90000), origin: c81, destination: c81, off: now - 90000, on: now - 86100, landed: true, in_air: false, max_alt_ft: 3000 },
        ] } }));
      await page.route(url => /\/api\/planner\/traffic\/flight\/a89c1e$/.test(url.pathname), route => route.fulfill({ json: {
        hex: "a89c1e", registration: "N654FL", type: "P28A", description: "PIPER PA-28-140/150/160/180", operator: "RYALIS LLC",
        departed: { ident: "C81", name: "Campbell Airport", at: now - 3600 },
        trail: [{ t: now - 3600, lat: 42.32, lon: -88.07, alt_ft: null }, { t: now - 1800, lat: 42.42, lon: -88.2, alt_ft: 3500 }, { t: now - 5, lat: 42.35, lon: -88.0, alt_ft: 4500 }],
      } }));
      await page.route(url => url.hostname === "api.planespotters.net", route => route.fulfill({ json: { photos: [] } }));
      await page.goto("/app/plan?flight=a89c1e");
      await settle(page);
      // Half way, as it opens.
      await expect(sideDrawer(page).getByTestId("flight-now")).toBeAttached({ timeout: slow(30000) });
      if (part === "Alert menu") {
        await sideDrawer(page).getByTestId("flight-alert").click();
        await expect(page.getByTestId("flight-alert-menu")).toBeVisible();
      }
    },
  })),
  // FPL with no route, all the way up: its strip showing the routes
  // planned last, from its filter (the Recents seeded in this browser:
  // nothing is written to the planner).
  {
    name: "FPL, Saved and Recents",
    ready: async page => {
      await page.addInitScript(() => {
        const kept = JSON.parse(localStorage.getItem("vfr.preferences") ?? '{"state":{},"version":1}');
        kept.state.recentRoutes = [
          { dep: "C81", dest: "KDLH", stops: [], at: Date.UTC(2026, 9, 15, 15) },
          { dep: "C81", dest: "KMSP", stops: ["KLSE"], at: Date.UTC(2026, 9, 14, 15) },
        ];
        localStorage.setItem("vfr.preferences", JSON.stringify(kept));
      });
      await page.goto("/app/plan");
      await settle(page);
      await grabberTo(page, "full");
      await stripShows(page, "fpl-strip-shows", "fpl-shows-recents");
      await expect(sideDrawer(page).getByTestId("route-recent").first()).toBeVisible();
    },
  },
  // The route's Procedures, its fields down a line in the order they are
  // flown, each runway's pattern a chip (the redesign's C), FPL's own all
  // the way up with the tops of climb and descent: the chips' hit areas
  // and their words measured as the rows' are.
  {
    name: "FPL, the route in order",
    ready: async page => {
      await page.route(url => /\/airport\/[^/]+\/procedures/.test(url.pathname), route =>
        route.fulfill({ json: { airport: "KDLH", cycle: "261001", procedures: [] } }));
      await page.goto(`/app/plan?${ROUTE}`);
      await settle(page);
      await openTab(page, "Nav Log");
      await expect(page.getByTestId("procedure-pattern").first()).toBeVisible({ timeout: slow(30000) });
    },
  },
  // The route's Procedures with an approach's own page open, as ForeFlight
  // picks one: its transitions and Add to Route under the map. The list
  // and the drawing stubbed, as procedures.spec has them: the FAA's file
  // is not read on CI's runner.
  {
    name: "procedures, an approach's page",
    ready: async page => {
      await page.route(url => /\/airport\/[^/]+\/procedures/.test(url.pathname), route => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith("/KDLH/procedures")) {
          return route.fulfill({ json: { airport: "KDLH", cycle: "261001", procedures: [
            { kind: "approach", id: "I09", name: "ILS RWY 09", runway: "09", transitions: ["DLH"], runway_transitions: [] },
          ] } });
        }
        if (path.endsWith("/KDLH/procedures/I09")) {
          return route.fulfill({ json: {
            airport: "KDLH", kind: "approach", id: "I09", name: "ILS RWY 09", transition: null, cycle: "261001",
            lines: [{ role: "final", name: null, points: [[46.84, -92.40], [46.84, -92.30], [46.842, -92.21]] }],
            holds: [], fixes: [{ ident: "FAKER", lat: 46.84, lon: -92.30, roles: ["FAF"], min_ft: 2700, max_ft: 2700, speed_kt: null, missed: false }],
          } });
        }
        return route.fulfill({ json: { airport: "C81", cycle: "261001", procedures: [] } });
      });
      await page.goto(`/app/plan?${ROUTE}`);
      await settle(page);
      await openTab(page, "Nav Log");
      await page.getByTestId("procedures").getByRole("region", { name: "KDLH · Arrive" })
        .locator('[data-testid=procedure-kind][data-kind=approach]').click({ timeout: slow(30000) });
      // The pull-down's foot opens the field's whole list (ProcedureMenu).
      await page.getByTestId("procedure-menu-all").click();
      await page.getByTestId("procedure-option").first().click();
      await expect(page.getByTestId("procedure-add")).toBeVisible();
    },
  },
  {
    name: "Nearest list",
    ready: async page => {
      await page.goto("/app/plan?near=1");
      await settle(page);
      await openPanel(page);
      await expect(sideDrawer(page).getByTestId("nearest-card")).toBeVisible();
    },
  },
  {
    name: "developer page, Perf tab",
    ready: async page => {
      await page.goto("/app/dev");
      await settle(page);
      await showTabs(page);
      await page.getByTestId("tab-perf").click();
      // The training page's pill is its tabs: Perf all the way up.
      await grabberTo(page, "full");
      await expect(sideDrawer(page).getByTestId("perf-panel").getByText("Model comparison")).toBeVisible({ timeout: slow(30000) });
    },
  },
  {
    // The route's box of pills -- an airport landed at and a waypoint
    // flown through -- and the airplane, the time and the actions under it.
    name: "route box with stops",
    ready: async page => {
      await page.route(url => /\/(checkpoints|navlog|briefing)$/.test(url.pathname) && url.searchParams.get("stops") === "VPBNG,KMSN",
        route => route.abort());
      await page.goto(`/app/plan?${ROUTE}&stops=VPBNG,KMSN&view=briefing`);
      await controlsInSight(page);
      await expect(page.getByTestId("route-box")).toBeVisible({ timeout: slow(30000) });
      await expect(page.getByTestId("stop")).toHaveCount(2);
    },
  },
  {
    // No legal altitude's mark beside the Nav Log, its sheet open: the
    // reasons and the ways round a Class B.
    name: "no legal altitude, opened",
    ready: async page => {
      await page.route("**/api/planner/navlog**", route => route.fulfill({
        status: 200, contentType: "application/x-ndjson",
        body: JSON.stringify({
          type: "error", retry: false, detail: "No legal VFR cruising altitude 1-15 nm along the route",
          reasons: ["The Chicago Class B reaches the ground there; going through it needs a clearance."],
          advice: "Fly via BEPKE (6 nm further) to stay out of it, or plan it with a Class B clearance.",
          class_b: true, detours: [{ ident: "BEPKE", kind: "GPS waypoint", added_nm: 5.9, stop_index: 0, description: "in Downers Grove" }],
        }) + "\n",
      }));
      await page.goto(`/app/plan?${ROUTE}&view=briefing`);
      await controlsInSight(page);
      await openProfile(page);
      await expect(page.getByTestId("unflyable-fly-via")).toBeVisible();
    },
  },
  {
    // The altitude set on the profile (the owner's pick, 2026-10-20): the
    // wheel of legal altitudes beside the route from the side, its
    // figures, Class B and how it was chosen.
    name: "altitude on the profile",
    ready: async page => {
      await page.goto(`/app/plan?${ROUTE}`);
      await settle(page);
      await controlsInSight(page);
      await expect(page.getByTestId("altitude-why")).toHaveAccessibleName(/feet|FL/, { timeout: slow(60000) });
      await openProfile(page);
      await expect(page.getByTestId("altitude-wheel")).toBeVisible();
      await expect(page.getByTestId("altitude-figures")).toBeVisible();
    },
  },
  {
    name: "departure picker",
    ready: async page => {
      await page.goto(`/app/plan?${ROUTE}&view=briefing`);
      await controlsInSight(page);
      await page.getByTestId("depart-date").click({ timeout: slow(30000) });
      await page.locator('[data-slot="calendar"] td button').nth(20).click();
      await expect(page.getByTestId("depart-time")).toBeVisible();
      // The plan made again for that day, its arrival in behind the sheet:
      // not judged greyed out mid-plan.
      await expect(page.getByTestId("navlog-fuel")).toBeAttached({ timeout: slow(120000) });
    },
  },
  {
    // The planner down: the one line by the map's buttons, Try again.
    name: "a service out",
    ready: async page => {
      await page.route("**/api/planner/**", route => route.fulfill({
        status: 502, contentType: "application/json", body: JSON.stringify({ detail: "planner service unreachable" }),
      }));
      await page.goto(`/app/plan?${ROUTE}`);
      await expect(page.locator("[data-problem-banner]").getByRole("button", { name: "Try again" })).toBeVisible({ timeout: slow(30000) });
    },
  },
  {
    name: "local flight",
    ready: async page => {
      await page.goto("/app/plan?dep=C81&dest=C81&view=briefing");
      await expect(page.locator('[data-slot="section-summary"]').first()).toContainText("Aloft", { timeout: slow(30000) });
      // Its fuel required among the figures.
      await openTab(page, "Local");
      await expect(page.getByTestId("navlog-fuel")).toBeVisible({ timeout: slow(30000) });
    },
  },
];
