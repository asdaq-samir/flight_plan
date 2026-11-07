import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { ChevronRight, Wind } from "lucide-react";
import { cn } from "cn";
import { GLASS_BUTTON, GLASS_PICKED } from "../../../../components/mapChrome";
import { ToggleGroup, ToggleGroupItem } from "../../../../components/ui/toggle-group";
import { CollapsibleContent } from "../../../../components/ui/collapsible";
import { Skeleton } from "../../../../components/ui/skeleton";
import type { Runway } from "../../../../lib/api/types";
import { runwayNumber, type RunwayEnd, type WindPick } from "../../../../lib/pattern";
import { trafficPattern } from "../../../../lib/trafficPattern";
import { TEXT } from "../../../../lib/text";
import { altFt } from "../../../../lib/units";
import type { EndFit } from "../../../../lib/runwayFit";
import { useOpenRunwayLines, type ProcedureAirport } from "../../hooks/useProceduresRoute";

/** The value of a choice's "None" (no transition), and a runway line's
 *  with none picked yet: a toggle's value is a string. */
export const NONE = "none";

/**
 * Choices laid out as chips, as iOS's filters are, one of them picked:
 * shadcn's ToggleGroup (Radix: a radio group to a screen reader, arrow
 * keys between them), a tap on the one picked keeping it. Each chip is 32
 * high; its 44-point hit area a pseudo-element six round it, meeting its
 * neighbours' across the twelve between them, along a row and between
 * the rows they wrap to, the chip not grown.
 */
export function Chips({ label, value, onChange, trailing, trailingRef, enter, flushStart = false, tray = false, children }: {
  /** The chips the body of a tray, after its head (TRAY_HEAD). */
  tray?: boolean;
  /** The pull-downs' box, for the line to glide them as it opens. */
  trailingRef?: RefObject<HTMLDivElement | null>;
  /** How the chips come in, the pull-downs after them left out of it. */
  enter?: string;
  /** Its first chip at its start, no room kept before it for the chip's
   *  own tap area: where a control's 44 points end just before it (the
   *  runway line's arrow). */
  flushStart?: boolean;
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** After the chips, sliding with them: a field's procedures' pull-downs
   *  (the owner's "just let it slide with runways"). */
  trailing?: ReactNode;
  children: ReactNode;
}) {
  const row = useRef<HTMLDivElement>(null);
  // The chip chosen in the middle of the line, the runways either side of
  // it in sight, at the owner's ask ("when unfolding runway, make selected
  // the center one so we can see what's on the left and right"); where the
  // line does not scroll, as far as it goes. One past the row's end
  // (O'Hare's 9L of eight runways) came in at the edge before. Sideways
  // only -- as it is picked, and again
  // whenever the line or its chips change size after it opens: brought in
  // once at its first layout, 9L was out of sight again by the time it was
  // looked for, one run in two (procedures:306). A pilot's own scroll
  // resizes nothing, so it is never undone.
  useEffect(() => {
    const box = row.current;
    if (!box) return;
    const show = () => {
      const on = box.querySelector<HTMLElement>("[data-state=on]");
      if (!on) return;
      // Where it lies in the line's scroll, by layout: the chips slide in
      // as the line opens (`enter`), and their place on screen then was
      // 24 points off the middle (procedures:307). The group moves as one,
      // so the chip's place in it holds.
      const group = on.closest<HTMLElement>("[data-slot=toggle-group]") ?? on.parentElement!;
      const chip = on.getBoundingClientRect(), its = group.getBoundingClientRect();
      box.scrollLeft = group.offsetLeft + (chip.left - its.left) + chip.width / 2 - box.clientWidth / 2;
    };
    show();
    const watch = new ResizeObserver(show);
    watch.observe(box);
    if (box.firstElementChild) watch.observe(box.firstElementChild);
    return () => watch.disconnect();
  }, [value]);
  return (
    // One line, scrolled sideways where the chips are more than fit, at
    // the owner's ask; the padding keeps the chips' and the group's tap
    // areas inside what the scroll clips.
    <div ref={row} data-slides="" className={cn("relative -my-1.5 min-w-0 flex-1 overflow-x-auto py-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden", flushStart ? "-mr-1.5 pr-1.5" : "-mx-1.5 px-1.5", trailing && "flex items-center gap-3")}>
      <ToggleGroup
        type="single" value={value} onValueChange={v => { if (v) onChange(v); }}
        aria-label={label} spacing={3}
        // The group's own 44 a pseudo-element behind it, as Segmented's
        // track has, so a tap just over or under a row of chips is the
        // group's and not the page's (isolate keeps it over what is round).
        className={cn("relative isolate w-max flex-nowrap after:absolute after:inset-x-0 after:-inset-y-1.5 after:-z-10 after:content-['']", !trailing && !tray && "min-w-full", tray && TRAY_BODY, enter)}
      >
        {children}
      </ToggleGroup>
      {trailing && <div ref={trailingRef} className="flex shrink-0 items-center gap-2">{trailing}</div>}
    </div>
  );
}

/** Where each runway line's pull-downs stood at its last drawing, by the
 *  line's key, and whether it was open: for them to glide from there as it
 *  opens or folds (PatternChips). */
const trailingStood = new Map<string, { open: boolean; x: number }>();

// A runway's chip the buttons' glass, the one picked tinted glass, at the
// owner's pick of the sketches ("B"). Its runway in its middle: a one-figure
// runway ("4") is narrower than the chip's least width, and sat at its left,
// the room to its right empty (the owner's "Why is there extra space to the
// right of runway 4").
/** A tray, the owner's pick for a line that folds (G2): its glyph's head,
 *  the round start of a pale tint capsule, and its chips' body, the rest
 *  of it, hugging them. Two boxes, not one, as the chips scroll sideways
 *  under the head while the line is open: the body goes under the head's
 *  edge, and the tray reads as one. 38 high, the 32 chips three in; the
 *  head 44 across, so the chip against it takes none of its 44 points
 *  (the iOS audit's P1). */
export const TRAY_HEAD = "relative flex h-[38px] w-11 shrink-0 items-center justify-center rounded-l-full bg-tint/12 text-tint";
const TRAY_BODY = "rounded-r-full bg-tint/12 p-[3px] pl-0";
/** The arrow in a folded line's chip, after its words: a tap opens it. */
const FOLDED_ARROW = <ChevronRight className="-mr-1 size-3.5 shrink-0" strokeWidth={2.6} aria-hidden />;

export const CHIP = cn(
  "relative h-8 min-w-11 justify-center rounded-full px-3 font-normal", GLASS_BUTTON, GLASS_PICKED,
  "after:absolute after:-inset-1.5 after:content-['']",
  TEXT.detail,
);

/**
 * A field's traffic pattern, picked by its runway as a chip: the
 * end the wind favours marked with the wind, as the redesign's A had it
 * at the owner's pick, and its head- and crosswind said under the chips
 * (windPick) -- at a departure too, the runway to take off on, at the
 * owner's ask, from the nearest report's wind where the field has none of
 * its own, said as that station's. Drawn on the map as the FAA's Airplane Flying
 * Handbook flies a pattern: the downwind about three-quarters of a mile
 * out, the base 45° from the runway's end, the 45° entry abeam midfield.
 * The side its traffic is flown on and the pattern's altitude are said
 * at the head's end for the runway picked.
 */
/** How the route lands at a field it flies an approach to: the
 *  approach's runway (none for one circling only), whether its plate
 *  publishes circling minimums (undefined until the plate is in), and the
 *  approach as the route's box names it. */
export interface Landing {
  runway: string | null;
  circling: boolean | undefined;
  name: string;
}

export function PatternChips({ airport: a, wind, chosen, landing, note, label, fitOf, onPick, trailing }: {
  airport: ProcedureAirport;
  /** Each end's fit today, marked on its chip (lib/runwayFit). */
  fitOf: (runway: Runway, end: RunwayEnd) => EndFit | null;
  /** The chips' name to a screen reader, where not the pattern's. */
  label?: string;
  /** How the runway picked is flown -- its pattern's side and height, or
   *  how the approach lands ("Straight in", "Circle to land") -- said in
   *  its chip's name: the info button that showed it is gone, at the
   *  owner's ask ("No need for info button"). */
  note: string | null;
  /** The field's procedures' pull-downs, after the runway picked while the
   *  line is folded, sliding with its runways while it is open. */
  trailing?: ReactNode;
  wind: WindPick | null;
  chosen: string | null;
  landing: Landing | null;
  onPick: (end: string) => void;
}) {
  const ends = (a.runways ?? [])
    .filter(r => !r.closed)
    .flatMap(r => (r.runway_ends ?? []).filter(e => e.heading_true_deg != null).map(e => ({ runway: r, end: e })))
    .sort((x, y) => x.end.ident.localeCompare(y.end.ident));
  const into = wind && !wind.calm ? wind.ident : null;
  // With an approach, the chip is the runway landed on: the approach's
  // own, straight in, or another only where the plate publishes circling
  // minimums -- a circle to land (AIM 5-4-20); one circling only may
  // circle to any. No pattern is flown then (PlanWorkspace's patterns).
  const straightIn = landing?.runway ?? null;
  const mayCircle = !!landing && (straightIn === null || landing.circling === true);
  const allowed = (id: string) => !landing || id === straightIn || mayCircle;
  // Folded to the runway picked, at the owner's ask ("can the runway line
  // collapse to the selected runway?"): its chip alone, a tap on it the
  // whole line again, and a pick folding it back to the new one. None
  // picked yet, the line whole. Kept by field while the page is, not the
  // component: the list is drawn again as the sheet moves between its
  // foot and its body.
  const key = `${a.ident}:${label ?? ""}`;
  const open = useOpenRunwayLines(s => s.open.includes(key));
  const setOpen = (next: boolean) => useOpenRunwayLines.setState(s => ({ open: next ? [...s.open, key] : s.open.filter(k => k !== key) }));
  const chip = (runway: Runway, end: RunwayEnd) => {
    const id = runwayNumber(end.ident);
    const windward = into === id;
    // Too short in red, a crosswind past the demonstrated or a length
    // inside the margin in amber: a ring, the chip not grown.
    const fitted = fitOf(runway, end);
    const ring = fitted?.short ? "ring-2 ring-destructive" : fitted && (fitted.crosswindOver || fitted.close) ? "ring-2 ring-amber-500" : undefined;
    const said = fitted?.short ? ", too short today" : fitted?.close ? ", little to spare in length" : "";
    const words = `Runway ${id}${windward ? ", into the wind" : ""}${fitted?.crosswindOver ? `, crosswind ${fitted.crosswindKt} knots, past the airplane's demonstrated` : ""}${said}`;
    const fit = fitted?.short ? "short" : fitted?.crosswindOver ? "crosswind" : fitted?.close ? "close" : undefined;
    return { id, ring, words, fit, face: <>{windward && <Wind className="size-4" strokeWidth={2.2} aria-hidden />}{id}</> };
  };
  const picked = chosen !== null ? ends.find(e => runwayNumber(e.end.ident) === chosen) : undefined;
  // The pull-downs after the runways ("+ Arrival", "+ Approach") glide to
  // where the line puts them as it opens and folds, as the runways slide
  // in, where they jumped there -- and faded and slid in with the runways
  // -- once they came up beside them (the owner's "not as smooth as it
  // used to be before the procedures got moved up"). Where they stood is
  // taken at every render (a scroll of the line is one, `scrolled`), by
  // the line's key, as the line is drawn anew as it opens (its block's
  // runway-line-toggle), and they start from it, by a CSS transition:
  // WebKit's headless WAAPI can stall at its first frame.
  const [, setScrolled] = useState(0);
  const line = useRef<HTMLDivElement>(null);
  const after = useRef<HTMLDivElement>(null);
  const shown = !!picked && !open && a.runways !== null ? "folded" : "open";
  useLayoutEffect(() => {
    const box = after.current, base = line.current;
    if (!box || !base) {
      trailingStood.delete(key);
      return;
    }
    const x = box.getBoundingClientRect().left - base.getBoundingClientRect().left;
    const was = trailingStood.get(key);
    trailingStood.set(key, { open: shown === "open", x });
    if (!was || was.open === (shown === "open") || Math.abs(was.x - x) < 1) return;
    if (globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    // Never from past the line's right edge: in the open line they can
    // stand beyond it, scrolled out of sight in its own scroller, and
    // gliding in from there they ran the panel sideways past its edge for
    // the glide's 300 ms -- the nav log 434 px wide in a 385 px drawer as
    // the runway picked into the wind folded the line (checkpoints.spec,
    // CI 2026-10-28), the iOS audit's "no sideways scroll in a panel".
    const room = Math.max(0, base.getBoundingClientRect().width - box.getBoundingClientRect().width - x);
    const from = Math.min(was.x - x, room);
    if (Math.abs(from) < 1) return;
    box.style.transition = "none";
    box.style.transform = `translateX(${from}px)`;
    // Laid out from there before the transition back: a call, as the
    // minifier drops a bare read of offsetWidth.
    box.getBoundingClientRect();
    box.style.transition = "transform 300ms ease-out";
    box.style.transform = "";
  });
  if (shown === "folded" && picked) {
    const c = chip(picked.runway, picked.end);
    return (
      // The pull-downs under the tray where there is no room beside it:
      // a field with an arrival and an approach to add ran the nav log
      // 41 points past a phone's width (the iOS audit's "no sideways
      // scroll in a panel").
      <div ref={line} className="flex flex-wrap items-center gap-x-2 gap-y-2" data-testid="procedure-patterns">
        {/* Still the group's choice to a screen reader, picked: the same
            stock ToggleGroup as the open line's, with the one runway in it,
            so VoiceOver says the same group and choice folded or open. A
            tap on it, the one already picked, opens the line rather than
            unpicking it. The tray's body, its head the glyph (the block's
            runway-line-toggle). */}
        <ToggleGroup
          type="single" value={c.id} aria-label={label ?? `${a.ident} ${landing ? "runway" : "traffic pattern"}`}
          // Square where it meets the head, as the open line's body is.
          className={cn(TRAY_BODY, "rounded-l-none")}
        >
          <ToggleGroupItem
            value={c.id} onClick={() => setOpen(true)}
            // One line, the wind's mark, the runway and the arrow side by
            // side, the arrow never out under the chip (the owner's
            // screenshot, 2026-10-20): laid out in a row here, not left to
            // the chip's own.
            // Its area from the tray's head to the tray's own right edge, the
            // 3 of padding past the chip: on a finger index.css's touch rule
            // sizes a button's area to its own 44 across, outside the
            // utilities' layer, so it stopped at the chip and the tray's
            // 44-point square, 47 across, lost its two corners there above
            // and below (the iOS audit's P1, on KDLH's folded runway,
            // 2026-11-06). Marked important to win over that rule.
            className={cn(CHIP, "inline-flex items-center gap-0.5 whitespace-nowrap after:left-0 after:-right-[3px]! motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-right-3 motion-safe:duration-300", c.ring)}
            aria-label={`${c.words}${note ? `, ${note}` : ""}, picked: tap for the other runways`} data-testid="procedure-pattern" data-fit={c.fit} data-folded=""
          >
            {c.face}
            {FOLDED_ARROW}
          </ToggleGroupItem>
        </ToggleGroup>
        {trailing && <div ref={after} className="flex shrink-0 items-center gap-2">{trailing}</div>}
      </div>
    );
  }
  return (
    // The chips alone, the wind the airport's under its ident and how the
    // runway picked is flown in its chip's name (the owner's "No need for
    // info button").
    <div ref={line} className="flex items-center gap-2" data-testid="procedure-patterns">
      {a.runways === null ? (
        <>
          {/* The runways' chips in outline while they come (the style
              audit, 2026-10-26), their words for a screen reader. */}
          <span role="status" className={cn("flex items-center gap-2", TRAY_BODY)}>
            <span className="sr-only">Fetching the runways…</span>
            {[0, 1, 2].map(k => <Skeleton key={k} aria-hidden="true" className="h-8 w-11 rounded-full" />)}
          </span>
          {trailing}
        </>
      ) : (
        // Opened from its fold, the line slides out to the right of the
        // runway picked, at the owner's ask ("smoothly expand to the
        // right"); a scroll on it draws it again (`scrolled`), for its
        // pull-downs to glide from where they stand as it folds. With a
        // runway picked to fold to, the line is the content of its tray's
        // Collapsible (the block's runway-line-toggle), so the head's
        // aria-controls names it.
        <LineContent folds={!!picked}>
          <div
            className="flex min-w-0 flex-1"
            onScrollCapture={() => setScrolled(t => t + 1)}
          >
            {/* A runway each: no None, at the owner's ask ("Why is none even
                an option?"), as every takeoff and landing is on one -- and
                the chip picked tapped again is no way to unpick it either:
                it folds the line, as a new pick does (the owner, 2026-11-05:
                "The runways should fold when a runway is picked", "Even the
                same one"); the ToggleGroup's "" is that tap. */}
            <Chips
              label={label ?? `${a.ident} ${landing ? "runway" : "traffic pattern"}`} value={chosen ?? NONE}
              onChange={v => { if (v === NONE) return; setOpen(false); if (v) onPick(v); }} trailing={trailing} flushStart tray
              trailingRef={after} enter={chosen !== null ? "motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-left-6 motion-safe:duration-300" : undefined}
            >
              {ends.map(({ runway, end }) => {
                const c = chip(runway, end);
                // An end with no surveyed threshold has no pattern to draw;
                // with an approach, none is drawn, and the end is the approach's
                // own or one it may circle to.
                const drawn = trafficPattern(a.ident, runway, end.ident, a.patternAltitudeFt) !== null;
                const circleNa = !allowed(c.id);
                return (
                  <ToggleGroupItem
                    key={end.ident} value={c.id} disabled={circleNa || (!landing && !drawn)} className={cn(CHIP, c.ring)}
                    aria-label={`${c.words}${circleNa ? `, no circling on the ${landing!.name}` : !landing && !drawn ? ", not surveyed" : ""}`}
                    data-testid="procedure-pattern" data-fit={c.fit}
                  >
                    {c.face}
                  </ToggleGroupItem>
                );
              })}
            </Chips>
          </div>
        </LineContent>
      )}
    </div>
  );
}

/** A runway line's open chips, the content of its tray's Collapsible
 *  where the line folds to a runway picked (`folds`); where it does not
 *  (none picked yet) it is the line itself, with nothing to open it. */
function LineContent({ folds, children }: { folds: boolean; children: ReactNode }) {
  return folds ? <CollapsibleContent asChild>{children}</CollapsibleContent> : children;
}

/** The runway picked, as its field's info says it: the pattern's side and
 *  height, or with an approach, straight in or a circle to land. */
export function patternNote(a: ProcedureAirport, chosen: string | null, landing: Landing | null): string | null {
  if (chosen === null) return null;
  if (landing) return chosen === landing.runway ? "Straight in" : "Circle to land";
  const end = (a.runways ?? []).flatMap(r => r.runway_ends ?? []).find(e => runwayNumber(e.ident) === chosen);
  // Left unless the FAA flags it right (14 CFR 91.126(b)(1)).
  const side = end ? `Runway ${chosen}, ${end.traffic === "right" ? "right" : "left"} traffic` : `Runway ${chosen}`;
  return [side, a.patternAltitudeFt != null ? `${altFt(a.patternAltitudeFt)} ft` : null].filter(Boolean).join(" · ");
}
