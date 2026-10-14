import { useCallback, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { FileArchive, FileDown, FileText, Link2, MapPinned, Printer, Send, Share, Trash2 } from "lucide-react";
import RoundButton from "../../../components/RoundButton";
import { ResponsivePopover, ResponsivePopoverAnchor } from "../../../components/ResponsivePopover";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "../../../components/ui/dropdown-menu";
import type { Candidate, Course } from "../../../lib/api/types";
import { foreflightRoute, fplOf, gpxOf, shareFile, type PlanPoint } from "../../../lib/flightPlanFiles";
import { markPackSent, openInForeFlight, packOrigin, packPath, packSent } from "../../../lib/foreflightPack";
import { routeName } from "../../../lib/identSchema";
import { showError } from "../../../lib/problems";
import { cancelled, shareOrCopy } from "../../../lib/share";
import { navLogRows } from "./navlog/rows";

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
 * ForeFlight), Save, the solo cross-country review, Print, filing the
 * flight plan and the route's close. Greyed in its places with no route
 * (cleared, or half typed), the menu keeping its shape.
 *
 * Out of the workspace (PlanWorkspace), which only says what the route is
 * and hands in what the lazy route panel draws: Save and the review's item
 * (`saving`), and the review's sheet (`reviewSheet`), opened here as the
 * menu goes.
 */
export default function ShareMenu({
  align, planned, course, selected, altitudeFt, routed, hasPoints, local, fileable, onFile, onClear, saving, reviewSheet,
}: {
  align: "start" | "end";
  planned: Planned;
  course: Course | null;
  selected: Candidate[];
  altitudeFt: number | undefined;
  /** A route planned whole, its nav log in. */
  routed: boolean;
  hasPoints: boolean;
  /** A local flight, round one field: no kneeboard card. */
  local: boolean;
  fileable: boolean;
  onFile: () => void;
  onClear: () => void;
  /** Save and the review's item, given the way to open the review's sheet. */
  saving: (askReview: () => void) => ReactNode;
  /** The review's sheet, given the way to put it away. */
  reviewSheet: (done: () => void) => ReactNode;
}) {
  const [askingReview, setAskingReview] = useState(false);

  // The plan's own address, to another device or person: the share
  // sheet where the browser has one (Safari on an iPhone) or in the iOS
  // app (lib/native), otherwise copied.
  const share = useCallback(async () => {
    const url = window.location.href;
    const title = routeName(planned.dep, planned.dest, planned.stops);
    try {
      if (await shareOrCopy({ title, url }) === "copied") toast.success("Link copied");
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
    return [{ ident: row.airport.ident, name: row.airport.name ?? row.airport.ident, kind: row.airport.kind === "fix" ? "fix" : "airport", lat: row.airport.lat, lon: row.airport.lon }];
  }), [course, selected]);

  const exportPlan = useCallback(async (kind: "fpl" | "gpx") => {
    if (!points.length) return;
    const name = routeName(planned.dep, planned.dest, planned.stops);
    const file = name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
    try {
      if (kind === "fpl") await shareFile(`${file}.fpl`, "application/xml", fplOf(points, name));
      else await shareFile(`${file}.gpx`, "application/gpx+xml", gpxOf(points, name));
    } catch (err) {
      if ((err as Error).name !== "AbortError") showError("Could not export the route", (err as Error).message);
    }
  }, [points, planned.dep, planned.dest, planned.stops]);

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
    toast.info("Sending the checkpoints to ForeFlight. When it has added them, tap Open in ForeFlight again for the route, the checkpoints by name.");
  };

  return (
    // The review's sheet, from the menu's item, placed by the Share
    // button: the menu has gone by the time it opens (as Print waits).
    <ResponsivePopover open={askingReview} onOpenChange={setAskingReview}>
      <DropdownMenu>
        <ResponsivePopoverAnchor asChild>
          <DropdownMenuTrigger asChild>
            <RoundButton label="Share this route" data-testid="share-route">
              <Share className="size-5" strokeWidth={2} />
            </RoundButton>
          </DropdownMenuTrigger>
        </ResponsivePopoverAnchor>
        <DropdownMenuContent align={align} className="min-w-56 print:hidden">
          {routed && (
            <>
              <DropdownMenuItem onSelect={() => void share()}><Link2 />Share link</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void exportPlan("fpl")} data-testid="export-fpl"><FileDown />Flight plan (.fpl)</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void exportPlan("gpx")} data-testid="export-gpx"><FileDown />GPX route (.gpx)</DropdownMenuItem>
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
          {/* Printed once the menu has gone, so it is not on the paper: the
              whole briefing, or the kneeboard card -- the nav log, radio and
              patterns on one half-letter page to fly with. */}
          <DropdownMenuItem disabled={!routed} onSelect={() => setTimeout(() => window.print(), 150)} data-testid="print-briefing">
            <Printer />Print the briefing
          </DropdownMenuItem>
          {!local && (
            <DropdownMenuItem
              disabled={!routed} data-testid="print-kneeboard"
              onSelect={() => setTimeout(() => void import("../../../lib/printKneeboard").then(m => m.printKneeboard()), 150)}
            >
              <Printer />Print a kneeboard card
            </DropdownMenuItem>
          )}
          {hasPoints && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={onClear} data-testid="route-clear"><Trash2 />Clear the route</DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {askingReview && reviewSheet(() => setAskingReview(false))}
    </ResponsivePopover>
  );
}
