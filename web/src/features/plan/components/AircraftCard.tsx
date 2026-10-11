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
  useEffect(() => {
    const later = window.setTimeout(() => setAsked(typed.replace(/\s+/g, "").toUpperCase()), TYPING_MS);
    return () => window.clearTimeout(later);
  }, [typed]);
  const searching = asked.length >= 3;
  const { data: found, isFetching, isError } = useQuery({
    queryKey: ["trafficFind", asked], queryFn: () => api.trafficFind(asked), enabled: searching, staleTime: 30_000,
    meta: { silent: true },
  });
  const fix = useOwnShip(s => (s.enabled ? s.fix : null));
  const seen = useTracking(s => s.seen);
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
            onKeyDown={e => { if (e.key === "Enter" && found?.[0]) onPick(found[0]); }}
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
        {searching && (
          <ListGroup title="Found">
            {(found ?? []).map(plane => (
              <AircraftRow key={plane.hex} plane={plane} from={from} ownFt={ownFt} onPick={() => onPick(plane)} testId="aircraft-found" />
            ))}
            {found && !found.length && !isFetching && (
              <ListRow title={<span className="text-muted-foreground">None in the air by that name is heard now</span>} />
            )}
            {isError && <ListRow title={<span className={cn("text-destructive", TEXT.detail)}>Couldn't search. Try again in a moment.</span>} />}
            {!found && !isError && <ListRow title={<span className={cn("text-muted-foreground", TEXT.detail)}>Looking…</span>} />}
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
