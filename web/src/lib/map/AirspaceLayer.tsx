import { memo, useMemo } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Marker, Pane, Polyline } from "react-leaflet";
import { api } from "../api/client";
import type { AirspaceVolume } from "../api/types";
import { usePreferences } from "../preferences";
import { airspaceLabel } from "./airspaceLabel";
import { AIRSPACE_LINE, airspaceLabelIcon } from "./airspaceMarks";
import { useAhead, useLiveZoom } from "./useView";

/** From this zoom in, as the airports' and the VFR waypoints': further
 *  out the chart's own lines are as much as a phone can read, and a box
 *  there holds a few states' airspace. */
const FROM_ZOOM = 8;

/** Under the route and everything on it, the airports' marks and the VFR
 *  waypoints' diamonds (440 and up) and Leaflet's own overlay pane (400),
 *  where the course line and the TFRs are drawn: over the chart's tiles. */
const LINES_Z = 350;
const LABELS_Z = 355;

const NONE: AirspaceVolume[] = [];

/**
 * The Class B, C and D over the chart, the owner's pick of the map's
 * looks ("C", after ForeFlight's): each volume's line from the FAA's own
 * airspace file -- the one the chart is drawn from, so it lies on the
 * chart's printed ring however irregular -- and its altitudes on it as
 * the sectional prints them (lib/map/airspaceLabel). Lines and labels
 * alike are not targets: a tap there is the chart's, its Airspace card.
 * The settings' Airspace turns them off.
 */
export function AirspaceLayer() {
  const show = usePreferences(s => s.airspace);
  // Asked for as the airports' marks are (useAhead, useLiveZoom): the view
  // and a screen round it, again under a finger's pan or pinch.
  const zoom = useLiveZoom();
  const asked = useAhead();
  const on = show && zoom >= FROM_ZOOM;
  const { data } = useQuery({
    queryKey: ["airspaceInView", asked.key],
    queryFn: () => api.airspaceInView(asked.box),
    enabled: on,
    staleTime: Infinity,
    placeholderData: keepPreviousData,
    meta: { silent: true },
  });
  const volumes = data ?? NONE;
  if (!on) return null;
  return (
    <>
      <Pane name="airspace" style={{ zIndex: LINES_Z }}>
        {volumes.map(v => <VolumeLines key={v.id} volume={v} />)}
      </Pane>
      <Pane name="airspace-labels" style={{ zIndex: LABELS_Z }}>
        {volumes.map(v => <VolumeLabel key={v.id} volume={v} />)}
      </Pane>
    </>
  );
}

/** One volume's lines, drawn again only when its answer changes. */
const VolumeLines = memo(function VolumeLines({ volume }: { volume: AirspaceVolume }) {
  return <Polyline positions={volume.lines as [number, number][][]} pathOptions={AIRSPACE_LINE[volume.airspace_class]} interactive={false} />;
});

/** One volume's label, one a volume, on the volume. */
const VolumeLabel = memo(function VolumeLabel({ volume }: { volume: AirspaceVolume }) {
  const position = useMemo<[number, number]>(() => [volume.label_lat, volume.label_lon], [volume.label_lat, volume.label_lon]);
  const label = airspaceLabel(volume);
  if (!label) return null;
  return <Marker position={position} icon={airspaceLabelIcon(label, volume.airspace_class)} interactive={false} keyboard={false} />;
});
