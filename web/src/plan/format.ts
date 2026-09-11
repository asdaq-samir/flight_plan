import type { Airport, Candidate, Leg, Totals } from "../api/types";

/**
 * The planner's pure half: colours, number formatting, and the derived
 * row list the panel renders.
 *
 * Split out for the same reason the labeler's logic was -- these are the
 * parts with edge cases (a heading of exactly 360, a leg that cannot be
 * flown, a route whose nav log has not arrived yet), and they are only
 * testable while they have no map and no DOM attached.
 */

/** Score bands, matching the labeling legend so a colour means one thing
 *  across both views. */
export function scoreColor(s: number): string {
  if (s >= 4.5) return "#1a7f37";
  if (s >= 4.0) return "#4a9d4a";
  if (s >= 3.5) return "#b8860b";
  if (s >= 3.0) return "#c2681a";
  return "#b3261e";
}

/**
 * A bearing as a pilot writes it: three digits, and 360 shown as 000.
 *
 * The modulo is not cosmetic. Rounding 359.7 gives 360, which is a
 * heading no chart or clearance ever uses.
 */
export function deg(d: number): string {
  return String(Math.round(d) % 360).padStart(3, "0") + "°";
}

/** One decimal, or an em dash. null and undefined are ordinary here --
 *  an unflyable leg has no ETE and no fuel burn. */
export function one(n: number | null | undefined): string {
  return n === null || n === undefined ? "—" : n.toFixed(1);
}

/** Signed to one decimal: a wind correction of -3 reads as a correction,
 *  where "3" reads as a magnitude. */
export function signed(n: number): string {
  return (n >= 0 ? "+" : "") + n.toFixed(1) + "°";
}

/** Total time as hours and minutes. Minutes are padded so the width does
 *  not jump as the number crosses ten. */
export function hhmm(minutes: number | null): string {
  if (minutes === null) return "ETE n/a";
  return `${Math.floor(minutes / 60)}h ${String(Math.round(minutes % 60)).padStart(2, "0")}m`;
}

export interface EndpointRow {
  kind: "endpoint";
  tag: "DEP" | "DEST";
  ident: string;
  name: string;
  lat: number;
  lon: number;
  along_track_nm: number;
}

export interface CheckpointRow {
  kind: "checkpoint";
  /** 1-based, and the same number the map marker carries. */
  n: number;
  name: string;
  category: string;
  score: number;
  lat: number;
  lon: number;
  along_track_nm: number;
  /** The leg leaving this checkpoint, once the nav log has arrived. */
  nextLeg: Leg | null;
}

export type PanelRow = EndpointRow | CheckpointRow;

/**
 * The panel's rows: departure, the checkpoints, destination, in the order
 * they are flown.
 *
 * The legs are matched by position, not by name. `legs` runs
 * departure -> 1 -> 2 -> ... -> destination, so the leg leaving
 * checkpoint n is legs[n]. The page this replaces looked the leg up by
 * comparing its `from` against the checkpoint's display name, which
 * silently picks the wrong leg when two checkpoints are both unnamed and
 * fall back to the same category word.
 */
export function panelRows(
  departure: Airport,
  destination: Airport,
  distanceNm: number,
  selected: Candidate[],
  legs: Leg[],
): PanelRow[] {
  const rows: PanelRow[] = [
    { kind: "endpoint", tag: "DEP", ...departure, along_track_nm: 0 },
    { kind: "endpoint", tag: "DEST", ...destination, along_track_nm: distanceNm },
  ];
  selected.forEach((c, i) => {
    rows.push({
      kind: "checkpoint",
      n: i + 1,
      name: c.name || "(unnamed)",
      category: c.category,
      score: c.predicted_score,
      lat: c.lat,
      lon: c.lon,
      along_track_nm: c.along_track_nm,
      nextLeg: legs[i + 1] ?? null,
    });
  });
  return rows.sort((a, b) => a.along_track_nm - b.along_track_nm);
}

/** The header summary, which has to say something useful at each of the
 *  three loading stages rather than sitting blank until the last one. */
export function summary(
  distanceNm: number | null,
  candidates: number,
  selected: number,
): string {
  if (distanceNm === null) return "";
  if (!selected) return `${distanceNm} nm · scoring checkpoints…`;
  return `${distanceNm} nm · ${selected} checkpoints from ${candidates} candidates`;
}

/** Totals for the nav-log bar. Returns parts rather than markup so the
 *  warning can be styled without parsing a string back apart. */
export function totalsParts(t: Totals) {
  return {
    distance: `${t.distance_nm} nm`,
    time: hhmm(t.ete_min),
    fuel: `${t.fuel_gal === null ? "—" : t.fuel_gal} gal`,
    warning: t.legs_without_wind
      ? `${t.legs_without_wind} leg${t.legs_without_wind === 1 ? "" : "s"} without wind data`
      : null,
  };
}

/** Elapsed time on a build job, as m:ss. */
export function elapsed(ms: number): string {
  const secs = Math.floor(ms / 1000);
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
}
