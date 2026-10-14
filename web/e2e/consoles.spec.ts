import { test, expect } from "@playwright/test";
import { closeConsole, closeSidebarWithTheStockKey, consoleSheet, expectDrawerClosed, grabberTo, library, openConsole, openAccount, openSettings, openSidebar, settle, settled, showTabs, consolePage } from "./helpers";

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
    void button;
    await openConsole(page);
    await openAccount(page);
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
  // Opened as the tabs alone, at the owner's ask (MapPanel).
  await expect(page.locator('[data-slot="map-panel"]')).toHaveAttribute("data-panel", "peek");
  expect(await consoleSheet(page).count()).toBe(0);

  await showTabs(page);
  await openConsole(page);
  const pilot = consoleSheet(page);
  await expect(pilot).toBeVisible();
  // Settings is a tab of the bar, the tab up while the console is out:
  // on a phone the console is the panel's layer, under the tab bar, in
  // the search bar's place; elsewhere a sheet.
  const phone = page.viewportSize()!.width < 768;
  await showTabs(page);
  await expect(page.getByTestId("settings-button")).toHaveAttribute("aria-current", "page");
  if (phone) expect(await pilot.evaluate(el => !!el.closest('[data-slot="map-panel"]'))).toBe(true);
  // The role, a menu, in Personal's Account row, at the owner's ask: Pilot
  // (chosen here), Developer for a developer, and Sign out last; who is
  // signed in beside it.
  await expect(page.getByRole("dialog", { name: "Pilot" })).toBeVisible();
  await openAccount(page);
  await expect(pilot.getByTestId("role-menu")).toHaveText("Pilot");
  await expect(pilot.getByTestId("pilot-address")).toHaveText("developer@example.com");
  await pilot.getByTestId("role-menu").click();
  await expect(page.getByRole("menuitemradio", { name: "Pilot" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("menuitemradio", { name: "Developer" })).toHaveAttribute("aria-checked", "false");
  await expect(page.getByRole("menuitem", { name: "Sign out" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menuitem", { name: "Sign out" })).toHaveCount(0);
  // One page, no tabs over it: the account first, then the rest as rows
  // (Setup, the owner's pick of the redesign).
  await expect(pilot.getByTestId("setup-page")).toBeVisible();
  await expect(pilot.getByRole("tab")).toHaveCount(0);
  // The pilot's own things in one tab, Personal (it was Library), a
  // segment each.
  await library(pilot, "Aircraft");
  await expect(pilot.getByRole("region", { name: "Aircraft", exact: true })).toBeVisible();
  await library(pilot, "Flights");
  await expect(pilot.getByRole("region", { name: "Flights", exact: true })).toBeVisible();
  // Settings, Guide and About as rows of their own.
  await consolePage(pilot, "Account");
  for (const row of ["Settings", "Guide", "About"]) await expect(pilot.getByTestId("setup-page").getByRole("button", { name: new RegExp(`^${row}`) })).toBeVisible();
  // The personal minimums are Personal's, with no sign-in needed.
  await library(pilot, "Minimums");
  await expect(pilot.getByTestId("minimum-ceilingFt")).toBeVisible();

  // Escape puts it away -- the search under it at the height it was, on
  // a phone -- and then Escape lowers the panel too, and its grabber opens
  // it again.
  await page.keyboard.press("Escape");
  await expect(pilot).toHaveCount(0);
  await closeSidebarWithTheStockKey(page);
  await expectDrawerClosed(page);
  await openSidebar(page);
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

  // The panel at rest is the tabs' pill (no head of its own): where the
  // panel is, its box.
  const header = (await page.locator('[data-slot="map-panel"]').boundingBox())!;
  const buttons = (await page.locator("[data-map-controls] > *").first().boundingBox())!;
  if (phone) {
    expect(header.y).toBeLessThan(40);
    expect(buttons.y).toBeGreaterThan(viewport.height / 2);
  } else {
    expect(header.y + header.height).toBeGreaterThan(viewport.height / 2);
    expect(buttons.y).toBeLessThan(viewport.height / 2);
  }

  // The console, its tab, comes in from the same edge: on a phone the
  // panel's layer, the panel half way down from the top, in from the
  // screen's edges.
  await page.goto("/app/plan");
  await settle(page);
  await showTabs(page);
  await openConsole(page);
  const pilot = consoleSheet(page);
  await expect(pilot.getByTestId("setup-page").or(pilot.getByRole("tab", { name: "Guide" })).first()).toBeVisible();
  await pilot.evaluate(el => Promise.all(el.getAnimations({ subtree: true }).map(a => a.finished)));
  const box = (await (phone ? page.locator('[data-slot="map-panel"]') : pilot).boundingBox())!;
  // All the way up: the sheet to the screen's edge (MapPanel's "edge").
  if (phone) expect(Math.round(box.y)).toBeLessThanOrEqual(8);
  // Beside a desktop's map, Setup is the panel's (MapPage's inPanel), its
  // foot the panel's, eight in from the screen's.
  else expect(viewport.height - Math.round(box.y + box.height)).toBeLessThanOrEqual(12);
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
  await expect.poll(async () => Math.abs((await page.locator('[data-slot="map-panel"]').boundingBox())!.y - header.y)).toBeLessThan(1);
});

test("the console is the panel's own: up from the bottom of a phone's screen, in the panel beside a desktop's map", async ({ page }) => {
  // The planner's Setup is a layer of the map's panel on every screen
  // (MapPage's inPanel), at the owner's ask: a phone's from the bottom
  // edge, the panel's height; from `md` up in the panel's column.
  await page.goto("/app/plan");
  await settle(page);
  const panel = page.locator('[data-slot="map-panel"]');
  // Opened as the tabs alone: half way up first, the height compared.
  await grabberTo(page, "full");
  // Measured once it has come to rest, not on its way up from the tabs.
  await settled(panel);
  const half = (await panel.boundingBox())!;
  await openConsole(page);
  const pilot = consoleSheet(page);
  await expect(pilot.getByTestId("setup-page").or(pilot.getByRole("tab", { name: "Guide" })).first()).toBeVisible();
  await pilot.evaluate(el => Promise.all(el.getAnimations({ subtree: true }).map(a => a.finished)));
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("no viewport configured");
  const box = (await pilot.boundingBox())!;
  if (viewport.width < 768) {
    // A layer of the map's panel, at the half every panel has, as the
    // search was: in from the screen's sides and its foot by eight.
    await expect(panel).toHaveAttribute("data-panel", "full");
    await settled(panel);
    const now = (await panel.boundingBox())!;
    expect(Math.abs(now.y - half.y)).toBeLessThan(1);
    expect(Math.abs(now.height - half.height)).toBeLessThan(1);
    // All the way up, the sheet to the screen's sides.
    expect(Math.round(box.x)).toBe(0);
    expect(Math.abs(box.width - viewport.width)).toBeLessThanOrEqual(1);
    // To the sheet's foot, less the room it keeps under its body for the home
    // indicator all the way up.
    expect(Math.abs(box.y + box.height - (now.y + now.height))).toBeLessThan(40);
  } else {
    // Inside the panel, as the other tabs are, not a sheet of its own.
    const now = (await panel.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(now.y - 1);
    expect(box.y + box.height).toBeLessThanOrEqual(now.y + now.height + 1);
  }
  // Setup is one page now, no tabs of its own to change (PilotPanel).
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
