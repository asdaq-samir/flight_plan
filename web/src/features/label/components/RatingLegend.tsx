import { useState } from "react";
import Badge from "../../../components/Badge";
import type { Rating } from "../../../lib/api/types";
import { COLORS } from "../logic";

const SCALE: [Rating, string, string][] = [
  [0, "Not a feature.", "Contour, boundary, chart text. The detector is wrong."],
  [1, "", "Real, but you’d never use it. One creek among a dozen."],
  [2, "", "You’d have to hunt, and might not be sure you found it."],
  [3, "", "Workable. Findable, but confusable with something nearby."],
  [4, "", "You’d expect to spot it and be confident."],
  [5, "", "Unmistakable. On the nav log without a second thought."],
];

/**
 * The rating scale and keyboard shortcuts, pinned to the bottom-left
 * corner of the map rather than the sidebar -- it's about the map, so
 * it opens over it. The panel grows upward from the toggle button
 * (`absolute bottom-full`) so opening it never shifts the button, or
 * anything else, out from under the cursor.
 */
export default function RatingLegend() {
  const [open, setOpen] = useState(false);

  return (
    // z-[1000]: Leaflet's own panes and controls carry real z-index
    // values (up to 1000 for controls) despite sitting later in a
    // different part of the DOM, and z-index:auto here would lose to
    // them regardless of paint order -- without this, the map's own
    // layers paint over this panel once tiles load, which looks like
    // the panel turned transparent but is actually stacking order.
    <div className="absolute bottom-3 left-3 z-[1000]">
      <div
        className={`mb-2 w-72 origin-bottom overflow-y-auto rounded-lg border border-slate-200 bg-white p-3 shadow-lg transition-all duration-200 ${
          open ? "max-h-[70vh] scale-y-100 opacity-100" : "max-h-0 scale-y-0 opacity-0"
        }`}
      >
        <div className="space-y-3 text-sm">
          <p className="italic text-slate-600">
            Flying this leg, would I look up and know <i>that&rsquo;s the one</i> — not one like it?
          </p>
          <div className="space-y-1">
            {SCALE.map(([n, lead, text]) => (
              <div key={n} className="flex items-start gap-2">
                <Badge color={COLORS[n]}>{n}</Badge>
                <span>{lead && <b>{lead}</b>} {text}</span>
              </div>
            ))}
          </div>
          <p className="text-slate-600">
            <b>0 vs 1 matters most</b> — 0 means the detector should never have surfaced it,
            1 means it&rsquo;s real but poor. <b>Ignore spacing</b>; selection already enforces
            separation. <b>Judge at this zoom</b>.
          </p>
          <div className="space-y-1 border-t border-slate-200 pt-2 text-slate-600">
            <div><kbd>Space</kbd> start / resume / whole route · <kbd>0</kbd>–<kbd>5</kbd> rate</div>
            <div><kbd>&uarr;&darr;&larr;&rarr;</kbd> step the way the course runs · <kbd>Del</kbd> remove</div>
            <div>click the course to add · <kbd>t</kbd> toggle FAA / OSM</div>
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm shadow-md hover:bg-slate-50"
      >
        {open ? "Hide" : "Show"} rating guide &amp; shortcuts
      </button>
    </div>
  );
}
