import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "cn";
import { Button } from "../../components/ui/button";
import type { Frequency } from "../../lib/api/types";
import { clockTime, duration } from "../../lib/clock";
import { ctafOf, frequencyOf, mhzText } from "../../lib/frequencies";
import type { BriefGlance, FieldGlance } from "../../lib/glance";
import { airportQuery } from "../../lib/queryClient";
import { TEXT } from "../../lib/text";
import { isLegPoint, legOf, rowPoint, type NavLogRow } from "../plan/components/navlog/rows";
import { STRIP_CARD } from "./StripHead";
import { INK } from "./stripData";

/** A chip on a card: the tint's words in a capsule of its wash, 32 tall
 *  with its 44-point area (gap-2 keeps the areas apart). */
const CHIP = cn("relative h-8 shrink-0 rounded-full border-0 bg-tint/12 px-3 font-semibold text-tint after:absolute after:-inset-y-1.5 after:inset-x-0 after:content-['']", TEXT.detail);

/** The timeline's column: the line at the left, 4 points of magenta, each
 *  entry's dot on it. */
const LINE = "absolute top-0 bottom-0 left-[7px] w-1";
/** More checkpoints than this fold in the middle, the first and the
 *  last kept (the canvas's "N more checkpoints"). */
const SHOWN = 6;
const FIRST = 3;
const LAST = 2;

/** The frequency chips a field's card offers: its ATIS (or AWOS/ASOS),
 *  its tower or CTAF. Each a tap into the field's card. */
function radioChips(frequencies: Frequency[] | undefined, towered: boolean | undefined): { label: string; words: string }[] {
  if (!frequencies) return [];
  const out: { label: string; words: string }[] = [];
  const atis = frequencyOf(frequencies, "ATIS") ?? frequencyOf(frequencies, "AWOS", "ASOS");
  if (atis?.frequency_mhz != null) out.push({ label: (atis.type ?? "ATIS").toUpperCase(), words: `${(atis.type ?? "ATIS").toUpperCase()} ${mhzText(atis.frequency_mhz)}` });
  const tower = towered ? frequencyOf(frequencies, "TWR") : null;
  if (tower?.frequency_mhz != null) out.push({ label: "TOWER", words: `Tower ${mhzText(tower.frequency_mhz)}` });
  else {
    const ctaf = ctafOf(frequencies);
    if (ctaf?.frequency_mhz != null) out.push({ label: "CTAF", words: `CTAF ${mhzText(ctaf.frequency_mhz)}` });
  }
  return out;
}

/** The field's weather in a line: its category and the wind reported,
 *  as the glance has them (lib/glance). */
const weatherLine = (field: FieldGlance | null | undefined) =>
  field ? [field.category, field.wind && `wind ${field.wind}`].filter(Boolean).join(" · ") || null : null;

/** A dot on the line, in a field's green or a checkpoint's brown. */
function Dot({ field }: { field: boolean }) {
  return (
    <span
      aria-hidden="true" className={cn("absolute left-0 rounded-full ring-4 ring-[var(--sheet,white)]", field ? "top-4 size-[18px]" : "top-[15px] size-3.5 left-[2px]")}
      style={{ background: field ? INK.field : INK.brown }}
    />
  );
}

/** A field's card on the line: its ident and name, the time there, the
 *  runway and wind, its chips. The ident is the way into its card. */
function FieldCard({ ident, name, at, atLabel, detail, chips, testId, onOpen }: {
  ident: string;
  name: string;
  at: string | null;
  atLabel: string;
  detail: (string | null)[];
  chips: { label: string; words: string; onTap: () => void; testId: string }[];
  testId: string;
  onOpen: () => void;
}) {
  return (
    <li className="relative pl-8" data-testid={testId}>
      <Dot field />
      <div className={cn("flex flex-col gap-2 p-3.5", STRIP_CARD)}>
        <div className="flex items-start gap-2">
          <button
            type="button" onClick={onOpen} data-testid={`${testId}-open`}
            className="relative min-w-0 flex-1 text-left outline-none after:absolute after:-inset-y-2 after:inset-x-0 after:content-[''] focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className={cn("font-bold text-tint", TEXT.row)}>{ident}</span>
            {name && <span className={cn("block truncate text-muted-foreground", TEXT.detail)}>{name}</span>}
          </button>
          {at && (
            <span className="shrink-0 text-right">
              <span className={cn("block font-semibold tabular-nums", TEXT.row)} data-testid={`${testId}-time`}>{at}</span>
              <span className={cn("block text-muted-foreground", TEXT.note)}>{atLabel}</span>
            </span>
          )}
        </div>
        {detail.some(Boolean) && (
          <p className={cn("text-foreground/80", TEXT.detail)} data-testid={`${testId}-detail`}>{detail.filter(Boolean).join(" · ")}</p>
        )}
        {chips.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {chips.map(c => (
              <Button key={c.label} variant="secondary" size="sm" className={CHIP} onClick={c.onTap} data-testid={c.testId} aria-label={c.words}>
                {c.label}
              </Button>
            ))}
          </div>
        )}
      </div>
    </li>
  );
}

/**
 * The strip's timeline: the departure's card, each checkpoint a row --
 * its name, "MH 318 · 24 NM", the leg's minutes at the right -- a stop's
 * card, and the destination's, on one magenta line; the middle folded
 * where there are more than six checkpoints. The rows and cards are the
 * nav log's own (navlog/rows), a row opening the leg in the nav log.
 */
export default function StripList({ rows, depart, glance, onField, onPlates, onClearance, onCheckpoint, after }: {
  rows: NavLogRow[];
  /** The departure as an ISO instant, or "" for about now. */
  depart: string;
  glance: BriefGlance | null;
  onField: (ident: string) => void;
  onPlates: (ident: string) => void;
  onClearance: () => void;
  onCheckpoint: (lat: number, lon: number) => void;
  /** After the destination: the debrief, once a track is flown. */
  after?: ReactNode;
}) {
  const [unfolded, setUnfolded] = useState(false);
  const first = rows[0];
  const last = rows.at(-1);
  const depIdent = first?.kind === "departure" ? first.airport.ident : "";
  const destIdent = last && last.kind === "destination" ? last.airport.ident : "";
  // The fields' cards, which the route's rows and the map's chips share
  // (airportQuery): the frequencies for the chips.
  const { data: depCard } = useQuery({ ...airportQuery(depIdent), enabled: !!depIdent });
  const { data: destCard } = useQuery({ ...airportQuery(destIdent), enabled: !!destIdent && destIdent !== depIdent });
  if (!first || !last || first.kind !== "departure") return null;
  const leaveAt = depart ? new Date(depart) : new Date();
  const timeAt = (minutes: number | null) => (minutes === null ? null : clockTime(new Date(leaveAt.getTime() + minutes * 60_000)));
  const middle = rows.slice(1, -1).filter(r => !isLegPoint(r));
  const checkpoints = middle.filter(r => r.kind === "checkpoint").length;
  const folded = !unfolded && checkpoints > SHOWN;
  const shown = folded ? [...middle.slice(0, FIRST), null, ...middle.slice(-LAST)] : middle;
  const hidden = folded ? middle.length - FIRST - LAST : 0;
  // Each checkpoint's number as the log counts them, whatever is folded.
  const numbers = new Map(middle.filter(r => r.kind === "checkpoint").map((r, n) => [r.key, n + 1] as const));
  const fieldChips = (ident: string, card: typeof depCard, clearance: boolean, plates: boolean) => [
    ...radioChips(card?.frequencies, card?.towered).map(c => ({ ...c, onTap: () => onField(ident), testId: `strip-chip-${c.label.toLowerCase()}` })),
    ...(clearance ? [{ label: "CLEARANCE", words: "The clearance card", onTap: onClearance, testId: "strip-chip-clearance" }] : []),
    ...(plates ? [{ label: "PLATES", words: "The approach plates", onTap: () => onPlates(ident), testId: "strip-chip-plates" }] : []),
  ];
  return (
    <section aria-label="The route in order" data-testid="strip-list">
      <ol className="relative flex flex-col gap-2">
        <div className={cn(LINE, "rounded-full")} style={{ background: INK.magenta }} aria-hidden="true" />
        <FieldCard
          ident={first.airport.ident} name={first.airport.name} at={timeAt(first.minutesFlown)} atLabel="leaving" testId="strip-departure"
          detail={[glance?.depart?.runway ? `Runway ${glance.depart.runway}` : null, glance?.depart?.wind ? `wind ${glance.depart.wind}` : null]}
          chips={fieldChips(first.airport.ident, depCard, true, false)} onOpen={() => onField(first.airport.ident)}
        />
        {shown.map(row => {
          if (row === null) {
            return (
              <li key="fold" className="relative pl-8" data-testid="strip-fold">
                <span aria-hidden="true" className="absolute top-[13px] left-[5px] size-2 rounded-full bg-[var(--sheet,white)] ring-2 ring-current" style={{ color: INK.brown }} />
                <button
                  type="button" onClick={() => setUnfolded(true)} data-testid="strip-fold-open"
                  className={cn("relative flex min-h-11 w-full items-center px-1 text-left font-semibold text-tint outline-none focus-visible:ring-2 focus-visible:ring-ring", TEXT.row)}
                >
                  {hidden} more checkpoints
                </button>
              </li>
            );
          }
          if (row.kind === "stop") {
            const stopCard = row.airport.ident === depIdent ? depCard : row.airport.ident === destIdent ? destCard : undefined;
            return (
              <FieldCard
                key={row.key} ident={row.airport.ident} name={row.airport.name} at={timeAt(row.minutesFlown)} atLabel="ETA" testId="strip-stop"
                detail={[row.groundMin ? `${duration(row.groundMin)} on the ground` : null]}
                chips={fieldChips(row.airport.ident, stopCard, false, false)} onOpen={() => onField(row.airport.ident)}
              />
            );
          }
          if (row.kind !== "checkpoint") return null;
          const leg = legOf(row);
          const point = rowPoint(row);
          const figures = leg ? `MH ${String(Math.round(leg.magnetic_heading_deg)).padStart(3, "0")} · ${leg.distance_nm.toFixed(0)} NM` : null;
          return (
            <li key={row.key} className="relative pl-8" data-testid="strip-checkpoint">
              <Dot field={false} />
              <button
                type="button" onClick={() => onCheckpoint(point.lat, point.lon)} data-testid="strip-checkpoint-open"
                className="flex min-h-11 w-full items-center gap-3 px-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="min-w-0 flex-1">
                  <span className={cn("block truncate font-medium", TEXT.row)}>{numbers.get(row.key)}. {point.name}</span>
                  {figures && <span className={cn("block text-muted-foreground", TEXT.note)}>{figures}</span>}
                </span>
                {leg?.ete_min != null && <span className={cn("shrink-0 tabular-nums text-muted-foreground", TEXT.detail)}>{duration(leg.ete_min)}</span>}
              </button>
            </li>
          );
        })}
        {last.kind === "destination" && (

          <FieldCard
            ident={last.airport.ident} name={last.airport.name} at={timeAt(last.minutesFlown)} atLabel="ETA" testId="strip-destination"
            detail={[weatherLine(glance?.arrive) && `At ETA ${weatherLine(glance?.arrive)}`, glance?.arrive?.runway ? `Runway ${glance.arrive.runway}` : null]}
            chips={fieldChips(last.airport.ident, destCard, false, true)} onOpen={() => onField(last.airport.ident)}
          />
        )}
      </ol>
      {after}
    </section>
  );
}
