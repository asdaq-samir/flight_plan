import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Plane } from "lucide-react";
import { cn } from "cn";
import { N_NUMBER, profileOfRegistered, shortName } from "../../../../lib/aircraftChoice";
import { api } from "../../../../lib/api/client";
import { GLASS_BUTTON } from "../../../../components/mapChrome";
import { PANEL_FIELD_FILL } from "../../../../components/panelField";
import { TEXT } from "../../../../lib/text";
import DepartPicker from "./DepartPicker";

/**
 * The two inputs the nav log is computed from, in the planning panel's
 * second row, in sight with the panel down: the airplane (one of the
 * pilot's own, by its N-number, or any other N-number typed and added,
 * looked up in the FAA's registry behind it; its TAS and burn are
 * what the legs' times and fuel come from) and when the flight leaves,
 * which gives every row an ETA, is what a saved flight is planned for,
 * and picks the winds forecast period -- shadcn's date picker with a time
 * box (DepartPicker), empty for about now. Changing either re-plans.
 */
export default function FlightInputs({ aircraftValue, aircraftOptions, onAircraftChange, onTailPick, onOpenAirplane, altitude, depart, onDepartChange }: {
  aircraftValue: string;
  aircraftOptions: { value: string; label: string }[];
  onAircraftChange: (value: string) => void;
  /** An N-number typed that is none of the pilot's own: flown on its type's
   *  stock profile once the FAA's registry says it. */
  onTailPick?: (tail: string, profile: string) => void;
  /** The airplane's card, by its Mode S hex (the FAA's registry's). */
  onOpenAirplane?: (hex: string) => void;
  /** Beside the airplane: the altitude it flies (AltitudeGroup). */
  altitude?: ReactNode;
  /** An ISO instant, or "" for about now; with no handler, no picker here
   *  (the departure's step in FPL's list has it). */
  depart: string;
  onDepartChange?: (iso: string) => void;
}) {
  const current = shortName(aircraftOptions.find(o => o.value === aircraftValue)?.label ?? "");
  const tailNow = N_NUMBER.test(current) ? current : "";
  const [typed, setTyped] = useState<string | null>(null);
  const shown = typed ?? tailNow;
  const queryClient = useQueryClient();
  const registered = (tail: string) => queryClient.fetchQuery({
    queryKey: ["registered", tail], queryFn: () => api.trafficFind(tail), staleTime: 24 * 60 * 60_000, meta: { silent: true },
  });
  // An N-number typed: one of the pilot's own picked, any other added at
  // once, at the owner's ask ("Just show a button to add N number from
  // here. You can do the lookup in the background"): flown on the profile
  // in use until the FAA's registry answers, then on its type's where it
  // has one (profileOfRegistered). No stock profile is a choice (the
  // owner's "Why is it showing C172?").
  const commit = () => {
    const tail = (typed ?? "").trim().toUpperCase();
    setTyped(null);
    if (!N_NUMBER.test(tail) || tail === tailNow) return;
    const mine = aircraftOptions.find(o => shortName(o.label) === tail);
    if (mine) {
      onAircraftChange(mine.value);
      return;
    }
    const now = /^[a-z0-9]+$/.test(aircraftValue) ? aircraftValue : "c172";
    onTailPick?.(tail, now);
    void registered(tail).then(found => {
      const profile = found?.registered ? profileOfRegistered(found.registered) : null;
      if (profile && profile !== now) onTailPick?.(tail, profile);
    }).catch(() => { /* the profile in use stands */ });
  };
  // Its card, at the owner's ask ("should have a button show up to go to
  // its card"): the airplane by its Mode S hex, from the registry.
  const openCard = () => {
    if (!tailNow || !onOpenAirplane) return;
    void registered(tailNow).then(found => {
      const hex = found?.registered?.mode_s_hex;
      if (hex) onOpenAirplane(hex.toLowerCase());
    }).catch(() => { /* no card to open */ });
  };
  return (
    <>
      {/* A field as the altitude's is, at the owner's ask ("N-number should
          look similar to altitude"): typed in, its card's button at its end
          once there is one, the route box's fill and type. */}
      <div role="group" aria-label="Airplane" className={cn("grid h-8 shrink-0 items-center rounded-full", PANEL_FIELD_FILL, TEXT.row)} data-testid="aircraft-select">
        {/* As wide as what is in it -- the example at a detail's size, as
            the button it replaced had it, or the N-number and its card's
            button -- so the route box's row keeps its one line (briefing's
            spec: Share level with the airplane). */}
        <span aria-hidden="true" className="invisible col-start-1 row-start-1 flex h-0 overflow-hidden">
          {shown ? <span className="whitespace-pre pr-3 pl-2.5 font-semibold">{shown}</span>
            : <span className={cn("whitespace-pre pr-2.5 pl-2.5 font-normal", TEXT.detail)}>N-number</span>}
          {tailNow && typed === null && onOpenAirplane && <span className="w-[1.8125rem] shrink-0" />}
        </span>
        <div className="col-start-1 row-start-1 flex h-full min-w-0 items-center">
          <label className="relative flex h-full min-w-0 flex-1 items-center pr-1.5 after:absolute after:-inset-y-1.5 after:-left-0.5 after:right-0 after:content-['']">
            <input
              type="text" autoCapitalize="characters" autoCorrect="off" spellCheck={false} enterKeyHint="done" autoComplete="off" size={1}
              value={shown} placeholder="N-number" aria-label="Airplane, N-number"
              onChange={e => setTyped(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6))}
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); commit(); (e.target as HTMLInputElement).blur(); } if (e.key === "Escape") setTyped(null); }}
              onBlur={commit}
              className={cn("relative z-10 h-full w-0 min-w-0 flex-1 bg-transparent pr-1.5 pl-2.5 font-semibold text-foreground outline-none placeholder:font-normal", !shown && TEXT.detail)}
              data-testid="aircraft-input"
            />
          </label>
          {tailNow && typed === null && onOpenAirplane && (
            <button
              type="button" onClick={openCard} aria-label={`${tailNow}: its card`} data-testid="aircraft-card-button"
              // 26 inside the field's 32, three in from its end, at the owner's
              // ask ("buttons for n number and altitude should be smaller to
              // fit in its input group"); its 44 a pseudo-element round it.
              className={cn("relative mr-[3px] flex size-[1.625rem] shrink-0 items-center justify-center rounded-full outline-none after:absolute after:-inset-[9px] after:content-[''] focus-visible:ring-2 focus-visible:ring-ring", GLASS_BUTTON)}
            >
              <Plane className="size-4 text-tint" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
      {altitude}
      {onDepartChange && <DepartPicker value={depart} onChange={onDepartChange} />}
    </>
  );
}
