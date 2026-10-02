import { test, expect, type Page } from "@playwright/test";
import { PAGES, consoleSheet, settle, roleMenu, openPanel } from "./helpers";

/**
 * The two pages and the switch between them: the Dev-mode switch, the
 * header they share, and the old addresses that land on one or other.
 */

test("the console's role menu flips to the dev page, the console staying out, and back to where it was flipped from", async ({ page }) => {
  // From the planner's search bar, where its console's button is: a
  // route on screen takes the bar's place, and the button with it.
  await page.goto("/app/plan");
  await settle(page);

  // Pilot on Plan, in the console's title -- the one control that
  // switches roles, in the same place on both pages.
  let roles = await roleMenu(page);
  await expect(roles.pilot).toHaveAttribute("aria-checked", "true");

  // Developer: the dev page, on its own route, and the console still
  // out -- the developer's now.
  await roles.developer.click();
  await page.waitForURL(/\/app\/dev/);
  await expect(consoleSheet(page).getByRole("tab", { name: "Performance" })).toBeVisible({ timeout: 15000 });
  roles = await roleMenu(page);
  await expect(roles.developer).toHaveAttribute("aria-checked", "true");

  // Pilot again: back to exactly where it was flipped from (`state.from`,
  // useDevMode's own).
  await roles.pilot.click();
  await page.waitForURL(/\/app\/plan$/);
});

test("the panel's head looks the same on both pages: the console's role says which one this is", async ({ page }) => {
  await page.goto("/app/plan");
  await settle(page);
  const pilotBg = await page.locator("header").evaluate(el => getComputedStyle(el).backgroundColor);
  await expect(page.locator("[data-mode]")).toHaveAttribute("data-mode", "pilot");
  await expect((await roleMenu(page)).developer).toHaveAttribute("aria-checked", "false");
  await page.goto("/app/dev");
  await settle(page);
  const devBg = await page.locator("header").evaluate(el => getComputedStyle(el).backgroundColor);
  await expect(page.locator("[data-mode]")).toHaveAttribute("data-mode", "dev");
  await expect((await roleMenu(page)).developer).toHaveAttribute("aria-checked", "true");
  expect(devBg).toBe(pilotBg);
});

test("the route form leads the panel's head on both pages, signed in or out", async ({ page, browser }) => {
  // Where the form starts in its row: the same on the planner and the dev
  // page, and for someone signed out, whose actions differ.
  const lead = (p: Page) => p.locator("header").evaluate(header => {
    const form = header.querySelector("form")!.getBoundingClientRect();
    return Math.round(form.left - header.getBoundingClientRect().left);
  });
  const leads: number[] = [];
  for (const path of PAGES) {
    await page.goto(`${path}?dep=C81&dest=KDLH`);
    await settle(page);
    await openPanel(page);
    leads.push(await lead(page));
  }
  const signedOut = await browser.newContext({
    baseURL: new URL(page.url()).origin, viewport: page.viewportSize(), storageState: { cookies: [], origins: [] },
  });
  const planner = await signedOut.newPage();
  await planner.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(planner);
  await openPanel(planner);
  leads.push(await lead(planner));
  await signedOut.close();
  expect(Math.max(...leads) - Math.min(...leads)).toBeLessThanOrEqual(1);
  expect(Math.max(...leads)).toBeLessThanOrEqual(16);
});

test("dev page opened on its own: Pilot falls back to the planner with the dev page's own route", async ({ page }) => {
  await page.goto("/app/dev?dep=C81&dest=KDLH");
  await settle(page);
  await (await roleMenu(page)).pilot.click();
  await page.waitForURL(/\/app\/plan\?dep=C81&dest=KDLH$/);
});

test("the old Settings address lands on the planner", async ({ page }) => {
  await page.goto("/app/settings");
  await page.waitForURL("**/app/plan");
});
