import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { LocateFixed, MapPin, X } from "lucide-react";
import { cn } from "cn";
import { CardHead, PanelCard } from "../../../components/PanelCard";
import { ListGroup, ListRow } from "../../../components/GroupedList";
import { api } from "../../../lib/api/client";
import type { PlaceFound } from "../../../lib/api/types";
import { compassPoint } from "../../../lib/compass";
import { glideRangeNm } from "../../../lib/map/glide";
import { positionNow, useOwnShip } from "../../../lib/map/ownShip";
import { nearestQuery } from "../../../lib/queryClient";
import { TEXT } from "../../../lib/text";
import { altFt } from "../../../lib/units";

export interface NearFrom {
  label: string;
  lat: number;
  lon: number;
}

/** What is typed waits this long for the next letter before it is asked
 *  about: the Census geocoder is a request a word, not a letter. */
const TYPING_MS = 250;

/**
 * Where Nearest is from: the pilot's position until a place is typed --
 * a town, a street address, an airport -- at the pilot's ask, as Maps'
 * search asks where. The field reads "Current position" until then;
 * what answers comes up under it, and its clear goes back to the
 * position.
 */
function NearField({ from, onFrom }: { from: NearFrom | null; onFrom: (from: NearFrom | null) => void }) {
  const [typed, setTyped] = useState(from?.label ?? "");
  const [asked, setAsked] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const later = window.setTimeout(() => setAsked(typed.trim()), TYPING_MS);
    return () => window.clearTimeout(later);
  }, [typed]);
  const searching = asked.length >= 2 && asked !== from?.label;
  const { data: found, isFetching } = useQuery({
    queryKey: ["places", asked], queryFn: () => api.placesSearch(asked), enabled: searching, staleTime: 60 * 60_000,
    meta: { silent: true },
  });
  const pick = (place: PlaceFound | null) => {
    onFrom(place && { label: place.label, lat: place.lat, lon: place.lon });
    setTyped(place?.label ?? "");
    input.current?.blur();
  };
  return (
    <div className="pt-3">
      {/* The search bar's field (PanelCapsule's SearchField), a pin for
          the magnifier: where from, not what. */}
      <label className={cn("flex h-[2.5625rem] items-center gap-2 rounded-full bg-foreground/8 px-3.5 text-muted-foreground", TEXT.row)}>
        <MapPin className="size-5 shrink-0 text-foreground" strokeWidth={1.75} aria-hidden="true" />
        <input
          ref={input} type="search" enterKeyHint="search" autoComplete="off" autoCorrect="off" spellCheck={false}
          value={typed} onChange={e => setTyped(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && found?.[0]) pick(found[0]); }}
          placeholder="Current position" aria-label="Nearest to: a town, an address or an airport" data-testid="nearest-from"
          className="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
        />
        {(typed || from) && (
          <button
            type="button" aria-label="Nearest to your position" data-testid="nearest-from-clear"
            onClick={() => pick(null)}
            className="grid size-5 shrink-0 place-items-center rounded-full bg-muted-foreground/50 text-background outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-3" strokeWidth={3} />
          </button>
        )}
      </label>
      {searching && (
        <div className="pt-3">
          <ListGroup>
            {(found ?? []).map(place => (
              <ListRow
                key={`${place.kind}-${place.label}`} media={<MapPin className="size-5 text-muted-foreground" />}
                title={place.label} description={place.kind === "airport" ? "Airport" : place.kind === "town" ? "Town" : "Address"}
                onClick={() => pick(place)} data-testid="nearest-from-option"
              />
            ))}
            {found && !found.length && !isFetching && (
              <ListRow title={<span className="text-muted-foreground">Nothing by that name</span>} />
            )}
            {!found && <ListRow title={<span className={cn("text-muted-foreground", TEXT.detail)}>Looking…</span>} />}
            {from && (
              <ListRow
                media={<LocateFixed className="size-5 text-tint" />} title="Current position"
                onClick={() => pick(null)} data-testid="nearest-from-position"
              />
            )}
          </ListGroup>
        </div>
      )}
    </div>
  );
}

/**
 * Nearest, as an EFB's, a card in the panel at the pilot's ask -- half
 * way up with the map fitted to the fields above it (RouteMap's FitTo),
 * where it was a sheet of its own over the panel: the ten fields nearest
 * own ship, how far and which way, the longest runway, and -- in the
 * air, with the GPS's altitude -- which are within a still-air glide
 * (lib/map/glide), the ring the map draws round own ship. Or nearest a
 * place typed in its field (NearField), at the pilot's ask: a town, an
 * address, an airport. A tap on one opens its card over this one, and
 * its close comes back here. With no position yet, it offers to show it.
 */
export default function NearestCard({ onOpen, onClose, from, onFrom }: {
  onOpen: (ident: string) => void;
  onClose: () => void;
  /** The place typed, where it is from one (the page's, in its address). */
  from: NearFrom | null;
  onFrom: (from: NearFrom | null) => void;
}) {
  const enabled = useOwnShip(s => s.enabled);
  const setEnabled = useOwnShip(s => s.setEnabled);
  const fix = useOwnShip(s => (s.enabled ? s.fix : null));
  const origin = from ?? fix;
  const { data } = useQuery({ ...nearestQuery(origin?.lat ?? 0, origin?.lon ?? 0), enabled: !!origin });
  // Asked for the nearest fields, the position is wanted: own ship turned
  // on quietly where the browser already lets it be read (positionNow),
  // as Fly Here does; else the card offers to show it.
  useEffect(() => {
    void positionNow(0);
  }, []);
  // A glide only from where the airplane is, with its altitude.
  const glide = !from && fix ? glideRangeNm(fix, data?.[0]?.elevation_ft) : null;
  return (
    <PanelCard testId="nearest-card">
      <CardHead
        name="Nearest Airports"
        line={from ? `Near ${from.label}` : !fix ? "From your position" : glide != null ? `Within a glide: about ${Math.round(glide)} nm` : "From your position now"}
        onClose={onClose} closeTestId="nearest-close"
      />
      <NearField from={from} onFrom={onFrom} />
      <div className="pt-4">
        {!origin ? (
          <ListGroup footer="The nearest fields are found from your position, which stays on this device, or from a place typed above.">
            {enabled
              ? <ListRow title={<span className="text-muted-foreground">Finding your position…</span>} />
              : <ListRow title="Show my position" onClick={() => setEnabled(true)} data-testid="nearest-show-position" />}
          </ListGroup>
        ) : (
          <ListGroup
            footer={from
              ? `From ${from.label}. Clear the field for the nearest to your position.`
              : glide != null
                ? `Within a still-air glide: about ${Math.round(glide)} nm from here, at 1.5 nm for every 1,000 ft over the nearest field -- the dashed ring.`
                : "In the air, the ones within a glide are marked."}
          >
            {(data ?? []).map(a => {
              const reach = glide != null && a.distance_nm <= glide;
              return (
                <ListRow
                  key={a.ident}
                  title={<><span className="font-mono font-semibold">{a.ident}</span> · {a.name}</>}
                  description={[
                    `${a.distance_nm} nm ${compassPoint(a.bearing_deg)}`,
                    a.longest_runway_ft ? `${altFt(a.longest_runway_ft)} ft runway` : null,
                    // Listed whoever owns it, and said: in an emergency the
                    // pilot in command lands where the emergency needs
                    // (14 CFR 91.3(b)), and a military field may be it.
                    a.military === "military" ? "military" : a.military === "joint" ? "joint use" : null,
                    reach ? "within glide" : null,
                  ].filter(Boolean).join(" · ")}
                  value={a.flight_category ?? undefined}
                  onClick={() => onOpen(a.ident)}
                  className={cn(reach && "font-medium")}
                  data-testid="nearest-airport"
                />
              );
            })}
            {!data && <ListRow title={<span className={cn("text-muted-foreground", TEXT.detail)}>Looking…</span>} />}
          </ListGroup>
        )}
      </div>
    </PanelCard>
  );
}
