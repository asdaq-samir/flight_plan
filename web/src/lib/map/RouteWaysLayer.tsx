import L from "leaflet";
import { memo, useMemo } from "react";
import { Marker, Polyline } from "react-leaflet";
import { COURSE_MAGENTA } from "./chartColors";
import { made } from "./icons";
import { text } from "./airportMark";

/** A way FPL's route line offers beside the route (its chips), as the map
 *  draws it: its line and the words on its chip. */
export interface RouteWay {
  key: string;
  path: [number, number][];
  /** Its time, "3 h 40 min". */
  label: string;
  /** Its name, said on its callout while it is the one shown, "Best Weather". */
  name?: string;
  /** Where along it its chip sits, a share of its length: given by the
   *  caller so it holds as the other ways come and go (else by place). */
  share?: number;
}

// One style for good: react-leaflet restyles a path whose pathOptions is a
// new object, and a literal is one at every render.
// Faded and solid magenta, the course line's own, at the owner's ask
// ("show all suggested routes on the map with faded magenta instead of
// blue, and make that route solid magenta as browsed").
const WAY_STYLE: L.PathOptions = { color: COURSE_MAGENTA, weight: 6, opacity: 0.35, lineCap: "round", lineJoin: "round" };
/** The one shown (FPL's Routes' card in sight): solid magenta. */
const SHOWN_STYLE: L.PathOptions = { color: COURSE_MAGENTA, weight: 7, opacity: 1, lineCap: "round", lineJoin: "round" };
const NO_WAYS: RouteWay[] = [];
/** Where along each way its chip sits, a share of its length, one apiece. */
const WAY_SHARES = [0.35, 0.6, 0.8];
/** The chip's fill: the line's magenta a step darker, white words at 13
 *  points on it 6:1 (WCAG 1.4.3 asks 4.5; the line's own #e600e6 is 3.8). */
const WAY_CHIP = "#b000b0";

/** The chip on a way's line: its names and time, as Maps marks the
 *  routes beside the one picked, in the line's magenta; 24 tall, its
 *  44-point hit area a pseudo-element round it. */
const wayIcon = made(function wayIcon(key: string, label: string, name: string, shown: boolean) {
  // A callout as Maps puts on its routes: the one shown filled in
  // magenta with its name under its time, the others white with the time in
  // magenta; a tail down to the line. Sized to its words, so the marker
  // has a box (a hit test, a test's "visible").
  const lines = shown && name ? 2 : 1;
  const width = Math.ceil(Math.max(label.length, shown ? name.length : 0) * 7.6) + 22;
  const height = lines === 2 ? 40 : 24;
  const fill = shown ? WAY_CHIP : "#ffffff";
  const ink = shown ? "#ffffff" : WAY_CHIP;
  return L.divIcon({
    className: "",
    iconSize: [width, height], iconAnchor: [14, height + 7],
    html: `<span data-route-way="${text(key)}" class="relative flex h-full w-full flex-col justify-center rounded-xl px-2.5 text-[13px] leading-4 font-semibold shadow-[0_1px_4px_rgba(0,0,0,.35)] after:absolute after:-inset-x-1 after:-inset-y-1 after:content-['']" style="background-color:${fill};color:${ink}">` +
      `<span class="whitespace-nowrap tabular-nums">${text(label)}</span>` +
      (lines === 2 ? `<span class="whitespace-nowrap font-medium">${text(name)}</span>` : "") +
      `<span aria-hidden="true" class="absolute left-2 top-full h-0 w-0 border-x-[6px] border-t-[8px] border-x-transparent" style="border-top-color:${fill}"></span></span>`,
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
      <Marker position={at} icon={wayIcon(way.key, way.label, way.name ?? "", shown)} eventHandlers={events} keyboard={false} zIndexOffset={shown ? 1000 : 0} />
    </>
  );
});

/**
 * The ways FPL's route line offers beside the route while it is open,
 * drawn under it in faded magenta as Maps draws the routes it did not
 * pick, each with a chip of its names and time, the one picked at full
 * strength; a tap on either picks that way, as a tap on its chip does.
 */
export const RouteWaysLayer = memo(function RouteWaysLayer({ ways = NO_WAYS, shown = null, onPick }: {
  ways?: RouteWay[];
  shown?: string | null;
  onPick: (key: string) => void;
}) {
  return <>{ways.map((way, i) => <Way key={way.key} way={way} shown={way.key === shown} at={way.share ?? WAY_SHARES[i % WAY_SHARES.length]!} onPick={onPick} />)}</>;
});
