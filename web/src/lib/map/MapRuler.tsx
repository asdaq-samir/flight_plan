import L from "leaflet";
import { useQuery } from "@tanstack/react-query";
import { memo, useEffect, useMemo, useState } from "react";
import { cruiseTasOf } from "../aircraftChoice";
import { loadDeclination, type Declination } from "../magnetic";
import { usePreferences } from "../preferences";
import { aircraftListQuery, aircraftProfilesQuery } from "../queryClient";
import { TEXT } from "../text";
import { HOLD_MS, heldStill, rulerWords, upright } from "./ruler";

/** Where the two fingers are on the map's container, in points. */
type Ends = readonly [L.Point, L.Point];
/** The ruler's words clear of the fingertips at either end, in points. */
const FINGER_CLEAR = 36;
/** The band's least width, for its words to fit with the fingers close. */
const MIN_BAND = 220;

/**
 * The ruler (lib/map/ruler): two fingers held still on the map for
 * HOLD_MS, and a line between them with its course each way, distance and
 * time, following the fingers until both lift. The map holds still under
 * it -- Leaflet's pinch and drag off for that touch, and on again as the
 * fingers lift -- so the line's ends are the map's container points and
 * it is drawn over the map, not in it. A pinch that moves before then is
 * Leaflet's as ever: these listeners only watch.
 */
export const MapRuler = memo(function MapRuler({ map }: { map: L.Map }) {
  // Where the fingers were as it came, for what VoiceOver is told, and
  // where they are now.
  const [ends, setEnds] = useState<{ first: Ends; now: Ends } | null>(null);
  const [declination, setDeclination] = useState<Declination | null>(null);
  // Timed at the airplane the planner flies: its own figures as they are
  // now where it is the pilot's, as the planner flies it (PlanWorkspace).
  const remembered = usePreferences(p => p.aircraft);
  const { data: profiles } = useQuery(aircraftProfilesQuery);
  const { data: mine } = useQuery({ ...aircraftListQuery, enabled: remembered.aircraftId != null });
  const own = remembered.aircraftId != null ? mine?.find(a => a.id === remembered.aircraftId) : undefined;
  const tasKt = cruiseTasOf(own ? { ...remembered, cruiseTasKt: own.cruiseTasKt } : remembered, profiles);

  useEffect(() => {
    const el = map.getContainer();
    // Held, the fingers where they came down on the page; ruling, where
    // they are on the map's container.
    let hold: { ids: [number, number]; from: L.Point[]; timer: number } | null = null;
    // Where the held fingers are now, the ruler's ends as it comes.
    let held: L.Point[] = [];
    let ruling: { ids: [number, number]; at: L.Point[]; box: DOMRect; zoom: boolean; drag: boolean } | null = null;
    const pointOf = (t: Touch, box?: DOMRect) => L.point(t.clientX - (box?.left ?? 0), t.clientY - (box?.top ?? 0));
    const find = (list: TouchList, id: number) => Array.from(list).find(t => t.identifier === id);
    const cancelHold = () => {
      if (hold) window.clearTimeout(hold.timer);
      hold = null;
    };
    const begin = () => {
      if (!hold) return;
      const { ids } = hold;
      hold = null;
      const pinch = map.touchZoom as L.Handler & { _onTouchEnd?: () => void };
      // Leaflet's pinch, begun as the fingers came down, ends where they
      // have it now (within STILL_PX of the zoom they came to), and the
      // pinch and the drag are off until they lift, so the chart under
      // the ruler holds still.
      pinch._onTouchEnd?.();
      const box = el.getBoundingClientRect();
      const from = held.map(p => p.subtract(L.point(box.left, box.top)));
      ruling = { ids, at: from, box, zoom: map.touchZoom.enabled(), drag: map.dragging.enabled() };
      map.touchZoom.disable();
      map.dragging.disable();
      const first = [from[0]!, from[1]!] as const;
      setEnds({ first, now: first });
    };
    const end = () => {
      if (!ruling) return;
      if (ruling.zoom) map.touchZoom.enable();
      if (ruling.drag) map.dragging.enable();
      ruling = null;
      setEnds(null);
    };
    const start = (e: TouchEvent) => {
      if (ruling) return;
      cancelHold();
      if (e.touches.length !== 2) return;
      // The model of the earth's field asked for as the fingers come
      // down, to be there by the time the ruler is; wrapped, as a state
      // setter calls a function it is given as an update.
      loadDeclination().then(at => setDeclination(() => at), () => {});
      const [a, b] = [e.touches[0]!, e.touches[1]!];
      hold = { ids: [a.identifier, b.identifier], from: [pointOf(a), pointOf(b)], timer: window.setTimeout(begin, HOLD_MS) };
      held = hold.from;
    };
    const move = (e: TouchEvent) => {
      if (hold) {
        const now = hold.ids.map(id => find(e.touches, id));
        if (now.some(t => !t)) return cancelHold();
        held = now.map(t => pointOf(t!));
        if (!heldStill(hold.from, held)) cancelHold();
        return;
      }
      if (!ruling) return;
      const r = ruling;
      // A finger that lifts leaves its end where it was, as the other moves on.
      const at = r.ids.map((id, i) => {
        const t = find(e.touches, id);
        return t ? pointOf(t, r.box) : r.at[i]!;
      });
      r.at = at;
      setEnds(was => was && { first: was.first, now: [at[0]!, at[1]!] });
    };
    const lift = (e: TouchEvent) => {
      if (hold && e.touches.length < 2) cancelHold();
      if (ruling && e.touches.length === 0) end();
    };
    // Captured, so they hear each touch before Leaflet's own handlers do;
    // passive, as they never stop one.
    const options = { capture: true, passive: true } as const;
    el.addEventListener("touchstart", start, options);
    el.addEventListener("touchmove", move, options);
    el.addEventListener("touchend", lift, options);
    el.addEventListener("touchcancel", lift, options);
    return () => {
      el.removeEventListener("touchstart", start, options);
      el.removeEventListener("touchmove", move, options);
      el.removeEventListener("touchend", lift, options);
      el.removeEventListener("touchcancel", lift, options);
      cancelHold();
      end();
    };
  }, [map]);

  const drawn = useMemo(() => ends && placed(map, ends.now, declination, tasKt), [ends, map, declination, tasKt]);
  // Said once, as the ruler comes, and not again at each move of a finger.
  const first = ends?.first;
  const spoken = useMemo(() => (first ? placed(map, first, declination, tasKt).words.spoken : ""), [first, map, declination, tasKt]);

  return (
    <>
      <div className="sr-only" aria-live="polite" data-testid="ruler-spoken">{spoken}</div>
      {drawn && (
        // Over the map's marks and popups, under its buttons (Leaflet's
        // panes reach 700, its controls 800).
        <div className="pointer-events-none absolute inset-0 z-[750]" data-testid="map-ruler" aria-hidden="true">
          <svg className="absolute inset-0 h-full w-full overflow-visible">
            {/* A dark casing under a white line, seen on the day chart and the night one. */}
            <line x1={drawn.a.x} y1={drawn.a.y} x2={drawn.b.x} y2={drawn.b.y} stroke="rgb(0 0 0 / 0.6)" strokeWidth={5} strokeLinecap="round" />
            <line x1={drawn.a.x} y1={drawn.a.y} x2={drawn.b.x} y2={drawn.b.y} stroke="white" strokeWidth={2} strokeLinecap="round" />
            {[drawn.a, drawn.b].map((p, i) => (
              <circle key={i} cx={p.x} cy={p.y} r={5} fill="white" stroke="rgb(0 0 0 / 0.6)" strokeWidth={2} />
            ))}
          </svg>
          <div
            className="absolute flex flex-col items-stretch rounded-lg bg-black/70 px-2.5 py-1 font-semibold text-white tabular-nums"
            style={{ left: drawn.middle.x, top: drawn.middle.y, width: drawn.width, transform: `translate(-50%, -50%) rotate(${drawn.angleDeg}deg)` }}
          >
            <div className={`flex justify-between gap-3 whitespace-nowrap ${TEXT.row}`}>
              <span>{drawn.words.toLeft}</span>
              <span>{drawn.words.toRight}</span>
            </div>
            <div className={`whitespace-nowrap text-center ${TEXT.detail}`}>{drawn.words.figures}</div>
          </div>
        </div>
      )}
    </>
  );
});

/** The ruler between `ends` on the screen: its words upright along it,
 *  read from whichever end is then on the left. */
function placed(map: L.Map, [a, b]: Ends, declination: Declination | null, tasKt: number | null) {
  const { angleDeg, flipped } = upright(a, b);
  const [left, right] = flipped ? [b, a] : [a, b];
  const at = (p: L.Point) => {
    const ll = map.containerPointToLatLng(p);
    return { lat: ll.lat, lon: ll.lng };
  };
  const words = rulerWords(at(left), at(right), declination, tasKt);
  return { a, b, angleDeg, words, width: Math.max(MIN_BAND, a.distanceTo(b) - 2 * FINGER_CLEAR), middle: a.add(b).divideBy(2) };
}
