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
/** The one shown (FPL's Routes' card picked): the tint at full strength. */
const SHOWN_STYLE: L.PathOptions = { color: MAP_BLUE, weight: 7, opacity: 0.9, lineCap: "round", lineJoin: "round" };
const NO_WAYS: RouteWay[] = [];
/** The chip's fill: the map's blue a step darker, white words at 12
 *  points on it 4.5:1 and more (WCAG 1.4.3; the map's own #007aff is 4.0). */
const WAY_CHIP = "#0062cc";

/** The chip on a way's line: its names and time, white on the tint, as
 *  Maps marks the routes beside the one picked; 22 tall, its 44-point hit
 *  area a pseudo-element round it. */
const wayIcon = made(function wayIcon(label: string) {
  // Sized to its words, so the marker has a box (a hit test, a test's
  // "visible"): about 7 a letter at 12 points, and the chip's padding.
  const width = Math.ceil(label.length * 6.6) + 18;
  return L.divIcon({
    className: "",
    iconSize: [width, 22], iconAnchor: [width / 2, 11],
    html: `<span data-route-way="" class="relative flex h-full w-full items-center justify-center whitespace-nowrap rounded-full px-2 text-[12px] leading-[18px] font-semibold text-white shadow-[0_1px_3px_rgba(0,0,0,.35)] after:absolute after:-inset-x-1 after:-inset-y-[11px] after:content-['']" style="background-color:${WAY_CHIP}">${text(label)}</span>`,
  });
});

const Way = memo(function Way({ way, shown, onPick }: { way: RouteWay; shown: boolean; onPick: (key: string) => void }) {
  const events = useMemo(() => ({ click: (e: L.LeafletMouseEvent) => { L.DomEvent.stopPropagation(e); onPick(way.key); } }), [onPick, way.key]);
  // The chip at the middle of the way's middle leg, not on a turn.
  const at = useMemo((): [number, number] => {
    const i = Math.floor((way.path.length - 1) / 2);
    const a = way.path[i]!, b = way.path[Math.min(i + 1, way.path.length - 1)]!;
    return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  }, [way.path]);
  return (
    <>
      <Polyline positions={way.path} pathOptions={shown ? SHOWN_STYLE : WAY_STYLE} eventHandlers={events} />
      <Marker position={at} icon={wayIcon(way.label)} eventHandlers={events} keyboard={false} />
    </>
  );
});

/**
 * The ways FPL's Routes offer beside the route, drawn under it in a pale
 * tint as Maps draws the routes it did not pick, each with a chip of its
 * names and time, the one shown (FPL's Routes' card picked) at full
 * strength; a tap on either shows that way, as a tap on its card does
 * (RouteChoices), whose Use puts it in the route.
 */
export const RouteWaysLayer = memo(function RouteWaysLayer({ ways = NO_WAYS, shown = null, onPick }: {
  ways?: RouteWay[];
  shown?: string | null;
  onPick: (key: string) => void;
}) {
  return <>{ways.map(way => <Way key={way.key} way={way} shown={way.key === shown} onPick={onPick} />)}</>;
});
