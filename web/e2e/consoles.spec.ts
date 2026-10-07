import { test, expect } from "@playwright/test";
import { settle, settled, consoleSheet, expectDrawerClosed, expectDrawerOpen, closeSidebarWithTheStockKey, openSettings, library, closeConsole } from "./helpers";

/**
 * The consoles and the settings: fitting the screen, the pilot
 * console's account and airplanes, the header's edge, the console
 * holding still as its tabs change, and the theme.
 */

test("signed in, each console fits the screen's width: nothing but a table's own scroller runs past its edge", async ({ page }) => {
  // The address is the settings' first row, and wraps there (once
  // "Signed in as <address>" and Log out shared the tab row with the
  // developer's buttons, and on a phone ran off the right edge). Wide
  // tables scroll inside their own container, which is the one thing
  // allowed past the edge.
  for (const [path, button] of [["/app/plan", "settings-button"], ["/app/dev", "settings-button"]] as const) {
    await page.goto(path);
    await page.getByTestId(button).click();
    await expect(consoleSheet(page).getByTestId("pilot-address")).toHaveText("developer@example.com");
    const past = await consoleSheet(page).evaluate(sheet => {
      const edge = document.documentElement.clientWidth + 1;
      return [...sheet.querySelectorAll("*")]
        .filter(el => !el.closest('[data-slot="table-container"]'))
        .filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.right > edge; })
        .map(el => (el.textContent ?? "").trim().slice(0, 40));
    });
    expect(past, `${path}: past the right edge`).toEqual([]);
  }
});

test("plan page: the pilot console holds the account, airplanes and flights, and the drawer opens once it is closed", { tag: "@smoke" }, async ({ page }) => {
  await page.goto("/app/plan");
  await settle(page);
  // Opened as Maps opens: the search half way up (lib/freshLoad).
  await expect(page.locator('[data-slot="map-panel"]')).toHaveAttribute("data-panel", "half");
  expect(await consoleSheet(page).count()).toBe(0);

  await page.getByTestId("settings-button").click();
  const pilot = consoleSheet(page);
  await expect(pilot).toBeVisible();
  await expect(page.getByTestId("settings-button")).toHaveAttribute("aria-expanded", "true");
  // The title is the role, a menu: Pilot (chosen here), Developer for a
  // developer, and Sign out last; who is signed in beside it.
  await expect(page.getByRole("dialog", { name: "Pilot" })).toBeVisible();
  await expect(pilot.getByTestId("role-menu")).toHaveText("Pilot");
  await expect(pilot.getByTestId("pilot-address")).toHaveText("developer@example.com");
  await pilot.getByTestId("role-menu").click();
  await expect(page.getByRole("menuitemradio", { name: "Pilot" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("menuitemradio", { name: "Developer" })).toHaveAttribute("aria-checked", "false");
  await expect(page.getByRole("menuitem", { name: "Sign out" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menuitem", { name: "Sign out" })).toHaveCount(0);
  // The guide first, where someone new to the planner starts.
  await expect(pilot.getByRole("tab").first()).toHaveText("Guide");
  // The pilot's own things in one tab, Personal (it was Library), a
  // segment each.
  await library(pilot, "Aircraft");
  await expect(pilot.getByRole("region", { name: "Aircraft", exact: true })).toBeVisible();
  await library(pilot, "Flights");
  await expect(pilot.getByRole("region", { name: "Flights", exact: true })).toBeVisible();
  await expect(pilot.getByRole("tab")).toHaveText(["Guide", "Personal", "Settings"]);
  // The personal minimums are Personal's, with no sign-in needed.
  await library(pilot, "Minimums");
  await expect(pilot.getByTestId("minimum-ceilingFt")).toBeVisible();

  // The console is modal: Escape puts it away, and then Escape lowers
  // the panel too, and its grabber opens it again.
  await page.keyboard.press("Escape");
  await expect(pilot).toHaveCount(0);
  await closeSidebarWithTheStockKey(page);
  await expectDrawerClosed(page);
  await page.getByTestId("sidebar-trigger-button").click();
  await expectDrawerOpen(page);
});

test("the navigation bar's edge is a setting: the panel moves to it, the map's buttons take the other, the console comes from it, and it is remembered", async ({ page }) => {
  // By default the bottom on a phone and the top from md up; the other
  // edge picked in the settings moves the panel there, the map's
  // buttons to the edge away from it, and the console in from it.
  await page.goto("/app/plan");
  await settle(page);
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("no viewport configured");
  const phone = viewport.width < 768;
  await openSettings(page);
  await page.getByTestId("nav-bar-select").getByRole("radio", { name: phone ? "Top" : "Bottom" }).click();
  await closeConsole(page);
  await expect(page.locator("[data-slot=drawer-content], [data-slot=popover-content], [data-testid=console-sheet]")).toHaveCount(0);
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  // Once the panel has come to rest: it measures its head and eases to
  // its height after a load, and the reload below is compared with this.
  await settled(page.locator('[data-slot="map-panel"]'));

  const header = (await page.locator("header").boundingBox())!;
  const buttons = (await page.locator("[data-map-controls] > *").first().boundingBox())!;
  if (phone) {
    expect(header.y).toBeLessThan(40);
    expect(buttons.y).toBeGreaterThan(viewport.height / 2);
  } else {
    expect(header.y).toBeGreaterThan(viewport.height / 2);
    expect(buttons.y).toBeLessThan(viewport.height / 2);
  }

  // The console, from the search bar, comes in from the same edge: on a
  // phone half way down from the top, in from the screen's edges.
  await page.goto("/app/plan");
  await settle(page);
  await page.getByTestId("settings-button").click();
  const pilot = consoleSheet(page);
  await expect(pilot.getByRole("tab", { name: "Guide" })).toBeVisible();
  await pilot.evaluate(el => Promise.all(el.getAnimations({ subtree: true }).map(a => a.finished)));
  const box = (await pilot.boundingBox())!;
  if (phone) expect(Math.round(box.y)).toBe(8);
  else expect(Math.round(box.y + box.height)).toBe(viewport.height);
  await page.keyboard.press("Escape");
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  await expect(pilot).toHaveCount(0);

  // Remembered per browser: the route opened again (a reload would
  // forget it, lib/freshLoad).
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  // To the pixel, once the panel has settled: it measures its head and
  // eases to its height after a load.
  await expect.poll(async () => Math.abs((await page.locator("header").boundingBox())!.y - header.y)).toBeLessThan(1);
});

test("the console holds still as its tabs change: up from the bottom of a phone's screen, down from the top of a desktop's", async ({ page }) => {
  // On a phone the console is a sheet from the bottom edge, where the
  // header is. Sized to the tab showing, its top edge rose and fell as
  // the tabs changed, and the tab row moved out from under the finger
  // that had just tapped it; its height is now fixed, half the screen
  // showing until it is dragged up. From `md` up it is the Sheet from
  // the top, whose tab row stays put however tall it is.
  await page.goto("/app/plan");
  await settle(page);
  await page.getByTestId("settings-button").click();
  const pilot = consoleSheet(page);
  await expect(pilot.getByRole("tab", { name: "Guide" })).toBeVisible();
  await pilot.evaluate(el => Promise.all(el.getAnimations({ subtree: true }).map(a => a.finished)));
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("no viewport configured");
  const box = (await pilot.boundingBox())!;
  if (viewport.width < 768) {
    // iOS's medium detent, as the map's panel is at half: in from the
    // screen's sides and its foot by eight, half of what it has to rise in.
    expect(Math.round(box.x)).toBe(8);
    expect(Math.round(box.width)).toBe(viewport.width - 16);
    expect(Math.abs(box.y + box.height - (viewport.height - 8))).toBeLessThan(1);
    expect(Math.abs(box.height - (viewport.height - 8) / 2)).toBeLessThan(1);
  } else {
    expect(box.y).toBe(0);
  }
  const tabRow = pilot.getByRole("tablist");
  const rowTop = (await tabRow.boundingBox())!.y;
  for (const name of ["Personal", "Settings", "Guide"]) {
    await pilot.getByRole("tab", { name }).click();
    await expect(pilot.getByRole("tab", { name })).toHaveAttribute("aria-selected", "true");
    expect((await tabRow.boundingBox())!.y, `the tab row after ${name}`).toBe(rowTop);
  }
});

test("the settings' theme is system, light or dark, all three on show, and the choice survives a reload", async ({ page }) => {
  await page.goto("/app/plan");
  await settle(page);
  await openSettings(page);
  const html = page.locator("html");
  const theme = page.getByTestId("theme-select");
  await expect(theme.getByRole("radio", { name: "System" })).toHaveAttribute("aria-checked", "true");
  await expect(html).not.toHaveClass(/dark/);   // "system", and the test browser prefers light
  await theme.getByRole("radio", { name: "Dark" }).click();
  await expect(html).toHaveClass(/dark/);
  // The one already chosen, tapped again, stays chosen: a segmented
  // control, not a set of toggles that can all be off.
  await theme.getByRole("radio", { name: "Dark" }).click();
  await expect(theme.getByRole("radio", { name: "Dark" })).toHaveAttribute("aria-checked", "true");
  await page.reload();
  await page.waitForTimeout(300);
  await expect(html).toHaveClass(/dark/);
  await openSettings(page);
  await page.getByTestId("theme-select").getByRole("radio", { name: "Light" }).click();
  await expect(html).not.toHaveClass(/dark/);
});
