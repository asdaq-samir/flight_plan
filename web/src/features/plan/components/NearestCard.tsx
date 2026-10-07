import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "cn";
import { CardHead, PanelCard } from "../../../components/PanelCard";
import { ListGroup, ListRow } from "../../../components/GroupedList";
import { compassPoint } from "../../../lib/compass";
import { glideRangeNm } from "../../../lib/map/glide";
import { positionNow, useOwnShip } from "../../../lib/map/ownShip";
import { nearestQuery } from "../../../lib/queryClient";
import { TEXT } from "../../../lib/text";
import { altFt } from "../../../lib/units";

/**
 * Nearest, as an EFB's, a card in the panel at the pilot's ask -- half
 * way up with the map fitted to the fields above it (RouteMap's FitTo),
 * where it was a sheet of its own over the panel: the ten fields nearest
 * own ship, how far and which way, the longest runway, and -- in the
 * air, with the GPS's altitude -- which are within a still-air glide
 * (lib/map/glide), the ring the map draws round own ship. A tap on one
 * opens its card over this one, and its close comes back here. With no
 * position yet, it offers to show it.
 */
export default function NearestCard({ onOpen, onClose }: { onOpen: (ident: string) => void; onClose: () => void }) {
  const enabled = useOwnShip(s => s.enabled);
  const setEnabled = useOwnShip(s => s.setEnabled);
  const fix = useOwnShip(s => (s.enabled ? s.fix : null));
  const { data } = useQuery({ ...nearestQuery(fix?.lat ?? 0, fix?.lon ?? 0), enabled: !!fix });
  // Asked for the nearest fields, the position is wanted: own ship turned
  // on quietly where the browser already lets it be read (positionNow),
  // as Fly Here does; else the card offers to show it.
  useEffect(() => {
    void positionNow(0);
  }, []);
  const glide = fix ? glideRangeNm(fix, data?.[0]?.elevation_ft) : null;
  return (
    <PanelCard testId="nearest-card">
      <CardHead
        name="Nearest Airports"
        line={!fix ? "From your position" : glide != null ? `Within a glide: about ${Math.round(glide)} nm` : "From your position now"}
        onClose={onClose} closeTestId="nearest-close"
      />
      <div className="pt-4">
        {!fix ? (
          <ListGroup footer="The nearest fields are found from your position, which stays on this device.">
            {enabled
              ? <ListRow title={<span className="text-muted-foreground">Finding your position…</span>} />
              : <ListRow title="Show my position" onClick={() => setEnabled(true)} data-testid="nearest-show-position" />}
          </ListGroup>
        ) : (
          <ListGroup
            footer={glide != null
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
