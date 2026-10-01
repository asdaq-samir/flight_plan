import { test, expect, type Page } from "@playwright/test";
import { PAGES, settle, sideDrawer, devSwitchInSettings, expectDrawerOpen, openBriefing, openSettings } from "./helpers";

/**
 * The two pages and the switch between them: the Dev-mode switch, the
 * header they share, and the old addresses that land on one or other.
 */

test("the Dev-mode switch is in the settings, flips to the dev page with the route, and back to where it was flipped from", async ({ page }) => {
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  // With the briefing open on a desktop, where the header stays in
  // reach beside the sidebar; on a phone the drawer is a modal sheet
  // over the header, so the switch is flipped with it closed.
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("no viewport configured");
  const wide = viewport.width >= 768;
  if (wide) await openBriefing(page);

  // Off on Plan, in the header's settings -- the one control that
  // switches roles, in the same place on both pages.
  const devSwitch = await devSwitchInSettings(page);
  await expect(devSwitch).toHaveAttribute("aria-checked", "false");

  // On: the dev page, with the route on screen carried along and
  // Plan's own briefing parameter left behind.
  await devSwitch.click();
  await page.waitForURL(/\/app\/dev\?dep=C81&dest=KDLH$/);
  // The settings can come through the change of page open or closed:
  // opened again until the switch is there, rather than an Escape and a
  // click that toggled them shut when they were already.
  const onDev = page.getByRole("switch", { name: "Dev mode" });
  await expect(async () => {
    if (!(await onDev.isVisible())) await openSettings(page);
    await expect(onDev).toHaveAttribute("aria-checked", "true", { timeout: 2000 });
  }).toPass({ timeout: 15000 });

  // Off again: back to exactly where it was flipped from (`state.from`,
  // DevSwitch's own), the open briefing included, not a flat /app/plan.
  await page.getByRole("switch", { name: "Dev mode" }).click();
  if (wide) {
    await page.waitForURL(/\/app\/plan\?dep=C81&dest=KDLH&view=briefing$/);
    await expectDrawerOpen(page);
    await expect(sideDrawer(page).getByTestId("print-button")).toBeVisible();
  } else {
    await page.waitForURL(/\/app\/plan\?dep=C81&dest=KDLH$/);
  }
});

test("the panel's head looks the same on both pages: the settings' Dev-mode switch says which one this is", async ({ page }) => {
  await page.goto("/app/plan");
  await settle(page);
  const pilotBg = await page.locator("header").evaluate(el => getComputedStyle(el).backgroundColor);
  await expect(page.locator("[data-mode]")).toHaveAttribute("data-mode", "pilot");
  await expect(await devSwitchInSettings(page)).toHaveAttribute("aria-checked", "false");
  await page.goto("/app/dev");
  await settle(page);
  const devBg = await page.locator("header").evaluate(el => getComputedStyle(el).backgroundColor);
  await expect(page.locator("[data-mode]")).toHaveAttribute("data-mode", "dev");
  await expect(await devSwitchInSettings(page)).toHaveAttribute("aria-checked", "true");
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
    await page.goto(path);
    await settle(page);
    leads.push(await lead(page));
  }
  const signedOut = await browser.newContext({
    baseURL: new URL(page.url()).origin, viewport: page.viewportSize(), storageState: { cookies: [], origins: [] },
  });
  const planner = await signedOut.newPage();
  await planner.goto("/app/plan");
  await settle(planner);
  leads.push(await lead(planner));
  await signedOut.close();
  expect(Math.max(...leads) - Math.min(...leads)).toBeLessThanOrEqual(1);
  expect(Math.max(...leads)).toBeLessThanOrEqual(16);
});

test("dev page opened on its own: the switch falls back to the planner with the dev page's own route", async ({ page }) => {
  await page.goto("/app/dev?dep=C81&dest=KDLH");
  await settle(page);
  await (await devSwitchInSettings(page)).click();
  await page.waitForURL(/\/app\/plan\?dep=C81&dest=KDLH$/);
});

test("the old Settings address lands on the planner", async ({ page }) => {
  await page.goto("/app/settings");
  await page.waitForURL("**/app/plan");
});
