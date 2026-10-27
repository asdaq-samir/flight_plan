import { cn } from "cn";
import { STOP_KINDS, type StopKind } from "../lib/stopKinds";

/**
 * A kind of stop's round mark -- fuel's pump, food's fork and knife,
 * repair's wrench, training's mortarboard -- white on the kind's colour,
 * as the map's pins wear it (lib/stopKinds): the Stops sheet's pills and
 * lines and the Airport tab's Find Nearby tiles: 20 points unless the
 * caller sizes it, the glyph a little over half of it. The kind is said
 * by the words beside it.
 */
export default function StopKindGlyph({ kind, className }: { kind: StopKind; className?: string }) {
  const { colour, paths } = STOP_KINDS[kind];
  return (
    <span aria-hidden="true" className={cn("grid size-5 shrink-0 place-items-center rounded-full", className)} style={{ background: colour }}>
      <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" className="size-[58%]">
        {paths.map(d => <path key={d} d={d} />)}
      </svg>
    </span>
  );
}
