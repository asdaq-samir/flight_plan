import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { cn } from "cn";
import { Popover, PopoverContent, PopoverTrigger } from "../../../../components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "../../../../components/ui/command";
import { N_NUMBER, profileOfRegistered, shortName } from "../../../../lib/aircraftChoice";
import { api } from "../../../../lib/api/client";
import { GLASS_BUTTON } from "../../../../components/mapChrome";
import { TEXT } from "../../../../lib/text";
import DepartPicker from "./DepartPicker";

/**
 * The two inputs the nav log is computed from, in the planning panel's
 * second row, in sight with the panel down: the airplane (one of the
 * pilot's own, by its N-number, first; a stock profile; or any airplane
 * the FAA's registry has, typed by its N-number; its TAS and burn are
 * what the legs' times and fuel come from) and when the flight leaves,
 * which gives every row an ETA, is what a saved flight is planned for,
 * and picks the winds forecast period -- shadcn's date picker with a time
 * box (DepartPicker), empty for about now. Changing either re-plans.
 */
export default function FlightInputs({ aircraftValue, aircraftOptions, onAircraftChange, onTailPick, altitude, depart, onDepartChange }: {
  aircraftValue: string;
  aircraftOptions: { value: string; label: string }[];
  onAircraftChange: (value: string) => void;
  /** An airplane found in the FAA's registry by its N-number, flown on
   *  its type's stock profile. */
  onTailPick?: (tail: string, profile: string) => void;
  /** Beside the airplane: the altitude it flies (AltitudeGroup). */
  altitude?: ReactNode;
  /** An ISO instant, or "" for about now; with no handler, no picker here
   *  (the departure's step in FPL's list has it). */
  depart: string;
  onDepartChange?: (iso: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = shortName(aircraftOptions.find(o => o.value === aircraftValue)?.label ?? "");
  const [typed, setTyped] = useState("");
  const pick = (value: string) => {
    onAircraftChange(value);
    setOpen(false);
    setTyped("");
  };
  return (
    <>
      <Popover open={open} onOpenChange={next => { setOpen(next); if (!next) setTyped(""); }}>
        {/* A button as the Brief's is, a pill of the glass round buttons are
            made of (GLASS_BUTTON), 32 tall in the route box, at the owner's pick ("pa28 should
            be a selection button style like the brief button"); in the row's
            type, at the owner's ask ("why is the font for PA28 so small").
            Its short name -- C172, N12345 -- so a departure time picked
            beside it stays on the same line; the list has them whole. */}
        <PopoverTrigger asChild>
          <button
            type="button" aria-label="Airplane" data-testid="aircraft-select"
            className={cn("inline-flex h-8 shrink-0 items-center rounded-full px-2 font-semibold whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-ring", GLASS_BUTTON, TEXT.row)}
          >
            {/* Its N-number, at the owner's ask ("And should show the n-number
                instead of airplane model"); with none picked yet -- a plan on
                the stock profile it starts with -- the field's ask for one. */}
            {/* The ask in a detail's size and the pill eight in from its sides, so
                the row keeps its line with the brief, the nav log, Share and
                the refresh on a computer's 24-rem panel, as with "C172". */}
            {N_NUMBER.test(current) ? current : <span className={cn("font-normal text-muted-foreground", TEXT.detail)}>N-number</span>}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-0">
          {/* A list to type in, at the owner's asks ("The airplane picker
              should pick an airplane by N number", "No airplane should only
              be picked by n-number"): the pilot's own by their N-numbers, and
              any other N-number looked up in the FAA's registry; no stock
              profile is a choice, only what an airplane flies on. */}
          <Command>
            <CommandInput placeholder="N-number" value={typed} onValueChange={setTyped} data-testid="aircraft-search" />
            <CommandList>
              <CommandEmpty>{N_NUMBER.test(typed.trim().toUpperCase()) ? null : "Type an airplane's N-number"}</CommandEmpty>
              <CommandGroup>
                {aircraftOptions.map(o => (
                  <CommandItem key={o.value} value={o.label} onSelect={() => pick(o.value)}>
                    <span className="min-w-0 flex-1 truncate">{o.label}</span>
                    {o.value === aircraftValue && <Check className="size-4 text-tint" aria-hidden="true" />}
                  </CommandItem>
                ))}
              </CommandGroup>
              {onTailPick && (
                <Registered
                  typed={typed} known={aircraftOptions.map(o => shortName(o.label))}
                  onPick={(tail, profile) => { onTailPick(tail, profile); setOpen(false); setTyped(""); }}
                />
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {altitude}
      {onDepartChange && <DepartPicker value={depart} onChange={onDepartChange} />}
    </>
  );
}

/**
 * An N-number typed that is none of the list's, looked up in the FAA's
 * registry (the planner's airplane search, its `registered`): its maker,
 * model and year, flown on its type's stock profile where there is one
 * (profileOfRegistered); where there is none, said so, its speed and burn
 * the pilot's to give in Setup's Airplanes.
 */
function Registered({ typed, known, onPick }: { typed: string; known: string[]; onPick: (tail: string, profile: string) => void }) {
  const tail = typed.trim().toUpperCase();
  const asked = N_NUMBER.test(tail) && !known.includes(tail);
  const { data, isFetching, isError } = useQuery({
    queryKey: ["registered", tail], queryFn: () => api.trafficFind(tail), enabled: asked, staleTime: 24 * 60 * 60_000,
    meta: { silent: true },
  });
  if (!asked) return null;
  const registered = data?.registered ?? null;
  const profile = registered ? profileOfRegistered(registered) : null;
  const what = registered ? [registered.manufacturer, registered.model, registered.year].filter(Boolean).join(" ") : "";
  return (
    <CommandGroup heading="FAA registry" forceMount>
      {isFetching && !data ? (
        <p className={cn("px-2 py-2 text-muted-foreground", TEXT.detail)} role="status">Looking up {tail}…</p>
      ) : !registered ? (
        <p className={cn("px-2 py-2 text-muted-foreground", TEXT.detail)} role="status" data-testid="registry-none">
          {isError ? `${tail} could not be looked up just now` : `No airplane ${tail} in the FAA's registry`}
        </p>
      ) : profile ? (
        <CommandItem value={`${tail} ${what}`} forceMount onSelect={() => onPick(tail, profile)} data-testid="registry-pick">
          <span className="min-w-0 flex-1 truncate">{tail} · {what}</span>
          <span className="text-muted-foreground">{profile.toUpperCase()}</span>
        </CommandItem>
      ) : (
        <p className={cn("px-2 py-2 text-muted-foreground", TEXT.detail)} role="status" data-testid="registry-no-profile">
          {tail} · {what}: no performance profile for it. Add it in Setup › Airplanes with its speed and fuel burn.
        </p>
      )}
    </CommandGroup>
  );
}
