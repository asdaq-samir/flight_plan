import { useState, type ReactNode } from "react";

interface Props {
  /** Each page's own content -- the rating scale on the label page, the
   *  checkpoint score key on the planner. Only the shell (position,
   *  the open/closed panel, the toggle button) is shared. */
  children: ReactNode;
  /** The panel's width class -- the two pages' content wants slightly
   *  different widths (a wrapping paragraph vs. a short color key), so
   *  this is the one thing callers still set themselves. */
  width?: string;
  /** Overrides the toggle button's own text -- defaults to "Show
   *  Guide"/"Hide Guide" (reflecting open state). Pass a fixed name
   *  (e.g. "Labeling Guide") to show that instead, the same
   *  regardless of whether the panel's open; it's split one word per
   *  line, the same two-line shape the default text has. */
  buttonLabel?: string;
  /** Extra clearance above the corner, in pixels -- the error drawer
   *  reserves real space at the bottom now instead of just floating
   *  over everything, so this needs to clear it rather than sit
   *  underneath it. */
  bottomOffset?: number;
}

/**
 * The bottom-right "Guide" both pages show: a button that opens a panel
 * of reference material over the map, closed by default. Both pages
 * used to carry their own copy of this shell (`RatingLegend`,
 * `ScoreLegend`) — identical down to the comments explaining `z-[1000]`
 * and `items-end` — with only the content and one width class actually
 * differing, which is what's left in each of them now.
 */
export default function GuidePanel({ children, width = "w-72", buttonLabel, bottomOffset = 0 }: Props) {
  const [open, setOpen] = useState(false);

  return (
    // z-[1000]: Leaflet's own panes and controls carry real z-index
    // values (up to 1000 for controls) despite sitting later in a
    // different part of the DOM, and z-index:auto here would lose to
    // them regardless of paint order -- without this, the map's own
    // layers paint over this panel once tiles load, which looks like
    // the panel turned transparent but is actually stacking order.
    // items-end: the panel is wider than the button, and block children
    // default to left-aligned within whatever width the container's own
    // shrink-to-fit picks -- without this, the button wasn't actually
    // flush against the true right edge, just against the panel's own
    // left edge, wherever that happened to land.
    <div style={{ bottom: 4 + bottomOffset }} className="absolute right-1 z-[1000] flex flex-col items-end">
      <div
        className={`mb-2 ${width} origin-bottom-right overflow-y-auto rounded-lg border border-slate-200 bg-white p-3 shadow-lg transition-all duration-200 ${
          open ? "max-h-[70vh] scale-y-100 opacity-100" : "max-h-0 scale-y-0 opacity-0"
        }`}
      >
        {children}
      </div>

      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        data-testid="guide-button"
        className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-center text-sm leading-tight shadow-md hover:bg-slate-50"
      >
        {buttonLabel ? (
          buttonLabel.split(" ").map((word, i) => <div key={i}>{word}</div>)
        ) : (
          <>
            <div>{open ? "Hide" : "Show"}</div>
            <div>Guide</div>
          </>
        )}
      </button>
    </div>
  );
}
