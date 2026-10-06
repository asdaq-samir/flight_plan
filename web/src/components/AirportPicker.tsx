import { useRef, useState, type ReactNode } from "react";
import { Command as CommandPrimitive } from "cmdk";
import { ChevronsUpDown, Diamond, History, Search, X } from "lucide-react";
import { cn } from "cn";
import { TEXT } from "../lib/text";
import { Button } from "./ui/button";
import IconButton from "./IconButton";
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from "./ui/command";
import { FavoriteTiles } from "./Favorites";
import { usePreferences, type RecentAirport } from "../lib/preferences";
import { useOwnShip } from "../lib/map/ownShip";
import { ResponsivePopover, ResponsivePopoverContent, ResponsivePopoverTrigger } from "./ResponsivePopover";
import { useAirportSearch, type AirportSearchRow } from "../lib/useAirportSearch";
import { useIsMobile } from "../hooks/use-mobile";
import { useKeyboardInset } from "../hooks/use-viewport";

interface Props {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  ariaLabel: string;
  invalid?: boolean;
  className?: string;
  /** "pill": the ident alone, a point of a route in its box (RouteBox). */
  look?: "field" | "pill";
  testId?: string;
  /** A stop's: the VFR and GPS waypoints as well as the airports
   *  (useAirportSearch), a route flying through one. */
  fixes?: boolean;
}

/**
 * DEP or DEST as shadcn's own combobox: a button showing the ident that
 * opens a `Command` -- its search box, its list, its keyboard handling
 * (Up/Down/Enter/Escape, the highlighted row, `aria-activedescendant`)
 * all cmdk's -- with the airport lookup as the list. Typing "duluth"
 * surfaces KDLH the same as typing "KDL" would, for a pilot who does
 * not have every ident memorised; an ident the lookup does not know
 * (a private strip, say) still goes through on Enter. This replaced a
 * hand-rolled input-anchored combobox that carried its own keyboard
 * navigation and ARIA wiring; the stock shape costs one more tap and
 * gives a phone a full-width search box and rows the size of a finger
 * -- in a sheet from the navigation bar's edge there, as every panel
 * is, where it was a popover the keyboard covered half of.
 */
export default function AirportPicker({
  value, onChange, placeholder, ariaLabel, invalid, className, look = "field", testId, fixes = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const onPhone = useIsMobile();
  const keyboard = useKeyboardInset();
  // Enter takes the highlighted row only once the rows answer what is in
  // the box: it used to take it whenever there were rows, so "KD", a
  // pause, then "LH" and a quick Enter set the field to the first "KD..."
  // airport rather than KDLH.
  const { typed, rows, answered } = useAirportSearch(query, open, fixes);

  const pick = (ident: string) => {
    onChange(ident.toUpperCase());
    setOpen(false);
    setQuery("");
  };

  // Before anything is typed, what the search bar offers too: Home and
  // the favorites as tiles, and the airports picked last.
  const home = usePreferences(p => p.homeAirport);
  const favorites = usePreferences(p => p.favoriteAirports);
  const recents = usePreferences(p => p.recentAirports);
  const fix = useOwnShip(o => (o.enabled ? o.fix : null));
  const choose = (airport: RecentAirport) => {
    usePreferences.getState().addRecentAirport(airport);
    pick(airport.ident);
  };

  return (
    // From the top of a phone's screen, where the keyboard cannot come up
    // over the field: from the bottom it came up over it, field and all.
    <ResponsivePopover open={open} onOpenChange={next => { setOpen(next); if (!next) setQuery(""); }} phoneEdge="top" handleOnly>
      <ResponsivePopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel}
          aria-invalid={invalid}
          data-testid={testId}
          // A field, as a search box is: its ident in the text's colour
          // (not a button's tint) at a row's size (TEXT). A route's pill
          // in the system face, semibold, at a line under a row's (15):
          // in the monospaced face at 17 two took a phone's line, the pilot
          // asked for three.
          className={look === "pill"
            ? cn("font-semibold uppercase tracking-wide text-foreground", TEXT.detail, className)
            : cn("font-mono uppercase text-foreground", TEXT.row, !value && "text-muted-foreground", className)}
        >
          {value || placeholder}
          {look === "field" && <ChevronsUpDown className="text-muted-foreground" />}
        </Button>
      </ResponsivePopoverTrigger>
      {/* The panel's own search, as the search bar is with no route: on a
          phone a tall sheet, the field a capsule at its top, Favorites
          and Recents under it until something is typed. */}
      <ResponsivePopoverContent
        title={`${ariaLabel} airport`} titleHidden className="w-96 p-3" align="start"
        // The whole screen's height, keyboard or not, as Maps' search
        // sheet stands: sized to what was in sight above the keyboard, it
        // stayed half a card once the keyboard went (iOS does not always
        // say so). The list scrolls clear of the keyboard instead (below).
        style={onPhone ? { height: "calc(100dvh - 8px)", maxHeight: "none" } : undefined}
        // The field focused as it opens, as the search bar is on its tap:
        // the sheet's own first focus went to the sheet itself.
        onOpenAutoFocus={e => { e.preventDefault(); input.current?.focus(); }}
      >
        {/* The server already filters (an ident, a word of a name or a
            town), so cmdk's own filter is off: it would drop a row whose
            name matched but whose ident, the `value`, did not. */}
        <Command
          shouldFilter={false} className="gap-4 overflow-visible bg-transparent"
          // Room under the last row for the keyboard, so it scrolls above it.
          style={onPhone && keyboard > 0 ? { paddingBottom: keyboard } : undefined}
        >
          {/* The field, and a close beside it, as Maps' search sheet has:
              on a phone the sheet stands over nearly the whole screen. */}
          <div className="flex shrink-0 items-center gap-2">
            <div className={cn("flex h-11 min-w-0 flex-1 items-center gap-2 rounded-full bg-foreground/8 px-4 text-muted-foreground", TEXT.row)}>
              <Search className="size-5 shrink-0" aria-hidden="true" />
              <CommandPrimitive.Input
                ref={input}
                // Short enough for a phone's field, as Maps' "Search Maps"
                // is: "Search airports and waypoints" was cut at "wayp".
                // Its label says the whole of it.
                placeholder={fixes ? "Search" : `Search for a ${ariaLabel.toLowerCase()}`}
                aria-label={fixes ? "Search airports and waypoints" : `Search for a ${ariaLabel.toLowerCase()}`}
                value={query}
                onValueChange={setQuery}
                className="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground"
                onKeyDown={e => {
                  // What was typed goes through when the rows are not the
                  // answer to it yet, and when the lookup has nothing for it
                  // (a private strip, say).
                  if (e.key === "Enter" && typed && !(answered && rows.length > 0)) {
                    e.preventDefault();
                    pick(typed);
                  }
                }}
              />
            </div>
            <IconButton label="Close" variant="secondary" className="rounded-full" onClick={() => { setOpen(false); setQuery(""); }} data-testid="picker-close">
              <X />
            </IconButton>
          </div>
          {/* Its own height, not shrunk: with the keyboard up the sheet is
              short, and the tiles were squeezed to a sliver of their tops. */}
          {!typed && (home || favorites.length > 0) && (
            <div className="shrink-0">
              <FavoriteTiles home={home} favorites={favorites} from={fix} onOpen={choose} />
            </div>
          )}
          {/* Dimmed while they answer something older than the box. */}
          <CommandList className={cn("max-h-none overflow-visible", typed && !answered && "opacity-60")} aria-busy={!answered}>
            {typed && <CommandEmpty>No {fixes ? "airport or waypoint" : "airport"} matches; Enter keeps what you typed.</CommandEmpty>}
            {!typed && recents.length > 0 && (
              <PickerGroup heading="Recents">
                {recents.map(a => <AirportRow key={a.ident} airport={a} recent onSelect={() => choose(a)} />)}
              </PickerGroup>
            )}
            {!typed && recents.length === 0 && !home && favorites.length === 0 && (
              <p className={cn("px-1 text-muted-foreground", TEXT.note)}>Search by an airport's ident, its name or its town.</p>
            )}
            <SearchRows rows={rows} onAirport={choose} onWaypoint={pick} />
          </CommandList>
        </Command>
      </ResponsivePopoverContent>
    </ResponsivePopover>
  );
}

/** A group's heading as a grouped list's is (GroupedList): 13, semibold,
 *  in small capitals. */
export function PickerGroup({ heading, children }: { heading: string; children: ReactNode }) {
  return <CommandGroup heading={heading} className={GROUP}>{children}</CommandGroup>;
}

const GROUP = "p-0 **:[[cmdk-group-heading]]:px-1 **:[[cmdk-group-heading]]:pb-1.5 **:[[cmdk-group-heading]]:font-semibold **:[[cmdk-group-heading]]:uppercase **:[[cmdk-group-heading]]:tracking-wide **:[[cmdk-group-heading]]:text-xs pointer-coarse:**:[[cmdk-group-heading]]:text-[0.8125rem]";

/** What a search answers, as the picker lists it and the route box's
 *  suggestions do: the airports, then a stop's waypoints -- flown
 *  through, not kept among the recent airports. */
export function SearchRows({ rows, onAirport, onWaypoint }: {
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

/** One airport in the picker's list, as a row of the search bar's: its
 *  ident and name, its town under them -- or a waypoint, with the
 *  magenta diamond the map marks one with, its kind and its state. */
export function AirportRow({ airport, recent = false, waypoint = false, onSelect, testId }: {
  airport: RecentAirport; recent?: boolean; waypoint?: boolean; onSelect: () => void; testId?: string;
}) {
  return (
    <CommandItem value={airport.ident} onSelect={onSelect} className="min-h-11 gap-3 rounded-lg px-2 py-2" data-testid={testId}>
      {/* Its magenta as fill and stroke, not the text colour: a row's
          highlight recolours its icons' text, and the diamond went black. */}
      {waypoint ? <Diamond className="size-5 fill-[#b02e7c] stroke-[#b02e7c] dark:fill-[#e070b0] dark:stroke-[#e070b0]" />
        : recent ? <History className="size-5 text-muted-foreground" /> : <Search className="size-5 text-muted-foreground" />}
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate", TEXT.row)}><span className="font-mono font-semibold">{airport.ident}</span> · {airport.name}</span>
        {airport.municipality && <span className={cn("block truncate text-muted-foreground", TEXT.detail)}>{airport.municipality}</span>}
      </span>
    </CommandItem>
  );
}
