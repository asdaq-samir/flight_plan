import { useQuery } from "@tanstack/react-query";
import type { Marker } from "maplibre-gl";
import { useEffect, useMemo, useRef } from "react";
import type { ChartInfo } from "../../../api/types";
import { prefersReducedMotion } from "../../../motion";
import { usePreferences } from "../../../preferences";
import { classBQuery } from "../../../queryClient";
import { useAhead } from "../../ahead";
import { colourOf } from "../../flightCategory";
import { airportMarkIcon } from "../../icons";
import { useOwnShip } from "../../ownShip";
import { chartPair, sheetAt } from "../../tiles";
import { useGlMap } from "../glLayer";
import { glZoom } from "../glStyle";
import { iconMarker, type IconLike } from "../htmlMarker";
import { useGlLines, type GlRun } from "../useGlLines";

export interface GlMark {
  key: string;
  lat: number;
  lon: number;
  icon: IconLike;
  /** A tap on it, when it is a target. */
  onTap?: () => void;
  onHover?: (on: boolean) => void;
  title?: string;
}

/**
 * Marks drawn as the app's own div icons (icons.ts), one MapLibre marker
 * each, kept by key and made again only as their icon changes: the few
 * dozen marks that are chips with words in them -- the Class B fields'
 * weather, a stop's pin, a top of climb -- where a symbol layer would
 * need a picture for each. The map places them in the frame it draws
 * the chart.
 */
export function useGlMarks(marks: GlMark[]) {
  const { map } = useGlMap();
  const kept = useRef(new Map<string, { marker: Marker; icon: IconLike; mark: GlMark }>());
  useEffect(() => {
    const seen = new Set<string>();
    for (const mark of marks) {
      seen.add(mark.key);
      const was = kept.current.get(mark.key);
      if (was && was.icon === mark.icon) {
        was.marker.setLngLat([mark.lon, mark.lat]);
        was.mark = mark;
        continue;
      }
      was?.marker.remove();
      const marker = iconMarker(mark.icon, { interactive: !!mark.onTap }).setLngLat([mark.lon, mark.lat]).addTo(map);
      const el = marker.getElement();
      if (mark.title) el.title = mark.title;
      const entry = { marker, icon: mark.icon, mark };
      if (mark.onTap) {
        el.style.cursor = "pointer";
        el.addEventListener("click", e => { e.stopPropagation(); entry.mark.onTap?.(); });
      }
      el.addEventListener("mouseenter", () => entry.mark.onHover?.(true));
      el.addEventListener("mouseleave", () => entry.mark.onHover?.(false));
      kept.current.set(mark.key, entry);
    }
    for (const [key, { marker }] of kept.current) {
      if (!seen.has(key)) {
        marker.remove();
        kept.current.delete(key);
      }
    }
  }, [map, marks]);
  useEffect(() => {
    const all = kept.current;
    return () => { for (const { marker } of all.values()) marker.remove(); all.clear(); };
  }, [map]);
}

/**
 * The Class B fields' weather, as chips over the chart (ClassBLayer), at
 * the settings' Class B Weather: a tap the field's card; a hover shows the
 * terminal sheet over it while the pointer is there.
 */
export function ClassBGl({ chart, route, onPreview, onSelectPlace }: {
  chart: ChartInfo;
  route: string[];
  onPreview: (on: boolean) => void;
  onSelectPlace?: (ident: string) => void;
}) {
  const { map } = useGlMap();
  const show = usePreferences(s => s.classB);
  const base = usePreferences(s => s.base);
  const { overlay } = chartPair(chart.chart_layers, base);
  const overlayFromZoom = overlay?.min_zoom ?? 10;
  const { data } = useQuery({ ...classBQuery, enabled: show });
  const marks = useMemo<GlMark[]>(() => (show && data ? data.filter(a => !route.includes(a.ident)).map(a => {
    const sheet = sheetAt(overlay, a.lat, a.lon);
    return {
      key: a.ident, lat: a.lat, lon: a.lon, icon: airportMarkIcon(a.ident, "B", colourOf(a.flight_category)),
      title: `${a.ident} · ${a.name} · ${a.flight_category ?? "no report"}`,
      onHover: on => onPreview(on && !!sheet),
      onTap: () => {
        onPreview(false);
        if (onSelectPlace) onSelectPlace(a.ident);
        else map.flyTo({ center: [a.lon, a.lat], zoom: Math.max(map.getZoom(), glZoom(overlayFromZoom)), duration: prefersReducedMotion() ? 0 : 600 });
      },
    };
  }) : []), [show, data, route, overlay, overlayFromZoom, onPreview, onSelectPlace, map]);
  useGlMarks(marks);
  return null;
}

/**
 * What is ahead of own ship in the air (AheadLayer, lib/map/ahead): each
 * alert's point ringed in its level's colour, a dashed line out to it
 * from own ship where it is not already inside.
 */
/** AheadLayer's inks: a warning red, a caution amber. */
const AHEAD_INK = { warning: "#dc2626", caution: "#d97706" } as const;

export function AheadGl() {
  const ahead = useAhead();
  const fix = useOwnShip(s => s.fix);
  const runs = useMemo<GlRun[] | null>(() => (ahead && fix ? ahead.alerts.flatMap(a => [
    ...(!a.inside ? [{ points: [[fix.lat, fix.lon], [a.lat, a.lon]] as [number, number][], colour: AHEAD_INK[a.level], width: 2 }] : []),
  ]) : null), [ahead, fix]);
  useGlLines("ahead", "top", runs, null, [3, 3]);
  const rings = useMemo<GlMark[]>(() => (ahead && fix ? ahead.alerts.map(a => ({
    key: a.id, lat: a.lat, lon: a.lon, icon: aheadIcon(a.level),
  })) : []), [ahead, fix]);
  useGlMarks(rings);
  return null;
}

const aheadIcons = new Map<string, IconLike>();
/** An alert's ring, as AheadLayer's circle: its level's colour over a wash. */
function aheadIcon(level: "warning" | "caution"): IconLike {
  let icon = aheadIcons.get(level);
  if (!icon) {
    const [line, fill] = level === "warning" ? ["#dc2626", "rgba(220,38,38,.25)"] : ["#d97706", "rgba(245,158,11,.25)"];
    icon = { options: { className: `ahead-${level}`, iconSize: [22, 22], iconAnchor: [11, 11], html: `<span style="position:absolute;inset:0;border-radius:9999px;border:3px solid ${line};background:${fill}"></span>` } };
    aheadIcons.set(level, icon);
  }
  return icon;
}
