import { expect, type Page } from "@playwright/test";
import { settle, sideDrawer, slow } from "../helpers";

/** One state of the app as a pilot sees it, reached from a fresh page. */
export type Screen = { name: string; ready: (page: Page) => Promise<void> };

const ROUTE = "dep=C81&dest=KDLH";

/**
 * The screens the iOS audit measures: the planner's map, its drawer and
 * the nav log with a leg open, the training drawer with a waypoint open,
 * the developer console and the settings. Nothing is written: a row is
 * selected, never rated, and no note is typed.
 */
export const SCREENS: Screen[] = [
  {
    name: "map",
    ready: async page => {
      await page.goto(`/app/plan?${ROUTE}`);
      await settle(page);
      await expect(page.locator(".leaflet-marker-icon").first()).toBeVisible({ timeout: slow(30000) });
    },
  },
  {
    name: "flight planning drawer",
    ready: async page => {
      await page.goto(`/app/plan?${ROUTE}&view=briefing`);
      await expect(page.getByRole("button", { name: /^Nav Log/ })).toBeVisible({ timeout: slow(30000) });
    },
  },
  {
    name: "nav log, a leg open",
    ready: async page => {
      await page.goto(`/app/plan?${ROUTE}&view=briefing`);
      await page.getByRole("button", { name: /^Nav Log/ }).click();
      await page.getByTestId("fuel-check").waitFor({ timeout: slow(120000) });
      await page.locator("tbody tr[tabindex='0']").nth(3).click();
      await expect(page.locator("tbody textarea").first()).toBeVisible();
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
    name: "settings",
    ready: async page => {
      await page.goto("/app/plan");
      await page.getByTestId("settings-button").click();
      await expect(page.getByRole("switch", { name: "Dev mode" })).toBeVisible();
    },
  },
];
