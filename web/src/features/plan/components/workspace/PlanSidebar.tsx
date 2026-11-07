import { Suspense, lazy, type ReactNode, type ComponentProps } from "react";
import { cn } from "cn";
import type { LatLon } from "../../../../lib/geo";
import { pickKeptAircraft } from "../../../../lib/tabSearch";
import { MAX_STOPS, routeName } from "../../../../lib/identSchema";
import type { FlightRules } from "../../../../lib/preferences";
import Segmented from "../../../../components/Segmented";
import { AirportRecentsPage, RecentAirportTiles, SearchResults } from "../../../../components/PanelCapsule";
import { FavoriteStrip } from "../../../../components/Favorites";
import { sameField } from "../../../../lib/procedures";
import { NearestStrip } from "../NearestStrip";
import AircraftCard, { AircraftRecentsPage } from "../AircraftCard";
import AircraftPill from "../AircraftPill";
import TabKept from "../../../../components/TabKept";
import TabPage from "../../../../components/TabPage";
import AirportPill from "../AirportPill";
import FplStrip from "../FplStrip";
import { RecentRoutesPage } from "../RecentRoutes";
import ProfileCard from "../ProfileCard";
import { BriefCard, AirspaceCard, FlightCard, PastFlightCard, PlaceCard, StopsCard, DryRunControls } from "../../routePanelParts";
import type { PlanWorkspaceModel } from "../../hooks/usePlanWorkspace";
import ProfileSideView from "./ProfileSideView";

/** The saved flights in full, FPL's card (the console's list, loaded as
 *  it opens). */
const SavedFlights = lazy(() => import("../../../pilot/AccountPanels").then(m => ({ default: m.FlightsPanel })));
// The Favorites in full, airports' and airplanes', when one is opened:
// their drag to reorder (dnd-kit, SortableRows) is kept out of the first
// load (scripts/first-load.mjs's budget, 2026-11-05).
const FavoritesList = lazy(() => import("../../../../components/FavoritesList"));
const AircraftFavoritesList = lazy(() => import("../AircraftFavoritesList"));
// Nearest's list in full, when it is opened; its strip is the pill's.
const NearestCard = lazy(() => import("../NearestCard"));

/** The flight rules a route is planned under, as the Profile card's switch
 *  offers them. */
const FLIGHT_RULES = [{ value: "vfr", label: "VFR" }, { value: "ifr", label: "IFR" }];

/**
 * The tab's body (PlanWorkspace's `sidebar`): FPL's nav log, kept mounted
 * under whatever is open over it and on paper; Airport's search, its
 * Favorites and Recents and what answers, or Nearest's list; Aircraft's
 * list. A card -- an airport's, the airspace's, an airplane's -- over the
 * tab it was opened from, its close back to it.
 */
export default function PlanSidebar({ vm, navLog, briefContents, briefNotice }: {
  vm: PlanWorkspaceModel;
  navLog: ReactNode;
  briefContents: ComponentProps<typeof BriefCard>["contents"];
  briefNotice: ReactNode;
}) {
  const {
    addFromPill, addStop, addStopField, aircraftFavoritesOpen, aircraftOpen, aircraftRecentsOpen, aircraftTyped,
    airportRecentsOpen, approachesOf, askFor, briefHere, briefLine, cardUp, closeBrief, closeCard, closeFlight, closeList, closeNearest,
    closePlace, closeProfileCard, closeSaved, closeStops, course, depAlone, depart, dropIntoRoute, dryRunning, favorites, favoritesOpen,
    findNearby, flight, flightRules, flyHere, goMissed, goMissedNow, hasPoints, heldPoint, home, keepFuelStops, marks, measuredFrom,
    moveFavoriteAirport, nearFrom, nearOpen, nearOrigin, nearStrip, openAirportOverFlight, openList, openNearest, openSaved, opened, past,
    pickPlace, picking, place, planned, profileCautions, profileHere, query, routeKey, routePoints, routeRecentsOpen, routed, s, savedOpen,
    selectFlight, selectPast, selectPlace, setApproachesOf, setFlightRules, setHomeAirport, setNearFrom, setPanel, setStopsScope, showLegs,
    stopDryRun, stopsAt, stopsHere, stopsRoute, stopsScope, stripsDrawn, suggestedAt, tab, tabTap, toggleFavoriteAirport,
  } = vm;
  const flightCard = flight && past
    ? <Suspense fallback={null}><PastFlightCard key={`${flight}-${past}`} hex={flight} id={past} onClose={() => selectPast(null)} /></Suspense>
    : flight ? <Suspense fallback={null}><FlightCard
      key={flight} hex={flight} onOpenPast={selectPast}
      onClose={closeFlight}
      onOpenAirport={openAirportOverFlight}
    /></Suspense> : null;
  // The airport's card, in the panel's body.
  const placeCard = place && (
    <Suspense fallback={null}>
      <PlaceCard
        key={place} ident={place} from={measuredFrom}
        onClose={closePlace} onFlyHere={to => void flyHere(to)} onExpand={() => setPanel("full")} onLower={() => setPanel("half")}
        // None for a point of the route, or past the planner's most stops.
        onAddStop={routePoints.includes(place) || planned.stops.length >= MAX_STOPS ? undefined
          : suggestedAt ? () => keepFuelStops(suggestedAt.after, [place]) : addStop}
        stop={suggestedAt?.stop}
        // The route's destination: when the flight lands there -- the time
        // en route and on the ground at its stops (Totals.ground_min) after
        // it leaves, as the figures' ETA -- for the hour its forecast marks.
        arrival={!s.local && sameField(place, `${planned.dest}`) && s.totals?.ete_min != null
          ? { depart: depart || null, minutes: s.totals.ete_min + (s.totals.ground_min ?? 0) } : undefined}
        startOn={approachesOf === place ? "approaches" : undefined} onStarted={() => setApproachesOf(null)}
      />
    </Suspense>
  );
  // Each tab's one strip, what it shows picked from its filter, the
  // Favorites first: half way, and all the way up the same, where it was,
  // at the owner's ask ("I want the favorites filter to stay when it's
  // full"); each list's title opens it in full, all the way up.
  const airportStrip = (
    <AirportPill
      favorites={<FavoriteStrip home={home} favorites={favorites} onOpen={a => selectPlace(a.ident)} onAddHome={() => addFromPill("home")} onAddFavorite={() => askFor("favorite")} />}
      recents={<RecentAirportTiles onPick={airport => void pickPlace(airport)} />}
      nearest={<NearestStrip fields={nearStrip} located={!!nearOrigin} onOpen={selectPlace} />}
      onAllFavorites={() => openList("favorites")}
      onAllRecents={() => openList("recents")}
      onAllNearest={openNearest}
      onFindNearby={findNearby}
    />
  );
  // With the Map switch at its right (AircraftPill).
  const aircraftStrip = (
    <AircraftPill
      onOpen={hex => selectFlight(hex)} onAddMine={() => addFromPill("mine")} onAddFavorite={() => addFromPill("airplane")} onPick={plane => selectFlight(plane.hex, plane)}
      onAllFavorites={() => openList("aircraft-favorites")}
      onAllRecents={() => openList("aircraft-recents")}
    />
  );
  return (
    <>
      {place ? (
        // Mounted at the pill as well, out of sight, so the minimized
        // tabs' Back there has a card to close.
        placeCard
      ) : heldPoint ? (
        <Suspense fallback={null}>
          <AirspaceCard
            key={`${heldPoint.lat},${heldPoint.lon}`} point={heldPoint} onClose={() => closeCard(() => selectPlace(null))}
            {...(routed && course && planned.stops.length < MAX_STOPS ? {
              onAdd: (ident: string, at: LatLon) => dropIntoRoute(ident, at, "add"),
              onDirect: (ident: string, at: LatLon) => dropIntoRoute(ident, at, "direct"),
              onHold: (ident: string, at: LatLon) => dropIntoRoute(ident, at, "hold"),
            } : {})}
          />
        </Suspense>
      ) : null}
      {/* Each tab once opened kept under the others, as iOS keeps a
          tab's screen (TabKept): back to it, as it was left. */}
      {opened.includes("aircraft") && (
        <TabKept away={cardUp || tab !== "aircraft"}>{flightCard ?? (aircraftOpen && (aircraftFavoritesOpen && !aircraftTyped ? (
          <TabPage testId="aircraft-favorites">
            <Suspense fallback={null}>
              <AircraftFavoritesList
                onBack={closeList} onOpen={hex => selectFlight(hex)}
                onChangeMine={() => { closeList(); addFromPill("mine"); }}
                onAdd={() => { closeList(); addFromPill("airplane"); }}
              />
            </Suspense>
          </TabPage>
        ) : aircraftRecentsOpen && !aircraftTyped ? (
          // Kept open under an airplane's card opened from it, as the
          // Favorites in full are: its close comes back here.
          <AircraftRecentsPage onBack={closeList} onPick={kept => pickKeptAircraft(kept, hex => selectFlight(hex))} />
        ) : (
          // The strip once, in the pill or here: at the pill's size the
          // body is out of sight but for a finger taking it up.
          <AircraftCard onPick={plane => selectFlight(plane.hex, plane)} onPickHex={hex => selectFlight(hex)} strip={stripsDrawn ? aircraftStrip : null} />
        )))}</TabKept>
      )}
      {!cardUp && tab !== "aircraft" && nearOpen && (
        <Suspense fallback={null}><NearestCard onOpen={selectPlace} from={nearFrom} onFrom={setNearFrom} onBack={closeNearest} /></Suspense>
      )}
      {opened.includes("airport") && (
        <TabKept away={cardUp || tab !== "airport" || nearOpen}>{favoritesOpen ? (
          <TabPage testId="favorites-page">
            <Suspense fallback={null}>
              <FavoritesList
                home={home} favorites={favorites}
                onBack={closeList} onOpen={airport => selectPlace(airport.ident)}
                onChangeHome={() => askFor("home")} onRemoveHome={() => setHomeAirport(null)}
                onRemove={toggleFavoriteAirport} onMove={moveFavoriteAirport} onAdd={() => askFor("favorite")}
              />
            </Suspense>
          </TabPage>
        ) : airportRecentsOpen && !query ? (
          <TabPage testId="airport-recents-list">
            <AirportRecentsPage
              onBack={closeList}
              onPick={airport => { closeList(); void pickPlace(airport); }}
            />
          </TabPage>
        ) : (
          <TabPage testId="airport-page">
            <SearchResults
              query={query} onPick={airport => void pickPlace(airport)}
              // The pill's strip where it was, the Recents under it.
              places={picking === "place" && stripsDrawn && airportStrip}
              onAllRecents={() => openList("recents")}
            />
          </TabPage>
        )}</TabKept>
      )}
      {opened.includes("fpl") && (
      <TabKept away={cardUp || tab !== "fpl"}>
      {/* And while a finger takes it up: the pill's own are out of
          sight then (the owner's notice, "Fpl hides Saved while dragging
          up"). */}
      {/* Not under the Stops with no route: FPL's Saved stood over
          its list (the owner's screenshot, 2026-10-26). */}
      {!savedOpen && !hasPoints && !stopsHere && stripsDrawn && (
        routeRecentsOpen ? (
          <TabPage testId="route-recents-list">
            <RecentRoutesPage onBack={closeList} />
          </TabPage>
        ) : (
          // The flights saved or the routes planned last, picked from its
          // filter as every tab's strip is.
          <TabPage>
            <FplStrip onAllSaved={openSaved} onAllRecents={() => openList("routes")} />
          </TabPage>
        )
      )}
      {savedOpen && (
        <TabPage testId="saved-flights">
          <Suspense fallback={null}><SavedFlights onBack={closeSaved} /></Suspense>
        </TabPage>
      )}
      {/* The Brief over FPL, a card of its own: the route's head and its
          figures out of sight while it is open, as an airport's card has
          them. */}
      {briefHere && !savedOpen && (
        <BriefCard
          name={routeName(planned.dep, planned.dest, planned.stops)} line={briefLine} contents={briefContents} notice={briefNotice}
          marks={marks} onClose={closeBrief} onTap={tabTap} onLegs={showLegs} route={routeKey}
        />
      )}
      {/* FPL's nav log once there is a route, at the pilot's ask: the
          empty box alone before. */}
      {profileHere && !savedOpen && (
        <ProfileCard
          name={routeName(planned.dep, planned.dest, planned.stops)} line={briefLine} onClose={closeProfileCard}
          cautions={profileCautions}
          corner={!s.local && (
            <Segmented
              label="Flight rules" value={flightRules} onChange={v => setFlightRules(v as FlightRules)} testId="flight-rules"
              options={FLIGHT_RULES}
            />
          )}
        >
          {/* The dry run in the side view's place while it plays, the card's
              height; its figures counting down at the sheet's foot. */}
          {dryRunning ? (
            <Suspense fallback={null}>
              <div className="flex min-h-0 flex-1 flex-col" data-testid="profile-dry-run">
                <DryRunControls run={dryRunning} ends={course} onClose={stopDryRun} missed={goMissed} onMissed={goMissedNow} />
              </div>
            </Suspense>
          ) : <ProfileSideView vm={vm} />}
        </ProfileCard>
      )}
      {stopsHere && !savedOpen && (
        <StopsCard
          at={stopsAt} route={stopsRoute} scope={stopsScope} onScope={setStopsScope} onClose={closeStops} onOpenField={selectPlace}
          onAddStop={addStopField}
        />
      )}
      <div className={cn("flex min-h-0 flex-col print:flex", depAlone ? "flex-none" : "flex-1", (savedOpen || briefHere || profileHere || stopsHere || !hasPoints) && "hidden")}>{navLog}</div>
      {/* A departure alone: under it the flights saved and the routes
          planned last, to pick from, where the sheet stood empty under
          the one field (the owner's screenshot, 2026-10-23). */}
      {depAlone && hasPoints && !savedOpen && !briefHere && !profileHere && !stopsHere && (
        <div className="px-4 pt-2" data-testid="fpl-departure-strip">
          <FplStrip onAllSaved={openSaved} onAllRecents={() => openList("routes")} />
        </div>
      )}
      </TabKept>
      )}
    </>
  );
}
