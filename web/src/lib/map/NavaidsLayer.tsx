import { memo, useMemo, useState } from "react";
import { Check, Copy, MapPinPlus } from "lucide-react";
import { cn } from "cn";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import L from "leaflet";
import { Marker, Pane, useMap } from "react-leaflet";
import { CardAction } from "../../components/CardAction";
import DirectToIcon from "../../components/DirectToIcon";
import { ListGroup, ListRow } from "../../components/GroupedList";
import { declinationOf, fixRadialDistance, hoursOf, morseOf, radialOf, serviceVolume, threeFigures } from "../navaid";
import { TEXT } from "../text";
import { feet } from "../units";
import { useOwnFix } from "./ownShip";
import { usePointActions, type ChartPoint } from "./pointActions";
import { api } from "../api/client";
import type { FixPin, VorPin } from "../api/types";
import { usePreferences } from "../preferences";
import { enrouteFixIcon, vorIcon } from "./airspaceMarks";
import { airportBox, ownShipBox, useDrawnAirports, vorTagSide, type TagSide } from "./declutter";
import { useOwnShipNear } from "./ownShip";
import { useAhead, useLiveZoom } from "./useView";
import { MapCard } from "./MapCard";
import { MapPopup } from "./MapPopup";
import { degreesMinutes } from "../coords";
import { nmAway, useAwayWords } from "../useAway";
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
/** Their taps over the airspace rings' (AirspaceLayer's 430), whose
 *  20 px targets otherwise took a tap on a VOR or fix inside a ring and
 *  opened the airspace's card; under the airports' and waypoints' marks
 *  (the marker pane's 600), which keep theirs. */
const NAVAID_TAPS_Z = 440;
const MARKS_PANE = { zIndex: NAVAIDS_Z };
const TAPS_PANE = { zIndex: NAVAID_TAPS_Z };

/** The 44 points round a station that take its tap, unseen, the mark
 *  drawn below in its own pane not grown for it. */
const HIT_ICON = L.divIcon({
  className: "", iconSize: [0, 0], iconAnchor: [0, 0],
  html: `<span class="absolute -left-[22px] -top-[22px] size-11 rounded-full" data-navaid-hit=""></span>`,
});

const NO_VORS: VorPin[] = [];
const NO_FIXES: FixPin[] = [];

const vorKey = (v: VorPin) => `${v.ident}-${v.lat}`;

/** Which side of each VOR's hexagon its tag goes at this zoom, clear of
 *  the airports' marks and own ship's airplane where it can be (declutter):
 *  own ship is never moved for a VOR. Own ship as it moves a few hundred
 *  metres (useOwnShipNear), not at every fix. */
function useTagSides(vors: VorPin[], zoom: number): Map<string, TagSide> {
  const map = useMap();
  const fields = useDrawnAirports(s => s.fields);
  const ship = useOwnShipNear();
  return useMemo(() => {
    const at = (lat: number, lon: number) => map.project([lat, lon], zoom);
    const blockers = fields.map(f => airportBox(at(f.lat, f.lon), f.ident));
    if (ship) blockers.push(ownShipBox(at(ship.lat, ship.lon)));
    return new Map(vors.map(v => [vorKey(v), vorTagSide(at(v.lat, v.lon), v.ident, blockers)]));
  }, [map, vors, zoom, fields, ship]);
}

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
  const sides = useTagSides(on ? vors : NO_VORS, zoom);
  if (!on) return null;
  return (
    <>
      <Pane name="navaids" style={MARKS_PANE}>
        {fixes.map(f => <Mark key={f.ident} at={f} icon={enrouteFixIcon(f.ident)} />)}
        {vors.map(v => <Mark key={vorKey(v)} at={v} icon={vorIcon(v.ident, sides.get(vorKey(v)))} />)}
      </Pane>
      <Pane name="navaid-taps" style={TAPS_PANE}>
        {fixes.map(f => <FixTap key={f.ident} fix={f} vors={vors} />)}
        {vors.map(v => <VorTap key={vorKey(v)} vor={v} />)}
      </Pane>
    </>
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

/** A VOR's or fix's mark as the chart draws it, not a target. */
const Mark = memo(function Mark({ at, icon }: { at: { lat: number; lon: number }; icon: L.DivIcon }) {
  const position = useMemo<[number, number]>(() => [at.lat, at.lon], [at.lat, at.lon]);
  return <Marker position={position} icon={icon} interactive={false} keyboard={false} />;
});

/** The chart's colours of the two marks, the ground of their cards' pill. */
const VOR_BLUE = "#1e5bb8";
const FIX_INK = "#1c1a17";

const VorTap = memo(function VorTap({ vor }: { vor: VorPin }) {
  const position = useMemo<[number, number]>(() => [vor.lat, vor.lon], [vor.lat, vor.lon]);
  return (
    <Marker position={position} icon={HIT_ICON} eventHandlers={STOP_CLICK} title={`${vor.ident} ${vor.kind}`}>
      <MapPopup pane="popupPane" panOnce>
        <VorCard vor={vor} />
      </MapPopup>
    </Marker>
  );
});

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
      {(vor.remarks ?? []).length > 0 && (
        <ListGroup>
          {(vor.remarks ?? []).map(remark => (
            <ListRow
              key={remark} title={<span className={cn(vor.restricted && "text-amber-700 dark:text-amber-400", TEXT.detail)}>{remark}</span>}
              data-testid="vor-remark"
            />
          ))}
        </ListGroup>
      )}
      <PointWhere lat={vor.lat} lon={vor.lon} />
    </MapCard>
  );
}

/**
 * A point card's actions, as an airport card's: Direct To, from where the
 * airplane is to the point and on along the route, and Add to Route, the
 * point a stop where it fits -- each while there is a route to do it to
 * (usePointActions) -- and Copy, the VOR's frequency for the radio.
 */
function PointActions({ point, copy }: { point: ChartPoint; copy: { label: string; text: string } | null }) {
  const map = useMap();
  const { addToRoute, directTo } = usePointActions();
  const [copied, setCopied] = useState(false);
  if (!addToRoute && !directTo && !copy) return null;
  const done = (act: (p: ChartPoint) => void) => () => { map.closePopup(); act({ ident: point.ident, lat: point.lat, lon: point.lon }); };
  return (
    <div className="grid grid-cols-3 gap-2" data-testid="point-actions">
      {directTo && <CardAction icon={<DirectToIcon />} label="Direct To" filled onClick={done(directTo)} testId="point-direct-to" />}
      {addToRoute && <CardAction icon={<MapPinPlus />} label="Add to Route" onClick={done(addToRoute)} testId="point-add" />}
      {copy && (
        <CardAction
          icon={copied ? <Check /> : <Copy />} label={copied ? "Copied" : copy.label} spoken={`Copy ${copy.label}`}
          onClick={() => {
            // Called in the tap, as the clipboard asks; refused, nothing said.
            void navigator.clipboard?.writeText(copy.text).then(() => setCopied(true), () => {});
          }}
          testId="point-copy"
        />
      )}
    </div>
  );
}

const FixTap = memo(function FixTap({ fix, vors }: { fix: FixPin; vors: readonly VorPin[] }) {
  const position = useMemo<[number, number]>(() => [fix.lat, fix.lon], [fix.lat, fix.lon]);
  return (
    <Marker position={position} icon={HIT_ICON} eventHandlers={STOP_CLICK} title={`${fix.ident} fix`}>
      <MapPopup pane="popupPane" panOnce>
        <FixCard fix={fix} vors={vors} />
      </MapPopup>
    </Marker>
  );
});

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
