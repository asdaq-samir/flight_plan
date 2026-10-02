import { test, expect, type Page } from "@playwright/test";
import { PAGES, consoleSheet, settle, sideDrawer, roleMenu, expectDrawerOpen, openBriefing, openPanel } from "./helpers";

/**
 * The two pages and the switch between them: the Dev-mode switch, the
 * header they share, and the old addresses that land on one or other.
 */

test("the console's role menu flips to the dev page with the route, the console staying out, and back to where it was flipped from", async ({ page }) => {
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  // With the briefing open on a desktop, where the header stays in
  // reach beside the sidebar; on a phone the drawer is a modal sheet
  // over the header, so the switch is flipped with it closed.
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("no viewport configured");
  const wide = viewport.width >= 768;
  if (wide) await openBriefing(page);

  // Pilot on Plan, in the console's title -- the one control that
  // switches roles, in the same place on both pages.
  let roles = await roleMenu(page);
  await expect(roles.pilot).toHaveAttribute("aria-checked", "true");

  // Developer: the dev page, with the route on screen carried along and
  // Plan's own briefing parameter left behind, and the console still
  // out -- the developer's now.
  await roles.developer.click();
  await page.waitForURL(/\/app\/dev\?dep=C81&dest=KDLH$/);
  await expect(consoleSheet(page).getByRole("tab", { name: "Performance" })).toBeVisible({ timeout: 15000 });
  roles = await roleMenu(page);
  await expect(roles.developer).toHaveAttribute("aria-checked", "true");

  // Pilot again: back to exactly where it was flipped from (`state.from`,
  // useDevMode's own), the open briefing included, not a flat /app/plan.
  await roles.pilot.click();
  if (wide) {
    await page.waitForURL(/\/app\/plan\?dep=C81&dest=KDLH&view=briefing$/);
    await expectDrawerOpen(page);
    await expect(sideDrawer(page).getByTestId("plan-more-button")).toBeVisible();
  } else {
    await page.waitForURL(/\/app\/plan\?dep=C81&dest=KDLH$/);
  }
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
