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
 * the home indicator; P16 the app's own typeface everywhere; P17 reading
 * text and headings in the text's own colour; P18 the same component at
 * the same size wherever it is; P14 an iPad's sheets as iOS's form sheet;
 * P15 every word at WCAG's contrast, light and dark.
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
// The map panel's grabber is the mark of where to drag, as iOS's is: the
// whole head drags, and tapping it is a keyboard's and VoiceOver's way.
export const HIT_EXEMPT = [".leaflet-marker-icon", "[data-slot=tabs-trigger]", "[data-testid=sidebar-trigger-button]"].join(", ");

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
  await page.evaluate(async () => {
    // Two frames first: a change just made -- the colour scheme switched
    // for P15's dark pass, a control enabled -- starts its transitions
    // only when the page's style is next worked out, and a wait begun
    // before then found none to wait for. CI's landscape phone measured
    // a row's words at 1.1:1, dark on dark, a frame into a theme change.
    await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
    await Promise.race([
      Promise.all(document.getAnimations()
        .filter(a => a.effect?.getTiming().iterations !== Infinity)
        .map(a => a.finished.catch(() => undefined))),
      new Promise(done => setTimeout(done, 3000)),
    ]);
  });
}

/** The planner's progress toasts gone ("Scoring checkpoints…"): over
 *  the top of a phone's screen they cover the controls under them for a
 *  moment, which is not the screen's layout. Up to twenty seconds; past
 *  that, P1 looks round a toast that stays rather than at it. */
export async function quiet(page: Page) {
  await page.locator("[data-sonner-toast]").first().waitFor({ state: "detached", timeout: 20000 }).catch(() => undefined);
}

export type HitMiss = { control: string; box: string; lost: number; by: string };

/** P1: every control whose 44 × 44 square, centred on it, is not wholly
 *  its own, by nine elementFromPoint probes. That sees a pseudo-element
 *  hit area as its element (index.css's ::after), and sees whatever
 *  covers or clips the square: a neighbour's area, an overflow:hidden
 *  ancestor, a sticky bar. Not judged: a control covered at its own
 *  centre (behind a drawer, under an overlay -- not on show), one whose
 *  square crosses a scroll container's edge (scrolled into view it would
 *  be judged), and a probe that lands on a toast, which is gone in a
 *  moment and is not the layout, or on a sticky heading a row has
 *  scrolled under. */
export function hitAreaMisses(page: Page, scope = "body", size = 44): Promise<HitMiss[]> {
  return page.evaluate(({ scope, size, tappable, exempt }) => {
    const half = size / 2 - 1;
    const misses: { control: string; box: string; lost: number; by: string }[] = [];
    const root = document.querySelector(scope);
    if (!root) return misses;
    for (const el of root.querySelectorAll<HTMLElement>(tappable)) {
      // A tab list is focusable for its arrow keys; its tabs are what is tapped.
      if (el.getAttribute("role") === "tablist" || el.matches(exempt)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2 || getComputedStyle(el).visibility !== "visible") continue;
      const own = (hit: Element | null) =>
        !!hit && (hit === el || el.contains(hit) || (hit.closest("label") as HTMLLabelElement | null)?.control === el);
      const toast = (hit: Element | null) => !!hit?.closest("[data-sonner-toaster]");
      // A sticky heading over a row scrolled half under it: the row is
      // half out of view, as at a scroll container's edge, not covered.
      const pinned = (hit: Element | null) => {
        for (let a = hit; a && a !== document.body; a = a.parentElement) if (getComputedStyle(a).position === "sticky") return !a.contains(el);
        return false;
      };
      // A popover or a sheet open over the page covers what is under its
      // edge, as iOS's do: a row half under it is covered, not crowded.
      const over = (hit: Element | null) => {
        const layer = hit?.closest('[data-slot="popover-content"], [data-slot="drawer-content"], [role="dialog"]');
        return !!layer && !layer.contains(el);
      };
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      if (!own(document.elementFromPoint(cx, cy))) continue;
      let port = { l: 0, t: 0, r: innerWidth, b: innerHeight };
      for (let a = el.parentElement; a; a = a.parentElement) {
        const o = getComputedStyle(a);
        if (!/auto|scroll/.test(o.overflowX + o.overflowY)) continue;
        const b = a.getBoundingClientRect();
        port = { l: Math.max(port.l, b.left), t: Math.max(port.t, b.top), r: Math.min(port.r, b.right), b: Math.min(port.b, b.bottom) };
      }
      // A port's right and bottom edges are past it: a probe on one
      // finds what is beyond (a row cut off at 992 by its list, probed
      // at 992, found the panel's foot under it).
      if (cx - half < port.l || cx + half >= port.r || cy - half < port.t || cy + half >= port.b) continue;
      const probes = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];
      const takers: string[] = [];
      const lost = probes.filter(([dx, dy]) => {
        const hit = document.elementFromPoint(cx + dx * half, cy + dy * half);
        const taken = !own(hit) && !toast(hit) && !pinned(hit) && !over(hit);
        if (taken && hit) takers.push(`${hit.tagName.toLowerCase()}${(hit as HTMLElement).dataset.testid ? `[${(hit as HTMLElement).dataset.testid}]` : ""} "${(hit.getAttribute("aria-label") ?? hit.textContent ?? "").trim().slice(0, 20)}"`);
        return taken;
      }).length;
      if (!lost) continue;
      const name = (el.getAttribute("aria-label") ?? el.getAttribute("title") ?? el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
      const id = el.dataset.testid ?? el.dataset.slot ?? [...el.classList].find(c => c.startsWith("leaflet-")) ?? "";
      misses.push({ control: `${el.tagName.toLowerCase()}${id ? `[${id}]` : ""} "${name}"`, box: `${Math.round(r.width)}×${Math.round(r.height)}`, lost, by: [...new Set(takers)].join(", ") });
    }
    return misses;
  }, { scope, size, tappable: TAPPABLE, exempt: HIT_EXEMPT });
}

export type TypeFinding = {
  size: number; leading: number | null; want: number | null; where: string; text: string; count: number;
  face?: string;
};

/** P2 and P3: visible text off iOS's scale, and text at an iOS size off
 *  that size's leading by more than a pixel -- each kind grouped by size
 *  (and leading) and by where it is (the nearest test id, shadcn slot or
 *  Leaflet part), with an example and how many pieces of text. Not seen:
 *  text clipped to a pixel (a screen reader's alone), and text above or
 *  left of the page, where no scroll reaches, and text kept for a screen
 *  reader (sr-only, whose padding can leave it a box of its own). */
export function typeFindings(page: Page, scope = "body"): Promise<{ offScale: TypeFinding[]; offLeading: TypeFinding[]; offFace: TypeFinding[] }> {
  return page.evaluate(({ scope, type, glyphs }) => {
    const offScale = new Map<string, TypeFinding>(), offLeading = new Map<string, TypeFinding>(), offFace = new Map<string, TypeFinding>();
    // P16: the app's own face -- the body's -- or its monospace where a
    // font-mono class asks for one. The map's words were Leaflet's
    // Helvetica Neue, and every size check passed them.
    const first = (family: string) => family.split(",")[0].replace(/["']/g, "").trim();
    const appFace = first(getComputedStyle(document.body).fontFamily);
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
        const face = first(cs.fontFamily);
        if (face !== appFace && !el.closest(".font-mono")) {
          const key = `${face}|${where}`, found = offFace.get(key);
          if (found) found.count++;
          else offFace.set(key, { size, leading, want, where, text: text.slice(0, 40), count: 1, face });
        }
        if (want === null) add(offScale, `${size}|${where}`);
        else if (leading !== null && Math.abs(leading - want) > 1 && !el.closest(glyphs)) add(offLeading, `${size}/${leading}|${where}`);
      }
    }
    return { offScale: [...offScale.values()], offLeading: [...offLeading.values()], offFace: [...offFace.values()] };
  }, { scope, type: IOS_TYPE, glyphs: LEADING_EXEMPT });
}

export type RoleFinding = { role: string; text: string; where: string };

/** P17: reading text -- a paragraph or a list item at the prose size, 15
 *  to a finger -- and headings in the text's own colour, never in the
 *  grey that is for a row's detail, a section's summary, a note and a
 *  status. The consoles' guides were grey where the sidebar's briefing
 *  is black, and every size check passed them. Not judged: rows and
 *  summaries (their grey is their role), a group's small-capital header,
 *  a status (role="status"), and red or amber words, which say something
 *  of their own. */
export function roleFindings(page: Page, scope = "body"): Promise<RoleFinding[]> {
  return page.evaluate(scope => {
    const root = document.querySelector(scope);
    if (!root) return [];
    const probe = document.createElement("span");
    probe.className = "text-muted-foreground";
    document.body.append(probe);
    const muted = getComputedStyle(probe).color;
    probe.remove();
    const found: { role: string; text: string; where: string }[] = [];
    for (const el of root.querySelectorAll<HTMLElement>("p, li, h1, h2, h3, h4")) {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2 || el.closest(".sr-only")) continue;
      if (el.closest('[role="status"], [data-slot^="item"], [data-slot="section-summary"], [data-slot="accordion-trigger"], [data-sonner-toaster], .leaflet-pane')) continue;
      const cs = getComputedStyle(el);
      // A group's header is grey by design: iOS's small capitals over a
      // grouped list (13, semibold, uppercase), as the settings' are.
      const groupHeader = cs.textTransform === "uppercase" && parseFloat(cs.fontSize) <= 13.25;
      const heading = /^H\d$/.test(el.tagName) && !groupHeader;
      const reading = !heading && Math.abs(parseFloat(cs.fontSize) - 15) <= 0.25;
      if ((heading || reading) && cs.color === muted) {
        let where = el.tagName.toLowerCase();
        for (let a: HTMLElement | null = el; a; a = a.parentElement) {
          const id = a.dataset.testid ? `#${a.dataset.testid}` : a.dataset.slot;
          if (id) { where = id; break; }
        }
        found.push({ role: heading ? "heading" : "reading", text: (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40), where });
      }
    }
    return found;
  }, scope);
}

export type ComponentFinding = { rule: string; what: string; measured: string };

/** P18: the same component at the same size wherever it is -- what the
 *  pilot found differing from one surface to the next, which no check of
 *  a size against iOS's list on its own could see:
 *  - a sheet's grabber at iOS's 36 by 5;
 *  - one radius for what floats, the theme's: sheets, pop-ups, dialogs,
 *    map cards, list cards and toasts -- but the map's panel on a phone,
 *    in Maps' own shapes: its capsule at rest a full pill, its medium
 *    sheet 36, and the console's sheet at half the same 36;
 *  - one icon-only button, 36 with a 20 glyph -- outside the navigation
 *    bar, whose sizes are a decision still open, and the map's markers;
 *  - a drawer's or a sheet's words at least 16 in from its side, iOS's
 *    margin (a point less for a glyph's own side bearing);
 *  - a switch at iOS's own 51 by 31 to a finger, the pilot's one
 *    exception to keeping stock controls their stock size;
 *  - P14, on an iPad, the consoles as iOS's form sheet: 540 by 620 (or
 *    less, on a smaller window), centred;
 *  - on a phone, no panel scrolling sideways (the nav log's five columns
 *    are laid out to fit their drawer) -- not in Slide Over's 320, where
 *    the drawer is narrower than five columns need and the log scrolls,
 *    as it does with the text set large. */
export function componentFindings(page: Page): Promise<ComponentFinding[]> {
  return page.evaluate(() => {
    const found: { rule: string; what: string; measured: string }[] = [];
    const on = (el: Element) => {
      const r = el.getBoundingClientRect();
      return r.width > 1 && r.height > 1 && getComputedStyle(el).visibility === "visible";
    };
    const name = (el: Element) => (el.getAttribute("aria-label") ?? (el as HTMLElement).dataset?.testid ?? el.getAttribute("data-slot") ?? el.className.toString().split(" ")[0]).slice(0, 40);
    for (const grab of document.querySelectorAll('[data-slot="drawer-content"] > div:first-child, [data-slot="console-sheet"] [data-grabber]')) {
      const r = grab.getBoundingClientRect();
      if (!on(grab) || r.height > 12) continue;
      if (Math.abs(r.width - 36) > 0.5 || Math.abs(r.height - 5) > 0.5) found.push({ rule: "grabber 36×5", what: "sheet grabber", measured: `${r.width}×${r.height}` });
    }
    const theme = document.createElement("div");
    theme.className = "rounded-lg";
    document.body.append(theme);
    const radius = parseFloat(getComputedStyle(theme).borderTopLeftRadius);
    theme.remove();
    const floats = ['[data-slot="drawer-content"][data-vaul-drawer-direction="bottom"]', '[data-slot="console-sheet"]', '[data-slot="map-panel"]', '[data-slot="popover-content"]', '[data-slot="dialog-content"]',
      '[data-slot="alert-dialog-content"]', ".leaflet-popup-content-wrapper", '[data-slot="item-group"].border', "[data-sonner-toast]"].join(", ");
    for (const box of document.querySelectorAll(floats)) {
      if (!on(box)) continue;
      // A sheet from the top of the screen is rounded at its bottom only.
      const r = Math.max(parseFloat(getComputedStyle(box).borderTopLeftRadius), parseFloat(getComputedStyle(box).borderBottomLeftRadius));
      // The capsule a full pill, its corners half its height, as Maps'; a
      // phone's sheet (the map's panel, the console) 36, inset or on the
      // screen's edges with its far corners round.
      const sheet = box.matches('[data-slot="map-panel"][data-sheet], [data-slot="console-sheet"]');
      const shape = box.matches("[data-capsule]") ? box.getBoundingClientRect().height / 2 : sheet ? 36 : radius;
      if (Math.abs(r - shape) > 0.5) found.push({ rule: `one radius, ${Math.round(shape)}`, what: name(box), measured: `${r}` });
    }
    for (const button of document.querySelectorAll<HTMLElement>('button, a[data-slot="button"]')) {
      const svg = button.querySelector("svg");
      if (!svg || !on(button) || button.closest('header, .leaflet-marker-icon, [data-sonner-toaster], [data-slot="tabs-trigger"]')) continue;
      const words = [...button.querySelectorAll("*"), button].some(n => [...n.childNodes].some(c => c.nodeType === 3 && c.textContent!.trim() && !(n as Element).closest(".sr-only")));
      // A button named by words laid over it -- a section's title over its
      // row-wide accordion trigger (AccordionSection) -- has words: it is
      // a row with a chevron, not an icon button.
      const labelled = (button.getAttribute("aria-labelledby") ?? "").split(/\s+/).some(id => (id && document.getElementById(id)?.textContent?.trim()));
      if (words || labelled || button.getAttribute("role") === "combobox") continue;
      const b = button.getBoundingClientRect(), g = svg.getBoundingClientRect();
      const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      if (!hit || !(hit === button || button.contains(hit))) continue;
      // The close's cross at 24, the one exception (CloseButton): lucide's
      // spans half its box where the other glyphs span most of theirs.
      const glyph = button.querySelector("svg.lucide-x") ? 24 : 20;
      if (Math.abs(b.width - 36) > 0.5 || Math.abs(b.height - 36) > 0.5 || Math.abs(g.width - glyph) > 0.5) {
        found.push({ rule: `icon button 36, glyph ${glyph}`, what: name(button), measured: `${Math.round(b.width)}×${Math.round(b.height)}, glyph ${Math.round(g.width)}` });
      }
    }
    for (const panel of document.querySelectorAll('[data-slot="map-panel"], [data-slot="drawer-content"], [data-testid="console-sheet"]')) {
      if (!on(panel)) continue;
      const p = panel.getBoundingClientRect();
      let inset = Infinity, sample = "";
      const walk = document.createTreeWalker(panel, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        if (!n.textContent!.trim() || n.parentElement!.closest(".sr-only")) continue;
        const range = document.createRange();
        range.selectNodeContents(n);
        const t = range.getBoundingClientRect();
        if (t.width < 1 || t.bottom < p.top || t.top > p.bottom) continue;
        // Words scrolled out of sight, or in something that scrolls
        // sideways (a wide table, its cells passing the edge as it moves),
        // are not the panel's margin.
        const at = document.elementFromPoint(t.left + Math.min(t.width / 2, 4), t.top + t.height / 2);
        if (!at || !(at === n.parentElement || n.parentElement!.contains(at) || at.contains(n.parentElement))) continue;
        let scrolls = false;
        for (let a = n.parentElement; a && a !== panel; a = a.parentElement) if (a.scrollWidth > a.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(a).overflowX)) scrolls = true;
        if (scrolls) continue;
        if (t.left - p.left < inset) { inset = t.left - p.left; sample = n.textContent!.trim().slice(0, 30); }
      }
      if (inset < 14.5) found.push({ rule: "margin 16", what: name(panel), measured: `${Math.round(inset)} at "${sample}"` });
    }
    if (matchMedia("(pointer: coarse)").matches) {
      for (const sw of document.querySelectorAll('[data-slot="switch"]')) {
        if (!on(sw)) continue;
        const b = sw.getBoundingClientRect();
        if (Math.abs(b.width - 51) > 0.5 || Math.abs(b.height - 31) > 0.5) found.push({ rule: "switch 51×31", what: name(sw), measured: `${b.width}×${b.height}` });
      }
    }
    if (matchMedia("(pointer: coarse) and (min-width: 744px) and (min-height: 600px)").matches) {
      for (const sheet of document.querySelectorAll('[data-testid="console-sheet"]')) {
        if (!on(sheet)) continue;
        const b = sheet.getBoundingClientRect();
        const w = Math.min(540, innerWidth - 40), h = Math.min(620, innerHeight * 0.85);
        const centred = Math.abs(b.left - (innerWidth - b.right)) <= 1 && Math.abs(b.top - (innerHeight - b.bottom)) <= 1;
        if (Math.abs(b.width - w) > 1 || Math.abs(b.height - h) > 1 || !centred) {
          found.push({ rule: "P14 form sheet", what: "console", measured: `${Math.round(b.width)}×${Math.round(b.height)} at ${Math.round(b.left)},${Math.round(b.top)}` });
        }
      }
    }
    if (innerWidth >= 375 && innerWidth < 768) {
      for (const el of document.querySelectorAll<HTMLElement>("*")) {
        const s = getComputedStyle(el);
        if (!/auto|scroll/.test(s.overflowX) || !on(el)) continue;
        // A line made to slide, the route's pills (RouteBox, the capsule):
        // one line of tokens, as ForeFlight's route is, at the pilot's ask.
        if (el.hasAttribute("data-slides")) continue;
        if (el.scrollWidth - el.clientWidth > 1) found.push({ rule: "no sideways scroll in a panel", what: name(el), measured: `${el.scrollWidth} in ${el.clientWidth}` });
      }
    }
    return found;
  });
}

export type ContrastFinding = { text: string; ratio: number; need: number; where: string };

/** P15: every visible word at WCAG's contrast against what is actually
 *  behind it -- 4.5:1, or 3:1 for large type (24, or 18.66 bold) -- in
 *  whichever scheme the page is in. The backgrounds behind a word are
 *  composited up to the first opaque one, its colour taken at its
 *  opacity and its ancestors'; a canvas reads any CSS colour (oklch,
 *  oklab, color-mix) as sRGB. Not judged: a disabled control's words
 *  (WCAG's own exception), text over the map's tiles or an image, whose
 *  background is not a colour, and a screen reader's own. */
export function contrastFindings(page: Page, scope = "body"): Promise<ContrastFinding[]> {
  return page.evaluate(scope => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const rgba = (color: string): number[] => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = "rgba(0,0,0,0)";
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      return [d[0], d[1], d[2], d[3] / 255];
    };
    const over = (top: number[], under: number[]) => {
      const a = top[3];
      return [0, 1, 2].map(i => top[i] * a + under[i] * (1 - a)).concat(1);
    };
    const lum = (c: number[]) => {
      const [r, g, b] = c.slice(0, 3).map(v => {
        const s = v / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const root = document.querySelector(scope);
    const found = new Map<string, { text: string; ratio: number; need: number; where: string }>();
    if (!root) return [];
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const text = (n.textContent ?? "").trim();
      const el = n.parentElement;
      if (!text || !el || el.closest(".sr-only, [disabled], [aria-disabled='true'], [data-disabled], .leaflet-tile-pane")) continue;
      const box = el.getBoundingClientRect();
      if (box.width < 2 || box.height < 2) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility !== "visible") continue;
      // Up to the first opaque background, every layer on the way, and
      // the opacity the word is drawn at.
      const layers: number[][] = [];
      let opacity = 1, base: number[] | null = null, unknown = false;
      for (let a: Element | null = el; a; a = a.parentElement) {
        const s = getComputedStyle(a);
        opacity *= parseFloat(s.opacity);
        if (s.backgroundImage !== "none" || a.classList.contains("leaflet-container")) { unknown = true; break; }
        const bg = rgba(s.backgroundColor);
        if (bg[3] >= 0.999) { base = bg; break; }
        if (bg[3] > 0) layers.push(bg);
      }
      // A toast fading in or out is between two states, neither of them its
      // own; at rest it is measured.
      if (unknown || (opacity < 0.99 && el.closest("[data-sonner-toaster]"))) continue;
      let bg = base ?? [255, 255, 255, 1];
      for (const layer of layers.reverse()) bg = over(layer, bg);
      const fill = el instanceof SVGElement && cs.fill.startsWith("rgb") ? cs.fill : cs.color;
      const fg = rgba(fill);
      fg[3] *= opacity;
      const shown = over(fg, bg);
      const [hi, lo] = [lum(shown), lum(bg)].sort((x, y) => y - x);
      const ratio = Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
      const size = parseFloat(cs.fontSize), weight = parseFloat(cs.fontWeight);
      const need = size >= 24 || (size >= 18.66 && weight >= 700) ? 3 : 4.5;
      if (ratio + 0.005 < need) {
        let where = el.tagName.toLowerCase();
        for (let a: HTMLElement | null = el; a; a = a.parentElement) {
          const id = a.dataset.testid ? `#${a.dataset.testid}` : a.dataset.slot;
          if (id) { where = id; break; }
        }
        const key = `${where}|${ratio}`;
        if (!found.has(key)) found.set(key, { text: text.slice(0, 32), ratio, need, where });
      }
    }
    return [...found.values()];
  }, scope);
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
    // What reads the insets in script (the map panel's sheet, whose
    // detents are pixels) reads them again on a resize, which on a phone
    // is what turning it fires.
    window.dispatchEvent(new Event("resize"));
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
