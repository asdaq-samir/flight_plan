import { Suspense, useCallback, useDeferredValue, useMemo } from "react";
import { AirplaneGlyph, AirportGlyph, RouteGlyph } from "../../components/tabGlyphs";
import { TEXT } from "../../lib/text";
import TabBar, { type BarTab } from "../../components/TabBar";
import type { PanelTab } from "./hooks/useTabCards";
import { MAX_STOPS, routeName } from "../../lib/identSchema";
import type { WorkspaceProps } from "../page/workspace";
import ShareMenu from "./components/ShareMenu";
import type { RouteCard } from "../../lib/openCards";
import { CardHead } from "../../components/PanelCard";
import type { BriefingPart } from "./components/briefing/sections";
import PaidPrompt from "../../components/PaidPrompt";
import { PilotPanel, NavLogView, ProceduresRoute, FlightBriefingView, BriefingNotices, SaveFlightButton, ReviewAskItem, ReviewAskSheet, Kneeboard, FlightInputs, AltitudeGroup, BriefNarrative } from "./routePanelParts";
import { usePlanWorkspace } from "./hooks/usePlanWorkspace";
import PlanMap from "./components/workspace/PlanMap";
import PlanSidebar from "./components/workspace/PlanSidebar";
import FlightFoot from "./components/workspace/FlightFoot";
import RouteHead from "./components/workspace/RouteHead";
import RouteControls from "./components/workspace/RouteControls";
import TabSearchField from "./components/workspace/SearchFields";

const PLANNER_TABS: BarTab<PanelTab>[] = [
  // FPL first and Aircraft third, swapped back at the owner's ask ("Swap
  // fpl and aircraft tab positions").
  { value: "fpl", label: "FPL", icon: RouteGlyph },
  { value: "airport", label: "Airport", icon: AirportGlyph },
  { value: "aircraft", label: "Aircraft", icon: AirplaneGlyph },
  // Nearest is Airport's now, its strip under the Favorites and its list
  // in full from the strip's title, at the owner's pick of the redesign
  // ("make it 4 tabs, combining the nearest into airport").
];

/**
 * The planner: two idents in, a charted course with checkpoints and a
 * dead-reckoning nav log out -- the pilot's workspace on the page
 * (MapPage), which owns the shell around it and the route typed into
 * it.
 *
 * The address is the plan: the route, the altitude, the plan chosen
 * and the departure time are its query parameters, and every stage
 * (usePlan) is a query keyed on the ones it depends on. Loading a
 * route writes the address; a new airplane or departure time changes
 * a key; and the screen is derived from the queries on each render,
 * nothing kept in step by hand.
 *
 * The view (MVVM): what the screen shows and every handler that changes
 * it are the view model's (usePlanWorkspace); this draws it, its parts in
 * components/workspace, and keeps the parts made once for the same plan
 * (useMemo), as the route panel's are drawn again only when their props
 * change (routePanelParts' memo).
 */
export default function PlanWorkspace({ panel, setPanel, children }: WorkspaceProps) {
  const vm = usePlanWorkspace({ panel, setPanel });
  const {
    aircraft, aircraftChoices, aircraftValue, altitudeAt, altitudeFt, altitudeNearest, autoPicked, briefLine, briefShown, cardOpen,
    cardTitle, changeAircraft, changeDepart, closeNavLogCard, closeSheet, course, crossings, depart, descriptionsHidden,
    descriptionsLoading, deselectPoint, directParam, directToPoint, drawerOpen, dryRunning, fileFlightPlan, fileable, filedProcedures,
    flight, flightRules, flightToSave, flyAltitude, flying, fuelHidden, ground, heldPoint, holdAsk, holds, insertStopAfter, landedStops,
    landings, list, listEdit, marks, metarColour, navLogShown, nearOpen, noApproaches, openNavLogCard, paywalled, pickPattern,
    pickProcedures, pickTab, pickTail, pickedPatterns, pickedProcedures, pickedTakeoffs, place, planned, preselectPattern,
    preselectTakeoff, previewProcedure, procedureAirports, proceduresAt, profileShown, removeStop, routeEdit, routeLine, routePoints,
    routeProcedures, routeRows, routed, runwayFitInputs, s, savedOpen, selectPlace, selectPointAt, selected, selectedPoint,
    setApproachesOf, setGround, setHold, setLoad, setPointAltitude, setProceduresShown, setTakeoff, showFix, showFuelStops, stale,
    stopsShown, tab, tabUp, tankFigures, tightLeg, unflyable, unflyableBrief,
  } = vm;
  // Each tab's part of the briefing; the Brief's narrative under its Go /
  // No-Go. Made once for the same plan (useCallback, useMemo), and each
  // part drawn again only when its plan changes (FlightBriefingView's
  // memo): a row picked in the nav log drew all four tabs again, the
  // hidden ones and their charts too -- half a second of a phone's.
  const narrative = useMemo(() => !s.local && (
    <BriefNarrative
      ready={!!s.totals} onGenerateNarrative={s.generateNarrative} narrative={s.narrative}
    />
  ), [s.local, s.totals, s.generateNarrative, s.narrative]);

  const tabContent = useCallback((part: BriefingPart) => (
    <FlightBriefingView
      part={part} nav={s.nav} legs={s.legs}
      dep={planned.dep} dest={planned.dest}
      // The airports landed at: a waypoint has no weather of its own.
      stops={landedStops} route={planned.stops} procedures={filedProcedures}
      briefing={s.briefing} course={course} totals={s.totals} depart={depart}
      narrativeText={s.narrative.text}
      problem={unflyableBrief}
      narrative={part === "preflight" ? narrative : undefined}
    />
  ), [s.nav, s.legs, planned.dep, planned.dest, landedStops, planned.stops, filedProcedures, s.briefing, course, s.totals, depart,
    s.narrative.text, unflyableBrief, narrative]);

  // Print's Kneeboard card, off screen (a portal to the page's body):
  // drawn after what the pilot sees (useDeferredValue), first and as the
  // legs stream in -- it was a part of the route's first draw on a phone,
  // and of each leg's. (Not the Go / No-Go's publishing beside it: Save
  // files the risk assessment it publishes, and drawn later, Save was
  // offered, and pressed, before it was in.)
  const kneeboard = useMemo(() => (
    <Kneeboard
      course={course} selected={s.logSelected} legs={s.legs} totals={s.totals} nav={s.nav}
      briefing={s.briefing.state === "ready" ? s.briefing.data : null} depart={depart}
      aircraftLabel={aircraft.label} landings={landings}
    />
  ), [course, s.logSelected, s.legs, s.totals, s.nav, s.briefing, depart, aircraft.label, landings]);
  const kneeboardLater = useDeferredValue(kneeboard, null);

  const descriptionsPaywall = useMemo(() => (paywalled ? (
    <PaidPrompt feature="CHECKPOINT_NOTES">A line for each checkpoint on what to look for from the air.</PaidPrompt>
  ) : undefined), [paywalled]);

  const routeList = useMemo(() => (
    <>
    <ProceduresRoute
      airports={procedureAirports} rows={routeRows} depart={depart} weather={metarColour}
      picked={pickedPatterns} onPick={pickPattern} onPreselect={preselectPattern} takeoffs={pickedTakeoffs} onTakeoff={setTakeoff}
      onPreselectTakeoff={preselectTakeoff} autoPicked={autoPicked} fit={runwayFitInputs}
      procedures={pickedProcedures} inRoute={routeProcedures} onProcedures={pickProcedures} onPreview={previewProcedure}
      at={proceduresAt} onAt={setProceduresShown} crossings={crossings} onFix={showFix} onDepart={changeDepart} ground={ground} onGround={setGround}
      pointAltitude={altitudeAt} onPointAltitude={setPointAltitude} directTo={directParam} onDirectTo={directToPoint}
      onInfo={selectPlace} onRemove={removeStop} onCreateFix={insertStopAfter} holds={holds} onHoldSet={setHold} askHold={holdAsk}
      routePoints={routePoints} stopsFull={planned.stops.length >= MAX_STOPS} fuel={tankFigures}
      onCharts={() => { if (planned.dest) { setApproachesOf(planned.dest); selectPlace(planned.dest); } }}
      chartsDisabled={!planned.dest || noApproaches}
      // In Route Cards the Routes row is in the head's box with the
      // controls (the route slot, below), not over the list.
      routeLine={routeEdit === "plan" ? null : routeLine}
      // The list changes the route too where the box is folded away once
      // the route is whole (RouteEdit, both of the owner's picks).
      // Not with the box as it was, whose pills do it.
      edit={routeEdit !== "box" && planned.dep && planned.dest ? listEdit : undefined}
    />
    </>
  ), [routeLine, procedureAirports, routeRows, depart, metarColour, pickedPatterns, pickPattern, preselectPattern, pickedTakeoffs, setTakeoff, preselectTakeoff, autoPicked, runwayFitInputs, pickedProcedures, routeProcedures, pickProcedures, crossings, showFix,
    ground, setGround, previewProcedure, proceduresAt, setProceduresShown, planned.dest, selectPlace, noApproaches, changeDepart,
    altitudeAt, setPointAltitude, directParam, directToPoint, removeStop, insertStopAfter, holds, setHold, holdAsk, routePoints, planned.stops.length,
    tankFigures, listEdit, routeEdit]);

  const navLog = useMemo(() => (
    <Suspense fallback={<div className="min-h-0 flex-1" />}>
    <NavLogView
      totals={s.totals} nav={s.nav} legs={s.legs} descriptionError={s.descriptionError}
      depart={depart}
      dep={planned.dep} dest={planned.dest}
      ends={course}
      selected={s.logSelected}
      descriptions={s.descriptions}
      onSaveDescription={s.saveDescription}
      onGenerateDescriptions={s.generateDescriptions}
      descriptionsLoading={descriptionsLoading}
      descriptionsPaywall={descriptionsPaywall} descriptionsHidden={descriptionsHidden}
      selectedPoint={selectedPoint} onSelectPoint={selectPointAt} onDeselectPoint={deselectPoint}
      // In sight all the way up, the Brief not over it: a row picked is
      // brought into sight as it comes back.
      drawerOpen={drawerOpen && !briefShown} dryRun={dryRunning}
      // Under the strip the nav log's card keeps the route in order too:
      // its pills' menus -- a stop taken out, a point's altitude, a hold,
      // direct to -- have no route box there (features/strip).
      // Route Cards with one end only: its card is the end's own (RouteEnds),
      // not again under it as the list's row (the owner's screenshot,
      // 2026-11-05: C81 typed as the departure, there twice).
      route={navLogShown || (routeEdit === "plan" && !(planned.dep && planned.dest)) ? undefined : routeList}
      cardHead={navLogShown ? (
        <CardHead
          // As the Brief's head: the route's name, and the line under it --
          // "Nav log" is the tab bar's title over it already (the owner's
          // "Profile and Navlog titles appear twice").
          name={routeName(planned.dep, planned.dest, planned.stops)} line={briefLine} nameTestId="navlog-name"
          onClose={closeNavLogCard} onShare="navlog" closeTestId="navlog-close"
        />
      ) : undefined}
      aircraftLabel={aircraft.label}
      marks={marks}
      tabContent={tabContent}
      notice={<BriefingNotices briefing={s.briefing} />}

      local={s.local} metarColourOf={metarColour}
    >
      {/* Out of the tabs, drawing nothing: the risk assessment and the
          Go / No-Go's findings published once, for Save and the tabs' marks. */}
      <FlightBriefingView
        part={null} publish nav={s.nav} legs={s.legs} dep={planned.dep} dest={planned.dest} stops={landedStops}
        briefing={s.briefing} course={course} totals={s.totals} depart={depart}
        narrativeText={s.narrative.text} problem={unflyableBrief}
      />
      {kneeboardLater}
    </NavLogView>
    </Suspense>
  ), [s.totals, s.descriptionError, s.nav, s.legs, depart, planned.dep, planned.dest, course, s.logSelected, s.descriptions, s.saveDescription,
    s.generateDescriptions, descriptionsLoading, descriptionsPaywall, descriptionsHidden, selectedPoint, selectPointAt, deselectPoint, drawerOpen, aircraft.label,
    marks, tabContent, s.briefing, s.local, landedStops, s.narrative.text, unflyableBrief, kneeboardLater, metarColour, dryRunning, briefShown,
    routeList, navLogShown, closeNavLogCard, planned.stops, briefLine, routeEdit, planned.dep, planned.dest]);
  // The Brief's pages (BriefCard): En route's without the legs, which are
  // FPL's own; and its warnings over them.
  const briefContents = useMemo(() => ({
    preflight: tabContent("preflight"),
    depart: tabContent("depart"),
    enroute: <section aria-label="En route" className={TEXT.prose}>{!s.local && tabContent("profile")}{tabContent("enroute")}</section>,
    arrive: tabContent("arrive"),
  }), [tabContent, s.local]);
  const briefNotice = useMemo(() => <BriefingNotices briefing={s.briefing} />, [s.briefing]);

  const flightInputs = useMemo(() => (
    <FlightInputs
      aircraftValue={aircraftValue}
      aircraftOptions={aircraftChoices} onTailPick={pickTail}
      onAircraftChange={changeAircraft}
      altitude={!s.local && (
        <AltitudeGroup
          nav={s.nav} legs={s.legs} onFlyAltitude={flyAltitude}
          // The altitude asked for, at once, while its log is planned, and
          // with no log yet: with no route the figure typed went blank, as
          // if it were not taken, where the route entered next flies it.
          commanded={(s.replanning || !s.nav) && altitudeFt ? Number(altitudeFt) : null}
          asked={altitudeFt ? { ft: Number(altitudeFt), nearest: altitudeNearest } : null}
          problem={!!unflyable}
          // What the altitude was planned within, marked on the group, said
          // in the Profile card (AltitudeProfile).
          tight={unflyable ? null : tightLeg}
          disabled={!routed} rules={flightRules}
        />
      )}
      // The departure's time on its step in FPL's list (ProceduresRoute),
      // not beside the altitude, at the owner's asks ("The departure time
      // can move from the route box to the departure and arrival boxes";
      // "Departure time doesn't need to be next to altitude selection
      // anymore"): here only for a local flight, which has no departure
      // step and no altitude, beside its time aloft.
      depart={depart} onDepartChange={s.local ? changeDepart : undefined}
    />
  ), [aircraftValue, aircraftChoices, changeAircraft, pickTail, s.local, s.nav, s.legs, flyAltitude, unflyable, tightLeg,
    routed, depart, changeDepart, flightRules, s.replanning, altitudeFt, altitudeNearest]);

  const shareMenu = (align: "start" | "end", testId?: string, card?: RouteCard) => (
    <ShareMenu
      align={align} testId={testId} card={card} planned={planned} course={course} selected={selected} altitudeFt={s.nav?.altitude_ft ?? undefined}
      routed={routed} local={!!s.local} fileable={fileable} onFile={fileFlightPlan}
      saving={askReview => (
        <Suspense fallback={null}>
          <SaveFlightButton {...flightToSave} />
          <ReviewAskItem flight={flightToSave} onAsk={askReview} />
        </Suspense>
      )}
      reviewSheet={done => <Suspense fallback={null}><ReviewAskSheet flight={flightToSave} onDone={done} /></Suspense>}
      // Plan again in the route's own menu, at the owner's pick ("A") to
      // keep the route box's row on one line; Share marked where it is due.
      planAgain={card === undefined && routed && !s.local ? { stale, onPlan: () => setLoad(n => n + 1) } : undefined}
      onShowFuel={card === undefined && fuelHidden ? showFuelStops : undefined}
      onNavLog={card === undefined && routed && course ? openNavLogCard : undefined}
    />
  );

  return children({
    // The map stays mounted beside the briefing (the arrow walk still
    // pans it) but stays off the paper: the drawer is the printed page.
    map: (
      <PlanMap vm={vm} />
    ),
    // The tab's body (TabBar): FPL's nav log, kept mounted under whatever
    // is open over it and on paper; Airport's search, its Favorites and
    // Recents and what answers, or Nearest's list; Aircraft's list. A card --
    // an airport's, the airspace's, an airplane's -- over the tab it was
    // opened from, its close back to it.
    sidebar: (
      <PlanSidebar vm={vm} navLog={navLog} briefContents={briefContents} briefNotice={briefNotice} />
    ),
    // The tab's head: FPL's the route's box (`route`, below); the others'
    // the search bar, the whole width (Settings is a tab, not a gear).
    head: tab === "fpl" ? undefined : <TabSearchField vm={vm} />,
    // A card over the tab: its card alone, the tab's head gone while it is
    // open, at the pilot's ask.
    alone: cardOpen || briefShown || navLogShown || profileShown || stopsShown,
    // An airport's or a point's card over another tab -- a field tapped on
    // the route from FPL -- its bar the card's kind and Back to the tab, at
    // the owner's ask ("unless going from another tab ... the back button
    // should get it back to fpl"); on its own tab, the tabs.
    // Any card, an airplane's too, its bar its name with Back and the close,
    // at the owner's ask ("For the airport card it should replace tabs with
    // a back close button and title as the airport id").
    cardOver: cardOpen || briefShown || navLogShown || profileShown || stopsShown,
    toEdge: !!place,
    flying,
    // The planner's tabs, the panel's first row, and at rest the pill
    // itself, at the pilot's ask: no search bar or route under them
    // (MapPanel).
    bar: <TabBar tabs={PLANNER_TABS} tab={tab} over={(place || heldPoint) && tab !== "airport" ? "airport" : undefined} title={cardTitle} onPick={pickTab} onUp={tabUp} onClose={closeSheet} routeShare={card => shareMenu("start", "tab-share", card)} listOver={!!list || savedOpen || nearOpen} marks={s.unflyable ? { fpl: "stop" } : undefined} />,
    // The route's figures -- the distance, the time en route, the arrival
    // and the fuel -- pinned at FPL's foot while there is a route, at every
    // height, the pill too, at the pilot's ask: they were the last of the
    // route's head, out of sight at rest. FPL's alone, at the owner's ask
    // ("Fpl can show calculations but other tabs should show something
    // else"): the other tabs' pills are their search bars (MapPanel's
    // headInPill).
    // FPL's figures pinned at the sheet's foot at every height, the pill's
    // too, growing as it comes up, at the owner's asks ("While dragging fpl
    // keep the calculations pinned at the bottom"; "Why can't the half card
    // have calculations pinned at the very bottom as the full card, just
    // make them bigger smoothly as expanded").
    // A dry run's chart in the side view's place and its size, at every
    // height: still as the sheet is dragged, the nav log coming out over it,
    // as the side view is, at the owner's ask ("the dry run drags up instead
    // of staying still like the profile"); all the way up the log scrolls
    // over it and follows the run (NavLogView), at the owner's ask ("I wanna
    // be able to do the dry run with navlog in full fpl"). It took the
    // body's room half way, and grew with the sheet under a finger.
    // Under the nav log's card too, its side view and figures with it, as
    // FPL is "route, navlog, profile and calculations".
    foot: tab === "fpl" && !place && !heldPoint && !flight && !briefShown ? routed && (
      <FlightFoot vm={vm} />
    ) : undefined,
    // The route as one box of pills, in place of the two airport fields,
    // the top row to itself, at the pilot's ask: its close and its
    // Procedures beside it went to the chips' row (Approaches) and the
    // Share menu (Clear the route). An airport twice (a round trip with its
    // stop taken out) keeps the box, its notice saying what to change.
    // Whatever the tab: MapPanel keeps it under the others' heads (`kept`).
    // Once the route is whole, folded away (lib/preferences RouteEdit, the
    // owner's A and B of the FPL canvas, 2026-11-05: "keeping the route box
    // on top after a destination is known is redundant because the plan
    // at the bottom can have dragables"): the route on one line, a tap the
    // box again (A), or its name over the plan whose rows change it (B);
    // the airplane, the altitude and the route's buttons under either, as
    // they were under the box. The box again while a stop is typed in
    // from the list or a problem, and while it is opened from the head;
    // with no route either, the head folded (the owner, 2026-11-05).
    route: <RouteHead vm={vm} controls={<RouteControls vm={vm} flightInputs={flightInputs} share={shareMenu("end")} />} />,
    console: <PilotPanel />,
  });
}
