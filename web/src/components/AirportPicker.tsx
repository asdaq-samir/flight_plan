import { useRef, useState } from "react";
import { Command as CommandPrimitive } from "cmdk";
import { ChevronsUpDown, Flag, History, Plus, Search, X } from "lucide-react";
import { cn } from "cn";
import { TEXT } from "../lib/text";
import { Button } from "./ui/button";
import IconButton from "./IconButton";
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from "./ui/command";
import { FavoriteTiles } from "./Favorites";
import { usePreferences, type RecentAirport } from "../lib/preferences";
import { useOwnShip } from "../lib/map/ownShip";
import { ResponsivePopover, ResponsivePopoverContent, ResponsivePopoverTrigger } from "./ResponsivePopover";
import { useAirportSearch } from "../lib/useAirportSearch";
import { useIsMobile } from "../hooks/use-mobile";
import { useVisualHeight } from "../hooks/use-viewport";

interface Props {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  ariaLabel: string;
  invalid?: boolean;
  className?: string;
  /** "add": a plus and the placeholder in the tint, no chevrons -- a stop
   *  to add (StopsBar), not a field to change. */
  look?: "field" | "add";
  /** Open from elsewhere: a problem's Add a stop (PlanWorkspace). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
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
  value, onChange, placeholder, ariaLabel, invalid, className, look = "field", open: openFrom, onOpenChange, testId,
  fixes = false,
}: Props) {
  const [ownOpen, setOwnOpen] = useState(false);
  const open = openFrom ?? ownOpen;
  const setOpen = (next: boolean) => { setOwnOpen(next); onOpenChange?.(next); };
  const [query, setQuery] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const onPhone = useIsMobile();
  const visualHeight = useVisualHeight();
  // Enter takes the highlighted row only once the rows answer what is in
  // the box: it used to take it whenever there were rows, so "KD", a
  // pause, then "LH" and a quick Enter set the field to the first "KD..."
  // airport rather than KDLH.
  const { typed, rows, answered } = useAirportSearch(query, open, fixes);
  const fields = rows.filter(r => r.kind !== "fix");
  const waypoints = rows.filter(r => r.kind === "fix");

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
    // From the top of a phone's screen, sized to what is in sight above the
    // keyboard: from the bottom the keyboard came up over it, field and all.
    <ResponsivePopover open={open} onOpenChange={next => { setOpen(next); if (!next) setQuery(""); }} phoneEdge="top">
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
          // (not a button's tint) at a row's size (TEXT); a stop to add,
          // the tint's.
          className={look === "add"
            ? cn("text-tint", TEXT.row, className)
            : cn("font-mono uppercase text-foreground", TEXT.row, !value && "text-muted-foreground", className)}
        >
          {look === "add" && <Plus />}
          {value || placeholder}
          {look === "field" && <ChevronsUpDown className="text-muted-foreground" />}
        </Button>
      </ResponsivePopoverTrigger>
      {/* The panel's own search, as the search bar is with no route: on a
          phone a tall sheet, the field a capsule at its top, Favorites
          and Recents under it until something is typed. */}
      <ResponsivePopoverContent
        title={`${ariaLabel} airport`} titleHidden className="w-96 p-3" align="start"
        style={onPhone ? { height: visualHeight - 8, maxHeight: "none" } : undefined}
        // The field focused as it opens, as the search bar is on its tap:
        // the sheet's own first focus went to the sheet itself.
        onOpenAutoFocus={e => { e.preventDefault(); input.current?.focus(); }}
      >
        {/* The server already filters (an ident, a word of a name or a
            town), so cmdk's own filter is off: it would drop a row whose
            name matched but whose ident, the `value`, did not. */}
        <Command shouldFilter={false} className="gap-4 overflow-visible bg-transparent">
          {/* The field, and a close beside it, as Maps' search sheet has:
              on a phone the sheet stands over nearly the whole screen. */}
          <div className="flex shrink-0 items-center gap-2">
            <div className={cn("flex h-11 min-w-0 flex-1 items-center gap-2 rounded-full bg-foreground/8 px-4 text-muted-foreground", TEXT.row)}>
              <Search className="size-5 shrink-0" aria-hidden="true" />
              <CommandPrimitive.Input
                ref={input}
                placeholder={fixes ? "Search airports and waypoints" : `Search for a ${ariaLabel.toLowerCase()}`}
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
          {!typed && (home || favorites.length > 0) && (
            <FavoriteTiles home={home} favorites={favorites} from={fix} onOpen={choose} />
          )}
          {/* Dimmed while they answer something older than the box. */}
          <CommandList className={cn("max-h-none overflow-visible", typed && !answered && "opacity-60")} aria-busy={!answered}>
            {typed && <CommandEmpty>No {fixes ? "airport or waypoint" : "airport"} matches; Enter keeps what you typed.</CommandEmpty>}
            {!typed && recents.length > 0 && (
              <CommandGroup heading="Recents" className={GROUP}>
                {recents.map(a => <AirportRow key={a.ident} airport={a} recent onSelect={() => choose(a)} />)}
              </CommandGroup>
            )}
            {!typed && recents.length === 0 && !home && favorites.length === 0 && (
              <p className={cn("px-1 text-muted-foreground", TEXT.note)}>Search by an airport's ident, its name or its town.</p>
            )}
            {fields.length > 0 && (
              <CommandGroup heading="Airports" className={GROUP}>
                {fields.map(r => (
                  <AirportRow
                    key={r.ident} airport={{ ident: r.ident, name: r.name, municipality: r.municipality }}
                    onSelect={() => choose({ ident: r.ident, name: r.name, municipality: r.municipality })}
                  />
                ))}
              </CommandGroup>
            )}
            {/* A stop's waypoints, after the airports: flown through, not
                kept among the recent airports. */}
            {waypoints.length > 0 && (
              <CommandGroup heading="Waypoints" className={GROUP}>
                {waypoints.map(r => (
                  <AirportRow
                    key={r.ident} waypoint airport={{ ident: r.ident, name: r.name, municipality: r.region }}
                    onSelect={() => pick(r.ident)}
                  />
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </ResponsivePopoverContent>
    </ResponsivePopover>
  );
}

/** A group's heading as a grouped list's is (GroupedList): 13, semibold,
 *  in small capitals. */
const GROUP = "p-0 **:[[cmdk-group-heading]]:px-1 **:[[cmdk-group-heading]]:pb-1.5 **:[[cmdk-group-heading]]:font-semibold **:[[cmdk-group-heading]]:uppercase **:[[cmdk-group-heading]]:tracking-wide **:[[cmdk-group-heading]]:text-xs pointer-coarse:**:[[cmdk-group-heading]]:text-[0.8125rem]";

/** One airport in the picker's list, as a row of the search bar's: its
 *  ident and name, its town under them -- or a waypoint, with the
 *  sectional's magenta flag, its kind and its state. */
function AirportRow({ airport, recent = false, waypoint = false, onSelect }: {
  airport: RecentAirport; recent?: boolean; waypoint?: boolean; onSelect: () => void;
}) {
  return (
    <CommandItem value={airport.ident} onSelect={onSelect} className="min-h-11 gap-3 rounded-lg px-2 py-2">
      {waypoint ? <Flag className="size-5 text-[#b02e7c] dark:text-[#e070b0]" />
        : recent ? <History className="size-5 text-muted-foreground" /> : <Search className="size-5 text-muted-foreground" />}
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate", TEXT.row)}><span className="font-mono font-semibold">{airport.ident}</span> · {airport.name}</span>
        {airport.municipality && <span className={cn("block truncate text-muted-foreground", TEXT.detail)}>{airport.municipality}</span>}
      </span>
    </CommandItem>
  );
}
