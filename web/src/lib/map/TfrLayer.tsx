import { memo } from "react";
import { Ban } from "lucide-react";
import { RowBadge } from "../../components/RowBadge";
import { BADGE } from "../rowBadges";
import { useQuery } from "@tanstack/react-query";
import { Polygon } from "react-leaflet";
import type { LatLngExpression, PathOptions } from "leaflet";
import { tfrAltitudes, tfrTimes } from "../advisories";
import type { Tfr } from "../api/types";
import { usePreferences } from "../preferences";
import { tfrsQuery } from "../queryClient";
import { MapCard } from "./MapCard";
import { MapPopup } from "./MapPopup";

/** The FAA's own TFR red, as tfr.faa.gov and every EFB draw one. */
const TFR_RED = "#dc2626";

// One style each, in force and not yet, rather than a literal at every
// render: react-leaflet restyles a path whenever its pathOptions is new.
// No dash said as undefined, so a TFR coming into force loses its dash
// (Leaflet merges a new style into the old).
const IN_FORCE: PathOptions = { color: TFR_RED, weight: 2, dashArray: undefined, fillColor: TFR_RED, fillOpacity: 0.14 };
const NOT_YET: PathOptions = { color: TFR_RED, weight: 1.5, dashArray: "6 5", fillColor: TFR_RED, fillOpacity: 0.06 };

/** Whether a TFR is in force now: one with no times is taken as so. */
function inForce(tfr: Tfr, now: number): boolean {
  const from = tfr.effective ? Date.parse(tfr.effective) : -Infinity;
  const to = tfr.expires ? Date.parse(tfr.expires) : Infinity;
  return from <= now && now <= to;
}

// Each TFR's rings worked out once, kept with the query's own object for
// it: new arrays are a new shape to react-leaflet, which redrew every TFR
// on the map each time the page drew.
const ringsOf = new WeakMap<Tfr, LatLngExpression[][][]>();

/** A MultiPolygon's rings as Leaflet's [lat, lon] positions. */
function positions(tfr: Tfr): LatLngExpression[][][] {
  let rings = ringsOf.get(tfr);
  if (!rings) {
    const coordinates = (tfr.geometry as { coordinates?: number[][][][] }).coordinates ?? [];
    rings = coordinates.map(polygon => polygon.map(ring => ring.map(([lon, lat]) => [lat!, lon!] as LatLngExpression)));
    ringsOf.set(tfr, rings);
  }
  return rings;
}

/**
 * Every temporary flight restriction on the map, from tfr.faa.gov, as
 * the FAA and every EFB draw them: red, solid while in force, dashed
 * while still to come. A tap opens its card: the NOTAM, how high, when
 * and why, and the FAA's own page for it. On by default -- the settings'
 * TFRs -- as a pilot must know of every one near the route.
 */
export const TfrLayer = memo(function TfrLayer() {
  const show = usePreferences(s => s.tfrs);
  // In force as of when they were fetched, ten minutes apart at most
  // (tfrsQuery): the render itself reads no clock.
  const { data, dataUpdatedAt: now } = useQuery({ ...tfrsQuery, enabled: show });
  if (!show || !data) return null;
  return (
    <>
      {data.map(tfr => <TfrShape key={tfr.notam_id} tfr={tfr} active={inForce(tfr, now)} />)}
    </>
  );
});

/** One TFR, drawn again only when it changes (memo), and its card made
 *  only once it is opened (TfrCard, inside the popup): every TFR in the
 *  country, its times written out with date-fns, was drawn again with
 *  each render of the map -- 0.15 to 0.4 s of a phone's as a route
 *  loaded (measured 2026-10-07). */
const TfrShape = memo(function TfrShape({ tfr, active }: { tfr: Tfr; active: boolean }) {
  return (
    <Polygon positions={positions(tfr)} pathOptions={active ? IN_FORCE : NOT_YET}>
      <MapPopup>
        <TfrCard tfr={tfr} active={active} />
      </MapPopup>
    </Polygon>
  );
});

function TfrCard({ tfr, active }: { tfr: Tfr; active: boolean }) {
  return (
    <MapCard
      // A TFR's badge, red while it is in force, as its shape is drawn.
      media={<RowBadge colour={active ? TFR_RED : BADGE.other}><Ban /></RowBadge>}
      title={`TFR ${tfr.notam_id}`} subtitle={[tfr.kind, active ? "In force now" : "Not yet in force"].filter(Boolean).join(" · ")}
    >
      <div className="space-y-1 text-left" data-testid="tfr-card">
        {tfrAltitudes(tfr) && <p>{tfrAltitudes(tfr)}</p>}
        {tfrTimes(tfr) && <p>{tfrTimes(tfr)}</p>}
        {(tfr.purpose ?? tfr.rule) && <p className="text-muted-foreground">{tfr.purpose ?? tfr.rule}</p>}
        <a className="text-tint" href={`https://tfr.faa.gov/tfr3/?page=detail_${tfr.notam_id.replace("/", "_")}`} target="_blank" rel="noreferrer">
          The NOTAM on tfr.faa.gov
        </a>
      </div>
    </MapCard>
  );
}
