/**
 * The route's checkpoints for ForeFlight. The planner builds the content
 * pack (planning-service app/foreflight.py) at a short address ending in
 * the pack's file name, which ForeFlight names its download by, so
 * ForeFlight can fetch it itself from its own link
 * (https://foreflight.com/support/content-packs/: content?downloadURL=),
 * and a browser can download it to Files, from where ForeFlight imports
 * it too. It was built here, zipped in the browser and handed to the
 * share sheet, which does not offer ForeFlight for a ZIP. The route itself
 * goes by ForeFlight's maps link (lib/flightPlanFiles foreflightRoute).
 */

/** The pack's address on this server: the route, its idents dash-joined,
 *  then the pack's name -- KORD-KDLH/KORD-KDLH-checkpoints.zip -- the
 *  checkpoints the planner's own selection for it. It once carried the
 *  checkpoints themselves, some 2,000 characters, and ForeFlight would not
 *  install a pack from an address that long; the same file installed from
 *  a short one. */
export function packPath(dep: string, dest: string, stops: string[]): string {
  const route = [dep, ...stops, dest].join("-");
  return `/api/planner/foreflight-pack/${route}/${route}-checkpoints.zip`;
}

/** Where ForeFlight fetches the pack from: this page's own origin, but on
 *  the local stack's HTTPS port (8443) the plain port beside it (8080).
 *  That port's certificate is the Mac's own authority's, which ForeFlight
 *  would not take: it came to the port in plain HTTP, which TLS refuses.
 *  The planner leaves the pack on plain http for it (SecurityConfig). */
export function packOrigin(location: Pick<Location, "protocol" | "hostname" | "port" | "origin">): string {
  return location.protocol === "https:" && location.port === "8443" ? `http://${location.hostname}:8080` : location.origin;
}

/** ForeFlight's own link for a pack at `packUrl` (a whole address it can
 *  reach): on a device with ForeFlight, it opens there and downloads it. */
export function openInForeFlight(packUrl: string): string {
  return `https://foreflight.com/content?downloadURL=${encodeURIComponent(packUrl)}`;
}

/** Where this device keeps which route's pack it sent ForeFlight, with
 *  the names the pack carried. */
const SENT_KEY = "wingtip.foreflightPacks";

const sentPacks = (): Record<string, string> => {
  try {
    return JSON.parse(localStorage.getItem(SENT_KEY) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
};

/** Whether this device sent ForeFlight the route's pack with these
 *  waypoint names: a new chart or another selection is another pack. */
export function packSent(route: string, names: string[]): boolean {
  return names.length > 0 && sentPacks()[route] === names.join(" ");
}

/** That it has, kept for the next time the route goes to ForeFlight. */
export function markPackSent(route: string, names: string[]): void {
  try {
    localStorage.setItem(SENT_KEY, JSON.stringify({ ...sentPacks(), [route]: names.join(" ") }));
  } catch {
    // A private window: the pack goes again next time.
  }
}
