import type { ReactNode } from "react";
import { ChevronRight, Fuel, PlaneLanding, PlaneTakeoff, Wind } from "lucide-react";
import { cn } from "cn";
import CardIdent from "../CardIdent";
import { CARD_BODY, CARD_GAP, CardMark, CardThread, POINT_CARD } from "../routeCard";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../../../../components/ui/collapsible";
import type { Runway } from "../../../../lib/api/types";
import { normalizeDeg } from "../../../../lib/geo";
import type { RunwayEnd } from "../../../../lib/pattern";
import { sameField } from "../../../../lib/procedures";
import { TEXT } from "../../../../lib/text";
import { altFt } from "../../../../lib/units";
import { endFit } from "../../../../lib/runwayFit";
import { isFixIdent } from "../../../../lib/identSchema";
import { etaAt } from "../../format";
import { AirportMark, PointMark } from "../navlog/PointMark";
import { colourOf } from "../../../../lib/map/flightCategory";
import FixBranch from "../FixBranch";
import DepartPicker from "../navlog/DepartPicker";
import ProcedureMenu from "../ProcedureMenu";
import { PointFigures, PointMenu } from "../PointControls";
import { FuelGauge } from "../FuelGauge";
import { groundMinAt, legOf, type NavLogRow } from "../navlog/rows";
import {
  DAY_MIN, toggleField, useOpenRunwayLines, type ProcedureAirport, type ProcedureKind, type ProceduresRouteModel,
} from "../../hooks/useProceduresRoute";
import { PatternChips, patternNote, TRAY_HEAD, type Landing } from "./PatternChips";
import { KIND_WORD } from "./ProcedureSheet";
import { PointGrip, ROUTE_LINE } from "./RouteRows";

type Kind = ProcedureKind;

// The end of a point's row, at the owner's picks ("keep the format of
// altitude (elev/published/cruising) and eta to the right side of each
// depart/arrive and waypoints"; "Each stop can have a menu (set altitude,
// create a fix, hold here, More Info)"; "the menu can include direct
// to"): its time over its altitude -- the pilot's own (the address's
// `altitudes`), else a waypoint's cruise to it, a field's elevation --
// and its menu. `to`, a point flown to: Direct to it and its altitude
// set there; `stop`, one the route's points can lose.
export function pointEnd(
  vm: ProceduresRouteModel, ident: string,
  at: { time: ReactNode; waypoint: boolean; elevationFt: number | null; to: boolean; stop: boolean; holdable?: boolean; row?: NavLogRow; index?: number },
) {
  const {
    pointAltitude, directTo, routePoints, positioned, onDirectTo, setEditing, onInfo, stopsFull, setFixFrom, holdOn, setHoldAt, edit, onRemove,
  } = vm;
  const altitude = at.to ? pointAltitude(ident, at.waypoint) : undefined;
  const own = altitude?.own ? altitude.feet : null;
  const shown = own ?? (at.waypoint ? altitude?.feet ?? null : at.elevationFt);
  const direct = directTo !== null && sameField(directTo, ident);
  const typed = routePoints.some(p => sameField(p, ident));
  // Direct to a round trip's end on the ground, with no position, is from
  // the field to itself: a local flight, not a direct (the audit's).
  const homeward = routePoints.length > 1 && sameField(routePoints[0]!, ident) && !positioned;
  const kind = own !== null ? "set" : at.waypoint ? "cruise" : "elev";
  return {
    direct,
    figures: <PointFigures time={at.time} altitude={shown === null ? null : altFt(shown)} kind={kind} />,
    // The two apart, for an airport's block: the time on its ident's
    // line, the elevation on its wind's.
    time: <PointFigures time={at.time} altitude={null} kind={kind} />,
    elevation: <PointFigures time={null} altitude={shown === null ? null : altFt(shown)} kind={kind} testId="point-elevation" />,
    // Behind the point's mark (`face`), at the owner's ask ("Use the
    // airport icon as the more button instead of having one to the right").
    menu: (face: ReactNode) => (
      <PointMenu
        face={face} ident={ident} direct={direct}
        onDirect={at.to && typed && !homeward ? () => onDirectTo(direct ? null : ident) : undefined}
        onAltitude={at.to && altitude ? () => setEditing({ ident, waypoint: at.waypoint, altitude, elevationFt: at.elevationFt }) : undefined}
        // An airport's card; a waypoint's is the chart's popup.
        onInfo={!at.waypoint ? () => onInfo(ident) : undefined}
        // Off a fix, a navaid or an airport by its ident: not off the
        // pilot's own point, nor a present position.
        onFix={typed && !stopsFull && isFixIdent(ident) ? () => setFixFrom(ident) : undefined}
        // Held over a point flown over, or before landing at the end:
        // not over a field landed at on the way, where it is left again.
        held={!!holdOn(ident)}
        onHold={at.holdable ? () => {
          const leg = at.row ? legOf(at.row) : undefined;
          setHoldAt({
            fix: ident, hold: holdOn(ident), altitudeFt: leg?.altitude_ft ?? null,
            // Magnetic = true - variation, east positive (the leg's own).
            arrivalDeg: leg ? normalizeDeg(leg.true_course_deg - leg.magnetic_variation_deg) : null,
          });
        } : undefined}
        // Not after the destination: what follows it is a new
        // destination, the route box's own (its end).
        onChange={edit?.onChange && typed ? edit.onChange : undefined}
        onAddAfter={edit && at.index !== undefined && at.index < routePoints.length - 1 && !stopsFull ? () => edit.onAddAt(at.index! + 1) : undefined}
        onRemove={at.stop && typed ? () => onRemove(ident) : undefined}
      />
    ),
    // Its grip, where the list changes the route: by its place among the
    // typed points.
    grip: edit && at.index !== undefined ? <PointGrip ident={ident} index={at.index} /> : null,
  };
}

/** A field's step: what is flown there, in the order it is flown. */
export function FieldStep({ vm, a, row, last, leads }: {
  vm: ProceduresRouteModel;
  a: ProcedureAirport;
  row: NavLogRow | undefined;
  last: boolean;
  leads: boolean;
}) {
  const {
    airports, lists, cards, inRoute, procedures, crossings, depart, weather, fit, edit, ground, startMs, tanks, asCards, openLines,
    windOf, pickOf, chosenAt, takeoffAt, ask, pick, onAt, setLesson, hasKind, onProcedures, onFix, isOpen, pointIndex, reportedOf,
    isFuelStop, landingOf, landedAt, onPick, onTakeoff, onDepart, onGround,
  } = vm;
  // A kind's pull-down: the one in the route said on it (ProcedureMenu).
  const wind = windOf(a.ident);
  const i = airports.findIndex(f => sameField(f.ident, a.ident));
  const kindMenu = (kind: Kind, look: "button" | "add") => (
    <ProcedureMenu
      key={kind} ident={a.ident} kind={kind} list={lists[i]?.data} loading={!!lists[i]?.isFetching} look={look}
      picked={pickOf(a.ident, kind)} label={inRoute.find(p => sameField(p.ident, a.ident) && p.kind === kind)?.label ?? null}
      fixes={inRoute.find(p => sameField(p.ident, a.ident) && p.kind === kind)?.fixes?.map(f => f.ident)}
      runway={chosenAt(a.ident)} windward={wind && !wind.calm ? wind.ident : null}
      onOpen={() => ask(a.ident)} onPick={next => pick(a.ident, kind, next)} onAll={() => onAt({ ident: a.ident, kind })}
      onLearn={kind === "approach" ? () => setLesson(pickOf(a.ident, kind)) : undefined}
    />
  );
  const has = (kind: Kind) => hasKind(a.ident, kind) || inRoute.some(p => sameField(p.ident, a.ident) && p.kind === kind);
  const time = row ? etaAt(depart || new Date().toISOString(), row.minutesFlown) : null;
  // 22 in the 36 of its glass button, where the map's 26 filled it.
  // Before the plan, the field's own mark from its card (its airspace,
  // its weather), not a dot, at the owner's screenshot (a departure alone);
  // and before its card is in, the plain airport symbol the route's box
  // shows, where a blue dot stood in for it while the route was drawn (the
  // owner's screenshot, 2026-10-29: BDL to KGLH, "Drawing Route...").
  const placed = cards[i]?.data;
  const mark = row ? <PointMark row={row} number={undefined} weather={weather} airportSize={22} />
    : <AirportMark airspaceClass={placed?.airspace_class ?? null} colour={weather(a.ident) ?? colourOf(placed?.metar?.flight_category ?? null)} size={22} />;
  // A step of the field's, at the owner's pick (option C of the
  // procedures canvas): its name and time in its head, its runway chips
  // under with its info at their start ("Info can go on the left side of
  // the runways"), and after them its procedures -- each picked one the
  // head of a branch of its fixes, in the order they are flown
  // (FixBranch), its pull-down its name; each kind not picked a dashed
  // "+ Arrival" to pick one.
  const branch = (kind: Kind) => {
    const inPlace = inRoute.find(p => sameField(p.ident, a.ident) && p.kind === kind);
    // By its id, not its kind: the field's list, which says each pick's
    // kind, is asked for only as a pull-down opens.
    const chosen = inPlace && procedures.find(p => sameField(p.ident, a.ident) && p.id === inPlace.id);
    if (!inPlace || !chosen) return null;
    return (
      <FixBranch
        key={`branch-${kind}`} name={inPlace.label} kind={KIND_WORD[kind]} menu={kindMenu(kind, "button")}
        fixes={inPlace.fixes ?? []} direct={inPlace.direct ?? null} crossings={crossings}
        onDirect={fix => onProcedures(procedures.map(p => (p === chosen ? { ...p, direct: fix } : p)), null)}
        onOpen={fix => onFix(a.ident, kind, fix)}
      />
    );
  };
  // One block an airport, at the owner's pick (2026-10-21, boards 4 and 5
  // of the canvas: "the airport id on top and then departure and arrival
  // that can collapse", "no need to use the word depart, fuel stop,
  // arrive"): its ident, a fuel stop's pump before it and the fuel in the
  // tanks after it, the arrow that opens it, its time over its elevation
  // and its menu; its wind under. Opened, a line each for its landing
  // and its takeoff -- the glyph, the runways, the procedures, a stop's
  // time to leave again -- named for a screen reader as its parts are.
  const key = `${a.role}:${a.ident}`;
  const opened = isOpen(key);
  // `line`, the runway line's key and the runway picked on it
  // (PatternChips folds a line with a runway picked to that runway's chip).
  type Part = { role: "Arrive" | "Depart"; kinds: Kind[]; chips: (trailing: ReactNode) => ReactNode; leaves: ReactNode; line: { key: string; chosen: string | null } };
  const partBody = (part: Part) => {
    const picked = part.kinds.filter(k => inRoute.some(p => sameField(p.ident, a.ident) && p.kind === k));
    const unpicked = part.kinds.filter(k => !picked.includes(k));
    const Glyph = part.role === "Arrive" ? PlaneLanding : PlaneTakeoff;
    // The pull-downs for the procedures not yet picked beside the runway's
    // chip while its line is folded to it, at the owner's ask ("Can
    // arrival and approach pills be next to the runway when runway is
    // collapsed?", "Same with departure"); under it while the line is
    // open, its runways across the row.
    const foldable = part.line.chosen !== null && a.runways !== null;
    const lineOpen = openLines.includes(part.line.key);
    const adds = unpicked.map(k => kindMenu(k, "add"));
    return (
      <div className="space-y-3 pt-3">
        <div className="flex items-center gap-2">
          {/* The glyph and its runways one tray, at the owner's pick of the
              canvas (2026-10-27, G2, artifact JMQabZH2W33kzmvUuahbad): the
              landing's or the takeoff's glyph at its head, the runway
              picked after it with its arrow while it is folded, every
              runway in it while it is open. The head is the line's
              button where it folds, a tap on it opening or folding it, as
              a tap on the runway picked opens it; it was a small arrow
              after the glyph ("the arrow next to runway can be next to
              the depart/arrive symbol"). The pull-downs follow the tray,
              sliding with the runways (the owner's "Approach doesn't need
              to go next line just let it slide with runways"). Its head
              level with the runways' line, not the middle of two where
              the pull-downs wrap under it (the owner's screenshot,
              2026-10-27, the head between "12" and "+ Arrival"). The tray
              a stock Collapsible, open while its runways are out: the head
              its trigger, and the line of runways (PatternChips) its
              content. Its open state stays the page's (useOpenRunwayLines),
              as the list is drawn again as the sheet moves. */}
          <Collapsible
            asChild open={foldable && lineOpen}
            onOpenChange={next => useOpenRunwayLines.setState(st => ({ open: next ? [...st.open, part.line.key] : st.open.filter(k => k !== part.line.key) }))}
          >
            <div className="flex min-w-0 flex-1 items-start">
              {foldable ? (
                <CollapsibleTrigger asChild>
                  <button
                    type="button" data-testid="runway-line-toggle" data-disclosure=""
                    aria-label={lineOpen ? `${a.ident}: fold the runways` : `${a.ident}: all the runways`}
                    className={cn(TRAY_HEAD, "outline-none focus-visible:ring-2 focus-visible:ring-ring")}
                  >
                    <Glyph className="size-5" aria-hidden />
                  </button>
                </CollapsibleTrigger>
              ) : (
                <span className={TRAY_HEAD}>
                  <Glyph className="size-5" aria-label={part.role === "Arrive" ? "landing" : "takeoff"} role="img" />
                </span>
              )}
              <div className="min-w-0 flex-1">{part.chips(adds.length > 0 ? adds : null)}</div>
            </div>
          </Collapsible>
          {part.leaves && <span className="shrink-0">{part.leaves}</span>}
        </div>
        {picked.map(branch)}
      </div>
    );
  };
  const block = (parts: Part[], headTime: ReactNode) => {
    const first = parts[0]!;
    const end = pointEnd(vm, a.ident, {
      time: headTime, waypoint: false, elevationFt: a.elevationFt ?? cards[i]?.data?.elevation_ft ?? null, to: a.role !== "Departure", stop: a.role === "Stop",
      holdable: a.role === "Destination", row, index: pointIndex(a.ident, a.role),
    });
    const reported = reportedOf(a.ident);
    // Without the "T" after its direction, at the owner's ask ("No need
    // to put T next to wind"): a METAR's and a TAF's winds are true (FAA
    // Order JO 7900.5), as VoiceOver still says them (`spoken`).
    const wind = reported === "calm" ? "Calm" : reported ? `${reported.dir.replace(/T$/, "")} ${reported.speed} kt` : null;
    const tank = row ? tanks.get(row.key) : a.role === "Departure" ? tanks.get("departure") : undefined;
    return (
      // The field a stock Collapsible, its arrow the trigger: aria-expanded
      // and aria-controls Radix's, and the landing's or the takeoff's body
      // its content. A stop's second part, in a section of its own, is
      // shown with it (a Collapsible has one content).
      <Collapsible key={key} asChild open={opened} onOpenChange={next => toggleField(key, a.ident, next)}>
        <li className={cn("relative", asCards && cn(POINT_CARD, "isolate"), asCards && !last && CARD_GAP)} data-testid="route-field" data-ident={a.ident}>
          {asCards && <CardThread first={leads} last={last} />}
          {!last && !asCards && <span aria-hidden="true" className="absolute top-3 bottom-0 left-[calc(0.875rem-1px)] w-0.5" style={ROUTE_LINE} />}
          <section aria-label={`${a.ident} · ${first.role}`} className={cn(!(opened && parts[1]) && !asCards && "pb-5")}>
            {/* The airport's lines: a tap anywhere on them -- its symbol, its
                ident, its fuel, its wind, its time -- opens it, at the
                owner's ask ("it should expand when tapped anywhere on the
                airport information next to the symbol or the symbol
                itself"): the arrow by the symbol is the button, its area
                stretched over the lines (before:inset-0); the menu and a
                time to pick lie over it, their own. */}
            <div className="relative flex gap-2.5">
              {/* A fuel stop's pump on top of its symbol, at the owner's ask
                  ("instead of fuel symbol next to airport id, can we put it
                  on top of the airport symbol?"). */}
              {/* The symbol is the field's menu, over the lines' tap that
                  opens them (z-10), at the owner's ask ("Use the airport
                  icon as the more button"). */}
              {/* Centred on the two lines, at the owner's ask ("Center it
                  on the two lines"): the column as tall as they are. */}
              <div className="relative z-10 flex w-7 shrink-0 items-center justify-center">
                {(face => (asCards ? <CardMark>{face}</CardMark> : face))(end.menu(
                  <span className="relative">
                    {mark}
                    {a.role === "Stop" && isFuelStop(a.ident) && (
                      <span className="absolute -top-1.5 -right-1.5 grid size-4 place-items-center rounded-full bg-caution text-white ring-2 ring-background">
                        <Fuel className="size-2.5" strokeWidth={2.6} aria-label="fuel stop" role="img" />
                      </span>
                    )}
                  </span>,
                ))}
              </div>
              {/* Two lines, as a waypoint's row and the list before had them,
                  at the owner's ask ("line up the time with airport id and
                  elevation with wind like before"): the ident and the time,
                  then the wind and the elevation. */}
              <div className={cn("grid min-w-0 flex-1 items-center gap-x-2", end.grip ? "grid-cols-[minmax(0,1fr)_auto_auto]" : "grid-cols-[minmax(0,1fr)_auto]")}>
                <div className="col-start-1 row-start-1 flex min-w-0 items-center gap-1.5">
                  {/* The disclosure, iOS's small chevron by the symbol, not
                      an icon button (data-disclosure): the Collapsible's
                      trigger, the arrow turned by its open state. */}
                  {/* A card's without its arrow, at the owner's ask (2026-11-05:
                      "Now that it's a card, we don't need the expanding
                      arrow next to airport", then "It should still become
                      a smaller card with a tap"): its tap over the lines
                      alone. */}
                  <CollapsibleTrigger asChild>
                    <button
                      type="button" data-testid="field-toggle" data-ident={a.ident} data-disclosure=""
                      aria-label={`${a.ident}: runways and procedures`}
                      // Its area over the lines a ::before: on a touch screen
                      // index.css gives every button's ::after its 44 points,
                      // which overrode an ::after stretched here, and on the
                      // owner's phone only the arrow opened the field ("make
                      // the whole line tapable for unfolding"). Static, where
                      // index.css positions every button on a touch screen:
                      // its areas reach out to the lines' box, not its own; and
                      // twelve over it, into the room above the field, where the
                      // arrow's 44 points, round its line, reach (the iOS
                      // audit's P1).
                      className={cn(
                        "group static grid shrink-0 place-items-center text-tint outline-none before:absolute before:inset-x-0 before:-top-3 before:bottom-0 before:content-[''] focus-visible:ring-2 focus-visible:ring-ring",
                        asCards ? "-ml-1.5 size-0" : "-ml-0.5 size-4",
                      )}
                    >
                      {!asCards && <ChevronRight className="size-4 transition-transform group-data-[state=open]:rotate-90" aria-hidden />}
                    </button>
                  </CollapsibleTrigger>
                  {/* The size the list's names were ("the font size is bigger
                      than it used to be for airport id"). */}
                  {asCards && edit?.onReplace && pointIndex(a.ident, a.role) !== undefined ? (
                    <h3 className="min-w-0">
                      <CardIdent
                        value={a.ident} label={`${a.ident}, change`} testId="field-ident"
                        onCommit={v => { const at = pointIndex(a.ident, a.role); if (at !== undefined && !sameField(v, a.ident)) edit.onReplace!(at, v); }}
                      />
                    </h3>
                  ) : <h3 className={cn("truncate font-semibold", TEXT.row)}>{a.ident}</h3>}
                  {tank && <FuelGauge gal={tank.gal} usable={tank.usable} tone={tank.low ? "low" : a.role === "Stop" && isFuelStop(a.ident) ? "fuel" : undefined} />}
                </div>
                <div className="relative z-10 col-start-2 row-start-1 justify-self-end">{end.time}</div>
                <p className={cn("col-start-1 row-start-2 flex min-w-0 items-center gap-1 font-semibold text-tint tabular-nums", TEXT.note)} data-testid="field-wind">
                  {end.direct ? "Direct to" : wind && (
                    <>
                      <Wind className="size-3.5 shrink-0" aria-hidden />
                      <span aria-hidden="true">{wind}</span>
                      <span className="sr-only">{`Wind ${reported === "calm" ? "calm" : reported ? reported.spoken : ""}`}</span>
                    </>
                  )}
                </p>
                <div className="col-start-2 row-start-2 justify-self-end">{end.elevation}</div>
                {end.grip && <div className="relative z-10 col-start-3 row-span-2 row-start-1 self-center">{end.grip}</div>}
              </div>
            </div>
            {/* A card's runways and procedures nearly its whole width, at
                the owner's ask ("we can use all card width for runway and
                arrival approach buttons"), right of the line down its
                marks (CARD_BODY): the arrival and the approach then fit
                on the runway's line. */}
            <CollapsibleContent className={asCards ? CARD_BODY : "pl-[2.375rem]"}>{partBody(first)}</CollapsibleContent>
          </section>
          {opened && parts[1] && <section aria-label={`${a.ident} · ${parts[1].role}`} className={asCards ? CARD_BODY : "pl-[2.375rem] pb-5"}>{partBody(parts[1])}</section>}
        </li>
      </Collapsible>
    );
  };
  // Each runway end's fit today (lib/runwayFit): its crosswind against the
  // airplane's demonstrated, and its length against the distance needed,
  // marked on its chip and said in the field's info, at the owner's ask.
  const card = cards[i]?.data;
  const reportedWind = card?.metar ?? card?.nearby_metar?.metar ?? null;
  const fitOf = (kind: "takeoff" | "landing") => (runway: Runway, end: RunwayEnd) => (fit ? endFit({
    aircraft: fit.aircraft, runway, end, kind,
    wind: reportedWind && { dirTrueDeg: reportedWind.wind_dir_true_deg, speedKt: reportedWind.wind_speed_kt, gustKt: reportedWind.wind_gust_kt },
    elevationFt: a.elevationFt ?? null, altimeterInHg: card?.metar?.altimeter_in_hg, tempC: card?.metar?.temp_c,
    weightLb: kind === "takeoff" ? fit.takeoffLb : fit.landingLb,
  }) : null);
  const chips = (kind: "takeoff" | "landing", chosen: string | null, landing: Landing | null, note: string | null, pick: (end: string) => void, label?: string) =>
    (trailing: ReactNode) => (
      <PatternChips
        airport={a} wind={wind} chosen={chosen} landing={landing} label={label} onPick={pick} fitOf={fitOf(kind)}
        note={note} trailing={trailing}
      />
    );
  const landingChips = chips("landing", chosenAt(a.ident), landingOf(a.ident), patternNote(a, chosenAt(a.ident), landingOf(a.ident)), end => onPick(a.ident, end));
  // A round trip's departure is left from its own runway (`takeoff`), the
  // field's pattern the landing's, as a stop's are.
  const roundTrip = a.role === "Departure" && airports.some(b => b !== a && b.role === "Destination" && sameField(b.ident, a.ident));
  const departChips = roundTrip
    ? chips("takeoff", takeoffAt(a.ident), null, takeoffAt(a.ident) ? `Runway ${takeoffAt(a.ident)}` : null,
      end => onTakeoff(a.ident, end), `${a.ident} takeoff runway`)
    : chips("takeoff", chosenAt(a.ident), null, patternNote(a, chosenAt(a.ident), null), end => onPick(a.ident, end));
  const takeoffChips = chips("takeoff", takeoffAt(a.ident), null, takeoffAt(a.ident) ? `Runway ${takeoffAt(a.ident)}` : null,
    end => onTakeoff(a.ident, end), `${a.ident} takeoff runway`);
  // The departure's time on its own step, from the route's box at the
  // owner's ask ("The departure time can move from the route box to the
  // departure and arrival boxes"): picked there, Now for about now.
  const leaving = <DepartPicker value={depart} onChange={onDepart} look="time" />;
  // Each runway line's key as PatternChips keeps it open: the field and
  // the chips' own name, none for a landing's or a departure's own.
  const landingLine = { key: `${a.ident}:`, chosen: chosenAt(a.ident) };
  const takeoffLine = { key: `${a.ident}:${a.ident} takeoff runway`, chosen: takeoffAt(a.ident) };
  if (a.role === "Departure") {
    return block([{ role: "Depart", kinds: (["departure"] as Kind[]).filter(has), chips: departChips, leaves: null, line: roundTrip ? takeoffLine : landingLine }], leaving);
  }
  if (a.role === "Destination") return block([{ role: "Arrive", kinds: (["arrival", "approach"] as Kind[]).filter(has), chips: landingChips, leaves: null, line: landingLine }], time);
  // A stop is landed at and left again, each with its own runway, at the
  // owner's ask ("If a stop is an airport then it should have arrival
  // first with a runway and a separate departure with a runway"): two
  // steps, the pattern drawn the landing's.
  // When it leaves again, picked on its Depart step as the flight's own
  // departure is, at the owner's ask ("we should not say 30 min on the
  // ground instead just make the departure time selectable like now is
  // for the first departure"): kept as its minutes on the ground (the
  // address's `ground`), the flights after it timed from it; none picked,
  // the planner's turnaround after it lands (the stop's row, groundMinAt).
  // Never before it lands.
  const onGroundMin = row?.kind === "stop" ? row.groundMin : groundMinAt(ground, a.ident);
  const flownTo = row?.minutesFlown ?? landedAt(a.ident);
  // To the whole minute, as its picker shows it: with the seconds kept, a
  // departure picked a quarter of an hour after the one shown was 44
  // minutes on the ground, not 45 (the stops spec, 2026-11-03).
  const landsMs = flownTo == null ? null : Math.floor((startMs + flownTo * 60_000) / 60_000) * 60_000;
  const leaves = landsMs === null ? null : (
    <DepartPicker
      value={new Date(landsMs + onGroundMin * 60_000).toISOString()} look="time" label={`Departure from ${a.ident}`} testId={`depart-date-${a.ident}`} leavesNow={false}
      // From landing to a day after, as the planner takes a stop's time
      // on the ground (PlanQuery.own_ground).
      earliest={landsMs} latest={landsMs + DAY_MIN * 60_000}
      onChange={iso => { if (iso) onGround(a.ident, Math.min(DAY_MIN, Math.max(0, Math.round((Date.parse(iso) - landsMs) / 60_000)))); }}
    />
  );
  return block([
    { role: "Arrive", kinds: (["arrival", "approach"] as Kind[]).filter(has), chips: landingChips, leaves: null, line: landingLine },
    { role: "Depart", kinds: (["departure"] as Kind[]).filter(has), chips: takeoffChips, leaves, line: takeoffLine },
  ], time);
}
