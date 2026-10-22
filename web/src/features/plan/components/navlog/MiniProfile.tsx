import { memo, useId, useMemo, type CSSProperties } from "react";
import { AIRSPACE, ceilingOverFloor, ceilings, nameFits, namedPieces } from "./profile";
import { useQuery } from "@tanstack/react-query";
import { cn } from "cn";
import type { Candidate, Leg } from "../../../../lib/api/types";
import { routeProfileQuery } from "../../../../lib/queryClient";
import { TEXT } from "../../../../lib/text";
import { altFt } from "../../../../lib/units";
import { planProfile } from "./profile";
import { navLogRows, type RouteEnds } from "./rows";
const W = 340, H = 64;
const miles = (nm: number) => `${Math.round(nm)}`;
/** The ruler's heights for a chart `top` feet tall, up to three times it
 *  for the drag's zoom out: every 1,000 ft to 6,000, 2,000 to 12,000, then
 *  every 4,000 -- five or six in sight. */
const rulerMarks = (top: number) => {
  const step = top <= 6000 ? 1000 : top <= 12_000 ? 2000 : 4000;
  return Array.from({ length: Math.floor((top * 3) / step) }, (_, i) => (i + 1) * step);
};

/**
 * FPL's pill's side view of the flight, at the owner's pick of the
 * redesign ("FPL 3, profile", the profile above the figures): the ground,
 * the Class B, C and D crossed and the plan's altitudes over them, as the
 * printed nav log's Profile draws them full (ProfileChart) -- here plain SVG, so
 * the page's first load keeps recharts out, its axes' figures words beside
 * and under it (an SVG stretched to the width would stretch them), at the
 * owner's ask ("profile can show the axis and numbers etc. since we have
 * some empty space"). The same question as
 * the full one (its query key), asked once there is a route. A tap opens
 * the nav log full on it (`onOpen`); with nothing to open, all the way up,
 * it is a picture, not a button.
 */
export default memo(function MiniProfile({ ends, selected, legs, onOpen, preview = null, scaleTop, ruler = false }: {
  ends: RouteEnds;
  selected: Candidate[];
  legs: Leg[];
  onOpen?: () => void;
  /** An altitude on the Profile card's wheel not yet flown (AltitudeProfile):
   *  a dashed line across at it, named, until the plan comes to it. */
  preview?: number | null;
  /** The chart's top, feet, where the Profile card's drag has zoomed it
   *  (AltitudeProfile); else just over the highest of what it shows. */
  scaleTop?: number;
  /** A ruler of heights down its left side, the altitude on it boxed, where
   *  the graph is dragged (the Profile card), at the owner's ask ("can't see
   *  the ruler"); none in FPL's own, at the owner's earlier ask ("y axis is
   *  not needed"). */
  ruler?: boolean;
}) {
  // An id a url(#…) takes as it is: React's has colons in it.
  const tintId = `tint${useId().replace(/[^A-Za-z0-9_-]/g, "")}`;
  const dep = ends.departure.ident, dest = ends.destination.ident;
  const stops = (ends.stops ?? []).map(s => s.ident);
  const { data: profile } = useQuery(routeProfileQuery(dep, dest, stops));
  const plan = useMemo(() => planProfile(navLogRows(ends, selected, legs)), [ends, selected, legs]);
  const cruise = Math.max(0, ...plan.points.map(p => p.plan_ft));
  if (!profile) return <div className="h-24 rounded-xl bg-background/60" aria-hidden="true" />;
  const scale = plan.length_nm > 0 ? profile.length_nm / plan.length_nm : 1;
  // The airspace's ceilings over the plan's line, at the owner's ask
  // ("Profile view should show the airspace ceilings above the altitude
  // trace"): a Class B's shelf at 10,000 was cut at the chart's top.
  const highest = Math.max(0, ...profile.terrain.map(t => t.ground_ft), cruise, preview ?? 0, ...ceilings(profile.airspace));
  // Just over the highest of the ground, the plan and the ceilings, to the
  // next 500 ft: a thousand and a half over it left the top third of the
  // chart empty, at the owner's notice ("y axis has extra white space").
  const top = scaleTop ?? Math.ceil((highest + 300) / 500) * 500;
  // The ground tinted against the altitude shown, as ForeFlight's profile
  // does (the owner's recording): red at and above it, amber within 500 ft
  // under it -- the least a flight keeps over the ground away from a
  // congested area (14 CFR 91.119(c)) -- else the ground's own. Offsets in
  // the chart's own height, moved by the Profile card's drag as it goes
  // (data-tint), not drawn again.
  const tintAt = preview ?? cruise;
  const tintOffset = (ft: number) => Math.max(0, Math.min(1, 1 - ft / top));
  const x = (nm: number) => (profile.length_nm > 0 ? (nm / profile.length_nm) * W : 0);
  const y = (ft: number) => H - (Math.max(0, Math.min(ft, top)) / top) * H;
  const ground = `M0 ${H} ${profile.terrain.map(t => `L${x(t.along_nm).toFixed(1)} ${y(t.ground_ft).toFixed(1)}`).join(" ")} L${W} ${H}Z`;
  // Each airspace's label once, over its widest piece: its airport's
  // ident, else its class.
  const named = [...namedPieces(profile.airspace)].map(([label, a]) => ({ ...a, label, key: `${label}${a.from_nm}` }))
    // Wide enough on the chart for its words.
    .filter(a => nameFits(a, profile.length_nm));
  const line = plan.points.map((p, i) => `${i ? "L" : "M"}${x(p.along_nm * scale).toFixed(1)} ${y(p.plan_ft).toFixed(1)}`).join(" ");
  const label = `Profile: ${cruise ? `cruise ${altFt(cruise)} ft` : "the route from the side"}`;
  const look = cn(
    "grid h-24 w-full shrink-0 grid-rows-[1fr_auto] overflow-hidden rounded-xl bg-background/70 px-2 pt-1.5 pb-1",
    "text-muted-foreground tabular-nums", TEXT.caption,
  );
  const chart = (
    <>
      <span
        className={cn("relative block min-h-0", ruler && "overflow-hidden")} data-plot=""
        // The drag's zoom: the chart drawn at `top`, scaled about its foot
        // to the drag's --scale-top as it goes, smoothly, nothing drawn
        // again till the finger lifts (AltitudeProfile).
        style={{ "--base-top": top } as CSSProperties}
      >
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block h-full w-full" aria-hidden="true">
        <defs>
          <linearGradient id={tintId} gradientUnits="userSpaceOnUse" x1={0} y1={0} x2={0} y2={H}>
            <stop offset={tintAt ? tintOffset(tintAt) : 0} stopColor="#d92d20" data-tint="red" />
            <stop offset={tintAt ? tintOffset(tintAt) : 0} stopColor="#e0a100" data-tint="red-end" />
            <stop offset={tintAt ? tintOffset(tintAt - 500) : 0} stopColor="#e0a100" data-tint="amber" />
            <stop offset={tintAt ? tintOffset(tintAt - 500) : 0} stopColor="#8b6f47" data-tint="amber-end" />
          </linearGradient>
        </defs>
        <g
          data-scale=""
          style={{
            transformBox: "view-box", transformOrigin: "0 100%",
            transform: "scaleY(calc(var(--base-top) / var(--scale-top, var(--base-top))))", transition: "transform 0.18s ease-out",
          }}
        >
        {profile.airspace.map((a, i) => {
          const look = AIRSPACE[a.class];
          if (!look) return null;
          const top_ = y(Math.min(a.ceiling_ft ?? top, top)), bottom = y(a.floor_ft);
          return (
            <rect
              key={i} x={x(a.from_nm)} width={Math.max(1, x(a.to_nm) - x(a.from_nm))} y={top_} height={Math.max(1, bottom - top_)}
              fill={look.stroke} fillOpacity={0.08} stroke={look.stroke} strokeOpacity={0.7} strokeDasharray={look.dashed ? "4 3" : undefined}
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
        <path d={ground} fill={`url(#${tintId})`} fillOpacity={0.55} />
        <path d={line} fill="none" stroke="var(--primary)" strokeWidth={2.5} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        {preview !== null && (
          <line
            x1={0} x2={W} y1={y(preview)} y2={y(preview)} stroke="var(--primary)" strokeWidth={2} strokeDasharray="6 4"
            vectorEffect="non-scaling-stroke" data-testid="mini-profile-preview"
          />
        )}
        </g>
      </svg>
      {/* The Profile ruler's tick as it rolls, a dashed line moved by the
          ruler itself (AltitudeProfile's --roll-ft and --roll-on, its words
          its data-label), not the chart drawn again at each tick, at the
          owner's ask ("do we need to redraw the whole thing or just move it
          up or down?"). Held at the chart's top above it, till the ruler
          rests and the chart is drawn for it. */}
      <span
        aria-hidden="true" data-roll=""
        className="pointer-events-none absolute inset-x-0 border-t-2 border-dashed border-primary opacity-[var(--roll-on,0)]"
        style={{ top: "calc((1 - min(var(--roll-ft, 0), var(--scale-top, var(--base-top))) / var(--scale-top, var(--base-top))) * 100%)" }}
      >
        <span
          data-roll-label=""
          className={cn(
            "absolute rounded bg-background px-1 font-semibold text-foreground after:content-[attr(data-label)]",
            ruler ? "left-0 -translate-y-1/2 ring-[1.5px] ring-primary" : "top-[3px] left-1/2 -translate-x-1/2 bg-background/80",
          )}
        />
      </span>
      {/* The ruler: its heights where the chart's scale puts them, moved with
          the drag's zoom as the line is (--scale-top), those over the top cut
          off by the plot; a step to keep them four or more apart. */}
      {ruler && rulerMarks(top).map(ft => (
        <span
          key={ft} aria-hidden="true"
          className="pointer-events-none absolute left-0 -translate-y-1/2 pl-0.5 text-muted-foreground opacity-[calc(1-var(--roll-on,0)*0.4)]"
          style={{ top: `calc((1 - ${ft} / var(--scale-top, var(--base-top))) * 100%)` }} data-testid="profile-ruler-mark"
        >
          {altFt(ft)}
        </span>
      ))}
      {/* Each airspace named for its airport, at the owner's ask ("can the
          profile view airspaces have airport ids on them"): over its
          widest piece, in its own colour, under its top edge -- words,
          not drawn in the stretched SVG. */}
      {named.map(a => (
        <span
          key={a.key}
          // Out of sight while the drag's own line is (data-roll): set at
          // the chart's own scale, which the drag's zoom moves.
          className="pointer-events-none absolute -translate-x-1/2 rounded bg-background/80 px-1 font-semibold opacity-[calc(1-var(--roll-on,0))]"
          style={{ left: `${(x((a.from_nm + a.to_nm) / 2) / W) * 100}%`, top: `calc(${(y(Math.min(a.ceiling_ft ?? top, top)) / H) * 100}% + 2px)`, color: AIRSPACE[a.class]!.text }}
          aria-hidden="true" data-testid="mini-profile-airspace"
        >
          {a.label} {ceilingOverFloor(a)}
        </span>
      ))}
      {/* No axis of heights: the cruise altitude named on its line, in the
          middle, is enough, at the owner's asks ("label the cruise altitude
          within the graph"; "y axis is not needed, just the cruise label is
          enough"); words, not drawn in the stretched SVG. */}
      {(preview ?? cruise) > 0 && (
        <span
          // Under the line, over the ground: with the chart's top just
          // over the cruise there is no room above it.
          // Out of sight while the ruler's own line is (data-roll).
          className={cn(
            "absolute rounded px-1 font-semibold text-foreground opacity-[calc(1-var(--roll-on,0))]",
            // Boxed on the ruler where there is one, as the drag's is.
            ruler ? "left-0 -translate-y-1/2 bg-background ring-[1.5px] ring-primary" : "left-1/2 -translate-x-1/2 bg-background/80",
          )}
          style={{ top: ruler ? `${(y(preview ?? cruise) / H) * 100}%` : `calc(${(y(preview ?? cruise) / H) * 100}% + 3px)` }} aria-hidden="true" data-testid="mini-profile-cruise"
        >
          {altFt(preview ?? cruise)} ft
        </span>
      )}
      </span>
      {/* The distance along, in nautical miles, under the chart's start,
          middle and end. */}
      <span className="flex justify-between" aria-hidden="true">
        <span>0</span><span>{miles(profile.length_nm / 2)}</span><span>{miles(profile.length_nm)} nm</span>
      </span>
    </>
  );
  return onOpen ? (
    <button
      type="button" onClick={onOpen} data-testid="mini-profile" aria-label={`${label}; opens the nav log`}
      className={cn(look, "outline-none focus-visible:ring-2 focus-visible:ring-ring")}
    >
      {chart}
    </button>
  ) : (
    <div role="img" data-testid="mini-profile" aria-label={label} className={look}>{chart}</div>
  );
});
