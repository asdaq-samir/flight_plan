/**
 * The route to ForeFlight, which sends it on to the panel's GPS
 * wirelessly (Garmin's Connext, Avidyne, Dynon): its own link. Files for
 * an SD card or a USB stick, and Garmin Pilot, went at the owner's calls
 * (2026-11-02).
 */

export interface PlanPoint {
  ident: string;
  /** What the log calls it: the airport's name, the checkpoint's. */
  name: string;
  kind: "airport" | "fix" | "checkpoint";
  lat: number;
  lon: number;
  /** A checkpoint's waypoint in the route's ForeFlight pack (LAKE_ZURICH). */
  waypoint?: string | null;
}

/** ForeFlight's own link to the route (https://foreflight.com/support/app-urls/):
 *  it opens ForeFlight on its map with the flight plan filled in, airports
 *  and fixes by identifier, then the altitude where the plan has one. Each
 *  checkpoint is its waypoint in the route's pack, by name, where `named`
 *  (CONTPACK@LAKE_ZURICH: the pack must be in ForeFlight), else at its
 *  place, as ForeFlight writes a position in a route (42.3700/-88.0800). */
export function foreflightRoute(points: PlanPoint[], altitudeFt?: number | null, named = false): string {
  const tokens = points.map(p => (p.kind !== "checkpoint" ? p.ident.toUpperCase()
    : named && p.waypoint ? `CONTPACK@${p.waypoint}` : `${p.lat.toFixed(4)}/${p.lon.toFixed(4)}`));
  if (altitudeFt) tokens.push(`${Math.round(altitudeFt)}ft`);
  return `foreflightmobile://maps/search?q=${tokens.join("+")}`;
}

/** A file to the share sheet where the browser can share one (Safari on
 *  an iPhone: "Open in ForeFlight"), otherwise downloaded. */
export async function shareFile(fileName: string, type: string, text: string): Promise<void> {
  const file = new File([text], fileName, { type });
  if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title: fileName });
    return;
  }
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
