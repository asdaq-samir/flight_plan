import { memo, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "cn";
import { api } from "../../../../lib/api/client";
import type { Candidate, Leg } from "../../../../lib/api/types";
import { TEXT } from "../../../../lib/text";
import { altFt } from "../../../../lib/units";
import { planProfile } from "./profile";
import { navLogRows, type RouteEnds } from "./rows";

/** The sectional's airspace colours, as the full chart's (ProfileChart):
 *  Class B solid blue, C magenta, D blue dashed (FAA Aeronautical Chart
 *  User's Guide, Airspace). */
const AIRSPACE: Record<string, { stroke: string; dash?: string }> = {
  B: { stroke: "#2465b8" },
  C: { stroke: "#c0309f" },
  D: { stroke: "#2465b8", dash: "4 3" },
};
const W = 340, H = 64;
const miles = (nm: number) => `${Math.round(nm)}`;

/**
 * FPL's pill's side view of the flight, at the owner's pick of the
 * redesign ("FPL 3, profile", the profile above the figures): the ground,
 * the Class B, C and D crossed and the plan's altitudes over them, as the
 * nav log's Profile draws them full (ProfileChart) -- here plain SVG, so
 * the page's first load keeps recharts out, its axes' figures words beside
 * and under it (an SVG stretched to the width would stretch them), at the
 * owner's ask ("profile can show the axis and numbers etc. since we have
 * some empty space"). The same question as
 * the full one (its query key), asked once there is a route. A tap opens
 * the nav log full on it (`onOpen`).
 */
export default memo(function MiniProfile({ ends, selected, legs, onOpen }: {
  ends: RouteEnds;
  selected: Candidate[];
  legs: Leg[];
  onOpen: () => void;
}) {
  const dep = ends.departure.ident, dest = ends.destination.ident;
  const stops = (ends.stops ?? []).map(s => s.ident);
  const { data: profile } = useQuery({
    queryKey: ["route-profile", dep, ...stops, dest],
    queryFn: () => api.routeProfile(dep, dest, stops), staleTime: Infinity, meta: { silent: true },
  });
  const plan = useMemo(() => planProfile(navLogRows(ends, selected, legs)), [ends, selected, legs]);
  const cruise = Math.max(0, ...plan.points.map(p => p.plan_ft));
  if (!profile) return <div className="h-24 rounded-xl bg-background/60" aria-hidden="true" />;
  const scale = plan.length_nm > 0 ? profile.length_nm / plan.length_nm : 1;
  const highest = Math.max(0, ...profile.terrain.map(t => t.ground_ft), cruise);
  // Just over the highest of the ground and the plan, to the next 500 ft:
  // a thousand and a half over it left the top third of the chart empty,
  // at the owner's notice ("y axis has extra white space").
  const top = Math.ceil((highest + 300) / 500) * 500;
  const x = (nm: number) => (profile.length_nm > 0 ? (nm / profile.length_nm) * W : 0);
  const y = (ft: number) => H - (Math.max(0, Math.min(ft, top)) / top) * H;
  const ground = `M0 ${H} ${profile.terrain.map(t => `L${x(t.along_nm).toFixed(1)} ${y(t.ground_ft).toFixed(1)}`).join(" ")} L${W} ${H}Z`;
  const line = plan.points.map((p, i) => `${i ? "L" : "M"}${x(p.along_nm * scale).toFixed(1)} ${y(p.plan_ft).toFixed(1)}`).join(" ");
  return (
    <button
      type="button" onClick={onOpen} data-testid="mini-profile"
      aria-label={`Profile: ${cruise ? `cruise ${altFt(cruise)} ft` : "the route from the side"}; opens the nav log`}
      className={cn(
        "grid h-24 w-full shrink-0 grid-rows-[1fr_auto] overflow-hidden rounded-xl bg-background/70 px-2 pt-1.5 pb-1",
        "text-muted-foreground tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring", TEXT.caption,
      )}
    >
      <span className="relative block min-h-0">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block h-full w-full" aria-hidden="true">
        {profile.airspace.map((a, i) => {
          const look = AIRSPACE[a.class];
          if (!look) return null;
          const top_ = y(Math.min(a.ceiling_ft ?? top, top)), bottom = y(a.floor_ft);
          return (
            <rect
              key={i} x={x(a.from_nm)} width={Math.max(1, x(a.to_nm) - x(a.from_nm))} y={top_} height={Math.max(1, bottom - top_)}
              fill={look.stroke} fillOpacity={0.08} stroke={look.stroke} strokeOpacity={0.7} strokeDasharray={look.dash}
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
        <path d={ground} fill="#8b6f47" fillOpacity={0.45} />
        <path d={line} fill="none" stroke="var(--primary)" strokeWidth={2.5} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
      {/* No axis of heights: the cruise altitude named on its line, in the
          middle, is enough, at the owner's asks ("label the cruise altitude
          within the graph"; "y axis is not needed, just the cruise label is
          enough"); words, not drawn in the stretched SVG. */}
      {cruise > 0 && (
        <span
          // Under the line, over the ground: with the chart's top just
          // over the cruise there is no room above it.
          className="absolute left-1/2 -translate-x-1/2 rounded bg-background/80 px-1 font-semibold text-foreground"
          style={{ top: `calc(${(y(cruise) / H) * 100}% + 3px)` }} aria-hidden="true" data-testid="mini-profile-cruise"
        >
          {altFt(cruise)} ft
        </span>
      )}
      </span>
      {/* The distance along, in nautical miles, under the chart's start,
          middle and end. */}
      <span className="flex justify-between" aria-hidden="true">
        <span>0</span><span>{miles(profile.length_nm / 2)}</span><span>{miles(profile.length_nm)} nm</span>
      </span>
    </button>
  );
});
