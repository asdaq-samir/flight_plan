import { useRef, useState } from "react";
import { Command as CommandPrimitive } from "cmdk";
import { ChevronsUpDown, History, Search } from "lucide-react";
import { cn } from "cn";
import { TEXT } from "../lib/text";
import { Button } from "./ui/button";
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from "./ui/command";
import { FavoriteTiles } from "./Favorites";
import { usePreferences, type RecentAirport } from "../lib/preferences";
import { useOwnShip } from "../lib/map/ownShip";
import { ResponsivePopover, ResponsivePopoverContent, ResponsivePopoverTrigger } from "./ResponsivePopover";
import { useAirportSearch } from "../lib/useAirportSearch";

interface Props {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  ariaLabel: string;
  invalid?: boolean;
  className?: string;
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
export default function AirportPicker({ value, onChange, placeholder, ariaLabel, invalid, className }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const input = useRef<HTMLInputElement>(null);
  // Enter takes the highlighted row only once the rows answer what is in
  // the box: it used to take it whenever there were rows, so "KD", a
  // pause, then "LH" and a quick Enter set the field to the first "KD..."
  // airport rather than KDLH.
  const { typed, rows, answered } = useAirportSearch(query, open);

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
    <ResponsivePopover open={open} onOpenChange={next => { setOpen(next); if (!next) setQuery(""); }}>
      <ResponsivePopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel}
          aria-invalid={invalid}
          // A field, as a search box is: its ident in the text's colour
          // (not a button's tint) at a row's size (TEXT).
          className={cn("font-mono uppercase text-foreground", TEXT.row, !value && "text-muted-foreground", className)}
        >
          {value || placeholder}
          <ChevronsUpDown className="text-muted-foreground" />
        </Button>
      </ResponsivePopoverTrigger>
      {/* The panel's own search, as the search bar is with no route: on a
          phone a tall sheet, the field a capsule at its top, Favorites
          and Recents under it until something is typed. */}
      <ResponsivePopoverContent
        title={`${ariaLabel} airport`} titleHidden className="w-96 p-3" align="start"
        sheetClassName="data-[vaul-drawer-direction=bottom]:h-[85dvh] data-[vaul-drawer-direction=top]:h-[85dvh]"
        // The field focused as it opens, as the search bar is on its tap:
        // the sheet's own first focus went to the sheet itself.
        onOpenAutoFocus={e => { e.preventDefault(); input.current?.focus(); }}
      >
        {/* The server already filters (an ident, a word of a name or a
            town), so cmdk's own filter is off: it would drop a row whose
            name matched but whose ident, the `value`, did not. */}
        <Command shouldFilter={false} className="gap-4 overflow-visible bg-transparent">
          <div className={cn("flex h-11 shrink-0 items-center gap-2 rounded-full bg-foreground/8 px-4 text-muted-foreground", TEXT.row)}>
            <Search className="size-5 shrink-0" aria-hidden="true" />
            <CommandPrimitive.Input
              ref={input}
              placeholder={`Search for a ${ariaLabel.toLowerCase()}`} aria-label={`Search for a ${ariaLabel.toLowerCase()}`}
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
          {!typed && (home || favorites.length > 0) && (
            <FavoriteTiles home={home} favorites={favorites} from={fix} onOpen={choose} />
          )}
          {/* Dimmed while they answer something older than the box. */}
          <CommandList className={cn("max-h-none overflow-visible", typed && !answered && "opacity-60")} aria-busy={!answered}>
            {typed && <CommandEmpty>No airport matches; Enter keeps what you typed.</CommandEmpty>}
            {!typed && recents.length > 0 && (
              <CommandGroup heading="Recents" className={GROUP}>
                {recents.map(a => <AirportRow key={a.ident} airport={a} recent onSelect={() => choose(a)} />)}
              </CommandGroup>
            )}
            {!typed && recents.length === 0 && !home && favorites.length === 0 && (
              <p className={cn("px-1 text-muted-foreground", TEXT.note)}>Search by an airport's ident, its name or its town.</p>
            )}
            {rows.length > 0 && (
              <CommandGroup heading="Airports" className={GROUP}>
                {rows.map(r => (
                  <AirportRow
                    key={r.ident} airport={{ ident: r.ident, name: r.name, municipality: r.municipality }}
                    onSelect={() => choose({ ident: r.ident, name: r.name, municipality: r.municipality })}
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
 *  ident and name, its town under them. */
function AirportRow({ airport, recent = false, onSelect }: { airport: RecentAirport; recent?: boolean; onSelect: () => void }) {
  return (
    <CommandItem value={airport.ident} onSelect={onSelect} className="min-h-11 gap-3 rounded-lg px-2 py-2">
      {recent ? <History className="size-5 text-muted-foreground" /> : <Search className="size-5 text-muted-foreground" />}
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate", TEXT.row)}><span className="font-mono font-semibold">{airport.ident}</span> · {airport.name}</span>
        {airport.municipality && <span className={cn("block truncate text-muted-foreground", TEXT.detail)}>{airport.municipality}</span>}
      </span>
    </CommandItem>
  );
}
