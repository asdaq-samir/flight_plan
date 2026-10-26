import type { CSSProperties } from "react";
import { cn } from "cn";

/**
 * The tab up's marker: a flat pane of the tint since the style audit
 * (2026-10-26). Before, it was drawn out of one line of glass, at the owner's pick of the
 * tab bar's looks (2e, 2026-10-22: "Let's try 2e first"): a stroke of
 * clear glass's lit rim along under the tabs, rising over the tab up --
 * its sides, round shoulders at the top, feet that flare down onto the
 * line -- the tab a bubble of clear glass, bright at its top and lit
 * along its rim, standing off the card on a soft shadow. No grey line
 * under the bar: this is it. Raised, not etched: a dark hairline under
 * the rim read as a groove cut round the tab (the owner's "Why does the
 * glass tint look etched than a bubble?"), so the shade is a soft blur
 * outside it and the glass itself carries the light. The tab slides with the tab up, the
 * line opening under it, at the bar's own pace (`transition`).
 *
 * Its own height past the bar's top (the parent's -top-[3px]) leaves six
 * points of glass over the icon and four clear of the grabber, in the
 * sheet's 56-point bar; the feet
 * meet the line at the tab's own edges, so the line runs from the panel's
 * side to the tab and on from it to the other.
 */
export default function TabGlass({ at, count, transition, lifted = null }: {
  /** The tab up, from the left. */
  at: number;
  count: number;
  /** The bar's own easing, so the tab and the line move as the bubble did. */
  transition: string;
  /** Held under a finger: the same tab of glass, not another shape, at the
   *  finger -- its middle and its width in the bar's own pixels -- a little
   *  wider and taller, as iOS's lens grows when lifted, where a big oval
   *  of the old bubble took the tab's place (the owner's video, 2026-10-22). */
  lifted?: { x: number; tab: number } | null;
}) {
  const moves: CSSProperties = { transition };
  // Where the tab stands: its cell, or under the finger, grown 4 a side.
  const left = lifted ? `${lifted.x - lifted.tab / 2 - 4}px` : `calc(${at} * 100% / ${count})`;
  const width = lifted ? `${lifted.tab + 8}px` : `calc(100% / ${count})`;
  return (
    <div
      aria-hidden="true" data-testid="tab-bubble" data-lifted={lifted ? "" : undefined}
      className={cn("pointer-events-none absolute inset-x-0 bottom-0 transition-[top] duration-150", lifted ? "-top-[6px]" : "-top-[3px]")}
    >
      {/* The tab up on a flat pane of the tint, as Apple's own web apps
          mark a choice (the owner's yes to the style audit's "sharper",
          2026-10-26): the glass tab with its sheen and white rim, and the
          lines out from it, read as smudged on the opaque sheet. Moving
          and lifted as before. */}
      <div className="absolute inset-y-0 px-1.5 pb-1" style={{ ...moves, left, width }}>
        <div className="size-full rounded-2xl bg-tint/10" />
      </div>
    </div>
  );
}
