import type { Page } from "@playwright/test";

/**
 * The iOS audit's measurements. Each returns what breaks its rule, as
 * data, so a spec can both assert that nothing does and attach the list
 * for the audit's report. All in CSS px, which on an iPhone at
 * width=device-width are points.
 *
 * The rules, by the audit's numbering: P1 a 44-point hit region for
 * everything tappable; P2 text on iOS's type scale; P3 each size at its
 * iOS leading; P11 no sideways scroll, at 100% and at Safari's 150% page
 * zoom; P12 nothing pinned to the screen under the notch, the island or
 * the home indicator.
 */

/** What a finger can tap. */
export const TAPPABLE = [
  "a[href]", "button", "input:not([type=hidden])", "select", "textarea", "summary",
  "[role=button]", "[role=tab]", "[role=checkbox]", "[role=radio]", "[role=switch]",
  "[role=menuitem]", "[role=option]", "[role=slider]", "[tabindex='0']",
].join(", ");

/** P1's declared exceptions, the pilot's call (2026-09-30): the map's
 *  markers keep their own tap boxes (36 points for a numbered checkpoint,
 *  an airport's chip its own size, icons.ts), since 44-point areas would
 *  overlap along a route and take each other's taps; and a segmented
 *  control's segments keep iOS's own 32-point track. */
export const HIT_EXEMPT = [".leaflet-marker-icon", "[data-slot=tabs-trigger]"].join(", ");

/** P3's: a marker's number or ident, centred in its dot or chip as a
 *  glyph is (icons.ts), not a line of text. */
export const LEADING_EXEMPT = ".leaflet-marker-icon";

/** iOS's text styles at the default text size: size → leading. */
export const IOS_TYPE: Record<number, number> = {
  11: 13, 12: 16, 13: 18, 15: 20, 16: 21, 17: 22, 20: 25, 22: 28, 28: 34, 34: 41,
};

/** Every finite animation on the page run out -- a sheet's slide, a
 *  section opening: measured mid-slide, a control is not where it rests.
 *  A spinner's endless spin is left alone, and the wait is capped at
 *  three seconds: in WebKit an animation's promise could stay pending
 *  for good, and the wait with it. */
export async function still(page: Page) {
  await page.evaluate(() => Promise.race([
    Promise.all(document.getAnimations()
      .filter(a => a.effect?.getTiming().iterations !== Infinity)
      .map(a => a.finished.catch(() => undefined))),
    new Promise(done => setTimeout(done, 3000)),
  ]));
}

/** The planner's progress toasts gone ("Scoring checkpoints…"): over
 *  the top of a phone's screen they cover the controls under them for a
 *  moment, which is not the screen's layout. Up to twenty seconds; a toast
 *  that stays is measured as it is. */
export async function quiet(page: Page) {
  await page.locator("[data-sonner-toast]").first().waitFor({ state: "detached", timeout: 20000 }).catch(() => undefined);
}

export type HitMiss = { control: string; box: string; lost: number };

/** P1: every control whose 44 × 44 square, centred on it, is not wholly
 *  its own, by nine elementFromPoint probes. That sees a pseudo-element
 *  hit area as its element (index.css's ::after), and sees whatever
 *  covers or clips the square: a neighbour's area, an overflow:hidden
 *  ancestor, a sticky bar. Not judged: a control covered at its own
 *  centre (behind a drawer, under an overlay -- not on show), and one
 *  whose square crosses a scroll container's edge (scrolled into view it
 *  would be judged). */
export function hitAreaMisses(page: Page, scope = "body", size = 44): Promise<HitMiss[]> {
  return page.evaluate(({ scope, size, tappable, exempt }) => {
    const half = size / 2 - 1;
    const misses: { control: string; box: string; lost: number }[] = [];
    const root = document.querySelector(scope);
    if (!root) return misses;
    for (const el of root.querySelectorAll<HTMLElement>(tappable)) {
      // A tab list is focusable for its arrow keys; its tabs are what is tapped.
      if (el.getAttribute("role") === "tablist" || el.matches(exempt)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2 || getComputedStyle(el).visibility !== "visible") continue;
      const own = (hit: Element | null) =>
        !!hit && (hit === el || el.contains(hit) || (hit.closest("label") as HTMLLabelElement | null)?.control === el);
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      if (!own(document.elementFromPoint(cx, cy))) continue;
      let port = { l: 0, t: 0, r: innerWidth, b: innerHeight };
      for (let a = el.parentElement; a; a = a.parentElement) {
        const o = getComputedStyle(a);
        if (!/auto|scroll/.test(o.overflowX + o.overflowY)) continue;
        const b = a.getBoundingClientRect();
        port = { l: Math.max(port.l, b.left), t: Math.max(port.t, b.top), r: Math.min(port.r, b.right), b: Math.min(port.b, b.bottom) };
      }
      if (cx - half < port.l || cx + half > port.r || cy - half < port.t || cy + half > port.b) continue;
      const probes = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];
      const lost = probes.filter(([dx, dy]) => !own(document.elementFromPoint(cx + dx * half, cy + dy * half))).length;
      if (!lost) continue;
      const name = (el.getAttribute("aria-label") ?? el.getAttribute("title") ?? el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
      const id = el.dataset.testid ?? el.dataset.slot ?? [...el.classList].find(c => c.startsWith("leaflet-")) ?? "";
      misses.push({ control: `${el.tagName.toLowerCase()}${id ? `[${id}]` : ""} "${name}"`, box: `${Math.round(r.width)}×${Math.round(r.height)}`, lost });
    }
    return misses;
  }, { scope, size, tappable: TAPPABLE, exempt: HIT_EXEMPT });
}

export type TypeFinding = {
  size: number; leading: number | null; want: number | null; where: string; text: string; count: number;
};

/** P2 and P3: visible text off iOS's scale, and text at an iOS size off
 *  that size's leading by more than a pixel -- each kind grouped by size
 *  (and leading) and by where it is (the nearest test id, shadcn slot or
 *  Leaflet part), with an example and how many pieces of text. Not seen:
 *  text clipped to a pixel (a screen reader's alone), and text above or
 *  left of the page, where no scroll reaches, and text kept for a screen
 *  reader (sr-only, whose padding can leave it a box of its own). */
export function typeFindings(page: Page, scope = "body"): Promise<{ offScale: TypeFinding[]; offLeading: TypeFinding[] }> {
  return page.evaluate(({ scope, type, glyphs }) => {
    const offScale = new Map<string, TypeFinding>(), offLeading = new Map<string, TypeFinding>();
    const root = document.querySelector(scope);
    if (root) {
      const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        const text = (n.textContent ?? "").trim().replace(/\s+/g, " ");
        const el = n.parentElement;
        if (!text || !el) continue;
        const rect = el.getBoundingClientRect();
        if (rect.width <= 1 || rect.height <= 1 || rect.right <= 0 || rect.bottom <= 0 || el.closest(".sr-only")) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility !== "visible" || cs.opacity === "0") continue;
        const size = Math.round(parseFloat(cs.fontSize) * 100) / 100;
        const leading = cs.lineHeight === "normal" ? null : Math.round(parseFloat(cs.lineHeight) * 10) / 10;
        const want = Math.abs(size - Math.round(size)) <= 0.25 ? (type[Math.round(size)] ?? null) : null;
        let where = el.tagName.toLowerCase();
        for (let a: HTMLElement | null = el; a; a = a.parentElement) {
          const leaflet = [...a.classList].find(c => c.startsWith("leaflet-") && c !== "leaflet-container");
          const id = a.dataset.testid ? `#${a.dataset.testid}` : a.dataset.slot ?? leaflet;
          if (id) { where = id; break; }
        }
        const add = (map: Map<string, TypeFinding>, key: string) => {
          const found = map.get(key);
          if (found) found.count++;
          else map.set(key, { size, leading, want, where, text: text.slice(0, 40), count: 1 });
        };
        if (want === null) add(offScale, `${size}|${where}`);
        else if (leading !== null && Math.abs(leading - want) > 1 && !el.closest(glyphs)) add(offLeading, `${size}/${leading}|${where}`);
      }
    }
    return { offScale: [...offScale.values()], offLeading: [...offLeading.values()] };
  }, { scope, type: IOS_TYPE, glyphs: LEADING_EXEMPT });
}

/** P11: how far the page scrolls sideways; 0 or less passes. */
export const horizontalOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

export type Insets = { top: number; right: number; bottom: number; left: number };

/** P12's notch, island and home indicator, which no desktop engine has:
 *  every env(safe-area-inset-*) in the page's own style sheets and style
 *  attributes rewritten to these insets, in place, so the app is
 *  measured with the CSS it ships. */
export async function emulateSafeArea(page: Page, insets: Insets) {
  await page.evaluate(insets => {
    const re = /env\(\s*safe-area-inset-(top|right|bottom|left)\s*(?:,[^()]*(?:\([^()]*\)[^()]*)*)?\)/g;
    const patch = (style: CSSStyleDeclaration) => {
      if (style.cssText.includes("safe-area-inset")) {
        style.cssText = style.cssText.replace(re, (_, side: keyof typeof insets) => `${insets[side]}px`);
      }
    };
    const walk = (rules: CSSRuleList) => {
      for (const rule of rules) {
        if (rule instanceof CSSStyleRule) patch(rule.style);
        if ("cssRules" in rule) walk((rule as CSSGroupingRule).cssRules);
      }
    };
    for (const sheet of document.styleSheets) {
      try { walk(sheet.cssRules); } catch { /* another origin's sheet: not ours */ }
    }
    for (const el of document.querySelectorAll<HTMLElement>("[style*='safe-area-inset']")) patch(el.style);
  }, insets);
}

export type InsetFinding = { control: string; box: string };

/** P12: controls pinned to the screen that reach into an inset. Pinned:
 *  in a fixed or sticky box with no scroll container between (content
 *  that scrolls is not pinned, and the map's own markers and popups are
 *  the map's). Covered at its centre: not on show, not judged. */
export function outsideSafeArea(page: Page, insets: Insets): Promise<InsetFinding[]> {
  return page.evaluate(({ insets, tappable }) => {
    const pinned = (el: HTMLElement) => {
      for (let a: HTMLElement | null = el; a; a = a.parentElement) {
        const cs = getComputedStyle(a);
        if (/fixed|sticky/.test(cs.position)) return true;
        if (a !== el && /auto|scroll/.test(cs.overflowX + cs.overflowY)) return false;
      }
      return false;
    };
    const found: { control: string; box: string }[] = [];
    for (const el of document.querySelectorAll<HTMLElement>(tappable)) {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2 || el.closest(".leaflet-pane") || !pinned(el)) continue;
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (!hit || !(hit === el || el.contains(hit))) continue;
      if (r.top >= insets.top && r.left >= insets.left && r.right <= innerWidth - insets.right && r.bottom <= innerHeight - insets.bottom) continue;
      const name = (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
      found.push({
        control: `${el.tagName.toLowerCase()}${el.dataset.testid ? `[${el.dataset.testid}]` : ""} "${name}"`,
        box: `${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}×${Math.round(r.height)}`,
      });
    }
    return found;
  }, { insets, tappable: TAPPABLE });
}
