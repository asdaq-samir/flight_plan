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
/** Where along each way its chip sits, a share of its length, one apiece. */
const WAY_SHARES = [0.35, 0.6, 0.8];
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

const Way = memo(function Way({ way, shown, at: share, onPick }: { way: RouteWay; shown: boolean; at: number; onPick: (key: string) => void }) {
  const events = useMemo(() => ({ click: (e: L.LeafletMouseEvent) => { L.DomEvent.stopPropagation(e); onPick(way.key); } }), [onPick, way.key]);
  // The chip `share` of the way along, by distance: each way's at its own
  // share (WAY_SHARES), so two ways that run close are not labelled on top
  // of each other (the owner's screenshot, the two times stacked).
  const at = useMemo((): [number, number] => {
    const legs = way.path.slice(1).map((b, i) => {
      const a = way.path[i]!;
      return Math.hypot(b[0] - a[0], (b[1] - a[1]) * Math.cos((a[0] * Math.PI) / 180));
    });
    let left = legs.reduce((sum, d) => sum + d, 0) * share;
    for (let i = 0; i < legs.length; i++) {
      if (left <= legs[i]! || i === legs.length - 1) {
        const a = way.path[i]!, b = way.path[i + 1]!, t = legs[i] ? Math.min(1, left / legs[i]!) : 0;
        return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      }
      left -= legs[i]!;
    }
    return way.path[0]!;
  }, [way.path, share]);
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
  return <>{ways.map((way, i) => <Way key={way.key} way={way} shown={way.key === shown} at={WAY_SHARES[i % WAY_SHARES.length]!} onPick={onPick} />)}</>;
});
