import { useEffect, useMemo, useState } from "react";
import { loadDeclination, type Declination } from "../../../magnetic";
import { PINCHED_LEVELS, RulerDrawing, placed, useCruiseTas } from "../../RulerDrawing";
import { HOLD_MS, heldStill } from "../../ruler";
import { useGlMap } from "../glLayer";

type XY = { x: number; y: number };
type Ends = readonly [XY, XY];

/**
 * Two fingers held still on the chart measure it, as ForeFlight's ruler
 * (MapRuler) -- the WebGL map's: held for HOLD_MS without the map zooming,
 * the pinch handed over to the ruler, which follows the fingers until
 * they lift, its distance, course and time en route along it.
 */
export function RulerGl() {
  const { map } = useGlMap();
  const [ends, setEnds] = useState<{ first: Ends; now: Ends } | null>(null);
  const [declination, setDeclination] = useState<Declination | null>(null);
  const tasKt = useCruiseTas();
  useEffect(() => {
    const el = map.getContainer();
    let hold: { ids: [number, number]; from: XY[]; zoom: number; timer: number } | null = null;
    let held: XY[] = [];
    let ruling: { ids: [number, number]; at: XY[]; box: DOMRect } | null = null;
    const pointOf = (t: Touch, box?: DOMRect): XY => ({ x: t.clientX - (box?.left ?? 0), y: t.clientY - (box?.top ?? 0) });
    const find = (list: TouchList, id: number) => Array.from(list).find(t => t.identifier === id);
    const cancelHold = () => {
      if (hold) window.clearTimeout(hold.timer);
      hold = null;
    };
    // MapLibre's zoom is Leaflet's less one: the same fraction of a level.
    const begin = () => {
      if (!hold) return;
      if (Math.abs(map.getZoom() - hold.zoom) > PINCHED_LEVELS) return cancelHold();
      const { ids } = hold;
      hold = null;
      const box = el.getBoundingClientRect();
      const from = held.map(p => ({ x: p.x - box.left, y: p.y - box.top }));
      ruling = { ids, at: from, box };
      map.touchZoomRotate.disable();
      map.dragPan.disable();
      const first = [from[0]!, from[1]!] as const;
      setEnds({ first, now: first });
    };
    const end = () => {
      if (!ruling) return;
      map.touchZoomRotate.enable();
      map.touchZoomRotate.disableRotation();
      map.dragPan.enable();
      ruling = null;
      setEnds(null);
    };
    const start = (e: TouchEvent) => {
      if (ruling) return;
      cancelHold();
      if (e.touches.length !== 2) return;
      loadDeclination().then(at => setDeclination(() => at), () => {});
      const [a, b] = [e.touches[0]!, e.touches[1]!];
      hold = { ids: [a.identifier, b.identifier], from: [pointOf(a), pointOf(b)], zoom: map.getZoom(), timer: window.setTimeout(begin, HOLD_MS) };
      held = hold.from;
    };
    const move = (e: TouchEvent) => {
      if (hold) {
        const now = hold.ids.map(id => find(e.touches, id));
        if (now.some(t => !t)) return cancelHold();
        held = now.map(t => pointOf(t!));
        if (!heldStill(hold.from, held) || Math.abs(map.getZoom() - hold.zoom) > PINCHED_LEVELS) cancelHold();
        return;
      }
      if (!ruling) return;
      const r = ruling;
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
  const toLatLon = useMemo(() => (p: XY) => {
    const ll = map.unproject([p.x, p.y]);
    return { lat: ll.lat, lon: ll.lng };
  }, [map]);
  const drawn = useMemo(() => ends && placed(toLatLon, ends.now, declination, tasKt), [ends, toLatLon, declination, tasKt]);
  const first = ends?.first;
  const spoken = useMemo(() => (first ? placed(toLatLon, first, declination, tasKt).words.spoken : ""), [first, toLatLon, declination, tasKt]);
  return <RulerDrawing drawn={drawn} spoken={spoken} />;
}
