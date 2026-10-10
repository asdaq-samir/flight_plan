import { Fragment, memo, useMemo, useState } from "react";
import L from "leaflet";
import { Marker, Pane, Polyline, useMap, useMapEvents } from "react-leaflet";
import type { ProcedureDrawing, ProcedureFix } from "../api/types";
import { altitudeLines, speedWords } from "../procedures";
import { BADGE } from "../rowBadges";
import { made } from "./icons";

/**
 * The instrument procedures the pilot picked (the route's Procedures), on
 * the chart as ForeFlight draws one, at the pilot's showing (the ILS Y RWY
 * 8 at KBUR via LAX): the transition and the final in the approaches'
 * indigo over a white casing, the missed approach dashed, each hold its
 * racetrack, and each fix a mark with its name, its part (IAF, FAF, MAP)
 * and the altitudes it is crossed at as the chart sets them -- a minimum
 * underlined, a maximum overlined, a mandatory one both. From the FAA's
 * coded procedure (vfr.procedures), drawn as a sketch: not tappable, the
 * chart under it. One of an older cycle than the one in force (the
 * FAA's current file could not be had) is drawn in grey, its fixes
 * saying OUT OF DATE, so it is not read as current once the sheet is closed.
 */
const INK = BADGE.approach;
/** A procedure of an old cycle: grey, not the approaches' indigo. */
const STALE_INK = "#6b6b6b";
const CASING: L.PathOptions = { color: "#ffffff", weight: 7, opacity: 0.9, lineJoin: "round" };
const lineOf = (ink: string): L.PathOptions => ({ color: ink, weight: 3.5, opacity: 1, lineJoin: "round" });
const missedOf = (ink: string): L.PathOptions => ({ color: ink, weight: 3, opacity: 1, dashArray: "8,7" });
const holdOf = (ink: string): L.PathOptions => ({ color: ink, weight: 2.5, opacity: 1, lineJoin: "round" });
const HOLD_CASING: L.PathOptions = { color: "#ffffff", weight: 5.5, opacity: 0.9, lineJoin: "round" };
/** From this zoom in, the fixes' names and altitudes: further out an
 *  approach is a short line by its field, and its words would cover it. */
const WORDS_FROM_ZOOM = 9;

const esc = (text: string) => text.replace(/[<>&"]/g, "");

/** A fix: an indigo diamond, and from WORDS_FROM_ZOOM its name, its part
 *  and its altitudes beside it. */
const fixIcon = made(function fixIcon(fix: ProcedureFix, words: boolean, stale: boolean) {
  const ink = stale ? STALE_INK : INK;
  const roles = fix.roles.filter(r => r !== "hold");
  const { lines } = altitudeLines(fix);
  const speed = speedWords(fix);
  const alt = lines.map(l => {
    const deco = [l.under && "underline", l.over && "overline"].filter(Boolean).join(" ");
    return `<span style="text-decoration:${deco || "none"};text-decoration-thickness:1.5px">${esc(l.text)}</span>`;
  }).join("");
  const label = words
    ? `<span class="absolute top-1/2 left-[14px] flex -translate-y-1/2 flex-col rounded-md bg-white/95 px-1.5 py-0.5 text-[0.8125rem] leading-4 font-bold whitespace-nowrap shadow-sm" style="color:${ink}">` +
      `<span>${esc(fix.ident)}${roles.length ? ` <span class="font-semibold opacity-80">${esc(roles.join(" "))}</span>` : ""}</span>` +
      `${alt ? `<span class="flex flex-col text-[#1c1a17]">${alt}</span>` : ""}` +
      `${speed ? `<span class="text-[#1c1a17]">${esc(speed)}</span>` : ""}` +
      `${stale ? `<span class="text-[#1c1a17]">OUT OF DATE</span>` : ""}</span>`
    : "";
  return L.divIcon({
    className: "", iconSize: [14, 14], iconAnchor: [7, 7],
    html: `<span class="absolute inset-0" data-procedure-fix="${esc(fix.ident)}">` +
      `<svg viewBox="-7 -7 14 14" width="14" height="14" aria-hidden="true"><path d="M0 -5.5 L5.5 0 L0 5.5 L-5.5 0 Z" fill="${fix.missed ? "#fff" : ink}" stroke="${fix.missed ? ink : "#fff"}" stroke-width="1.8"/></svg>` +
      `${label}</span>`,
  });
});

export const ProcedureLayer = memo(function ProcedureLayer({ drawings }: { drawings: ProcedureDrawing[] }) {
  const map = useMap();
  const [zoom, setZoom] = useState(() => map.getZoom());
  useMapEvents(useMemo(() => ({ zoomend: () => setZoom(map.getZoom()) }), [map]));
  if (drawings.length === 0) return null;
  const words = zoom >= WORDS_FROM_ZOOM;
  return (
    <Pane name="procedures" style={{ zIndex: 432 }}>
      {drawings.map(d => {
        const ink = d.stale ? STALE_INK : INK;
        return (
        <Fragment key={`${d.airport}-${d.id}-${d.transition ?? ""}`}>
          {d.lines.map((line, i) => <Polyline key={`c${i}`} positions={line.points} pathOptions={CASING} interactive={false} />)}
          {d.holds.map((hold, i) => <Polyline key={`hc${i}`} positions={hold.points} pathOptions={HOLD_CASING} interactive={false} />)}
          {d.lines.map((line, i) => (
            <Polyline
              key={`l${i}`} positions={line.points} pathOptions={line.role === "missed" ? missedOf(ink) : lineOf(ink)} interactive={false}
              className={line.role === "missed" ? "instrument-procedure-missed" : "instrument-procedure"}
            />
          ))}
          {d.holds.map((hold, i) => (
            <Polyline key={`h${i}`} positions={hold.points} pathOptions={hold.missed ? { ...holdOf(ink), dashArray: "6,6" } : holdOf(ink)} interactive={false} className="instrument-procedure-hold" />
          ))}
          {d.fixes.map(fix => (
            <Marker key={fix.ident} position={[fix.lat, fix.lon]} icon={fixIcon(fix, words, !!d.stale)} interactive={false} keyboard={false} pane="procedures" />
          ))}
        </Fragment>
        );
      })}
    </Pane>
  );
});
