/**
 * What goes wrong on a pilot's device, sent to the server's log
 * (ClientErrorController, CloudWatch in production) so the owner hears of
 * it without the pilot writing in: an error nobody caught, a promise
 * nobody caught, a render React could not finish (main.tsx).
 *
 * Nothing of the pilot's goes: the page's path without its query (a
 * magic link's token rides there), the message and the stack cut short and without any address's query,
 * the browser's own name. Each different error once per page load, and
 * ten at most, so a loop cannot flood the log; the server holds a caller
 * to thirty an hour besides. Sent with sendBeacon, which outlives the
 * page and carries no credentials.
 */
export interface ClientErrorReport {
  kind: "error" | "rejection" | "render";
  message: string;
  stack?: string;
  page: string;
  userAgent: string;
}

/** Different errors sent per page load, at most. */
export const LIMIT = 10;

const sent = new Set<string>();

/** For the tests: as at a fresh load. */
export function resetReports() {
  sent.clear();
}

/** Text with the query and fragment of any address in it cut off: a fetch error carries the pilot's position. */
const withoutQueries = (text: string) => text.replace(/[?#]\S*/g, "");

/** The report for an error, as the page saw it. */
export function reportOf(kind: ClientErrorReport["kind"], error: unknown, location: { pathname: string } = window.location,
  userAgent: string = navigator.userAgent): ClientErrorReport {
  const message = withoutQueries(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
  const stack = error instanceof Error && error.stack ? withoutQueries(error.stack).slice(0, 4000) : undefined;
  return { kind, message: message.slice(0, 500) || "(no message)", stack, page: location.pathname.slice(0, 300),
    userAgent: userAgent.slice(0, 300) };
}

function beacon(body: string): boolean {
  return typeof navigator.sendBeacon === "function"
    && navigator.sendBeacon("/api/client-errors", new Blob([body], { type: "application/json" }));
}

/** Sends a report unless the same error has gone already, or ten have. */
export function sendReport(report: ClientErrorReport, send: (body: string) => boolean = beacon): boolean {
  const key = `${report.kind}:${report.message}`;
  if (sent.has(key) || sent.size >= LIMIT) return false;
  sent.add(key);
  return send(JSON.stringify(report));
}

/** Listens for what nothing else caught. */
export function installErrorReports(target: Window = window) {
  target.addEventListener("error", event => sendReport(reportOf("error", event.error ?? event.message)));
  target.addEventListener("unhandledrejection", event => sendReport(reportOf("rejection", event.reason)));
}
