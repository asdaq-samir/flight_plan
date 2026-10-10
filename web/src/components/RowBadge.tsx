import type { ReactNode } from "react";
import { FileText } from "lucide-react";
import { BADGE } from "../lib/rowBadges";

/**
 * A row's glyph on a rounded square of its own colour, as iOS's Settings
 * and Maps lead a row with one: a card's rows -- a field's frequencies,
 * its weather and runways, its charts, the airspace over a point -- each
 * said by its kind at a glance, as Nearest's rows lead with the field's
 * mark (the pilot liked those, and asked for every card to read so).
 * White on the colour in light and dark alike; the glyph's meaning is
 * also in the row's words.
 */
export function RowBadge({ colour, children }: { colour: string; children: ReactNode }) {
  return (
    <span
      aria-hidden="true"
      className="grid size-7 shrink-0 place-items-center rounded-[7px] text-white [&_svg]:size-[18px]"
      style={{ backgroundColor: colour }}
    >
      {children}
    </span>
  );
}

/** A chart's badge: the FAA's charts and the Chart Supplement, on every
 *  card that lists them. */
export function ChartBadge() {
  return <RowBadge colour={BADGE.chart}><FileText /></RowBadge>;
}
