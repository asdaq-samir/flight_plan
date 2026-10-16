import { expect, type Page } from "@playwright/test";
import { consolePage, controlsInSight, grabberTo, openConsole, openPanel, openSection, openSettings, openTab, settle, showTabs, sideDrawer, slow } from "../helpers";

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
    // All the way up: the route's figures alone over the tabs.
    name: "flight planning drawer",
    ready: async page => {
      await page.goto(`/app/plan?${ROUTE}&view=briefing`);
      await expect(page.getByRole("tab", { name: "Preflight" })).toBeVisible({ timeout: slow(30000) });
      await expect(sideDrawer(page).getByTestId("navlog-eta")).toBeVisible({ timeout: slow(120000) });
    },
  },
  {
    // Half way: the route's box, the airplane, the time, Approaches and
    // Share, the figures at the card's foot.
    name: "route panel, half way",
    ready: async page => {
      await page.goto(`/app/plan?${ROUTE}&view=briefing`);
      await expect(page.getByRole("tab", { name: "Preflight" })).toBeVisible({ timeout: slow(30000) });
      await controlsInSight(page);
      // The plan in, its figures whole: not judged fading in.
      await expect(page.getByTestId("navlog-eta")).toBeVisible({ timeout: slow(30000) });
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
      await openTab(page, "En route");
      await page.getByTestId("fuel-check").waitFor({ timeout: slow(120000) });
      // A tap's click, without Playwright's own scroll into view first:
      // where the table is wider than its drawer (every column, on a
      // phone on its side or an iPad), that scrolled it to its far end,
      // which no finger does.
      await page.locator("tbody tr[data-kind='checkpoint']").nth(2).dispatchEvent("click");
      await expect(page.locator("tbody textarea").first()).toBeVisible();
    },
  },
  // The panel's other tabs, each laid out once its briefing is in: the
  // narrative asked for only by a tap, not here.
  ...([
    ["Preflight", "verdict"], ["Depart", "takeoff-landing"], ["En route", "weather-places"], ["Arrive", "weather-places"],
  ] as const).map(([tab, shown]): Screen => ({
    name: `panel, ${tab} tab`,
    ready: async page => {
      await page.goto(`/app/plan?${ROUTE}&view=briefing`);
      await page.getByTestId("navlog-eta").waitFor({ timeout: slow(120000) });
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
      await page.getByTestId("library-section").getByRole("button", { name: /^Aircraft/ }).click();
      await expect(page.getByRole("heading", { name: "Aircraft", exact: true })).toBeVisible();
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
    name: "settings",
    ready: async page => {
      await page.goto("/app/plan");
      await openSettings(page);
      await expect(page.getByTestId("settings-panel")).toBeVisible();
    },
  },
  {
    name: "pilot console, About tab",
    ready: async page => {
      await page.goto("/app/plan");
      await openSettings(page);
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
  // FPL with no route, all the way up: Saved, and the routes planned last
  // under it, each title the way to its list in full (the Recents seeded
  // in this browser: nothing is written to the planner).
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
      await expect(sideDrawer(page).getByTestId("route-recent").first()).toBeVisible();
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
      await page.getByTestId("altitude-why").click({ timeout: slow(30000) });
      await expect(page.getByTestId("unflyable-fly-via")).toBeVisible();
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
      await expect(page.getByTestId("navlog-eta")).toBeAttached({ timeout: slow(120000) });
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
      await openTab(page, "En route");
      await expect(page.getByTestId("fuel-check")).toBeVisible();
    },
  },
];
