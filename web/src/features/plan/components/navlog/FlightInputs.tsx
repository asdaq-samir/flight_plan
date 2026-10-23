import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Plane } from "lucide-react";
import { cn } from "cn";
import { N_NUMBER, profileOfRegistered, shortName } from "../../../../lib/aircraftChoice";
import { api } from "../../../../lib/api/client";
import { GLASS_BUTTON } from "../../../../components/mapChrome";
import { INLINE_FIELD_BUTTON, InlineField } from "../../../../components/InlineField";
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
          look similar to altitude"), the same field (InlineField): typed
          in, its card's button at its end once there is one. */}
      <InlineField
        label="Airplane" testId="aircraft-select" widest="N888MM" placeholder="N-number" shrink
        placeholderClassName={TEXT.detail}
        input={{
          autoCapitalize: "characters", autoCorrect: "off", spellCheck: false, value: shown, "aria-label": "Airplane, N-number",
          onChange: e => setTyped(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6)),
          onKeyDown: e => { if (e.key === "Enter") { e.preventDefault(); commit(); (e.target as HTMLInputElement).blur(); } if (e.key === "Escape") setTyped(null); },
          onBlur: commit, "data-testid": "aircraft-input",
        }}
        inputClassName={cn("text-foreground", !shown && TEXT.detail)}
        button={tailNow && typed === null && onOpenAirplane && (
          <button
            type="button" onClick={openCard} aria-label={`${tailNow}: its card`} data-testid="aircraft-card-button"
            className={cn(INLINE_FIELD_BUTTON, GLASS_BUTTON)}
          >
            <Plane className="size-3.5" aria-hidden="true" />
          </button>
        )}
      />
      {altitude}
      {onDepartChange && <DepartPicker value={depart} onChange={onDepartChange} />}
    </>
  );
}
