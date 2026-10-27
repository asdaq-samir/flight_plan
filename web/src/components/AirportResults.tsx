import type { ReactNode } from "react";
import { Diamond, History, Search } from "lucide-react";
import { cn } from "cn";
import { TEXT } from "../lib/text";
import { CommandGroup, CommandItem, CommandList } from "./ui/command";
import type { RecentAirport } from "../lib/preferences";
import type { AirportSearchRow } from "../lib/useAirportSearch";

/**
 * What an airport search answers, as a list: the one list for every place
 * an airport or a waypoint is searched for -- the airport picker's sheet
 * (AirportPicker) and the route box's suggestions as its field is typed
 * in (RouteBox) -- so the two look and behave alike (the owner's "one
 * look, common code", 2026-10-27). Groups of the caller's own first (the
 * suggested waypoints, the pilot's own point, the recents), then the
 * search's airports and waypoints. cmdk's list, inside the caller's
 * Command, which keeps the arrows and Enter on the field being typed in.
 * Dimmed while its rows answer something older than the field.
 */
export default function AirportResults({ rows, answered, onAirport, onWaypoint, id, className, empty, children }: {
  rows: AirportSearchRow[];
  /** Whether the rows answer what is typed now. */
  answered: boolean;
  onAirport: (airport: RecentAirport) => void;
  onWaypoint: (ident: string) => void;
  /** The list's id, for a field's aria-controls. */
  id?: string;
  className?: string;
  /** What it says where the search has nothing (cmdk's CommandEmpty). */
  empty?: ReactNode;
  /** Groups before the search's (PickerGroup). */
  children?: ReactNode;
}) {
  return (
    <CommandList id={id} className={cn("max-h-none overflow-visible", !answered && "opacity-60", className)} aria-busy={!answered}>
      {empty}
      {children}
      <SearchRows rows={rows} onAirport={onAirport} onWaypoint={onWaypoint} />
    </CommandList>
  );
}

/** A group's heading as a grouped list's is (GroupedList): 13, semibold,
 *  in small capitals. */
export function PickerGroup({ heading, children }: { heading: string; children: ReactNode }) {
  return <CommandGroup heading={heading} className={GROUP}>{children}</CommandGroup>;
}

// The group's heading is cmdk's own element, reached only by its
// attribute's selector, so GROUP_HEADING's note sizes (TEXT.note, 12 and
// 13) are written out here under it.
const GROUP = "p-0 **:[[cmdk-group-heading]]:px-1 **:[[cmdk-group-heading]]:pb-1.5 **:[[cmdk-group-heading]]:font-semibold **:[[cmdk-group-heading]]:uppercase **:[[cmdk-group-heading]]:tracking-wide **:[[cmdk-group-heading]]:text-xs pointer-coarse:**:[[cmdk-group-heading]]:text-[0.8125rem]";

/** The search's own rows: the airports, then a stop's waypoints -- flown
 *  through, not kept among the recent airports. */
function SearchRows({ rows, onAirport, onWaypoint }: {
  rows: AirportSearchRow[];
  onAirport: (airport: RecentAirport) => void;
  onWaypoint: (ident: string) => void;
}) {
  const fields = rows.filter(r => r.kind !== "fix");
  const waypoints = rows.filter(r => r.kind === "fix");
  return (
    <>
      {fields.length > 0 && (
        <PickerGroup heading="Airports">
          {fields.map(r => (
            <AirportRow
              key={r.ident} airport={{ ident: r.ident, name: r.name, municipality: r.municipality }}
              onSelect={() => onAirport({ ident: r.ident, name: r.name, municipality: r.municipality })}
            />
          ))}
        </PickerGroup>
      )}
      {waypoints.length > 0 && (
        <PickerGroup heading="Waypoints">
          {waypoints.map(r => (
            <AirportRow
              key={r.ident} waypoint airport={{ ident: r.ident, name: r.name, municipality: r.region }}
              onSelect={() => onWaypoint(r.ident)}
            />
          ))}
        </PickerGroup>
      )}
    </>
  );
}

/** One airport in the list, as a row of Maps' search: its ident in bold
 *  and its name, its town under them in the grey -- or a waypoint, with
 *  the magenta diamond the map marks one with, its kind and its state. */
export function AirportRow({ airport, recent = false, waypoint = false, onSelect, testId }: {
  airport: RecentAirport; recent?: boolean; waypoint?: boolean; onSelect: () => void; testId?: string;
}) {
  return (
    // 52 at the least, as a search result's two lines are in Maps: the
    // row is the control, not a control grown to its hit area.
    <CommandItem value={airport.ident} onSelect={onSelect} className="min-h-13 gap-3 rounded-lg px-2 py-2" data-testid={testId ?? "airport-result"}>
      {/* Its magenta as fill and stroke, not the text colour: a row's
          highlight recolours its icons' text, and the diamond went black. */}
      {waypoint ? <Diamond className="size-5 fill-[#c0309f] stroke-[#c0309f] dark:fill-[#e070b0] dark:stroke-[#e070b0]" />
        : recent ? <History className="size-5 text-muted-foreground" /> : <Search className="size-5 text-muted-foreground" />}
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate", TEXT.row)}><span className="font-mono font-bold">{airport.ident}</span> · {airport.name}</span>
        {airport.municipality && <span className={cn("block truncate text-muted-foreground", TEXT.detail)}>{airport.municipality}</span>}
      </span>
    </CommandItem>
  );
}
