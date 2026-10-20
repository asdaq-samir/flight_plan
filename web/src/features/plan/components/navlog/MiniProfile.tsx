import { memo, useMemo } from "react";
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
export default memo(function MiniProfile({ ends, selected, legs, onOpen, preview = null }: {
  ends: RouteEnds;
  selected: Candidate[];
  legs: Leg[];
  onOpen?: () => void;
  /** An altitude on the Profile card's wheel not yet flown (AltitudeProfile):
   *  a dashed line across at it, named, until the plan comes to it. */
  preview?: number | null;
}) {
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
  const top = Math.ceil((highest + 300) / 500) * 500;
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
      <span className="relative block min-h-0">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block h-full w-full" aria-hidden="true">
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
        <path d={ground} fill="#8b6f47" fillOpacity={0.45} />
        <path d={line} fill="none" stroke="var(--primary)" strokeWidth={2.5} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        {preview !== null && (
          <line
            x1={0} x2={W} y1={y(preview)} y2={y(preview)} stroke="var(--primary)" strokeWidth={2} strokeDasharray="6 4"
            vectorEffect="non-scaling-stroke" data-testid="mini-profile-preview"
          />
        )}
      </svg>
      {/* Each airspace named for its airport, at the owner's ask ("can the
          profile view airspaces have airport ids on them"): over its
          widest piece, in its own colour, under its top edge -- words,
          not drawn in the stretched SVG. */}
      {named.map(a => (
        <span
          key={a.key}
          className="pointer-events-none absolute -translate-x-1/2 rounded bg-background/80 px-1 font-semibold"
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
          className="absolute left-1/2 -translate-x-1/2 rounded bg-background/80 px-1 font-semibold text-foreground"
          style={{ top: `calc(${(y(preview ?? cruise) / H) * 100}% + 3px)` }} aria-hidden="true" data-testid="mini-profile-cruise"
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
