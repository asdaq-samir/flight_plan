import L from "leaflet";
import { memo, useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Pane, Polyline, useMap, useMapEvents } from "react-leaflet";
import { api } from "../api/client";
import type { AirspaceVolume } from "../api/types";
import { usePreferences } from "../preferences";
import { cn } from "cn";
import { TEXT } from "../text";
import { airspaceFacts, airspaceLabel } from "./airspaceLabel";
import { AIRSPACE_LINE, AIRSPACE_TAP } from "./airspaceMarks";
import { airportBox, overlaps, useDrawnAirports, type Box } from "./declutter";
import { edgeSpots, spotBox } from "./edgeLabels";
import { MapCard } from "./MapCard";
import { Button } from "../../components/ui/button";
import { ListGroup, ListRow } from "../../components/GroupedList";
import { callTypes, entryRules } from "../airspaceRules";
import { mhzText } from "../frequencies";
import { airportQuery } from "../queryClient";
import { usePointActions } from "./pointActions";
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
        {near && <EdgeLabels volumes={volumes} zoom={zoom} />}
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

/** The words along the lines: 11 px bold, the map's smallest type, each
 *  letter guessed a little wide (declutter's), and the room they take
 *  across with their halo. */
const EDGE_TEXT_PX = 11;
const EDGE_LETTER_PX = 7;
const EDGE_HEIGHT_PX = 14;
/** No altitudes this close to an airport's mark or its ident, px: the
 *  field is what a pilot reads there. */
const AIRPORT_CLEAR_PX = 20;

/** The words' ink, the line's own hue a shade darker by day and as it is
 *  or lighter at night (index.css), 5.1:1 or more on their halo either
 *  way: over WCAG's 4.5:1 for small type. */
const INK: Record<AirspaceVolume["airspace_class"], string> = {
  B: "var(--airspace-edge-blue)", C: "var(--airspace-edge-magenta)", D: "var(--airspace-edge-blue)",
};
/** A halo of the map's own ground round each letter, white by day and
 *  the sheet's dark at night, so the words read over the chart's own
 *  print without a plate of their own (the owner, 2026-10-29). */
const EDGE_STYLE = {
  fontSize: EDGE_TEXT_PX, fontWeight: 700, fontVariantNumeric: "tabular-nums",
  stroke: "var(--airspace-halo)", strokeWidth: 3, strokeLinejoin: "round", paintOrder: "stroke",
} as const;

/** A volume's altitudes on one line, as ForeFlight writes them: a Class B
 *  or C shelf's "100/30", a Class D's ceiling alone ("-30" under a Class
 *  B shelf), the wording the sectional's (lib/map/airspaceLabel). */
function edgeText(volume: AirspaceVolume): string | null {
  const label = airspaceLabel(volume);
  if (!label) return null;
  return label.kind === "shelf" ? `${label.top}/${label.floor}` : label.ceiling;
}

interface EdgeWords { key: string; x: number; y: number; angle: number; text: string; ink: string }

/**
 * Every volume's altitudes written along its own lines, just inside it
 * and a few times round a long one (lib/map/edgeLabels), as ForeFlight's
 * Chicago map writes them (the owner's ask, 2026-10-30), clear of the
 * airports' marks. One SVG for all of them, in the map's pixels at this
 * zoom: a pan moves it with the pane and costs nothing, and the words are
 * worked out again only when the zoom, the volumes or the airports drawn
 * change. Hidden while a zoom or pinch is under way, when its pixels are
 * the zoom's before, and shown again at the new zoom's once it ends.
 */
const EdgeLabels = memo(function EdgeLabels({ volumes, zoom }: { volumes: AirspaceVolume[]; zoom: number }) {
  const map = useMap();
  const fields = useDrawnAirports(s => s.fields);
  const holder = useRef<HTMLDivElement>(null);
  const zooming = useRef(false);
  const words = useMemo(() => {
    const at = (lat: number, lon: number) => map.project([lat, lon], zoom);
    const clear: Box[] = fields.map(f => {
      const b = airportBox(at(f.lat, f.lon), f.ident);
      return { x0: b.x0 - AIRPORT_CLEAR_PX, y0: b.y0 - AIRPORT_CLEAR_PX, x1: b.x1 + AIRPORT_CLEAR_PX, y1: b.y1 + AIRPORT_CLEAR_PX };
    });
    const out: EdgeWords[] = [];
    for (const volume of volumes) {
      const text = edgeText(volume);
      if (!text) continue;
      const width = text.length * EDGE_LETTER_PX;
      volume.lines.forEach((line, n) => {
        const points = line.map(p => at(p[0]!, p[1]!));
        edgeSpots(points, width).forEach((spot, i) => {
          if (clear.some(b => overlaps(b, spotBox(spot, width, EDGE_HEIGHT_PX)))) return;
          out.push({
            key: `${volume.id}-${n}-${i}`, x: Math.round(spot.x * 10) / 10, y: Math.round(spot.y * 10) / 10,
            angle: Math.round(spot.angle * 10) / 10, text, ink: INK[volume.airspace_class],
          });
        });
      });
    }
    return { zoom, out };
  }, [map, volumes, zoom, fields]);

  // The SVG's corner at the world's pixel origin, so the words' world
  // pixels land where the pane's own do; shown only once they are this
  // zoom's.
  const place = useCallback(() => {
    const el = holder.current;
    if (!el || zooming.current || words.zoom !== map.getZoom()) return;
    L.DomUtil.setPosition(el, map.getPixelOrigin().multiplyBy(-1));
    el.style.visibility = "";
  }, [map, words]);
  useMapEvents(useMemo(() => ({
    zoomstart: () => {
      zooming.current = true;
      if (holder.current) holder.current.style.visibility = "hidden";
    },
    zoomend: () => {
      zooming.current = false;
      place();
    },
    viewreset: place,
  }), [place]));
  useLayoutEffect(place, [place]);

  return (
    <div ref={holder} className="pointer-events-none absolute left-0 top-0" style={HOLDER_STYLE}>
      <svg width="1" height="1" overflow="visible" aria-hidden="true" style={EDGE_STYLE}>
        {words.out.map(w => (
          <text
            key={w.key} data-airspace-edge-label="" x={w.x} y={w.y} transform={`rotate(${w.angle} ${w.x} ${w.y})`}
            fill={w.ink} textAnchor="middle" dominantBaseline="central"
          >{w.text}</text>
        ))}
      </svg>
    </div>
  );
});

/** Hidden until it is placed at this zoom (EdgeLabels' place). */
const HOLDER_STYLE = { visibility: "hidden" } as const;
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
