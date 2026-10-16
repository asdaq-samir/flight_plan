import { useQuery } from "@tanstack/react-query";
import { Route } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { PillStrip, SmallMark, SmallTile, StripNote, StripSection } from "../../../components/Favorites";
import { api } from "../../../lib/api/client";
import { planHrefOf } from "../../../lib/flightLink";
import { pointName } from "../../../lib/identSchema";
import { pilotQuery } from "../../../lib/queryClient";
import { useStripShows } from "../hooks/useStripShows";
import { RecentRouteTiles } from "./RecentRoutes";

/** The most the strip shows, newest first; Saved's title opens them all. */
const STRIP_MOST = 10;

/**
 * FPL's strip with no route, at the owner's pick of the redesign ("Can we
 * make fpl no route to be P3?"): the flights the pilot saved or the routes
 * planned last, picked from the filter menu at its heading's right as
 * Airport's and Aircraft's lists are, at the owner's ask ("apply the
 * filter to other cards too so for example saved and recents in fpl can
 * be filtered"); the title the list in full. Saved flights are FPL's now,
 * where they were the console's.
 */
export default function FplStrip({ onAllSaved, onAllRecents }: {
  /** The flights saved in full (FlightsPanel). */
  onAllSaved: () => void;
  /** The routes planned last in full (RecentRoutesPage). */
  onAllRecents: () => void;
}) {
  const shows = useStripShows(s => s.fpl);
  const { data: pilot } = useQuery(pilotQuery);
  return (
    <StripSection
      lists={[
        // Signed out, no list to open: a word of where they would be.
        { value: "saved", label: "Saved", onMore: pilot ? onAllSaved : undefined, section: "pill-section-saved", testId: "fpl-shows-saved" },
        { value: "recents", label: "Recents", onMore: onAllRecents, section: "route-recents", testId: "fpl-shows-recents" },
      ]}
      shows={shows} onShow={fpl => useStripShows.setState({ fpl })} menuTestId="fpl-strip-shows"
    >
      {shows === "saved" ? <SavedTiles signedIn={!!pilot} /> : <RecentRouteTiles />}
    </StripSection>
  );
}

/** The flights saved as small tiles -- the route and the day -- newest
 *  first, a tap loading one onto the map. Signed out, a word of where they
 *  would be. */
function SavedTiles({ signedIn }: { signedIn: boolean }) {
  const navigate = useNavigate();
  const { data: flights } = useQuery({ queryKey: ["flights"], queryFn: api.flights.list, enabled: signedIn, meta: { silent: true } });
  const shown = [...(flights ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, STRIP_MOST);
  if (!signedIn) return <StripNote>Sign in to keep the flights you plan.</StripNote>;
  if (flights && !shown.length) return <StripNote>Plan a route and Save it from Share; it is kept here.</StripNote>;
  return (
    <PillStrip testId="saved-strip">
      {shown.map(f => {
        const day = new Date(f.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" });
        // A flight from a position by its coordinates as a GPS writes
        // them (pointName), cut short on the tile and whole to a screen
        // reader, at the owner's pick ("Coordinates, cut short").
        const dep = pointName(f.departureIdent), dest = pointName(f.destinationIdent);
        const name = `${dep}→${dest}`;
        return (
          <SmallTile
            key={f.id} onClick={() => navigate(planHrefOf(f))} testId="saved-flight" title={name} detail={day} wide
            label={`${dep} to ${dest}${f.stops.length ? ` by ${f.stops.join(", ")}` : ""}, saved ${day}`}
            mark={<SmallMark icon={<Route />} className="bg-foreground/8 text-tint" />}
          />
        );
      })}
    </PillStrip>
  );
}
