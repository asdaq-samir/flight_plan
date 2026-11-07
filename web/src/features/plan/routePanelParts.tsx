import { lazy, memo, useState, type ComponentType } from "react";
import { fromChunk } from "../../lib/fromChunk";

// The planner's parts drawn from chunks of their own (PlanWorkspace and its
// sub-views, components/workspace): the pilot console and the route's panel.

// The pilot console on a chunk of its own: the account forms (react-hook-
// form, zod), the flights, the logbook and the guide are no part of a
// first load. Asked for once the page has drawn (below), so the gear
// opens it at once, drawn straight from the chunk (fromChunk); MapPage's
// AfterTheSheet holds its place meanwhile.
export const { Part: PilotPanel, prefetch: prefetchPilotPanel } = fromChunk(() => import("../pilot/PilotPanel"), m => m.PilotPanel);
// The route's own panel, a chunk of its own (routePanel), fetched once
// the page is idle and drawn where a route is. Its parts drawn straight
// from the chunk once it is in hand, and waited for (lazy) only until
// then: a part under lazy() alone waits once the first time it is drawn,
// chunk in hand or not, and the Brief's narrative, first drawn as its tab
// opened, hid the whole panel -- its tabs, with the focus in them -- while
// it did.
type RoutePanel = typeof import("./routePanel");
type PropsOf<C> = C extends ComponentType<infer P extends object> ? P : never;
let routePanel: RoutePanel | null = null;
// Asked for once the page has painted, not as its first render draws the
// chips and the hidden nav log: 608 KB, 203 KB gzipped, that shared a
// phone's connection with the fonts, the map's chunks and the engine the
// first paint waits for (issue #214). Every part has its room meanwhile
// (its Suspense), and nothing of the chunk shows on a first paint.
const painted = new Promise<void>(resolve => {
  // Where paints are not reported (Node's observer under the tests), at once.
  if (typeof PerformanceObserver === "undefined" || !PerformanceObserver.supportedEntryTypes?.includes("paint")) {
    resolve();
    return;
  }
  try {
    new PerformanceObserver((list, observer) => {
      if (!list.getEntries().some(entry => entry.name === "first-contentful-paint")) return;
      observer.disconnect();
      resolve();
    }).observe({ type: "paint", buffered: true });
  } catch {
    resolve();
  }
  // Where no paint is reported (a hidden tab, an old browser), soon anyway.
  window.setTimeout(resolve, 3000);
});
export const loadRoutePanel = () => painted.then(() => import("./routePanel")).then(m => (routePanel = m));
// Each part drawn again only when its own props change (memo): the
// workspace renders at each answer that streams in, and the route's box,
// the chips and the nav log were all drawn again each time -- 60 to 85 ms
// a time on a phone, a dozen times between Fly Here and the nav log.
function fromRoutePanel<K extends keyof RoutePanel>(name: K) {
  type Props = PropsOf<RoutePanel[K]>;
  const Waited = lazy(() => loadRoutePanel().then(m => ({ default: m[name] as ComponentType<Props> })));
  return memo(function RoutePanelPart(props: Props) {
    // Not compiled: the React Compiler (1.0.0) lost `Waited`, this
    // factory's own, from the compiled part, and the page failed to draw
    // ("Waited is not defined"). Memoised by hand already (memo).
    "use no memo";
    // The one it was first drawn with, for good: a part drawn before the
    // chunk came, switched to the module's own once it had, was a new part
    // from nothing, its state lost -- and drawn again only when its props
    // change (memo), the switch could come at any moment.
    const [Part] = useState(() => (routePanel?.[name] ?? Waited) as ComponentType<Props>);
    return <Part {...props} />;
  });
}
export const NavLogView = fromRoutePanel("NavLogView");
// FPL's route list, drawn only inside the nav log's view (its `route`),
// which waits on this chunk already: 61 KB off the first load, which
// stood 10 KB under its 1.10 MB budget (the 20 Oct audit).
export const ProceduresRoute = fromRoutePanel("ProceduresRoute");
// The Routes row, in Route Cards' head box beside the controls.
export const RouteLine = fromRoutePanel("RouteLine");
export const FlightBriefingView = fromRoutePanel("FlightBriefingView");
export const BriefingNotices = fromRoutePanel("BriefingNotices");
export const SaveFlightButton = fromRoutePanel("SaveFlightButton");
export const ReviewAskItem = fromRoutePanel("ReviewAskItem");
export const ReviewAskSheet = fromRoutePanel("ReviewAskSheet");
// The search, on a chunk of its own: the first screen draws it.
export { RouteBox } from "./routeBoxChunk";
export const RouteEnds = fromRoutePanel("RouteEnds");
export const RouteSplit = fromRoutePanel("RouteSplit");
export const Kneeboard = fromRoutePanel("Kneeboard");
export const FlightInputs = fromRoutePanel("FlightInputs");
export const AltitudeGroup = fromRoutePanel("AltitudeGroup");
export const AltitudeProfile = fromRoutePanel("AltitudeProfile");
export const BriefNarrative = fromRoutePanel("BriefNarrative");
export const RouteProblem = fromRoutePanel("RouteProblem");
export const LocalDuration = fromRoutePanel("LocalDuration");
export const BriefCard = fromRoutePanel("BriefCard");
// The cards for an airplane or a point held on the map are drawn only at a
// tap, so they ride with the route panel rather than the first load.
export const AirspaceCard = fromRoutePanel("AirspaceCard");
export const FlightCard = fromRoutePanel("FlightCard");
export const PastFlightCard = fromRoutePanel("PastFlightCard");
// An airport's card and the dry run's panel too, each drawn at a tap: with
// the React Compiler on, the first load was 11 KB past CI's 1.10 MB.
export const PlaceCard = fromRoutePanel("PlaceCard");
// The map's Stops (StopsCard), drawn at its button's tap.
export const StopsCard = fromRoutePanel("StopsCard");
export const DryRunControls = fromRoutePanel("DryRunControls");
export const DryRunFigures = fromRoutePanel("DryRunFigures");
export const FlyingHead = fromRoutePanel("FlyingHead");
