import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "cn";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import L from "leaflet";
import { Pane, useMap, useMapEvents } from "react-leaflet";
import { ListGroup, ListRow } from "../../components/GroupedList";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../../components/ui/collapsible";
import { declinationOf, fixRadialDistance, hoursOf, morseOf, radialOf, serviceVolume, threeFigures } from "../navaid";
import { TEXT } from "../text";
import { feet } from "../units";
import { useOwnFix } from "./ownShip";
import { PointActions } from "./PointCardActions";
import { usePointActions } from "./pointActions";
import { api } from "../api/client";
import type { FixPin, VorPin } from "../api/types";
import { usePreferences } from "../preferences";
import { airportBox, overlaps, ownShipBox, useDrawnAirports, vorTagBoxes, vorTagSide, type TagSide } from "./declutter";
import { useOwnShipNear } from "./ownShip";
import { useAhead, useLiveZoom } from "./useView";
import { hovers, type Box } from "./view";
import { MapCard } from "./MapCard";
import { MapPopup } from "./MapPopup";
import { NavaidMarksLayer, type NavaidMark } from "./NavaidCanvas";
import { degreesMinutes } from "../coords";
import { BLUE } from "../useAirspace";
import { nmAway, useAwayWords } from "../useAway";
import { PointWhere } from "./PointWhere";

/** The VORs from a region's zoom in: a few to a state, each a station a
 *  pilot tunes, and the chart's compass roses round them. */
const VOR_ZOOM = 8;
/** The longest the VORs wait for the airports' first answer before they
 *  are drawn anyway. */
const AIRPORTS_WAIT_MS = 2000;
/** The enroute chart's fixes only close in: further out there are dozens
 *  to a county, a scatter over the chart's own marks. */
const FIX_ZOOM = 10;

/** Over the airspace's lines and labels (AirspaceLayer's 350 and 355),
 *  under the overlay pane's course line (400) and the airports' marks. */
const NAVAIDS_Z = 360;
const MARKS_PANE = { zIndex: NAVAIDS_Z };

/** How far off a station a tap on the chart is still the station's: half
 *  a finger's 44 points, the reach its unseen target had. */
export const TAP_PX = 22;
/** How near the mouse names a station: its mark's half-width and a little. */
export const HOVER_PX = 10;

const NO_VORS: VorPin[] = [];
const NO_FIXES: FixPin[] = [];

const vorKey = (v: VorPin) => `${v.ident}-${v.lat}`;

/** Each VOR's tag's side as first chosen, kept: chosen afresh at each
 *  zoom against the airports' marks there, a tag went from right to left
 *  to gone and back as the map zoomed (the owner's audit, 2026-11-02:
 *  the overlay "very dynamic while zooming in"). A tag with no room on
 *  either side is chosen again until it has some. */
const keptSides = new Map<string, TagSide>();

/** Which side of each VOR's hexagon its tag goes, clear of the airports'
 *  marks where it can be (declutter) the first time it is drawn, and on
 *  that side from then on -- but off own ship's airplane, which is never
 *  moved for a VOR, as it flies past. Own ship as it moves a few hundred
 *  metres (useOwnShipNear), not at every fix. */
function useTagSides(vors: VorPin[], zoom: number): Map<string, TagSide> {
  const map = useMap();
  const fields = useDrawnAirports(s => s.fields);
  const ship = useOwnShipNear();
  return useMemo(() => {
    const at = (lat: number, lon: number) => map.project([lat, lon], zoom);
    const blockers = fields.map(f => airportBox(at(f.lat, f.lon), f.ident));
    const shipBox = ship ? ownShipBox(at(ship.lat, ship.lon)) : null;
    return new Map(vors.map(v => {
      const key = vorKey(v);
      const here = at(v.lat, v.lon);
      let side = keptSides.get(key);
      // Chosen again where an airport's mark has come onto it since: a
      // tag drawn before the fields' marks came in (or came into view, as
      // a zoom in brings a Class D's) kept its side under them, DPA's
      // under KDPA's for the rest of the session (a probe, 2026-11-03).
      if (!side || side === "none" || blockers.some(b => overlaps(b, vorTagBoxes(here, v.ident)[side as "right" | "left"]))) {
        side = vorTagSide(here, v.ident, blockers);
        keptSides.set(key, side);
      }
      // Own ship over the kept side: the other, if it is clear of it.
      if (shipBox && side !== "none") {
        const boxes = vorTagBoxes(here, v.ident);
        if (overlaps(shipBox, boxes[side])) {
          const other = side === "right" ? "left" : "right";
          side = overlaps(shipBox, boxes[other]) ? "none" : other;
        }
      }
      return [key, side];
    }));
  }, [map, vors, zoom, fields, ship]);
}

/** What a tap picked: the station's mark and its pin, for its card. */
type Picked = { mark: NavaidMark; vor?: VorPin; fix?: FixPin };

/**
 * The VORs over the chart as the sectional marks them, a blue hexagon
 * with its ident beside it, and from closer in the low enroute chart's
 * fixes as small triangles -- with the airspace (AirspaceLayer), the
 * owner's pick of the map's looks ("C", after ForeFlight's). Drawn on one
 * canvas (NavaidCanvas), not a marker each. A tap opens its card -- what
 * it is, a VOR's name and frequency, and where it is -- at the owner's
 * ask ("the VORs or any other fix or navaid should be selectable",
 * 2026-10-29): the map's own click, given to the nearest station within a
 * finger's half-width, as the airports' marks take theirs. The settings'
 * VORs and Fixes turns them off.
 */
export function NavaidsLayer() {
  const show = usePreferences(s => s.navaids);
  const zoom = useLiveZoom();
  // Asked for as the airports' marks are (useAhead), the question sent
  // from the map's own events.
  const asked = useAhead((box, level) => navaidsQuery(box, level, show));
  const query = navaidsQuery(asked, zoom, show);
  const on = query.enabled;
  const withFixes = zoom >= FIX_ZOOM;
  const { data } = useQuery({ ...query, placeholderData: keepPreviousData });
  const vors = data?.vors ?? NO_VORS;
  // The VORs in view for the other point cards to place a point off the
  // nearest (a VFR waypoint's, WaypointsLayer).
  useEffect(() => { usePointActions.setState({ stations: show ? vors : [] }); }, [vors, show]);
  // Not the fixes of an answer kept from closer in, zoomed back out.
  const fixes = withFixes ? (data?.fixes ?? NO_FIXES) : NO_FIXES;
  const sides = useTagSides(on ? vors : NO_VORS, zoom);
  // Drawn after the airports, as the owner asked ("on the app vors show
  // up first", 2026-11-05): asked for at once, but put on the map once
  // the airports' first answer is in -- or after AIRPORTS_WAIT_MS where
  // none comes (a map without the airports' layer, a planner too slow).
  const airportsIn = useDrawnAirports(s => s.airportsIn);
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setWaited(true), AIRPORTS_WAIT_MS);
    return () => window.clearTimeout(timer);
  }, []);
  const drawn = on && (airportsIn || waited);
  const marks = useMemo((): NavaidMark[] => (drawn ? [
    ...fixes.map((f): NavaidMark => ({ key: `fix-${f.ident}`, ident: f.ident, lat: f.lat, lon: f.lon, kind: "fix", side: "right" })),
    ...vors.map((v): NavaidMark => ({ key: vorKey(v), ident: v.ident, lat: v.lat, lon: v.lon, kind: "vor", side: sides.get(vorKey(v)) ?? "right" })),
  ] : []), [drawn, fixes, vors, sides]);
  if (!on) return null;
  return (
    <Pane name="navaids" style={MARKS_PANE}>
      <NavaidMarks marks={marks} vors={vors} fixes={fixes} />
    </Pane>
  );
}

/** The planner asked for a box's VORs at a zoom, from VOR_ZOOM, and its
 *  fixes with them from FIX_ZOOM; none where the settings' VORs and Fixes
 *  is off. The layer's useQuery and the map's own events (useAhead) ask
 *  it alike. */
export function navaidsQuery(asked: Box, zoom: number, show: boolean) {
  const withFixes = zoom >= FIX_ZOOM;
  return {
    queryKey: ["navaidsInView", asked.key, withFixes],
    queryFn: () => api.navaidsInView(asked.box, withFixes),
    enabled: show && zoom >= VOR_ZOOM,
    staleTime: Infinity,
    meta: { silent: true },
  };
}

/** The canvas the stations are drawn on, made once and given the marks
 *  as they change; a tap's card; and with a mouse, a station named under
 *  the pointer. */
function NavaidMarks({ marks, vors, fixes }: { marks: NavaidMark[]; vors: VorPin[]; fixes: FixPin[] }) {
  const map = useMap();
  const [layer] = useState(() => new NavaidMarksLayer("navaids"));
  useEffect(() => {
    layer.addTo(map);
    return () => { layer.remove(); };
  }, [layer, map]);
  useEffect(() => { layer.setMarks(marks); }, [layer, marks]);
  // The pins by their mark's key, for the card of the one tapped.
  const pins = useRef<{ vors: Map<string, VorPin>; fixes: Map<string, FixPin> }>({ vors: new Map(), fixes: new Map() });
  useEffect(() => {
    pins.current = { vors: new Map(vors.map(v => [vorKey(v), v])), fixes: new Map(fixes.map(f => [`fix-${f.ident}`, f])) };
  }, [vors, fixes]);
  const [picked, setPicked] = useState<Picked | null>(null);
  // A tap near a field's mark never gets here: the airports' layer takes
  // it first (AirportsLayer's capture), as it did when each station's
  // target lay under the field's mark. A tap on a marker, a popup or a
  // line with a tap of its own is theirs. The airspace rings' tap yields
  // to a station (AirspaceLayer, navaidAt).
  useMapEvents(useMemo(() => ({
    click: (e: L.LeafletMouseEvent) => {
      const target = e.originalEvent.target as Element | null;
      if (target?.closest(".leaflet-marker-icon, .leaflet-popup, path.leaflet-interactive")) return;
      const near = layer.nearest(e.containerPoint, TAP_PX)?.mark ?? null;
      setPicked(was => {
        if (!near) return null;
        if (was?.mark.key === near.key) return was;
        return { mark: near, vor: pins.current.vors.get(near.key), fix: pins.current.fixes.get(near.key) };
      });
    },
  }), [layer]));
  const closed = useMemo<L.LeafletEventHandlerFnMap>(() => ({ remove: () => setPicked(null) }), []);
  return (
    <>
      {hovers && <NavaidHover layer={layer} />}
      {picked && (
        /* In Leaflet's own pane, over the marks, as a waypoint's card. Put
           away by a tap on the chart or the card's close (MapPopup). */
        <MapPopup key={picked.mark.key} position={[picked.mark.lat, picked.mark.lon]} pane="popupPane" panOnce eventHandlers={closed}>
          {picked.vor ? <VorCard vor={picked.vor} /> : picked.fix ? <FixCard fix={picked.fix} vors={vors} /> : null}
        </MapPopup>
      )}
    </>
  );
}

/** With a mouse, a station under the pointer named as the markers were
 *  (their titles), and the pointer a hand over it (AirportHover the same). */
export function NavaidHover({ layer }: { layer: NavaidMarksLayer }) {
  const map = useMap();
  const tip = useMemo(() => L.tooltip({ direction: "top", offset: [0, -10], opacity: 1 }), []);
  const frame = useRef(0);
  // The hand set here is taken back here, not the airports' (AirportHover
  // sets and clears its own).
  const hand = useRef(false);
  useEffect(() => () => { cancelAnimationFrame(frame.current); map.closeTooltip(tip); }, [map, tip]);
  useMapEvents(useMemo(() => {
    const off = () => {
      if (hand.current) { map.getContainer().style.cursor = ""; hand.current = false; }
      map.closeTooltip(tip);
    };
    return {
      mousemove: (e: L.LeafletMouseEvent) => {
        cancelAnimationFrame(frame.current);
        frame.current = requestAnimationFrame(() => {
          const near = layer.nearest(e.containerPoint, HOVER_PX)?.mark ?? null;
          if (!near) return off();
          map.getContainer().style.cursor = "pointer";
          hand.current = true;
          tip.setLatLng([near.lat, near.lon]).setContent(near.kind === "vor" ? `${near.ident} VOR` : near.kind === "vfr" ? `${near.ident} VFR waypoint` : `${near.ident} fix`);
          if (!map.hasLayer(tip)) map.openTooltip(tip);
        });
      },
      mouseout: off,
    };
  }, [layer, map, tip]));
  return null;
}

/** A VOR's mark on its card: the sectional's blue hexagon. */
const HEXAGON = (
  <svg className="mx-1 shrink-0" width="18" height="18" viewBox="0 0 16 16" aria-hidden="true">
    <polygon points="15,8 11.5,14.06 4.5,14.06 1,8 4.5,1.94 11.5,1.94" fill="#fff" stroke={BLUE} strokeWidth="2" />
    <circle cx="8" cy="8" r="1.6" fill={BLUE} />
  </svg>
);
/** An enroute fix's on its card: the low chart's triangle, as the map's. */
const TRIANGLE = (
  <svg className="mx-1 shrink-0" width="16" height="16" viewBox="0 0 10 10" aria-hidden="true">
    <polygon points="5,1 9.4,8.8 0.6,8.8" fill="#fff" stroke="#1c1a17" strokeWidth="1.2" strokeLinejoin="round" />
  </svg>
);

/** The chart's colours of the two marks, the ground of their cards' pill:
 *  the VOR's the map's own blue (airspaceMarks' vorIcon), where the card's
 *  was a shade deeper (the owner's pick, 2026-11-03). */
const VOR_BLUE = BLUE;
const FIX_INK = "#1c1a17";

/** Made only once it is opened, so only an open card hears own ship. */
function VorCard({ vor }: { vor: VorPin }) {
  const ship = useOwnFix();
  const away = useAwayWords(vor.lat, vor.lon);
  // The radial the airplane is on and the course back to the station, to
  // its own declination (lib/navaid): what the OBS is set to.
  const on = ship ? radialOf(vor, ship) : null;
  const volume = serviceVolume(vor.service_volume);
  const hours = hoursOf(vor.hours);
  return (
    <MapCard
      media={HEXAGON}
      title={<>{vor.ident}<span className="font-normal text-muted-foreground">{vor.kind}</span></>}
      subtitle={[vor.name, vor.freq].filter(Boolean).join(" · ") || undefined}
      pill={{ name: `${vor.ident} ${vor.kind}`, line: [vor.freq, away ?? vor.name].filter(Boolean).join(" · "), colour: VOR_BLUE }}
    >
      <PointActions point={vor} copy={vor.freq ? { label: vor.freq, text: vor.freq } : null} />
      {on && (
        <p className={cn("tabular-nums", TEXT.row)} data-testid="vor-radial">
          <span className="font-semibold">On the {threeFigures(on.radial)} radial</span> · {nmAway(on.nm)}
          <span className={cn("block text-muted-foreground", TEXT.detail)}>{threeFigures(on.toCourse)}° to fly to it</span>
        </p>
      )}
      <ListGroup>
        {/* Its identifier as it sends it: the only sure way to know the
            station tuned is the one meant (AIM 1-1-3). */}
        <ListRow title="Identifier" value={<span className="font-semibold text-foreground" aria-label={[...vor.ident].join(" ")}>{morseOf(vor.ident)}</span>} data-testid="vor-morse" />
        {vor.channel && <ListRow title="DME channel" value={<span className="text-foreground">{vor.channel}</span>} />}
        {volume && <ListRow title="Service volume" description={volume} data-testid="vor-service-volume" />}
        {vor.elevation_ft != null && <ListRow title="Elevation" value={<span className="text-foreground">{feet(vor.elevation_ft)}</span>} />}
        {vor.mag_var != null && <ListRow title="Declination" value={<span className="text-foreground">{declinationOf(vor.mag_var)}</span>} />}
        {hours && <ListRow title="Hours" value={<span className="text-foreground">{hours}</span>} />}
      </ListGroup>
      {/* Where its signal is not to be used, as the Chart Supplement lists
          it (NASR NAV_RMK): in the caution colour where it is in service
          with restrictions. */}
      {/* Folded under a row of their own, as the airport card's fuel
          remarks are: a busy station's run to a screenful (STL's). */}
      {(vor.remarks ?? []).length > 0 && (
        <ListGroup>
          <Collapsible>
            <CollapsibleTrigger asChild>
              <ListRow
                title={<span className={cn(vor.restricted && "text-amber-700 dark:text-amber-400")}>{vor.restricted ? "Restrictions" : "Remarks"}</span>}
                chevron data-testid="vor-remarks"
              />
            </CollapsibleTrigger>
            <CollapsibleContent>
              {(vor.remarks ?? []).map(remark => (
                <ListRow key={remark} title={<span className={cn("text-muted-foreground", TEXT.detail)}>{remark}</span>} data-testid="vor-remark" />
              ))}
            </CollapsibleContent>
          </Collapsible>
        </ListGroup>
      )}
      <PointWhere lat={vor.lat} lon={vor.lon} />
    </MapCard>
  );
}

function FixCard({ fix, vors }: { fix: FixPin; vors: readonly VorPin[] }) {
  const away = useAwayWords(fix.lat, fix.lon);
  // Where it is off the nearest VOR in view, as a controller says it.
  const frd = fixRadialDistance(fix, vors);
  return (
    <MapCard
      media={TRIANGLE} title={<>{fix.ident}<span className="font-normal text-muted-foreground">Fix</span></>}
      subtitle={frd ?? undefined}
      pill={{ name: `${fix.ident} fix`, line: frd ?? away ?? degreesMinutes(fix), colour: FIX_INK }}
    >
      <PointActions point={fix} copy={null} />
      <PointWhere lat={fix.lat} lon={fix.lon} />
    </MapCard>
  );
}
