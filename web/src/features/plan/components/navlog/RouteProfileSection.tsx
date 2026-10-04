import { Suspense, lazy } from "react";
import { useQuery } from "@tanstack/react-query";
import AccordionSection from "../../../../components/AccordionSection";
import { ListGroup, ListRow } from "../../../../components/GroupedList";
import { api } from "../../../../lib/api/client";
import { altFt } from "../../../../lib/units";
import { planProfile } from "./profile";
import type { NavLogRow, RouteEnds } from "./rows";

/** Recharts, with the section rather than with the page (the bundle's
 *  critical path, as the console's charts are). */
const ProfileChart = lazy(() => import("./ProfileChart"));

/** "Chicago Class B" from the FAA's "CHICAGO CLASS B". */
const titled = (name: string) => name.toLowerCase().replace(/\b\w/g, c => c.toUpperCase()).replace(/\bClass\b/i, "Class");

/**
 * The route from the side (ProfileChart): the ground, the controlled
 * airspace it passes through and the plan's altitudes over them, asked
 * of the planner only once the section is opened (or printed), and the
 * airspace as rows under it -- what the picture shows, in words.
 */
export default function RouteProfileSection({ ends, rows, wanted }: { ends: RouteEnds; rows: NavLogRow[]; wanted: boolean }) {
  const dep = ends.departure.ident, dest = ends.destination.ident;
  const stops = (ends.stops ?? []).map(s => s.ident);
  const { data: profile, isError } = useQuery({
    queryKey: ["route-profile", dep, ...stops, dest],
    queryFn: () => api.routeProfile(dep, dest, stops),
    enabled: wanted, staleTime: Infinity, meta: { silent: true },
  });
  const plan = planProfile(rows);
  const highest = profile ? Math.max(...profile.terrain.map(t => t.ground_ft)) : null;
  const classes = profile ? [...new Set(profile.airspace.map(a => a.class))].sort() : [];
  const summary = !profile ? (isError ? "Could not be drawn" : "The ground, the airspace and the plan from the side")
    : `Ground to ${altFt(highest)} ft${classes.length ? ` · through Class ${classes.join(", ")}` : ""}`;
  // One row per airspace, its pieces at the same floor joined.
  const joined = new Map<string, NonNullable<typeof profile>["airspace"][number]>();
  for (const a of profile?.airspace ?? []) {
    const key = `${a.name}|${a.floor_ft}|${a.ceiling_ft}`;
    const held = joined.get(key);
    joined.set(key, held ? { ...held, from_nm: Math.min(held.from_nm, a.from_nm), to_nm: Math.max(held.to_nm, a.to_nm) } : a);
  }
  const crossed = [...joined.values()];
  return (
    <AccordionSection title="Profile" summary={summary}>
      {profile && (
        <>
          <Suspense fallback={<div className="h-48" />}>
            <ProfileChart profile={profile} plan={plan} />
          </Suspense>
          {crossed.length > 0 && (
            <div className="pt-3">
              <ListGroup title="Airspace on the route">
                {crossed.map(a => (
                  <ListRow
                    key={`${a.name}-${a.floor_ft}-${a.from_nm}`}
                    title={titled(a.name)}
                    description={`${a.floor_ft === 0 ? "Surface" : `${altFt(a.floor_ft)} ft`} to ${a.ceiling_ft != null ? `${altFt(a.ceiling_ft)} ft` : "—"}`}
                    value={`${Math.round(a.from_nm)}–${Math.round(a.to_nm)} nm`}
                  />
                ))}
              </ListGroup>
            </div>
          )}
        </>
      )}
    </AccordionSection>
  );
}
