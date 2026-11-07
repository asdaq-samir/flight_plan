import type { ProcedureFix } from "../api/types";
import { altitudeLines, decorationOf, speedWords } from "../procedures";
import { altFt } from "../units";
import { BADGE } from "../rowBadges";
import { MAP_BLUE } from "./chartColors";
import { divIcon, made } from "./icons";

/**
 * The instrument procedures the pilot picked (the route's Procedures), on
 * the chart as ForeFlight draws one, at the pilot's showing (the ILS Y RWY
 * 8 at KBUR via LAX): the transition and the final in the approaches'
 * indigo over a white casing, the missed approach dashed, each hold its
 * racetrack, and each fix a mark with its name, its part (IAF, FAF, MAP)
 * and the altitudes it is crossed at as the chart sets them -- a minimum
 * underlined, a maximum overlined, a mandatory one both. From the FAA's
 * coded procedure (wingtip.procedures), drawn as a sketch, the chart under it.
 * A fix of the procedure's own is tapped for its card (FixCard: Direct to
 * it, an altitude to cross it at), at the owner's pick; the pilot's own
 * altitude there said under the chart's in the tint, and the fix sent
 * direct to ringed in it. One of an older cycle than the one in force (the
 * FAA's current file could not be had) is drawn in grey, its fixes
 * saying OUT OF DATE, so it is not read as current once the sheet is closed.
 */
export const PROCEDURE_INK = BADGE.approach;
/** A procedure of an old cycle: grey, not the approaches' indigo. */
export const STALE_INK = "#6b6b6b";

/** From this zoom in, the fixes' names and altitudes: further out an
 *  approach is a short line by its field, and its words would cover it. */
export const PROCEDURE_WORDS_FROM_ZOOM = 9;

const esc = (text: string) => text.replace(/[<>&"]/g, "");

/** A fix: an indigo diamond, and from WORDS_FROM_ZOOM its name, its part
 *  and its altitudes beside it. */
export const fixIcon = made(function fixIcon(fix: ProcedureFix, words: boolean, stale: boolean, own: number | null, direct: boolean) {
  const ink = stale ? STALE_INK : PROCEDURE_INK;
  const roles = fix.roles.filter(r => r !== "hold");
  const { lines } = altitudeLines(fix);
  const speed = speedWords(fix);
  const alt = lines.map(l => `<span style="text-decoration:${decorationOf(l)};text-decoration-thickness:1.5px">${esc(l.text)}</span>`).join("");
  // A runway's threshold (the missed approach point of most approaches)
  // is under the field's own mark and its ident: its diamond alone, where
  // "RW08 MAP" covered the field's name (2026-10-10).
  const label = words && !/^RW\d/.test(fix.ident)
    ? `<span class="absolute top-1/2 left-[21px] flex -translate-y-1/2 flex-col rounded-md bg-white/95 px-1.5 py-0.5 text-[0.8125rem] leading-4 font-bold whitespace-nowrap shadow-sm" style="color:${ink}">` +
      `<span>${esc(fix.ident)}${roles.length ? ` <span class="font-semibold opacity-80">${esc(roles.join(" "))}</span>` : ""}</span>` +
      `${alt ? `<span class="flex flex-col text-[#1c1a17]">${alt}</span>` : ""}` +
      `${speed ? `<span class="text-[#1c1a17]">${esc(speed)}</span>` : ""}` +
      `${own != null ? `<span style="color:${MAP_BLUE}">Cross ${altFt(own)}</span>` : ""}` +
      `${direct ? `<span style="color:${MAP_BLUE}">Direct to</span>` : ""}` +
      `${stale ? `<span class="text-[#1c1a17]">OUT OF DATE</span>` : ""}</span>`
    : "";
  // A box twice the diamond's size, the diamond at its middle: a mark to
  // tap for the fix's card (FixMark), where 14 points was a third of a
  // finger's 44.
  return divIcon({
    className: "", iconSize: [28, 28], iconAnchor: [14, 14],
    html: `<span class="absolute inset-0 flex items-center justify-center" data-procedure-fix="${esc(fix.ident)}">` +
      `<svg viewBox="-7 -7 14 14" width="14" height="14" aria-hidden="true" style="overflow:visible">${direct ? `<circle r="10" fill="none" stroke="${MAP_BLUE}" stroke-width="2.5"/>` : ""}<path d="M0 -5.5 L5.5 0 L0 5.5 L-5.5 0 Z" fill="${fix.missed ? "#fff" : ink}" stroke="${fix.missed ? ink : "#fff"}" stroke-width="1.8"/></svg>` +
      `${label}</span>`,
  });
});

