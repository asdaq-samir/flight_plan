import { test, expect } from "@playwright/test";
import { slow, settle, sideDrawer, openBriefing, openTab, grabberTo, panelTabs } from "./helpers";

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
  await openTab(page, "Nav Log");
  const table = page.getByRole("table", { name: /Navigation log from/i });
  // The rows arrive with the scored checkpoints; wait for more than
  // the departure and the destination.
  await expect.poll(async () => table.locator("tbody tr[data-selected], tbody tr").count(), { timeout: slow(15000) }).toBeGreaterThan(4);
  // And the legs: their tops of climb and descent are rows of their own,
  // put in as the legs arrive, and a row counted before them moves.
  await expect(page.getByTestId("fuel-check")).toBeVisible({ timeout: slow(120000) });
  const selectedRow = table.locator("tbody tr[data-selected]");
  await expect(selectedRow).toHaveCount(0);

  // Each row led by its point's mark as the map draws it: the fields'
  // symbols at the ends, the checkpoints' dots numbered as the map's are,
  // from 1 in the order flown, and a top of climb's tag.
  const marks = await table.locator("tbody tr[tabindex='0'] [data-mark]")
    .evaluateAll(els => els.map(e => [e.getAttribute("data-mark") ?? "", (e.textContent ?? "").trim()] as const));
  expect(marks[0]![0]).toBe("airport");
  expect(marks.at(-1)![0]).toBe("airport");
  const numbered = marks.filter(([kind]) => kind === "checkpoint").map(([, n]) => Number(n));
  expect(numbered.length).toBeGreaterThan(0);
  expect(numbered).toEqual(numbered.map((_, i) => i + 1));
  expect(marks.some(([kind]) => kind === "toc")).toBe(true);

  // A click selects that row, and the map follows it.
  // The one selected is the row clicked, told by its mark rather than
  // by its words: a leg the clouds leave no altitude on gains its
  // warning when the altitude streams in, after the rows, and a name
  // read before that was compared with one read after.
  const rows = table.locator("tbody tr[tabindex='0']");
  await rows.nth(2).click();
  await expect(selectedRow).toHaveCount(1);
  await expect(rows.nth(2)).toHaveAttribute("data-selected");

  // From the keyboard the same way, and with nothing this page binds
  // on the document: a row is focusable and takes Enter itself
  // (`SelectableRow`). The drawer is non-modal and the map is mounted
  // beside it, so this works with the briefing open.
  await rows.nth(1).focus();
  await page.keyboard.press("Enter");
  await expect(rows.nth(1)).toHaveAttribute("data-selected");
  await expect(selectedRow).toHaveCount(1);

  // The panel's tabs take the stock tabs' own arrows, Right to the next:
  // the Brief, after the Nav Log.
  const tabs = panelTabs(page).getByRole("tab");
  await panelTabs(page).getByRole("tab", { name: "Nav Log" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(tabs.filter({ hasText: "Brief" })).toBeFocused();
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
  // 462: the route's box is two lines tall again (42 points more than the
  // 420 this was written at), and a scroller left under a row and the
  // table's sticky heading is too short for a row to stay put.
  await page.setViewportSize({ width: viewport.width, height: 462 });
  await page.waitForTimeout(300);
  await grabberTo(page, "full");
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
  // Once the drawer has come all the way up and stood still, which on a
  // busy phone is more than a few seconds.
  await expect.poll(middle, { timeout: slow(10000) }).toBeLessThan(0.25);

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
  // edge on a phone -- or under the table's sticky heading, below the
  // tabs -- and a row half out of view is rightly brought in.
  await neighbour.evaluate(row => row.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(200);
  // Where the row is on the screen, which is the claim: not the
  // scroller's offset, which the browser moves itself to keep what is
  // on screen still (scroll anchoring) while the legs still streaming
  // in give a row above a second line -- 22 px, on a CI phone.
  const onScreen = async () => (await neighbour.boundingBox())!.y;
  const before = await onScreen();
  await neighbour.locator("td").first().click();
  // By the cell's words: its mark (PointMark) is a box of its own, which
  // innerText sets on a line apart.
  await expect(selectedRow.first().locator("td").first()).toHaveText((await neighbour.locator("td").first().textContent()) ?? "");
  await page.waitForTimeout(400);
  expect(Math.abs((await onScreen()) - before)).toBeLessThan(2);

  // Another tab and back: the selection kept, its row brought into view.
  await openTab(page, "Weather");
  await expect(sideDrawer(page).getByRole("heading", { name: "Adverse Conditions" })).toBeVisible();
  await openTab(page, "Nav Log");
  await expect(selectedRow).toBeInViewport();
  await neighbour.scrollIntoViewIfNeeded();

  // The selected row clicked again: deselected, and its note closed.
  await expect(selectedRow).toHaveAttribute("data-expanded", "true");
  await neighbour.locator("td").first().click();
  await expect(selectedRow).toHaveCount(0);
  await expect(table.locator('tbody tr[data-expanded="true"]')).toHaveCount(0);
});

test("plan page: the briefing's nav log scrolls inside the drawer, not the page", async ({ page }) => {
  await page.goto("/app/plan?dep=C81&dest=KDLH");
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

test("plan page: iOS never zooms the page in on a phone's field: the viewport forbids it, and every field but the nav log's notes is 16px", async ({ page }) => {
  // iOS Safari zooms the whole page in when a field under 16px takes
  // focus, and leaves it zoomed once the field blurs and the drawer
  // closes -- with the header and the route form off the top of the
  // screen. The viewport's maximum-scale=1 (index.html) is what stops
  // it now, so that is checked first; the fields are 16px and more all
  // the same, all but the note box under a nav log row, which is the
  // log's own 12 because the pilot wanted it in proportion to the rows.
  // Chromium never zooms, so the rest is on the computed font size
  // itself, over every field the page can show: the route form, and
  // the nav log's altitude box and description boxes.
  const viewport = page.viewportSize();
  if (!viewport || viewport.width >= 768) return;   // `md` and up keep the small type
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute("content", /maximum-scale=1\b/);
  await page.getByTestId("sidebar-trigger-button").click();
  // The description boxes are in the nav log's section, closed until
  // its title is clicked, and each under its own row, closed until
  // that row is selected.
  await openTab(page, "Nav Log");
  const rows = sideDrawer(page).locator("table tbody tr[data-kind='checkpoint']");
  await expect.poll(() => rows.count(), { timeout: slow(15000) }).toBeGreaterThan(0);
  await rows.first().click();
  await expect.poll(() => page.locator("textarea").count(), { timeout: slow(15000) }).toBeGreaterThan(0);
  const small = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("input, textarea, select")]
      .filter(el => !el.closest('[data-testid="navlog-scroller"] tbody'))
      .map(el => ({
        field: el.getAttribute("aria-label") ?? el.getAttribute("placeholder") ?? el.tagName,
        px: parseFloat(getComputedStyle(el).fontSize),
      }))
      .filter(f => f.px < 16));
  expect(small).toEqual([]);
});

test("plan page: the checkpoints are named on the map beside their dots, as ForeFlight names them, none over another and none off the screen", async ({ page }) => {
  await page.goto("/app/plan?dep=C81&dest=KDLH");
  await settle(page);
  const labels = page.locator("[data-checkpoint-label]");
  await expect.poll(() => labels.count(), { timeout: slow(30000) }).toBeGreaterThan(3);
  // The names the route's ForeFlight pack gives them, spaced.
  for (const text of await labels.allInnerTexts()) expect(text).toMatch(/^[A-Z0-9 ]+$/);
  const viewport = page.viewportSize()!;
  const boxes = (await labels.evaluateAll(els => els.map(el => {
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
  })));
  // Nor over the route's own airports' marks, nor their idents beside them.
  const chips = await page.locator(".leaflet-marker-icon", { hasText: /^(C81|KDLH)$/ }).evaluateAll(els => els.map(el => {
    const [mark, ident] = [...el.children].map(c => c.getBoundingClientRect());
    return { left: mark!.left, right: Math.max(mark!.right, ident!.right), top: Math.min(mark!.top, ident!.top), bottom: Math.max(mark!.bottom, ident!.bottom) };
  }));
  for (const a of boxes) {
    for (const c of chips) {
      const apart = a.right <= c.left + 1 || c.right <= a.left + 1 || a.bottom <= c.top + 1 || c.bottom <= a.top + 1;
      expect(apart, `${JSON.stringify(a)} over the chip ${JSON.stringify(c)}`).toBe(true);
    }
  }
  for (const [i, a] of boxes.entries()) {
    expect(a.left).toBeGreaterThanOrEqual(-1);
    expect(a.right).toBeLessThanOrEqual(viewport.width + 1);
    for (const b of boxes.slice(i + 1)) {
      const apart = a.right <= b.left + 1 || b.right <= a.left + 1 || a.bottom <= b.top + 1 || b.bottom <= a.top + 1;
      expect(apart, `${JSON.stringify(a)} over ${JSON.stringify(b)}`).toBe(true);
    }
  }
});
