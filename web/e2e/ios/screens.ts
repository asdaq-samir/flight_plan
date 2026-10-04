import { expect, type Page } from "@playwright/test";
import { openSettings, settle, sideDrawer, slow } from "../helpers";

/** One state of the app as a pilot sees it, reached from a fresh page. */
export type Screen = { name: string; ready: (page: Page) => Promise<void> };

const ROUTE = "dep=C81&dest=KDLH";

/**
 * The screens the iOS audit measures: the planner's map, its panel and
 * the nav log with a leg open, an airport's card, the training drawer with a waypoint open,
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
    name: "flight planning drawer",
    ready: async page => {
      await page.goto(`/app/plan?${ROUTE}&view=briefing`);
      await expect(page.getByRole("button", { name: /^Nav Log/ })).toBeVisible({ timeout: slow(30000) });
      // Save enabled, as on the map: not judged fading in.
      await expect(page.getByTestId("save-flight-button")).toBeEnabled({ timeout: slow(30000) });
    },
  },
  {
    name: "nav log, a leg open",
    ready: async page => {
      await page.goto(`/app/plan?${ROUTE}&view=briefing`);
      await page.getByRole("button", { name: /^Nav Log/ }).click();
      await page.getByTestId("fuel-check").waitFor({ timeout: slow(120000) });
      // A tap's click, without Playwright's own scroll into view first:
      // where the table is wider than its drawer (every column, on a
      // phone on its side or an iPad), that scrolled it to its far end,
      // which no finger does.
      await page.locator("tbody tr[data-kind='checkpoint']").nth(2).dispatchEvent("click");
      await expect(page.locator("tbody textarea").first()).toBeVisible();
    },
  },
  {
    name: "airport card",
    ready: async page => {
      await page.goto(`/app/plan?${ROUTE}&place=KDLH`);
      await expect(page.getByTestId("place-name")).toHaveText("Duluth International Airport", { timeout: slow(30000) });
    },
  },
  {
    name: "training drawer, a waypoint open",
    ready: async page => {
      await page.goto(`/app/dev?${ROUTE}`);
      await settle(page);
      await page.getByTestId("sidebar-trigger-button").click();
      const rows = sideDrawer(page).locator("[data-waypoint-row]");
      await expect.poll(() => rows.count(), { timeout: slow(60000) }).toBeGreaterThan(10);
      await rows.nth(2).click();
      await expect(sideDrawer(page).getByRole("button", { name: "Rate 5" })).toBeVisible();
    },
  },
  {
    name: "developer console, System tab",
    ready: async page => {
      await page.goto("/app/dev");
      await page.getByTestId("settings-button").click();
      await page.getByRole("tab", { name: "System" }).click();
      await expect(page.getByTestId("dev-refresh")).toBeVisible();
    },
  },
  {
    name: "pilot console, Guide tab",
    ready: async page => {
      await page.goto("/app/plan");
      await page.getByTestId("settings-button").click();
      await page.getByRole("tab", { name: "Guide" }).click();
      await expect(page.getByRole("heading", { name: "Plan a flight" })).toBeVisible();
    },
  },
  {
    name: "developer console, Guide tab",
    ready: async page => {
      await page.goto("/app/dev");
      await page.getByTestId("settings-button").click();
      await page.getByRole("tab", { name: "Guide" }).click();
      await expect(page.getByRole("heading", { name: "Train the model" })).toBeVisible();
    },
  },
  {
    name: "settings",
    ready: async page => {
      await page.goto("/app/plan");
      await openSettings(page);
      await expect(page.getByTestId("role-menu")).toBeVisible();
    },
  },
  {
    // The route's box of pills -- an airport landed at and a waypoint
    // flown through -- and the aeroplane, the time and the actions under it.
    name: "route box with stops",
    ready: async page => {
      await page.route(url => /\/(checkpoints|navlog|briefing)$/.test(url.pathname) && url.searchParams.get("stops") === "VPBNG,KMSN",
        route => route.abort());
      await page.goto(`/app/plan?${ROUTE}&stops=VPBNG,KMSN&view=briefing`);
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
      await page.getByTestId("route-problem-title").click({ timeout: slow(30000) });
      await expect(page.getByTestId("unflyable-fly-via")).toBeVisible();
    },
  },
  {
    name: "departure picker",
    ready: async page => {
      await page.goto(`/app/plan?${ROUTE}&view=briefing`);
      await page.getByTestId("depart-date").click({ timeout: slow(30000) });
      await page.locator('[data-slot="calendar"] td button').nth(20).click();
      await expect(page.getByTestId("depart-time")).toBeVisible();
      // The plan made again for that day: Save enabled behind the sheet,
      // not judged greyed out mid-plan.
      await expect(page.getByTestId("save-flight-button")).toBeEnabled({ timeout: slow(120000) });
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
      const section = page.locator("[data-slot=accordion-trigger]").filter({ hasText: "Local Flight" });
      await expect(section).toContainText("Aloft", { timeout: slow(30000) });
      await section.click();
      await expect(page.getByTestId("fuel-check")).toBeVisible();
    },
  },
];
