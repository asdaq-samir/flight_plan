import L from "leaflet";
import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, QueryObserver, useQuery } from "@tanstack/react-query";
import { Pane, useMap, useMapEvents } from "react-leaflet";
import { api } from "../api/client";
import type { AirspaceVolume } from "../api/types";
import { usePreferences } from "../preferences";
import { cn } from "cn";
import { TEXT } from "../text";
import { airspaceFacts, airspaceLabel } from "./airspaceLabel";
import { AIRSPACE_LINE } from "./airspaceMarks";
import { useDrawnAirports } from "./declutter";
import { edgeAnchors } from "./edgeLabels";
import { AirspaceLabelsLayer, type CanvasEdgeLabel } from "./AirspaceLabelsCanvas";
import { AirspaceLinesLayer } from "./AirspaceLinesCanvas";
import { MapCard } from "./MapCard";
import { Button } from "../../components/ui/button";
import { ListGroup, ListRow } from "../../components/GroupedList";
import { callTypes, entryRules } from "../airspaceRules";
import { mhzText } from "../frequencies";
import { airportQuery, queryClient } from "../queryClient";
import { usePointActions } from "./pointActions";
import { MapPopup } from "./MapPopup";
import { useAhead, useLiveZoom } from "./useView";
import type { Box } from "./view";

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

// The panes' styles, constants as react-leaflet's are (measure-speed's
// known costs).
const LINES_PANE = { zIndex: LINES_Z };
const LABELS_PANE = { zIndex: LABELS_Z };

const NONE: AirspaceVolume[] = [];

/** The volumes already drawn, by their id and the box's height their
 *  lines were simplified for (the planner's tolerance_for): a pan into a
 *  new box answers with the same rings, and each kept as the same object
 *  is not projected again (AirspaceLinesLayer, by the object) nor its tap
 *  made again (VolumeTap is memo). New objects, every ring on the map was
 *  taken off its line and put back, its tap too, at each box a pan or a
 *  pinch asked for. */
const drawn = new Map<string, AirspaceVolume>();
/** The most kept, a few states' worth, before they are let go. */
const MOST_KEPT = 3000;

function kept(volumes: AirspaceVolume[], box: { south: number; north: number }): AirspaceVolume[] {
  if (drawn.size > MOST_KEPT) drawn.clear();
  const height = box.north - box.south;
  return volumes.map(v => {
    const key = `${v.id}|${height}`;
    const was = drawn.get(key);
    if (was) return was;
    drawn.set(key, v);
    return v;
  });
}

/**
 * The Class B, C and D over the chart, the owner's pick of the map's
 * looks ("C", after ForeFlight's): each volume's line from the FAA's own
 * airspace file -- the one the chart is drawn from, so it lies on the
 * chart's printed ring however irregular -- and its altitudes written
 * along it, just inside, as ForeFlight writes them (EdgeLabels). A tap on a line
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
  const query = useMemo(() => airspaceQuery(asked, classes), [asked, classes]);
  const { data } = useQuery({ ...query, enabled: on, placeholderData: keepPreviousData });
  const volumes = data ?? NONE;
  if (!on) return null;
  return (
    <>
      <Pane name="airspace" style={LINES_PANE}>
        <Lines query={query} />
      </Pane>
      <Pane name="airspace-labels" style={LABELS_PANE}>
        {near && <EdgeLabels volumes={volumes} />}
      </Pane>
    </>
  );
}

/** How near a tap must be to a ring's line to open its card, px each
 *  side: the unseen 20 px line that took it before. */
const TAP_PX = 10;
/** Within this of a field's mark a tap is the field's (AirportsLayer's
 *  own reach, a finger's half-width). */
const MARK_PX = 22;

/**
 * The volumes' lines on a canvas kept on the chart (AirspaceLinesLayer),
 * as the airports' marks and the altitudes are: whole however the map
 * is moved, where Leaflet's SVG cut a ring straight at its renderer's
 * box (the owner's screenshots, 2026-11-02 and 2026-11-03).
 */
function Lines({ query }: { query: AirspaceQuery }) {
  const map = useMap();
  const [layer] = useState(() => new AirspaceLinesLayer("airspace"));
  useEffect(() => {
    layer.addTo(map);
    return () => { layer.remove(); };
  }, [map, layer]);
  // A tap on a ring is the map's own click, given to the volume whose
  // line is nearest within a finger's reach (AirspaceLinesLayer.volumeAt),
  // as a tap on a field's mark is (AirportsLayer): the field's catches the
  // click first and keeps it where a mark is near, so a mark on a ring
  // opens the field. A tap on a marker or a line with a tap of its own
  // (a checkpoint, a TFR) is theirs. Each volume had an unseen 20 px line
  // of Leaflet's SVG over its own for this: fifty of them projected and
  // written out again at every zoom's end, and made anew with each box's
  // answer, a tenth of the main thread's work after a zoom (a profile on
  // the phone viewport at CPU 4x, 2026-11-03).
  const [picked, setPicked] = useState<{ volume: AirspaceVolume; at: L.LatLng } | null>(null);
  useMapEvents(useMemo(() => ({
    click: (e: L.LeafletMouseEvent) => {
      const target = e.originalEvent.target as Element | null;
      if (target?.closest(".leaflet-marker-icon, .leaflet-popup, path.leaflet-interactive")) return;
      // Near a field's mark the tap is the field's: the fields' layer
      // takes it first, but on the map's container itself (a tap on the
      // chart, under which every pane lets the pointer through) its
      // stopPropagation does not keep the click from Leaflet, which
      // listens on the same element.
      const near = useDrawnAirports.getState().fields.some(f => map.latLngToContainerPoint([f.lat, f.lon]).distanceTo(e.containerPoint) <= MARK_PX);
      if (near) return;
      const volume = layer.volumeAt(e.containerPoint, TAP_PX);
      // The same ring tapped again keeps its card where it was.
      setPicked(was => (volume ? (was?.volume === volume ? was : { volume, at: e.latlng }) : null));
    },
  }), [layer, map]));
  const closed = useMemo<L.LeafletEventHandlerFnMap>(() => ({ remove: () => setPicked(null) }), []);
  // The box's answer goes straight to the layer as it comes, through an
  // observer of the same cached query, not after React has rendered all
  // else the zoom changed -- the airports' answer merged into its marks,
  // the lists, the altitudes and the taps below. Set from an effect, the
  // rings for the new view came 0.4 to 1.2 s after the zoom's animation
  // had ended on a busy main thread (a probe on the phone viewport at CPU
  // 4x, 2026-11-03, Chicago from 7 to 9: the planner's answer back at
  // 0.6 s, mid-animation; the Class D rings drawn at 1.9 s), at the
  // owner's "why do the rings take a while to redraw?". The layer keeps
  // the last box's rings until the next box's come.
  useEffect(() => {
    const observer = new QueryObserver(queryClient, query);
    const apply = ({ data }: { data?: AirspaceVolume[] }) => { if (data) layer.set(data); };
    apply(observer.getCurrentResult());
    return observer.subscribe(apply);
  }, [layer, query]);
  if (!picked) return null;
  return (
    /* In Leaflet's own pane, over the marks, as the waypoints' card; a
       line's, so no ring at the point tapped. Put away by a tap on the
       chart or the card's close (MapPopup), which is heard here. */
    <MapPopup key={picked.volume.id} position={picked.at} pane="popupPane" panOnce ring={false} eventHandlers={closed}>
      <AirspaceCard volume={picked.volume} />
    </MapPopup>
  );
}

/** The planner asked for a box's volumes, once per box and classes (the
 *  query cache): the lines' layer, the altitudes and the taps share it. */
function airspaceQuery(asked: Box, classes: string) {
  return {
    queryKey: ["airspaceInView", asked.key, classes],
    queryFn: () => api.airspaceInView({ ...asked.box, classes }).then(volumes => kept(volumes, asked.box)),
    staleTime: Infinity,
    meta: { silent: true },
  };
}
type AirspaceQuery = ReturnType<typeof airspaceQuery>;

/** The words' width on the screen, each letter guessed a little wide
 *  (declutter's), for where they fit along a line. */
const EDGE_LETTER_PX = 7;
/** The zoom the labels' places are worked out at: finer than the chart's
 *  own, so a label is on its line at every zoom it is drawn at. */
const EDGE_ZOOM = 13;

/** The words' ink, the line's own hue a shade darker by day and as it is
 *  or lighter at night (index.css), 5.1:1 or more on their halo either
 *  way: over WCAG's 4.5:1 for small type. */
const INK: Record<AirspaceVolume["airspace_class"], string> = {
  B: "--airspace-edge-blue", C: "--airspace-edge-magenta", D: "--airspace-edge-blue",
};

/** A volume's altitudes on one line, as ForeFlight writes them: a Class B
 *  or C shelf's "100/30", a Class D's ceiling alone ("-30" under a Class
 *  B shelf), the wording the sectional's (lib/map/airspaceLabel). */
function edgeText(volume: AirspaceVolume): string | null {
  const label = airspaceLabel(volume);
  if (!label) return null;
  return label.kind === "shelf" ? `${label.top}/${label.floor}` : label.ceiling;
}

/** A volume's labels where they lie on its lines, worked out once for
 *  each answer: the same at every zoom (edgeAnchors). */
const anchorsOf = new WeakMap<AirspaceVolume, CanvasEdgeLabel[]>();
function volumeLabels(map: L.Map, volume: AirspaceVolume): CanvasEdgeLabel[] {
  let labels = anchorsOf.get(volume);
  if (labels) return labels;
  labels = [];
  const text = edgeText(volume);
  if (text) {
    volume.lines.forEach((line, n) => {
      const points = line.map(p => map.project([p[0]!, p[1]!], EDGE_ZOOM));
      edgeAnchors(points, text.length * EDGE_LETTER_PX, EDGE_ZOOM).forEach((a, i) => {
        const at = map.unproject([a.x, a.y], EDGE_ZOOM);
        labels!.push({
          key: `${volume.id}-${n}-${i}`, lat: at.lat, lon: at.lng, dx: a.dx, dy: a.dy, angle: Math.round(a.angle * 10) / 10,
          from: a.from, text, ink: INK[volume.airspace_class],
        });
      });
    });
  }
  anchorsOf.set(volume, labels);
  return labels;
}

/**
 * Every volume's altitudes written along its own lines, just inside it
 * and a few times round a long one, as ForeFlight's Chicago map writes
 * them (the owner's ask, 2026-10-30), clear of the airports' marks: on a
 * canvas that keeps each where it is on its line and its size through a
 * zoom (AirspaceLabelsLayer), more coming in between them going in.
 */
function EdgeLabels({ volumes }: { volumes: AirspaceVolume[] }) {
  const map = useMap();
  const fields = useDrawnAirports(s => s.fields);
  const [layer] = useState(() => new AirspaceLabelsLayer("airspace-labels"));
  useEffect(() => {
    layer.addTo(map);
    return () => { layer.remove(); };
  }, [map, layer]);
  useEffect(() => {
    layer.set(volumes.flatMap(v => volumeLabels(map, v)), fields);
  }, [map, layer, volumes, fields]);
  return null;
}

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
  const map = useMap();
  const avoid = usePointActions(s => s.avoidClassB);
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
      <AirspaceCall volume={volume} />
      {/* What it takes to go in, each rule with its section (lib/airspaceRules),
          at the owner's ask for cards that say what a pilot does there
          (2026-10-30). */}
      <div data-testid="airspace-rules">
        <ListGroup title="To enter">
          {entryRules(volume.airspace_class).map(r => (
            <ListRow key={r.rule} title={<span className={TEXT.detail}>{r.rule}</span>} description={r.cite} />
          ))}
        </ListGroup>
      </div>
      {volume.airspace_class === "B" && avoid && (
        <Button type="button" variant="secondary" className="w-full text-tint" onClick={() => { map.closePopup(); avoid(); }} data-testid="airspace-avoid">
          Route Around Class B
        </Button>
      )}
    </MapCard>
  );
}

/** Who to call before entering, from the primary airport's frequencies
 *  (NASR FRQ): its approach control for a Class B or C, its tower for a
 *  Class D; the first three. */
function AirspaceCall({ volume }: { volume: AirspaceVolume }) {
  const { data: field } = useQuery({ ...airportQuery(volume.ident ?? ""), enabled: !!volume.ident });
  const types = callTypes(volume.airspace_class);
  const calls = (field?.frequencies ?? []).filter(f => f.frequency_mhz != null && types.includes((f.type ?? "").toUpperCase()));
  // Approach where it has one, else the tower.
  const first = types.find(type => calls.some(f => f.type?.toUpperCase() === type));
  const shown = calls.filter(f => f.type?.toUpperCase() === first).slice(0, 3);
  if (!shown.length) return null;
  return (
    <div data-testid="airspace-call">
      <ListGroup title={first === "APP" ? "Call approach" : "Call the tower"}>
        {shown.map((f, i) => (
          <ListRow
            key={`${f.frequency_mhz}-${i}`} title={<span className={TEXT.detail}>{f.description ?? f.type}</span>}
            value={<span className="font-semibold text-foreground tabular-nums">{mhzText(f.frequency_mhz!)}</span>}
          />
        ))}
      </ListGroup>
    </div>
  );
}
