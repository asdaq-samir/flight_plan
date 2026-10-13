import { useQuery } from "@tanstack/react-query";
import { Route } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { cn } from "cn";
import { PillSection, PillStrip, SmallMark, SmallTile } from "../../../components/Favorites";
import { api } from "../../../lib/api/client";
import { planHrefOf } from "../../../lib/flightLink";
import { pilotQuery } from "../../../lib/queryClient";
import { TEXT } from "../../../lib/text";

/** The most the strip shows, newest first; SAVED's title opens them all. */
const STRIP_MOST = 10;

/**
 * FPL's pill with no route: the flights the pilot saved, as small tiles --
 * the route and the day -- newest first, a tap loading one onto the map;
 * the title opens them all (`onMore`), at the owner's pick of the redesign
 * ("Can we make fpl no route to be P3?"). Saved flights are FPL's now,
 * where they were the console's. Signed out, a word of where they would be.
 */
export default function SavedStrip({ onMore }: { onMore: () => void }) {
  const navigate = useNavigate();
  const { data: pilot } = useQuery(pilotQuery);
  const { data: flights } = useQuery({ queryKey: ["flights"], queryFn: api.flights.list, enabled: !!pilot, meta: { silent: true } });
  const shown = [...(flights ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, STRIP_MOST);
  return (
    <PillSection title="Saved" onMore={pilot ? onMore : undefined} testId="pill-section-saved">
      {!pilot ? (
        <p className={cn("py-1 text-foreground/65", TEXT.note)}>Sign in to keep the flights you plan.</p>
      ) : flights && !shown.length ? (
        <p className={cn("py-1 text-foreground/65", TEXT.note)}>Plan a route and Save it from Share; it is kept here.</p>
      ) : (
        <PillStrip testId="saved-strip">
          {shown.map(f => {
            const day = new Date(f.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" });
            const name = `${f.departureIdent}→${f.destinationIdent}`;
            return (
              <SmallTile
                key={f.id} onClick={() => navigate(planHrefOf(f))} testId="saved-flight" title={name} detail={day} wide
                label={`${f.departureIdent} to ${f.destinationIdent}${f.stops.length ? ` by ${f.stops.join(", ")}` : ""}, saved ${day}`}
                mark={<SmallMark icon={<Route />} className="bg-foreground/8 text-tint" />}
              />
            );
          })}
        </PillStrip>
      )}
    </PillSection>
  );
}
