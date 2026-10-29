import { memo, useMemo } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Marker, Pane } from "react-leaflet";
import { api } from "../api/client";
import type { FixPin, VorPin } from "../api/types";
import { usePreferences } from "../preferences";
import { enrouteFixIcon, vorIcon } from "./airspaceMarks";
import { useAhead, useLiveZoom } from "./useView";

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
 * owner's pick of the map's looks ("C", after ForeFlight's). Not targets.
 * The settings' VORs and Fixes turns them off.
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

const VorMark = memo(function VorMark({ vor }: { vor: VorPin }) {
  const position = useMemo<[number, number]>(() => [vor.lat, vor.lon], [vor.lat, vor.lon]);
  return <Marker position={position} icon={vorIcon(vor.ident)} interactive={false} keyboard={false} />;
});

const FixMark = memo(function FixMark({ fix }: { fix: FixPin }) {
  const position = useMemo<[number, number]>(() => [fix.lat, fix.lon], [fix.lat, fix.lon]);
  return <Marker position={position} icon={enrouteFixIcon(fix.ident)} interactive={false} keyboard={false} />;
});
