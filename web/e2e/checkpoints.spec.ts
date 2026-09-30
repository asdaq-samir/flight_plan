import { test, expect } from "@playwright/test";
import { slow, settle, sideDrawer, openBriefing } from "./helpers";

/**
 * The nav log's checkpoints: selected by a click, by Enter or by a pick
 * on the map, brought into view without moving the one tapped, the
 * log scrolling inside the drawer, and the fields a phone types in.
 */

test("plan page: a click or Enter selects a nav log checkpoint, with the briefing drawer open over the map", async ({ page }) => {
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  await page.getByTestId("sidebar-trigger-button").click();
  // The sections start closed: open the nav log's to walk its rows.
  await sideDrawer(page).getByText("Nav Log", { exact: true }).click();
  const table = page.getByRole("table", { name: /Navigation log from/i });
  // The rows arrive with the scored checkpoints; wait for more than
  // the departure and the destination.
  await expect.poll(async () => table.locator("tbody tr[data-selected], tbody tr").count(), { timeout: slow(15000) }).toBeGreaterThan(4);
  const selectedRow = table.locator("tbody tr[data-selected]");
  await expect(selectedRow).toHaveCount(0);

  // A click selects that row, and the map follows it.
  const rows = table.locator("tbody tr[tabindex='0']");
  await rows.nth(2).click();
  await expect(selectedRow).toHaveCount(1);
  await expect(selectedRow.first().locator("td").first()).toHaveText(await rows.nth(2).locator("td").first().innerText());

  // From the keyboard the same way, and with nothing this page binds
  // on the document: a row is focusable and takes Enter itself
  // (`SelectableRow`). The drawer is non-modal and the map is mounted
  // beside it, so this works with the briefing open.
  await rows.nth(1).focus();
  await page.keyboard.press("Enter");
  await expect(selectedRow.first().locator("td").first()).toHaveText(await rows.nth(1).locator("td").first().innerText());

  // The section titles get the stock accordion's own Up and Down back:
  // the trigger used to swallow them for the walk that is now gone.
  const titles = sideDrawer(page).locator('[data-slot="accordion-trigger"]');
  await titles.first().focus();
  await page.keyboard.press("ArrowDown");
  await expect(titles.nth(1)).toBeFocused();
});

test("plan page: a checkpoint picked on the map is brought to the middle of the nav log, and a row clicked in view stays put", { tag: "@smoke" }, async ({ page }) => {
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  const marker = page.locator(".leaflet-marker-icon", { hasText: /^1[01]$/ }).first();
  await expect(marker).toBeVisible({ timeout: slow(15000) });
  // A DOM click, not a pointer one: the legs are still streaming in
  // and each re-draws the markers, so Playwright's wait for the marker
  // to hold still ran the test out of time.
  await marker.dispatchEvent("click");

  // Then a short window, so the nav log has to scroll: the row used to
  // come to rest at the bottom edge (scrollIntoView "nearest"), the
  // last visible line when the drawer was opened after the pick. (The
  // pick first, at full height: at 420px a phone's map is too short
  // for a marker along the route to be clicked.)
  const viewport = page.viewportSize()!;
  await page.setViewportSize({ width: viewport.width, height: 420 });
  await page.waitForTimeout(300);
  await page.getByTestId("sidebar-trigger-button").click();
  // The drawer opens the nav log's own section itself, for the pick:
  // no title to find and press first.
  const table = page.getByRole("table", { name: /Navigation log from/i });
  await expect(table).toBeVisible();
  const selectedRow = table.locator("tbody tr[data-selected]");
  await expect(selectedRow).toHaveCount(1);
  const scroller = sideDrawer(page).getByTestId("navlog-scroller");
  const middle = async () => {
    const row = (await selectedRow.boundingBox())!;
    const view = (await scroller.boundingBox())!;
    return Math.abs((row.y + row.height / 2) - (view.y + view.height / 2)) / view.height;
  };
  // Within a quarter of the scroller's height of its middle.
  await expect.poll(middle, { timeout: slow(5000) }).toBeLessThan(0.25);

  // The row above it, in view beside it, clicked: selected, and
  // nothing moves. Clicked on its first cell, where a finger would: on
  // a desktop the table scrolls sideways inside the drawer, and the
  // middle of the row, where a bare click lands, is past the drawer's
  // edge -- over the map, so Playwright scrolled the drawer to reach it.
  const rows = table.locator("tbody tr[tabindex='0']");
  const index = await selectedRow.evaluate(row => Array.from(row.parentElement!.querySelectorAll("tr[tabindex='0']")).indexOf(row));
  const neighbour = rows.nth(index - 1);
  // In view whole first, as the claim is about: centred to within a
  // quarter of the middle, the row above can sit half under the top
  // edge on a phone, and a row half out of view is rightly brought in.
  await neighbour.scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  // Where the row is on the screen, which is the claim: not the
  // scroller's offset, which the browser moves itself to keep what is
  // on screen still (scroll anchoring) while the legs still streaming
  // in give a row above a second line -- 22 px, on a CI phone.
  const onScreen = async () => (await neighbour.boundingBox())!.y;
  const before = await onScreen();
  await neighbour.locator("td").first().click();
  await expect(selectedRow.first().locator("td").first()).toHaveText(await neighbour.locator("td").first().innerText());
  await page.waitForTimeout(400);
  expect(Math.abs((await onScreen()) - before)).toBeLessThan(2);

  // Another section opened, with the drawer scrolled elsewhere: the
  // drawer stays where it is. (Every section's opening used to reveal
  // the selected row again, scrolling back up to it.)
  // To the end, and then just enough back that the section's title is
  // on screen: at the very end it can sit above the visible band (the
  // planning-aid line is the drawer's last), and Playwright would scroll
  // it into view to click it -- a move of the test's, not the drawer's.
  const cruise = sideDrawer(page).getByRole("button", { name: "Cruise Altitude" });
  await scroller.evaluate(el => el.scrollTo(0, el.scrollHeight));
  await cruise.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  // The section's title, where it is on the screen (as the row above).
  const elsewhere = (await cruise.boundingBox())!.y;
  await cruise.click();
  await page.waitForTimeout(600);
  expect(Math.abs((await cruise.boundingBox())!.y - elsewhere)).toBeLessThan(2);
  await sideDrawer(page).getByRole("button", { name: "Cruise Altitude" }).click();
  await neighbour.scrollIntoViewIfNeeded();

  // The selected row clicked again: deselected, and its note closed.
  await expect(selectedRow).toHaveAttribute("aria-expanded", "true");
  await neighbour.locator("td").first().click();
  await expect(selectedRow).toHaveCount(0);
  await expect(table.locator('tbody tr[aria-expanded="true"]')).toHaveCount(0);
});

test("plan page: the briefing's nav log scrolls inside the drawer, not the page", async ({ page }) => {
  await page.goto("/app/plan");
  await settle(page);

  await openBriefing(page);
  await page.waitForTimeout(500);

  const pageOverflowing = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(pageOverflowing).toBe(false);

  const scroller = page.getByTestId("navlog-scroller");
  const info = await scroller.evaluate(el => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
  // A route's worth of columns (12, `whitespace-nowrap`) at a phone
  // width is wider than the viewport -- the scroller itself should be
  // the thing that overflows and scrolls, which is only meaningful to
  // assert once it actually has content (the "reading"/generating
  // placeholder is a single centered line, not the wide table).
  const hasTable = await scroller.locator("table").count();
  if (hasTable > 0) {
    expect(info.scrollWidth).toBeGreaterThanOrEqual(info.clientWidth);
  }
});

test("plan page: every text field is at least 16px on a phone, so iOS never zooms the page in on focus", async ({ page }) => {
  // iOS Safari zooms the whole page in when a field under 16px takes
  // focus, and leaves it zoomed once the field blurs and the drawer
  // closes -- with the header and the route form off the top of the
  // screen. Chromium never does this, so the check is on the computed
  // font size itself, over every field the page can show: the route
  // form, and the nav log's altitude box and description boxes.
  const viewport = page.viewportSize();
  if (!viewport || viewport.width >= 768) return;   // `md` and up keep the small type
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  await page.getByTestId("sidebar-trigger-button").click();
  // The description boxes are in the nav log's section, closed until
  // its title is clicked, and each under its own row, closed until
  // that row is selected.
  await sideDrawer(page).getByText("Nav Log", { exact: true }).click();
  const rows = sideDrawer(page).locator("table tbody tr[tabindex='0']");
  await expect.poll(() => rows.count(), { timeout: slow(15000) }).toBeGreaterThan(2);
  await rows.nth(1).click();
  await expect.poll(() => page.locator("textarea").count(), { timeout: slow(15000) }).toBeGreaterThan(0);
  const small = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("input, textarea, select")]
      .map(el => ({
        field: el.getAttribute("aria-label") ?? el.getAttribute("placeholder") ?? el.tagName,
        px: parseFloat(getComputedStyle(el).fontSize),
      }))
      .filter(f => f.px < 16));
  expect(small).toEqual([]);
});
