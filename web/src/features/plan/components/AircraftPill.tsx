import { useEffect, useState } from "react";
import { ChevronDown, Plane } from "lucide-react";
import { cn } from "cn";
import AirportPicker from "../../../components/AirportPicker";
import { PillSection, PillStrip, SmallTile } from "../../../components/Favorites";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
import { Switch } from "../../../components/ui/switch";
import type { TrafficAircraft } from "../../../lib/api/types";
import { inEmergency } from "../../../lib/fbo";
import { useOwnShip } from "../../../lib/map/ownShip";
import { useTracking } from "../../../lib/map/tracking";
import { usePreferences } from "../../../lib/preferences";
import { TEXT } from "../../../lib/text";
import { filterFor, QUESTIONS, questionOf, strip, useFilteredAircraft, useTrafficFocus, type Question } from "../hooks/useAircraftQuestion";
import { AircraftFavoriteStrip } from "./AircraftCard";

/** The strip's title for each question: what it lists, the airport after
 *  it where it asks of one. */
const TITLES: Record<Question, string> = {
  near: "Nearest", around: "Around", inbound: "Inbound", departing: "Departing", based: "Based at", emergency: "Emergencies",
};
/** The most the strip shows: a finger's width each, sliding for more. */
const STRIP_MOST = 12;

/**
 * The Aircraft tab's pill, the owner's picks of the redesign: under the
 * search bar, the Favorites (Plane first), then a second strip whose title
 * is a menu of what to list -- the nearest, those around, inbound to,
 * departing or based at an airport, or emergencies -- the airport a pill
 * of its own beside it to change; and at the row's right one switch, Map,
 * that leaves only these airplanes on the map, the rest faded ("Map: show
 * only these"). The same filter as the full list (AircraftFilters).
 */
export default function AircraftPill({ onOpen, onAddMine, onPick }: {
  onOpen: (hex: string) => void;
  onAddMine: () => void;
  onPick: (plane: TrafficAircraft) => void;
}) {
  const seen = useTracking(s => s.seen);
  const planes = useSeenPlanes(seen);
  const from = useOwnShip(s => (s.enabled ? s.fix : null));
  const setOwnShip = useOwnShip(s => s.setEnabled);
  const { filter, field, kept } = useFilteredAircraft(planes, from);
  const change = usePreferences(s => s.setAircraftFilter);
  const question = questionOf(filter);
  const asks = QUESTIONS.find(q => q.value === question)!;
  const [picking, setPicking] = useState(false);
  const pick = (q: Question) => {
    change(filterFor(q));
    // An airport's question with none named yet: which one, at once.
    if (QUESTIONS.find(x => x.value === q)!.airport && !filter.airport) setPicking(true);
  };
  const rows = strip(question, kept, from, field).slice(0, STRIP_MOST);
  const map = useTrafficFocus(s => s.on);
  // The airplanes left on the map, as the question's answer changes.
  const only = rows.length ? rows.map(r => r.plane.hex).join(",") : "";
  useEffect(() => {
    if (map) useTrafficFocus.setState({ only: new Set(only ? only.split(",") : []) });
  }, [map, only]);
  return (
    <div className="flex flex-col gap-2" data-testid="aircraft-pill">
      <PillSection title="Favorites" testId="pill-section-aircraft-favorites">
        <AircraftFavoriteStrip onOpen={onOpen} onAddMine={onAddMine} />
      </PillSection>
      <PillSection
        testId="pill-section-question"
        title={(
          <div className="flex min-w-0 items-center gap-1.5">
            <DropdownMenu>
              <DropdownMenuTrigger
                data-testid="aircraft-question"
                className={cn(
                  "relative flex items-center gap-0.5 font-semibold uppercase tracking-wide text-tint outline-none",
                  "focus-visible:ring-2 focus-visible:ring-ring after:absolute after:-inset-2", TEXT.note,
                )}
              >
                {TITLES[question]}
                <ChevronDown className="size-3.5" strokeWidth={2.5} aria-hidden="true" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-52">
                <DropdownMenuRadioGroup value={question} onValueChange={v => pick(v as Question)}>
                  {QUESTIONS.map(q => (
                    <DropdownMenuRadioItem key={q.value} value={q.value} data-testid={`question-${q.value}`}>
                      {q.label}{q.airport ? "…" : ""}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            {asks.airport && (
              // The airport asked of, a pill of its own to change: Home
              // and the Favorites first, then a search (AirportPicker).
              <AirportPicker
                value={filter.airport} onChange={airport => change({ airport })} placeholder="Airport" ariaLabel="Traffic at"
                look="pill" testId="question-airport" open={picking} onOpenChange={setPicking}
                className="h-7 rounded-full bg-foreground/8 px-2.5"
              />
            )}
          </div>
        )}
        right={(
          <>
            <label htmlFor="aircraft-map-only" className={cn("text-foreground/65", TEXT.note)}>Map</label>
            <Switch
              id="aircraft-map-only" checked={map} data-testid="aircraft-map-only"
              onCheckedChange={on => useTrafficFocus.setState({ on, only: on ? useTrafficFocus.getState().only : null })}
            />
          </>
        )}
      >
        {question === "near" && !from ? (
          <button
            type="button" onClick={() => setOwnShip(true)} data-testid="aircraft-strip-position"
            className={cn("relative mx-auto block px-2 py-1 text-tint after:absolute after:-inset-y-2 after:inset-x-0", TEXT.row)}
          >
            Show my position
          </button>
        ) : asks.airport && !field ? (
          <p className={cn("py-1 text-center text-foreground/65", TEXT.note)}>Pick an airport</p>
        ) : rows.length ? (
          <PillStrip testId="aircraft-strip">
            {rows.map(({ plane, detail }) => {
              const name = plane.callsign?.trim() || plane.registration || plane.hex.toUpperCase();
              return (
                <SmallTile
                  key={plane.hex} onClick={() => onPick(plane)} testId="aircraft-strip-plane" title={name} detail={detail}
                  label={`${name}${detail ? `, ${detail}` : ""}`}
                  mark={(
                    <span className={cn("grid size-7 place-items-center", inEmergency(plane) ? "text-red-600" : "text-sky-600")} aria-hidden="true">
                      {/* lucide's airplane points north-east: turned to its track. */}
                      <Plane className="size-5" fill="currentColor" style={{ transform: `rotate(${(plane.track_deg ?? 45) - 45}deg)` }} />
                    </span>
                  )}
                />
              );
            })}
          </PillStrip>
        ) : (
          <p className={cn("py-1 text-center text-foreground/65", TEXT.note)} role="status">None heard now</p>
        )}
      </PillSection>
    </div>
  );
}

/** The airplanes the map has heard, one array while the reports are the
 *  same (useFilteredAircraft's memo keys on it). */
function useSeenPlanes(seen: { plane: TrafficAircraft }[]): TrafficAircraft[] {
  const [kept, setKept] = useState<{ from: typeof seen; planes: TrafficAircraft[] }>({ from: seen, planes: seen.map(r => r.plane) });
  if (kept.from !== seen) setKept({ from: seen, planes: seen.map(r => r.plane) });
  return kept.planes;
}
