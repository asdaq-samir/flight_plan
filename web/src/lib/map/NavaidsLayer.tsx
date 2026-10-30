import { memo, useMemo } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import L from "leaflet";
import { Marker, Pane } from "react-leaflet";
import { api } from "../api/client";
import type { FixPin, VorPin } from "../api/types";
import { usePreferences } from "../preferences";
import { enrouteFixIcon, vorIcon } from "./airspaceMarks";
import { useAhead, useLiveZoom } from "./useView";
import { MapCard } from "./MapCard";
import { MapPopup } from "./MapPopup";
import { PointWhere } from "./PointWhere";

/** The VORs from a region's zoom in: a few to a state, each a station a
 *  pilot tunes, and the chart's compass roses round them. */
const VOR_ZOOM = 8;
/** The enroute chart's fixes only close in: further out there are dozens
 *  to a county, a scatter over the chart's own marks. */
const FIX_ZOOM = 10;

/** Over the airspace's lines and labels (AirspaceLayer's 350 and 355),
 *  under the overlay pane's course line (400) and the airports' marks. */
const NAVAIDS_Z = 360;

const NO_VORS: VorPin[] = [];
const NO_FIXES: FixPin[] = [];

/**
 * The VORs over the chart as the sectional marks them, a blue hexagon
 * with its ident beside it, and from closer in the low enroute chart's
 * fixes as small triangles -- with the airspace (AirspaceLayer), the
 * owner's pick of the map's looks ("C", after ForeFlight's). A tap opens
 * its card -- what it is, a VOR's name and frequency, and where it is --
 * at the owner's ask ("the VORs or any other fix or navaid should be
 * selectable", 2026-10-29). The settings' VORs and Fixes turns them off.
 */
export function NavaidsLayer() {
  const show = usePreferences(s => s.navaids);
  const zoom = useLiveZoom();
  const asked = useAhead();
  const on = show && zoom >= VOR_ZOOM;
  const withFixes = zoom >= FIX_ZOOM;
  const { data } = useQuery({
    queryKey: ["navaidsInView", asked.key, withFixes],
    queryFn: () => api.navaidsInView(asked.box, withFixes),
    enabled: on,
    staleTime: Infinity,
    placeholderData: keepPreviousData,
    meta: { silent: true },
  });
  const vors = data?.vors ?? NO_VORS;
  // Not the fixes of an answer kept from closer in, zoomed back out.
  const fixes = withFixes ? (data?.fixes ?? NO_FIXES) : NO_FIXES;
  if (!on) return null;
  return (
    <Pane name="navaids" style={{ zIndex: NAVAIDS_Z }}>
      {fixes.map(f => <FixMark key={f.ident} fix={f} />)}
      {vors.map(v => <VorMark key={`${v.ident}-${v.lat}`} vor={v} />)}
    </Pane>
  );
}

/** A tap on a mark kept off the map under it. A constant: react-leaflet
 *  binds a marker's handlers again whenever they are a new object. */
const STOP_CLICK = { click: (e: L.LeafletMouseEvent) => L.DomEvent.stopPropagation(e) };

/** A VOR's mark on its card: the sectional's blue hexagon. */
const HEXAGON = (
  <svg className="mx-1 shrink-0" width="18" height="18" viewBox="0 0 16 16" aria-hidden="true">
    <polygon points="15,8 11.5,14.06 4.5,14.06 1,8 4.5,1.94 11.5,1.94" fill="#fff" stroke="#1e5bb8" strokeWidth="2" />
    <circle cx="8" cy="8" r="1.6" fill="#1e5bb8" />
  </svg>
);
/** An enroute fix's on its card: the low chart's triangle, as the map's. */
const TRIANGLE = (
  <svg className="mx-1 shrink-0" width="16" height="16" viewBox="0 0 10 10" aria-hidden="true">
    <polygon points="5,1 9.4,8.8 0.6,8.8" fill="#fff" stroke="#1c1a17" strokeWidth="1.2" strokeLinejoin="round" />
  </svg>
);

const VorMark = memo(function VorMark({ vor }: { vor: VorPin }) {
  const position = useMemo<[number, number]>(() => [vor.lat, vor.lon], [vor.lat, vor.lon]);
  return (
    <Marker position={position} icon={vorIcon(vor.ident)} eventHandlers={STOP_CLICK} title={`${vor.ident} ${vor.kind}`}>
      <MapPopup pane="popupPane" panOnce>
        <MapCard
          media={HEXAGON}
          title={<>{vor.ident}<span className="font-normal text-muted-foreground">{vor.kind}</span></>}
          subtitle={[vor.name, vor.freq].filter(Boolean).join(" · ") || undefined}
        >
          <PointWhere lat={vor.lat} lon={vor.lon} />
        </MapCard>
      </MapPopup>
    </Marker>
  );
});

const FixMark = memo(function FixMark({ fix }: { fix: FixPin }) {
  const position = useMemo<[number, number]>(() => [fix.lat, fix.lon], [fix.lat, fix.lon]);
  return (
    <Marker position={position} icon={enrouteFixIcon(fix.ident)} eventHandlers={STOP_CLICK} title={`${fix.ident} fix`}>
      <MapPopup pane="popupPane" panOnce>
        <MapCard media={TRIANGLE} title={<>{fix.ident}<span className="font-normal text-muted-foreground">Fix</span></>}>
          <PointWhere lat={fix.lat} lon={fix.lon} />
        </MapCard>
      </MapPopup>
    </Marker>
  );
});
