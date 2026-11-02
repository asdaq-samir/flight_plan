import { useCallback, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { cn } from "cn";
import { Ellipsis, FileArchive, FileDown, FileText, Fuel, Link2, MapPinned, Printer, RotateCw, Send, Share } from "lucide-react";
import RoundButton from "../../../components/RoundButton";
import { ResponsivePopover, ResponsivePopoverAnchor } from "../../../components/ResponsivePopover";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "../../../components/ui/dropdown-menu";
import type { Candidate, Course } from "../../../lib/api/types";
import type { RouteCard } from "../../../lib/openCards";
import { foreflightRoute, shareFile, type PlanPoint } from "../../../lib/flightPlanFiles";
import { api } from "../../../lib/api/client";
import { fplOf } from "../../../lib/avionics/fpl";
import { gfpOf, isApproach } from "../../../lib/avionics/gfp";
import { PANEL_MAX_POINTS, panelFileName } from "../../../lib/avionics/points";
import { dynonUserWaypointsOf, gpxOf, gtnUserWaypointsOf } from "../../../lib/avionics/waypointFiles";
import { proceduresOf } from "../../../lib/procedures";
import { TEXT } from "../../../lib/text";
import { patternsOf } from "../../../lib/trafficPattern";
import { useSearchParam } from "../../../lib/useSearchParam";
import { markPackSent, openInForeFlight, packOrigin, packPath, packSent } from "../../../lib/foreflightPack";
import { routeName } from "../../../lib/identSchema";
import { showError } from "../../../lib/problems";
import { cancelled, shareOrCopy } from "../../../lib/share";
import { navLogRows } from "./navlog/rows";

const SHARE_LABEL: Record<"route" | RouteCard, string> = {
  // The route box's is More, a "…", at the owner's ask ("Don't call it
  // share, call it more with the … as the text"): it holds the route's
  // other actions (save, file, plan again, clear), not sharing alone.
  route: "More", brief: "Share the briefing", navlog: "Share the nav log", profile: "Share the profile",
};

/** The route as typed: its departure, stops and destination. */
interface Planned {
  dep: string;
  dest: string;
  stops: string[];
}

/**
 * Share, a round button of glass beside the route's Approaches -- at the
 * capsule's start at rest -- and with it, at the pilot's ask, everything
 * else the route's row had: the route shared (a link, a file for another
 * app or the panel's GPS, on an iPhone the share sheet's Open in
 * ForeFlight), Save, the solo cross-country review, filing the flight
 * plan and the route's close. Only once there is a route (PlanWorkspace).
 *
 * Each card's own, at the owner's asks ("every share button needs to be
 * specific to that card. So printing briefing should only be in brief
 * card"; "printing navlog should be in navlog"): the route box's has the
 * route -- its link, files, ForeFlight, Save and the review, filing and its
 * clear; the Brief's, its link and Print the briefing; the nav log's, its
 * link and the nav log printed (the kneeboard card); the profile's, its
 * link.
 *
 * Out of the workspace (PlanWorkspace), which only says what the route is
 * and hands in what the lazy route panel draws: Save and the review's item
 * (`saving`), and the review's sheet (`reviewSheet`), opened here as the
 * menu goes.
 */
export default function ShareMenu({
  align, testId = "share-route", card = "route", planned, course, selected, altitudeFt, routed, local, fileable, onFile, saving, reviewSheet, planAgain, onShowFuel,
}: {
  /** The suggested fuel stops taken out of the route box, put back. */
  onShowFuel?: () => void;
  align: "start" | "end";
  /** Its button's: the route box's, or the tab bar's over the Brief and
   *  the nav log (TabBar's `routeShare`). */
  testId?: string;
  /** Whose Share it is: the route box's, or one of the route's cards'. */
  card?: "route" | RouteCard;
  planned: Planned;
  course: Course | null;
  selected: Candidate[];
  altitudeFt: number | undefined;
  /** A route planned whole, its nav log in. */
  routed: boolean;
  /** A local flight, round one field: no kneeboard card. */
  local: boolean;
  fileable: boolean;
  onFile: () => void;
  /** Save and the review's item, given the way to open the review's sheet. */
  saving: (askReview: () => void) => ReactNode;
  /** The review's sheet, given the way to put it away. */
  reviewSheet: (done: () => void) => ReactNode;
  /** Plan again -- fresh winds, weather and fuel -- in the route's menu,
   *  at the owner's pick ("A": the route box's row on one line), and what
   *  is out of date, marked on Share as it was on its own button. */
  planAgain?: { stale: string[]; onPlan: () => void };
}) {
  const [askingReview, setAskingReview] = useState(false);

  // The plan's own address, to another device or person: the share
  // sheet where the browser has one (Safari on an iPhone) or in the iOS
  // app (lib/native), otherwise copied.
  const share = useCallback(async () => {
    const url = window.location.href;
    const title = routeName(planned.dep, planned.dest, planned.stops);
    try {
      if (await shareOrCopy({ title, url }) === "copied") toast.success("Link Copied");
    } catch (err) {
      if (!cancelled(err)) showError("Could not share the route", (err as Error).message);
    }
  }, [planned.dep, planned.dest, planned.stops]);

  // The route as the files and ForeFlight's link take it: the departure,
  // each checkpoint, stop and the destination, as the nav log lists them
  // (lib/flightPlanFiles).
  const points = useMemo((): PlanPoint[] => !course ? [] : navLogRows(course, selected, []).flatMap((row): PlanPoint[] => {
    if (row.kind === "checkpoint") return [{ ident: "", name: row.cp.name || row.cp.category, kind: "checkpoint", lat: row.cp.lat, lon: row.cp.lon, waypoint: row.cp.waypoint }];
    if (row.kind === "toc" || row.kind === "tod") return [];
    return [{
      ident: row.airport.ident, name: row.airport.name ?? row.airport.ident, kind: row.airport.kind === "fix" ? "fix" : "airport",
      lat: row.airport.lat, lon: row.airport.lon,
      // The airway the leg into it is flown along, for a GTN's .gfp.
      airway: row.kind === "departure" ? null : row.leg?.airway?.id ?? null,
    }];
  }), [course, selected]);

  // The procedures and runways picked, for a GTN's .gfp: a departure at
  // the departure, an arrival and an approach at the destination.
  const procsParam = useSearchParam("procs"), takeoffParam = useSearchParam("takeoff"), patternParam = useSearchParam("pattern");
  const gtnProcedures = useMemo(() => {
    const picked = proceduresOf(procsParam);
    const atDest = picked.filter(p => p.ident === planned.dest);
    return {
      departure: picked.find(p => p.ident === planned.dep && !isApproach(p.id)) ?? null,
      arrival: atDest.find(p => !isApproach(p.id)) ?? null,
      approach: atDest.find(p => isApproach(p.id)) ?? null,
      takeoffRunway: patternsOf(takeoffParam).get(planned.dep) ?? null,
      landingRunway: patternsOf(patternParam).get(planned.dest) ?? null,
    };
  }, [procsParam, takeoffParam, patternParam, planned.dep, planned.dest]);
  const checkpointsIn = points.some(p => p.kind === "checkpoint");
  // Past 99 a GTN cuts the plan and a SkyView reads no further (lib/avionics):
  // said on the panels' items, the file still whole.
  const overPanel = points.length > PANEL_MAX_POINTS ? `A panel loads the first ${PANEL_MAX_POINTS} of ${points.length} points` : null;

  const exportPlan = useCallback(async (kind: "fpl" | "gpx" | "gfp" | "user-wpt" | "dynon" | "garmin-pilot") => {
    if (!points.length) return;
    const name = routeName(planned.dep, planned.dest, planned.stops);
    const file = panelFileName(name);
    try {
      // Each point's Garmin type and ICAO region, which tell a panel which
      // of two of a name is meant; without them a panel goes by the name.
      const coded = kind === "fpl" || kind === "gfp" || kind === "garmin-pilot" ? await withCodes(points) : points;
      if (kind === "fpl" || kind === "garmin-pilot") await shareFile(`${file}.fpl`, "application/xml", fplOf(coded, name));
      else if (kind === "gfp") await shareFile(`${file}.gfp`, "text/plain", gfpOf(coded, gtnProcedures).text);
      else if (kind === "user-wpt") await shareFile("user.wpt", "text/plain", gtnUserWaypointsOf(points));
      else if (kind === "dynon") await shareFile(`${file}-waypoints.csv`, "text/csv", dynonUserWaypointsOf(points));
      else await shareFile(`${file}.gpx`, "application/gpx+xml", gpxOf(points, name));
    } catch (err) {
      if ((err as Error).name !== "AbortError") showError("Could not export the route", (err as Error).message);
    }
  }, [points, planned.dep, planned.dest, planned.stops, gtnProcedures]);

  // The checkpoints as a ForeFlight content pack, built by the planner
  // (lib/foreflightPack): each a waypoint with its own page, and the course
  // drawn on its map, for ForeFlight's own link or to download.
  const packHref = selected.length ? packPath(planned.dep, planned.dest, planned.stops) : null;
  // Open in ForeFlight is one button for the two hand-offs ForeFlight
  // needs: the pack first, the first time a route goes there from this
  // device, then the route itself, its checkpoints by their names in the
  // pack (CONTPACK@LAKE_ZURICH) -- ForeFlight takes no route and pack in
  // one. The pilot asked for one step; it is one button, tapped twice the
  // first time and once after.
  const packRoute = [planned.dep, ...planned.stops, planned.dest].join("-");
  const packNames = selected.map(c => c.waypoint ?? "");
  const [, packChanged] = useState(0);
  const sentPack = packHref !== null && packSent(packRoute, packNames);
  const sendPack = () => {
    markPackSent(packRoute, packNames);
    // The button's own link changes after the tap has followed it: changed
    // at once, the tap followed the new one, the route's.
    window.setTimeout(() => packChanged(n => n + 1), 0);
    toast.success("Sent to ForeFlight", { description: "Then tap Open in ForeFlight again" });
  };

  return (
    // The review's sheet, from the menu's item, placed by the Share
    // button: the menu has gone by the time it opens (as Print waits).
    <ResponsivePopover open={askingReview} onOpenChange={setAskingReview}>
      <DropdownMenu>
        <ResponsivePopoverAnchor asChild>
          <DropdownMenuTrigger asChild>
            {/* The route box's a size down, as the box's other buttons are. */}
            <RoundButton
              label={planAgain?.stale.length ? `${SHARE_LABEL[card]}: ${planAgain.stale.join(", ")}` : SHARE_LABEL[card]}
              className={card === "route" ? "size-8" : undefined} data-testid={testId}
            >
              <span className="relative">
                {card === "route" ? <Ellipsis className="size-[1.125rem]" strokeWidth={2.4} /> : <Share className="size-5" strokeWidth={2} />}
                {!!planAgain?.stale.length && (
                  <span aria-hidden="true" data-testid="plan-again-mark" className="absolute -top-0.5 -right-1 size-2 rounded-full bg-caution" />
                )}
              </span>
            </RoundButton>
          </DropdownMenuTrigger>
        </ResponsivePopoverAnchor>
        <DropdownMenuContent align={align} className="min-w-56 print:hidden">
          {routed && onShowFuel && <DropdownMenuItem onSelect={onShowFuel} data-testid="route-show-fuel"><Fuel />Show Fuel Stops</DropdownMenuItem>}
          {routed && <DropdownMenuItem onSelect={() => void share()} data-testid="share-link"><Link2 />Share link</DropdownMenuItem>}
          {card === "route" && (
            <>
              {routed && (
                <>
                  <DropdownMenuItem onSelect={() => void exportPlan("fpl")} data-testid="export-fpl">
                    <FileDown /><Lines label="Flight plan (.fpl)" help={overPanel ?? "G1000, G3X, MGL: on an SD card"} />
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => void exportPlan("gfp")} data-testid="export-gfp">
                    <FileDown /><Lines label="GTN flight plan (.gfp)" help={overPanel ?? "In an FPL folder on the SD card"} />
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => void exportPlan("gpx")} data-testid="export-gpx">
                    <FileDown /><Lines label="GPX route (.gpx)" help={overPanel ?? "Dynon, aera, MGL: on a USB stick"} />
                  </DropdownMenuItem>
                  {checkpointsIn && (
                    <>
                      <DropdownMenuItem onSelect={() => void exportPlan("user-wpt")} data-testid="export-user-wpt">
                        <FileDown /><Lines label="GTN checkpoints (user.wpt)" help="At the SD card's top level" />
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => void exportPlan("dynon")} data-testid="export-dynon">
                        <FileDown /><Lines label="Dynon checkpoints (.csv)" help="On a USB stick" />
                      </DropdownMenuItem>
                    </>
                  )}
                  {/* The .fpl to Garmin Pilot from the share sheet, which sends
                      it on to a Connext panel (Flight Stream, GTX 345, G3X). */}
                  <DropdownMenuItem onSelect={() => void exportPlan("garmin-pilot")} data-testid="open-garmin-pilot"><Send />Open in Garmin Pilot</DropdownMenuItem>
                  {/* Links, not handlers: ForeFlight opens from a tap on its
                      own link, and a download needs one too. */}
                  {points.length > 0 && (packHref && !sentPack ? (
                    <DropdownMenuItem asChild data-testid="open-foreflight">
                      <a href={openInForeFlight(new URL(packHref, packOrigin(window.location)).href)} onClick={sendPack}>
                        <Send />Open in ForeFlight
                      </a>
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem asChild data-testid="open-foreflight">
                      <a href={foreflightRoute(points, altitudeFt, sentPack)}><Send />Open in ForeFlight</a>
                    </DropdownMenuItem>
                  ))}
                  {/* Sent once and since deleted in ForeFlight: again. */}
                  {packHref && sentPack && (
                    <DropdownMenuItem asChild data-testid="foreflight-pack">
                      <a href={openInForeFlight(new URL(packHref, packOrigin(window.location)).href)}><MapPinned />Send the checkpoints again</a>
                    </DropdownMenuItem>
                  )}
                  {packHref && (
                    <DropdownMenuItem asChild data-testid="export-foreflight">
                      <a href={packHref} download><FileArchive />Checkpoints for ForeFlight (.zip)</a>
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                </>
              )}
              {saving(() => setTimeout(() => setAskingReview(true), 150))}
              <DropdownMenuItem disabled={!fileable} onSelect={onFile} data-testid="file-flight-plan"><FileText />File flight plan</DropdownMenuItem>
              {planAgain && (
                <DropdownMenuItem onSelect={planAgain.onPlan} data-testid="plan-again" data-stale={planAgain.stale.length ? "" : undefined}>
                  <RotateCw />Refresh
                  {planAgain.stale.length > 0 && <span aria-hidden="true" className="ml-auto size-2 rounded-full bg-caution" />}
                </DropdownMenuItem>
              )}
            </>
          )}
          {/* Printed once the menu has gone, so it is not on the paper: the
              whole briefing from the Brief, and from the nav log the
              kneeboard card -- the nav log, radio and patterns on one
              half-letter page to fly with. */}
          {card === "brief" && (
            <DropdownMenuItem disabled={!routed} onSelect={() => setTimeout(() => window.print(), 150)} data-testid="print-briefing">
              <Printer />Print the briefing
            </DropdownMenuItem>
          )}
          {card === "navlog" && !local && (
            <DropdownMenuItem
              disabled={!routed} data-testid="print-kneeboard"
              onSelect={() => setTimeout(() => void import("../../../lib/printKneeboard").then(m => m.printKneeboard()), 150)}
            >
              <Printer />Print the nav log
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {askingReview && reviewSheet(() => setAskingReview(false))}
    </ResponsivePopover>
  );
}

/** A menu item's name and, under it, the one line a panel's file needs:
 *  where it goes, or that the panel will not load all of it. */
function Lines({ label, help }: { label: string; help: string }) {
  return (
    <span className="flex min-w-0 flex-col">
      <span>{label}</span>
      <span className={cn("text-muted-foreground", TEXT.note)}>{help}</span>
    </span>
  );
}

/** The points with their Garmin types and ICAO regions, from the planner;
 *  as they are where it cannot say. */
async function withCodes(points: PlanPoint[]): Promise<PlanPoint[]> {
  const asked = points.filter(p => p.kind !== "checkpoint" && /^[A-Z0-9]{1,7}$/i.test(p.ident));
  if (!asked.length) return points;
  try {
    const codes = await api.waypointCodes(asked.map(p => `${p.kind === "airport" ? "A" : "F"}:${p.ident.toUpperCase()}:${p.lat.toFixed(5)}:${p.lon.toFixed(5)}`).join(","));
    const byPoint = new Map(asked.map((p, i) => [p, codes[i]]));
    return points.map(p => (byPoint.get(p) ? { ...p, code: { type: byPoint.get(p)!.type ?? null, region: byPoint.get(p)!.region ?? null } } : p));
  } catch {
    return points;
  }
}
