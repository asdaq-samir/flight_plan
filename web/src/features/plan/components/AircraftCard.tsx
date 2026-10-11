import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plane, Search, X } from "lucide-react";
import { cn } from "cn";
import { CardHead, PanelCard } from "../../../components/PanelCard";
import { ListGroup, ListRow } from "../../../components/GroupedList";
import { api } from "../../../lib/api/client";
import type { TrafficAircraft } from "../../../lib/api/types";
import { compassPoint } from "../../../lib/compass";
import { bearingDeg, distanceNm, type LatLon } from "../../../lib/geo";
import { useOwnShip } from "../../../lib/map/ownShip";
import { trafficLabel } from "../../../lib/map/traffic";
import { useTracking } from "../../../lib/map/tracking";
import { TEXT } from "../../../lib/text";
import { altFt } from "../../../lib/units";

/** What is typed waits this long for the next letter before it is asked
 *  about: each search is a request adsb.lol paces (vfr.traffic). */
const TYPING_MS = 500;

/** Whether an airplane's callsign, registration or ICAO address begins
 *  with what is typed (spaces and a registration's hyphen aside). */
function named(plane: TrafficAircraft, text: string): boolean {
  const bare = text.replace(/-/g, "");
  return (plane.callsign ?? "").toUpperCase().startsWith(text)
    || (plane.registration ?? "").replace(/-/g, "").toUpperCase().startsWith(bare)
    || plane.hex.toUpperCase().startsWith(text);
}

/** One airplane in a list: its name, what it is and how it flies, and
 *  how far and which way it is from `from`. */
function AircraftRow({ plane, from, ownFt, onPick, testId = "aircraft-row" }: {
  plane: TrafficAircraft; from: LatLon | null; ownFt: number | null; onPick: () => void; testId?: string;
}) {
  const where = from ? `${distanceNm(from, plane).toFixed(1)} nm ${compassPoint(bearingDeg(from, plane))}` : undefined;
  const height = plane.altitude_ft == null ? null
    : ownFt != null ? trafficLabel(plane, ownFt) : `${altFt(Math.round(plane.altitude_ft / 100) * 100)} ft`;
  return (
    <ListRow
      media={<Plane className="size-5 text-muted-foreground" style={{ transform: `rotate(${(plane.track_deg ?? 45) - 45}deg)` }} />}
      title={<span className="font-semibold">{plane.callsign ?? plane.registration ?? plane.hex.toUpperCase()}</span>}
      description={[plane.type, height, plane.speed_kt != null ? `${Math.round(plane.speed_kt)} kt` : null].filter(Boolean).join(" · ")}
      value={where} chevron onClick={onPick} data-testid={testId}
    />
  );
}

/**
 * Aircraft, from the map's button under Nearest, at the pilot's ask: a
 * search for one by what a pilot knows it by -- its callsign (UAL2088),
 * registration (N174HA) or ICAO address -- anywhere in adsb.lol's
 * coverage, and the airplanes about, nearest first; a tap tracks one
 * (FlightCard). The traffic is drawn on the map while it is open.
 */
export default function AircraftCard({ onPick, onClose }: {
  onPick: (plane: TrafficAircraft) => void;
  onClose: () => void;
}) {
  const [typed, setTyped] = useState("");
  const [asked, setAsked] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const wanted = typed.replace(/\s+/g, "").toUpperCase();
  const searching = wanted.length >= 3;
  const { data: found, isFetching, isError } = useQuery({
    queryKey: ["trafficFind", asked], queryFn: () => api.trafficFind(asked), enabled: asked.length >= 3, staleTime: 30_000,
    meta: { silent: true },
  });
  // Asked once the typing pauses, and one search at a time: what is typed
  // while one is out is asked when it is back, the letters between never.
  // A search asked at each pause ("N65", "N654", "N654F") queued its
  // requests behind each other's at adsb.lol's pace, and the name typed
  // last waited for all of them.
  useEffect(() => {
    if (isFetching || wanted === asked) return;
    const later = window.setTimeout(() => setAsked(wanted), TYPING_MS);
    return () => window.clearTimeout(later);
  }, [wanted, asked, isFetching]);
  const fix = useOwnShip(s => (s.enabled ? s.fix : null));
  const seen = useTracking(s => s.seen);
  // The airplanes about whose name begins with what is typed: found as it
  // is typed, asking nothing, before adsb.lol's answer for the rest.
  // Three letters at least, as the planner search wants: two match scores
  // of ICAO addresses. A whole name goes first, so Enter on a full
  // registration picks it and not a longer one that begins with it; eight
  // rows at most.
  const heard = useMemo(() => {
    if (!searching) return [];
    const bare = wanted.replace(/-/g, "");
    const whole = (p: TrafficAircraft) => (p.callsign ?? "").toUpperCase() === wanted
      || (p.registration ?? "").replace(/-/g, "").toUpperCase() === bare || p.hex.toUpperCase() === wanted;
    return seen.map(r => r.plane).filter(plane => named(plane, wanted))
      .sort((a, b) => Number(whole(b)) - Number(whole(a))).slice(0, 8);
  }, [seen, wanted, searching]);
  const answer = asked === wanted ? found : undefined;
  const listed = [...heard, ...(answer ?? []).filter(plane => !heard.some(h => h.hex === plane.hex))];
  const from = fix ? { lat: fix.lat, lon: fix.lon } : null;
  const about = useMemo(() => {
    const planes = seen.map(r => r.plane);
    return from ? planes.sort((a, b) => distanceNm(from, a) - distanceNm(from, b)) : planes;
    // `from` moves with every fix; the list is ordered again with each answer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seen]);
  const ownFt = fix?.altitudeFt ?? null;
  return (
    <PanelCard testId="aircraft-card">
      <CardHead name="Aircraft" line="Track one: tap it on the map or find it here." onClose={onClose} closeTestId="aircraft-close" />
      <div className="space-y-5 pt-3">
        {/* The search bar's field, as Nearest's is. */}
        <label className={cn("flex h-[2.5625rem] items-center gap-2 rounded-full bg-foreground/8 px-3.5 text-muted-foreground", TEXT.row)}>
          <Search className="size-5 shrink-0 text-foreground" strokeWidth={1.75} aria-hidden="true" />
          <input
            ref={input} type="search" enterKeyHint="search" autoComplete="off" autoCorrect="off" autoCapitalize="characters" spellCheck={false}
            value={typed} onChange={e => setTyped(e.target.value)}
            onKeyDown={e => {
              if (e.key !== "Enter") return;
              // The first found, or the search asked now rather than at the pause.
              if (listed[0]) onPick(listed[0]);
              else if (!isFetching) setAsked(wanted);
            }}
            placeholder="Callsign, registration or ICAO address" aria-label="Find an aircraft" data-testid="aircraft-search"
            className="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
          />
          {typed && (
            <button
              type="button" aria-label="Clear" onClick={() => { setTyped(""); input.current?.focus(); }}
              className="relative grid size-5 shrink-0 place-items-center rounded-full bg-muted-foreground/50 text-background outline-none after:absolute after:-inset-3 after:content-[''] focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="size-3" strokeWidth={3} />
            </button>
          )}
        </label>
        {(searching || heard.length > 0) && (
          <ListGroup title="Found">
            {listed.map(plane => (
              <AircraftRow key={plane.hex} plane={plane} from={from} ownFt={ownFt} onPick={() => onPick(plane)} testId="aircraft-found" />
            ))}
            {searching && answer && !listed.length && (
              <ListRow title={<span className="text-muted-foreground">None in the air by that name is heard now</span>} />
            )}
            {searching && !answer && isError && asked === wanted && (
              <ListRow title={<span className={cn("text-destructive", TEXT.detail)}>Couldn't search. Try again in a moment.</span>} />
            )}
            {searching && !answer && !(isError && asked === wanted) && !listed.length && (
              <ListRow title={<span className={cn("text-muted-foreground", TEXT.detail)}>Looking…</span>} />
            )}
          </ListGroup>
        )}
        <ListGroup
          title={from ? "Near you" : "On the map"}
          footer="From adsb.lol's ADS-B receivers, under the Open Database License: seconds old, for knowing what is about, not for avoiding it."
        >
          {about.length
            ? about.slice(0, 40).map(plane => <AircraftRow key={plane.hex} plane={plane} from={from} ownFt={ownFt} onPick={() => onPick(plane)} />)
            : <ListRow title={<span className="text-muted-foreground">None heard yet</span>} />}
        </ListGroup>
      </div>
    </PanelCard>
  );
}
