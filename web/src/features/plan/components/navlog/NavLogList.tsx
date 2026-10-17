import { Fragment, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "cn";
import { placeName } from "../../../../lib/radio";
import { TEXT } from "../../../../lib/text";
import { altFt, bearing, etaAt, one } from "../../format";
import { PointMark } from "./PointMark";
import { isLegPoint, legOf, rowPoint, type NavLogRow } from "./rows";

/** The rail's middle, across the row: the row's own 6 and half the
 *  mark's column (2.125 rem). */
const RAIL = "left-[calc(0.375rem+1.0625rem)]";
/** A mark's middle, down the row: the row's 8 and half a mark's 24. */
const MARK_MIDDLE = "1.25rem";

/** The wind a leg was worked out in, as the nav log says it (true, as the
 *  forecast's winds aloft are). */
function windOf(row: NavLogRow): string | null {
  const leg = legOf(row);
  if (!leg) return null;
  return leg.wind ? `${bearing(leg.wind.wind_dir_true_deg)}/${Math.round(leg.wind.wind_speed_kt)} kt` : "no data";
}

/** What each row says beside its leg's own figures, worked out in order:
 *  the wind where it is not the leg's before (and over the first), and the
 *  altitude where it is not -- a field's elevation, a top of climb's or
 *  descent's level, a step. */
function railOf(rows: NavLogRow[]): { wind: string | null; altitude: string }[] {
  let windBefore: string | null = null;
  let altitudeBefore: number | null = null;
  return rows.map(row => {
    const wind = windOf(row);
    const changed = wind !== null && wind !== windBefore ? wind : null;
    if (wind !== null) windBefore = wind;
    const field = row.kind === "departure" || row.kind === "destination" || (row.kind === "stop" && row.airport.kind !== "fix");
    const legAltitude = isLegPoint(row) ? row.point.altitude_ft : legOf(row)?.altitude_ft ?? null;
    const altitude = field ? `field ${altFt("airport" in row ? row.airport.elevation_ft : null)} ft`
      : legAltitude !== null && (isLegPoint(row) || legAltitude !== altitudeBefore) ? `${altFt(legAltitude)} ft` : "";
    if (legAltitude !== null) altitudeBefore = legAltitude;
    return { wind: changed, altitude };
  });
}

/**
 * The nav log on screen, a line a point down a rail, at the owner's pick
 * of the redesign ("a new modern look for the navlog"): the point's mark
 * as the map draws it (PointMark) and its name, and under the name the leg
 * flown to it -- the heading to steer first, an arrow pointing it, then
 * the distance and the time -- with the clock time there and the
 * groundspeed at the line's end. The altitude only where it is not the
 * leg's before (the climb, the tops of climb and descent, a field), and
 * where the wind the legs are worked out in changes, a chip on the rail
 * says so. It was a table of four columns of the printed page's fourteen;
 * on paper it still is (NavLogView's navLogTable), and to a screen reader
 * this is a table too (its roles), a row a point.
 *
 * A row tapped, or Enter or Space on it, selects it, as a marker on the map
 * does, and opens its note under it -- the leg's working and the
 * checkpoint's description (NavLogView's `note`) -- as the table's did.
 */
export function NavLogList({ rows, label, numberOf, weather, isSelected, onSelect, onDeselect, flying, selectedRef, flyingRef, depart, note }: {
  rows: NavLogRow[];
  /** The table's name: "Navigation log from C81 to KDLH". */
  label: string;
  /** A checkpoint's number, as its dot on the map has it. */
  numberOf: (row: NavLogRow) => number | undefined;
  /** An airport's weather colour, as its chip on the map. */
  weather: (ident: string) => string | undefined;
  isSelected: (row: NavLogRow) => boolean;
  onSelect: (row: NavLogRow) => void;
  onDeselect: () => void;
  /** The row the dry run is flying to, by its place. */
  flying: number | null;
  /** The selected row and the one flown to, as they are put in the page,
   *  for NavLogView to bring into sight. */
  selectedRef: (el: HTMLElement | null) => void;
  flyingRef: (el: HTMLElement | null) => void;
  /** The departure time picked, ISO; empty for now, as the figures at the
   *  sheet's foot take it (figures.ts). */
  depart: string;
  /** What opens under a selected row. */
  note: (row: NavLogRow, selected: boolean) => ReactNode;
}) {
  const from = depart || new Date().toISOString();
  const rail = railOf(rows);
  return (
    <div role="table" aria-label={label} className="relative pt-1 pb-2" data-testid="navlog-list">
      {/* The columns' names, for a screen reader: on screen each figure is
          said by its place and its unit. */}
      <div role="rowgroup" className="sr-only">
        <div role="row">
          {["Waypoint", "Arrival time", "Magnetic heading", "Distance", "Time en route", "Altitude", "Groundspeed"].map(name => (
            <span key={name} role="columnheader">{name}</span>
          ))}
        </div>
      </div>
      <div role="rowgroup">
        {rows.map((row, at) => {
          const leg = legOf(row);
          const selected = isSelected(row);
          const first = at === 0, last = at === rows.length - 1;
          const { wind, altitude } = rail[at]!;
          const name = row.kind === "toc" ? "Top of climb" : row.kind === "tod" ? "Top of descent"
            : "airport" in row && row.airport.kind !== "fix" ? `${row.airport.ident} · ${placeName(row.airport.name, row.airport.ident)}`
              : rowPoint(row).name;
          const heading = leg ? leg.magnetic_heading_deg : null;
          const select = () => (selected ? onDeselect() : onSelect(row));
          const keys = (event: KeyboardEvent) => {
            if (event.target !== event.currentTarget) return;
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              select();
            }
          };
          const isFlying = at === flying;
          return (
            <Fragment key={row.key}>
              {wind && !first && (
                <div aria-hidden="true" className="relative flex h-7 items-center pl-[3.125rem]">
                  <span className={cn("absolute inset-y-0 w-0.5 -translate-x-1/2 bg-border", RAIL)} />
                  <span className={cn("rounded-full border border-cyan-200 bg-cyan-50 px-2 py-0.5 font-semibold text-cyan-800 dark:border-cyan-900 dark:bg-cyan-950 dark:text-cyan-200", TEXT.note)} data-testid="navlog-wind-change">
                    Wind {wind}
                  </span>
                </div>
              )}
              <div className="relative">
                {/* The rail, from the mark before to the mark after, under
                    this row's own mark. */}
                {rows.length > 1 && (
                  <span
                    aria-hidden="true" className={cn("absolute w-0.5 -translate-x-1/2 bg-border", RAIL)}
                    style={{ top: first ? MARK_MIDDLE : 0, ...(last ? { height: MARK_MIDDLE } : { bottom: 0 }) } as CSSProperties}
                  />
                )}
                <div
                  role="row" tabIndex={0} ref={selected ? selectedRef : isFlying ? flyingRef : undefined}
                  onClick={select} onKeyDown={keys}
                  data-kind={row.kind} data-selected={selected || undefined} data-flying={isFlying || undefined}
                  data-expanded={selected} aria-current={selected || undefined}
                  className={cn(
                    "relative grid cursor-pointer grid-cols-[2.125rem_minmax(0,1fr)_auto] items-start gap-x-2.5 rounded-xl px-1.5 py-2 outline-none",
                    "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
                    "hover:bg-foreground/5 focus-visible:bg-foreground/5 active:bg-foreground/8",
                    isFlying && "bg-tint/12 hover:bg-tint/12",
                    selected && "rounded-b-none bg-foreground/8 hover:bg-foreground/8 focus-visible:bg-foreground/8",
                  )}
                >
                  <span className="relative row-span-2 flex justify-center pt-0.5">
                    <PointMark row={row} number={numberOf(row)} weather={weather} />
                  </span>
                  <span role="rowheader" className={cn("min-w-0 font-medium text-foreground [overflow-wrap:anywhere]", TEXT.row)}>{name}</span>
                  <span role="cell" className={cn("text-right font-semibold text-foreground tabular-nums", TEXT.row)} data-testid="navlog-row-eta">
                    {etaAt(from, row.minutesFlown)}
                  </span>
                  {/* Grey, and the text's own colour on the selection's tint,
                      where grey fell under 4.5:1 (the iPhone audit's P15). */}
                  <span className={cn("col-start-2 tabular-nums", selected ? "text-foreground" : "text-muted-foreground", TEXT.detail, row.kind !== "departure" && leg && !leg.wind && "italic")}>
                    {row.kind === "departure" ? (
                      <>
                        <span role="cell" /><span role="cell" /><span role="cell" />
                        <span role="cell">{altitude.replace(/^field/, "Field")}</span>
                      </>
                    ) : (
                      <>
                        <span role="cell" className="font-semibold text-foreground">
                          {heading !== null && (
                            <svg
                              viewBox="0 0 16 16" aria-hidden="true"
                              className="mr-1 inline-block size-3 align-[-1px]" style={{ transform: `rotate(${Math.round(heading)}deg)` }}
                            >
                              <path d="M8 1.5 12.5 13 8 10.5 3.5 13z" fill="currentColor" />
                            </svg>
                          )}
                          {leg ? bearing(leg.magnetic_heading_deg) : "—"}
                        </span>
                        <span aria-hidden="true"> · </span>
                        <span role="cell">{leg ? `${one(leg.distance_nm)} nm` : "—"}</span>
                        <span aria-hidden="true"> · </span>
                        <span role="cell">{leg ? (leg.ete_min === null ? "unflyable" : `${one(leg.ete_min)} min`) : "—"}</span>
                        {altitude && <span aria-hidden="true"> · </span>}
                        <span role="cell">{altitude}</span>
                      </>
                    )}
                  </span>
                  <span role="cell" className={cn("text-right tabular-nums", selected ? "text-foreground" : "text-muted-foreground", TEXT.note)}>
                    {row.kind === "departure" ? "Takeoff" : leg?.groundspeed_kt != null ? `GS ${Math.round(leg.groundspeed_kt)}` : ""}
                  </span>
                </div>
                {selected && (
                  // Its note: the leg's working and the checkpoint's
                  // description, a row of its own so a tap in it does not
                  // put the row away, in the selection's tint with it.
                  // Twelve under it: the note's field reaches nine past its
                  // box for a finger (DescriptionCell's label).
                  <div role="row" className="rounded-b-xl bg-foreground/8 pr-2 pb-3 pl-[3.125rem]">
                    <div role="cell" aria-colspan={7} className={cn("text-foreground/70", TEXT.detail)}>{note(row, selected)}</div>
                  </div>
                )}
              </div>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
