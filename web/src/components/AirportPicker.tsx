import { useRef, useState } from "react";
import { Command as CommandPrimitive } from "cmdk";
import { ChevronsUpDown, Search } from "lucide-react";
import { cn } from "cn";
import { TEXT } from "../lib/text";
import { Button } from "./ui/button";
import { Command, CommandEmpty } from "./ui/command";
import AirportResults, { AirportRow, PickerGroup } from "./AirportResults";
import { FavoriteTiles } from "./Favorites";
import { usePreferences, type RecentAirport } from "../lib/preferences";
import { ResponsivePopover, ResponsivePopoverContent, ResponsivePopoverTrigger } from "./ResponsivePopover";
import { useAirportSearch } from "../lib/useAirportSearch";
import { useIsMobile } from "../hooks/use-mobile";
import { useKeyboardInset } from "../hooks/use-viewport";
import CloseButton from "./CloseButton";
import ClearButton from "./ClearButton";

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
  /** Whether the search is out, where its opener is elsewhere -- a
   *  route's airport, whose tap opens its card, changed from its menu
   *  (RouteBox) -- with what to do as it opens or closes. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** What a tap on the button does in place of opening the search. */
  onTap?: () => void;
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
  open: shown, onOpenChange, onTap,
}: Props) {
  const [ownOpen, setOwnOpen] = useState(false);
  const open = shown ?? ownOpen;
  const setOpen = onOpenChange ?? setOwnOpen;
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
  const choose = (airport: RecentAirport) => {
    usePreferences.getState().addRecentAirport(airport);
    pick(airport.ident);
  };

  return (
    // From the top of a phone's screen, where the keyboard cannot come up
    // over the field: from the bottom it came up over it, field and all.
    <ResponsivePopover open={open} onOpenChange={next => { setOpen(next); if (!next) setQuery(""); }} phoneEdge="top">
      <ResponsivePopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          // A combobox where a tap opens the search; a button where it
          // opens the airport's card (`onTap`), the search its menu's.
          role={onTap ? undefined : "combobox"}
          aria-expanded={onTap ? undefined : open}
          aria-label={ariaLabel}
          aria-invalid={invalid}
          data-testid={testId}
          // A tap the caller's (`onTap`), not the trigger's opening:
          // Radix's own toggle runs only where nothing prevented it.
          onClick={onTap ? e => { e.preventDefault(); onTap(); } : undefined}
          // A field, as a search box is: its ident in the text's colour
          // (not a button's tint) at a row's size (TEXT). A route's pill
          // in the system face, semibold, at a line under a row's (15):
          // in the monospaced face at 17 two took a phone's line, the pilot
          // asked for three.
          className={look === "pill"
            ? cn("font-semibold uppercase text-foreground", TEXT.detail, className)
            : cn("font-mono uppercase text-foreground", TEXT.row, !value && "text-muted-foreground", className)}
        >
          {value || placeholder}
          {look === "field" && <ChevronsUpDown className="text-muted-foreground" />}
        </Button>
      </ResponsivePopoverTrigger>
      {/* The panel's own search, as the search bar is with no route: on a
          phone a sheet from the top, the field a capsule at its top,
          Favorites and Recents under it until something is typed. */}
      <ResponsivePopoverContent
        title={`${ariaLabel} airport`} titleHidden className="w-96 p-3" align="start"
        // As tall as what it holds, at the owner's pick ("a tall, mostly
        // empty glass pane" before anything was typed): the field and
        // Favorites and Recents, growing as rows come in, to the screen's
        // height at most. Not sized to what was in sight above the
        // keyboard, which stayed half a card once the keyboard went (iOS
        // does not always say so): the list's room under it for the
        // keyboard (below) is what it grows by while the keyboard is up.
        style={onPhone ? { maxHeight: "calc(100dvh - 1rem - env(safe-area-inset-top))" } : undefined}
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
              on a phone the sheet stands over nearly the whole screen.
              A field, not a control grown to its hit area: 44 tall as
              the search field of Maps' sheet is, its whole box the place
              to type. */}
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
                className="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
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
              {query && <ClearButton label="Clear the search" onClear={() => { setQuery(""); input.current?.focus(); }} />}
            </div>
            <CloseButton onClick={() => { setOpen(false); setQuery(""); }} data-testid="picker-close" />
          </div>
          {/* Its own height, not shrunk: with the keyboard up the sheet is
              short, and the tiles were squeezed to a sliver of their tops. */}
          {!typed && (home || favorites.length > 0) && (
            <div className="shrink-0">
              <FavoriteTiles home={home} favorites={favorites} onOpen={choose} />
            </div>
          )}
          {/* Dimmed while they answer something older than the box. */}
          <AirportResults
            rows={rows} answered={!typed || answered} onAirport={choose} onWaypoint={pick}
            empty={typed && <CommandEmpty>No {fixes ? "airport or waypoint" : "airport"} matches; Enter keeps what you typed.</CommandEmpty>}
          >
            {!typed && recents.length > 0 && (
              <PickerGroup heading="Recents">
                {recents.map(a => <AirportRow key={a.ident} airport={a} recent onSelect={() => choose(a)} />)}
              </PickerGroup>
            )}
            {!typed && recents.length === 0 && !home && favorites.length === 0 && (
              <p className={cn("px-1 text-muted-foreground", TEXT.note)}>Search by an airport's ident, its name or its town.</p>
            )}
          </AirportResults>
        </Command>
      </ResponsivePopoverContent>
    </ResponsivePopover>
  );
}
