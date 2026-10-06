import { useEffect, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "./api/client";
import { usePreferences, type AirspaceClass, type RecentAirport } from "./preferences";

/**
 * An airport drawn as the sectional draws its airspace -- the Favorites'
 * tiles (Favorites) and the route's pills (RouteBox) alike, one look for
 * a field wherever the planner shows one.
 */
type Space = AirspaceClass;

/** The sectional's blue and magenta, a shade lighter so a glyph in them
 *  reads on the panel's dark material too. */
export const BLUE = "#2465b8";
export const MAGENTA = "#b02e7c";

/**
 * A field's airspace as the sectional draws it, on its tile: Class B a
 * solid blue line, C solid magenta, D dashed blue, an E surface area
 * dashed magenta, and G no line at all -- the field under the shaded
 * magenta edge of the Class E above it, here a ring of the same shading.
 * Solid as a fill, dashed as a dashed ring on a wash of the colour.
 */
export const AIRSPACE: Record<Space, { name: string; style: CSSProperties }> = {
  B: { name: "Class B", style: { backgroundColor: BLUE, color: "#ffffff" } },
  C: { name: "Class C", style: { backgroundColor: MAGENTA, color: "#ffffff" } },
  D: { name: "Class D", style: { border: `2.5px dashed ${BLUE}`, backgroundColor: `${BLUE}1f`, color: BLUE } },
  E: { name: "Class E", style: { border: `2.5px dashed ${MAGENTA}`, backgroundColor: `${MAGENTA}1f`, color: MAGENTA } },
  G: { name: "Class G", style: { background: `radial-gradient(circle closest-side, ${MAGENTA}00 58%, ${MAGENTA}70 82%, ${MAGENTA}10 100%)`, color: MAGENTA } },
};

/** A kept airport's airspace class: the one remembered with it, so the
 *  tile is drawn right as the sheet opens, and its card's own answer,
 *  asked for once and kept a while. Until either is known, a plain grey
 *  tile: it was drawn as Class G, magenta, and turned blue a moment after
 *  every fresh load where the field was Class B or D. The answer is
 *  remembered with the airport for the next load. */
export function useAirspace(airport: RecentAirport, enabled = true): { name: string; style?: CSSProperties; className?: string } {
  const { data } = useQuery({
    queryKey: ["airport", airport.ident], queryFn: () => api.airport(airport.ident), staleTime: 60 * 60_000, meta: { silent: true },
    enabled,
  });
  const answered = data?.airspace_class ?? undefined;
  useEffect(() => {
    if (answered && answered !== airport.airspace) usePreferences.getState().rememberAirspace(airport.ident, answered);
  }, [answered, airport.ident, airport.airspace]);
  const known = answered ?? airport.airspace;
  return known ? AIRSPACE[known] : { name: "Airport", className: "bg-foreground/8 text-muted-foreground" };
}

