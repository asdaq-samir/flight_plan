import { memo, useMemo } from "react";
import { Area, ComposedChart, Line, ReferenceArea, XAxis, YAxis, usePlotArea, useXAxisScale, useYAxisScale } from "recharts";
import { ChartContainer, type ChartConfig } from "../../../components/ui/chart";
import { usePastFlight } from "../../../lib/map/pastFlight";
import type { PastFlightPoint, RouteProfile } from "../../../lib/api/types";
import { clockTime } from "../../../lib/clock";
import { altFt, grouped } from "../../../lib/units";
import { when } from "./pastFlightFormat";
import { TRACES } from "./flightTraces";
import { AIRSPACE, ceilingOverFloor, ceilings, nameFits, namedPieces } from "./navlog/profile";

// Green height and amber speed (flightTraces): the theme's chart greys
// read as one line.
const chartConfig = {
  alt: { label: TRACES.alt.label, theme: { light: TRACES.alt.light, dark: TRACES.alt.dark } },
  kt: { label: TRACES.kt.label, theme: { light: TRACES.kt.light, dark: TRACES.kt.dark } },
} satisfies ChartConfig;

/** A past flight's height and ground speed (PastFlightCard), in a chunk
 *  of its own, loaded once a flight is opened: drawn again with each
 *  second of a replay, for its mark. The plan's dry run (DryRunControls)
 *  gives the distance flown by each point (`alongNm`), and is drawn as the
 *  owner asked of it: no axes up the sides, its labels coloured as their
 *  traces said over it instead; room over the traces at the top; and
 *  across, the distance flown, not the time ("x axis can be just
 *  distance"), its mark where the moment is along the course. */
const FlightChart = memo(function FlightChart({ points, fromStart = false, alongNm, airspace = null, laid }: {
  points: PastFlightPoint[];
  /** The mark at the first point before the run is played (the dry
   *  run's), where a replay's has none till then. */
  fromStart?: boolean;
  alongNm?: number[];
  /** The route from the side (vfr.profile), for a dry run's airspace. */
  airspace?: RouteProfile | null;
  /** Where a fraction of the way along the route is along the run, for
   *  the airspace: a dry run's own where an approach flown has made the
   *  run longer than the route near its end (runNmAt), else evenly. */
  laid?: (fraction: number) => number;
}) {
  const data = useMemo(() => points.map((p, i) => ({ t: p.t, nm: alongNm?.[i] ?? null, alt: p.alt_ft ?? 0, kt: p.gs_kt ?? null })), [points, alongNm]);
  const plain = !!alongNm;
  // The white space on top, a quarter again over the highest height; the
  // speed held to the chart's lower half, so the two traces read apart
  // where both run level (the owner's recording: a cruise at 3,000 ft and
  // 108 kt drew both as one line along the top).
  const headroom = (max: number) => Math.ceil(max * 1.25);
  const lowerHalf = (max: number) => Math.ceil(max * 2.2);
  // The Class B, C and D the course passes through, floor to ceiling
  // where the run crosses them, as the side view draws them (MiniProfile),
  // at the owner's ask ("Also draw the airspace on the dry run as well"):
  // the profile's distances, along the straight route, laid onto the
  // run's, as the side view lays the plan's onto the route's; the chart
  // tall enough for their ceilings, as the side view's is.
  const start = alongNm?.[0] ?? 0, runNm = (alongNm?.at(-1) ?? 0) - start;
  const route = plain && airspace && airspace.length_nm > 0 ? airspace : null;
  const pieces = route ? route.airspace.filter(a => AIRSPACE[a.class]) : [];
  const runAt = (nm: number) => {
    const fraction = route ? nm / route.length_nm : 0;
    return laid ? laid(fraction) : start + fraction * runNm;
  };
  const named = new Set([...namedPieces(pieces).values()].filter(a => nameFits(a, route?.length_nm ?? 0)));
  const tops = ceilings(pieces);
  const airspaceTop = tops.length ? Math.ceil((Math.max(...tops) + 300) / 500) * 500 : 0;
  // A name at the run's ends kept inside the chart: set from the box's
  // edge there, not its middle.
  const placed = (a: (typeof pieces)[number]) => {
    const middle = runNm > 0 ? (runAt((a.from_nm + a.to_nm) / 2) - start) / runNm : 0.5;
    return middle < 0.2 ? "insideTopLeft" : middle > 0.8 ? "insideTopRight" : "insideTop";
  };
  return (
    <ChartContainer config={chartConfig} className="aspect-auto h-full w-full">
      <ComposedChart data={data} margin={{ left: plain ? 12 : 0, right: plain ? 12 : 0, top: 4, bottom: 0 }}>
        {plain ? (
          <XAxis dataKey="nm" type="number" domain={["dataMin", "dataMax"]} tickLine={false} axisLine={false} minTickGap={32}
            tickFormatter={(nm: number) => `${Math.round(nm)} nm`} />
        ) : (
          <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} tickLine={false} axisLine={false} minTickGap={32}
            tickFormatter={(t: number) => clockTime(when(t))} />
        )}
        <YAxis
          yAxisId="alt" hide={plain} domain={plain ? [0, (max: number) => Math.max(headroom(max), airspaceTop)] : undefined}
          tickLine={false} axisLine={false} width={44} tickFormatter={(v: number) => `${grouped(v)}`}
        />
        <YAxis yAxisId="kt" hide={plain} domain={plain ? [0, lowerHalf] : undefined} orientation="right" tickLine={false} axisLine={false} width={32} />
        {/* Under the traces, each name once, over its widest piece, as the
            side view's: its airport's ident with its ceiling over its floor. */}
        {pieces.map((a, i) => {
          const look = AIRSPACE[a.class]!;
          return (
            <ReferenceArea
              key={i} yAxisId="alt" x1={runAt(a.from_nm)} x2={runAt(a.to_nm)} y1={a.floor_ft} y2={a.ceiling_ft ?? undefined}
              stroke={look.stroke} strokeDasharray={look.dashed ? "5 4" : undefined} strokeOpacity={0.8} fill={look.stroke} fillOpacity={0.08}
              ifOverflow="hidden"
              label={named.has(a) ? {
                value: `${a.ident || `Class ${a.class}`} ${ceilingOverFloor(a)}`.trim(), position: placed(a), fontSize: 11, fontWeight: 600, fill: look.text,
              } : undefined}
            />
          );
        })}
        <Area yAxisId="alt" dataKey="alt" type="monotone" stroke="var(--color-alt)" fill="var(--color-alt)" fillOpacity={0.15}
          strokeWidth={2} isAnimationActive={false} dot={false} />
        <Line yAxisId="kt" dataKey="kt" type="monotone" stroke="var(--color-kt)" strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls />
        <Now points={points} alongNm={alongNm} fromStart={fromStart} />
      </ComposedChart>
    </ChartContainer>
  );
});

/**
 * The replay's moment on the chart: its line, and on a dry run's the
 * height and speed riding the traces (NowMarks). Its own component, the
 * clock read here alone: given to the chart as a prop, the whole of
 * recharts was drawn again as it moved, every frame at 200x -- a long task
 * of 60 to 130 ms each on a desktop, 16 frames a second, and a tap on the
 * sheet's bar went unanswered in CI (tracking.spec, 2026-10-28).
 */
function Now({ points, alongNm, fromStart }: { points: PastFlightPoint[]; alongNm?: number[]; fromStart: boolean }) {
  const second = usePastFlight(s => (s.at === null ? null : Math.floor(s.at)));
  const at = second ?? (fromStart ? points[0]?.t ?? null : null);
  const x = useXAxisScale(), area = usePlotArea();
  if (at === null || !points.length || !x || !area) return null;
  // The moment's distance along the course, between the points either side.
  const i = Math.max(1, Math.min(points.length - 1, points.findIndex(p => p.t >= at) < 0 ? points.length - 1 : points.findIndex(p => p.t >= at)));
  const a = points[i - 1] ?? points[0]!, b = points[i] ?? a;
  const f = b.t > a.t ? Math.min(1, Math.max(0, (at - a.t) / (b.t - a.t))) : 0;
  const mix = (p: number | null | undefined, q: number | null | undefined) => (p == null || q == null ? p ?? q ?? null : p + (q - p) * f);
  const atNm = alongNm ? (at <= points[0]!.t ? alongNm[0] ?? null : at >= points.at(-1)!.t ? alongNm.at(-1) ?? null : mix(alongNm[i - 1], alongNm[i])) : null;
  const cx = x(alongNm ? atNm ?? undefined : at);
  if (cx === undefined || !Number.isFinite(cx)) return null;
  return (
    <>
      <line x1={cx} x2={cx} y1={area.y} y2={area.y + area.height} stroke="var(--tint)" strokeWidth={2} data-testid="replay-mark" />
      {alongNm && atNm !== null && <NowMarks nm={atNm} alt={mix(a.alt_ft, b.alt_ft) ?? 0} kt={mix(a.gs_kt, b.gs_kt)} />}
    </>
  );
}

/** A figure's line of words, in pixels: its box's height, and how far
 *  from its dot its middle sits, over or under it. */
const MARK_LINE_PX = 18;
const MARK_OFF_PX = 12;
/** A figure's width, in pixels a character, for its box: 13-pixel
 *  semibold figures, tabular. */
const MARK_CHAR_PX = 7.6;
/** The controls' corner over the chart, in pixels (DryRunControls): a
 *  figure that would sit under them goes under its trace instead. */
const CONTROLS_PX = { width: 150, height: 44 };

/**
 * The dry run's height and ground speed where it is, each a dot on its
 * trace with its figure by it in the trace's colour, riding the line as
 * the mark moves, at the owner's ask ("the altitude/speed number can
 * trace their lines as the bar is moving"): the higher trace's figure
 * over its line and the lower's under its own, so neither line runs
 * through words; after the mark until the last two-fifths of the run and
 * before it from there; one under the controls' corner or the chart's
 * top set under its line. Each on a box of the background, over the
 * airspace's names.
 */
function NowMarks({ nm, alt, kt }: { nm: number; alt: number; kt: number | null }) {
  const x = useXAxisScale(), yAlt = useYAxisScale("alt"), yKt = useYAxisScale("kt"), area = usePlotArea();
  const cx = x?.(nm);
  if (cx === undefined || !yAlt || !area) return null;
  const marks = [
    { key: "alt", dot: yAlt(alt), words: `${altFt(alt)} ft`, colour: "var(--color-alt)" },
    { key: "kt", dot: kt == null ? undefined : yKt?.(kt), words: `${Math.round(kt ?? 0)} kt`, colour: "var(--color-kt)" },
  ].flatMap(m => (m.dot === undefined ? [] : [{ ...m, dot: m.dot }]));
  const before = cx > area.x + area.width * 0.6;
  const top = Math.min(...marks.map(m => m.dot));
  const placed = marks.map(m => {
    const width = m.words.length * MARK_CHAR_PX + 8;
    const left = before ? cx - 6 - width : cx + 6;
    const over = m.dot === top && marks.length > 1 ? true : marks.length === 1;
    let middle = over ? m.dot - MARK_OFF_PX : m.dot + MARK_OFF_PX;
    const hidden = left + width > area.x + area.width - CONTROLS_PX.width && middle - MARK_LINE_PX / 2 < area.y + CONTROLS_PX.height;
    if (over && (hidden || middle - MARK_LINE_PX / 2 < area.y)) middle = m.dot + MARK_OFF_PX;
    middle = Math.min(area.y + area.height - MARK_LINE_PX / 2, middle);
    return { ...m, width, left, middle };
  });
  // Two set one on the other (both under their lines): the lower moved down.
  if (placed.length === 2 && Math.abs(placed[0]!.middle - placed[1]!.middle) < MARK_LINE_PX) {
    const lower = placed[0]!.dot > placed[1]!.dot ? placed[0]! : placed[1]!;
    const upper = lower === placed[0] ? placed[1]! : placed[0]!;
    lower.middle = upper.middle + MARK_LINE_PX;
  }
  return (
    <g data-testid="dry-run-now" aria-hidden>
      {placed.map(m => (
        <g key={m.key} data-mark={m.key}>
          <circle cx={cx} cy={m.dot} r={3.5} fill={m.colour} stroke="var(--background)" strokeWidth={1.5} />
          <rect x={m.left} y={m.middle - MARK_LINE_PX / 2} width={m.width} height={MARK_LINE_PX} rx={5} fill="var(--background)" fillOpacity={0.85} />
          <text
            x={m.left + m.width / 2} y={m.middle} textAnchor="middle" dominantBaseline="central" fill={m.colour}
            fontSize={13} fontWeight={600} style={{ fontVariantNumeric: "tabular-nums" }}
          >
            {m.words}
          </text>
        </g>
      ))}
    </g>
  );
}

export default FlightChart;
