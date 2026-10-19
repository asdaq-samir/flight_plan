import { useRef, useState } from "react";
import { Check, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "cn";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
import type { ProcedureList, ProcedureSummary } from "../../../lib/api/types";
import { runwayNumber } from "../../../lib/pattern";
import type { PickedProcedure } from "../../../lib/procedures";
import { TEXT } from "../../../lib/text";

type Kind = ProcedureSummary["kind"];

const TITLE: Record<Kind, string> = { approach: "Approach", arrival: "Arrival", departure: "Departure" };
const ALL: Record<Kind, string> = { approach: "All approaches…", arrival: "All arrivals…", departure: "All departures…" };
const NONE: Record<Kind, string> = { approach: "No approach", arrival: "No arrival", departure: "No departure" };

/** A transition as a pilot picks it: an approach's from its initial fix
 *  or from vectors to final; an arrival's from where it starts, or its
 *  common route alone; a departure's to where it ends. */
function transitionName(kind: Kind, transition: string | null): string {
  if (transition === null) return kind === "approach" ? "Vectors to final" : "Common route";
  return kind === "departure" ? `To ${transition}` : `From ${transition}`;
}

/** An approach's name in its runway's group, the runway said by the group:
 *  "ILS RWY 09L" is "ILS", "RNAV (GPS) Y RWY 10R" is "RNAV (GPS) Y". */
function shortName(p: ProcedureSummary): string {
  return p.kind === "approach" ? p.name.replace(/\s*RWY\s*\S+$/i, "") || p.name : p.name;
}

/**
 * One kind of a field's procedures picked from a pull-down menu, at the
 * owner's pick ("B", 2026-10-19): the trigger says the one in the route,
 * and the menu lists the field's -- an approach's by runway, the runway
 * landed on (the runway chips', preselected into the wind) first and the
 * others each a page of the menu -- each with its transitions a page of
 * its own. No approach, or none of the kind, at the foot, and the field's
 * whole list (the Procedures sheet, with each one's fixes and plate)
 * after it. The list is asked for as the menu opens.
 */
export default function ProcedureMenu({ ident, kind, list, loading, picked, label, runway, windward, onOpen, onPick, onAll }: {
  ident: string;
  kind: Kind;
  /** The field's procedures, once asked for (onOpen). */
  list: ProcedureList | undefined;
  loading: boolean;
  /** The one of the kind in the route, and its name as the route's box
   *  says it. */
  picked: PickedProcedure | null;
  label: string | null;
  /** The runway landed on and the one into the wind, in a chip's form
   *  ("9L"): an approach's group first. */
  runway: string | null;
  windward: string | null;
  onOpen: () => void;
  onPick: (next: { id: string; transition: string | null } | null) => void;
  onAll: () => void;
}) {
  const all = (list?.procedures ?? []).filter(p => p.kind === kind);
  // The whole list opens a sheet of its own: focus not handed back to the
  // trigger as the menu closes, which the sheet took for a tap outside it
  // and closed (the desktop's popover).
  const toSheet = useRef(false);
  // A runway's approaches and a procedure's transitions are pages of the
  // menu itself, pushed in its place with a back row at their head, as an
  // iOS menu opens a submenu in place: side by side they ran off a
  // phone's screen (the owner's screenshot, 2026-10-19).
  const [pages, setPages] = useState<Page[]>([]);
  const page = pages.at(-1) ?? null;
  const push = (next: Page) => (event: Event) => { event.preventDefault(); setPages([...pages, next]); };
  const back = (event: Event) => { event.preventDefault(); setPages(pages.slice(0, -1)); };
  const runwayName = (r: string) => (r === "Circling" ? "Circling" : `Runway ${r}${r === windward ? " · into the wind" : ""}`);
  const item = (p: ProcedureSummary, name: string) => {
    const on = picked?.id === p.id;
    // Its transitions a page where it has any; else picked at a tap.
    return p.transitions.length === 0 ? (
      <DropdownMenuItem key={p.id} onSelect={() => onPick({ id: p.id, transition: null })} data-testid="procedure-menu-item">
        <Mark on={on} />{name}
      </DropdownMenuItem>
    ) : (
      <DropdownMenuItem key={p.id} onSelect={push({ procedure: p, name })} data-testid="procedure-menu-item">
        <Mark on={on} /><span className="flex-1">{name}</span><ChevronRight className="size-4 text-muted-foreground" aria-hidden />
      </DropdownMenuItem>
    );
  };
  // An approach's by runway: the runway landed on first, open; the rest a
  // page each, in the runways' order; one circling only under Circling.
  const byRunway = new Map<string, ProcedureSummary[]>();
  for (const p of all) {
    const key = p.runway ? runwayNumber(p.runway) : "Circling";
    byRunway.set(key, [...(byRunway.get(key) ?? []), p]);
  }
  const first = kind === "approach"
    ? [runway, windward, ...byRunway.keys()].find(r => r !== null && byRunway.has(r)) ?? null : null;
  const others = [...byRunway.keys()].filter(r => r !== first).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const head = (title: string) => (
    <>
      <DropdownMenuItem onSelect={back} className="text-tint" data-testid="procedure-menu-back">
        <ChevronLeft className="size-4" aria-hidden />Back
      </DropdownMenuItem>
      <DropdownMenuLabel className={cn("text-muted-foreground", TEXT.note)}>{title}</DropdownMenuLabel>
    </>
  );
  return (
    <DropdownMenu onOpenChange={open => { if (open) onOpen(); else setPages([]); }}>
      <DropdownMenuTrigger asChild>
        {/* One line, at the owner's ask: "Select Approach" until one is
            picked, then the one picked, in the tint as what is tapped. */}
        <button
          type="button" data-testid="procedure-kind" data-kind={kind}
          className={cn(
            "flex min-h-11 min-w-0 items-center justify-between gap-1 rounded-xl border bg-card px-3 text-left font-semibold text-tint outline-none focus-visible:ring-2 focus-visible:ring-ring",
            TEXT.detail,
          )}
          aria-label={`${ident} ${TITLE[kind].toLowerCase()}: ${label ?? "none picked"}`}
        >
          <span className="truncate">{label ?? `Select ${TITLE[kind]}`}</span>
          <ChevronDown className="size-4 shrink-0" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start" collisionPadding={12} className="w-[min(16rem,calc(100vw-1.5rem))]" data-testid="procedure-menu"
        onCloseAutoFocus={event => { if (toSheet.current) event.preventDefault(); toSheet.current = false; }}
      >
        {page && "procedure" in page ? (
          <>
            {head(page.name)}
            {[null, ...page.procedure.transitions].map(t => (
              <DropdownMenuItem key={t ?? "-"} onSelect={() => onPick({ id: page.procedure.id, transition: t })} data-testid="procedure-menu-transition">
                <Mark on={picked?.id === page.procedure.id && (picked.transition ?? null) === t} />{transitionName(kind, t)}
              </DropdownMenuItem>
            ))}
          </>
        ) : page ? (
          <>
            {head(runwayName(page.runway))}
            {(byRunway.get(page.runway) ?? []).map(p => item(p, shortName(p)))}
          </>
        ) : (
          <>
            {loading && all.length === 0 && <DropdownMenuItem disabled>Looking them up…</DropdownMenuItem>}
            {!loading && all.length === 0 && <DropdownMenuItem disabled>None published</DropdownMenuItem>}
            {kind === "approach" && first !== null && (
              <>
                <DropdownMenuLabel className={cn("text-muted-foreground", TEXT.note)}>{runwayName(first)}</DropdownMenuLabel>
                {byRunway.get(first)!.map(p => item(p, shortName(p)))}
                {others.length > 0 && <DropdownMenuSeparator />}
                {others.map(r => (
                  <DropdownMenuItem key={r} onSelect={push({ runway: r })} data-testid="procedure-menu-runway">
                    <Mark on={byRunway.get(r)!.some(p => p.id === picked?.id)} />
                    <span className="flex-1">{runwayName(r)}</span><ChevronRight className="size-4 text-muted-foreground" aria-hidden />
                  </DropdownMenuItem>
                ))}
              </>
            )}
            {kind !== "approach" && all.map(p => item(p, p.name))}
            <DropdownMenuSeparator />
            {picked && <DropdownMenuItem onSelect={() => onPick(null)} data-testid="procedure-menu-none">{NONE[kind]}</DropdownMenuItem>}
            <DropdownMenuItem onSelect={() => { toSheet.current = true; onAll(); }} data-testid="procedure-menu-all">{ALL[kind]}</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A page of the menu pushed in its place: a runway's approaches, or a
 *  procedure's transitions. */
type Page = { runway: string } | { procedure: ProcedureSummary; name: string };

/** The one picked, ticked; the others kept in line with it. */
function Mark({ on }: { on: boolean }) {
  return <Check className={cn("size-4 shrink-0 text-tint", !on && "invisible")} aria-hidden />;
}
