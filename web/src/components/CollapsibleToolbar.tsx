import { useEffect, useRef, useState, type ReactNode } from "react";
import PullTab from "./PullTab";
import { useDragHandle } from "../lib/useDragHandle";

// Below this there's no real room to show content -- the handle's own
// label takes over instead of a drawer too short to read. Same value
// and the same reasoning as the sidebar's own `LABEL_AT`: once dragged
// open past it, the drawer itself communicates what it is and the
// label becomes redundant, so it drops out rather than crowding a tab
// that's already showing real content underneath it.
const LABEL_AT = 40;
// The toolbar's own permanently-visible footprint when its drawer is
// fully collapsed: the title bar plus the tab row below it. A page's
// own floating status needs to clear this even at height 0, not just
// once the drawer's been dragged open -- exported so that's one
// number every caller reads off this component instead of each
// keeping its own guessed copy.
export const TOOLBAR_COLLAPSED_FOOTPRINT = 64;

interface Props {
  /** What the handle says -- each page names its own settings. */
  label: string;
  /** Shown above the drawer at all times, collapsed or open -- the
   *  page's own name ("VFR planner"). Dragging only ever hides
   *  `children`, never this. */
  title?: ReactNode;
  children: ReactNode;
  /** Fired whenever the dragged height changes -- purely a report,
   *  not control: height stays this component's own state. The status
   *  popup sits right below this drawer and needs to know how far
   *  down it's been pulled so it can follow, not get covered as the
   *  drawer opens over it. */
  onHeightChange?: (height: number) => void;
}

/**
 * The toolbar's own settings drawer: drag the handle down to reveal
 * more, up to reveal less, continuously (`useDragHandle`) -- one
 * height value, not an open/closed boolean with its own snap-to-
 * collapse threshold and a separate click-to-toggle path. That
 * discrete state swap (a whole different element past a threshold) is
 * what made dragging feel like it jumped partway through instead of
 * following the finger. Always starts collapsed, on a reload as much
 * as a first load; there's nothing to click either way, only drag.
 * `title`, if given, sits above the drawer and never collapses with
 * it -- dragging only ever hides `children`.
 */
export default function CollapsibleToolbar({ label, title, children, onHeightChange }: Props) {
  const content = useRef<HTMLDivElement>(null);
  // The most this can be dragged open is however tall the content
  // actually is, not a fixed number both pages shared regardless of
  // how much each one actually holds -- the planner's route form is
  // shorter than the label page's route-and-view form, and dragging
  // past the last real row should be impossible, not just pointless.
  // Measured off the content wrapper itself (never clipped -- only the
  // `height`-driven ancestor around it is), so it stays right even as
  // the content wraps differently at another viewport width.
  const [maxHeight, setMaxHeight] = useState(0);

  useEffect(() => {
    const el = content.current;
    if (!el) return;
    const measure = () => setMaxHeight(el.scrollHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Dragging down opens this further -- the ordinary sign, since this
  // drawer is anchored to the top and grows downward.
  const { size: height, startDrag, onKeyDown } = useDragHandle({ axis: "y", sign: 1, maxSize: maxHeight });

  useEffect(() => { onHeightChange?.(height); }, [height, onHeightChange]);

  return (
    // Floats directly over the map (absolute, full width, pinned to
    // the top) rather than taking its own row out of the layout -- the
    // content comes first, the tab after, not the other way around, so
    // it still sits at the actual moving boundary (pushed down as the
    // content above it grows) the same way it did as a flex sibling.
    // A translucent, blurred backdrop on the content is what a
    // panel needs once there's a sectional chart under it instead of
    // plain white.
    <div className="absolute inset-x-0 top-0 z-[900]">
      {title && (
        <div className="bg-white/95 px-3 pt-1 text-lg font-bold tracking-tight text-slate-900 backdrop-blur-sm">
          {title}
        </div>
      )}
      <div
        style={{ height }}
        data-testid="toolbar-content"
        className={`overflow-x-hidden overflow-y-auto bg-white/95 backdrop-blur-sm ${height > 0 ? "shadow-md" : ""}`}
      >
        <div ref={content} className="space-y-2 px-3 pb-2 pt-1">
          {children}
        </div>
      </div>
      {/* No background strip -- the bare tab on white is the look this
          had originally and the one to keep. Feedback on press is the
          tab dimming (`group-hover`/`group-active` opacity), not a
          background tint appearing around it. w-fit on the inner
          wrapper, and the hit target inset-0 against it rather than
          past it: only the tab itself is draggable, the same as every
          other pull-tab handle in this app -- the space beside it is
          ordinary, unrelated space, not a hidden extension of the
          drag target. */}
      <div className="flex flex-shrink-0 items-center justify-center py-1">
        <div className="group relative w-fit">
          <div className="pointer-events-none transition-opacity group-hover:opacity-90 group-active:opacity-75">
            <PullTab orientation="horizontal">
              {height < LABEL_AT && (
                <span className="text-xs text-slate-500">{label}</span>
              )}
            </PullTab>
          </div>
          <div
            onPointerDown={startDrag}
            onKeyDown={onKeyDown}
            role="slider"
            tabIndex={0}
            aria-label={`Resize the ${label} drawer`}
            aria-orientation="vertical"
            aria-valuemin={0}
            aria-valuemax={maxHeight}
            aria-valuenow={height}
            title="Drag or use arrow keys to resize"
            data-testid="toolbar-handle"
            className="absolute inset-0 z-10 cursor-row-resize touch-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-slate-500"
          />
        </div>
      </div>
    </div>
  );
}
