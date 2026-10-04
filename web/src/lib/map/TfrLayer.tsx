import { useQuery } from "@tanstack/react-query";
import { Polygon } from "react-leaflet";
import type { LatLngExpression } from "leaflet";
import { tfrAltitudes, tfrTimes } from "../advisories";
import type { Tfr } from "../api/types";
import { usePreferences } from "../preferences";
import { tfrsQuery } from "../queryClient";
import { MapCard } from "./MapCard";
import { MapPopup } from "./MapPopup";

/** The FAA's own TFR red, as tfr.faa.gov and every EFB draw one. */
const TFR_RED = "#dc2626";

/** Whether a TFR is in force now: one with no times is taken as so. */
function inForce(tfr: Tfr, now: number): boolean {
  const from = tfr.effective ? Date.parse(tfr.effective) : -Infinity;
  const to = tfr.expires ? Date.parse(tfr.expires) : Infinity;
  return from <= now && now <= to;
}

/** A MultiPolygon's rings as Leaflet's [lat, lon] positions. */
function positions(tfr: Tfr): LatLngExpression[][][] {
  const coordinates = (tfr.geometry as { coordinates?: number[][][][] }).coordinates ?? [];
  return coordinates.map(polygon => polygon.map(ring => ring.map(([lon, lat]) => [lat!, lon!] as LatLngExpression)));
}

/**
 * Every temporary flight restriction on the map, from tfr.faa.gov, as
 * the FAA and every EFB draw them: red, solid while in force, dashed
 * while still to come. A tap opens its card: the NOTAM, how high, when
 * and why, and the FAA's own page for it. On by default -- the settings'
 * TFRs -- as a pilot must know of every one near the route.
 */
export function TfrLayer() {
  const show = usePreferences(s => s.tfrs);
  // In force as of when they were fetched, ten minutes apart at most
  // (tfrsQuery): the render itself reads no clock.
  const { data, dataUpdatedAt: now } = useQuery({ ...tfrsQuery, enabled: show });
  if (!show || !data) return null;
  return (
    <>
      {data.map(tfr => {
        const active = inForce(tfr, now);
        return (
          <Polygon
            key={tfr.notam_id}
            positions={positions(tfr)}
            pathOptions={{
              color: TFR_RED, weight: active ? 2 : 1.5, dashArray: active ? undefined : "6 5",
              fillColor: TFR_RED, fillOpacity: active ? 0.14 : 0.06,
            }}
          >
            <MapPopup>
              <MapCard title={`TFR ${tfr.notam_id}`} subtitle={[tfr.kind, active ? "In force now" : "Not yet in force"].filter(Boolean).join(" · ")}>
                <div className="space-y-1 text-left" data-testid="tfr-card">
                  {tfrAltitudes(tfr) && <p>{tfrAltitudes(tfr)}</p>}
                  {tfrTimes(tfr) && <p>{tfrTimes(tfr)}</p>}
                  {(tfr.purpose ?? tfr.rule) && <p className="text-muted-foreground">{tfr.purpose ?? tfr.rule}</p>}
                  <a className="text-tint" href={`https://tfr.faa.gov/tfr3/?page=detail_${tfr.notam_id.replace("/", "_")}`} target="_blank" rel="noreferrer">
                    The NOTAM on tfr.faa.gov
                  </a>
                </div>
              </MapCard>
            </MapPopup>
          </Polygon>
        );
      })}
    </>
  );
}
