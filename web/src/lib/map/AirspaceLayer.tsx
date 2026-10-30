import L from "leaflet";
import { memo, useMemo } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Marker, Pane, Polyline } from "react-leaflet";
import { api } from "../api/client";
import type { AirspaceVolume } from "../api/types";
import { usePreferences } from "../preferences";
import { cn } from "cn";
import { TEXT } from "../text";
import { airspaceFacts, airspaceLabel } from "./airspaceLabel";
import { AIRSPACE_LINE, AIRSPACE_TAP, airspaceLabelIcon } from "./airspaceMarks";
import { MapCard } from "./MapCard";
import { MapPopup } from "./MapPopup";
import { useAhead, useLiveZoom } from "./useView";

/** From this zoom in, as the airports' and the VFR waypoints', the Class
 *  C and D and every label: further out they are a scatter of small rings
 *  over a few states. */
const FROM_ZOOM = 8;
/** The Class B's lines from a few states' zoom, as the airline airports'
 *  marks are (AirportsLayer), at the owner's ask (2026-10-29, "Maybe
 *  class B from 4?", then two levels in from that): the big rings a pilot
 *  plans round, there before anything else. Unlabelled until FROM_ZOOM. */
const CLASS_B_FROM_ZOOM = 6;
/** The Class C's lines a zoom before the D's, at the owner's ask
 *  (2026-10-29, "Show c airspace from 7"); unlabelled until FROM_ZOOM. */
const CLASS_C_FROM_ZOOM = 7;

/** Under the route and everything on it, the airports' marks and the VFR
 *  waypoints' diamonds (440 and up) and Leaflet's own overlay pane (400),
 *  where the course line and the TFRs are drawn: over the chart's tiles. */
const LINES_Z = 350;
const LABELS_Z = 355;

/** The lines' tap targets over Leaflet's overlay pane (400), whose SVG
 *  covers the map and would take a tap meant for a pane under it, and
 *  under the VFR waypoints (440) and the airports' marks, which keep
 *  theirs. The pane itself takes none (pointer-events none, which its
 *  SVG inherits), only the targets on it (Leaflet's .leaflet-interactive):
 *  so a TFR or the course line under it is still tapped off the rings. */
const TAPS_Z = 430;

// The panes' styles, constants as react-leaflet's are (measure-speed's
// known costs).
const LINES_PANE = { zIndex: LINES_Z };
const LABELS_PANE = { zIndex: LABELS_Z };
const TAPS_PANE = { zIndex: TAPS_Z, pointerEvents: "none" } as const;

const NONE: AirspaceVolume[] = [];

/**
 * The Class B, C and D over the chart, the owner's pick of the map's
 * looks ("C", after ForeFlight's): each volume's line from the FAA's own
 * airspace file -- the one the chart is drawn from, so it lies on the
 * chart's printed ring however irregular -- and its altitudes on it as
 * the sectional prints them (lib/map/airspaceLabel). A tap on a line
 * opens the volume's card: its class, name, floor, ceiling and hours
 * (the owner, 2026-10-29: "make the airspace rings selectable with more
 * info"). The labels are not targets. The settings' Airspace turns them
 * off.
 */
export function AirspaceLayer() {
  const show = usePreferences(s => s.airspace);
  // Asked for as the airports' marks are (useAhead, useLiveZoom): the view
  // and a screen round it, again under a finger's pan or pinch.
  const zoom = useLiveZoom();
  const asked = useAhead();
  const on = show && zoom >= CLASS_B_FROM_ZOOM;
  const near = zoom >= FROM_ZOOM;
  const classes = near ? "BCD" : zoom >= CLASS_C_FROM_ZOOM ? "BC" : "B";
  const { data } = useQuery({
    queryKey: ["airspaceInView", asked.key, classes],
    queryFn: () => api.airspaceInView({ ...asked.box, classes }),
    enabled: on,
    staleTime: Infinity,
    placeholderData: keepPreviousData,
    meta: { silent: true },
  });
  const volumes = data ?? NONE;
  if (!on) return null;
  return (
    <>
      <Pane name="airspace" style={LINES_PANE}>
        {volumes.map(v => <VolumeLines key={v.id} volume={v} />)}
      </Pane>
      <Pane name="airspace-labels" style={LABELS_PANE}>
        {near && volumes.map(v => <VolumeLabel key={v.id} volume={v} />)}
      </Pane>
      <Pane name="airspace-taps" style={TAPS_PANE}>
        {volumes.map(v => <VolumeTap key={v.id} volume={v} />)}
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

/** A tap on a ring kept off the map under it, whose own tap is the
 *  chart's Airspace card. A constant: react-leaflet binds a path's
 *  handlers again whenever they are a new object. */
const STOP_CLICK = { click: (e: L.LeafletMouseEvent) => L.DomEvent.stopPropagation(e) };

/** One volume's tap target, unseen over its line, and its card, made
 *  only once it is opened (MapPopup); drawn again only when its answer
 *  changes. */
const VolumeTap = memo(function VolumeTap({ volume }: { volume: AirspaceVolume }) {
  return (
    <Polyline
      positions={volume.lines as [number, number][][]} pathOptions={AIRSPACE_TAP[volume.airspace_class]} eventHandlers={STOP_CLICK}
      // Its class as an option of its own: react-leaflet gives pathOptions
      // to setStyle, which sets no class, so the browser tests found none.
      className={AIRSPACE_TAP[volume.airspace_class].className}
    >
      {/* In Leaflet's own pane, over the marks, as the waypoints' card;
          a line's, so no ring at the point tapped. */}
      <MapPopup pane="popupPane" panOnce ring={false}>
        <AirspaceCard volume={volume} />
      </MapPopup>
    </Polyline>
  );
});

/** A short length of the volume's line as the map draws it, before its
 *  title: solid blue, solid magenta or dashed blue. */
function Swatch({ volume }: { volume: AirspaceVolume }) {
  const line = AIRSPACE_LINE[volume.airspace_class];
  return (
    <svg aria-hidden="true" width="28" height="8" viewBox="0 0 28 8" className="mx-1 shrink-0">
      <line x1="0" y1="4" x2="28" y2="4" stroke={line.color} strokeWidth={line.weight} strokeDasharray={typeof line.dashArray === "string" ? line.dashArray : undefined} />
    </svg>
  );
}

function AirspaceCard({ volume }: { volume: AirspaceVolume }) {
  const facts = airspaceFacts(volume);
  const rows: [string, string][] = [["Floor", facts.floor], ["Ceiling", facts.ceiling]];
  if (facts.hours) rows.push(["Hours", facts.hours]);
  return (
    <MapCard
      media={<Swatch volume={volume} />} title={`Class ${volume.airspace_class}`} subtitle={facts.name}
      // In the pill its name and place on the ring's own colour, as an
      // airport's is its picture (MapCard's `pill`).
      pill={{ name: `Class ${volume.airspace_class}`, line: facts.name, colour: AIRSPACE_LINE[volume.airspace_class].color }}
    >
      <dl className={cn("grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-left", TEXT.row)} data-testid="airspace-card">
        {rows.map(([term, value]) => (
          <div key={term} className="contents">
            <dt className="text-muted-foreground">{term}</dt>
            <dd className="tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
    </MapCard>
  );
}
