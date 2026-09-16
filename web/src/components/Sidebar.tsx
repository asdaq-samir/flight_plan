import { useEffect, type ReactNode } from "react";
import PullTab from "./PullTab";
import { useDragHandle } from "../lib/useDragHandle";

const MAX_WIDTH = 640;
// Below this there's no real room to show content -- the handle's own
// vertical label takes over instead of a panel too narrow to read.
const LABEL_AT = 40;
// A drag released "back at the start" rarely lands on exactly 0 --
// callers that hide something else (the Guide panel) while this is
// open treat anything under this as closed, so it actually comes back
// once the sidebar's been opened and closed again, rather than
// staying hidden behind a fraction of a pixel forever.
export const SIDEBAR_OPEN_AT = 20;

function maxWidth(ratio: number, cap: number) {
  // The upper bound scales with the viewport instead of a fixed pixel
  // cap, so it can never swallow the whole screen on a phone -- unless
  // a caller explicitly asks for that (the planner's own nav log wants
  // to be draggable edge to edge), which is what `cap`/`ratio` being
  // overridable is for.
  return Math.min(cap, Math.round(window.innerWidth * ratio));
}

/**
 * The right-hand stack of cards both pages use. A flex column, not a
 * block with `overflow-y-auto` on itself: that let every card scroll
 * as one unit, so a card that should fill the remaining height (like
 * the labeler's waypoint list) had no room to claim -- flex lets a
 * child opt into `flex-1 min-h-0` and actually get it.
 *
 * One continuously-dragged width (`useDragHandle`), not an open/closed
 * boolean with its own snap-to-collapse threshold and a separate
 * click-to-toggle path -- that discrete state swap (a whole different
 * element rendered past a threshold) is what made dragging feel like
 * it jumped partway through instead of following the finger. Drag the
 * handle anywhere from 0 (just its own line) up to as wide as the
 * viewport allows; there's nothing to click.
 */
interface Props {
  children: ReactNode;
  /** What the handle says, vertically, once the panel's too narrow to
   *  show its content -- each page names its own list. */
  label: string;
  /** Fired whenever the dragged width changes -- purely a report, not
   *  control: width stays this component's own state. The Guide panel
   *  sits in the same bottom-right corner this panel opens over, and
   *  needs to know when to get out of the way rather than float on
   *  top of it. */
  onWidthChange?: (width: number) => void;
  /** How much of the viewport width dragging can reach, and the hard
   *  pixel ceiling on top of that -- 0.7/640 (a card stack that's
   *  never the main event) unless a caller overrides them, the way
   *  the planner's own nav log does to be draggable edge to edge. */
  maxWidthRatio?: number;
  maxWidthCap?: number;
}

export default function Sidebar({
  children, label, onWidthChange, maxWidthRatio = 0.7, maxWidthCap = MAX_WIDTH,
}: Props) {
  // The handle sits on the sidebar's left edge, which is to the right
  // of the map -- dragging left is what should widen it, the opposite
  // sign from a left-anchored handle's own math.
  const { size: width, startDrag, onKeyDown } = useDragHandle({
    axis: "x", sign: -1, maxSize: maxWidth(maxWidthRatio, maxWidthCap),
  });

  useEffect(() => { onWidthChange?.(width); }, [width, onWidthChange]);

  return (
    // Floats directly over the map (absolute, full height, pinned to
    // the right) rather than taking its own column out of the layout --
    // `flex` here is what still stretches the gutter and the aside to
    // the full height, the same as it did as a flex sibling in Shell's
    // own row.
    <div className="absolute inset-y-0 right-0 z-[900] flex">
      {/* items-center justify-center centers the tab within the full
          column height (this column still stretches to that height,
          flexbox's own default), rather than the column having to be
          some specific size for the centering to work. No background
          strip -- a bare tab is the look the toolbar's own handle had,
          and the one to match here too. w-fit on the inner wrapper,
          and the hit target inset-0 against it rather than past it:
          only the tab itself is draggable, the same as every other
          pull-tab handle in this app. Feedback on press is the tab
          itself dimming (`group-hover`/`group-active`), not a tint
          appearing around it. */}
      <div className="flex flex-shrink-0 items-center justify-center px-1">
        <div className="group relative w-fit">
          <div className="pointer-events-none transition-opacity group-hover:opacity-90 group-active:opacity-75">
            <PullTab orientation="vertical">
              {width < LABEL_AT && (
                // Same text-xs/slate-500 as the toolbar's own tab label --
                // no bolding, no uppercase, no extra tracking: those made
                // this one read as a different (bigger) size even though
                // the font-size itself already matched.
                <span className="whitespace-nowrap text-xs text-slate-500 [writing-mode:vertical-rl]">
                  {label}
                </span>
              )}
            </PullTab>
          </div>
          <div
            onPointerDown={startDrag}
            onKeyDown={onKeyDown}
            role="slider"
            tabIndex={0}
            aria-label="Resize the sidebar"
            aria-orientation="horizontal"
            aria-valuemin={0}
            aria-valuemax={maxWidth(maxWidthRatio, maxWidthCap)}
            aria-valuenow={width}
            title="Drag or use arrow keys to resize"
            data-testid="sidebar-handle"
            className="absolute inset-0 z-10 cursor-col-resize touch-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-slate-500"
          />
        </div>
      </div>
      <aside
        data-testid="sidebar"
        style={{ width }}
        // min-w-0: flex items default to min-width:auto, which refuses
        // to shrink below the content's own intrinsic size no matter
        // what an explicit width says. No padding of its own, on
        // purpose: a border-box element's rendered width can never go
        // below its own padding, full stop -- this element carries none,
        // so `width:0` really means 0 rather than "0 plus whatever
        // padding was on it," and the padded content wrapper inside
        // simply gets clipped by this element's own overflow instead.
        className={`flex min-w-0 flex-shrink-0 overflow-hidden bg-white/95 backdrop-blur-sm ${width > 0 ? "shadow-md" : ""}`}
      >
        <div className="flex w-full flex-col gap-3 overflow-y-auto py-3 pl-2 pr-3">
          {children}
        </div>
      </aside>
    </div>
  );
}
