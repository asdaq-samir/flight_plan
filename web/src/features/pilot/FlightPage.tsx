import { useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Check, Upload, X } from "lucide-react";
import { cn } from "cn";
import { ListGroup, ListRow } from "../../components/GroupedList";
import ConsoleClose from "../../components/ConsoleClose";
import { api } from "../../lib/api/client";
import type { Flight, FlightSummary } from "../../lib/api/types";
import {
  ALTITUDE_FT, COURSE_DEG, debrief, ETA_MIN, OFF_ROUTE_NM, PATTERN_FT, PATTERN_NM, type Debrief,
} from "../../lib/debrief";
import { LEVEL_TONE, riskLine, type RiskLevel } from "../../lib/frat";
import { TEXT } from "../../lib/text";
import { keepTrack, keptTrack, readTrack, thin, TrackError, type TrackPoint } from "../../lib/track";
import { useFlownTrack } from "../../lib/map/flownTrack";
import { routeName } from "../../lib/identSchema";
import { altFt, feet, grouped } from "../../lib/units";

/** Minutes as a nav log writes them: "0:18", "1:35". */
function hm(min: number): string {
  const whole = Math.round(min);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** A difference as said, its sign after rounding: "+3 min", "±0 min". */
function signed(n: number, unit = ""): string {
  const whole = Math.round(n);
  return `${whole > 0 ? "+" : whole < 0 ? "−" : "±"}${grouped(Math.abs(whole))}${unit}`;
}

/** A tolerance met or not, as the drills mark one. */
function Mark({ ok }: { ok: boolean }) {
  return ok
    ? <Check className="size-4 text-green-700 dark:text-green-400" aria-label="Within" />
    : <X className="size-4 text-red-700 dark:text-red-400" aria-label="Outside" />;
}

/**
 * The flown altitude along the course over the plan's, a step a leg:
 * drawn, not read -- the figures are in the rows under it.
 */
function Profile({ d }: { d: Debrief }) {
  const end = Math.max(...d.planned.map(p => p.toNm), ...d.profile.map(p => p.alongNm));
  const alts = [...d.profile.map(p => p.altFt), ...d.planned.flatMap(p => (p.altFt == null ? [] : [p.altFt]))];
  if (end <= 0 || alts.length === 0) return null;
  const low = Math.floor(Math.min(...alts) / 500) * 500, high = Math.ceil(Math.max(...alts) / 500) * 500 || low + 500;
  const x = (nm: number) => (nm / end) * 300;
  const y = (ft: number) => 100 - ((ft - low) / (high - low)) * 100;
  const flown = d.profile.map((p, i) => `${i ? "L" : "M"}${x(p.alongNm).toFixed(1)} ${y(p.altFt).toFixed(1)}`).join(" ");
  return (
    <figure className="space-y-1 px-3 py-3" data-testid="debrief-profile">
      <div className={cn("flex justify-between text-muted-foreground tabular-nums", TEXT.note)}>
        <span>{feet(high)}</span>
        <span className="flex gap-3">
          <span><span className="mr-1 inline-block h-0.5 w-4 bg-tint align-middle" />Planned</span>
          <span><span className="mr-1 inline-block h-0.5 w-4 bg-foreground align-middle" />Flown</span>
        </span>
      </div>
      <svg viewBox="0 0 300 100" preserveAspectRatio="none" className="h-28 w-full" role="img" aria-label="Flown altitude along the course, over the planned">
        {d.planned.map((p, i) => p.altFt != null && (
          <line
            key={i} x1={x(p.fromNm)} x2={x(p.toNm)} y1={y(p.altFt)} y2={y(p.altFt)}
            className="stroke-tint" strokeWidth={2} strokeDasharray="4 3" vectorEffect="non-scaling-stroke"
          />
        ))}
        <path d={flown} fill="none" className="stroke-foreground" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      </svg>
      <div className={cn("flex justify-between text-muted-foreground tabular-nums", TEXT.note)}>
        <span>{feet(low)} · 0 nm</span>
        <span>{end.toFixed(0)} nm</span>
      </div>
    </figure>
  );
}

/** The debrief's findings: the flight in a line, then leg by leg, the
 *  checkpoints and the patterns, each against its ACS tolerance. */
function Findings({ d }: { d: Debrief }) {
  return (
    <div className="space-y-4">
      {d.notes.length > 0 && (
        <ul className={cn("list-disc space-y-0.5 pl-5 text-amber-700 dark:text-amber-400", TEXT.prose)} data-testid="debrief-notes">
          {d.notes.map(note => <li key={note}>{note}</li>)}
        </ul>
      )}
      <ListGroup title="The flight">
        <ListRow title="Took off" value={format(new Date(d.takeoff), "d MMM, HH:mm")} />
        <ListRow
          title="In the air" description={d.plannedMin != null ? `${hm(d.plannedMin)} planned` : undefined}
          value={hm(d.flownMin)} data-testid="debrief-time"
        />
        {d.hasAltitude && <Profile d={d} />}
      </ListGroup>

      <ListGroup
        title="Leg by leg"
        footer={`PA.VI.A: within ${OFF_ROUTE_NM} nm of the route, and ${ALTITUDE_FT} ft and ${COURSE_DEG}° in the cruise, the climb and the descent left out. GPS altitude is not the altimeter's, and a ground track is not a heading: close to what an examiner sees, not it.`}
      >
        {d.legs.map((leg, i) => {
          const altOk = leg.worstAltFt == null || Math.abs(leg.worstAltFt) <= ALTITUDE_FT;
          const routeOk = leg.worstOffNm == null || Math.abs(leg.worstOffNm) <= OFF_ROUTE_NM;
          return (
            <ListRow
              key={i} media={<Mark ok={altOk && routeOk} />}
              title={`${leg.from} → ${leg.to}`}
              description={(
                <>
                  <span className="block">
                    {leg.altitudeWithin == null
                      ? d.hasAltitude ? "Altitude: no cruise on this leg" : "Altitude: the file has none"
                      : `Altitude: ${Math.round(leg.altitudeWithin * 100)}% within ${ALTITUDE_FT} ft of ${feet(leg.plannedAltFt)}${leg.worstAltFt != null ? `, at most ${signed(leg.worstAltFt, " ft")}` : ""}`}
                  </span>
                  {leg.courseWithin != null && leg.courseDeg != null && (
                    <span className="block">
                      Course: {Math.round(leg.courseWithin * 100)}% within {COURSE_DEG}° of {String(Math.round(leg.courseDeg) % 360 || 360).padStart(3, "0")}°
                      {leg.worstOffNm != null && `, at most ${Math.abs(leg.worstOffNm).toFixed(1)} nm ${leg.worstOffNm >= 0 ? "right" : "left"} of the line`}
                    </span>
                  )}
                </>
              )}
              data-testid="debrief-leg"
            />
          );
        })}
      </ListGroup>

      <ListGroup title="Checkpoints" footer={`PA.VI.A: each within ${ETA_MIN} minutes of its estimate, from the takeoff.`}>
        {d.passes.map((p, i) => {
          const landed = p.category === "destination" || p.category === "stop";
          const late = p.dueMin != null && p.passedMin != null ? p.passedMin - p.dueMin : null;
          return (
            <ListRow
              key={i} media={late != null ? <Mark ok={Math.abs(late) <= ETA_MIN} /> : undefined}
              title={p.name}
              description={[
                p.dueMin != null && `Due ${hm(p.dueMin)}`,
                p.passedMin != null ? `${landed ? "landed" : "passed"} ${hm(p.passedMin)}${late != null ? ` (${signed(late, " min")})` : ""}` : "not reached",
                !landed && p.closestNm != null && `${p.closestNm.toFixed(1)} nm from it at closest`,
              ].filter(Boolean).join(" · ")}
              data-testid="debrief-checkpoint"
            />
          );
        })}
      </ListGroup>

      {d.patterns.length > 0 && (
        <ListGroup title="Into the pattern" footer={`PA.III.B: pattern altitude within ${PATTERN_FT} ft, read ${PATTERN_NM} nm from the field, about where the downwind starts.`}>
          {d.patterns.map(p => (
            <ListRow
              key={p.ident} media={<Mark ok={Math.abs(p.altFt - p.patternFt) <= PATTERN_FT} />}
              title={p.ident} description={`Pattern altitude ${feet(p.patternFt)}`}
              value={`${altFt(p.altFt)} ft (${signed(p.altFt - p.patternFt)})`} data-testid="debrief-pattern"
            />
          ))}
        </ListGroup>
      )}
    </div>
  );
}

type Track = { source: string; points: TrackPoint[] };

/**
 * The debrief: a track imported from the pilot's own app (GPX or KML),
 * read against the saved flight's nav log (lib/debrief). The track stays
 * on this device unless the pilot saves it to their account, and either
 * can be forgotten.
 */
function DebriefSection({ flight, planHref }: { flight: Flight; planHref: string }) {
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const [local, setLocal] = useState<Track | null>(() => keptTrack(flight.id));
  const [problem, setProblem] = useState<string | null>(null);
  const saved = useQuery({ queryKey: ["flight-track", flight.id], queryFn: () => api.flights.track(flight.id) });
  const track: Track | null = useMemo(
    () => local ?? (saved.data ? { source: saved.data.source, points: saved.data.points } : null),
    [local, saved.data],
  );
  const fields = [...new Set(flight.checkpoints.filter(c => ["departure", "stop", "destination"].includes(c.category)).map(c => c.name))];
  const places = useQueries({ queries: fields.map(ident => ({ queryKey: ["airport", ident], queryFn: () => api.airport(ident), staleTime: 3_600_000 })) });
  const patterns = Object.fromEntries(fields.flatMap((ident, i) => {
    const ft = places[i]?.data?.pattern?.altitude_ft;
    return ft == null ? [] : [[ident, ft]];
  }));
  const patternKey = JSON.stringify(patterns);
  const result = useMemo(
    () => (track ? debrief(flight, track.points, patterns) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `patterns` by its contents
    [flight, track, patternKey],
  );

  const save = useMutation({
    mutationFn: (t: Track) => api.flights.saveTrack(flight.id, t),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["flight-track", flight.id] }),
  });
  const unsave = useMutation({
    mutationFn: () => api.flights.deleteTrack(flight.id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["flight-track", flight.id] }),
  });

  const read = async (file: File) => {
    setProblem(null);
    try {
      const points = thin(readTrack(await file.text()));
      const next = { source: file.name.slice(0, 120), points };
      setLocal(next);
      if (!keepTrack(flight.id, next)) setProblem("This browser would not keep the track: it is here until you leave the page.");
    } catch (err) {
      setProblem(err instanceof TrackError ? err.message : "That file could not be read.");
    }
  };
  const forget = () => {
    keepTrack(flight.id, null);
    setLocal(null);
  };

  const showTrack = useFlownTrack(s => s.show);
  const onAccount = !!saved.data;
  return (
    <div className="space-y-4" data-testid="debrief">
      <ListGroup
        title="Debrief"
        footer="Your track log from ForeFlight, Garmin Pilot or a GPS, as GPX or KML, read against this flight's nav log. It stays on this device unless you save it to your account."
      >
        {track && (
          <ListRow
            title={track.source}
            description={`${grouped(track.points.length)} points · ${local ? "on this device" : "saved to your account"}${local && onAccount ? " and your account" : ""}`}
            data-testid="debrief-source"
          />
        )}
        <ListRow
          title={track ? "Import another track" : "Import a track"} media={<Upload className="size-5" aria-hidden />}
          onClick={() => input.current?.click()} data-testid="debrief-import"
        />
        {track && !onAccount && (
          <ListRow title="Save to your account" onClick={() => save.mutate(track)} disabled={save.isPending} data-testid="debrief-save" />
        )}
        {onAccount && (
          <ListRow title="Remove from your account" onClick={() => unsave.mutate()} disabled={unsave.isPending} data-testid="debrief-unsave" />
        )}
        {local && <ListRow title="Forget it on this device" onClick={forget} data-testid="debrief-forget" />}
        {result && (
          // Onto the chart over its own route, red where it was outside a
          // tolerance; the map's buttons have its key and Hide.
          <ConsoleClose>
            <ListRow
              title="Show on the map" to={planHref} data-testid="debrief-show"
              onClick={() => showTrack({
                flightId: flight.id, title: routeName(flight.departureIdent, flight.destinationIdent, flight.stops),
                departure: flight.departureIdent, destination: flight.destinationIdent, line: result.line,
              })}
            />
          </ConsoleClose>
        )}
      </ListGroup>
      <input
        ref={input} id={inputId} type="file" className="hidden" accept=".gpx,.kml,application/gpx+xml,application/vnd.google-earth.kml+xml"
        onChange={e => { const file = e.target.files?.[0]; e.target.value = ""; if (file) void read(file); }}
        data-testid="debrief-file"
      />
      {(problem || save.error || unsave.error) && (
        <p className={cn("px-1 text-red-700 dark:text-red-400", TEXT.prose)} role="alert" data-testid="debrief-problem">
          {problem ?? (save.error ?? unsave.error)?.message}
        </p>
      )}
      {track && !result && (
        <p className={cn("px-1 text-muted-foreground", TEXT.prose)}>
          No flight in this track: it never went faster than taxiing.
        </p>
      )}
      {result && <Findings d={result} />}
    </div>
  );
}

function Row({ title, value }: { title: string; value: ReactNode }) {
  return <ListRow title={title} value={value} />;
}

/**
 * One saved flight, as the console's Flights page opens it: what was
 * filed, the risk assessment it was saved with, a way back onto the map
 * at its altitude, and its debrief.
 */
export default function FlightPage({ summary, planHref }: { summary: FlightSummary; planHref: string }) {
  const { data: flight, isPending, error } = useQuery({ queryKey: ["flight", summary.id], queryFn: () => api.flights.get(summary.id) });
  return (
    <div className="space-y-4">
      <ListGroup footer={`Filed ${format(new Date(summary.createdAt), "d MMM yyyy")}.`}>
        {summary.aircraftTailNumber && <Row title="Aircraft" value={summary.aircraftTailNumber} />}
        <Row title="Altitude" value={feet(summary.cruiseAltitudeFt)} />
        {summary.totalDistanceNm != null && <Row title="Distance" value={`${summary.totalDistanceNm.toFixed(1)} nm`} />}
        {summary.totalEteMin != null && <Row title="Time" value={hm(summary.totalEteMin)} />}
        {summary.totalFuelGal != null && <Row title="Fuel" value={`${summary.totalFuelGal.toFixed(1)} gal`} />}
        {summary.plannedFor && <Row title="Planned for" value={format(new Date(summary.plannedFor), "d MMM, HH:mm")} />}
        {summary.risk && (
          <ListRow
            title="Risk"
            description={summary.risk.factors.join(" · ") || undefined}
            value={<span className={LEVEL_TONE[summary.risk.level as RiskLevel]}>{riskLine(summary.risk)}</span>}
          />
        )}
        <ConsoleClose>
          <ListRow title="Open on the map" to={planHref} data-testid="flight-open" />
        </ConsoleClose>
      </ListGroup>
      {isPending ? (
        <p role="status" className={cn("px-1 text-muted-foreground", TEXT.note)}>Fetching its nav log…</p>
      ) : error || !flight ? (
        <p className={cn("px-1 text-red-700 dark:text-red-400", TEXT.prose)}>Its nav log could not be fetched ({error?.message ?? "not found"}).</p>
      ) : (
        <DebriefSection flight={flight} planHref={planHref} />
      )}
    </div>
  );
}
