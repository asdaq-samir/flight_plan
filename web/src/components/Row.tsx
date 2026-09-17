import { forwardRef, type ReactNode } from "react";

interface Props {
  selected?: boolean;
  onClick?: () => void;
  children: ReactNode;
}

/**
 * A clickable list row with a bottom divider and a selected state --
 * every list in both views (waypoints, checkpoints) is built from
 * these. Forwards its ref so a list can scroll the selected row into
 * view when the selection changes from somewhere other than the row
 * itself (a map click, a keyboard step). `tabIndex` makes it focusable,
 * which is how the labeler tells "arrows should walk the list" apart
 * from "arrows should walk the map" -- but a click doesn't reliably
 * focus a plain element in every browser (Safari, notably, won't
 * unless "Full Keyboard Access" is on), so the click handler focuses
 * it explicitly rather than trusting that default.
 */
const Row = forwardRef<HTMLDivElement, Props>(function Row({ selected, onClick, children }, ref) {
  return (
    <div
      ref={ref}
      tabIndex={0}
      role="button"
      aria-pressed={selected}
      onClick={e => { e.currentTarget.focus(); onClick?.(); }}
      onKeyDown={e => {
        // Enter/Space activate it, matching a real <button> -- tabIndex
        // alone makes a div focusable, not actionable, from the keyboard.
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick?.();
        }
      }}
      className={`cursor-pointer border-b border-slate-100 py-2 last:border-0 hover:bg-slate-50 focus:outline-none focus-visible:bg-blue-50 ${
        selected ? "bg-blue-50 font-semibold" : ""
      }`}
    >
      {children}
    </div>
  );
});

export default Row;
