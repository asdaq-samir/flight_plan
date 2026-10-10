import { Fragment, useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Command as CommandPrimitive } from "cmdk";
import { ArrowRight, MoveVertical, Trash2, TriangleAlert } from "lucide-react";
import {
  DndContext, KeyboardSensor, MouseSensor, TouchSensor, closestCenter, useDndMonitor, useSensor, useSensors, type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "cn";
import AirportPicker, { AirportRow, PickerGroup, SearchRows } from "../../../components/AirportPicker";
import { CommandList } from "../../../components/ui/command";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuShortcut, ContextMenuTrigger } from "../../../components/ui/context-menu";
import { InputGroup } from "../../../components/ui/input-group";
import { Popover, PopoverAnchor, PopoverContent } from "../../../components/ui/popover";
import type { Detour } from "../../../lib/api/types";
import { MAX_STOPS, identOf, isPosition, pointName, stopOf } from "../../../lib/identSchema";
import { usePreferences, type AirspaceClass, type RecentAirport } from "../../../lib/preferences";
import { useAirportSearch } from "../../../lib/useAirportSearch";
import { AIRSPACE_PILL, pillLook, useAirspace } from "../../../lib/useAirspace";
import { inkOn } from "../../../lib/scoreScale";
import { altFt, flightLevel } from "../../../lib/units";
import PointAltitudeDialog, { type EditedPoint, type PointAltitude } from "./PointAltitudeDialog";

/** The route as the box changes it: either end may be missing (half a
 *  route, the other end still to be typed), and neither means none. */
export interface RouteParts { dep: string; stops: string[]; dest: string }

/**
 * The route as ForeFlight's is: one box, every point of it a pill in the
 * order flown -- the departure, the airports landed at and the waypoints
 * flown through, the destination -- an arrow between each two. A tap on an
 * arrow types a stop in there; what is typed after the destination goes
 * on to it, the old destination a stop on the way (or, with none yet,
 * names it); the airports and
 * waypoints that answer what is typed are offered under the box as it is
 * typed (Enter takes the first, or what was typed, "VPBNG 06C"). A pill is
 * dragged into another order, tapped to change, and taken out from its
 * menu -- any of them, the departure and the destination too: the next
 * airport along becomes the end taken out, and a route of two keeps the
 * other end, half a route. From Fly via, on the flight the Class B stops
 * (`via`), the ways round are offered before anything is typed. Every
 * change re-plans at once, so there is no Load button.
 *
 * The search bar's field, as Maps' is, round at a line's ends to sit in
 * the sheet's round corners.
 *
 * The ends stay airports: a waypoint is flown through, never taken off
 * from or landed at, so a change that would put one at an end is undone.
 */
export default function RouteBox({
  dep, stops, dest, waypoints, airspaceOf, metarColourOf, altitudeAt, onAltitudeChange, onChange, adding, onAddingChange, via,
}: RouteParts & {
  /** Which points are waypoints, flown through: in the sectional's magenta. */
  waypoints: Set<string>;
  /** An airport's airspace class, as the course came with it. */
  airspaceOf: (ident: string) => AirspaceClass | undefined;
  /** An airport's METAR colour, for the pills coloured by the weather. */
  metarColourOf: (ident: string) => string | undefined;
  /** The altitude at a point, which its menu offers to change: a
   *  waypoint's cruise there, an airport's pattern. */
  altitudeAt: (ident: string, waypoint: boolean) => PointAltitude;
  /** A point's own altitude set, or (null) given back to the plan. */
  onAltitudeChange: (ident: string, feet: number | null) => void;
  onChange: (route: RouteParts) => void;
  /** A stop asked for from elsewhere -- a problem's Add a stop or Fly
   *  via: the box takes the typing where it goes in, with `via` offered. */
  adding: boolean;
  onAddingChange: (adding: boolean) => void;
  /** Fly via's waypoints round the Class B, best first. */
  via?: Detour[];
}) {
  const hasDep = !!dep, hasDest = !!dest;
  const points = [...(hasDep ? [dep] : []), ...stops, ...(hasDest ? [dest] : [])];
  const roleOf = (i: number) => (i === 0 && hasDep ? "dep" : i === points.length - 1 && hasDest ? "dest" : "stop");
  const [typed, setTyped] = useState("");
  // The field taken, for the arrow on from the destination (below).
  const [focused, setFocused] = useState(false);
  const typedNow = useRef(typed);
  useEffect(() => { typedNow.current = typed; }, [typed]);
  const field = useRef<HTMLInputElement>(null);
  const listId = useId();
  // Where the field is: before point `at` (a stop typed in there, or at 0
  // with no departure, the departure), or null -- after the last point,
  // where what is typed is the destination.
  const [chosen, setAt] = useState<number | null>(null);
  // The point whose altitude is being set, from its menu.
  const [editing, setEditing] = useState<EditedPoint | null>(null);
  // Asked for from a problem: the field where the stop goes -- on the
  // flight the Class B stops, or before the destination.
  const asked = via?.length ? via[0]!.stop_index + 1 : Math.max(points.length - 1, 0);
  // With no departure yet, the field is there first: half a route reads
  // "Departure -> KDLH", the departure still to be typed.
  const at = chosen ?? (adding ? asked : !hasDep && points.length ? 0 : null);
  const atNow = useRef(at);
  useEffect(() => { atNow.current = at; }, [at]);
  // Each point's key is its place in the order and its ident: the same
  // airport twice is two points.
  const ids = points.map((p, i) => `${i}:${p}`);
  // A press that moves is a drag; a tap is the pill's own (its picker).
  // On a finger, as on iOS, a drag starts with a hold.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const isEnd = (ident: string) => (!!identOf(ident) && !waypoints.has(ident)) || isPosition(ident);
  const full = stops.length >= MAX_STOPS;

  // A list of points back into the route's parts, the ends kept where they
  // were. No end a waypoint, no more stops than the planner takes, and no
  // point straight after itself (KDLH, KDLH, KMDW) -- but a route of one
  // airport twice is let through, to be said (PlanWorkspace's notice) and
  // changed here.
  const change = (list: string[], withDep = hasDep, withDest = hasDest) => {
    const d = withDep && list.length ? list[0]! : "";
    const a = withDest && list.length > (d ? 1 : 0) ? list.at(-1)! : "";
    const route = { dep: d, stops: list.slice(d ? 1 : 0, a ? list.length - 1 : list.length), dest: a };
    const repeats = list.some((p, i) => i > 0 && p === list[i - 1]) && list.length !== 2;
    if ((d && !isEnd(d)) || (a && !isEnd(a)) || route.stops.length > MAX_STOPS || repeats) return;
    onChange(route);
  };
  // Taken out: the next airport along becomes the end taken out; of two,
  // the other end stays, half a route; the last, no route.
  const remove = (i: number) => {
    const list = points.filter((_, j) => j !== i);
    const role = roleOf(i);
    if (list.length === 1 && role !== "stop") {
      change(list, role === "dest", role === "dep");
      return;
    }
    change(list, hasDep && (role !== "dep" || isEnd(list[0] ?? "")), hasDest && (role !== "dest" || isEnd(list.at(-1) ?? "")));
  };
  // What was typed, put in where the field is: before a point, as stops
  // (the departure, with none, when it is an airport); after the last, the
  // route goes on to it -- the last airport typed the destination, the old
  // destination and anything typed before it stops on the way (a
  // waypoint typed there is a stop before the destination: a flight does
  // not end at one).
  // Into an empty box -- the route cleared -- the first airport typed is
  // the departure, and the field asks for the destination next, at the
  // pilot's ask; more than one typed at once, on to the last.
  const put = (idents: string[]) => {
    const fresh = idents.map(stopOf).filter(Boolean);
    if (!fresh.length) return;
    if (!points.length) {
      change(fresh, isEnd(fresh[0]!), fresh.length > 1 && isEnd(fresh.at(-1)!));
      return;
    }
    const where = atNow.current;
    if (where !== null) {
      const departure = where === 0 && !hasDep && isEnd(fresh[0]!);
      change([...points.slice(0, where), ...fresh, ...points.slice(where)], hasDep || departure, hasDest);
      setAt(where + fresh.length);
      return;
    }
    if (!isEnd(fresh.at(-1)!)) {
      change([...points.slice(0, hasDest ? -1 : undefined), ...fresh, ...(hasDest ? [dest] : [])]);
      return;
    }
    change([...points, ...fresh], hasDep, true);
  };
  const commitTyped = () => {
    put(typedNow.current.split(/[\s,]+/));
    setTyped("");
  };
  // One picked from the suggestions: in, the field empty for the next, the
  // typing kept in it; an airport among the recents, as the search bar's.
  const pick = (ident: string, airport?: RecentAirport) => {
    if (airport) usePreferences.getState().addRecentAirport(airport);
    put([ident]);
    setTyped("");
    onAddingChange(false);
    field.current?.focus();
  };
  // The field to a place: an arrow's, or back after the last point.
  const typeAt = (where: number | null) => {
    setAt(where);
    setTyped("");
    // Once it is there: a tap's focus within the tap (iOS brings the
    // keyboard up for no other).
    queueMicrotask(() => field.current?.focus());
  };

  // The airports and waypoints that answer what is typed, under the box;
  // before anything is typed, Fly via's ways round. Put away with Escape
  // or a tap elsewhere, until the next thing typed.
  const { rows, answered } = useAirportSearch(typed, !!typed.trim(), true);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const offering = typed.trim() ? rows.length > 0 : adding && !!via?.length;
  const open = offering && dismissed !== typed;
  // Asked for, the field takes the typing.
  useEffect(() => { if (adding) field.current?.focus(); }, [adding]);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      // The first suggestion, once they answer what is typed (cmdk's own
      // Enter, on its highlighted row); else what was typed.
      if (open && answered && rows.length > 0) return;
      e.preventDefault();
      e.stopPropagation();
      if (typed.trim()) commitTyped();
    } else if (e.key === " " || e.key === ",") {
      if (!typed.trim()) return;
      e.preventDefault();
      commitTyped();
    } else if (e.key === "Escape" && at !== null) {
      typeAt(null);
      onAddingChange(false);
    } else if (e.key === "Backspace" && !typed) {
      // As a token field does: the point before the caret goes -- after
      // the last, the destination; an arrow's field is put away.
      if (at !== null) typeAt(null);
      else if (points.length) remove(points.length - 1);
    }
  };
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    change(arrayMove(points, ids.indexOf(String(active.id)), ids.indexOf(String(over.id))));
  };

  // A plain field in cmdk's root, which takes its arrows and Enter as they
  // bubble: cmdk's own field names a list that is not in the page while
  // the suggestions are put away. After the last point it fills the rest
  // of the line, so a tap anywhere after the destination types there; at
  // an arrow, a stop's width.
  const typing = (
    <input
      ref={field} value={typed} onChange={e => setTyped(e.target.value.toUpperCase())} onKeyDown={onKeyDown}
      role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list"
      // What was typed goes in when the box is left -- unless a suggestion
      // took the tap, which empties it first -- and an arrow's field is
      // put away.
      onFocus={() => setFocused(true)}
      onBlur={() => window.setTimeout(() => {
        setFocused(false);
        if (document.activeElement === field.current) return;
        if (typedNow.current.trim()) commitTyped();
        if (atNow.current !== null) { setAt(null); onAddingChange(false); }
      }, 200)}
      // Empty, the route, from its departure (put); then each end it lacks;
      // a whole route, Add stop after its destination, as Maps' directions
      // say it -- what is typed there the new destination, the old one a
      // stop on the way, as Maps' Add Stop does -- where the line after the
      // last point was blank and read as no place to type.
      placeholder={!points.length ? "Route" : at === null ? (hasDest ? "Add stop" : "Destination") : at === 0 && !hasDep ? "Departure" : ""}
      aria-label={!points.length ? "The route, from its departure" : at === null ? (hasDest ? "Add stop, the new destination" : "The destination") : at === 0 && !hasDep ? "The departure" : "A stop here"}
      enterKeyHint="done" autoCapitalize="characters" autoCorrect="off" spellCheck={false}
      // 16 at the least below md, as every field is: under 16 iOS zooms
      // the page in on it (checkpoints.spec checks every field). Not
      // TEXT.row, whose 14 with a mouse would be under it on a narrow
      // window; 17 to a finger, a row's, and 14 from md up.
      className={cn(
        "h-8 bg-transparent font-mono text-base uppercase outline-none placeholder:font-sans placeholder:normal-case placeholder:text-muted-foreground md:text-sm pointer-coarse:text-[1.0625rem]",
        // The departure's field wide enough for its word: at a stop's width
        // it read "Departu".
        // After the last point, clear of it, as a field's words are of
        // its edge: "Add stop" ran into the destination's pill.
        at === null ? "min-w-12 flex-1 pl-2" : cn("shrink-0 rounded-full bg-background/60 px-2", at === 0 && !hasDep ? "w-28" : "w-20"),
      )}
      data-testid="route-type"
    />
  );
  // An arrow between two points, a tap on it the field there; a plain
  // arrow on either side of the field once it is open.
  const arrow = (before: number) => at === before ? (
    <Fragment key={`at-${before}`}>
      {before > 0 && <ArrowRight className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />}
      {typing}
      <ArrowRight className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
    </Fragment>
  ) : (
    <button
      key={`arrow-${before}`} type="button" disabled={full && !(before === 0 && !hasDep)}
      onClick={() => typeAt(before)} data-testid="route-arrow"
      aria-label={before === 0 ? "Type the departure" : `Type a stop between ${points[before - 1]} and ${points[before]}`}
      className="grid h-5 w-4 shrink-0 place-items-center rounded-full text-muted-foreground outline-none hover:text-tint focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
    >
      <ArrowRight className="size-3" />
    </button>
  );
  return (
    // The box's own presses are its pills', not the panel's drag. cmdk's
    // root round the box and its suggestions: the field moves the
    // highlight with the arrows and takes it with Enter.
    <CommandPrimitive
      shouldFilter={false} loop className="min-w-0" onPointerDown={e => e.stopPropagation()}
      // Delete (or Backspace) on a focused pill takes it out, as its menu
      // does (Pill).
      onKeyDown={event => {
        const point = (event.target as HTMLElement).dataset.point;
        if (point === undefined || (event.key !== "Delete" && event.key !== "Backspace")) return;
        event.preventDefault();
        remove(Number(point));
      }}
    >
      <Popover open={open} onOpenChange={next => { if (!next) { setDismissed(typed); onAddingChange(false); } }}>
        <PopoverAnchor asChild>
          {/* The search bar's field, as Maps' is with no route: its grey,
              no line round it, its corners round, the pills on it in the
              sheet's own colour -- one line, the search field's 41 points,
              while the route fits on one, and a line more for each it
              wraps onto, at the pilot's ask: two lines tall however short
              the route left a grey line empty under "C81 -> KDLH" and the
              tabs that much lower. Beside it the route's Procedures and its
              close, on its first line (PlanWorkspace). */}
          <InputGroup
            className="h-auto min-h-[2.5625rem] items-start rounded-[20.5px] border-0 bg-foreground/8 py-0 pr-1.5 pl-1 shadow-none dark:bg-foreground/8 has-[[data-slot=input-group-control]:focus-visible]:ring-0"
            data-testid="route-box" data-tip="route"
          >
            {/* The pills wrap, two lines of them in sight and the top of a
                third -- so a point below them reads as there, the
                destination most of all -- and the rest a scroll down, as
                ForeFlight's flight plan box does: one line that slid
                sideways hid all but the first few of a long route, at the
                pilot's ask. Up and down only: the 44-point hit areas
                (index.css) reaching past a line's end let it slide
                sideways by a few points (the iPhone audit's "no sideways
                scroll in a panel"). Lines eight apart, as rows are, so the
                hit areas meet; room round them for the areas at the box's
                edges. A swipe up or down in it scrolls it, not the sheet
                (the root takes the presses). */}
            <div className="flex max-h-[96px] min-w-0 flex-1 flex-wrap items-center gap-x-px gap-y-2 overflow-x-hidden overflow-y-auto overscroll-contain py-1 pr-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" data-testid="route-slide">
              {/* The box does not scroll itself under a drag: the pill dragged
                  is in the box it scrolls, so each step down carried it
                  further, and a pill held over the second line ran the box
                  671 points down to the last point. A line out of sight is
                  scrolled to first. */}
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd} autoScroll={false}>
                <SortableContext items={ids} strategy={rectSortingStrategy}>
                  {points.map((point, i) => (
                    <Fragment key={ids[i]}>
                      {/* Before the first point an arrow only with no
                          departure yet: the departure is typed there. */}
                      {(i > 0 || !hasDep) && arrow(i)}
                      <Pill
                        id={ids[i]!} ident={point} waypoint={waypoints.has(point)} index={i} airspaceOf={airspaceOf} metarColourOf={metarColourOf}
                        role={roleOf(i)} stopNumber={i + (hasDep ? 0 : 1)}
                        onChange={ident => change(points.map((p, j) => (j === i ? ident : p)))}
                        altitude={altitudeAt(point, waypoints.has(point))}
                        onEditAltitude={() => setEditing({ ident: point, waypoint: waypoints.has(point), altitude: altitudeAt(point, waypoints.has(point)) })}
                        onRemove={() => remove(i)}
                      />
                    </Fragment>
                  ))}
                </SortableContext>
              </DndContext>
              {/* After the last point: the destination typed, or changed.
                  With none yet, an arrow on to it; with one, an arrow on from
                  it while the field is taken, at the pilot's ask -- what is
                  typed there is the new destination, the old one a stop. */}
              {at === null && (
                <>
                  {points.length > 0 && (!hasDest || focused || !!typed) && (
                    <ArrowRight className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" data-testid="route-arrow-on" />
                  )}
                  {typing}
                </>
              )}
            </div>
          </InputGroup>
        </PopoverAnchor>
        <PopoverContent
          align="start" sideOffset={6}
          className="w-(--radix-popper-anchor-width) max-w-[calc(100vw-16px)] p-2"
          // The typing stays in the box.
          onOpenAutoFocus={e => e.preventDefault()}
          onInteractOutside={e => { if (field.current?.closest("[data-slot=input-group]")?.contains(e.target as Node)) e.preventDefault(); }}
          data-testid="route-suggestions"
        >
          <CommandList className="max-h-72" id={listId}>
            {!typed.trim() && via && via.length > 0 && (
              <PickerGroup heading="Suggested">
                {via.map(d => (
                  <AirportRow
                    key={d.ident} waypoint testId="picker-suggestion" onSelect={() => pick(d.ident)}
                    airport={{
                      ident: d.ident, name: d.kind,
                      municipality: [`+${Math.round(d.added_nm)} nm`, d.description].filter(Boolean).join(" · "),
                    }}
                  />
                ))}
              </PickerGroup>
            )}
            {typed.trim() && <SearchRows rows={rows} onAirport={airport => pick(airport.ident, airport)} onWaypoint={ident => pick(ident)} />}
          </CommandList>
        </PopoverContent>
      </Popover>
      <PointAltitudeDialog
        point={editing} onClose={() => setEditing(null)}
        onSet={(ident, feet) => { onAltitudeChange(ident, feet); setEditing(null); }}
      />
    </CommandPrimitive>
  );
}

/** One point of the route: its ident in its airspace's look, a tap to
 *  change it (the picker), and a drag to move it. Taken out from its own
 *  menu, as iOS takes things out -- a press and hold on a phone, a
 *  right-click with a mouse -- or Delete with it focused: a cross on every
 *  pill was a row of targets crowded between them, at the pilot's ask. Any
 *  of them, the ends too (RouteBox's `remove`). */
function Pill({ id, ident, waypoint, index, role, stopNumber, airspaceOf, metarColourOf, altitude, onChange, onEditAltitude, onRemove }: {
  id: string; ident: string; waypoint: boolean; index: number; role: "dep" | "stop" | "dest"; stopNumber: number;
  airspaceOf: (ident: string) => AirspaceClass | undefined;
  metarColourOf: (ident: string) => string | undefined;
  altitude: PointAltitude;
  onChange: (ident: string) => void; onEditAltitude: () => void; onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  // A finger's hold, as iOS's: the pill lifts at a quarter second (the
  // drag's, RouteBox's sensors), its menu at half -- unless it has moved
  // first, which makes it a drag; moved with the menu out, the menu goes
  // and the drag goes on. Radix's own hold (700 ms) is put off by any
  // move at all, and a finger is never quite still: this one allows it
  // eight points, and opens where Radix's would.
  const hold = useRef<{ timer: number; x: number; y: number } | null>(null);
  const menuOut = useRef(false);
  const letGo = () => {
    if (hold.current) window.clearTimeout(hold.current.timer);
    hold.current = null;
  };
  const press = (event: PointerEvent<HTMLSpanElement>) => {
    if (event.pointerType === "mouse") return;
    letGo();
    const pill = event.currentTarget, { clientX, clientY } = event;
    hold.current = {
      x: clientX, y: clientY,
      timer: window.setTimeout(() => pill.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX, clientY })), 500),
    };
  };
  const slide = (event: PointerEvent<HTMLSpanElement>) => {
    if (hold.current && Math.hypot(event.clientX - hold.current.x, event.clientY - hold.current.y) > 8) letGo();
  };
  useDndMonitor({
    onDragMove: ({ active, delta }) => {
      if (active.id !== id || Math.hypot(delta.x, delta.y) <= 8) return;
      letGo();
      // Radix closes its menu on Escape's key; dnd-kit cancels a drag on
      // Escape's code, which this has none of.
      if (menuOut.current) document.dispatchEvent(new globalThis.KeyboardEvent("keydown", { key: "Escape" }));
    },
  });
  // An airport as the sectional draws its airspace, as its Favorites tile
  // is (lib/useAirspace): Class B and C solid blue and magenta, D and E
  // dashed; G, and one not known yet, the sheet's own pill. A waypoint in
  // the sectional's magenta letters, where it carried a diamond that cost
  // a third pill its place on a phone's line.
  // Or, as the setting has it, by the METAR's flight category, as the
  // map's chips are (metarColourOf, PlanWorkspace's); grey without one.
  const byWeather = usePreferences(s => s.routeColours) === "metar";
  // The class the course came with, else the airport's card asked for.
  const known = airspaceOf(ident);
  // Not for a present position, which has no card to ask for (it was
  // asked for, and the planner answered 404, at every Fly Here).
  const space = useAirspace({ ident, name: ident, airspace: known }, !waypoint && !byWeather && !known && !isPosition(ident));
  const metar = byWeather && !waypoint ? metarColourOf(ident) : undefined;
  const look = waypoint ? undefined
    : metar ? { backgroundColor: metar, color: inkOn(metar) }
      : byWeather ? undefined : pillLook(space);
  // The fields' own names, as the two fields were: "Departure", "Stop 1".
  const label = role === "dep" ? "Departure" : role === "dest" ? "Destination" : `Stop ${stopNumber}`;
  const pill = (
    // A group, not dnd-kit's button: the picker inside it is the button,
    // and a button in a button is nothing a reader can use (axe's
    // nested-interactive). Still focusable, for the keyboard's reordering
    // (KeyboardSensor) and its Delete.
    <span
      ref={setNodeRef} {...attributes} {...listeners} role="group" aria-label={`${label} ${ident}`}
      aria-keyshortcuts="Delete" data-point={index}
      onPointerDown={press} onPointerMove={slide} onPointerUp={letGo} onPointerCancel={letGo}
      // Moved, never scaled: across lines the pills differ in width, and
      // dnd-kit's rect strategy scales one to another's, stretching its
      // ident while it is dragged.
      style={{ transform: CSS.Translate.toString(transform), transition, ...look }}
      className={cn(
        // A swipe up or down scrolls the lines; a hold, then a move, drags;
        // a hold alone, its menu. No callout of iOS's own over the hold.
        AIRSPACE_PILL, "touch-pan-y select-none [-webkit-touch-callout:none]",
        isDragging && "z-10 shadow-md ring-2 ring-tint",
      )}
      data-testid={role === "stop" ? "stop" : `route-${role}`}
    >
      <AirportPicker
        value={pointName(ident)} placeholder={label} ariaLabel={waypoint ? `${label}, a waypoint` : label} look="pill" fixes={role === "stop"}
        className={cn("h-8 rounded-full px-1.5", look && "text-current", waypoint && "text-[#b02e7c] dark:text-[#ec8cc4]")} onChange={onChange}
      />
    </span>
  );
  return (
    <ContextMenu onOpenChange={open => { menuOut.current = open; }}>
      <ContextMenuTrigger asChild>{pill}</ContextMenuTrigger>
      <ContextMenuContent>
        {/* The altitude there, before Remove, at the pilot's ask: a
            waypoint's cruise, as a flight level, an airport's pattern, in
            feet -- the plan's until the pilot sets their own. Asked once
            the menu has gone, so the dialog takes the focus it hands back. */}
        <ContextMenuItem onSelect={() => window.setTimeout(onEditAltitude)} data-testid="point-altitude">
          <MoveVertical />
          {waypoint ? "Altitude" : "Pattern altitude"}
          <ContextMenuShortcut className={cn("flex items-center gap-1 tracking-normal tabular-nums", altitude.caution?.length && "text-amber-600 dark:text-amber-400")}>
            {altitude.caution?.length ? <TriangleAlert className="size-3.5" aria-label="With a caution" /> : null}
            {waypoint ? flightLevel(altitude.feet) : altitude.feet === null ? "—" : `${altFt(altitude.feet)} ft`}
          </ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem variant="destructive" onSelect={onRemove} data-testid="remove-point">
          {/* The one word, at the pilot's ask: the menu is the pill's. */}
          <Trash2 />Remove
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
