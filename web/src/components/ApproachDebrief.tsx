import { useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { Check, TriangleAlert, X } from "lucide-react";
import { cn } from "cn";
import { ListGroup, ListRow } from "./GroupedList";
import { Input } from "./ui/input";
import { api } from "../lib/api/client";
import type { ProcedureDrawing, ProcedureList } from "../lib/api/types";
import {
  findApproaches, withMinimums, withTransition, type ApproachDebrief as Debriefed, type Tone,
} from "../lib/approachDebrief";
import { clockTime } from "../lib/clock";
import { rad } from "../lib/geo";
import { sameField, transitionWords, type PickedProcedure } from "../lib/procedures";
import { FINDING_TONE } from "../lib/status";
import { TEXT } from "../lib/text";
import type { TrackPoint } from "../lib/track";
import { feet } from "../lib/units";

/** A cycle's procedures hold for its 28 days: as the route's own queries
 *  of them keep them (ProceduresRoute), and under the same keys, so a
 *  drawing the map has is not asked for again. */
const STALE_MS = 6 * 60 * 60_000;
/** None picked, one array for every render, so the search is not made
 *  again at each one. */
const NO_PICKS: PickedProcedure[] = [];

const listQuery = (ident: string) => ({
  queryKey: ["procedures", ident], queryFn: () => api.procedures(ident), staleTime: STALE_MS,
});
const drawingQuery = (ident: string, id: string, transition: string | null) => ({
  queryKey: ["procedure", ident, id, transition], queryFn: () => api.procedure(ident, id, transition), staleTime: STALE_MS,
});

/** A finding's mark, as the debrief's tolerances are marked (FlightPage). */
function Mark({ tone }: { tone: Tone }) {
  if (tone === "stop") return <X className={cn("size-4", FINDING_TONE.stop)} aria-label="Outside" />;
  if (tone === "caution") return <TriangleAlert className={cn("size-4", FINDING_TONE.caution)} aria-label="To look at" />;
  if (tone === "ok") return <Check className={cn("size-4", FINDING_TONE.ok)} aria-label="Within" />;
  return <span className="size-4" aria-hidden />;
}

/**
 * The approaches a track flew, each debriefed against its procedure
 * (lib/approachDebrief): of the fields' approaches in the FAA's CIFP, the
 * one whose final the track came down, the one picked for the flight
 * where it fits as well, and then its transition. Nothing where none was
 * flown. For the pilot's own flight (FlightPage) and an airplane followed
 * (PastFlightCard), so an instructor can debrief a student's; and for a
 * lesson an instructor set (LessonAssign), `only` its approach's id, and
 * `none` said where the track did not fly it.
 */
export default function ApproachDebriefs({ fields, points, picked = NO_PICKS, only, none }: {
  fields: string[];
  points: TrackPoint[];
  picked?: PickedProcedure[];
  only?: string;
  none?: string;
}) {
  const lists = useQueries({ queries: fields.map(listQuery) });
  // Each field's approaches, from vectors to final -- the one picked with
  // its transition -- to find which final the track came down.
  const wanted = fields.flatMap((ident, k) => {
    const list = lists[k]?.data;
    if (!list) return [];
    return list.procedures.filter(p => p.kind === "approach").map(p => {
      const pick = picked.find(q => sameField(q.ident, ident) && q.id === p.id);
      return { ident, id: p.id, transition: pick?.transition ?? null };
    });
  });
  const drawings = useQueries({
    queries: wanted.map(w => drawingQuery(w.ident, w.id, w.transition)),
    combine: results => ({
      drawn: results.flatMap(r => (r.data ? [r.data] : [])),
      pending: results.some(r => r.isPending),
    }),
  });
  const listsPending = lists.some(l => l.isPending);
  const [minimums, setMinimums] = useState<Record<string, number | null>>({});
  const found = useMemo(() => {
    if (drawings.pending || drawings.drawn.length === 0) return [];
    const byField = new Map<string, ProcedureDrawing[]>();
    for (const d of drawings.drawn) byField.set(d.airport, [...(byField.get(d.airport) ?? []), d]);
    return [...byField].flatMap(([airport, ds]) => {
      const pick = picked.find(q => sameField(q.ident, airport))?.id ?? null;
      return findApproaches(ds, points, pick);
    });
  }, [drawings, points, picked]);

  // The transition it came in by, where it was not picked: each of the
  // found approaches' transitions drawn, and the one the track flew kept.
  const summaries = (d: Debriefed) => lists.flatMap(l => (l.data ? [l.data] : [])).find(l => sameField(l.airport, d.airport));
  const transitionsOf = (d: Debriefed, list: ProcedureList | undefined) =>
    d.transition ? [] : list?.procedures.find(p => p.id === d.id)?.transitions ?? [];
  const more = found.flatMap(d => transitionsOf(d, summaries(d)).map(t => ({ d, t })));
  const transitions = useQueries({
    queries: more.map(({ d, t }) => drawingQuery(d.airport, d.id, t)),
    combine: results => ({ drawn: results.flatMap(r => (r.data ? [r.data] : [])), pending: results.some(r => r.isPending) }),
  });
  const flown = useMemo(() => found.map(d => {
    const own = transitions.drawn.filter(t => t.airport === d.airport && t.id === d.id);
    return own.length ? withTransition(d, own, points) : d;
  }), [found, transitions, points]);

  if (listsPending || drawings.pending) {
    return fields.length ? <p role="status" className={cn("px-1 text-muted-foreground", TEXT.note)}>Looking for an approach in the track…</p> : null;
  }
  const shown = only ? flown.filter(d => d.id === only) : flown;
  if (shown.length === 0) {
    return none ? <p className={cn("px-1 text-muted-foreground", TEXT.prose)} data-testid="approach-debrief-none">{none}</p> : null;
  }
  return (
    <div className="space-y-4" data-testid="approach-debrief">
      {shown.map(d => {
        const key = `${d.airport}:${d.id}:${d.fafAt}`;
        return (
          <ApproachSection
            key={key} d={d} minimumsFt={minimums[key] ?? null}
            onMinimums={ft => setMinimums(m => ({ ...m, [key]: ft }))}
          />
        );
      })}
    </div>
  );
}

/** One approach flown: its name and when, its plan view and profile, the
 *  findings, and the pilot's minimums from the plate to hold it to. */
function ApproachSection({ d: given, minimumsFt, onMinimums }: {
  d: Debriefed;
  minimumsFt: number | null;
  onMinimums: (ft: number | null) => void;
}) {
  const [typed, setTyped] = useState(minimumsFt != null ? String(minimumsFt) : "");
  // The findings again with the minimums typed: the CIFP has none, and
  // the lowest before the MAP is only measured without them.
  const d = useMemo(() => withMinimums(given, minimumsFt), [given, minimumsFt]);
  return (
    <>
      {/* GPS altitude is not the altimeter's, and a ground track is not a
          needle: the title says what the figures are measured from. */}
      <ListGroup title="Approach · GPS track">
        <ListRow
          title={d.name}
          description={[
            `${d.airport} · ${transitionWords("approach", d.transition)}`,
            d.alsoFits.length ? `The same final as the ${d.alsoFits.join(", the ")}` : null,
          ].filter(Boolean).join(" · ")}
          value={clockTime(new Date(d.fafAt))} data-testid="approach-name"
        />
        <PlanView d={d} />
        {d.hasAltitude && <ProfileView d={d} />}
        <ListRow title={<label htmlFor={`mins-${d.fafAt}`}>Your minimums</label>} description="The DA or MDA you flew to, from the plate">
          <Input
            id={`mins-${d.fafAt}`} value={typed} inputMode="numeric" placeholder="ft" aria-label="Your minimums, feet MSL"
            className="h-9 w-20 text-right tabular-nums" data-testid="approach-minimums"
            onChange={e => {
              const next = e.target.value.replace(/\D/g, "").slice(0, 5);
              setTyped(next);
              onMinimums(next ? Number(next) : null);
            }}
          />
        </ListRow>
      </ListGroup>
      <ListGroup title="Findings">
        {d.findings.map((f, i) => (
          <ListRow key={i} media={<Mark tone={f.tone} />} title={f.text} data-testid="approach-finding" />
        ))}
      </ListGroup>
    </>
  );
}

/** Latitude and longitude onto a box, north up, the scale the same both
 *  ways (a plate's plan view): the procedure's way in and the track. */
function useFrame(d: Debriefed, width: number, height: number, pad: number) {
  return useMemo(() => {
    const all = [...d.plan.inbound.map(([lat, lon]) => ({ lat, lon })), ...d.plan.track];
    const lat0 = all.reduce((s, p) => s + p.lat, 0) / all.length;
    const kx = Math.cos(rad(lat0));
    const xs = all.map(p => p.lon * kx), ys = all.map(p => p.lat);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const scale = Math.min((width - 2 * pad) / Math.max(1e-6, x1 - x0), (height - 2 * pad) / Math.max(1e-6, y1 - y0));
    const ox = (width - (x1 - x0) * scale) / 2, oy = (height - (y1 - y0) * scale) / 2;
    return (lat: number, lon: number) => [ox + (lon * kx - x0) * scale, height - (oy + (lat - y0) * scale)] as const;
  }, [d, width, height, pad]);
}

const W = 320, H = 220;

/** The plan view, as a plate's: the procedure in the approaches' colour
 *  (the map's, ProcedureLayer), its missed approach dashed, each fix a
 *  diamond and its name; the track over it in the flown track's ink, red
 *  where it was past full scale or under a minimum. Drawn, not read: the
 *  figures are in the findings under it. */
function PlanView({ d }: { d: Debriefed }) {
  const at = useFrame(d, W, H, 24);
  const line = (pts: readonly (readonly [number, number])[]) => pts.map(([lat, lon], i) => `${i ? "L" : "M"}${at(lat, lon).map(n => n.toFixed(1)).join(" ")}`).join(" ");
  const runs = trackRuns(d.plan.track);
  return (
    <figure className="px-3 py-3" data-testid="approach-plan">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full overflow-hidden rounded-md bg-background" role="img"
        aria-label={`${d.name} as flown, over the procedure`}>
        {d.plan.missed.map((m, i) => (
          <path key={i} d={line(m)} fill="none" className="stroke-procedure" strokeWidth={1.5} strokeDasharray="5 4" />
        ))}
        <path d={line(d.plan.inbound)} fill="none" className="stroke-procedure" strokeWidth={2.5} strokeLinejoin="round" />
        {runs.map((r, i) => (
          <path key={i} d={line(r.points)} fill="none" className={r.off ? "stroke-destructive" : "stroke-foreground"}
            strokeWidth={r.off ? 2.5 : 1.75} strokeLinejoin="round" />
        ))}
        {d.plan.fixes.map(f => {
          const [x, y] = at(f.lat, f.lon);
          if (x < -10 || x > W + 10 || y < -10 || y > H + 10) return null;
          return (
            <g key={f.ident} transform={`translate(${x.toFixed(1)} ${y.toFixed(1)})`}>
              <path d="M0 -4.5 L4.5 0 L0 4.5 L-4.5 0 Z" className={f.roles.includes("MAP") || f.roles.includes("FAF") ? "fill-procedure" : "fill-background stroke-procedure"} strokeWidth={1.5} />
              <text x={7} y={4} className="fill-foreground" fontSize={11} fontWeight={600}>{f.ident}</text>
            </g>
          );
        })}
      </svg>
      <figcaption className={cn("flex gap-3 pt-1 text-muted-foreground", TEXT.note)}>
        <span><span className="mr-1 inline-block h-0.5 w-4 bg-procedure align-middle" />Procedure</span>
        <span><span className="mr-1 inline-block h-0.5 w-4 bg-foreground align-middle" />Flown</span>
        <span><span className="mr-1 inline-block h-0.5 w-4 bg-destructive align-middle" />Outside</span>
      </figcaption>
    </figure>
  );
}

function trackRuns(track: { lat: number; lon: number; off: boolean }[]) {
  const out: { off: boolean; points: [number, number][] }[] = [];
  track.forEach((p, i) => {
    const last = out[out.length - 1];
    if (last && last.off === p.off) last.points.push([p.lat, p.lon]);
    else out.push({ off: p.off, points: i > 0 ? [[track[i - 1]!.lat, track[i - 1]!.lon], [p.lat, p.lon]] : [[p.lat, p.lon]] });
  });
  return out;
}

/** The profile, as a plate's: each fix's minimum altitude a step until the
 *  next, the glidepath dashed to the runway, the track's altitude over
 *  them by its distance to the missed approach point. */
function ProfileView({ d }: { d: Debriefed }) {
  const { track, fixes, glidepath } = d.profile;
  if (track.length < 2) return null;
  const far = Math.max(...track.map(p => p.toGoNm), ...fixes.filter(f => f.toGoNm <= track[0]!.toGoNm + 1).map(f => f.toGoNm));
  const near = Math.min(0, ...track.map(p => p.toGoNm));
  const alts = [...track.map(p => p.altFt), ...fixes.flatMap(f => (f.minFt != null && f.toGoNm <= far ? [f.minFt] : []))];
  const low = Math.floor(Math.min(...alts) / 500) * 500, high = Math.ceil(Math.max(...alts) / 500) * 500 || low + 500;
  const x = (nm: number) => ((far - nm) / Math.max(0.1, far - near)) * 300;
  const y = (ft: number) => 100 - ((ft - low) / Math.max(1, high - low)) * 100;
  const shown = fixes.filter(f => f.toGoNm <= far && f.toGoNm >= near);
  const steps = shown.flatMap((f, i) => {
    if (f.minFt == null) return [];
    // A fix's altitude holds from the fix before it to it (AIM 5-4-5).
    const from = i > 0 ? shown[i - 1]!.toGoNm : far;
    return [{ from, to: f.toGoNm, ft: f.minFt }];
  });
  const flown = track.map((p, i) => `${i ? "L" : "M"}${x(p.toGoNm).toFixed(1)} ${y(p.altFt).toFixed(1)}`).join(" ");
  return (
    <figure className="space-y-1 px-3 py-3" data-testid="approach-profile">
      <div className={cn("flex justify-between text-muted-foreground tabular-nums", TEXT.note)}>
        <span>{feet(high)}</span>
        <span className="flex gap-3">
          <span><span className="mr-1 inline-block h-0.5 w-4 bg-procedure align-middle" />Minimums{glidepath ? " · path" : ""}</span>
          <span><span className="mr-1 inline-block h-0.5 w-4 bg-foreground align-middle" />Flown</span>
        </span>
      </div>
      <svg viewBox="0 0 300 100" preserveAspectRatio="none" className="h-28 w-full" role="img" aria-label="The track's altitude over the approach's minimums, to the missed approach point">
        {steps.map((s, i) => (
          <line key={i} x1={x(s.from)} x2={x(s.to)} y1={y(s.ft)} y2={y(s.ft)} className="stroke-procedure" strokeWidth={2} vectorEffect="non-scaling-stroke" />
        ))}
        {glidepath && (
          <line x1={x(glidepath.fromNm)} x2={x(glidepath.toNm)} y1={y(glidepath.fromFt)} y2={y(glidepath.toFt)}
            className="stroke-procedure" strokeWidth={1.5} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
        )}
        {shown.map(f => (
          <line key={f.ident} x1={x(f.toGoNm)} x2={x(f.toGoNm)} y1={0} y2={100} className="stroke-border" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        ))}
        <path d={flown} fill="none" className="stroke-foreground" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        {track.map((p, i) => p.off && (
          <line key={i} x1={x(p.toGoNm)} x2={x(p.toGoNm)} y1={y(p.altFt) - 0.01} y2={y(p.altFt)} className="stroke-destructive"
            strokeWidth={4} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
      <div className={cn("relative h-4 text-muted-foreground tabular-nums", TEXT.note)} aria-hidden>
        {shown.map(f => (
          <span key={f.ident} className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: `${(x(f.toGoNm) / 300) * 100}%` }}>{f.ident}</span>
        ))}
      </div>
      <p className={cn("text-muted-foreground tabular-nums", TEXT.note)}>{feet(low)} · {far.toFixed(0)} nm to the MAP</p>
    </figure>
  );
}
