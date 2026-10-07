import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PlaneLanding } from "lucide-react";
import { cn } from "cn";
import { ListGroup, ListRow } from "./GroupedList";
import IconButton from "./IconButton";
import { ResponsivePopover, ResponsivePopoverContent, ResponsivePopoverTrigger } from "./ResponsivePopover";
import { compassPoint } from "../lib/compass";
import { glideRangeNm } from "../lib/map/glide";
import { useOwnShip } from "../lib/map/ownShip";
import { nearestQuery } from "../lib/queryClient";
import { TEXT } from "../lib/text";
import { altFt } from "../lib/units";

/**
 * Nearest, as an EFB's: the ten fields nearest own ship, how far and
 * which way, the longest runway, and -- in the air, with the GPS's
 * altitude -- which are within a still-air glide (lib/map/glide), the
 * ring the map draws round own ship. A tap on one opens its card, its Fly
 * Here and its weather. On the open route's head under its close, where
 * the console's button was, at the pilot's ask (the map's buttons hold
 * the map's settings in its place); with no position yet, it offers to
 * show it.
 */
export default function NearestButton({ onSelectPlace, className }: { onSelectPlace: (ident: string) => void; className?: string }) {
  const enabled = useOwnShip(s => s.enabled);
  const setEnabled = useOwnShip(s => s.setEnabled);
  const fix = useOwnShip(s => (s.enabled ? s.fix : null));
  const [open, setOpen] = useState(false);
  const { data } = useQuery({ ...nearestQuery(fix?.lat ?? 0, fix?.lon ?? 0), enabled: !!fix });
  const glide = fix ? glideRangeNm(fix, data?.[0]?.elevation_ft) : null;
  return (
    <ResponsivePopover open={open} onOpenChange={setOpen}>
      <ResponsivePopoverTrigger asChild>
        <IconButton label="Nearest airports" variant="secondary" className={className} data-testid="nearest-button">
          <PlaneLanding strokeWidth={1.5} className="size-5" />
        </IconButton>
      </ResponsivePopoverTrigger>
      <ResponsivePopoverContent title="Nearest airports" className="w-80 p-3" align="end" side="bottom">
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
            : "From your position now; in the air the ones within a glide are marked."}
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
                  reach ? "within glide" : null,
                ].filter(Boolean).join(" · ")}
                value={a.flight_category ?? undefined}
                onClick={() => { setOpen(false); onSelectPlace(a.ident); }}
                className={cn(reach && "font-medium")}
                data-testid="nearest-airport"
              />
            );
          })}
          {!data && <ListRow title={<span className={cn("text-muted-foreground", TEXT.detail)}>Looking…</span>} />}
        </ListGroup>
        )}
      </ResponsivePopoverContent>
    </ResponsivePopover>
  );
}
