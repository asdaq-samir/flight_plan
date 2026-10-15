import { test, expect, type Page } from "@playwright/test";
import { grabberTo, settle, settled, sideDrawer } from "./helpers";

/**
 * The tabs' own pages laid out as one (TabPage), at the owner's ask
 * ("consistent look and feel for all tabs fpl, airport, aircraft and
 * setup"): each had a shell of its own, and they told apart on a switch --
 * Aircraft's strip three points under Airport's, the Recents headed in a
 * list's small capitals under the Favorites' title, sections 32, 20 and 16
 * points apart on Airport, Aircraft and Setup. Measured on every tab's page
 * half way and all the way up: the sections' sides, their headings, the
 * room between them, and where the first one starts under the tab bar.
 */

test.beforeEach(async ({ page }) => {
  // Recents on both search tabs, so each page has more than one section.
  await page.addInitScript(() => {
    const key = "vfr.preferences";
    const kept = JSON.parse(localStorage.getItem(key) ?? '{"state":{},"version":1}');
    kept.state.recentAirports = [{ ident: "KDLH", name: "Duluth International" }, { ident: "C81", name: "Campbell" }];
    kept.state.recentAircraft = [{ hex: "a0b1c2", name: "N123AB", type: "C172" }];
    localStorage.setItem(key, JSON.stringify(kept));
  });
});

interface Section { heading: string | null; font: string | null; top: number; bottom: number; left: number; right: number }

/** The tab page in sight and its sections, the outermost in it, in
 *  points from the panel's edges; and where the tab bar ends. */
async function layout(page: Page) {
  const panel = sideDrawer(page);
  await settled(panel);
  return panel.evaluate(el => {
    const box = el.getBoundingClientRect();
    const shown = (e: Element) => e.getBoundingClientRect().height > 0;
    const tabPage = [...el.querySelectorAll("[data-panel-body] [data-tab-page]")].find(shown);
    const bar = el.querySelector('[data-testid="tab-bar"]')!.getBoundingClientRect();
    if (!tabPage) return null;
    const sections = [...tabPage.querySelectorAll("section")].filter(s => {
      for (let up = s.parentElement; up && up !== tabPage; up = up.parentElement) if (up.tagName === "SECTION") return false;
      return shown(s);
    }).map((s): Section => {
      const b = s.getBoundingClientRect();
      // A labelled section's heading: its title, or the menu that is its
      // title (PillSection). A list's own small heading counts too.
      const heading = s.querySelector(":scope > div:first-child :is(h3, button)");
      const css = heading && getComputedStyle(heading);
      return {
        heading: heading?.textContent?.trim() || null,
        font: css && `${css.fontSize} ${css.fontWeight} ${css.textTransform}`,
        top: b.top - bar.bottom, bottom: b.bottom - bar.bottom, left: b.left - box.left, right: box.right - b.right,
      };
    });
    return { sections };
  });
}

test("every tab's page is laid out as one: its sections' sides, headings and the room between them, and where the first starts", async ({ page }) => {
  await page.goto("/app/plan");
  await settle(page);
  const pages: Record<string, Section[]> = {};
  for (const [name, tab] of [["FPL", "tab-fpl"], ["Airport", "tab-airport"], ["Aircraft", "tab-aircraft"], ["Setup", "setup-button"]] as const) {
    for (const size of ["half", "full"] as const) {
      // FPL with no route shows its Saved strip half way only.
      if (name === "FPL" && size === "full") continue;
      await page.getByTestId(tab).click();
      await grabberTo(page, size);
      const seen = await layout(page);
      expect(seen, `${name} ${size}: a tab page`).not.toBeNull();
      pages[`${name} ${size}`] = seen!.sections;
    }
  }
  const all = Object.entries(pages);
  for (const [where, sections] of all) {
    expect(sections.length, `${where}: its sections`).toBeGreaterThan(0);
    for (const s of sections) {
      expect(Math.round(s.left), `${where} ${s.heading}: left`).toBe(16);
      expect(Math.round(s.right), `${where} ${s.heading}: right`).toBe(16);
    }
  }
  // One heading, the Favorites' (PillSection), on every tab.
  const fonts = new Set(all.flatMap(([, sections]) => sections.filter(s => s.font).map(s => s.font)));
  expect([...fonts]).toHaveLength(1);
  // One room between sections, on every tab.
  const gaps = all.flatMap(([where, sections]) => sections.slice(1).map((s, i) => ({ where, gap: s.top - sections[i]!.bottom })));
  expect(gaps.length).toBeGreaterThan(2);
  for (const { where, gap } of gaps) expect(Math.abs(gap - gaps[0]!.gap), `${where}: ${gap} apart`).toBeLessThan(1.5);
  // Airport's and Aircraft's first section, under the same search bar,
  // as far under the tab bar.
  for (const size of ["half", "full"]) {
    expect(Math.abs(pages[`Airport ${size}`]![0]!.top - pages[`Aircraft ${size}`]![0]!.top), size).toBeLessThan(1.5);
  }
});
