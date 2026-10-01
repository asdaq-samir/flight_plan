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
      // And the nav log in: until then Save is disabled, and WebKit was
      // measured fading it in, its word at half strength.
      await expect(page.getByTestId("save-flight-button")).toBeEnabled({ timeout: slow(30000) });
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
      await page.locator("tbody tr[tabindex='0']").nth(3).dispatchEvent("click");
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
      await page.getByTestId("dev-console-button").click();
      await page.getByRole("tab", { name: "System" }).click();
      await expect(page.getByTestId("dev-refresh")).toBeVisible();
    },
  },
  {
    name: "pilot console, Guide tab",
    ready: async page => {
      await page.goto("/app/plan");
      await page.getByTestId("pilot-button").click();
      await page.getByRole("tab", { name: "Guide" }).click();
      await expect(page.getByRole("heading", { name: "Plan a flight" })).toBeVisible();
    },
  },
  {
    name: "developer console, Guide tab",
    ready: async page => {
      await page.goto("/app/dev");
      await page.getByTestId("dev-console-button").click();
      await page.getByRole("tab", { name: "Guide" }).click();
      await expect(page.getByRole("heading", { name: "Train the model" })).toBeVisible();
    },
  },
  {
    name: "settings",
    ready: async page => {
      await page.goto("/app/plan");
      await openSettings(page);
      await expect(page.getByRole("switch", { name: "Dev mode" })).toBeVisible();
    },
  },
];
