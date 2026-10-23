import L from "leaflet";
import { memo, useMemo } from "react";
import { Marker, Polyline } from "react-leaflet";
import { MAP_BLUE } from "./chartColors";
import { made } from "./icons";
import { text } from "./airportMark";

/** A way FPL's Routes offer beside the route (RouteChoices), as the map
 *  draws it: its line and the words on its chip. */
export interface RouteWay {
  key: string;
  path: [number, number][];
  /** Its names and its time, "Best Weather · 3 h 40 min". */
  label: string;
}

// One style for good: react-leaflet restyles a path whose pathOptions is a
// new object, and a literal is one at every render.
const WAY_STYLE: L.PathOptions = { color: MAP_BLUE, weight: 6, opacity: 0.35, lineCap: "round", lineJoin: "round" };
const NO_WAYS: RouteWay[] = [];

/** The chip on a way's line: its names and time, white on the tint, as
 *  Maps marks the routes beside the one picked; 22 tall, its 44-point hit
 *  area a pseudo-element round it. */
const wayIcon = made(function wayIcon(label: string) {
  return L.divIcon({
    className: "",
    iconSize: [0, 0], iconAnchor: [0, 0],
    html: `<span data-route-way="" class="absolute left-0 top-0 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full px-2 py-0.5 text-[12px] leading-[18px] font-semibold text-white shadow-[0_1px_3px_rgba(0,0,0,.35)] after:absolute after:-inset-x-1 after:-inset-y-[11px] after:content-['']" style="background-color:${MAP_BLUE}">${text(label)}</span>`,
  });
});

const Way = memo(function Way({ way, onPick }: { way: RouteWay; onPick: (key: string) => void }) {
  const events = useMemo(() => ({ click: (e: L.LeafletMouseEvent) => { L.DomEvent.stopPropagation(e); onPick(way.key); } }), [onPick, way.key]);
  // The chip at the middle of the way's middle leg, not on a turn.
  const at = useMemo((): [number, number] => {
    const i = Math.floor((way.path.length - 1) / 2);
    const a = way.path[i]!, b = way.path[Math.min(i + 1, way.path.length - 1)]!;
    return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  }, [way.path]);
  return (
    <>
      <Polyline positions={way.path} pathOptions={WAY_STYLE} eventHandlers={events} />
      <Marker position={at} icon={wayIcon(way.label)} eventHandlers={events} keyboard={false} />
    </>
  );
});

/**
 * The ways FPL's Routes offer beside the route, drawn under it in a pale
 * tint as Maps draws the routes it did not pick, each with a chip of its
 * names and time; a tap on either puts that way in the route, as a tap on
 * its row does (RouteChoices).
 */
export const RouteWaysLayer = memo(function RouteWaysLayer({ ways = NO_WAYS, onPick }: {
  ways?: RouteWay[];
  onPick: (key: string) => void;
}) {
  return <>{ways.map(way => <Way key={way.key} way={way} onPick={onPick} />)}</>;
});
