import { useRef } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "cn";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
  DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
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
 * others each a submenu -- each with its transitions a submenu of its
 * own. No approach, or none of the kind, at the foot, and the field's
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
  const item = (p: ProcedureSummary, name: string) => {
    const on = picked?.id === p.id;
    // Its transitions a submenu where it has any; else picked at a tap.
    if (p.transitions.length === 0) {
      return (
        <DropdownMenuItem key={p.id} onSelect={() => onPick({ id: p.id, transition: null })} data-testid="procedure-menu-item">
          <Mark on={on} />{name}
        </DropdownMenuItem>
      );
    }
    return (
      <DropdownMenuSub key={p.id}>
        <DropdownMenuSubTrigger data-testid="procedure-menu-item"><Mark on={on} />{name}</DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="w-56">
          {[null, ...p.transitions].map(t => (
            <DropdownMenuItem key={t ?? "-"} onSelect={() => onPick({ id: p.id, transition: t })} data-testid="procedure-menu-transition">
              <Mark on={on && (picked?.transition ?? null) === t} />{transitionName(kind, t)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    );
  };
  // An approach's by runway: the runway landed on first, open; the rest a
  // submenu each, in the runways' order; one circling only under Circling.
  const byRunway = new Map<string, ProcedureSummary[]>();
  for (const p of all) {
    const key = p.runway ? runwayNumber(p.runway) : "Circling";
    byRunway.set(key, [...(byRunway.get(key) ?? []), p]);
  }
  const first = kind === "approach"
    ? [runway, windward, ...byRunway.keys()].find(r => r !== null && byRunway.has(r)) ?? null : null;
  const others = [...byRunway.keys()].filter(r => r !== first).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return (
    <DropdownMenu onOpenChange={open => { if (open) onOpen(); }}>
      <DropdownMenuTrigger asChild>
        <button
          type="button" data-testid="procedure-kind"
          className="flex min-w-0 flex-col items-start gap-0.5 rounded-xl border bg-card px-3 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`${ident} ${TITLE[kind].toLowerCase()}: ${label ?? "none"}`}
        >
          <span className={cn("text-muted-foreground", TEXT.note)}>{TITLE[kind]}</span>
          <span className={cn("flex max-w-full items-center gap-1 font-semibold", label ? "text-tint" : "text-muted-foreground", TEXT.detail)}>
            <span className="truncate">{label ?? "None"}</span>
            <ChevronDown className="size-4 shrink-0" aria-hidden />
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start" className="w-64" data-testid="procedure-menu"
        onCloseAutoFocus={event => { if (toSheet.current) event.preventDefault(); toSheet.current = false; }}
      >
        {loading && all.length === 0 && <DropdownMenuItem disabled>Looking them up…</DropdownMenuItem>}
        {!loading && all.length === 0 && <DropdownMenuItem disabled>None published</DropdownMenuItem>}
        {kind === "approach" && first !== null && (
          <>
            <DropdownMenuLabel className={cn("text-muted-foreground", TEXT.note)}>
              {first === "Circling" ? "Circling" : `Runway ${first}${first === windward ? " · into the wind" : ""}`}
            </DropdownMenuLabel>
            {byRunway.get(first)!.map(p => item(p, shortName(p)))}
            {others.length > 0 && <DropdownMenuSeparator />}
            {others.map(r => (
              <DropdownMenuSub key={r}>
                <DropdownMenuSubTrigger data-testid="procedure-menu-runway">
                  <Mark on={byRunway.get(r)!.some(p => p.id === picked?.id)} />
                  {r === "Circling" ? "Circling" : `Runway ${r}${r === windward ? " · into the wind" : ""}`}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-56">{byRunway.get(r)!.map(p => item(p, shortName(p)))}</DropdownMenuSubContent>
              </DropdownMenuSub>
            ))}
          </>
        )}
        {kind !== "approach" && all.map(p => item(p, p.name))}
        <DropdownMenuSeparator />
        {picked && <DropdownMenuItem onSelect={() => onPick(null)} data-testid="procedure-menu-none">{NONE[kind]}</DropdownMenuItem>}
        <DropdownMenuItem onSelect={() => { toSheet.current = true; onAll(); }} data-testid="procedure-menu-all">{ALL[kind]}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The one picked, ticked; the others kept in line with it. */
function Mark({ on }: { on: boolean }) {
  return <Check className={cn("size-4 shrink-0 text-tint", !on && "invisible")} aria-hidden />;
}
